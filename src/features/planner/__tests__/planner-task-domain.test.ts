import {
  createPlannerTask,
  isLocalDate,
  isLocalTime,
  localDateKey,
  offsetLocalDate,
  parsePlannerTaskEnvelope,
  revisePlannerTask,
  setPlannerTaskCompleted,
  sortPlannerTasks,
  validatePlannerTaskDraft,
} from '../data/planner-task';

const ID_A = 'task.aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const ID_B = 'task.bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
const AT = new Date('2026-08-21T08:00:00.000Z');

function task(id = ID_A) {
  const result = createPlannerTask(
    { title: '  Send the report  ', notes: '  Attach the signed copy  ', dueDate: '2026-08-21' },
    id,
    AT,
  );
  if (result.kind !== 'created') throw new Error('fixture failed');
  return result.task;
}

describe('Planner task domain', () => {
  it('normalises user-entered copy and supplies honest defaults', () => {
    const result = createPlannerTask(
      { title: '  Send the report  ', notes: '  Attach it  ', dueDate: null },
      ID_A,
      AT,
    );
    expect(result).toEqual({
      kind: 'created',
      task: {
        id: ID_A,
        title: 'Send the report',
        notes: 'Attach it',
        dueDate: null,
        dueTime: null,
        priority: 'normal',
        status: 'open',
        createdAt: AT.toISOString(),
        updatedAt: AT.toISOString(),
        completedAt: null,
      },
    });
  });

  it.each([
    [{ title: '   ' }, 'empty-title'],
    [{ title: 'x'.repeat(121) }, 'title-too-long'],
    [{ title: 'Valid', notes: 'x'.repeat(1001) }, 'notes-too-long'],
    [{ title: 'Valid', dueDate: '2026-02-30' }, 'invalid-date'],
    [{ title: 'Valid', dueTime: '09:30' }, 'invalid-time'],
    [{ title: 'Valid', dueDate: '2026-08-21', dueTime: '25:00' }, 'invalid-time'],
  ] as const)('rejects invalid input without repairing it: %s', (draft, fault) => {
    expect(validatePlannerTaskDraft(draft)).toEqual({ kind: 'invalid', fault });
  });

  it('accepts real leap days and strict 24-hour times', () => {
    expect(isLocalDate('2028-02-29')).toBe(true);
    expect(isLocalDate('2027-02-29')).toBe(false);
    expect(isLocalTime('00:00')).toBe(true);
    expect(isLocalTime('23:59')).toBe(true);
    expect(isLocalTime('9:30')).toBe(false);
  });

  it('uses local calendar arithmetic rather than UTC slicing', () => {
    const local = new Date(2026, 11, 31, 23, 30);
    expect(localDateKey(local)).toBe('2026-12-31');
    expect(offsetLocalDate(local, 1)).toBe('2027-01-01');
  });

  it('revises only editable fields and preserves completion state', () => {
    const completed = setPlannerTaskCompleted(task(), true, new Date('2026-08-21T09:00:00.000Z'));
    const revised = revisePlannerTask(
      completed,
      { title: 'Send the final report', dueDate: '2026-08-22', priority: 'high' },
      new Date('2026-08-21T10:00:00.000Z'),
    );
    expect(revised.kind).toBe('updated');
    if (revised.kind === 'updated') {
      expect(revised.task.id).toBe(ID_A);
      expect(revised.task.status).toBe('completed');
      expect(revised.task.completedAt).toBe('2026-08-21T09:00:00.000Z');
      expect(revised.task.title).toBe('Send the final report');
    }
  });

  it('completes and reopens with explicit timestamps', () => {
    const completed = setPlannerTaskCompleted(task(), true, new Date('2026-08-21T09:00:00.000Z'));
    expect(completed.status).toBe('completed');
    expect(completed.completedAt).toBe('2026-08-21T09:00:00.000Z');
    const reopened = setPlannerTaskCompleted(
      completed,
      false,
      new Date('2026-08-21T10:00:00.000Z'),
    );
    expect(reopened.status).toBe('open');
    expect(reopened.completedAt).toBeNull();
  });

  it('fails closed on unknown fields, duplicate ids, corrupt timestamps and oversized stores', () => {
    const valid = task();
    expect(parsePlannerTaskEnvelope({ version: 1, tasks: [valid] })).not.toBeNull();
    expect(
      parsePlannerTaskEnvelope({ version: 1, tasks: [{ ...valid, secret: 'no' }] }),
    ).toBeNull();
    expect(parsePlannerTaskEnvelope({ version: 1, tasks: [valid, valid] })).toBeNull();
    expect(
      parsePlannerTaskEnvelope({ version: 1, tasks: [{ ...valid, updatedAt: 'yesterday' }] }),
    ).toBeNull();
    expect(parsePlannerTaskEnvelope({ version: 1, tasks: Array(501).fill(valid) })).toBeNull();
  });

  it('sorts open tasks before completed tasks, then by due date and time', () => {
    const late = { ...task(ID_A), dueDate: '2026-08-22', dueTime: '08:00' };
    const early = { ...task(ID_B), dueDate: '2026-08-21', dueTime: '17:00' };
    const done = setPlannerTaskCompleted(early, true, new Date('2026-08-21T09:00:00.000Z'));
    expect(sortPlannerTasks([done, late, early]).map((item) => item.id)).toEqual([
      ID_B,
      ID_A,
      ID_B,
    ]);
  });

  it('rejects ids outside the generated task namespace', () => {
    expect(() => createPlannerTask({ title: 'Valid' }, 'user-supplied', AT)).toThrow(
      'Planner task ids must be generated UUID addresses.',
    );
  });
});
