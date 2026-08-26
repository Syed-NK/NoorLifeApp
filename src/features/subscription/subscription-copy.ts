import { TRIAL_DAYS, trialLengthLabel } from './domain/trial-period';

/**
 * Every customer-facing string in the subscription and family system.
 *
 * Centralised for the same reason the entry flow centralises its copy: commercial wording is
 * reviewed, and a phrase typed inline in a screen is a phrase nobody can audit. The family
 * wording in particular is approved verbatim and must not be paraphrased.
 */

/**
 * The approved family wording.
 *
 * "up to 5 family members" means five accounts *in addition to* the organizer, six in total. The
 * supporting line exists to remove exactly that ambiguity, so the two are used together wherever
 * the seat count is first introduced.
 *
 * The superseded four-seat wording must never appear anywhere in NoorLife. A test asserts it
 * does not, by scanning the source tree for it.
 */
export const familyWording = {
  headline: 'Share NoorLife with up to 5 family members.',
  supporting: 'One organizer and five additional members. Everyone gets their own private account.',
} as const;

export const planNames = {
  free: 'Free',
  premium_single: 'Premium Single',
  premium_family: 'Premium Family',
} as const;

export const welcomeCopy = {
  heading: 'Choose how NoorLife supports you',
  subheading: 'Faith is always free. Add the rest whenever you are ready.',
  continueFree: 'Continue with Free',
  restore: 'Restore Purchases',
  comparePlans: 'Compare all plans',
  terms: 'Terms of Service',
  privacy: 'Privacy Policy',
  legalJoin: ' and ',
  legalPrefix: 'By subscribing you agree to our ',
} as const;

export const billingCopy = {
  monthly: 'Monthly',
  yearly: 'Yearly',
  /** Rendered with the computed percentage, never a hardcoded "20%". */
  saveBadge: (percent: number) => `Save ${percent}%`,
  perMonth: 'per month',
  perYear: 'per year',
  billedMonthly: 'Billed monthly',
  billedYearly: 'Billed yearly',
  equivalentPerMonth: (formatted: string) => `${formatted} per month, billed yearly`,
  approximate: 'Approximate price. Your store will show your exact price.',
} as const;

export const freePlanCopy = {
  name: planNames.free,
  price: 'Free forever',
  tagline: 'Faith, always included',
  features: [
    'One personal account',
    'Main Home',
    'The complete Faith module',
    'Quran, Hadith, Duas and Tasbih',
    'Prayer times, Qibla and mosques',
    'Islamic calendar',
    'Basic Noor AI navigation help',
    'No advertisements',
    'Preview access to paid modules',
  ],
} as const;

export const singlePlanCopy = {
  name: planNames.premium_single,
  tagline: 'Every module, one account',
  features: [
    'Everything in Free',
    'Health, Planner and Finance',
    'Learning, Family and Goals',
    'Module-specific AI assistants',
    'Advanced insights',
    'Sync and cloud backup',
    'Personalization and progress reporting',
  ],
} as const;

export const familyPlanCopy = {
  name: planNames.premium_family,
  tagline: familyWording.headline,
  features: [
    'Everything in Premium Single',
    'Six accounts: one organizer, five members',
    'Private personal profiles',
    'Shared family calendar',
    'Shared events and tasks',
    'Shared family goals',
    'Family check-ins',
    'Shared memories',
    'Invitations and member management',
    'Parental controls',
  ],
  privacyHeading: 'What stays private',
  privacyBody:
    'Health, Finance, Goals and AI conversations are private to each account. Family members never see them by default.',
  sharedHeading: 'What the family shares',
  sharedBody:
    'The calendar, events and tasks, shared goals, check-ins and memories are visible to everyone in the family.',
} as const;

export const trialCopy = {
  /*
    Both strings take their length from `TRIAL_DAYS` rather than writing 7 again. The number was in
    four places — the adapter, two screens and this copy — and a heading that outlives the length it
    names is the same class of defect as a date that outlives its clock.
  */
  heading: `${trialLengthLabel} free trial`,
  /** Only ever rendered when the store has confirmed eligibility for this user. */
  body: (priceAfter: string, renewalDate: string) =>
    `Your trial is free for ${TRIAL_DAYS} days. On ${renewalDate} it renews at ${priceAfter} unless you cancel before then.`,
  notEligible: 'The free trial is for first-time yearly subscribers.',
} as const;

