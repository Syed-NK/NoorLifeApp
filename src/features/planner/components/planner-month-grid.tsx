import { StyleSheet, View } from 'react-native';

import { PressableScale } from '@ds/components';
import { ModuleText } from '@features/modules/components';
import { useModuleTheme } from '@features/modules/module-context';
import { moduleLayout, moduleNeutrals } from '@features/modules/module-tokens';
import { useModuleMetrics } from '@features/modules/use-module-metrics';
import { minimumHitSlop } from '@shared/utils/a11y';
import {
  WEEKDAY_LABELS,
  dayOfMonth,
  gridCellWidth,
  spokenDate,
  type MonthGrid,
} from '@shared/utils/calendar-grid';

import type { PlannerDayIndicator } from '../data/planner-calendar';

/**
 * **The month grid** — seven columns of days, each marked only if the user put something there.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── Why this is not the Faith calendar's grid ──────────────────────────────
 * It renders the same shape and shares the arithmetic (`gridCellWidth`, the Monday-first column, the
 * spoken-date convention all come from `@shared/utils/calendar-grid`), but the cell contents differ:
 * a Hijri day carries two calendars and an observance, a Planner day carries a Gregorian number and
 * a count of the user's own tasks. Sharing the component would mean a props union that satisfies
 * neither; sharing the arithmetic is what actually needed to be shared, and that is shared.
 *
 * ── What a dot may mean ────────────────────────────────────────────────────
 * A dot means *this day has at least one task of yours*. It never means a holiday, a routine, a
 * prayer, a suggestion or a sample. And it is a **secondary** signal: the selected-day list below
 * names every task in words, because a dot alone is not information a colour-blind or screen-reader
 * user can act on. The spoken label carries the count for the same reason.
 * ═══════════════════════════════════════════════════════════════════════════
 */

export type PlannerMonthGridProps = {
  readonly month: MonthGrid;
  readonly indicators: ReadonlyMap<string, PlannerDayIndicator>;
  /** Today in the device's local calendar, so "today" is the user's today. */
  readonly today: string;
  readonly selected: string;
  readonly onSelect: (day: string) => void;
  readonly testID?: string;
};

export function PlannerMonthGrid({
  month,
  indicators,
  today,
  selected,
  onSelect,
  testID,
}: PlannerMonthGridProps) {
  const theme = useModuleTheme();
  const { dp, contentWidth } = useModuleMetrics();
  const id = testID ?? 'planner-calendar-grid';
  const cell = gridCellWidth(contentWidth, dp(moduleLayout.cardPadding));

  return (
    <View testID={id}>
      <View style={styles.row}>
        {WEEKDAY_LABELS.map((label) => (
          <View key={label} style={{ width: cell, alignItems: 'center' }}>
            {/*
              Decorative. Every day cell speaks its own full date, so reading seven abbreviations
              first would only delay the content.
            */}
            <ModuleText token="chartAxis" numberOfLines={1} accessibilityElementsHidden>
              {label}
            </ModuleText>
          </View>
        ))}
      </View>
      <View style={[styles.row, styles.wrap]}>
        {/*
          Spacers so the 1st sits under its real weekday. Keyed with a distinct prefix so they
          cannot collide with the day keys below.
        */}
        {Array.from({ length: month.leadingBlanks }, (_, index) => (
          <View key={`lead-${index}`} style={{ width: cell, height: cell }} />
        ))}
        {month.days.map((day) => {
          const isToday = day === today;
          const isSelected = day === selected;
          const entry = indicators.get(day);
          const total = entry === undefined ? 0 : entry.open + entry.completed;
          return (
            <PressableScale
              key={day}
              onPress={() => onSelect(day)}
              accessibilityRole="button"
              accessibilityState={{ selected: isSelected }}
              /*
                The whole date, plus what is on it. A bare "15" read out of a grid tells a
                screen-reader user neither which month they are in nor whether the day is worth
                opening.
              */
              accessibilityLabel={`${spokenDate(day)}${isToday ? ', today' : ''}${
                total === 0 ? '' : `, ${total} ${total === 1 ? 'task' : 'tasks'}`
              }${isSelected ? ', selected' : ''}`}
              hitSlop={minimumHitSlop(cell)}
              style={{ width: cell, height: cell, alignItems: 'center', justifyContent: 'center' }}
              testID={`${id}-day-${day}`}
            >
              <View
                style={[
                  styles.cell,
                  {
                    width: cell - dp(6),
                    height: cell - dp(6),
                    borderRadius: cell,
                    backgroundColor: isSelected ? theme.fill : 'transparent',
                    /*
                      Today is outlined, the selection is filled. Two states that can coexist on one
                      cell need two different devices, or the day you picked and the day it happens
                      to be become indistinguishable.
                    */
                    borderWidth: isToday && !isSelected ? dp(1.5) : 0,
                    borderColor: theme.border,
                  },
                ]}
              >
                <ModuleText
                  token="rowLabel"
                  color={isSelected ? theme.onFill : moduleNeutrals.textPrimary}
                  numberOfLines={1}
                >
                  {String(dayOfMonth(day))}
                </ModuleText>
                {total === 0 ? null : (
                  <View
                    testID={`${id}-dot-${day}`}
                    style={{
                      width: dp(4),
                      height: dp(4),
                      borderRadius: dp(4),
                      marginTop: dp(1),
                      backgroundColor: isSelected ? theme.onFill : theme.fill,
                    }}
                  />
                )}
              </View>
            </PressableScale>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
  },
  wrap: {
    flexWrap: 'wrap',
  },
  cell: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
