import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import {
  ModuleButton,
  ModuleErrorState,
  ModuleLoadingState,
  ModuleScaffold,
  ModuleSection,
  ModuleText,
} from '@features/modules/components';
import { ModuleCard } from '@features/modules/components/module-card';
import { useModuleTheme } from '@features/modules/module-context';
import { moduleLayout, moduleNeutrals } from '@features/modules/module-tokens';
import { useModuleMetrics } from '@features/modules/use-module-metrics';

import {
  isLocalDate,
  type PlannerTask,
  type PlannerTaskDraft,
  type PlannerTaskFault,
  type PlannerTaskPriority,
} from '../data/planner-task';
import { usePlannerDay } from '../di/planner-day-source';
import { usePlanner } from '../di/planner-provider';
import { PlannerTaskList } from './planner-task-list';
import { minimumTouchTargetSize } from '@shared/utils/a11y';

type DueChoice = 'none' | 'today' | 'tomorrow' | 'custom';

const FAULT_COPY: Readonly<Record<PlannerTaskFault, string>> = {
  'empty-title': 'Give the task a title.',
  'title-too-long': 'Keep the title to 120 characters.',
  'notes-too-long': 'Keep notes to 1,000 characters.',
  'invalid-date': 'Choose a valid due date.',
  'invalid-time': 'Use a 24-hour time such as 09:30, after choosing a day.',
};

/**
 * The due date a route parameter asked for, or `null`.
 *
 * Expo Router types a search parameter as `string | string[]`, because a URL may repeat it. So this
 * takes the first value if it is an array, and then puts it through `isLocalDate` — the same
 * validator the task contract uses — rather than trusting it. A deep link is untrusted input: it can
 * carry `2026-02-30`, an empty string, a word, or twenty of them, and none of those may reach the
 * composer as a due date. Anything that is not a real calendar day is discarded silently and the
 * composer opens on its normal default, because a malformed link is not something to explain to a
 * user who did not type it.
 *
 * Exported so the parsing rule is tested directly, without driving navigation.
 */
/**
 * Which due chip a stored date corresponds to.
 *
 * Shared by the composer's initial state and by `beginEdit`, so opening a task for editing and
 * arriving with a prefilled date agree about when a date counts as "Today" rather than "Date". They
 * were briefly two copies of the same conditional, which is how one of them ends up not knowing
 * about tomorrow.
 */
export function dueChoiceFor(dueDate: string | null, today: string, tomorrow: string): DueChoice {
  if (dueDate === null) {
    return 'none';
  }
  if (dueDate === today) {
    return 'today';
  }
  return dueDate === tomorrow ? 'tomorrow' : 'custom';
}

export function prefilledDueDate(raw: string | string[] | undefined): string | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === 'string' && isLocalDate(value) ? value : null;
}

export function PlannerTasksScreen() {
  return (
    <ModuleScaffold moduleId="planner" activeKey="tasks" title="Tasks" testID="planner-tasks">
      <PlannerTasksBody />
    </ModuleScaffold>
  );
}

/**
 * Split out so it renders inside the scaffold's `ModuleProvider`.
 *
 * `useModuleTheme` reads the context that `ModuleScaffold` creates, so a screen cannot call it in
 * the same function that renders the scaffold — the hook runs while the provider is still part of
 * the value being returned, and throws. Keeping the body in its own component is what puts the hook
 * below the provider. This is the same split `NoorAIFeedbackScreen` makes, for the same reason.
 */
