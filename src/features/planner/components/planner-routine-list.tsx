import { Pressable, StyleSheet, View } from 'react-native';

import { ModuleButton, ModuleText } from '@features/modules/components';
import { ModuleCard } from '@features/modules/components/module-card';
import { moduleLayout, moduleNeutrals } from '@features/modules/module-tokens';
import { useModuleMetrics } from '@features/modules/use-module-metrics';

import {
  routineScheduleLabel,
  routineScheduleSpoken,
  type PlannerRoutine,
} from '../data/planner-routine';

/**
 * **A list of routines** — either today's occurrences, which can be ticked, or the whole set for
 * management.
 *
 * One component for both because a routine should look the same wherever it appears; the difference
 * is which controls the caller passes. `PlannerTaskList` makes the same choice for the same reason.
 *
 * The tick is a `checkbox` with its state in `accessibilityState`, so "done" is announced rather than
 * only coloured. Nothing here shows a count across days: this phase records today and aggregates
 * nothing.
 */

export type PlannerRoutineListProps = {
  readonly routines: readonly PlannerRoutine[];
  /** Whether each routine is complete for the day being shown. Absent in management mode. */
  readonly completedIds?: readonly string[];
  /** Ticking an occurrence. Absent in management mode, where there is no day to tick. */
  readonly onToggle?: (routine: PlannerRoutine, completed: boolean) => void;
  readonly onEdit?: (routine: PlannerRoutine) => void;
  readonly onToggleActive?: (routine: PlannerRoutine) => void;
  readonly onRemove?: (routine: PlannerRoutine) => void;
  readonly emptyTitle: string;
  readonly emptyBody: string;
  readonly testID?: string;
};

export function PlannerRoutineList({
  routines,
  completedIds,
  onToggle,
  onEdit,
  onToggleActive,
  onRemove,
  emptyTitle,
  emptyBody,
  testID = 'planner-routine-list',
}: PlannerRoutineListProps) {
  const { dp } = useModuleMetrics();

  if (routines.length === 0) {
    return (
      <ModuleCard testID={`${testID}-empty`}>
        <ModuleText token="cardTitle" accessibilityRole="header">
          {emptyTitle}
        </ModuleText>
        <ModuleText token="caption" color={moduleNeutrals.textSecondary}>
          {emptyBody}
        </ModuleText>
      </ModuleCard>
    );
  }

  return (
    <View style={{ rowGap: dp(moduleLayout.cardGap) }} testID={testID}>
      {routines.map((routine) => {
        const completed = (completedIds ?? []).includes(routine.id);
        return (
          <ModuleCard key={routine.id} testID={`${testID}-${routine.id}`}>
            <View style={{ rowGap: dp(8) }}>
              {onToggle === undefined ? (
                <RoutineHeading routine={routine} />
              ) : (
                <Pressable
                  onPress={() => onToggle(routine, !completed)}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: completed }}
                  /*
                    The spoken label carries the action, the title and the schedule in full — a bare
                    "Morning stretch, checkbox" tells a screen-reader user nothing about which days it
                    recurs on, which is the whole point of a routine.
                  */
                  accessibilityLabel={`${completed ? 'Reopen' : 'Complete'} ${routine.title}, ${routineScheduleSpoken(
                    routine.schedule,
                  )}${routine.preferredTime === null ? '' : ` at ${routine.preferredTime}`}`}
                  style={styles.heading}
                  testID={`${testID}-toggle-${routine.id}`}
                >
                  <View
                    style={[
                      styles.check,
                      {
                        width: dp(24),
                        height: dp(24),
                        borderRadius: dp(12),
                        backgroundColor: completed
                          ? moduleNeutrals.success
                          : moduleNeutrals.surface,
                      },
                    ]}
                  />
                  <View style={styles.flex}>
                    <RoutineHeading routine={routine} />
                  </View>
                </Pressable>
              )}

              {routine.note.length === 0 ? null : (
                <ModuleText token="body" color={moduleNeutrals.textSecondary} numberOfLines={4}>
                  {routine.note}
                </ModuleText>
              )}

              {onEdit === undefined &&
              onToggleActive === undefined &&
              onRemove === undefined ? null : (
                <View style={{ rowGap: dp(4) }}>
                  {onEdit === undefined ? null : (
                    <ModuleButton
                      label="Edit routine"
                      variant="secondary"
                      onPress={() => onEdit(routine)}
                      testID={`${testID}-edit-${routine.id}`}
                    />
                  )}
                  {onToggleActive === undefined ? null : (
                    <ModuleButton
                      label={routine.active ? 'Turn off' : 'Turn on'}
                      variant="tertiary"
                      onPress={() => onToggleActive(routine)}
                      accessibilityHint={
                        routine.active
                          ? 'Stops it appearing on its scheduled days. Your record is kept.'
                          : 'Starts it appearing on its scheduled days again.'
                      }
                      testID={`${testID}-active-${routine.id}`}
                    />
                  )}
                  {onRemove === undefined ? null : (
                    <ModuleButton
                      label="Delete routine"
                      variant="destructive"
                      onPress={() => onRemove(routine)}
                      testID={`${testID}-remove-${routine.id}`}
                    />
                  )}
                </View>
              )}
            </View>
          </ModuleCard>
        );
      })}
    </View>
  );
}

/** Title, schedule and time — the three facts a routine row states, and nothing derived. */
function RoutineHeading({ routine }: { readonly routine: PlannerRoutine }) {
  return (
    <>
      <ModuleText token="cardTitle" numberOfLines={3}>
        {routine.title}
      </ModuleText>
      <ModuleText token="caption" color={moduleNeutrals.textSecondary} numberOfLines={2}>
        {routineScheduleLabel(routine.schedule)}
        {routine.preferredTime === null ? '' : ` · ${routine.preferredTime}`}
        {routine.priority === 'high' ? ' · High priority' : ''}
        {routine.active ? '' : ' · Off'}
      </ModuleText>
    </>
  );
}

const styles = StyleSheet.create({
  heading: {
    alignItems: 'center',
    flexDirection: 'row',
    minHeight: 44,
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
