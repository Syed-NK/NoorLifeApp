/**
 * Jest setup for NoorLife.
 *
 * Only the native/host boundaries are mocked. Nothing in the design system,
 * module themes or feature code is mocked — those are the things under test.
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
  Redirect: () => null,
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
});
