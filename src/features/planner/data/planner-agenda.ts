import { isLocalDate, sortPlannerTasks, type PlannerTask } from './planner-task';

/**
 * **What is actually on today** — the selector other surfaces ask, and the only answer they get.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── Why this lives in Planner and not in the caller ────────────────────────
 * Main Home needs to show today's plan, and the tempting shortcut is for Home to filter the task
 * array itself: `tasks.filter(t => t.dueDate === today)`. That shortcut is how a second, quietly
 * different definition of "due today" enters the app — one that forgets completed tasks, or counts an
 * undated one, or sorts by a different rule than the Tasks screen. Planner owns what a task *means*,
 * so Planner answers the question and every surface gets the same answer.
 *
 * ── The three rules, stated once ───────────────────────────────────────────
 *   • **Open only.** A completed task is not something the user still has to do, and putting it on a
 *     "today at a glance" line would pad the day with work already finished.
 *   • **Due exactly today.** Not overdue, not tomorrow. A glance at today is a claim about today;
 *     pulling yesterday's unfinished work forward would be presenting a date the user did not set.
 *   • **Undated tasks are excluded.** They are real and they appear on the Tasks screen, but they
 *     belong to no day. Showing one under today would assign a date the user deliberately declined
 *     to give — the same rule the calendar's day indicators follow.
 *
 * Ordering is `sortPlannerTasks`, so a task sits in the same position here as on the Tasks screen and
 * in the calendar's day list. Three surfaces disagreeing about order looks like three different sets
 * of data.
 *
 * ── Formatting belongs here too ────────────────────────────────────────────
 * `TimelineEntry.time` is documented as "pre-formatted for the user's locale by the source module",
 * and this is that module. A caller that formatted a stored `HH:MM` itself would be making a
 * presentation decision about Planner's data without Planner's knowledge.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/**
 * One row of today's plan, reduced to what a summary surface may see.
 *
 * Deliberately **not** a `PlannerTask`. Handing the whole record to another feature would hand it the
 * notes, the completion timestamps and the storage id, and a summary surface has no business with any
 * of them — notes especially, which are private prose the user wrote for one screen. The `id` is here
 * only so a list can key its rows.
 */
export type PlannerAgendaItem = {
  readonly id: string;
  readonly title: string;
  /** `9:30 AM`, or an empty string when the task has a date but no time. Never a date. */
  readonly time: string;
};

/**
 * `09:30` → `9:30 AM`.
 *
 * Twelve-hour with an uppercase meridiem, matching the clock the rest of Main Home's timeline shows.
 * Built by hand rather than through `toLocaleTimeString` on a synthesised `Date`, because the stored
 * value is a wall-clock time with no date and no zone — constructing an instant to format it is the
 * move that reintroduces the off-by-one-day class of defect this codebase has already paid for in
 * prayer times.
 *
 * Returns `''` for anything that is not `HH:MM`, so a corrupt row renders without a time rather than
 * rendering `NaN:NaN`.
 */
export function formatPlannerClock(dueTime: string | null): string {
  if (dueTime === null) {
    return '';
  }
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(dueTime);
  if (match === null) {
    return '';
  }
  const hours = Number(match[1]);
  const minutes = match[2];
  const meridiem = hours < 12 ? 'AM' : 'PM';
  // 0 and 12 both display as 12; everything else is the remainder.
  const display = hours % 12 === 0 ? 12 : hours % 12;
  return `${display}:${minutes} ${meridiem}`;
}

/**
 * The user's open tasks due on one day, in Planner's own order.
 *
 * `day` is a local calendar day (`YYYY-MM-DD`) supplied by the caller, and comparison is string
 * equality against the stored `dueDate` — exact, and with no timezone in it. Nothing here reads the
 * clock: a selector that decided for itself what "today" is could not be tested for a given day, and
 * would drift from whatever day the screen believes it is showing.
 */
export function plannerOpenTasksDueOn(
  tasks: readonly PlannerTask[],
  day: string,
): readonly PlannerAgendaItem[] {
  if (!isLocalDate(day)) {
    return [];
  }
  const due = tasks.filter(
    (task) => task.status === 'open' && task.dueDate !== null && task.dueDate === day,
  );
  return sortPlannerTasks(due).map((task) => ({
    id: task.id,
    title: task.title,
    time: formatPlannerClock(task.dueTime),
  }));
}
