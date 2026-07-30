import { StyleSheet, View } from 'react-native';

import { ModuleHeroArtwork } from '../components/module-hero-artwork';
import { ModuleText } from '../components/module-text';
import { useModule } from '../module-context';
import { moduleLayout } from '../module-tokens';
import { useModuleMetrics } from '../use-module-metrics';

export type NoorAIHeroProps = {
  readonly testID?: string;
};

/**
 * Noor AI's hero — the one hero with its copy on the right.
 *
 * `02-noor-ai-hero.png` puts the waving robot on the left and leaves the right as clear indigo
 * with a few stars, so the copy goes right and the robot stays fully visible. Every other
 * locked hero is the other way round, which is why `heroCopySide` is per module rather than a
 * constant.
 *
 * The headline is two deliberate lines — "How can I help" / "with NoorLife?" — as the reference
 * sets it, carried as one string with a newline so the break cannot drift with the font metrics.
 * The pill beneath states the boundary the AI policy enforces: NoorLife questions only.
 */
export function NoorAIHero({ testID }: NoorAIHeroProps) {
  const module = useModule();
  const { dp, contentWidth } = useModuleMetrics();
  const hero = module.hero;

  return (
    <View
      style={[
        styles.root,
        {
          height: dp(moduleLayout.heroHeight),
          borderRadius: dp(moduleLayout.cardRadius),
          backgroundColor: module.theme.gradientStart,
        },
      ]}
      testID={testID}
    >
      <ModuleHeroArtwork
        source={module.heroArtwork}
        scrim={module.heroScrim}
        copySide={module.heroCopySide}
        testID={`${testID ?? 'noor-ai-hero'}-artwork`}
      />

      <View
        style={[
          styles.copy,
          {
            width: contentWidth * moduleLayout.heroTextColumnRatio,
            paddingRight: dp(moduleLayout.heroPadding),
            paddingVertical: dp(moduleLayout.heroCopyPaddingV),
            rowGap: dp(8),
          },
        ]}
      >
        <ModuleText
          token="heroTitle"
          color={module.theme.onFill}
          align="right"
          numberOfLines={2}
          maxFontSizeMultiplier={1.15}
        >
          {hero.headline}
        </ModuleText>

        <View
          style={[
            styles.pill,
            {
              borderRadius: dp(moduleLayout.radiusPill),
              paddingHorizontal: dp(10),
              paddingVertical: dp(5),
            },
          ]}
        >
          <ModuleText token="rowMeta" color={module.theme.onFill} numberOfLines={1}>
            {hero.support}
          </ModuleText>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    overflow: 'hidden',
  },
  copy: {
    // Pinned right so the robot on the artwork's left is never covered.
    alignSelf: 'flex-end',
    flex: 1,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  pill: {
    backgroundColor: 'rgba(255, 255, 255, 0.24)',
  },
});
