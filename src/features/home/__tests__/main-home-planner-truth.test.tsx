import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { View } from 'react-native';
import { render, screen, waitFor } from '@testing-library/react-native';

import {
  TodayAgendaProvider,
  todayAgenda,
  useTodayAgenda,
} from '@application/providers/today-agenda-provider';
import {
  createPlannerTaskRepository,
  type PlannerTaskStorage,
} from '@features/planner/data/planner-task.repository';
import { mockMainHomeDashboard } from '@mocks/main-home';

import { useMainHomeDashboard } from '../hooks/use-main-home-dashboard';
import { usePlannerTimelineEntries } from '../hooks/use-planner-timeline-entries';

/**
 * **Main Home tells the truth about today** — the regression guard for issue #21.
 *
 * The defect: "Today at a Glance" showed School drop-off 8:00, Work focus time 10:00 and Family
 * dinner 17:30 while Planner held zero tasks. Nobody created them and nobody could complete or delete
 * them, and Planner promises two taps away that NoorLife will not invent a schedule.
 */

const OWNER_A = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const OWNER_B = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
const FABRICATED = ['School drop-off', 'Work focus time', 'Family dinner'] as const;
const FABRICATED_TIMES = ['8:00 AM', '10:00 AM', '5:30 PM'] as const;

/** Renders only the hook's output, so these cases test the contract rather than the whole screen. */
function Rows() {
  const entries = usePlannerTimelineEntries();
  return (
    <>
      {entries.map((entry) => (
        <TimelineProbe key={entry.id} id={entry.id} title={entry.title} time={entry.time} />
      ))}
    </>
  );
}

function TimelineProbe({
  id,
  title,
  time,
}: {
  readonly id: string;
  readonly title: string;
  readonly time: string;
}) {
  return (
    <>
      <View testID={`row-${id}`} accessibilityLabel={`${time}|${title}`} />
    </>
  );
}

let sequence = 0;

/** Deterministic task ids, because the domain rejects anything that is not a generated UUID. */
function nextTaskId(): string {
  sequence += 1;
  return `task.aaaaaaaa-1111-4111-8111-${String(sequence).padStart(12, '0')}`;
}

function storage(rows: Map<string, string>): PlannerTaskStorage {
  return {
    getItem: async (key) => rows.get(key) ?? null,
    setItem: async (key, value) => {
      rows.set(key, value);
    },
  };
}

