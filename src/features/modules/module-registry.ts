import { moduleThemes } from '@ds/modules/module-themes';
import { getModulePictogram } from '@features/home/module-pictograms';
import { noorLifeAssets } from '@shared/assets/noorlife-assets';

import { moduleAIPolicies } from './module-ai-policy';
import type { ModuleDefinition } from './module-definition';
import { FRAMEWORK_MODULE_IDS, moduleColorThemes, type FrameworkModuleId } from './module-tokens';

/**
 * The seven NoorLife module definitions.
 *
 * Read this file as the answer to "what is a module?". Nothing below is a screen;
 * it is the description a screen is generated from. Three things are deliberately
 * *not* re-typed here:
 *
 *   • navigation — taken from the Phase 1 `moduleThemes`, which validates the
 *     five-item / AI-third invariant at import time.
 *   • pictograms — resolved through the locked `getModulePictogram`, which throws
 *     rather than substituting an icon for a missing asset.
 *   • colour — taken from `moduleColorThemes`, whose contrast is asserted by test.
 *
 * ── Which PNG set is canonical, and why ─────────────────────────────────────
 * `getModulePictogram` is the registry Main Home's grid itself renders from, so
 * routing every module surface through it is what makes "the hero shows the same
 * pictogram as the tile" true by construction rather than by inspection.
 *
 * It resolves `assets/images/pictograms/normalized/*.png`. The project also holds
 * the pre-normalization originals one directory up, and those two sets are not
 * interchangeable: measured, the originals occupy 85.9% of their canvas with an
 * 18 px margin, the normalized set 71.1% with a 37 px margin. Both are internally
 * uniform — every one of the eight sits at exactly the same occupancy, so no
 * per-module optical correction is needed in either set.
 *
 * The normalized set is the one Main Home ships and is therefore the canonical one
 * here. Its extra transparent padding is compensated for once, in the hero card's
 * `heroArtSize`, rather than by per-module scale tweaks.
 *
 * The Entry/Auth onboarding medallions still read the originals through
 * `noorLifeAssets.modules`. That is a real inconsistency, but changing it would
 * alter an approved Entry/Auth layout, which this pass is explicitly scoped out of
 * — it is recorded in docs/PRE_RELEASE_BACKLOG.md instead.
 */

/**
 * One canonical asset resolution per module.
 *
 * Both `pictogram` and `heroPictogram` read from this, so the two fields cannot
 * disagree even by accident — there is nowhere to type a second asset.
 */
const ASSET = {
  'noor-ai': getModulePictogram('noor-ai'),
  faith: getModulePictogram('faith'),
  health: getModulePictogram('health'),
  planner: getModulePictogram('planner'),
  finance: getModulePictogram('finance'),
  learning: getModulePictogram('learning'),
  family: getModulePictogram('family'),
  goals: getModulePictogram('goals'),
} as const;

/*
 * ── On the content in this file ─────────────────────────────────────────────
 * Hero copy, quick actions and capability tiles are real framework content, not
 * lorem ipsum: the phase brief requires complete hero cards with no blank upper
 * area, and a tile grid that demonstrates the module reads correctly. What is *not*
 * here is module functionality — every capability that has no screen behind it yet
 * is marked `available: false` with a reason, so the UI is honest about it rather
 * than presenting a tile that silently does nothing.
 */

/**
 * Noor AI.
 *
 * A core module with its own approved reference (`02-noor-ai.png`), not the "arrives in
 * Phase 2" placeholder it was left as. Its AI scope is the one that differs from every
 * other module: Noor AI may reach across modules the user has granted, where a module AI
 * may not — which is why its policy comes from `noorlife` scope rather than `module`.
 */
