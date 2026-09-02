import { act, render } from '@testing-library/react-native';
import { Text } from 'react-native';
import { useEffect, useRef } from 'react';

import {
  AuthProvider,
  SESSION_RESOLUTION_TIMEOUT_MS,
  useAuth,
  type AuthState,
} from '@application/providers/auth-provider';
import { STARTUP_PRESENTATION_CEILING_MS } from '@application/startup/startup-machine';
import { createFakeConnectivity, WIFI_ONLINE } from '@/test-support/fake-connectivity-port';

/**
 * Issue #34 — what the launch waits for, and what it no longer waits for.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── The two costs being removed ────────────────────────────────────────────
 * Two unbounded network round trips sat in series before authority was published: `resolveSession()`,
 * which refreshes an expired token, and then `getProfile()`, whose whole contribution is a display
 * name and a duplicate onboarding flag. Measured at ~45 s cold on a device holding only a receipt and
 * ~11 s on one with a live session.
 *
 * So: the session lookup is **bounded** — and a bound that fires is never a signed-out verdict — and
 * the profile read is **off the critical path**, applied to an authority that has already published.
 *
 * ── Why the clock here is virtual and asserted on ──────────────────────────
 * "Authority no longer waits for the profile" is a claim about *time*, and a test that only checks
 * the final state would pass just as well if it still waited. Every case below runs on fake timers
 * from a fixed epoch and records `Date.now()` at each observed transition, so the assertion is that
 * authority was published at 0 ms of profile latency — not merely that it was published eventually.
 * No sleeps, no real timers, and no bound is raised to make a number look better.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const USER = {
  id: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa',
  email: 'a@example.com',
  fullName: 'Signup Name',
  avatarUrl: null,
  emailConfirmed: true,
};

const OTHER_USER = {
  id: 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb',
  email: 'b@example.com',
  fullName: 'Second Person',
  avatarUrl: null,
  emailConfirmed: true,
};

const mockResolveSession = jest.fn();
const mockGetProfile = jest.fn();
const mockSubscribe = jest.fn();
let emitAuthEvent: ((change: { event: string; user: typeof USER | null }) => void) | null = null;

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
const mockSecureSet = jest.fn();
const mockSecureDelete = jest.fn();
jest.mock('expo-secure-store', () => ({
  getItemAsync: (...args: unknown[]) => mockSecureGet(...args),
  setItemAsync: (...args: unknown[]) => mockSecureSet(...args),
  deleteItemAsync: (...args: unknown[]) => mockSecureDelete(...args),
}));

/** A receipt exactly as the current build writes one, carrying the last **durable** name. */
function receiptJson(userId = USER.id, displayName = 'Durable Name') {
  return JSON.stringify({
    version: 1,
    userId,
    displayName,
    avatarUrl: null,
    hasCompletedOnboarding: true,
    validatedAt: 0,
    updatedAt: 0,
  });
}

/** A promise whose settlement this test controls, so latency is a decision rather than a race. */
function deferred<T>() {
  let settle: (value: T) => void = () => undefined;
  let reject: (reason: unknown) => void = () => undefined;
  const promise = new Promise<T>((resolveIt, rejectIt) => {
    settle = resolveIt;
    reject = rejectIt;
  });
  return { promise, settle, reject };
}

type Sample = {
  readonly at: number;
  readonly status: string;
  readonly authority: string;
  readonly name: string | null;
  readonly onboarded: boolean;
};

const samples: Sample[] = [];

/**
 * Records every distinct authority the provider publishes, with the virtual time it arrived.
 *
 * Deliberately records on *change* rather than on render: React may render more often than the state
 * changes, and "how many authority decisions were taken" is a question about the state, not about
 * render counts.
 */
function Recorder() {
  const state: AuthState = useAuth();
  const last = useRef<string | null>(null);
  const key = `${state.status}:${state.authority ?? 'none'}:${state.user?.fullName ?? 'none'}:${String(state.hasCompletedOnboarding)}`;
  useEffect(() => {
    if (last.current === key) {
      return;
    }
    last.current = key;
    samples.push({
      at: Date.now(),
      status: state.status,
      authority: state.authority ?? 'none',
      name: state.user?.fullName ?? null,
      onboarded: state.hasCompletedOnboarding,
    });
  }, [key, state]);
  return <Text testID="probe">{key}</Text>;
}

async function launch() {
  return await render(
    <AuthProvider connectivity={createFakeConnectivity(WIFI_ONLINE)}>
      <Recorder />
    </AuthProvider>,
  );
}