export const renewalCopy = {
  /** Every recurring offer must state frequency, automatic renewal and how to cancel. */
  autoRenews: (period: string, price: string) =>
    `Renews automatically ${period} at ${price} until you cancel.`,
  cancelAnyTime: 'Cancel any time in your store account. Cancelling keeps your data.',
  renewsOn: (date: string) => `Renews on ${date}`,
  expiresOn: (date: string) => `Access ends on ${date}`,
  cancelledButActive: (date: string) => `Cancelled. Paid access continues until ${date}.`,
} as const;

export const confirmCopy = {
  heading: 'Confirm your plan',
  body: 'The next step opens the store to complete payment. NoorLife never sees your card details.',
  paidVia: (store: string) => `Payment handled by ${store}`,
  confirm: 'Confirm and Continue',
  changePlan: 'Back / change plan',
} as const;

export const processingCopy = {
  heading: 'Confirming your subscription…',
  body: 'This only takes a moment. Please keep the app open.',
  slow: 'This is taking longer than usual. You can keep waiting or try again.',
  retry: 'Try again',
  cancel: 'Back to plans',
} as const;

export const successCopy = {
  heading: 'You are all set',
  activated: (plan: string) => `${plan} is now active`,
  start: 'Start using NoorLife',
  inviteFamily: 'Invite family members',
  familyLater: 'Do this later',
  /** Setting up the family is never forced — the brief requires "Do this later" to stay open. */
  setupLater: 'You can set up your family now, or any time from the Family module.',
  /*
    Shown when there is no date that can be stated truthfully — the provider issued none, or issued one
    that does not end after the purchase. Both say the subscription is active and point at the one place
    that always knows, rather than approximating a date. The screen previously rendered nothing at all in
    this case, which left a user who expected a trial end with no explanation.
  */
  trialDateUnknown: 'Your free trial is active. Your store account shows the exact end date.',
  renewalDateUnknown:
    'Your subscription is active. Your store account shows the exact next billing date.',
} as const;

export const restoreCopy = {
  heading: 'Restore Purchases',
  body: 'If you subscribed before, restoring brings your plan back to this device.',
  action: 'Restore Purchases',
  restoring: 'Checking your store account…',
  restored: (plan: string) => `${plan} restored`,
  nothingFound: 'No previous purchases found',
  nothingFoundBody:
    'This store account has no NoorLife subscription. If you used a different account, sign in to that one and try again.',
  storeUnavailable: 'The store is not responding',
  storeUnavailableBody: 'This is usually temporary. Faith stays available while you wait.',
  offline: 'You are offline',
  offlineBody: 'Reconnect and try again. Faith works offline.',
  error: 'Something went wrong',
  errorBody: 'We could not check your purchases. Please try again.',
} as const;

export const manageCopy = {
  heading: 'Subscription',
  currentPlan: 'Current plan',
  status: 'Status',
  billingPeriod: 'Billing period',
  store: 'Purchased through',
  manageInStore: (store: string) => `Manage in ${store}`,
  /** Shown when NoorLife has no store to hand off to, instead of a button that does nothing. */
  noManagementSurface:
    'This subscription was not purchased through a store, so there is nothing to manage here.',
  cancelGuidance:
    'NoorLife cannot cancel a store subscription for you. Cancel it in your store account; paid access continues until the period ends and your data is kept.',
  upgrade: 'Upgrade plan',
  switchToYearly: 'Switch to yearly billing',
  switchToMonthly: 'Switch to monthly billing',
  restore: 'Restore Purchases',
} as const;

export const statusLabels = {
  free: 'Free plan',
  trialing: 'Free trial',
  active: 'Active',
  grace_period: 'Payment problem',
  account_hold: 'On hold',
  paused: 'Paused',
  expired: 'Expired',
  revoked: 'Cancelled',
  unknown: 'Checking…',
} as const;

