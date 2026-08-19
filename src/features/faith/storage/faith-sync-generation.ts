import { Directory, File, Paths } from 'expo-file-system';

import { faithStorageKeys, isRecord, readJson, removeKey, writeChecked } from './faith-storage';
import type { RecitationRow, TranslationAttribution, TranslationRow } from './faith-sync-rows';
import type { ArabicRow } from './faith-arabic-rows';
import {
  type BackupExclusionOutcome,
  ensureExcludedFromBackup,
  isBackupSafe,
} from './faith-backup-exclusion';

/**
 * Synchronised Qur'an content, published as immutable file-backed generations.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── The two defects this module exists to fix ──────────────────────────────
 * **1. Sequential durable writes are not a transaction.** The previous orchestrator wrote
 * translations, then recitations, then the audio clock, then the token — four separate durable
 * writes. A process death or a failed write between any two of them leaves the device holding
 * translation rows from one run beside recitation rows from another, with a token acknowledging
 * content that was never fully applied. Deferring writes until the end of a function is not
 * atomicity; the window is smaller, and it is still a window.
 *
 * **2. Multi-megabyte JSON does not belong in AsyncStorage.** The live snapshots measured
 * `over_2_to_4_mib` (translations) and `over_4_to_8_mib` (recitations), and the transformed JSON is
 * larger than the wire body. AsyncStorage on Android is one SQLite database with a shared cursor
 * window; storing rows of that size is a production failure that no unit test on an in-memory double
 * would ever reveal. Raising the database size, or sharding across keys, would move the failure
 * rather than remove it.
 *
 * ── The fix: one pointer flip publishes everything ─────────────────────────
 * A **generation** is a private directory holding every synchronised resource *and the token that
 * acknowledges them*, written as ordinary files. Publication is a single small AsyncStorage write of
 * `{version, generationId}`. That write is the only moment anything becomes visible, so:
 *
 *   • a crash before it leaves the previous generation active, whole and untouched;
 *   • a crash after it leaves the new generation active, whole;
 *   • there is no third state, because no reader consults anything but the pointer.
 *
 * The token is **inside** the generation rather than beside it. It acknowledges the content in that
 * directory, so storing it anywhere else recreates the very skew this module removes — a token that
 * outlives the rows it was issued for is a claim that work was done which was not.
 *
 * ── Why immutable, and why a fresh directory per generation ────────────────
 * Nothing is ever edited in place. A generation directory is written once, validated by reopening it,
 * and then only ever read or deleted whole. That is what lets a reader hold a generation id and know
 * that every file it reads under that id belongs to the same coherent publication, even if a new one
 * is published while it reads.
 *
 * ── What lives in AsyncStorage after this ──────────────────────────────────
 * The pointer, and nothing else from this module. Rows, attribution, reconciliation metadata and the
 * token are all file-backed. A source scan asserts this file is the only writer of the pointer key
 * and that no large dataset reaches `writeChecked`.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/** The on-disk schema. A mismatch rejects the generation rather than migrating it. */
/**
 * The generation schema version.
 *
 * Raised to 2 when Arabic joined the generation. A v1 generation is still a valid, readable
 * generation — it simply predates the Arabic permission and holds no Arabic — so the reader accepts
 * both and reports Arabic as unavailable for v1. Refusing v1 outright would discard a perfectly good
 * translation and recitation index and force an eight-mebibyte re-download to arrive at the same
 * bytes.
 */
export const GENERATION_SCHEMA_VERSION = 2;

/** Versions this build can open. Anything else is not a generation this code understands. */
export const READABLE_SCHEMA_VERSIONS: readonly number[] = [1, 2];

/** The pointer schema, versioned separately because it changes far less often. */
export const GENERATION_POINTER_VERSION = 1;

/** The root, under private application storage. Never external, never shared, never exported. */
const ROOT_DIRECTORY = 'quran-sync';

const TRANSLATIONS_FILE = 'translations.json';
const RECITATIONS_FILE = 'recitations.json';
const ARABIC_FILE = 'arabic.json';

/**
 * Arabic carries no vendor resource id, unlike translations (85) and recitations (3).
 *
 * The shared dataset validator compares one, so a value is required; zero is the explicit
 * "not applicable" marker rather than a real identifier. The script name is Arabic's actual identity,
 * and it is validated separately against the manifest.
 */