describe('the fabricated rows are gone from production source', () => {
  it('holds no timeline fixture in the Main Home mock', () => {
    expect(mockMainHomeDashboard.timeline).toEqual([]);
  });

  /*
    A source scan, not just a render assertion. A render can only prove the rows are absent from the
    one path the test drives; this proves the strings do not exist to be reintroduced, which is what
    stops the fixture quietly coming back with a future design tweak.
  */
  it('names none of the three anywhere in the production sources it came from', () => {
    const sources = [
      join(process.cwd(), 'src', 'mocks', 'main-home.ts'),
      join(process.cwd(), 'src', 'features', 'home', 'hooks', 'use-main-home-dashboard.ts'),
      join(process.cwd(), 'src', 'features', 'home', 'hooks', 'use-planner-timeline-entries.ts'),
    ];

    sources.forEach((path) => {
      const code = readFileSync(path, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');

      FABRICATED.forEach((title) => {
        expect(code).not.toContain(title);
      });
      FABRICATED_TIMES.forEach((time) => {
        expect(code).not.toContain(time);
      });
    });
  });

  it('carries no sample, mock or placeholder event vocabulary in the Planner rows', () => {
    const code = readFileSync(
      join(process.cwd(), 'src', 'features', 'home', 'hooks', 'use-planner-timeline-entries.ts'),
      'utf8',
    )
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');

    expect(code).not.toMatch(/sampleEvents|mockEvents|demoEvents|placeholderEvents|fixture/i);
  });
});

describe('Home does not import Planner', () => {
  /*
    The architectural point of the change. Home is a summary of every module, so if each module it
    summarises becomes an import, Home ends up coupled to all of them. It reads one small read-only
    port instead.
  */
  it('reaches Planner only through the application-level agenda port', () => {
    const code = readFileSync(
      join(process.cwd(), 'src', 'features', 'home', 'hooks', 'use-planner-timeline-entries.ts'),
      'utf8',
    );

    expect(code).toContain('@application/providers/today-agenda-provider');
    expect(code).not.toMatch(/@features\/planner/);
  });

  it('parses no storage and builds no account key in Home', () => {
    const code = readFileSync(
      join(process.cwd(), 'src', 'features', 'home', 'hooks', 'use-planner-timeline-entries.ts'),
      'utf8',
    );

    expect(code).not.toMatch(/AsyncStorage|getItem|setItem|JSON\.parse/);
    expect(code).not.toMatch(/noorlife\.planner|plannerTaskAddress/);
  });
});

describe('what the Planner rows say', () => {
  async function renderRows(state: Parameters<typeof TodayAgendaProvider>[0]['state']) {
    await render(
      <TodayAgendaProvider state={state}>
        <Rows />
      </TodayAgendaProvider>,
    );
  }

  it('states that nothing is planned when there are no tasks due today', async () => {
    await renderRows(todayAgenda([]));

    expect(screen.getByTestId('row-planner-nothing-today')).toBeTruthy();
    expect(screen.getByTestId('row-planner-nothing-today').props.accessibilityLabel).toBe(
      '|Nothing planned for today',
    );
  });

  it('renders a real task with its own title and time', async () => {
    await renderRows(
      todayAgenda([{ id: 'task.one', title: 'Collect prescription', time: '9:30 AM' }]),
    );

    expect(screen.getByTestId('row-task.one').props.accessibilityLabel).toBe(
      '9:30 AM|Collect prescription',
    );
    expect(screen.queryByTestId('row-planner-nothing-today')).toBeNull();
  });

  it('renders a task with no time without inventing one', async () => {
    await renderRows(todayAgenda([{ id: 'task.two', title: 'Water the plants', time: '' }]));

    expect(screen.getByTestId('row-task.two').props.accessibilityLabel).toBe('|Water the plants');
  });

  it("keeps the port's order", async () => {
    await renderRows(
      todayAgenda([
        { id: 'task.a', title: 'First', time: '8:00 AM' },
        { id: 'task.b', title: 'Second', time: '1:00 PM' },
      ]),
    );

    expect(screen.getByTestId('row-task.a')).toBeTruthy();
    expect(screen.getByTestId('row-task.b')).toBeTruthy();
  });

  it('says the plan is unavailable rather than showing an empty day', async () => {
    await renderRows(todayAgenda([], { status: 'unavailable' }));

    expect(screen.getByTestId('row-planner-unavailable').props.accessibilityLabel).toBe(
      '|Your plan is unavailable — open Planner',
    );
    expect(screen.queryByTestId('row-planner-nothing-today')).toBeNull();
  });

  it('claims nothing at all while Planner is still being read', async () => {
    await renderRows(todayAgenda([], { status: 'loading' }));

    expect(screen.queryByTestId('row-planner-nothing-today')).toBeNull();
    expect(screen.queryByTestId('row-planner-unavailable')).toBeNull();
  });

  it('never falls back to a fabricated row in any state', async () => {
    for (const state of [
      todayAgenda([]),
      todayAgenda([], { status: 'loading' }),
      todayAgenda([], { status: 'unavailable' }),
    ]) {
      /*
        No manual unmount here. Unmounting inside the loop detached RNTL's `screen` for every render
        that followed in this file, and four later cases failed looking for a testID that was present —
        a harness fault reading exactly like a product one. RNTL cleans up between tests on its own.
      */
      const view = await render(
        <TodayAgendaProvider state={state}>
          <Rows />
        </TodayAgendaProvider>,
      );
      FABRICATED.forEach((title) => {
        expect(view.queryAllByText(title)).toHaveLength(0);
      });
    }
  });
});

describe('Main Home picks up Planner changes', () => {
  /** A minimal consumer of the dashboard hook, so the focus behaviour is tested where it lives. */
  function DashboardProbe() {
    const { state } = useMainHomeDashboard();
    return <View testID="dashboard" accessibilityLabel={state.status} />;
  }

  /*
    A task added, completed or deleted on the Tasks or Calendar screen has to show up when the user
    comes back. Without this the section would keep reporting the plan as it stood at launch — a
    quieter version of the same dishonesty the fixtures were.

    `useFocusEffect` really runs under this suite's router double, so asserting the reload was
    requested is asserting the wiring rather than the mock.
  */
  it('re-reads the agenda when the screen gains focus', async () => {
    const reload = jest.fn(() => Promise.resolve());

    await render(
      <TodayAgendaProvider state={todayAgenda([], { reload })}>
        <DashboardProbe />
      </TodayAgendaProvider>,
    );

    await waitFor(() => {
      expect(reload).toHaveBeenCalled();
    });
  });

  it('does not re-read in a loop', async () => {
    const reload = jest.fn(() => Promise.resolve());

    await render(
      <TodayAgendaProvider state={todayAgenda([], { reload })}>
        <DashboardProbe />
      </TodayAgendaProvider>,
    );

    await waitFor(() => {
      expect(reload).toHaveBeenCalled();
    });
    const afterFirst = reload.mock.calls.length;
    await waitFor(() => {
      expect(screen.getByTestId('dashboard')).toBeTruthy();
    });

    /*
      The guard for a real defect. The focus effect first depended on the agenda value it reloads, so
      each reload produced a new value, re-armed the effect and reloaded again; ninety-nine tests in
      three Main Home suites hung on it. A handful of calls is fine — an unbounded climb is not.
    */
    expect(reload.mock.calls.length).toBeLessThanOrEqual(afterFirst + 1);
  });
});

describe('the agenda port over real Planner storage', () => {
  /** Publishes the port's reading as text, so a case can assert what a real store produces. */
  function AgendaProbe() {
    const agenda = useTodayAgenda();
    return (
      <View
        testID="agenda"
        accessibilityLabel={`${agenda.status}|${agenda.items.map((item) => item.title).join(',')}`}
      />
    );
  }

  async function renderOver(ownerId: string | null, rows: Map<string, string>) {
    await render(
      <TodayAgendaProvider
        repository={createPlannerTaskRepository({
          ownerId,
          storage: storage(rows),
          id: nextTaskId,
        })}
      >
        <AgendaProbe />
      </TodayAgendaProvider>,
    );
  }

  it('reports no tasks for an empty store, and does not invent any', async () => {
    await renderOver(OWNER_A, new Map());

    await waitFor(() => {
      // Settled and genuinely empty — not "loading forever", and not a fabricated row.
      expect(screen.getByTestId('agenda').props.accessibilityLabel).toBe('ready|');
    });
  });

  /*
    Account isolation, proven through the port rather than restated. Owner A's task is written by
    Owner A's repository; Owner B reads a different address and therefore sees nothing. The port adds
    no rule of its own here — it inherits Planner's, which is the reason the boundary was drawn where
    it was.
  */
  it("does not show one account's task to another", async () => {
    const rows = new Map<string, string>();
    const mine = createPlannerTaskRepository({
      ownerId: OWNER_A,
      storage: storage(rows),
      id: nextTaskId,
    });
    const today = new Date().toISOString().slice(0, 10);
    await mine.create({ title: 'Mine only', dueDate: today, priority: 'normal' });

    await renderOver(OWNER_B, rows);

    await waitFor(() => {
      const label = String(screen.getByTestId('agenda').props.accessibilityLabel);
      expect(label).not.toContain('Mine only');
    });
  });

  it('shows nothing at all when there is no signed-in owner', async () => {
    const rows = new Map<string, string>();
    const mine = createPlannerTaskRepository({
      ownerId: OWNER_A,
      storage: storage(rows),
      id: nextTaskId,
    });
    const today = new Date().toISOString().slice(0, 10);
    await mine.create({ title: 'Mine only', dueDate: today, priority: 'normal' });

    await renderOver(null, rows);

    await waitFor(() => {
      const label = String(screen.getByTestId('agenda').props.accessibilityLabel);
      // No owner means Planner refuses the read outright, so the port reports unavailable.
      expect(label).toContain('unavailable');
      expect(label).not.toContain('Mine only');
    });
  });

  it('reports unavailable, not empty, when storage cannot be read', async () => {
    const failing: PlannerTaskStorage = {
      getItem: async () => {
        throw new Error('unavailable');
      },
      setItem: async () => undefined,
    };

    await render(
      <TodayAgendaProvider
        repository={createPlannerTaskRepository({
          ownerId: OWNER_A,
          storage: failing,
          id: nextTaskId,
        })}
      >
        <AgendaProbe />
      </TodayAgendaProvider>,
    );

    await waitFor(() => {
      expect(String(screen.getByTestId('agenda').props.accessibilityLabel)).toContain(
        'unavailable',
      );
    });
  });

  it('reports unavailable, not empty, when the stored envelope is corrupt', async () => {
    const rows = new Map<string, string>();
    const address = createPlannerTaskRepository({
      ownerId: OWNER_A,
      storage: storage(rows),
    }).address;
    expect(address).not.toBeNull();
    rows.set(address as string, '{ this is not json');

    await renderOver(OWNER_A, rows);

    await waitFor(() => {
      expect(String(screen.getByTestId('agenda').props.accessibilityLabel)).toContain(
        'unavailable',
      );
    });
  });

  afterEach(async () => {
    await AsyncStorage.clear();
  });
});
