/**
 * Jest setup for NoorLife.
 *
 * Only the native/host boundaries are mocked. Nothing in the design system,
 * module themes or feature code is mocked — those are the things under test.
 */

/**
 * ── There is deliberately no global `jest.setTimeout` here ──────────────────
 * 6C-3A raised the whole run to thirty seconds because provider-heavy suites were timing out under
 * parallel load. That diagnosis was wrong in an expensive way: the suites were not starved of CPU,
 * they were *sleeping*. Four mock data sources simulate latency with a real `setTimeout` —
 * `use-main-home-dashboard` 450 ms, `mock-module-repository` 350 ms, Faith's `mock-support` 280 ms,
 * `mock-auth-service` 650 ms — and every mount of every screen paid it in wall-clock time. Main
 * Home's four suites mount the screen 246 times between them, which is roughly 110 seconds of the
 * run spent waiting for timers that exist so a human can see a skeleton.
 *
 * Raising the budget hid that, and it hid something worse: a genuinely hung unit test took thirty
 * seconds to say so, and every suite in the project — including the pure ones that finish in
 * milliseconds — lost its ability to fail fast.
 *
 * The fix is `installMockLatencyTimers()` from `@/test-support/mock-latency-timers`, which the
 * affected suites opt into: it advances the mock clock instead of sleeping on it, and warms the
 * first mount in `beforeAll` so the opening test of a heavy suite is not charged for compiling a
 * provider stack. Neither changes a single assertion.
 *
 * The second half of the fix is `maxWorkers: "60%"` in `package.json`. Jest's default of
 * `cores - 1` had thirteen workers competing for fourteen cores, which inflated the slowest mount
 * from 2.6 s to 4.7 s and occasionally past five. Leaving 40% of the machine free made the whole
 * run *faster* — 70.8 s against 74.6 s — because the time was being lost to contention, not spent
 * on work.
 *
 * Jest's five-second default now applies to every test in the project, which is what makes a hang
 * look like a hang: no `jest.setTimeout` survives anywhere in `src`.
 */

/**
 * The shared router double.
 *
 * The `mock` name prefix is required: `jest.mock` factories are hoisted above
 * variable declarations, and Jest only permits a factory to close over an
 * out-of-scope variable when its name starts with `mock`.
 */
const mockRouterInstance = {
  push: jest.fn(),
  replace: jest.fn(),
  navigate: jest.fn(),
  back: jest.fn(),
  canGoBack: jest.fn(() => true),
  dismiss: jest.fn(),
  /**
   * The header back arrow's method.
   *
   * `dismissTo(href)` pops to `href` when it is on the stack and replaces the current
   * screen with it when it is not — which is what makes a deep-linked module child return
   * to its module home instead of exiting the app.
   */
  dismissTo: jest.fn(),
  dismissAll: jest.fn(),
  canDismiss: jest.fn(() => true),
  setParams: jest.fn(),
};

// Fonts: in tests the faces are always "loaded", so components render with their
// real styles instead of being gated behind a readiness flag.
jest.mock('expo-font', () => ({
  ...jest.requireActual('expo-font'),
  useFonts: () => [true, null],
  isLoaded: () => true,
  loadAsync: () => Promise.resolve(),
}));

// Safe area: the real provider renders nothing until it measures native insets,
// which never happens in jsdom. The library ships an official mock that supplies
// zero insets synchronously, so components under test actually render.
jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual('react-native-safe-area-context/jest/mock').default,
);

// Splash screen: no native module in the test environment.
jest.mock('expo-splash-screen', () => ({
  preventAutoHideAsync: () => Promise.resolve(),
  hideAsync: () => Promise.resolve(),
  setOptions: () => undefined,
}));

// AsyncStorage: the library ships an official in-memory mock. Without it any module that
// reaches the persistence boundary fails at import time, not at call time.
jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

/**
 * Application metadata: the values a real install reports.
 *
 * `expo-application` reads the installed package — `versionName` and `versionCode` on Android.
 * There is no installed package under Jest, so the module is stood in with the values the current
 * Android build actually declares. That makes the Help & Support suite a test of *what the screen
 * does with the numbers it is given*, which is the part this project owns; that the numbers are
 * real on a device is the responsibility of the library, and is verified on the device pass.
 */
jest.mock('expo-application', () => ({
  nativeApplicationVersion: '1.0.0',
  nativeBuildVersion: '1',
}));

