import { act, render, waitFor } from '@testing-library/react-native';
import { AppState, Text } from 'react-native';

import { AuthProvider, useAuth } from '@application/providers/auth-provider';
import { STARTUP_PRESENTATION_CEILING_MS } from '@application/startup/startup-machine';
import { OFFLINE_RECEIPT_KEY_FOR_TESTS } from '@services/auth/offline-receipt';
import { isServerValidatedAuthEvent } from '@services/auth/session-resolution';
import {
  CELLULAR_ONLINE,
  createFakeConnectivity,
  WIFI_CAPTIVE,
  WIFI_ONLINE,
} from '@/test-support/fake-connectivity-port';
import type { ConnectivityState } from '@features/faith/data/connectivity/connectivity.port';

/**
 * The launch decisions that airplane mode actually exercises.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── Written after the device disagreed with the unit tests ─────────────────
 * Every case below corresponds to something observed on a real emulator against a release build,
 * not to something imagined at a whiteboard. The previous suite passed while the device showed
 * Authentication Options to a signed-in user holding 3,158 downloaded files, so the standard here
 * is "would this have failed then".
 *
 * Three separate defects were found, and each has its own describe block:
 *   1. `INITIAL_SESSION` upgrading a token-free offline launch to `authority: 'online'`;
 *   2. the 4 s startup ceiling firing ~300 ms before the offline resolution landed;
 *   3. a link that reports `isConnected: true` while nothing is reachable.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const USER = {
  id: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa',
  email: 'a@example.com',
  fullName: 'A Person',
  avatarUrl: null,
  emailConfirmed: true,
};

const mockResolveSession = jest.fn();
const mockGetProfile = jest.fn();
const mockSignOut = jest.fn();
const mockSubscribe = jest.fn();
/** The listener the provider registered, so a test can fire a Supabase event at it. */
let emitAuthEvent: ((change: { event: string; user: typeof USER | null }) => void) | null = null;

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
const mockSecureSet = jest.fn();
const mockSecureDelete = jest.fn();
jest.mock('expo-secure-store', () => ({
  getItemAsync: (...args: unknown[]) => mockSecureGet(...args),
  setItemAsync: (...args: unknown[]) => mockSecureSet(...args),
  deleteItemAsync: (...args: unknown[]) => mockSecureDelete(...args),
}));

/** A stored receipt exactly as the current build writes one. */
function validReceipt(userId = USER.id) {
  return JSON.stringify({
    version: 1,
    userId,
    displayName: 'A Person',
    avatarUrl: null,
    hasCompletedOnboarding: true,
    validatedAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
  });
}

/**
 * Airplane mode as the emulator actually reports it.
 *
 * `isConnected: true` with a Wi-Fi type and **no reachability** — which is why a gate written as
 * `isConnected === false` never fires. This is measured behaviour, not a hypothetical.
 */
const AIRPLANE_WITH_LINK: ConnectivityState = {
  isConnected: true,
  reachability: 'link-only',
  kind: 'wifi',
  isWifi: false,
  isMetered: false,
};

const TRUE_OFFLINE: ConnectivityState = {
  isConnected: false,
  reachability: 'offline',
  kind: 'none',
  isWifi: false,
  isMetered: false,
};

function Probe() {
  const { status, authority } = useAuth();
  return <Text testID="probe">{`${status}:${authority ?? 'none'}`}</Text>;
}

async function launch(connectivity: ReturnType<typeof createFakeConnectivity>) {
  return await render(
    <AuthProvider connectivity={connectivity}>
      <Probe />
    </AuthProvider>,
  );
}

function retryableFailure() {
  return { kind: 'retryable-offline' as const };
}

beforeEach(() => {
  mockResolveSession.mockReset();
  mockGetProfile.mockReset().mockResolvedValue(null);
  mockSignOut.mockReset().mockResolvedValue(undefined);
  emitAuthEvent = null;
  mockSubscribe.mockReset().mockImplementation((listener: typeof emitAuthEvent) => {
    emitAuthEvent = listener;
    return () => undefined;
  });
  mockSecureGet.mockReset().mockResolvedValue(validReceipt());
  mockSecureSet.mockReset().mockResolvedValue(undefined);
  mockSecureDelete.mockReset().mockResolvedValue(undefined);
});

