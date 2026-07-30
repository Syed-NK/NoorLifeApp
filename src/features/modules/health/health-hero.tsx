import { StyleSheet, View } from 'react-native';

import { AppIcon, PressableScale, ProgressRing } from '@ds/components';

import { ModuleHeroArtwork } from '../components/module-hero-artwork';
import { ModuleText } from '../components/module-text';
import { useModule } from '../module-context';
import { moduleLayout, moduleNeutrals } from '../module-tokens';
import { useModuleMetrics } from '../use-module-metrics';
import type { HealthHomeViewModel } from './health-view-model';

export type HealthHeroProps = {
  readonly model: HealthHomeViewModel['wellness'];
  readonly onViewInsights: () => void;
  readonly testID?: string;
};

/**
 * Health's wellness hero, from `04-health.png`.
 *
 * ── What is drawn versus what is missing ────────────────────────────────────
 * The reference's right side has two distinct things, and they are handled differently:
 *
 *   • the circular score ring — a *data graphic*, so it is drawn live with the
 *     design system's `ProgressRing` and reflects `model.score`. It is not artwork and
 *     must not be baked into an image, or the ring would stop matching the number.
 *   • the lake/trees/runner landscape — *artwork*, which does not exist as a standalone
 *     asset. The slot renders `module.heroArtwork`, currently `null`, so nothing appears.
 *     No substitute is invented.
 *
 * `ProgressRing` masks a filled pie with a centre disc, so its `holeColor` has to match
 * whatever sits behind it — here the hero's own fill, not the page. Getting that wrong
 * shows as a mismatched disc rather than a ring.
 */
export function HealthHero({ model, onViewInsights, testID }: HealthHeroProps) {
  const module = useModule();
  const { dp } = useModuleMetrics();

  const ring = dp(moduleLayout.scoreRing);

  return (
    <View
      style={[
        styles.root,
        {
          height: dp(moduleLayout.heroHeight),
          borderRadius: dp(moduleLayout.cardRadius),
          backgroundColor: module.theme.gradientEnd,
        },
      ]}
      testID={testID}
    >
      <ModuleHeroArtwork
        source={module.heroArtwork}
        scrim={module.heroScrim}
        copySide={module.heroCopySide}
        testID={`${testID ?? 'health-hero'}-artwork`}
      />

      <View style={[styles.row, { padding: dp(10), columnGap: dp(8) }]}>
        <View style={styles.textColumn}>
          <ModuleText token="rowMeta" color={module.theme.onFill} numberOfLines={1}>
            {model.eyebrow}
          </ModuleText>
          <ModuleText
            token="cardHeading"
            color={module.theme.onFill}
            numberOfLines={1}
            maxFontSizeMultiplier={1.2}
          >
            {model.title}
          </ModuleText>
          <ModuleText
            token="heroScore"
            color={module.theme.onFill}
            numberOfLines={1}
            maxFontSizeMultiplier={1.1}
            // The score is the screen's headline figure; the ring repeats it visually, so
            // the numeral is what a screen reader announces.
            accessibilityLabel={`${model.title} ${model.score} out of 100`}
          >
            {String(model.score)}
          </ModuleText>
          <ModuleText token="rowMeta" color={module.theme.onFill} numberOfLines={2}>
            {model.encouragement}
          </ModuleText>

          <PressableScale
            onPress={onViewInsights}
            accessibilityRole="button"
            accessibilityLabel={model.actionLabel}
            style={[
              styles.button,
              {
                marginTop: dp(7),
                borderRadius: dp(moduleLayout.radiusSmall),
                paddingHorizontal: dp(9),
                paddingVertical: dp(5),
                columnGap: dp(6),
              },
            ]}
            testID={`${testID ?? 'health-hero'}-action`}
          >
            <AppIcon name="chart-bar" size={dp(15)} color={module.theme.ink} />
            <ModuleText token="cardAction" color={module.theme.ink} numberOfLines={1}>
              {model.actionLabel}
            </ModuleText>
          </PressableScale>
        </View>

        <View style={[styles.ringColumn, { marginRight: dp(44) }]}>
          <ProgressRing
            progress={model.score}
            size={ring}
            thickness={dp(moduleLayout.scoreRingStroke)}
            color={moduleNeutrals.success}
            // The unfilled arc reads as a pale ring on the blue, as the reference shows.
            trackColor="rgba(255, 255, 255, 0.42)"
            // Must match the hero fill behind it, or the ring's centre shows as a disc.
            holeColor={module.theme.gradientEnd}
            accessibilityLabel={`Wellness score ${model.score} out of 100`}
            testID={`${testID ?? 'health-hero'}-ring`}
          />
          {/* The heart-and-pulse mark the reference centres inside the ring. */}
          <View style={styles.ringCentre} pointerEvents="none">
            <AppIcon name="wellness" size={dp(30)} color={module.theme.onFill} />
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  textColumn: {
    flex: 1,
    minWidth: 0,
  },
  ringColumn: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  ringCentre: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: moduleNeutrals.surface,
  },
});
