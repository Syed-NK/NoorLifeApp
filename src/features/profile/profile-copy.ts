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

  /** Shared by the detail screens: Back goes to Profile, never to Main Home. */
  detail: {
    backToProfile: 'Back to Profile',
  },

  /**
   * Personal Information — `/profile/edit`.
   *
   * ── What this screen is allowed to change ───────────────────────────────────
   * The name, and nothing else. The address is displayed because the user needs to see which
   * account they are signed into, and it is read-only because changing an auth email is a
   * confirmation flow this screen does not own — writing one into `profiles` would look like an
   * account change while leaving the credential untouched.
   *
   * The photo has no storage contract, so there is no upload control. A disabled button would imply
   * the capability exists and is merely unavailable; a sentence says the true thing instead.
   */
  personal: {
    title: 'Personal Information',
    photo: {
      /** Not "Upload disabled" — there is nothing to enable. */
      note: 'Profile photo changes are coming later.',
      accessibilityLabel: 'Your profile picture',
    },
    name: {
      label: 'Full Name',
      placeholder: 'Your name',
      hint: 'Shown on your profile and in your greeting.',
      /** One message per validation outcome, keyed by the domain's problem codes. */
      errors: {
        empty: 'Enter your name.',
        /** The number comes from the domain constant, so copy and rule cannot drift apart. */
        tooLong: (max: number) => `Use ${max} characters or fewer.`,
        controlCharacters: 'Remove any line breaks or tabs from your name.',
      },
    },
    email: {
      label: 'Email',
      /** States where the change lives rather than implying it cannot be made at all. */
      supporting: 'Email changes are managed in Privacy & Security.',
      accessibilityHint: 'Read only on this screen.',
    },
    provider: {
      label: 'Signed in with',
      /** Rendered only for a provider the session actually reports. Never inferred. */
      names: {
        email: 'Email',
        google: 'Google',
        apple: 'Apple',
      },
    },
    save: {
      label: 'Save Changes',
      /** Why the button is inert, so a disabled control is never a mystery. */
      hintUnchanged: 'Change your name to enable saving.',
      hintReady: 'Saves your new name to your account.',
      saving: 'Saving your name',
      success: 'Name updated',
    },
    /** Shown when Back is pressed with an edit still in the field. */
    discard: {
      title: 'Discard your changes?',
      body: 'Your new name has not been saved yet.',
      keep: 'Keep Editing',
      discard: 'Discard Changes',
    },
  },

  /**
   * Family & Membership — `/profile/family-membership`.
   *
   * ── The capacity sentence is verbatim ───────────────────────────────────────
   * "six accounts: one organizer and five additional members" is the wording the phase fixes, and
   * it exists because "up to 5 family members" is ambiguous about whether the organizer is one of
   * them. It is asserted character-for-character by a test.
   */
  membershipDetail: {
    title: 'Family & Membership',
    currentPlanLabel: 'Current plan',
    /** The six-account explanation. Verbatim — do not paraphrase. */
    capacity: 'Premium Family supports six accounts: one organizer and five additional members.',
    free: {
      supporting: 'Faith is always free.',
      primary: 'View Premium Plans',
    },
    single: {
      supporting: 'All NoorLife modules are available.',
      primary: 'Manage Plan',
      viewFamily: 'View Premium Family',
      /** Says what upgrading buys, in accounts rather than in features. */
      familyAdds: 'Premium Family adds five additional accounts.',
    },
    family: {
      primary: 'Manage Plan',
      manageFamily: 'Manage Family',
      organizerLabel: 'Organizer',
      /** Rendered only from real seat data. */
      seats: (used: number, limit: number) => `${used} of ${limit} accounts in use`,
      pending: (count: number) =>
        `${count} invitation${count === 1 ? '' : 's'} waiting to be accepted`,
      membersHeading: 'Family members',
    },
    /** Plan summaries a free account is comparing. Headings only — pricing lives on the chooser. */
    plans: {
      heading: 'Premium plans',
      singleTitle: 'Premium Single',
      familyTitle: 'Premium Family',
    },
    restore: 'Restore Purchases',
    /**
     * The honest answer for the roster.
     *
     * There is no family table and no invitation service. The in-memory store the family *screens*
     * use is a development fixture with a hardcoded organizer, so reading it here would present
     * invented people as this user's family. Verbatim — asserted by a test.
     */
    backendMissing:
      'Family membership management will be available when store subscriptions and family invitations are connected.',
    unavailable: 'Plan details unavailable',
    unavailableSupporting: 'Your access has not changed.',
    retry: 'Retry',
    loadingAccessibilityLabel: 'Loading your plan',
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