/**
 * Device: only the operating-system release, which is the one field the diagnostics allow-list
 * takes from this module. The model, brand and manufacturer are deliberately left undefined, so a
 * test would fail rather than quietly pass if one of them were ever read.
 */
jest.mock('expo-device', () => ({
  osVersion: '17',
}));

/**
 * Clipboard: an in-memory stand-in, so a test can read back what a screen copied.
 *
 * Which matters more here than usual — "the copied diagnostics contain no token and no email
 * address" is only a real assertion if the test can inspect the string that was actually written.
 */
jest.mock('expo-clipboard', () => {
  let contents = '';
  return {
    setStringAsync: (text: string) => {
      contents = text;
      return Promise.resolve(true);
    },
    getStringAsync: () => Promise.resolve(contents),
  };
});

/**
 * Secure store: an in-memory stand-in for the Keystore.
 *
 * `isAvailableAsync` resolves true so the token-writing path is exercised rather than skipped —
 * the session-storage tests need to observe that a token goes here and never to AsyncStorage.
 *
 * ── Why a token is seeded ───────────────────────────────────────────────────
 * The store starts holding an access token, so `AuthProvider` restores a session and screens
 * behind authentication render signed-in. That is the realistic precondition for those screens:
 * Main Home is only reachable with a session, and rendering it without one is a state the app
 * never produces. On a real device a fresh install has no token, so launch correctly resolves
 * to signed-out and routes into the entry flow.
 *
 * Entry-flow tests that need the signed-out path clear this key first.
 */
jest.mock('expo-secure-store', () => {
  const store = new Map<string, string>([['noorlife.auth.accessToken', 'jest-seeded-token']]);
  return {
    isAvailableAsync: () => Promise.resolve(true),
    getItemAsync: (key: string) => Promise.resolve(store.get(key) ?? null),
    setItemAsync: (key: string, value: string) => {
      store.set(key, value);
      return Promise.resolve();
    },
    deleteItemAsync: (key: string) => {
      store.delete(key);
      return Promise.resolve();
    },
  };
});

/**
 * Supabase configuration for tests.
 *
 * Set before any test module is imported, because `src/lib/supabase.ts` reads these at import time to
 * decide whether the backend is configured. Obvious non-secret placeholders — no real project is
 * contacted, since `createClient` itself is mocked below.
 */
process.env.EXPO_PUBLIC_SUPABASE_URL = 'http://localhost:54321';
process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'test-publishable-key';

/**
 * The `public.profiles` row the double serves, and the values it is restored to.
 *
 * Held outside the `jest.mock` factory so `beforeEach` can reset it. A write through the double
 * *mutates* this row — see the note on `from` below — which means a test that saves a new name and a
 * later test that expects the original one would otherwise interfere.
 *
 * The `mock` name prefix is required: `jest.mock` factories are hoisted above variable declarations,
 * and Jest only permits a factory to close over an out-of-scope variable when its name starts with
 * `mock`.
 */
const mockProfileRow: {
  id: string;
  full_name: string | null;
  avatar_url: string | null;
  onboarding_completed: boolean;
} = {
  id: 'test-user-id',
  full_name: 'Ahmed Al-Rashid',
  avatar_url: null,
  onboarding_completed: true,
};
const MOCK_PROFILE_DEFAULTS = { ...mockProfileRow };

/**
 * Supabase client double.
 *
 * Resolves a confirmed session for a demo user, which is the realistic precondition for any screen
 * behind authentication: Main Home is only reachable with one, and rendering it signed-out is a state
 * the app never produces. On a device with no `.env` the real client is null and launch correctly
 * resolves to signed-out, routing into the entry flow.
 *
 * Only the surface the service actually calls is implemented. A fuller fake would invite tests to
 * assert against the double rather than against our own code.
 */
