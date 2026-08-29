import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import { AppIcon, PressableScale } from '@ds/components';
import { ModuleEmptyState, ModuleText } from '@features/modules/components';
import { ModuleCard } from '@features/modules/components/module-card';
import { ModuleProgressBar } from '@features/modules/components/module-chart';
import { useModuleTheme } from '@features/modules/module-context';
import { moduleLayout, moduleNeutrals } from '@features/modules/module-tokens';
import { useModuleMetrics } from '@features/modules/use-module-metrics';
import { minimumHitSlop, minimumTouchTargetSize } from '@shared/utils/a11y';

import { FaithRow, FaithRowGroup } from '../components/faith-list';
import { FaithScreen, FaithSuccessBanner } from '../components/faith-screen';
import { hasData } from '../data/faith-result';
import type { SurahSummary } from '../data/quran-content.repository';
import { useFaithRepositories } from '../di/faith-repository-context';
import { faithNavKeys, readerHref } from '../faith-routes';
import { useContinueReading } from '../hooks/use-continue-reading';
import { useFaithResource } from '../hooks/use-faith-resource';
import { todayIsoDate, useReadingLog } from '../hooks/use-reading-log';
import {
  daysMetGoal,
  MAX_DAILY_GOAL,
  MIN_DAILY_GOAL,
  readOn,
  recentDays,
  surahProgress,
  totalAyatRead,
} from '../storage/faith-reading-log';

/**
 * Reading progress — real, local, and only ever as much as the device actually recorded.
 *
 * ── What is deliberately absent ─────────────────────────────────────────────
 * **Minutes read.** Nothing here can tell whether the phone was face-down in a pocket, so a duration
 * would be a guess presented as a measurement.
 *
 * **A streak.** It is offered by every app in this category and it is the easiest number to
 * fabricate. One is derivable from `days` once there is a week of real data in it, and this screen
 * will show one then — but a streak computed from three days of history, two of which are zero
 * because the feature only just shipped, tells the user something false about themselves.
 *
 * **Interpolated days.** A day with no record draws an empty bar. There is no carry-forward and no
 * average filling a gap.
 *
 * See `faith-reading-log.ts` for the precise definition of when an ayah counts as read, and why the
 * two more obvious rules were rejected.
 */
export function ProgressScreen() {
  return (
    <FaithScreen title="Reading progress" activeKey={faithNavKeys.quran} testID="faith-progress">
      <ProgressBody />
    </FaithScreen>
  );
}

