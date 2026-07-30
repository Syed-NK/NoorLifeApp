import { Image, StyleSheet, View } from 'react-native';

import { useModule } from '../module-context';
import { moduleLayout } from '../module-tokens';
import { useModuleMetrics } from '../use-module-metrics';
import { ModuleText } from './module-text';

/**
 * Slices in the hero's gradient wash.
 *
 * Twelve is where the steps stopped being visible on a Pixel 8 at the hero's ~132 dp
 * height. Fewer showed banding; more buys nothing and costs views.
 */
const GRADIENT_BANDS = 12;

export type ModuleHeroCardProps = {
  /** Overrides the registry's hero copy — used on sub-screens. */
  readonly title?: string;
  readonly body?: string;
  readonly eyebrow?: string;
  readonly highlight?: string;
  readonly testID?: string;
};

/**
 * The hero card at the top of a module screen.
 *
 * The brief's requirement is specific: **no blank upper area**. Every module
 * therefore ships hero copy in the registry, and this component lays it out as a
 * filled two-column card — text on the left, the module's approved pictogram on the
 * right — so there is never a hero that renders as an empty coloured block waiting
 * for content.
 *
 * ── Why the gradient is a stack of thin bands ───────────────────────────────
 * No gradient dependency is installed, and adding one for a decorative wash is not
 * worth a native rebuild. The first attempt was two views — `gradientStart` with one
 * `gradientEnd` band over the lower half — and on the Pixel 8 that produced a clearly
 * visible horizontal seam straight through the hero's second line of copy. The same
 * mistake as the entry flow's medallion sheen, where a rectangular band left a hard
 * edge that had to become a soft ellipse.
 *
 * So the wash is `GRADIENT_BANDS` slices with a linear opacity ramp. Each step changes
 * the colour by about a twelfth of the distance between two already-close colours,
 * which is below the threshold where an edge is visible, and the bands overlap
 * fractionally so sub-pixel rounding cannot open a hairline gap between them.
 *
 * Both endpoint colours were derived to clear 4.5:1 against white, so the white hero
 * text is AA over every band rather than only over the darker ones — the property a
 * real gradient would have had to satisfy too.
 *
 * The artwork is `accessible={false}` with an empty label in the registry: it repeats
 * the module identity already announced by the header and the eyebrow, so
 * announcing it again is noise for a screen-reader user.
 */
export function ModuleHeroCard({ title, body, eyebrow, highlight, testID }: ModuleHeroCardProps) {
  const module = useModule();
  const { dp, type, contentWidth } = useModuleMetrics();
  const hero = module.hero;

  const artSize = dp(moduleLayout.heroArtSize);
  const padding = dp(moduleLayout.heroPadding);
  const resolvedHighlight = highlight ?? hero.highlight;
  /**
   * The copy occupies a fixed share of the card, never a flexible remainder.
   *
   * At the 393 dp baseline the card is 361 dp wide, so 62% is ~224 dp of text against an
   * 88 dp pictogram — inside the specified 60–65% band with the gap and padding
   * accounted for. Fixing the proportion is what guarantees the two never overlap
   * regardless of how long a module's headline is.
   */
  const textColumnWidth = Math.floor(contentWidth * moduleLayout.heroTextColumnRatio);

  return (
    <View
      style={[
        styles.root,
        {
          minHeight: dp(moduleLayout.heroMinHeight),
          borderRadius: dp(moduleLayout.cardRadius),
          backgroundColor: module.theme.gradientStart,
        },
      ]}
      testID={testID}
    >
      {/* The wash. Purely decorative, and hidden from accessibility. */}
      <View style={styles.wash} accessible={false} pointerEvents="none">
        {Array.from({ length: GRADIENT_BANDS }, (_, index) => (
          <View
            key={index}
            style={{
              flex: 1,
              backgroundColor: module.theme.gradientEnd,
              opacity: index / (GRADIENT_BANDS - 1),
              // A hair of overlap, so rounding cannot leave a visible gap between bands.
              marginBottom: index === GRADIENT_BANDS - 1 ? 0 : -0.5,
            }}
          />
        ))}
      </View>

      {/* `columnGap` keeps the copy off the artwork. Without it a three-line body ran
          flush against the pictogram's edge. */}
      <View style={[styles.row, { padding, columnGap: dp(10) }]}>
        <View style={[styles.textColumn, { rowGap: dp(4), width: textColumnWidth }]}>
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
          <ModuleText token="heroBody" color={module.theme.onFill} numberOfLines={3}>
            {body ?? hero.body}
          </ModuleText>

          {resolvedHighlight === undefined ? null : (
            <View
              style={[
                styles.chip,
                {
                  marginTop: dp(6),
                  borderRadius: dp(moduleLayout.radiusPill),
                  paddingHorizontal: dp(9),
                  paddingVertical: dp(4),
                },
              ]}
            >
              <ModuleText
                token="caption"
                color={module.theme.onFill}
                numberOfLines={1}
                maxFontSizeMultiplier={1.4}
                style={{ lineHeight: type('caption').lineHeight }}
              >
                {resolvedHighlight}
              </ModuleText>
            </View>
          )}
        </View>

        {/*
          The approved PNG, straight from the module definition's single asset field.

          No `tintColor`, no background, no pedestal or shadow view, and `contain` so it
          is never stretched or cropped. The wrapper is sized rather than the Image being
          allowed to drive layout, so a change of asset cannot change the card's height.
        */}
        <View
          style={{ width: artSize, height: artSize }}
          testID={`${testID ?? 'module-hero'}-artbox`}
        >
          <Image
            source={module.heroPictogram}
            style={styles.art}
            resizeMode="contain"
            accessible={hero.artworkAccessibilityLabel !== ''}
            accessibilityLabel={
              hero.artworkAccessibilityLabel === '' ? undefined : hero.artworkAccessibilityLabel
            }
            testID={`${testID ?? 'module-hero'}-art`}
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    // Clips the wash to the card's radius. The artwork sits inside the padding, well
    // clear of the rounded corners, so nothing of the PNG is ever cut.
    overflow: 'hidden',
  },
  wash: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  textColumn: {
    // A share of the row rather than `flex: 1`, so the copy can never expand into the
    // artwork's column: text and PNG occupy fixed proportions of the card. `flex: 1`
    // let a long headline squeeze the artwork — the collapse that lost an illustration
    // in the entry flow.
    flexGrow: 0,
    flexShrink: 1,
    minWidth: 0,
  },
  art: {
    width: '100%',
    height: '100%',
  },
  eyebrow: {
    letterSpacing: 0.6,
    opacity: 0.9,
  },
  chip: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(255, 255, 255, 0.22)',
  },
});