describe('an offline authority is never upgraded without a server', () => {
  it('ignores INITIAL_SESSION, which is a disk read rather than a server answer', async () => {
    /*
      ── The exact device observation this pins ───────────────────────────────
      The diagnostic sequence in airplane mode read
      `adoption=adopted authority=offline authority=online`. `onAuthStateChange` emits
      `INITIAL_SESSION` on subscribe carrying the stored session, the old handler adopted any
      non-null user as online, and a token-free launch became one that `isOnlineAuthenticated`
      reports as live — opening Content Sync, the Qur'an Edge function and every profile write on a
      device with no route to any of them.
    */
    mockResolveSession.mockResolvedValue(retryableFailure());
    const { getByTestId } = await launch(createFakeConnectivity(AIRPLANE_WITH_LINK));
    await waitFor(() => expect(getByTestId('probe')).toHaveTextContent('signed-in:offline'));

    /*
      Wrapped in an async `act` so every promise the handler could start is flushed before the
      assertion. A bare `waitFor` passes on the very first tick — the state is still offline at
      that instant — so it went green even with the guard removed, which the mutation run caught.
      The assertion after the flush is the one that actually distinguishes the two behaviours.
    */
    await act(async () => {
      emitAuthEvent?.({ event: 'INITIAL_SESSION', user: USER });
    });

    /* Still offline. A replay of local storage is not evidence of a server. */
    expect(getByTestId('probe')).toHaveTextContent('signed-in:offline');
  });

  it('does adopt a genuine server event', async () => {
    /* The other half: a gate that never opens would be just as wrong. */
    mockResolveSession.mockResolvedValue(retryableFailure());
    const { getByTestId } = await launch(createFakeConnectivity(AIRPLANE_WITH_LINK));
    await waitFor(() => expect(getByTestId('probe')).toHaveTextContent('signed-in:offline'));

    await act(async () => {
      emitAuthEvent?.({ event: 'TOKEN_REFRESHED', user: USER });
    });
    await waitFor(() => expect(getByTestId('probe')).toHaveTextContent('signed-in:online'));
  });

  it('classifies exactly the events that imply a round trip', () => {
    expect(isServerValidatedAuthEvent('SIGNED_IN')).toBe(true);
    expect(isServerValidatedAuthEvent('TOKEN_REFRESHED')).toBe(true);
    expect(isServerValidatedAuthEvent('USER_UPDATED')).toBe(true);
    expect(isServerValidatedAuthEvent('INITIAL_SESSION')).toBe(false);
    expect(isServerValidatedAuthEvent('PASSWORD_RECOVERY')).toBe(false);
  });
});

describe('a link that reports connected but reaches nothing', () => {
  it('adopts the receipt when airplane mode still says isConnected: true', async () => {
    /*
      The gate cannot be `isConnected === false`. On the emulator, airplane mode leaves
      `isConnected: true` with a Wi-Fi type, so the launch takes the network path — and must still
      end up offline-authenticated once the request fails.
    */
    mockResolveSession.mockResolvedValue(retryableFailure());
    const { getByTestId } = await launch(createFakeConnectivity(AIRPLANE_WITH_LINK));

    await waitFor(() => expect(getByTestId('probe')).toHaveTextContent('signed-in:offline'));
    expect(mockResolveSession).toHaveBeenCalled();
  });

  it('skips the request entirely when the platform is definitely offline', async () => {
    mockResolveSession.mockResolvedValue(retryableFailure());
    const { getByTestId } = await launch(createFakeConnectivity(TRUE_OFFLINE));

    await waitFor(() => expect(getByTestId('probe')).toHaveTextContent('signed-in:offline'));
    expect(mockResolveSession).not.toHaveBeenCalled();
  });

  it.each([
    ['a DNS failure', 'TypeError'],
    ['a timeout', 'AbortError'],
    ['a retryable fetch failure', 'AuthRetryableFetchError'],
  ])('adopts the receipt after %s', async (_label, errorName) => {
    const error = new Error('unused');
    error.name = errorName;
    mockResolveSession.mockResolvedValue(retryableFailure());

    const { getByTestId } = await launch(createFakeConnectivity(AIRPLANE_WITH_LINK));
    await waitFor(() => expect(getByTestId('probe')).toHaveTextContent('signed-in:offline'));
    /* And the receipt survives — a retryable failure is not a verdict. */
    expect(mockSecureDelete).not.toHaveBeenCalled();
  });
});

