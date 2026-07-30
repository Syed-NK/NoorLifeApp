import { StyleSheet, View } from 'react-native';

import { useModule } from '../module-context';
import { moduleLayout } from '../module-tokens';
import { useModuleMetrics } from '../use-module-metrics';
import { ModuleHeroArtwork } from './module-hero-artwork';
import { ModuleText } from './module-text';

export type ModuleHeroCardProps = {
  /** Overrides the registry's hero copy — used on sub-screens. */
  readonly title?: string;
  readonly body?: string;
  readonly eyebrow?: string;
  readonly highlight?: string;
  readonly testID?: string;
};

/**
 * The shared hero card: locked artwork behind, live copy in front.
 *
 * Used by the five modules that do not yet have a composition of their own, and by every
 * module sub-screen. Faith and Health have their own heroes because their references place
 * specific controls — a gold CTA, a live score ring — inside the card.
 *
 * ── What changed when the artwork arrived ───────────────────────────────────
 * This card previously drew a twelve-band gradient wash and placed the module's small
 * pictogram on the right, because no hero artwork existed. Both are now gone: the locked
 * 1083 × 396 PNG fills the card, and putting the pictogram on top of it is explicitly
 * forbidden — it is the small mark for tiles, not a hero subject.
 *
 * The copy occupies a fixed share of the card rather than a flexible remainder, so a long
 * headline can never expand into the artwork's subject. Every asset puts its quiet band on
 * the copy side, and the scrim — where one is needed at all — ramps away from it.
 */
export function ModuleHeroCard({ title, body, eyebrow, highlight, testID }: ModuleHeroCardProps) {
  const module = useModule();
  const { dp, type, contentWidth } = useModuleMetrics();
  const hero = module.hero;

  const resolvedHighlight = highlight ?? hero.highlight;
  const textColumnWidth = Math.floor(contentWidth * moduleLayout.heroTextColumnRatio);

  return (
    <View
      style={[
        styles.root,
        {
          height: dp(moduleLayout.heroHeight),
          borderRadius: dp(moduleLayout.cardRadius),
          // Shows only in the instant before the image decodes, and behind its edges if a
          // future asset ever ships with transparency.
          backgroundColor: module.theme.gradientStart,
        },
      ]}
      testID={testID}
    >
      <ModuleHeroArtwork
        source={module.heroArtwork}
        scrim={module.heroScrim}
        copySide={module.heroCopySide}
        testID={`${testID ?? 'module-hero'}-artwork`}
      />

      <View style={[styles.row, { padding: dp(moduleLayout.heroPadding) }]}>
        <View style={[styles.textColumn, { rowGap: dp(3), width: textColumnWidth }]}>
          <ModuleText
            token="eyebrow"
            color={module.theme.onFill}
            numberOfLines={1}
            style={styles.eyebrow}
          >
            {(eyebrow ?? hero.eyebrow).toUpperCase()}
          </ModuleText>
          <ModuleText token="heroTitle" color={module.theme.onFill} numberOfLines={2}>
            {title ?? hero.title}
          </ModuleText>
          <ModuleText token="heroBody" color={module.theme.onFill} numberOfLines={2}>
            {body ?? hero.body}
          </ModuleText>

          {resolvedHighlight === undefined ? null : (
            <View
              style={[
                styles.chip,
                {
                  marginTop: dp(4),
                  borderRadius: dp(moduleLayout.radiusPill),
                  paddingHorizontal: dp(8),
                  paddingVertical: dp(3),
                },
              ]}
            >
              <ModuleText
                token="rowMeta"
                color={module.theme.onFill}
                numberOfLines={1}
                maxFontSizeMultiplier={1.3}
                style={{ lineHeight: type('rowMeta').lineHeight }}
              >
                {resolvedHighlight}
              </ModuleText>
            </View>
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    // The card owns the radius and does the clipping; the artwork carries neither.
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  textColumn: {
    flexGrow: 0,
    flexShrink: 1,
    minWidth: 0,
  },
  eyebrow: {
    letterSpacing: 0.6,
    opacity: 0.92,
  },
  chip: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(0, 0, 0, 0.24)',
  },
});
