import { WEEKDAY_FULL, weekdayColumn } from '@shared/utils/calendar-grid';

import { isLocalDate, isLocalTime } from './planner-task';

/**
 * **A routine is a thing the user repeats, and a completion is one day of it.**
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── What this refuses to do ────────────────────────────────────────────────
 * There are no starter routines, no suggestions, no defaults and no examples. A routine appears
 * because somebody typed it. That is the same rule Planner's tasks and calendar already follow, and
 * it is worth restating here because a habit feature is the most tempting place in an app to seed
 * "Drink water" and "Morning walk" — content that reads as the user's own intention while being the
 * developer's.
 *
 * There are also **no streaks, no badges, no percentages and no encouragement**. A completion count
 * across days is a claim about somebody's life, and the moment an app displays one it starts
 * rewarding and implicitly judging. This phase records what happened and shows today; nothing
 * aggregates.
 *
 * ── Why a completion is (routine, local day) and not a row of its own ──────
 * An occurrence needs no identity of its own: a routine scheduled on a day either happened or it
 * did not, and `routineId + YYYY-MM-DD` says exactly that. Generating an occurrence id would mean
 * materialising every future day to have something to point at, which is how a checklist quietly
 * becomes a calendar of rows nobody created.
 *
 * The consequence is the behaviour the product needs for free: today's completion is a fact about
 * today. Tomorrow starts empty without deleting anything, reopening touches one day, and changing a
 * schedule cannot rewrite history because history is keyed by the day it happened on, not by what
 * the schedule currently says.
 *
 * ── Weekdays are Monday-first, from the shared grid ────────────────────────
 * `weekdayColumn` already answers "which column is this date in", Monday first, and that index *is*
 * the weekday key. Storing a second convention — a `Date.getDay()` Sunday-first number, or a string
 * like `'mon'` — would be a second thing to keep in step with the calendar the user already sees.
 * ═══════════════════════════════════════════════════════════════════════════
 */

export const PLANNER_ROUTINE_SCHEMA_VERSION = 1 as const;

/** Monday `0` … Sunday `6`, matching `weekdayColumn`. */
export type RoutineWeekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export const routineWeekdays: readonly RoutineWeekday[] = [0, 1, 2, 3, 4, 5, 6];

/** The full name a control speaks. `Monday` for `0`. */
export function routineWeekdayName(day: RoutineWeekday): string {
  return WEEKDAY_FULL[day] ?? '';
}

/**
 * When a routine is due.
 *
 * Two shapes rather than one list of seven booleans: "every day" is what most routines are, and a
 * caller that had to check whether all seven flags were set would eventually check six.
 */
export type RoutineSchedule =
  | { readonly kind: 'daily' }
  | { readonly kind: 'weekdays'; readonly days: readonly RoutineWeekday[] };

export const routinePriorities = ['normal', 'high'] as const;
export type RoutinePriority = (typeof routinePriorities)[number];

