import { StyleSheet, View } from 'react-native';

import { AppText } from '@ds/typography/app-text';
import { AppIcon } from './app-icon';
import { PressableScale } from './pressable-scale';

import { iconSize, neutralColors, semanticColors, spacing } from '@ds/tokens';
import { minimumHitSlop, minimumTouchTargetSize } from '@shared/utils/a11y';
import { forwardChevron } from '@shared/utils/rtl';

export type SectionHeaderProps = {
  readonly title: string;
  /**
   * Title size. Defaults to the §2.4 Section title (17/24).
   *
   * Inside a card, step down: a heading plus its `View All` has to share a
   * half-width card, and at 17 px — or even 15 px — "Family Check-in" wraps and
   * breaks mid-word. `label` (12/17) is what the reference uses for in-card
   * headings, with the card's *value* carrying the visual weight instead.
   */
  readonly titleVariant?: 'sectionTitle' | 'cardTitle' | 'label';
  /** Optional one-line context under the title. */
  readonly subtitle?: string;
  /**
   * Trailing action. §3.0 requires `View All` whenever a home section shows only
   * a subset of its data, so the label defaults to exactly that.
   */
  readonly action?: {
    readonly label?: string;
    readonly onPress: () => void;
    /** Colour of the action label — pass the module primary inside a module. */
    readonly color?: string;
  };
  readonly testID?: string;
};

/**
 * Section heading used above every home-screen section.
 *
 * Title uses the §2.4 Section title style (17/24 · 600). The trailing action is a
 * real 44 px touch target via hit-slop, even though it renders as compact text.
 */
export function SectionHeader({
  title,
  titleVariant = 'sectionTitle',
  subtitle,
  action,
  testID,
}: SectionHeaderProps) {
  const actionLabel = action?.label ?? 'View All';
  const actionColor = action?.color ?? semanticColors.primary;

  return (
    /* The floor is read at render, never cached in a StyleSheet - issue #115. */
    <View style={[styles.root, { minHeight: minimumTouchTargetSize() }]} testID={testID}>
      <View style={styles.titleColumn}>
        <AppText variant={titleVariant} numberOfLines={2}>
          {title}
        </AppText>
        {subtitle === undefined ? null : (
          <AppText variant="caption" color={neutralColors.textSecondary} numberOfLines={1}>
            {subtitle}
          </AppText>
        )}
      </View>

      {action === undefined ? null : (
        <PressableScale
          onPress={action.onPress}
          hitSlop={minimumHitSlop(spacing.xl)}
          accessibilityRole="button"
          accessibilityLabel={`${actionLabel}, ${title}`}
          style={[
            styles.action,
            {
              minWidth: minimumTouchTargetSize(),
              minHeight: minimumTouchTargetSize(),
              alignItems: 'center',
              justifyContent: 'center',
            },
          ]}
        >
          <AppText variant="label" color={actionColor} numberOfLines={1}>
            {actionLabel}
          </AppText>
          <AppIcon name={forwardChevron()} size={iconSize.xs} color={actionColor} />
        </PressableScale>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  titleColumn: {
    flexShrink: 1,
    minWidth: 0,
  },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    // Never squeezed by a long title — the title column shrinks instead.
    flexShrink: 0,
  },
});
