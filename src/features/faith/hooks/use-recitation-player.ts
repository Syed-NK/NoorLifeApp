import { useAudioPlayer, useAudioPlayerStatus, setAudioModeAsync } from 'expo-audio';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { PreparationFailure, RecitationPreparation } from '../data/audio';
import type { AyahRecitation } from '../data/quran-content.repository';
import { useRecitationAudio } from '../di/recitation-audio-context';

/**
 * Verse-by-verse Qur'an recitation, played from files prepared on the device.
 *
 * ── What plays, and what it is called ───────────────────────────────────────
 * Arabic recitation, and nothing else. The approved Content API provides no translated narration and
 * NoorLife builds none, so nothing in this file or the screens above it may describe what plays as a
 * translation — `AyahRecitation` carries no text field precisely so a caption cannot be attached to
 * it by accident.
 *
 * ── The change that removes the gap between ayat ────────────────────────────
 * The player used to be pointed straight at the CDN URL, so every ayah began with a network open:
 * DNS, TLS, first byte, buffer fill — all of it after the previous ayah had already ended. The
 * silence between two verses was a full request round trip.
 *
 * It is now pointed at a **local file**. `RecitationPreparation` fetches the current ayah before
 * playback starts and the next few while it plays, validates each one, and promotes it under an
 * atomic rename. Advancing therefore re-points the player from one `file://` URI to another with no
 * request in between.
 *
 * This is **not** gapless playback and this file does not claim to be. There is still a source swap,
 * and what that costs is a property of the platform player measured on a device — see the reported
 * transition figure. What has been removed is the network, which was the part that was seconds
 * rather than milliseconds.
 *
 * ── A failed preparation never skips an ayah ────────────────────────────────
 * The single most important rule here. When the file for an ayah cannot be produced, the transport
 * stops on that ayah and reports why. It does not advance, it does not fall back to streaming the
 * URL, and it does not silently move on. A recitation of the Qur'an that quietly omits a verse is
 * the worst outcome this screen can produce, and every branch below is written so that it cannot.
 *
 * ── The states are the platform's, not this hook's ──────────────────────────
 * `isBuffering`, `playing` and `didJustFinish` come from `useAudioPlayerStatus`. None of them is
 * inferred, guessed, or optimistically set on a tap: a play button that flipped to "playing" because
 * it was pressed is the same class of defect as a fixture control that announced "Pause" while
 * streaming nothing.
 *
 * ── Who owns the native player's lifetime ───────────────────────────────────
 * `useAudioPlayer` does, and nothing in this file may act as though it shares that ownership. The
 * SDK 57 documentation is unambiguous — it "creates an `AudioPlayer` instance that automatically
 * releases when the component unmounts" — and `useReleasingSharedObject`, which it is built on,
 * releases in an effect cleanup registered at the point `useAudioPlayer` is called.
 *
 * That last detail is the one that matters, because React runs effect cleanups in the order the
 * effects were declared. `useAudioPlayer` is called near the top of this hook, so **its** cleanup
 * always runs before any cleanup this file registers afterwards. An unmount cleanup here that
 * touched the player was therefore not racing the release — it was guaranteed to run after it, and
 * threw `ERR_USING_RELEASED_SHARED_OBJECT` every single time the reader was closed. See the note on
 * `stopOnUnmount` below for why the effect is gone rather than reordered.
 */

