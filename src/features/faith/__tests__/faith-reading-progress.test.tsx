import AsyncStorage from '@react-native-async-storage/async-storage';
import { seedTranslationPreference } from '@/test-support/faith-preferences-fixtures';
import { render, fireEvent, screen } from '@testing-library/react-native';
import React, { type ReactElement } from 'react';

import { warmUpFirstMount } from '@/test-support/mock-latency-timers';

import { setRouteParams } from '../../../../jest.setup';

import { createMockFaithRepositories } from '../data/mock';
import { FaithRepositoryProvider } from '../di/faith-repository-context';
import { todayIsoDate } from '../hooks/use-reading-log';
import { ProgressScreen } from '../screens/progress-screen';
import { ReaderScreen } from '../screens/reader-screen';
import {
  applyReading,
  clampGoal,
  daysMetGoal,
  DEFAULT_DAILY_GOAL,
  emptyReadingLog,
  MAX_DAILY_GOAL,
  MIN_DAILY_GOAL,
  readOn,
  recentDays,
  recordReading,
  readReadingLog,
  setDailyGoal,
  surahProgress,
  totalAyatRead,
  type ReadingLog,
} from '../storage/faith-reading-log';

/**
 * Reading progress is measured, and measures only what happened.
 *
 * ── The rule under test ─────────────────────────────────────────────────────
 * An ayah counts as read when the reader's furthest position in that surah advances past it. The
 * cases below assert both halves of that: what it counts, and — more importantly — the four things
 * it must never count. Rendering a screen, re-opening a surah, scrolling back, and loading a page
 * all leave the total untouched.
 *
 * `faith-reading-log.ts` records why the two more obvious rules (on-render, on-scroll-with-dwell)
 * were rejected.
 */
warmUpFirstMount(() => withRepositories(<ProgressScreen />));

beforeEach(async () => {
  await AsyncStorage.clear();
  // A chosen translation is a precondition of these cases, not their subject.
  await seedTranslationPreference();
});

async function withRepositories(element: ReactElement): Promise<typeof screen> {
  await render(
    <FaithRepositoryProvider repositories={createMockFaithRepositories()}>
      {element}
    </FaithRepositoryProvider>,
  );
  return screen;
}

const DAY = '2026-08-10';

describe('the read rule', () => {
  it('counts the verses the furthest position advanced by', () => {
    const first = applyReading(emptyReadingLog, 18, 12, DAY);
    expect(first.added).toBe(12);
    expect(first.log.furthest['18']).toBe(12);
    expect(first.log.days[DAY]).toBe(12);

    // Advancing to 32 adds the twenty verses between, not thirty-two again.
    const second = applyReading(first.log, 18, 32, DAY);
    expect(second.added).toBe(20);
    expect(second.log.furthest['18']).toBe(32);
    expect(second.log.days[DAY]).toBe(32);
  });

  it('counts nothing for re-reading the same verse', () => {
    const first = applyReading(emptyReadingLog, 18, 32, DAY);
    const again = applyReading(first.log, 18, 32, DAY);

    expect(again.added).toBe(0);
    expect(again.log).toBe(first.log);
    expect(again.log.days[DAY]).toBe(32);
  });

  it('counts nothing for going back', () => {
    // Scrolling back to an earlier verse is real reading, and it is not *new* reading. Counting it
    // would let a user inflate the total by moving up and down a surah.
    const first = applyReading(emptyReadingLog, 18, 32, DAY);
    const back = applyReading(first.log, 18, 5, DAY);

    expect(back.added).toBe(0);
    expect(back.log.furthest['18']).toBe(32);
  });

  it('tracks surahs independently', () => {
    let log = applyReading(emptyReadingLog, 18, 32, DAY).log;
    log = applyReading(log, 2, 10, DAY).log;

    expect(log.furthest['18']).toBe(32);
    expect(log.furthest['2']).toBe(10);
    expect(log.days[DAY]).toBe(42);
  });

  it('files reading under the day it happened', () => {
    let log = applyReading(emptyReadingLog, 18, 10, '2026-08-09').log;
    log = applyReading(log, 18, 20, '2026-08-10').log;

    expect(log.days['2026-08-09']).toBe(10);
    expect(log.days['2026-08-10']).toBe(10);
  });
});

