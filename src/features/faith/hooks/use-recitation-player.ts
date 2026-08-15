import { setAudioModeAsync, useAudioPlaylist, useAudioPlaylistStatus } from 'expo-audio';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type {
  PreparationFailure,
  RecitationPreparation,
} from '../data/audio/recitation-preparation';
import {
  buildPlaylistTracks,
  hasNextTrack,
  hasPreviousTrack,
  indexOfAyah,
  isLastTrack,
  sameTracks,
  trackAt,
  type PlaylistTrack,
} from '../data/audio/recitation-playlist';
import {
  extensionWindow,
  prepareSurahRun,
  preparationWindow,
  SURAH_PREPARE_WINDOW,
} from '../data/audio/surah-preparation';
import { recordRecitation } from '../data/audio/recitation-diagnostics';
import type { AyahRecitation } from '../data/quran-content.repository';
import { useRecitationAudio } from '../di/recitation-audio-context';

/**
 * Recitation playback, as one surah-scoped native playlist.
 *
 * ── The architecture this replaces, and why it had to go ────────────────────
 * There used to be **one player whose source was replaced per ayah**:
 *
 * ```ts
 * const player = useAudioPlayer(uri === null ? null : { uri });
 * ```
 *
 * `useAudioPlayer` keys on `JSON.stringify(source)`, so every verse meant a *new native player
 * object*. The sequence at each boundary was: the ayah finishes → JavaScript picks the next one →
 * the file is fetched if it is not already local → React releases the old native player and builds a
 * new one → the new one loads → sound resumes. Steps two through five are all time this application
 * added, and step three had no bound at all when the prefetch had fallen behind. The result was an
 * audible pause between ayat, which is what this file exists to remove.
 *
 * Prefetching harder could not fix it. Even with the next file already on disk, a source replacement
 * still costs a native teardown, a construction and a load, *between two verses of the Qur'an*.
 *
 * ── What replaces it ────────────────────────────────────────────────────────
 * One `AudioPlaylist` per surah, holding local `file://` sources, advanced by the native player.
 * On Android that is ExoPlayer moving between media items in a prepared queue — no JavaScript in the
 * transition path, and no object lifecycle at the boundary. Ayat are appended to the live queue well
 * ahead of the needle, so the queue grows without ever being rebuilt.
 *
 * ── One transition authority, and it is `trackChanged` ──────────────────────
 * `currentIndex` is held here and is written by **exactly one thing**: the playlist's `trackChanged`
 * event. Not `didJustFinish`, not a timer, not `currentTime` polling, not the reader's focus. The
 * old architecture advanced from `didJustFinish` and needed a minted token per selection to stop one
 * completion being honoured twice; there is no such hazard here, because a native track change is a
 * single event with a from-index and a to-index.
 *
 * `didJustFinish` is still read, for one thing only: recognising that the **final** track ended so
 * the transport can report `completed`. That is a terminal state, not an advancement.
 *
 * ── Nothing is queued that is not already on disk ───────────────────────────
 * `buildPlaylistTracks` refuses any source without a validated local URI, and refuses a run with a
 * gap in it. A queue containing a source that has not arrived would stall the native player at
 * exactly the boundary this work exists to protect — so preparation happens first, with a progress
 * state the panel shows, and playback starts when the window is ready.
 */

/**
 * The transport's own state, independent of anything the reader knows.
 *
 * `unavailable` and `idle` are deliberately different: the first says this reciter has no recording
 * of this surah, the second says there is one and nothing has been asked for yet. A single "nothing
 * is playing" state collapsed the two, and the collapse always resolved to the more optimistic one.
 */
export type RecitationPhase =
  | 'unavailable'
  | 'idle'
  | 'preparing'
  | 'queueReady'
  | 'starting'
  | 'playing'
  | 'paused'
  | 'completed'
  | 'failed';

