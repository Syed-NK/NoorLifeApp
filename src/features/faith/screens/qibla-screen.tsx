import { StyleSheet, View } from 'react-native';

import { AppIcon } from '@ds/components';
import { modulePalettes } from '@ds/tokens';
import { ModuleStatusBanner, ModuleText } from '@features/modules/components';
import {
  moduleLayout,
  moduleNeutrals,
  readerDockColors,
  readerPageBackground,
} from '@features/modules/module-tokens';
import { useModuleMetrics } from '@features/modules/use-module-metrics';
import type { IconName } from '@shared/models/icon';
import { minimumHitSlop, useReducedMotion, minimumTouchTargetSize } from '@shared/utils/a11y';

import { QiblaBearingDial, QiblaLiveDial } from '../components/qibla-compass';
import { FaithResourceView, FaithScreen } from '../components/faith-screen';
import {
  calibrationAdvice,
  locationAuthorityLabel,
  qiblaGuidance,
  relativeBearing,
  type CompassAccuracy,
  type QiblaGuidance,
  type QiblaMode,
} from '../data/qibla/qibla';
import { faithNavKeys } from '../faith-routes';
import { permissionAdvice, useLocationPermission } from '../hooks/use-location-permission';
import { useQibla, type QiblaTarget } from '../hooks/use-qibla';

/**
 * Qibla — one screen, one route, two truthful runtime states.
 *
 * ── The distinction the whole screen is built around ────────────────────────
 * In **live** the dial is an instrument: the marker points at the Kaaba *in the room*, and turning
 * the phone moves it. In **bearing-only** there is no trustworthy heading at all, so the dial is a
 * north-up diagram with the Qibla drawn on it — exactly as useful as a printed bearing and no more.
 *
 * Drawing the second as though it were the first is the failure this screen exists to prevent. A
 * marker sitting still while the phone turns, with nothing on screen saying why, reads as a broken
 * compass rather than as a correct bearing — so bearing-only never shows a turn instruction, an
 * alignment claim, a compass-accuracy grade or a "using device sensors" line, and it says which of
 * the three ways the heading went missing applies.
 *
 * ── Shared geometry ────────────────────────────────────────────────────────
 * Both states place the dial at the same diameter in the same position, and both end in the same
 * location and distance rows, so a mode change while the user is looking at it does not move the
 * furniture under their eyes.
 *
 * ── True north, and nothing else ────────────────────────────────────────────
 * The bearing is measured from true north, so the heading must be too. `expo-location` supplies a
 * declination-corrected `trueHeading` and reports its absence; magnetic north is never substituted,
 * because the two differ by up to ~20° in populated parts of the world.
 */

const EMERALD = modulePalettes.faith.primary;
const EMERALD_DEEP = modulePalettes.faith.dark;
const GOLD = modulePalettes.faith.supporting;

export function QiblaScreen() {
  return (
    <FaithScreen
      title="Qibla"
      activeKey={faithNavKeys.more}
      background={readerPageBackground}
      testID="faith-qibla"
    >
      <QiblaBody />
    </FaithScreen>
  );
}

/** Split out so it renders inside the scaffold's `ModuleProvider`. */
function QiblaBody() {
  const { dp } = useModuleMetrics();
  const { target, heading, accuracy, mode, probing } = useQibla();
  const permission = useLocationPermission(target.reload);
  const advice = permissionAdvice(permission.outcome);

  return (
    <View style={{ rowGap: dp(moduleLayout.cardGap) }}>
      {advice === null ? null : (
        <ModuleStatusBanner
          tone="warning"
          message={advice}
          testID="faith-qibla-permission-advice"
        />
      )}

      <FaithResourceView
        resource={target}
        empty={{ title: 'No bearing', body: 'The Qibla direction could not be calculated.' }}
        loadingRows={2}
        onGrantPermission={() => void permission.request()}
        testID="faith-qibla-body"
      >
        {(value) => (
          <QiblaView
            target={value}
            heading={heading}
            accuracy={accuracy}
            mode={mode}
            probing={probing}
          />
        )}
      </FaithResourceView>
    </View>
  );
}

