import { MAX_CACHE_AGE_MS } from '../quran-foundation/quran-foundation.contract';
import type { AyahRecitation } from '../quran-content.repository';
import {
  audioFileName,
  parseAudioFileName,
  type AudioStore,
  type StoredAudioFile,
} from './audio-store.port';

/**
 * Bounded local preparation for verse recitation.
 *
 * ── The defect this exists to close, stated exactly ─────────────────────────
 * Recitation streamed verse by verse. Each ayah was a fresh network open: DNS, TLS, the CDN's first
 * byte, and the platform player's own buffer fill — all of it *after* the previous ayah had already
 * finished. The gap between two ayat was therefore a whole request round trip, every time, and it
 * was audible.
 *
 * The repair is not a claim of gapless playback, which would need one continuous stream this API
 * does not serve. It is **local preparation**: the ayah about to play is already a file on the
 * device, so the platform opens a local URI instead of a socket. The transition is then whatever the
 * player costs to swap sources, and that is a number measured on the device rather than asserted
 * here.
 *
 * ── The four properties the rest of this file exists to hold ────────────────
 *   1. **Nothing is played that was not validated.** A prepared URI is only ever handed out for a
 *      file that downloaded completely, began with plausible audio bytes, and was promoted under an
 *      atomic rename. See `AudioStore.download`.
 *   2. **A failure never skips an ayah.** A preparation that fails resolves to a state the player
 *      renders as buffering-and-retry. The one thing it must never do is let the transport move on,
 *      because a skipped ayah in a recitation of the Qur'an is the worst outcome available here.
 *   3. **Obsolete work is cancelled, not merely ignored.** Changing surah or reciter aborts the
 *      transfers in flight and discards their partials, so a user browsing surahs does not leave a
 *      trail of downloads competing for the connection the new surah needs.
 *   4. **The licence ceiling is the ceiling.** Nothing is served past `MAX_CACHE_AGE_MS`, and the
 *      check is on read, so a file cannot outlive the policy by having been written under an older
 *      one. This mirrors `quran-cache` and `faith-quran-catalogue` exactly.
 */

/** How many ayat ahead of the one playing are prepared. */
export const PREFETCH_AHEAD = 3;

/**
 * How many bytes of automatically-prepared audio may sit on disk.
 *
 * ── Why there is a bound at all, and why it is this small ───────────────────
 * The developer terms forbid accumulating a copy of the content, and a prefetch with no ceiling
 * accumulates one surah at a time until the device is full. 96 MB is roughly a long surah at the
 * CDN's bitrate — comfortably more than the listening window this exists to cover, and nowhere near
 * a mushaf.
 *
 * Files the **user explicitly downloaded** are not counted here and are not evicted by it. Those are
 * a deliberate choice with their own management screen; evicting them to make room for a prefetch
 * would silently undo something the user asked for.
 */
export const MAX_PREPARED_BYTES = 96 * 1024 * 1024;

/**
 * Free space below which preparation stops rather than competing for the last of the device.
 *
 * Reported as a state, not swallowed: the player says storage is low, which is a thing the user can
 * act on, instead of showing a download that fails for a reason nothing explains.
 */
export const LOW_STORAGE_FLOOR_BYTES = 64 * 1024 * 1024;

/**
 * Why a preparation did not produce a local file.
 *
 * A closed set of **states**, never a message — the same rule the endpoint contract follows, and for
 * the same reason: there is no member here that could carry a URL, a host or a transport error
 * string, so nothing from the CDN can reach a screen even if a future edit tried to pass it along.
 */
export type PreparationFailure =
  /** The device could not reach the network. */
  | 'offline'
  /** Not enough free space to prepare safely. */
  | 'low-storage'
  /** The transfer started and did not finish. Retrying is the right advice. */
  | 'interrupted'
  /** The bytes arrived and were not audio. Retrying is still right — the CDN may have erred once. */
  | 'corrupt';

export type PreparationOutcome =
  | { readonly kind: 'ready'; readonly uri: string }
  | { readonly kind: 'failed'; readonly failure: PreparationFailure }
  /** Superseded by a scope change. Never rendered — the thing it was for is gone. */
  | { readonly kind: 'cancelled' };

/** The surah and reciter currently being listened to. Preparation outside it is obsolete. */
export type PreparationScope = {
  readonly reciterId: string;
  readonly surah: number;
};

export type PreparationUsage = {
  readonly files: number;
  readonly bytes: number;
};

export type RecitationPreparation = {
  /**
   * A validated, unexpired local URI for this ayah, or `null`.
   *
   * Synchronous on purpose: the transport asks this at the instant it selects a source, and an async
   * answer would mean a frame in which the player has no source and the reader shows buffering for a
   * file that is already on disk.
   */
  localUriFor(recitation: AyahRecitation): string | null;
  /** Prepares one ayah, joining an identical preparation already in flight. */
  prepare(recitation: AyahRecitation): Promise<PreparationOutcome>;
  /** Prepares the next `PREFETCH_AHEAD` ayat after `ayah`, without waiting for them. */
  prefetchAfter(available: readonly AyahRecitation[], ayah: number): void;
  /** Fraction complete for an ayah being prepared now, or `null`. */
  progressFor(recitation: AyahRecitation): number | null;
  /** Declares what is being listened to. Anything outside it is aborted. */
  setScope(scope: PreparationScope | null): void;
  /** Removes expired files and every partial. Safe to call on every mount. */
  sweep(): void;
  /** What automatic preparation is currently occupying. Excludes explicit downloads. */
  usage(): PreparationUsage;
};