const noorAI: ModuleDefinition = {
  id: 'noor-ai',
  name: 'Noor AI',
  summary: 'Help with NoorLife itself — features, progress and planning.',
  theme: moduleColorThemes['noor-ai'],
  pictogram: ASSET['noor-ai'],
  heroPictogram: ASSET['noor-ai'],
  // Its reference is one of only two that caption the centre control.
  showAICaption: true,
  heroArtwork: noorLifeAssets.moduleHeroes.noorAI,
  heroScrim: 0,
  // The one hero whose robot sits left and copy sits right.
  heroCopySide: 'right',
  routes: { home: '/ai', ai: '/ai', help: '/settings/help' },
  navigation: moduleThemes['noor-ai'].navigation,
  hero: {
    eyebrow: '',
    headline: 'How can I help\nwith NoorLife?',
    support: 'NoorLife questions only',
    actionLabel: '',
    artworkAccessibilityLabel: '',
  },
  quickActions: [
    { key: 'find-feature', label: 'Find a feature', icon: 'search' },
    { key: 'explain-progress', label: 'Explain my progress', icon: 'insights' },
    { key: 'help-plan', label: 'Help me plan', icon: 'calendar' },
  ],
  capabilities: [
    { key: 'find-feature', label: 'Find a feature', icon: 'search', href: '/ai', available: true },
    {
      key: 'explain-progress',
      label: 'Explain my progress',
      icon: 'insights',
      href: '/insights',
      available: true,
    },
    {
      key: 'help-plan',
      label: 'Help me plan',
      icon: 'calendar',
      href: '/planner',
      available: true,
    },
    {
      key: 'app-settings',
      label: 'App settings',
      icon: 'settings',
      href: '/settings',
      available: true,
    },
  ],
  permissions: [
    {
      key: 'notifications',
      title: 'Noor AI suggestions',
      rationale: 'So Noor AI can offer a suggestion at a moment it is actually useful.',
      required: false,
    },
    {
      key: 'microphone',
      title: 'Voice input',
      rationale: 'Only used while you hold the microphone to dictate a question.',
      required: false,
    },
  ],
  ai: moduleAIPolicies['noor-ai'],
  stateCopy: {
    empty: {
      title: 'Nothing asked yet',
      body: 'Ask about a feature, your progress, or how to plan your week.',
      action: 'See suggestions',
    },
    error: {
      title: 'Couldn’t reach Noor AI',
      body: 'A request failed on our side. Your conversations are safe.',
      action: 'Try again',
    },
    offline: {
      title: 'You’re offline',
      body: 'Saved conversations are still readable. New questions need a connection.',
    },
    loading: 'Loading Noor AI',
  },
};