jest.mock('@supabase/supabase-js', () => {
  const session = {
    /**
     * A session carries an access token, because the real one does and because one code path now
     * depends on it: `signOutEverywhere` reads the session before asking for a global sign-out,
     * since `supabase-js` skips the network entirely — and still answers `{ error: null }` — when
     * there is no token to present. A double without one would make that path look like the normal
     * case.
     */
    access_token: 'jest-session-access-token',
    user: {
      id: 'test-user-id',
      email: 'ahmed@example.com',
      email_confirmed_at: '2026-01-01T00:00:00Z',
      user_metadata: { full_name: 'Ahmed Al-Rashid' },
      /**
       * Where Supabase records the sign-in method.
       *
       * Deliberately *not* updated by a profile write, because the real backend does not update it
       * either: `user_metadata.full_name` is the copy taken at signup, and `public.profiles` is the
       * record from then on. Keeping the two able to disagree is what lets a test prove the app
       * prefers the durable row.
       */
      app_metadata: { provider: 'email' },
    },
  };
  return {
    createClient: () => ({
      auth: {
        getSession: () => Promise.resolve({ data: { session }, error: null }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => undefined } } }),
        signInWithPassword: () => Promise.resolve({ data: { session }, error: null }),
        signUp: () => Promise.resolve({ data: { session: null, user: session.user }, error: null }),
        signOut: () => Promise.resolve({ error: null }),
        resetPasswordForEmail: () => Promise.resolve({ error: null }),
        updateUser: () => Promise.resolve({ data: { user: session.user }, error: null }),
        resend: () => Promise.resolve({ error: null }),
        verifyOtp: () => Promise.resolve({ data: { session }, error: null }),
        exchangeCodeForSession: () => Promise.resolve({ data: { session }, error: null }),
        signInWithOAuth: () => Promise.resolve({ data: { url: null }, error: null }),
        signInWithIdToken: () => Promise.resolve({ data: { session }, error: null }),
      },
      /**
       * The query builder, as supabase-js actually shapes it.
       *
       * Every method returns the builder and the builder itself is thenable, which is what makes
       * `.from(t).update(v).eq('id', x)` awaitable — the real client works this way, and a double
       * whose `update` returned a bare promise made `.eq` a type error at runtime that only
       * survived because its one caller swallowed failures.
       *
       * ── Why a write actually writes ─────────────────────────────────────────
       * `update` applies the patch to the stored row, so a subsequent read returns what was
       * written. A double that accepted writes and then kept serving the old value would make
       * "Profile Home shows the new name without a restart" pass or fail for reasons that have
       * nothing to do with the app — the read would be stale no matter what the app did.
       */
      from: () => {
        const chain = {
          select: () => chain,
          eq: () => chain,
          update: (patch: Record<string, unknown>) => {
            Object.assign(mockProfileRow, patch);
            return chain;
          },
          // A copy, so a caller holding the result cannot mutate the stored row by accident.
          maybeSingle: () => Promise.resolve({ data: { ...mockProfileRow }, error: null }),
          then: (resolve: (value: { data: null; error: null }) => unknown) =>
            Promise.resolve(resolve({ data: null, error: null })),
        };
        return chain;
      },
    }),
  };
});

// Auth session: `makeRedirectUri` needs the expo-constants manifest, which jsdom has no equivalent of.
jest.mock('expo-auth-session', () => ({
  makeRedirectUri: () => 'noorlifeapp://',
}));

/**
 * Linking: the deep-link boundary, stood in with something a test can drive.
 *
 * ── Why this is global rather than per-suite ─────────────────────────────────
 * `AuthCallbackProvider` is inside `AppProviders`, so *every* suite that renders a screen now reaches
 * `getInitialURL` and `addEventListener` on mount. Left to the real module those are native calls with
 * no implementation under Jest: they resolved slowly and non-deterministically, and the two provider
 * suites measured on this machine went from 8.0 s to 13.0 s for no assertion's benefit.
 *
 * The default is the honest cold-start case — the app was **not** launched by a link — so no suite
 * inherits a pending callback it did not ask for. `mockLinking` is exported so the callback suites can
 * set a launch URL or fire a warm `url` event, which is the only way to test either on a machine that
 * cannot make Android send an intent.
 *
 * The `mock` name prefix is required: `jest.mock` factories are hoisted above variable declarations,
 * and Jest only permits a factory to close over an out-of-scope variable when its name starts with
 * `mock`.
 */
const mockLinkingInstance = {
  /** Handlers registered through `addEventListener('url', …)`, so a test can fire one. */
  urlHandlers: new Set<(event: { url: string }) => void>(),
  getInitialURL: jest.fn<Promise<string | null>, []>(() => Promise.resolve(null)),
  canOpenURL: jest.fn<Promise<boolean>, [string]>(() => Promise.resolve(true)),
  openURL: jest.fn<Promise<boolean>, [string]>(() => Promise.resolve(true)),
  openSettings: jest.fn<Promise<void>, []>(() => Promise.resolve()),
  createURL: jest.fn<string, [string]>((path: string) => `noorlifeapp://${path.replace(/^\//, '')}`),
  /** Delivers a warm-start URL to every registered handler. */
  emit(url: string) {
    for (const handler of mockLinkingInstance.urlHandlers) {
      handler({ url });
    }
  },
};

