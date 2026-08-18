import { StyleSheet, View } from 'react-native';

import { PressableScale } from '@ds/components';
import { ModuleText } from '@features/modules/components';
import { useModuleTheme } from '@features/modules/module-context';
import { moduleLayout, moduleNeutrals } from '@features/modules/module-tokens';
import { useModuleMetrics } from '@features/modules/use-module-metrics';
import { minimumHitSlop } from '@shared/utils/a11y';

import type { CalendarMonth } from '../data/faith-calendar.repository';

/**
 * A Hijri month drawn as a month.
 *
 * ── What this replaces ──────────────────────────────────────────────────────
 * A vertical `FaithRowGroup` of up to thirty rows — "1 Safar / 2026-07-17", "2 Safar / 2026-07-18",
 * one under the next. It was accurate and unreadable: a calendar's whole purpose is to show a date
 * *in relation to* the days around it, and a list can only show sequence. Finding which day of the
 * week the 12th falls on meant counting rows.
 *
 * ── Why the columns are Gregorian weekdays ──────────────────────────────────
 * A Hijri month does not begin on a fixed weekday, so the leading cells are blank until the first
 * of the month lands in its real column. That offset is computed from each day's **Gregorian**
 * date, which is the one the repository states and the one the device's week is aligned to.
 *
 * ── Why `Date.UTC` and not `new Date(iso)` ──────────────────────────────────
 * `new Date('2026-07-17')` is parsed as UTC midnight but read back through the device's zone, so
 * west of Greenwich it reports the previous day — and the whole grid shifts by one column for
 * anybody in the Americas. Parsing the parts and asking `getUTCDay()` keeps the weekday a property
 * of the date rather than of where the phone is.
 */

/** Monday-first, matching the reference's column order. */
const WEEKDAYS: readonly string[] = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** The card's own border, top/bottom/left/right, as `ModuleCard` draws it. */
const CARD_BORDER = 1;

/** How many columns a week has. Named so the arithmetic below is not a bare 7. */
export const GRID_COLUMNS = 7;

/**
 * The width of one day cell, given the page column and the card's padding.
 *
 * ── Why the card's *border* is in this arithmetic ───────────────────────────
 * It was not, and that cost an entire column. `contentWidth` is the page column; the card takes its
 * padding from both sides **and** its 1 dp border from both sides. Dividing the un-debited track by
 * seven made each cell ~0.3 dp too wide, so seven no longer fitted and `flexWrap` pushed the last
 * one onto the next row — Sunday rendered permanently empty and every date sat one column to the
 * left of its real weekday. On a calendar, that is not a cosmetic error: it tells the user the
 * wrong day of the week for every date in the month.
 *
 * `Math.floor` is belt and braces on top of the correction. A fractional cell width can still round
 * up in the compositor; flooring guarantees seven fit and wastes at most a fraction of a dp on the
 * trailing edge.
 *
 * Exported so the guarantee — seven cells fit the track — is asserted arithmetically rather than
 * inferred from a screenshot.
 */
export function gridCellWidth(contentWidth: number, cardPadding: number): number {
  const track = contentWidth - cardPadding * 2 - CARD_BORDER * 2;
  return Math.floor(track / GRID_COLUMNS);
}

/** Column index (0 = Monday) for an ISO `YYYY-MM-DD` date. */
export function weekdayColumn(iso: string): number {
  const [year, month, day] = iso.split('-').map(Number);
  if (year === undefined || month === undefined || day === undefined) {
    return 0;
  }
  const sundayFirst = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return (sundayFirst + 6) % 7;
}

export type HijriMonthGridProps = {
  readonly month: CalendarMonth;
  /** Today's Gregorian ISO date, so "today" is decided once by the caller. */
  readonly todayGregorian: string;
  /** The selected day's Gregorian ISO date, or null when none is chosen. */
  readonly selectedGregorian: string | null;
  readonly onSelect: (gregorian: string) => void;
  readonly testID?: string;
};

export function HijriMonthGrid({
  month,
  todayGregorian,
  selectedGregorian,
  onSelect,
  testID,
}: HijriMonthGridProps) {
  const theme = useModuleTheme();
  const { dp, contentWidth } = useModuleMetrics();

  const id = testID ?? 'faith-calendar-grid';
  const cell = gridCellWidth(contentWidth, dp(moduleLayout.cardPadding));

  const first = month.days[0];
  const leading = first === undefined ? 0 : weekdayColumn(first.gregorian);

  return (
    <View testID={id}>
      <View style={styles.row}>
        {WEEKDAYS.map((label) => (
          <View key={label} style={{ width: cell, alignItems: 'center' }}>
            {/*
              Decorative: the day cells below each carry a full spoken date, so a screen reader
              reading seven weekday abbreviations first would only add noise.
            */}
            <ModuleText token="chartAxis" numberOfLines={1} accessibilityElementsHidden>
              {label}
            </ModuleText>
          </View>
        ))}
      </View>

      <View style={[styles.row, styles.wrap]}>
        {/*
          Blank leading cells, so the first of the month sits in its real weekday column. They are
          spacers, not days — no key collision with the days below because the prefix differs.
        */}
        {Array.from({ length: leading }, (_, index) => (
          <View key={`lead-${index}`} style={{ width: cell, height: cell }} />
        ))}

        {month.days.map((entry) => {
          const isToday = entry.gregorian === todayGregorian;
          const isSelected = entry.gregorian === selectedGregorian;
          const hasObservance = entry.observanceIds.length > 0;

          return (
            <PressableScale
              key={entry.gregorian}
              onPress={() => onSelect(entry.gregorian)}
              accessibilityRole="button"
              accessibilityState={{ selected: isSelected }}
              /*
                The spoken label is the whole date in both calendars, because a bare number read out
                of a grid tells a screen-reader user nothing about which month or year they are in.
              */
              accessibilityLabel={`${entry.hijri.formatted}, ${entry.gregorian}${
                isToday ? ', today' : ''
              }${hasObservance ? ', has an observance' : ''}`}
              hitSlop={minimumHitSlop(cell)}
              style={{ width: cell, height: cell, alignItems: 'center', justifyContent: 'center' }}
              testID={`${id}-day-${entry.hijri.day}`}
            >
              <View
                style={[
                  styles.cell,
                  {
                    width: cell - dp(6),
                    height: cell - dp(6),
                    borderRadius: cell,
                    backgroundColor: isToday ? theme.fill : 'transparent',
                    borderWidth: isSelected && !isToday ? dp(1.5) : 0,
                    borderColor: theme.border,
                  },
                ]}
              >
                <ModuleText
                  token="rowLabel"
                  color={isToday ? theme.onFill : moduleNeutrals.textPrimary}
                  numberOfLines={1}
                >
                  {String(entry.hijri.day)}
                </ModuleText>
                {/*
                  A gold dot marks a day carrying an observance. It is a *secondary* signal — the
                  selected-day card below names the observance in words — because a dot alone is
                  not information a colour-blind or screen-reader user can act on.
                */}
                {hasObservance ? (
                  <View
                    style={{
                      width: dp(4),
                      height: dp(4),
                      borderRadius: dp(4),
                      marginTop: dp(1),
                      backgroundColor: isToday ? theme.onFill : GOLD_DOT,
                    }}
                  />
                ) : null}
              </View>
            </PressableScale>
          );
        })}
      </View>
    </View>
  );
}

/** Faith's supporting gold, for the observance dot. */
const GOLD_DOT = '#C99B45';

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
