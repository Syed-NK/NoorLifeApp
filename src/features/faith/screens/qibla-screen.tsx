import { StyleSheet, View } from 'react-native';

import { AppIcon } from '@ds/components';
import { ModuleStatusBanner, ModuleText } from '@features/modules/components';
import { ModuleCard } from '@features/modules/components/module-card';
import { useModuleTheme } from '@features/modules/module-context';
import { moduleLayout, moduleNeutrals } from '@features/modules/module-tokens';
import { useModuleMetrics } from '@features/modules/use-module-metrics';
import { useReducedMotion } from '@shared/utils/a11y';

import { FaithSectionHero } from '../components/faith-section-hero';
import { FaithResourceView, FaithScreen } from '../components/faith-screen';
import {
  calibrationAdvice,
  guidanceLabel,
  locationAuthorityLabel,
  qiblaGuidance,
  relativeBearing,
  type CompassAccuracy,
  type QiblaMode,
} from '../data/qibla/qibla';
import { faithHeroImages } from '../faith-hero-images';
import { faithNavKeys } from '../faith-routes';
import { permissionAdvice, useLocationPermission } from '../hooks/use-location-permission';
import { useQibla, type QiblaTarget } from '../hooks/use-qibla';

/**
 * Qibla.
 *
 * ── What changed, and why it needed to ──────────────────────────────────────
 * This screen used to show a bearing and a static arrow, with a banner explaining that it was "not a
 * live compass" and asking the user to align it with a separate app. That was honest, and it was
 * not the feature — the arrow rotated by the Qibla bearing alone, so it pointed the same way whether
 * you were facing Mecca or away from it.
 *
 * It now reads the device's heading and rotates the marker by `qibla − heading`, so the marker points
 * at the Kaaba in the room the user is standing in. The states below are all the ways that can fail,
 * and each says what the user can do about it rather than hiding the dial.
 *
 * ── True north, and nothing else ────────────────────────────────────────────
 * The bearing is measured from true north, so the heading must be too. `expo-location` supplies a
 * declination-corrected `trueHeading` and reports its absence; magnetic north is never substituted,
 * because the two differ by up to ~20° in populated parts of the world.
 */
