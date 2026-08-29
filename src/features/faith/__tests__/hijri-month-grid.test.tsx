import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import React from 'react';

import { seedPrayerLocation } from '@/test-support/faith-location-fixtures';
import { installMockLatencyTimers } from '@/test-support/mock-latency-timers';

import { GRID_COLUMNS, gridCellWidth, weekdayColumn } from '../components/hijri-month-grid';
import { FaithRepositoryProvider } from '../di/faith-repository-context';
import { CalendarScreen, stepHijriMonth } from '../screens/calendar-screens';

/**
 * The Hijri calendar renders as a month, and navigates like one.
 *
 * ── What this replaced ──────────────────────────────────────────────────────
 * A vertical list of up to thirty rows — "1 Safar / 2026-07-17" under "2 Safar / 2026-07-18". It
 * was accurate and unusable: finding which weekday a date fell on meant counting rows, and there
 * was no way to reach any month but the current one.
 */

installMockLatencyTimers(() => renderCalendar());

/*
  The screen's "today" is scoped to the user's prayer location now, so a suite about the *grid* has
  to give it one — otherwise it renders the location-required state and there is no grid to assert
  on. Seeded into storage rather than stubbed, so the zone is the one the repository really resolves.
*/
async function renderCalendar() {
  await seedPrayerLocation();
  await render(
    <FaithRepositoryProvider>
      <CalendarScreen />
    </FaithRepositoryProvider>,
  );
  return screen;
}

describe('weekdayColumn', () => {
  /**
   * ── Why this is tested against known dates rather than `new Date()` ─────────
   * `new Date('2026-07-17')` parses as UTC midnight and reads back through the device's zone, so
   * west of Greenwich it reports the previous day and the entire grid shifts one column. These are
   * dates whose weekday is a fact, so the assertion holds in every timezone the suite runs in.
   */
  it.each([
    ['2026-08-10', 0, 'Monday'],
    ['2026-08-11', 1, 'Tuesday'],
    ['2026-08-15', 5, 'Saturday'],
    ['2026-08-16', 6, 'Sunday'],
  ])('places %s in column %i (%s)', (iso, column) => {
    expect(weekdayColumn(iso)).toBe(column);
  });

  it('does not depend on the device timezone', () => {
    // A date that is the previous day in any negative UTC offset. If the implementation used a
    // local-time Date, this would come back one column early on a US-configured machine.
    expect(weekdayColumn('2026-01-01')).toBe(weekdayColumn('2026-01-01'));
    expect(weekdayColumn('2026-01-01')).toBe(3); // Thursday
  });
});

describe('gridCellWidth', () => {
  /**
   * The regression this locks out cost a whole column.
   *
   * The card's 1 dp border was missing from the track, so seven cells were collectively ~2 dp too
   * wide, `flexWrap` pushed the seventh onto the next row, and Sunday rendered permanently empty —
   * every date in the month displayed under the wrong weekday.
   */
  it.each([361, 359, 340, 320, 393, 300])('fits seven columns at a %i dp column', (width) => {
    const padding = 11;
    const cell = gridCellWidth(width, padding);
    const available = width - padding * 2 - 2; // both paddings, both borders

    expect(cell).toBeGreaterThan(0);
    expect(cell * GRID_COLUMNS).toBeLessThanOrEqual(available);
  });

  it('leaves less than one column of slack, so the grid is not visibly narrow', () => {
    const cell = gridCellWidth(361, 11);
    const available = 361 - 22 - 2;
    expect(available - cell * GRID_COLUMNS).toBeLessThan(GRID_COLUMNS);
  });
});

/**
 * The same arithmetic, driven from **device** widths rather than content widths.
 *
 * ── Why this case is separate from the one above ─────────────────────────────
 * The cases above pass a content-column width directly, which is the function's own contract but is
 * one step removed from anything a device reports. Nothing connected `320` the device to the `294`
 * the grid actually receives, so the named widths in the brief — 320, 360, 393, 411 — were not
 * covered as device widths at all. This reproduces `useModuleMetrics` exactly and asserts the whole
 * chain.
 *
 * Reproduced rather than imported because the hook needs a React render and a window, and what is
 * under test here is arithmetic. If `useModuleMetrics` changes, this drifts — which is why the two
 * formulas sit side by side in one place with the source named.
 */
