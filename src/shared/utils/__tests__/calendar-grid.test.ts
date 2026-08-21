import { daysInGregorianMonth } from '@features/faith/data/calendar-day';
import {
  GRID_COLUMNS,
  WEEKDAY_LABELS,
  buildMonthGrid,
  dayOfMonth,
  daysInMonth,
  gridCellWidth,
  isoFor,
  monthLabel,
  monthOf,
  shiftMonth,
  spokenDate,
  weekdayColumn,
} from '../calendar-grid';

/**
 * The calendar arithmetic every month grid in the app depends on.
 *
 * These assert *properties* rather than a table of remembered months wherever possible — a table of
 * expected day counts is only as good as the person who typed it, and the point of this file is to
 * be more trustworthy than that.
 */

describe('daysInMonth', () => {
  it.each([
    ['31-day January', 2026, 1, 31],
    ['28-day February', 2026, 2, 28],
    ['31-day March', 2026, 3, 31],
    ['30-day April', 2026, 4, 30],
    ['30-day September', 2026, 9, 30],
    ['31-day December', 2026, 12, 31],
  ])('handles a %s', (_label, year, month, expected) => {
    expect(daysInMonth(year, month)).toBe(expected);
  });

  it.each([
    [2024, 29],
    [2028, 29],
    [2000, 29],
    [1900, 28],
    [2100, 28],
    [2026, 28],
  ])('gives February %i the right length: %i days', (year, expected) => {
    expect(daysInMonth(year, 2)).toBe(expected);
  });

  it('does not need a branch for December rolling into the next January', () => {
    expect(daysInMonth(2026, 12)).toBe(31);
    expect(daysInMonth(2026, 11)).toBe(30);
  });

  /*
    The Faith calendar computes this from Julian day numbers, this one from UTC civil dates. Two
    implementations of the same fact is a liability unless something holds them together, so this
    does: any disagreement over two centuries fails here rather than showing a user a month with the
    wrong number of days.
  */
  it('agrees with the Julian-day implementation across 1900-2100', () => {
    for (let year = 1900; year <= 2100; year += 1) {
      for (let month = 1; month <= 12; month += 1) {
        expect(daysInMonth(year, month)).toBe(daysInGregorianMonth(year, month));
      }
    }
  });

  it('only ever returns 28, 29, 30 or 31', () => {
    const seen = new Set<number>();
    for (let year = 1999; year <= 2035; year += 1) {
      for (let month = 1; month <= 12; month += 1) {
        seen.add(daysInMonth(year, month));
      }
    }
    expect([...seen].sort((a, b) => a - b)).toEqual([28, 29, 30, 31]);
  });
});

describe('weekdayColumn', () => {
  it('is Monday-first', () => {
    // 2026-08-17 is a Monday.
    expect(weekdayColumn('2026-08-17')).toBe(0);
    expect(weekdayColumn('2026-08-23')).toBe(6); // the Sunday after
  });

  it('stays inside the grid for every day of a year', () => {
    for (let month = 1; month <= 12; month += 1) {
      for (let day = 1; day <= daysInMonth(2026, month); day += 1) {
        const column = weekdayColumn(isoFor(2026, month, day));
        expect(column).toBeGreaterThanOrEqual(0);
        expect(column).toBeLessThan(GRID_COLUMNS);
      }
    }
  });

  it('advances by exactly one column per calendar day, wrapping at the week', () => {
    let previous = weekdayColumn('2026-01-01');
    for (let day = 2; day <= 31; day += 1) {
      const column = weekdayColumn(isoFor(2026, 1, day));
      expect(column).toBe((previous + 1) % GRID_COLUMNS);
      previous = column;
    }
  });

  it('returns a usable column rather than throwing on malformed input', () => {
    expect(weekdayColumn('')).toBe(0);
    expect(weekdayColumn('not-a-date')).toBe(0);
  });
});

