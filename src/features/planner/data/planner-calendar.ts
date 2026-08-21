import {
  buildMonthGrid,
  monthOf,
  shiftMonth,
  type MonthAddress,
  type MonthGrid,
} from '@shared/utils/calendar-grid';

import { isLocalDate, sortPlannerTasks, type PlannerTask } from './planner-task';

/**
 * **What the Planner calendar shows** — which of the user's own tasks fall on which day, and nothing
 * else.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── The rule this file exists to enforce ───────────────────────────────────
 * Every mark on this calendar comes from a task the user created. There are no holidays, no
 * observances, no prayer events, no routines, no suggestions and no sample days. A calendar is the
 * most tempting surface in an app to decorate — an empty grid looks broken, and filling it makes a
 * screenshot look alive — which is exactly why the rule is written here rather than left to
 * judgement. Planner's own empty state promises *"NoorLife will not invent a schedule for you"*, and
 * a calendar that quietly disagreed would make that sentence a lie two taps away.
 *
 * So the only inputs are `PlannerTask[]` and a month. Anything a day cell can display is derived
 * from those.
 *
 * ── Why grouping happens here and not in the screen ────────────────────────
 * The month grid, the per-day indicators and the selected-day list must agree. If the grid counted
 * tasks one way and the list below filtered them another, a day could show a dot and then an empty
 * list — which reads as data loss. One function answers "what is on this day", and both the dot and
 * the list are derived from it.
 *
 * ── Dates are compared as strings, deliberately ────────────────────────────
 * `dueDate` is stored as `YYYY-MM-DD` in the user's local calendar, and a day cell is the same
 * shape. Comparing the two as strings is exact and has no timezone in it. Parsing either side into a
 * `Date` to compare them would reintroduce the class of defect this project has already paid for
 * four times over in prayer times: an instant rendered against the wrong day. There is no `Date`
 * arithmetic in this file at all.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/** What a day cell may signal, counted from real tasks only. */
export type PlannerDayIndicator = {
  readonly open: number;
  readonly completed: number;
};

/**
 * Every day in the month that carries at least one task, with its counts.
 *
 * A `Map` keyed by the ISO day, so a grid of 31 cells does not scan the task list 31 times. Days
 * with nothing are absent rather than present-and-zero: "no entry" and "an entry claiming zero" are
 * the same fact, and only one of them can be rendered by mistake.
 *
 * Tasks with no due date are counted nowhere. They are real tasks and they appear on the Tasks
 * screen, but they belong to no day, and placing them on today — the obvious shortcut — would put a
 * date on something the user deliberately left undated.
 */
export function plannerDayIndicators(
  tasks: readonly PlannerTask[],
): ReadonlyMap<string, PlannerDayIndicator> {
  const byDay = new Map<string, { open: number; completed: number }>();
  for (const task of tasks) {
    if (task.dueDate === null || !isLocalDate(task.dueDate)) {
      continue;
    }
    const entry = byDay.get(task.dueDate) ?? { open: 0, completed: 0 };
    if (task.status === 'completed') {
      entry.completed += 1;
    } else {
      entry.open += 1;
    }
    byDay.set(task.dueDate, entry);
  }
  return byDay;
}

/**
 * The tasks due on one day, in the order the rest of Planner shows them.
 *
 * `sortPlannerTasks` rather than a local comparator, so a day's list is ordered by the same rule as
 * the Tasks screen: open before completed, then by due time, then by when it was created. A calendar
 * that ordered its days differently from the list the user already knows would look like different
 * data.
 */
export function plannerTasksForDay(
  tasks: readonly PlannerTask[],
  day: string,
): readonly PlannerTask[] {
  if (!isLocalDate(day)) {
    return [];
  }
  return sortPlannerTasks(tasks.filter((task) => task.dueDate === day));
}

/** Whether any task at all is due on this day. The cheap question, asked by the day cell. */
export function plannerDayHasTasks(
  indicators: ReadonlyMap<string, PlannerDayIndicator>,
  day: string,
): boolean {
  const entry = indicators.get(day);
  return entry !== undefined && entry.open + entry.completed > 0;
}

/**
 * Everything one rendered month needs.
 *
 * Assembled in one place so the screen holds a single value and cannot render a grid from one month
 * while listing a day from another.
 */
export type PlannerCalendarMonth = {
  readonly grid: MonthGrid;
  readonly indicators: ReadonlyMap<string, PlannerDayIndicator>;
};

export function plannerCalendarMonth(
  address: MonthAddress,
  tasks: readonly PlannerTask[],
): PlannerCalendarMonth {
  return { grid: buildMonthGrid(address), indicators: plannerDayIndicators(tasks) };
}

/**
 * The month a selected day sits in, falling back to the month of `today`.
 *
 * A selection always has a month, so the grid never has to guess: opening the calendar shows the
 * month containing today, and arriving with a day already selected shows that day's month rather
 * than making the user page to it.
 */
export function monthForSelection(selected: string | null, today: string): MonthAddress {
  return monthOf(selected ?? '') ?? monthOf(today) ?? { year: 1970, month: 1 };
}

/** Previous month. Named so the screen reads as intent rather than as arithmetic. */
export function previousMonth(address: MonthAddress): MonthAddress {
  return shiftMonth(address, -1);
}

/** Next month. */
export function nextMonth(address: MonthAddress): MonthAddress {
  return shiftMonth(address, 1);
}

/**
 * What the selected day's section says when that day is empty.
 *
 * Kept beside the grouping rather than inline in the screen, so the wording and the condition that
 * produces it cannot drift apart, and so a test can assert the sentence does not promise anything
 * the app will not do. It says the day is free and how to fill it; it does not suggest what to put
 * there.
 */
export function plannerEmptyDayCopy(): { readonly title: string; readonly body: string } {
  return {
    title: 'Nothing planned for this day',
    body: 'Add a task and it appears here. NoorLife will not fill your calendar for you.',
  };
}

/**
 * The count line a selected day shows above its list.
 *
 * Stated as a count of the user's own tasks, never as a characterisation of the day. "Two tasks" is
 * a fact; "a busy day" is an opinion the app has no standing to offer.
 */
export function plannerDaySummary(tasks: readonly PlannerTask[]): string {
  const open = tasks.filter((task) => task.status === 'open').length;
  const completed = tasks.length - open;
  if (tasks.length === 0) {
    return 'No tasks';
  }
  const openPart = `${open} open`;
  return completed === 0 ? openPart : `${openPart}, ${completed} completed`;
}
