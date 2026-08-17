import { checksumOf, utf8Length } from './faith-sync-generation';

/**
 * The complete offline recitation of the Qur'an, as one versioned manifest.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── Why this replaces two stores rather than joining them ──────────────────
 * NoorLife held two disagreeing authorities on what recitation audio was on the device:
 *
 *   • `faith-audio-downloads.ts` — an index of *surah decisions*, whose `expiresAt` was computed
 *     from `MAX_CACHE_AGE_MS`, i.e. seven days from **download**. That clock deletes permitted audio
 *     from the user who has been offline, which is precisely the user the extended-retention
 *     permission exists to protect.
 *   • `faith-audio-manifest.ts` — per-ayah rows bound to synchronised identity, which nothing at
 *     runtime ever read.
 *
 * Two authorities disagreeing about which bytes are playable is worse than either alone: a screen
 * offers "Remove" for files that are gone, or a player refuses a file that is present and permitted.
 * This module is the only authority, and both of the others are deleted.
 *
 * ── Why the manifest is file-backed and the pointer idea is not repeated ───
 * 6,236 rows do not belong in AsyncStorage. That is not a preference — `faith-sync-generation.ts`
 * documents the measurement: the recitation snapshot alone is `over_4_to_8_mib`, AsyncStorage on
 * Android is one SQLite database with a shared cursor window, and sharding across keys moves the
 * failure rather than removing it. So the manifest is an ordinary private file, written the same way
 * a generation dataset is: to `.part`, reopened and checked, then renamed over the live name.
 *
 * Unlike a generation there is no pointer, because there is no immutability to preserve. A generation
 * is published once and never edited; this manifest is edited continuously as files land. A rename
 * over one well-known name is atomic on both platforms' filesystems, so a reader sees the previous
 * whole manifest or the next whole manifest and never a torn one — which is all the atomicity a
 * single mutable document needs.
 *
 * ── The filesystem is the truth about bytes; this is the truth about meaning ──
 * A row says which vendor generation the bytes came from, whether they were validated, and when they
 * last agreed with the publisher. None of that is recoverable from a directory listing, and all of it
 * is required to answer "may this be played?" under the permission. Conversely a row never proves a
 * file exists — the OS can reclaim storage — so every read still goes through the store, and
 * `reconcileAgainstDisk` repairs the difference rather than either side silently winning.
 *
 * ── What is deliberately absent ────────────────────────────────────────────
 * No URL, no host, no bearer token, no authorization header, no request signature. A CDN address is
 * resolved from the currently published generation at the moment a transfer starts and is discarded
 * when it finishes; binding a file's durable identity to one would make that identity depend on a
 * value the vendor may rotate without telling anybody. `offline-recitation-privacy.test.ts` asserts
 * this file contains no such field.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/** The on-disk schema. A mismatch discards the manifest rather than migrating it in place. */
export const OFFLINE_RECITATION_VERSION = 1;

/**
 * Quran Foundation's recitation resource this manifest may describe.
 *
 * A constant rather than a parameter, and that is the enforcement. The extended-retention permission
 * names **resource 3 alone**; a manifest that accepted a resource id would hold another reciter's
 * files under the same indefinite-retention rules the moment somebody passed one in.
 * `permanentDownloadPermitted` is the only gate, and it answers `false` for every other id.
 */
export const PERMITTED_RESOURCE_ID = 3;

/** The complete recitation, as published. Not a constant to check against — a fact to report. */
export const COMPLETE_AYAH_COUNT = 6236;

export const SURAH_COUNT = 114;

/**
 * Whether a reciter may be kept offline indefinitely.
 *
 * The single place the permission is decided. Other reciters remain catalogue choices under their
 * ordinary caching rules, and there is deliberately no argument, flag or configuration value that
 * could extend this to one of them.
 */
export function permanentDownloadPermitted(resourceId: number): boolean {
  return resourceId === PERMITTED_RESOURCE_ID;
}

