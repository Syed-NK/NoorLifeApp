export const PLANNER_TASK_SCHEMA_VERSION = 1 as const;

export const plannerTaskPriorities = ['normal', 'high'] as const;
export type PlannerTaskPriority = (typeof plannerTaskPriorities)[number];

export const plannerTaskStatuses = ['open', 'completed'] as const;
export type PlannerTaskStatus = (typeof plannerTaskStatuses)[number];

export type PlannerTask = {
  readonly id: string;
  readonly title: string;
  readonly notes: string;
  /** Local calendar date (`YYYY-MM-DD`), or null when the task is unscheduled. */
  readonly dueDate: string | null;
  /** Local wall-clock time (`HH:mm`), meaningful only when `dueDate` is present. */
  readonly dueTime: string | null;
  readonly priority: PlannerTaskPriority;
  readonly status: PlannerTaskStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly completedAt: string | null;
};

export type PlannerTaskDraft = {
  readonly title: string;
  readonly notes?: string;
  readonly dueDate?: string | null;
  readonly dueTime?: string | null;
  readonly priority?: PlannerTaskPriority;
};

export type PlannerTaskFault =
  'empty-title' | 'title-too-long' | 'notes-too-long' | 'invalid-date' | 'invalid-time';

export type PlannerTaskValidation =
  | { readonly kind: 'valid'; readonly draft: Required<PlannerTaskDraft> }
  | { readonly kind: 'invalid'; readonly fault: PlannerTaskFault };

