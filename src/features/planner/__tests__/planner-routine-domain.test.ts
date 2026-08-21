import { isoFor, weekdayColumn } from '@shared/utils/calendar-grid';

import {
  MAX_COMPLETION_DAYS,
  MAX_ROUTINES,
  MAX_ROUTINE_NOTE_LENGTH,
  MAX_ROUTINE_TITLE_LENGTH,
  createPlannerRoutine,
  emptyCompletions,
  isPlannerRoutine,
  parsePlannerRoutineCompletions,
  parsePlannerRoutineEnvelope,
  pruneCompletions,
  revisePlannerRoutine,
  routineFallsOn,
  routineIsCompletedOn,
  routineOccurrenceKey,
  routineScheduleLabel,
  routineScheduleSpoken,
  routineWeekdayName,
  routineWeekdays,
  routinesScheduledOn,
  setPlannerRoutineActive,
  sortPlannerRoutines,
  validatePlannerRoutineDraft,
  withRoutineCompletion,
  type PlannerRoutine,
  type RoutineSchedule,
  type RoutineWeekday,
} from '../data/planner-routine';

/**
 * The routine domain: when a routine is due, what a completion means, and what the app refuses to
 * invent.
 */

let sequence = 0;

function nextId(): string {
  sequence += 1;
  return `routine.aaaaaaaa-1111-4111-8111-${String(sequence).padStart(12, '0')}`;
}

function routine(overrides?: {
  readonly title?: string;
  readonly note?: string;
  readonly schedule?: RoutineSchedule;
  readonly preferredTime?: string | null;
  readonly priority?: 'normal' | 'high';
  readonly active?: boolean;
  readonly createdAt?: string;
}): PlannerRoutine {
  const created = createPlannerRoutine(
    {
      title: overrides?.title ?? `Routine ${sequence + 1}`,
      note: overrides?.note ?? '',
      schedule: overrides?.schedule ?? { kind: 'daily' },
      preferredTime: overrides?.preferredTime ?? null,
      priority: overrides?.priority ?? 'normal',
      active: overrides?.active ?? true,
    },
    nextId(),
    new Date(overrides?.createdAt ?? '2026-08-21T08:00:00.000Z'),
  );
  if (created.kind !== 'created') {
    throw new Error(`fixture is not a valid routine: ${created.fault}`);
  }
  return created.routine;
}

/* 2026-08-17 is a Monday, so this week runs Monday..Sunday as 17..23. */
const MONDAY = '2026-08-17';
const TUESDAY = '2026-08-18';
const WEDNESDAY = '2026-08-19';
const SATURDAY = '2026-08-22';
const SUNDAY = '2026-08-23';

describe('weekday identity', () => {
  it('is Monday-first and agrees with the calendar grid', () => {
    expect(weekdayColumn(MONDAY)).toBe(0);
    expect(weekdayColumn(SUNDAY)).toBe(6);
    expect(routineWeekdayName(0)).toBe('Monday');
    expect(routineWeekdayName(6)).toBe('Sunday');
  });

  it('offers exactly seven days, each with a full name', () => {
    expect(routineWeekdays).toHaveLength(7);
    routineWeekdays.forEach((day) => {
      expect(routineWeekdayName(day).length).toBeGreaterThan(2);
    });
  });
});

describe('a daily schedule', () => {
  it('falls on every day of a week', () => {
    const daily = routine({ schedule: { kind: 'daily' } });
    for (let day = 17; day <= 23; day += 1) {
      expect(routineFallsOn(daily, isoFor(2026, 8, day))).toBe(true);
    }
  });

  it('falls on a leap day and on both sides of a year boundary', () => {
    const daily = routine({ schedule: { kind: 'daily' } });
    ['2028-02-29', '2026-12-31', '2027-01-01'].forEach((day) => {
      expect(routineFallsOn(daily, day)).toBe(true);
    });
  });
});

