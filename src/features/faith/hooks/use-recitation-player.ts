import { setAudioModeAsync, useAudioPlaylist, useAudioPlaylistStatus } from 'expo-audio';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  buildLocalPlaylist,
  hasNextTrack,
  hasPreviousTrack,
  indexOfAyah,
  isLastTrack,
  sameTracks,
  trackAt,
  type PlaylistTrack,
} from '../data/audio/recitation-playlist';
import { recordRecitation } from '../data/audio/recitation-diagnostics';
import { PERMITTED_RESOURCE_ID } from '../storage/faith-offline-recitation';
import type { OfflineDownloadService } from '../data/audio/offline-download.service';
import { useOfflineRecitation } from '../di/offline-recitation-context';

/**
 * Recitation playback, as one surah-scoped native playlist over verified local files.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── The architecture this replaces, and why it had to go ────────────────────
 * Two things, in sequence.
 *
 * **First, one player whose source was replaced per ayah.** `useAudioPlayer` keys on
 * `JSON.stringify(source)`, so every verse meant a *new native player object*: the ayah finishes →
 * JavaScript picks the next one → React releases the old native player and builds a new one → the new
 * one loads → sound resumes. All of that between two verses of the Qur'an.
 *
 * **Second, and still present until now, per-ayah network preparation.** Even with a playlist, the
 * queue was built from a twenty-ayah window that was *fetched* when Play was pressed, and extended by
 * fetching more while playing. So the first verse waited on a download, and every extension raced the
 * needle. On a slow link the extension lost, and the queue ran out mid-surah.
 *
 * ── What replaces it ────────────────────────────────────────────────────────
 * One `AudioPlaylist` per surah, built **in a single pass from files already on the device**, holding
 * the whole contiguous local run. No network call is on any path in this file. On Android that is
 * ExoPlayer moving between media items in a prepared queue — no JavaScript in the transition path, no
 * object lifecycle at the boundary, and no fetch that can arrive late.
 *
 * Because the queue is complete before playback starts, there is no extension effect at all. The one
 * that used to live here appended to a live queue while `currentIndex` moved underneath it, and
 * needed a re-entrancy guard to stop it queueing the same ayat twice. Removing the reason for the
 * guard is a better fix than the guard.
 *
 * ── One transition authority, and it is `trackChanged` ──────────────────────
 * `currentIndex` is written by **exactly one thing**: the playlist's `trackChanged` event. Not
 * `didJustFinish`, not a timer, not `currentTime` polling, not the reader's focus. `didJustFinish` is
 * read for one purpose only — recognising that the **final** track ended so the transport can report
 * `completed` exactly once. That is a terminal state, not an advancement.
 *
 * ── A missing verse stops playback; it never streams and never skips ────────
 * If the surah is partly downloaded, the queue is the contiguous run containing the requested verse
 * and `missingAyah` says where it stops. The panel then offers Offline audio management. There is no
 * fallback that fetches the gap, because a fallback that fetched the gap would be the per-ayah
 * network preparation this work exists to remove, reintroduced at the worst possible moment.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/**
 * The transport's own state, independent of anything the reader knows.
 *
 * `not-downloaded` and `idle` are deliberately different: the first says there is no audio on this
 * device for this surah, the second says there is and nothing has been asked for yet. A single
 * "nothing is playing" state collapsed the two, and the collapse always resolved to the more
 * optimistic one — which is how a panel came to read "Ready to play" over a surah whose audio had
 * never been fetched.
 */
export type RecitationPhase =
  /** The offline manifest has not been read yet. Nothing is known; nothing is claimed. */
  | 'loading'
  /** Nothing local for this surah. The action is a download, not a retry. */
  | 'not-downloaded'
  | 'idle'
  | 'starting'
  | 'playing'
  | 'paused'
  | 'buffering'
  | 'completed'
  /** Playback reached a verse that is not on the device and stopped there. */
  | 'missing-ayah'
  | 'failed';