// ─────────────────────────────────────────────────────────────────────────────
// States
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Where one ayah's file is in its lifecycle.
 *
 * `available` is the only state a player may source from, and it is deliberately distinct from
 * `downloaded`: bytes having arrived is not the same as bytes having been checked, and collapsing the
 * two is exactly how an unvalidated file reaches a player.
 *
 * There is no expiry state here, because expiry is not a property of a permitted file. A file whose
 * resource has not been reconciled inside seven days stays `available` and the *whole-download* state
 * carries the owed check — see `OfflineDownloadState`. The licence obliges a check, not a deletion.
 */
export type OfflineFileState =
  | 'queued'
  | 'downloading'
  | 'downloaded'
  | 'verifying'
  | 'available'
  /** The publisher's row changed. The current file stays playable until a replacement is promoted. */
  | 'update-required'
  | 'failed'
  | 'removing';

/**
 * The states a player may source a file from.
 *
 * ── Why `update-required` is in this list ───────────────────────────────────
 * Because a superseded recitation is still a recitation. The row means "the publisher has changed
 * this and a replacement is owed", not "these bytes are wrong" — they were validated when they
 * arrived and they have not changed since. Excluding them would put a **hole in the surah** for the
 * whole of the update window: playback would stop at that verse, the reader would offer the Offline
 * audio screen, and the user would be told a verse they demonstrably have is not downloaded.
 *
 * That is also what Phase 4 requires in the other direction — the currently playable valid file is
 * never removed before its replacement is ready. Keeping it out of this list would make it unplayable
 * without removing it, which is the same harm by a quieter route.
 *
 * `queued`, `downloading` and `downloaded` are excluded for the opposite reason: bytes having arrived
 * is not the same as bytes having been checked, and collapsing the two is how an unvalidated file
 * reaches a player.
 */
export const PLAYABLE_FILE_STATES: readonly OfflineFileState[] = ['available', 'update-required'];

/**
 * What the whole download is doing.
 *
 * Fourteen states, none of which is a synonym for another. Three pairs are worth naming because
 * collapsing them is the obvious simplification and each collapse loses a fact the user acts on:
 *
 *   • `waiting-for-wifi` vs `waiting-for-connection` — the first is the user's own preference holding
 *     the download; the second is the device. The remedy differs, so the state must.
 *   • `paused` vs `waiting-for-*` — a pause is a decision and survives a reconnection; a wait resumes
 *     by itself. A download that silently restarted after the user paused it would be spending their
 *     data against their instruction.
 *   • `partially-downloaded` vs `failed` — verified files exist in the first and the run simply
 *     stopped; the second is a run that could not proceed. Neither permits deleting what landed.
 */
export type OfflineDownloadState =
  | 'not-downloaded'
  /** Resolving how large this will be. No bytes of audio have been requested yet. */
  | 'estimating'
  /** Estimated, room confirmed, awaiting the user's go-ahead. Nothing has been fetched. */
  | 'ready'
  | 'downloading'
  | 'paused'
  | 'waiting-for-wifi'
  | 'waiting-for-connection'
  | 'insufficient-storage'
  | 'partially-downloaded'
  | 'verifying'
  | 'complete'
  /** A newer generation changed rows this device holds. Existing files stay playable meanwhile. */
  | 'update-required'
  | 'removing'
  | 'failed';

/** The states in which a run is making progress or is about to. */
export const ACTIVE_DOWNLOAD_STATES: readonly OfflineDownloadState[] = [
  'estimating',
  'downloading',
  'verifying',
  'removing',
];

/** The states a run can be resumed from without the user re-deciding anything. */
export const RESUMABLE_DOWNLOAD_STATES: readonly OfflineDownloadState[] = [
  'downloading',
  'paused',
  'waiting-for-wifi',
  'waiting-for-connection',
  'insufficient-storage',
  'partially-downloaded',
  'update-required',
  'failed',
];

/**
 * What validation concluded about a file's bytes.
 *
 * Three values, and `unverified` is not a failure. A file adopted from a previous build, or promoted
 * by a process that died before it could record the result, is genuinely unverified — and saying so
 * is what lets the repair pass re-check it instead of either trusting it or deleting it.
 */
export type OfflineValidation = 'unverified' | 'signature-ok' | 'rejected';