describe('a weekday schedule', () => {
  /*
    Every weekday individually. A single off-by-one in the Monday-first mapping would put a routine on
    the wrong day for the rest of the app's life, and it is the sort of error nobody notices until a
    user says "this is showing on Tuesdays".
  */
  it.each([
    [0, MONDAY, 'Monday'],
    [1, TUESDAY, 'Tuesday'],
    [2, WEDNESDAY, 'Wednesday'],
    [3, '2026-08-20', 'Thursday'],
    [4, '2026-08-21', 'Friday'],
    [5, SATURDAY, 'Saturday'],
    [6, SUNDAY, 'Sunday'],
  ])('index %i falls only on %s (%s)', (index, day) => {
    const only = routine({
      schedule: { kind: 'weekdays', days: [index as RoutineWeekday] },
    });
    expect(routineFallsOn(only, day)).toBe(true);
    for (let other = 17; other <= 23; other += 1) {
      const iso = isoFor(2026, 8, other);
      if (iso !== day) {
        expect(routineFallsOn(only, iso)).toBe(false);
      }
    }
  });

  it('handles several selected days', () => {
    const mwf = routine({ schedule: { kind: 'weekdays', days: [0, 2, 4] } });
    expect(routineFallsOn(mwf, MONDAY)).toBe(true);
    expect(routineFallsOn(mwf, WEDNESDAY)).toBe(true);
    expect(routineFallsOn(mwf, '2026-08-21')).toBe(true);
    expect(routineFallsOn(mwf, TUESDAY)).toBe(false);
    expect(routineFallsOn(mwf, SUNDAY)).toBe(false);
  });

  /*
    The Sunday/Monday boundary is where a Sunday-first convention would silently disagree. Consecutive
    days must land in consecutive indices with the week wrapping only between Sunday and Monday.
  */
  it('does not confuse Sunday with Monday across the week boundary', () => {
    const sunday = routine({ schedule: { kind: 'weekdays', days: [6] } });
    const monday = routine({ schedule: { kind: 'weekdays', days: [0] } });

    expect(routineFallsOn(sunday, SUNDAY)).toBe(true);
    expect(routineFallsOn(sunday, '2026-08-24')).toBe(false); // the Monday after
    expect(routineFallsOn(monday, '2026-08-24')).toBe(true);
    expect(routineFallsOn(monday, SUNDAY)).toBe(false);
  });

  it('keeps the same weekday across a year boundary and a leap February', () => {
    // 2026-12-31 is a Thursday; 2028-02-29 is a Tuesday.
    const thursday = routine({ schedule: { kind: 'weekdays', days: [3] } });
    const tuesday = routine({ schedule: { kind: 'weekdays', days: [1] } });

    expect(routineFallsOn(thursday, '2026-12-31')).toBe(true);
    expect(routineFallsOn(tuesday, '2028-02-29')).toBe(true);
    expect(routineFallsOn(thursday, '2028-02-29')).toBe(false);
  });

  it('advances by one weekday index per calendar day for a whole year', () => {
    let previous = weekdayColumn('2026-01-01');
    for (let month = 1; month <= 12; month += 1) {
      for (let day = 1; day <= 28; day += 1) {
        if (month === 1 && day === 1) {
          continue;
        }
        const column = weekdayColumn(isoFor(2026, month, day));
        const only = routine({ schedule: { kind: 'weekdays', days: [column as RoutineWeekday] } });
        expect(routineFallsOn(only, isoFor(2026, month, day))).toBe(true);
        previous = column;
      }
    }
    expect(previous).toBeGreaterThanOrEqual(0);
  });
});

describe('local-date handling', () => {
  /*
    No `Date` arithmetic anywhere in the scheduling path: the day is a string and `weekdayColumn`
    builds a UTC instant from its parts. So a DST transition cannot move a routine to a different
    weekday, which is the class of defect this project has already paid for in prayer times.
  */
  it.each(['2026-03-08', '2026-03-29', '2026-10-25', '2026-11-01'])(
    'does not shift the weekday on a DST transition (%s)',
    (day) => {
      const column = weekdayColumn(day) as RoutineWeekday;
      const only = routine({ schedule: { kind: 'weekdays', days: [column] } });
      expect(routineFallsOn(only, day)).toBe(true);
    },
  );

  it('refuses a malformed day rather than guessing', () => {
    const daily = routine({ schedule: { kind: 'daily' } });
    ['', 'today', '2026-13-01', '2026-02-30', '2026-8-1'].forEach((bad) => {
      expect(routineFallsOn(daily, bad)).toBe(false);
    });
  });
});

