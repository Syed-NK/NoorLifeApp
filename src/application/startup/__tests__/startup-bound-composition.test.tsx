import { act, render } from '@testing-library/react-native';
import { useEffect } from 'react';
import { Text } from 'react-native';

import { AuthProvider, SESSION_RESOLUTION_TIMEOUT_MS } from '@application/providers/auth-provider';
import { StartupPresentationProvider } from '@application/startup/startup-presentation-provider';
import type { ConnectivityPort } from '@features/faith/data/connectivity/connectivity.port';

import { STARTUP_PRESENTATION_CEILING_MS, isDestination } from '../startup-machine';
import { JOURNEY_READ_TIMEOUT_MS, useStartupRouting } from '../use-startup-routing';

/**
 * **What the ten-second ceiling means when the bounds are composed** — issue #57.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── The question ───────────────────────────────────────────────────────────
 * Three reads gate a launch and each is bounded: the connectivity probe at 2 s, session resolution
 * at 6 s, and the account-journey read at 4 s. They are serial — the probe decides whether to ask
 * Supabase at all, and the journey read needs an owner that only a resolved session can name — so
 * their worst cases sum to roughly twelve seconds, against a presentation ceiling of ten.
 *
 * #57 asked whether that is a defect. It is not, and the reason is what this file pins: **ten
 * seconds is the threshold at which a waiting launch starts telling the truth, not a deadline by
 * which it must be finished.** Crossing it changes what is on screen and changes nothing about what
 * is decided. `startup-machine.ts` says so in as many words — "the launch reaches its real
 * destination whenever the answer lands, at 11 s or at 40 s" — and the whole of #31 was removing the
 * behaviour where elapsed time *did* decide something.
 *
 * ── Why this file exists at all, given every bound is already tested ────────
 * Each bound has a suite. None of them composes with another, so nothing failed if someone read the
 * ceiling as a deadline and "fixed" the arithmetic by raising it, by shortening a bound, or by
 * starting the journey read early to save a second. Those are the three tempting wrong answers, and
 * the cases below are the shape of each one failing.
 *
 * The clock is virtual throughout, because every claim here is a claim about time.
 * ═══════════════════════════════════════════════════════════════════════════
 */

jest.mock('@application/providers/font-provider', () => ({
  useFontReadiness: () => ({ ready: true, error: null }),
}));

jest.mock('@services/onboarding/onboarding-preferences', () => ({
  readOnboardingState: async () => ({ completed: true, completedVersion: 1 }),
}));

const mockRecovery = { pending: false as boolean | null };
jest.mock('@application/providers/recovery-containment-provider', () => ({
  useRecoveryContainmentState: () => ({
    pending: mockRecovery.pending,
    containment: { action: 'proceed' },
  }),
  RecoveryContainmentProvider: ({ children }: { children: React.ReactNode }) => children,
}));

const mockReadJourney = jest.fn();
jest.mock('@services/account/account-journey', () => ({
  readAccountJourney: (...args: unknown[]) => mockReadJourney(...args),
}));

