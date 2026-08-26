import fs from 'node:fs';
import path from 'node:path';

import { StrictMode, useEffect } from 'react';
import { Text, View } from 'react-native';
import { act, render, screen } from '@testing-library/react-native';

import { TodayAgendaProvider, useTodayAgenda } from '@application/providers/today-agenda-provider';
import { ModuleProvider } from '@features/modules/module-context';
import { pinModuleWindow } from '@/test-support/module-window';
import { installPlannerDaySource, type PlannerDayHarness } from '@/test-support/planner-day';

import {
  msUntilNextLocalMidnight,
  plannerDayAt,
  samePlannerDay,
  type PlannerDay,
} from '../data/planner-day';
import { routinesScheduledOn } from '../data/planner-routine';
import { localDateKey, offsetLocalDate } from '../data/planner-task';
import {
  createPlannerRoutineRepository,
  type PlannerRoutineStorage,
} from '../data/planner-routine.repository';
import {
  createPlannerTaskRepository,
  type PlannerTaskStorage,
} from '../data/planner-task.repository';
import { createPlannerDaySource, usePlannerDay } from '../di/planner-day-source';
import { PlannerRoutineProvider, usePlannerRoutines } from '../di/planner-routine-provider';
import { usePlanner } from '../di/planner-provider';
import { PlannerHomeContent } from '../screens/planner-home-content';

/**
 * **One day, read once, shared by every Planner surface** — issue #76.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── What was wrong ─────────────────────────────────────────────────────────
 * Five surfaces derived "today" independently. Tasks, Calendar and Routines captured `new Date()`
 * once per mount, Main Home's agenda port captured it once per provider mount, and the Planner home
 * read it on **every render**. A session held open across midnight left them stale *differently*:
 * the home rolled over on its next re-render while the calendar still highlighted yesterday, so
 * "Due today" counted a day the list beside it was not showing.
 *
 * Underneath that was a sharper defect. With the clock read per call, one logical operation could
 * read two days — `localDateKey(new Date())` followed by `offsetLocalDate(new Date(), 1)` on the next
 * line lands either side of midnight if the boundary passes between them, and "today" and "tomorrow"
 * stop being consecutive. No amount of memoisation per surface fixes that; only reading the clock
 * once does.
 *
 * ── Why these tests state the clock ────────────────────────────────────────
 * Every case here names the instant. Nothing waits for a real midnight, nothing changes a device
 * clock, and nothing is timing-dependent: the harness hands back the armed timer's callback, so
 * "midnight arrives" is a function call. That is also what makes the just-before / at / just-after
 * trio meaningful — they are three stated instants, not three sleeps.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const OWNER = '5c2a7e10-3b4d-4f81-9a62-8e0d1c3f5b74';
const OTHER = '9d4f1b26-7e83-4a05-b1c9-2f6a8d0e4c37';

/** 23:59:30 local on a stated day, and the same wall-clock moment one minute later. */
function justBeforeMidnight(): Date {
  const date = new Date(2026, 7, 21, 23, 59, 30, 0);
  return date;
}

function atMidnight(): Date {
  return new Date(2026, 7, 22, 0, 0, 0, 0);
}

function justAfterMidnight(): Date {
  return new Date(2026, 7, 22, 0, 0, 30, 0);
}

/* Stated ids, so a run is reproducible and the repositories' UUID-address rule is satisfied. */
let ids = 0;
const taskId = (): string => `task.${String(++ids).padStart(8, '0')}-0000-4000-8000-000000000000`;
const routineId = (): string =>
  `routine.${String(++ids).padStart(8, '0')}-0000-4000-8000-000000000000`;

const DAY_ONE = localDateKey(justBeforeMidnight());
const DAY_TWO = localDateKey(atMidnight());

