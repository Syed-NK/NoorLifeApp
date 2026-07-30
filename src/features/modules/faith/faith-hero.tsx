import { Image, StyleSheet, View } from 'react-native';

import { AppIcon, PressableScale } from '@ds/components';

import { ModuleText } from '../components/module-text';
import { useModule } from '../module-context';
import { moduleLayout } from '../module-tokens';
import { useModuleMetrics } from '../use-module-metrics';
import type { FaithHomeViewModel } from './faith-view-model';

/** Gold, from the approved reference's ornament and button. */
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
 * Faith's next-prayer hero, from `03-faith.png`.
 *
 * ── The artwork gap, stated plainly ─────────────────────────────────────────
 * The reference's hero is an illustrated mosque skyline with gold corner ornament, a
 * crescent and stars. **That artwork does not exist as a standalone asset** — it lives
 * only inside the 512 × 1024 composite mockup, where it is roughly 2.5× too small to
 * upscale cleanly. So the slot below renders `module.heroArtwork`, which is `null`, and
 * therefore renders nothing at all.
 *
 * What it deliberately does *not* do is substitute the small mosque pictogram or invent a
 * replacement scene. Both were explicitly ruled out, and both would have to be undone
 * when the real artwork arrives. Dropping the file in and setting one registry value
 * completes the hero without touching this layout.
 *
 * Everything else here is the reference: the centred text stack, the two date lines, and
 * the gold pill button. The text is centred rather than left-aligned because the
 * reference centres it between the flanking mosques.
 */
export function FaithHero({ model, onViewPrayerTimes, testID }: FaithHeroProps) {
  const module = useModule();
  const { dp } = useModuleMetrics();

  return (
    <View
      style={[
        styles.root,
        {
          minHeight: dp(moduleLayout.heroFaith),
          borderRadius: dp(moduleLayout.cardRadius),
          backgroundColor: module.theme.gradientStart,
        },
      ]}
      testID={testID}
    >
      {/* Artwork slot. Renders only when the approved illustration exists. */}
      {module.heroArtwork === null ? null : (
        <Image
          source={module.heroArtwork}
          style={styles.artwork}
          resizeMode="cover"
          accessible={false}
          testID={`${testID ?? 'faith-hero'}-artwork`}
        />
      )}

      <View style={[styles.content, { paddingVertical: dp(12) }]}>
        <ModuleText token="eyebrow" color={GOLD} align="center" numberOfLines={1}>
          {model.eyebrow}
        </ModuleText>

        <ModuleText
          token="heroDisplay"
          color={module.theme.onFill}
          align="center"
          numberOfLines={1}
          maxFontSizeMultiplier={1.15}
        >
          {model.name}
        </ModuleText>
        <ModuleText
          token="heroDisplay"
          color={module.theme.onFill}
          align="center"
          numberOfLines={1}
          maxFontSizeMultiplier={1.15}
        >
          {model.time}
        </ModuleText>

        <View style={{ marginTop: dp(4) }}>
          <ModuleText token="heroBody" color={module.theme.onFill} align="center" numberOfLines={1}>
            {model.gregorianDate}
          </ModuleText>
          <ModuleText token="heroBody" color={module.theme.onFill} align="center" numberOfLines={1}>
            {model.hijriDate}
          </ModuleText>
        </View>

        <PressableScale
          onPress={onViewPrayerTimes}
          accessibilityRole="button"
          accessibilityLabel={model.actionLabel}
          style={[
            styles.button,
            {
              marginTop: dp(8),
              minHeight: dp(moduleLayout.minTouchTarget * 0.75),
              borderRadius: dp(moduleLayout.radiusPill),
              paddingHorizontal: dp(14),
              paddingVertical: dp(7),
              columnGap: dp(6),
            },
          ]}
          testID={`${testID ?? 'faith-hero'}-action`}
        >
          <AppIcon name="clock" size={dp(15)} color={GOLD_INK} />
          <ModuleText token="button" color={GOLD_INK} numberOfLines={1}>
            {model.actionLabel}
          </ModuleText>
        </PressableScale>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    overflow: 'hidden',
    justifyContent: 'center',
  },
  artwork: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  content: {
    alignItems: 'center',
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