const ARABIC_RESOURCE_ID = 0;
/** Written last inside a generation directory. Its absence means the generation is unpublishable. */
const MANIFEST_FILE = 'generation.json';
const PART_SUFFIX = '.part';

/**
 * Free space kept in reserve beyond what the new generation needs.
 *
 * Publication requires the old and new generations to coexist, so the preflight asks for the new
 * generation's size *plus* this. Sixteen mebibytes is roughly one more generation's worth of
 * headroom, which covers the filesystem's own overhead and leaves the device usable if the estimate
 * was low. A download that fails halfway for want of space is worse than one that never started.
 */
export const STORAGE_RESERVE_BYTES = 16 * 1024 * 1024;

export type GenerationPointer = {
  readonly version: number;
  readonly generationId: string;
};

/** What one file in a generation must prove about itself when reopened. */
export type DatasetIntegrity = {
  readonly resourceId: number;
  readonly rowCount: number;
  /**
   * The real UTF-8 size on disk, for the storage preflight and for reporting.
   *
   * Distinct from `charLength` deliberately, and the distinction is not pedantry: Arabic and the
   * typographic punctuation in translated text are two and three bytes per character, so a preflight
   * that reserved space from a character count would under-reserve by roughly half on exactly the
   * content this app stores.
   */
  readonly byteLength: number;
  /** UTF-16 code units of the serialised text, which is what the cheap reopen check compares. */
  readonly charLength: number;
  /** A deterministic checksum over the serialised text. Detects a torn or truncated file. */
  readonly checksum: string;
};

export type GenerationManifest = {
  readonly schemaVersion: number;
  readonly generationId: string;
  readonly createdAt: number;
  readonly validatedAt: number;
  /**
   * The feed checkpoint this generation acknowledges.
   *
   * Inside the generation, deliberately. The token is a claim about the content in this directory,
   * so it lives with that content and is published by the same pointer flip.
   */
  readonly feed: {
    readonly resources: string;
    readonly syncToken: string;
    readonly syncedUntilSequence: number;
  };
  readonly translations: DatasetIntegrity & { readonly hasAttribution: boolean };
  readonly recitations: DatasetIntegrity;
  /**
   * The complete Arabic Qur'an, when this generation carries it.
   *
   * Optional because a v1 generation predates the permission. `null` is the honest value for
   * "this generation has no Arabic", and every reader must treat it as unavailable rather than
   * substituting anything — there is no fallback text and no reconstruction.
   *
   * `lastCheckedAt` is the seven-connected-day Arabic clock. It lives here, inside the generation,
   * for the same reason the feed token does: it is a claim about the content in this directory, and
   * a clock in AsyncStorage could drift away from the rows it describes. There is deliberately no
   * competing standalone Arabic clock anywhere.
   */
  readonly arabic:
    | (DatasetIntegrity & {
        readonly script: string;
        readonly lastCheckedAt: number;
      })
    | null;
  /** How the recitation resource was reconciled, and when. Part of the generation, not a side record. */
  readonly recitation: {
    readonly lastCheckedAt: number;
    readonly method: RecitationCheckMethod;
    readonly mutationEverObserved: boolean;
  };
};

/**
 * How the recitation resource was last reconciled.
 *
 * Declared here because the manifest is the only thing that stores it. It used to live in
 * `faith-recitation-check.ts` alongside a second, separately persisted clock; that module was
 * retired once the generation became the single authority, and keeping a type there would have kept
 * the file alive for no reason other than the type.
 *
 * `mutation` is the documented path and has not yet occurred on any device. `snapshot` means the
 * rows came from re-reading the approved resource-3 snapshot. `none` means neither was needed —
 * a clean no-mutation run, which is the expected weekly result.
 */
export type RecitationCheckMethod = 'none' | 'mutation' | 'snapshot';

/** A generation, opened and fully validated. Every field came from one directory. */
export type ActiveGeneration = {
  readonly manifest: GenerationManifest;
  readonly translations: {
    readonly resourceId: number;
    readonly attribution: TranslationAttribution | null;
    readonly rows: readonly TranslationRow[];
  };
  readonly recitations: {
    readonly resourceId: number;
    readonly rows: readonly RecitationRow[];
  };
  /** `null` on a v1 generation, and on any generation published before a complete baseline existed. */
  readonly arabic: {
    readonly script: string;
    readonly rows: readonly ArabicRow[];
    readonly lastCheckedAt: number;
  } | null;
};