const faith: ModuleDefinition = {
  id: 'faith',
  name: 'Faith',
  summary: 'Prayer times, Qur’an reading and your daily worship.',
  theme: moduleColorThemes.faith,
  pictogram: ASSET.faith,
  heroPictogram: ASSET.faith,
  // Faith's approved reference captions its centre control; the others do not.
  showAICaption: true,
  heroArtwork: noorLifeAssets.moduleHeroes.faith,
  heroScrim: 0,
  heroCopySide: 'left',
  routes: { home: '/faith', ai: '/faith/ai', help: '/settings/help' },
  navigation: moduleThemes.faith.navigation,
  hero: {
    eyebrow: 'Next Prayer',
    headline: 'Dhuhr 12:35 PM',
    support: 'May 19, 2025',
    supportSecondary: '21 Dhul-Qa‘dah 1446 AH',
    actionLabel: 'View Prayer Times',
    artworkAccessibilityLabel: '',
  },
  quickActions: [
    { key: 'prayer-times', label: 'Prayer times', icon: 'worship', href: '/faith/prayer-times' },
    { key: 'read-quran', label: 'Read Qur’an', icon: 'quran', href: '/faith/quran' },
    { key: 'ask-faith-ai', label: 'Ask Faith AI', icon: 'robot', href: '/faith/ai' },
  ],
  capabilities: [
    {
      key: 'prayer-times',
      label: 'Prayer',
      icon: 'worship',
      href: '/faith/prayer-times',
      available: true,
    },
    { key: 'quran', label: 'Qur’an', icon: 'quran', href: '/faith/quran', available: true },
    { key: 'today', label: 'Today', icon: 'today', href: '/faith', available: true },
    { key: 'more', label: 'More', icon: 'more', href: '/faith/more', available: true },
    {
      key: 'qibla',
      label: 'Qibla',
      icon: 'mosque',
      available: false,
      unavailableReason: 'Qibla direction needs location access and arrives in a later release.',
    },
    {
      key: 'dhikr',
      label: 'Dhikr',
      icon: 'leaf',
      available: false,
      unavailableReason: 'Dhikr counter arrives with the Faith module’s full release.',
    },
  ],
  permissions: [
    {
      key: 'notifications',
      title: 'Prayer reminders',
      rationale: 'So NoorLife can notify you shortly before each prayer time.',
      required: false,
    },
    {
      key: 'location',
      title: 'Accurate prayer times',
      rationale: 'Prayer times depend on where you are. Without it, you can set a city manually.',
      required: false,
    },
  ],
  ai: moduleAIPolicies.faith,
  stateCopy: {
    empty: {
      title: 'Nothing recorded yet',
      body: 'Once you start tracking your prayers, your day will appear here.',
      action: 'Set up prayer times',
    },
    error: {
      title: 'Couldn’t load your Faith data',
      body: 'The connection dropped on our side. Your recorded prayers are safe.',
      action: 'Try again',
    },
    offline: {
      title: 'You’re offline',
      body: 'Prayer times and your saved Qur’an progress still work. New activity syncs later.',
    },
    loading: 'Loading your Faith module',
  },
};

const health: ModuleDefinition = {
  id: 'health',
  name: 'Health',
  summary: 'Track activity, sleep and habits, and see what changes.',
  theme: moduleColorThemes.health,
  pictogram: ASSET.health,
  heroPictogram: ASSET.health,
  // Faith's approved reference captions its centre control; the others do not.
  showAICaption: false,
  heroArtwork: noorLifeAssets.moduleHeroes.health,
  heroScrim: 0.45,
  heroCopySide: 'left',
  routes: { home: '/health', ai: '/health/ai', help: '/settings/help' },
  navigation: moduleThemes.health.navigation,
  hero: {
    eyebrow: 'Today’s Wellness',
    headline: '86',
    support: 'Wellness Score',
    supportSecondary: 'You’re building a balanced day.',
    actionLabel: 'View Insights',
    artworkAccessibilityLabel: '',
  },
  quickActions: [
    { key: 'log', label: 'Log entry', icon: 'add-circle', href: '/health/log' },
    { key: 'trends', label: 'Trends', icon: 'trends', href: '/health/trends' },
    { key: 'ask-health-ai', label: 'Ask Health AI', icon: 'robot', href: '/health/ai' },
  ],
  capabilities: [
    { key: 'track', label: 'Track', icon: 'track', href: '/health/log', available: true },
    { key: 'trends', label: 'Trends', icon: 'trends', href: '/health/trends', available: true },
    { key: 'records', label: 'Records', icon: 'records', href: '/health/records', available: true },
    { key: 'overview', label: 'Overview', icon: 'home', href: '/health', available: true },
    {
      key: 'sleep',
      label: 'Sleep',
      icon: 'sleep',
      available: false,
      unavailableReason:
        'Automatic sleep tracking needs health data access, coming in a later release.',
    },
    {
      key: 'water',
      label: 'Water',
      icon: 'water',
      available: false,
      unavailableReason: 'Hydration tracking arrives with the Health module’s full release.',
    },
  ],
  permissions: [
    {
      key: 'health-data',
      title: 'Activity and sleep data',
      rationale:
        'To read steps and sleep from your phone’s health store so you don’t type them in. NoorLife never writes to it.',
      required: false,
    },
    {
      key: 'notifications',
      title: 'Habit reminders',
      rationale: 'So NoorLife can remind you at the time you choose.',
      required: false,
    },
  ],
  ai: moduleAIPolicies.health,
  stateCopy: {
    empty: {
      title: 'No entries yet',
      body: 'Log one thing today — a walk, a glass of water — and your trend starts here.',
      action: 'Log your first entry',
    },
    error: {
      title: 'Couldn’t load your Health data',
      body: 'Something failed on our side. Nothing you logged has been lost.',
      action: 'Try again',
    },
    offline: {
      title: 'You’re offline',
      body: 'You can still log entries. They’ll sync when you reconnect.',
    },
    loading: 'Loading your Health module',
  },
};

