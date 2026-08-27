import { useState, type ReactNode } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';

import { PressableScale } from '@ds/components';
import { minimumHitSlop } from '@shared/utils/a11y';

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
 *
 * ── A pressable card measures itself, so its hit area can reach the minimum ──
 * A card sizes to its content — deliberately, see above — so how tall any given one is depends on
 * what is inside it and on the OS text scale, and nothing in the props can say. The Duas attribution
 * card is one caption line inside two `cardPadding`s, which came to **37 dp** on a Samsung SM-G556B:
 * a real control, below the 44 dp minimum, in the app's own shared card.
 *
 * `minimumHitSlop` is the project's existing answer to exactly this shape of problem — expand the
 * touchable rectangle, leave the drawn card alone — and it needs a visual size to work from. One
 * `onLayout` supplies it, and the state changes only when the height actually changes, so a card with
 * stable content settles after its first layout and re-renders no further.
 *
 * Only a card with `onPress` measures anything. A decorative card has no hit area to correct.
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
  const [measuredHeight, setMeasuredHeight] = useState(0);

  const base: ViewStyle = {
    backgroundColor: tinted ? theme.wellSurface : moduleNeutrals.surface,
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
      /*
        Zero until the first layout lands, which yields an empty slop rather than a wrong one — the
        card is still fully tappable over its drawn area in that first frame, it simply has not been
        widened yet.
      */
      hitSlop={minimumHitSlop(measuredHeight)}
      onLayout={(event) => {
        const next = event.nativeEvent.layout.height;
        setMeasuredHeight((current) => (current === next ? current : next));
      }}
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
/**
 * A pair of cards side by side — or stacked, when side by side would cost content.
 *
 * ── Why this component owns the decision ────────────────────────────────────
 * Both of Faith Home's pairs and every future one ask the same question, and the answer has to be
 * the same for all of them: two cards that stack independently would leave a half-width card beside
 * a full-width one. `stackTwoColumns` is resolved once in `useModuleMetrics` from the measured
 * half-column and the OS text size, so the rule lives in one place and can be asserted directly.
 *
 * ── What changes and what does not ──────────────────────────────────────────
 * Only the axis. The cards keep their padding, colours, borders, icon sizes and internal hierarchy,
 * and the gap between them keeps its value — it simply becomes a row gap. Stacked cards are no
 * longer forced to equal heights either, which is the point: each one takes the height its own copy
 * needs, so a heading, a prayer label or an observance date renders in full instead of ellipsising
 * into a column too narrow to hold it.
 */
export function ModuleTwoColumn({ left, right, testID }: ModuleTwoColumnProps) {
  const { dp, stackTwoColumns } = useModuleMetrics();
  const gap = dp(moduleLayout.twoColumnGap);

  if (stackTwoColumns) {
    return (
      <View style={{ rowGap: gap }} testID={testID}>
        {/*
          No `styles.column` here. `flex: 1` on a column child of a *vertical* stack would make the
          two cards share the available height rather than each taking what its content needs, which
          is the opposite of why the pair stacked.
        */}
        <View>{left}</View>
        <View>{right}</View>
      </View>
    );
  }

  return (
    <View style={[styles.row, { columnGap: gap }]} testID={testID}>
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
      {/*
        Two lines, because one truncated the heading that names the card. Inside a half-width column
        "Today’s worship" beside a "View All" link rendered "Today’s w…" at 411 dp and font scale 1.3,
        and a heading is the last thing a screen should abbreviate — it is what tells the reader what
        the rows beneath it are. The heading row is content-height, so a second line grows it.

        Still capped rather than unbounded: the pairing with a trailing action means an unlimited
        heading could push the link into a column too narrow to read, and no heading in the app is
        long enough to need a third line.
      */}
      <ModuleText
        token="cardHeading"
        numberOfLines={2}
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
