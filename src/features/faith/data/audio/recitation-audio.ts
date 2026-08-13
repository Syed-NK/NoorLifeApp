import {
  clearSurahDownloads,
  downloadExpiresAt,
  forgetSurahDownload,
  isDownloadExpired,
  readSurahDownloads,
  recordSurahDownload,
  type SurahDownload,
  type SurahDownloadIndex,
} from '../../storage/faith-audio-downloads';
import type { AyahRecitation } from '../quran-content.repository';
import { audioFileName, type AudioStore } from './audio-store.port';
import {
  createRecitationPreparation,
  type PreparationFailure,
  type RecitationPreparation,
} from './recitation-preparation';

/**
 * Everything the app does with recitation bytes, behind one object.
 *
 * ── Why the prefetcher and the downloader are constructed together ──────────
 * They share a fact neither can hold alone: **which files are on disk because the user asked for
 * them.** The prefetcher needs it so its byte budget never evicts a deliberate download; the
 * downloader needs it so a surah it is part-way through is protected while it is being written.
 *
 * A boolean threaded between two independently-constructed services would have to be kept in sync by
 * both, and the failure mode of getting it wrong is silent and expensive — a user downloads
 * Al-Baqarah on a train, the prefetch evicts half of it to make room for the surah they are
 * listening to, and the download screen goes on reporting 47 MB that is no longer there. Owning the
 * registry in one place makes that state impossible rather than merely unlikely.
 *
 * ── The pin registry is not the source of truth about bytes ─────────────────
 * The filesystem is. A pin says "do not evict this"; it does not assert the file exists. Every read
 * still goes through the store, so a file the OS reclaimed under storage pressure is simply absent
 * and the download reports itself as needing repair.
 */

/** How a reciter's copy of one surah stands on this device. */
export type SurahDownloadState =
  /** Nothing local. Playback streams and prefetches the listening window only. */
  | { readonly kind: 'stream-only' }
  | { readonly kind: 'downloading'; readonly completed: number; readonly total: number }
  | { readonly kind: 'downloaded'; readonly bytes: number; readonly expiresAt: number }
  /** Complete, but past the one-week licence ceiling. Offered for re-download, never served. */
  | { readonly kind: 'expired'; readonly bytes: number }
  /** Some files landed and some did not. Retrying downloads only what is missing. */
  | { readonly kind: 'incomplete'; readonly completed: number; readonly total: number }
  | { readonly kind: 'failed'; readonly failure: PreparationFailure };

export type SurahDownloadOutcome =
  | { readonly kind: 'complete'; readonly download: SurahDownload }
  | {
      readonly kind: 'failed';
      readonly failure: PreparationFailure;
      readonly completed: number;
      readonly total: number;
    }
  | { readonly kind: 'cancelled' };

export type RecitationAudio = {
  readonly preparation: RecitationPreparation;
  /** The user's deliberate downloads, read from storage. */
  downloads(): Promise<SurahDownloadIndex>;
  /** How one surah stands for one reciter, from what is already known. Synchronous. */
  stateFor(reciterId: string, surah: number): SurahDownloadState;
  /**
   * Downloads every ayah of a surah, in order, and records the result.
   *
   * Explicitly initiated only: nothing in this module calls it, and no effect anywhere schedules it.
   * A download of a whole surah is a decision about somebody's storage and their connection, and it
   * happens because they pressed a control that said so.
   */
  downloadSurah(
    reciterId: string,
    surah: number,
    recitations: readonly AyahRecitation[],
    onProgress?: (completed: number, total: number) => void,
  ): Promise<SurahDownloadOutcome>;
  cancelDownload(reciterId: string, surah: number): void;
  /** Deletes the files and forgets the record. */
  removeDownload(reciterId: string, surah: number, ayahCount: number): Promise<void>;
  /** Removes every download, for the Faith data reset. */
  removeAll(): Promise<void>;
  /** Re-reads the index into the pin registry. Called once at startup. */
  hydrate(): Promise<void>;
};