const planner: ModuleDefinition = {
  id: 'planner',
  name: 'Planner',
  summary: 'Your day, your tasks and the routines that hold them together.',
  theme: moduleColorThemes.planner,
  pictogram: ASSET.planner,
  heroPictogram: ASSET.planner,
  // Faith's approved reference captions its centre control; the others do not.
  showAICaption: false,
  heroArtwork: noorLifeAssets.moduleHeroes.planner,
  heroScrim: 0,
  heroCopySide: 'left',
  routes: { home: '/planner', ai: '/planner/ai', help: '/settings/help' },
  navigation: moduleThemes.planner.navigation,
  hero: {
    eyebrow: 'Your Day',
    headline: '3 priorities',
    support: 'Next: School drop-off',
    supportSecondary: '8:00 AM',
    actionLabel: 'Optimize My Day',
    artworkAccessibilityLabel: '',
  },
  quickActions: [
    { key: 'add-task', label: 'Add task', icon: 'add-circle', href: '/planner/tasks' },
    { key: 'calendar', label: 'Calendar', icon: 'calendar', href: '/planner/calendar' },
    { key: 'ask-plan-ai', label: 'Ask Plan AI', icon: 'robot', href: '/planner/ai' },
  ],
  capabilities: [
    { key: 'today', label: 'Today', icon: 'today', href: '/planner', available: true },
    {
      key: 'calendar',
      label: 'Calendar',
      icon: 'calendar',
      href: '/planner/calendar',
      available: true,
    },
    { key: 'tasks', label: 'Tasks', icon: 'tasks', href: '/planner/tasks', available: true },
    {
      key: 'routines',
      label: 'Routines',
      icon: 'routines',
      href: '/planner/routines',
      available: true,
    },
    {
      key: 'focus',
      label: 'Focus',
      icon: 'clock',
      available: false,
      unavailableReason: 'Focus sessions arrive with the Planner module’s full release.',
    },
  ],
  permissions: [
    {
      key: 'calendar',
      title: 'Your device calendar',
      rationale:
        'To show your existing events beside NoorLife tasks. Read-only unless you add an event.',
      required: false,
    },
    {
      key: 'notifications',
      title: 'Task and event reminders',
      rationale: 'So a task can remind you at the time you set.',
      required: false,
    },
  ],
  ai: moduleAIPolicies.planner,
  stateCopy: {
    empty: {
      title: 'Your day is clear',
      body: 'Add a task or bring in your calendar and today will fill itself in.',
      action: 'Add your first task',
    },
    error: {
      title: 'Couldn’t load your Planner',
      body: 'A request failed on our side. Your tasks are still saved.',
      action: 'Try again',
    },
    offline: {
      title: 'You’re offline',
      body: 'Today’s plan is available and you can still add tasks. Changes sync later.',
    },
    loading: 'Loading your Planner module',
  },
};

