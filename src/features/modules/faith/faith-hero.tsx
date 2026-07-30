import { StyleSheet, View } from 'react-native';

import { AppIcon, PressableScale } from '@ds/components';

import { ModuleHeroArtwork } from '../components/module-hero-artwork';
import { ModuleText } from '../components/module-text';
import { useModule } from '../module-context';
import { moduleLayout } from '../module-tokens';
import { useModuleMetrics } from '../use-module-metrics';

/** Gold, sampled from the locked artwork's ornament and the reference's button. */
const GOLD = '#E3BE73';
const GOLD_DEEP = '#C99B45';
/** Ink on the gold button — the reference uses a dark brown-green, not black. */
const GOLD_INK = '#3D2E10';

export type FaithHeroProps = {
  readonly onViewPrayerTimes: () => void;
  readonly testID?: string;
};

/**
 * Faith's next-prayer hero — the one hero whose copy is centred.
 *
 * ── Why Faith is the exception ───────────────────────────────────────────────
 * Every other locked hero puts its subject on one side and leaves the other quiet, so its copy
 * goes in that band. `03-faith-hero.png` is symmetrical: mosques and ornament on both flanks
 * with calm sky through the middle. Its reference centres the prayer information there, and the
 * correction brief names it as the exception.
 *
 * ── The hierarchy, and the one-line rule ────────────────────────────────────
 *     Next Prayer
 *     Dhuhr 12:35 PM        ← one line, never wrapped
 *     May 19, 2025
 *     21 Dhul-Qa'dah 1446 AH
 *     [View Prayer Times]
 *
 * The prayer and time are a single string in the registry rather than two fields, because two
 * fields is how they end up on two lines. At 24 dp semibold "Dhuhr 12:35 PM" measures about
 * 158 dp against the 361 dp card, so it fits with room to spare and no shrinking is needed.
 *
 * Spacing is explicit rather than derived from one device's measurements: a real top margin
 * above the eyebrow, a small gap before the dates, and a real bottom clearance so the button
 * never touches the card's edge.
 */
export function FaithHero({ onViewPrayerTimes, testID }: FaithHeroProps) {
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
            // Explicit top and bottom padding: the brief asks for breathing room above
            // "Next Prayer" and below the button, on any device.
            paddingTop: dp(moduleLayout.faithHeroPaddingTop),
            paddingBottom: dp(moduleLayout.faithHeroPaddingBottom),
            paddingHorizontal: dp(moduleLayout.heroPadding),
          },
        ]}
      >
        <ModuleText token="eyebrow" color={GOLD} align="center" numberOfLines={1}>
          {hero.eyebrow}
        </ModuleText>

        {/* One line. A wrapped time is the specific defect this replaces. */}
        <ModuleText
          token="faithPrayer"
          color={module.theme.onFill}
          align="center"
          numberOfLines={1}
          maxFontSizeMultiplier={1.1}
          style={{ marginTop: dp(2) }}
          testID={`${testID ?? 'faith-hero'}-prayer`}
        >
          {hero.headline}
        </ModuleText>

        <View style={{ marginTop: dp(moduleLayout.faithHeroDateGap) }}>
          <ModuleText token="rowMeta" color={module.theme.onFill} align="center" numberOfLines={1}>
            {hero.support}
          </ModuleText>
          <ModuleText token="rowMeta" color={module.theme.onFill} align="center" numberOfLines={1}>
            {hero.supportSecondary}
          </ModuleText>
        </View>

        <PressableScale
          onPress={onViewPrayerTimes}
          accessibilityRole="button"
          accessibilityLabel={hero.actionLabel}
          style={[
            styles.button,
            {
              marginTop: dp(moduleLayout.faithHeroButtonGap),
              minHeight: dp(moduleLayout.heroButtonHeight),
              borderRadius: dp(moduleLayout.radiusPill),
              paddingHorizontal: dp(12),
              columnGap: dp(5),
            },
          ]}
          testID={`${testID ?? 'faith-hero'}-action`}
        >
          <AppIcon name="clock" size={dp(13)} color={GOLD_INK} />
          <ModuleText token="cardAction" color={GOLD_INK} numberOfLines={1}>
            {hero.actionLabel}
          </ModuleText>
        </PressableScale>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    // The card owns the radius and does the clipping; the artwork carries neither.
    overflow: 'hidden',
  },
  copy: {
    flex: 1,
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
