import { StyleSheet, View } from 'react-native';

import { AppIcon, PressableScale } from '@ds/components';
import { minimumHitSlop } from '@shared/utils/a11y';

import { ModuleHeroArtwork } from '../components/module-hero-artwork';
import { ModuleText } from '../components/module-text';
import { useModule } from '../module-context';
import { moduleLayout } from '../module-tokens';
import { useModuleMetrics } from '../use-module-metrics';

/** Gold, sampled from the locked artwork's lanterns and the reference's button. */
const GOLD = '#E3BE73';
const GOLD_DEEP = '#C99B45';
/** Ink on the gold button — the reference uses a dark brown-green, not black. */
const GOLD_INK = '#3D2E10';

/**
 * Share of the card width given to the copy.
 *
 * 0.55, the middle of the specified 52–58% band. Measured against
 * `03-faith-hero-left-copy-v2.png`: the artwork's leftmost architecture — the outer
 * minaret of the distant skyline — begins at about 44% of the canvas, so copy may run to
 * 55% before it reaches anything worth seeing. The palms and the lit mosque, which are
 * the subject, start past 65%.
 */
const COPY_WIDTH_RATIO = 0.55;

export type FaithHeroProps = {
  readonly onViewPrayerTimes: () => void;
  readonly testID?: string;
};

/**
 * Faith's next-prayer hero.
 *
 * ── Left-aligned, like every other module ───────────────────────────────────
 * This hero used to centre its copy, because the superseded artwork was symmetrical and
 * there was no quiet side to put text on. `03-faith-hero-left-copy-v2.png` fixes that at
 * the source: the mosque sits right, the left is an unlit green field. So the copy is
 * left-aligned and lives in the left 55%, and Faith stops being the exception.
 *
 * ── The hierarchy ───────────────────────────────────────────────────────────
 *     Next Prayer            eyebrow, gold
 *     Dhuhr 12:35 PM         one line, never wrapped
 *     May 19, 2025
 *     21 Dhul-Qa'dah 1446 AH
 *     [View Prayer Times]
 *
 * ── Why the prayer line stays on one line ───────────────────────────────────
 * The prayer name and time are a single registry string rather than two fields, because
 * two fields is how they end up on two lines. At 20 dp semibold, "Dhuhr 12:35 PM"
 * measures ~132 dp against the 199 dp copy column at the 393 dp reference width, so it
 * fits with room to spare.
 *
 * The size dropped from 24 to 20 dp when the column narrowed from full-width-centred to
 * 55%: at 24 dp the string measured ~158 dp, which fits 199 dp but leaves too little
 * margin once Android's font scale is applied. 20 dp is still well above the accessible
 * minimum for a display line, and `maxFontSizeMultiplier` caps growth at 1.1 rather than
 * switching scaling off.
 *
 * ── Spacing ─────────────────────────────────────────────────────────────────
 * Explicit at both ends and between every group, so the button never touches the prayer
 * line and the eyebrow never touches the card edge, on any device.
 */
export function FaithHero({ onViewPrayerTimes, testID }: FaithHeroProps) {
  const module = useModule();
  const { dp, contentWidth } = useModuleMetrics();
  const hero = module.hero;

  return (
    <View
      style={[
        styles.root,
        {
          height: dp(moduleLayout.faithHeroHeight),
          borderRadius: dp(moduleLayout.cardRadius),
          // Painted behind the artwork so there is no white flash while the PNG decodes,
          // and no seam if `cover` leaves a sub-pixel edge.
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
            width: contentWidth * COPY_WIDTH_RATIO,
            paddingTop: dp(moduleLayout.faithHeroPaddingTop),
            paddingBottom: dp(moduleLayout.faithHeroPaddingBottom),
            paddingLeft: dp(moduleLayout.heroPadding),
          },
        ]}
        testID={`${testID ?? 'faith-hero'}-copy`}
      >
        <ModuleText token="eyebrow" color={GOLD} align="left" numberOfLines={1}>
          {hero.eyebrow}
        </ModuleText>

        {/* One line. A wrapped prayer time is the specific defect this replaces. */}
        <ModuleText
          token="faithPrayer"
          color={module.theme.onFill}
          align="left"
          numberOfLines={1}
          maxFontSizeMultiplier={1.1}
          style={{ marginTop: dp(moduleLayout.faithHeroEyebrowGap) }}
          testID={`${testID ?? 'faith-hero'}-prayer`}
        >
          {hero.headline}
        </ModuleText>

        <View style={{ marginTop: dp(moduleLayout.faithHeroDateGap) }}>
          <ModuleText token="rowMeta" color={module.theme.onFill} align="left" numberOfLines={1}>
            {hero.support}
          </ModuleText>
          <ModuleText token="rowMeta" color={module.theme.onFill} align="left" numberOfLines={1}>
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
          // The visible pill is 34 dp so it fits the hero; hit-slop brings the
          // effective target to the 44 dp minimum without growing the artwork box.
          hitSlop={minimumHitSlop(dp(moduleLayout.heroButtonHeight))}
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
    // Left-aligned and vertically centred in the card.
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-start',
    backgroundColor: GOLD,
    borderWidth: 1,
    borderColor: GOLD_DEEP,
  },
});