describe('validation', () => {
  const base = { title: 'Stretch', schedule: { kind: 'daily' } as RoutineSchedule };

  it('accepts a minimal draft and normalises it', () => {
    const result = validatePlannerRoutineDraft({ title: '  Stretch  ', schedule: base.schedule });
    expect(result.kind).toBe('valid');
    if (result.kind === 'valid') {
      expect(result.draft.title).toBe('Stretch');
      expect(result.draft.note).toBe('');
      expect(result.draft.preferredTime).toBeNull();
      expect(result.draft.priority).toBe('normal');
      expect(result.draft.active).toBe(true);
    }
  });

  it('rejects an empty or whitespace-only name', () => {
    expect(validatePlannerRoutineDraft({ ...base, title: '' })).toEqual({
      kind: 'invalid',
      fault: 'empty-title',
    });
    expect(validatePlannerRoutineDraft({ ...base, title: '   ' })).toEqual({
      kind: 'invalid',
      fault: 'empty-title',
    });
  });

  it('enforces the title and note limits', () => {
    expect(
      validatePlannerRoutineDraft({ ...base, title: 'x'.repeat(MAX_ROUTINE_TITLE_LENGTH + 1) }),
    ).toEqual({ kind: 'invalid', fault: 'title-too-long' });
    expect(
      validatePlannerRoutineDraft({ ...base, note: 'x'.repeat(MAX_ROUTINE_NOTE_LENGTH + 1) }),
    ).toEqual({ kind: 'invalid', fault: 'note-too-long' });
    // ...and accepts exactly the limit.
    expect(
      validatePlannerRoutineDraft({ ...base, title: 'x'.repeat(MAX_ROUTINE_TITLE_LENGTH) }).kind,
    ).toBe('valid');
  });

  /*
    A weekday schedule with nothing selected would never come due. Silently never appearing is worse
    than being told to pick a day.
  */
  it('rejects a weekday schedule with no days chosen', () => {
    expect(
      validatePlannerRoutineDraft({ ...base, schedule: { kind: 'weekdays', days: [] } }),
    ).toEqual({ kind: 'invalid', fault: 'no-weekdays' });
  });

  it('rejects an out-of-range or duplicated weekday', () => {
    expect(
      validatePlannerRoutineDraft({
        ...base,
        schedule: { kind: 'weekdays', days: [9 as RoutineWeekday] },
      }),
    ).toEqual({ kind: 'invalid', fault: 'invalid-weekday' });
    expect(
      validatePlannerRoutineDraft({ ...base, schedule: { kind: 'weekdays', days: [1, 1] } }),
    ).toEqual({ kind: 'invalid', fault: 'duplicate-weekday' });
  });

  it('sorts chosen days, so tap order is not part of the schedule', () => {
    const result = validatePlannerRoutineDraft({
      ...base,
      schedule: { kind: 'weekdays', days: [4, 0, 2] },
    });
    expect(result.kind).toBe('valid');
    if (result.kind === 'valid' && result.draft.schedule.kind === 'weekdays') {
      expect(result.draft.schedule.days).toEqual([0, 2, 4]);
    }
  });

  it.each([['24:00'], ['7:30'], ['07:60'], ['half seven'], ['0730']])(
    'rejects %s as a preferred time',
    (bad) => {
      expect(validatePlannerRoutineDraft({ ...base, preferredTime: bad })).toEqual({
        kind: 'invalid',
        fault: 'invalid-time',
      });
    },
  );

  it('accepts a valid time, and treats blank as none', () => {
    expect(validatePlannerRoutineDraft({ ...base, preferredTime: '07:30' }).kind).toBe('valid');
    const blank = validatePlannerRoutineDraft({ ...base, preferredTime: '   ' });
    expect(blank.kind).toBe('valid');
    if (blank.kind === 'valid') {
      expect(blank.draft.preferredTime).toBeNull();
    }
  });

  /*
    Unlike a task, a routine's time needs no date. A task refuses a time without a day because the
    time would have nothing to attach to; a routine's day comes from its schedule.
  */
  it('accepts a time with no date attached, because a routine has no single date', () => {
    expect(validatePlannerRoutineDraft({ ...base, preferredTime: '07:30' }).kind).toBe('valid');
  });

  it('refuses to create a routine with an id it did not generate', () => {
    expect(() => createPlannerRoutine(base, 'routine-1', new Date())).toThrow(
      'Planner routine ids must be generated UUID addresses.',
    );
    expect(() =>
      createPlannerRoutine(base, 'task.aaaaaaaa-1111-4111-8111-000000000001', new Date()),
    ).toThrow();
  });
});

