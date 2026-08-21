import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  monthForSelection,
  nextMonth,
  plannerCalendarMonth,
  plannerDayHasTasks,
  plannerDayIndicators,
  plannerDaySummary,
  plannerEmptyDayCopy,
  plannerTasksForDay,
  previousMonth,
} from '../data/planner-calendar';
import { createPlannerTask, type PlannerTask } from '../data/planner-task';

/**
 * What the Planner calendar is allowed to show, and in what order.
 *
 * The load-bearing assertion in this file is the last one: nothing reaches a day cell that the user
 * did not put there.
 */

let sequence = 0;

function task(overrides: {
  readonly title?: string;
  readonly dueDate?: string | null;
  readonly dueTime?: string | null;
  readonly completed?: boolean;
  readonly createdAt?: string;
}): PlannerTask {
  sequence += 1;
  const created = createPlannerTask(
    {
      title: overrides.title ?? `Task ${sequence}`,
      dueDate: overrides.dueDate ?? null,
      dueTime: overrides.dueTime ?? null,
      priority: 'normal',
    },
    `task.aaaaaaaa-1111-4111-8111-${String(sequence).padStart(12, '0')}`,
    new Date(overrides.createdAt ?? '2026-08-21T08:00:00.000Z'),
  );
  if (created.kind !== 'created') {
    throw new Error(`fixture is not a valid task: ${created.fault}`);
  }
  return overrides.completed === true
    ? {
        ...created.task,
        status: 'completed',
        completedAt: '2026-08-21T09:00:00.000Z',
      }
    : created.task;
}

describe('day indicators', () => {
  it('counts open and completed separately, per day', () => {
    const indicators = plannerDayIndicators([
      task({ dueDate: '2026-09-15' }),
      task({ dueDate: '2026-09-15' }),
      task({ dueDate: '2026-09-15', completed: true }),
      task({ dueDate: '2026-09-16' }),
    ]);

    expect(indicators.get('2026-09-15')).toEqual({ open: 2, completed: 1 });
    expect(indicators.get('2026-09-16')).toEqual({ open: 1, completed: 0 });
  });

  it('leaves a day with nothing absent rather than present-and-zero', () => {
    const indicators = plannerDayIndicators([task({ dueDate: '2026-09-15' })]);

    expect(indicators.has('2026-09-14')).toBe(false);
    expect(plannerDayHasTasks(indicators, '2026-09-14')).toBe(false);
    expect(plannerDayHasTasks(indicators, '2026-09-15')).toBe(true);
  });

  /*
    An undated task is real, and it belongs on the Tasks screen. Putting it on today — the tempting
    shortcut — would assign a date the user deliberately declined to give it.
  */
  it('places an undated task on no day at all', () => {
    const indicators = plannerDayIndicators([
      task({ dueDate: null }),
      task({ dueDate: '2026-09-15' }),
    ]);

    expect([...indicators.keys()]).toEqual(['2026-09-15']);
  });

  it('ignores a stored date that is not a real calendar day', () => {
    const corrupt = { ...task({ dueDate: '2026-09-15' }), dueDate: '2026-02-30' } as PlannerTask;

    expect(plannerDayIndicators([corrupt]).size).toBe(0);
  });

  it('reflects a completion moving between the two counts', () => {
    const open = task({ dueDate: '2026-09-15' });
    const done: PlannerTask = {
      ...open,
      status: 'completed',
      completedAt: '2026-08-21T09:00:00.000Z',
    };

    expect(plannerDayIndicators([open]).get('2026-09-15')).toEqual({ open: 1, completed: 0 });
    expect(plannerDayIndicators([done]).get('2026-09-15')).toEqual({ open: 0, completed: 1 });
  });
});

