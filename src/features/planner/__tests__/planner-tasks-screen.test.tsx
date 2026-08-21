import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { ModuleProvider } from '@features/modules/module-context';

import {
  createPlannerTaskRepository,
  type PlannerTaskRepository,
  type PlannerTaskStorage,
} from '../data/planner-task.repository';
import { PlannerProvider } from '../di/planner-provider';
import { PlannerTasksScreen } from '../screens/planner-tasks-screen';

const OWNER = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';

async function press(testID: string): Promise<void> {
  await act(async () => {
    fireEvent.press(screen.getByTestId(testID));
    await Promise.resolve();
  });
}

function repository(): PlannerTaskRepository {
  const rows = new Map<string, string>();
  const storage: PlannerTaskStorage = {
    getItem: async (key) => rows.get(key) ?? null,
    setItem: async (key, value) => {
      rows.set(key, value);
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

async function renderPlanner(repo: PlannerTaskRepository) {
  await render(
    <ModuleProvider moduleId="planner">
      <PlannerProvider repository={repo}>
        <PlannerTasksScreen />
      </PlannerProvider>
    </ModuleProvider>,
  );
  await waitFor(() => {
    expect(screen.queryByTestId('planner-open-tasks')).toBeTruthy();
    expect(screen.queryByText('Loading your saved information…')).toBeNull();
  });
}

describe('Planner task screen', () => {
  it('starts honestly empty and never invents a schedule', async () => {
    await renderPlanner(repository());
    expect(screen.getByText('Nothing scheduled')).toBeTruthy();
    expect(screen.getByText(/NoorLife will not invent a schedule/)).toBeTruthy();
  });

  it('preserves a custom due date while editing', async () => {
    const repo = repository();
    const created = await repo.create({ title: 'Renew passport', dueDate: '2027-03-14' });
    expect(created.kind).toBe('saved');
    await renderPlanner(repo);
    const listed = await repo.list();
    if (listed.kind !== 'ok') throw new Error('Expected seeded task.');
    const task = listed.tasks[0];
    if (task === undefined) throw new Error('Expected seeded task.');

    await press(`planner-open-list-edit-${task.id}`);
    expect(screen.getByTestId('planner-task-due-custom').props.accessibilityState).toEqual({
      selected: true,
    });
    expect(screen.getByTestId('planner-task-date').props.value).toBe('2027-03-14');
    expect(screen.getByTestId('planner-task-title').props.value).toBe('Renew passport');
  });

  it('does not delete until the user confirms', async () => {
    const repo = repository();
    await repo.create({ title: 'Pack lunch' });
    await renderPlanner(repo);
    const listed = await repo.list();
    if (listed.kind !== 'ok') throw new Error('Expected seeded task.');
    const task = listed.tasks[0];
    if (task === undefined) throw new Error('Expected seeded task.');

    await press(`planner-open-list-remove-${task.id}`);
    expect(screen.getByTestId('planner-removal-confirmation')).toBeTruthy();
    await press('planner-task-delete-cancel');
    expect(screen.queryByText('Delete this task?')).toBeNull();
    expect(screen.getByText('Pack lunch')).toBeTruthy();
    await expect(repo.list()).resolves.toMatchObject({
      kind: 'ok',
      tasks: [{ id: task.id, title: 'Pack lunch' }],
    });
  });
});