/** What the user asked for. Drives which surahs a run covers and what "complete" means. */
export type OfflineScope =
  | { readonly kind: 'none' }
  | { readonly kind: 'complete' }
  /** Specific surahs, in ascending order, deduplicated. */
  | { readonly kind: 'selected'; readonly surahs: readonly number[] };

// ─────────────────────────────────────────────────────────────────────────────
// The model
// ─────────────────────────────────────────────────────────────────────────────

export type OfflineFileRow = {
  /** Always `PERMITTED_RESOURCE_ID`. Carried on the row so a row read in isolation is complete. */
  readonly resourceId: number;
  readonly surah: number;
  readonly ayah: number;
  /** `surah:ayah`, the publisher's own stable identity. Checked against the numbers beside it. */
  readonly verseKey: string;
  /** The name inside the private download directory. Never a path, never derived from a URL. */
  readonly fileName: string;
  readonly state: OfflineFileState;
  /** Bytes actually on disk at the last write. Zero until something is promoted. */
  readonly bytes: number;
  /** What the publisher said it would be, where it said. Never estimated onto a row. */
  readonly expectedBytes: number | null;
  readonly validation: OfflineValidation;
  /** The generation these bytes were resolved and validated under. Null only for adopted legacy files. */
  readonly generationId: string | null;
  /** The vendor sequence of the row these bytes came from, where one was supplied. */
  readonly sequence: number | null;
  /** Epoch ms the file was validated and promoted. */
  readonly completedAt: number | null;
  /** Epoch ms this row last agreed with a published generation's row. */
  readonly verifiedAt: number | null;
};

export type OfflineManifest = {
  readonly version: number;
  readonly resourceId: number;
  readonly download: OfflineDownloadState;
  readonly scope: OfflineScope;
  /**
   * The generation the current or last run was bound to.
   *
   * One run, one generation. A mutation that mixed rows from two publications could promote an ayah
   * resolved under a generation that had already been superseded, with nothing downstream able to
   * notice — so the binding is recorded and `bindGeneration` refuses to change it mid-run.
   */
  readonly generationId: string | null;
  /** Wi-Fi-only, on by default. A large download is not something to start on somebody's data plan. */
  readonly wifiOnly: boolean;
  readonly rows: readonly OfflineFileRow[];
  /** Epoch ms the manifest last agreed with a published generation in full. */
  readonly reconciledAt: number | null;
  /** Whether the one-time adoption of pre-manifest files has run to completion. */
  readonly migratedLegacyFiles: boolean;
};

export const EMPTY_MANIFEST: OfflineManifest = {
  version: OFFLINE_RECITATION_VERSION,
  resourceId: PERMITTED_RESOURCE_ID,
  download: 'not-downloaded',
  scope: { kind: 'none' },
  generationId: null,
  wifiOnly: true,
  rows: [],
  reconciledAt: null,
  migratedLegacyFiles: false,
};

// ─────────────────────────────────────────────────────────────────────────────
// Identity
// ─────────────────────────────────────────────────────────────────────────────

/** `3:2:255` — resource, surah, ayah. The key every lookup and every mutation is by. */
export function rowKey(resourceId: number, surah: number, ayah: number): string {
  return `${resourceId}:${surah}:${ayah}`;
}

export function verseKeyOf(surah: number, ayah: number): string {
  return `${surah}:${ayah}`;
}

/**
 * The private file name for one ayah.
 *
 * Deterministic from three integers this app already holds, so a crash cannot orphan a file whose
 * name nothing can rederive, and so nothing from a vendor URL ever reaches the filesystem. The
 * resource id is interpolated as a number rather than a sanitised string because the only value it
 * may take is `PERMITTED_RESOURCE_ID` — there is no user-supplied component to escape.
 */
export function offlineFileName(resourceId: number, surah: number, ayah: number): string {
  return `r${resourceId}-s${surah}-a${ayah}.mp3`;
}

export function parseOfflineFileName(
  name: string,
): { readonly resourceId: number; readonly surah: number; readonly ayah: number } | null {
  const match = /^r(\d+)-s(\d+)-a(\d+)\.mp3$/.exec(name);
  if (match === null) {
    return null;
  }
  const [, resourceId, surah, ayah] = match;
  if (resourceId === undefined || surah === undefined || ayah === undefined) {
    return null;
  }
  return { resourceId: Number(resourceId), surah: Number(surah), ayah: Number(ayah) };
}