describe('local date handling', () => {
  /*
    The defect this guards against: building a month from local `Date` values, where a
    spring-forward day resolves the missing hour forward and the day read back is the next one. Every
    function here constructs UTC, so the answer cannot depend on the machine's zone. Asserting it
    with the process's real zone plus a set of known DST transition dates is the closest a unit test
    gets to proving it without spawning a differently-zoned process.
  */
  it.each([
    ['spring forward, Europe', '2026-03-29'],
    ['spring forward, US', '2026-03-08'],
    ['autumn back, Europe', '2026-10-25'],
    ['autumn back, US', '2026-11-01'],
  ])('does not drift a day on a DST transition (%s)', (_label, iso) => {
    const address = monthOf(iso);
    expect(address).not.toBeNull();
    const grid = buildMonthGrid(address!);
    expect(grid.days).toContain(iso);
    // Every entry is the day it claims to be, read straight off the string.
    grid.days.forEach((day, index) => {
      expect(dayOfMonth(day)).toBe(index + 1);
    });
  });

  it('builds a month whose entries are contiguous and correctly counted', () => {
    for (let month = 1; month <= 12; month += 1) {
      const grid = buildMonthGrid({ year: 2026, month });
      expect(grid.days).toHaveLength(daysInMonth(2026, month));
      expect(grid.days[0]).toBe(isoFor(2026, month, 1));
      expect(grid.days[grid.days.length - 1]).toBe(
        isoFor(2026, month, daysInMonth(2026, month)),
      );
    }
  });

  it('puts the first of the month in its real weekday column', () => {
    for (let month = 1; month <= 12; month += 1) {
      const grid = buildMonthGrid({ year: 2026, month });
      expect(grid.leadingBlanks).toBe(weekdayColumn(isoFor(2026, month, 1)));
    }
  });

  it('never needs more than six rows, and never fewer than four', () => {
    for (let year = 2024; year <= 2030; year += 1) {
      for (let month = 1; month <= 12; month += 1) {
        const grid = buildMonthGrid({ year, month });
        expect(grid.rows).toBeGreaterThanOrEqual(4);
        expect(grid.rows).toBeLessThanOrEqual(6);
        expect(grid.rows).toBe(
          Math.ceil((grid.days.length + grid.leadingBlanks) / GRID_COLUMNS),
        );
      }
    }
  });

  it('gives a leap February 29 cells', () => {
    expect(buildMonthGrid({ year: 2024, month: 2 }).days).toHaveLength(29);
    expect(buildMonthGrid({ year: 2026, month: 2 }).days).toHaveLength(28);
  });
});

describe('shiftMonth', () => {
  it('crosses from December into the next January', () => {
    expect(shiftMonth({ year: 2026, month: 12 }, 1)).toEqual({ year: 2027, month: 1 });
  });

  it('crosses from January back into the previous December', () => {
    expect(shiftMonth({ year: 2026, month: 1 }, -1)).toEqual({ year: 2025, month: 12 });
  });

  it('is reversible for every month of a year', () => {
    for (let month = 1; month <= 12; month += 1) {
      const start = { year: 2026, month };
      expect(shiftMonth(shiftMonth(start, 1), -1)).toEqual(start);
      expect(shiftMonth(shiftMonth(start, -1), 1)).toEqual(start);
    }
  });

  it('walks a full year forward and lands on the same month one year later', () => {
    let cursor = { year: 2026, month: 5 };
    for (let step = 0; step < 12; step += 1) {
      cursor = shiftMonth(cursor, 1);
    }
    expect(cursor).toEqual({ year: 2027, month: 5 });
  });

  it('always produces a month between 1 and 12', () => {
    for (let delta = -40; delta <= 40; delta += 1) {
      const { month } = shiftMonth({ year: 2026, month: 1 }, delta);
      expect(month).toBeGreaterThanOrEqual(1);
      expect(month).toBeLessThanOrEqual(12);
    }
  });
});

describe('labels', () => {
  it('names the month and year', () => {
    expect(monthLabel({ year: 2026, month: 9 })).toBe('September 2026');
    expect(monthLabel({ year: 2027, month: 1 })).toBe('January 2027');
  });

  it('offers seven weekday headings, Monday first', () => {
    expect(WEEKDAY_LABELS).toHaveLength(GRID_COLUMNS);
    expect(WEEKDAY_LABELS[0]).toBe('Mon');
    expect(WEEKDAY_LABELS[6]).toBe('Sun');
  });

  it('speaks a whole date, so a grid cell is not just a number', () => {
    expect(spokenDate('2026-08-17')).toBe('Monday, 17 August 2026');
    expect(spokenDate('2026-02-29')).not.toContain('undefined');
  });

  it('returns the input unchanged when it cannot be parsed', () => {
    expect(spokenDate('nonsense')).toBe('nonsense');
  });

  it('zero-pads so every key is comparable as a string', () => {
    expect(isoFor(2026, 1, 5)).toBe('2026-01-05');
    expect(isoFor(2026, 12, 31)).toBe('2026-12-31');
  });

  it('rejects a month outside 1-12 rather than inventing one', () => {
    expect(monthOf('2026-13-01')).toBeNull();
    expect(monthOf('2026-00-01')).toBeNull();
    expect(monthOf('2026-09-15')).toEqual({ year: 2026, month: 9 });
  });
});

describe('gridCellWidth', () => {
  it('fits seven cells inside the card track', () => {
    for (const width of [320, 360, 361, 384, 411, 480, 768]) {
      for (const padding of [10, 11, 14]) {
        const cell = gridCellWidth(width, padding);
        const available = width - padding * 2 - 2;
        expect(cell * GRID_COLUMNS).toBeLessThanOrEqual(available);
        // ...and wastes less than a whole column doing it.
        expect(available - cell * GRID_COLUMNS).toBeLessThan(GRID_COLUMNS);
      }
    }
  });
});
