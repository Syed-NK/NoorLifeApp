import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { localDateKey } from '../data/planner-task';
import { routineWeekdayName } from '../data/planner-routine';
import {
  createPlannerRoutineRepository,
  type PlannerRoutineRepository,
  type PlannerRoutineStorage,
} from '../data/planner-routine.repository';
import { PlannerRoutineProvider } from '../di/planner-routine-provider';
import { PlannerRoutinesScreen } from '../screens/planner-routines-screen';

/**
 * The Routines screen, rendered the way its route renders it.
 *
 * Today comes from the real clock because the screen's does too; a routine set to "every day" is due
 * whatever day the suite runs on, which is what keeps these cases date-independent.
 */

const OWNER = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const OTHER_OWNER = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
const TODAY = localDateKey(new Date());
/** Monday `0` … Sunday `6`. Today's index, so a "not today" day can be chosen deterministically. */
const TODAY_INDEX = Number(
  (() => {
    const sundayFirst = new Date(`${TODAY}T00:00:00.000Z`).getUTCDay();
    return (sundayFirst + 6) % 7;
  })(),
);
const NOT_TODAY_INDEX = (TODAY_INDEX + 3) % 7;

function storage(rows: Map<string, string>): PlannerRoutineStorage {
  return {
    getItem: async (key) => rows.get(key) ?? null,
    setItem: async (key, value) => {
      rows.set(key, value);
    },
  };
}

function repository(
  rows: Map<string, string>,
  ownerId: string | null = OWNER,
): PlannerRoutineRepository {
  let sequence = 0;
  return createPlannerRoutineRepository({
    ownerId,
    storage: storage(rows),
    id: () => `routine.aaaaaaaa-1111-4111-8111-${String(++sequence).padStart(12, '0')}`,
    now: () => new Date('2026-08-17T08:00:00.000Z'),
  });
}

async function renderRoutines(repo: PlannerRoutineRepository) {
  /*
    Exactly the tree `src/app/planner/routines.tsx` renders — a `PlannerRoutineProvider` and the
    screen. No `ModuleProvider`: the screen owns its scaffold, and supplying the module context here
    is the mistake that let a release-crashing Tasks screen pass its tests.
  */
  await render(
    <PlannerRoutineProvider repository={repo}>
      <PlannerRoutinesScreen />
    </PlannerRoutineProvider>,
  );
  await waitFor(() => {
    expect(screen.queryByTestId('planner-routine-all')).toBeTruthy();
  });
}

async function press(testID: string): Promise<void> {
  await act(async () => {
    fireEvent.press(screen.getByTestId(testID));
    await Promise.resolve();
  });
}

async function type(testID: string, value: string): Promise<void> {
  await act(async () => {
    fireEvent.changeText(screen.getByTestId(testID), value);
    await Promise.resolve();
  });
}

