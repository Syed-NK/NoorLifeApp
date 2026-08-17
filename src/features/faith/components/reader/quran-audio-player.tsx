import { useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { AppIcon, PressableScale } from '@ds/components';
import { modulePalettes, shadowRaised } from '@ds/tokens';
import { ModuleText } from '@features/modules/components';
import { moduleLayout, moduleNeutrals, readerDockColors } from '@features/modules/module-tokens';
import { useModuleTheme } from '@features/modules/module-context';
import { useModuleMetrics } from '@features/modules/use-module-metrics';
import { minimumHitSlop } from '@shared/utils/a11y';

/**
 * What the player is doing, as one closed set.
 *
 * ── Why a union rather than five booleans ───────────────────────────────────
 * The player it replaces derived its appearance from `playing`, `buffering`, `preparing` and
 * `failed` at each of a dozen call sites, and the combinations nobody thought about — failed *and*
 * buffering, preparing *and* playing — each drew something slightly different. A single resolved
 * state is decided once, by the transport, and every branch below is exhaustive over it.
 *
 * ── Two of these are new, and they replace one that was a lie ──────────────
 * `preparing` is gone. It described NoorLife fetching a verse's audio at the moment somebody pressed
 * Play, which is the behaviour this pass removed: playback is now sourced only from files already on
 * the device. A state named after a network wait that can no longer occur would be a control claiming
 * work that is not happening.
 *
 * In its place are `not-downloaded` — there is no audio here and the remedy is a download, not a
 * retry — and `missing-ayah`, which is playback having stopped at a verse the device does not hold.
 * The second is the important one: it is what makes stopping at a gap distinguishable from a surah
 * that finished, so the panel can say which happened instead of falling silent either way.
 */
export type QuranPlaybackState =
  | 'idle'
  /** The offline manifest has not been read yet. Distinct from `not-downloaded`: nothing is known. */
  | 'loading'
  /** No audio for this surah on this device. The action is a download. */
  | 'not-downloaded'
  | 'starting'
  | 'buffering'
  | 'playing'
  | 'paused'
  | 'completed'
  /** Stopped at a verse that is not downloaded. Never skipped, never streamed. */
  | 'missing-ayah'
  | 'failed';

export type QuranAudioPlayerProps = {
  readonly surahName: string;
  /** The ayah the player is pointed at — playing, or merely selected. */
  readonly ayah: number;
  readonly totalAyat: number;
  /** `null` until the reciter catalogue resolves. Never replaced with a guessed name. */
  readonly reciterName: string | null;
  readonly state: QuranPlaybackState;
  /** Seconds played, or `null` where the platform has not said. */
  readonly positionSeconds: number | null;
  readonly durationSeconds: number | null;
  readonly rate: number;
  readonly rates: readonly number[];
  /** False only where the platform has refused a rate change. */
  readonly rateSupported: boolean;
  readonly hasPrevious: boolean;
  readonly hasNext: boolean;
  /** How many of this surah's verses are on the device. Drawn only where it is not all of them. */
  readonly downloadedAyat: number;
  /** The verse playback stopped at, or the verse that cannot start. `null` when neither applies. */
  readonly missingAyah: number | null;
  readonly onTogglePlay: () => void;
  readonly onPrevious: () => void;
  readonly onNext: () => void;
  readonly onSeek: (seconds: number) => void;
  readonly onChangeRate: (rate: number) => void;
  readonly onRetry: () => void;
  readonly onOpenReciters: () => void;
  /**
   * Opens the Offline audio screen.
   *
   * ── Why this is the action and a retry is not ───────────────────────────────
   * A verse that is not on the device cannot be produced by pressing Play again, and a control that
   * looked like it might would be the streaming fallback reintroduced as a user expectation. The one
   * honest thing this panel can offer is the screen where the download is made.
   */
  readonly onManageOfflineAudio: () => void;
};

/**
 * The Qur'an reader's audio player: one dock, always present, every control on it.
 *
 * ── What it replaces, and why the collapsed form is gone ────────────────────
 * The previous transport rendered only once `transport.current !== null`, and started collapsed.
 * Opening a surah therefore showed no player at all; tapping a verse showed a small strip offering
 * "Play from here"; the seek bar, the speed control and the download action lived behind an expand
 * chevron. Three separate steps stood between a reader and the controls of the thing they had come
 * to listen to, and at each step the player was a different shape.
 *
 * It is now one shape. The dock mounts as soon as the reader has a page, and it carries the whole
 * transport in every state — idle, preparing, playing, paused, buffering, finished, offline and
 * failed. Nothing about it collapses, nothing is revealed by a chevron, and there is no second
 * presentation of playback anywhere in the reader.
 *
 * ── It renders playback; it does not own it ─────────────────────────────────
 * Every input is a prop and every action is a callback. This component holds exactly one piece of
 * state — the measured width of its own seek track, which nothing outside it can know. It cannot
 * choose a verse, cannot fetch, and cannot decide what plays next; `useRecitationPlayer` owns all
 * of that, and `ReaderPlayer` is the adapter between the two. That separation is what lets the
 * player be tested at a fixed viewport without an audio pipeline behind it.
 *
 * ── It docks above bottom navigation and never covers the last ayah ─────────
 * The panel is handed to `ModuleScaffold` as `docked`, which places it last in its flex column with
 * the navigation bar's space reserved beneath it. The scroll region above is `flex: 1`, so it ends
 * exactly where this panel begins: the last verse of a surah scrolls fully clear of the player
 * because the two never share any space, not because a padding was computed to match a measurement.
 */
export function QuranAudioPlayer({
  surahName,
  ayah,
  totalAyat,
  reciterName,
  state,
  positionSeconds,
  durationSeconds,
  rate,
  rates,
  rateSupported,
  hasPrevious,
  hasNext,
  downloadedAyat,
  missingAyah,
  onTogglePlay,
  onPrevious,
  onNext,
  onSeek,
  onChangeRate,
  onRetry,
  onOpenReciters,
  onManageOfflineAudio,
}: QuranAudioPlayerProps) {
  const { dp } = useModuleMetrics();

  const playable = state !== 'not-downloaded' && state !== 'loading';
  /*
    ── Why the step controls need their own reason ─────────────────────────
    `hasNext` is false for two different situations, and the label named only one of them: at the
    end of the queue, and when there is no queue at all. On a release device that produced "Next
    ayah, unavailable on the last ayah" while the panel was pointed at verse one of eleven — a
    statement about a position in a queue that did not exist. The queue's existence is the state,
    not the flags, so it is read from there.
  */
  const queued = playable && state !== 'idle';
  /*
    ── The third case, found on a device after the first two were fixed ──────
    A partially downloaded surah reaches the end of what is on the phone without reaching the end of
    the surah. Ya-Sin with 5 of 83 verses stopped correctly at verse 5 — the panel said so, naming
    verse 6 — while this control announced "Next ayah, unavailable on the last ayah" from verse 5 of
    83. The stop was honest and the label contradicted it.

    So the reason is derived rather than assumed. The end of the surah is `ayah`; the end of what is
    downloaded is `missingAyah`, which the screen already supplies for exactly this state. Checking
    the surah's end first keeps the two from competing on the genuine final verse.
  */
  const nextReason = !queued
    ? ', unavailable until playback starts'
    : ayah >= totalAyat
      ? ', unavailable on the last ayah'
      : missingAyah !== null
        ? `, unavailable — verse ${missingAyah} is not downloaded`
        : ', unavailable — the next verse is not downloaded';
  /*
    The same asymmetry backwards. `hasPrevious` is false at the start of the *queue*, which is only
    the first ayah when playback began there — starting from verse 40 would otherwise have this
    announce "the first ayah" while pointed at verse 40.
  */
  const previousReason = !queued
    ? ', unavailable until playback starts'
    : ayah <= 1
      ? ', unavailable on the first ayah'
      : ', unavailable — no earlier verse in this playback';
  const identity = `${surahName} • Aya ${ayah}`;

  return (
    <View
      style={{
        backgroundColor: readerDockColors.surface,
        borderRadius: dp(moduleLayout.cardRadius),
        borderWidth: 1,
        borderColor: readerDockColors.border,
        paddingHorizontal: dp(PLAYER_PADDING_H),
        paddingVertical: dp(PLAYER_PADDING_V),
        /*
          A floor, never a fixed height. The specified 112–128 dp is what the two rows measure at
          the ordinary text size; a failure line or a large accessibility setting makes the panel
          taller, and the scaffold re-measures it, so the reading column's clearance follows.
        */
        minHeight: dp(PLAYER_MIN_HEIGHT),
        rowGap: dp(10),
        ...shadowRaised,
      }}
      testID="faith-reader-player"
    >
      {/*
        ── A temporary diagnostic, removed before this work is committed ─────
        `console.log` does not reach logcat on a release build, and the release build is the one
        whose playback is being stabilised. This carries the same privacy-safe trace as an
        accessibility label so `uiautomator dump` can read it. It draws nothing.
      */}

      {state === 'failed' ? <RetryRow ayah={ayah} onRetry={onRetry} /> : null}

      {state === 'not-downloaded' || state === 'missing-ayah' ? (
        <OfflineRow
          state={state}
          ayah={missingAyah ?? ayah}
          surahName={surahName}
          downloadedAyat={downloadedAyat}
          totalAyat={totalAyat}
          onPress={onManageOfflineAudio}
        />
      ) : null}

      {/*
        The content row, and its gaps are measured rather than chosen.

        At the 393 dp reference the panel is 361 dp wide; padding, the 48 dp play control and the
        four trailing controls account for 209 of it, which leaves 152 dp for the identity column.
        `Al-Baqarah • Aya 1` sets at about 129 dp there, so the ordinary case is one line. Wider
        gaps looked better in isolation and pushed that string onto two lines on every surah with a
        long name — which is the whole reason these are 6 and 3 rather than 8 and 4.
      */}
      <View style={{ flexDirection: 'row', alignItems: 'center', columnGap: dp(6) }}>
        <PlayButton state={state} identity={identity} onPress={onTogglePlay} />

        <View
          style={{ flex: 1, minWidth: 0 }}
          accessible
          accessibilityLiveRegion="polite"
          accessibilityLabel={`${describeState(state)}. ${surahName} verse ${ayah} of ${totalAyat}${
            reciterName === null ? '' : `, recited by ${reciterName}`
          }`}
          testID="faith-reader-player-status"
        >
          <ModuleText
            token="cardTitle"
            numberOfLines={2}
            maxFontSizeMultiplier={PLAYER_MAX_FONT_SCALE}
            testID="faith-reader-player-title"
          >
            {identity}
          </ModuleText>
          {/*
            The reciter, and the one status word the icons cannot carry.

            Play/pause already says whether it is playing, so those two states add nothing here and
            the line stays as the mockup draws it — the reciter's name alone. Preparing, buffering,
            finished and unavailable are states no glyph on this panel expresses, so they are
            spelled out. The download's own progress joins them for the same reason.
          */}
          <PressableScale
            onPress={onOpenReciters}
            accessibilityRole="button"
            accessibilityLabel={`Change reciter. Currently ${reciterName ?? 'not yet named'}`}
            hitSlop={minimumHitSlop(dp(18))}
            testID="faith-reader-player-reciter-control"
          >
            <ModuleText
              token="caption"
              numberOfLines={2}
              maxFontSizeMultiplier={PLAYER_MAX_FONT_SCALE}
              testID="faith-reader-player-reciter"
            >
              {`${reciterName ?? 'Recitation'}${stateSuffix(state)}`}
            </ModuleText>
          </PressableScale>
        </View>

        {/*
          A real spinner while something is genuinely outstanding, beside the text that says so.
          Two channels for one state, because a caption alone is easy to miss on a busy panel — and
          it covers both waits: NoorLife fetching the file, and the platform reading it.
        */}
        {state === 'starting' || state === 'buffering' ? (
          <ActivityIndicator
            color={moduleNeutrals.textSecondary}
            accessibilityLabel={
              state === 'starting' ? 'Starting recitation' : 'Buffering recitation'
            }
            testID="faith-reader-player-buffering"
          />
        ) : null}

        <View style={{ flexDirection: 'row', alignItems: 'center', columnGap: dp(3) }}>
          {/*
            ── The download control is gone from here, deliberately ──────────
            The docked player is a playback controller, not a download manager. It used to carry one
            control cycling through Download / Cancel / Remove / Retry / Finish across a six-state
            union — five of those states are about storage rather than listening, and none of them
            belongs on the surface somebody reaches for mid-recitation.

            Downloads live on their own screen now, reached through the reader's settings rather than
            through an icon here. See `docs/QURAN_AUDIO_ARCHITECTURE_AUDIT.md`.
          */}
          <SpeedControl
            rate={rate}
            rates={rates}
            supported={rateSupported}
            onChangeRate={onChangeRate}
          />
          <StepButton
            glyph="skip-previous"
            label={`Previous ayah${hasPrevious ? '' : previousReason}`}
            disabled={!hasPrevious || !playable}
            onPress={onPrevious}
            testID="faith-reader-player-previous"
          />
          <StepButton
            glyph="skip-next"
            label={`Next ayah${hasNext ? '' : nextReason}`}
            disabled={!hasNext || !playable}
            onPress={onNext}
            testID="faith-reader-player-next"
          />
        </View>
      </View>

      <SeekRow
        positionSeconds={positionSeconds}
        durationSeconds={durationSeconds}
        onSeek={onSeek}
      />
    </View>
  );
}

/** The panel's own geometry, exported so the layout test measures the shipped numbers. */
export const PLAYER_PADDING_H = 12;
export const PLAYER_PADDING_V = 12;
/** The specified expanded height, as a floor. See the note on the panel's style. */
export const PLAYER_MIN_HEIGHT = 112;
/** The play/pause target. Above the 44 dp minimum, and the mockup's dominant control. */
export const PLAYER_PLAY_SIZE = 48;
/** Secondary controls: 28 dp drawn, carried to the 44 dp minimum by hit-slop. */
export const PLAYER_STEP_SIZE = 28;
/**
 * How far OS text scaling may grow the panel's labels.
 *
 * The panel grows with them — nothing here is clipped — but two rows of controls and two lines of
 * text cannot absorb 2× without the transport leaving the viewport on a short device. 1.5 keeps the
 * labels legibly larger while the dock stays a dock.
 */
export const PLAYER_MAX_FONT_SCALE = 1.5;

/** What the transport is doing, in the words the screen reader uses. */
export function describeState(state: QuranPlaybackState): string {
  switch (state) {
    case 'idle':
      /*
        "Ready to play" is now a claim this state can actually make: the queue is built from files
        already validated on the device, so reaching `idle` means the audio is there. It could not be
        said under the previous architecture, where the files were fetched when Play was pressed and
        this caption appeared over surahs with no audio on the device at all.
      */
      return 'Ready to play';
    case 'loading':
      return 'Checking downloaded audio';
    case 'not-downloaded':
      return 'Not downloaded';
    case 'starting':
      return 'Starting';
    case 'buffering':
      return 'Buffering';
    case 'playing':
      return 'Reciting';
    case 'paused':
      return 'Paused';
    case 'completed':
      return 'Finished';
    case 'missing-ayah':
      return 'Stopped — next verse not downloaded';
    case 'failed':
      return 'Could not play';
  }
}

/**
 * The states the play/pause glyph cannot express, appended to the reciter line.
 *
 * Playing, paused and idle are all already visible: the button shows a pause glyph or a play one,
 * and the seek bar shows whether anything has started. Repeating them in words would push the
 * reciter's name off the line to say what the control beside it already says.
 */
function stateSuffix(state: QuranPlaybackState): string {
  switch (state) {
    case 'playing':
    case 'paused':
    case 'idle':
      return '';
    case 'loading':
    case 'not-downloaded':
    case 'starting':
    case 'buffering':
    case 'completed':
    case 'missing-ayah':
    case 'failed':
      return ` • ${describeState(state)}`;
  }
}

/**
 * The large play/pause control.
 *
 * Filled with the module's `fill` and labelled in white, which is the one pair on this panel
 * measured for white text. Its gold ring is the locked Faith supporting hue, so the control reads
 * as the dominant thing on a gold panel without introducing a second green.
 */
function PlayButton({
  state,
  identity,
  onPress,
}: {
  readonly state: QuranPlaybackState;
  readonly identity: string;
  readonly onPress: () => void;
}) {
  const theme = useModuleTheme();
  const { dp } = useModuleMetrics();
  /*
    Disabled for the two states where there is nothing a press could start: nothing is downloaded, or
    the manifest has not been read and pressing would have to guess which of those it is. Every other
    state — including `failed` and `missing-ayah` — keeps the control live, because in the first
    retrying is the point and in the second the verses before the gap are still playable.
  */
  const disabled = state === 'not-downloaded' || state === 'loading';
  const size = dp(PLAYER_PLAY_SIZE);

  return (
    <PressableScale
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled, busy: state === 'starting' || state === 'buffering' }}
      accessibilityLabel={
        disabled
          ? /*
               ── Why this does not say "no recitation available" ──────────────────
               It used to, and on a device that sentence appeared over Al-Fatihah — a surah Quran
               Foundation publishes in full. The audio was simply not downloaded. Blaming the
               publisher for a file the user has not fetched is the same misattribution the size
               wording was corrected for, and it is worse here because it is the only thing a screen
               reader is told about a control that will not respond.
            */
            state === 'loading'
            ? `Checking downloaded audio for ${identity}`
            : `${identity} is not downloaded. Open offline audio to download it`
          : state === 'playing'
            ? `Pause recitation of ${identity}`
            : `Play recitation of ${identity}`
      }
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: disabled ? moduleNeutrals.skeleton : theme.fill,
        borderWidth: dp(2),
        borderColor: modulePalettes.faith.supporting,
        opacity: disabled ? 0.6 : 1,
      }}
      testID="faith-reader-player-toggle"
    >
      <AppIcon
        name={state === 'playing' ? 'pause' : 'play'}
        size={dp(24)}
        color={disabled ? moduleNeutrals.textTertiary : theme.onFill}
      />
    </PressableScale>
  );
}

