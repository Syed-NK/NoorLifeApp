import { useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { AppIcon, PressableScale } from '@ds/components';
import { modulePalettes, shadowRaised } from '@ds/tokens';
import { ModuleText } from '@features/modules/components';
import { moduleLayout, moduleNeutrals, readerDockColors } from '@features/modules/module-tokens';
import { useModuleTheme } from '@features/modules/module-context';
import { useModuleMetrics } from '@features/modules/use-module-metrics';
import { minimumHitSlop } from '@shared/utils/a11y';

import type { PreparationFailure, SurahDownloadState } from '../../data/audio';

/**
 * What the player is doing, as one closed set.
 *
 * ── Why a union rather than five booleans ───────────────────────────────────
 * The player it replaces derived its appearance from `playing`, `buffering`, `preparing` and
 * `failed` at each of a dozen call sites, and the combinations nobody thought about — failed *and*
 * buffering, preparing *and* playing — each drew something slightly different. A single resolved
 * state is decided once, by the adapter that owns the transport, and every branch below is
 * exhaustive over it.
 *
 * `unavailable` is the honest state for a surah this reciter has no recording of. It is not
 * `failed`: nothing failed, and no amount of retrying will produce audio that was never published.
 */
export type QuranPlaybackState =
  | 'idle'
  | 'preparing'
  | 'buffering'
  | 'playing'
  | 'paused'
  | 'completed'
  | 'offline'
  | 'failed'
  | 'unavailable';

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
  /** Fraction of the current verse's file that has arrived, or `null` when unmeasured. */
  readonly prepareProgress: number | null;
  readonly rate: number;
  readonly rates: readonly number[];
  /** False only where the platform has refused a rate change. */
  readonly rateSupported: boolean;
  readonly download: SurahDownloadState;
  readonly hasPrevious: boolean;
  readonly hasNext: boolean;
  /** Why the current verse could not be prepared, for the retry line's wording. */
  readonly failure: PreparationFailure | null;
  readonly onTogglePlay: () => void;
  readonly onPrevious: () => void;
  readonly onNext: () => void;
  readonly onSeek: (seconds: number) => void;
  readonly onChangeRate: (rate: number) => void;
  readonly onDownload: () => void;
  readonly onCancelDownload: () => void;
  /** Deletes this surah's downloaded audio. Reached from the completed state. */
  readonly onRemoveDownload: () => void;
  readonly onRetry: () => void;
  readonly onOpenReciters: () => void;
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
  prepareProgress,
  rate,
  rates,
  rateSupported,
  download,
  hasPrevious,
  hasNext,
  failure,
  onTogglePlay,
  onPrevious,
  onNext,
  onSeek,
  onChangeRate,
  onDownload,
  onCancelDownload,
  onRemoveDownload,
  onRetry,
  onOpenReciters,
}: QuranAudioPlayerProps) {
  const { dp } = useModuleMetrics();

  const playable = state !== 'unavailable';
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
      {state === 'failed' || state === 'offline' ? (
        <RetryRow failure={failure} ayah={ayah} onRetry={onRetry} />
      ) : null}

      {state === 'preparing' && prepareProgress !== null ? (
        <PrepareRow ayah={ayah} fraction={prepareProgress} />
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
              {`${reciterName ?? 'Recitation'}${stateSuffix(state)}${downloadSuffix(download)}`}
            </ModuleText>
          </PressableScale>
        </View>

        {/*
          A real spinner while something is genuinely outstanding, beside the text that says so.
          Two channels for one state, because a caption alone is easy to miss on a busy panel — and
          it covers both waits: NoorLife fetching the file, and the platform reading it.
        */}
        {state === 'preparing' || state === 'buffering' ? (
          <ActivityIndicator
            color={moduleNeutrals.textSecondary}
            accessibilityLabel={
              state === 'preparing' ? 'Preparing recitation' : 'Buffering recitation'
            }
            testID="faith-reader-player-buffering"
          />
        ) : null}

        <View style={{ flexDirection: 'row', alignItems: 'center', columnGap: dp(3) }}>
          <DownloadControl
            state={download}
            surahName={surahName}
            onDownload={onDownload}
            onCancel={onCancelDownload}
            onRemove={onRemoveDownload}
          />
          <SpeedControl
            rate={rate}
            rates={rates}
            supported={rateSupported}
            onChangeRate={onChangeRate}
          />
          <StepButton
            glyph="skip-previous"
            label={`Previous ayah${hasPrevious ? '' : ', unavailable on the first ayah'}`}
            disabled={!hasPrevious || !playable}
            onPress={onPrevious}
            testID="faith-reader-player-previous"
          />
          <StepButton
            glyph="skip-next"
            label={`Next ayah${hasNext ? '' : ', unavailable on the last ayah'}`}
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
function describeState(state: QuranPlaybackState): string {
  switch (state) {
    case 'idle':
      return 'Ready to play';
    case 'preparing':
      return 'Preparing';
    case 'buffering':
      return 'Buffering';
    case 'playing':
      return 'Reciting';
    case 'paused':
      return 'Paused';
    case 'completed':
      return 'Finished';
    case 'offline':
      return 'Not available offline';
    case 'failed':
      return 'Could not play';
    case 'unavailable':
      return 'No recitation for this surah';
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
    case 'preparing':
    case 'buffering':
    case 'completed':
    case 'offline':
    case 'failed':
    case 'unavailable':
      return ` • ${describeState(state)}`;
  }
}

/**
 * The download, stated on the panel rather than only in an icon.
 *
 * A glyph can say "there is a download control here"; it cannot say a surah is on the device until
 * a date, or that a transfer is a third of the way through. Those are facts a user plans around —
 * a commute, a flight — so they are on the line, not two taps away.
 */
function downloadSuffix(state: SurahDownloadState): string {
  switch (state.kind) {
    case 'stream-only':
      return '';
    case 'downloading':
      return ` • Downloading ${state.completed}/${state.total}`;
    case 'downloaded':
      return ` • Offline until ${formatDate(state.expiresAt)}`;
    case 'expired':
      return ' • Download expired';
    case 'incomplete':
      return ` • Download incomplete ${state.completed}/${state.total}`;
    case 'failed':
      return ' • Download failed';
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
  const disabled = state === 'unavailable';
  const size = dp(PLAYER_PLAY_SIZE);

  return (
    <PressableScale
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled, busy: state === 'preparing' || state === 'buffering' }}
      accessibilityLabel={
        disabled
          ? `No recitation available for ${identity}`
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
 * "Download this surah", and everything that is true instead of it.
 *
 * ── Every state is a different action, not a different colour ───────────────
 * Stream-only, running, complete, expired, incomplete and failed are six genuinely different
 * situations, and a control that said "Download" in all of them would be wrong in five. The glyph
 * changes with the state, the label states it in full, and the panel's caption line carries the
 * part a sighted user needs to plan around — see `downloadSuffix`.
 */
function DownloadControl({
  state,
  surahName,
  onDownload,
  onCancel,
  onRemove,
}: {
  readonly state: SurahDownloadState;
  readonly surahName: string;
  readonly onDownload: () => void;
  readonly onCancel: () => void;
  readonly onRemove: () => void;
}) {
  const { dp } = useModuleMetrics();

  const running = state.kind === 'downloading';
  const done = state.kind === 'downloaded';

  const label = ((): string => {
    switch (state.kind) {
      case 'downloading':
        return `Downloading ${surahName}, ${state.completed} of ${state.total} ayat. Cancel the download`;
      case 'downloaded':
        /*
          ── The dead end this replaces ────────────────────────────────────
          The control used to be `disabled` in this state, so a completed download turned the only
          affordance on the panel into a read-out: pressing it re-announced "is downloaded" and did
          nothing. The Reciter screen's own Remove was unreachable for this surah unless the user had
          separately marked a verse read, so there was no path from "I have downloaded this" to "I
          would like the space back". Now the control *is* that path.
        */
        return `${surahName} is downloaded, ${formatBytes(state.bytes)}, available until ${formatDate(state.expiresAt)}. Remove it from this device`;
      case 'expired':
        return `The download of ${surahName} has expired. Download it again`;
      case 'incomplete':
        return `The download of ${surahName} is incomplete, ${state.completed} of ${state.total} ayat. Finish it`;
      case 'failed':
        return `The download of ${surahName} failed. Try again`;
      case 'stream-only':
        return `Download ${surahName} for offline listening`;
    }
  })();

  return (
    <PressableScale
      onPress={running ? onCancel : done ? onRemove : onDownload}
      accessibilityRole="button"
      accessibilityState={{ busy: running }}
      accessibilityLabel={label}
      hitSlop={minimumHitSlop(dp(moduleLayout.minTouchTarget))}
      style={{
        width: dp(PLAYER_STEP_SIZE),
        height: dp(PLAYER_STEP_SIZE),
        borderRadius: dp(PLAYER_STEP_SIZE) / 2,
        borderWidth: 1,
        borderColor: readerDockColors.border,
        alignItems: 'center',
        justifyContent: 'center',
      }}
      testID="faith-reader-player-download"
    >
      {/*
        The destructive state gets the destructive glyph. A tick that removed a download on tap
        would be a delete button wearing the badge for "this worked" — the one icon a user is least
        expecting to take something away.
      */}
      <AppIcon
        name={running ? 'downloading' : done ? 'delete' : 'download'}
        size={dp(17)}
        color={done ? moduleNeutrals.warning : readerDockColors.accent}
      />
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
 * The failure line, naming the kind of failure.
 *
 * Each of the four preparation failures is a different thing for the user to do, and collapsing
 * them into one message would give three quarters of the affected users advice that cannot work.
 */
function RetryRow({
  failure,
  ayah,
  onRetry,
}: {
  readonly failure: PreparationFailure | null;
  readonly ayah: number;
  readonly onRetry: () => void;
}) {
  const { dp } = useModuleMetrics();

  return (
    <PressableScale
      onPress={onRetry}
      accessibilityRole="button"
      accessibilityLabel={`${failureMessage(failure)} Try verse ${ayah} again`}
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
        {`${failureMessage(failure)} Tap to try again.`}
      </ModuleText>
    </PressableScale>
  );
}

/**
 * The four preparation failures, each with the thing the user can actually do about it.
 *
 * The default covers the case where the platform refused playback of a file that *was* prepared —
 * a codec the device lacks, audio focus denied. Nothing about it is a preparation failure, so it
 * gets the honest generic sentence rather than being described as one of the four.
 */
export function failureMessage(failure: PreparationFailure | null): string {
  switch (failure) {
    case 'offline':
      return 'This verse is not on your device and you appear to be offline.';
    case 'low-storage':
      return 'There is not enough free space to prepare this verse.';
    case 'interrupted':
      return 'The download of this verse did not finish.';
    case 'corrupt':
      return 'The audio for this verse did not arrive intact.';
    case null:
      return 'This verse could not be played.';
  }
}

/**
 * How much of *this verse's file* has arrived.
 *
 * Distinct from the seek bar, which is a position within audio that has already loaded. Drawn only
 * when the server sent a length to measure against — the spinner already says "working", and a
 * fabricated fraction would claim a measurement nobody made.
 */
function PrepareRow({ ayah, fraction }: { readonly ayah: number; readonly fraction: number }) {
  const { dp } = useModuleMetrics();
  const bounded = Math.min(Math.max(fraction, 0), 1);

  return (
    <View style={{ rowGap: dp(4) }} testID="faith-reader-player-prepare-progress">
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
            width: `${bounded * 100}%`,
            height: '100%',
            backgroundColor: readerDockColors.accent,
          }}
        />
      </View>
      <ModuleText token="caption" numberOfLines={1} maxFontSizeMultiplier={PLAYER_MAX_FONT_SCALE}>
        {`Preparing verse ${ayah} — ${Math.round(bounded * 100)}%`}
      </ModuleText>
    </View>
  );
}

/** `0:07`, `1:42`. Minutes and seconds, which is the whole range a single ayah occupies. */
export function formatSeconds(value: number): string {
  const whole = Math.max(0, Math.floor(value));
  const minutes = Math.floor(whole / 60);
  return `${minutes}:${String(whole % 60).padStart(2, '0')}`;
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/**
 * A calendar date, in the device's own locale.
 *
 * Not a relative "in 6 days": an expiry the user is planning around — a flight, a commute with no
 * signal — is a date, and "in 6 days" forces them to do the arithmetic that this string exists to
 * save them.
 */
export function formatDate(epochMs: number): string {
  return new Date(epochMs).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
  });
}