/** Split out so it renders inside the scaffold's `ModuleProvider`. */
function ProgressBody() {
  const router = useRouter();
  const { dp } = useModuleMetrics();
  const { quran } = useFaithRepositories();
  const { log, ready, setGoal, reset } = useReadingLog();
  const { clear: clearPosition } = useContinueReading();
  const [notice, setNotice] = useState<string | null>(null);

  const today = todayIsoDate();
  const readToday = readOn(log, today);
  const week = recentDays(log, today);

  /**
   * The catalogue, for surah names and lengths.
   *
   * The log stores numbers; naming a surah and turning a furthest verse into a percentage both need
   * the catalogue. A failure here degrades the per-surah section to numbers rather than failing the
   * screen — the goal, the week and the totals are all the user's own data and need no network.
   */
  const catalogue = useFaithResource(
    'faith.progress.catalogue',
    useCallback(() => quran.listSurahs(), [quran]),
  );

  const surahs: readonly SurahSummary[] =
    catalogue.status === 'settled' && hasData(catalogue.result) ? catalogue.result.data : [];
  const ayahCounts = Object.fromEntries(surahs.map((item) => [item.number, item.ayahCount]));
  const nameFor = (surah: number): string =>
    surahs.find((item) => item.number === surah)?.name ?? `Surah ${surah}`;

  const perSurah = surahProgress(log, ayahCounts);
  const total = totalAyatRead(log);

  const confirmReset = useCallback(() => {
    Alert.alert(
      'Reset your reading data?',
      'Your reading history, per-surah progress and saved place will be erased from this device. Your bookmarks are kept.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              await reset();
              // The saved place is part of the same record, and leaving it behind would resume a
              // user into a surah the progress screen says they have never read.
              await clearPosition();
              setNotice('Your reading data has been erased from this device.');
            })();
          },
        },
      ],
    );
  }, [reset, clearPosition]);

  if (ready && total === 0) {
    return (
      <ModuleEmptyState
        title="Nothing recorded yet"
        body="Open a surah and tap “Save my place here” as you read. NoorLife records how far you reached, on this device only."
        actionLabel="Open the Qur’an"
        onAction={() => router.push(readerHref(1))}
        testID="faith-progress-empty"
      />
    );
  }

  return (
    <View style={{ rowGap: dp(moduleLayout.sectionGap) }}>
      {notice === null ? null : (
        <FaithSuccessBanner
          message={notice}
          onDismiss={() => setNotice(null)}
          testID="faith-progress"
        />
      )}

      <GoalCard
        goal={log.dailyGoal}
        readToday={readToday}
        onChange={(next) => void setGoal(next)}
      />

      <WeekCard week={week} goal={log.dailyGoal} />

      <ModuleCard testID="faith-progress-total">
        <ModuleText token="cardTitle" numberOfLines={1} accessibilityRole="header">
          Altogether
        </ModuleText>
        <ModuleText token="body" numberOfLines={2}>
          {`${total} ${total === 1 ? 'verse' : 'verses'} reached across ${perSurah.length} ${perSurah.length === 1 ? 'surah' : 'surahs'}.`}
        </ModuleText>
        <ModuleText token="caption" numberOfLines={2}>
          {`${daysMetGoal(log, today)} of the last 7 days met your goal.`}
        </ModuleText>
      </ModuleCard>

      {perSurah.length === 0 ? null : (
        <FaithRowGroup title="By surah" testID="faith-progress-surahs">
          {perSurah.map((entry) => (
            <FaithRow
              key={entry.surah}
              title={nameFor(entry.surah)}
              subtitle={
                entry.fraction === null
                  ? `Reached verse ${entry.furthest}`
                  : `${entry.furthest} of ${ayahCounts[entry.surah]} verses • ${Math.round(entry.fraction * 100)}%`
              }
              onPress={() => router.push(readerHref(entry.surah, entry.furthest))}
              accessibilityLabel={
                entry.fraction === null
                  ? `${nameFor(entry.surah)}, reached verse ${entry.furthest}. Opens the reader there.`
                  : `${nameFor(entry.surah)}, ${entry.furthest} of ${ayahCounts[entry.surah]} verses, ${Math.round(entry.fraction * 100)} percent. Opens the reader there.`
              }
              testID={`faith-progress-surah-${entry.surah}`}
            />
          ))}
        </FaithRowGroup>
      )}

      <PressableScale
        onPress={confirmReset}
        accessibilityRole="button"
        accessibilityLabel="Reset your reading data"
        accessibilityHint="Erases your reading history and saved place from this device."
        style={[
          styles.reset,
          {
            minHeight: minimumTouchTargetSize(),
            borderRadius: dp(moduleLayout.radiusSmall),
            columnGap: dp(8),
          },
        ]}
        testID="faith-progress-reset"
      >
        <AppIcon name="close" size={dp(16)} color={moduleNeutrals.error} />
        <ModuleText token="cardAction" color={moduleNeutrals.error} numberOfLines={1}>
          Reset reading data
        </ModuleText>
      </PressableScale>
    </View>
  );
}

/**
 * Today against the goal, and the controls that change it.
 *
 * ── Stepper rather than a text field ────────────────────────────────────────
 * A goal is a small integer the user nudges, and a numeric keyboard for it is three taps of overhead
 * plus a dismiss. The steps are ±5 because ±1 would take twenty presses to move from 10 to 30, and
 * both ends are clamped, announced, and disabled at the bounds rather than silently doing nothing.
 */
function GoalCard({
  goal,
  readToday,
  onChange,
}: {
  readonly goal: number;
  readonly readToday: number;
  readonly onChange: (goal: number) => void;
}) {
  const { dp } = useModuleMetrics();

  const met = readToday >= goal;

  return (
    <ModuleCard testID="faith-progress-goal">
      <View style={{ rowGap: dp(8) }}>
        <ModuleText token="cardTitle" numberOfLines={1} accessibilityRole="header">
          Today
        </ModuleText>

        <View
          accessible
          accessibilityLabel={`${readToday} of ${goal} verses read today.${met ? ' Goal met.' : ''}`}
          accessibilityLiveRegion="polite"
        >
          <ModuleText token="heroScore" numberOfLines={1} testID="faith-progress-today-count">
            {`${readToday} / ${goal}`}
          </ModuleText>
          <ModuleText token="caption" numberOfLines={1}>
            {met ? 'Verses read today — goal met' : 'Verses read today'}
          </ModuleText>
        </View>

        <ModuleProgressBar
          value={goal === 0 ? 0 : Math.min(1, readToday / goal)}
          accessibilityLabel={`${readToday} of ${goal} verses toward today's goal`}
          testID="faith-progress-today-bar"
        />

        <View style={[styles.stepper, { columnGap: dp(10), marginTop: dp(4) }]}>
          <ModuleText token="caption" numberOfLines={1} style={styles.flex}>
            Daily goal
          </ModuleText>
          <StepButton
            label="Lower the daily goal"
            glyph="close"
            disabled={goal <= MIN_DAILY_GOAL}
            onPress={() => onChange(goal - 5)}
            testID="faith-progress-goal-down"
          />
          <ModuleText token="cardTitle" numberOfLines={1} testID="faith-progress-goal-value">
            {String(goal)}
          </ModuleText>
          <StepButton
            label="Raise the daily goal"
            glyph="add"
            disabled={goal >= MAX_DAILY_GOAL}
            onPress={() => onChange(goal + 5)}
            testID="faith-progress-goal-up"
          />
        </View>
      </View>
    </ModuleCard>
  );
}

