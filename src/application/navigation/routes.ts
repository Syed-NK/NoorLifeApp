/**
 * The NoorLife route contract.
 *
 * Source of truth: docs/NOORLIFE_PRODUCTION_WORKFLOW.md §3, §4, §6–§14.
 *
 * Route strings live here rather than being typed inline at call sites, so a path
 * change is a single edit. Expo Router's generated `Href` type still validates
 * each one at compile time wherever it is used for navigation.
 */

/** §3.1 global destinations. */
export const globalRoutes = {
  splash: '/splash',
  home: '/home',
  modules: '/modules',
  noorAI: '/ai',
  insights: '/insights',
  profile: '/profile',
  settings: '/settings',
  notifications: '/notifications',
  personalization: '/personalization',
} as const;

/**
 * §4 entry and account routes — the Phase 2 `(auth)` group.
 *
 * `(auth)` is a *group*, so it contributes no URL segment: these paths are flat. The group
 * exists to give the twelve entry screens one shared layout without nesting them under a
 * `/auth` prefix, and without touching the locked Main Home routes.
 *
 * The Authentication Options screen is `welcome`, not `index`: an `index` inside a group
 * resolves to `/`, which would collide with the entry gate at `src/app/index.tsx`.
 */
export const authRoutes = {
  welcome: '/welcome',
  signIn: '/sign-in',
  signUp: '/sign-up',
  verifyEmail: '/verify-email',
  forgotPassword: '/forgot-password',
  resetLinkSent: '/reset-link-sent',
  newPassword: '/new-password',
  accountReady: '/account-ready',
  biometric: '/biometric',
} as const;

export const onboardingRoutes = {
  one: '/onboarding/one',
  two: '/onboarding/two',
  three: '/onboarding/three',
} as const;

/**
 * §3.2 module entry rule: every module card opens the module's default home.
 * §3.3 module AI rule: the centre navigation item opens AI inside that module.
 */
export const moduleRoutes = {
  faith: { home: '/faith', ai: '/faith/ai' },
  health: { home: '/health', ai: '/health/ai' },
  planner: { home: '/planner', ai: '/planner/ai' },
  finance: { home: '/finance', ai: '/finance/ai' },
  learning: { home: '/learning', ai: '/learning/ai' },
  family: { home: '/family', ai: '/family/ai' },
  goals: { home: '/goals', ai: '/goals/ai' },
} as const;

/**
 * §14 subscription routes, extended by Phase 5.
 *
 * `manage` moved from `/subscription/manage` to `/settings/subscription`, which is where the
 * Phase 5 brief places it — managing a subscription is a settings task, and it sits beside the
 * other account rows there.
 *
 * `yearly` is retained as a redirect to `compare`: Phase 5 replaced the yearly-only placeholder
 * with a full three-plan comparison, and deleting a declared route is a contract change this
 * phase was not asked to make.
 *
 * The parameterised forms — a plan at a billing period — live in
 * `@features/subscription/subscription-routes`, since a query string does not fit this file's
 * flat shape.
 */
export const subscriptionRoutes = {
  overview: '/subscription',
  compare: '/subscription/compare',
  single: '/subscription/single',
  family: '/subscription/family',
  confirm: '/subscription/confirm',
  processing: '/subscription/processing',
  success: '/subscription/success',
  restore: '/subscription/restore',
  expired: '/subscription/expired',
  billingIssue: '/subscription/billing-issue',
  /** Superseded by `compare`; kept as a redirect for existing links. */
  yearly: '/subscription/yearly',
  manage: '/settings/subscription',
} as const;

/** §5.11–§5.15 family membership. Distinct from the Family *module* routes in `moduleRoutes`. */
export const familyMembershipRoutes = {
  setup: '/family/setup',
  invite: '/family/invite',
  invitations: '/family/invitations',
  members: '/family/members',
  planFull: '/family/plan-full',
} as const;