function keyOf(row: OfflineFileRow): string {
  return rowKey(row.resourceId, row.surah, row.ayah);
}

// ─────────────────────────────────────────────────────────────────────────────
// Queries — pure, and the only way anything asks about the manifest
// ─────────────────────────────────────────────────────────────────────────────

export function findRow(
  manifest: OfflineManifest,
  surah: number,
  ayah: number,
): OfflineFileRow | null {
  const key = rowKey(manifest.resourceId, surah, ayah);
  return manifest.rows.find((row) => keyOf(row) === key) ?? null;
}

/** Whether a player may source this ayah. Checked bytes under a known generation, and nothing less. */
export function isPlayable(row: OfflineFileRow | null): boolean {
  return (
    row !== null &&
    PLAYABLE_FILE_STATES.includes(row.state) &&
    row.validation === 'signature-ok' &&
    row.bytes > 0
  );
}

export function rowsForSurah(manifest: OfflineManifest, surah: number): readonly OfflineFileRow[] {
  return manifest.rows.filter((row) => row.surah === surah);
}

/** Every ayah of one surah that a player may source, in ayah order. */
export function playableAyatOf(manifest: OfflineManifest, surah: number): readonly number[] {
  return rowsForSurah(manifest, surah)
    .filter(isPlayable)
    .map((row) => row.ayah)
    .sort((left, right) => left - right);
}

export type OfflineTotals = {
  readonly playableAyat: number;
  readonly playableBytes: number;
  /** Surahs where every ayah the generation publishes is playable. */
  readonly completeSurahs: number;
  /** Surahs with at least one playable ayah but not all of them. */
  readonly partialSurahs: number;
  readonly failedAyat: number;
  readonly updateRequiredAyat: number;
};

/**
 * What is actually on the device, counted against what the generation publishes.
 *
 * `expectedAyatBySurah` comes from the active generation rather than from a table in this file. A
 * bundled ayah-count table would be a second, unsourced copy of the structure of the Qur'an, and the
 * one thing that can say how many ayat resource 3 publishes for a surah is the publication itself.
 */
export function totalsOf(
  manifest: OfflineManifest,
  expectedAyatBySurah: ReadonlyMap<number, number>,
): OfflineTotals {
  let playableAyat = 0;
  let playableBytes = 0;
  let failedAyat = 0;
  let updateRequiredAyat = 0;
  const playableBySurah = new Map<number, number>();

  for (const row of manifest.rows) {
    if (row.state === 'failed') {
      failedAyat += 1;
    }
    if (row.state === 'update-required') {
      updateRequiredAyat += 1;
    }
    if (!isPlayable(row)) {
      continue;
    }
    playableAyat += 1;
    playableBytes += row.bytes;
    playableBySurah.set(row.surah, (playableBySurah.get(row.surah) ?? 0) + 1);
  }

  let completeSurahs = 0;
  let partialSurahs = 0;
  for (const [surah, count] of playableBySurah) {
    const expected = expectedAyatBySurah.get(surah);
    if (expected !== undefined && count >= expected) {
      completeSurahs += 1;
    } else {
      partialSurahs += 1;
    }
  }

  return {
    playableAyat,
    playableBytes,
    completeSurahs,
    partialSurahs,
    failedAyat,
    updateRequiredAyat,
  };
}

/**
 * Whether every ayah of a surah is playable.
 *
 * The gate Phase 5 turns on: a surah is playable end to end only when the generation's whole list for
 * it is on disk and checked. A surah with a hole answers `false`, and the caller plays the contiguous
 * run it can vouch for rather than pretending.
 */