export type RecitationTransport = {
  /** The verse currently selected, or `null` when nothing is. */
  readonly current: AyahRecitation | null;
  /**
   * The verse the transport is **pointed at**, playing or not.
   *
   * ── Why this is separate from `current` ─────────────────────────────────────
   * `current` is a selection the platform has been given a source for; it is `null` before anything
   * has been played and again after a surah finishes. The player, however, is on screen from the
   * moment the reader loads — it opens showing verse one, named and ready — so it needs a verse to
   * name in exactly the states where `current` is null.
   *
   * Keeping the two fields distinct is what stops that convenience from becoming a lie: the reciting
   * highlight and the audio session still follow `current` alone, so a player pointed at verse nine
   * while nothing is loaded cannot make the reader claim verse nine is being recited.
   *
   * Defaults to the first verse that has a recitation, which is what "open Al-Baqarah and the player
   * says Ayah 1" means mechanically.
   */
  readonly focus: AyahRecitation | null;
  /**
   * The verse the transport was explicitly pointed at, with no fallback. `null` when none.
   *
   * Distinct from `focus`, which substitutes the first verse that has audio so the panel always has
   * a number to draw. Use this when a wrong number is worse than no number — a caption that names a
   * verse the screen is not showing is the defect this exists to make impossible.
   */
  readonly pointedAyah: number | null;
  /** Points the player at a verse **without** starting it. The ayah menu's quiet route in. */
  readonly focusOn: (recitation: AyahRecitation) => void;
  /**
   * True once the loaded page has been played to its end and nothing followed.
   *
   * A real state rather than an absence: "finished" and "never started" are both `current === null`,
   * and a player that showed the same thing for both would tell a user who had just listened to a
   * surah that nothing had happened.
   */
  readonly completed: boolean;
  readonly playing: boolean;
  /** True while the platform is fetching audio from the file it was given. */
  readonly buffering: boolean;
  /**
   * True while the local file for the current verse is being produced.
   *
   * Distinct from `buffering`, and the distinction is real: buffering is the platform reading a
   * source it already has, preparing is NoorLife fetching the source in the first place. They show
   * the same way to the user — the recitation has not started yet — but only one of them has a
   * progress fraction and only one of them can fail with `low-storage`.
   */
  readonly preparing: boolean;
  /** Fraction of the current verse's file that has arrived, or `null` when unmeasured. */
  readonly prepareProgress: number | null;
  /** Why the current verse could not be prepared, or `null`. */
  readonly preparationFailure: PreparationFailure | null;
  /** True when the last load failed. The screen renders a retry, not a dead control. */
  readonly failed: boolean;
  /** Whether a verse after the current one exists in the loaded page. */
  readonly hasNext: boolean;
  readonly hasPrevious: boolean;
  readonly autoAdvance: boolean;
  /**
   * Seconds played, and the verse's total length — or `null` where the platform has not said.
   *
   * `AudioStatus` reports `currentTime` and `duration` as numbers whether or not it knows them, and
   * an unloaded player reports `0`. A progress bar drawn from that shows a full-width track sitting
   * at zero — a confident statement that the verse is zero seconds long and has not started. So the
   * unreliable case is represented rather than rounded off: `null` means *not known*.
   */
  readonly elapsedSeconds: number | null;
  readonly durationSeconds: number | null;
  /**
   * Playback rate, and whether changing it is offered.
   *
   * Bounded rather than free: a short list of rates, all of them close to normal, with pitch
   * correction requested so the recitation stays recognisably itself. `speedSupported` is false
   * where the platform cannot honour that, and the control is then not drawn — never drawn and
   * disabled, which would claim a feature exists.
   */
  readonly rate: number;
  readonly speedSupported: boolean;
  readonly setRate: (rate: number) => void;
  /** Seeks within the current verse. A no-op when the duration is unknown. */
  readonly seekTo: (seconds: number) => void;
  readonly play: (recitation: AyahRecitation) => void;
  readonly toggle: (recitation: AyahRecitation) => void;
  /** Re-attempts the current verse, including its preparation. */
  readonly retry: () => void;
  readonly pause: () => void;
  readonly stop: () => void;
  readonly next: () => void;
  readonly previous: () => void;
  readonly setAutoAdvance: (enabled: boolean) => void;
};

/** Orders recitations by verse so next/previous mean what they say. */
function sortByAyah(list: readonly AyahRecitation[]): readonly AyahRecitation[] {
  return [...list].sort((a, b) => a.ayah - b.ayah);
}

/**
 * The rates NoorLife offers, and the bound on how far from the recording they go.
 *
 * `expo-audio` accepts 0.1–2.0 on Android. That range is a capability, not a recommendation, and
 * this is Qur'anic recitation: at 2× a murattal reading stops being one, and at 0.5× the elongations
 * that carry the tajwid stretch into something no reciter performed. 0.75 to 1.5 covers the two
 * things people actually ask for — following a fast reciter, and slowing down to learn — without
 * offering a setting whose output nobody would describe as the recitation.
 *
 * Pitch correction is requested at `high` for the same reason: a rate change that also moves the
 * pitch changes the voice, and a changed voice is a different claim about who is reciting.
 */
export const RECITATION_RATES: readonly number[] = [0.75, 1, 1.25, 1.5];
const DEFAULT_RATE = 1;

/**
 * A number the platform genuinely reported, or `null`.
 *
 * `AudioStatus` uses `0` both for "zero seconds" and for "not determined yet", and its own
 * documentation says so of `duration`. Treating that as a measurement is what produces a progress
 * bar claiming a verse is zero seconds long, so the ambiguous value is refused here.
 */
function reported(value: number, { allowZero }: { readonly allowZero: boolean }): number | null {
  if (!Number.isFinite(value) || value < 0) {
    return null;
  }
  return value === 0 && !allowZero ? null : value;
}

