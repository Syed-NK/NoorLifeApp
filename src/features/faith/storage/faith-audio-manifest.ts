import { faithStorageKeys, isRecord, readJson, removeKey, writeChecked } from './faith-storage';

/**
 * What is actually on the device, per ayah, and how it got there.
 *
 * ── The practice this replaces ──────────────────────────────────────────────
 * Until now the filesystem *was* the index: presence was decided by building a name from a reciter,
 * a surah and an ayah, and asking whether that file existed. `parseAudioFileName` then read the
 * identity back out of the name when a sweep or a removal needed it.
 *
 * That works, and it is exactly wrong for deliberate downloads. A filename is a **guess about
 * identity**, not a record of it: nothing in it says which vendor row the bytes came from, whether
 * they were ever validated, when they last agreed with the publisher, or whether a half-written file
 * is a download in progress or the wreckage of a killed process. Content Sync makes all four of
 * those questions answerable, and none of them fits in a name.
 *
 * So identity now comes from a row here, and a row is written only where identity was *known* — from
 * a synchronised recitation row, never inferred. The one place a filename is still parsed is
 * `migrateLegacyFiles`, which exists to retire the practice: it runs once, proves every inferred
 * identity against synchronised rows, and quarantines whatever it cannot prove.
 *
 * ── Why the state is an enum and not a set of booleans ──────────────────────
 * A file is queued, or downloading, or being verified, or available, or marked for removal. Those
 * are stages of one lifecycle, and the combinations booleans permit — downloading *and* available,
 * removed *and* verifying — are all meaningless. One field, one closed set, one transition at a time.
 */

export const AUDIO_MANIFEST_VERSION = 1;

/**
 * Where one file is in its lifecycle.
 *
 * `available` is the only state a player may read from, and it is deliberately distinct from
 * `downloaded`: bytes having arrived is not the same as bytes having been checked, and collapsing
 * the two is how an unvalidated file reaches a player. `stale-check-due` marks a file whose resource
 * has not been synchronised inside the seven-day window — it stays playable, because the licence
 * expressly permits an offline device to keep permitted audio, and the state exists to say the check
 * is owed rather than to withhold the audio.
 */
export type AudioFileState =
  | 'queued'
  | 'downloading'
  | 'paused'
  | 'downloaded'
  | 'verifying'
  | 'available'
  | 'stale-check-due'
  | 'updating'
  | 'removal-required'
  | 'failed'
  | 'removing';

/** The states a player may source a file from. Everything else is not ready, for a stated reason. */
export const PLAYABLE_STATES: readonly AudioFileState[] = ['available', 'stale-check-due'];

export type AudioManifestRow = {
  /** The reciter resource id this file belongs to. A file for another reciter is never a match. */
  readonly reciterId: string;
  readonly surah: number;
  readonly ayah: number;
  /** The file name inside the download store. The store owns the directory; this owns the name. */
  readonly fileName: string;
  readonly bytes: number;
  /** A locally computed or vendor-supplied integrity value, where one exists. Never invented. */
  readonly integrity: string | null;
  /** Epoch milliseconds the bytes were validated and promoted. */
  readonly downloadedAt: number | null;
  /** Epoch milliseconds this row last agreed with a synchronised recitation row. */
  readonly lastSyncedAt: number | null;
  /** Quran Foundation's own record identity for the row these bytes came from. */
  readonly recordKey: string | null;
  /** The vendor sequence the row was at, where one was supplied. */
  readonly sequence: number | null;
  readonly state: AudioFileState;
};

export type AudioManifest = {
  readonly version: number;
  readonly rows: readonly AudioManifestRow[];
  /**
   * Whether the one-time migration off filename probing has run.
   *
   * Stored rather than inferred from an empty manifest: a user with no downloads and a user whose
   * legacy files were all unprovable both have zero rows, and only one of them still needs the
   * migration. Getting that wrong would re-run a quarantine sweep on every launch.
   */
  readonly migratedLegacyFiles: boolean;
};

const STATES: readonly string[] = [
  'queued',
  'downloading',
  'paused',
  'downloaded',
  'verifying',
  'available',
  'stale-check-due',
  'updating',
  'removal-required',
  'failed',
  'removing',
];