const finance: ModuleDefinition = {
  id: 'finance',
  name: 'Finance',
  summary: 'Where your money goes, and whether you’re on budget.',
  theme: moduleColorThemes.finance,
  pictogram: ASSET.finance,
  heroPictogram: ASSET.finance,
  // Faith's approved reference captions its centre control; the others do not.
  showAICaption: false,
  heroArtwork: noorLifeAssets.moduleHeroes.finance,
  heroScrim: 0.2,
  heroCopySide: 'left',
  routes: { home: '/finance', ai: '/finance/ai', help: '/settings/help' },
  navigation: moduleThemes.finance.navigation,
  hero: {
    eyebrow: 'My Budget',
    headline: '$2,450',
    headlineSuffix: 'left',
    support: '62% spent',
    progress: 0.62,
    actionLabel: 'View Budget',
    artworkAccessibilityLabel: '',
  },
  quickActions: [
    { key: 'add-expense', label: 'Add expense', icon: 'add-circle', href: '/finance/transactions' },
    { key: 'budgets', label: 'Budgets', icon: 'budgets', href: '/finance/budgets' },
    { key: 'ask-money-ai', label: 'Ask Money AI', icon: 'robot', href: '/finance/ai' },
  ],
  capabilities: [
    { key: 'overview', label: 'Overview', icon: 'home', href: '/finance', available: true },
    {
      key: 'transactions',
      label: 'Spending',
      icon: 'transactions',
      href: '/finance/transactions',
      available: true,
    },
    {
      key: 'budgets',
      label: 'Budgets',
      icon: 'budgets',
      href: '/finance/budgets',
      available: true,
    },
    { key: 'goals', label: 'Savings', icon: 'target', href: '/finance/goals', available: true },
    {
      key: 'bank-sync',
      label: 'Bank sync',
      icon: 'money',
      available: false,
      unavailableReason:
        'Connecting a bank account needs a regulated provider and is not part of this release.',
    },
    {
      key: 'receipts',
      label: 'Receipts',
      icon: 'document',
      available: false,
      unavailableReason: 'Receipt capture arrives with the Finance module’s full release.',
    },
  ],
  permissions: [
    {
      key: 'notifications',
      title: 'Budget alerts',
      rationale: 'So NoorLife can tell you when a budget is close to its limit.',
      required: false,
    },
    {
      key: 'photos',
      title: 'Receipt photos',
      rationale: 'Only used when you attach a photo to a transaction yourself.',
      required: false,
    },
  ],
  ai: moduleAIPolicies.finance,
  stateCopy: {
    empty: {
      title: 'No transactions yet',
      body: 'Add what you spent today, or set a budget first and fill it in as you go.',
      action: 'Add a transaction',
    },
    error: {
      title: 'Couldn’t load your Finance data',
      body: 'A request failed on our side. Your transactions are unaffected.',
      action: 'Try again',
    },
    offline: {
      title: 'You’re offline',
      body: 'You can add transactions now and they’ll sync when you reconnect.',
    },
    loading: 'Loading your Finance module',
  },
};