describe('the selected day list', () => {
  it('returns only the tasks due on that day', () => {
    const tasks = [
      task({ title: 'On the day', dueDate: '2026-09-15' }),
      task({ title: 'Day before', dueDate: '2026-09-14' }),
      task({ title: 'Undated', dueDate: null }),
    ];

    expect(plannerTasksForDay(tasks, '2026-09-15').map((entry) => entry.title)).toEqual([
      'On the day',
    ]);
  });

  it('orders open before completed, then by time, matching the Tasks screen', () => {
    const tasks = [
      task({ title: 'Late', dueDate: '2026-09-15', dueTime: '17:00' }),
      task({ title: 'Done', dueDate: '2026-09-15', dueTime: '07:00', completed: true }),
      task({ title: 'Early', dueDate: '2026-09-15', dueTime: '09:00' }),
    ];

    expect(plannerTasksForDay(tasks, '2026-09-15').map((entry) => entry.title)).toEqual([
      'Early',
      'Late',
      'Done',
    ]);
  });

  it('falls back to creation order for two tasks at the same time', () => {
    const tasks = [
      task({ title: 'Second', dueDate: '2026-09-15', createdAt: '2026-08-21T09:00:00.000Z' }),
      task({ title: 'First', dueDate: '2026-09-15', createdAt: '2026-08-21T08:00:00.000Z' }),
    ];

    expect(plannerTasksForDay(tasks, '2026-09-15').map((entry) => entry.title)).toEqual([
      'First',
      'Second',
    ]);
  });

  it('is empty for a day nobody planned', () => {
    expect(plannerTasksForDay([task({ dueDate: '2026-09-15' })], '2026-09-16')).toEqual([]);
  });

  it('is empty rather than throwing for a malformed day key', () => {
    expect(plannerTasksForDay([task({ dueDate: '2026-09-15' })], 'not-a-day')).toEqual([]);
    expect(plannerTasksForDay([task({ dueDate: '2026-09-15' })], '2026-02-30')).toEqual([]);
  });

  it('does not mutate the array it was given', () => {
    const tasks = [
      task({ title: 'B', dueDate: '2026-09-15', dueTime: '17:00' }),
      task({ title: 'A', dueDate: '2026-09-15', dueTime: '09:00' }),
    ];
    const order = tasks.map((entry) => entry.title);

    plannerTasksForDay(tasks, '2026-09-15');

    expect(tasks.map((entry) => entry.title)).toEqual(order);
  });
});

describe('the day summary', () => {
  it('counts without characterising the day', () => {
    expect(plannerDaySummary([])).toBe('No tasks');
    expect(plannerDaySummary([task({ dueDate: '2026-09-15' })])).toBe('1 open');
    expect(
      plannerDaySummary([
        task({ dueDate: '2026-09-15' }),
        task({ dueDate: '2026-09-15', completed: true }),
      ]),
    ).toBe('1 open, 1 completed');
  });

  it('never editorialises', () => {
    const summaries = [
      plannerDaySummary([]),
      plannerDaySummary([task({ dueDate: '2026-09-15' })]),
      plannerDaySummary(Array.from({ length: 9 }, () => task({ dueDate: '2026-09-15' }))),
    ];

    summaries.forEach((line) => {
      expect(line).not.toMatch(/busy|free|light|packed|productive|relax/i);
    });
  });
});

describe('month navigation', () => {
  it('opens on the month containing today when nothing is selected', () => {
    expect(monthForSelection(null, '2026-08-21')).toEqual({ year: 2026, month: 8 });
  });

  it('opens on the selected day’s month rather than making the user page to it', () => {
    expect(monthForSelection('2026-12-03', '2026-08-21')).toEqual({ year: 2026, month: 12 });
  });

  it('steps across both year boundaries', () => {
    expect(nextMonth({ year: 2026, month: 12 })).toEqual({ year: 2027, month: 1 });
    expect(previousMonth({ year: 2026, month: 1 })).toEqual({ year: 2025, month: 12 });
  });
});