/**
 * Why the dial is not tracking, in one sentence per reason.
 *
 * Kept exhaustive over the union so a fourth reason is a compile error here rather than a screen
 * that silently explains nothing.
 */
function bearingOnlyReason(reason: Extract<QiblaMode, { kind: 'bearing-only' }>['reason']): string {
  switch (reason) {
    case 'no-compass':
      return 'This device has no compass sensor.';
    case 'unusable-accuracy':
      return 'The compass is not reporting a heading NoorLife can trust.';
    case 'no-heading':
      return 'No compass heading has arrived yet.';
  }
}

/**
 * Whether saying the live dial may return is honest.
 *
 * A device with no magnetometer will never produce a heading, so telling its owner that NoorLife is
 * waiting for one is a promise that can never be kept — they would hold the phone up waiting for a
 * switch that is not coming. The other two reasons are genuinely transient, and there the statement
 * is true.
 */
function isRecoverable(reason: Extract<QiblaMode, { kind: 'bearing-only' }>['reason']): boolean {
  return reason !== 'no-compass';
}

function QiblaView({
  target,
  heading,
  accuracy,
  mode,
  probing,
}: {
  readonly target: QiblaTarget;
  readonly heading: number | null;
  readonly accuracy: CompassAccuracy;
  readonly mode: QiblaMode;
  readonly probing: boolean;
}) {
  const { dp, screenWidth } = useModuleMetrics();
  const reduceMotion = useReducedMotion();

  const bearing = Math.round(target.bearing);
  const distance = `${Math.round(target.distanceKm).toLocaleString()} km`;

  /*
    ── Guidance belongs to `live` alone ──────────────────────────────────────
    "Turn left 24°" is an instruction about the room, and it is only meaningful while a heading is
    being tracked. Deriving it from a heading the mode has already judged untrustworthy is how a
    screen tells somebody to turn based on a reading the platform disowned.
  */
  const guidance =
    mode.kind === 'live' && heading !== null ? qiblaGuidance(target.bearing, heading) : null;

  /*
    ── The dial's diameter, and why the cap is 276 and not a round 300 ────────
    It is the dominant element, so it takes the content column less its margins. The ceiling is what
    makes the bearing-only state fit above the bottom navigation at the reference 411 dp: measured on
    device at 300 dp, the recovery row ended at 841 dp against a navigation edge at ~820 and was
    clipped mid-word. 276 dp buys back the difference and leaves the compass more than three times
    the height of anything else on the screen, which is what "dominant" has to mean here.
  */
  const dial = Math.max(dp(200), Math.min(dp(276), screenWidth - dp(72)));

  const locationRow = (
    <InfoRow
      icon="location"
      title={target.location.label}
      subtitle={locationAuthorityLabel(target.location.mode)}
      testID="faith-qibla-source"
    />
  );
  const distanceRow = (
    <InfoRow icon="mosque" title={distance} subtitle="to Makkah" testID="faith-qibla-distance" />
  );

  if (mode.kind === 'live') {
    /*
      The marker's angle. `relativeBearing` is the shortest signed turn from where the phone points
      to the Qibla, so the marker sits at the Kaaba's position relative to the top of the phone.

      Reduced motion does not disable an animation here — there is none; the marker is drawn at
      whatever the latest reading gives, so it moves exactly as fast as the sensor. What it changes
      is the *rounding*: at 5° steps the marker stops trembling in peripheral vision while staying
      accurate to well inside the alignment window.
    */
    const raw = heading === null ? target.bearing : relativeBearing(target.bearing, heading);
    const markerAngle = reduceMotion ? Math.round(raw / 5) * 5 : Math.round(raw);
    const calibration = calibrationAdvice(accuracy);

    return (
      <View style={{ rowGap: dp(12) }} testID="faith-qibla-live">
        <BearingHeadline bearing={bearing} />

        <View style={styles.centre}>
          <QiblaLiveDial
            size={dial}
            markerAngle={markerAngle}
            aligned={guidance?.kind === 'aligned'}
            testID="faith-qibla-dial"
          />
        </View>

        <GuidanceCard guidance={guidance} probing={probing} />

        <AccuracyRow accuracy={accuracy} />

        {/*
          Calibration is offered only when it would help: a compass that is working but imprecise.
          At `good` there is nothing to fix, and at `unusable` the mode has already dropped to
          bearing-only — so this control never appears as busywork on a dial that is already fine or
          already disowned.
        */}
        {calibration === null ? null : (
          <InfoRow
            icon="calibrate"
            title="Calibrate compass"
            subtitle={calibration}
            testID="faith-qibla-calibrate"
          />
        )}

        <View style={[styles.sensorLine, { columnGap: dp(6) }]}>
          <View
            style={{
              width: dp(7),
              height: dp(7),
              borderRadius: dp(4),
              backgroundColor: EMERALD,
            }}
          />
          <ModuleText token="caption" color={EMERALD} testID="faith-qibla-sensors">
            Using device sensors
          </ModuleText>
        </View>

        {locationRow}
        {distanceRow}
      </View>
    );
  }

  return (
    <View style={{ rowGap: dp(12) }} testID="faith-qibla-bearing-only">
      {/*
        The banner is the first thing on the screen for the same reason the mode exists: a user has
        to know the dial below is a diagram *before* they start turning with the phone held up.
      */}
      <BearingOnlyBanner reason={bearingOnlyReason(mode.reason)} />

      <View style={styles.centre}>
        <QiblaBearingDial size={dial} bearing={target.bearing} testID="faith-qibla-dial" />
      </View>

      <View style={styles.centre} accessible testID="faith-qibla-bearing-readout">
        <ModuleText token="body" align="center">
          Qibla is
        </ModuleText>
        <ModuleText
          token="heroScore"
          align="center"
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.6}
          style={{ fontSize: dp(46), lineHeight: dp(54) }}
        >
          {`${bearing}°`}
        </ModuleText>
        <ModuleText token="caption" align="center">
          from true north
        </ModuleText>
      </View>

      {locationRow}
      {distanceRow}

      {/*
        Whether the live dial can still come back, stated only when it can. See `isRecoverable`: on a
        device with no magnetometer there is nothing to wait for, so saying so would be false hope.

        ── Why this is worded as a status and not as "Try live compass" ──────────
        It was worded that way, and it was an imperative with nothing behind it: the row is an
        `InfoRow`, it has no `onPress`, and the mode switches on its own the moment a trustworthy
        heading arrives. A user reading a command taps it, nothing happens, and the screen has taught
        them the app is broken at precisely the point it is being most careful. The recovery is
        automatic, so the row reports that it is waiting rather than asking for an action that does
        not exist.
      */}
      {isRecoverable(mode.reason) ? (
        <InfoRow
          icon="qibla"
          title="Waiting for a reliable heading"
          subtitle="The dial switches to live tracking on its own if one arrives"
          accent
          testID="faith-qibla-recovery"
        />
      ) : null}
    </View>
  );
}