function isRow(value: unknown): value is AudioManifestRow {
  if (!isRecord(value)) {
    return false;
  }
  const {
    reciterId,
    surah,
    ayah,
    fileName,
    bytes,
    integrity,
    downloadedAt,
    lastSyncedAt,
    recordKey,
    sequence,
    state,
  } = value;
  const nullableNumber = (input: unknown): boolean =>
    input === null || (typeof input === 'number' && Number.isFinite(input));
  const nullableString = (input: unknown): boolean =>
    input === null || (typeof input === 'string' && input.length > 0);
  return (
    typeof reciterId === 'string' &&
    reciterId.length > 0 &&
    typeof surah === 'number' &&
    Number.isInteger(surah) &&
    surah >= 1 &&
    surah <= 114 &&
    typeof ayah === 'number' &&
    Number.isInteger(ayah) &&
    ayah >= 1 &&
    typeof fileName === 'string' &&
    fileName.length > 0 &&
    typeof bytes === 'number' &&
    Number.isFinite(bytes) &&
    bytes >= 0 &&
    nullableString(integrity) &&
    nullableNumber(downloadedAt) &&
    nullableNumber(lastSyncedAt) &&
    nullableString(recordKey) &&
    (sequence === null || (typeof sequence === 'number' && Number.isInteger(sequence))) &&
    typeof state === 'string' &&
    STATES.includes(state)
  );
}

function isManifest(value: unknown): value is AudioManifest {
  if (!isRecord(value)) {
    return false;
  }
  const { version, rows, migratedLegacyFiles } = value;
  return (
    version === AUDIO_MANIFEST_VERSION &&
    Array.isArray(rows) &&
    rows.every(isRow) &&
    typeof migratedLegacyFiles === 'boolean'
  );
}

export const EMPTY_MANIFEST: AudioManifest = {
  version: AUDIO_MANIFEST_VERSION,
  rows: [],
  migratedLegacyFiles: false,
};

export async function readAudioManifest(): Promise<AudioManifest> {
  return await readJson<AudioManifest>(
    faithStorageKeys.quranAudioManifest,
    EMPTY_MANIFEST,
    isManifest,
  );
}

export async function writeAudioManifest(manifest: AudioManifest): Promise<boolean> {
  return await writeChecked(faithStorageKeys.quranAudioManifest, manifest);
}

export async function clearAudioManifest(): Promise<void> {
  await removeKey(faithStorageKeys.quranAudioManifest);
}

/** The identity of a row, as one string. Reciter first, because a surah exists per reciter. */
export function manifestKey(reciterId: string, surah: number, ayah: number): string {
  return `${reciterId}:${surah}:${ayah}`;
}

function keyOf(row: AudioManifestRow): string {
  return manifestKey(row.reciterId, row.surah, row.ayah);
}

/**
 * The row for one ayah, or `null`.
 *
 * Matched on all three parts. A file for the right surah and ayah but the wrong reciter is not a
 * near miss to be tolerated — it is a different recitation, and playing it would be substituting one
 * reciter for another without telling the listener.
 */
export function findRow(
  manifest: AudioManifest,
  reciterId: string,
  surah: number,
  ayah: number,
): AudioManifestRow | null {
  const key = manifestKey(reciterId, surah, ayah);
  return manifest.rows.find((row) => keyOf(row) === key) ?? null;
}

/** Whether a player may source this ayah from the download store. */
export function isPlayable(row: AudioManifestRow | null): boolean {
  return row !== null && PLAYABLE_STATES.includes(row.state);
}

/**
 * Inserts or replaces rows by identity, leaving everything else untouched.
 *
 * Returns a whole manifest rather than mutating, so the caller writes once and either the new state
 * is stored or the old one is — never a manifest that half-describes the filesystem.
 */
export function upsertRows(
  manifest: AudioManifest,
  rows: readonly AudioManifestRow[],
): AudioManifest {
  const byKey = new Map(manifest.rows.map((row) => [keyOf(row), row]));
  for (const row of rows) {
    byKey.set(keyOf(row), row);
  }
  return { ...manifest, rows: sorted([...byKey.values()]) };
}