jest.mock('expo-linking', () => ({
  getInitialURL: () => mockLinkingInstance.getInitialURL(),
  canOpenURL: (url: string) => mockLinkingInstance.canOpenURL(url),
  openURL: (url: string) => mockLinkingInstance.openURL(url),
  openSettings: () => mockLinkingInstance.openSettings(),
  createURL: (path: string) => mockLinkingInstance.createURL(path),
  addEventListener: (_type: string, handler: (event: { url: string }) => void) => {
    mockLinkingInstance.urlHandlers.add(handler);
    return {
      remove: () => {
        mockLinkingInstance.urlHandlers.delete(handler);
      },
    };
  },
}));

/** Exposed so the callback suites can simulate a cold-start launch URL and a warm `url` event. */
export const mockLinking = mockLinkingInstance;

// Apple authentication: unavailable in the test environment, which is also the Android behaviour.
jest.mock('expo-apple-authentication', () => ({
  isAvailableAsync: () => Promise.resolve(false),
  signInAsync: () => Promise.reject(new Error('unavailable')),
  AppleAuthenticationButton: () => null,
  AppleAuthenticationButtonType: { CONTINUE: 2 },
  AppleAuthenticationButtonStyle: { WHITE_OUTLINE: 1 },
  AppleAuthenticationScope: { FULL_NAME: 0, EMAIL: 1 },
}));

// Router: navigation is asserted by inspecting the shared double above.
jest.mock('expo-router', () => ({
  useRouter: () => mockRouterInstance,
  useLocalSearchParams: () => ({}),
  useGlobalSearchParams: () => ({}),
  usePathname: () => '/home',
  useSegments: () => [],
  useFocusEffect: () => undefined,
  /**
   * `Redirect` renders an observable marker rather than nothing.
   *
   * It used to render `null`, which made a redirect indistinguishable from a screen that rendered
   * nothing — and the entry gate's whole job is choosing a destination. The rule Phase 6C-3C has to
   * guarantee ("a cold-start callback resolves to `/auth/callback` *instead of* Main Home") is a
   * statement about which href the gate produced, so the href has to be readable.
   *
   * A `View` with the href as its accessibility label, so a test reads a prop rather than parsing a
   * rendered string. Nothing navigates: this is the whole of the stand-in.
   */
  Redirect: ({ href }: { readonly href?: unknown }) =>
    // `jest.requireActual` rather than a bare `require`: a `jest.mock` factory may not close over an
    // out-of-scope import, and this keeps the file free of `require()`-style imports.
    jest
      .requireActual<typeof import('react')>('react')
      .createElement(jest.requireActual<typeof import('react-native')>('react-native').View, {
        testID: 'router-redirect',
        accessibilityLabel: typeof href === 'string' ? href : JSON.stringify(href),
      }),
  Link: ({ children }: { readonly children?: unknown }) => children,
  Stack: () => null,
  Tabs: () => null,
  router: mockRouterInstance,
}));

/** Exposed so tests can assert navigation. */
export const mockRouter = mockRouterInstance;

beforeEach(() => {
  for (const value of Object.values(mockRouterInstance)) {
    value.mockClear();
  }
  // The profile row is writable, so it is restored between tests.
  Object.assign(mockProfileRow, MOCK_PROFILE_DEFAULTS);

  /**
   * Linking is restored to "the app was not launched by a link".
   *
   * A launch URL set by one test would otherwise give the next one a pending callback it never asked
   * for — and because the provider deduplicates by code, the symptom would be a test that passes
   * alone and fails in sequence. The handler set is cleared too: an unmounted provider's listener is
   * removed by its own effect, but a test that throws mid-render never gets there.
   */
  mockLinkingInstance.getInitialURL.mockReset();
  mockLinkingInstance.getInitialURL.mockResolvedValue(null);
  mockLinkingInstance.canOpenURL.mockClear();
  mockLinkingInstance.openURL.mockClear();
  mockLinkingInstance.openSettings.mockClear();
  mockLinkingInstance.urlHandlers.clear();
});
