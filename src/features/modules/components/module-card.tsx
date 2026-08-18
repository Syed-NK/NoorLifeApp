import type { ReactNode } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';

import { PressableScale } from '@ds/components';

import { useModuleTheme } from '../module-context';
import { moduleLayout, moduleNeutrals } from '../module-tokens';
import { useModuleMetrics } from '../use-module-metrics';
import { ModuleText } from './module-text';

export type ModuleCardProps = {
  /** Fills with the module's light surface instead of white. */
  readonly tinted?: boolean;
  /** Uses the module's border colour instead of the neutral hairline. */
  readonly accentBorder?: boolean;
  /** Makes the whole card a button. */
  readonly onPress?: () => void;
  readonly accessibilityLabel?: string;
  /** Baseline dp. Defaults to the shared card padding. */
  readonly padding?: number;
  readonly style?: ViewStyle;
  readonly children: ReactNode;
  readonly testID?: string;
};

/**
 * The white rounded card both approved references are built from.
 *
 * Extracted because Faith and Health between them use it eleven times, and the
 * alternative — each composition writing its own `borderWidth: 1, borderColor: …,
 * borderRadius: dp(16)` — is how card styling drifts between screens that are supposed
 * to look like one app.
 *
 * Deliberately does **not** take a height. A card that sizes to its content cannot
 * stretch; the references' compact density comes from the content, not from fixed
 * heights fighting their contents.
 */
export function ModuleCard({
  tinted = false,
  accentBorder = false,
  onPress,
  accessibilityLabel,
  padding,
  style,
  children,
  testID,
}: ModuleCardProps) {
  const theme = useModuleTheme();
  const { dp } = useModuleMetrics();

  const base: ViewStyle = {
    backgroundColor: tinted ? theme.lightSurface : moduleNeutrals.surface,
    borderColor: accentBorder ? theme.border : moduleNeutrals.border,
    borderWidth: 1,
    borderRadius: dp(moduleLayout.cardRadius),
    padding: dp(padding ?? moduleLayout.cardPadding),
  };

  if (onPress === undefined) {
    return (
      <View style={[base, style]} testID={testID}>
        {children}
      </View>
    );
  }

  return (
    <PressableScale
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={[base, style]}
      testID={testID}
    >
      {children}
    </PressableScale>
  );
}

export type ModuleTwoColumnProps = {
  readonly left: ReactNode;
  readonly right: ReactNode;
  readonly testID?: string;
};

/**
 * The equal-width two-column row that dominates both references.
 *
 * `alignItems: 'stretch'` so the two cards match height whichever is taller — the
 * references show both columns' cards ending on the same line. Each column carries
 * `minWidth: 0`, without which a long word in one column expands it and squeezes the
 * other, the same collapse that has bitten this project twice.
 */
export function ModuleTwoColumn({ left, right, testID }: ModuleTwoColumnProps) {
  const { dp } = useModuleMetrics();
  return (
    <View style={[styles.row, { columnGap: dp(moduleLayout.twoColumnGap) }]} testID={testID}>
      <View style={styles.column}>{left}</View>
      <View style={styles.column}>{right}</View>
    </View>
  );
}

export type ModuleCardHeadingProps = {
  readonly title: string;
  /** Trailing link, e.g. "View All". Rendered in the module's ink colour. */
  readonly actionLabel?: string;
  readonly onAction?: () => void;
  readonly testID?: string;
};

/** A card's own heading row, with the references' optional trailing link. */
export function ModuleCardHeading({
  title,
  actionLabel,
  onAction,
  testID,
}: ModuleCardHeadingProps) {
  const theme = useModuleTheme();
  const { dp } = useModuleMetrics();

  return (
    <View style={[styles.headingRow, { marginBottom: dp(6), columnGap: dp(6) }]}>
      <ModuleText
        token="cardHeading"
        numberOfLines={1}
        accessibilityRole="header"
        style={styles.flex}
      >
        {title}
      </ModuleText>
      {actionLabel === undefined || onAction === undefined ? null : (
        <PressableScale
          onPress={onAction}
          accessibilityRole="button"
          accessibilityLabel={`${actionLabel}, ${title}`}
          // The link is visually small; hit-slop carries it to 44 dp without changing
          // the reference's compact heading height.
          hitSlop={12}
          testID={testID}
        >
          <ModuleText token="cardAction" color={theme.ink} numberOfLines={1}>
            {actionLabel}
          </ModuleText>
        </PressableScale>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  column: {
    flex: 1,
    minWidth: 0,
  },
  headingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  flex: {
    flex: 1,
    minWidth: 0,
  },
});
