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
  qiblaGuidance,
  relativeBearing,
  type CompassAccuracy,
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
  const { target, heading, accuracy, hasCompass, probing } = useQibla();
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
            hasCompass={hasCompass}
            probing={probing}
          />
        )}
      </FaithResourceView>
    </View>
  );
}

function QiblaView({
  target,
  heading,
  accuracy,
  hasCompass,
  probing,
}: {
  readonly target: QiblaTarget;
  readonly heading: number | null;
  readonly accuracy: CompassAccuracy;
  readonly hasCompass: boolean;
  readonly probing: boolean;
}) {
  const { dp } = useModuleMetrics();

  const bearing = Math.round(target.bearing);
  const guidance = heading === null ? null : qiblaGuidance(target.bearing, heading);
  const calibration = hasCompass ? calibrationAdvice(accuracy) : null;

  return (
    <View style={{ rowGap: dp(moduleLayout.cardGap) }}>
      {/*
        ── The no-compass state ────────────────────────────────────────────
        An emulator without a virtual magnetometer, and some low-cost handsets, genuinely cannot
        report a heading. The bearing below is still correct and still usable with a separate
        compass, so the screen keeps it and says plainly what is missing — rather than drawing a
        needle that will never move.
      */}
      {hasCompass ? null : (
        <ModuleStatusBanner
          tone="info"
          message="This device has no compass, so NoorLife cannot show which way you are facing. The bearing below is measured from true north."
          testID="faith-qibla-no-compass"
        />
      )}

      {calibration === null ? null : (
        <ModuleStatusBanner tone="warning" message={calibration} testID="faith-qibla-calibration" />
      )}

      <ModuleCard testID="faith-qibla-dial">
        <View style={{ alignItems: 'center', rowGap: dp(12) }}>
          <QiblaDial
            bearing={target.bearing}
            heading={heading}
            aligned={guidance?.kind === 'aligned'}
          />

          {/*
            The instruction, and the one thing on this screen a user acts on. It is a live region so
            a screen-reader user hears "turn left 24 degrees" become "facing the Qibla" without
            re-focusing anything.
          */}
          <View accessible accessibilityLiveRegion="polite" testID="faith-qibla-guidance">
            <ModuleText token="cardTitle" align="center" numberOfLines={2}>
              {guidance === null
                ? probing
                  ? 'Finding your heading…'
                  : 'Heading unavailable'
                : guidanceLabel(guidance)}
            </ModuleText>
          </View>

          <ModuleText token="caption" align="center" numberOfLines={2}>
            {`${bearing}° from true north • ${Math.round(target.distanceKm).toLocaleString()} km to Makkah`}
          </ModuleText>
          <ModuleText token="caption" align="center" numberOfLines={2}>
            {target.location.manual
              ? `Calculated for ${target.location.label}, which you chose`
              : `Calculated for ${target.location.label}`}
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
  aligned,
}: {
  readonly bearing: number;
  readonly heading: number | null;
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
  const raw = heading === null ? bearing : relativeBearing(bearing, heading);
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
