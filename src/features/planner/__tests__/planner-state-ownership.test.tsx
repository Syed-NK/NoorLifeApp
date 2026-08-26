import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { act, render, screen } from '@testing-library/react-native';
import { useEffect } from 'react';
import { AppState, Text } from 'react-native';

import { TodayAgendaProvider } from '@application/providers/today-agenda-provider';
import { usePlannerTimelineEntries } from '@features/home/hooks/use-planner-timeline-entries';
import { ModuleProvider } from '@features/modules/module-context';
import { pinModuleWindow } from '@/test-support/module-window';

import {
  createPlannerTaskRepository,
  plannerTaskAddress,
  type PlannerTaskStorage,
} from '../data/planner-task.repository';
import {
  createPlannerRoutineRepository,
  type PlannerRoutineRepository,
} from '../data/planner-routine.repository';
import { localDateKey } from '../data/planner-task';
import { usePlanner } from '../di/planner-provider';
import { PlannerRoutineProvider, usePlannerRoutines } from '../di/planner-routine-provider';
import { PlannerHomeContent } from '../screens/planner-home-content';

/**
 * **One owner per Planner store, observed by every surface** — issue #73.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── What was wrong, and what these assert instead ──────────────────────────
 * Every Planner route mounted its own provider. React context resolves to the nearest one, so a
 * route-local provider *shadowed* the app-scoped owner and each screen kept a private copy of the
 * task list. Adding a task updated the screen that added it and nothing else; back navigation
 * revealed a stale count, and Main Home's timeline still said "Nothing planned for today".
 *
 * The tests below mount the consumers **together under one owner**, which is what the production tree
 * now is: `TodayAgendaProvider` owns tasks app-wide and `app/planner/_layout.tsx` owns routines for
 * the Planner stack. Under a Stack navigator the previous screen stays mounted, so "Tasks, then back
 * to the home" is precisely two live consumers of one state — and that is the arrangement asserted.
 *
 * ── Why a probe rather than every real screen ──────────────────────────────
 * The Planner home is rendered for real, because its counts are the thing that went stale. Main
 * Home's row is produced by its real hook, `usePlannerTimelineEntries`, for the same reason. The
 * *mutation* is driven through the provider's own API rather than by typing into the Tasks composer:
 * what is under test is who observes a change, not whether a text field accepts text — the composer
 * has its own suite.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const OWNER = '3f6d2c18-9a4b-4c7e-8f21-5b7d0e9a1c42';
const OTHER = '7b1e4a90-2c3d-4e5f-9a08-1d2c3b4a5e6f';
const TODAY = localDateKey(new Date());

function memoryStorage(): PlannerTaskStorage & {
  readonly raw: Map<string, string>;
  reads: number;
} {
  const raw = new Map<string, string>();
  const store = {
    raw,
    reads: 0,
    async getItem(key: string): Promise<string | null> {
      store.reads += 1;
      await Promise.resolve();
      return raw.get(key) ?? null;
    },
    async setItem(key: string, value: string): Promise<void> {
      await Promise.resolve();
      raw.set(key, value);
    },
  };
  return store;
}

let ids = 0;
function taskRepository(storage: PlannerTaskStorage, ownerId = OWNER) {
  return createPlannerTaskRepository({
    ownerId,
    storage,
    now: () => new Date(),
    id: () => `task.${String(ids++).padStart(8, '0')}-0000-4000-8000-000000000000`,
  });
}

function routineRepository(storage: PlannerTaskStorage, ownerId = OWNER): PlannerRoutineRepository {
  return createPlannerRoutineRepository({
    ownerId,
    storage,
    now: () => new Date(),
    id: () => `routine.${String(ids++).padStart(8, '0')}-0000-4000-8000-000000000000`,
  });
}

/** Main Home's real timeline rows, rendered as one line each. */
function MainHomeProbe() {
  const rows = usePlannerTimelineEntries();
  return (
    <>
      {rows.map((row) => (
        <Text key={row.id} testID={`home-row-${row.id}`}>
          {`${row.time} ${row.title}`.trim()}
        </Text>
      ))}
    </>
  );
}

/** A second task consumer, standing in for the Tasks screen still mounted beneath the stack. */
function TaskConsumerProbe() {
  const planner = usePlanner();
  return (
    <Text testID="consumer-open">
      {String(planner.tasks.filter((t) => t.status === 'open').length)}
    </Text>
  );
}

