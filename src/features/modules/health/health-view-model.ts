import type { IconName } from '@shared/models/icon';

/**
 * Health's home-screen view model and its fixture.
 *
 * Values are the approved reference's values — `04-health.png` shows a wellness score of
 * 86, 7,542 steps and 7h 15m sleep — because this pass exists to reproduce that screen.
 * Nothing here is live, and no production Health table may exist before its data model is
 * reviewed, so the shape is a view model over typed fixtures.
 *
 * ── One note on Health specifically ─────────────────────────────────────────
 * Health's AI policy requires a standing disclaimer, and the reference shows it inside the
 * insight card. It is part of this model rather than a presentation detail so it cannot be
 * dropped by a layout change.
 */

export type HealthMetric = {
  readonly key: string;
  /** Pre-formatted, e.g. "7,542" or "7h 15m". */
  readonly value: string;
  readonly label: string;
  readonly icon: IconName;
  /** `theme` uses the module ink; the rest are the reference's own accents. */
  readonly tone: 'theme' | 'teal' | 'navy' | 'green';
};

export type HealthFocusItem = {
  readonly key: string;
  readonly title: string;
  readonly detail: string;
  readonly icon: IconName;
  /** The reference tiles the first icon on a pale square and leaves the second bare. */
  readonly tiled: boolean;
};

export type HealthActivityItem = {
  readonly key: string;
  readonly title: string;
  readonly detail: string;
  readonly time: string;
  readonly icon: IconName;
  readonly tone: 'theme' | 'navy';
};

export type HealthQuickLogAction = {
  readonly key: string;
  readonly label: string;
  readonly icon: IconName;
  readonly tone: 'theme' | 'green' | 'red' | 'grey';
};

export type HealthHomeViewModel = {
  readonly wellness: {
    readonly eyebrow: string;
    readonly title: string;
    /** 0–100. Drives both the numeral and the ring. */
    readonly score: number;
    readonly encouragement: string;
    readonly actionLabel: string;
  };
  readonly metrics: readonly HealthMetric[];
  readonly medication: {
    readonly title: string;
    readonly name: string;
    readonly time: string;
    readonly statusLabel: string;
  };
  readonly focus: {
    readonly title: string;
    readonly items: readonly HealthFocusItem[];
  };
  readonly weeklyTrend: {
    readonly title: string;
    readonly summary: string;
    readonly values: readonly number[];
    readonly labels: readonly string[];
  };
  readonly recentActivity: {
    readonly title: string;
    readonly items: readonly HealthActivityItem[];
  };
  readonly quickLog: {
    readonly title: string;
    readonly actions: readonly HealthQuickLogAction[];
  };
  readonly insight: {
    readonly title: string;
    readonly body: string;
    /** Required by the Health AI policy and shown in the reference. */
    readonly disclaimer: string;
  };
};

export const healthHomeFixture: HealthHomeViewModel = {
  wellness: {
    eyebrow: 'Today’s Wellness',
    title: 'Wellness Score',
    score: 86,
    encouragement: 'You’re building a balanced day.',
    actionLabel: 'View Insights',
  },
  metrics: [
    { key: 'steps', value: '7,542', label: 'Steps', icon: 'steps', tone: 'teal' },
    { key: 'sleep', value: '7h 15m', label: 'Sleep', icon: 'sleep', tone: 'navy' },
    { key: 'water', value: '6 cups', label: 'Water', icon: 'water', tone: 'theme' },
    { key: 'mood', value: 'Good', label: 'Mood', icon: 'mood', tone: 'green' },
  ],
  medication: {
    title: 'Medication Reminder',
    name: 'Vitamin D',
    time: '8:00 AM',
    statusLabel: 'Taken',
  },
  focus: {
    title: 'Today’s Focus',
    items: [
      {
        key: 'breathing',
        title: 'Mindful Breathing',
        detail: '5 min • Calm your mind',
        icon: 'breathing',
        tiled: true,
      },
      {
        key: 'walk',
        title: '20-minute Walk',
        detail: 'Keep your body moving',
        icon: 'walk',
        tiled: false,
      },
    ],
  },
  weeklyTrend: {
    title: 'Weekly Trend',
    summary: 'Your activity is trending up!',
    // Read off the reference's plotted points: a dip mid-week, rising into the weekend.
    values: [30, 48, 22, 55, 28, 72, 90],
    labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
  },
  recentActivity: {
    title: 'Recent Activity',
    items: [
      {
        key: 'walk',
        title: 'Morning Walk',
        detail: '7,542 steps',
        time: '7:45 AM',
        icon: 'walk',
        tone: 'theme',
      },
      {
        key: 'water',
        title: 'Water Logged',
        detail: '2 cups',
        time: '10:20 AM',
        icon: 'water',
        tone: 'theme',
      },
      {
        key: 'sleep',
        title: 'Sleep Logged',
        detail: '7h 15m',
        time: '11:30 PM',
        icon: 'sleep',
        tone: 'navy',
      },
    ],
  },
  quickLog: {
    title: 'Quick Log',
    actions: [
      { key: 'water', label: 'Water', icon: 'water', tone: 'theme' },
      { key: 'mood', label: 'Mood', icon: 'mood', tone: 'green' },
      { key: 'medication', label: 'Medication', icon: 'medication', tone: 'red' },
      { key: 'weight', label: 'Weight', icon: 'weight', tone: 'grey' },
    ],
  },
  insight: {
    title: 'Health AI Insight',
    body: 'Great job staying active! A short afternoon walk can improve energy and focus. Keep listening to your body.',
    disclaimer: 'This is general information, not medical advice.',
  },
};