/** What a caller hands over to publish. Everything a generation needs, in one value. */
export type GenerationDraft = {
  readonly generationId: string;
  readonly createdAt: number;
  readonly feed: GenerationManifest['feed'];
  readonly translations: ActiveGeneration['translations'];
  readonly recitations: ActiveGeneration['recitations'];
  readonly recitation: GenerationManifest['recitation'];
  /** Omitted or `null` publishes a generation with no Arabic, which stays a valid generation. */
  readonly arabic?: ActiveGeneration['arabic'];
};

export type PublishFailure =
  | 'insufficient-storage'
  | 'staging-failed'
  | 'validation-failed'
  | 'pointer-failed'
  /**
   * The caller's session ended before the pointer was written.
   *
   * Distinct from every other reason because nothing went wrong: the work was correct and was
   * abandoned deliberately. The previous generation is still active, and the staged directory is an
   * unreferenced one for `sweepGenerations` to remove.
   */
  | 'cancelled';

/**
 * How a caller keeps a publication from outliving its authority.
 *
 * Consulted twice — before anything is staged, and in the instruction immediately before the pointer
 * write. The second is the one that matters: the pointer write is the only moment a generation
 * becomes visible, so a check there is the last point at which "nothing was published" is still true.
 */
export type PublishOptions = {
  /** Returns false once the caller's session has ended. Absent means the caller has no session. */
  readonly isValid?: () => boolean;
};

export type PublishOutcome =
  | {
      readonly kind: 'published';
      readonly generationId: string;
      readonly bytes: number;
      /**
       * Set when Arabic was offered and dropped because backup exclusion could not be confirmed.
       *
       * Reported rather than logged, and carries no path, URI or content — only the fact. A caller
       * that asked to publish Arabic and did not is entitled to know why, so the reader's "Arabic
       * unavailable" state is explainable instead of mysterious.
       */
      readonly arabicRefusedForBackup?: boolean;
    }
  | { readonly kind: 'failed'; readonly reason: PublishFailure };

// ─────────────────────────────────────────────────────────────────────────────
// Integrity
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A deterministic checksum over serialised text — FNV-1a, 32-bit, as eight hex digits.
 *
 * ── Why this rather than a cryptographic digest ────────────────────────────
 * The threat is a **torn or truncated file**, not a forged one: this is private application storage
 * that only NoorLife writes. FNV-1a detects truncation, a lost chunk and a flipped byte, costs one
 * pass with no dependency, and runs in milliseconds over eight mebibytes — where SHA-256 in
 * JavaScript over the same data would be seconds on every launch.
 *
 * It is one of three checks, and the weakest of them. Byte length catches truncation on its own, and
 * the structural revalidation on reopen — every row, every verse identity — is what actually proves
 * the file is the dataset it claims to be. A checksum that matched a wrong-but-well-formed file would
 * still be rejected by that.
 */
/** The real encoded size, which is what a filesystem stores and a preflight must reserve. */
export function utf8Length(text: string): number {
  return new TextEncoder().encode(text).length;
}

