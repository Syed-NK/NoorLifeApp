import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { isoFor, monthLabel, spokenDate } from '@shared/utils/calendar-grid';

import {
  createPlannerTaskRepository,
  type PlannerTaskRepository,
  type PlannerTaskStorage,
} from '../data/planner-task.repository';
import { localDateKey, offsetLocalDate } from '../data/planner-task';
import { PlannerProvider } from '../di/planner-provider';
import { PlannerCalendarScreen } from '../screens/planner-calendar-screen';

const OWNER = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const OTHER_OWNER = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';

/**
 * The Calendar screen, rendered the way its route renders it.
 *
 * "Today" is taken from the real clock rather than pinned, because the screen does too — pinning it
 * here would test a fixture instead of the behaviour, and the day cells are addressed by ISO date so
 * nothing depends on which day the suite happens to run on.
 */
const now = new Date();
const TODAY = localDateKey(now);
const TOMORROW = offsetLocalDate(now, 1);

function rows(): Map<string, string> {
  return new Map<string, string>();
}

function repository(store: Map<string, string>, ownerId: string = OWNER): PlannerTaskRepository {
  const storage: PlannerTaskStorage = {
    getItem: async (key) => store.get(key) ?? null,
    setItem: async (key, value) => {
      store.set(key, value);
    },
  };
  let sequence = 0;
  return createPlannerTaskRepository({
    ownerId,
    storage,
    id: () => `task.aaaaaaaa-1111-4111-8111-${String(++sequence).padStart(12, '0')}`,
    now: () => new Date('2026-08-21T08:00:00.000Z'),
  });
}

async function renderCalendar(repo: PlannerTaskRepository) {
  /*
    The screen under one task owner. `src/app/planner/calendar.tsx` mounts no provider of its own —
    since issue #73 the owner is `TodayAgendaProvider`, app-wide — so this supplies the equivalent
    boundary with an injected repository. No
    `ModuleProvider`: the screen owns its scaffold, and supplying the module context here is the
    mistake that let a release-crashing Tasks screen pass its tests.
  */
  await render(
    <PlannerProvider repository={repo}>
      <PlannerCalendarScreen />
    </PlannerProvider>,
  );
  await waitFor(() => {
    expect(screen.queryByTestId('planner-calendar-grid')).toBeTruthy();
  });
}

async function press(testID: string): Promise<void> {
  await act(async () => {
    fireEvent.press(screen.getByTestId(testID));
    await Promise.resolve();
  });
}