export type PlannerTaskEnvelope = {
  readonly version: typeof PLANNER_TASK_SCHEMA_VERSION;
  readonly tasks: readonly PlannerTask[];
};

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const TASK_ID_PATTERN = /^task\.[0-9a-f-]{36}$/i;
const MAX_TASKS = 500;
const MAX_TITLE_LENGTH = 120;
const MAX_NOTES_LENGTH = 1000;
const TASK_FIELDS = [
  'completedAt',
  'createdAt',
  'dueDate',
  'dueTime',
  'id',
  'notes',
  'priority',
  'status',
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

export function isLocalDate(value: unknown): value is string {
  if (typeof value !== 'string') {
    return false;
  }
  const match = DATE_PATTERN.exec(value);
  if (match === null) {
    return false;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

export function isLocalTime(value: unknown): value is string {
  return typeof value === 'string' && TIME_PATTERN.test(value);
}

export function localDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function offsetLocalDate(date: Date, days: number): string {
  const copy = new Date(date.getTime());
  copy.setHours(12, 0, 0, 0);
  copy.setDate(copy.getDate() + days);
  return localDateKey(copy);
}

export function validatePlannerTaskDraft(draft: PlannerTaskDraft): PlannerTaskValidation {
  const title = draft.title.trim();
  if (title.length === 0) {
    return { kind: 'invalid', fault: 'empty-title' };
  }
  if (title.length > MAX_TITLE_LENGTH) {
    return { kind: 'invalid', fault: 'title-too-long' };
  }
  const notes = (draft.notes ?? '').trim();
  if (notes.length > MAX_NOTES_LENGTH) {
    return { kind: 'invalid', fault: 'notes-too-long' };
  }
  const dueDate = draft.dueDate ?? null;
  if (dueDate !== null && !isLocalDate(dueDate)) {
    return { kind: 'invalid', fault: 'invalid-date' };
  }
  const suppliedTime = (draft.dueTime ?? '').trim();
  const dueTime = suppliedTime.length === 0 ? null : suppliedTime;
  if (dueTime !== null && (dueDate === null || !isLocalTime(dueTime))) {
    return { kind: 'invalid', fault: 'invalid-time' };
  }
  return {
    kind: 'valid',
    draft: {
      title,
      notes,
      dueDate,
      dueTime,
      priority: draft.priority ?? 'normal',
    },
  };
}

export function createPlannerTask(
  draft: PlannerTaskDraft,
  id: string,
  at: Date,
):
  | { readonly kind: 'created'; readonly task: PlannerTask }
  | { readonly kind: 'invalid'; readonly fault: PlannerTaskFault } {
  const validation = validatePlannerTaskDraft(draft);
  if (validation.kind === 'invalid') {
    return validation;
  }
  if (!TASK_ID_PATTERN.test(id)) {
    throw new Error('Planner task ids must be generated UUID addresses.');
  }
  const timestamp = at.toISOString();
  return {
    kind: 'created',
    task: {
      id,
      ...validation.draft,
      status: 'open',
      createdAt: timestamp,
      updatedAt: timestamp,
      completedAt: null,
    },
  };
}

export function revisePlannerTask(
  task: PlannerTask,
  draft: PlannerTaskDraft,
  at: Date,
):
  | { readonly kind: 'updated'; readonly task: PlannerTask }
  | { readonly kind: 'invalid'; readonly fault: PlannerTaskFault } {
  const validation = validatePlannerTaskDraft(draft);
  if (validation.kind === 'invalid') {
    return validation;
  }
  return {
    kind: 'updated',
    task: { ...task, ...validation.draft, updatedAt: at.toISOString() },
  };
}

export function setPlannerTaskCompleted(
  task: PlannerTask,
  completed: boolean,
  at: Date,
): PlannerTask {
  const timestamp = at.toISOString();
  return {
    ...task,
    status: completed ? 'completed' : 'open',
    completedAt: completed ? timestamp : null,
    updatedAt: timestamp,
  };
}

export function isPlannerTask(value: unknown): value is PlannerTask {
  if (!isRecord(value)) {
    return false;
  }
  const fields = Object.keys(value).sort();
  if (
    fields.length !== TASK_FIELDS.length ||
    !fields.every((field, index) => field === TASK_FIELDS[index])
  ) {
    return false;
  }
  const dueDate = value.dueDate;
  const dueTime = value.dueTime;
  return (
    typeof value.id === 'string' &&
    TASK_ID_PATTERN.test(value.id) &&
    typeof value.title === 'string' &&
    value.title === value.title.trim() &&
    value.title.length > 0 &&
    value.title.length <= MAX_TITLE_LENGTH &&
    typeof value.notes === 'string' &&
    value.notes === value.notes.trim() &&
    value.notes.length <= MAX_NOTES_LENGTH &&
    (dueDate === null || isLocalDate(dueDate)) &&
    (dueTime === null || (dueDate !== null && isLocalTime(dueTime))) &&
    plannerTaskPriorities.includes(value.priority as PlannerTaskPriority) &&
    plannerTaskStatuses.includes(value.status as PlannerTaskStatus) &&
    isIsoInstant(value.createdAt) &&
    isIsoInstant(value.updatedAt) &&
    (value.completedAt === null || isIsoInstant(value.completedAt)) &&
    (value.status === 'completed') === (value.completedAt !== null)
  );
}

export function parsePlannerTaskEnvelope(value: unknown): PlannerTaskEnvelope | null {
  if (
    !isRecord(value) ||
    value.version !== PLANNER_TASK_SCHEMA_VERSION ||
    !Array.isArray(value.tasks)
  ) {
    return null;
  }
  if (value.tasks.length > MAX_TASKS || !value.tasks.every(isPlannerTask)) {
    return null;
  }
  const ids = new Set(value.tasks.map((task) => task.id));
  if (ids.size !== value.tasks.length) {
    return null;
  }
  return { version: PLANNER_TASK_SCHEMA_VERSION, tasks: value.tasks };
}

export function sortPlannerTasks(tasks: readonly PlannerTask[]): readonly PlannerTask[] {
  return [...tasks].sort((left, right) => {
    if (left.status !== right.status) {
      return left.status === 'open' ? -1 : 1;
    }
    const leftDue = `${left.dueDate ?? '9999-99-99'}T${left.dueTime ?? '23:59'}`;
    const rightDue = `${right.dueDate ?? '9999-99-99'}T${right.dueTime ?? '23:59'}`;
    return leftDue.localeCompare(rightDue) || left.createdAt.localeCompare(right.createdAt);
  });
}