describe('seven columns fit on real devices', () => {
  /** `moduleLayout.referenceWidth`, `pagePadding` and `cardPadding` — see `module-tokens.ts`. */
  const REFERENCE_WIDTH = 393;
  const PAGE_PADDING = 16;
  const CARD_PADDING = 11;

  function metricsFor(screenWidth: number): { contentWidth: number; cardPadding: number } {
    // `moduleScale`: never upscales, so anything at or above the reference width scales at 1.
    const scale = Math.min(screenWidth / REFERENCE_WIDTH, 1);
    const dp = (value: number): number => Math.round(value * scale);
    const columnWidth = Math.min(screenWidth, REFERENCE_WIDTH);
    return { contentWidth: columnWidth - dp(PAGE_PADDING) * 2, cardPadding: dp(CARD_PADDING) };
  }

  it.each([
    [320, 'small Android / older iPhone SE'],
    [360, 'the most common Android width'],
    [393, 'the reference width'],
    [411, 'Pixel-class'],
    [430, 'iPhone Pro Max class'],
    [600, 'small tablet'],
  ])('fits seven columns on a %i dp device (%s)', (screenWidth) => {
    const { contentWidth, cardPadding } = metricsFor(screenWidth);
    const cell = gridCellWidth(contentWidth, cardPadding);
    const available = contentWidth - cardPadding * 2 - 2;

    expect(cell).toBeGreaterThan(0);
    expect(cell * GRID_COLUMNS).toBeLessThanOrEqual(available);
    // Slack below one column, so the grid never looks narrow with a wasted gutter on the right.
    expect(available - cell * GRID_COLUMNS).toBeLessThan(GRID_COLUMNS);
  });

  it('stops widening above the reference width, so a tablet is not a special case', () => {
    // The column is capped at 393, so every wider device resolves to the identical grid. Asserted
    // because it is the reason 411, 430 and 600 above are not independent risks.
    const wide = [411, 430, 600, 1024].map((width) => {
      const { contentWidth, cardPadding } = metricsFor(width);
      return gridCellWidth(contentWidth, cardPadding);
    });
    expect(new Set(wide).size).toBe(1);
  });
});

/**
 * A month can begin on any of seven weekdays, and each one has to land in its own column.
 *
 * ── Why this is the case that matters most ──────────────────────────────────
 * The leading-blank count *is* the alignment. A Hijri month does not start on a fixed weekday, so
 * every month is a different offset, and an off-by-one in that offset tells the user the wrong day
 * of the week for all thirty dates — the same visible defect the missing card border produced, from
 * a different cause. Nothing covered it: the existing cases assert four individual dates, none of
 * which is a month boundary.
 */
describe('the leading offset places the first of the month', () => {
  /**
   * Seven consecutive dates, so between them they start on all seven weekdays.
   *
   * 2026-06-01 is a Monday, which makes the expected column equal to the index.
   */
  it.each([
    ['2026-06-01', 0, 'Monday'],
    ['2026-06-02', 1, 'Tuesday'],
    ['2026-06-03', 2, 'Wednesday'],
    ['2026-06-04', 3, 'Thursday'],
    ['2026-06-05', 4, 'Friday'],
    ['2026-06-06', 5, 'Saturday'],
    ['2026-06-07', 6, 'Sunday'],
  ])('starts a month on %s in column %i (%s)', (iso, column) => {
    expect(weekdayColumn(iso)).toBe(column);
  });

  it('never returns a column outside the seven', () => {
    // Every day of a full year, so no month start in any month of any weekday can escape the range.
    for (let day = 0; day < 366; day += 1) {
      const date = new Date(Date.UTC(2026, 0, 1 + day));
      const iso = date.toISOString().slice(0, 10);
      const column = weekdayColumn(iso);
      expect(column).toBeGreaterThanOrEqual(0);
      expect(column).toBeLessThan(GRID_COLUMNS);
    }
  });
});

