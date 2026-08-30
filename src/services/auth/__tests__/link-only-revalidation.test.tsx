import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { act, render, waitFor } from '@testing-library/react-native';
import { AppState, Text, type AppStateStatus } from 'react-native';

import {
  AuthProvider,
  useAuth,
  SESSION_RESOLUTION_TIMEOUT_MS,
} from '@application/providers/auth-provider';
import { isRemoteAccessAuthorised } from '@services/network/remote-access';
import { createFakeConnectivity } from '@/test-support/fake-connectivity-port';
import type { ConnectivityState } from '@features/faith/data/connectivity/connectivity.port';

/**
 * **A link that will not answer must not disable the app forever** — issue #124.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── The two premises this replaces, both measured wrong ────────────────────
 * The issue was filed claiming an unvalidated network was classified as offline. It is not:
 * `connectivity.port.ts` reports `link-only`, and the launch already falls through and asks. A
 * device trace confirmed both. The Supabase URL was not stale either, and a fresh sign-in ruled out
 * a stale session.
 *
 * ── What the device actually showed ────────────────────────────────────────
 * On a Wi-Fi link carrying traffic that Android would not validate, with the service reachable over
 * TCP 443, the application's own decisions were:
 *
 *     conn    { reachability: 'link-only', isConnected: true }      ← classifier correct
 *     launch  { supabaseConfigured: true, confirmedOffline: false } ← correctly tried
 *     raced   { timedOut: true }                                   ← the resolve never answered
 *     gate    { authorised: false }                                ← offline authority adopted
 *
 * then, on returning to the foreground:
 *
 *     attempt { starting: true } · reval-enter {}    … and nothing further, ever
 *     (second foreground: no attempt at all)
 *
 * `resolveSession` did not fail on that link — it **hung**. The revalidation awaited it unbounded,
 * so the retry never settled; and because the trigger clears its in-flight latch in `.finally()`,
 * the latch stayed set and every later foreground was swallowed. One unanswered socket disabled
 * every remote feature for the life of the process.
 *
 * ── What is asserted here ──────────────────────────────────────────────────
 * That a hang is survivable: the bound settles, the latch clears, and the next trigger is a real
 * attempt that can still recover online authority. Plus the copy, which claimed the user was offline
 * on a working connection.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const USER = {
  id: 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb',
  email: 'b@example.com',
  fullName: 'B Person',
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
jest.mock('expo-secure-store', () => ({
  getItemAsync: (...args: unknown[]) => mockSecureGet(...args),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

/** The device's own state: a link exists, Android will not validate it. */
const LINK_ONLY: ConnectivityState = {
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

function receipt(userId = USER.id) {
  return JSON.stringify({
    version: 1,
    userId,
    displayName: 'B Person',
    avatarUrl: null,
    hasCompletedOnboarding: true,
    validatedAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
  });
}

function Probe() {
  const { status, authority } = useAuth();
  return <Text testID="probe">{`${status}:${authority ?? 'none'}`}</Text>;
}

/** A promise that never settles — the device's hanging resolve, exactly. */
function hangs(): Promise<never> {
  return new Promise<never>(() => undefined);
}

let appStateListener: ((next: AppStateStatus) => void) | null = null;

beforeEach(() => {
  jest.useFakeTimers();
  mockResolveSession.mockReset();
  mockGetProfile.mockReset().mockResolvedValue(null);
  mockSignOut.mockReset().mockResolvedValue(undefined);
  mockSubscribe.mockReset().mockReturnValue(() => undefined);
  mockSecureGet.mockReset().mockResolvedValue(receipt());
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

async function launchOn(state: ConnectivityState) {
  const connectivity = createFakeConnectivity(state);
  /* Awaited: RNTL's render is async, and an un-awaited one leaves the provider's launch unmounted. */
  const view = await render(
    <AuthProvider connectivity={connectivity}>
      <Probe />
    </AuthProvider>,
  );
  return { view, connectivity };
}

/** Lets every queued microtask run. The launch chains several awaits before it reaches a timer. */
async function flush(times = 12): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    await Promise.resolve();
  }
}

/**
 * Advances past both bounds the launch races, flushing between them.
 *
 * Two, not one: `isConfirmedOffline` has its own 2 s race, and the resolution bound is only reached
 * after that has settled. Advancing straight to 6 s without flushing leaves the first race pending
 * and the second never armed.
 */
async function passTheBound() {
  await act(async () => {
    await flush();
    jest.advanceTimersByTime(2100);
    await flush();
    jest.advanceTimersByTime(SESSION_RESOLUTION_TIMEOUT_MS + 100);
    await flush();
  });
}

async function foreground() {
  await act(async () => {
    appStateListener?.('active');
    await flush();
  });
}

describe('a hanging resolve on a link-only network', () => {
  it('adopts offline authority at the launch bound rather than waiting forever', async () => {
    mockResolveSession.mockImplementation(hangs);
    const { view } = await launchOn(LINK_ONLY);
    await passTheBound();
    /*
      The bound is what keeps the launch moving. It is not a verdict — the receipt is what opens the
      user's own data, and the attempt is still outstanding.
    */
    await waitFor(() => expect(view.getByTestId('probe').props.children).toBe('signed-in:offline'));
    expect(isRemoteAccessAuthorised()).toBe(false);
  });

  it('still attempts, rather than skipping because Android withheld validation', async () => {
    mockResolveSession.mockImplementation(hangs);
    await launchOn(LINK_ONLY);
    await passTheBound();
    /* The whole premise of #124: link-only asks. It has always asked, and it must keep asking. */
    expect(mockResolveSession).toHaveBeenCalled();
  });

  it('lets a later foreground be a real attempt, not a swallowed one', async () => {
    mockResolveSession.mockImplementation(hangs);
    await launchOn(LINK_ONLY);
    await passTheBound();
    const afterLaunch = mockResolveSession.mock.calls.length;

    await foreground();
    await passTheBound();
    const afterFirstRetry = mockResolveSession.mock.calls.length;
    expect(afterFirstRetry).toBeGreaterThan(afterLaunch);

    /*
      The defect this file exists for. The first retry hung, its `.finally()` never ran, and the
      in-flight latch stayed set — so every foreground after it did nothing at all. Bounding the
      retry makes the promise settle either way, which is what frees the latch.
    */
    await foreground();
    await passTheBound();
    expect(mockResolveSession.mock.calls.length).toBeGreaterThan(afterFirstRetry);
  });

  it('recovers online authority when an attempt finally answers', async () => {
    mockResolveSession.mockImplementationOnce(hangs);
    const { view } = await launchOn(LINK_ONLY);
    await passTheBound();
    expect(view.getByTestId('probe').props.children).toBe('signed-in:offline');

    mockResolveSession.mockResolvedValue({ kind: 'authenticated', user: USER });
    await foreground();
    await act(async () => {
      await flush();
    });

    await waitFor(() => expect(view.getByTestId('probe').props.children).toBe('signed-in:online'));
    expect(isRemoteAccessAuthorised()).toBe(true);
  });

  it('does not publish anything merely because the bound elapsed', async () => {
    mockResolveSession.mockImplementation(hangs);
    const { view } = await launchOn(LINK_ONLY);
    await passTheBound();
    const afterLaunch = view.getByTestId('probe').props.children;
    await foreground();
    await passTheBound();
    /* A bound that runs out has learned nothing. Offline authority stands; it is not re-decided. */
    expect(view.getByTestId('probe').props.children).toBe(afterLaunch);
  });

  it('runs one attempt at a time', async () => {
    mockResolveSession.mockImplementation(hangs);
    await launchOn(LINK_ONLY);
    await passTheBound();
    const before = mockResolveSession.mock.calls.length;
    /* Three triggers with no bound elapsing between them are one attempt, not three. */
    await foreground();
    await foreground();
    await foreground();
    expect(mockResolveSession.mock.calls.length).toBe(before + 1);
  });
});

describe('a confirmed-offline device is still allowed to skip', () => {
  it('makes no backend call at launch', async () => {
    mockResolveSession.mockResolvedValue({ kind: 'authenticated', user: USER });
    await launchOn(TRUE_OFFLINE);
    await act(async () => {
      await flush();
    });
    /*
      Locked decision 7, untouched. A refresh with no route can only fail, and its failure would say
      nothing the port has not already said.
    */
    expect(mockResolveSession).not.toHaveBeenCalled();
  });

  it('makes no backend call on a foreground either', async () => {
    mockResolveSession.mockResolvedValue({ kind: 'authenticated', user: USER });
    await launchOn(TRUE_OFFLINE);
    await act(async () => {
      await flush();
    });
    await foreground();
    await act(async () => {
      await flush();
    });
    expect(mockResolveSession).not.toHaveBeenCalled();
  });
});

describe('the source keeps the corrected shape', () => {
  const PROVIDER = join(
    __dirname,
    '..',
    '..',
    '..',
    'application',
    'providers',
    'auth-provider.tsx',
  );
  const COPY = join(
    __dirname,
    '..',
    '..',
    '..',
    'features',
    'modules',
    'noor-ai',
    'noor-ai-chat-copy.ts',
  );
  const code = (path: string): string =>
    readFileSync(path, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');

  it('bounds the revalidation with the launch’s own constant', () => {
    const provider = code(PROVIDER);
    expect(provider).toContain(
      'const answer = await withBound(authService.resolveSession(), SESSION_RESOLUTION_TIMEOUT_MS)',
    );
    /* The unbounded form, named so it cannot come back. */
    expect(provider).not.toContain('applyServerAnswer(await authService.resolveSession())');
  });

  it('leaves the timeout constants where they were', () => {
    const provider = code(PROVIDER);
    expect(provider).toContain('const CONNECTIVITY_TIMEOUT_MS = 2000');
    expect(provider).toContain('export const SESSION_RESOLUTION_TIMEOUT_MS = 6000');
    /* No bound was raised to hide a failure — the fix is that a bound exists, not that it is longer. */
    expect(SESSION_RESOLUTION_TIMEOUT_MS).toBe(6000);
  });

  it('adds no polling, no interval and no retry loop', () => {
    const provider = code(PROVIDER);
    expect(provider).not.toContain('setInterval');
    expect(provider).not.toMatch(/while\s*\(/);
    /* The two triggers are the ones that already existed: a connectivity change and a foreground. */
    expect(provider).toContain("AppState.addEventListener('change'");
    expect(provider).toContain('network.subscribe(');
  });

  it('stops telling the user they are offline when it does not know that', () => {
    const copy = code(COPY);
    expect(copy).not.toContain('You’re offline');
    expect(copy).not.toContain('Check your internet');
    expect(copy).toContain('Noor AI could not be reached');
    expect(copy).toContain(
      'NoorLife could not reach Noor AI. Check your connection and try again.',
    );
  });

  it('keeps the other failure states distinct from it', () => {
    const copy = code(COPY);
    /* A reachable service that refused, rate-limited or timed out still says so in its own words. */
    for (const distinct of [
      'Noor AI is unavailable',
      'Noor AI is temporarily limited',
      'That took too long',
    ]) {
      expect(copy).toContain(distinct);
    }
  });

  it('leaves the connectivity authority alone', () => {
    /*
      #124 was filed asking for a tri-state classifier. There already is one, it was measured correct
      on the device, and this change does not add a second.
    */
    const port = code(
      join(
        __dirname,
        '..',
        '..',
        '..',
        'features',
        'faith',
        'data',
        'connectivity',
        'connectivity.port.ts',
      ),
    );
    expect(port).toContain("export type Reachability = 'online' | 'link-only' | 'offline'");
    const provider = code(PROVIDER);
    expect(provider).toContain('isConfirmedOffline');
    expect(provider).not.toMatch(/isInternetReachable/);
  });
});
