import { StyleSheet, View } from 'react-native';

import { HeroArtwork } from '@ds/illustrations/hero-artwork';
import { AppText } from '@ds/typography/app-text';
import { Pill } from './pill';
import { PrimaryButton } from './primary-button';

import { layout, neutralColors, onHeroColors, radius, shadowRaised, spacing } from '@ds/tokens';
import type { IconName } from '@shared/models/icon';
import type { ModuleTheme } from '@shared/models/module-theme';

/**
 * Artwork column height, measured from
 * design-reference/individual-core-screens/01-main-home.png: the illustration
 * fills the hero between its top and bottom padding.
 */
const ARTWORK_HEIGHT = 124;

/**
 * Illustration share of the hero width.
 *
 * §3.3 permits 35–45%. The lower bound is used deliberately: the Main Home title
 * ("Your life, organized with NoorLife.") only fits three un-truncated lines at
 * the locked 24 px hero-title size if the text column keeps ~170 dp, and 35%
 * artwork is what leaves that. The reference illustration is wider (52% — outside
 * the specified band), so this is the closest in-spec value.
 */
const ARTWORK_WIDTH_PERCENT = '35%';

export type HeroMicroMetric = {
  readonly key: string;
  readonly label: string;
  readonly value: string;
  readonly icon: IconName;
};

export type HeroCardProps = {
  readonly theme: ModuleTheme;
  /** Eyebrow / contextual label — hero structure item 1 (§3.3). */
  readonly eyebrow: string;
  /** Large title or value — item 2. Two lines maximum. */
  readonly title: string;
  /** One short supporting line — item 3. Two lines maximum. */
  readonly supportingLine?: string;
  /** Optional scope or status pill — part of item 5. */
  readonly pillLabel?: string;
  /** Optional primary action — item 5. */
  readonly action?: {
    readonly label: string;
    readonly icon?: IconName;
    readonly onPress: () => void;
  };
  /** Optional micro-metrics row, e.g. next prayer / tasks due (§05). */
  readonly microMetrics?: readonly HeroMicroMetric[];
  /** `dataLarge` renders the title as a big numeric value (§08–§13 heroes). */
  readonly titleVariant?: 'heroTitle' | 'dataLarge';
  /**
   * Title line limit. Defaults to the two lines §3.3 specifies.
   *
   * Three is permitted for one documented case: Main Home's product tagline
   * ("Your life, organized with NoorLife.") does not fit two lines at 24 px in the
   * text column, and the reference itself renders it on three
   * (design-reference/individual-core-screens/01-main-home.png). Truncating the
   * tagline is worse than a third line, so the limit is a prop rather than a silent
   * ellipsis.
   */
  readonly titleMaxLines?: 2 | 3;
  readonly testID?: string;
};

/**
 * The shared Learning-style hero card.
 *
 * Spec §3.3 makes this mandatory as the first element after the top bar on Main
 * Home and on every module home. It is deliberately the only hero implementation
 * in the codebase: modules pass a ModuleTheme rather than restyling a copy, which
 * is what §5 means by "do not duplicate module screens with hard-coded styling".
 *
 * Locked properties:
 *   • radius 24, padding 20
 *   • module `dark` → `primary` fill, never more than two chromatic colours
 *   • illustration constrained to 35% of the width (spec allows 35–45%)
 *   • supporting copy clamped to two lines
 *   • text sits in its own column so no decoration lands behind it
 *
 * Fill note: the Main Home reference
 * (design-reference/individual-core-screens/01-main-home.png) renders the hero as
 * a *flat* indigo — sampling a row straight across it returns a uniform value with
 * no left-to-right ramp. An earlier horizontally banded approximation of the
 * §3.3 dark→primary gradient produced a visible vertical split down the card, which
 * the reference does not have. The fill is therefore a uniform blend: `dark` base
 * with a full-bleed `primary` wash, which sits between the two specified colours,
 * introduces no new value and has no seam. A true directional gradient needs
 * `expo-linear-gradient` (a native module — see illustrations/ASSETS-REQUIRED.md §5).
 */
export function HeroCard({
  theme,
  eyebrow,
  title,
  supportingLine,
  pillLabel,
  action,
  microMetrics,
  titleVariant = 'heroTitle',
  titleMaxLines = 2,
  testID,
}: HeroCardProps) {
  return (
    <View
      style={[styles.root, shadowRaised, { backgroundColor: theme.dark }]}
      testID={testID}
      accessible={false}
    >
      {/* Uniform primary wash — no directional seam (see the note above). */}
      <View style={[styles.fillWash, { backgroundColor: theme.primary }]} pointerEvents="none" />

      <View style={styles.body}>
        <View style={styles.textColumn}>
          <AppText variant="label" color={onHeroColors.secondary} numberOfLines={1}>
            {eyebrow}
          </AppText>

          <AppText
            variant={titleVariant}
            color={onHeroColors.primary}
            numberOfLines={titleMaxLines}
          >
            {title}
          </AppText>

          {supportingLine === undefined ? null : (
            <AppText variant="body" color={onHeroColors.secondary} numberOfLines={2}>
              {supportingLine}
            </AppText>
          )}

          {pillLabel === undefined ? null : (
            <Pill
              label={pillLabel}
              backgroundColor={onHeroColors.chip}
              textColor={onHeroColors.primary}
              style={styles.pill}
            />
          )}

          {action === undefined ? null : (
            <PrimaryButton
              label={action.label}
              {...(action.icon === undefined ? {} : { icon: action.icon })}
              onPress={action.onPress}
              // The reference action is a solid white pill with dark module text,
              // not a translucent chip.
              color={neutralColors.surface}
              textColor={theme.dark}
              style={styles.action}
            />
          )}
        </View>

        <View style={styles.artworkColumn}>
          <HeroArtwork illustration={theme.heroIllustration} height={ARTWORK_HEIGHT} />
        </View>
      </View>

      {microMetrics === undefined || microMetrics.length === 0 ? null : (
        <View style={styles.microMetrics}>
          {microMetrics.map((metric) => (
            <View key={metric.key} style={styles.microMetric}>
              <AppText variant="caption" color={onHeroColors.muted} numberOfLines={1}>
                {metric.label}
              </AppText>
              <AppText variant="label" color={onHeroColors.primary} numberOfLines={1}>
                {metric.value}
              </AppText>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    // No `minHeight`: the reference hero is 155 dp, below the §3.3 180 px minimum,
    // so the card sizes to its content instead of being padded out to 180. The
    // content floor (20 padding + eyebrow + 3 title lines + 44 dp action + 20
    // padding) already exceeds 180 on Main Home.
    borderRadius: radius.hero,
    padding: layout.heroPadding,
    overflow: 'hidden',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  fillWash: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    // Blends `dark` toward `primary` uniformly. Low enough to keep hero copy at
    // WCAG AA against the resulting fill (§3.3).
    opacity: 0.26,
  },
  body: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  textColumn: {
    flex: 1,
    gap: spacing.xs,
  },
  artworkColumn: {
    width: ARTWORK_WIDTH_PERCENT,
    height: ARTWORK_HEIGHT,
    alignItems: 'flex-end',
    justifyContent: 'flex-end',
  },
  pill: {
    marginTop: spacing.xs,
  },
  action: {
    marginTop: spacing.sm,
  },
  microMetrics: {
    flexDirection: 'row',
    gap: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: onHeroColors.hairline,
  },
  microMetric: {
    flex: 1,
    gap: 2,
  },
});
