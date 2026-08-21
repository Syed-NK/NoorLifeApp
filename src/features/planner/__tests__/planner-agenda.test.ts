import { formatPlannerClock, plannerOpenTasksDueOn } from '../data/planner-agenda';
import { createPlannerTask, type PlannerTask } from '../data/planner-task';

/**
 * The selector every summary surface asks, and the one place "due today" is defined.
 */

let sequence = 0;

function task(overrides: {
  readonly title?: string;
  readonly dueDate?: string | null;
  readonly dueTime?: string | null;
  readonly notes?: string;
  readonly completed?: boolean;
  readonly createdAt?: string;
}): PlannerTask {
  sequence += 1;
  const created = createPlannerTask(
    {
      title: overrides.title ?? `Task ${sequence}`,
      notes: overrides.notes ?? '',
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
    ? { ...created.task, status: 'completed', completedAt: '2026-08-21T09:00:00.000Z' }
    : created.task;
}

const TODAY = '2026-08-21';
const TOMORROW = '2026-08-22';
const YESTERDAY = '2026-08-20';

describe('formatPlannerClock', () => {
  it.each([
    ['09:30', '9:30 AM'],
    ['00:00', '12:00 AM'],
    ['00:05', '12:05 AM'],
    ['11:59', '11:59 AM'],
    ['12:00', '12:00 PM'],
    ['12:45', '12:45 PM'],
    ['13:00', '1:00 PM'],
    ['17:30', '5:30 PM'],
    ['23:59', '11:59 PM'],
  ])('renders %s as %s', (stored, expected) => {
    expect(formatPlannerClock(stored)).toBe(expected);
  });

  it('is empty rather than wrong when there is no time', () => {
    expect(formatPlannerClock(null)).toBe('');
  });

  it.each([['24:00'], ['9:30'], ['09:60'], ['half nine'], ['']])(
    'refuses %s rather than rendering nonsense',
    (bad) => {
      expect(formatPlannerClock(bad)).toBe('');
    },
  );
});

describe('plannerOpenTasksDueOn', () => {
  it('returns the open tasks due on that day', () => {
    const items = plannerOpenTasksDueOn(
      [
        task({ title: 'Due today', dueDate: TODAY, dueTime: '09:30' }),
        task({ title: 'Due tomorrow', dueDate: TOMORROW }),
      ],
      TODAY,
    );

    expect(items).toEqual([{ id: expect.any(String), title: 'Due today', time: '9:30 AM' }]);
  });

  it('excludes a completed task, because it is not still to do', () => {
    const items = plannerOpenTasksDueOn(
      [
        task({ title: 'Done', dueDate: TODAY, completed: true }),
        task({ title: 'Still open', dueDate: TODAY }),
      ],
      TODAY,
    );

    expect(items.map((item) => item.title)).toEqual(['Still open']);
  });

  it('excludes a future task', () => {
    expect(plannerOpenTasksDueOn([task({ dueDate: TOMORROW })], TODAY)).toEqual([]);
  });

  /*
    Overdue work is excluded on purpose. A glance at *today* is a claim about today, and quietly
    pulling yesterday's unfinished task forward would present a date the user never set.
  */
  it('excludes an overdue task rather than pulling it forward', () => {
    expect(plannerOpenTasksDueOn([task({ dueDate: YESTERDAY })], TODAY)).toEqual([]);
  });

  it('excludes an undated task', () => {
    expect(plannerOpenTasksDueOn([task({ dueDate: null })], TODAY)).toEqual([]);
  });

  it("preserves Planner's own ordering", () => {
    const items = plannerOpenTasksDueOn(
      [
        task({ title: 'Afternoon', dueDate: TODAY, dueTime: '15:00' }),
        task({ title: 'Morning', dueDate: TODAY, dueTime: '08:00' }),
        task({ title: 'Midday', dueDate: TODAY, dueTime: '12:00' }),
      ],
      TODAY,
    );

    expect(items.map((item) => item.title)).toEqual(['Morning', 'Midday', 'Afternoon']);
  });

  it('falls back to creation order for two tasks at the same time', () => {
    const items = plannerOpenTasksDueOn(
      [
        task({ title: 'Second', dueDate: TODAY, createdAt: '2026-08-21T09:00:00.000Z' }),
        task({ title: 'First', dueDate: TODAY, createdAt: '2026-08-21T08:00:00.000Z' }),
      ],
      TODAY,
    );

    expect(items.map((item) => item.title)).toEqual(['First', 'Second']);
  });

  /*
    The load-bearing privacy assertion. Notes are prose the user wrote for the Tasks screen; a summary
    surface has no business with them, and the shape this selector returns is what makes that
    structural rather than a rule somebody has to remember.
  */
  it('never carries notes out of Planner', () => {
    const items = plannerOpenTasksDueOn(
      [task({ title: 'Has a note', dueDate: TODAY, notes: 'Private detail about my health' })],
      TODAY,
    );

    expect(items).toHaveLength(1);
    expect(Object.keys(items[0]!).sort()).toEqual(['id', 'time', 'title']);
    expect(JSON.stringify(items)).not.toContain('Private detail');
  });

  it('carries no status, priority or timestamps either', () => {
    const items = plannerOpenTasksDueOn([task({ dueDate: TODAY })], TODAY);
    const serialised = JSON.stringify(items[0]);

    expect(serialised).not.toContain('status');
    expect(serialised).not.toContain('priority');
    expect(serialised).not.toContain('createdAt');
  });

  it('is empty for a malformed day rather than throwing', () => {
    expect(plannerOpenTasksDueOn([task({ dueDate: TODAY })], 'not-a-day')).toEqual([]);
    expect(plannerOpenTasksDueOn([task({ dueDate: TODAY })], '2026-02-30')).toEqual([]);
  });

  it('is empty when the user has no tasks at all', () => {
    expect(plannerOpenTasksDueOn([], TODAY)).toEqual([]);
  });

  it('does not mutate the array it was given', () => {
    const tasks = [
      task({ title: 'B', dueDate: TODAY, dueTime: '15:00' }),
      task({ title: 'A', dueDate: TODAY, dueTime: '08:00' }),
    ];
    const order = tasks.map((entry) => entry.title);

    plannerOpenTasksDueOn(tasks, TODAY);

    expect(tasks.map((entry) => entry.title)).toEqual(order);
  });

  it('renders a task with a date but no time without a time', () => {
    const items = plannerOpenTasksDueOn([task({ dueDate: TODAY, dueTime: null })], TODAY);

    expect(items[0]!.time).toBe('');
  });
});