export function checksumOf(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    /* The FNV prime, applied with shifts so the whole product stays inside 32 bits. */
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

// ─────────────────────────────────────────────────────────────────────────────
// Paths — private application storage, and nowhere else
// ─────────────────────────────────────────────────────────────────────────────

function rootDirectory(): Directory {
  return new Directory(Paths.document, ROOT_DIRECTORY);
}

function generationDirectory(generationId: string): Directory {
  return new Directory(rootDirectory(), generationId);
}

/**
 * Where a not-yet-complete Arabic baseline accumulates, and why it lives inside the generation root.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * A complete Arabic baseline is roughly 180 authenticated `list_verses` requests. That is not work a
 * single run can be relied upon to finish — a rate limit, a lost connection or the process being
 * killed will interrupt it — and a design that restarted from surah 1 each time would spend the
 * vendor's rate limit repeatedly to arrive nowhere. So partial work is durable, and a run resumes
 * where the last one stopped.
 *
 * It sits **inside** the generation root rather than beside it for one reason: this is Quran
 * Foundation's Arabic text on disk, under the same permission as everything else here, and the root
 * is the directory the iOS backup exclusion is applied to. A sibling directory would need its own
 * exclusion, its own path allowance in the native module, and its own way to be wrong.
 *
 * It is deliberately **not** a generation. It has no manifest, no pointer and no reader — nothing
 * outside the sync transaction opens it, and it becomes visible only by being validated in full and
 * published into a real generation. The sweeper skips it by name for that reason: it is neither an
 * active generation nor an unreferenced one, and deleting it between two runs would reset the
 * baseline to zero on every publication.
 * ═══════════════════════════════════════════════════════════════════════════
 */
export const ARABIC_STAGING_DIRECTORY = '_arabic-staging';

/** The staging directory, created on demand. The root's backup exclusion covers everything in it. */
export function arabicStagingDirectory(): Directory {
  ensureRoot();
  const directory = new Directory(rootDirectory(), ARABIC_STAGING_DIRECTORY);
  if (!directory.exists) {
    directory.create();
  }
  return directory;
}

/** `Paths.document` is the app-internal files directory: not shared media, not user-visible. */
function ensureRoot(): void {
  const root = rootDirectory();
  if (!root.exists) {
    root.create();
  }
  /*
    Applied on creation as well as before publication. A directory created here and marked now is the
    common case; the publish-time check exists because a root recreated in between would otherwise
    carry no flag, and that is the moment the licence actually rests on.
  */
  ensureExcludedFromBackup(root.uri);
}

/**
 * Whether this device can hold retained Arabic within the terms of the permission.
 *
 * iOS must confirm the backup exclusion; Android's rules already exclude the file domain. Anything
 * else is a refusal rather than a warning — see `faith-backup-exclusion.ts` for why the honest
 * failure is to hold no Arabic at all.
 */
export function arabicRetentionAllowed(): {
  readonly allowed: boolean;
  readonly outcome: BackupExclusionOutcome;
} {
  const outcome = ensureExcludedFromBackup(rootDirectory().uri);
  return { allowed: isBackupSafe(outcome), outcome };
}

// ─────────────────────────────────────────────────────────────────────────────
// The pointer — the only thing this module puts in AsyncStorage
// ─────────────────────────────────────────────────────────────────────────────

function isPointer(value: unknown): value is GenerationPointer {
  if (!isRecord(value)) {
    return false;
  }
  const { version, generationId } = value;
  return (
    version === GENERATION_POINTER_VERSION &&
    typeof generationId === 'string' &&
    generationId.length > 0
  );
}

export async function readGenerationPointer(): Promise<GenerationPointer | null> {
  return await readJson<GenerationPointer | null>(
    faithStorageKeys.quranGenerationPointer,
    null,
    (value): value is GenerationPointer | null => value === null || isPointer(value),
  );
}

export async function clearGenerationPointer(): Promise<void> {
  await removeKey(faithStorageKeys.quranGenerationPointer);
}

// ─────────────────────────────────────────────────────────────────────────────
// Reading — always through the pointer, always from one directory
// ─────────────────────────────────────────────────────────────────────────────

function readTextFile(directory: Directory, name: string): string | null {
  try {
    const file = new File(directory, name);
    return file.exists ? file.textSync() : null;
  } catch {
    /* Unreadable is indistinguishable from absent for every caller's purpose. */
    return null;
  }
}

function validateDataset(
  text: string,
  integrity: DatasetIntegrity,
): { readonly rows: unknown[]; readonly payload: Record<string, unknown> } | null {
  if (text.length !== integrity.charLength || checksumOf(text) !== integrity.checksum) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) {
    return null;
  }
  const rows = parsed.rows;
  if (!Array.isArray(rows) || rows.length !== integrity.rowCount) {
    return null;
  }
  if (parsed.resourceId !== integrity.resourceId) {
    return null;
  }
  return { rows, payload: parsed };
}

/**
 * Every row's identity is re-checked on reopen, not just the count.
 *
 * A file with the right number of well-formed rows for the wrong verses would pass a count check and
 * every checksum, and would then be rendered as scripture. The verse key is compared against the
 * surah and ayah beside it — the same rule `faith-sync-rows.ts` applies on the way in — so identity
 * is proved twice and by the same standard.
 */
function readTranslationRows(
  rows: readonly unknown[],
  resourceId: number,
): TranslationRow[] | null {
  const out: TranslationRow[] = [];
  for (const raw of rows) {
    if (!isRecord(raw)) {
      return null;
    }
    const { verseKey, surah, ayah, text, sequence, refreshedAt } = raw;
    if (
      typeof surah !== 'number' ||
      typeof ayah !== 'number' ||
      typeof text !== 'string' ||
      text.length === 0 ||
      verseKey !== `${surah}:${ayah}`
    ) {
      return null;
    }
    out.push({
      verseKey,
      surah,
      ayah,
      text,
      resourceId,
      sequence: typeof sequence === 'number' ? sequence : null,
      refreshedAt: typeof refreshedAt === 'number' ? refreshedAt : 0,
    });
  }
  return out;
}