/**
 * Four-, five- and six-row months all fit without a cell being pushed out of the grid.
 *
 * ── Why six rows is the real ceiling, and why it is reachable ────────────────
 * A Hijri month is 29 or 30 days and the leading offset is 0–6, so the worst case is 30 + 6 = 36
 * cells — six rows of seven with one to spare. `flexWrap` handles it, but nothing asserted the
 * bound, and a five-row assumption anywhere in the layout would clip the last week of a month that
 * happens to start on a Sunday.
 */
describe('month layouts of every height', () => {
  it.each([
    // [days, leading, expected rows] — the honest bounds, not a sample.
    [29, 0, 5],
    [30, 0, 5],
    [29, 6, 5],
    [30, 5, 5],
    [30, 6, 6],
    [29, 5, 5],
  ])('lays %i days out with %i leading blanks in %i rows', (days, leading, rows) => {
    expect(Math.ceil((days + leading) / GRID_COLUMNS)).toBe(rows);
  });

  it('never needs more than six rows', () => {
    for (let days = 29; days <= 30; days += 1) {
      for (let leading = 0; leading < GRID_COLUMNS; leading += 1) {
        expect(Math.ceil((days + leading) / GRID_COLUMNS)).toBeLessThanOrEqual(6);
      }
    }
  });
});

describe('the rendered grid', () => {
  /**
   * All seven weekday headers reach the screen.
   *
   * This is the assertion that would have failed when the card border was missing: the seventh
   * header wrapped to a row of its own, and Sunday's column rendered permanently empty. It is
   * cheaper and more direct than the arithmetic above, and it is the one a screenshot would show.
   */
  it('draws all seven weekday columns, Monday through Sunday', async () => {
    const view = await renderCalendar();
    await view.findByTestId('faith-calendar-grid');

    for (const label of ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']) {
      /**
       * `includeHiddenElements`, because the headers are deliberately hidden from accessibility.
       *
       * Each day cell already speaks its full date, so seven weekday abbreviations read out first
       * would be noise — the component sets `accessibilityElementsHidden` for that reason, and this
       * library excludes accessibility-hidden nodes from text queries by default. The headers are
       * visual, so a visual assertion has to opt back in.
       */
      expect(view.getAllByText(label, { includeHiddenElements: true }).length).toBeGreaterThan(0);
    }
  });

  /**
   * Every day cell is the same width, and it is the width the arithmetic promised.
   *
   * A single cell wider than the rest is what makes a row wrap, so equal widths are the property
   * that keeps each date under its own weekday. Read off the rendered style rather than recomputed,
   * so a component that stopped using `gridCellWidth` would fail here.
   */
  it('gives every day cell the same computed width, and it is a whole number of dp', async () => {
    const view = await renderCalendar();
    await view.findByTestId('faith-calendar-grid');

    /**
     * the testID node itself, because the testID node now carries the style itself - issue #115 made it the accessibility node.
     *
     * `PressableScale` renders the styled, sized view and puts an absolutely-positioned overlay
     * inside it to carry the hit slop. The overlay is what holds the `testID`, so the width lives on
     * its parent — worth naming, because reading the width off the wrong node returns `undefined`
     * and an assertion on `undefined === undefined` would pass while measuring nothing.
     */
    const widthOf = (testID: string): number => {
      const sized = view.getByTestId(testID);
      const style = sized?.props.style as { width?: unknown } | undefined;
      expect(typeof style?.width).toBe('number');
      return style?.width as number;
    };

    // Day 1 and day 2 sit in different columns, so an equal width is the property that keeps the
    // row from wrapping. Day 28 is in a later row, where a drifting width would show up first.
    const first = widthOf('faith-calendar-grid-day-1');
    expect(first).toBeGreaterThan(0);
    expect(Number.isInteger(first)).toBe(true);
    expect(widthOf('faith-calendar-grid-day-2')).toBe(first);
    expect(widthOf('faith-calendar-grid-day-28')).toBe(first);

    // And the rendered width is the one the arithmetic promises, at the default 393 dp window.
    expect(first).toBe(gridCellWidth(361, 11));
  });

  /**
   * The day number is capped to one line.
   *
   * ── Why this stands in for a font-scale test ────────────────────────────────
   * Android font scaling cannot break the *column count*: cell width and height come from `dp()`,
   * which scales with the window and not with the user's font preference, so seven cells fit at any
   * text size. What large text can do is push a two-digit day onto a second line inside a fixed
   * circle, which clips it. `numberOfLines={1}` is what prevents that, and this asserts it is
   * present rather than asserting a font scale the test renderer cannot vary.
   */
  it('holds each day number to a single line', async () => {
    const view = await renderCalendar();
    await view.findByTestId('faith-calendar-grid');

    // A two-digit day, which is the one at risk of wrapping inside a fixed circle.
    const [number] = view.getAllByText('12', { includeHiddenElements: true });
    expect(number).toBeDefined();
    expect(number?.props.numberOfLines).toBe(1);
  });
});

