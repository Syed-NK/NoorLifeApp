import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import {
  ModuleButton,
  ModuleErrorState,
  ModuleLoadingState,
  ModuleScaffold,
  ModuleSection,
  ModuleText,
} from '@features/modules/components';
import { ModuleCard } from '@features/modules/components/module-card';
import { moduleLayout, moduleNeutrals } from '@features/modules/module-tokens';
import { useModuleMetrics } from '@features/modules/use-module-metrics';
import { monthLabel, spokenDate } from '@shared/utils/calendar-grid';

import {
  monthForSelection,
  nextMonth,
  plannerCalendarMonth,
  plannerDaySummary,
  plannerEmptyDayCopy,
  plannerTasksForDay,
  previousMonth,
} from '../data/planner-calendar';
import { usePlannerDay } from '../di/planner-day-source';
import { usePlanner } from '../di/planner-provider';
import { PlannerMonthGrid } from '../components/planner-month-grid';
import { PlannerTaskList } from './planner-task-list';

/**
 * **Planner → Calendar.** A month of the user's own tasks, and the day they picked.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── What replaced what ─────────────────────────────────────────────────────
 * This route was a `ModuleSectionScreen` placeholder whose hero promised *"your events and NoorLife
 * plans on one grid, so nothing gets double-booked"*. That sentence described a feature that does not
 * exist and, read plainly, promised imported external events. Nothing here reads an external
 * calendar; the copy now says what the screen actually does.
 *
 * ── The provider split is not stylistic ────────────────────────────────────
 * `useModuleTheme` reads context that `ModuleScaffold` creates, so it cannot be called in the same
 * function that renders the scaffold — the hook runs while the provider is still part of the value
 * being returned, and throws. That exact mistake shipped on the Tasks route and crashed the app on
 * every mount. The body lives in its own component for that reason, and the regression test for it
 * renders this screen with no module context of its own.
 * ═══════════════════════════════════════════════════════════════════════════
 */
export function PlannerCalendarScreen() {
  return (
    <ModuleScaffold
      moduleId="planner"
      activeKey="calendar"
      title="Calendar"
      testID="planner-calendar"
    >
      <PlannerCalendarBody />
    </ModuleScaffold>
  );
}

/** Split out so it renders inside the scaffold's `ModuleProvider`. */
function PlannerCalendarBody() {
  const planner = usePlanner();
  const router = useRouter();
  const { dp } = useModuleMetrics();

  /*
    Today comes from the shared day source, so a day cell cannot change which day it thinks is
    "today" midway through a render pass *and* cannot disagree with the Planner home once midnight
    passes. Capturing it per mount achieved only the first.
  */
  const { today, tomorrow } = usePlannerDay();
  const [selected, setSelected] = useState<string>(today);
  const [visibleMonth, setVisibleMonth] = useState(() => monthForSelection(today, today));

  const month = useMemo(
    () => plannerCalendarMonth(visibleMonth, planner.tasks),
    [visibleMonth, planner.tasks],
  );
  const dayTasks = useMemo(
    () => plannerTasksForDay(planner.tasks, selected),
    [planner.tasks, selected],
  );

  /*
    Paging months does not move the selection. Looking at October while August 14th stays selected is
    what a person expects from a calendar, and silently re-selecting a day in the month they paged to
    would change what the list below shows without them asking.
  */
  function goToPreviousMonth(): void {
    setVisibleMonth((current) => previousMonth(current));
  }

  function goToNextMonth(): void {
    setVisibleMonth((current) => nextMonth(current));
  }

  /** Today selects today *and* pages to its month, because that is one intent, not two. */
  function goToToday(): void {
    setSelected(today);
    setVisibleMonth(monthForSelection(today, today));
  }

  const empty = plannerEmptyDayCopy();

  return (
    <View style={{ rowGap: dp(moduleLayout.sectionGap) }}>
      <ModuleCard tinted testID="planner-calendar-month">
        <View style={{ rowGap: dp(10) }}>
          <View style={styles.monthHeader}>
            <ModuleButton
              label="Previous"
              variant="tertiary"
              fullWidth={false}
              onPress={goToPreviousMonth}
              accessibilityHint={`Show ${monthLabel(previousMonth(visibleMonth))}`}
              testID="planner-calendar-prev"
            />
            <ModuleText
              token="cardTitle"
              accessibilityRole="header"
              testID="planner-calendar-label"
            >
              {month.grid.label}
            </ModuleText>
            <ModuleButton
              label="Next"
              variant="tertiary"
              fullWidth={false}
              onPress={goToNextMonth}
              accessibilityHint={`Show ${monthLabel(nextMonth(visibleMonth))}`}
              testID="planner-calendar-next"
            />
          </View>
          <PlannerMonthGrid
            month={month.grid}
            indicators={month.indicators}
            today={today}
            selected={selected}
            onSelect={setSelected}
            testID="planner-calendar-grid"
          />
          <ModuleButton
            label="Today"
            variant="secondary"
            onPress={goToToday}
            testID="planner-calendar-today"
          />
        </View>
      </ModuleCard>

      {planner.loading ? <ModuleLoadingState /> : null}
      {planner.fault === null ? null : (
        <ModuleErrorState onRetry={planner.reload} developerDetail={planner.fault} />
      )}

      {!planner.loading && planner.fault === null ? (
        <ModuleSection title="Selected day" testID="planner-calendar-day">
          <View style={{ rowGap: dp(moduleLayout.cardGap) }}>
            <ModuleCard testID="planner-calendar-day-summary">
              <View style={{ rowGap: dp(4) }}>
                <ModuleText
                  token="cardTitle"
                  numberOfLines={2}
                  testID="planner-calendar-day-heading"
                >
                  {selectedHeading(selected, today)}
                </ModuleText>
                <ModuleText token="caption" color={moduleNeutrals.textSecondary}>
                  {plannerDaySummary(dayTasks)}
                </ModuleText>
              </View>
            </ModuleCard>

            {dayTasks.length === 0 ? (
              <ModuleCard testID="planner-calendar-day-empty">
                <View style={{ rowGap: dp(4) }}>
                  <ModuleText token="cardTitle" accessibilityRole="header">
                    {empty.title}
                  </ModuleText>
                  <ModuleText token="caption" color={moduleNeutrals.textSecondary}>
                    {empty.body}
                  </ModuleText>
                </View>
              </ModuleCard>
            ) : (
              /*
                The same list component the Tasks screen uses, so a task looks and behaves the same
                wherever the user meets it. `onEdit` and `onRemove` are deliberately not passed:
                editing and deleting live on the Tasks screen, and offering a second place to delete
                something is how two confirmation flows drift apart.
              */
              <PlannerTaskList
                tasks={dayTasks}
                today={today}
                tomorrow={tomorrow}
                onComplete={(task) => void planner.setCompleted(task.id, task.status === 'open')}
                testID="planner-calendar-day-list"
              />
            )}

            <ModuleButton
              label="Add task for this day"
              onPress={() =>
                router.push({ pathname: '/planner/tasks', params: { date: selected } })
              }
              accessibilityHint="Opens Tasks with this date already filled in"
              testID="planner-calendar-add"
            />
          </View>
        </ModuleSection>
      ) : null}
    </View>
  );
}

/**
 * The heading above the selected day's list.
 *
 * Says "Today" only when the day really is today, because a calendar that called a paged-to day
 * "today" would be lying about the one thing a calendar is for. Exported for test, so the wording
 * and the condition stay together.
 */
export function selectedHeading(selected: string, today: string): string {
  return selected === today ? 'Today' : spokenDate(selected);
}

const styles = StyleSheet.create({
  monthHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
});