describe('the Routines screen', () => {
  it('mounts from its route with no module context but its own scaffold', async () => {
    /*
      The crash regression carried to this route: `renderRoutines` supplies no `ModuleProvider`, so
      mounting at all proves the screen reads module context below the scaffold that creates it.
    */
    await renderRoutines(repository(new Map()));

    expect(screen.getByTestId('planner-routines')).toBeTruthy();
    expect(screen.getByTestId('planner-routine-composer')).toBeTruthy();
  });

  it('says there are no routines yet, and that it will not add any', async () => {
    await renderRoutines(repository(new Map()));

    expect(screen.getByText('No routines yet')).toBeTruthy();
    expect(
      screen.getByText('Only routines you create appear here. NoorLife will not add any for you.'),
    ).toBeTruthy();
    expect(screen.getByText('Nothing scheduled today')).toBeTruthy();
  });

  it('creates a daily routine and shows it under both sections', async () => {
    await renderRoutines(repository(new Map()));

    await type('planner-routine-title', 'Evening walk');
    await press('planner-routine-save');

    await waitFor(() => {
      expect(screen.getByTestId('planner-routine-message').props.children).toBe('Routine saved');
    });
    expect(screen.getAllByText('Evening walk').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('Every day').length).toBeGreaterThanOrEqual(1);
    // The composer clears, so the next save is not an accidental duplicate.
    expect(screen.getByTestId('planner-routine-title').props.value).toBe('');
  });

  it('refuses to save without a name, and says why', async () => {
    await renderRoutines(repository(new Map()));

    await press('planner-routine-save');

    await waitFor(() => {
      expect(screen.getByTestId('planner-routine-message').props.children).toBe(
        'Give the routine a name.',
      );
    });
    expect(screen.getByText('No routines yet')).toBeTruthy();
  });

  it('refuses a chosen-days schedule with no day selected', async () => {
    await renderRoutines(repository(new Map()));

    await type('planner-routine-title', 'Gym');
    await press('planner-routine-repeat-weekdays');
    await press('planner-routine-save');

    await waitFor(() => {
      expect(screen.getByTestId('planner-routine-message').props.children).toBe(
        'Choose at least one day.',
      );
    });
  });

  it('offers seven weekday controls, each named in full', async () => {
    await renderRoutines(repository(new Map()));
    await press('planner-routine-repeat-weekdays');

    for (let day = 0; day < 7; day += 1) {
      const control = screen.getByTestId(`planner-routine-weekday-${day}`);
      expect(control.props.accessibilityLabel).toBe(routineWeekdayName(day as 0));
      expect(control.props.accessibilityState).toEqual(expect.objectContaining({ checked: false }));
    }
  });

  it('marks a weekday control checked once chosen', async () => {
    await renderRoutines(repository(new Map()));
    await press('planner-routine-repeat-weekdays');
    await press('planner-routine-weekday-2');

    expect(screen.getByTestId('planner-routine-weekday-2').props.accessibilityState).toEqual(
      expect.objectContaining({ checked: true }),
    );
  });

  it('shows under Today only the routines scheduled for today', async () => {
    const rows = new Map<string, string>();
    const repo = repository(rows);
    await repo.create({
      title: 'Due today',
      schedule: { kind: 'weekdays', days: [TODAY_INDEX as 0] },
    });
    await repo.create({
      title: 'Another day',
      schedule: { kind: 'weekdays', days: [NOT_TODAY_INDEX as 0] },
    });

    await renderRoutines(repository(rows));

    // Both are in All routines; only one is in Today.
    expect(screen.getByTestId('planner-routine-today')).toBeTruthy();
    expect(screen.getAllByText('Due today').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('Another day')).toHaveLength(1);
  });

  it('completes today and reopens it', async () => {
    const rows = new Map<string, string>();
    const repo = repository(rows);
    const created = await repo.create({ title: 'Stretch', schedule: { kind: 'daily' } });
    const id = created.kind === 'saved' ? created.routine.id : '';

    await renderRoutines(repository(rows));

    const toggle = `planner-routine-today-list-toggle-${id}`;
    expect(screen.getByTestId(toggle).props.accessibilityState).toEqual(
      expect.objectContaining({ checked: false }),
    );

    await press(toggle);
    await waitFor(() => {
      expect(screen.getByTestId(toggle).props.accessibilityState).toEqual(
        expect.objectContaining({ checked: true }),
      );
    });

    await press(toggle);
    await waitFor(() => {
      expect(screen.getByTestId(toggle).props.accessibilityState).toEqual(
        expect.objectContaining({ checked: false }),
      );
    });
  });

  it('speaks the action, the name and the schedule on the tick control', async () => {
    const rows = new Map<string, string>();
    const repo = repository(rows);
    const created = await repo.create({
      title: 'Stretch',
      schedule: { kind: 'daily' },
      preferredTime: '07:30',
    });
    const id = created.kind === 'saved' ? created.routine.id : '';

    await renderRoutines(repository(rows));

    const label = String(
      screen.getByTestId(`planner-routine-today-list-toggle-${id}`).props.accessibilityLabel,
    );
    expect(label).toContain('Complete Stretch');
    expect(label).toContain('Every day');
    expect(label).toContain('07:30');
  });

  it('loads a routine into the composer for editing and saves the change', async () => {
    const rows = new Map<string, string>();
    const repo = repository(rows);
    const created = await repo.create({ title: 'Old name', schedule: { kind: 'daily' } });
    const id = created.kind === 'saved' ? created.routine.id : '';

    await renderRoutines(repository(rows));
    await press(`planner-routine-all-list-edit-${id}`);

    expect(screen.getByTestId('planner-routine-title').props.value).toBe('Old name');
    // The composer is in edit mode: its action says so, and 'Cancel editing' exists only then.
    expect(screen.getByTestId('planner-routine-save').props.accessibilityLabel).toBe(
      'Save changes',
    );
    expect(screen.getByTestId('planner-routine-cancel')).toBeTruthy();

    await type('planner-routine-title', 'New name');
    await press('planner-routine-save');

    await waitFor(() => {
      expect(screen.getByTestId('planner-routine-message').props.children).toBe('Routine updated');
    });
    expect(screen.queryAllByText('Old name')).toHaveLength(0);
  });

  it('hides a disabled routine from today but keeps it in All routines', async () => {
    const rows = new Map<string, string>();
    const repo = repository(rows);
    const created = await repo.create({ title: 'Stretch', schedule: { kind: 'daily' } });
    const id = created.kind === 'saved' ? created.routine.id : '';

    await renderRoutines(repository(rows));
    expect(screen.queryByTestId(`planner-routine-today-list-toggle-${id}`)).toBeTruthy();

    await press(`planner-routine-all-list-active-${id}`);

    await waitFor(() => {
      expect(screen.queryByTestId(`planner-routine-today-list-toggle-${id}`)).toBeNull();
    });
    // Still managed, and shown as off rather than gone.
    expect(screen.getByTestId(`planner-routine-all-list-${id}`)).toBeTruthy();
    expect(screen.getByText('Nothing scheduled today')).toBeTruthy();
  });

  it('does not delete until the user confirms', async () => {
    const rows = new Map<string, string>();
    const repo = repository(rows);
    const created = await repo.create({ title: 'Stretch', schedule: { kind: 'daily' } });
    const id = created.kind === 'saved' ? created.routine.id : '';

    await renderRoutines(repository(rows));
    await press(`planner-routine-all-list-remove-${id}`);

    // Asked first, and the routine is still there.
    expect(screen.getByTestId('planner-routine-removal-confirmation')).toBeTruthy();
    expect(screen.getByTestId(`planner-routine-all-list-${id}`)).toBeTruthy();

    await press('planner-routine-delete-cancel');
    expect(screen.queryByTestId('planner-routine-removal-confirmation')).toBeNull();
    expect(screen.getByTestId(`planner-routine-all-list-${id}`)).toBeTruthy();

    await press(`planner-routine-all-list-remove-${id}`);
    await press('planner-routine-delete-confirm');

    await waitFor(() => {
      expect(screen.queryByTestId(`planner-routine-all-list-${id}`)).toBeNull();
    });
    expect(screen.getByText('No routines yet')).toBeTruthy();
  });

  it('says the completion record goes with the routine, before deleting it', async () => {
    const rows = new Map<string, string>();
    const repo = repository(rows);
    const created = await repo.create({ title: 'Stretch', schedule: { kind: 'daily' } });
    const id = created.kind === 'saved' ? created.routine.id : '';

    await renderRoutines(repository(rows));
    await press(`planner-routine-all-list-remove-${id}`);

    expect(
      screen.getByText(
        'Stretch and its completion record will be permanently removed. This cannot be undone.',
      ),
    ).toBeTruthy();
  });

  /*
    Persistence is a property of the repository, so it is proven the way the app experiences it: a
    second provider over the same store, which is what a relaunch is.
  */
  it('shows what a previous session saved, including today’s completion', async () => {
    const rows = new Map<string, string>();
    const first = repository(rows);
    const created = await first.create({ title: 'Stretch', schedule: { kind: 'daily' } });
    const id = created.kind === 'saved' ? created.routine.id : '';
    await first.setCompleted(id, TODAY, true);

    await renderRoutines(repository(rows));

    expect(
      screen.getByTestId(`planner-routine-today-list-toggle-${id}`).props.accessibilityState,
    ).toEqual(expect.objectContaining({ checked: true }));
  });

  it('shows nothing from another account', async () => {
    const rows = new Map<string, string>();
    const mine = repository(rows, OWNER);
    await mine.create({ title: 'Mine only', schedule: { kind: 'daily' } });

    await renderRoutines(repository(rows, OTHER_OWNER));

    expect(screen.queryByText('Mine only')).toBeNull();
    expect(screen.getByText('No routines yet')).toBeTruthy();
  });

  it('reports a storage fault instead of an empty list', async () => {
    const failing: PlannerRoutineStorage = {
      getItem: async () => {
        throw new Error('unavailable');
      },
      setItem: async () => undefined,
    };
    const repo = createPlannerRoutineRepository({ ownerId: OWNER, storage: failing });

    await render(
      <PlannerRoutineProvider repository={repo}>
        <PlannerRoutinesScreen />
      </PlannerRoutineProvider>,
    );

    await waitFor(() => {
      expect(screen.queryByTestId('planner-routine-all')).toBeNull();
    });
    // The composer still renders — the screen is usable, it just will not claim the list is empty.
    expect(screen.getByTestId('planner-routine-composer')).toBeTruthy();
  });
});