function StepButton({
  label,
  glyph,
  disabled,
  onPress,
  testID,
}: {
  readonly label: string;
  readonly glyph: 'add' | 'close';
  readonly disabled: boolean;
  readonly onPress: () => void;
  readonly testID: string;
}) {
  const theme = useModuleTheme();
  const { dp } = useModuleMetrics();
  const size = dp(32);

  return (
    <PressableScale
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      // The visible control is 32 dp so the row stays compact; hit-slop brings the effective
      // target to the 44 dp minimum.
      hitSlop={minimumHitSlop(size)}
      style={[
        styles.step,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          borderColor: disabled ? moduleNeutrals.border : theme.border,
          opacity: disabled ? 0.5 : 1,
        },
      ]}
      testID={testID}
    >
      <AppIcon
        name={glyph}
        size={dp(16)}
        color={disabled ? moduleNeutrals.textTertiary : theme.ink}
      />
    </PressableScale>
  );
}

/**
 * The last seven days.
 *
 * ── Every bar is a recorded day ─────────────────────────────────────────────
 * The height is the day's count against the tallest day in the window, so the shape compares the
 * user's own week rather than against a goal that would flatten every bar once it is exceeded. A day
 * with nothing recorded is drawn as the baseline stub — visible, so seven days are always seven
 * columns, and unmistakably empty.
 */
function WeekCard({
  week,
  goal,
}: {
  readonly week: readonly {
    readonly isoDate: string;
    readonly read: number;
    readonly metGoal: boolean;
  }[];
  readonly goal: number;
}) {
  const theme = useModuleTheme();
  const { dp } = useModuleMetrics();

  const peak = Math.max(...week.map((day) => day.read), 1);
  const height = dp(72);

  return (
    <ModuleCard testID="faith-progress-week">
      <View style={{ rowGap: dp(10) }}>
        <ModuleText token="cardTitle" numberOfLines={1} accessibilityRole="header">
          This week
        </ModuleText>

        <View style={[styles.week, { columnGap: dp(6), height }]}>
          {week.map((day) => {
            const weekday = new Date(`${day.isoDate}T00:00:00Z`).getUTCDay();
            return (
              <View key={day.isoDate} style={styles.dayColumn}>
                <View
                  accessible
                  accessibilityLabel={`${WEEKDAYS[weekday] ?? ''}, ${day.read} ${day.read === 1 ? 'verse' : 'verses'}${day.metGoal ? ', goal met' : ''}`}
                  style={[
                    styles.bar,
                    {
                      // A minimum of 2 dp so an empty day is a visible baseline rather than nothing.
                      height: Math.max(dp(2), (day.read / peak) * height),
                      backgroundColor: day.metGoal ? theme.ink : theme.lightSurface,
                      borderColor: theme.border,
                      borderRadius: dp(3),
                    },
                  ]}
                  testID={`faith-progress-day-${day.isoDate}`}
                />
              </View>
            );
          })}
        </View>

        <View style={[styles.week, { columnGap: dp(6) }]}>
          {week.map((day) => (
            <ModuleText
              key={day.isoDate}
              token="caption"
              align="center"
              numberOfLines={1}
              style={styles.dayColumn}
            >
              {WEEKDAYS[new Date(`${day.isoDate}T00:00:00Z`).getUTCDay()] ?? ''}
            </ModuleText>
          ))}
        </View>

        <ModuleText token="caption" numberOfLines={2}>
          {`Bars show verses reached each day, against your goal of ${goal}. Days you did not read are empty.`}
        </ModuleText>
      </View>
    </ModuleCard>
  );
}

const WEEKDAYS: readonly string[] = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

const styles = StyleSheet.create({
  flex: {
    flex: 1,
    minWidth: 0,
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  step: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    backgroundColor: moduleNeutrals.surface,
  },
  week: {
    flexDirection: 'row',
    alignItems: 'flex-end',
  },
  dayColumn: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  bar: {
    width: '100%',
    borderWidth: 1,
  },
  reset: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: moduleNeutrals.error,
  },
});
