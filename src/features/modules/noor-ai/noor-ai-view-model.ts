import type { IconName } from '@shared/models/icon';

/**
 * Noor AI's home-screen view model and its fixture.
 *
 * Content is verbatim from `02-noor-ai.png`. Typed fixtures rather than a table, because no
 * production conversation store exists yet and its schema has not been reviewed.
 */

export type NoorAICapability = {
  readonly key: string;
  readonly label: string;
  readonly icon: IconName;
};

export type NoorAISuggestion = {
  readonly key: string;
  readonly title: string;
  readonly detail: string;
  readonly icon: IconName;
};

export type NoorAIConversation = {
  readonly key: string;
  readonly question: string;
  readonly timestamp: string;
};

export type NoorAIHomeViewModel = {
  readonly prompt: {
    readonly placeholder: string;
  };
  readonly capabilities: readonly NoorAICapability[];
  readonly suggestions: {
    readonly title: string;
    readonly items: readonly NoorAISuggestion[];
  };
  readonly conversations: {
    readonly title: string;
    readonly items: readonly NoorAIConversation[];
  };
  readonly privacy: {
    readonly title: string;
    readonly body: string;
    readonly actionLabel: string;
  };
};

export const noorAIHomeFixture: NoorAIHomeViewModel = {
  prompt: {
    placeholder: 'Ask me anything about NoorLife…',
  },
  capabilities: [
    { key: 'find-feature', label: 'Find a feature', icon: 'search' },
    { key: 'explain-progress', label: 'Explain my progress', icon: 'insights' },
    { key: 'help-plan', label: 'Help me plan', icon: 'calendar' },
    { key: 'app-settings', label: 'App settings', icon: 'settings' },
  ],
  suggestions: {
    title: 'Today’s Suggestions',
    items: [
      {
        key: 'review-day',
        title: 'Review my day',
        detail: 'Get a summary of today’s activities',
        icon: 'today',
      },
      {
        key: 'balance-week',
        title: 'Balance my week',
        detail: 'See where to improve your time',
        icon: 'clock',
      },
      {
        key: 'family-activity',
        title: 'Family activity idea',
        detail: 'Suggest a fun, meaningful activity',
        icon: 'family',
      },
    ],
  },
  conversations: {
    title: 'Recent Conversations',
    items: [
      {
        key: 'productivity',
        question: 'How can I improve my productivity?',
        timestamp: 'Yesterday, 9:21 PM',
      },
      {
        key: 'dinner',
        question: 'Best healthy dinner ideas for family',
        timestamp: 'Yesterday, 6:08 PM',
      },
      {
        key: 'weekend',
        question: 'Plan a balanced weekend schedule',
        timestamp: 'May 18, 10:45 AM',
      },
    ],
  },
  privacy: {
    title: 'You control what Noor AI can access',
    body: 'Manage your data and permissions anytime.',
    actionLabel: 'Manage Permissions',
  },
};
