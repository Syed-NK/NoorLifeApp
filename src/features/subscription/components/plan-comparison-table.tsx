import { StyleSheet, View } from 'react-native';

import { EntryAuthText } from '@features/entry-auth/components/entry-auth-text';
import { useEntryAuthMetrics } from '@features/entry-auth/use-entry-auth-metrics';

import { planNames } from '../subscription-copy';
import { subscriptionColors, subscriptionLayout } from '../subscription-tokens';
import { PlanBadge } from './plan-badge';

/**
 * A cell value.
 *
 * `true`/`false` render a mark; a string renders text, which is what the "Family accounts" row
 * needs — "1", "1", "6" says something a tick cannot.
 */
export type ComparisonValue = boolean | string;

export type ComparisonRow = {
  readonly label: string;
  readonly free: ComparisonValue;
  readonly single: ComparisonValue;
  readonly family: ComparisonValue;
  /** Renders the "Always included" badge beside the label. Faith only. */
  readonly alwaysIncluded?: boolean;
};

/**
 * The twelve comparison rows, in the order the brief lists them.
 *
 * Faith is first and carries `alwaysIncluded`. It is the only row true under every plan, and
 * putting it at the top is the point: the first thing a user reads on the comparison screen is
 * that the thing they came for is free.
 */
export const COMPARISON_ROWS: readonly ComparisonRow[] = [
  { label: 'Faith', free: true, single: true, family: true, alwaysIncluded: true },
  { label: 'Main Home', free: true, single: true, family: true },
  { label: 'Paid modules', free: false, single: true, family: true },
  { label: 'Module AI', free: false, single: true, family: true },
  { label: 'Advanced insights', free: false, single: true, family: true },
  { label: 'Cloud synchronization', free: false, single: true, family: true },
  { label: 'Family accounts', free: '1', single: '1', family: '6' },
  { label: 'Shared calendar', free: false, single: false, family: true },
  { label: 'Shared goals', free: false, single: false, family: true },
  { label: 'Family check-ins', free: false, single: false, family: true },
  { label: 'Memories', free: false, single: false, family: true },
  // True under every plan: privacy controls are not a paid upsell.
  { label: 'Privacy controls', free: true, single: true, family: true },
] as const;

export type PlanComparisonTableProps = {
  readonly rows?: readonly ComparisonRow[];
  readonly testID?: string;
};

/**
 * Free / Single / Family side by side.
 *
 * ── Fitting three columns without horizontal scrolling ──────────────────────
 * The content column is 361 dp at the baseline. Three 54 dp value columns leave ~190 dp for the
 * label, which fits every row's text at `caption` size without truncation. The brief forbids
 * horizontal scrolling, so the columns are sized to the narrowest supported width rather than
 * being allowed to overflow — the table shrinks with the page instead.
 *
 * ── Why each row is one accessible node ─────────────────────────────────────
 * Read cell by cell, a comparison table is meaningless: "Shared calendar", "no", "no", "yes" only
 * makes sense if you remember the column order. Each row therefore announces itself in full —
 * "Shared calendar: not included on Free, not included on Premium Single, included on Premium
 * Family" — which is the information a sighted user gets from the layout.
 */
export function PlanComparisonTable({ rows = COMPARISON_ROWS, testID }: PlanComparisonTableProps) {
  const { dp } = useEntryAuthMetrics();
  const columnWidth = dp(54);

  return (
    <View
      style={[
        styles.table,
        {
          borderRadius: dp(subscriptionLayout.cardRadius),
          backgroundColor: subscriptionColors.surface,
          borderColor: subscriptionColors.border,
        },
      ]}
      testID={testID}
    >
      {/* Header. Short plan words, since "Premium Single" cannot fit a 54 dp column. */}
      <View
        style={[
          styles.row,
          {
            paddingVertical: dp(9),
            paddingHorizontal: dp(11),
            borderBottomColor: subscriptionColors.border,
            backgroundColor: subscriptionColors.surfaceMuted,
          },
        ]}
        accessible
        accessibilityLabel={`Columns: ${planNames.free}, ${planNames.premium_single}, ${planNames.premium_family}`}
      >
        <View style={styles.labelCell} />
        {['Free', 'Single', 'Family'].map((heading) => (
          <View key={heading} style={[styles.valueCell, { width: columnWidth }]}>
            <EntryAuthText token="caption" color={subscriptionColors.textPrimary} align="center">
              {heading}
            </EntryAuthText>
          </View>
        ))}
      </View>

      {rows.map((row, index) => (
        <Row
          key={row.label}
          row={row}
          columnWidth={columnWidth}
          isLast={index === rows.length - 1}
          testID={`${testID ?? 'comparison'}-${row.label.toLowerCase().replace(/\s+/g, '-')}`}
        />
      ))}
    </View>
  );
}

function describe(value: ComparisonValue): string {
  if (value === true) {
    return 'included';
  }
  if (value === false) {
    return 'not included';
  }
  return value;
}

type RowProps = {
  readonly row: ComparisonRow;
  readonly columnWidth: number;
  readonly isLast: boolean;
  readonly testID: string;
};

function Row({ row, columnWidth, isLast, testID }: RowProps) {
  const { dp } = useEntryAuthMetrics();

  const spoken = `${row.label}: ${describe(row.free)} on ${planNames.free}, ${describe(
    row.single,
  )} on ${planNames.premium_single}, ${describe(row.family)} on ${planNames.premium_family}`;

  return (
    <View
      style={[
        styles.row,
        {
          paddingVertical: dp(9),
          paddingHorizontal: dp(11),
          borderBottomColor: subscriptionColors.border,
          borderBottomWidth: isLast ? 0 : StyleSheet.hairlineWidth,
        },
      ]}
      accessible
      accessibilityLabel={row.alwaysIncluded === true ? `${spoken}. Always included.` : spoken}
      testID={testID}
    >
      <View style={[styles.labelCell, { rowGap: dp(3) }]}>
        <EntryAuthText token="caption" color={subscriptionColors.textPrimary}>
          {row.label}
        </EntryAuthText>
        {row.alwaysIncluded === true ? (
          <PlanBadge label="Always included" tone="success" testID={`${testID}-always-included`} />
        ) : null}
      </View>
      <Cell value={row.free} width={columnWidth} testID={`${testID}-free`} />
      <Cell value={row.single} width={columnWidth} testID={`${testID}-single`} />
      <Cell value={row.family} width={columnWidth} testID={`${testID}-family`} />
    </View>
  );
}

type CellProps = {
  readonly value: ComparisonValue;
  readonly width: number;
  readonly testID: string;
};

function Cell({ value, width, testID }: CellProps) {
  const { dp } = useEntryAuthMetrics();

  return (
    <View style={[styles.valueCell, { width }]} testID={testID}>
      {typeof value === 'string' ? (
        <EntryAuthText token="label" color={subscriptionColors.textPrimary} align="center">
          {value}
        </EntryAuthText>
      ) : value ? (
        // Tick: two rotated borders, never an icon-font glyph.
        <View
          style={{
            width: dp(9),
            height: dp(5),
            borderLeftWidth: 2,
            borderBottomWidth: 2,
            borderColor: subscriptionColors.accent,
            transform: [{ rotate: '-45deg' }, { translateY: -dp(1) }],
          }}
        />
      ) : (
        <View style={{ width: dp(9), height: 2, backgroundColor: subscriptionColors.disabled }} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  table: {
    width: '100%',
    borderWidth: 1,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  labelCell: {
    flex: 1,
    paddingRight: 4,
  },
  valueCell: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