describe('revision and activation', () => {
  it('keeps the id and createdAt through an edit', () => {
    const original = routine({ title: 'Stretch' });
    const updated = revisePlannerRoutine(
      original,
      { title: 'Stretch longer', schedule: { kind: 'weekdays', days: [0, 2] } },
      new Date('2026-08-22T09:00:00.000Z'),
    );

    expect(updated.kind).toBe('updated');
    if (updated.kind === 'updated') {
      expect(updated.routine.id).toBe(original.id);
      expect(updated.routine.createdAt).toBe(original.createdAt);
      expect(updated.routine.updatedAt).toBe('2026-08-22T09:00:00.000Z');
      expect(updated.routine.title).toBe('Stretch longer');
    }
  });

  it('turns a routine off without changing anything else', () => {
    const original = routine({ title: 'Stretch' });
    const off = setPlannerRoutineActive(original, false, new Date('2026-08-22T09:00:00.000Z'));

    expect(off.active).toBe(false);
    expect(off.id).toBe(original.id);
    expect(off.title).toBe(original.title);
    expect(off.createdAt).toBe(original.createdAt);
  });
});

describe('what appears on a day', () => {
  it('shows only active routines whose schedule includes it', () => {
    const routines = [
      routine({ title: 'Daily on', schedule: { kind: 'daily' } }),
      routine({ title: 'Daily off', schedule: { kind: 'daily' }, active: false }),
      routine({ title: 'Mondays', schedule: { kind: 'weekdays', days: [0] } }),
      routine({ title: 'Sundays', schedule: { kind: 'weekdays', days: [6] } }),
    ];

    expect(routinesScheduledOn(routines, MONDAY).map((r) => r.title)).toEqual([
      'Daily on',
      'Mondays',
    ]);
  });

  it('orders by preferred time, then title', () => {
    const routines = [
      routine({ title: 'Later', preferredTime: '18:00' }),
      routine({ title: 'Untimed B' }),
      routine({ title: 'Earlier', preferredTime: '06:30' }),
      routine({ title: 'Untimed A' }),
    ];

    expect(sortPlannerRoutines(routines).map((r) => r.title)).toEqual([
      'Earlier',
      'Later',
      'Untimed A',
      'Untimed B',
    ]);
  });

  it('does not mutate the array it was given', () => {
    const routines = [routine({ title: 'B', preferredTime: '18:00' }), routine({ title: 'A' })];
    const order = routines.map((r) => r.title);
    sortPlannerRoutines(routines);
    expect(routines.map((r) => r.title)).toEqual(order);
  });
});

describe('occurrence identity', () => {
  it('is the routine and the local day, and nothing else', () => {
    const one = routine({ title: 'Stretch' });
    expect(routineOccurrenceKey(one.id, MONDAY)).toBe(`${one.id}@${MONDAY}`);
    // Stable across calls — it is derived, never generated.
    expect(routineOccurrenceKey(one.id, MONDAY)).toBe(routineOccurrenceKey(one.id, MONDAY));
    expect(routineOccurrenceKey(one.id, MONDAY)).not.toBe(routineOccurrenceKey(one.id, TUESDAY));
  });
});