const learning: ModuleDefinition = {
  id: 'learning',
  name: 'Learning',
  summary: 'Courses, saved material and what you’ve actually retained.',
  theme: moduleColorThemes.learning,
  pictogram: ASSET.learning,
  heroPictogram: ASSET.learning,
  // Faith's approved reference captions its centre control; the others do not.
  showAICaption: false,
  heroArtwork: noorLifeAssets.moduleHeroes.learning,
  heroScrim: 0,
  heroCopySide: 'left',
  routes: { home: '/learning', ai: '/learning/ai', help: '/settings/help' },
  navigation: moduleThemes.learning.navigation,
  hero: {
    eyebrow: 'Learning Streak',
    headline: '12 days',
    support: 'Keep it up! ★',
    actionLabel: 'Continue Learning',
    artworkAccessibilityLabel: '',
  },
  quickActions: [
    { key: 'continue', label: 'Continue', icon: 'play', href: '/learning' },
    { key: 'library', label: 'Library', icon: 'library', href: '/learning/library' },
    { key: 'ask-learn-ai', label: 'Ask Learn AI', icon: 'robot', href: '/learning/ai' },
  ],
  capabilities: [
    { key: 'learn', label: 'Learn', icon: 'learn', href: '/learning', available: true },
    {
      key: 'library',
      label: 'Library',
      icon: 'library',
      href: '/learning/library',
      available: true,
    },
    {
      key: 'progress',
      label: 'Progress',
      icon: 'progress',
      href: '/learning/progress',
      available: true,
    },
    { key: 'saved', label: 'Saved', icon: 'bookmark', href: '/learning/saved', available: true },
    {
      key: 'quiz',
      label: 'Quiz',
      icon: 'school-bag',
      available: false,
      unavailableReason: 'Quizzes arrive with the Learning module’s full release.',
    },
  ],
  permissions: [
    {
      key: 'notifications',
      title: 'Study reminders',
      rationale: 'So NoorLife can nudge you at the study time you pick.',
      required: false,
    },
  ],
  ai: moduleAIPolicies.learning,
  stateCopy: {
    empty: {
      title: 'Nothing started yet',
      body: 'Save an article or begin a lesson, and your progress will show up here.',
      action: 'Browse the library',
    },
    error: {
      title: 'Couldn’t load your Learning data',
      body: 'A request failed on our side. Your saved material is still there.',
      action: 'Try again',
    },
    offline: {
      title: 'You’re offline',
      body: 'Anything you downloaded is still readable. Progress syncs when you reconnect.',
    },
    loading: 'Loading your Learning module',
  },
};

const family: ModuleDefinition = {
  id: 'family',
  name: 'Family',
  summary: 'Shared plans, moments and the people they belong to.',
  theme: moduleColorThemes.family,
  pictogram: ASSET.family,
  heroPictogram: ASSET.family,
  // Faith's approved reference captions its centre control; the others do not.
  showAICaption: false,
  heroArtwork: noorLifeAssets.moduleHeroes.family,
  heroScrim: 0,
  heroCopySide: 'left',
  routes: { home: '/family', ai: '/family/ai', help: '/settings/help' },
  navigation: moduleThemes.family.navigation,
  hero: {
    eyebrow: 'Family Connection',
    headline: 'Strong ❤️',
    support: '+18 points from last week',
    actionLabel: 'Family Check-in',
    artworkAccessibilityLabel: '',
  },
  quickActions: [
    { key: 'add-event', label: 'Add event', icon: 'add-circle', href: '/family/calendar' },
    { key: 'memories', label: 'Memories', icon: 'memories', href: '/family/memories' },
    { key: 'ask-family-ai', label: 'Ask Family AI', icon: 'robot', href: '/family/ai' },
  ],
  capabilities: [
    { key: 'family', label: 'Family', icon: 'family', href: '/family', available: true },
    {
      key: 'calendar',
      label: 'Calendar',
      icon: 'calendar',
      href: '/family/calendar',
      available: true,
    },
    {
      key: 'memories',
      label: 'Memories',
      icon: 'memories',
      href: '/family/memories',
      available: true,
    },
    { key: 'safety', label: 'Safety', icon: 'safety', href: '/family/safety', available: true },
    {
      key: 'chores',
      label: 'Chores',
      icon: 'tasks',
      available: false,
      unavailableReason: 'Shared chores arrive with the Family module’s full release.',
    },
  ],
  permissions: [
    {
      key: 'notifications',
      title: 'Family updates',
      rationale: 'So you hear when someone adds or changes a shared plan.',
      required: false,
    },
    {
      key: 'photos',
      title: 'Shared memories',
      rationale: 'Only the photos you choose are added to a shared memory.',
      required: false,
    },
    {
      key: 'contacts',
      title: 'Inviting family',
      rationale: 'To find people you already know when inviting them. Nothing is uploaded.',
      required: false,
    },
  ],
  ai: moduleAIPolicies.family,
  stateCopy: {
    empty: {
      title: 'No one here yet',
      body: 'Invite a family member, and your shared calendar and memories start filling in.',
      action: 'Invite family',
    },
    error: {
      title: 'Couldn’t load your Family data',
      body: 'A request failed on our side. Nothing shared has been lost.',
      action: 'Try again',
    },
    offline: {
      title: 'You’re offline',
      body: 'You can see what’s already synced. New shared items need a connection.',
    },
    loading: 'Loading your Family module',
  },
};