/**
 * Reaches the providers' mutations without driving a composer.
 *
 * Published from an effect rather than assigned during render: a component that writes to something
 * outside itself while rendering is not a pure render, and the React Compiler rejects it. An effect
 * is where a side effect belongs, and it runs after each committed value — so the handle a test reads
 * is the one the tree is currently using.
 */
const handles: {
  planner: ReturnType<typeof usePlanner> | null;
  routines: ReturnType<typeof usePlannerRoutines> | null;
} = { planner: null, routines: null };

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

async function renderPlannerTree(options: {
  readonly tasks: PlannerTaskStorage;
  readonly ownerId?: string;
  readonly routines?: PlannerRoutineRepository;
}) {
  const routineRepo =
    options.routines ?? routineRepository(options.tasks, options.ownerId ?? OWNER);
  return render(
    <TodayAgendaProvider repository={taskRepository(options.tasks, options.ownerId ?? OWNER)}>
      <PlannerRoutineProvider repository={routineRepo}>
        <ModuleProvider moduleId="planner">
          <TaskDriver />
          <RoutineDriver />
          <PlannerHomeContent />
          <TaskConsumerProbe />
          <MainHomeProbe />
        </ModuleProvider>
      </PlannerRoutineProvider>
    </TodayAgendaProvider>,
  );
}

/**
 * The file owns `AppState` for every test.
 *
 * Two cases below drive the foreground transition directly, and every other case mounts a provider
 * that subscribes to it. Installing one controllable listener registry up front means the
 * subscription a provider receives at mount is the same shape it hands back at unmount, whichever
 * test mounted it — rather than depending on what the environment's own mock happens to return after
 * a previous test has spied on it.
 */
let appStateHandlers: ((state: string) => void)[] = [];
let appStateSpy: jest.SpyInstance | null = null;

function foreground(): void {
  appStateHandlers.forEach((handler) => handler('active'));
}

beforeEach(() => {
  pinModuleWindow();
  handles.planner = null;
  handles.routines = null;
  appStateHandlers = [];
  appStateSpy = jest.spyOn(AppState, 'addEventListener').mockImplementation(((
    _event: unknown,
    handler: (state: string) => void,
  ) => {
    appStateHandlers.push(handler);
    return {
      remove: () => {
        appStateHandlers = appStateHandlers.filter((entry) => entry !== handler);
      },
    };
  }) as unknown as typeof AppState.addEventListener);
});

afterEach(() => {
  appStateSpy?.mockRestore();
  appStateSpy = null;
});

// ─────────────────────────────────────────────────────────────────────────────
// One update, every consumer
// ─────────────────────────────────────────────────────────────────────────────