/**
 * One verse selection: the verse, the identity of this selection, and the file it will play from.
 *
 * ── Why an ayah number was not enough, and a player instance was not either ──
 * The advance guard used to be two facts keyed on two different identities: a record of which
 * **ayah number** had been advanced past, cleared by an effect whenever the **player instance**
 * changed. Neither is the identity of *a selection*.
 *
 * Advancing changes the source, which produces a new player, which cleared the record — on a commit
 * where the status still in React state belonged to the previous source and still read
 * `didJustFinish: true`. Every guard passed a second time, and one completion advanced twice; with
 * the flag staying set, it advanced until the surah ran out.
 *
 * `token` is that missing identity. It is minted once per selection, by `play`, and never reused. A
 * completion is a fact *about a token*, so it cannot be inherited by the next selection, cannot be
 * re-honoured for its own, and cannot be revived by a re-render.
 *
 * `uri` is `null` while the file is being prepared. A selection with no URI points the player at no
 * source at all, which is deliberate: there is no intermediate state in which the player is given
 * the network URL, because nothing in this build streams.
 */
type Selection = {
  readonly recitation: AyahRecitation;
  readonly token: number;
  readonly uri: string | null;
};

export function useRecitationPlayer(available: readonly AyahRecitation[]): RecitationTransport {
  const { preparation } = useRecitationAudio();
  return useRecitationPlayerWith(available, preparation);
}

/**
 * The transport, with its preparation engine passed in.
 *
 * Split from `useRecitationPlayer` so a test can drive the engine directly without a provider, and
 * so the dependency is visible in the signature rather than reached for through a context.
 */
