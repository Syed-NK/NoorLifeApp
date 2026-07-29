import { modulePalettes } from '@ds/tokens';
import type { MainHomeDashboard } from '@shared/models/dashboard';

/**
 * Typed local mock data for the Main Home proof screen.
 *
 * Every value matches the reference design at
 * design-reference/full-core-screens/01-main-noor-ai-faith.png, so the rendered
 * screen can be compared against the reference directly.
 *
 * Phase 1 uses local mock data only: no backend is connected, and each field is
 * annotated with the module that will own it once real services exist
 * (workflow §5).
 */
export const mockMainHomeDashboard: MainHomeDashboard = {
  hero: {
    eyebrow: 'Today with NoorLife',
    title: 'Your life, organized with NoorLife.',
    actionLabel: 'View My Day',
  },

  /**
   * Source: Planner (events, tasks) merged with Faith (prayer times).
   *
   * Rows, order, times and titles are locked by implementation-lock §9. Accents match
   * the four hues in 04-today-timeline-reference.png — green, blue, purple, amber —
   * each taken from an existing module palette.
   */
  timeline: [
    {
      id: 'dhuhr',
      time: '12:35 PM',
      title: 'Dhuhr Prayer',
      icon: 'mosque',
      sourceModule: 'faith',
      accent: modulePalettes.faith.primary,
    },
    {
      id: 'school-drop-off',
      time: '8:00 AM',
      title: 'School drop-off',
      icon: 'school-bag',
      sourceModule: 'planner',
      accent: modulePalettes.planner.primary,
    },
    {
      id: 'work-focus',
      time: '10:00 AM',
      title: 'Work focus time',
      icon: 'work',
      sourceModule: 'planner',
      accent: modulePalettes.learning.primary,
    },
    {
      id: 'family-dinner',
      time: '5:30 PM',
      title: 'Family dinner',
      icon: 'meal',
      sourceModule: 'family',
      accent: modulePalettes.finance.primary,
    },
  ],

  // Source: Family module.
  familyCheckIn: {
    completed: 4,
    total: 5,
    statusLabel: 'complete',
  },

  // Source: Goals module.
  overallProgress: {
    percentage: 68,
    statusLabel: "You're on track",
  },

  // Source: Noor AI. Scope is always shown alongside the message (§06).
  aiInsight: {
    id: 'free-window',
    message: 'You have a free 30-minute window at 4 PM.',
    scopeLabel: 'NoorLife only',
    accessedModules: ['planner'],
  },

  // Each action navigates to the owning module; Main Home never edits records.
  quickActions: [
    { key: 'add-task', label: 'Add Task', icon: 'add-circle', sourceModule: 'planner' },
    { key: 'log-wellness', label: 'Log Wellness', icon: 'leaf', sourceModule: 'health' },
    { key: 'family-check-in', label: 'Family Check-in', icon: 'family', sourceModule: 'family' },
  ],
};