/**
 * The bearing-only banner.
 *
 * ── Why this is not the shared status banner ────────────────────────────────
 * `ModuleStatusBanner` renders one run of prose, and this has to say three things with different
 * weights: *what mode you are in*, *what that means for the dial below*, and *why*. Flattened into a
 * sentence the middle one — the dial does not track your phone — stopped being the thing the eye
 * lands on, which is the one fact a user has to take away before they lift the phone and turn.
 *
 * It is a statement, not a control: there is nothing to press, so it is one accessible node with the
 * whole message rather than three a screen reader has to walk.
 */
function BearingOnlyBanner({ reason }: { readonly reason: string }) {
  const { dp } = useModuleMetrics();

  return (
    <View
      style={[
        styles.banner,
        {
          borderRadius: dp(moduleLayout.radiusSmall),
          padding: dp(12),
          columnGap: dp(12),
        },
      ]}
      accessible
      accessibilityLabel={`Bearing only. Dial does not track your phone. ${reason}`}
      testID="faith-qibla-bearing-only-banner"
    >
      <View
        style={{
          width: dp(32),
          height: dp(32),
          borderRadius: dp(16),
          borderWidth: 1.5,
          borderColor: GOLD,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <AppIcon name="info" size={dp(18)} color={GOLD} />
      </View>
      <View style={styles.flex}>
        <ModuleText token="cardTitle" color={moduleNeutrals.textPrimary} numberOfLines={1}>
          Bearing only
        </ModuleText>
        <ModuleText token="caption" numberOfLines={2}>
          Dial does not track your phone
        </ModuleText>
        {/* The specific reason, so the user can tell a missing sensor from a momentary one. */}
        <ModuleText token="caption" numberOfLines={3} testID="faith-qibla-bearing-only-reason">
          {reason}
        </ModuleText>
      </View>
    </View>
  );
}

/** `{bearing}° Qibla direction`, the live state's opening line. */
function BearingHeadline({ bearing }: { readonly bearing: number }) {
  const { dp } = useModuleMetrics();

  return (
    <View style={[styles.headline, { columnGap: dp(6) }]} testID="faith-qibla-headline">
      <ModuleText
        token="heroScore"
        color={EMERALD}
        numberOfLines={1}
        style={{ fontSize: dp(30), lineHeight: dp(38) }}
      >
        {`${bearing}°`}
      </ModuleText>
      <ModuleText token="cardTitle" numberOfLines={1}>
        Qibla direction
      </ModuleText>
    </View>
  );
}

/**
 * The instruction, and the one thing on this screen a user acts on.
 *
 * A live region, so a screen-reader user hears "turn left 24 degrees" become "you are facing the
 * Qibla" without re-focusing anything.
 */
function GuidanceCard({
  guidance,
  probing,
}: {
  readonly guidance: QiblaGuidance | null;
  readonly probing: boolean;
}) {
  const { dp } = useModuleMetrics();
  const aligned = guidance?.kind === 'aligned';

  const heading = (() => {
    if (guidance === null) {
      return probing ? 'Finding your heading…' : 'Heading unavailable';
    }
    if (guidance.kind === 'aligned') {
      return 'You are facing the Qibla';
    }
    /*
      ── The degrees are always stated, including inside the "almost" window ──
      The model still marks a turn under 20° as `close`, and `guidanceLabel` renders that as "Almost
      — turn slightly right". That reads well and it drops the one number the user is acting on: at
      18° they were told to turn "slightly" with no idea whether that meant two degrees or nineteen.
      The approved design shows the figure at every distance, so the figure is shown at every
      distance; `close` survives as emphasis below rather than as a replacement for it.
    */
    return `Turn ${guidance.direction} ${guidance.degrees}°`;
  })();

  return (
    <View
      style={[
        styles.guidance,
        {
          borderRadius: dp(moduleLayout.cardRadius),
          padding: dp(14),
          columnGap: dp(14),
          backgroundColor: EMERALD_DEEP,
          borderColor: aligned ? GOLD : 'transparent',
          borderWidth: aligned ? dp(1.5) : 0,
        },
      ]}
      accessible
      accessibilityLiveRegion="polite"
      testID="faith-qibla-guidance"
    >
      <View
        style={[
          styles.guidanceGlyph,
          {
            width: dp(46),
            height: dp(46),
            borderRadius: dp(23),
            borderColor: `${GOLD}66`,
          },
        ]}
      >
        <AppIcon
          name={aligned ? 'check' : 'turn-left'}
          size={dp(22)}
          color={GOLD}
          /*
            The glyph is a left turn; a right turn is the same arrow mirrored. One asset, and the two
            can never drift apart into arrows that disagree about which way is which.
          */
          style={
            guidance?.kind === 'turn' && guidance.direction === 'right'
              ? { transform: [{ scaleX: -1 }] }
              : undefined
          }
        />
      </View>

      <View style={styles.flex}>
        <ModuleText
          token="cardTitle"
          color={moduleNeutrals.surface}
          numberOfLines={2}
          testID="faith-qibla-guidance-text"
        >
          {heading}
        </ModuleText>
        <ModuleText token="caption" color={`${moduleNeutrals.surface}CC`} numberOfLines={2}>
          Align your phone with the Qibla direction
        </ModuleText>
      </View>
    </View>
  );
}

/** Compass accuracy, as a grade with a signal glyph — live only. */
function AccuracyRow({ accuracy }: { readonly accuracy: CompassAccuracy }) {
  const { dp } = useModuleMetrics();
  const grade = accuracy === 'good' ? 'High' : 'Low';
  const tint = accuracy === 'good' ? EMERALD : moduleNeutrals.warning;

  return (
    <View
      style={[
        styles.row,
        {
          borderRadius: dp(moduleLayout.radiusSmall),
          minHeight: minimumTouchTargetSize(),
          paddingHorizontal: dp(12),
          paddingVertical: dp(10),
          columnGap: dp(12),
        },
      ]}
      accessible
      accessibilityLabel={`Compass accuracy ${grade}`}
      testID="faith-qibla-accuracy"
    >
      <RowGlyph icon="target" />
      <ModuleText
        token="body"
        color={moduleNeutrals.textPrimary}
        numberOfLines={1}
        style={styles.flex}
      >
        Compass accuracy
      </ModuleText>
      <ModuleText token="button" color={tint} numberOfLines={1}>
        {grade}
      </ModuleText>
      <AppIcon name="signal" size={dp(18)} color={tint} />
    </View>
  );
}

function RowGlyph({
  icon,
  accent = false,
}: {
  readonly icon: IconName;
  readonly accent?: boolean;
}) {
  const { dp } = useModuleMetrics();
  const size = dp(36);

  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: accent ? EMERALD_DEEP : `${EMERALD}1A`,
      }}
    >
      <AppIcon name={icon} size={dp(18)} color={accent ? GOLD : EMERALD} />
    </View>
  );
}