describe('the assembled month', () => {
  it('carries a grid and the indicators for the same task set', () => {
    const tasks = [task({ dueDate: '2026-09-15' }), task({ dueDate: '2026-09-30' })];
    const month = plannerCalendarMonth({ year: 2026, month: 9 }, tasks);

    expect(month.grid.days).toHaveLength(30);
    expect(month.grid.label).toBe('September 2026');
    expect(plannerDayHasTasks(month.indicators, '2026-09-15')).toBe(true);
    expect(plannerDayHasTasks(month.indicators, '2026-09-16')).toBe(false);
  });

  it('marks no day at all when the user has no tasks', () => {
    const month = plannerCalendarMonth({ year: 2026, month: 9 }, []);

    expect(month.grid.days).toHaveLength(30);
    month.grid.days.forEach((day) => {
      expect(plannerDayHasTasks(month.indicators, day)).toBe(false);
    });
  });

  it('marks a leap-year 29 February when a task is due on it', () => {
    const month = plannerCalendarMonth({ year: 2024, month: 2 }, [task({ dueDate: '2024-02-29' })]);

    expect(month.grid.days).toHaveLength(29);
    expect(plannerDayHasTasks(month.indicators, '2024-02-29')).toBe(true);
  });
});

describe('the honest empty day', () => {
  it('says the day is empty and how to fill it, without suggesting what to put there', () => {
    const copy = plannerEmptyDayCopy();

    expect(copy.title).toBe('Nothing planned for this day');
    expect(copy.body).toContain('NoorLife will not fill your calendar for you');
    expect(copy.body).not.toMatch(/suggest|recommend|try adding a|why not/i);
  });
});

/** Source with docblocks and line comments removed, so a content gate scans code and not prose. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

describe('no fabricated calendar content', () => {
  const root = join(__dirname, '..');
  const sources = [
    join(root, 'data', 'planner-calendar.ts'),
    join(root, 'components', 'planner-month-grid.tsx'),
    join(root, 'screens', 'planner-calendar-screen.tsx'),
  ];

  /*
    A calendar is the most tempting surface in an app to decorate: an empty grid looks broken, and a
    sample event makes a screenshot look alive. This is the gate. It reads the calendar's own sources
    and fails if any of them names an event, an observance or a holiday — the same class of check
    that keeps unreviewed supplications out of Faith.
  */
  it('ships no sample events, holidays, observances or seeded days', () => {
    sources.forEach((path) => {
      const source = readFileSync(path, 'utf8');
      const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

      // Word-anchored: an unanchored /Eid/i matches the "eId" inside `moduleId`, and a
      // content gate that fails on a prop name is one the next person loosens.
      expect(code).not.toMatch(
        /(holidays?|observances?|Ramadan|Eid|birthdays?|anniversar(y|ies))/i,
      );
      expect(code).not.toMatch(/School drop-off|Family dinner|Work focus|Standup|Meeting/i);
      expect(code).not.toMatch(/sampleEvents|mockEvents|demoEvents|seedDays|placeholderDays/);
    });
  });

  it('derives every day marker from PlannerTask and nothing else', () => {
    const source = readFileSync(sources[0]!, 'utf8');

    // The only data type the calendar's grouping layer imports is the task itself.
    expect(source).toMatch(/from '\.\/planner-task'/);
    // Prose removed first: the docblock names prayer times and routines precisely to say
    // they are excluded, so scanning the raw file would fail on the promise itself.
    expect(stripComments(source)).not.toMatch(/(prayer|adhan|hijri|routines?)/i);
  });

  it('reads no network and no clock of its own in the grouping layer', () => {
    const source = readFileSync(sources[0]!, 'utf8');
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

    expect(code).not.toMatch(/fetch\(|axios|https?:\/\//);
    // No `new Date()` either: a grouping function that read the clock could not be tested for a
    // given day, and would quietly disagree with the day the screen thinks is selected.
    expect(code).not.toMatch(/new Date\(/);
  });
});