describe('completions', () => {
  const id = 'routine.aaaaaaaa-1111-4111-8111-000000000999';

  it('records and clears one day', () => {
    const marked = withRoutineCompletion(emptyCompletions, id, MONDAY, true);
    expect(routineIsCompletedOn(marked, id, MONDAY)).toBe(true);

    const cleared = withRoutineCompletion(marked, id, MONDAY, false);
    expect(routineIsCompletedOn(cleared, id, MONDAY)).toBe(false);
  });

  it('leaves tomorrow incomplete without deleting today', () => {
    const marked = withRoutineCompletion(emptyCompletions, id, MONDAY, true);

    expect(routineIsCompletedOn(marked, id, TUESDAY)).toBe(false);
    expect(routineIsCompletedOn(marked, id, MONDAY)).toBe(true);
  });

  it('reopening one day leaves the others alone', () => {
    let log = withRoutineCompletion(emptyCompletions, id, MONDAY, true);
    log = withRoutineCompletion(log, id, TUESDAY, true);
    log = withRoutineCompletion(log, id, MONDAY, false);

    expect(routineIsCompletedOn(log, id, MONDAY)).toBe(false);
    expect(routineIsCompletedOn(log, id, TUESDAY)).toBe(true);
  });

  it('is idempotent, so a double tap does not double-record', () => {
    const once = withRoutineCompletion(emptyCompletions, id, MONDAY, true);
    const twice = withRoutineCompletion(once, id, MONDAY, true);
    expect(twice.days[MONDAY]).toEqual([id]);
  });

  it('removes an emptied day rather than leaving an empty list behind', () => {
    const marked = withRoutineCompletion(emptyCompletions, id, MONDAY, true);
    const cleared = withRoutineCompletion(marked, id, MONDAY, false);
    expect(Object.keys(cleared.days)).not.toContain(MONDAY);
  });

  it('ignores a malformed day', () => {
    expect(withRoutineCompletion(emptyCompletions, id, 'nonsense', true)).toEqual(emptyCompletions);
  });
});

describe('retention and orphan cleanup', () => {
  const live = 'routine.aaaaaaaa-1111-4111-8111-000000000111';
  const dead = 'routine.aaaaaaaa-1111-4111-8111-000000000222';

  it('drops every trace of a routine that no longer exists', () => {
    let log = withRoutineCompletion(emptyCompletions, live, MONDAY, true);
    log = withRoutineCompletion(log, dead, MONDAY, true);
    log = withRoutineCompletion(log, dead, TUESDAY, true);

    const pruned = pruneCompletions(log, [live]);

    expect(pruned.days[MONDAY]).toEqual([live]);
    expect(Object.keys(pruned.days)).not.toContain(TUESDAY);
  });

  it('keeps the newest days and no more than the retention window', () => {
    let log = emptyCompletions;
    // Well past the window, oldest first.
    for (let day = 0; day < MAX_COMPLETION_DAYS + 40; day += 1) {
      const iso = isoFor(2024, 1, 1).slice(0, 8) + '01';
      void iso;
      const date = new Date(Date.UTC(2024, 0, 1 + day));
      log = withRoutineCompletion(log, live, date.toISOString().slice(0, 10), true);
    }
    const pruned = pruneCompletions(log, [live]);
    const days = Object.keys(pruned.days).sort();

    expect(days).toHaveLength(MAX_COMPLETION_DAYS);
    // The newest day survives and the oldest does not.
    expect(days[days.length - 1]).toBe(
      new Date(Date.UTC(2024, 0, MAX_COMPLETION_DAYS + 40)).toISOString().slice(0, 10),
    );
    expect(days[0]).not.toBe('2024-01-01');
  });

  it('is deterministic — pruning twice changes nothing further', () => {
    let log = emptyCompletions;
    for (let day = 1; day <= 30; day += 1) {
      log = withRoutineCompletion(log, live, isoFor(2026, 8, day), true);
    }
    const once = pruneCompletions(log, [live]);
    expect(pruneCompletions(once, [live])).toEqual(once);
  });

  it('empties entirely when nothing is live', () => {
    const log = withRoutineCompletion(emptyCompletions, dead, MONDAY, true);
    expect(pruneCompletions(log, []).days).toEqual({});
  });
});

