import { act, render } from '@testing-library/react-native';
import { AppState, Text } from 'react-native';

import {
  AuthProvider,
  SESSION_RESOLUTION_TIMEOUT_MS,
  useAuth,
} from '@application/providers/auth-provider';
import { createFakeConnectivity, WIFI_ONLINE } from '@/test-support/fake-connectivity-port';

/**
 * A slow launch interrupted by the app going away, or by the tree going away.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * These are the lifecycles that a launch with work still in flight can be caught by, and they became
 * relevant for the first time with issue #34: before, every await sat inside the one function that
 * then wrote state, so a launch could not be *partly* done. Now it can — the bound may have fired
 * while the session request is still running, and the profile read is always outstanding for a while.
 *
 * A separate file from the other suites deliberately, and Strict Mode is separate again in
 * `startup-authority-strict-mode.test.tsx`. Each case mounts the provider and drives a real launch,
 * and this project has no act environment: a Strict Mode render mounts twice, which overlapped this
 * file's act calls and left every later render in it unable to resolve. That looks exactly like a
 * defect in the provider and is not one — it is the harness, so the harness is kept apart.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const USER = {
  id: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa',
  email: 'a@example.com',
  fullName: 'Signup Name',
  avatarUrl: null,
  emailConfirmed: true,
};

const mockResolveSession = jest.fn();
const mockGetProfile = jest.fn();
const mockSubscribe = jest.fn();

jest.mock('@services/auth/auth.service', () => ({
  resolveSession: (...args: unknown[]) => mockResolveSession(...args),
  getProfile: (...args: unknown[]) => mockGetProfile(...args),
  subscribeToAuthChanges: (listener: (change: never) => void) => mockSubscribe(listener),
  signOut: jest.fn().mockResolvedValue(undefined),
  getSession: jest.fn(),
  signInWithEmail: jest.fn(),
  signUpWithEmail: jest.fn(),
  verifyOtp: jest.fn(),
  resendVerificationEmail: jest.fn(),
  sendPasswordReset: jest.fn(),
  updatePassword: jest.fn(),
  signInWithGoogle: jest.fn(),
  signInWithApple: jest.fn(),
  setOnboardingCompleted: jest.fn(),
}));

const mockSecureGet = jest.fn();
jest.mock('expo-secure-store', () => ({
  getItemAsync: (...args: unknown[]) => mockSecureGet(...args),
  setItemAsync: jest.fn().mockResolvedValue(undefined),
  deleteItemAsync: jest.fn().mockResolvedValue(undefined),
}));

function receiptJson() {
  return JSON.stringify({
    version: 1,
    userId: USER.id,
    displayName: 'Durable Name',
    avatarUrl: null,
    hasCompletedOnboarding: true,
    validatedAt: 0,
    updatedAt: 0,
  });
}

function deferred<T>() {
  let settle: (value: T) => void = () => undefined;
  const promise = new Promise<T>((resolveIt) => {
    settle = resolveIt;
  });
  return { promise, settle };
}

function Probe() {
  const state = useAuth();
  return <Text testID="probe">{`${state.status}:${state.authority ?? 'none'}`}</Text>;
}

function tree() {
  return (
    <AuthProvider connectivity={createFakeConnectivity(WIFI_ONLINE)}>
      <Probe />
    </AuthProvider>
  );
}

async function settle(ms = 0) {
  await act(async () => {
    if (ms > 0) {
      jest.advanceTimersByTime(ms);
    }
    for (let i = 0; i < 40; i += 1) {
      await Promise.resolve();
    }
  });
}

let appStateListeners: ((status: string) => void)[] = [];

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(0);
  mockResolveSession.mockReset();
  mockGetProfile.mockReset().mockResolvedValue(null);
  mockSubscribe.mockReset().mockReturnValue(() => undefined);
  mockSecureGet.mockReset().mockResolvedValue(null);
  appStateListeners = [];
  jest.spyOn(AppState, 'addEventListener').mockImplementation(((
    _event: string,
    listener: (status: string) => void,
  ) => {
    appStateListeners.push(listener);
    return { remove: jest.fn() };
  }) as unknown as typeof AppState.addEventListener);
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe('the app going away mid-launch', () => {
  it('keeps the receipt-adopted authority across a background and foreground', async () => {
    const session = deferred<{ kind: 'retryable-offline' }>();
    mockResolveSession.mockReturnValue(session.promise);
    mockSecureGet.mockResolvedValue(receiptJson());

    const view = await render(tree());
    await settle(SESSION_RESOLUTION_TIMEOUT_MS);
    expect(view.getByTestId('probe').props.children).toBe('signed-in:offline');

    await act(async () => {
      for (const listener of [...appStateListeners]) {
        listener('background');
      }
      await Promise.resolve();
    });
    await settle();

    /*
      Backgrounding is not a verdict either. The offline authority the bound reached must survive it —
      losing it here would drop a user back to an unresolved launch for switching apps.
    */
    expect(view.getByTestId('probe').props.children).toBe('signed-in:offline');

    session.settle({ kind: 'retryable-offline' });
    await settle();
    expect(view.getByTestId('probe').props.children).toBe('signed-in:offline');
  });

  it('lets a foreground recover online authority after a bounded offline launch', async () => {
    mockResolveSession
      .mockReturnValueOnce(deferred<never>().promise)
      .mockResolvedValue({ kind: 'authenticated', user: USER });
    mockSecureGet.mockResolvedValue(receiptJson());

    const view = await render(tree());
    await settle(SESSION_RESOLUTION_TIMEOUT_MS);
    expect(view.getByTestId('probe').props.children).toBe('signed-in:offline');

    await act(async () => {
      for (const listener of [...appStateListeners]) {
        listener('active');
      }
      await Promise.resolve();
    });
    await settle();

    /*
      The existing recovery trigger, unchanged and still reached from an authority the bound produced.
      A bounded launch is not a dead end: the app upgrades itself the moment the server answers, by
      the same route an airplane-mode launch already used.
    */
    expect(view.getByTestId('probe').props.children).toBe('signed-in:online');
  });
});

/*
  ── Order matters in this file, and that is a harness fact ──────────────────
  The unmount case settles a promise *after* tearing its tree down, which leaves the act environment
  unable to resolve renders that come after it — every later test in the file then failed to find its
  probe, which reads as a provider defect and is not one. It runs last so nothing follows it. This
  project has no act environment; the same trap costs a suite once per feature until it is written
  down, so it is written down.
*/
describe('a launch whose tree goes away', () => {
  it('abandons a slow launch on unmount without adopting anything', async () => {
    const slow = deferred<{ kind: 'authenticated'; user: typeof USER }>();
    mockResolveSession.mockReturnValue(slow.promise);
    mockSecureGet.mockResolvedValue(receiptJson());

    const view = await render(tree());
    await settle();
    expect(view.getByTestId('probe').props.children).toBe('unknown:none');

    view.unmount();
    slow.settle({ kind: 'authenticated', user: USER });
    await settle(SESSION_RESOLUTION_TIMEOUT_MS * 2);

    /*
      Observed through the profile read rather than through a second tree: `adopt` is the only caller
      of `getProfile`, so a never-called `getProfile` is proof that no adoption happened after the
      provider went away. Mounting a second tree in the same test to check this instead overlaps act —
      there is no act environment here — and every later render in the file then fails to resolve,
      which reads as a provider defect and is only ever a harness one.
    */
    expect(mockGetProfile).not.toHaveBeenCalled();
  });
});