function PlannerTasksBody() {
  const planner = usePlanner();
  const params = useLocalSearchParams<{ date?: string | string[] }>();
  const prefilled = prefilledDueDate(params.date);
  /*
    Today and tomorrow come from the shared day source rather than a date captured once per mount. A
    composer that opened before midnight used to keep labelling the previous day "Today" for as long
    as it stayed mounted, and disagree with the Planner home the moment that re-rendered.
  */
  const { today, tomorrow } = usePlannerDay();
  const theme = useModuleTheme();
  const { dp } = useModuleMetrics();
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  /*
    A prefilled date arrives from the calendar's "Add task for this day". It seeds the composer once,
    as initial state, rather than through an effect that would fight the user: re-applying the
    parameter on every render would snap the picker back each time they chose a different day.

    Today and tomorrow keep their own chips even when passed explicitly, so the composer shows the
    same choice the user would have made by hand for that date.
  */
  const [dueChoice, setDueChoice] = useState<DueChoice>(
    prefilled === null ? 'today' : dueChoiceFor(prefilled, today, tomorrow),
  );
  const [customDate, setCustomDate] = useState(
    prefilled !== null && dueChoiceFor(prefilled, today, tomorrow) === 'custom' ? prefilled : '',
  );
  const [dueTime, setDueTime] = useState('');
  const [priority, setPriority] = useState<PlannerTaskPriority>('normal');
  const [editing, setEditing] = useState<PlannerTask | null>(null);
  const [pendingRemoval, setPendingRemoval] = useState<PlannerTask | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const openTasks = planner.tasks.filter((task) => task.status === 'open');
  const completedTasks = planner.tasks.filter((task) => task.status === 'completed');

  function clearComposer(): void {
    setTitle('');
    setNotes('');
    setDueChoice('today');
    setCustomDate('');
    setDueTime('');
    setPriority('normal');
    setEditing(null);
  }

  function beginEdit(task: PlannerTask): void {
    const choice = dueChoiceFor(task.dueDate, today, tomorrow);
    setEditing(task);
    setTitle(task.title);
    setNotes(task.notes);
    setDueChoice(choice);
    setCustomDate(choice === 'custom' ? (task.dueDate ?? '') : '');
    setDueTime(task.dueTime ?? '');
    setPriority(task.priority);
    setMessage(null);
  }

  async function save(): Promise<void> {
    setSaving(true);
    setMessage(null);
    const dueDate =
      dueChoice === 'none'
        ? null
        : dueChoice === 'today'
          ? today
          : dueChoice === 'tomorrow'
            ? tomorrow
            : customDate;
    const draft: PlannerTaskDraft = { title, notes, dueDate, dueTime, priority };
    const result =
      editing === null
        ? await planner.createTask(draft)
        : await planner.updateTask(editing.id, draft);
    setSaving(false);
    if (result.kind === 'saved') {
      setMessage(editing === null ? 'Task saved' : 'Task updated');
      clearComposer();
      return;
    }
    if (result.kind === 'invalid') {
      setMessage(FAULT_COPY[result.fault]);
      return;
    }
    setMessage('The task could not be saved. Nothing was changed.');
  }

  return (
    <View style={{ rowGap: dp(moduleLayout.sectionGap) }}>
      <ModuleCard tinted accentBorder testID="planner-task-composer">
        <View style={{ rowGap: dp(10) }}>
          <ModuleText token="cardTitle" accessibilityRole="header">
            {editing === null ? 'Add a task' : 'Edit task'}
          </ModuleText>
          <TextInput
            value={title}
            onChangeText={setTitle}
            placeholder="What needs doing?"
            placeholderTextColor={moduleNeutrals.textTertiary}
            maxLength={120}
            accessibilityLabel="Task title"
            style={[
              styles.input,
              {
                minHeight: dp(48),
                borderRadius: dp(12),
                borderColor: theme.border,
                color: moduleNeutrals.textPrimary,
                paddingHorizontal: dp(12),
                fontSize: dp(14),
              },
            ]}
            testID="planner-task-title"
          />
          <TextInput
            value={notes}
            onChangeText={setNotes}
            placeholder="Notes (optional)"
            placeholderTextColor={moduleNeutrals.textTertiary}
            maxLength={1000}
            multiline
            accessibilityLabel="Task notes"
            style={[
              styles.input,
              styles.notes,
              {
                minHeight: dp(88),
                borderRadius: dp(12),
                borderColor: theme.border,
                color: moduleNeutrals.textPrimary,
                padding: dp(12),
                fontSize: dp(14),
              },
            ]}
            testID="planner-task-notes"
          />
          <ChoiceRow
            label="Due"
            choices={[
              { key: 'none', label: 'No date' },
              { key: 'today', label: 'Today' },
              { key: 'tomorrow', label: 'Tomorrow' },
              { key: 'custom', label: 'Date' },
            ]}
            selected={dueChoice}
            onSelect={(value) => {
              setDueChoice(value as DueChoice);
              if (value === 'none') setDueTime('');
            }}
            testID="planner-task-due"
          />
          {dueChoice === 'custom' ? (
            <TextInput
              value={customDate}
              onChangeText={setCustomDate}
              placeholder="Date (YYYY-MM-DD)"
              placeholderTextColor={moduleNeutrals.textTertiary}
              keyboardType="numbers-and-punctuation"
              maxLength={10}
              accessibilityLabel="Task due date"
              style={[
                styles.input,
                {
                  minHeight: dp(48),
                  borderRadius: dp(12),
                  borderColor: theme.border,
                  color: moduleNeutrals.textPrimary,
                  paddingHorizontal: dp(12),
                  fontSize: dp(14),
                },
              ]}
              testID="planner-task-date"
            />
          ) : null}
          {dueChoice === 'none' ? null : (
            <TextInput
              value={dueTime}
              onChangeText={setDueTime}
              placeholder="Time (optional, 09:30)"
              placeholderTextColor={moduleNeutrals.textTertiary}
              keyboardType="numbers-and-punctuation"
              maxLength={5}
              accessibilityLabel="Task due time"
              style={[
                styles.input,
                {
                  minHeight: dp(48),
                  borderRadius: dp(12),
                  borderColor: theme.border,
                  color: moduleNeutrals.textPrimary,
                  paddingHorizontal: dp(12),
                  fontSize: dp(14),
                },
              ]}
              testID="planner-task-time"
            />
          )}
          <ChoiceRow
            label="Priority"
            choices={[
              { key: 'normal', label: 'Normal' },
              { key: 'high', label: 'High' },
            ]}
            selected={priority}
            onSelect={(value) => setPriority(value as PlannerTaskPriority)}
            testID="planner-task-priority"
          />
          {message === null ? null : (
            <ModuleText
              token="caption"
              color={moduleNeutrals.textSecondary}
              testID="planner-task-message"
            >
              {message}
            </ModuleText>
          )}
          <ModuleButton
            label={editing === null ? 'Save task' : 'Save changes'}
            onPress={() => void save()}
            loading={saving}
            disabled={saving}
            testID="planner-task-save"
          />
          {editing === null ? null : (
            <ModuleButton
              label="Cancel editing"
              variant="tertiary"
              onPress={clearComposer}
              testID="planner-task-cancel"
            />
          )}
        </View>
      </ModuleCard>

      {planner.loading ? <ModuleLoadingState /> : null}
      {planner.fault === null ? null : (
        <ModuleErrorState onRetry={planner.reload} developerDetail={planner.fault} />
      )}
      {pendingRemoval === null ? null : (
        <ModuleCard accentBorder testID="planner-removal-confirmation">
          <View style={{ rowGap: dp(10) }}>
            <ModuleText token="cardTitle" accessibilityRole="header">
              Delete this task?
            </ModuleText>
            <ModuleText token="body" color={moduleNeutrals.textSecondary}>
              {pendingRemoval.title} will be permanently removed. This cannot be undone.
            </ModuleText>
            <ModuleButton
              label="Delete task"
              variant="secondary"
              onPress={() => {
                const task = pendingRemoval;
                setPendingRemoval(null);
                void planner.removeTask(task.id);
              }}
              testID="planner-task-delete-confirm"
            />
            <ModuleButton
              label="Keep task"
              variant="tertiary"
              onPress={() => setPendingRemoval(null)}
              testID="planner-task-delete-cancel"
            />
          </View>
        </ModuleCard>
      )}
      {!planner.loading && planner.fault === null ? (
        <>
          <ModuleSection title={`Open (${openTasks.length})`} testID="planner-open-tasks">
            <PlannerTaskList
              tasks={openTasks}
              today={today}
              tomorrow={tomorrow}
              onEdit={beginEdit}
              onComplete={(task) => void planner.setCompleted(task.id, true)}
              onRemove={setPendingRemoval}
              testID="planner-open-list"
            />
          </ModuleSection>
          {completedTasks.length === 0 ? null : (
            <ModuleSection
              title={`Completed (${completedTasks.length})`}
              testID="planner-completed-tasks"
            >
              <PlannerTaskList
                tasks={completedTasks}
                today={today}
                tomorrow={tomorrow}
                onEdit={beginEdit}
                onComplete={(task) => void planner.setCompleted(task.id, false)}
                onRemove={setPendingRemoval}
                testID="planner-completed-list"
              />
            </ModuleSection>
          )}
        </>
      ) : null}
    </View>
  );
}

