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

import { localDateKey, offsetLocalDate } from '../data/planner-task';
import { usePlanner } from '../di/planner-provider';
import { PlannerTaskList } from './planner-task-list';

export function PlannerHomeContent() {
  const router = useRouter();
  const planner = usePlanner();
  const { dp } = useModuleMetrics();
  const now = new Date();
  const today = localDateKey(now);
  const tomorrow = offsetLocalDate(now, 1);
  const dueToday = planner.tasks.filter((task) => task.status === 'open' && task.dueDate === today);
  const open = planner.tasks.filter((task) => task.status === 'open');
  const completed = planner.tasks.filter((task) => task.status === 'completed');

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