export function QiblaScreen() {
  return (
    <FaithScreen title="Qibla" activeKey={faithNavKeys.more} testID="faith-qibla">
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
    <View style={{ rowGap: dp(moduleLayout.sectionGap) }}>
      {/*
        ── "Find Qibla" was built, measured, and removed for the same reason as Qur'an's ──
        It raised the real location prompt, so it was functional. It also covered the second line of the
        baked subtitle — "from where you are." — because the 2.507 crop puts the baked copy lower in the
        card than the cleared band allows for.

        Nothing is lost: `FaithResourceView` below already offers the grant affordance on the permission
        path, which is the only state in which acquiring a fix is the useful next step.
      */}
      <FaithSectionHero
        submenu="qibla"
        heroImage={faithHeroImages.qibla}
        summary="The direction of prayer from where you are."
      />

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

/** What the bearing-only state says, and why it is in that state. One wording per reason. */
function bearingOnlyMessage(
  reason: Extract<QiblaMode, { kind: 'bearing-only' }>['reason'],
): string {
  switch (reason) {
    case 'no-compass':
      return 'This device has no compass, so NoorLife cannot show which way you are facing. The bearing below is measured from true north — use it with a separate compass.';
    case 'unusable-accuracy':
      return 'The compass is not reporting a heading NoorLife can trust, so the dial is showing the bearing rather than tracking your phone. The bearing itself is unaffected.';
    case 'no-heading':
      return 'No compass heading has arrived, so the dial is showing the bearing from north rather than tracking your phone.';
  }
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
  const { dp } = useModuleMetrics();

  const bearing = Math.round(target.bearing);
  /*
    ── Guidance belongs to `live` alone ──────────────────────────────────────
    "Turn left 24°" is an instruction about the room, and it is only meaningful when a heading is
    being tracked. Deriving it from a heading the mode has already judged untrustworthy is how a
    screen tells somebody to turn based on a reading the platform disowned.
  */
  const guidance =
    mode.kind === 'live' && heading !== null ? qiblaGuidance(target.bearing, heading) : null;
  /*
    Calibration advice is for a compass that is working but imprecise. When accuracy is unusable the
    mode has already dropped to bearing-only and says so in full, so a second banner would be the
    same news twice.
  */
  const calibration = mode.kind === 'live' ? calibrationAdvice(accuracy) : null;

  return (
    <View style={{ rowGap: dp(moduleLayout.cardGap) }}>
      {/*
        ── One banner, naming the actual reason ────────────────────────────
        This replaced a `hasCompass` banner that could only describe one of the three ways a heading
        goes missing. A device with a compass reporting garbage got no explanation at all, and the
        dial stayed live on readings the platform had disowned.
      */}
      {mode.kind === 'bearing-only' ? (
        <ModuleStatusBanner
          tone={mode.reason === 'no-compass' ? 'info' : 'warning'}
          message={bearingOnlyMessage(mode.reason)}
          testID="faith-qibla-bearing-only"
        />
      ) : null}

      {calibration === null ? null : (
        <ModuleStatusBanner tone="warning" message={calibration} testID="faith-qibla-calibration" />
      )}

      <ModuleCard testID="faith-qibla-dial">
        <View style={{ alignItems: 'center', rowGap: dp(12) }}>
          {/*
            The mode, stated on the dial itself rather than only in a banner above it. A user who
            scrolls past the banner still has to be able to tell a compass from a diagram, and this
            is the label that survives a screenshot.
          */}
          <ModuleText
            token="caption"
            align="center"
            color={moduleNeutrals.textSecondary}
            testID="faith-qibla-mode"
          >
            {mode.kind === 'live'
              ? 'Live compass'
              : 'Bearing only — dial does not track your phone'}
          </ModuleText>

          <QiblaDial
            bearing={target.bearing}
            heading={heading}
            live={mode.kind === 'live'}
            aligned={guidance?.kind === 'aligned'}
          />

          {/*
            The instruction, and the one thing on this screen a user acts on. It is a live region so
            a screen-reader user hears "turn left 24 degrees" become "facing the Qibla" without
            re-focusing anything.
          */}
          <View accessible accessibilityLiveRegion="polite" testID="faith-qibla-guidance">
            {/*
              ── "Finding your heading…" is only true while it is still being looked for ──
              On the emulator this line read "Finding your heading…" underneath a banner that had
              already concluded the compass could not be trusted — two statements about the same
              sensor, one of them stale, and the optimistic one on top. `probing` alone was the wrong
              condition: it stays true until a *reading* arrives, which never happens on a device
              whose compass has been ruled out.

              Waiting is now only claimed for the one reason that is genuinely transient — no reading
              yet, from a compass that exists and is trusted. `no-compass` and `unusable-accuracy` are
              settled answers, so they state the bearing instead.
            */}
            <ModuleText token="cardTitle" align="center" numberOfLines={2}>
              {guidance === null
                ? probing && mode.kind === 'bearing-only' && mode.reason === 'no-heading'
                  ? 'Finding your heading…'
                  : `Qibla is ${bearing}° from true north`
                : guidanceLabel(guidance)}
            </ModuleText>
          </View>

          <ModuleText token="caption" align="center" numberOfLines={2}>
            {`${bearing}° from true north • ${Math.round(target.distanceKm).toLocaleString()} km to Makkah`}
          </ModuleText>
          {/*
            ── Where the bearing was calculated *from* ─────────────────────
            The place and the authority behind it, because they answer different questions. "Dubai"
            says where; "Selected city" says NoorLife did not measure it — which is what a user needs
            to know before trusting an arrow while standing somewhere else. The label is the stored
            one and is never invented; `locationAuthorityLabel` is total over the three V3 modes.
          */}
          <ModuleText token="caption" align="center" numberOfLines={2} testID="faith-qibla-source">
            {`Calculated for ${target.location.label} • ${locationAuthorityLabel(target.location.mode)}`}
          </ModuleText>
        </View>
      </ModuleCard>
    </View>
  );
}

/**
 * The dial: a fixed compass rose, and a marker that rotates to point at the Kaaba.
 *
 * ── What rotates, and why it is the marker rather than the rose ─────────────
 * Rotating the *rose* by `−heading` and leaving the marker at the Qibla bearing is the other common
 * design, and it is the one that makes people motion-sick: the whole dial swings as the phone
 * trembles. Here the rose is still and only the marker moves, by `qibla − heading`, so the marker
 * points at the Kaaba relative to the top of the phone. Less visually impressive, easier to follow.
 *
 * ── Reduced motion ─────────────────────────────────────────────────────────
 * There is no animation to disable — the marker is rendered at whatever angle the latest reading
 * gives, so it moves exactly as fast as the sensor does. What `reduceMotion` changes is the
 * *rounding*: at 5° steps the marker stops trembling in the user's peripheral vision while still
 * being accurate to well inside the alignment window.
 */
function QiblaDial({
  bearing,
  heading,
  live,
  aligned,
}: {
  readonly bearing: number;
  readonly heading: number | null;
  /** True only when a trusted heading is tracking. Decides what the dial *is*. */
  readonly live: boolean;
  readonly aligned: boolean;
}) {
  const theme = useModuleTheme();
  const { dp } = useModuleMetrics();
  const reduceMotion = useReducedMotion();

  const size = dp(220);
  /**
   * The marker's angle.
   *
   * With no heading it points at the Qibla bearing from *north* and the caption says the heading is
   * unavailable — which is the same information the old screen gave, presented as the fallback it is
   * rather than as the feature.
   */
  const raw = live && heading !== null ? relativeBearing(bearing, heading) : bearing;
  const angle = reduceMotion ? Math.round(raw / 5) * 5 : Math.round(raw);

  return (
    <View
      style={[
        styles.dial,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          borderColor: aligned ? theme.ink : theme.border,
          borderWidth: aligned ? dp(3) : dp(2),
          backgroundColor: theme.lightSurface,
        },
      ]}
      accessible
      accessibilityLabel={
        heading === null
          ? `Qibla bearing ${Math.round(bearing)} degrees from true north. Device heading unavailable.`
          : `Qibla is ${Math.abs(angle)} degrees ${angle >= 0 ? 'clockwise' : 'anticlockwise'} from where the phone is pointing.`
      }
      testID="faith-qibla-dial-face"
    >
      {/* North, fixed at the top of the rose so the marker's angle is readable against it. */}
      <View style={[styles.north, { top: dp(8) }]}>
        <ModuleText token="caption" color={moduleNeutrals.textSecondary} numberOfLines={1}>
          N
        </ModuleText>
      </View>

      <View style={{ transform: [{ rotate: `${angle}deg` }] }} testID="faith-qibla-marker">
        <AppIcon
          name="qibla"
          size={dp(84)}
          color={aligned ? theme.ink : moduleNeutrals.textSecondary}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  dial: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  north: {
    position: 'absolute',
    alignSelf: 'center',
  },
});
