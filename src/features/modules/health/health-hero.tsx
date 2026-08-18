import { StyleSheet, View } from 'react-native';

import { AppIcon, PressableScale, ProgressRing } from '@ds/components';

import { ModuleHeroArtwork } from '../components/module-hero-artwork';
import { ModuleText } from '../components/module-text';
import { useModule } from '../module-context';
import { moduleLayout, moduleNeutrals } from '../module-tokens';
import { useModuleMetrics } from '../use-module-metrics';

export type HealthHeroProps = {
  /** 0–100. Drives the numeral and the ring from one value. */
  readonly score: number;
  readonly onViewInsights: () => void;
  readonly testID?: string;
};

/**
 * Health's wellness hero: locked landscape behind, live score in front.
 *
 * ── What is drawn and what is artwork ───────────────────────────────────────
 * The lake, trees and runner are the locked PNG. The score ring is a *data graphic* drawn with
 * the design system's `ProgressRing` from the same `score` the numeral shows, so the two can
 * never disagree — and "86" is never baked into an image.
 *
 * The ring sits inboard of the right edge rather than against it, because the runner occupies
 * the artwork's far right and the brief requires the runner stay visible. `holeColor` matches
 * the hero fill; get that wrong and the ring renders as a filled disc.
 *
 * Copy comes from the registry's approved hero fields, in the reference's order: eyebrow,
 * "Wellness Score", the figure, then the encouragement.
 */
export function HealthHero({ score, onViewInsights, testID }: HealthHeroProps) {
  const module = useModule();
  const { dp } = useModuleMetrics();
  const hero = module.hero;

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

      <View style={[styles.row, { padding: dp(moduleLayout.heroCopyPaddingV) }]}>
        <View style={[styles.textColumn, { rowGap: dp(1) }]}>
          <ModuleText token="rowMeta" color={module.theme.onFill} numberOfLines={1}>
            {hero.eyebrow}
          </ModuleText>
          <ModuleText
            token="cardHeading"
            color={module.theme.onFill}
            numberOfLines={1}
            maxFontSizeMultiplier={1.2}
          >
            {hero.support}
          </ModuleText>
          <ModuleText
            token="heroScore"
            color={module.theme.onFill}
            numberOfLines={1}
            maxFontSizeMultiplier={1.1}
            // The ring repeats this visually, so the numeral is what a reader announces.
            accessibilityLabel={`${hero.support ?? 'Score'} ${score} out of 100`}
          >
            {String(score)}
          </ModuleText>
          <ModuleText token="rowMeta" color={module.theme.onFill} numberOfLines={2}>
            {hero.supportSecondary}
          </ModuleText>

          <PressableScale
            onPress={onViewInsights}
            accessibilityRole="button"
            accessibilityLabel={hero.actionLabel}
            style={[
              styles.button,
              {
                marginTop: dp(6),
                minHeight: dp(moduleLayout.heroButtonHeight),
                borderRadius: dp(moduleLayout.radiusSmall),
                paddingHorizontal: dp(10),
                columnGap: dp(5),
              },
            ]}
            testID={`${testID ?? 'health-hero'}-action`}
          >
            <AppIcon name="chart-bar" size={dp(13)} color={module.theme.ink} />
            <ModuleText token="cardAction" color={module.theme.ink} numberOfLines={1}>
              {hero.actionLabel}
            </ModuleText>
          </PressableScale>
        </View>

        {/* Inboard of the right edge so the artwork's runner stays visible. */}
        <View style={[styles.ringColumn, { marginRight: dp(moduleLayout.healthRingInset) }]}>
          <ProgressRing
            progress={score}
            size={dp(moduleLayout.scoreRing)}
            thickness={dp(moduleLayout.scoreRingStroke)}
            color={moduleNeutrals.success}
            trackColor="rgba(255, 255, 255, 0.42)"
            holeColor={module.theme.gradientEnd}
            accessibilityLabel={`Wellness score ${score} out of 100`}
            testID={`${testID ?? 'health-hero'}-ring`}
          />
          <View style={styles.ringCentre} pointerEvents="none">
            <AppIcon name="wellness" size={dp(26)} color={module.theme.onFill} />
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
