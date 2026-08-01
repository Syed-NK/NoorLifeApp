import { Image } from 'expo-image';
import { StyleSheet, View, type ImageSourcePropType } from 'react-native';

import { noorLifeAssets, type ModuleAssetKey } from '@shared/assets/noorlife-assets';

import { medallionSpec } from '../entry-auth-tokens';
import { useEntryAuthMetrics } from '../use-entry-auth-metrics';
import { ModuleMedallion } from './module-medallion';

/**
 * One medallion's place on the ring.
 *
 * `angle` is in degrees, clockwise, 0° = right, in screen coordinates (y increasing downward).
 * Both rings below sit on the same eight-position 45° clock, leaving positions free where the
 * robot needs room — which is what the reference does, and what keeps the spacing exactly regular
 * instead of hand-placed.
 */
export type RingPosition = { readonly id: ModuleAssetKey; readonly angle: number };

/**
 * Screen 03 — all seven modules, bottom position left free for the robot's feet.
 *
 * Measured angles from the reference were 269°, 324°, 7°, 45°, 135°, 172° and 215°: within a few
 * degrees of the ideal clock, so the ideal is used.
 */
export const FULL_RING: readonly RingPosition[] = [
  { id: 'faith', angle: 270 },
  { id: 'planner', angle: 315 },
  { id: 'goals', angle: 0 },
  { id: 'family', angle: 45 },
  { id: 'learning', angle: 135 },
  { id: 'finance', angle: 180 },
  { id: 'health', angle: 225 },
];

/**
 * Six modules, omitting Health.
 *
 * ── No longer used by onboarding panel 3 ────────────────────────────────────
 * This matched an early reference that dropped Health to give the robot's head and feet clear
 * space. The approved product requirement is **seven** surrounding modules with Health present, so
 * panel 3 now uses `FULL_RING`. Kept because the geometry is measured and may suit a future screen
 * that genuinely wants a lighter ring; a test asserts onboarding does not use it.
 */
export const SELECTED_RING: readonly RingPosition[] = [
  { id: 'planner', angle: 315 },
  { id: 'goals', angle: 0 },
  { id: 'family', angle: 45 },
  { id: 'learning', angle: 135 },
  { id: 'finance', angle: 180 },
  { id: 'faith', angle: 225 },
];

/**
 * All eight product identities as equals — onboarding panel 2.
 *
 * ── Why Noor AI is a medallion here and the centre is empty ─────────────────
 * Panel 2 is about the whole product, so its eight identities carry equal weight, evenly spaced on
 * one clock. Panel 3 is about the assistant, so it puts the robot at the centre with the modules
 * around it. Same asset set, two different statements — and that difference is what stops the two
 * panels reading as the same picture twice.
 *
 * It is also why this is a ring rather than a grid: a four-column grid of these pictograms is the
 * Main Home module grid, which onboarding must not imitate.
 */
export const ORBIT_RING: readonly RingPosition[] = [
  { id: 'noorAI', angle: 270 },
  { id: 'planner', angle: 315 },
  { id: 'goals', angle: 0 },
  { id: 'family', angle: 45 },
  { id: 'health', angle: 90 },
  { id: 'learning', angle: 135 },
  { id: 'finance', angle: 180 },
  { id: 'faith', angle: 225 },
];

/** Human-readable module names, for the ring's accessibility label. */
const NAMES: Record<ModuleAssetKey, string> = {
  noorAI: 'Noor AI',
  faith: 'Faith',
  planner: 'Planner',
  goals: 'Goals',
  family: 'Family',
  learning: 'Learning',
  finance: 'Finance',
  health: 'Health',
};

export type MedallionRingProps = {
  /** Diameter of the square the ring occupies, in baseline dp. */
  readonly size: number;
  /** Medallion diameter, in baseline dp. */
  readonly medallion?: number;
  /**
   * Centre artwork. Defaults to the Noor AI robot; `null` leaves the centre empty.
   *
   * Empty on panel 2, where Noor AI is one of eight equals on the ring rather than the subject at
   * the middle. Rendering the robot there as well would show it twice in one composition.
   */
  readonly centre?: ImageSourcePropType | null;
  /** Centre artwork height, in baseline dp. */
  readonly centreHeight?: number;
  /** Which medallions sit where. Defaults to all seven. */
  readonly ring?: readonly RingPosition[];
  /**
   * Overlays the approved privacy shield across the centre artwork's lower left, as screen 04's
   * reference shows. Off by default.
   */
  readonly withPrivacyShield?: boolean;
  readonly testID?: string;
};

/**
 * The seven module medallions arranged around Noor AI.
 *
 * Absolute placement from one radius and one angle per medallion, rather than a hand-positioned
 * layout: the ring stays regular at any size, and changing the radius cannot break the spacing.
 *
 * The whole ring is a single accessibility element naming all seven modules. Seven separately
 * focusable decorative images would make a screen reader walk through unlabelled artwork before
 * reaching the controls, which is worse than one accurate summary.
 */
export function MedallionRing({
  size,
  medallion = medallionSpec.diameter,
  centre = noorLifeAssets.entryAuth.noorAiRobot,
  centreHeight = 168,
  ring = FULL_RING,
  withPrivacyShield = false,
  testID,
}: MedallionRingProps) {
  const { dp } = useEntryAuthMetrics();
  const box = dp(size);
  const disc = dp(medallion);
  // The medallion is centred on its ring position, so the radius must leave half a disc inside
  // the box on every side.
  const radius = (box - disc) / 2;

  return (
    <View
      style={[styles.root, { width: box, height: box }]}
      accessible
      accessibilityRole="image"
      accessibilityLabel={`Noor AI surrounded by the ${ring
        .map((r) => NAMES[r.id])
        .join(', ')} modules.`}
      testID={testID}
    >
      {ring.map(({ id, angle }) => {
        const radians = (angle * Math.PI) / 180;
        return (
          <ModuleMedallion
            key={id}
            module={id}
            diameter={medallion}
            style={[
              styles.medallion,
              {
                left: box / 2 + radius * Math.cos(radians) - disc / 2,
                top: box / 2 + radius * Math.sin(radians) - disc / 2,
              },
            ]}
            testID={`${testID ?? 'medallion-ring'}-${id}`}
          />
        );
      })}

      {centre === null ? null : (
        <Image
          source={centre}
          style={{ width: dp(centreHeight) * 0.62, height: dp(centreHeight) }}
          contentFit="contain"
          accessible={false}
          testID={`${testID ?? 'medallion-ring'}-centre`}
        />
      )}

      {/* Positioned against the centre artwork's lower left, as the reference draws it. Absolute so
          it overlaps the robot rather than displacing it — the ring geometry stays untouched. */}
      {withPrivacyShield ? (
        <Image
          source={noorLifeAssets.entryAuth.privacyShield}
          style={{
            position: 'absolute',
            width: dp(centreHeight) * 0.52,
            height: dp(centreHeight) * 0.52,
            left: box / 2 - dp(centreHeight) * 0.5,
            top: box / 2 + dp(centreHeight) * 0.02,
          }}
          contentFit="contain"
          accessible={false}
          testID={`${testID ?? 'medallion-ring'}-shield`}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
  },
  medallion: {
    position: 'absolute',
  },
});
