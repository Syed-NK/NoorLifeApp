import type { AppStateKind, StatePreset } from './app-state';

/**
 * Copy and treatment for every shared state.
 *
 * Titles are taken verbatim from docs/NOORLIFE_UI_DESIGN_SPEC.md §19–§28 where
 * the spec names one (`Nothing here yet`, `Something went wrong`,
 * `You're offline`, `Connection is slow`, `No results found`,
 * `Your session has expired`, `All done!`). Messages follow the spec's rule that
 * explanations stay short and recoverable.
 *
 * Centralising the copy here is what stops each module from inventing its own
 * error wording (§15).
 */
export const statePresets = {
  loading: {
    kind: 'loading',
    title: 'Preparing your experience…',
    message: 'This will just take a moment.',
    mascot: 'laptop',
    tone: 'neutral',
    icon: 'clock',
  },
  empty: {
    kind: 'empty',
    title: 'Nothing here yet',
    message: 'Add your first item to get started.',
    mascot: 'box',
    tone: 'module',
    icon: 'add-circle',
    primaryActionLabel: 'Add New',
  },
  'first-use-empty': {
    kind: 'first-use-empty',
    title: 'Start your first item',
    message: "We'll guide you step by step.",
    mascot: 'flag',
    tone: 'module',
    icon: 'sparkle',
    primaryActionLabel: 'Get Started',
    secondaryActionLabel: 'Learn More',
  },
  error: {
    kind: 'error',
    title: 'Something went wrong',
    message: "We didn't expect that. Please try again.",
    mascot: 'concerned',
    tone: 'error',
    icon: 'error',
    primaryActionLabel: 'Try Again',
    secondaryActionLabel: 'See Details',
  },
  'server-unavailable': {
    kind: 'server-unavailable',
    title: 'Service temporarily unavailable',
    message: 'Our team is on it. Your saved data is safe.',
    mascot: 'wrench',
    tone: 'error',
    icon: 'error',
    primaryActionLabel: 'Check Again',
  },
  offline: {
    kind: 'offline',
    title: "You're offline",
    message: 'Check your connection and try again. Your saved items are still available.',
    mascot: 'offline',
    tone: 'error',
    icon: 'offline',
    primaryActionLabel: 'Retry',
    secondaryActionLabel: 'View Offline Content',
  },
  'slow-network': {
    kind: 'slow-network',
    title: 'Connection is slow',
    message: 'Things may take longer than usual.',
    mascot: 'waiting',
    tone: 'warning',
    icon: 'clock',
    primaryActionLabel: 'Keep Waiting',
    secondaryActionLabel: 'Work Offline',
  },
  'no-results': {
    kind: 'no-results',
    title: 'No results found',
    message: 'Try different keywords or check your spelling.',
    mascot: 'magnifier',
    tone: 'neutral',
    icon: 'search',
    primaryActionLabel: 'Clear Search',
  },
  'permission-required': {
    kind: 'permission-required',
    title: 'Permission needed',
    message: 'This action requires access to continue. Your data stays private.',
    mascot: 'shield',
    tone: 'warning',
    icon: 'lock',
    primaryActionLabel: 'Open Settings',
    secondaryActionLabel: 'Not Now',
  },
  'permission-denied': {
    kind: 'permission-denied',
    title: 'Access is turned off',
    message: 'Enable permission in Settings to continue. No data was collected.',
    mascot: 'shield',
    tone: 'warning',
    icon: 'lock',
    primaryActionLabel: 'Open Settings',
    secondaryActionLabel: 'Go Back',
  },
  'session-expired': {
    kind: 'session-expired',
    title: 'Your session has expired',
    message: 'For your security, please sign in again. Your data is safe.',
    mascot: 'clock',
    tone: 'neutral',
    icon: 'clock',
    primaryActionLabel: 'Sign In',
    secondaryActionLabel: 'Not Now',
  },
  'validation-error': {
    kind: 'validation-error',
    title: 'Please fix the errors below',
    message: 'Correct the highlighted fields to continue.',
    mascot: 'concerned',
    tone: 'error',
    icon: 'warning',
    primaryActionLabel: 'Fix Errors',
    secondaryActionLabel: 'Review All',
  },
  success: {
    kind: 'success',
    title: 'All done!',
    message: 'Your changes were saved successfully.',
    mascot: 'thumbs-up',
    tone: 'success',
    icon: 'check-circle',
    primaryActionLabel: 'Continue',
    secondaryActionLabel: 'View Details',
  },
  'ai-unavailable': {
    kind: 'ai-unavailable',
    title: 'Module AI is temporarily unavailable',
    message: "We'll have it back shortly. Your data is safe and you can continue without AI.",
    mascot: 'thinking',
    tone: 'ai',
    icon: 'robot',
    primaryActionLabel: 'Try Again',
    secondaryActionLabel: 'Continue without AI',
  },
  'ai-safety-boundary': {
    kind: 'ai-safety-boundary',
    title: "I can't help with that request",
    message: "This request goes beyond safe use boundaries. We're here to help safely.",
    mascot: 'shield',
    tone: 'ai',
    icon: 'shield',
    primaryActionLabel: 'Learn Safe Alternatives',
    secondaryActionLabel: 'Contact Support',
  },
} as const satisfies Record<AppStateKind, StatePreset>;

export function getStatePreset(kind: AppStateKind): StatePreset {
  return statePresets[kind];
}