const mockResolveSession = jest.fn();
const mockGetProfile = jest.fn();
jest.mock('@services/auth/auth.service', () => ({
  resolveSession: (...args: unknown[]) => mockResolveSession(...args),
  getProfile: (...args: unknown[]) => mockGetProfile(...args),
  subscribeToAuthChanges: () => () => undefined,
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

const USER = {
  id: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa',
  email: 'a@example.com',
  fullName: 'Signup Name',
  avatarUrl: null,
  emailConfirmed: true,
};

function never<T>(): Promise<T> {
  return new Promise<T>(() => undefined);
}

/** A platform that never answers, so the connectivity probe runs to its bound. */
const SILENT_PLATFORM: ConnectivityPort = {
  current: () => never(),
  currentOrUnknown: () => never(),
  subscribe: () => () => undefined,
};

/** A platform that positively reports no link, which is the one reading that skips the session. */
const CONFIRMED_OFFLINE: ConnectivityPort = {
  current: async () => ({
    isConnected: false,
    reachability: 'offline',
    kind: 'none',
    isWifi: false,
    isMetered: false,
  }),
  currentOrUnknown: async () => ({
    isConnected: false,
    reachability: 'offline',
    kind: 'none',
    isWifi: false,
    isMetered: false,
  }),
  subscribe: () => () => undefined,
};

const seen: { at: number; state: string; destination: string }[] = [];

/**
 * Records each distinct machine state with the virtual time it arrived.
 *
 * The push lives in an effect rather than the render body, for the reason the session-bound suite
 * records: `Date.now()` is impure, and a render that reads it stamps whatever moment React happened
 * to re-render in — which for a file whose assertions are about *when* a bound fired is not a
 * detail. The effect runs after commit, once per change.
 */
function Probe() {
  const { state, destination } = useStartupRouting();
  const named = destination ?? 'none';
  const key = `${state}|${named}`;
  useEffect(() => {
    if (seen.at(-1)?.state === state && seen.at(-1)?.destination === named) {
      return;
    }
    seen.push({ at: Date.now(), state, destination: named });
  }, [key, state, named]);
  return <Text testID="probe">{key}</Text>;
}

async function launch(connectivity: ConnectivityPort) {
  return await render(
    <StartupPresentationProvider>
      <AuthProvider connectivity={connectivity}>
        <Probe />
      </AuthProvider>
    </StartupPresentationProvider>,
  );
}

/**
 * Advances the virtual clock in slices, flushing microtasks between them.
 *
 * One big `advanceTimersByTime` is not equivalent and the difference is the whole subject of this
 * file. The legs are serial: the session bound's timer is only *scheduled* once the connectivity
 * probe's promise has settled and its continuation has run, which happens on a microtask. Jumping
 * the clock straight to forty-five seconds fires the probe's timer and then finds no session timer
 * to fire, because it did not exist yet — so the launch never reaches the branch under test and the
 * assertions pass for the wrong reason.
 *
 * Stepping is what makes a composition test a composition test.
 */
async function advance(ms: number) {
  const STEP = 250;
  for (let elapsed = 0; elapsed < ms; elapsed += STEP) {
    await act(async () => {
      jest.advanceTimersByTime(Math.min(STEP, ms - elapsed));
      for (let i = 0; i < 12; i += 1) {
        await Promise.resolve();
      }
    });
  }
}

const current = () => seen.at(-1);

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(0);
  seen.length = 0;
  mockRecovery.pending = false;
  mockResolveSession.mockReset();
  mockGetProfile.mockReset().mockResolvedValue(null);
  mockReadJourney.mockReset();
  mockSecureGet.mockReset().mockResolvedValue(null);
});

afterEach(() => {
  jest.useRealTimers();
});

// ─────────────────────────────────────────────────────────────────────────────
// The bounds themselves, so a silent change to any of them is caught here too
// ─────────────────────────────────────────────────────────────────────────────

describe('the declared bounds', () => {
  it('are the four numbers #57 is about', () => {
    /*
      Pinned together rather than separately, because #57 is about their *sum* and the tempting wrong
      answers all move one of them. Shortening a bound to fit the ceiling would be trading a real
      guarantee — how long the app is willing to wait for a legitimate answer — for an arithmetic
      identity that no user experiences.
    */
    expect(SESSION_RESOLUTION_TIMEOUT_MS).toBe(6000);
    expect(JOURNEY_READ_TIMEOUT_MS).toBe(4000);
    expect(STARTUP_PRESENTATION_CEILING_MS).toBe(10_000);
  });

  it('describe a composition that may legitimately outlast the ceiling', () => {
    /*
      The arithmetic, stated once so it is not re-derived in an issue thread. Reaching it needs all
      three to run to their bound at once, which is three independent pathologies rather than one
      cause: an unresponsive platform network module, a link that accepts a connection and never
      answers, and a backend that does the same.
    */
    const worstAuthority = 2000 + SESSION_RESOLUTION_TIMEOUT_MS;
    const worstComposed = worstAuthority + JOURNEY_READ_TIMEOUT_MS;
    expect(worstComposed).toBeGreaterThan(STARTUP_PRESENTATION_CEILING_MS);
    expect(worstComposed).toBe(12_000);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// A threshold, not a deadline
// ─────────────────────────────────────────────────────────────────────────────

describe('crossing the ceiling with work still outstanding', () => {
  it('changes the presentation and decides nothing', async () => {
    /*
      Every leg outstanding: the platform never answers, so the probe runs to its bound; the session
      never answers, so it runs to its; and no receipt exists to fall back on. Past ten seconds the
      launch says it is still working — and that is the whole of what changes.

      `isDestination` is the assertion that matters. A state that is not a destination cannot freeze,
      cannot be routed to, and cannot be mistaken for a verdict; #31 is the record of what happens
      when elapsed time is allowed to name one.
    */
    mockResolveSession.mockReturnValue(never());

    await launch(SILENT_PLATFORM);
    await advance(STARTUP_PRESENTATION_CEILING_MS);

    expect(current()?.state).toBe('still_resolving');
    expect(current()?.destination).toBe('none');
    expect(isDestination('still_resolving')).toBe(false);
  });

  it('still decides nothing far beyond it', async () => {
    /*
      Well past the composed worst case. If ten seconds were a deadline this is where a verdict would
      appear, and the states recorded below are the proof that none does — not `authentication`, not
      `authenticated_home`, not `subscription_choice`.
    */
    mockResolveSession.mockReturnValue(never());

    await launch(SILENT_PLATFORM);
    await advance(45_000);

    expect(current()?.destination).toBe('none');
    const named = seen.map((entry) => entry.state);
    expect(named).not.toContain('authentication');
    expect(named).not.toContain('authenticated_home');
    expect(named).not.toContain('subscription_choice');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// What the composition actually costs on the paths that exist
// ─────────────────────────────────────────────────────────────────────────────

describe('a launch the platform reports as offline', () => {
  it('never pays the session bound, so the worst case is not the ordinary one', async () => {
    /*
      The composition's short circuit, and the reason the twelve-second figure is not what an offline
      user experiences. A confirmed-offline reading skips the session attempt entirely — locked
      decision 7: a refresh with no route can only fail — so the receipt is adopted as soon as the
      probe answers, and the six-second bound is never armed.

      Asserted through the request count as well as the timing, because a launch that resolved
      quickly *and* still spent a doomed request would satisfy a timing assertion alone.
    */
    mockSecureGet.mockResolvedValue(
      JSON.stringify({
        version: 1,
        userId: USER.id,
        displayName: 'Durable Name',
        avatarUrl: null,
        hasCompletedOnboarding: true,
        validatedAt: 0,
        updatedAt: 0,
      }),
    );

    await launch(CONFIRMED_OFFLINE);
    await advance(500);

    expect(mockResolveSession).not.toHaveBeenCalled();
    expect(current()?.at).toBeLessThan(SESSION_RESOLUTION_TIMEOUT_MS);
  });
});

describe('the account-journey read', () => {
  it('does not begin before authority has named an owner', async () => {
    /*
      The ordering that makes the serialization real rather than incidental, and the one place where
      "start it earlier to save time" would be a security change rather than a performance one. The
      read is account-scoped; issuing it before a validated session names the owner would be
      prefetching one account's data on nobody's authority.

      So the four seconds cannot be moved off the end of the chain, and the composition is serial by
      requirement rather than by accident.
    */
    mockResolveSession.mockReturnValue(never());

    await launch(SILENT_PLATFORM);
    await advance(STARTUP_PRESENTATION_CEILING_MS + JOURNEY_READ_TIMEOUT_MS);

    expect(mockReadJourney).not.toHaveBeenCalled();
  });
});
