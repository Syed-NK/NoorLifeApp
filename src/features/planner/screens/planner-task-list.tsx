import { Pressable, StyleSheet, View } from 'react-native';

import { ModuleButton, ModuleText } from '@features/modules/components';
import { ModuleCard } from '@features/modules/components/module-card';
import { moduleLayout, moduleNeutrals } from '@features/modules/module-tokens';
import { useModuleMetrics } from '@features/modules/use-module-metrics';

import type { PlannerTask } from '../data/planner-task';
import { minimumTouchTargetSize } from '@shared/utils/a11y';

export function plannerDueLabel(task: PlannerTask, today: string, tomorrow: string): string {
  if (task.dueDate === null) {
    return 'No due date';
  }
  const day =
    task.dueDate === today ? 'Today' : task.dueDate === tomorrow ? 'Tomorrow' : task.dueDate;
  return task.dueTime === null ? day : `${day} at ${task.dueTime}`;
}

export type PlannerTaskListProps = {
  readonly tasks: readonly PlannerTask[];
  readonly today: string;
  readonly tomorrow: string;
  readonly onEdit?: (task: PlannerTask) => void;
  readonly onComplete: (task: PlannerTask) => void;
  readonly onRemove?: (task: PlannerTask) => void;
  readonly testID?: string;
};

export function PlannerTaskList({
  tasks,
  today,
  tomorrow,
  onEdit,
  onComplete,
  onRemove,
  testID = 'planner-task-list',
}: PlannerTaskListProps) {
  const { dp } = useModuleMetrics();

  if (tasks.length === 0) {
    return (
      <ModuleCard testID={`${testID}-empty`}>
        <ModuleText token="cardTitle" accessibilityRole="header">
          Nothing scheduled
        </ModuleText>
        <ModuleText token="caption" color={moduleNeutrals.textSecondary}>
          Add only what you genuinely plan to do. NoorLife will not invent a schedule for you.
        </ModuleText>
      </ModuleCard>
    );
  }

  return (
    <View style={{ rowGap: dp(moduleLayout.cardGap) }} testID={testID}>
      {tasks.map((task) => (
        <ModuleCard key={task.id} testID={`${testID}-${task.id}`}>
          <View style={{ rowGap: dp(8) }}>
            <Pressable
              onPress={() => onComplete(task)}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: task.status === 'completed' }}
              accessibilityLabel={`${task.status === 'completed' ? 'Reopen' : 'Complete'} ${task.title}`}
              /*
                The density-safe floor, read at render — issue #120.

                The style below carried a literal `minHeight: 44`. That is a request, not a result: Yoga
                snaps to whole pixels, so 44 dp at density 2.625 is 115.5 px and paints 115 px / 43.810 dp.
                It was also evaluated once at module load, which is the wrong density for any display the
                app was not launched on. Both are the halves #115 closed elsewhere.
              */
              style={[styles.heading, { minHeight: minimumTouchTargetSize() }]}
              testID={`${testID}-toggle-${task.id}`}
            >
              <View
                style={[
                  styles.check,
                  {
                    width: dp(24),
                    height: dp(24),
                    borderRadius: dp(12),
                    backgroundColor:
                      task.status === 'completed' ? moduleNeutrals.success : moduleNeutrals.surface,
                  },
                ]}
              />
              <View style={styles.flex}>
                <ModuleText token="cardTitle" numberOfLines={3}>
                  {task.title}
                </ModuleText>
                <ModuleText token="caption" color={moduleNeutrals.textSecondary} numberOfLines={2}>
                  {plannerDueLabel(task, today, tomorrow)}
                  {task.priority === 'high' ? ' · High priority' : ''}
                </ModuleText>
              </View>
            </Pressable>
            {task.notes.length === 0 ? null : (
              <ModuleText token="body" color={moduleNeutrals.textSecondary} numberOfLines={5}>
                {task.notes}
              </ModuleText>
            )}
            {onEdit === undefined && onRemove === undefined ? null : (
              <View style={{ rowGap: dp(4) }}>
                {onEdit === undefined ? null : (
                  <ModuleButton
                    label="Edit task"
                    variant="secondary"
                    onPress={() => onEdit(task)}
                    testID={`${testID}-edit-${task.id}`}
                  />
                )}
                {onRemove === undefined ? null : (
                  <ModuleButton
                    label="Delete task"
                    variant="destructive"
                    onPress={() => onRemove(task)}
                    testID={`${testID}-remove-${task.id}`}
                  />
                )}
              </View>
            )}
          </View>
        </ModuleCard>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  heading: {
    alignItems: 'center',
    flexDirection: 'row',
    columnGap: 10,
  },
  check: {
    borderColor: moduleNeutrals.border,
    borderWidth: 2,
  },
  flex: {
    flex: 1,
    minWidth: 0,
  },
});