describe('a terminal verdict outranks the receipt', () => {
  it('signs out and deletes the receipt when the server rejects the session', async () => {
    mockResolveSession.mockResolvedValue({ kind: 'invalid-or-revoked' });
    const { getByTestId } = await launch(createFakeConnectivity(WIFI_ONLINE));

    await waitFor(() => expect(getByTestId('probe')).toHaveTextContent('signed-out:none'));
    expect(mockSecureDelete).toHaveBeenCalledWith(OFFLINE_RECEIPT_KEY_FOR_TESTS);
  });

  it('does not let a valid receipt hide a no-session verdict', async () => {
    mockResolveSession.mockResolvedValue({ kind: 'no-session' });
    const { getByTestId } = await launch(createFakeConnectivity(WIFI_ONLINE));

    await waitFor(() => expect(getByTestId('probe')).toHaveTextContent('signed-out:none'));
    expect(mockSecureDelete).toHaveBeenCalled();
  });
});

describe('SecureStore failures', () => {
  it('does not sign the user out and does not delete anything when the read throws', async () => {
    /*
      A throw is "could not read", not "there is no receipt". Deleting on it would destroy the one
      record that makes the *next* launch work, for a reason that may be transient.
    */
    mockSecureGet.mockRejectedValue(new Error('keystore busy'));
    mockResolveSession.mockResolvedValue(retryableFailure());

    const { getByTestId } = await launch(createFakeConnectivity(AIRPLANE_WITH_LINK));
    await waitFor(() => expect(getByTestId('probe')).toHaveTextContent('signed-out:none'));
    expect(mockSecureDelete).not.toHaveBeenCalled();
  });

  it('recovers on the next launch once the read succeeds again', async () => {
    /*
      The bounded, deterministic recovery: no retry loop, no sleep, no plaintext fallback — the next
      launch simply reads again. A transient Keystore failure therefore costs one launch of offline
      access and nothing durable.
    */
    mockSecureGet.mockRejectedValueOnce(new Error('keystore busy'));
    mockResolveSession.mockResolvedValue(retryableFailure());
    const first = await launch(createFakeConnectivity(AIRPLANE_WITH_LINK));
    await waitFor(() => expect(first.getByTestId('probe')).toHaveTextContent('signed-out:none'));
    await first.unmount();

    const second = await launch(createFakeConnectivity(AIRPLANE_WITH_LINK));
    await waitFor(() => expect(second.getByTestId('probe')).toHaveTextContent('signed-in:offline'));
  });
});

describe('receipts that must fail closed', () => {
  it.each([
    ['a corrupt record', '{not json'],
    ['an unsupported version', JSON.stringify({ version: 99, userId: 'x' })],
    [
      'a forbidden email field',
      JSON.stringify({
        version: 1,
        userId: 'u',
        displayName: 'n',
        avatarUrl: null,
        email: 'a@example.com',
        hasCompletedOnboarding: true,
        validatedAt: 1,
        updatedAt: 1,
      }),
    ],
  ])('refuses %s and removes it', async (_label, stored) => {
    mockSecureGet.mockResolvedValue(stored);
    mockResolveSession.mockResolvedValue(retryableFailure());

    const { getByTestId } = await launch(createFakeConnectivity(AIRPLANE_WITH_LINK));
    await waitFor(() => expect(getByTestId('probe')).toHaveTextContent('signed-out:none'));
    expect(mockSecureDelete).toHaveBeenCalledWith(OFFLINE_RECEIPT_KEY_FOR_TESTS);
  });

  it('adopts only the user the receipt names', async () => {
    mockSecureGet.mockResolvedValue(validReceipt('bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb'));
    mockResolveSession.mockResolvedValue(retryableFailure());

    const { getByTestId } = await launch(createFakeConnectivity(AIRPLANE_WITH_LINK));
    await waitFor(() => expect(getByTestId('probe')).toHaveTextContent('signed-in:offline'));
    /* One record, one identity — there is no collection a second user could be read out of. */
    expect(mockSecureGet).toHaveBeenCalledWith(OFFLINE_RECEIPT_KEY_FOR_TESTS);
  });
});

describe('the startup ceiling', () => {
  it('is wider than a measured cold offline launch', () => {
    /*
      Measured on the emulator against a release build: the offline resolution lands at roughly
      4.3 s from splash mount. The old ceiling was 4,000 ms, so it fired first, routed to
      authentication assuming signed-out, and froze there — the user-visible blocker.

      Asserted as a number rather than a comment so that lowering it back under the measurement is a
      test failure rather than a regression somebody discovers on a plane.
    */
    expect(STARTUP_PRESENTATION_CEILING_MS).toBeGreaterThanOrEqual(8000);
  });
});

