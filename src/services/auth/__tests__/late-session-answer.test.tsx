import { act, fireEvent, render } from '@testing-library/react-native';
import { AppState, Text, type AppStateStatus } from 'react-native';

import {
  AuthProvider,
  useAuth,
  useAuthActions,
  SESSION_RESOLUTION_TIMEOUT_MS,
} from '@application/providers/auth-provider';
import { createFakeConnectivity } from '@/test-support/fake-connectivity-port';
import type { ConnectivityState } from '@features/faith/data/connectivity/connectivity.port';

/**
 * **A refresh that lands after the launch has moved on** — issue #130.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── The division this file exists to pin ───────────────────────────────────
 * `getSession()` awaits the auth client's memoised `initializePromise`, and on a degraded link that
 * initialization was measured running for **130,645 ms** with every caller parked behind it. The
 * launch bound therefore cannot end the request — only the wait. The request keeps going and its
 * real answer arrives long after the launch concluded, which is deliberate: it is how a remote
 * sign-out still reaches a device that has been opening its own downloaded content from a receipt.
 *
 * What that late answer may do is the whole question, and it was under-specified. The guard was
 * authority-shaped — "nothing newer has spoken" — and an offline session is `authority: 'offline'`
 * whoever it belongs to. So a late `authenticated` for one account satisfied it while a *different*
 * account was signed in offline, and 130 s is long enough to switch accounts in.
 *
 * ── Why these cases and not others ─────────────────────────────────────────
 * A never-resolving refresh, one that resolves inside the bound, the latch clearing, and recovery on
 * a later attempt are all already covered by `link-only-revalidation.test.tsx` for #124, and are not
 * duplicated here. A rejection is covered there too — and separately by
 * `offline-session-resolution.test.ts`, which owns the classification table. What was uncovered is
 * the *late* branch: completion after the bound, and what it is allowed to overwrite.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const OWNER = {
  id: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa',
  email: 'owner@example.com',
  fullName: 'Owner Person',
  avatarUrl: null,
  emailConfirmed: true,
};

const OTHER = {
  id: 'cccccccc-3333-4333-8333-cccccccccccc',
  email: 'other@example.com',
  fullName: 'Other Person',
  avatarUrl: null,
  emailConfirmed: true,
};

const mockResolveSession = jest.fn();
const mockGetProfile = jest.fn();
const mockSignOut = jest.fn();
const mockSubscribe = jest.fn();

jest.mock('@services/auth/auth.service', () => ({
  resolveSession: (...args: unknown[]) => mockResolveSession(...args),
  getProfile: (...args: unknown[]) => mockGetProfile(...args),
  signOut: (...args: unknown[]) => mockSignOut(...args),
  subscribeToAuthChanges: (listener: (change: never) => void) => mockSubscribe(listener),
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
const mockSecureDelete = jest.fn();
jest.mock('expo-secure-store', () => ({
  getItemAsync: (...args: unknown[]) => mockSecureGet(...args),
  setItemAsync: jest.fn(),
  deleteItemAsync: (...args: unknown[]) => mockSecureDelete(...args),
}));

/** A link exists and will not answer — the condition that makes the bound fire. */
const LINK_ONLY: ConnectivityState = {
  isConnected: true,
  reachability: 'link-only',
  kind: 'wifi',
  isWifi: false,
  isMetered: false,
};

function receipt(userId: string, displayName: string) {
  return JSON.stringify({
    version: 1,
    userId,
    displayName,
    avatarUrl: null,
    hasCompletedOnboarding: true,
    validatedAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
  });
}

/** Reports identity as well as authority: the account is the thing under test. */
function Probe() {
  const { status, authority, user } = useAuth();
  const { signOut } = useAuthActions();
  return (
    <>
      <Text testID="probe">{`${status}:${authority ?? 'none'}:${user?.id ?? 'none'}`}</Text>
      {/* So a deliberate sign-out can happen *while* the refresh is still in flight. */}
      <Text
        testID="sign-out"
        onPress={() => {
          void signOut();
        }}
      >
        sign out
      </Text>
    </>
  );
}

/** The in-flight refresh, settled by the test rather than by a clock. */
function deferred<T>() {
  let settle: (value: T) => void = () => undefined;
  const promise = new Promise<T>((resolveIt) => {
    settle = resolveIt;
  });
  return { promise, settle };
}

let appStateListener: ((next: AppStateStatus) => void) | null = null;

beforeEach(() => {
  jest.useFakeTimers();
  mockResolveSession.mockReset();
  mockGetProfile.mockReset().mockResolvedValue(null);
  mockSignOut.mockReset().mockResolvedValue(undefined);
  mockSubscribe.mockReset().mockReturnValue(() => undefined);
  mockSecureGet.mockReset().mockResolvedValue(receipt(OWNER.id, 'Owner Person'));
  mockSecureDelete.mockReset().mockResolvedValue(undefined);
  appStateListener = null;
  jest
    .spyOn(AppState, 'addEventListener')
    .mockImplementation((_event: string, handler: (next: AppStateStatus) => void) => {
      appStateListener = handler;
      return { remove: () => undefined } as never;
    });
});

afterEach(() => {
  jest.runOnlyPendingTimers();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

async function flush(times = 12): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    await Promise.resolve();
  }
}

