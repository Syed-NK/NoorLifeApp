import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppTextInput } from '@ds/typography/app-text-input';
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

import { PlannerRoutineList } from '../components/planner-routine-list';
import {
  MAX_ROUTINE_NOTE_LENGTH,
  MAX_ROUTINE_TITLE_LENGTH,
  routineWeekdayName,
  routineWeekdays,
  routinesScheduledOn,
  sortPlannerRoutines,
  type PlannerRoutine,
  type PlannerRoutineDraft,
  type PlannerRoutineFault,
  type RoutineSchedule,
  type RoutineWeekday,
} from '../data/planner-routine';
import { usePlannerDay } from '../di/planner-day-source';
import { usePlannerRoutines } from '../di/planner-routine-provider';
import { minimumTouchTargetSize } from '@shared/utils/a11y';

/**
 * **Planner → Routines.** The parts of the day the user chose to repeat, and today's tick boxes.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── What replaced what ─────────────────────────────────────────────────────
 * This route was a `ModuleSectionScreen` placeholder whose hero promised a routine would *"lay itself
 * out every day without asking"*. Nothing laid anything out; there was no store. The screen now reads
 * the user's own routines and says plainly when there are none.
 *
 * ── What this screen will not do ───────────────────────────────────────────
 * No starter routines, no suggestions, no streaks, no percentages, no encouragement. A habit surface
 * is where an app is most tempted to start scoring somebody's life, and this one records today and
 * aggregates nothing.
 *
 * ── The provider split is not stylistic ────────────────────────────────────
 * `useModuleTheme` reads context that `ModuleScaffold` creates, so it cannot be called in the same
 * function that renders the scaffold — the hook runs while the provider is still part of the value
 * being returned, and throws. That exact mistake shipped on the Tasks route and crashed the app on
 * every mount. The body lives in its own component for that reason.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const FAULT_COPY: Readonly<Record<PlannerRoutineFault, string>> = {
  'empty-title': 'Give the routine a name.',
  'title-too-long': `Keep the name to ${MAX_ROUTINE_TITLE_LENGTH} characters.`,
  'note-too-long': `Keep notes to ${MAX_ROUTINE_NOTE_LENGTH} characters.`,
  'no-weekdays': 'Choose at least one day.',
  'invalid-weekday': 'That day is not valid.',
  'duplicate-weekday': 'That day is already chosen.',
  'invalid-time': 'Use a 24-hour time such as 07:30.',
  'too-many-routines': 'You have reached the routine limit. Delete one to add another.',
};

export function PlannerRoutinesScreen() {
  return (
    <ModuleScaffold
      moduleId="planner"
      activeKey="routines"
      title="Routines"
      testID="planner-routines"
    >
      <PlannerRoutinesBody />
    </ModuleScaffold>
  );
}

/** Split out so it renders inside the scaffold's `ModuleProvider`. */
function PlannerRoutinesBody() {
  const routinesState = usePlannerRoutines();
  const theme = useModuleTheme();
  const { dp } = useModuleMetrics();

  /*
    Today comes from the shared day source, so a row cannot change which day it is ticking midway
    through a render pass, and the day it ticks is the same one the Planner home counts.
  */
  const { today } = usePlannerDay();

  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [daily, setDaily] = useState(true);
  const [days, setDays] = useState<readonly RoutineWeekday[]>([]);
  const [preferredTime, setPreferredTime] = useState('');
  const [priority, setPriority] = useState<'normal' | 'high'>('normal');
  const [editing, setEditing] = useState<PlannerRoutine | null>(null);
  const [pendingRemoval, setPendingRemoval] = useState<PlannerRoutine | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const scheduledToday = routinesScheduledOn(routinesState.routines, today);
  const completedToday = routinesState.completions.days[today] ?? [];
  const allRoutines = sortPlannerRoutines(routinesState.routines);

  function clearComposer(): void {
    setTitle('');
    setNote('');
    setDaily(true);
    setDays([]);
    setPreferredTime('');
    setPriority('normal');
    setEditing(null);
  }

  function beginEdit(routine: PlannerRoutine): void {
    setEditing(routine);
    setTitle(routine.title);
    setNote(routine.note);
    setDaily(routine.schedule.kind === 'daily');
    setDays(routine.schedule.kind === 'weekdays' ? routine.schedule.days : []);
    setPreferredTime(routine.preferredTime ?? '');
    setPriority(routine.priority);
    setMessage(null);
  }

  function toggleDay(day: RoutineWeekday): void {
    setDays((current) =>
      current.includes(day) ? current.filter((value) => value !== day) : [...current, day],
    );
  }

  async function save(): Promise<void> {
    setSaving(true);
    setMessage(null);

    const schedule: RoutineSchedule = daily ? { kind: 'daily' } : { kind: 'weekdays', days };
    const draft: PlannerRoutineDraft = {
      title,
      note,
      schedule,
      preferredTime,
      priority,
      active: editing?.active ?? true,
    };

    const result =
      editing === null
        ? await routinesState.createRoutine(draft)
        : await routinesState.updateRoutine(editing.id, draft);
    setSaving(false);

    if (result.kind === 'saved') {
      setMessage(editing === null ? 'Routine saved' : 'Routine updated');
      clearComposer();
      return;
    }
    if (result.kind === 'invalid') {
      setMessage(FAULT_COPY[result.fault]);
      return;
    }
    setMessage('The routine could not be saved. Nothing was changed.');
  }

  return (
    <View style={{ rowGap: dp(moduleLayout.sectionGap) }}>
      <ModuleCard tinted accentBorder testID="planner-routine-composer">
        <View style={{ rowGap: dp(10) }}>
          <ModuleText token="cardTitle" accessibilityRole="header">
            {editing === null ? 'Add a routine' : 'Edit routine'}
          </ModuleText>

          <AppTextInput
            value={title}
            onChangeText={setTitle}
            placeholder="What do you repeat?"
            placeholderTextColor={moduleNeutrals.textTertiary}
            maxLength={MAX_ROUTINE_TITLE_LENGTH}
            accessibilityLabel="Routine name"
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
            testID="planner-routine-title"
          />

          <AppTextInput
            value={note}
            onChangeText={setNote}
            placeholder="Notes (optional)"
            placeholderTextColor={moduleNeutrals.textTertiary}
            maxLength={MAX_ROUTINE_NOTE_LENGTH}
            multiline
            accessibilityLabel="Routine notes"
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
            testID="planner-routine-note"
          />

          <ChoiceRow
            label="Repeats"
            choices={[
              { key: 'daily', label: 'Every day' },
              { key: 'weekdays', label: 'Chosen days' },
            ]}
            selected={daily ? 'daily' : 'weekdays'}
            onSelect={(value) => setDaily(value === 'daily')}
            testID="planner-routine-repeat"
          />

          {daily ? null : (
            <View style={{ rowGap: dp(6) }} testID="planner-routine-weekdays">
              <ModuleText token="caption" color={moduleNeutrals.textSecondary}>
                Days
              </ModuleText>
              <View style={[styles.choices, { gap: dp(6) }]}>
                {routineWeekdays.map((day) => {
                  const active = days.includes(day);
                  const name = routineWeekdayName(day);
                  return (
                    <Pressable
                      key={day}
                      onPress={() => toggleDay(day)}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: active }}
                      /* The full day name, because "Mon" read aloud is not a day. */
                      accessibilityLabel={name}
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
                      testID={`planner-routine-weekday-${day}`}
                    >
                      <ModuleText
                        token="button"
                        color={active ? theme.ink : moduleNeutrals.textSecondary}
                      >
                        {name.slice(0, 3)}
                      </ModuleText>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          )}

          <AppTextInput
            value={preferredTime}
            onChangeText={setPreferredTime}
            placeholder="Time (optional, 07:30)"
            placeholderTextColor={moduleNeutrals.textTertiary}
            keyboardType="numbers-and-punctuation"
            maxLength={5}
            accessibilityLabel="Preferred time"
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
            testID="planner-routine-time"
          />

          <ChoiceRow
            label="Priority"
            choices={[
              { key: 'normal', label: 'Normal' },
              { key: 'high', label: 'High' },
            ]}
            selected={priority}
            onSelect={(value) => setPriority(value === 'high' ? 'high' : 'normal')}
            testID="planner-routine-priority"
          />

          {message === null ? null : (
            <ModuleText
              token="caption"
              color={moduleNeutrals.textSecondary}
              testID="planner-routine-message"
            >
              {message}
            </ModuleText>
          )}

          <ModuleButton
            label={editing === null ? 'Save routine' : 'Save changes'}
            onPress={() => void save()}
            loading={saving}
            disabled={saving}
            testID="planner-routine-save"
          />
          {editing === null ? null : (
            <ModuleButton
              label="Cancel editing"
              variant="tertiary"
              onPress={clearComposer}
              testID="planner-routine-cancel"
            />
          )}
        </View>
      </ModuleCard>

      {routinesState.loading ? <ModuleLoadingState /> : null}
      {routinesState.fault === null ? null : (
        <ModuleErrorState onRetry={routinesState.reload} developerDetail={routinesState.fault} />
      )}

      {pendingRemoval === null ? null : (
        <ModuleCard accentBorder testID="planner-routine-removal-confirmation">
          <View style={{ rowGap: dp(10) }}>
            <ModuleText token="cardTitle" accessibilityRole="header">
              Delete this routine?
            </ModuleText>
            <ModuleText token="body" color={moduleNeutrals.textSecondary}>
              {pendingRemoval.title} and its completion record will be permanently removed. This
              cannot be undone.
            </ModuleText>
            <ModuleButton
              label="Delete routine"
              variant="secondary"
              onPress={() => {
                const routine = pendingRemoval;
                setPendingRemoval(null);
                void routinesState.removeRoutine(routine.id);
              }}
              testID="planner-routine-delete-confirm"
            />
            <ModuleButton
              label="Keep routine"
              variant="tertiary"
              onPress={() => setPendingRemoval(null)}
              testID="planner-routine-delete-cancel"
            />
          </View>
        </ModuleCard>
      )}

      {!routinesState.loading && routinesState.fault === null ? (
        <>
          <ModuleSection title={`Today (${scheduledToday.length})`} testID="planner-routine-today">
            <PlannerRoutineList
              routines={scheduledToday}
              completedIds={completedToday}
              onToggle={(routine, completed) =>
                void routinesState.setCompleted(routine.id, today, completed)
              }
              emptyTitle="Nothing scheduled today"
              emptyBody="Routines you set for today appear here. NoorLife adds none of its own."
              testID="planner-routine-today-list"
            />
          </ModuleSection>

          <ModuleSection
            title={`All routines (${allRoutines.length})`}
            testID="planner-routine-all"
          >
            <PlannerRoutineList
              routines={allRoutines}
              onEdit={beginEdit}
              onToggleActive={(routine) =>
                void routinesState.setActive(routine.id, !routine.active)
              }
              onRemove={setPendingRemoval}
              emptyTitle="No routines yet"
              emptyBody="Only routines you create appear here. NoorLife will not add any for you."
              testID="planner-routine-all-list"
            />
          </ModuleSection>
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