/** Previous / next ayah. Disabled only at the two genuine ends of the recitation. */
function StepButton({
  glyph,
  label,
  disabled,
  onPress,
  testID,
}: {
  readonly glyph: 'skip-previous' | 'skip-next';
  readonly label: string;
  readonly disabled: boolean;
  readonly onPress: () => void;
  readonly testID: string;
}) {
  const { dp } = useModuleMetrics();

  return (
    <PressableScale
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      hitSlop={minimumHitSlop(dp(moduleLayout.minTouchTarget))}
      style={{
        width: dp(PLAYER_STEP_SIZE),
        height: dp(PLAYER_STEP_SIZE),
        alignItems: 'center',
        justifyContent: 'center',
        opacity: disabled ? 0.4 : 1,
      }}
      testID={testID}
    >
      <AppIcon
        name={glyph}
        size={dp(22)}
        color={disabled ? moduleNeutrals.textTertiary : readerDockColors.accent}
      />
    </PressableScale>
  );
}

/**
 * The speed control — one button that cycles the offered rates.
 *
 * ── A cycle rather than a menu, and rates rather than a slider ──────────────
 * There are four values. A menu would be a sheet to open and dismiss for a choice between four
 * things, and a slider would offer the continuum the bound in `RECITATION_RATES` exists to prevent.
 * Cycling shows the current rate as its own label, which is also what a screen reader announces.
 *
 * Drawn whether or not a verse is loaded: the chosen rate is applied to every verse as it loads, so
 * a rate set on an idle player is honoured when playback starts. It disappears only where the
 * platform has refused a rate change outright, because a control that silently does nothing claims
 * a capability the device does not have.
 */
