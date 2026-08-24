import { act, render } from '@testing-library/react-native';
import { useEffect } from 'react';
import { Text } from 'react-native';

import {
  AuthProvider,
  SESSION_RESOLUTION_TIMEOUT_MS,
  useAuth,
} from '@application/providers/auth-provider';
import { STARTUP_PRESENTATION_CEILING_MS } from '@application/startup/startup-machine';
import { createFakeConnectivity, WIFI_ONLINE } from '@/test-support/fake-connectivity-port';

/**
 * The bound on the launch's session lookup — issue #34's other half.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── What a bound firing means, and what it must never mean ─────────────────
 * `resolveSession()` refreshes an expired token, and on a flapping or captive link that can take tens
 * of seconds with nothing bounding it. The launch now waits `SESSION_RESOLUTION_TIMEOUT_MS` and then
 * decides without it.
 *
 * "Decides without it" has exactly two honest outcomes, and the tests below are mostly about refusing
 * a third:
 *
 *   • a valid receipt exists → **permitted-offline authority**, under the policy that already exists;
 *   • no receipt → **still `unknown`**. Unresolved and retryable. Not `signed-out`, not Welcome, not
 *     Authentication Options and not protected content.
 *
 * A timeout is not a verdict. Mapping one to `no-session` would clear the receipt and eject a signed-in
 * user on a bad connection, which is the defect #31 removed — rebuilt out of a timer instead of a
 * ceiling. So there is a case here for each way that could creep back.
 *
 * ── The request is not abandoned ───────────────────────────────────────────
 * The bound decides how long the *launch* waits; the promise keeps running. When it finally answers,
 * an upgrade applies only if nothing better-informed has spoken since, and a **verdict** applies
 * unconditionally — because that is how a remote sign-out reaches a device running from a receipt, and
 * a bound that made the receipt unrevocable would be a security regression dressed as a speed-up.
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

function receiptJson(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    version: 1,
    userId: USER.id,
    displayName: 'Durable Name',
    avatarUrl: null,
    hasCompletedOnboarding: true,
    validatedAt: 0,
    updatedAt: 0,
    ...overrides,
  });
}

function deferred<T>() {
  let settle: (value: T) => void = () => undefined;
  const promise = new Promise<T>((resolveIt) => {
    settle = resolveIt;
  });
  return { promise, settle };
}

const seen: { at: number; status: string; authority: string }[] = [];

/**
 * Records each distinct authority with the virtual time it arrived.
 *
 * The push lives in an effect rather than in the render body. `Date.now()` is impure, and a render
 * that reads it would stamp whatever moment React happened to re-render in — which for a suite whose
 * assertions are about *when* the bound fired is not a detail. The effect runs after commit, once per
 * change.
 */