export const billingIssueCopy = {
  grace_period: {
    heading: 'There is a problem with your payment',
    body: 'Your store is retrying the charge. Your plan keeps working while it does.',
  },
  account_hold: {
    heading: 'Your subscription is on hold',
    body: 'The store could not take payment. Premium modules are locked until it succeeds.',
  },
  expired: {
    heading: 'Your subscription has expired',
    body: 'Premium modules are locked. Nothing has been deleted.',
  },
  store_unavailable: {
    heading: 'The store is not responding',
    body: 'We cannot check your subscription right now. This is usually temporary.',
  },
  paused: {
    heading: 'Your subscription is paused',
    body: 'You paused this plan in your store account. Resume it there whenever you like.',
  },
  /** Repeated on every billing-problem state, because it is the reassurance that matters most. */
  faithReassurance: 'Faith stays completely available, as always.',
  fixInStore: (store: string) => `Update payment in ${store}`,
  continueToFaith: 'Continue to Faith',
} as const;

export const expiredCopy = {
  heading: 'Your subscription has expired',
  lockedBody: 'Health, Planner, Finance, Learning, Family and Goals are locked for now.',
  faithBody: 'Faith is still completely free, exactly as before.',
  dataBody: 'None of your data has been deleted. Renewing brings everything back.',
  renew: 'Renew subscription',
  continueToFaith: 'Continue to Faith',
  manage: 'Manage subscription',
} as const;

/**
 * The contextual upgrade explanation.
 *
 * ── One title for every request ─────────────────────────────────────────────
 * The title used to be built from the module — "Planner is part of Premium" — which read as a
 * statement about Planner rather than an answer to what the user just tapped, and duplicated the
 * module name the body already carries. One fixed title, and the body does the explaining.
 *
 * ── The body names what was tapped *and* where it lives ─────────────────────
 * A free user who taps "Add Task" is not asking about Planner; they are asking why Add Task did
 * nothing. Telling them only about Planner drops the thing they touched — the device pass found
 * exactly that. So the body states both, and which of the two sentences applies is decided by whether
 * the feature *is* the module: a module tile has nothing extra to say, a feature inside one does.
 */
export const lockedModuleCopy = {
  /**
   * One short, specific line per module. Never a generic "unlock premium".
   *
   * These are read by a free user *before* paying, which makes them the strictest truthfulness
   * surface in the app: a line here is a purchase decision. Planner's line used to sell
   * "reminders that respect prayer times" — Planner schedules no notifications at all and reads no
   * prayer times, so the sentence sold two capabilities that do not exist. It now names only what
   * Planner actually does. Nothing may be added to a line here before the capability ships.
   */
  valueStatements: {
    health: 'Track wellness, activity and habits with a private health assistant.',
    planner: 'Plan your days with tasks and recurring routines that work offline.',
    finance: 'Budgets, spending and savings goals, kept entirely private.',
    learning: 'Structured Islamic learning with progress you can see.',
    family: 'A shared calendar, goals and memories for up to six accounts.',
    goals: 'Set goals, track streaks and see honest progress reporting.',
  },
  /** The same for every request, whatever raised it. */
  title: 'Unlock this feature',
  /**
   * The contextual line.
   *
   * `featureTitle === moduleName` is the module-tile case — "Health is included with NoorLife
   * Premium." Anything else is a feature that lives inside a module, and naming both is what makes
   * the sheet an answer: "Add Task is available with Planner in NoorLife Premium."
   */
  body: ({
    featureTitle,
    moduleName,
  }: {
    readonly featureTitle: string;
    readonly moduleName: string;
  }) =>
    featureTitle === moduleName
      ? `${moduleName} is included with NoorLife Premium.`
      : `${featureTitle} is available with ${moduleName} in NoorLife Premium.`,
  viewPlans: 'View Premium Plans',
  notNow: 'Not now',
  continueToFaith: 'Continue to Faith',
} as const;

/**
 * Noor AI in its free, application-guidance mode.
 *
 * Noor AI is never locked — it is included on the free plan, at the scope `freePlanCopy` describes
 * as "Basic Noor AI navigation help". These are the words that state that scope where a free user
 * meets it, and they replace the paid personalized insight rather than sitting beside it: a free
 * user has no Planner, so "You have a free 30-minute window at 4 PM" is a claim about a schedule
 * they do not have.
 *
 * The wording invites rather than refuses. Nothing here says "upgrade" — Noor AI works, and what
 * this describes is what it works on.
 */