async function launch() {
  const connectivity = createFakeConnectivity(LINK_ONLY);
  const view = await render(
    <AuthProvider connectivity={connectivity}>
      <Probe />
    </AuthProvider>,
  );
  return view;
}

/** Past the connectivity probe and then the resolution bound, flushing between. */
async function passTheBound() {
  await act(async () => {
    await flush();
    jest.advanceTimersByTime(2100);
    await flush();
    jest.advanceTimersByTime(SESSION_RESOLUTION_TIMEOUT_MS + 100);
    await flush();
  });
}

function shown(view: Awaited<ReturnType<typeof launch>>): string {
  return String(view.getByTestId('probe').props.children);
}

describe('a refresh that completes after the launch bound', () => {
  it('upgrades the same account from offline to online authority', async () => {
    const inFlight = deferred<{ kind: 'authenticated'; user: typeof OWNER }>();
    mockResolveSession.mockReturnValue(inFlight.promise);

    const view = await launch();
    await passTheBound();
    /* The receipt opened the owner's own content while the request was still running. */
    expect(shown(view)).toBe(`signed-in:offline:${OWNER.id}`);

    inFlight.settle({ kind: 'authenticated', user: OWNER });
    await act(async () => {
      await flush();
    });

    /*
      The answer this launch was waiting for, arriving late. It is the same account, so it completes
      the conclusion the launch reached without it rather than replacing it.
    */
    expect(shown(view)).toBe(`signed-in:online:${OWNER.id}`);
  });

  it('does not replace one account with another', async () => {
    /*
      The defect. The device is running offline as OWNER; the request still in flight was started
      before that was settled and answers for OTHER. The old guard asked only whether anything newer
      had spoken, and an offline session answers "no" whoever it belongs to — so OTHER was adopted
      over OWNER, silently, with OWNER's Faith data already open.
    */
    const inFlight = deferred<{ kind: 'authenticated'; user: typeof OTHER }>();
    mockResolveSession.mockReturnValue(inFlight.promise);

    const view = await launch();
    await passTheBound();
    expect(shown(view)).toBe(`signed-in:offline:${OWNER.id}`);

    inFlight.settle({ kind: 'authenticated', user: OTHER });
    await act(async () => {
      await flush();
    });

    /* Unchanged: still OWNER, still offline. A stale answer for somebody else is not news. */
    expect(shown(view)).toBe(`signed-in:offline:${OWNER.id}`);
  });

  it('still lets a verdict end offline access, which is how revocation arrives', async () => {
    /*
      The exemption that must survive the identity check. `no-session` is the server having looked
      and refused; suppressing it to protect the local session would make a receipt unrevocable for
      the life of the process. It carries no account of its own, so an identity test must not reject
      it by default.
    */
    const inFlight = deferred<{ kind: 'no-session' }>();
    mockResolveSession.mockReturnValue(inFlight.promise);

    const view = await launch();
    await passTheBound();
    expect(shown(view)).toBe(`signed-in:offline:${OWNER.id}`);

    inFlight.settle({ kind: 'no-session' });
    await act(async () => {
      await flush();
    });

    expect(shown(view)).toBe('signed-out:none:none');
    /* And the receipt is gone, so the next launch cannot reopen the account from it. */
    expect(mockSecureDelete).toHaveBeenCalled();
  });

  it('does not resurrect a session the user signed out of while it was in flight', async () => {
    /*
      The other half of the guard, and the one an identity test alone cannot cover: this late answer
      is for the *same* account, so only "has anything newer spoken?" can refuse it. A deliberate
      sign-out is the newest word there is, and a refresh that started before it must not undo it.
    */
    const inFlight = deferred<{ kind: 'authenticated'; user: typeof OWNER }>();
    mockResolveSession.mockReturnValue(inFlight.promise);

    const view = await launch();
    await passTheBound();
    expect(shown(view)).toBe(`signed-in:offline:${OWNER.id}`);

    await fireEvent.press(view.getByTestId('sign-out'));
    await act(async () => {
      await flush();
    });
    expect(shown(view)).toBe('signed-out:none:none');

    inFlight.settle({ kind: 'authenticated', user: OWNER });
    await act(async () => {
      await flush();
    });

    /* Still signed out. The user's own action outranks an answer to a question asked before it. */
    expect(shown(view)).toBe('signed-out:none:none');
  });

  it('leaves an established online session alone', async () => {
    /*
      A late answer may complete an unresolved launch or confirm the account in hand; it may not
      overwrite a session a server has already validated. Here the launch itself resolves online for
      OWNER, and a second attempt answers late for OTHER.
    */
    mockResolveSession.mockResolvedValueOnce({ kind: 'authenticated', user: OWNER });
    const view = await launch();
    await act(async () => {
      await flush();
    });
    expect(shown(view)).toBe(`signed-in:online:${OWNER.id}`);

    const late = deferred<{ kind: 'authenticated'; user: typeof OTHER }>();
    mockResolveSession.mockReturnValue(late.promise);
    await act(async () => {
      appStateListener?.('active');
      await flush();
    });
    late.settle({ kind: 'authenticated', user: OTHER });
    await act(async () => {
      await flush();
    });

    expect(shown(view)).toBe(`signed-in:online:${OWNER.id}`);
  });
});
