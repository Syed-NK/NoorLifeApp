import { PlannerTasksScreen } from '@features/planner/screens/planner-tasks-screen';

/**
 * Planner → Tasks.
 *
 * No provider here. The task store has one owner, mounted app-wide by `TodayAgendaProvider` — issue
 * #73. A provider on this route would shadow it, and adding a task would then update this screen and
 * nothing else.
 */
export default function Screen() {
  return <PlannerTasksScreen />;
}