describe('the daily goal', () => {
  it('starts at a target a first day can meet', () => {
    expect(emptyReadingLog.dailyGoal).toBe(DEFAULT_DAILY_GOAL);
    expect(DEFAULT_DAILY_GOAL).toBeGreaterThanOrEqual(MIN_DAILY_GOAL);
  });

  it('clamps to its bounds rather than accepting nonsense', () => {
    expect(clampGoal(0)).toBe(MIN_DAILY_GOAL);
    expect(clampGoal(-30)).toBe(MIN_DAILY_GOAL);
    expect(clampGoal(10_000)).toBe(MAX_DAILY_GOAL);
    expect(clampGoal(Number.NaN)).toBe(DEFAULT_DAILY_GOAL);
    expect(clampGoal(12.4)).toBe(12);
  });

  it('persists across a restart', async () => {
    await setDailyGoal(25);
    expect((await readReadingLog()).dailyGoal).toBe(25);
  });
});

describe('the weekly view', () => {
  const log: ReadingLog = {
    days: { '2026-08-10': 14, '2026-08-08': 3 },
    furthest: { '18': 17 },
    dailyGoal: 10,
  };

  it('returns seven days, oldest first, ending on the day asked for', () => {
    const week = recentDays(log, '2026-08-10');

    expect(week).toHaveLength(7);
    expect(week[0]?.isoDate).toBe('2026-08-04');
    expect(week[6]?.isoDate).toBe('2026-08-10');
  });

  it('draws a day with no record as zero rather than inventing one', () => {
    const week = recentDays(log, '2026-08-10');
    const untouched = week.filter((day) => day.read === 0);

    // Five of the seven days have no record, and every one of them reads zero — not an average,
    // not the previous day carried forward, not omitted from the array.
    expect(untouched).toHaveLength(5);
    for (const day of untouched) {
      expect(day.metGoal).toBe(false);
    }
  });

  it('marks only the days that actually met the goal', () => {
    const week = recentDays(log, '2026-08-10');
    expect(week.find((day) => day.isoDate === '2026-08-10')?.metGoal).toBe(true);
    // Three verses against a goal of ten.
    expect(week.find((day) => day.isoDate === '2026-08-08')?.metGoal).toBe(false);
    expect(daysMetGoal(log, '2026-08-10')).toBe(1);
  });

  it('reports zero for a day nothing was recorded on', () => {
    expect(readOn(log, '2026-08-09')).toBe(0);
    expect(readOn(log, '2026-08-10')).toBe(14);
  });

  it('returns nothing for a date it cannot parse, rather than a week of NaN', () => {
    expect(recentDays(log, 'not-a-date')).toEqual([]);
  });
});

describe('per-surah completion', () => {
  const log: ReadingLog = {
    days: {},
    furthest: { '1': 7, '18': 32, '2': 10 },
    dailyGoal: 10,
  };

  it('is the furthest verse over the surah’s real length', () => {
    const progress = surahProgress(log, { 1: 7, 2: 286, 18: 110 });

    expect(progress.map((entry) => entry.surah)).toEqual([1, 2, 18]);
    expect(progress.find((entry) => entry.surah === 1)?.fraction).toBe(1);
    expect(progress.find((entry) => entry.surah === 18)?.fraction).toBeCloseTo(32 / 110);
  });

  it('reports null rather than a fraction over a guessed denominator', () => {
    // A surah whose length the caller could not resolve — the catalogue failed to load.
    const progress = surahProgress(log, { 1: 7 });
    expect(progress.find((entry) => entry.surah === 18)?.fraction).toBeNull();
  });

  it('sums the furthest verses, not the days', () => {
    expect(totalAyatRead(log)).toBe(7 + 32 + 10);
  });

  it('discards a surah number outside 1–114', () => {
    const corrupt: ReadingLog = { ...log, furthest: { ...log.furthest, '900': 4, x: 2 } };
    const progress = surahProgress(corrupt, {});
    expect(progress.map((entry) => entry.surah)).toEqual([1, 2, 18]);
  });
});

describe('today’s date', () => {
  it('is the device’s local calendar day, not UTC', () => {
    // 11pm local on the 10th is still the 10th. `toISOString` would file it under the 11th for
    // anyone east of Greenwich, crediting a night's reading to tomorrow.
    expect(todayIsoDate(new Date(2026, 7, 10, 23, 30))).toBe('2026-08-10');
    expect(todayIsoDate(new Date(2026, 7, 10, 0, 5))).toBe('2026-08-10');
  });
});