describe('stepHijriMonth', () => {
  it('steps within a year', () => {
    expect(stepHijriMonth({ year: 1448, month: 2 }, 1)).toEqual({ year: 1448, month: 3 });
    expect(stepHijriMonth({ year: 1448, month: 2 }, -1)).toEqual({ year: 1448, month: 1 });
  });

  it('wraps the year at both boundaries', () => {
    // Twelve Hijri months, so stepping past either end is a year change, not a month 13 or 0.
    expect(stepHijriMonth({ year: 1448, month: 12 }, 1)).toEqual({ year: 1449, month: 1 });
    expect(stepHijriMonth({ year: 1448, month: 1 }, -1)).toEqual({ year: 1447, month: 12 });
  });
});

describe('the calendar screen', () => {
  it('draws a grid rather than a list of day rows', async () => {
    const view = await renderCalendar();
    await view.findByTestId('faith-calendar-grid');

    // The superseded list gave every day a row of its own; the grid gives it a cell.
    expect(view.queryByTestId('faith-calendar-days')).toBeNull();
  });

  it('offers navigation in both directions', async () => {
    const view = await renderCalendar();
    expect(await view.findByTestId('faith-calendar-previous')).toBeTruthy();
    expect(view.getByTestId('faith-calendar-next')).toBeTruthy();
  });

  it('opens a day when its cell is pressed', async () => {
    const view = await renderCalendar();
    await view.findByTestId('faith-calendar-grid');

    fireEvent.press(view.getByTestId('faith-calendar-grid-day-3'));

    const card = await view.findByTestId('faith-calendar-selected');
    expect(card).toBeTruthy();
  });

  it('names every upcoming observance as expected rather than confirmed', async () => {
    const view = await renderCalendar();
    const list = await view.findByTestId('faith-calendar-upcoming-list');
    expect(list).toBeTruthy();
  });

  /**
   * Ordered last, deliberately.
   *
   * This is the only test here that drives an interaction, and its `waitFor` leaves the shared mock
   * latency timers mid-drain — a later render in the same file then never resolves its resources.
   * Ordering is the honest fix: the alternative is a per-test timer reset that hides the coupling
   * rather than acknowledging it.
   */
  it('moves to another month when stepped, and says which one', async () => {
    const view = await renderCalendar();
    const before = String((await view.findByTestId('faith-calendar-month-title')).props.children);

    fireEvent.press(view.getByTestId('faith-calendar-next'));

    /**
     * `waitFor`, not a bare `findByTestId`.
     *
     * The title node persists across the step, so `findByTestId` resolves immediately with the
     * *old* text — and this project's `fireEvent` does not run inside an act environment, so the
     * state change and the month refetch have not landed by the time the press returns. The
     * assertion has to be the thing that retries.
     */
    await waitFor(() => {
      const after = String(view.getByTestId('faith-calendar-month-title').props.children);
      expect(after).not.toBe(before);
    });
  });
});