function memoryTaskStorage(seed: readonly { readonly id: string; readonly due: string }[] = []) {
  const raw = new Map<string, string>();
  const storage: PlannerTaskStorage = {
    async getItem(key) {
      await Promise.resolve();
      return raw.get(key) ?? null;
    },
    async setItem(key, value) {
      await Promise.resolve();
      raw.set(key, value);
    },
  };
  return { raw, storage, seed };
}

function routineStorage(): PlannerRoutineStorage {
  const raw = new Map<string, string>();
  return {
    async getItem(key) {
      await Promise.resolve();
      return raw.get(key) ?? null;
    },
    async setItem(key, value) {
      await Promise.resolve();
      raw.set(key, value);
    },
  };
}

/* Every surface's idea of the day, published where an assertion can read it side by side. */
type Handles = {
  planner: ReturnType<typeof usePlanner> | null;
  routines: ReturnType<typeof usePlannerRoutines> | null;
};
const handles: Handles = { planner: null, routines: null };

function TaskDriver() {
  const planner = usePlanner();
  useEffect(() => {
    handles.planner = planner;
  }, [planner]);
  return null;
}

function RoutineDriver() {
  const routines = usePlannerRoutines();
  useEffect(() => {
    handles.routines = routines;
  }, [routines]);
  return null;
}

/** Stands in for Tasks, Calendar and Routines: each reads the day the same single way. */
function SurfaceProbe({ name }: { readonly name: string }) {
  const { today, tomorrow } = usePlannerDay();
  return (
    <View>
      <Text testID={`${name}-today`}>{today}</Text>
      <Text testID={`${name}-tomorrow`}>{tomorrow}</Text>
    </View>
  );
}

/** Main Home reads through the agenda port, not through `usePlannerDay` directly. */
function MainHomeProbe() {
  const agenda = useTodayAgenda();
  return (
    <View>
      <Text testID="mainhome-today">{agenda.today}</Text>
      <Text testID="mainhome-count">{String(agenda.items.length)}</Text>
    </View>
  );
}

/** Routine scheduling, resolved against whatever day the shared source is publishing. */
function RoutineOccurrenceProbe() {
  const { today } = usePlannerDay();
  const routines = usePlannerRoutines();
  const scheduled = routinesScheduledOn(routines.routines, today);
  return <Text testID="routine-scheduled">{String(scheduled.length)}</Text>;
}

async function renderTree(options: {
  readonly tasks: PlannerTaskStorage;
  readonly ownerId?: string;
  readonly strict?: boolean;
}) {
  const tree = (
    <TodayAgendaProvider
      repository={createPlannerTaskRepository({
        ownerId: options.ownerId ?? OWNER,
        storage: options.tasks,
        id: taskId,
        now: () => harness?.now() ?? justBeforeMidnight(),
      })}
    >
      <PlannerRoutineProvider
        repository={createPlannerRoutineRepository({
          ownerId: options.ownerId ?? OWNER,
          storage: routineStorage(),
          id: routineId,
          now: () => harness?.now() ?? justBeforeMidnight(),
        })}
      >
        <ModuleProvider moduleId="planner">
          <TaskDriver />
          <RoutineDriver />
          <PlannerHomeContent />
          <SurfaceProbe name="tasks" />
          <SurfaceProbe name="calendar" />
          <SurfaceProbe name="routines" />
          <RoutineOccurrenceProbe />
          <MainHomeProbe />
        </ModuleProvider>
      </PlannerRoutineProvider>
    </TodayAgendaProvider>
  );
  return render(options.strict === true ? <StrictMode>{tree}</StrictMode> : tree);
}

/*
  Read from the metric tile's accessibility label rather than by digging into its text nodes: the
  label is the contract the card publishes — "Due today, 1" — and it is what a screen reader states.
*/
function dueTodayCount(): string {
  const label = screen.getByTestId('planner-summary-today').props.accessibilityLabel as string;
  return label.replace('Due today, ', '');
}