describe('every surface observes one task state', () => {
  it('shows a new task on the Planner home, a second consumer and Main Home at once', async () => {
    const storage = memoryStorage();
    await renderPlannerTree({ tasks: storage });

    /* Before: the home's own count, the second consumer's count, and Main Home's honest empty row. */
    expect(screen.getByTestId('planner-summary')).toBeTruthy();
    expect(screen.getByTestId('consumer-open').props.children).toBe('0');
    expect(screen.getByTestId('home-row-planner-nothing-today')).toBeTruthy();

    await act(async () => {
      await handles.planner?.createTask({ title: 'Call the clinic', dueDate: TODAY });
    });

    /*
      The load-bearing assertion of this whole issue: one mutation, three surfaces, no remount and no
      reload. Under the previous tree the home and Main Home would still read zero.
    */
    expect(screen.getByTestId('consumer-open').props.children).toBe('1');
    expect(screen.queryByTestId('home-row-planner-nothing-today')).toBeNull();
    /* Two matches, and both are wanted: the Planner home's Today list and Main Home's row. */
    expect(screen.getAllByText('Call the clinic')).toHaveLength(2);
    expect(screen.getByTestId('planner-today-list')).toBeTruthy();
  });

  it('keeps every surface in step through edit, complete and delete', async () => {
    const storage = memoryStorage();
    await renderPlannerTree({ tasks: storage });

    let id = '';
    await act(async () => {
      const created = await handles.planner?.createTask({ title: 'Draft', dueDate: TODAY });
      id = created?.kind === 'saved' ? created.task.id : '';
    });
    expect(screen.getByTestId('consumer-open').props.children).toBe('1');

    await act(async () => {
      await handles.planner?.updateTask(id, { title: 'Renamed', dueDate: TODAY });
    });
    /* Renamed on both surfaces at once — the home's Today list and Main Home's row. */
    expect(screen.getAllByText('Renamed')).toHaveLength(2);

    await act(async () => {
      await handles.planner?.setCompleted(id, true);
    });
    /* Completed leaves the open count and Main Home's today row, which shows open tasks only. */
    expect(screen.getByTestId('consumer-open').props.children).toBe('0');
    expect(screen.getByTestId('home-row-planner-nothing-today')).toBeTruthy();

    await act(async () => {
      await handles.planner?.removeTask(id);
    });
    expect(screen.queryAllByText('Renamed')).toHaveLength(0);
  });

  it('publishes no task list when a write is refused', async () => {
    const storage = memoryStorage();
    await renderPlannerTree({ tasks: storage });

    await act(async () => {
      await handles.planner?.createTask({ title: 'First', dueDate: TODAY });
    });
    expect(screen.getByTestId('consumer-open').props.children).toBe('1');

    storage.setItem = async () => {
      await Promise.resolve();
      throw new Error('refused');
    };

    await act(async () => {
      const refused = await handles.planner?.createTask({ title: 'Second', dueDate: TODAY });
      expect(refused?.kind).toBe('unavailable');
    });

    /* The refused task is not on screen: a fault is published, never an optimistic list. */
    expect(screen.queryByText('Second')).toBeNull();
    /*
      And the task that *was* saved is still held. A refused write publishes a fault and changes
      nothing else — clearing the list would present a storage failure as an emptied plan.

      Asserted through the consumer rather than by looking for the title: the Planner home replaces
      its content with the error state on a fault, which is the correct thing for it to do and means
      the row is legitimately off screen. What must not change is the state behind it.
    */
    expect(screen.getByTestId('consumer-open').props.children).toBe('1');
    expect(handles.planner?.fault).toBe('storage-unavailable');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Routines
// ─────────────────────────────────────────────────────────────────────────────

describe('routine changes reach the Planner home', () => {
  it('propagates create, complete, disable and delete', async () => {
    const storage = memoryStorage();
    await renderPlannerTree({ tasks: storage });

    const scheduled = () => screen.getByTestId('planner-routines-summary');
    expect(scheduled()).toBeTruthy();

    let id = '';
    await act(async () => {
      const created = await handles.routines?.createRoutine({
        title: 'Morning walk',
        schedule: { kind: 'daily' },
      });
      id = created?.kind === 'saved' ? created.routine.id : '';
    });
    /* "Scheduled 1, Done 0" — the home reads the same store the Routines screen ticks. */
    expect(screen.getAllByText('1').length).toBeGreaterThan(0);

    await act(async () => {
      await handles.routines?.setCompleted(id, TODAY, true);
    });
    expect(screen.getAllByText('1').length).toBeGreaterThan(1);

    await act(async () => {
      await handles.routines?.setActive(id, false);
    });
    /* Deactivated hides today's occurrence without touching the completion record. */
    expect(handles.routines?.completions.days[TODAY]).toContain(id);

    await act(async () => {
      await handles.routines?.removeRoutine(id);
    });
    expect(handles.routines?.routines).toEqual([]);
    /* Deletion cleanup still prunes the orphaned completion. */
    expect(handles.routines?.completions.days[TODAY]).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Foreground, accounts and remount
// ─────────────────────────────────────────────────────────────────────────────

describe('the owner reconciles and isolates correctly', () => {
  it('picks up an external storage change when the app returns to the foreground', async () => {
    const storage = memoryStorage();
    await render(
      <TodayAgendaProvider repository={taskRepository(storage)}>
        <TaskDriver />
        <TaskConsumerProbe />
      </TodayAgendaProvider>,
    );
    expect(screen.getByTestId('consumer-open').props.children).toBe('0');

    /* Something outside this process writes the account's key — a restore, or another writer. */
    await act(async () => {
      await taskRepository(storage).create({ title: 'Added elsewhere', dueDate: TODAY });
    });
    /* Not yet visible: nothing has told the owner. */
    expect(screen.getByTestId('consumer-open').props.children).toBe('0');

    await act(async () => {
      foreground();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByTestId('consumer-open').props.children).toBe('1');
  });

  it('does not read on a background or inactive transition', async () => {
    const storage = memoryStorage();
    await render(
      <TodayAgendaProvider repository={taskRepository(storage)}>
        <TaskConsumerProbe />
      </TodayAgendaProvider>,
    );
    const before = storage.reads;
    await act(async () => {
      appStateHandlers.forEach((handler) => {
        handler('background');
        handler('inactive');
      });
      await Promise.resolve();
    });
    expect(storage.reads).toBe(before);
  });

  it('never publishes one account’s tasks into another’s session', async () => {
    const storage = memoryStorage();
    await act(async () => {
      await taskRepository(storage, OWNER).create({ title: 'Mine', dueDate: TODAY });
    });

    const view = await render(
      <TodayAgendaProvider repository={taskRepository(storage, OWNER)}>
        <TaskConsumerProbe />
      </TodayAgendaProvider>,
    );
    expect(screen.getByTestId('consumer-open').props.children).toBe('1');

    /* The account is replaced. The repository identity is the account boundary. */
    await act(async () => {
      await view.rerender(
        <TodayAgendaProvider repository={taskRepository(storage, OTHER)}>
          <TaskConsumerProbe />
        </TodayAgendaProvider>,
      );
    });

    expect(screen.getByTestId('consumer-open').props.children).toBe('0');
  });

  it('clears account-scoped state on sign-out', async () => {
    const storage = memoryStorage();
    await act(async () => {
      await taskRepository(storage, OWNER).create({ title: 'Mine', dueDate: TODAY });
    });

    const view = await render(
      <TodayAgendaProvider repository={taskRepository(storage, OWNER)}>
        <TaskConsumerProbe />
      </TodayAgendaProvider>,
    );
    expect(screen.getByTestId('consumer-open').props.children).toBe('1');

    /* Signing out yields a null owner, so the repository has no address and refuses every read. */
    await act(async () => {
      await view.rerender(
        <TodayAgendaProvider repository={createPlannerTaskRepository({ ownerId: null, storage })}>
          <TaskConsumerProbe />
        </TodayAgendaProvider>,
      );
    });

    expect(screen.getByTestId('consumer-open').props.children).toBe('0');
    /* And the bytes are still there for the account that owns them. */
    expect(storage.raw.size).toBe(1);
  });

  it('refuses a mutation that resolves after its account was replaced', async () => {
    /*
      The guard M8 removes. `rerender` alone does not reach it: the switch has to happen while a write
      is still in flight, so the result arrives holding the previous account's full task list.
    */
    const raw = new Map<string, string>();
    let release: (() => void) | null = null;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const storage: PlannerTaskStorage = {
      async getItem(key: string) {
        return raw.get(key) ?? null;
      },
      async setItem(key: string, value: string) {
        raw.set(key, value);
        await held;
      },
    };

    const view = await render(
      <TodayAgendaProvider repository={taskRepository(storage, OWNER)}>
        <TaskDriver />
        <TaskConsumerProbe />
      </TodayAgendaProvider>,
    );

    let pending: Promise<unknown> | undefined;
    await act(async () => {
      pending = handles.planner?.createTask({ title: 'Held', dueDate: TODAY });
      await Promise.resolve();
    });

    /* The account is replaced while that write is still parked inside `setItem`. */
    await act(async () => {
      await view.rerender(
        <TodayAgendaProvider repository={taskRepository(storage, OTHER)}>
          <TaskDriver />
          <TaskConsumerProbe />
        </TodayAgendaProvider>,
      );
    });
    expect(screen.getByTestId('consumer-open').props.children).toBe('0');

    await act(async () => {
      release?.();
      await pending;
    });

    /* The write landed on the account that started it, and published into nobody's session. */
    expect(screen.getByTestId('consumer-open').props.children).toBe('0');
    expect([...raw.keys()]).toEqual([plannerTaskAddress(OWNER)]);
  });

  it('never publishes one account’s routines into another’s session', async () => {
    const storage = memoryStorage();
    await act(async () => {
      await routineRepository(storage, OWNER).create({
        title: 'Mine only',
        schedule: { kind: 'daily' },
      });
    });

    const view = await render(
      <PlannerRoutineProvider repository={routineRepository(storage, OWNER)}>
        <RoutineDriver />
      </PlannerRoutineProvider>,
    );
    expect(handles.routines?.routines).toHaveLength(1);

    await act(async () => {
      await view.rerender(
        <PlannerRoutineProvider repository={routineRepository(storage, OTHER)}>
          <RoutineDriver />
        </PlannerRoutineProvider>,
      );
    });

    expect(handles.routines?.routines).toEqual([]);
    expect(handles.routines?.completions.days).toEqual({});
  });

  it('creates one owner per mount, and one write per mutation, across a remount', async () => {
    const storage = memoryStorage();
    const repo = taskRepository(storage);
    const view = await render(
      <TodayAgendaProvider repository={repo}>
        <TaskDriver />
        <TaskConsumerProbe />
      </TodayAgendaProvider>,
    );

    await act(async () => {
      await handles.planner?.createTask({ title: 'Once', dueDate: TODAY });
    });
    expect(screen.getByTestId('consumer-open').props.children).toBe('1');

    /* Re-rendering the same tree must not duplicate the task or spawn a second owner. */
    await act(async () => {
      await view.rerender(
        <TodayAgendaProvider repository={repo}>
          <TaskDriver />
          <TaskConsumerProbe />
        </TodayAgendaProvider>,
      );
    });

    expect(screen.getByTestId('consumer-open').props.children).toBe('1');
    const stored = JSON.parse([...storage.raw.values()][0] ?? '{"tasks":[]}') as {
      tasks: readonly unknown[];
    };
    expect(stored.tasks).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The shape of the tree, pinned in the source
// ─────────────────────────────────────────────────────────────────────────────

describe('the ownership boundary is pinned where it is', () => {
  const app = join(__dirname, '..', '..', '..', 'app', 'planner');
  const strip = (source: string): string =>
    source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

  it('mounts no task provider inside the Planner stack', () => {
    /*
      Reintroducing a route-local provider is the whole defect, and it would not fail any behavioural
      test above — those mount the tree themselves. This is what catches it.
    */
    for (const file of readdirSync(app).filter((name) => name.endsWith('.tsx'))) {
      const code = strip(readFileSync(join(app, file), 'utf8'));
      expect(code).not.toContain('PlannerProvider');
    }
  });

  it('mounts exactly one routine provider, in the Planner layout', () => {
    const layout = strip(readFileSync(join(app, '_layout.tsx'), 'utf8'));
    expect(layout).toContain('<PlannerRoutineProvider>');
    /* Inside the entitlement gate: a visitor who may not open Planner has no keys read. */
    /* The JSX, not the imports — those are alphabetical and say nothing about nesting. */
    expect(layout.indexOf('<ModuleEntitlementGate')).toBeLessThan(
      layout.indexOf('<PlannerRoutineProvider>'),
    );

    for (const file of readdirSync(app).filter((name) => name !== '_layout.tsx')) {
      const code = strip(readFileSync(join(app, file), 'utf8'));
      expect(code).not.toContain('PlannerRoutineProvider');
    }
  });

  it('mounts no Planner provider in the module composition', () => {
    const composition = strip(
      readFileSync(join(__dirname, '..', '..', 'modules', 'module-compositions.tsx'), 'utf8'),
    );
    expect(composition).not.toContain('PlannerProvider');
    expect(composition).not.toContain('PlannerRoutineProvider');
  });

  it('keeps write serialization in one shared module, with no local queue', () => {
    /* Reverting either repository to a private queue is the lost-update defect returning. */
    for (const file of ['planner-task.repository.ts', 'planner-routine.repository.ts']) {
      const code = readFileSync(join(__dirname, '..', 'data', file), 'utf8');
      expect(code).toContain("from './planner-write-queue'");
      expect(strip(code)).not.toMatch(/let\s+mutationQueue/);
    }
  });

  it('reads Planner storage only through the two repositories', () => {
    /*
      Every AsyncStorage call for a Planner key must go through a repository, or the owner is not the
      owner. Screens, providers and selectors must hold none.
    */
    const root = join(__dirname, '..');
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== '__tests__') walk(path);
          continue;
        }
        if (!entry.name.endsWith('.ts') && !entry.name.endsWith('.tsx')) continue;
        if (entry.name.endsWith('.repository.ts')) continue;
        if (strip(readFileSync(path, 'utf8')).includes('async-storage')) {
          offenders.push(entry.name);
        }
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });
});