function SpeedControl({
  rate,
  rates,
  supported,
  onChangeRate,
}: {
  readonly rate: number;
  readonly rates: readonly number[];
  readonly supported: boolean;
  readonly onChangeRate: (rate: number) => void;
}) {
  const { dp } = useModuleMetrics();

  if (!supported) {
    return null;
  }

  const index = rates.indexOf(rate);
  const nextRate = rates[(index + 1) % rates.length] ?? 1;

  return (
    <PressableScale
      onPress={() => onChangeRate(nextRate)}
      accessibilityRole="button"
      accessibilityLabel={`Playback speed ${rate} times. Change to ${nextRate} times`}
      hitSlop={minimumHitSlop(dp(moduleLayout.minTouchTarget))}
      style={{
        minWidth: dp(32),
        height: dp(PLAYER_STEP_SIZE),
        paddingHorizontal: dp(3),
        alignItems: 'center',
        justifyContent: 'center',
      }}
      testID="faith-reader-player-speed"
    >
      <ModuleText
        token="cardAction"
        numberOfLines={1}
        maxFontSizeMultiplier={PLAYER_MAX_FONT_SCALE}
        color={moduleNeutrals.textPrimary}
      >
        {`${rate}×`}
      </ModuleText>
    </PressableScale>
  );
}

