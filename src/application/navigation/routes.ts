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

export const subscriptionRoutes = {
  overview: '/subscription',
  single: '/subscription/single',
  family: '/subscription/family',
  yearly: '/subscription/yearly',
  manage: '/subscription/manage',
} as const;
