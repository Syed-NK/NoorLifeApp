import { MAX_CACHE_AGE_MS } from '../data/quran-foundation/quran-foundation.contract';
import { faithStorageKeys, isRecord, readJson, removeKey, writeJson } from './faith-storage';

/**
 * The record of which surahs a user deliberately downloaded, for which reciter.
 *
 * ── What this is, and the one thing it is emphatically not ──────────────────
 * It is an index of *user decisions*, not a copy of anything. The audio itself lives on the
 * filesystem under the same one-week ceiling as every other piece of cached Quran Foundation
 * content, and this store's whole purpose is to remember which of those files exist because somebody
 * asked for them — so that the automatic prefetch never evicts them, and so the download-management
 * screen can state what is on the device and when it expires.
 *
 * It is **not** a permanent offline mushaf. The developer terms do not permit one under the current
 * agreement, and nothing here extends a file's life by a millisecond: `expiresAt` below is computed
 * from the same `MAX_CACHE_AGE_MS` the cache enforces, and an expired entry is reported as expired
 * and offered for re-download rather than silently served.
 *
 * ── Why the byte count is stored and not measured ───────────────────────────
 * Measuring means listing the directory and summing, which is a synchronous filesystem walk over
 * potentially hundreds of files, on a screen that renders a row per reciter. The count recorded at
 * download time is exact at that moment and is only ever used to *describe* the download to the
 * user. The filesystem stays the authority on what actually exists — a file the OS reclaimed under
 * storage pressure simply fails its next read, and the entry is repaired then.
 */

/** One surah, downloaded once, for one reciter. */
export type SurahDownload = {
  readonly reciterId: string;
  readonly surah: number;
  /** How many ayah files were promoted. Below the surah's ayah count means a partial download. */
  readonly files: number;
  /** The surah's total ayat, so a partial download can say how partial it is. */
  readonly ayahCount: number;
  readonly bytes: number;
  /** Epoch milliseconds the download completed. */
  readonly storedAt: number;
};

export type SurahDownloadIndex = readonly SurahDownload[];

const DOWNLOAD_VERSION = 1;

type StoredDownloads = {
  readonly version: number;
  readonly entries: readonly SurahDownload[];
};

function isDownload(value: unknown): value is SurahDownload {
  if (!isRecord(value)) {
    return false;
  }
  const { reciterId, surah, files, ayahCount, bytes, storedAt } = value;
  return (
    typeof reciterId === 'string' &&
    reciterId.length > 0 &&
    typeof surah === 'number' &&
    Number.isInteger(surah) &&
    surah >= 1 &&
    surah <= 114 &&
    typeof files === 'number' &&
    Number.isInteger(files) &&
    files >= 0 &&
    typeof ayahCount === 'number' &&
    Number.isInteger(ayahCount) &&
    ayahCount > 0 &&
    typeof bytes === 'number' &&
    Number.isFinite(bytes) &&
    bytes >= 0 &&
    typeof storedAt === 'number' &&
    Number.isFinite(storedAt)
  );
}

function isStored(value: unknown): value is StoredDownloads {
  return (
    isRecord(value) &&
    value.version === DOWNLOAD_VERSION &&
    Array.isArray(value.entries) &&
    value.entries.every(isDownload)
  );
}

/** When a download stops being servable. The licence ceiling, not a preference. */
export function downloadExpiresAt(download: SurahDownload): number {
  return download.storedAt + MAX_CACHE_AGE_MS;
}

export function isDownloadExpired(download: SurahDownload, now: number = Date.now()): boolean {
  const age = now - download.storedAt;
  // A negative age is a clock that moved backwards — treated as expired for the same reason the
  // catalogue cache treats it that way: an age that cannot be reasoned about is not a freshness claim.
  return age >= MAX_CACHE_AGE_MS || age < 0;
}

export async function readSurahDownloads(): Promise<SurahDownloadIndex> {
  const stored = await readJson<StoredDownloads | null>(
    faithStorageKeys.audioDownloads,
    null,
    (value): value is StoredDownloads | null => value === null || isStored(value),
  );
  return stored?.entries ?? [];
}

/**
 * Records a completed download, replacing any previous one for the same surah and reciter.
 *
 * Replacing rather than appending is what makes a re-download after expiry produce one entry rather
 * than two, and it is why the identity is the pair rather than a generated id.
 */
export async function recordSurahDownload(download: SurahDownload): Promise<SurahDownloadIndex> {
  const existing = await readSurahDownloads();
  const entries = [
    ...existing.filter(
      (entry) => !(entry.reciterId === download.reciterId && entry.surah === download.surah),
    ),
    download,
  ];
  await writeJson(faithStorageKeys.audioDownloads, { version: DOWNLOAD_VERSION, entries });
  return entries;
}

export async function forgetSurahDownload(
  reciterId: string,
  surah: number,
): Promise<SurahDownloadIndex> {
  const existing = await readSurahDownloads();
  const entries = existing.filter(
    (entry) => !(entry.reciterId === reciterId && entry.surah === surah),
  );
  await writeJson(faithStorageKeys.audioDownloads, { version: DOWNLOAD_VERSION, entries });
  return entries;
}

/** Drops every record. Used by the Faith data reset and by tests. */
export async function clearSurahDownloads(): Promise<void> {
  await removeKey(faithStorageKeys.audioDownloads);
}

/** Total bytes the user's deliberate downloads occupy, for the management screen. */
export function downloadedBytes(index: SurahDownloadIndex): number {
  return index.reduce((sum, entry) => sum + entry.bytes, 0);
}