/**
 * Elapsed, a seek bar, and the verse's length.
 *
 * ── Why the row is always drawn, and the bar is sometimes inactive ──────────
 * The previous transport removed the whole row until the platform reported a duration, on the
 * reasoning that `0` means "not determined yet" as often as it means zero — which is true, and led
 * to a player that changed shape the moment a verse loaded. The ambiguity is still refused: a
 * duration nobody has reported reads `--:--` rather than `0:00`, and the track takes no presses,
 * because seeking within an unknown length is not a thing that can be done. What has changed is
 * that the row is present either way, so the panel has one height and one layout.
 *
 * Seeking is by tapping the track. A draggable thumb needs a gesture handler and a pixel-to-seconds
 * mapping that is only correct once the track has been measured; tapping is one `onLayout` and is
 * accurate to the same degree.
 */
function SeekRow({
  positionSeconds,
  durationSeconds,
  onSeek,
}: {
  readonly positionSeconds: number | null;
  readonly durationSeconds: number | null;
  readonly onSeek: (seconds: number) => void;
}) {
  const { dp } = useModuleMetrics();
  const [trackWidth, setTrackWidth] = useState(0);

  const duration = durationSeconds;
  const elapsed = positionSeconds ?? 0;
  const seekable = duration !== null && duration > 0;
  const fraction = seekable ? Math.min(Math.max(elapsed / duration, 0), 1) : 0;

  return (
    <View
      style={{ flexDirection: 'row', alignItems: 'center', columnGap: dp(8) }}
      testID="faith-reader-player-progress"
    >
      <ModuleText
        token="caption"
        numberOfLines={1}
        maxFontSizeMultiplier={PLAYER_MAX_FONT_SCALE}
        testID="faith-reader-player-elapsed"
      >
        {formatSeconds(elapsed)}
      </ModuleText>

      <PressableScale
        onPress={(event) => {
          if (!seekable || trackWidth <= 0) {
            return;
          }
          const x = event.nativeEvent.locationX;
          onSeek((Math.min(Math.max(x, 0), trackWidth) / trackWidth) * duration);
        }}
        disabled={!seekable}
        onLayout={(event) => setTrackWidth(event.nativeEvent.layout.width)}
        accessibilityRole="adjustable"
        accessibilityLabel="Recitation position"
        accessibilityState={{ disabled: !seekable }}
        accessibilityValue={
          seekable
            ? {
                min: 0,
                max: Math.round(duration),
                now: Math.round(elapsed),
                text: `${formatSeconds(elapsed)} of ${formatSeconds(duration)}`,
              }
            : { text: 'Length not known yet' }
        }
        // The visible track is 4 dp; hit-slop brings the tappable region to the 44 dp minimum
        // without making the bar itself a heavy element on a compact panel.
        hitSlop={minimumHitSlop(dp(4))}
        style={{ flex: 1, height: dp(4), justifyContent: 'center' }}
        testID="faith-reader-player-seek"
      >
        <View
          style={{
            height: dp(4),
            borderRadius: dp(2),
            backgroundColor: readerDockColors.track,
            overflow: 'hidden',
          }}
        >
          <View
            style={{
              width: `${fraction * 100}%`,
              height: '100%',
              backgroundColor: seekable ? readerDockColors.accent : 'transparent',
            }}
          />
        </View>
      </PressableScale>

      <ModuleText
        token="caption"
        numberOfLines={1}
        maxFontSizeMultiplier={PLAYER_MAX_FONT_SCALE}
        testID="faith-reader-player-duration"
      >
        {duration === null ? UNKNOWN_DURATION : formatSeconds(duration)}
      </ModuleText>
    </View>
  );
}