export function removeRows(
  manifest: AudioManifest,
  identities: readonly {
    readonly reciterId: string;
    readonly surah: number;
    readonly ayah: number;
  }[],
): AudioManifest {
  const removing = new Set(
    identities.map((entry) => manifestKey(entry.reciterId, entry.surah, entry.ayah)),
  );
  return { ...manifest, rows: manifest.rows.filter((row) => !removing.has(keyOf(row))) };
}

/** Every row for one surah of one reciter, in ayah order. */
export function rowsForSurah(
  manifest: AudioManifest,
  reciterId: string,
  surah: number,
): readonly AudioManifestRow[] {
  return manifest.rows.filter((row) => row.reciterId === reciterId && row.surah === surah);
}

function sorted(rows: readonly AudioManifestRow[]): readonly AudioManifestRow[] {
  return [...rows].sort((left, right) => {
    if (left.reciterId !== right.reciterId) {
      return left.reciterId < right.reciterId ? -1 : 1;
    }
    return left.surah === right.surah ? left.ayah - right.ayah : left.surah - right.surah;
  });
}

/**
 * The one-time migration off filename probing.
 *
 * ── Why a filename may be parsed here and nowhere else ──────────────────────
 * Files already exist on devices, written before a manifest did. Their identity is recoverable only
 * from their names, so the parse has to happen once — and this is the boundary where it is allowed,
 * because it is also the boundary where the guess is **proved**.
 *
 * Every inferred identity is checked against a synchronised recitation row. A file whose surah and
 * ayah the vendor confirms becomes a manifest row; a file whose identity nothing corroborates is
 * quarantined rather than trusted, because a name is not evidence and a mis-bound recitation plays a
 * verse in the wrong place with nothing downstream able to notice.
 *
 * Pure: it takes what was found and what is known, and returns the decision. The caller does the
 * filesystem work and the write, so the whole migration is one commit rather than a walk that can
 * half-finish.
 */
export function planLegacyMigration(input: {
  /** Names found in the download store, exactly as they are on disk. */
  readonly fileNames: readonly string[];
  /** Identity as parsed from each name, or `null` where the name is unreadable. */
  readonly parse: (
    fileName: string,
  ) => { readonly reciterId: string; readonly surah: number; readonly ayah: number } | null;
  /** Byte sizes by file name, so a row records what is actually there. */
  readonly bytesFor: (fileName: string) => number | null;
  /** The synchronised rows that can corroborate an identity. */
  readonly knownRows: readonly {
    readonly resourceId: number;
    readonly surah: number;
    readonly ayah: number;
    readonly verseKey: string;
    readonly sequence: number | null;
  }[];
  readonly at: number;
}): {
  readonly rows: readonly AudioManifestRow[];
  /** Names whose identity could not be proved. The caller removes or quarantines these. */
  readonly unprovable: readonly string[];
} {
  const known = new Map(
    input.knownRows.map((row) => [manifestKey(String(row.resourceId), row.surah, row.ayah), row]),
  );
  const rows: AudioManifestRow[] = [];
  const unprovable: string[] = [];

  for (const fileName of input.fileNames) {
    const identity = input.parse(fileName);
    const bytes = input.bytesFor(fileName);
    if (identity === null || bytes === null || bytes <= 0) {
      unprovable.push(fileName);
      continue;
    }
    const match = known.get(manifestKey(identity.reciterId, identity.surah, identity.ayah));
    if (match === undefined) {
      /*
        The name says what it says and nothing agrees with it. That is not a reason to trust it: an
        unprovable file is quarantined, and the surah can be downloaded again against real identity.
      */
      unprovable.push(fileName);
      continue;
    }
    rows.push({
      reciterId: identity.reciterId,
      surah: identity.surah,
      ayah: identity.ayah,
      fileName,
      bytes,
      /* Nothing is invented: no integrity value existed for these files, so none is recorded. */
      integrity: null,
      downloadedAt: null,
      lastSyncedAt: input.at,
      recordKey: match.verseKey,
      sequence: match.sequence,
      /*
        `downloaded`, not `available`. The bytes are present and their identity is now proved, but
        they have not been validated by this build — so they go through verification like any other
        file rather than being promoted on the strength of having existed before.
      */
      state: 'downloaded',
    });
  }

  return { rows: sorted(rows), unprovable };
}