const goals: ModuleDefinition = {
  id: 'goals',
  name: 'Goals',
  summary: 'Intentions broken into habits, and honest progress against them.',
  theme: moduleColorThemes.goals,
  pictogram: ASSET.goals,
  heroPictogram: ASSET.goals,
  // Faith's approved reference captions its centre control; the others do not.
  showAICaption: false,
  heroArtwork: noorLifeAssets.moduleHeroes.goals,
  heroScrim: 0.2,
  heroCopySide: 'left',
  routes: { home: '/goals', ai: '/goals/ai', help: '/settings/help' },
  navigation: moduleThemes.goals.navigation,
  hero: {
    eyebrow: 'Overall Progress',
    headline: '68%',
    support: 'You’re on track! 🎯',
    actionLabel: 'View Weekly Steps',
    artworkAccessibilityLabel: '',
  },
  quickActions: [
    { key: 'add-goal', label: 'Add goal', icon: 'add-circle', href: '/goals' },
    { key: 'habits', label: 'Habits', icon: 'habits', href: '/goals/habits' },
    { key: 'ask-goal-ai', label: 'Ask Goal AI', icon: 'robot', href: '/goals/ai' },
  ],
  capabilities: [
    { key: 'goals', label: 'Goals', icon: 'target', href: '/goals', available: true },
    { key: 'habits', label: 'Habits', icon: 'habits', href: '/goals/habits', available: true },
    {
      key: 'progress',
      label: 'Progress',
      icon: 'progress',
      href: '/goals/progress',
      available: true,
    },
    { key: 'wins', label: 'Wins', icon: 'wins', href: '/goals/wins', available: true },
    {
      key: 'shared-goals',
      label: 'Shared',
      icon: 'family',
      available: false,
      unavailableReason: 'Sharing a goal with family arrives in a later release.',
    },
  ],
  permissions: [
    {
      key: 'notifications',
      title: 'Habit reminders',
      rationale: 'So a habit can check in with you at the time you choose.',
      required: false,
    },
  ],
  ai: moduleAIPolicies.goals,
  stateCopy: {
    empty: {
      title: 'No goals yet',
      body: 'Name one thing you want to change, and we’ll turn it into a habit you can keep.',
      action: 'Add your first goal',
    },
    error: {
      title: 'Couldn’t load your Goals',
      body: 'A request failed on our side. Your streaks are intact.',
      action: 'Try again',
    },
    offline: {
      title: 'You’re offline',
      body: 'You can still tick off today’s habits. They’ll sync when you reconnect.',
    },
    loading: 'Loading your Goals module',
  },
};

export const moduleRegistry: Readonly<Record<FrameworkModuleId, ModuleDefinition>> = {
  'noor-ai': noorAI,
  faith,
  health,
  planner,
  finance,
  learning,
  family,
  goals,
};

/** Every module definition, in the registry's declared order. */
export const allModuleDefinitions: readonly ModuleDefinition[] = FRAMEWORK_MODULE_IDS.map(
  (id) => moduleRegistry[id],
);

/**
 * Resolves a module definition.
 *
 * Throws on an unknown id rather than returning a default. A module screen rendered
 * with the wrong module's colour and copy is worse than a visible failure.
 */
export function getModuleDefinition(id: FrameworkModuleId): ModuleDefinition {
  const definition = moduleRegistry[id];
  if (definition === undefined) {
    throw new Error(`Unknown module "${id}". Register it in module-registry.ts.`);
  }
  return definition;
}
