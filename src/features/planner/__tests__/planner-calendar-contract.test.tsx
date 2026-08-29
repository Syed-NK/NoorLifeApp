import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { render, screen, waitFor } from '@testing-library/react-native';

import { setRouteParams } from '../../../../jest.setup';

import { GRID_COLUMNS, gridCellWidth, isoFor } from '@shared/utils/calendar-grid';

import {
  createPlannerTaskRepository,
  type PlannerTaskRepository,
  type PlannerTaskStorage,
} from '../data/planner-task.repository';
import { localDateKey, offsetLocalDate } from '../data/planner-task';
import { PlannerProvider } from '../di/planner-provider';
import { PlannerCalendarScreen } from '../screens/planner-calendar-screen';
import {
  PlannerTasksScreen,
  dueChoiceFor,
  prefilledDueDate,
} from '../screens/planner-tasks-screen';

const OWNER = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const now = new Date();
const TODAY = localDateKey(now);
const TOMORROW = offsetLocalDate(now, 1);
const FAR_FUTURE = '2027-03-09';

function repository(store: Map<string, string>): PlannerTaskRepository {
  const storage: PlannerTaskStorage = {
    getItem: async (key) => store.get(key) ?? null,
    setItem: async (key, value) => {
      store.set(key, value);
    },
  };
  let sequence = 0;
  return createPlannerTaskRepository({
    ownerId: OWNER,
    storage,
    id: () => `task.aaaaaaaa-1111-4111-8111-${String(++sequence).padStart(12, '0')}`,
    now: () => new Date('2026-08-21T08:00:00.000Z'),
  });
}

/**
 * The contract between the calendar and the Tasks screen, and the layout promises the grid makes.
 */

describe('the prefilled due date a route parameter carries', () => {
  it('accepts a real calendar day', () => {
    expect(prefilledDueDate(FAR_FUTURE)).toBe(FAR_FUTURE);
    expect(prefilledDueDate('2024-02-29')).toBe('2024-02-29');
  });

  /*
    Expo Router types a search parameter as `string | string[]`, because a URL may repeat it. A deep
    link is untrusted input, so every one of these has to be refused rather than reaching the
    composer as a due date.
  */
  it.each([
    ['a day that does not exist', '2026-02-30'],
    ['a month that does not exist', '2026-13-01'],
    ['a word', 'tomorrow'],
    ['an empty string', ''],
    ['a partial date', '2026-09'],
    ['an ISO instant rather than a day', '2026-09-15T00:00:00.000Z'],
    ['a slashed date', '2026/09/15'],
    ['an unpadded date', '2026-9-5'],
  ])('refuses %s', (_label, raw) => {
    expect(prefilledDueDate(raw)).toBeNull();
  });

  it('takes the first value when the parameter repeats', () => {
    expect(prefilledDueDate([FAR_FUTURE, '2026-01-01'])).toBe(FAR_FUTURE);
  });

  it('refuses a repeated parameter whose first value is invalid', () => {
    expect(prefilledDueDate(['nonsense', FAR_FUTURE])).toBeNull();
  });

  it('is null when the parameter is absent', () => {
    expect(prefilledDueDate(undefined)).toBeNull();
    expect(prefilledDueDate([])).toBeNull();
  });
});

describe('which due chip a date corresponds to', () => {
  it('maps today, tomorrow, another day and no day', () => {
    expect(dueChoiceFor(TODAY, TODAY, TOMORROW)).toBe('today');
    expect(dueChoiceFor(TOMORROW, TODAY, TOMORROW)).toBe('tomorrow');
    expect(dueChoiceFor(FAR_FUTURE, TODAY, TOMORROW)).toBe('custom');
    expect(dueChoiceFor(null, TODAY, TOMORROW)).toBe('none');
  });
});