/**
 * Getting back online, which is the half the first round never covered.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── Observed on the emulator, after the launch defects were fixed ──────────
 * Launch in airplane mode, then turn airplane mode **off**. `ping 8.8.8.8` answers from the device,
 * and the app stays offline for the rest of the process: the reader keeps rendering
 * `faith-reader-body-offline`, Verse of the day keeps saying it could not be loaded, and the "Try
 * again" button the product itself offers does nothing. Backgrounding and reopening does not help
 * either. Only force-quitting recovers it.
 *
 * The launch fixes made offline access *work*; nothing made it *end*. `authority` had one writer —
 * `resolveLaunch`, on mount — and `setRemoteAccessAuthorised` mirrors it, so every remote read in
 * the app stayed gated shut until Supabase's own refresh timer happened to fire.
 *
 * These cases are the recovery, and each is written against what the device actually did.
 * ═══════════════════════════════════════════════════════════════════════════
 */
describe('recovering online authority when the connection comes back', () => {
  let appStateListeners: ((status: string) => void)[] = [];
  let appStateRemovals: jest.Mock[] = [];

  beforeEach(() => {
    appStateListeners = [];
    appStateRemovals = [];
    jest.spyOn(AppState, 'addEventListener').mockImplementation(((
      _event: string,
      listener: (status: string) => void,
    ) => {
      appStateListeners.push(listener);
      const remove = jest.fn();
      appStateRemovals.push(remove);
      return { remove };
    }) as unknown as typeof AppState.addEventListener);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  /** Brings the app to the foreground, as the platform would. */
  async function foreground(): Promise<void> {
    await act(async () => {
      for (const listener of [...appStateListeners]) {
        listener('active');
      }
      await Promise.resolve();
    });
  }

  /** An offline-authority launch, which is the precondition for every case here. */
  async function launchOffline(initial: ConnectivityState = TRUE_OFFLINE) {
    mockResolveSession.mockResolvedValue(retryableFailure());
    const network = createFakeConnectivity(initial);
    const view = await launch(network);
    await waitFor(() => expect(view.getByTestId('probe')).toHaveTextContent('signed-in:offline'));
    return { network, view };
  }

  it('upgrades to online authority when airplane mode is turned off', async () => {
    /* The exact device sequence: launch with no link, then the link returns and reaches the server. */
    const { network, view } = await launchOffline();

    mockResolveSession.mockResolvedValue({ kind: 'authenticated', user: USER });
    await act(async () => {
      network.set(WIFI_ONLINE);
      await Promise.resolve();
    });

    await waitFor(() => expect(view.getByTestId('probe')).toHaveTextContent('signed-in:online'));
  });

  it('leaves the offline session untouched when the retry also fails to reach anyone', async () => {
    /*
      ── Why this asserts on the receipt read ─────────────────────────────────
      Re-running `resolveLaunch` would have been the obvious implementation, and it would pass a
      "still offline" assertion while calling `adoptOffline` and minting a fresh user object on every
      flap. Reading the receipt again is the observable trace of that rebuild, so its absence is what
      distinguishes "nothing was learned, so nothing was written" from "rewritten to the same value".
    */
    const { network, view } = await launchOffline();
    const before = mockResolveSession.mock.calls.length;
    mockSecureGet.mockClear();

    await act(async () => {
      network.set(WIFI_ONLINE);
      await Promise.resolve();
    });
    await waitFor(() => expect(mockResolveSession.mock.calls.length).toBeGreaterThan(before));

    expect(view.getByTestId('probe')).toHaveTextContent('signed-in:offline');
    expect(mockSecureGet).not.toHaveBeenCalled();
  });

  it('ends offline access when the server that finally answered refuses the credential', async () => {
    /*
      The retry is not allowed to be one-way. A receipt that could only ever be upgraded and never
      revoked would outlive a remote sign-out for as long as the process lived, which is the whole
      reason `invalid-or-revoked` is kept distinct from `retryable-offline`.
    */
    const { network, view } = await launchOffline();

    mockResolveSession.mockResolvedValue({ kind: 'invalid-or-revoked' });
    await act(async () => {
      network.set(WIFI_ONLINE);
      await Promise.resolve();
    });

    await waitFor(() => expect(view.getByTestId('probe')).toHaveTextContent('signed-out:none'));
    expect(mockSecureDelete).toHaveBeenCalledWith(OFFLINE_RECEIPT_KEY_FOR_TESTS);
  });

  it('recovers a launch that had a link but no server, where no transition will ever come', async () => {
    /*
      A captive portal, or a server that never answered. The device is *already* reachable when the
      trigger attaches, so waiting for a transition would wait forever — this is the case foreground
      exists for, and it is why one trigger is not enough.
    */
    const { view } = await launchOffline(WIFI_ONLINE);

    mockResolveSession.mockResolvedValue({ kind: 'authenticated', user: USER });
    await foreground();

    await waitFor(() => expect(view.getByTestId('probe')).toHaveTextContent('signed-in:online'));
  });

  it('makes no request on foreground while the device still has no link', async () => {
    /*
      Foreground is a frequent event. Without the local connectivity check it would put a request on
      the wire every time a user switched apps on a plane, each one guaranteed to fail.
    */
    const { view } = await launchOffline();
    const before = mockResolveSession.mock.calls.length;

    await foreground();

    expect(mockResolveSession.mock.calls.length).toBe(before);
    expect(view.getByTestId('probe')).toHaveTextContent('signed-in:offline');
  });

  it('treats a run of reachable events as one arrival', async () => {
    const { network } = await launchOffline();
    const before = mockResolveSession.mock.calls.length;

    await act(async () => {
      network.set(WIFI_ONLINE);
      network.set(WIFI_ONLINE);
      network.set(CELLULAR_ONLINE);
      await Promise.resolve();
    });
    await waitFor(() => expect(mockResolveSession.mock.calls.length).toBeGreaterThan(before));

    /* One transition into reachable, therefore one attempt — not one per event. */
    expect(mockResolveSession.mock.calls.length).toBe(before + 1);
  });

  it('stays quiet across reachable events that each settle before the next', async () => {
    /*
      ── Why this case exists beside the one above ────────────────────────────
      That one fires its events synchronously, so the in-flight guard alone collapses them and the
      test passes even with the transition check removed — which the mutation run caught, reporting
      the transition guard UNPROVEN.

      Separating the events by a settled attempt clears `inFlight` between them, so the only thing
      left that can suppress the second and third is the transition check itself. A platform that
      re-announces an unchanged reachable link — which is ordinary — must not produce a request per
      announcement.
    */
    const { network } = await launchOffline();
    const before = mockResolveSession.mock.calls.length;

    for (let round = 0; round < 3; round += 1) {
      await act(async () => {
        network.set(WIFI_ONLINE);
        await Promise.resolve();
      });
      /* Lets the attempt started by the first round actually settle. */
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
    }

    expect(mockResolveSession.mock.calls.length).toBe(before + 1);
  });

  it('does not treat a captive portal as the connection returning', async () => {
    /*
      `link-only` is a link that reaches nothing. Firing on it would mean a request per hotel Wi-Fi
      association, and `reachability === 'online'` rather than `isConnected` is what prevents it.
    */
    const { network, view } = await launchOffline();
    const before = mockResolveSession.mock.calls.length;

    await act(async () => {
      network.set(WIFI_CAPTIVE);
      await Promise.resolve();
    });

    expect(mockResolveSession.mock.calls.length).toBe(before);
    expect(view.getByTestId('probe')).toHaveTextContent('signed-in:offline');
  });

  it('attaches nothing at all when the launch reached the server', async () => {
    /*
      The cost of the recovery must be zero for the ordinary launch: no listener, and no second
      request. Asserted by holding the port and counting, because an absence cannot be observed any
      other way.
    */
    mockResolveSession.mockResolvedValue({ kind: 'authenticated', user: USER });
    const network = createFakeConnectivity(WIFI_ONLINE);
    const view = await launch(network);
    await waitFor(() => expect(view.getByTestId('probe')).toHaveTextContent('signed-in:online'));

    expect(network.subscriberCount()).toBe(0);
    expect(appStateListeners).toHaveLength(0);
  });

  it('detaches both triggers on unmount', async () => {
    const { network, view } = await launchOffline();
    expect(network.subscriberCount()).toBe(1);

    /*
      Wrapped and flushed. A bare `unmount()` returns before this environment has run the cleanup, so
      the count is still 1 at the next statement — the same missing-act-environment behaviour that
      makes a press after a `changeText` read stale state in this repo's other suites.
    */
    await act(async () => {
      await view.unmount();
      await Promise.resolve();
    });

    expect(network.subscriberCount()).toBe(0);
    expect(appStateRemovals.every((remove) => remove.mock.calls.length > 0)).toBe(true);
  });
});
