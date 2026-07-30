import { StyleSheet, View } from 'react-native';

import { AppIcon, PressableScale } from '@ds/components';

import { ModuleHeroArtwork } from '../components/module-hero-artwork';
import { ModuleText } from '../components/module-text';
import { useModule } from '../module-context';
import { moduleLayout } from '../module-tokens';
import { useModuleMetrics } from '../use-module-metrics';
import type { FaithHomeViewModel } from './faith-view-model';

/** Gold, sampled from the locked artwork's ornament and the reference's button. */
const GOLD = '#E3BE73';
const GOLD_DEEP = '#C99B45';
/** Ink on the gold button — the reference uses a dark brown-green, not black. */
const GOLD_INK = '#3D2E10';

export type FaithHeroProps = {
  readonly model: FaithHomeViewModel['nextPrayer'];
  readonly onViewPrayerTimes: () => void;
  readonly testID?: string;
};

/**
 * Faith's next-prayer hero: locked artwork behind, live UI in front.
 *
 * ── Copy on the left, and why ───────────────────────────────────────────────
 * `03-faith-hero.png` puts its mosque, crescent and stars on the right and leaves the left
 * ~45% as quiet night sky. So the live text sits left, inside that quiet band, and never
 * over the subject. Measured, that band is 8.90:1 against white at its brightest — well past
 * AA — so this hero carries **no scrim at all**. The gold corner ornament is low-contrast
 * against the sky and reads as texture behind the eyebrow rather than as clutter.
 *
 * Everything visible is live React Native: the prayer name, the time, both date lines and
 * the button. Nothing is baked into the image, so the same artwork serves every prayer.
 */
export function FaithHero({ model, onViewPrayerTimes, testID }: FaithHeroProps) {
  const module = useModule();
  const { dp, contentWidth } = useModuleMetrics();

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
        testID={`${testID ?? 'faith-hero'}-artwork`}
      />

      <View
        style={[
          styles.copy,
          {
            paddingLeft: dp(14),
            paddingVertical: dp(9),
            // The quiet band is the left ~45%; a little more is safe because the mosque's
            // silhouette starts further right than its bounding box suggests.
            width: contentWidth * 0.5,
          },
        ]}
      >
        <ModuleText token="eyebrow" color={GOLD} numberOfLines={1}>
          {model.eyebrow}
        </ModuleText>

        <ModuleText
          token="heroDisplay"
          color={module.theme.onFill}
          numberOfLines={1}
          maxFontSizeMultiplier={1.1}
        >
          {model.name}
        </ModuleText>
        <ModuleText
          token="heroDisplay"
          color={module.theme.onFill}
          numberOfLines={1}
          maxFontSizeMultiplier={1.1}
        >
          {model.time}
        </ModuleText>

        <ModuleText token="rowMeta" color={module.theme.onFill} numberOfLines={1}>
          {model.gregorianDate}
        </ModuleText>
        <ModuleText token="rowMeta" color={module.theme.onFill} numberOfLines={1}>
          {model.hijriDate}
        </ModuleText>

        <PressableScale
          onPress={onViewPrayerTimes}
          accessibilityRole="button"
          accessibilityLabel={model.actionLabel}
          style={[
            styles.button,
            {
              marginTop: dp(6),
              borderRadius: dp(moduleLayout.radiusPill),
              paddingHorizontal: dp(10),
              paddingVertical: dp(5),
              columnGap: dp(5),
            },
          ]}
          testID={`${testID ?? 'faith-hero'}-action`}
        >
          <AppIcon name="clock" size={dp(13)} color={GOLD_INK} />
          <ModuleText token="cardAction" color={GOLD_INK} numberOfLines={1}>
            {model.actionLabel}
          </ModuleText>
        </PressableScale>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    // The card owns the radius and the clipping; the artwork carries neither.
    overflow: 'hidden',
    justifyContent: 'center',
  },
  copy: {
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: GOLD,
    borderWidth: 1,
    borderColor: GOLD_DEEP,
  },
});