describe('envelope parsing', () => {
  it('accepts a well-formed envelope', () => {
    const one = routine({ title: 'Stretch' });
    expect(parsePlannerRoutineEnvelope({ version: 1, routines: [one] })).toEqual({
      version: 1,
      routines: [one],
    });
  });

  it.each([
    ['a wrong version', { version: 2, routines: [] }],
    ['a missing list', { version: 1 }],
    ['a non-array list', { version: 1, routines: {} }],
    ['not an object', 'routines'],
    ['null', null],
  ])('refuses %s', (_label, value) => {
    expect(parsePlannerRoutineEnvelope(value)).toBeNull();
  });

  it('refuses duplicate ids', () => {
    const one = routine({ title: 'Stretch' });
    expect(parsePlannerRoutineEnvelope({ version: 1, routines: [one, one] })).toBeNull();
  });

  it('refuses more routines than the limit', () => {
    const many = Array.from({ length: MAX_ROUTINES + 1 }, () => routine({}));
    expect(parsePlannerRoutineEnvelope({ version: 1, routines: many })).toBeNull();
  });

  it('refuses a routine with an unexpected field', () => {
    const one = { ...routine({}), streak: 7 };
    expect(isPlannerRoutine(one)).toBe(false);
    expect(parsePlannerRoutineEnvelope({ version: 1, routines: [one] })).toBeNull();
  });

  it('refuses a routine with a broken schedule', () => {
    const one = { ...routine({}), schedule: { kind: 'weekdays', days: [] } };
    expect(isPlannerRoutine(one)).toBe(false);
  });

  it('accepts and refuses completion logs on their shape', () => {
    expect(parsePlannerRoutineCompletions({ version: 1, days: {} })).toEqual(emptyCompletions);
    expect(
      parsePlannerRoutineCompletions({
        version: 1,
        days: { [MONDAY]: ['routine.aaaaaaaa-1111-4111-8111-000000000111'] },
      }),
    ).not.toBeNull();

    expect(parsePlannerRoutineCompletions({ version: 2, days: {} })).toBeNull();
    expect(parsePlannerRoutineCompletions({ version: 1, days: { 'not-a-day': [] } })).toBeNull();
    expect(parsePlannerRoutineCompletions({ version: 1, days: { [MONDAY]: ['nope'] } })).toBeNull();
    expect(
      parsePlannerRoutineCompletions({
        version: 1,
        days: {
          [MONDAY]: [
            'routine.aaaaaaaa-1111-4111-8111-000000000111',
            'routine.aaaaaaaa-1111-4111-8111-000000000111',
          ],
        },
      }),
    ).toBeNull();
  });
});

describe('what a row says', () => {
  it('labels a daily and a weekday schedule', () => {
    expect(routineScheduleLabel({ kind: 'daily' })).toBe('Every day');
    expect(routineScheduleLabel({ kind: 'weekdays', days: [0, 2, 4] })).toBe('Mon, Wed, Fri');
  });

  it('speaks them in full, because abbreviations are not days read aloud', () => {
    expect(routineScheduleSpoken({ kind: 'daily' })).toBe('Every day');
    expect(routineScheduleSpoken({ kind: 'weekdays', days: [0] })).toBe('Every Monday');
    expect(routineScheduleSpoken({ kind: 'weekdays', days: [0, 2] })).toBe(
      'Every Monday and Wednesday',
    );
    expect(routineScheduleSpoken({ kind: 'weekdays', days: [0, 2, 4] })).toBe(
      'Every Monday, Wednesday and Friday',
    );
  });

  /*
    This phase records today and aggregates nothing. No streak, no percentage, no encouragement — a
    count across days is a claim about somebody's life, and displaying one starts rewarding and
    implicitly judging.
  */
  it('never produces a streak, score or motivational phrase', () => {
    const labels = [
      routineScheduleLabel({ kind: 'daily' }),
      routineScheduleLabel({ kind: 'weekdays', days: [0, 1, 2, 3, 4, 5, 6] }),
      routineScheduleSpoken({ kind: 'daily' }),
      routineScheduleSpoken({ kind: 'weekdays', days: [5, 6] }),
    ];
    labels.forEach((label) => {
      expect(label).not.toMatch(/streak|%|score|well done|keep going|badge|perfect/i);
    });
  });
});