export const noorAIFreeCopy = {
  /** Replaces the personalized insight on Main Home. */
  insightBody: 'Ask Noor AI how to find features or manage your account.',
  /**
   * Announced with the insight, in place of the paid "NoorLife only".
   *
   * The scope has to be *narrower* than "NoorLife only" to be true on the free plan, which covers
   * the application and the account rather than the modules' contents.
   */
  scopeLabel: 'NoorLife app help only',
  /** Said when a free user asks Noor AI to do a paid module's work. */
  outOfPlan: (moduleName: string) =>
    `${moduleName} is part of Premium, so I can't work with it yet. I can explain what it includes, or help you find your way around NoorLife.`,
} as const;

export const familySetupCopy = {
  heading: 'Create your family',
  body: 'Name your family and invite up to five members. You stay the organizer.',
  nameLabel: 'Family name',
  namePlaceholder: 'The Al-Rashid family',
  organizerLabel: 'Organizer',
  privacyHeading: 'Everyone keeps their privacy',
  privacyBody: familyPlanCopy.privacyBody,
  create: 'Create Family',
  later: 'Do this later',
} as const;

export const familyInviteCopy = {
  heading: 'Invite a family member',
  body: familyWording.supporting,
  emailLabel: 'Email address',
  emailPlaceholder: 'name@example.com',
  sendInvite: 'Send invitation',
  shareLink: 'Share an invitation link',
  expiryNote: 'Invitations expire after 7 days.',
  seatCounter: (used: number, limit: number) => `${used} of ${limit} members`,
  fullNotice: 'Your family plan is full. Remove a member to free a seat.',
  newOrExisting: 'They can join with an existing NoorLife account or create a new one.',
} as const;

export const familyInvitationsCopy = {
  heading: 'Pending invitations',
  empty: 'No invitations yet',
  emptyBody: 'Invitations you send will appear here until they are accepted.',
  resend: 'Resend',
  cancel: 'Cancel invitation',
  loading: 'Loading invitations…',
  error: 'Could not load invitations',
  errorBody: 'Please try again.',
  offline: 'You are offline',
  offlineBody: 'Invitations will load when you reconnect.',
  statusLabels: {
    pending: 'Pending',
    accepted: 'Accepted',
    expired: 'Expired',
    revoked: 'Cancelled',
  },
} as const;

export const familyMembersCopy = {
  heading: 'Family members',
  organizerBadge: 'Organizer',
  youBadge: 'You',
  remove: 'Remove',
  /** The organizer holds a seat and cannot leave; transfer is deferred this phase. */
  cannotRemoveSelf:
    'The organizer cannot be removed. Transferring the organizer role is coming later.',
  privacyLink: 'How family privacy works',
  /**
   * The line under a member's name.
   *
   * The organizer's does not repeat the word "Organizer" — the badge beside their name already says
   * it, and printing it twice in one row read as a rendering fault. It says what the role *means*
   * instead, which is the part a new organizer benefits from seeing.
   */
  roleLabels: {
    organizer: 'Manages the family and holds one of the six accounts',
    adult: 'Member',
    child: 'Child',
  },
  memberOnlyNote:
    'You are a member of this family. Only the organizer can invite or remove members.',
  /** Section headings, so a one-member family still reads as a complete screen. */
  seatSection: 'Accounts',
  membersSection: 'Members',
  pendingSection: 'Pending invitations',
  noPending: 'No invitations waiting.',
  pendingCount: (count: number) =>
    `${count} invitation${count === 1 ? '' : 's'} waiting to be accepted.`,
  invite: 'Invite a family member',
  seatsFree: (free: number) =>
    free === 0 ? 'All accounts are in use.' : `${free} account${free === 1 ? '' : 's'} still free.`,
} as const;

export const familyFullCopy = {
  heading: 'Your family plan is full',
  body: (limit: number) => `All ${limit} of ${limit} accounts are in use.`,
  manage: 'Manage members',
  close: 'Close',
  /** Removing someone is always the organizer's explicit choice. */
  neverAutoRemove: 'No one is ever removed automatically.',
} as const;

export const mockModeCopy = {
  badge: 'Development mock — purchases are simulated',
} as const;