describe('accessibility and layout contract', () => {
  it('gives every weekday control at least a 44 dp target', async () => {
    await renderRoutines(repository(new Map()));
    await press('planner-routine-repeat-weekdays');

    for (let day = 0; day < 7; day += 1) {
      const style = flatten(screen.getByTestId(`planner-routine-weekday-${day}`).props.style);
      expect(Number(style.minHeight)).toBeGreaterThanOrEqual(44);
      expect(Number(style.minWidth)).toBeGreaterThanOrEqual(44);
    }
  });

  it('gives the tick row at least a 44 dp height', async () => {
    const rows = new Map<string, string>();
    const repo = repository(rows);
    const created = await repo.create({ title: 'Stretch', schedule: { kind: 'daily' } });
    const id = created.kind === 'saved' ? created.routine.id : '';

    await renderRoutines(repository(rows));

    const style = flatten(
      screen.getByTestId(`planner-routine-today-list-toggle-${id}`).props.style,
    );
    expect(Number(style.minHeight)).toBeGreaterThanOrEqual(44);
  });

  it('renders inside the scaffold, which owns the bottom-navigation inset', () => {
    const source = readFileSync(
      join(__dirname, '..', 'screens', 'planner-routines-screen.tsx'),
      'utf8',
    );

    /*
      `ModuleScaffold` reserves the navigation bar's height and the gesture inset beneath it. A screen
      that positioned anything absolutely or set its own bottom padding is how content ends up under
      the bar on a device with a gesture area.
    */
    expect(source).toContain('<ModuleScaffold');
    expect(source).not.toMatch(/position:\s*'absolute'/);
    expect(source).not.toMatch(/paddingBottom/);
  });

  it('lets long names and notes reflow rather than truncating at a character count', () => {
    const source = readFileSync(
      join(__dirname, '..', 'components', 'planner-routine-list.tsx'),
      'utf8',
    );

    expect(source).toMatch(/numberOfLines=\{3\}/);
    expect(source).toMatch(/numberOfLines=\{4\}/);
    expect(source).not.toMatch(/\.slice\(0,\s*\d+\)\s*\+\s*'…'/);
  });
});

