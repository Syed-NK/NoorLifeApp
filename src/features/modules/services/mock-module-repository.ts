import type { ModuleActivityItem } from '../components/module-activity-card';
import type { ModuleSummaryMetric } from '../components/module-summary-card';
import type { FrameworkModuleId } from '../module-tokens';
import type {
  ModuleDataResult,
  ModuleOverview,
  ModuleRepository,
  ModuleRepositoryProvider,
} from './module-data.contract';

/**
 * In-memory module repositories.
 *
 * ── What this is and is not ────────────────────────────────────────────────
 * It is the framework's data source until each module's schema has been reviewed and
 * approved, which the phase brief requires before any production table exists. It is
 * *not* a fake that pretends a backend is present: nothing here writes, syncs, or
 * claims to have come from a server, and `generatedAt` is null because no sync has
 * happened.
 *
 * The fixtures are realistic enough to prove the layout — a summary card with a real
 * trend sentence, activity rows in every status, an insight of a plausible length —
 * because a framework validated only against empty data hides exactly the defects
 * that matter: overflow, truncation and misalignment.
 *
 * `scenario` is what makes the Module Gallery possible. The same seven modules can be
 * rendered as populated, empty, offline or failed without a network, so all four
 * outcomes are reviewable on a device.
 */

/** Which outcome a mock repository should produce. */
export type MockScenario = 'populated' | 'empty' | 'offline' | 'error';

/** Time the mock takes to resolve, so loading states are observable. */
const MOCK_LATENCY_MS = 350;

type Fixture = {
  readonly metrics: readonly ModuleSummaryMetric[];
  readonly activity: readonly ModuleActivityItem[];
  readonly insight: string;
};