/** Every surface's day, in one object, so agreement is a single assertion. */
function surfaceDays(): Record<string, string> {
  return {
    tasks: screen.getByTestId('tasks-today').props.children as string,
    calendar: screen.getByTestId('calendar-today').props.children as string,
    routines: screen.getByTestId('routines-today').props.children as string,
    mainHome: screen.getByTestId('mainhome-today').props.children as string,
  };
}

let harness: PlannerDayHarness | null = null;

beforeEach(() => {
  pinModuleWindow();
  ids = 0;
});

afterEach(() => {
  harness?.restore();
  harness = null;
  handles.planner = null;
  handles.routines = null;
});

// ─────────────────────────────────────────────────────────────────────────────
// The snapshot itself
// ─────────────────────────────────────────────────────────────────────────────

describe('a day snapshot is one reading of the clock', () => {
  it('keeps today and tomorrow consecutive even when the clock moves between calls', () => {
    /*
      The load-bearing case. This clock advances past midnight on its *second* read, which is exactly
      the interleaving the old per-call `new Date()` could hit. `plannerDayAt` reads once, so the pair
      it returns is consistent by construction; the old shape is shown beneath it to be not.
    */
    let reads = 0;
    const creepingClock = (): Date => {
      reads += 1;
      return reads === 1 ? justBeforeMidnight() : justAfterMidnight();
    };

    const snapshot = plannerDayAt(creepingClock());
    expect(snapshot.today).toBe(DAY_ONE);
    expect(snapshot.tomorrow).toBe(offsetLocalDate(justBeforeMidnight(), 1));
    expect(snapshot.tomorrow).toBe(DAY_TWO);

    /* The superseded shape, on the same clock: today is day one and tomorrow is day *three*. */
    reads = 0;
    const strayToday = localDateKey(creepingClock());
    const strayTomorrow = offsetLocalDate(creepingClock(), 1);
    expect(strayToday).toBe(DAY_ONE);
    expect(strayTomorrow).not.toBe(strayToday);
    expect(strayTomorrow).not.toBe(offsetLocalDate(new Date(strayToday), 1));
  });

  it('reads the same day just before, at, and just after midnight', () => {
    expect(plannerDayAt(justBeforeMidnight()).today).toBe(DAY_ONE);
    expect(plannerDayAt(atMidnight()).today).toBe(DAY_TWO);
    expect(plannerDayAt(justAfterMidnight()).today).toBe(DAY_TWO);
    expect(plannerDayAt(justBeforeMidnight()).tomorrow).toBe(DAY_TWO);
  });

  it('counts the milliseconds to the next local midnight without assuming a 24-hour day', () => {
    expect(msUntilNextLocalMidnight(justBeforeMidnight())).toBe(30_000);
    /* Exactly at midnight the next boundary is a whole day away, not zero. */
    expect(msUntilNextLocalMidnight(atMidnight())).toBeGreaterThan(23 * 60 * 60 * 1000);
    /* Never zero or negative: a timer armed for zero would spin rather than wait. */
    expect(msUntilNextLocalMidnight(new Date(2026, 7, 22, 23, 59, 59, 999))).toBeGreaterThan(0);
  });

  it('treats a zone change as a change even when the date key holds', () => {
    const left: PlannerDay = { today: DAY_ONE, tomorrow: DAY_TWO, zoneOffsetMinutes: -240 };
    const right: PlannerDay = { today: DAY_ONE, tomorrow: DAY_TWO, zoneOffsetMinutes: -120 };
    expect(samePlannerDay(left, left)).toBe(true);
    expect(samePlannerDay(left, right)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The source
// ─────────────────────────────────────────────────────────────────────────────

describe('the shared day source', () => {
  it('arms exactly one midnight timer however many surfaces subscribe', () => {
    harness = installPlannerDaySource(justBeforeMidnight());
    const before = harness.armCount();

    const stops = [0, 1, 2, 3, 4].map(() => harness!.source.subscribe(() => undefined));

    /* Five subscribers, one arm — the whole point of a shared source rather than five timers. */
    expect(harness.armCount()).toBe(before + 1);
    expect(harness.appStateListenerCount()).toBe(1);

    stops.forEach((stop) => stop());
    expect(harness.isArmed()).toBe(false);
    expect(harness.appStateListenerCount()).toBe(0);
  });

  it('publishes once when midnight passes, and re-arms for the following one', () => {
    harness = installPlannerDaySource(justBeforeMidnight());
    let notifications = 0;
    const stop = harness.source.subscribe(() => {
      notifications += 1;
    });

    expect(harness.source.getSnapshot().today).toBe(DAY_ONE);

    harness.setNow(justAfterMidnight());
    harness.fireMidnight();

    expect(harness.source.getSnapshot().today).toBe(DAY_TWO);
    expect(notifications).toBe(1);
    expect(harness.isArmed()).toBe(true);

    stop();
  });

  it('publishes nothing when a timer fires early and the day has not moved', () => {
    harness = installPlannerDaySource(justBeforeMidnight());
    let notifications = 0;
    const stop = harness.source.subscribe(() => {
      notifications += 1;
    });

    /* Drift, a coarse platform timer, a suspended thread: the clock has not crossed yet. */
    harness.fireMidnight();

    expect(harness.source.getSnapshot().today).toBe(DAY_ONE);
    expect(notifications).toBe(0);
    /* Still armed, so the real boundary is not missed. */
    expect(harness.isArmed()).toBe(true);

    stop();
  });

  it('picks up a new day when the app foregrounds', () => {
    harness = installPlannerDaySource(justBeforeMidnight());
    let notifications = 0;
    const stop = harness.source.subscribe(() => {
      notifications += 1;
    });

    /* Backgrounded overnight: the timer is not reliable, so the foreground read is what matters. */
    harness.setNow(new Date(2026, 7, 23, 9, 15, 0, 0));
    harness.sendAppState('active');

    expect(harness.source.getSnapshot().today).toBe('2026-08-23');
    expect(notifications).toBe(1);

    stop();
  });

  it('ignores inactive and background transitions', () => {
    harness = installPlannerDaySource(justBeforeMidnight());
    let notifications = 0;
    const stop = harness.source.subscribe(() => {
      notifications += 1;
    });

    harness.setNow(justAfterMidnight());
    harness.sendAppState('inactive');
    harness.sendAppState('background');

    /* The iOS app-switcher pass must not cost a read the user never completed. */
    expect(harness.source.getSnapshot().today).toBe(DAY_ONE);
    expect(notifications).toBe(0);

    stop();
  });

  it('re-reads on an explicit refresh, which is what an account change triggers', () => {
    harness = installPlannerDaySource(justBeforeMidnight());
    let notifications = 0;
    const stop = harness.source.subscribe(() => {
      notifications += 1;
    });

    harness.setNow(justAfterMidnight());
    expect(harness.source.refresh().today).toBe(DAY_TWO);
    expect(notifications).toBe(1);

    /* A refresh that observes no change publishes nothing. */
    expect(harness.source.refresh().today).toBe(DAY_TWO);
    expect(notifications).toBe(1);

    stop();
  });

  it('survives a subscribe / unsubscribe / subscribe cycle without leaking a timer', () => {
    harness = installPlannerDaySource(justBeforeMidnight());

    /* Strict Mode's double-invoked effect, in miniature. */
    const first = harness.source.subscribe(() => undefined);
    first();
    expect(harness.isArmed()).toBe(false);

    const second = harness.source.subscribe(() => undefined);
    expect(harness.isArmed()).toBe(true);
    expect(harness.appStateListenerCount()).toBe(1);

    second();
    expect(harness.appStateListenerCount()).toBe(0);
  });

  it('re-reads on the first subscribe, so an idle store cannot hand back a stale day', () => {
    harness = installPlannerDaySource(justBeforeMidnight());
    /* No consumers for a while, and the clock moved on. */
    harness.setNow(justAfterMidnight());

    const stop = harness.source.subscribe(() => undefined);
    expect(harness.source.getSnapshot().today).toBe(DAY_TWO);
    stop();
  });

  it('notices a timezone change at the next boundary, without polling for one', () => {
    /*
      React Native emits no timezone event. What this pins is that the offset is part of the reading,
      so a zone change is *observable* at the next foreground — the source does not need a poll to see
      it, and does not have one.
    */
    let offset = -240;
    let notifications = 0;
    let appStateHandler: ((status: 'active') => void) | null = null;
    const source = createPlannerDaySource({
      now: () => {
        const instant = new Date(justBeforeMidnight().getTime());
        Object.defineProperty(instant, 'getTimezoneOffset', { value: () => offset });
        return instant;
      },
      appState: {
        addEventListener: (_type, handler) => {
          appStateHandler = handler as (status: 'active') => void;
          return { remove: () => undefined } as never;
        },
      },
    });
    const stop = source.subscribe(() => {
      notifications += 1;
    });

    expect(source.getSnapshot().zoneOffsetMinutes).toBe(-240);

    offset = -120;
    (appStateHandler as ((status: 'active') => void) | null)?.('active');

    expect(source.getSnapshot().zoneOffsetMinutes).toBe(-120);
    expect(notifications).toBe(1);

    stop();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Every surface, one day
// ─────────────────────────────────────────────────────────────────────────────

describe('every Planner surface and Main Home agree on the day', () => {
  it('agrees on mount, and moves together when midnight passes', async () => {
    harness = installPlannerDaySource(justBeforeMidnight());
    const { storage } = memoryTaskStorage();
    await renderTree({ tasks: storage });

    await act(async () => {
      await handles.planner?.createTask({ title: 'Call the clinic', dueDate: DAY_ONE });
      await handles.planner?.createTask({ title: 'Collect the parcel', dueDate: DAY_TWO });
    });

    /* Before midnight: one task due today, and five surfaces naming the same day. */
    expect(surfaceDays()).toEqual({
      tasks: DAY_ONE,
      calendar: DAY_ONE,
      routines: DAY_ONE,
      mainHome: DAY_ONE,
    });
    expect(dueTodayCount()).toBe('1');
    expect(screen.getByTestId('mainhome-count').props.children).toBe('1');

    harness.setNow(justAfterMidnight());
    await act(async () => {
      harness!.fireMidnight();
    });

    /*
      After midnight, without a remount, a reload or a navigation. Under the previous code the home
      would have rolled over on its next render while the other four stayed on day one — the visible
      form of this defect.
    */
    expect(surfaceDays()).toEqual({
      tasks: DAY_TWO,
      calendar: DAY_TWO,
      routines: DAY_TWO,
      mainHome: DAY_TWO,
    });
    expect(dueTodayCount()).toBe('1');
    expect(screen.getByTestId('mainhome-count').props.children).toBe('1');
  });

  it('agrees on the due-today count with Main Home, on both sides of the boundary', async () => {
    harness = installPlannerDaySource(justBeforeMidnight());
    const { storage } = memoryTaskStorage();
    await renderTree({ tasks: storage });

    await act(async () => {
      await handles.planner?.createTask({ title: 'Pay the bill', dueDate: DAY_ONE });
      await handles.planner?.createTask({ title: 'Book the seat', dueDate: DAY_ONE });
    });

    expect(dueTodayCount()).toBe('2');
    expect(screen.getByTestId('mainhome-count').props.children).toBe('2');

    harness.setNow(justAfterMidnight());
    await act(async () => {
      harness!.fireMidnight();
    });

    /*
      Both drop to zero *together*. The overdue policy is unchanged — yesterday's open tasks are
      deliberately not pulled into today — so this is the correct new reading, not a regression.
    */
    expect(dueTodayCount()).toBe('0');
    expect(screen.getByTestId('mainhome-count').props.children).toBe('0');
  });

  it('resolves routine occurrences against the same day the home counts', async () => {
    harness = installPlannerDaySource(justBeforeMidnight());
    const { storage } = memoryTaskStorage();
    await renderTree({ tasks: storage });

    await act(async () => {
      await handles.routines?.createRoutine({
        title: 'Morning walk',
        note: '',
        schedule: { kind: 'daily' },
        preferredTime: null,
        priority: 'normal',
      });
    });

    const scheduledBefore = screen.getByTestId('routine-scheduled').props.children as string;
    expect(scheduledBefore).toBe('1');
    expect(screen.getByTestId('routines-today').props.children).toBe(DAY_ONE);

    harness.setNow(justAfterMidnight());
    await act(async () => {
      harness!.fireMidnight();
    });

    /* A daily routine is due on the new day too, and it is the *new* day it resolves against. */
    expect(screen.getByTestId('routine-scheduled').props.children).toBe('1');
    expect(screen.getByTestId('routines-today').props.children).toBe(DAY_TWO);
  });

  it('agrees after a foreground on the next day', async () => {
    harness = installPlannerDaySource(justBeforeMidnight());
    const { storage } = memoryTaskStorage();
    await renderTree({ tasks: storage });

    expect(surfaceDays().mainHome).toBe(DAY_ONE);

    harness.setNow(new Date(2026, 7, 23, 7, 0, 0, 0));
    await act(async () => {
      harness!.sendAppState('active');
    });

    expect(surfaceDays()).toEqual({
      tasks: '2026-08-23',
      calendar: '2026-08-23',
      routines: '2026-08-23',
      mainHome: '2026-08-23',
    });
  });

  it('gives a new account the current day, not the previous session’s', async () => {
    harness = installPlannerDaySource(justBeforeMidnight());
    const { storage } = memoryTaskStorage();
    const view = await renderTree({ tasks: storage, ownerId: OWNER });

    expect(surfaceDays().mainHome).toBe(DAY_ONE);

    /*
      The session sat idle across midnight and then switched account. `PlannerProvider` refreshes the
      day when the repository identity changes, so the new account's first render cannot inherit the
      previous session's day. Re-rendering with a different owner is what changes that identity.
    */
    harness.setNow(justAfterMidnight());
    await act(async () => {
      view.rerender(
        <TodayAgendaProvider
          repository={createPlannerTaskRepository({
            ownerId: OTHER,
            storage,
            id: taskId,
            now: () => harness?.now() ?? justBeforeMidnight(),
          })}
        >
          <PlannerRoutineProvider
            repository={createPlannerRoutineRepository({
              ownerId: OTHER,
              storage: routineStorage(),
              id: routineId,
              now: () => harness?.now() ?? justBeforeMidnight(),
            })}
          >
            <ModuleProvider moduleId="planner">
              <TaskDriver />
              <RoutineDriver />
              <PlannerHomeContent />
              <SurfaceProbe name="tasks" />
              <SurfaceProbe name="calendar" />
              <SurfaceProbe name="routines" />
              <RoutineOccurrenceProbe />
              <MainHomeProbe />
            </ModuleProvider>
          </PlannerRoutineProvider>
        </TodayAgendaProvider>,
      );
    });

    expect(surfaceDays()).toEqual({
      tasks: DAY_TWO,
      calendar: DAY_TWO,
      routines: DAY_TWO,
      mainHome: DAY_TWO,
    });
  });

  it('keeps its subscription across re-renders of a lone consumer', async () => {
    /*
      A single consumer is the sharp case. `useSyncExternalStore` re-subscribes whenever its
      subscribe function changes identity; with only one listener that teardown takes the store to
      zero, which disarms the midnight timer and arms a fresh one — on every render. Several
      consumers hide it, because the others keep the count above zero. So this renders exactly one.
    */
    harness = installPlannerDaySource(justBeforeMidnight());

    function LoneConsumer({ tick }: { readonly tick: number }) {
      const { today } = usePlannerDay();
      return <Text testID="lone-today">{`${today}#${tick}`}</Text>;
    }

    const view = await render(<LoneConsumer tick={0} />);
    const armsAfterMount = harness.armCount();

    for (let tick = 1; tick <= 5; tick += 1) {
      await view.rerender(<LoneConsumer tick={tick} />);
    }

    expect(screen.getByTestId('lone-today').props.children).toBe(`${DAY_ONE}#5`);
    expect(harness.armCount()).toBe(armsAfterMount);
  });

  it('does not re-arm the midnight timer when a surface re-renders', async () => {
    harness = installPlannerDaySource(justBeforeMidnight());
    const { storage } = memoryTaskStorage();
    await renderTree({ tasks: storage });

    const armsAfterMount = harness.armCount();

    /*
      Renders driven by ordinary work, not by the day. `useSyncExternalStore` re-subscribes whenever
      its subscribe function changes identity, and the store arms on the first listener and disarms on
      the last — so an inline closure in the hook would clear and re-arm the timer on every pass here.
    */
    await act(async () => {
      await handles.planner?.createTask({ title: 'One', dueDate: DAY_ONE });
      await handles.planner?.createTask({ title: 'Two', dueDate: DAY_ONE });
      await handles.planner?.createTask({ title: 'Three', dueDate: DAY_TWO });
    });

    expect(dueTodayCount()).toBe('2');
    expect(harness.armCount()).toBe(armsAfterMount);
    expect(harness.isArmed()).toBe(true);
  });

  it('agrees under Strict Mode, whose effects mount twice', async () => {
    harness = installPlannerDaySource(justBeforeMidnight());
    const { storage } = memoryTaskStorage();
    await renderTree({ tasks: storage, strict: true });

    expect(surfaceDays()).toEqual({
      tasks: DAY_ONE,
      calendar: DAY_ONE,
      routines: DAY_ONE,
      mainHome: DAY_ONE,
    });

    /* One timer survives the double subscribe, and it is a live one. */
    expect(harness.isArmed()).toBe(true);

    harness.setNow(justAfterMidnight());
    await act(async () => {
      harness!.fireMidnight();
    });

    expect(surfaceDays()).toEqual({
      tasks: DAY_TWO,
      calendar: DAY_TWO,
      routines: DAY_TWO,
      mainHome: DAY_TWO,
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The rule, pinned against the source tree
// ─────────────────────────────────────────────────────────────────────────────

describe('no Planner or Main Home surface derives its own day', () => {
  /*
    Reverting any surface to a per-call or per-mount `new Date()` has to fail here rather than at a
    user's midnight. `planner-day-source.ts` is the one file allowed to read the clock — that is what
    being the source means — and `planner-task.ts` only formats a `Date` it is handed.
  */
  const SURFACES = [
    'src/features/planner/screens/planner-home-content.tsx',
    'src/features/planner/screens/planner-tasks-screen.tsx',
    'src/features/planner/screens/planner-calendar-screen.tsx',
    'src/features/planner/screens/planner-routines-screen.tsx',
    'src/features/planner/screens/planner-task-list.tsx',
    'src/features/planner/components/planner-month-grid.tsx',
    'src/features/planner/components/planner-routine-list.tsx',
    'src/application/providers/today-agenda-provider.tsx',
  ] as const;

  it.each(SURFACES)('%s reads no clock of its own', (relative) => {
    const contents = fs.readFileSync(path.join(process.cwd(), relative), 'utf8');
    expect(contents).not.toMatch(/new Date\(\)/);
    expect(contents).not.toMatch(/Date\.now\(\)/);
  });

  it('leaves exactly one clock read in the Planner day machinery', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'src/features/planner/di/planner-day-source.ts'),
      'utf8',
    );
    /* The injectable default, and nothing else. */
    expect(source.match(/new Date\(\)/g)).toHaveLength(1);
    expect(source).toContain('deps.now ?? (() => new Date())');
  });
});