export type PreparationConfig = {
  readonly store: AudioStore;
  readonly now?: () => number;
  /** Bounded by the licence ceiling, and clamped to it. */
  readonly maxAgeMs?: number;
  readonly maxPreparedBytes?: number;
  readonly prefetchAhead?: number;
  /**
   * Whether a given file is a deliberate user download rather than an automatic prefetch.
   *
   * Injected rather than read here because the answer lives in AsyncStorage and this engine is
   * synchronous where it matters. A pinned file is never evicted to make room for a prefetch; it is
   * still subject to expiry, because the licence ceiling is not a preference.
   */
  readonly isPinned?: (reciterId: string, surah: number) => boolean;
};

/**
 * Classifies a rejection from the store without reading a message the transport wrote.
 *
 * ── Why the two sentinels are matched by name and the rest is `interrupted` ──
 * `AudioStore.download` throws exactly two errors of its own — `invalid` for a body that was not
 * audio, and `cancelled` for an abort observed after the bytes landed. Everything else came from the
 * platform's networking stack, and its `message` is a string this app has no screen for and must not
 * surface. Collapsing all of it to `interrupted` is honest: the transfer began and did not produce a
 * usable file, and retrying is the correct advice for every member of that set.
 *
 * `AbortError` is separated because it is not a failure at all — it is this engine's own doing.
 */
function classify(error: unknown): PreparationOutcome {
  const name = error instanceof Error ? error.name : '';
  const message = error instanceof Error ? error.message : '';
  if (name === 'AbortError' || message === 'cancelled') {
    return { kind: 'cancelled' };
  }
  if (message === 'invalid') {
    return { kind: 'failed', failure: 'corrupt' };
  }
  return { kind: 'failed', failure: 'interrupted' };
}