describe('Planner calendar screen', () => {
  it('mounts from its route with no module context but its own scaffold', async () => {
    /*
      The crash regression, carried forward to this route. `renderCalendar` supplies no
      `ModuleProvider`, so mounting at all proves the screen reads module context below the scaffold
      that creates it.
    */
    await renderCalendar(repository(rows()));

    expect(screen.getByTestId('planner-calendar')).toBeTruthy();
    expect(screen.getByTestId('planner-calendar-month')).toBeTruthy();
    expect(screen.getByTestId('planner-calendar-grid')).toBeTruthy();
  });

  it('opens on the current month with today selected', async () => {
    await renderCalendar(repository(rows()));

    expect(screen.getByTestId('planner-calendar-label').props.children).toBe(
      monthLabel({ year: Number(TODAY.slice(0, 4)), month: Number(TODAY.slice(5, 7)) }),
    );
    expect(
      screen.getByTestId(`planner-calendar-grid-day-${TODAY}`).props.accessibilityState,
    ).toEqual(expect.objectContaining({ selected: true }));
  });

  it('shows an honest empty state for a day with nothing on it', async () => {
    await renderCalendar(repository(rows()));

    expect(screen.getByTestId('planner-calendar-day-empty')).toBeTruthy();
    expect(screen.getByText('Nothing planned for this day')).toBeTruthy();
    expect(
      screen.getByText(
        'Add a task and it appears here. NoorLife will not fill your calendar for you.',
      ),
    ).toBeTruthy();
    expect(screen.getByText('No tasks')).toBeTruthy();
  });

  it('marks only the days the user actually planned, and never any others', async () => {
    const store = rows();
    const repo = repository(store);
    await repo.create({ title: 'Real task', dueDate: TODAY, priority: 'normal' });

    await renderCalendar(repository(store));

    expect(screen.getByTestId(`planner-calendar-grid-dot-${TODAY}`)).toBeTruthy();
    // Every other day in the month carries no dot.
    const [year, month] = [Number(TODAY.slice(0, 4)), Number(TODAY.slice(5, 7))];
    for (let day = 1; day <= 28; day += 1) {
      const iso = isoFor(year, month, day);
      if (iso === TODAY) {
        continue;
      }
      expect(screen.queryByTestId(`planner-calendar-grid-dot-${iso}`)).toBeNull();
    }
  });

  it('lists the selected day’s tasks and drops the empty state', async () => {
    const store = rows();
    const repo = repository(store);
    await repo.create({ title: 'Due today', dueDate: TODAY, dueTime: '09:30', priority: 'high' });
    await repo.create({ title: 'Due tomorrow', dueDate: TOMORROW, priority: 'normal' });

    await renderCalendar(repository(store));

    expect(screen.getByText('Due today')).toBeTruthy();
    expect(screen.queryByText('Due tomorrow')).toBeNull();
    expect(screen.queryByTestId('planner-calendar-day-empty')).toBeNull();
    expect(screen.getByText('1 open')).toBeTruthy();
  });

  it('switches the day list when another date is selected', async () => {
    const store = rows();
    const repo = repository(store);
    await repo.create({ title: 'Today job', dueDate: TODAY, priority: 'normal' });
    await repo.create({ title: 'Tomorrow job', dueDate: TOMORROW, priority: 'normal' });

    await renderCalendar(repository(store));
    expect(screen.getByText('Today job')).toBeTruthy();

    await press(`planner-calendar-grid-day-${TOMORROW}`);

    expect(screen.getByText('Tomorrow job')).toBeTruthy();
    expect(screen.queryByText('Today job')).toBeNull();
    // The heading stops claiming "Today" once another day is selected.
    expect(screen.getByText(spokenDate(TOMORROW))).toBeTruthy();
  });

  it('completes a task from the day list and moves it to the completed count', async () => {
    const store = rows();
    const repo = repository(store);
    const created = await repo.create({ title: 'Finish me', dueDate: TODAY, priority: 'normal' });
    expect(created.kind).toBe('saved');

    await renderCalendar(repository(store));
    expect(screen.getByText('1 open')).toBeTruthy();

    const task = created.kind === 'saved' ? created.task : null;
    await press(`planner-calendar-day-list-toggle-${task!.id}`);

    await waitFor(() => {
      expect(screen.getByText('0 open, 1 completed')).toBeTruthy();
    });
  });

  it('reopens a completed task from the day list', async () => {
    const store = rows();
    const repo = repository(store);
    const created = await repo.create({ title: 'Toggle me', dueDate: TODAY, priority: 'normal' });
    const task = created.kind === 'saved' ? created.task : null;
    await repo.setCompleted(task!.id, true);

    await renderCalendar(repository(store));
    expect(screen.getByText('0 open, 1 completed')).toBeTruthy();

    await press(`planner-calendar-day-list-toggle-${task!.id}`);

    await waitFor(() => {
      expect(screen.getByText('1 open')).toBeTruthy();
    });
  });

  it('pages to the previous and next month without moving the selection', async () => {
    await renderCalendar(repository(rows()));

    const year = Number(TODAY.slice(0, 4));
    const month = Number(TODAY.slice(5, 7));

    await press('planner-calendar-next');
    expect(screen.getByTestId('planner-calendar-label').props.children).toBe(
      monthLabel(month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 }),
    );
    // The selected day is still the one the user picked.
    expect(screen.getByTestId('planner-calendar-day-heading').props.children).toBe('Today');

    await press('planner-calendar-prev');
    expect(screen.getByTestId('planner-calendar-label').props.children).toBe(
      monthLabel({ year, month }),
    );
  });

  it('returns to today’s month and selection from anywhere', async () => {
    await renderCalendar(repository(rows()));

    await press('planner-calendar-next');
    await press('planner-calendar-next');
    await press('planner-calendar-today');

    expect(screen.getByTestId('planner-calendar-label').props.children).toBe(
      monthLabel({ year: Number(TODAY.slice(0, 4)), month: Number(TODAY.slice(5, 7)) }),
    );
    expect(
      screen.getByTestId(`planner-calendar-grid-day-${TODAY}`).props.accessibilityState,
    ).toEqual(expect.objectContaining({ selected: true }));
  });

  it('carries the selected date to Tasks when adding', async () => {
    const router = jest.requireMock('expo-router') as { useRouter: () => { push: jest.Mock } };
    const push = router.useRouter().push;
    push.mockClear();

    await renderCalendar(repository(rows()));
    await press(`planner-calendar-grid-day-${TOMORROW}`);
    await press('planner-calendar-add');

    expect(push).toHaveBeenCalledWith({
      pathname: '/planner/tasks',
      params: { date: TOMORROW },
    });
  });

  it('offers no delete or edit control on the calendar', async () => {
    const store = rows();
    const repo = repository(store);
    const created = await repo.create({ title: 'Only here', dueDate: TODAY, priority: 'normal' });
    const task = created.kind === 'saved' ? created.task : null;

    await renderCalendar(repository(store));

    /*
      Editing and deleting live on the Tasks screen. A second delete entry point would mean a second
      confirmation flow, and those drift.
    */
    expect(screen.queryByTestId(`planner-calendar-day-list-remove-${task!.id}`)).toBeNull();
    expect(screen.queryByTestId(`planner-calendar-day-list-edit-${task!.id}`)).toBeNull();
  });

  it('speaks a whole date and the task count on each day cell', async () => {
    const store = rows();
    const repo = repository(store);
    await repo.create({ title: 'One', dueDate: TOMORROW, priority: 'normal' });

    await renderCalendar(repository(store));

    const cell = screen.getByTestId(`planner-calendar-grid-day-${TOMORROW}`);
    const label = String(cell.props.accessibilityLabel);
    expect(label).toContain(spokenDate(TOMORROW));
    expect(label).toContain('1 task');

    const todayCell = screen.getByTestId(`planner-calendar-grid-day-${TODAY}`);
    expect(String(todayCell.props.accessibilityLabel)).toContain('today');
  });

  it('shows nothing from another account', async () => {
    const store = rows();
    const mine = repository(store, OWNER);
    await mine.create({ title: 'Mine only', dueDate: TODAY, priority: 'normal' });

    // A different owner reads a different address, so the calendar is empty for them.
    await renderCalendar(repository(store, OTHER_OWNER));

    expect(screen.queryByText('Mine only')).toBeNull();
    expect(screen.getByTestId('planner-calendar-day-empty')).toBeTruthy();
    expect(screen.queryByTestId(`planner-calendar-grid-dot-${TODAY}`)).toBeNull();
  });

  it('reports a storage fault instead of showing an empty calendar as if it were true', async () => {
    const failing: PlannerTaskStorage = {
      getItem: async () => {
        throw new Error('unavailable');
      },
      setItem: async () => undefined,
    };
    const repo = createPlannerTaskRepository({ ownerId: OWNER, storage: failing });

    await render(
      <PlannerProvider repository={repo}>
        <PlannerCalendarScreen />
      </PlannerProvider>,
    );

    await waitFor(() => {
      expect(screen.queryByTestId('planner-calendar-day')).toBeNull();
    });
    // The month grid still renders — a calendar with no data is still a calendar.
    expect(screen.getByTestId('planner-calendar-grid')).toBeTruthy();
  });
});