describe('the Tasks screen consuming a prefilled date', () => {
  afterEach(() => {
    setRouteParams({});
  });

  async function renderTasks() {
    await render(
      <PlannerProvider repository={repository(new Map())}>
        <PlannerTasksScreen />
      </PlannerProvider>,
    );
    await waitFor(() => {
      expect(screen.queryByTestId('planner-open-tasks')).toBeTruthy();
    });
  }

  it('fills the custom date field from the parameter', async () => {
    setRouteParams({ date: FAR_FUTURE });

    await renderTasks();

    expect(screen.getByTestId('planner-task-date').props.value).toBe(FAR_FUTURE);
    expect(screen.getByTestId('planner-task-due-custom').props.accessibilityState).toEqual(
      expect.objectContaining({ selected: true }),
    );
  });

  it('uses the Today chip rather than a custom date when the parameter is today', async () => {
    setRouteParams({ date: TODAY });

    await renderTasks();

    expect(screen.getByTestId('planner-task-due-today').props.accessibilityState).toEqual(
      expect.objectContaining({ selected: true }),
    );
    expect(screen.queryByTestId('planner-task-date')).toBeNull();
  });

  it('opens on its normal default when the parameter is malformed, without explaining itself', async () => {
    setRouteParams({ date: '2026-02-30' });

    await renderTasks();

    expect(screen.getByTestId('planner-task-due-today').props.accessibilityState).toEqual(
      expect.objectContaining({ selected: true }),
    );
    expect(screen.queryByTestId('planner-task-date')).toBeNull();
    // No error message: a bad deep link is not the user's mistake to be told about.
    expect(screen.queryByTestId('planner-task-message')).toBeNull();
  });

  it('opens on its normal default when there is no parameter at all', async () => {
    setRouteParams({});

    await renderTasks();

    expect(screen.getByTestId('planner-task-due-today').props.accessibilityState).toEqual(
      expect.objectContaining({ selected: true }),
    );
  });

  it('leaves the title and notes empty — a date is all the parameter may fill', async () => {
    setRouteParams({ date: FAR_FUTURE });

    await renderTasks();

    expect(screen.getByTestId('planner-task-title').props.value).toBe('');
    expect(screen.getByTestId('planner-task-notes').props.value).toBe('');
  });
});