export type RecitationTransport = {
  /** The verse currently selected, or `null` when nothing is. */
  readonly current: AyahRecitation | null;
  /**
   * The verse the transport is **pointed at**, playing or not.
   *
   * `current` is what the queue is on; this additionally falls back to the pointed-at verse and then
   * to the first verse with a recitation, so the panel always has a number to draw. The reciting
   * highlight follows `current` alone, so a player pointed at verse nine while nothing is loaded
   * cannot make the reader claim verse nine is being recited.
   */
  readonly focus: AyahRecitation | null;
  /**
   * The verse the transport was explicitly pointed at, with no fallback. `null` when none.
   *
   * Used where a wrong number is worse than no number — the docked player's caption prefers the
   * reader's own resolved verse when the transport has not been pointed anywhere.
   */
  readonly pointedAyah: number | null;
  /** Points the player at a verse **without** starting it. The ayah menu's quiet route in. */
  readonly focusOn: (recitation: AyahRecitation) => void;
  /**
   * What the transport is doing, as one closed set.
   *
   * ── Why this exists alongside the individual flags ──────────────────────
   * The panel used to resolve its caption from the flags by precedence, and every combination
   * nobody enumerated fell through to `idle` — which reads "Ready to play". A transport holding no
   * queue, with nothing downloaded and nothing requested, is not ready for anything, and saying so
   * over a surah whose audio had never been fetched is the defect this closes. The phase is decided
   * here, where the queue is, rather than inferred by a component from the route.
   */
  readonly phase: RecitationPhase;
  /** Validated local tracks in the live queue. Readiness is this being above zero, nothing else. */
  readonly queuedCount: number;
  /** True when this reciter published nothing for this surah, so there is nothing to prepare. */
  readonly unavailable: boolean;
  /** True once the queue has played to its end and nothing followed. Never true for an empty queue. */
  readonly completed: boolean;
  readonly playing: boolean;
  /** True while the platform is reading the source it already has. */
  readonly buffering: boolean;
  /**
   * True while local files are being produced for the run about to play.
   *
   * Distinct from `buffering`: buffering is the platform reading a source it has, preparing is
   * NoorLife fetching the sources in the first place. Only this one has a progress fraction, and
   * only this one can fail with `low-storage`.
   */
  readonly preparing: boolean;
  /** Fraction of the run that is prepared, or `null` when nothing is being prepared. */
  readonly prepareProgress: number | null;
  /** Why preparation could not produce local files, or `null`. */
  readonly preparationFailure: PreparationFailure | null;
  /** True when the last attempt failed. The screen renders a retry, not a dead control. */
  readonly failed: boolean;
  readonly hasNext: boolean;
  readonly hasPrevious: boolean;
  readonly autoAdvance: boolean;
  /**
   * Seconds played, and the current track's length — or `null` where the platform has not said.
   *
   * An unloaded playlist reports `0` for both, and a progress bar drawn from that claims the verse
   * is zero seconds long and has not started. `null` means *not known*.
   */
  readonly elapsedSeconds: number | null;
  readonly durationSeconds: number | null;
  readonly rate: number;
  readonly speedSupported: boolean;
  readonly setRate: (rate: number) => void;
  /** Seeks within the current track. A no-op when the duration is unknown. */
  readonly seekTo: (seconds: number) => void;
  readonly play: (recitation: AyahRecitation) => void;
  readonly toggle: (recitation: AyahRecitation) => void;
  /**
   * Play, pause or answer — the one entry point a press should call.
   *
   * Unlike `toggle` it takes no verse, because the case it exists for is the one where there is no
   * verse to pass: it resolves the target itself and, when there is none, records the refusal and
   * moves the transport to `unavailable` instead of doing nothing.
   */
  readonly requestPlay: () => void;
  /** Re-attempts the current run, including its preparation. */
  readonly retry: () => void;
  readonly pause: () => void;
  readonly stop: () => void;
  readonly next: () => void;
  readonly previous: () => void;
  readonly setAutoAdvance: (enabled: boolean) => void;
  /** Cancels an in-flight preparation without starting playback. */
  readonly cancelPreparation: () => void;
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
 * with nothing pending and nothing wrong on screen. A named failure the user can retry is better
 * than a state that never resolves.
 */
const READINESS_TIMEOUT_MS = 8000;

function sortByAyah(list: readonly AyahRecitation[]): readonly AyahRecitation[] {
  return [...list].sort((left, right) => left.ayah - right.ayah);
}

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

/** What preparation is doing right now. `null` when nothing is. */
type PreparationState = {
  readonly completed: number;
  readonly total: number;
};

export function useRecitationPlayer(available: readonly AyahRecitation[]): RecitationTransport {
  const { preparation } = useRecitationAudio();
  return useRecitationPlayerWith(available, preparation);
}

/**
 * The transport, with its preparation engine passed in.
 *
 * Split so a test can drive the engine directly without a provider, and so the dependency is visible
 * in the signature rather than reached for through a context.
 */
export function useRecitationPlayerWith(
  available: readonly AyahRecitation[],
  preparation: RecitationPreparation,
): RecitationTransport {
  const ordered = useMemo(() => sortByAyah(available), [available]);

  /**
   * The tracks the **native playlist was constructed from**.
   *
   * This drives the `sources` memo below, and `useAudioPlaylist` rebuilds the native object whenever
   * that memo changes — so this is set only on a genuine rebuild (surah, reciter, or a start verse
   * outside the queue). Ayat appended to a live queue deliberately do *not* land here.
   */
  const [sourceTracks, setSourceTracks] = useState<readonly PlaylistTrack[]>([]);

  /**
   * The queue as it actually stands, including tracks appended while playing.
   *
   * A ref rather than state, and that is the whole trick: appending to state would change the
   * `sources` memo and rebuild the native playlist mid-recitation, which is the source replacement
   * this file exists to remove. The native `add()` extends the live queue; this keeps the
   * index-to-ayah map in step with it.
   */
  const [queuedTracks, setQueuedTracks] = useState<readonly PlaylistTrack[]>([]);

  /**
   * The current track index, written by `trackChanged` and by an explicit `skipTo` — nothing else.
   *
   * The single transition authority. See the note at the top of this file.
   */
  const [currentIndex, setCurrentIndex] = useState(0);

  const [focusAyah, setFocusAyah] = useState<number | null>(null);
  const [completed, setCompleted] = useState(false);
  const [autoAdvance, setAutoAdvance] = useState(true);
  const [rate, setRateState] = useState(1);
  const [speedRejected, setSpeedRejected] = useState(false);
  const [preparingState, setPreparingState] = useState<PreparationState | null>(null);
  const [failure, setFailure] = useState<PreparationFailure | null>(null);
  const [playRequested, setPlayRequested] = useState(false);
  /**
   * The ayah a prepared run should start on, handed to the effect that owns the live playlist.
   *
   * Exists because the object that *requested* playback is not the object that will *perform* it —
   * building a queue rebuilds the native playlist. See the note in `play`.
   */
  const [pendingStart, setPendingStart] = useState<number | null>(null);
  /** A start that never became audible, as distinct from a preparation that never produced files. */
  const [startFailure, setStartFailure] = useState<'readiness-timeout' | null>(null);
  /**
   * Set when Play was pressed and there was nothing this transport could play.
   *
   * The press used to be dropped by the adapter — `if (focus !== null)` around the whole call — so a
   * user pressing Play on a surah with no recitation got no sound, no message and no change of any
   * kind. A press is a question, and "there is no audio for this reciter" is the answer.
   */
  const [refusedPlay, setRefusedPlay] = useState(false);

  /**
   * Increments on every scope change and every new preparation run.
   *
   * ── What it prevents ────────────────────────────────────────────────────────
   * A preparation for Al-Baqarah resolving after the user has navigated to Al-Fatihah would
   * otherwise build a queue for the surah nobody is looking at, and command a playlist that belongs
   * to a different session. Every asynchronous continuation checks the generation it started under
   * before touching state or the native object.
   */
  const session = useRef(0);
  const abort = useRef<AbortController | null>(null);
  /**
   * The last index accepted from `trackChanged`, so a repeated event cannot advance twice.
   *
   * The native layer emits `onMediaItemChanged` on more than a track boundary — a seek to the
   * default position of the same item reaches it too — and a duplicate accepted as a transition is
   * an ayah the listener never heard.
   */
  const acceptedIndex = useRef<number | null>(null);
  /**
   * The extension run in flight, as `generation:lastQueuedAyah`.
   *
   * Without it the extension effect re-enters while its own `prepareSurahRun` is pending — the
   * effect depends on `currentIndex`, which moves during preparation — and appends the *same* ayat
   * to the native queue a second time. A duplicated queue is the likeliest explanation for a run
   * that appeared to race through a surah.
   */
  const extending = useRef<string | null>(null);
  /** When the current start attempt began, for the bounded readiness timeout. */
  const startingSince = useRef<number | null>(null);

  /*
    The sources handed to the native playlist. Identity-stable while the track names are, because
    `useAudioPlaylist` memoises on `JSON.stringify(sources)` — an unstable array here would rebuild
    the native object on every render.
  */
  const sources = useMemo(() => sourceTracks.map((track) => ({ uri: track.uri })), [sourceTracks]);
  const playlist = useAudioPlaylist({ sources, updateInterval: STATUS_INTERVAL_MS, loop: 'none' });
  const status = useAudioPlaylistStatus(playlist);

  /** The scope the queue belongs to, so a change of surah or reciter is detectable. */
  const scope = ordered[0] ?? null;
  const scopeKey = scope === null ? null : `${scope.reciterId}:${scope.surah}`;

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
   * The one place the current track advances.
   *
   * Subscribed to the native `trackChanged` event. The listener is removed by the subscription's own
   * `remove()`, which does not command the playlist — so nothing here can touch a released object.
   */
  useEffect(() => {
    const subscription = playlist.addListener('trackChanged', ({ currentIndex: next }) => {
      /*
        ── Three guards, because the native event is not a promise of a transition ──
        `onMediaItemChanged` fires for reasons other than reaching the next track — a seek to the
        default position of the current item is one — and an event accepted twice is an ayah the
        listener never heard. An index outside the queue cannot be mapped to a verse at all, and
        mapping it by arithmetic is exactly the habit that produced the reader's deep-link defect.
      */
      if (next === acceptedIndex.current) {
        recordRecitation({
          generation: session.current,
          phase: 'playing',
          kind: 'refused',
          name: 'trackChanged',
          index: next,
          code: 'duplicate-event',
        });
        return;
      }
      if (next < 0 || next >= queuedTracks.length) {
        recordRecitation({
          generation: session.current,
          phase: 'playing',
          kind: 'refused',
          name: 'trackChanged',
          index: next,
          tracks: queuedTracks.length,
          code: 'index-out-of-range',
        });
        return;
      }
      acceptedIndex.current = next;
      recordRecitation({
        generation: session.current,
        phase: 'playing',
        kind: 'event',
        name: 'trackChanged',
        index: next,
        ayah: queuedTracks[next]?.ayah,
        tracks: queuedTracks.length,
      });
      setCurrentIndex(next);
      /* A transition means playback is under way, so any previous terminal state is stale. */
      setCompleted(false);
    });
    return () => subscription.remove();
  }, [playlist, queuedTracks]);

  /**
   * The terminal state, and the only thing `didJustFinish` is read for.
   *
   * A finish on the last queued track with nothing after it is the end of the surah. This is not an
   * advancement — it moves no index and starts nothing — which is why it can coexist with
   * `trackChanged` without becoming a second authority.
   */
  useEffect(() => {
    if (status.didJustFinish && isLastTrack(queuedTracks, currentIndex)) {
      /*
        Synchronising React with the native player's terminal state, which is what an effect is for.
        The compiler rule cannot see that `didJustFinish` arrives from a native status callback
        rather than from this render, so the cascade it warns about does not exist: this runs once,
        when the last track ends.
      */
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCompleted(true);
    }
  }, [status.didJustFinish, currentIndex, queuedTracks]);

  /**
   * Every status the native playlist reports, traced.
   *
   * ── Why the error is read through a cast ────────────────────────────────────
   * `AudioPlaylist`'s native side sends `onPlayerError` as a *status update* carrying an `error`
   * map — `sendStatusUpdate(mapOf("error" to mapOf("code" to ...)))` — but the published
   * `AudioPlaylistStatus` type does not declare the field. It is the single most useful signal for
   * diagnosing a queue that raced: ExoPlayer skips to the next media item when one fails, so a run
   * of per-track errors looks exactly like a surah playing at impossible speed.
   *
   * Only the numeric code is read. The message is deliberately not touched — it can carry a URL.
   */
  useEffect(() => {
    const native = status as unknown as { readonly error?: { readonly code?: number } };
    recordRecitation({
      generation: session.current,
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
        `setPlaybackSpeed`. There is no `setPlaybackRate(rate, quality)` as there is on
        `AudioPlayer`, so pitch is preserved by the platform's default rather than by a quality this
        app selects. Assigning to the shared object is the documented usage.
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

  /**
   * A change of surah or reciter discards the queue.
   *
   * The native playlist is rebuilt by the `sources` memo emptying; the session generation moves so
   * that any preparation still running cannot deliver into the new scope.
   */
  /* eslint-disable react-hooks/set-state-in-effect -- resetting React state to match an external
     scope change (surah or reciter) is the effect's whole purpose; there is no render-driven
     cascade, because the scope key only moves when the reader navigates. */
  useEffect(() => {
    session.current += 1;
    abort.current?.abort();
    abort.current = null;
    setQueuedTracks([]);
    setSourceTracks([]);
    setCurrentIndex(0);
    setFocusAyah(null);
    setCompleted(false);
    setPreparingState(null);
    setFailure(null);
    setPlayRequested(false);
    setPendingStart(null);
    setStartFailure(null);
    setRefusedPlay(false);
    acceptedIndex.current = null;
    extending.current = null;
    startingSince.current = null;
    preparation.setScope(
      scope === null ? null : { reciterId: scope.reciterId, surah: scope.surah },
    );
  }, [scopeKey, preparation, scope]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const currentTrack = trackAt(queuedTracks, currentIndex);
  const current =
    currentTrack === null
      ? null
      : (ordered.find((entry) => entry.ayah === currentTrack.ayah) ?? null);

  const focus = current ?? ordered.find((entry) => entry.ayah === focusAyah) ?? ordered[0] ?? null;

  const focusOn = useCallback((recitation: AyahRecitation) => {
    setFocusAyah(recitation.ayah);
    setCompleted(false);
  }, []);

  /**
   * Prepares the run containing `startAyah` and builds a queue from it.
   *
   * Returns the built tracks so the caller can decide whether to start playing. Everything
   * asynchronous is fenced by the session generation it began under.
   */
  const prepareAndBuild = useCallback(
    async (startAyah: number): Promise<readonly PlaylistTrack[] | null> => {
      if (scope === null) {
        return null;
      }
      const generation = (session.current += 1);
      const controller = new AbortController();
      abort.current = controller;
      setFailure(null);

      const window = preparationWindow(ordered, startAyah, SURAH_PREPARE_WINDOW);
      const outcome = await prepareSurahRun({
        preparation,
        recitations: window,
        signal: controller.signal,
        onProgress: (progress) => {
          if (session.current === generation) {
            setPreparingState(progress);
          }
        },
      });

      if (session.current !== generation) {
        return null;
      }
      setPreparingState(null);

      if (outcome.kind === 'cancelled') {
        return null;
      }
      if (outcome.kind === 'failed' && outcome.prepared === 0) {
        setFailure(outcome.failure);
        return null;
      }

      const build = buildPlaylistTracks({
        reciterId: scope.reciterId,
        surah: scope.surah,
        recitations: ordered,
        localUriFor: (recitation) => preparation.localUriFor(recitation),
        startAyah,
        maxTracks: SURAH_PREPARE_WINDOW,
      });
      if (build.kind === 'failed') {
        /*
          Preparation reported progress and the build still found nothing usable — a file was evicted
          or failed validation between the two. Reported as `interrupted`, which is the honest
          description and the one whose advice (retry) is correct.
        */
        setFailure(outcome.kind === 'failed' ? outcome.failure : 'interrupted');
        return null;
      }

      recordRecitation({
        generation,
        phase: 'queueReady',
        kind: 'phase',
        name: 'queueReady',
        reciterId: scope.reciterId,
        surah: scope.surah,
        from: build.tracks[0]?.ayah,
        to: build.tracks[build.tracks.length - 1]?.ayah,
        tracks: build.tracks.length,
      });
      setQueuedTracks(build.tracks);
      setSourceTracks(build.tracks);
      setCurrentIndex(build.startIndex);
      setCompleted(false);
      return build.tracks;
    },
    [ordered, preparation, scope],
  );

  /**
   * Points the queue at a verse and starts it, preparing first when the verse is not queued.
   *
   * The queue is reused wherever it can be: a verse already in it costs a `skipTo`, with no
   * preparation, no rebuild and no interruption to the native object.
   */
  const play = useCallback(
    (recitation: AyahRecitation) => {
      setFocusAyah(recitation.ayah);
      setCompleted(false);
      setStartFailure(null);
      setRefusedPlay(false);

      const existing = indexOfAyah(queuedTracks, recitation.ayah);
      if (existing >= 0) {
        setCurrentIndex(existing);
        playlist.skipTo(existing);
        playlist.play();
        return;
      }

      recordRecitation({
        generation: session.current + 1,
        phase: 'preparing',
        kind: 'intent',
        name: 'play',
        reciterId: recitation.reciterId,
        surah: recitation.surah,
        ayah: recitation.ayah,
      });
      setPlayRequested(true);
      void prepareAndBuild(recitation.ayah).then((tracks) => {
        if (tracks === null) {
          setPlayRequested(false);
          return;
        }
        /*
          ── The playlist in this closure is about to be released ──────────
          Building tracks sets `sourceTracks`, which changes the `sources` memo, which makes
          `useAudioPlaylist` construct a **new** native object on the next render — the one in scope
          here is the previous, empty instance. Commanding it starts nothing and, on a release build,
          is a call into an object the SDK is releasing.

          Observed on device: `ExoPlayerImpl Init` for the new queue landed *after* this `.then()`
          ran, and the panel sat at "Paused, 0:00" over a queue that had loaded correctly.

          So the intent is recorded and the effect below starts playback once the live playlist
          actually holds the queue.
        */
        setPendingStart(recitation.ayah);
        setPlayRequested(false);
      });
    },
    [playlist, prepareAndBuild, queuedTracks],
  );

  /**
   * Starts playback once the live playlist holds the queue that was prepared for it.
   *
   * Keyed on the playlist identity *and* the queue length, so it runs on the render after a rebuild
   * rather than against the instance that requested it. This is the one place a prepared run becomes
   * audible, and it is deliberately not inside the promise that prepared it.
   */
  useEffect(() => {
    if (pendingStart === null || sourceTracks.length === 0) {
      return;
    }
    /* eslint-disable react-hooks/set-state-in-effect -- consuming a one-shot intent after handing it
       to the native player, or abandoning it on a bounded timeout. Neither can be re-set by this
       render, so there is no cascade. */
    const index = indexOfAyah(sourceTracks, pendingStart);
    if (index < 0) {
      recordRecitation({
        generation: session.current,
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
      The native queue is loaded by `loadInitialPlaylist`, which runs when the playlist is
      constructed — so the JavaScript object exists before its media items do. Issuing `play()`
      against a queue the native side has not populated is how a start silently does nothing, which
      is one of the three device symptoms this pass is chasing.

      `trackCount` reaching the queue length is that evidence: it is reported by the native status
      and cannot be inferred from anything on this side.
    */
    startingSince.current ??= Date.now();
    if (status.trackCount < sourceTracks.length) {
      if (Date.now() - startingSince.current > READINESS_TIMEOUT_MS) {
        recordRecitation({
          generation: session.current,
          phase: 'starting',
          kind: 'refused',
          name: 'start',
          ayah: pendingStart,
          tracks: status.trackCount,
          code: 'readiness-timeout',
        });
        setStartFailure('readiness-timeout');
        setPendingStart(null);
        startingSince.current = null;
      }
      return;
    }

    if (index > 0) {
      recordRecitation({
        generation: session.current,
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
      generation: session.current,
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
  }, [playlist, pendingStart, sourceTracks, status.trackCount]);

  const toggle = useCallback(
    (recitation: AyahRecitation) => {
      if (status.playing && current?.ayah === recitation.ayah) {
        playlist.pause();
        return;
      }
      play(recitation);
    },
    [current, play, playlist, status.playing],
  );

  /**
   * The press handler, including the case where there is nothing to press play on.
   *
   * The adapter must not decide whether a press is worth passing on: it can only see `focus`, and a
   * null focus is the one case that most needs an answer. So the null case is handled here, where
   * the queue and the recitation list are, and the panel simply forwards every press.
   */
  const requestPlay = useCallback(() => {
    const target =
      current ?? ordered.find((entry) => entry.ayah === focusAyah) ?? ordered[0] ?? null;
    if (target === null) {
      recordRecitation({
        generation: session.current,
        phase: 'idle',
        kind: 'refused',
        name: 'play',
        code: 'no-recitations',
      });
      setRefusedPlay(true);
      return;
    }
    toggle(target);
  }, [current, focusAyah, ordered, toggle]);

  const pause = useCallback(() => playlist.pause(), [playlist]);

  const stop = useCallback(() => {
    playlist.pause();
    setCompleted(false);
  }, [playlist]);

  const next = useCallback(() => {
    if (hasNextTrack(queuedTracks, currentIndex)) {
      playlist.next();
    }
  }, [currentIndex, playlist, queuedTracks]);

  const previous = useCallback(() => {
    if (hasPreviousTrack(queuedTracks, currentIndex)) {
      playlist.previous();
    }
  }, [currentIndex, playlist, queuedTracks]);

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
    const target = focus?.ayah ?? ordered[0]?.ayah ?? null;
    if (target === null) {
      return;
    }
    setQueuedTracks([]);
    setSourceTracks([]);
    play({ ...(ordered.find((entry) => entry.ayah === target) as AyahRecitation) });
  }, [focus, ordered, play]);

  const cancelPreparation = useCallback(() => {
    session.current += 1;
    abort.current?.abort();
    abort.current = null;
    setPreparingState(null);
    setPlayRequested(false);
  }, []);

  /**
   * Extends the live queue ahead of the needle.
   *
   * ── Why this appends rather than rebuilding ─────────────────────────────────
   * `playlist.add` puts a media item on the end of the native queue without disturbing what is
   * playing. Rebuilding — which is what changing `sourceTracks` would do — would tear the native
   * object down mid-verse and reintroduce exactly the pause this file removes.
   *
   * It runs on track change rather than on a timer, and only when the queue is within
   * `PLAYLIST_EXTEND_AHEAD` of the end, so a surah is downloaded a few ayat at a time as it is
   * listened to rather than all at once.
   */
  useEffect(() => {
    if (!autoAdvance || scope === null || queuedTracks.length === 0) {
      return;
    }
    const last = queuedTracks[queuedTracks.length - 1];
    const playing = trackAt(queuedTracks, currentIndex);
    if (last === undefined || playing === null) {
      return;
    }
    const wanted = extensionWindow(ordered, last.ayah, playing.ayah);
    if (wanted.length === 0) {
      return;
    }

    const generation = session.current;
    const runKey = `${generation}:${last.ayah}`;
    if (extending.current === runKey) {
      /* Already appending this run. Re-entering would queue the same ayat a second time. */
      return;
    }
    extending.current = runKey;
    let active = true;
    recordRecitation({
      generation,
      phase: 'extending',
      kind: 'intent',
      name: 'extend',
      from: wanted[0]?.ayah,
      to: wanted[wanted.length - 1]?.ayah,
      tracks: queuedTracks.length,
    });
    void prepareSurahRun({ preparation, recitations: wanted }).then(() => {
      if (!active || session.current !== generation) {
        extending.current = null;
        return;
      }
      /*
        Appended one at a time, in order, and only for files that actually landed. A gap stops the
        extension rather than queueing past it — the queue may be short, never wrong.
      */
      const appended: PlaylistTrack[] = [];
      for (const recitation of [...wanted].sort((a, b) => a.ayah - b.ayah)) {
        const uri = preparation.localUriFor(recitation);
        if (uri === null) {
          break;
        }
        const track: PlaylistTrack = {
          name: `${recitation.reciterId}:${recitation.surah}:${recitation.ayah}`,
          uri,
          reciterId: recitation.reciterId,
          surah: recitation.surah,
          ayah: recitation.ayah,
        };
        playlist.add({ uri });
        appended.push(track);
      }
      if (appended.length > 0) {
        recordRecitation({
          generation,
          phase: 'extending',
          kind: 'command',
          name: 'add',
          from: appended[0]?.ayah,
          to: appended[appended.length - 1]?.ayah,
          tracks: queuedTracks.length + appended.length,
        });
        setQueuedTracks((queue) => [...queue, ...appended]);
      }
      extending.current = null;
    });

    return () => {
      active = false;
    };
  }, [autoAdvance, currentIndex, ordered, playlist, preparation, scope, queuedTracks]);

  const queueLength = queuedTracks.length;
  const preparing = preparingState !== null || playRequested;
  /**
   * Readiness, stated once and derived from the queue alone.
   *
   * Not from the route, not from the surah, not from the reciter catalogue — all three were
   * available to the panel and all three are true long before a single byte of audio exists.
   */
  const hasQueue = queuedTracks.length > 0;
  const unavailable = ordered.length === 0 || refusedPlay;
  const failed = failure !== null || startFailure !== null;
  /* Precedence, not a lookup: several of these are true at once for most of a verse's life. */
  const phase: RecitationPhase = failed
    ? 'failed'
    : preparing
      ? 'preparing'
      : unavailable
        ? 'unavailable'
        : status.playing
          ? 'playing'
          : pendingStart !== null
            ? 'starting'
            : hasQueue && completed
              ? 'completed'
              : current !== null
                ? 'paused'
                : hasQueue
                  ? 'queueReady'
                  : 'idle';
  const prepareProgress =
    preparingState === null || preparingState.total === 0
      ? null
      : preparingState.completed / preparingState.total;

  return {
    phase,
    queuedCount: queueLength,
    unavailable,
    current,
    focus,
    pointedAyah: current?.ayah ?? focusAyah,
    focusOn,
    /* Never over an empty queue: nothing played, so nothing finished. */
    completed: hasQueue && completed,
    playing: status.playing,
    buffering: status.isBuffering,
    preparing,
    prepareProgress,
    preparationFailure: failure,
    failed,
    /*
      Navigation is bounded by the *queue*, not by the surah: a verse that has not been queued yet
      cannot be skipped to natively. The queue extends ahead of the needle, so this is only ever
      false at the true end of a prepared run.
    */
    hasNext: hasNextTrack(queuedTracks, currentIndex),
    hasPrevious: hasPreviousTrack(queuedTracks, currentIndex),
    autoAdvance,
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
    setAutoAdvance,
    cancelPreparation,
  };
}

/** Re-exported so a caller can compare a built queue without importing the model directly. */
export { sameTracks };