/**
 * How many ayah files are fetched at once during an explicit surah download.
 *
 * Three, not one and not ten. One is needlessly slow over a high-latency connection where most of
 * each transfer is the round trip. Ten saturates the connection the user may also be using, and
 * multiplies the damage of a cancellation part-way through. Three keeps the pipe busy without the
 * download becoming the only thing the device is doing.
 */
const DOWNLOAD_CONCURRENCY = 3;

function pinKey(reciterId: string, surah: number): string {
  return `${reciterId}:${surah}`;
}

export function createRecitationAudio(config: {
  readonly store: AudioStore;
  readonly now?: () => number;
}): RecitationAudio {
  const { store } = config;
  const now = config.now ?? Date.now;

  /**
   * The surahs whose files the prefetch budget may not evict.
   *
   * Holds both completed downloads and downloads in progress, and the second is the load-bearing
   * half: without it, a surah being written would be unpinned for the whole of its download, and the
   * budget would evict its earliest ayat while its latest were still arriving.
   */
  const pinned = new Set<string>();
  /** Records for downloads already on disk, so `stateFor` can answer without touching storage. */
  const records = new Map<string, SurahDownload>();
  const active = new Map<string, { completed: number; total: number; cancelled: boolean }>();
  const failures = new Map<string, PreparationFailure>();

  const preparation = createRecitationPreparation({
    store,
    ...(config.now === undefined ? {} : { now: config.now }),
    isPinned: (reciterId, surah) => pinned.has(pinKey(reciterId, surah)),
  });

  /** How many of a surah's ayah files are actually on disk right now. */
  const filesPresent = (
    reciterId: string,
    surah: number,
    ayahCount: number,
  ): { readonly count: number; readonly bytes: number } => {
    let count = 0;
    let bytes = 0;
    for (let ayah = 1; ayah <= ayahCount; ayah += 1) {
      const file = store.read(audioFileName(reciterId, surah, ayah));
      if (file !== null) {
        count += 1;
        bytes += file.bytes;
      }
    }
    return { count, bytes };
  };

  return {
    preparation,

    async downloads() {
      return await readSurahDownloads();
    },

    stateFor(reciterId, surah) {
      const key = pinKey(reciterId, surah);

      const running = active.get(key);
      if (running !== undefined) {
        return { kind: 'downloading', completed: running.completed, total: running.total };
      }

      const failure = failures.get(key);
      const record = records.get(key);

      if (record === undefined) {
        return failure === undefined ? { kind: 'stream-only' } : { kind: 'failed', failure };
      }

      if (isDownloadExpired(record, now())) {
        return { kind: 'expired', bytes: record.bytes };
      }

      /**
       * Verified against the filesystem rather than reported from the record.
       *
       * A record says a download finished; it cannot say the files survived. The OS reclaims cache
       * storage without telling the app, so a screen that trusted the record would offer "Remove
       * download" for bytes that are not there and would play nothing when tapped.
       */
      const present = filesPresent(reciterId, surah, record.ayahCount);
      if (present.count < record.ayahCount) {
        return { kind: 'incomplete', completed: present.count, total: record.ayahCount };
      }
      return { kind: 'downloaded', bytes: present.bytes, expiresAt: downloadExpiresAt(record) };
    },

    async downloadSurah(reciterId, surah, recitations, onProgress) {
      const key = pinKey(reciterId, surah);
      if (active.has(key)) {
        // Already running. A second press is not a second download.
        return { kind: 'cancelled' };
      }

      const ordered = [...recitations].sort((a, b) => a.ayah - b.ayah);
      const total = ordered.length;
      if (total === 0) {
        return { kind: 'failed', failure: 'interrupted', completed: 0, total: 0 };
      }

      const progress = { completed: 0, total, cancelled: false };
      active.set(key, progress);
      // Pinned before the first byte, so the budget cannot evict what this is writing.
      pinned.add(key);
      failures.delete(key);

      let failure: PreparationFailure | null = null;
      let index = 0;

      const worker = async (): Promise<void> => {
        for (;;) {
          if (progress.cancelled || failure !== null) {
            return;
          }
          const next = ordered[index];
          index += 1;
          if (next === undefined) {
            return;
          }
          const outcome = await preparation.prepare(next);
          if (outcome.kind === 'ready') {
            progress.completed += 1;
            onProgress?.(progress.completed, total);
            continue;
          }
          if (outcome.kind === 'cancelled') {
            progress.cancelled = true;
            return;
          }
          /**
           * The first genuine failure stops the download rather than skipping past it.
           *
           * A surah download that quietly omitted the ayat it could not fetch would present itself
           * as complete and then play a surah with holes in it — the same class of defect as the
           * transport skipping an ayah, and worse for being invisible until somebody listened.
           */
          failure = outcome.failure;
          return;
        }
      };

      await Promise.all(
        Array.from({ length: Math.min(DOWNLOAD_CONCURRENCY, total) }, () => worker()),
      );

      active.delete(key);

      if (progress.cancelled) {
        pinned.delete(key);
        return { kind: 'cancelled' };
      }
      if (failure !== null) {
        failures.set(key, failure);
        /**
         * Stays pinned on failure.
         *
         * The partial download is exactly what a retry resumes from — every file already promoted is
         * one the retry finds locally and does not fetch again. Unpinning here would let the budget
         * evict that work before the user pressed retry.
         */
        const present = filesPresent(reciterId, surah, total);
        await recordSurahDownload({
          reciterId,
          surah,
          files: present.count,
          ayahCount: total,
          bytes: present.bytes,
          storedAt: now(),
        });
        records.set(key, {
          reciterId,
          surah,
          files: present.count,
          ayahCount: total,
          bytes: present.bytes,
          storedAt: now(),
        });
        return { kind: 'failed', failure, completed: progress.completed, total };
      }

      const present = filesPresent(reciterId, surah, total);
      const download: SurahDownload = {
        reciterId,
        surah,
        files: present.count,
        ayahCount: total,
        bytes: present.bytes,
        storedAt: now(),
      };
      await recordSurahDownload(download);
      records.set(key, download);
      return { kind: 'complete', download };
    },

    cancelDownload(reciterId, surah) {
      const running = active.get(pinKey(reciterId, surah));
      if (running !== undefined) {
        running.cancelled = true;
      }
    },

    async removeDownload(reciterId, surah, ayahCount) {
      const key = pinKey(reciterId, surah);
      // Stop a download in flight first, so it cannot promote a file after the deletion below.
      const running = active.get(key);
      if (running !== undefined) {
        running.cancelled = true;
      }
      for (let ayah = 1; ayah <= ayahCount; ayah += 1) {
        store.remove(audioFileName(reciterId, surah, ayah));
      }
      pinned.delete(key);
      records.delete(key);
      failures.delete(key);
      await forgetSurahDownload(reciterId, surah);
    },

    async removeAll() {
      for (const record of records.values()) {
        for (let ayah = 1; ayah <= record.ayahCount; ayah += 1) {
          store.remove(audioFileName(record.reciterId, record.surah, ayah));
        }
      }
      pinned.clear();
      records.clear();
      failures.clear();
      await clearSurahDownloads();
    },

    async hydrate() {
      const index = await readSurahDownloads();
      pinned.clear();
      records.clear();
      for (const entry of index) {
        const key = pinKey(entry.reciterId, entry.surah);
        records.set(key, entry);
        // Expired records stay in `records` so `stateFor` can report expiry honestly, but they are
        // not pinned: their bytes are past the licence ceiling and are the first thing worth losing.
        if (!isDownloadExpired(entry, now())) {
          pinned.add(key);
        }
      }
      preparation.sweep();
    },
  };
}