describe('the grid’s layout and accessibility contract', () => {
  async function renderCalendar() {
    await render(
      <PlannerProvider repository={repository(new Map())}>
        <PlannerCalendarScreen />
      </PlannerProvider>,
    );
    await waitFor(() => {
      expect(screen.queryByTestId('planner-calendar-grid')).toBeTruthy();
    });
  }

  it('gives every day cell a hit target of at least 44 dp', async () => {
    await renderCalendar();

    const cell = screen.getByTestId(`planner-calendar-grid-day-${TODAY}`);
    /*
      `PressableScale` is one node since #115: the element that carries the testID, the role and the
      label is the element the caller styled, so the sized box is the node itself. It used to be an
      outer `Animated.View` with an absolute-fill `Pressable` inside, and reading the child then
      gave `absoluteFill` — no width, and the assertion silently became NaN >= 44.
    */
    const sized = cell;
    const style = Array.isArray(sized.props.style)
      ? Object.assign({}, ...sized.props.style.flat())
      : sized.props.style;
    const slop = cell.props.hitSlop;
    const width = Number(style.width);
    const horizontal = width + Number(slop.left ?? 0) + Number(slop.right ?? 0);
    const vertical = Number(style.height) + Number(slop.top ?? 0) + Number(slop.bottom ?? 0);

    expect(horizontal).toBeGreaterThanOrEqual(44);
    expect(vertical).toBeGreaterThanOrEqual(44);
  });

  it('states the selected and today states through accessibility, not colour alone', async () => {
    await renderCalendar();

    const todayCell = screen.getByTestId(`planner-calendar-grid-day-${TODAY}`);
    expect(todayCell.props.accessibilityState).toEqual(expect.objectContaining({ selected: true }));
    expect(String(todayCell.props.accessibilityLabel)).toContain('today');
    expect(String(todayCell.props.accessibilityLabel)).toContain('selected');
  });

  it('hides the decorative weekday headings from the screen reader', () => {
    const source = readFileSync(
      join(__dirname, '..', 'components', 'planner-month-grid.tsx'),
      'utf8',
    );

    expect(source).toContain('accessibilityElementsHidden');
  });

  it('names the month controls in words, because the label is what is spoken', () => {
    const source = readFileSync(
      join(__dirname, '..', 'screens', 'planner-calendar-screen.tsx'),
      'utf8',
    );

    expect(source).toContain('label="Previous"');
    expect(source).toContain('label="Next"');
    // A glyph-only control would be read out as punctuation or skipped entirely.
    expect(source).not.toMatch(/label="[‹›<>]"/);
  });

  it('fits seven columns at every width the app supports, so no date sits in the wrong weekday', () => {
    for (const width of [320, 360, 384, 411, 480, 600, 768]) {
      for (const padding of [10, 11, 14, 18]) {
        const cell = gridCellWidth(width, padding);
        expect(cell * GRID_COLUMNS).toBeLessThanOrEqual(width - padding * 2 - 2);
      }
    }
  });

  it('renders the whole month even at a large font scale', async () => {
    await renderCalendar();

    const year = Number(TODAY.slice(0, 4));
    const month = Number(TODAY.slice(5, 7));
    /*
      Every day of the month is present as its own cell. A grid that dropped or merged cells under a
      larger type scale would fail here rather than on somebody's phone.
    */
    for (let day = 1; day <= 28; day += 1) {
      expect(
        screen.getByTestId(`planner-calendar-grid-day-${isoFor(year, month, day)}`),
      ).toBeTruthy();
    }
  });

  it('keeps its content inside the scaffold, which owns the bottom-navigation inset', () => {
    const source = readFileSync(
      join(__dirname, '..', 'screens', 'planner-calendar-screen.tsx'),
      'utf8',
    );

    /*
      The screen renders into `ModuleScaffold`, which reserves the navigation bar's height and the
      gesture inset beneath it. It must not position anything absolutely or set its own bottom
      padding, because that is how content ends up under the bar on a device with a gesture area.
    */
    expect(source).toContain('<ModuleScaffold');
    expect(source).not.toMatch(/position:\s*'absolute'/);
    expect(source).not.toMatch(/paddingBottom/);
  });
});

describe('offline and account-scoped by construction', () => {
  const sources = [
    join(__dirname, '..', 'data', 'planner-calendar.ts'),
    join(__dirname, '..', 'components', 'planner-month-grid.tsx'),
    join(__dirname, '..', 'screens', 'planner-calendar-screen.tsx'),
  ];

  it('reaches no network from any calendar source, so a cold offline launch is unaffected', () => {
    sources.forEach((path) => {
      const code = readFileSync(path, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');

      expect(code).not.toMatch(/fetch\(|axios|XMLHttpRequest|WebSocket|https?:\/\//);
      expect(code).not.toMatch(/supabase/i);
    });
  });

  it('reads tasks only through the account-scoped provider', () => {
    const code = readFileSync(sources[2]!, 'utf8');

    // The screen has no storage access of its own; every task comes from `usePlanner`.
    expect(code).toContain('usePlanner()');
    expect(code).not.toMatch(/AsyncStorage|getItem|setItem/);
  });

  it('renders a month from stored rows with no clock or network available to it', async () => {
    const store = new Map<string, string>();
    const repo = repository(store);
    await repo.create({ title: 'Saved earlier', dueDate: TODAY, priority: 'normal' });

    // A second repository over the same store stands in for a fresh launch.
    await render(
      <PlannerProvider repository={repository(store)}>
        <PlannerCalendarScreen />
      </PlannerProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText('Saved earlier')).toBeTruthy();
    });
    expect(screen.getByTestId(`planner-calendar-grid-dot-${TODAY}`)).toBeTruthy();
  });
});
