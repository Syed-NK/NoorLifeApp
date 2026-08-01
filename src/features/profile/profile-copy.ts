/**
 * Every string on the Profile screens.
 *
 * Centralised for the same reason the entry and subscription flows centralise theirs: account and
 * billing wording is reviewed, and a phrase typed inline is a phrase nobody can audit.
 *
 * ── Phase 6C-1 ──────────────────────────────────────────────────────────────
 * The long section-by-section wording is gone with the long screen. What remains is the compact
 * summary's copy, plus the honest wording for the two things Profile Home must be able to say
 * without lying: "this is not built yet" and "we could not load this".
 */
export const profileCopy = {
  title: 'Profile',

  /** Used only when there is genuinely no name on the account — never as a placeholder. */
  unknownName: 'Your account',
  unknownEmail: 'No email on file',

  identity: {
    edit: 'Edit',
    editAccessibilityLabel: 'Edit your profile',
    /** Read instead of the truncated line, so a long name is never lost to an ellipsis. */
    nameAccessibilityPrefix: 'Signed in as',
    emailAccessibilityPrefix: 'Email',
    avatarAccessibilityLabel: 'Your profile picture',
    loadingAccessibilityLabel: 'Loading your account details',
  },

  membership: {
    free: {
      title: 'Free plan',
      supporting: 'Faith is always free.',
      primary: 'View Premium',
    },
    premiumSingle: {
      title: 'Premium Single',
      supporting: 'All NoorLife modules are available.',
      primary: 'Manage Plan',
    },
    premiumFamily: {
      title: 'Premium Family',
      supporting: 'Share with up to five additional family members.',
      primary: 'Manage Plan',
    },
    restore: 'Restore Purchases',
    /** Prefixes a date only when the provider actually reported one. */
    renews: (date: string) => `Renews ${date}`,
    accessEnds: (date: string) => `Access ends ${date}`,
    /** Rendered only when real seat data has arrived. */
    seats: (used: number, limit: number) => `${used} of ${limit} seats`,
    loadingAccessibilityLabel: 'Loading your plan',
    unavailable: 'Plan details unavailable',
    /** Says the one thing a user actually worries about when billing data will not load. */
    unavailableSupporting: 'Your access has not changed.',
    retry: 'Retry',
    /**
     * The development-only marker.
     *
     * Three characters on the title row, not the full-width sentence the previous screen carried
     * permanently. It is excluded from a production build entirely — see `ProfileMembershipCard`.
     */
    devBadge: 'DEV',
    devBadgeAccessibilityLabel: 'Development build — purchases are simulated',
  },

  menu: {
    personalInformation: 'Personal Information',
    familyMembership: 'Family & Membership',
    preferences: 'Preferences',
    privacySecurity: 'Privacy & Security',
    helpSupport: 'Help & Support',
  },

  header: {
    back: 'Back to Home',
    help: 'Help',
    helpHint: 'Opens the NoorLife help centre.',
  },

  logout: {
    label: 'Log Out',
    hint: 'Asks you to confirm before signing out.',
    confirmTitle: 'Log out of NoorLife?',
    confirmBody: 'You will need to sign in again to open your account.',
    confirm: 'Log Out',
    cancel: 'Cancel',
    /** Shown when the sign-out request itself failed — the session is still live, and says so. */
    failedTitle: 'Could not log out',
    failedBody: 'Check your connection and try again. You are still signed in.',
    failedDismiss: 'OK',
  },

  /**
   * The one honest answer for a destination that does not exist yet.
   *
   * Named by feature rather than generic: "Preferences is coming later" is information, and
   * "Coming soon" is not — the same reasoning the module coming-soon screen already applies.
   */
  comingLater: {
    marker: 'Coming later',
    title: (feature: string) => `${feature} is coming later`,
    body: (feature: string) =>
      `${feature} arrives in a later NoorLife update. Nothing is missing from your account in the meantime.`,
    dismiss: 'OK',
    accessibilityHint: 'Not built yet. Opens a note explaining when it arrives.',
  },
} as const;