describe('the reader is the only thing that records', () => {
  it('records nothing merely from rendering a surah', async () => {
    setRouteParams({ surah: '1' });
    const view = await withRepositories(<ReaderScreen />);
    await view.findByTestId('faith-reader-header-label');

    /*
      The defect this forbids: a reader that counted an ayah because a card mounted would credit
      seven verses to somebody who opened Al-Fatihah and closed it, and credit them again on every
      return.
    */
    expect(totalAyatRead(await readReadingLog())).toBe(0);
  });

  it('records nothing from loading another page', async () => {
    setRouteParams({ surah: '1' });
    const view = await withRepositories(<ReaderScreen />);
    await view.findByTestId('faith-reader-header-label');

    const more = view.queryByTestId('faith-reader-load-more');
    if (more !== null) {
      await fireEvent.press(more);
    }
    expect(totalAyatRead(await readReadingLog())).toBe(0);
  });

  it('records the verse when the reader marks it read', async () => {
    setRouteParams({ surah: '1' });
    const view = await withRepositories(<ReaderScreen />);

    // The two deliberate taps: press the verse, then Read in its sheet. Opening the sheet on its
    // own records nothing — that case is in `quran-reader-actions.test.tsx`.
    await fireEvent.press(await view.findByTestId('faith-reader-ayah-1-2'));
    await fireEvent.press(await view.findByTestId('faith-reader-action-read'));
    await view.findByTestId('faith-reader-success');

    const log = await readReadingLog();
    expect(log.furthest['1']).toBe(2);
    expect(readOn(log, todayIsoDate())).toBe(2);
  });
});

describe('the progress screen', () => {
  it('says nothing has been recorded rather than showing an empty chart', async () => {
    const view = await withRepositories(<ProgressScreen />);
    expect(await view.findByTestId('faith-progress-empty')).toBeTruthy();
  });

  it('shows the day’s count against the goal once there is something to show', async () => {
    await recordReading(18, 14, todayIsoDate());

    const view = await withRepositories(<ProgressScreen />);
    expect(await view.findByTestId('faith-progress-today-count')).toBeTruthy();
    expect(await view.findByText(`14 / ${DEFAULT_DAILY_GOAL}`)).toBeTruthy();
  });

  it('draws seven day columns, including the empty ones', async () => {
    await recordReading(18, 14, todayIsoDate());
    const view = await withRepositories(<ProgressScreen />);

    const week = recentDays(await readReadingLog(), todayIsoDate());
    for (const day of week) {
      expect(await view.findByTestId(`faith-progress-day-${day.isoDate}`)).toBeTruthy();
    }
    expect(week).toHaveLength(7);
  });

  it('raises and lowers the goal, and persists it', async () => {
    await recordReading(18, 14, todayIsoDate());
    const view = await withRepositories(<ProgressScreen />);

    await fireEvent.press(await view.findByTestId('faith-progress-goal-up'));
    expect(await view.findByText(String(DEFAULT_DAILY_GOAL + 5))).toBeTruthy();
    expect((await readReadingLog()).dailyGoal).toBe(DEFAULT_DAILY_GOAL + 5);

    await fireEvent.press(await view.findByTestId('faith-progress-goal-down'));
    // Awaited through the rendered value, not straight from storage: the write is asynchronous, and
    // reading the store before the component has re-rendered races it.
    expect(await view.findByText(String(DEFAULT_DAILY_GOAL))).toBeTruthy();
    expect((await readReadingLog()).dailyGoal).toBe(DEFAULT_DAILY_GOAL);
  });

  it('offers a reset, and asks before erasing', async () => {
    await recordReading(18, 14, todayIsoDate());
    const view = await withRepositories(<ProgressScreen />);

    const reset = await view.findByTestId('faith-progress-reset');
    expect(String(reset.props.accessibilityHint)).toMatch(/Erases/);

    await fireEvent.press(reset);
    // The confirmation is a native Alert, so nothing is erased by the press itself.
    expect(totalAyatRead(await readReadingLog())).toBe(14);
  });

  it('claims no streak, and no minutes', async () => {
    await recordReading(18, 14, todayIsoDate());
    const view = await withRepositories(<ProgressScreen />);
    await view.findByTestId('faith-progress-today-count');

    /*
      Both are absent on purpose. A streak computed from a few days of history — most of them zero
      because the feature only just shipped — states something false about the user, and this module
      has no way to know whether the phone was face-down in a pocket, so minutes would be a guess
      presented as a measurement.
    */
    expect(view.queryByText(/streak/i)).toBeNull();
    expect(view.queryByText(/minute/i)).toBeNull();
  });
});