/**
 * Drains the launch, and optionally advances the virtual clock first.
 *
 * The chain is long — a connectivity reading, the session lookup, two local reads in parallel, a
 * receipt write, then the profile continuation — and each link is a separate microtask. A fixed
 * number of `await Promise.resolve()` calls would pass or fail depending on how many links the code
 * happens to have, which makes the test a hostage to an implementation detail. Draining in a loop
 * asserts nothing about the shape of the chain, only that it has finished.
 */
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

const signedIn = () => samples.filter((s) => s.status === 'signed-in');

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(0);
  samples.length = 0;
  mockResolveSession.mockReset();
  mockGetProfile.mockReset().mockResolvedValue(null);
  emitAuthEvent = null;
  mockSubscribe.mockReset().mockImplementation((listener: typeof emitAuthEvent) => {
    emitAuthEvent = listener;
    return () => undefined;
  });
  mockSecureGet.mockReset().mockResolvedValue(null);
  mockSecureSet.mockReset().mockResolvedValue(undefined);
  mockSecureDelete.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  jest.useRealTimers();
});

// ─────────────────────────────────────────────────────────────────────────────
// The bound is smaller than the thing it must not collide with
// ─────────────────────────────────────────────────────────────────────────────

describe('the bound sits inside the presentation ceiling', () => {
  it('resolves a bounded launch before the still-resolving notice would appear', () => {
    /*
      The invariant, not a preference. #31's notice exists for a launch that is *genuinely* unresolved
      at ten seconds; if the session bound could fire after that, every slow-but-answerable launch
      would show it first and the notice would stop meaning what it says. Two seconds of connectivity
      probe plus the session bound has to stay under the ceiling, and this fails if either moves.
    */
    expect(SESSION_RESOLUTION_TIMEOUT_MS).toBeLessThan(STARTUP_PRESENTATION_CEILING_MS);
    expect(2000 + SESSION_RESOLUTION_TIMEOUT_MS).toBeLessThan(STARTUP_PRESENTATION_CEILING_MS);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Profile latency no longer reaches authority
// ─────────────────────────────────────────────────────────────────────────────

describe('authority does not wait for the profile', () => {
  it('publishes at once when both are fast, and enriches to the durable name', async () => {
    mockResolveSession.mockResolvedValue({ kind: 'authenticated', user: USER });
    mockGetProfile.mockResolvedValue({
      id: USER.id,
      full_name: 'Durable Name',
      avatar_url: null,
      onboarding_completed: true,
    });

    await launch();
    await settle();

    expect(signedIn()[0]?.authority).toBe('online');
    expect(signedIn()[0]?.at).toBe(0);
    /* The durable row wins once it lands — the enrichment actually arrives, it is not merely safe. */
    expect(samples.at(-1)?.name).toBe('Durable Name');
    expect(samples.at(-1)?.onboarded).toBe(true);
  });

  it('publishes at 0 ms of profile latency when the profile takes a minute', async () => {
    const profile = deferred<{
      id: string;
      full_name: string;
      avatar_url: null;
      onboarding_completed: boolean;
    }>();
    mockResolveSession.mockResolvedValue({ kind: 'authenticated', user: USER });
    mockGetProfile.mockReturnValue(profile.promise);

    await launch();
    await settle();

    /*
      The whole issue in one assertion. Sixty seconds of profile latency, and authority was published
      at virtual time zero — before the read could possibly have answered.
    */
    const first = signedIn()[0];
    expect(first?.authority).toBe('online');
    expect(first?.at).toBe(0);
    expect(first?.name).toBe('Signup Name');

    await settle(60_000);
    expect(signedIn()[0]?.at).toBe(0);

    profile.settle({
      id: USER.id,
      full_name: 'Durable Name',
      avatar_url: null,
      onboarding_completed: true,
    });
    await settle();

    /* And it still lands, a minute late, on the same authority. */
    expect(samples.at(-1)?.name).toBe('Durable Name');
    expect(samples.at(-1)?.status).toBe('signed-in');
    expect(samples.at(-1)?.at).toBe(60_000);
  });

  it('survives a profile read that fails', async () => {
    mockResolveSession.mockResolvedValue({ kind: 'authenticated', user: USER });
    mockGetProfile.mockRejectedValue(new Error('select profiles'));

    await launch();
    await settle();

    /* A failure is silence: the session's own name stands, and nobody is signed out over it. */
    expect(signedIn()[0]?.authority).toBe('online');
    expect(samples.at(-1)?.status).toBe('signed-in');
    expect(samples.at(-1)?.name).toBe('Signup Name');
  });

  it('shows no placeholder or empty identity in the gap', async () => {
    const profile = deferred<null>();
    mockResolveSession.mockResolvedValue({ kind: 'authenticated', user: USER });
    mockGetProfile.mockReturnValue(profile.promise);

    await launch();
    await settle();

    /*
      "No stale flash" means every name ever published is a real one belonging to this account.
      `toProfile` falls back to the session's own `user_metadata.full_name`, so there is no window in
      which a signed-in state carries an empty string, a placeholder, or somebody else's name.
    */
    for (const sample of signedIn()) {
      expect(sample.name).not.toBeNull();
      expect(sample.name).not.toBe('');
      expect(sample.name).not.toBe('Friend');
      expect(sample.name).not.toBe('Second Person');
    }
  });

  it('starts from the receipt’s durable name, so the greeting does not visibly change', async () => {
    mockSecureGet.mockResolvedValue(receiptJson(USER.id, 'Durable Name'));
    mockResolveSession.mockResolvedValue({ kind: 'authenticated', user: USER });
    mockGetProfile.mockReturnValue(deferred<null>().promise);

    await launch();
    await settle();

    /*
      The receipt is the last durable name known for *this* id, and it is already read on every
      offline launch — not a new cache. Seeding from it is what keeps an edited name from appearing as
      the signup name and then switching when the row arrives.
    */
    expect(signedIn()[0]?.name).toBe('Durable Name');
  });

  it('ignores a receipt belonging to another account', async () => {
    mockSecureGet.mockResolvedValue(receiptJson(OTHER_USER.id, 'Second Person'));
    mockResolveSession.mockResolvedValue({ kind: 'authenticated', user: USER });
    mockGetProfile.mockReturnValue(deferred<null>().promise);

    await launch();
    await settle();

    /* A previous occupant's name is not a fallback for this one. The session's own value is. */
    expect(signedIn()[0]?.name).toBe('Signup Name');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// A late profile cannot land in the wrong world
// ─────────────────────────────────────────────────────────────────────────────

describe('a profile that arrives too late is inert', () => {
  it('does not merge after the user has signed out', async () => {
    const profile = deferred<{
      id: string;
      full_name: string;
      avatar_url: null;
      onboarding_completed: boolean;
    }>();
    mockResolveSession.mockResolvedValue({ kind: 'authenticated', user: USER });
    mockGetProfile.mockReturnValue(profile.promise);

    await launch();
    await settle();
    expect(signedIn()).toHaveLength(1);

    await act(async () => {
      emitAuthEvent?.({ event: 'SIGNED_OUT', user: null });
      await Promise.resolve();
    });
    await settle();
    expect(samples.at(-1)?.status).toBe('signed-out');

    profile.settle({
      id: USER.id,
      full_name: 'Durable Name',
      avatar_url: null,
      onboarding_completed: true,
    });
    await settle();

    /* Still signed out. A display name may not resurrect a session the user ended. */
    expect(samples.at(-1)?.status).toBe('signed-out');
    expect(samples.map((s) => s.name)).not.toContain('Durable Name');
  });

  it('does not merge account A’s row under account B', async () => {
    const profileA = deferred<{
      id: string;
      full_name: string;
      avatar_url: null;
      onboarding_completed: boolean;
    }>();
    mockResolveSession.mockResolvedValue({ kind: 'authenticated', user: USER });
    mockGetProfile.mockReturnValueOnce(profileA.promise).mockResolvedValue(null);

    await launch();
    await settle();

    /* B replaces A through a server-validated event, which is how a real account switch arrives. */
    await act(async () => {
      emitAuthEvent?.({ event: 'SIGNED_IN', user: OTHER_USER });
      await Promise.resolve();
    });
    await settle();
    expect(samples.at(-1)?.name).toBe('Second Person');

    profileA.settle({
      id: USER.id,
      full_name: 'Account A Name',
      avatar_url: null,
      onboarding_completed: false,
    });
    await settle();

    /*
      The identity check happens inside the functional update, against whoever is signed in *now* —
      so A's row cannot merge, and B's onboarding flag cannot be overwritten by A's.
    */
    expect(samples.at(-1)?.name).toBe('Second Person');
    expect(samples.map((s) => s.name)).not.toContain('Account A Name');
  });

  it('is inert after unmount', async () => {
    const profile = deferred<{
      id: string;
      full_name: string;
      avatar_url: null;
      onboarding_completed: boolean;
    }>();
    mockResolveSession.mockResolvedValue({ kind: 'authenticated', user: USER });
    mockGetProfile.mockReturnValue(profile.promise);

    const view = await launch();
    await settle();
    const before = samples.length;

    await view.unmount();
    profile.settle({
      id: USER.id,
      full_name: 'Durable Name',
      avatar_url: null,
      onboarding_completed: true,
    });
    await settle();

    /* React discards an update for a torn-down tree, so no guard of our own is needed or claimed. */
    expect(samples).toHaveLength(before);
  });
});
