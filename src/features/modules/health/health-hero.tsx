import { StyleSheet, View } from 'react-native';

import { AppIcon, PressableScale } from '@ds/components';

import { ModuleHeroArtwork } from '../components/module-hero-artwork';
import { ModuleText } from '../components/module-text';
import { useModule } from '../module-context';
import { moduleLayout, moduleNeutrals } from '../module-tokens';
import { useModuleMetrics } from '../use-module-metrics';

export type HealthHeroProps = {
  readonly onAction: () => void;
  readonly testID?: string;
};

/**
 * Health's hero: the approved landscape, and an invitation in front of it.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── What was here, and why the ring had to go (issue #27) ──────────────────
 * A `ProgressRing` swept to a wellness score of **86**, with the same number rendered beside it as a
 * display-size numeral and an accessibility label reading "Wellness Score 86 out of 100". The old
 * docblock defended the arrangement well: the ring was *"a data graphic drawn from the same `score`
 * the numeral shows, so the two can never disagree — and 86 is never baked into an image"*.
 *
 * Every word of that was true and none of it was the problem. The two could not disagree with each
 * other; they agreed with nothing. There is no health data layer anywhere in this codebase — no
 * repository, no provider, no storage namespace — so `score` came from a hard-coded fixture, and a
 * wellness score is not a neutral number. It is an assessment of the person reading it, rendered in
 * the largest type on the screen, which they cannot correct because there is nothing behind it to
 * correct.
 *
 * ── Why the whole ring, rather than a zeroed one ───────────────────────────
 * A ring at zero is still a claim — it says the score is zero, which is worse than saying nothing —
 * and an empty track with no sweep is a data graphic with no data, which reads as a loading state
 * that never finishes. So the element is gone rather than emptied, which is the narrow hero redesign
 * this change was approved for.
 *
 * ── What is preserved ──────────────────────────────────────────────────────
 * Everything that can carry truthful content: the locked landscape artwork and its scrim, the
 * module palette, the hero height and radius, the copy column on the approved side, the type tokens,
 * and the action button with its icon. Copy comes from the registry's hero fields exactly as before
 * — those fields are now an invitation rather than a reading. Nothing new was introduced to the
 * launch of this screen; a card was removed from it.
 * ═══════════════════════════════════════════════════════════════════════════
 */
export function HealthHero({ onAction, testID }: HealthHeroProps) {
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
        <View style={[styles.textColumn, { rowGap: dp(2) }]}>
          <ModuleText token="rowMeta" color={module.theme.onFill} numberOfLines={1}>
            {hero.eyebrow}
          </ModuleText>
          {/*
            `cardHeading` rather than the `heroScore` display token the numeral used. A short phrase
            set at score size would fill the artwork and crowd the runner the copy side exists to
            avoid; two lines are allowed here because a sentence can wrap where a two-digit number
            never had to.
          */}
          <ModuleText
            token="cardHeading"
            color={module.theme.onFill}
            numberOfLines={2}
            maxFontSizeMultiplier={1.2}
          >
            {hero.headline}
          </ModuleText>
          <ModuleText token="rowMeta" color={module.theme.onFill} numberOfLines={2}>
            {hero.support}
          </ModuleText>

          <PressableScale
            onPress={onAction}
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
            <AppIcon name="add-circle" size={dp(13)} color={module.theme.ink} />
            <ModuleText token="cardAction" color={module.theme.ink} numberOfLines={1}>
              {hero.actionLabel}
            </ModuleText>
          </PressableScale>
        </View>
        {/*
          The copy column keeps its own width and the artwork keeps the rest. Where the ring used to
          sit is simply artwork now — the runner the ring was inset to avoid is fully visible, which
          is the one visual improvement this change happens to make.
        */}
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
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: moduleNeutrals.surface,
  },
});