export function surahIsComplete(
  manifest: OfflineManifest,
  surah: number,
  expectedAyat: number,
): boolean {
  if (expectedAyat <= 0) {
    return false;
  }
  const playable = new Set(playableAyatOf(manifest, surah));
  for (let ayah = 1; ayah <= expectedAyat; ayah += 1) {
    if (!playable.has(ayah)) {
      return false;
    }
  }
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// Mutations — pure, total, and always returning a whole manifest
// ─────────────────────────────────────────────────────────────────────────────

function sorted(rows: readonly OfflineFileRow[]): readonly OfflineFileRow[] {
  return [...rows].sort((left, right) =>
    left.surah === right.surah ? left.ayah - right.ayah : left.surah - right.surah,
  );
}

/**
 * Inserts or replaces rows by identity.
 *
 * Returns a whole manifest rather than mutating, so the caller writes once and either the next state
 * is stored or the previous one is. There is no path that half-describes the filesystem.
 */
export function upsertRows(
  manifest: OfflineManifest,
  rows: readonly OfflineFileRow[],
): OfflineManifest {
  if (rows.length === 0) {
    return manifest;
  }
  const byKey = new Map(manifest.rows.map((row) => [keyOf(row), row]));
  for (const row of rows) {
    byKey.set(keyOf(row), row);
  }
  return { ...manifest, rows: sorted([...byKey.values()]) };
}

export function removeRows(
  manifest: OfflineManifest,
  identities: readonly { readonly surah: number; readonly ayah: number }[],
): OfflineManifest {
  const removing = new Set(
    identities.map((entry) => rowKey(manifest.resourceId, entry.surah, entry.ayah)),
  );
  return { ...manifest, rows: manifest.rows.filter((row) => !removing.has(keyOf(row))) };
}

export function removeSurahRows(manifest: OfflineManifest, surah: number): OfflineManifest {
  return { ...manifest, rows: manifest.rows.filter((row) => row.surah !== surah) };
}

export function setDownloadState(
  manifest: OfflineManifest,
  download: OfflineDownloadState,
): OfflineManifest {
  return manifest.download === download ? manifest : { ...manifest, download };
}

export function setWifiOnly(manifest: OfflineManifest, wifiOnly: boolean): OfflineManifest {
  return manifest.wifiOnly === wifiOnly ? manifest : { ...manifest, wifiOnly };
}

export function setScope(manifest: OfflineManifest, scope: OfflineScope): OfflineManifest {
  const normalised: OfflineScope =
    scope.kind === 'selected'
      ? { kind: 'selected', surahs: [...new Set(scope.surahs)].sort((a, b) => a - b) }
      : scope;
  return { ...manifest, scope: normalised };
}

/**
 * Binds the manifest to one published generation, or refuses.
 *
 * ── Why rebinding mid-run is refused rather than allowed ────────────────────
 * A run resolves vendor URLs from a generation, downloads against them, and promotes files recorded
 * as belonging to it. Changing the binding while transfers are in flight would let a file resolved
 * under generation A be recorded as validated under generation B — the manifest would then claim
 * agreement with a publication those bytes were never compared to, which is the one lie the whole
 * reconciliation depends on not being told.
 *
 * A newer generation is therefore applied by `planReconciliation` **between** runs, never during one.
 */
export function bindGeneration(
  manifest: OfflineManifest,
  generationId: string,
): { readonly kind: 'bound'; readonly manifest: OfflineManifest } | { readonly kind: 'refused' } {
  if (
    manifest.generationId !== null &&
    manifest.generationId !== generationId &&
    ACTIVE_DOWNLOAD_STATES.includes(manifest.download)
  ) {
    return { kind: 'refused' };
  }
  return { kind: 'bound', manifest: { ...manifest, generationId } };
}

// ─────────────────────────────────────────────────────────────────────────────
// Codec — a compact encoding for a document with 6,236 rows
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Short keys on disk, full names in memory.
 *
 * ── Why the encoding is not simply `JSON.stringify(manifest)` ──────────────
 * Field names would be roughly 45% of the file. At 6,236 rows that is the difference between a
 * manifest around 600 KB and one around 1.1 MB, rewritten every time a batch of files is promoted.
 * The rows are otherwise dense and repetitive, so the saving is real and comes at the cost of one
 * lookup table that is exercised by every round-trip test in the suite.
 *
 * `resourceId` is hoisted to the header rather than repeated 6,236 times: this manifest describes one
 * resource by construction, and `decodeManifest` writes it back onto every row so a row read in
 * isolation is still complete. `verseKey` and `fileName` are likewise rederived from the surah and
 * ayah on decode and checked against nothing, because they are functions of those two numbers — a
 * stored copy that disagreed would be a second identity for the same file.
 */
type EncodedRow = readonly [
  surah: number,
  ayah: number,
  state: OfflineFileState,
  bytes: number,
  expectedBytes: number | null,
  validation: OfflineValidation,
  generationId: string | null,
  sequence: number | null,
  completedAt: number | null,
  verifiedAt: number | null,
];

type EncodedManifest = {
  readonly v: number;
  readonly r: number;
  readonly d: OfflineDownloadState;
  readonly k: OfflineScope['kind'];
  readonly ks: readonly number[];
  readonly g: string | null;
  readonly w: boolean;
  readonly c: number | null;
  readonly m: boolean;
  readonly rows: readonly EncodedRow[];
};

export function encodeManifest(manifest: OfflineManifest): string {
  const encoded: EncodedManifest = {
    v: manifest.version,
    r: manifest.resourceId,
    d: manifest.download,
    k: manifest.scope.kind,
    ks: manifest.scope.kind === 'selected' ? manifest.scope.surahs : [],
    g: manifest.generationId,
    w: manifest.wifiOnly,
    c: manifest.reconciledAt,
    m: manifest.migratedLegacyFiles,
    rows: manifest.rows.map((row) => [
      row.surah,
      row.ayah,
      row.state,
      row.bytes,
      row.expectedBytes,
      row.validation,
      row.generationId,
      row.sequence,
      row.completedAt,
      row.verifiedAt,
    ]),
  };
  return JSON.stringify(encoded);
}

const FILE_STATES: readonly string[] = [
  'queued',
  'downloading',
  'downloaded',
  'verifying',
  'available',
  'update-required',
  'failed',
  'removing',
];

const DOWNLOAD_STATES: readonly string[] = [
  'not-downloaded',
  'estimating',
  'ready',
  'downloading',
  'paused',
  'waiting-for-wifi',
  'waiting-for-connection',
  'insufficient-storage',
  'partially-downloaded',
  'verifying',
  'complete',
  'update-required',
  'removing',
  'failed',
];

const VALIDATIONS: readonly string[] = ['unverified', 'signature-ok', 'rejected'];

function isNullableFiniteNumber(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isFinite(value));
}

