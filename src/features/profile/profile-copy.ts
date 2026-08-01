/**
 * Every string on the Profile screens.
 *
 * Centralised for the same reason the entry and subscription flows centralise theirs: account and
 * billing wording is reviewed, and a phrase typed inline is a phrase nobody can audit.
 */
export const profileCopy = {
  title: 'Profile',
  editProfile: 'Edit Profile',
  unknownName: 'Your account',
  unknownEmail: 'No email on file',
  loading: 'Loading…',
  monthly: 'Monthly',
  yearly: 'Yearly',
  /** Repeated wherever a plan is discussed, because it is the reassurance that matters most. */
  faithAlwaysFree: 'Faith is always free.',
  comingLater: 'Coming later',
  /** Shown only in a build that cannot take money. */
  mockNotice: 'Development mock — purchases are simulated',
  memberNotice: 'You are a member of this family. Only the organizer can manage members.',

  sections: {
    account: 'Account',
    subscription: 'Subscription',
    family: 'Family',
    preferences: 'Preferences',
    privacy: 'Privacy and data',
    help: 'Help',
    session: 'Session',
  },

  rows: {
    personalInfo: 'Personal Information',
    emailAddress: 'Email Address',
    passwordSecurity: 'Password & Security',

    currentPlan: 'Current plan',
    status: 'Status',
    billingPeriod: 'Billing period',
    renews: 'Renews',
    expires: 'Access ends',
    manageSubscription: 'Manage Subscription',
    viewPremium: 'View Premium Plans',
    restorePurchases: 'Restore Purchases',

    seats: 'Accounts in use',
    manageFamily: 'Manage Family',
    inviteMember: 'Invite Member',
    pendingInvitations: 'Pending Invitations',
    familyPrivacy: 'How family privacy works',
    viewFamilyPlan: 'View Premium Family',

    notifications: 'Notifications',
    language: 'Language',
    appearance: 'Appearance',
    accessibility: 'Accessibility',

    privacyControls: 'Privacy Controls',
    aiPermissions: 'AI Data & Permissions',
    downloadData: 'Download My Data',
    deleteAccount: 'Delete Account',

    helpCenter: 'Help Center',
    contactSupport: 'Contact Support',
    reportProblem: 'Report a Problem',
    terms: 'Terms of Service',
    privacyPolicy: 'Privacy Policy',
    about: 'About NoorLife',

    logOut: 'Log Out',
  },
} as const;