function ChoiceRow({
  label,
  choices,
  selected,
  onSelect,
  testID,
}: {
  readonly label: string;
  readonly choices: readonly { readonly key: string; readonly label: string }[];
  readonly selected: string;
  readonly onSelect: (value: string) => void;
  readonly testID: string;
}) {
  const theme = useModuleTheme();
  const { dp } = useModuleMetrics();
  return (
    <View style={{ rowGap: dp(6) }} testID={testID}>
      <ModuleText token="caption" color={moduleNeutrals.textSecondary}>
        {label}
      </ModuleText>
      <View style={[styles.choices, { gap: dp(6) }]}>
        {choices.map((choice) => {
          const active = selected === choice.key;
          return (
            <Pressable
              key={choice.key}
              onPress={() => onSelect(choice.key)}
              accessibilityRole="radio"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`${label}: ${choice.label}`}
              style={[
                styles.choice,
                {
                  minHeight: minimumTouchTargetSize(),
                  borderRadius: dp(12),
                  borderColor: active ? theme.ink : moduleNeutrals.border,
                  backgroundColor: active ? theme.lightSurface : moduleNeutrals.surface,
                  paddingHorizontal: dp(10),
                },
              ]}
              testID={`${testID}-${choice.key}`}
            >
              <ModuleText token="button" color={active ? theme.ink : moduleNeutrals.textSecondary}>
                {choice.label}
              </ModuleText>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  input: {
    backgroundColor: moduleNeutrals.surface,
    borderWidth: 1,
  },
  notes: {
    textAlignVertical: 'top',
  },
  choices: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  choice: {
    alignItems: 'center',
    borderWidth: 1,
    flexGrow: 1,
    justifyContent: 'center',
    minWidth: 88,
  },
});