/**
 * What a length nobody has reported is written as.
 *
 * Not `0:00`, which is a measurement — and a wrong one. `AudioStatus.duration` is `0` until the
 * platform determines it, and printing that would state that the verse is zero seconds long.
 */
export const UNKNOWN_DURATION = '--:--';

/**
 * The line offered when a verse is not on the device.
 *
 * ── Why this is not a retry, and why that distinction is load-bearing ───────
 * A retry is the right offer when something failed and might succeed. Nothing failed here: the audio
 * was never downloaded, and pressing Play again would produce exactly the same nothing. Offering a
 * retry would train a user to expect that pressing enough times eventually streams the verse — which
 * is the streaming fallback this architecture removed, reintroduced as an expectation rather than as
 * code.
 *
 * So the action is the Offline audio screen, the wording says what is actually true, and the two
 * cases are worded apart: nothing downloaded at all is a different sentence from playback having
 * stopped part-way because the next verse is missing.
 */
function OfflineRow({
  state,
  ayah,
  surahName,
  downloadedAyat,
  totalAyat,
  onPress,
}: {
  readonly state: 'not-downloaded' | 'missing-ayah';
  readonly ayah: number;
  readonly surahName: string;
  readonly downloadedAyat: number;
  readonly totalAyat: number;
  readonly onPress: () => void;
}) {
  const { dp } = useModuleMetrics();

  const message =
    state === 'not-downloaded'
      ? `${surahName} is not downloaded, so there is no audio to play on this device.`
      : `Playback stopped at verse ${ayah}, which is not downloaded. ${downloadedAyat} of ${totalAyat} verses are on this device.`;

  return (
    <PressableScale
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${message} Manage offline audio`}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        columnGap: dp(8),
        minHeight: dp(moduleLayout.minTouchTarget),
      }}
      testID="faith-reader-player-offline"
    >
      <AppIcon name="download" size={dp(16)} color={moduleNeutrals.textSecondary} />
      <ModuleText
        token="caption"
        color={moduleNeutrals.textSecondary}
        numberOfLines={3}
        maxFontSizeMultiplier={PLAYER_MAX_FONT_SCALE}
        style={{ flex: 1 }}
      >
        {`${message} Tap to manage offline audio.`}
      </ModuleText>
    </PressableScale>
  );
}

/**
 * The failure line, for the one failure that survives local-only playback.
 *
 * ── Why there is only one message now ───────────────────────────────────────
 * There used to be four, one per preparation failure — offline, low storage, interrupted, corrupt —
 * because every one of them was a way a *fetch* could go wrong at the moment of pressing Play. There
 * is no fetch on this path any more. What remains is the platform refusing to play a file that is
 * present and validated: a codec the device lacks, audio focus denied, a queue that never became
 * ready. All of those have the same remedy, and inventing four sentences for one situation would be
 * describing failures that cannot happen.
 */
function RetryRow({ ayah, onRetry }: { readonly ayah: number; readonly onRetry: () => void }) {
  const { dp } = useModuleMetrics();

  return (
    <PressableScale
      onPress={onRetry}
      accessibilityRole="button"
      accessibilityLabel={`${PLAYBACK_FAILURE_MESSAGE} Try verse ${ayah} again`}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        columnGap: dp(8),
        minHeight: dp(moduleLayout.minTouchTarget),
      }}
      testID="faith-reader-player-retry"
    >
      <AppIcon name="retry" size={dp(16)} color={moduleNeutrals.warning} />
      <ModuleText
        token="caption"
        color={moduleNeutrals.warning}
        numberOfLines={3}
        maxFontSizeMultiplier={PLAYER_MAX_FONT_SCALE}
        style={{ flex: 1 }}
      >
        {`${PLAYBACK_FAILURE_MESSAGE} Tap to try again.`}
      </ModuleText>
    </PressableScale>
  );
}

/**
 * What is said when the platform refuses a file that is present and validated.
 *
 * Deliberately does not guess at a cause. The candidates — a codec the device lacks, audio focus
 * held by another app, a native queue that never became ready — are indistinguishable from here, and
 * naming one of them would be right about a third of the time and misleading the rest.
 */
export const PLAYBACK_FAILURE_MESSAGE = 'This verse could not be played.';

/** `0:07`, `1:42`. Minutes and seconds, which is the whole range a single ayah occupies. */
export function formatSeconds(value: number): string {
  const whole = Math.max(0, Math.floor(value));
  const minutes = Math.floor(whole / 60);
  return `${minutes}:${String(whole % 60).padStart(2, '0')}`;
}

export function formatBytes(bytes: number): string {
  /**
   * ── Why zero is its own case ────────────────────────────────────────────────
   * The `Math.max(1, …)` below used to apply to every value, and on a device with nothing downloaded
   * the Offline audio screen therefore read **"1 KB downloaded"**. That is a fabricated measurement
   * of exactly the kind this feature is built to refuse — a non-zero figure standing in for nothing
   * at all — and it was invisible in Jest because no unit test asked what zero looks like.
   *
   * The floor itself is kept for genuinely small non-zero values: a 400-byte file is not "0 KB", and
   * rounding it to zero would be the same lie in the other direction.
   */
  if (bytes <= 0) {
    return '0 bytes';
  }
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