function Recorder() {
  const state = useAuth();
  const key = `${state.status}:${state.authority ?? 'none'}`;
  useEffect(() => {
    if (
      seen.at(-1)?.status === state.status &&
      seen.at(-1)?.authority === (state.authority ?? 'none')
    ) {
      return;
    }
    seen.push({ at: Date.now(), status: state.status, authority: state.authority ?? 'none' });
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

/** Drains pending microtasks, advancing the virtual clock first when asked. See the sibling suite. */
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

const current = () => seen.at(-1);

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(0);
  seen.length = 0;
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
// A bound that fires
// ─────────────────────────────────────────────────────────────────────────────

describe('a session lookup that outruns its bound', () => {
  it('adopts the receipt at the bound, not after the server answers', async () => {
    const session = deferred<{ kind: 'authenticated'; user: typeof USER }>();
    mockResolveSession.mockReturnValue(session.promise);
    mockSecureGet.mockResolvedValue(receiptJson());

    await launch();
    /* Before the bound there is no answer, so nothing is claimed. */
    expect(current()?.status).toBe('unknown');

    await settle(SESSION_RESOLUTION_TIMEOUT_MS);

    expect(current()?.status).toBe('signed-in');
    expect(current()?.authority).toBe('offline');
    /*
      The timing assertion, not just the outcome: resolution landed *at* the bound rather than
      whenever the network chose to answer. Before this change the same launch waited indefinitely.
    */
    expect(current()?.at).toBe(SESSION_RESOLUTION_TIMEOUT_MS);
    expect(current()?.at).toBeLessThan(STARTUP_PRESENTATION_CEILING_MS);
  });

  it('keeps the receipt rather than clearing it', async () => {
    mockResolveSession.mockReturnValue(deferred<never>().promise);
    mockSecureGet.mockResolvedValue(receiptJson());

    await launch();
    await settle(SESSION_RESOLUTION_TIMEOUT_MS);

    /* A timeout is not a revocation. Deleting here is how a flapping link would end offline access. */
    expect(mockSecureDelete).not.toHaveBeenCalled();
  });

  it('stays unresolved when there is no receipt — never signed out', async () => {
    mockResolveSession.mockReturnValue(deferred<never>().promise);
    mockSecureGet.mockResolvedValue(null);

    await launch();
    await settle(SESSION_RESOLUTION_TIMEOUT_MS);

    /*
      The single most important assertion in this file. Nothing has been established, so the launch
      says nothing: `unknown` holds the splash and, past the ceiling, shows #31's identity-free
      notice. A `signed-out` here would send a user with a valid but slow session to Welcome.
    */
    expect(current()?.status).toBe('unknown');
    expect(seen.map((s) => s.status)).not.toContain('signed-out');
  });

  it('stays unresolved when the stored receipt is not usable', async () => {
    mockResolveSession.mockReturnValue(deferred<never>().promise);
    /* A record from a future build. `readOfflineReceipt` rejects and deletes rather than tolerating. */
    mockSecureGet.mockResolvedValue(receiptJson({ version: 99 }));

    await launch();
    await settle(SESSION_RESOLUTION_TIMEOUT_MS);

    expect(current()?.status).toBe('unknown');
    expect(seen.map((s) => s.status)).not.toContain('signed-in');
  });

  it.each([
    ['corrupt JSON', 'not json at all'],
    ['a record carrying an email', receiptJson({ email: 'a@example.com' })],
    ['a record with no display name', receiptJson({ displayName: '' })],
  ])('grants nothing on %s', async (_label, stored) => {
    mockResolveSession.mockReturnValue(deferred<never>().promise);
    mockSecureGet.mockResolvedValue(stored);

    await launch();
    await settle(SESSION_RESOLUTION_TIMEOUT_MS);

    expect(current()?.status).toBe('unknown');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The answer that arrives after the bound
// ─────────────────────────────────────────────────────────────────────────────

describe('the late answer still counts', () => {
  it('upgrades offline authority to online when the session finally lands', async () => {
    const session = deferred<{ kind: 'authenticated'; user: typeof USER }>();
    mockResolveSession.mockReturnValue(session.promise);
    mockSecureGet.mockResolvedValue(receiptJson());

    await launch();
    await settle(SESSION_RESOLUTION_TIMEOUT_MS);
    expect(current()?.authority).toBe('offline');

    session.settle({ kind: 'authenticated', user: USER });
    await settle(30_000);

    /* The request was never abandoned, so a slow link ends up online rather than stuck offline. */
    expect(current()?.status).toBe('signed-in');
    expect(current()?.authority).toBe('online');
  });

  it('still revokes when the late answer is a verdict', async () => {
    const session = deferred<{ kind: 'invalid-or-revoked' }>();
    mockResolveSession.mockReturnValue(session.promise);
    mockSecureGet.mockResolvedValue(receiptJson());

    await launch();
    await settle(SESSION_RESOLUTION_TIMEOUT_MS);
    expect(current()?.authority).toBe('offline');

    session.settle({ kind: 'invalid-or-revoked' });
    await settle();

    /*
      A remote sign-out has to reach a device running from a receipt. The bound must not make the
      receipt unrevocable for the life of the process — which is what suppressing this would do.
    */
    expect(current()?.status).toBe('signed-out');
    expect(mockSecureDelete).toHaveBeenCalled();
  });

  it('is silence when the late answer is another failure', async () => {
    const session = deferred<{ kind: 'retryable-offline' }>();
    mockResolveSession.mockReturnValue(session.promise);
    mockSecureGet.mockResolvedValue(receiptJson());

    await launch();
    await settle(SESSION_RESOLUTION_TIMEOUT_MS);
    const afterBound = seen.length;

    session.settle({ kind: 'retryable-offline' });
    await settle();

    /* Nothing was learned, so nothing is written — no churn of identity on a flapping link. */
    expect(seen).toHaveLength(afterBound);
    expect(current()?.authority).toBe('offline');
  });

  it('does not resurrect a session the user has signed out of', async () => {
    const session = deferred<{ kind: 'authenticated'; user: typeof USER }>();
    mockResolveSession.mockReturnValue(session.promise);
    mockSecureGet.mockResolvedValue(receiptJson());

    await launch();
    await settle(SESSION_RESOLUTION_TIMEOUT_MS);

    await act(async () => {
      emitAuthEvent?.({ event: 'SIGNED_OUT', user: null });
      await Promise.resolve();
    });
    await settle();
    expect(current()?.status).toBe('signed-out');

    session.settle({ kind: 'authenticated', user: USER });
    await settle();

    /* An upgrade may only overwrite the conclusion the launch reached without it. */
    expect(current()?.status).toBe('signed-out');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Answers that arrive in time behave exactly as before
// ─────────────────────────────────────────────────────────────────────────────

describe('an answer inside the bound is unchanged by any of this', () => {
  it('signs out on a definitive no-session, and clears the receipt', async () => {
    mockResolveSession.mockResolvedValue({ kind: 'no-session' });
    mockSecureGet.mockResolvedValue(receiptJson());

    await launch();
    await settle();

    /* A verdict. The server looked and found nothing, which is the one branch that means signed out. */
    expect(current()?.status).toBe('signed-out');
    expect(mockSecureDelete).toHaveBeenCalled();
  });

  it('takes exactly one authority decision on an ordinary launch', async () => {
    mockResolveSession.mockResolvedValue({ kind: 'authenticated', user: USER });
    mockGetProfile.mockResolvedValue(null);

    await launch();
    await settle(STARTUP_PRESENTATION_CEILING_MS);

    /*
      One transition out of `unknown`, and no second one. A bound that also let the original promise
      publish would show two, and the enrichment must not register as an authority decision at all.
    */
    const decisions = seen.filter((s) => s.status !== 'unknown');
    expect(decisions).toHaveLength(1);
    expect(decisions[0]?.authority).toBe('online');
    expect(mockResolveSession).toHaveBeenCalledTimes(1);
  });

  it('asks the server exactly once even though the bound is armed', async () => {
    const session = deferred<{ kind: 'authenticated'; user: typeof USER }>();
    mockResolveSession.mockReturnValue(session.promise);
    mockSecureGet.mockResolvedValue(receiptJson());

    await launch();
    await settle(SESSION_RESOLUTION_TIMEOUT_MS * 3);
    session.settle({ kind: 'authenticated', user: USER });
    await settle();

    /*
      No retry loop, and no second request. The bound is a wait, not a re-attempt — which is what
      keeps this inside the provider's existing request behaviour rather than adding traffic.
    */
    expect(mockResolveSession).toHaveBeenCalledTimes(1);
  });

  it('cannot be disturbed by its own bound firing later', async () => {
    mockResolveSession.mockResolvedValue({ kind: 'authenticated', user: USER });
    mockSecureGet.mockResolvedValue(receiptJson());

    await launch();
    await settle();
    const settled = seen.length;
    expect(current()?.authority).toBe('online');

    await settle(SESSION_RESOLUTION_TIMEOUT_MS * 5);

    /*
      `Promise.race` settles on the first result and does not cancel the loser, so the bound's handle
      is cleared explicitly in `withBound` — and this asserts the consequence rather than the
      mechanism. If the loser were left armed and its branch still reachable, a launch that had
      already resolved online would later re-run the timeout path and could downgrade itself to the
      receipt. Counting live timers would not show that: several other subsystems keep their own.
    */
    expect(seen).toHaveLength(settled);
    expect(current()?.authority).toBe('online');
    expect(mockResolveSession).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// A failed attempt is not the same thing as a bound that fired
// ─────────────────────────────────────────────────────────────────────────────

describe('a reachable network that could not complete the request', () => {
  it('presents the entry gate when the failure finds no receipt to fall back to', async () => {
    /*
      `retryable-offline` inside the bound, with nothing stored. The platform said the internet was
      reachable and the request still could not complete — a captive portal, a flapping link, a server
      that never answered.

      This is deliberately *not* the `unknown` that the bound's own no-receipt case produces, and the
      difference is which of them still has an answer coming. When the bound fires the request is
      still running, so staying unresolved costs nothing and the late answer can resolve it. Here the
      attempt has already finished and failed: nothing further will arrive, so remaining `unknown`
      would hold the launch on the splash for the life of the process.

      `signed-out` is therefore the honest state rather than a revocation — this device holds no
      session and no receipt, so no authority is being taken away from anyone. The assertion that
      keeps it honest is the one below it.
    */
    mockResolveSession.mockResolvedValue({ kind: 'retryable-offline' });
    mockSecureGet.mockResolvedValue(null);

    await launch();
    await settle();

    expect(current()?.status).toBe('signed-out');
    expect(current()?.authority).toBe('none');
    /* Resolved by the attempt's own failure, so it must not have waited out the bound to get there. */
    expect(current()?.at).toBeLessThan(SESSION_RESOLUTION_TIMEOUT_MS);
  });

  it('resolves rather than hanging when the record it found turns out to be unusable', async () => {
    /*
      The same stored record as the bound's own unusable-receipt case above, and the opposite outcome —
      which is the point of having both. There, the request is still in flight, so `unknown` is
      correct and the late answer resolves it. Here the request has already failed, so nothing else is
      coming and `unknown` would be a permanent splash.

      The deletion that happens on this path is `readOfflineReceipt` quarantining a record it refuses
      to interpret, not a revocation of anything: there was no access to withdraw. What must not
      happen is the launch stalling because the fallback it reached for was not there.
    */
    mockResolveSession.mockResolvedValue({ kind: 'retryable-offline' });
    mockSecureGet.mockResolvedValue(receiptJson({ version: 99 }));

    await launch();
    await settle();

    expect(current()?.status).toBe('signed-out');
    expect(seen.map((s) => s.status)).not.toContain('signed-in');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The late answer meets an account that replaced the one it was asked about
// ─────────────────────────────────────────────────────────────────────────────

describe('a late answer that has been overtaken', () => {
  it('cannot install the account it asked about over the one that signed in since', async () => {
    /*
      The stale-write case the bound makes reachable. The launch times out and adopts account A's
      receipt; the user then signs in as account B, which the server validated, so B holds online
      authority. A's answer finally arrives.

      It must be discarded. `publish`'s predicate refuses to overwrite anything better-informed than
      the conclusion the launch reached without it, and online authority for a different account is
      strictly better-informed than a receipt. Applying it would put account A's identity — its
      greeting, its account-scoped storage — under the session that actually belongs to B.

      Asserted through the rule's consequence rather than the predicate, so a refactor that keeps the
      staleness guard but reaches it differently still passes, and one that drops it fails.
    */
    const OTHER = {
      id: 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb',
      email: 'b@example.com',
      fullName: 'Other Person',
      avatarUrl: null,
      emailConfirmed: true,
    };
    const session = deferred<{ kind: 'authenticated'; user: typeof USER }>();
    mockResolveSession.mockReturnValue(session.promise);
    mockSecureGet.mockResolvedValue(receiptJson());

    const view = await launch();
    await settle(SESSION_RESOLUTION_TIMEOUT_MS);
    expect(current()?.authority).toBe('offline');

    await act(async () => {
      emitAuthEvent?.({ event: 'SIGNED_IN', user: OTHER as unknown as typeof USER });
      await Promise.resolve();
    });
    await settle();
    expect(current()?.authority).toBe('online');

    /* Which account the receipt names, at any moment — the only identity this tree exposes. */
    const receiptOwner = () => {
      const writes = mockSecureSet.mock.calls;
      if (writes.length === 0) return null;
      return JSON.parse(String(writes[writes.length - 1]?.[1])).userId as string;
    };
    expect(receiptOwner()).toBe(OTHER.id);
    const writesBeforeTheLateAnswer = mockSecureSet.mock.calls.length;

    session.settle({ kind: 'authenticated', user: USER });
    await settle();

    expect(current()?.status).toBe('signed-in');
    expect(current()?.authority).toBe('online');
    expect(view.getByTestId('probe').props.children).toBe('signed-in:online');
    /*
      The assertion that separates "still online" from "still B". Authority alone cannot tell the two
      accounts apart, and the failure being guarded against keeps the authority and swaps the person.
    */
    expect(receiptOwner()).toBe(OTHER.id);
    expect(mockSecureSet).toHaveBeenCalledTimes(writesBeforeTheLateAnswer);
  });
});