/**
 * Reads Arabic rows back, refusing anything the writer could not have produced.
 *
 * Strict on purpose: this is the read side of an exactness guarantee. A row whose key disagrees with
 * its numbers, or whose script is not the one the manifest names, means the file is not the dataset
 * the manifest describes — and a Qur'an assembled from a file that is not what it claims is exactly
 * what the whole generation model exists to prevent.
 *
 * The text is passed through untouched. There is no trim, no normalise, no substitution.
 */
function readArabicRows(rows: readonly unknown[], script: string): ArabicRow[] | null {
  const out: ArabicRow[] = [];
  for (const raw of rows) {
    if (!isRecord(raw)) {
      return null;
    }
    const { verseKey, surah, ayah, text } = raw;
    if (typeof surah !== 'number' || typeof ayah !== 'number' || verseKey !== `${surah}:${ayah}`) {
      return null;
    }
    if (typeof text !== 'string' || text.length === 0) {
      return null;
    }
    if (raw.script !== script) {
      return null;
    }
    out.push({ verseKey, surah, ayah, text, script: script as ArabicRow['script'] });
  }
  return out;
}

function readRecitationRows(rows: readonly unknown[], resourceId: number): RecitationRow[] | null {
  const out: RecitationRow[] = [];
  for (const raw of rows) {
    if (!isRecord(raw)) {
      return null;
    }
    const { verseKey, surah, ayah, durationSeconds, bytes, sequence, refreshedAt } = raw;
    if (typeof surah !== 'number' || typeof ayah !== 'number' || verseKey !== `${surah}:${ayah}`) {
      return null;
    }
    out.push({
      verseKey,
      resourceId,
      surah,
      ayah,
      durationSeconds: typeof durationSeconds === 'number' ? durationSeconds : null,
      bytes: typeof bytes === 'number' ? bytes : null,
      sequence: typeof sequence === 'number' ? sequence : null,
      refreshedAt: typeof refreshedAt === 'number' ? refreshedAt : 0,
    });
  }
  return out;
}

function isManifest(value: unknown): value is GenerationManifest {
  if (!isRecord(value)) {
    return false;
  }
  const { schemaVersion, generationId, feed, translations, recitations, recitation, arabic } =
    value;
  /*
    A v1 manifest has no `arabic` key at all; a v2 manifest has one, and it is either null or a
    complete integrity block. A present-but-malformed block is a corrupt generation, not an absent
    Arabic dataset, so it is refused rather than read as null.
  */
  const arabicOk =
    arabic === undefined ||
    arabic === null ||
    (isRecord(arabic) && typeof arabic.script === 'string');
  return (
    arabicOk &&
    typeof schemaVersion === 'number' &&
    READABLE_SCHEMA_VERSIONS.includes(schemaVersion) &&
    typeof generationId === 'string' &&
    generationId.length > 0 &&
    isRecord(feed) &&
    typeof feed.syncToken === 'string' &&
    feed.syncToken.length > 0 &&
    typeof feed.resources === 'string' &&
    isRecord(translations) &&
    isRecord(recitations) &&
    isRecord(recitation)
  );
}

/**
 * Opens one generation by id and validates it completely, or returns `null`.
 *
 * Exported so a caller that already holds a generation id can re-read *that* generation rather than
 * whatever the pointer now says — which is how a reader that started under generation A is kept from
 * returning recitations from B when a publication lands mid-read.
 */