function isNullableNonEmptyString(value: unknown): value is string | null {
  return value === null || (typeof value === 'string' && value.length > 0);
}

/**
 * Decodes one row, or `null`.
 *
 * Every field is checked, including the ones the encoder wrote itself. This file is on a filesystem
 * the OS may truncate and a user with a rooted device may edit, and a row that decoded into a surah
 * of `0` or an ayah of `NaN` would produce a filename nothing can resolve and a playlist entry that
 * maps to no verse. Rejecting the row costs one re-download; accepting it costs a wrong recitation.
 */
function decodeRow(value: unknown, resourceId: number): OfflineFileRow | null {
  if (!Array.isArray(value) || value.length !== 10) {
    return null;
  }
  const [
    surah,
    ayah,
    state,
    bytes,
    expectedBytes,
    validation,
    generationId,
    sequence,
    completedAt,
    verifiedAt,
  ] = value as readonly unknown[];

  if (
    typeof surah !== 'number' ||
    !Number.isInteger(surah) ||
    surah < 1 ||
    surah > SURAH_COUNT ||
    typeof ayah !== 'number' ||
    !Number.isInteger(ayah) ||
    ayah < 1 ||
    typeof state !== 'string' ||
    !FILE_STATES.includes(state) ||
    typeof bytes !== 'number' ||
    !Number.isFinite(bytes) ||
    bytes < 0 ||
    !isNullableFiniteNumber(expectedBytes) ||
    typeof validation !== 'string' ||
    !VALIDATIONS.includes(validation) ||
    !isNullableNonEmptyString(generationId) ||
    !isNullableFiniteNumber(sequence) ||
    !isNullableFiniteNumber(completedAt) ||
    !isNullableFiniteNumber(verifiedAt)
  ) {
    return null;
  }

  return {
    resourceId,
    surah,
    ayah,
    verseKey: verseKeyOf(surah, ayah),
    fileName: offlineFileName(resourceId, surah, ayah),
    state: state as OfflineFileState,
    bytes,
    expectedBytes,
    validation: validation as OfflineValidation,
    generationId,
    sequence,
    completedAt,
    verifiedAt,
  };
}