const FIXTURES: Readonly<Record<FrameworkModuleId, Fixture>> = {
  faith: {
    metrics: [
      { key: 'prayers', label: 'Prayers', value: '4', unit: 'of 5', icon: 'worship' },
      {
        key: 'quran',
        label: 'Qur’an',
        value: '12',
        unit: 'pages',
        icon: 'quran',
        trend: 'up',
        trendLabel: '3 more than last week',
      },
    ],
    activity: [
      { key: 'fajr', title: 'Fajr', meta: '5:12 am', icon: 'worship', status: 'done' },
      { key: 'dhuhr', title: 'Dhuhr', meta: '1:04 pm', icon: 'worship', status: 'done' },
      { key: 'asr', title: 'Asr', meta: '4:12 pm', icon: 'worship', status: 'due' },
      { key: 'maghrib', title: 'Maghrib', meta: '7:38 pm', icon: 'worship', status: 'upcoming' },
    ],
    insight: 'You have kept every Fajr this week. Asr is the one you most often miss — a reminder 20 minutes earlier might help.',
  },
  health: {
    metrics: [
      { key: 'steps', label: 'Steps', value: '6,240', unit: 'today', icon: 'steps' },
      {
        key: 'sleep',
        label: 'Sleep',
        value: '6h 20m',
        icon: 'sleep',
        trend: 'down',
        trendLabel: '40 minutes less than your average',
      },
    ],
    activity: [
      { key: 'walk', title: 'Morning walk', meta: '25 minutes', icon: 'steps', status: 'done' },
      { key: 'water', title: 'Water', meta: '5 of 8 glasses', icon: 'water', status: 'due' },
      { key: 'stretch', title: 'Evening stretch', meta: '8:30 pm', icon: 'wellness', status: 'upcoming' },
      { key: 'weigh-in', title: 'Weekly weigh-in', meta: 'Yesterday', icon: 'records', status: 'missed' },
    ],
    insight: 'Your sleep is shorter on the nights you log an evening walk after 9 pm. Worth trying it earlier for a week.',
  },
  planner: {
    metrics: [
      { key: 'tasks', label: 'Tasks left', value: '3', unit: 'today', icon: 'tasks' },
      {
        key: 'done',
        label: 'Completed',
        value: '11',
        unit: 'this week',
        icon: 'check-circle',
        trend: 'up',
        trendLabel: '2 more than last week',
      },
    ],
    activity: [
      { key: 'standup', title: 'Team stand-up', meta: '9:30 am', icon: 'work', status: 'done' },
      { key: 'report', title: 'Send the report', meta: 'Due 4:00 pm', icon: 'document', status: 'due' },
      { key: 'school', title: 'School pick-up', meta: '3:15 pm', icon: 'school-bag', status: 'upcoming' },
      { key: 'invoice', title: 'File the invoice', meta: 'Yesterday', icon: 'tasks', status: 'missed' },
    ],
    insight: 'Your afternoons carry twice as many tasks as your mornings. Moving one to before 11 am tends to be what clears the day.',
  },
  finance: {
    metrics: [
      { key: 'spent', label: 'Spent', value: '£412', unit: 'this month', icon: 'money' },
      {
        key: 'budget',
        label: 'Budget used',
        value: '68%',
        icon: 'budgets',
        trend: 'down',
        trendLabel: '9% more than the same point last month',
      },
    ],
    activity: [
      { key: 'groceries', title: 'Groceries', meta: 'Today · £38.40', icon: 'meal', status: 'done' },
      { key: 'transport', title: 'Transport', meta: 'Yesterday · £6.20', icon: 'transactions', status: 'done' },
      { key: 'subscription', title: 'Subscription renews', meta: 'In 3 days · £9.99', icon: 'clock', status: 'upcoming' },
      { key: 'savings', title: 'Savings transfer', meta: 'Missed on the 1st', icon: 'target', status: 'missed' },
    ],
    insight: 'Groceries are your largest category and rose 14% this month. This is a description of your own spending, not advice.',
  },
  learning: {
    metrics: [
      { key: 'lessons', label: 'In progress', value: '2', unit: 'lessons', icon: 'learn' },
      {
        key: 'streak',
        label: 'Study streak',
        value: '6',
        unit: 'days',
        icon: 'progress',
        trend: 'up',
        trendLabel: 'Your longest so far',
      },
    ],
    activity: [
      { key: 'tajweed', title: 'Tajweed basics', meta: 'Lesson 4 of 9', icon: 'learn', status: 'due' },
      { key: 'article', title: 'Saved: focus habits', meta: '8 min read', icon: 'bookmark', status: 'upcoming' },
      { key: 'arabic', title: 'Arabic vocabulary', meta: 'Completed today', icon: 'school-bag', status: 'done' },
    ],
    insight: 'You finish lessons you start before noon and abandon the ones you start after 9 pm. Your mornings are working.',
  },
  family: {
    metrics: [
      { key: 'events', label: 'This week', value: '2', unit: 'events', icon: 'calendar' },
      { key: 'members', label: 'Members', value: '4', icon: 'family' },
    ],
    activity: [
      { key: 'dinner', title: 'Family dinner', meta: 'Friday, 7:00 pm', icon: 'meal', status: 'upcoming' },
      { key: 'trip', title: 'Weekend trip', meta: 'Saturday', icon: 'today', status: 'upcoming' },
      { key: 'photos', title: 'Eid photos added', meta: 'By Fatima · yesterday', icon: 'memories', status: 'done' },
    ],
    insight: 'Two plans this week have no one assigned to them yet. Naming someone is usually what makes them happen.',
  },
  goals: {
    metrics: [
      { key: 'active', label: 'Active goals', value: '3', icon: 'target' },
      {
        key: 'streak',
        label: 'Best streak',
        value: '4',
        unit: 'days',
        icon: 'habits',
        trend: 'up',
        trendLabel: 'Up from 2 last week',
      },
    ],
    activity: [
      { key: 'read', title: 'Read 10 pages', meta: 'Today', icon: 'habits', status: 'done' },
      { key: 'walk', title: 'Walk 8,000 steps', meta: 'Today', icon: 'steps', status: 'due' },
      { key: 'arabic', title: 'Practise Arabic', meta: 'Today', icon: 'learn', status: 'upcoming' },
      { key: 'sleep', title: 'Sleep by 11 pm', meta: 'Yesterday', icon: 'sleep', status: 'missed' },
    ],
    insight: 'Two of your three goals depend on the evening. Spreading them across the day is usually what protects a streak.',
  },
};

function delay<T>(value: T): Promise<T> {
  return new Promise((resolve) => {
    setTimeout(() => resolve(value), MOCK_LATENCY_MS);
  });
}

/** Builds a mock repository for one module in a chosen scenario. */
export function createMockModuleRepository(
  moduleId: FrameworkModuleId,
  scenario: MockScenario = 'populated',
): ModuleRepository {
  return {
    moduleId,
    async getOverview(): Promise<ModuleDataResult<ModuleOverview>> {
      switch (scenario) {
        case 'empty':
          return delay({ kind: 'empty' as const });
        case 'offline':
          return delay({ kind: 'offline' as const });
        case 'error':
          return delay({
            kind: 'error' as const,
            code: 'unavailable' as const,
            detail: 'mock scenario: error',
          });
        case 'populated': {
          const fixture = FIXTURES[moduleId];
          const overview: ModuleOverview = {
            moduleId,
            metrics: fixture.metrics,
            activity: fixture.activity,
            insight: fixture.insight,
            // Null on purpose: nothing has synced, and claiming a timestamp would be
            // the kind of invented success this project has ruled out.
            generatedAt: null,
          };
          return delay({ kind: 'ok' as const, data: overview });
        }
      }
    },
  };
}

/**
 * The provider the framework uses today.
 *
 * Replacing this one function with a Supabase-backed provider is the whole of the
 * integration work — no screen imports a repository directly.
 */
export const mockModuleRepositoryProvider: ModuleRepositoryProvider = (moduleId) =>
  createMockModuleRepository(moduleId, 'populated');
