import { useRouter } from 'expo-router';
import { View } from 'react-native';

import {
  ModuleButton,
  ModuleErrorState,
  ModuleHeroCard,
  ModuleLoadingState,
  ModuleSection,
  ModuleSummaryCard,
} from '@features/modules/components';
import { moduleLayout } from '@features/modules/module-tokens';
import { useModuleMetrics } from '@features/modules/use-module-metrics';

import { routinesScheduledOn } from '../data/planner-routine';
import { usePlannerDay } from '../di/planner-day-source';
import { usePlanner } from '../di/planner-provider';
import { usePlannerRoutines } from '../di/planner-routine-provider';
import { PlannerTaskList } from './planner-task-list';

export function PlannerHomeContent() {
  const router = useRouter();
  const planner = usePlanner();
  const routinesState = usePlannerRoutines();
  const { dp } = useModuleMetrics();
  /*
    One reading of the calendar, shared with Tasks, Calendar, Routines and Main Home. This line used
    to construct its own date on every render, so a re-render across midnight rolled this surface over
    while the memoised ones stayed on yesterday — issue #76.
  */
  const { today, tomorrow } = usePlannerDay();
  const dueToday = planner.tasks.filter((task) => task.status === 'open' && task.dueDate === today);
  const open = planner.tasks.filter((task) => task.status === 'open');
  const completed = planner.tasks.filter((task) => task.status === 'completed');

  /*
    Counted by Planner's own selector, not re-derived here. `routinesScheduledOn` already answers
    "which routines are due on this day", including the active check, so this reads one number rather
    than restating the scheduling rule. The done count comes from the same completion log the Routines
    screen ticks — there is no second source and no aggregate beyond today.
  */
  const routinesToday = routinesScheduledOn(routinesState.routines, today);
  const routinesDone = routinesToday.filter((routine) =>
    (routinesState.completions.days[today] ?? []).includes(routine.id),
  );

  return (
    <View style={{ rowGap: dp(moduleLayout.sectionGap) }}>
      <ModuleHeroCard onAction={() => router.push('/planner/tasks')} testID="planner-hero" />

      {planner.loading ? <ModuleLoadingState /> : null}
      {planner.fault === null ? null : (
        <ModuleErrorState onRetry={planner.reload} developerDetail={planner.fault} />
      )}
      {!planner.loading && planner.fault === null ? (
        <>
          <ModuleSection title="At a glance" testID="planner-glance">
            <ModuleSummaryCard
              metrics={[
                { key: 'today', label: 'Due today', value: String(dueToday.length), icon: 'today' },
                { key: 'open', label: 'Open tasks', value: String(open.length), icon: 'tasks' },
                {
                  key: 'completed',
                  label: 'Completed',
                  value: String(completed.length),
                  icon: 'check-circle',
                },
              ]}
              testID="planner-summary"
            />
          </ModuleSection>
          <ModuleSection
            title="Today"
            actionLabel="All tasks"
            onAction={() => router.push('/planner/tasks')}
            testID="planner-today"
          >
            <PlannerTaskList
              tasks={dueToday}
              today={today}
              tomorrow={tomorrow}
              onComplete={(task) => void planner.setCompleted(task.id, true)}
              testID="planner-today-list"
            />
          </ModuleSection>
          <ModuleSection
            title="Routines today"
            actionLabel="All routines"
            onAction={() => router.push('/planner/routines')}
            testID="planner-routines-today"
          >
            <ModuleSummaryCard
              metrics={[
                {
                  key: 'scheduled',
                  label: 'Scheduled',
                  value: String(routinesToday.length),
                  icon: 'routines',
                },
                {
                  key: 'done',
                  label: 'Done',
                  value: String(routinesDone.length),
                  icon: 'check-circle',
                },
              ]}
              testID="planner-routines-summary"
            />
          </ModuleSection>

          <ModuleButton
            label="Add a task"
            onPress={() => router.push('/planner/tasks')}
            testID="planner-add-task"
          />
        </>
      ) : null}
    </View>
  );
}