export type PlannerRoutine = {
  readonly id: string;
  readonly title: string;
  readonly note: string;
  readonly schedule: RoutineSchedule;
  /** `HH:MM`, or `null`. A preference for when in the day, never a reminder — nothing notifies. */
  readonly preferredTime: string | null;
  readonly priority: RoutinePriority;
  /**
   * Whether the routine still appears on its scheduled days.
   *
   * Inactive is not deleted. Somebody who stops a routine for a month should not lose the record of
   * the month they kept it, so this hides future occurrences and touches no history.
   */
  readonly active: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type PlannerRoutineDraft = {
  readonly title: string;
  readonly note?: string;
  readonly schedule: RoutineSchedule;
  readonly preferredTime?: string | null;
  readonly priority?: RoutinePriority;
  readonly active?: boolean;
};

export type PlannerRoutineFault =
  | 'empty-title'
  | 'title-too-long'
  | 'note-too-long'
  | 'no-weekdays'
  | 'invalid-weekday'
  | 'duplicate-weekday'
  | 'invalid-time'
  | 'too-many-routines';

export type PlannerRoutineValidation =
  | { readonly kind: 'valid'; readonly draft: Required<PlannerRoutineDraft> }
  | { readonly kind: 'invalid'; readonly fault: PlannerRoutineFault };

/* ── Limits ────────────────────────────────────────────────────────────────
   Stated rather than implied. Every one of these is a bound on what a single device stores for one
   account, because "the user can add as many as they like" is how a local store becomes a file that
   takes a second to parse on launch.
*/

/** A routine title is a line, not a paragraph. */
export const MAX_ROUTINE_TITLE_LENGTH = 80;
/** A note is context, not a journal — the daily surface has no room for more. */
export const MAX_ROUTINE_NOTE_LENGTH = 500;
/** More than this is not a checklist any more. */
export const MAX_ROUTINES = 100;
/**
 * How many days of completion history are retained.
 *
 * A little over a year, so "this time last year" is still answerable, and bounded so the log cannot
 * grow for ever. Pruning drops whole days from the oldest end; it never edits a day's contents,
 * because a partially trimmed day would be a false record rather than a missing one.
 */
export const MAX_COMPLETION_DAYS = 400;

const ROUTINE_ID_PATTERN = /^routine\.[0-9a-f-]{36}$/i;

const ROUTINE_FIELDS = [
  'active',
  'createdAt',
  'id',
  'note',
  'preferredTime',
  'priority',
  'schedule',
  'title',
  'updatedAt',
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isIsoInstant(value: unknown): value is string {
  if (typeof value !== 'string' || value.length < 20 || value.length > 30) {
    return false;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function isRoutineWeekday(value: unknown): value is RoutineWeekday {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 6;
}

/** A schedule as stored, validated shape-first so a corrupt row cannot reach the screen. */
export function isRoutineSchedule(value: unknown): value is RoutineSchedule {
  if (!isRecord(value)) {
    return false;
  }
  if (value.kind === 'daily') {
    return Object.keys(value).length === 1;
  }
  if (value.kind !== 'weekdays' || !Array.isArray(value.days)) {
    return false;
  }
  const days = value.days;
  if (days.length === 0 || days.length > 7 || !days.every(isRoutineWeekday)) {
    return false;
  }
  return new Set(days).size === days.length;
}

/**
 * Validates a draft and returns it normalised.
 *
 * Weekdays are sorted on the way in, so `[4, 0]` and `[0, 4]` are the same schedule and a diff
 * between two saves is about what changed rather than about the order somebody tapped.
 *
 * A time is refused **without** requiring a date, unlike a task: a routine's time is a preference
 * within whatever day it lands on, and there is no date to attach it to.
 */
export function validatePlannerRoutineDraft(draft: PlannerRoutineDraft): PlannerRoutineValidation {
  const title = draft.title.trim();
  if (title.length === 0) {
    return { kind: 'invalid', fault: 'empty-title' };
  }
  if (title.length > MAX_ROUTINE_TITLE_LENGTH) {
    return { kind: 'invalid', fault: 'title-too-long' };
  }

  const note = (draft.note ?? '').trim();
  if (note.length > MAX_ROUTINE_NOTE_LENGTH) {
    return { kind: 'invalid', fault: 'note-too-long' };
  }

  const schedule = draft.schedule;
  if (schedule.kind === 'weekdays') {
    if (schedule.days.length === 0) {
      // A weekday schedule with nothing selected would never come due — silently never appearing is
      // worse than being told to pick a day.
      return { kind: 'invalid', fault: 'no-weekdays' };
    }
    if (!schedule.days.every(isRoutineWeekday)) {
      return { kind: 'invalid', fault: 'invalid-weekday' };
    }
    if (new Set(schedule.days).size !== schedule.days.length) {
      return { kind: 'invalid', fault: 'duplicate-weekday' };
    }
  }

  const supplied = (draft.preferredTime ?? '').trim();
  const preferredTime = supplied.length === 0 ? null : supplied;
  if (preferredTime !== null && !isLocalTime(preferredTime)) {
    return { kind: 'invalid', fault: 'invalid-time' };
  }

  const normalised: RoutineSchedule =
    schedule.kind === 'daily'
      ? { kind: 'daily' }
      : { kind: 'weekdays', days: [...schedule.days].sort((a, b) => a - b) };

  return {
    kind: 'valid',
    draft: {
      title,
      note,
      schedule: normalised,
      preferredTime,
      priority: draft.priority ?? 'normal',
      active: draft.active ?? true,
    },
  };
}

export function createPlannerRoutine(
  draft: PlannerRoutineDraft,
  id: string,
  at: Date,
):
  | { readonly kind: 'created'; readonly routine: PlannerRoutine }
  | { readonly kind: 'invalid'; readonly fault: PlannerRoutineFault } {
  const validation = validatePlannerRoutineDraft(draft);
  if (validation.kind === 'invalid') {
    return validation;
  }
  if (!ROUTINE_ID_PATTERN.test(id)) {
    throw new Error('Planner routine ids must be generated UUID addresses.');
  }
  const timestamp = at.toISOString();
  return {
    kind: 'created',
    routine: { id, ...validation.draft, createdAt: timestamp, updatedAt: timestamp },
  };
}

export function revisePlannerRoutine(
  routine: PlannerRoutine,
  draft: PlannerRoutineDraft,
  at: Date,
):
  | { readonly kind: 'updated'; readonly routine: PlannerRoutine }
  | { readonly kind: 'invalid'; readonly fault: PlannerRoutineFault } {
  const validation = validatePlannerRoutineDraft(draft);
  if (validation.kind === 'invalid') {
    return validation;
  }
  /*
    `createdAt` and `id` survive a revision untouched. Editing a routine's schedule is not creating a
    different routine — its history is keyed by its id, and reassigning either would orphan every
    completion the user had recorded against it.
  */
  return {
    kind: 'updated',
    routine: { ...routine, ...validation.draft, updatedAt: at.toISOString() },
  };
}

export function setPlannerRoutineActive(
  routine: PlannerRoutine,
  active: boolean,
  at: Date,
): PlannerRoutine {
  return { ...routine, active, updatedAt: at.toISOString() };
}

export function isPlannerRoutine(value: unknown): value is PlannerRoutine {
  if (!isRecord(value)) {
    return false;
  }
  const fields = Object.keys(value).sort();
  if (
    fields.length !== ROUTINE_FIELDS.length ||
    !fields.every((field, index) => field === ROUTINE_FIELDS[index])
  ) {
    return false;
  }
  const preferredTime = value.preferredTime;
  return (
    typeof value.id === 'string' &&
    ROUTINE_ID_PATTERN.test(value.id) &&
    typeof value.title === 'string' &&
    value.title === value.title.trim() &&
    value.title.length > 0 &&
    value.title.length <= MAX_ROUTINE_TITLE_LENGTH &&
    typeof value.note === 'string' &&
    value.note === value.note.trim() &&
    value.note.length <= MAX_ROUTINE_NOTE_LENGTH &&
    isRoutineSchedule(value.schedule) &&
    (preferredTime === null || isLocalTime(preferredTime)) &&
    routinePriorities.includes(value.priority as RoutinePriority) &&
    typeof value.active === 'boolean' &&
    isIsoInstant(value.createdAt) &&
    isIsoInstant(value.updatedAt)
  );
}

export type PlannerRoutineEnvelope = {
  readonly version: typeof PLANNER_ROUTINE_SCHEMA_VERSION;
  readonly routines: readonly PlannerRoutine[];
};

export function parsePlannerRoutineEnvelope(value: unknown): PlannerRoutineEnvelope | null {
  if (
    !isRecord(value) ||
    value.version !== PLANNER_ROUTINE_SCHEMA_VERSION ||
    !Array.isArray(value.routines)
  ) {
    return null;
  }
  if (value.routines.length > MAX_ROUTINES || !value.routines.every(isPlannerRoutine)) {
    return null;
  }
  const ids = new Set(value.routines.map((routine) => routine.id));
  if (ids.size !== value.routines.length) {
    return null;
  }
  return { version: PLANNER_ROUTINE_SCHEMA_VERSION, routines: value.routines };
}

/* ── Completions ───────────────────────────────────────────────────────────── */

/**
 * Which routines were completed on which local day.
 *
 * A map from day to the ids completed on it, rather than a flat list of pairs: reading "what is done
 * today" is the question the screen asks on every render, and a map answers it without scanning
 * history. Pruning is also whole-day, which this shape makes exact.
 */
export type PlannerRoutineCompletions = {
  readonly version: typeof PLANNER_ROUTINE_SCHEMA_VERSION;
  readonly days: Readonly<Record<string, readonly string[]>>;
};

export const emptyCompletions: PlannerRoutineCompletions = {
  version: PLANNER_ROUTINE_SCHEMA_VERSION,
  days: {},
};

export function parsePlannerRoutineCompletions(value: unknown): PlannerRoutineCompletions | null {
  if (
    !isRecord(value) ||
    value.version !== PLANNER_ROUTINE_SCHEMA_VERSION ||
    !isRecord(value.days)
  ) {
    return null;
  }
  const entries = Object.entries(value.days);
  if (entries.length > MAX_COMPLETION_DAYS) {
    return null;
  }
  const days: Record<string, readonly string[]> = {};
  for (const [day, ids] of entries) {
    if (!isLocalDate(day) || !Array.isArray(ids)) {
      return null;
    }
    if (!ids.every((id) => typeof id === 'string' && ROUTINE_ID_PATTERN.test(id))) {
      return null;
    }
    if (new Set(ids).size !== ids.length || ids.length > MAX_ROUTINES) {
      return null;
    }
    days[day] = ids;
  }
  return { version: PLANNER_ROUTINE_SCHEMA_VERSION, days };
}

/** The stable identity of one occurrence. Never stored — derived wherever it is needed. */
export function routineOccurrenceKey(routineId: string, day: string): string {
  return `${routineId}@${day}`;
}

/** Whether this routine's schedule includes the given local day. Ignores `active`. */
export function routineFallsOn(routine: PlannerRoutine, day: string): boolean {
  if (!isLocalDate(day)) {
    return false;
  }
  if (routine.schedule.kind === 'daily') {
    return true;
  }
  return routine.schedule.days.includes(weekdayColumn(day) as RoutineWeekday);
}

/**
 * The routines that should appear for a local day.
 *
 * `active` is required as well as the schedule, which is what makes disabling hide *future*
 * occurrences while leaving every past completion exactly where it was.
 */
export function routinesScheduledOn(
  routines: readonly PlannerRoutine[],
  day: string,
): readonly PlannerRoutine[] {
  return sortPlannerRoutines(
    routines.filter((routine) => routine.active && routineFallsOn(routine, day)),
  );
}

export function routineIsCompletedOn(
  completions: PlannerRoutineCompletions,
  routineId: string,
  day: string,
): boolean {
  return (completions.days[day] ?? []).includes(routineId);
}

/**
 * The completion log with one routine marked or unmarked on one day.
 *
 * Only the named day changes. That is the whole behaviour the product asks for — tomorrow starts
 * incomplete without deleting yesterday, and reopening affects one occurrence — expressed as the one
 * thing this function is able to do.
 *
 * A day that empties is removed rather than left as `[]`, so "no entry" and "an entry recording
 * nothing" cannot both exist to mean the same thing.
 */
export function withRoutineCompletion(
  completions: PlannerRoutineCompletions,
  routineId: string,
  day: string,
  completed: boolean,
): PlannerRoutineCompletions {
  if (!isLocalDate(day)) {
    return completions;
  }
  const current = completions.days[day] ?? [];
  const next = completed
    ? current.includes(routineId)
      ? current
      : [...current, routineId]
    : current.filter((id) => id !== routineId);

  const days = { ...completions.days };
  if (next.length === 0) {
    delete days[day];
  } else {
    days[day] = next;
  }
  return { version: PLANNER_ROUTINE_SCHEMA_VERSION, days };
}

/**
 * The log with every trace of deleted routines removed, and trimmed to the retention window.
 *
 * Both halves are bounded and deterministic. Orphan removal is by id, so a deleted routine leaves
 * nothing behind that could be resurrected by an id collision; and the window keeps the newest days
 * by string order, which for `YYYY-MM-DD` is chronological order.
 */
export function pruneCompletions(
  completions: PlannerRoutineCompletions,
  liveRoutineIds: readonly string[],
): PlannerRoutineCompletions {
  const live = new Set(liveRoutineIds);
  const days: Record<string, readonly string[]> = {};

  for (const day of Object.keys(completions.days).sort().slice(-MAX_COMPLETION_DAYS)) {
    const kept = (completions.days[day] ?? []).filter((id) => live.has(id));
    if (kept.length > 0) {
      days[day] = kept;
    }
  }
  return { version: PLANNER_ROUTINE_SCHEMA_VERSION, days };
}

/**
 * Routines in display order: by preferred time, then by title.
 *
 * Time first because a routine with a time is a routine with a place in the day, and untimed ones
 * follow rather than interleave. Title breaks the tie so the list does not reshuffle between renders
 * for reasons the user cannot see.
 */
export function sortPlannerRoutines(
  routines: readonly PlannerRoutine[],
): readonly PlannerRoutine[] {
  return [...routines].sort((left, right) => {
    const leftTime = left.preferredTime ?? '99:99';
    const rightTime = right.preferredTime ?? '99:99';
    return (
      leftTime.localeCompare(rightTime) ||
      left.title.localeCompare(right.title) ||
      left.createdAt.localeCompare(right.createdAt)
    );
  });
}

/** `Every day`, or `Mon, Wed, Fri`. What a row says about when it recurs. */
export function routineScheduleLabel(schedule: RoutineSchedule): string {
  if (schedule.kind === 'daily') {
    return 'Every day';
  }
  return schedule.days.map((day) => routineWeekdayName(day).slice(0, 3)).join(', ');
}

/** The same thing spoken in full, because "Mon, Wed" read aloud is not a sentence. */
export function routineScheduleSpoken(schedule: RoutineSchedule): string {
  if (schedule.kind === 'daily') {
    return 'Every day';
  }
  const names = schedule.days.map(routineWeekdayName);
  if (names.length === 1) {
    return `Every ${names[0]}`;
  }
  return `Every ${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}