export function useRecitationPlayerWith(
  available: readonly AyahRecitation[],
  preparation: RecitationPreparation,
): RecitationTransport {
  const ordered = useMemo(() => sortByAyah(available), [available]);
  const [selection, setSelection] = useState<Selection | null>(null);
  const current = selection?.recitation ?? null;
  const [autoAdvance, setAutoAdvance] = useState(true);

  /**
   * The verse the player is pointed at when nothing is loaded.
   *
   * Held as an ayah number rather than a recitation so it survives the list being replaced — a
   * translation change re-fetches the page and produces new `AyahRecitation` objects for the same
   * verses, and a stored object would then stop matching anything in `ordered`.
   */
  const [focusAyah, setFocusAyah] = useState<number | null>(null);
  /** The verse the page finished on, so "played to the end" is distinguishable from "never started". */
  const [completedAyah, setCompletedAyah] = useState<number | null>(null);

  /**
   * What the player names: the loaded verse, else the pointed-at one, else the first with audio.
   *
   * The final fallback is what makes the player correct on arrival with no interaction at all — a
   * reader opened at Al-Baqarah shows `Ayah 1` because that is the first verse this reciter has.
   */
  const focus = current ?? ordered.find((item) => item.ayah === focusAyah) ?? ordered[0] ?? null;

  /** Mints selection tokens. Monotonic, so no two selections in a session can collide. */
  const nextToken = useRef(0);

  /**
   * The selected ayah, readable synchronously.
   *
   * `next` and `previous` step from wherever the transport currently is, and state does not update
   * until the next render. Three taps on Next inside one frame therefore all read the *same* index
   * and all select the *same* verse: the user taps three times and moves one ayah. A ref is written
   * during the press, so the second tap sees what the first one did.
   *
   * It never drives rendering — the state does — so the two cannot disagree about what is drawn.
   */
  const currentAyah = useRef<number | null>(null);
  /**
   * Whether the verse now loading was asked to start playing.
   *
   * A **ref**, not state: this value is written by a press and read by an effect, and it never
   * affects what is rendered. Holding it in state meant clearing it inside the effect that consumed
   * it — a synchronous `setState` in an effect, which cascades a render and which this project's
   * lint rules reject outright.
   */
  const shouldPlay = useRef(false);

  /**
   * The token whose completion has already been acted on.
   *
   * `didJustFinish` is a **status flag, not an event**: it stays true in the last status the player
   * reported until a new one replaces it, so any re-render observes the same completion again.
   * Recording the token — never the ayah number, never the player — makes the second observation a
   * no-op, and it is *never cleared on a source change*. The effect that used to do that is the
   * defect this replaces.
   */
  const handledFinishToken = useRef<number | null>(null);

  /**
   * The token that has been observed genuinely playing, and may therefore be allowed to finish.
   *
   * A token is armed only once the platform has reported a status for it that is loaded and **not**
   * finished — that is, the new source has actually reported in on its own behalf. Until then a
   * `didJustFinish` seen alongside this selection can only have come from the source before it, and
   * is ignored.
   *
   * This is why the fix does not rest on "the flag will be false again later". It never asks whether
   * the flag has cleared; it asks whether *this* source has ever been heard from. A stale flag that
   * never clears — which is exactly what the device produces across a source swap — cannot arm
   * anything, so it cannot advance anything.
   */
  const armedToken = useRef<number | null>(null);

  /**
   * The verse whose playback the platform refused, if any.
   *
   * Held as the **ayah number** rather than a boolean so it clears itself: a failure belongs to one
   * verse, and moving to another verse is not a state that has to be reset by hand.
   */
  const [rejectedAyah, setRejectedAyah] = useState<number | null>(null);
  /** Why the current verse's file could not be produced, tagged with the verse it belongs to. */
  const [preparationFailure, setPreparationFailure] = useState<{
    readonly ayah: number;
    readonly failure: PreparationFailure;
  } | null>(null);
  const [rate, setRateState] = useState<number>(DEFAULT_RATE);
  /**
   * Whether the platform refused to set a playback rate.
   *
   * Sticky for the life of the screen: a runtime that rejects the call once will reject it again,
   * and re-offering the control on the next verse so it can fail again is worse than withdrawing it.
   */
  const [speedRejected, setSpeedRejected] = useState(false);

  /**
   * One player, re-pointed at each verse's **local file**.
   *
   * `useAudioPlayer` takes the source and manages the native instance, including releasing it. This
   * hook never releases, removes or replaces it. Setting the source back to `null` — which is what
   * `stop` does, and what a selection still being prepared produces — makes the SDK release the
   * instance, and a paused player still holds an audio session, so releasing is how the app stops
   * quietly owning the phone's audio focus.
   */
  const uri = selection?.uri ?? null;
  const player = useAudioPlayer(uri === null ? null : { uri });
  const status = useAudioPlayerStatus(player);

  /**
   * Declares what is being listened to, so preparation outside it is aborted.
   *
   * Driven by the loaded page rather than by the selection: the scope is the *surah and reciter*, and
   * it changes when the reader is pointed at a different one — which is exactly when the transfers
   * queued for the previous surah stop being worth the connection they are using.
   */
  const scopeOf = ordered[0];
  const scopeReciter = scopeOf?.reciterId ?? null;
  const scopeSurah = scopeOf?.surah ?? null;
  useEffect(() => {
    preparation.setScope(
      scopeReciter === null || scopeSurah === null
        ? null
        : { reciterId: scopeReciter, surah: scopeSurah },
    );
  }, [preparation, scopeReciter, scopeSurah]);

  /**
   * The one place this hook speaks to the player, so there is one place to be careful in.
   *
   * Every call below runs during a commit in which `player` is the current instance, so none of them
   * can reach a released object — that is a property of the call sites, not of this wrapper. What the
   * wrapper is for is the *other* way a native call fails: the platform refusing it. A rejected
   * `play` — a file that will not open, audio focus denied, a codec the device does not have — throws
   * a `CodedError`, and an exception escaping an effect or a press handler unmounts the tree behind
   * an error boundary. A screen that cannot play a recitation must say so, not disappear.
   *
   * Nothing here logs. A media URL is content metadata this module must not emit.
   */
  const command = useCallback(
    (action: (target: typeof player) => void, ayah: number | null) => {
      try {
        action(player);
      } catch {
        // Deliberately swallowed. The `CodedError` carries a native message this app has no screen
        // for, and the honest thing to show is the retry affordance the failure flag drives.
        setRejectedAyah(ayah);
      }
    },
    [player],
  );

  /**
   * Arms the current selection once its own source has reported in.
   *
   * What used to be here was `handledFinishFor.current = null` keyed on `[player]` — it *cleared*
   * the completion guard every time the source changed, which is precisely the commit on which a
   * leaked `didJustFinish` from the previous source is still visible. Clearing a guard at the exact
   * moment it is needed is how one completion advanced the whole surah.
   *
   * The replacement moves in the opposite direction: it never clears anything, it only grants
   * permission, and only on evidence.
   */
  useEffect(() => {
    if (selection === null) {
      armedToken.current = null;
      return;
    }
    if (status.isLoaded && !status.didJustFinish) {
      armedToken.current = selection.token;
    }
  }, [selection, status.isLoaded, status.didJustFinish]);

  /**
   * The audio session, configured once.
   *
   * `playsInSilentMode` is **false** on purpose: a phone on silent is a phone whose owner has asked
   * for no sound, and overriding that for recitation would be the app deciding it is more important
   * than that choice. `shouldPlayInBackground` is false to match the config plugin — there are no
   * lock-screen controls, so background audio would be audio the user cannot stop.
   */
  useEffect(() => {
    void setAudioModeAsync({
      playsInSilentMode: false,
      shouldPlayInBackground: false,
      interruptionMode: 'mixWithOthers',
    });
  }, []);

  /**
   * Produces the local file for the selected verse, when the selection has none yet.
   *
   * ── Why this is an effect and not part of `play` ────────────────────────────
   * `play` is called from press handlers and from the auto-advance timer, and it has to be
   * synchronous so that a verse whose file is *already* on disk starts with no awaited tick at all —
   * that instant start is the whole point of prefetching. So `play` resolves the local URI
   * synchronously and, when there is none, selects with `uri: null` and leaves it to this effect.
   *
   * The token check on the way back is what makes a slow preparation harmless: by the time a
   * transfer for ayah 3 completes, the user may be on ayah 9, and a result that wrote its URI into
   * the current selection would restart a verse they had left.
   */
  const selectionToken = selection?.token ?? null;
  useEffect(() => {
    if (selection === null || selection.uri !== null) {
      return;
    }
    let active = true;
    const { recitation, token } = selection;

    void preparation.prepare(recitation).then((outcome) => {
      if (!active) {
        return;
      }
      if (outcome.kind === 'ready') {
        setSelection((live) =>
          live !== null && live.token === token ? { ...live, uri: outcome.uri } : live,
        );
        return;
      }
      if (outcome.kind === 'cancelled') {
        // Superseded by a scope change. The selection it belonged to is no longer being listened to,
        // and reporting a failure for it would put an error on screen for something nobody asked for.
        return;
      }
      /**
       * The verse stays selected and stops here.
       *
       * Deliberately **not** an advance and deliberately not a fallback to the network URL. The
       * transport holds on this ayah, the player shows the failure with a retry, and the user hears
       * this verse or hears nothing — never the next one in its place.
       */
      setPreparationFailure({ ayah: recitation.ayah, failure: outcome.failure });
    });

    return () => {
      active = false;
    };
    // `selection.uri` and `selection.token` are the inputs; the object identity is not, because a
    // re-render that produced an equal selection must not restart a preparation already in flight.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectionToken, uri, preparation]);

  /**
   * Prepares the next few ayat while this one plays.
   *
   * Keyed on the ayah rather than on the status, so it runs once per verse instead of on every tick
   * the platform reports. The engine skips anything already on disk and deduplicates the rest, so a
   * re-run costs a map lookup.
   */
  const playingAyah = current?.ayah ?? null;
  useEffect(() => {
    if (playingAyah === null) {
      return;
    }
    preparation.prefetchAfter(ordered, playingAyah);
  }, [preparation, ordered, playingAyah]);

  /**
   * Starts playback once the newly-pointed player is actually loaded.
   *
   * `player` is in the dependency list and is the instance this commit rendered with, so the call
   * cannot land on a released one: a source change produces a new player, a new commit and a new run
   * of this effect. The effect has no cleanup, which is the point — a cleanup here would capture the
   * outgoing player and run after the SDK had released it.
   */
  useEffect(() => {
    if (!shouldPlay.current || current === null || !status.isLoaded) {
      return;
    }
    command((target) => target.play(), current.ayah);
    shouldPlay.current = false;
    /*
      `selectionToken` is in the dependency list and `current` alone is not enough without it.
      Selecting the *same* verse again — which is what resuming after a pause and what a retry both
      do — produces an identical `AyahRecitation` reference, so an effect keyed on `current` did not
      re-run and the resumed verse never actually started. The token changes on every selection, so
      every route into playback reaches this call exactly once.
    */
  }, [selectionToken, current, status.isLoaded, command]);

  const index = current === null ? -1 : ordered.findIndex((item) => item.ayah === current.ayah);
  /**
   * Next and previous are enabled against the **pointed-at** verse, not the loaded one.
   *
   * They are on screen before anything has played, and a pair of permanently disabled buttons on an
   * idle player would say the recitation cannot be stepped when it can. `index` stays keyed on the
   * selection because the auto-advance below is a statement about what is playing.
   */
  const focusIndex = focus === null ? -1 : ordered.findIndex((item) => item.ayah === focus.ayah);
  const hasNext = focusIndex >= 0 && focusIndex < ordered.length - 1;
  const hasPrevious = focusIndex > 0;

  /**
   * Selects a verse and mints the token that identifies this selection.
   *
   * Every route to a new source goes through here — a tap, the transport's next and previous, a
   * retry, and the auto-advance itself. That is what makes the token the single identity for "which
   * selection is current": there is no other way to change the source.
   *
   * `localUriFor` is consulted **synchronously**. When the verse was prefetched — which is the
   * ordinary case for an advance — the selection carries its file immediately, the player is
   * re-pointed on this commit, and no request happens. That is the property the whole preparation
   * layer exists to produce, and it is why this lookup is not awaited.
   */
  const play = useCallback(
    (recitation: AyahRecitation) => {
      shouldPlay.current = true;
      // A retry of the verse that just failed is a fresh attempt, so the failures it is retrying go.
      setRejectedAyah((failedFor) => (failedFor === recitation.ayah ? null : failedFor));
      setPreparationFailure((failure) =>
        failure !== null && failure.ayah === recitation.ayah ? null : failure,
      );
      nextToken.current += 1;
      currentAyah.current = recitation.ayah;
      setFocusAyah(recitation.ayah);
      setCompletedAyah(null);
      setSelection({
        recitation,
        token: nextToken.current,
        uri: preparation.localUriFor(recitation),
      });
    },
    [preparation],
  );

  const pause = useCallback(() => {
    shouldPlay.current = false;
    command((target) => target.pause(), null);
  }, [command]);

  const stop = useCallback(() => {
    shouldPlay.current = false;
    /**
     * Paused first, then unpointed.
     *
     * The `setSelection(null)` is what actually ends it — a null source makes the SDK release the
     * instance, and release stops playback and frees the audio session. The pause is there so the
     * sound stops on this frame rather than whenever the release lands on the native main queue, and
     * it is safe because it runs against the player of the commit that called it.
     */
    command((target) => target.pause(), null);
    setPreparationFailure(null);
    setSelection(null);
    /*
      `currentAyah` is deliberately *not* cleared. It is the verse the transport is pointed at, and
      stopping does not un-point it: the player stays on screen naming that verse, and Next from a
      stopped player still means the verse after the one it is showing. Clearing it here is what
      used to leave the transport with no idea where it was.
    */
  }, [command]);

  /**
   * Points the player at a verse without starting it — the ayah menu's quiet route in.
   *
   * ── Why this stops anything already playing ─────────────────────────────────
   * The player's label, the green ayah in the reader and the audible recitation are required to
   * agree, and they do because all three read the selection. Re-pointing the label while a
   * different verse carried on playing would break that agreement in the one direction the user
   * cannot detect by looking — the screen would name a verse they are not hearing. So a re-point
   * during playback ends the playback rather than desynchronising from it, and nothing autoplays:
   * starting the new verse is what "Play from here" is for.
   */
  const focusOn = useCallback(
    (recitation: AyahRecitation) => {
      if (selection !== null) {
        stop();
      }
      currentAyah.current = recitation.ayah;
      setFocusAyah(recitation.ayah);
      setCompletedAyah(null);
    },
    [selection, stop],
  );

  const toggle = useCallback(
    (recitation: AyahRecitation) => {
      if (current?.ayah === recitation.ayah && status.playing) {
        pause();
        return;
      }
      play(recitation);
    },
    [current, status.playing, pause, play],
  );

  const retry = useCallback(() => {
    if (current !== null) {
      play(current);
    }
  }, [current, play]);

  /**
   * Applies a playback rate to the current player.
   *
   * `command` records a failure against the **verse**, which makes the control read "could not be
   * played" and offer a retry. That is the right response to a file that will not open, and the
   * wrong one to a platform that declines to change the rate: the recitation is playing perfectly,
   * and the only thing that failed is a secondary control. So this has its own catch, and what it
   * withdraws is the speed control.
   *
   * `shouldCorrectPitch` is deliberately not assigned. `setPlaybackRate`'s second argument already
   * requests pitch correction, and writing the property as well would be mutating an object this
   * hook does not own.
   */
  const applyRate = useCallback(
    (value: number) => {
      try {
        player.setPlaybackRate(value, 'high');
      } catch {
        setSpeedRejected(true);
      }
    },
    [player],
  );

  /**
   * The chosen rate, re-applied whenever the player changes.
   *
   * A new verse is a new native player, and a player starts at 1.0 — so without this the rate would
   * silently reset on every auto-advance, which is exactly the moment a user who chose a slower rate
   * is relying on it.
   */
  useEffect(() => {
    if (current === null || !status.isLoaded) {
      return;
    }
    /**
     * Deferred to a macrotask, for the reason the auto-advance effect below records: `applyRate` can
     * `setState`, and doing that synchronously inside an effect cascades a render, which this
     * project's lint rules fail the build on. The cleanup cancels it, so a screen unmounted between
     * a verse loading and the rate being applied does not reach for a released player.
     */
    const timer = setTimeout(() => applyRate(rate), 0);
    return () => clearTimeout(timer);
  }, [rate, current, status.isLoaded, applyRate]);

  const seekTo = useCallback(
    (seconds: number) => {
      const total = reported(status.duration, { allowZero: false });
      if (current === null || total === null) {
        // Nothing reliable to seek within. Silently ignored rather than clamped to a guess.
        return;
      }
      const bounded = Math.min(Math.max(seconds, 0), total);
      command((target) => void target.seekTo(bounded), current.ayah);
    },
    [command, current, status.duration],
  );

  /**
   * Steps one verse from wherever the transport actually is.
   *
   * Reads `currentAyah.current` rather than the rendered `index`, so a burst of taps inside one frame
   * advances once per tap instead of collapsing into a single step. Each call mints its own token, so
   * a completion still in flight from any earlier selection is already stale by construction.
   */
  const step = useCallback(
    (delta: 1 | -1) => {
      /*
        Falls back to the first verse with audio, because the buttons are live before anything has
        been selected: on a player that has only ever been looked at, `currentAyah` is still unset
        and Next means "the verse after the one on the label".
      */
      const from = currentAyah.current ?? ordered[0]?.ayah ?? null;
      const at = from === null ? -1 : ordered.findIndex((item) => item.ayah === from);
      if (at < 0) {
        return;
      }
      const target = ordered[at + delta];
      if (target === undefined) {
        return;
      }
      /*
        Stepping from a stopped or never-started player moves the player, it does not start it.
        Pressing Next on a paused transport and hearing audio begin is the behaviour of a control
        the user did not press.
      */
      if (selection === null) {
        focusOn(target);
        return;
      }
      play(target);
    },
    [ordered, play, selection, focusOn],
  );

  const next = useCallback(() => step(1), [step]);
  const previous = useCallback(() => step(-1), [step]);

  /**
   * Auto-advance: one genuine completion moves exactly one ayah.
   *
   * ── The four conditions, and the hole each one closes ───────────────────────
   * `didJustFinish` is a real signal from the platform rather than a timer this hook ran, which is
   * what makes auto-advance honest — it cannot fire early on a slow network or drift over a long
   * surah. It is also a **status flag rather than an event**, and every guard below exists because
   * of that one property.
   *
   *   1. **`selection !== null`.** A completion observed while nothing is loaded — the state `stop`
   *      leaves behind — computes `index` as `-1`, and `ordered[index + 1]` is `ordered[0]`. Without
   *      this the reader restarts the surah from verse one seconds after the user stopped it.
   *   2. **`armedToken === token`.** The selection's own source has reported in, loaded and not
   *      finished. A completion seen before that can only belong to the source this one replaced —
   *      which is the commit the device actually produces on every advance, and the one that made a
   *      single completion walk to the end of the page.
   *   3. **`handledFinishToken !== token`.** The same completion, observed again by a re-render, is
   *      the same completion. Acting once per token is what makes a flag behave like the event it
   *      stands in for.
   *   4. **`!failed`.** A verse the platform refused never completes; advancing past it would skip a
   *      verse the user never heard.
   *
   * Seeking to the end is defined behaviour and needs no separate case: it produces one genuine
   * completion on an already-armed token, so it advances exactly once, like any other completion.
   */
  useEffect(() => {
    if (!autoAdvance || !status.didJustFinish || selection === null) {
      return;
    }
    if (armedToken.current !== selection.token || handledFinishToken.current === selection.token) {
      return;
    }
    if (!status.isLoaded) {
      // Buffering or failed. Not a completion, whatever the flag says.
      return;
    }
    handledFinishToken.current = selection.token;

    const following = ordered[index + 1];
    /**
     * Deferred to a macrotask rather than run inline.
     *
     * Both branches call `setState`, and doing that synchronously inside an effect cascades a render
     * — the pattern this project's lint rules fail the build on. A timeout of zero puts the
     * transition on the next tick, where it is an ordinary update. The cleanup cancels it, so a
     * screen unmounted between a verse finishing and the next one starting does not reach for a
     * released player.
     *
     * The token is marked handled **before** the timer rather than inside it, so a re-render in the
     * gap cannot schedule a second advance for the same completion.
     */
    const finished = selection.recitation.ayah;
    const timer = setTimeout(() => {
      if (following === undefined) {
        // End of the loaded page. Stopping releases the session rather than leaving a finished
        // player holding it open — and the verse it ended on is recorded, so the player can say
        // "finished" rather than showing the same idle face it wore before anything played.
        stop();
        setCompletedAyah(finished);
        return;
      }
      play(following);
    }, 0);

    return () => clearTimeout(timer);
  }, [status.didJustFinish, status.isLoaded, autoAdvance, ordered, index, selection, play, stop]);

  /**
   * ── `stopOnUnmount`: the effect that used to be here, and why it is not ─────
   *
   * It was `useEffect(() => () => { player.pause(); }, [player])`, and it was the whole defect.
   * `useAudioPlayer` releases the player in a cleanup registered where it is called — above, near
   * the top of this hook — and React runs cleanups in declaration order, so on unmount the release
   * always happened first and this `pause` always landed on a released shared object.
   *
   * It is **deleted rather than reordered.** Registering it before `useAudioPlayer` would make the
   * cleanup run first and would work, and it would still be wrong: it would leave this file sharing
   * ownership of a lifetime the SDK documents as its own. Nothing is lost by deleting it — release
   * stops playback, so the guarantee is one the SDK provides.
   */

  const failedPreparation =
    preparationFailure !== null && preparationFailure.ayah === current?.ayah
      ? preparationFailure.failure
      : null;
  /** True while a file is being produced: selected, no URI yet, and no failure reported for it. */
  const preparing = current !== null && uri === null && failedPreparation === null;

  return {
    current,
    focus,
    /**
     * The verse the transport has been **explicitly** pointed at, or `null`.
     *
     * ── Why this is not `focus` ─────────────────────────────────────────────
     * `focus` falls back to `ordered[0]` so the panel always has something to draw, and that
     * fallback is exactly what made a deep link caption itself wrong: opening `reader/2?ayah=255`
     * where the reciter's list only covered the first page left `focusAyah` unset, so `focus`
     * resolved to verse 1 and the player announced "Aya 1" over a reader sitting on 255.
     *
     * This reports only a *decision* — a loaded verse, or one `focusOn` was called with. A caller
     * that knows which verse the screen is actually about can then prefer its own answer when the
     * transport has not been pointed anywhere, instead of being overruled by a fallback.
     */
    pointedAyah: current?.ayah ?? focusAyah,
    focusOn,
    completed: completedAyah !== null && completedAyah === focus?.ayah,
    playing: status.playing,
    buffering: status.isBuffering,
    preparing,
    prepareProgress: current === null || !preparing ? null : preparation.progressFor(current),
    preparationFailure: failedPreparation,
    /**
     * A load that did not succeed, or a call the platform refused.
     *
     * `preparing` is excluded explicitly. The heuristic below — "a source is set, the player is not
     * loading it and has not loaded it" — reads true for the whole time a file is being fetched,
     * because during that window the player deliberately has *no* source. Without this guard every
     * prepared verse would flash the retry icon before it started.
     */
    failed:
      current !== null &&
      !preparing &&
      (rejectedAyah === current.ayah ||
        failedPreparation !== null ||
        (uri !== null && !status.isLoaded && !status.isBuffering)),
    hasNext,
    hasPrevious,
    autoAdvance,
    /**
     * Elapsed accepts zero and duration does not, because the two ambiguities are not the same.
     *
     * A verse genuinely *is* at zero seconds the instant it starts, so refusing that value would
     * make the progress bar jump in from nowhere. A verse is never zero seconds *long*, so a zero
     * duration can only mean the platform has not determined one.
     */
    elapsedSeconds: reported(status.currentTime, { allowZero: true }),
    durationSeconds: reported(status.duration, { allowZero: false }),
    rate,
    /**
     * Offered until the platform refuses it, including before anything is loaded.
     *
     * It used to require a loaded verse, on the reasoning that there was no player to apply a rate
     * to. That is true and it is not the whole story: the chosen rate is re-applied every time a
     * verse loads — see the effect above — so a rate chosen on an idle player is honoured the
     * moment playback starts. Withdrawing the control until then would have hidden it in exactly
     * the state the player now spends most of its time in.
     *
     * A refusal is still sticky and still withdraws it: a runtime that rejects the call once will
     * reject it again, and a control that silently does nothing is a promise the build cannot keep.
     */
    speedSupported: !speedRejected,
    setRate: (value: number) => {
      // Only a rate this app offers. A caller passing something else is a bug, and honouring it
      // would put playback outside the bound the list above exists to enforce.
      if (RECITATION_RATES.includes(value)) {
        setRateState(value);
      }
    },
    seekTo,
    play,
    toggle,
    retry,
    pause,
    stop,
    next,
    previous,
    setAutoAdvance,
  };
}