describe('nothing is invented', () => {
  const sources = [
    join(__dirname, '..', 'data', 'planner-routine.ts'),
    join(__dirname, '..', 'data', 'planner-routine.repository.ts'),
    join(__dirname, '..', 'components', 'planner-routine-list.tsx'),
    join(__dirname, '..', 'screens', 'planner-routines-screen.tsx'),
    join(__dirname, '..', 'di', 'planner-routine-provider.tsx'),
  ];

  function code(path: string): string {
    return readFileSync(path, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
  }

  /*
    A habit feature is the most tempting place in an app to seed "Drink water" and "Morning walk".
    This is the gate: the sources are read and fail if they name a routine nobody created.
  */
  it('ships no starter, sample or suggested routine', () => {
    sources.forEach((path) => {
      expect(code(path)).not.toMatch(
        /Drink water|Morning walk|Meditate|Read Qur|Brush teeth|Make bed|Journal/i,
      );
      expect(code(path)).not.toMatch(
        /starterRoutines|defaultRoutines|sampleRoutines|suggestedRoutines|seedRoutines/,
      );
    });
  });

  /*
    No aggregate across days in this phase. A streak or a percentage is a claim about somebody's life,
    and the moment it is displayed the app starts rewarding and implicitly judging.
  */
  it('computes no streak, score, percentage or encouragement', () => {
    sources.forEach((path) => {
      expect(code(path)).not.toMatch(/\bstreak/i);
      expect(code(path)).not.toMatch(/\bbadge/i);
      expect(code(path)).not.toMatch(/percent|\bscore\b|\baverage\b/i);
      expect(code(path)).not.toMatch(/well done|keep going|congratulat|you're on track/i);
    });
  });

  it('adds no notification, reminder, calendar or AI dependency', () => {
    sources.forEach((path) => {
      expect(code(path)).not.toMatch(/expo-notifications|scheduleNotification|\breminder/i);
      expect(code(path)).not.toMatch(/expo-calendar|caldav/i);
      expect(code(path)).not.toMatch(/noor-ai|generatePlan|suggest/i);
    });
  });

  it('reaches no network and no backend', () => {
    sources.forEach((path) => {
      expect(code(path)).not.toMatch(/fetch\(|axios|XMLHttpRequest|WebSocket|https?:\/\//);
      expect(code(path)).not.toMatch(/supabase/i);
    });
  });

  it('imports no other feature — Planner, the module framework, shared and design system only', () => {
    sources.forEach((path) => {
      const imports = readFileSync(path, 'utf8').match(/from '(@features\/[^']+)'/g) ?? [];
      imports.forEach((line) => {
        expect(line).toMatch(/@features\/(planner|modules)\//);
      });
    });
  });
});

/** Flattens a React Native style prop, which may be an object or a nested array. */
function flatten(style: unknown): Record<string, unknown> {
  if (Array.isArray(style)) {
    return Object.assign({}, ...style.flat(Infinity).filter(Boolean));
  }
  return (style ?? {}) as Record<string, unknown>;
}