/**
 * Decodes a whole manifest, or `null`.
 *
 * All-or-nothing rather than best-effort. A manifest that dropped the rows it could not read would
 * report fewer downloaded ayat than the device holds, and the repair pass would re-download files
 * that are sitting right there — so a document that does not decode in full is discarded, and the
 * disk reconciliation rebuilds it from what actually exists.
 */
export function decodeManifest(text: string): OfflineManifest | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return null;
  }
  const encoded = parsed as Partial<EncodedManifest>;
  if (
    encoded.v !== OFFLINE_RECITATION_VERSION ||
    encoded.r !== PERMITTED_RESOURCE_ID ||
    typeof encoded.d !== 'string' ||
    !DOWNLOAD_STATES.includes(encoded.d) ||
    (encoded.k !== 'none' && encoded.k !== 'complete' && encoded.k !== 'selected') ||
    !Array.isArray(encoded.ks) ||
    !encoded.ks.every((entry) => typeof entry === 'number' && Number.isInteger(entry)) ||
    !isNullableNonEmptyString(encoded.g) ||
    typeof encoded.w !== 'boolean' ||
    !isNullableFiniteNumber(encoded.c) ||
    typeof encoded.m !== 'boolean' ||
    !Array.isArray(encoded.rows)
  ) {
    return null;
  }

  const rows: OfflineFileRow[] = [];
  for (const raw of encoded.rows) {
    const row = decodeRow(raw, encoded.r);
    if (row === null) {
      return null;
    }
    rows.push(row);
  }

  const scope: OfflineScope =
    encoded.k === 'selected'
      ? { kind: 'selected', surahs: [...encoded.ks].sort((a, b) => a - b) }
      : { kind: encoded.k };

  return {
    version: OFFLINE_RECITATION_VERSION,
    resourceId: encoded.r,
    download: encoded.d as OfflineDownloadState,
    scope,
    generationId: encoded.g,
    wifiOnly: encoded.w,
    rows: sorted(rows),
    reconciledAt: encoded.c,
    migratedLegacyFiles: encoded.m,
  };
}

/**
 * The document as it is written, with its own integrity envelope.
 *
 * The checksum is the same FNV-1a `faith-sync-generation.ts` uses, for the same reason and against
 * the same threat: this is private application storage that only NoorLife writes, so what is being
 * detected is a torn or truncated file, not a forged one. The byte length is recorded because it
 * catches truncation on its own and because the storage preflight deals in encoded bytes.
 */
export type ManifestEnvelope = {
  readonly checksum: string;
  readonly byteLength: number;
  readonly body: string;
};

export function envelopeFor(manifest: OfflineManifest): ManifestEnvelope {
  const body = encodeManifest(manifest);
  return { checksum: checksumOf(body), byteLength: utf8Length(body), body };
}

export function serialiseManifest(manifest: OfflineManifest): string {
  const envelope = envelopeFor(manifest);
  return JSON.stringify({
    checksum: envelope.checksum,
    charLength: envelope.body.length,
    body: envelope.body,
  });
}

/** Reads a serialised manifest, checking its envelope before its content. */
export function deserialiseManifest(text: string): OfflineManifest | null {
  let outer: unknown;
  try {
    outer = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof outer !== 'object' || outer === null || Array.isArray(outer)) {
    return null;
  }
  const { checksum, charLength, body } = outer as Record<string, unknown>;
  if (
    typeof body !== 'string' ||
    typeof checksum !== 'string' ||
    typeof charLength !== 'number' ||
    body.length !== charLength ||
    checksumOf(body) !== checksum
  ) {
    return null;
  }
  return decodeManifest(body);
}