/** Why playback cannot proceed. A closed set with no member that could carry a URL or a path. */
export type PlaybackBlock =
  /** The requested verse is not downloaded. */
  | 'not-downloaded'
  /** The run reached a verse that is not downloaded. */
  | 'gap'
  /** The native queue never became ready. Retrying is correct. */
  | 'readiness-timeout';

export type RecitationTransport = {
  readonly surah: number;
  /** The verse currently selected, or `null` when nothing is. */
  readonly currentAyah: number | null;
  /**
   * The verse the transport is **pointed at**, playing or not.
   *
   * `currentAyah` is what the queue is on; this additionally falls back to the pointed-at verse and
   * then to the first verse on the device, so the panel always has a number to draw. The reciting
   * highlight follows `currentAyah` alone, so a player pointed at verse nine while nothing is loaded
   * cannot make the reader claim verse nine is being recited.
   */
  readonly focusAyah: number | null;
  /** The verse explicitly pointed at, with no fallback. `null` when none. */
  readonly pointedAyah: number | null;
  readonly phase: RecitationPhase;
  /** Verified local tracks in the queue. Readiness is this being above zero, nothing else. */
  readonly queuedCount: number;
  /** Ayat of this surah verified on the device, whether contiguous or not. */
  readonly downloadedAyat: number;
  /**
   * Which ayat those are, ascending.
   *
   * Exposed because the reader needs to know whether a *specific* verse can be played before it
   * offers a Play control for it, and the count alone cannot answer that for a partial download.
   */
  readonly playableAyat: readonly number[];
  /** Ayat the published generation lists for this surah, or `null` when nothing is bound. */
  readonly totalAyat: number | null;
  /** True when some but not all of the surah is on the device. */
  readonly partiallyDownloaded: boolean;
  /**
   * The first verse after the queue that is not on the device, or `null`.
   *
   * What makes stopping at a gap honest rather than looking like a surah that ended early.
   */
  readonly missingAyah: number | null;
  readonly block: PlaybackBlock | null;
  readonly completed: boolean;
  readonly playing: boolean;
  /** True while the platform is reading a source it already has. Never a network wait. */
  readonly buffering: boolean;
  readonly hasNext: boolean;
  readonly hasPrevious: boolean;
  /**
   * Seconds played, and the current track's length — or `null` where the platform has not said.
   *
   * An unloaded playlist reports `0` for both, and a progress bar drawn from that claims the verse is
   * zero seconds long and has not started. `null` means *not known*.
   */
  readonly elapsedSeconds: number | null;
  readonly durationSeconds: number | null;
  readonly rate: number;
  readonly speedSupported: boolean;
  readonly setRate: (rate: number) => void;
  /** Seeks within the current track. A no-op when the duration is unknown. */
  readonly seekTo: (seconds: number) => void;
  readonly focusOn: (ayah: number) => void;
  readonly play: (ayah: number) => void;
  readonly toggle: (ayah: number) => void;
  /** Play, pause or answer — the one entry point a press should call. */
  readonly requestPlay: () => void;
  readonly retry: () => void;
  readonly pause: () => void;
  readonly stop: () => void;
  readonly next: () => void;
  readonly previous: () => void;
};

/**
 * The rates offered.
 *
 * Bounded rather than free, and all of them close to normal: this is Qur'anic recitation, and at 2×
 * a murattal reading stops being one while at 0.5× the elongations become unrecognisable.
 */
export const RECITATION_RATES: readonly number[] = [0.75, 1, 1.25, 1.5];

/** How often the native playlist reports status. 250 ms keeps the seek bar smooth without churn. */
const STATUS_INTERVAL_MS = 250;

/**
 * How long a start may wait for the native queue before it is called a failure.
 *
 * Bounded because the alternative was observed: the panel sat on "Ready to play" for fifty seconds
 * with nothing pending and nothing wrong on screen. A named failure the user can retry is better than
 * a state that never resolves. Shorter than it was, because the queue is now local — there is no
 * transfer for the wait to be covering.
 */