/** The repeated title/subtitle row the approved design ends both states with. */
function InfoRow({
  icon,
  title,
  subtitle,
  accent = false,
  testID,
}: {
  readonly icon: IconName;
  readonly title: string;
  readonly subtitle: string;
  readonly accent?: boolean;
  readonly testID: string;
}) {
  const { dp } = useModuleMetrics();

  return (
    <View
      style={[
        styles.row,
        {
          borderRadius: dp(moduleLayout.radiusSmall),
          minHeight: minimumTouchTargetSize(),
          paddingHorizontal: dp(12),
          paddingVertical: dp(10),
          columnGap: dp(12),
        },
      ]}
      accessible
      accessibilityLabel={`${title}. ${subtitle}`}
      hitSlop={minimumHitSlop(minimumTouchTargetSize())}
      testID={testID}
    >
      <RowGlyph icon={icon} accent={accent} />
      <View style={styles.flex}>
        <ModuleText token="body" color={moduleNeutrals.textPrimary} numberOfLines={2}>
          {title}
        </ModuleText>
        <ModuleText token="caption" numberOfLines={2}>
          {subtitle}
        </ModuleText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  centre: {
    alignItems: 'center',
  },
  flex: {
    flex: 1,
    minWidth: 0,
  },
  headline: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'center',
  },
  guidance: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  guidanceGlyph: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: moduleNeutrals.surface,
    borderWidth: 1,
    borderColor: moduleNeutrals.border,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    // The mock's warm cream notice, from the reader's own gold panel rather than a new hue.
    backgroundColor: readerDockColors.surface,
    borderWidth: 1,
    borderColor: readerDockColors.border,
  },
  sensorLine: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