export function openGeneration(generationId: string): ActiveGeneration | null {
  const directory = generationDirectory(generationId);
  if (!directory.exists) {
    return null;
  }
  const manifestText = readTextFile(directory, MANIFEST_FILE);
  if (manifestText === null) {
    /* No manifest means the generation was never completed. It is not a candidate for anything. */
    return null;
  }
  let manifest: unknown;
  try {
    manifest = JSON.parse(manifestText);
  } catch {
    return null;
  }
  if (!isManifest(manifest) || manifest.generationId !== generationId) {
    return null;
  }

  const translationsText = readTextFile(directory, TRANSLATIONS_FILE);
  const recitationsText = readTextFile(directory, RECITATIONS_FILE);
  if (translationsText === null || recitationsText === null) {
    return null;
  }

  const translationsFile = validateDataset(translationsText, manifest.translations);
  const recitationsFile = validateDataset(recitationsText, manifest.recitations);
  if (translationsFile === null || recitationsFile === null) {
    return null;
  }

  const translationRows = readTranslationRows(
    translationsFile.rows,
    manifest.translations.resourceId,
  );
  const recitationRows = readRecitationRows(recitationsFile.rows, manifest.recitations.resourceId);
  if (translationRows === null || recitationRows === null) {
    return null;
  }

  const attribution = translationsFile.payload.attribution;
  if (manifest.translations.hasAttribution && !isRecord(attribution)) {
    /* The manifest says a credit was published; a generation missing it is not the one it claims. */
    return null;
  }

  /*
    Arabic is read only when the manifest says this generation carries it. A v1 generation, or a v2
    one published before a complete baseline existed, answers `null` — and every reader treats that
    as "Arabic unavailable" rather than substituting anything.

    When the manifest *does* claim Arabic, a missing or failing file is a corrupt generation, not an
    absent dataset: the whole generation is refused, so no half-updated Qur'an can be exposed.
  */
  let arabic: ActiveGeneration['arabic'] = null;
  if (manifest.arabic != null) {
    const arabicText = readTextFile(directory, ARABIC_FILE);
    if (arabicText === null) {
      return null;
    }
    const arabicFile = validateDataset(arabicText, manifest.arabic);
    if (arabicFile === null) {
      return null;
    }
    const arabicRows = readArabicRows(arabicFile.rows, manifest.arabic.script);
    if (arabicRows === null || arabicRows.length !== manifest.arabic.rowCount) {
      return null;
    }
    arabic = {
      script: manifest.arabic.script,
      rows: arabicRows,
      lastCheckedAt: manifest.arabic.lastCheckedAt,
    };
  }

  return {
    manifest,
    arabic,
    translations: {
      resourceId: manifest.translations.resourceId,
      attribution: isRecord(attribution)
        ? (attribution as unknown as TranslationAttribution)
        : null,
      rows: translationRows,
    },
    recitations: { resourceId: manifest.recitations.resourceId, rows: recitationRows },
  };
}

/**
 * The active generation, resolved through the pointer, or `null`.
 *
 * A pointer to a generation that does not validate answers `null` rather than a partial read. There
 * is deliberately no fallback to an ordinary cache: content served from the seven-day cache is not
 * synchronised content, and returning it here would let a caller describe it as though it were.
 */
export function readActiveGenerationSync(
  pointer: GenerationPointer | null,
): ActiveGeneration | null {
  return pointer === null ? null : openGeneration(pointer.generationId);
}

export async function readActiveGeneration(): Promise<ActiveGeneration | null> {
  return readActiveGenerationSync(await readGenerationPointer());
}

// ─────────────────────────────────────────────────────────────────────────────
// Publishing
// ─────────────────────────────────────────────────────────────────────────────

function serialiseTranslations(draft: GenerationDraft): string {
  return JSON.stringify({
    resourceId: draft.translations.resourceId,
    attribution: draft.translations.attribution,
    rows: draft.translations.rows,
  });
}

function serialiseRecitations(draft: GenerationDraft): string {
  return JSON.stringify({
    resourceId: draft.recitations.resourceId,
    rows: draft.recitations.rows,
  });
}