const READINESS_TIMEOUT_MS = 4000;

/**
 * A reported number, or `null` when the platform has not determined one.
 *
 * Elapsed accepts zero and duration does not, because the two ambiguities differ: a verse genuinely
 * *is* at zero seconds the instant it starts, and a verse is never zero seconds *long*.
 */
function reported(value: number, { allowZero }: { readonly allowZero: boolean }): number | null {
  if (!Number.isFinite(value) || value < 0) {
    return null;
  }
  return value === 0 && !allowZero ? null : value;
}

export function useRecitationPlayer(surah: number): RecitationTransport {
  const { service, revision } = useOfflineRecitation();
  return useRecitationPlayerWith(surah, service, revision);
}

/**
 * The transport, with its offline service passed in.
 *
 * Split so a test can drive the service directly without a provider, and so the dependency is visible
 * in the signature rather than reached for through a context.
 */
export function useRecitationPlayerWith(
  surah: number,
  offline: OfflineDownloadService,
  revision: number,
): RecitationTransport {
  /**
   * The tracks the **native playlist was constructed from**.
   *
   * Drives the `sources` memo below, and `useAudioPlaylist` rebuilds the native object whenever that
   * memo changes — so this is set only on a genuine rebuild: a change of surah, or a start verse
   * outside the current queue. It is never appended to.
   */
  const [tracks, setTracks] = useState<readonly PlaylistTrack[]>([]);

  /**
   * The current track index, written by `trackChanged` and by an explicit `skipTo` — nothing else.
   *
   * The single transition authority. See the note at the top of this file.
   */
  const [currentIndex, setCurrentIndex] = useState(0);

  const [pointedAyah, setPointedAyah] = useState<number | null>(null);
  const [completed, setCompleted] = useState(false);
  const [rate, setRateState] = useState(1);
  const [speedRejected, setSpeedRejected] = useState(false);
  const [block, setBlock] = useState<PlaybackBlock | null>(null);
  const [missingAyah, setMissingAyah] = useState<number | null>(null);
  /** The ayah a built queue should start on, handed to the effect that owns the live playlist. */
  const [pendingStart, setPendingStart] = useState<number | null>(null);

  /**
   * The last index accepted from `trackChanged`, so a repeated event cannot advance twice.
   *
   * The native layer emits `onMediaItemChanged` on more than a track boundary — a seek to the default
   * position of the same item reaches it too — and a duplicate accepted as a transition is an ayah the
   * listener never heard.
   */
  const acceptedIndex = useRef<number | null>(null);
  /** When the current start attempt began, for the bounded readiness timeout. */
  const startingSince = useRef<number | null>(null);

  /**
   * What the device holds for this surah, re-read when the manifest changes.
   *
   * `revision` is the dependency that matters: the offline service is a mutable object, and a
   * synchronous read taken during the first commit — before the manifest has been loaded — would
   * otherwise be kept forever, which is how a reader came to offer "download" for a surah already on
   * the device.
   */
  const availableAyat = useMemo(() => {
    /*
      `revision` is read rather than merely listed. The offline service is a mutable object outside
      React, so nothing about `offline` changes when a download lands or a surah is removed — the
      revision is the only value that does. Consuming it makes it a genuine input to this computation
      rather than a dependency a linter is entitled to call redundant and strip.
    */
    void revision;
    return offline.playableAyat(surah);
  }, [offline, surah, revision]);

  const totalAyat = useMemo(() => {
    void revision;
    return offline.expectedAyat(surah);
  }, [offline, surah, revision]);

  /*
    The sources handed to the native playlist. Identity-stable while the track names are, because
    `useAudioPlaylist` memoises on `JSON.stringify(sources)` — an unstable array here would rebuild the
    native object on every render.
  */
  const sources = useMemo(() => tracks.map((track) => ({ uri: track.uri })), [tracks]);
  const playlist = useAudioPlaylist({ sources, updateInterval: STATUS_INTERVAL_MS, loop: 'none' });
  const status = useAudioPlaylistStatus(playlist);

  /**
   * Audio mode, set once.
   *
   * `shouldPlayInBackground` stays false to match the config plugin: there is no background audio
   * entitlement in this build, and the permission NoorLife holds is for in-app listening.
   */
  useEffect(() => {
    void setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: false,
      shouldRouteThroughEarpiece: false,
    }).catch(() => undefined);
  }, []);

  /**
   * A change of surah discards the queue.
   *
   * The native playlist is rebuilt by the `sources` memo emptying. Nothing asynchronous is in flight
   * to fence against, because nothing in this file is asynchronous any more.
   */
  /* eslint-disable react-hooks/set-state-in-effect -- resetting React state to match an external
     scope change (the surah the reader is on) is the effect's whole purpose; there is no
     render-driven cascade, because the surah only moves when the reader navigates. */
  useEffect(() => {
    setTracks([]);
    setCurrentIndex(0);
    setPointedAyah(null);
    setCompleted(false);
    setBlock(null);
    setMissingAyah(null);
    setPendingStart(null);
    acceptedIndex.current = null;
    startingSince.current = null;
  }, [surah]);
  /* eslint-enable react-hooks/set-state-in-effect */

  /**
   * The one place the current track advances.
   *
   * Subscribed to the native `trackChanged` event. The listener is removed by the subscription's own
   * `remove()`, which does not command the playlist — so nothing here can touch a released object.
   */
  useEffect(() => {
    const subscription = playlist.addListener('trackChanged', ({ currentIndex: next }) => {
      /*
        ── Two guards, because the native event is not a promise of a transition ──
        `onMediaItemChanged` fires for reasons other than reaching the next track — a seek to the
        default position of the current item is one — and an event accepted twice is an ayah the
        listener never heard. An index outside the queue cannot be mapped to a verse at all, and
        mapping it by arithmetic is exactly the habit that produced the reader's deep-link defect.
      */
      if (next === acceptedIndex.current) {
        recordRecitation({
          phase: 'playing',
          kind: 'refused',
          name: 'trackChanged',
          index: next,
          code: 'duplicate-event',
        });
        return;
      }
      if (next < 0 || next >= tracks.length) {
        recordRecitation({
          phase: 'playing',
          kind: 'refused',
          name: 'trackChanged',
          index: next,
          tracks: tracks.length,
          code: 'index-out-of-range',
        });
        return;
      }
      acceptedIndex.current = next;
      recordRecitation({
        phase: 'playing',
        kind: 'event',
        name: 'trackChanged',
        index: next,
        ayah: tracks[next]?.ayah,
        tracks: tracks.length,
      });
      setCurrentIndex(next);
      /* A transition means playback is under way, so any previous terminal state is stale. */
      setCompleted(false);
    });
    return () => subscription.remove();
  }, [playlist, tracks]);

  /**
   * The terminal state, and the only thing `didJustFinish` is read for.
   *
   * A finish on the last queued track is the end of the run. Whether that is the end of the *surah*
   * or a stop at a gap is decided by `missingAyah`, which was computed when the queue was built — so
   * the two are never confused and the surah's true end reports `completed` exactly once.
   */
  useEffect(() => {
    if (!status.didJustFinish || !isLastTrack(tracks, currentIndex)) {
      return;
    }
    /*
      Synchronising React with the native player's terminal state, which is what an effect is for. The
      compiler rule cannot see that `didJustFinish` arrives from a native status callback rather than
      from this render, so the cascade it warns about does not exist: this runs once, when the last
      track ends.
    */
    /* eslint-disable react-hooks/set-state-in-effect */
    if (missingAyah !== null) {
      setBlock('gap');
    } else {
      setCompleted(true);
    }
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [status.didJustFinish, currentIndex, tracks, missingAyah]);

  /**
   * Every status the native playlist reports, traced.
   *
   * ── Why this is kept now that nothing here fetches ──────────────────────────
   * It is the only evidence available for the transition measurement Phase 10 asks for.
   * `measuredTransitions` pairs each `trackChanged` with the first status that reports playing, which
   * is the window in which *this application* could have introduced a delay between two verses. It
   * cannot see silence encoded in the vendor's own audio and it is not a PCM measurement, and the
   * report must say so.
   *
   * The error is read through a cast because `AudioPlaylist`'s native side sends `onPlayerError` as a
   * status update carrying an `error` map that the published `AudioPlaylistStatus` type does not
   * declare. Only the numeric code is read; the message is deliberately not touched, because on a
   * URL-sourced player it can carry one — and while nothing here queues a URL any more, reading a
   * field that could hold one is a habit worth not having.
   */
  useEffect(() => {
    const native = status as unknown as { readonly error?: { readonly code?: number } };
    recordRecitation({
      phase: 'status',
      kind: 'event',
      name: 'status',
      index: status.currentIndex,
      tracks: status.trackCount,
      playing: status.playing,
      loaded: status.isLoaded,
      buffering: status.isBuffering,
      ...(native.error?.code === undefined ? {} : { code: 'prepare-failed' as const }),
    });
  }, [status]);

  /** The chosen rate, re-applied whenever a track loads. A refusal withdraws the control. */
  useEffect(() => {
    if (!status.isLoaded) {
      return;
    }
    try {
      /*
        The only rate API `AudioPlaylist` exposes — a settable property, reaching ExoPlayer's
        `setPlaybackSpeed`. Assigning to the shared object is the documented usage.
      */
      // eslint-disable-next-line react-hooks/immutability
      playlist.playbackRate = rate;
    } catch {
      /* A runtime that refuses once will refuse again, so the control is withdrawn rather than left
         to silently do nothing. */
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSpeedRejected(true);
    }
  }, [playlist, rate, status.isLoaded]);

  const currentTrack = trackAt(tracks, currentIndex);
  const currentAyah = currentTrack?.ayah ?? null;
  const focusAyah = currentAyah ?? pointedAyah ?? availableAyat[0] ?? null;

  const focusOn = useCallback((ayah: number) => {
    setPointedAyah(ayah);
    setCompleted(false);
  }, []);

  /**
   * Points the queue at a verse and starts it, rebuilding only when the verse is not already queued.
   *
   * ── Why a rebuild is the exception and not the rule ─────────────────────────
   * A verse already in the queue costs a `skipTo` — no rebuild, no interruption, no native teardown.
   * Because the queue is the whole contiguous local run rather than a twenty-ayah window, that is the
   * ordinary case for every press after the first, including `next`, `previous` and a tap on any
   * verse of a downloaded surah.
   */
  const play = useCallback(
    (ayah: number) => {
      setPointedAyah(ayah);
      setCompleted(false);
      setBlock(null);

      const existing = indexOfAyah(tracks, ayah);
      if (existing >= 0) {
        setCurrentIndex(existing);
        acceptedIndex.current = existing;
        playlist.skipTo(existing);
        playlist.play();
        return;
      }

      const build = buildLocalPlaylist({
        resourceId: PERMITTED_RESOURCE_ID,
        surah,
        availableAyat,
        localUriFor: (candidate) => offline.localUriFor(surah, candidate),
        startAyah: ayah,
        totalAyat: totalAyat ?? 0,
      });

      if (build.kind === 'failed') {
        recordRecitation({
          phase: 'idle',
          kind: 'refused',
          name: 'play',
          ayah,
          code: build.failure === 'no-local-audio' ? 'not-downloaded' : 'build-failed',
        });
        setBlock('not-downloaded');
        setMissingAyah(ayah);
        return;
      }

      recordRecitation({
        phase: 'queueReady',
        kind: 'phase',
        name: 'queueReady',
        surah,
        from: build.tracks[0]?.ayah,
        to: build.tracks[build.tracks.length - 1]?.ayah,
        tracks: build.tracks.length,
      });

      /*
        ── The playlist in this closure is about to be released ──────────────
        Setting `tracks` changes the `sources` memo, which makes `useAudioPlaylist` construct a **new**
        native object on the next render — the one in scope here is the previous instance. Commanding
        it starts nothing and, on a release build, is a call into an object the SDK is releasing.

        Observed on device: `ExoPlayerImpl Init` for the new queue landed *after* the equivalent call
        in the previous architecture, and the panel sat at "Paused, 0:00" over a queue that had loaded
        correctly. So the intent is recorded and the effect below starts playback once the live
        playlist actually holds the queue.
      */
      setTracks(build.tracks);
      setCurrentIndex(build.startIndex);
      setMissingAyah(build.nextMissingAyah);
      setPendingStart(ayah);
    },
    [availableAyat, offline, playlist, surah, totalAyat, tracks],
  );

  /**
   * Starts playback once the live playlist holds the queue that was built for it.
   *
   * Keyed on the playlist identity *and* the reported track count, so it runs on the render after a
   * rebuild rather than against the instance that requested it. This is the one place a built run
   * becomes audible.
   */
  useEffect(() => {
    if (pendingStart === null || tracks.length === 0) {
      return;
    }
    /* eslint-disable react-hooks/set-state-in-effect -- consuming a one-shot intent after handing it
       to the native player, or abandoning it on a bounded timeout. Neither can be re-set by this
       render, so there is no cascade. */
    const index = indexOfAyah(tracks, pendingStart);
    if (index < 0) {
      recordRecitation({
        phase: 'starting',
        kind: 'refused',
        name: 'start',
        ayah: pendingStart,
        code: 'index-out-of-range',
      });
      setPendingStart(null);
      startingSince.current = null;
      return;
    }

    /*
      ── Positive readiness evidence, not an assumption ──────────────────────
      The native queue is loaded when the playlist is constructed, so the JavaScript object exists
      before its media items do. Issuing `play()` against a queue the native side has not populated is
      how a start silently does nothing. `trackCount` reaching the queue length is that evidence: it
      is reported by the native status and cannot be inferred from anything on this side.
    */
    startingSince.current ??= Date.now();
    if (status.trackCount < tracks.length) {
      if (Date.now() - startingSince.current > READINESS_TIMEOUT_MS) {
        recordRecitation({
          phase: 'starting',
          kind: 'refused',
          name: 'start',
          ayah: pendingStart,
          tracks: status.trackCount,
          code: 'readiness-timeout',
        });
        setBlock('readiness-timeout');
        setPendingStart(null);
        startingSince.current = null;
      }
      return;
    }

    if (index > 0) {
      recordRecitation({
        phase: 'starting',
        kind: 'command',
        name: 'skipTo',
        index,
        ayah: pendingStart,
      });
      playlist.skipTo(index);
    }
    /*
      Exactly one `play()` per user intent. The intent is cleared in the same commit, so a status
      change cannot bring this effect back round and issue a second one.
    */
    acceptedIndex.current = index;
    recordRecitation({
      phase: 'starting',
      kind: 'command',
      name: 'play',
      index,
      ayah: pendingStart,
      tracks: status.trackCount,
    });
    playlist.play();
    setPendingStart(null);
    startingSince.current = null;
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [playlist, pendingStart, tracks, status.trackCount]);

  const toggle = useCallback(
    (ayah: number) => {
      if (status.playing && currentAyah === ayah) {
        playlist.pause();
        return;
      }
      play(ayah);
    },
    [currentAyah, play, playlist, status.playing],
  );

  /**
   * The press handler, including the case where there is nothing to press play on.
   *
   * The adapter must not decide whether a press is worth passing on: a surah with nothing downloaded
   * is the case that most needs an answer, and dropping the press there is what produced a Play
   * button that did nothing, said nothing and changed nothing.
   */
  const requestPlay = useCallback(() => {
    const target = currentAyah ?? pointedAyah ?? availableAyat[0] ?? null;
    if (target === null) {
      recordRecitation({ phase: 'idle', kind: 'refused', name: 'play', code: 'not-downloaded' });
      setBlock('not-downloaded');
      return;
    }
    toggle(target);
  }, [availableAyat, currentAyah, pointedAyah, toggle]);

  const pause = useCallback(() => playlist.pause(), [playlist]);

  /**
   * Stops without discarding the queue or the position.
   *
   * ── Why this does not reset the index ───────────────────────────────────────
   * It used to, and that is how stopping came to restart at ayah 1: the reader called `stop` on
   * teardown, the index went to zero, and the next press played the first verse of the surah rather
   * than the one the listener had reached. Pausing the native player leaves the queue and the needle
   * exactly where they were, which is what "stop" means to somebody who intends to carry on.
   */
  const stop = useCallback(() => {
    playlist.pause();
    setCompleted(false);
  }, [playlist]);

  const next = useCallback(() => {
    if (hasNextTrack(tracks, currentIndex)) {
      playlist.next();
    }
  }, [currentIndex, playlist, tracks]);

  const previous = useCallback(() => {
    if (hasPreviousTrack(tracks, currentIndex)) {
      playlist.previous();
    }
  }, [currentIndex, playlist, tracks]);

  const seekTo = useCallback(
    (seconds: number) => {
      if (!Number.isFinite(seconds) || seconds < 0) {
        return;
      }
      void playlist.seekTo(seconds).catch(() => undefined);
    },
    [playlist],
  );

  const retry = useCallback(() => {
    const target = focusAyah ?? availableAyat[0] ?? null;
    if (target === null) {
      return;
    }
    setTracks([]);
    setBlock(null);
    play(target);
  }, [availableAyat, focusAyah, play]);

  const hasQueue = tracks.length > 0;
  const downloadedAyat = availableAyat.length;
  const partiallyDownloaded =
    downloadedAyat > 0 && totalAyat !== null && downloadedAyat < totalAyat;

  /* Precedence, not a lookup: several of these are true at once for most of a verse's life. */
  const phase: RecitationPhase =
    totalAyat === null && downloadedAyat === 0
      ? 'loading'
      : block === 'gap'
        ? 'missing-ayah'
        : block !== null
          ? downloadedAyat === 0
            ? 'not-downloaded'
            : 'failed'
          : status.playing
            ? 'playing'
            : pendingStart !== null
              ? 'starting'
              : status.isBuffering && hasQueue
                ? 'buffering'
                : hasQueue && completed
                  ? 'completed'
                  : hasQueue
                    ? 'paused'
                    : downloadedAyat === 0
                      ? 'not-downloaded'
                      : 'idle';

  return {
    surah,
    phase,
    queuedCount: tracks.length,
    downloadedAyat,
    playableAyat: availableAyat,
    totalAyat,
    partiallyDownloaded,
    missingAyah,
    block,
    currentAyah,
    focusAyah,
    pointedAyah: currentAyah ?? pointedAyah,
    focusOn,
    /* Never over an empty queue: nothing played, so nothing finished. */
    completed: hasQueue && completed,
    playing: status.playing,
    buffering: status.isBuffering && hasQueue,
    /*
      Navigation is bounded by the queue, which is the whole contiguous local run — so `hasNext` is
      only false at the true end of what the device holds, and that end is described by `missingAyah`.
    */
    hasNext: hasNextTrack(tracks, currentIndex),
    hasPrevious: hasPreviousTrack(tracks, currentIndex),
    elapsedSeconds: reported(status.currentTime, { allowZero: true }),
    durationSeconds: reported(status.duration, { allowZero: false }),
    rate,
    speedSupported: !speedRejected,
    setRate: (value: number) => {
      if (RECITATION_RATES.includes(value)) {
        setRateState(value);
      }
    },
    seekTo,
    play,
    toggle,
    requestPlay,
    retry,
    pause,
    stop,
    next,
    previous,
  };
}

/** Re-exported so a caller can compare a built queue without importing the model directly. */
export { sameTracks };