export function createRecitationPreparation(config: PreparationConfig): RecitationPreparation {
  const { store } = config;
  const now = config.now ?? Date.now;
  /**
   * Clamped to the licence ceiling rather than trusted.
   *
   * A caller passing a longer window is a bug, and honouring it would put the app outside a term of
   * the Quran Foundation agreement — which is not a thing a configuration value may do.
   */
  const maxAgeMs = Math.min(config.maxAgeMs ?? MAX_CACHE_AGE_MS, MAX_CACHE_AGE_MS);
  const maxPreparedBytes = config.maxPreparedBytes ?? MAX_PREPARED_BYTES;
  const prefetchAhead = config.prefetchAhead ?? PREFETCH_AHEAD;
  const isPinned = config.isPinned ?? (() => false);

  /**
   * One entry per preparation in flight, keyed exactly as the file is named.
   *
   * This is the deduplication the brief asks for, and the duplicate it removes is not hypothetical:
   * the transport prepares the ayah it is about to play at the same moment the prefetch reaches it,
   * and a re-render during navigation restarts a prefetch that has not settled. Each duplicate is a
   * second transfer of the same bytes over the same connection the first one needs.
   */
  const inFlight = new Map<string, Promise<PreparationOutcome>>();
  const controllers = new Map<string, AbortController>();
  const progress = new Map<string, number | null>();

  let scope: PreparationScope | null = null;

  const keyFor = (recitation: AyahRecitation): string =>
    audioFileName(recitation.reciterId, recitation.surah, recitation.ayah);

  /** True when a file is old enough that the licence forbids serving it. */
  const expired = (file: StoredAudioFile): boolean => {
    const age = now() - file.storedAt;
    // A negative age is a device clock that moved backwards. Dropped for the same reason
    // `quran-cache` drops it: an age that cannot be reasoned about is not a freshness claim.
    return age >= maxAgeMs || age < 0;
  };

  const readUsable = (name: string): StoredAudioFile | null => {
    const file = store.read(name);
    if (file === null) {
      return null;
    }
    if (expired(file)) {
      store.remove(name);
      return null;
    }
    return file;
  };

  /**
   * Whether a name belongs to the scope currently being listened to.
   *
   * A name that does not parse is not one of ours and is treated as out of scope, so a stray file in
   * the directory is evicted rather than protected.
   */
  const inScope = (name: string): boolean => {
    if (scope === null) {
      return false;
    }
    const parsed = parseAudioFileName(name);
    return (
      parsed !== null &&
      parsed.reciterId === scope.reciterId.replace(/[^A-Za-z0-9]/g, '') &&
      parsed.surah === scope.surah
    );
  };

  /**
   * Brings automatic preparation back inside its byte budget.
   *
   * ── What is protected, and the order the rest goes in ───────────────────────
   * Pinned files — the ones the user downloaded on purpose — are excluded from the accounting
   * entirely, so a large deliberate download cannot make the prefetch evict itself into uselessness,
   * and the prefetch can never evict the download. Of what remains, the file currently in scope is
   * kept, because evicting the surah being listened to is the one eviction guaranteed to be wrong.
   * Everything else goes oldest first.
   */
  const enforceBudget = (): void => {
    const candidates = store
      .list()
      .filter((file) => {
        const parsed = parseAudioFileName(file.name);
        return parsed === null || !isPinned(parsed.reciterId, parsed.surah);
      })
      .sort((a, b) => a.storedAt - b.storedAt);

    let total = candidates.reduce((sum, file) => sum + file.bytes, 0);
    for (const file of candidates) {
      if (total <= maxPreparedBytes) {
        return;
      }
      if (inScope(file.name)) {
        continue;
      }
      store.remove(file.name);
      total -= file.bytes;
    }
  };

  const start = (recitation: AyahRecitation): Promise<PreparationOutcome> => {
    const name = keyFor(recitation);

    const existing = inFlight.get(name);
    if (existing !== undefined) {
      return existing;
    }

    const free = store.availableBytes();
    if (free !== null && free < LOW_STORAGE_FLOOR_BYTES) {
      return Promise.resolve({ kind: 'failed', failure: 'low-storage' });
    }

    const controller = new AbortController();
    controllers.set(name, controller);
    progress.set(name, null);

    const pending = store
      .download({
        url: recitation.url,
        name,
        signal: controller.signal,
        onProgress: (fraction) => progress.set(name, fraction),
      })
      .then((file): PreparationOutcome => {
        enforceBudget();
        /**
         * Re-read rather than trusting the promoted handle.
         *
         * `enforceBudget` can evict, and although it never evicts what is in scope, a preparation
         * that raced a scope change could have promoted a file the new budget then removed. Handing
         * back a URI for a file that is no longer there would produce a playback failure attributed
         * to the ayah rather than to the eviction.
         */
        const usable = readUsable(name);
        return usable === null
          ? { kind: 'failed', failure: 'interrupted' }
          : { kind: 'ready', uri: usable.uri };
      })
      .catch(classify)
      .finally(() => {
        inFlight.delete(name);
        controllers.delete(name);
        progress.delete(name);
      });

    inFlight.set(name, pending);
    return pending;
  };

  return {
    localUriFor(recitation) {
      return readUsable(keyFor(recitation))?.uri ?? null;
    },

    prepare(recitation) {
      const local = readUsable(keyFor(recitation));
      if (local !== null) {
        // Already prepared. This is the case the whole engine exists to produce, and it is the one
        // that must not cost a request: an advance into a prefetched ayah resolves here.
        return Promise.resolve({ kind: 'ready', uri: local.uri });
      }
      return start(recitation);
    },

    /**
     * Prepares the window ahead, and does not wait for it.
     *
     * ── Why the result is deliberately dropped ──────────────────────────────────
     * A prefetch that fails is not an event the user should be told about: the ayah it was for is
     * not playing, may never be reached, and will be prepared again — with its failure surfaced —
     * the moment the transport actually needs it. Reporting it early would put a buffering state on
     * screen for something nobody is waiting for.
     *
     * `void` rather than an ignored `.catch`: `prepare` already resolves rather than rejecting for
     * every failure it classifies, so there is no rejection to swallow.
     */
    prefetchAfter(available, ayah) {
      const ordered = [...available].sort((a, b) => a.ayah - b.ayah);
      const index = ordered.findIndex((item) => item.ayah === ayah);
      if (index < 0) {
        return;
      }
      for (const next of ordered.slice(index + 1, index + 1 + prefetchAhead)) {
        if (readUsable(keyFor(next)) === null) {
          void start(next);
        }
      }
    },

    progressFor(recitation) {
      return progress.get(keyFor(recitation)) ?? null;
    },

    /**
     * Declares the listening scope and aborts everything outside it.
     *
     * ── Why the abort is here rather than in the screen ─────────────────────────
     * The screen knows a surah changed; only this engine knows which transfers that invalidates. A
     * cancellation implemented at the call site would have to enumerate in-flight work it does not
     * own, and would miss the prefetches the previous scope had queued but not yet started.
     */
    setScope(next) {
      const changed =
        scope === null ||
        next === null ||
        scope.reciterId !== next.reciterId ||
        scope.surah !== next.surah;
      scope = next;
      if (!changed) {
        return;
      }
      for (const [name, controller] of controllers) {
        if (!inScope(name)) {
          controller.abort();
        }
      }
    },

    sweep() {
      store.sweepIncomplete();
      for (const file of store.list()) {
        if (expired(file)) {
          store.remove(file.name);
        }
      }
    },

    usage() {
      const files = store.list().filter((file) => {
        const parsed = parseAudioFileName(file.name);
        return parsed === null || !isPinned(parsed.reciterId, parsed.surah);
      });
      return {
        files: files.length,
        bytes: files.reduce((sum, file) => sum + file.bytes, 0),
      };
    },
  };
}