/** Writes to `<name>.part`, then renames. A reader never sees a name that is still being written. */
function stageFile(directory: Directory, name: string, text: string): boolean {
  try {
    const partial = new File(directory, `${name}${PART_SUFFIX}`);
    if (partial.exists) {
      partial.delete();
    }
    partial.create();
    partial.write(text);
    /* Reopened before the rename: a write that reported success and produced nothing stops here. */
    if (partial.textSync() !== text) {
      partial.delete();
      return false;
    }
    /*
      A generation id is derived from the run so a retry reuses the directory, which means the
      destination can already exist — the sweeper's "partials left by an interrupted re-publication
      of the same id" is that case named. `overwrite` defaults to false, so without this a retried
      publication fails at the first dataset it re-stages.
    */
    partial.moveSync(new File(directory, name), { overwrite: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * Whether there is room for the new generation while the old one is still present.
 *
 * Publication is a pointer flip, so both generations exist at once by design — the old one is only
 * eligible for removal *after* the flip succeeds. The preflight therefore asks for the new
 * generation's full size plus a reserve, and failing here keeps the old generation exactly as it was.
 */
export function hasRoomFor(bytes: number): boolean {
  const available = Paths.availableDiskSpace;
  return typeof available !== 'number' || available >= bytes + STORAGE_RESERVE_BYTES;
}

/**
 * Writes, validates and publishes a generation. One pointer write makes all of it visible.
 *
 * The order is the guarantee, and every step before the last is reversible by doing nothing:
 *
 *   1. preflight storage for both generations coexisting
 *   2. create a fresh directory for this generation id
 *   3. write each dataset to `.part`, reopen it, rename it
 *   4. write the manifest last, the same way
 *   5. **reopen and fully validate the whole generation from disk**
 *   6. write the pointer — the single publication
 *
 * A failure at 1–5 leaves the previous pointer untouched, so the previous generation stays active and
 * whole. A failure at 6 does the same. There is no step that mutates the active generation.
 *
 * `options.isValid` is consulted before step 2 and again in the instruction immediately before step
 * 6. Between those two points the caller's session may end at any time — the answer is the same
 * either way, because nothing before the pointer write is visible to any reader.
 */
export async function publishGeneration(
  draft: GenerationDraft,
  options: PublishOptions = {},
): Promise<PublishOutcome> {
  const translationsText = serialiseTranslations(draft);
  const recitationsText = serialiseRecitations(draft);
  let arabic = draft.arabic ?? null;
  /*
    Fail closed. If the platform cannot confirm that the generation root is outside backup, the
    Arabic is dropped from this publication rather than written somewhere it might be copied to
    iCloud. The rest of the generation still publishes: translations and recitations have their own
    terms, and refusing them would be a second wrong.
  */
  let arabicRefusedForBackup = false;
  if (arabic !== null && !arabicRetentionAllowed().allowed) {
    arabic = null;
    arabicRefusedForBackup = true;
  }
  /*
    Serialised in the same shape as the other datasets so one validator covers all three. Absent
    Arabic stages no file at all, rather than an empty one — an empty Arabic file would be a dataset
    claiming to be a complete Qur'an with nothing in it.
  */
  const arabicText =
    arabic === null
      ? null
      : JSON.stringify({
          resourceId: ARABIC_RESOURCE_ID,
          script: arabic.script,
          rows: arabic.rows,
        });
  /* Measured as encoded bytes, because that is what the filesystem and the preflight deal in. */
  const translationBytes = utf8Length(translationsText);
  const recitationBytes = utf8Length(recitationsText);
  const arabicBytes = arabicText === null ? 0 : utf8Length(arabicText);
  const bytes = translationBytes + recitationBytes + arabicBytes;

  if (!hasRoomFor(bytes)) {
    return { kind: 'failed', reason: 'insufficient-storage' };
  }

  /* Before a byte is staged. An ended session should not spend the device's storage either. */
  if (options.isValid?.() === false) {
    return { kind: 'failed', reason: 'cancelled' };
  }

  let directory: Directory;
  try {
    ensureRoot();
    directory = generationDirectory(draft.generationId);
    if (!directory.exists) {
      directory.create();
    }
  } catch {
    return { kind: 'failed', reason: 'staging-failed' };
  }

  const manifest: GenerationManifest = {
    schemaVersion: GENERATION_SCHEMA_VERSION,
    generationId: draft.generationId,
    createdAt: draft.createdAt,
    validatedAt: draft.createdAt,
    feed: draft.feed,
    translations: {
      resourceId: draft.translations.resourceId,
      rowCount: draft.translations.rows.length,
      byteLength: translationBytes,
      charLength: translationsText.length,
      checksum: checksumOf(translationsText),
      hasAttribution: draft.translations.attribution !== null,
    },
    recitations: {
      resourceId: draft.recitations.resourceId,
      rowCount: draft.recitations.rows.length,
      byteLength: recitationBytes,
      charLength: recitationsText.length,
      checksum: checksumOf(recitationsText),
    },
    recitation: draft.recitation,
    arabic:
      arabic === null || arabicText === null
        ? null
        : {
            resourceId: 0,
            script: arabic.script,
            rowCount: arabic.rows.length,
            byteLength: arabicBytes,
            charLength: arabicText.length,
            checksum: checksumOf(arabicText),
            lastCheckedAt: arabic.lastCheckedAt,
          },
  };

  if (
    !stageFile(directory, TRANSLATIONS_FILE, translationsText) ||
    !stageFile(directory, RECITATIONS_FILE, recitationsText) ||
    (arabicText !== null && !stageFile(directory, ARABIC_FILE, arabicText)) ||
    /* The manifest is written last, so a directory without one is unmistakably incomplete. */
    !stageFile(directory, MANIFEST_FILE, JSON.stringify(manifest))
  ) {
    return { kind: 'failed', reason: 'staging-failed' };
  }

  /* Reopened from disk and validated in full before anything points at it. */
  if (openGeneration(draft.generationId) === null) {
    return { kind: 'failed', reason: 'validation-failed' };
  }

  /*
    The last instruction before publication, and the boundary the whole session model turns on. Up to
    here the staged generation is an unreferenced directory that no reader can reach; one line later
    it is the active generation. A session that ended anywhere in the run — including during the
    staging immediately above — stops here, and the previous generation stays active.
  */
  if (options.isValid?.() === false) {
    return { kind: 'failed', reason: 'cancelled' };
  }

  /*
    Recorded on the outcome rather than logged. A caller that asked to publish Arabic and did not is
    entitled to know why, and the reader's "Arabic unavailable" state is then explainable rather than
    mysterious. No path, no URI and no content is carried — only the fact.
  */
  const published = await writeChecked(faithStorageKeys.quranGenerationPointer, {
    version: GENERATION_POINTER_VERSION,
    generationId: draft.generationId,
  } satisfies GenerationPointer);

  if (!published) {
    /* The old generation is still active, and the staged one is simply an unreferenced directory. */
    return { kind: 'failed', reason: 'pointer-failed' };
  }

  return { kind: 'published', generationId: draft.generationId, bytes, arabicRefusedForBackup };
}

// ─────────────────────────────────────────────────────────────────────────────
// Cleanup — never at the cost of the active generation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Removes abandoned partials and unreferenced generations. Never touches the active one.
 *
 * Run at startup and after a successful publication. A failure here is reported and otherwise
 * ignored: a generation that could not be deleted wastes space, which is a far smaller problem than
 * a cleanup pass that removed something a reader was about to open.
 */
export async function sweepGenerations(): Promise<{
  readonly removedGenerations: number;
  readonly removedPartials: number;
}> {
  const pointer = await readGenerationPointer();
  const active = pointer?.generationId ?? null;
  let removedGenerations = 0;
  let removedPartials = 0;

  let entries: (Directory | File)[];
  try {
    const root = rootDirectory();
    if (!root.exists) {
      return { removedGenerations: 0, removedPartials: 0 };
    }
    entries = root.list();
  } catch {
    return { removedGenerations: 0, removedPartials: 0 };
  }

  for (const entry of entries) {
    const name = entry.uri.replace(/\/+$/, '').split('/').pop() ?? '';
    if (name === '' || name === active) {
      /* The active generation is never a candidate, whatever else is true of it. */
      continue;
    }
    if (name === ARABIC_STAGING_DIRECTORY) {
      /*
        Not a generation and not an unreferenced one. It holds a partial Arabic baseline that the
        next run will resume, and sweeping it after every publication would restart that baseline
        from surah 1 forever — the exact failure the staging directory exists to prevent.
      */
      continue;
    }
    try {
      const directory = generationDirectory(name);
      if (!directory.exists) {
        continue;
      }
      /*
        A directory with no manifest was never published; one with a manifest that is not the active
        pointer is a superseded generation. Both are unreferenced, and neither can be being read
        through the pointer, because the pointer names something else.
      */
      directory.delete();
      removedGenerations += 1;
    } catch {
      /* Left in place. Wasted space is not a correctness problem. */
    }
  }

  /* Partials inside the active generation, left by an interrupted re-publication of the same id. */
  if (active !== null) {
    try {
      const directory = generationDirectory(active);
      if (directory.exists) {
        for (const entry of directory.list()) {
          if (entry.uri.endsWith(PART_SUFFIX) && entry instanceof File) {
            entry.delete();
            removedPartials += 1;
          }
        }
      }
    } catch {
      /* Nothing to release. */
    }
  }

  return { removedGenerations, removedPartials };
}

/** Removes every generation and the pointer. Used by the Faith data reset. */
export async function clearAllGenerations(): Promise<void> {
  await clearGenerationPointer();
  try {
    const root = rootDirectory();
    if (root.exists) {
      root.delete();
    }
  } catch {
    /* Best effort. */
  }
}
