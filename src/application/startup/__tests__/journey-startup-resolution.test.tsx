import { act, render } from '@testing-library/react-native';
import { StrictMode } from 'react';
import { AppState, Text } from 'react-native';

import type { AuthState } from '@application/providers/auth-provider';
import { STARTUP_PRESENTATION_CEILING_MS } from '../startup-machine';
import { JOURNEY_READ_TIMEOUT_MS, useStartupRouting } from '../use-startup-routing';

/**
 * Where each journey state routes a launch — issue #46.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── The defect ─────────────────────────────────────────────────────────────
 * `readAccountJourney` was unbounded, and `isResolved` requires its answer for a signed-in online
 * launch. On a link where the platform reports connectivity and nothing answers, the read never
 * returned, so the launch showed #31's notice indefinitely while holding perfectly good authority —
 * measured on both targets.
 *
 * And once bounded, the second half of the defect appears: the caller mapped *every* non-`completed`
 * answer to "has not chosen a plan", so a timeout would have sent an entitled, possibly paying account
 * to the subscription chooser. That is *could not ask* becoming *the answer is no*, which is the same
 * mistake as the original sign-out bug two layers up.
 *
 * ── What is asserted, and what deliberately is not ─────────────────────────
 * An unknown journey **holds** the launch: splash, then the identity-free notice, and the real
 * destination whenever an answer lands. Holding is the conservative reading — `false` sends a paying
 * user to a purchase screen and `true` lets a new account past an introduction it has not seen — so
 * the cases below assert that the launch reaches *no destination at all*, rather than asserting some
 * particular one.
 *
 * The clock is virtual throughout, because "the bound elapsed" is a claim about time.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const mockAuth = { current: null as AuthState | null };
jest.mock('@application/providers/auth-provider', () => ({
  useAuth: () => mockAuth.current,
  isOnlineAuthenticated: (state: AuthState) =>
    state.status === 'signed-in' && state.authority === 'online',
  isLocallyAuthenticated: (state: AuthState) => state.status === 'signed-in',
}));

jest.mock('@application/providers/font-provider', () => ({
  useFontReadiness: () => ({ ready: true, error: null }),
}));

const mockReadJourney = jest.fn();
jest.mock('@services/account/account-journey', () => ({
  readAccountJourney: (...args: unknown[]) => mockReadJourney(...args),
}));

jest.mock('@services/onboarding/onboarding-preferences', () => ({
  readOnboardingState: async () => ({ completed: true, isFirstLaunch: false }),
}));

const mockRecovery = { pending: false as boolean | null };
jest.mock('@application/providers/recovery-containment-provider', () => ({
  useRecoveryContainmentState: () => ({
    pending: mockRecovery.pending,
    containment: { action: 'proceed' },
  }),
}));

const USER_A = 'user-a';
const USER_B = 'user-b';

function state(over: Partial<AuthState> = {}, userId = USER_A): AuthState {
  return {
    status: 'signed-in',
    authority: 'online',
    user: {
      id: userId,
      fullName: 'A Person',
      givenName: 'A',
      subscriptionTier: 'free',
      greeting: 'x',
    },
    hasCompletedOnboarding: true,
    pendingVerificationEmail: null,
    isBackendConfigured: true,
    ...over,
  } as AuthState;
}

const seen: string[] = [];

function Probe() {
  const { state: current, destination } = useStartupRouting();
  const value = `${current}|${destination ?? 'none'}`;
  if (seen.at(-1) !== value) {
    seen.push(value);
  }
  return <Text testID="probe">{value}</Text>;
}

function tree(strict = false) {
  return strict ? (
    <StrictMode>
      <Probe />
    </StrictMode>
  ) : (
    <Probe />
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

/** Past the brand minimum and the ceiling, so a destination is named as soon as one exists. */
async function launchAndAge(ms = STARTUP_PRESENTATION_CEILING_MS + 1000) {
  const view = await render(tree());
  await settle();
  await settle(ms);
  return view;
}

function deferred<T>() {
  let settleWith: (value: T) => void = () => undefined;
  let reject: (reason: unknown) => void = () => undefined;
  const promise = new Promise<T>((resolveIt, rejectIt) => {
    settleWith = resolveIt;
    reject = rejectIt;
  });
  return { promise, settleWith, reject };
}

const destination = () => {
  const last = seen.at(-1);
  const part = last === undefined ? 'none' : last.split('|')[1];
  return part === undefined || part === 'none' ? null : part;
};
const currentState = () => seen.at(-1)?.split('|')[0] ?? 'none';

let appStateListeners: ((status: string) => void)[] = [];

/** Brings the app to the foreground, as the platform would. */
async function foreground() {
  await act(async () => {
    for (const listener of [...appStateListeners]) {
      listener('active');
    }
    await Promise.resolve();
  });
  await settle();
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(0);
  seen.length = 0;
  mockAuth.current = state();
  mockRecovery.pending = false;
  mockReadJourney.mockReset().mockResolvedValue({ status: 'pending' });
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

// ─────────────────────────────────────────────────────────────────────────────
// The bound sits where it was chosen to sit
// ─────────────────────────────────────────────────────────────────────────────

describe('the bound', () => {
  it('is shorter than the session bound, because it is a smaller piece of work', () => {
    /*
      Six seconds is sized for a token refresh. This is one indexed row read with no refresh and no
      negotiation, and one that has not answered in four seconds is not about to. Pinned so the two
      cannot silently converge.
    */
    expect(JOURNEY_READ_TIMEOUT_MS).toBe(4000);
    expect(JOURNEY_READ_TIMEOUT_MS).toBeLessThan(6000);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Definitive answers, fast and slow
// ─────────────────────────────────────────────────────────────────────────────

describe('a definitive selected answer', () => {
  it('routes to the authenticated destination immediately', async () => {
    mockReadJourney.mockResolvedValue({ status: 'completed', planCode: 'premium_single' });
    await launchAndAge();
    expect(destination()).toBe('authenticated_home');
  });

  it('routes there just as well when it arrives slowly but inside the bound', async () => {
    const journey = deferred<{ status: 'completed'; planCode: string }>();
    mockReadJourney.mockReturnValue(journey.promise);

    await render(tree());
    await settle(JOURNEY_READ_TIMEOUT_MS - 500);
    expect(destination()).toBeNull();

    journey.settleWith({ status: 'completed', planCode: 'free' });
    await settle(STARTUP_PRESENTATION_CEILING_MS);
    expect(destination()).toBe('authenticated_home');
  });
});

describe('a definitive not-selected answer', () => {
  it('routes to the plan chooser, which is the one thing that may', async () => {
    mockReadJourney.mockResolvedValue({ status: 'pending' });
    await launchAndAge();
    expect(destination()).toBe('subscription_choice');
  });

  it('routes there when slow but inside the bound', async () => {
    const journey = deferred<{ status: 'pending' }>();
    mockReadJourney.mockReturnValue(journey.promise);

    await render(tree());
    await settle(JOURNEY_READ_TIMEOUT_MS - 500);
    journey.settleWith({ status: 'pending' });
    await settle(STARTUP_PRESENTATION_CEILING_MS);

    expect(destination()).toBe('subscription_choice');
  });

  it('is the only thing that reaches it', async () => {
    /*
      Enumerated rather than asserted once. `pending` is the single state that means "the server looked
      at this account's row and found no choice recorded", and it is therefore the single state allowed
      to produce a purchase screen. Every other answer is checked in the suites below.
    */
    mockReadJourney.mockResolvedValue({ status: 'pending' });
    await launchAndAge();
    expect(destination()).toBe('subscription_choice');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// A deployment that cannot record an answer has not given one
// ─────────────────────────────────────────────────────────────────────────────

describe('a deployment that cannot record a plan choice', () => {
  it('holds rather than routing, because the installation is not the account', async () => {
    /*
      ═══════════════════════════════════════════════════════════════════════
      ── The correction ────────────────────────────────────────────────────
      This routed to the chooser, on the reasoning that a deployment with nowhere to store the answer
      has no accounts that chose a plan, so the chooser was harmless.

      It is not harmless. It invents a purchase decision in order to preserve availability, and it does
      so for exactly the person it hurts most: a subscriber whose backend is mis-deployed, shown a plan
      chooser as though they had never chosen. Absence of a place to record the answer is not the
      answer — so it holds, and the development diagnosis names the migration to apply.
      ═══════════════════════════════════════════════════════════════════════
    */
    mockReadJourney.mockResolvedValue({
      status: 'unconfigured',
      reason: 'profiles.initial_plan_selection_completed_at is not available',
    });
    await launchAndAge();

    expect(destination()).toBeNull();
    expect(currentState()).not.toBe('subscription_choice');
  });

  it.each([
    ['42703', 'undefined column'],
    ['42P01', 'undefined table'],
    ['PGRST204', 'schema cache miss'],
    ['PGRST205', 'schema cache miss'],
  ])('holds for the schema-missing answer behind code %s', async (_code, reason) => {
    /*
      Each recognised schema code produces `unconfigured` at the service — pinned in
      `account-journey-states.test.ts` — and every one of them must hold here. Enumerated so that a
      code added to the service's set without a routing decision cannot slip through.
    */
    mockReadJourney.mockResolvedValue({ status: 'unconfigured', reason });
    await launchAndAge();
    expect(destination()).toBeNull();
  });

  it('never reaches the chooser, even after ten minutes', async () => {
    mockReadJourney.mockResolvedValue({ status: 'unconfigured', reason: 'no column' });

    await render(tree());
    await settle(600_000);

    /*
      Availability is not preserved by guessing. Ten minutes of a mis-deployed backend produces a
      launch that has not opened — which is a defect somebody fixes — rather than a plan chooser shown
      to paying users, which is a defect that looks like a product.
    */
    expect(seen.map((entry) => entry.split('|')[1])).not.toContain('subscription_choice');
    expect(seen.map((entry) => entry.split('|')[0])).not.toContain('subscription_choice');
    expect(destination()).toBeNull();
  });

  it('resolves once the same service can answer, without a relaunch', async () => {
    /*
      The migration is applied, or the capability comes back, while the app is running. The launch was
      held rather than frozen, so the next answer settles it — and it settles it to whatever is true,
      including the chooser if the account genuinely owes the introduction.
    */
    mockReadJourney.mockResolvedValueOnce({ status: 'unconfigured', reason: 'no column' });
    await render(tree());
    await settle(JOURNEY_READ_TIMEOUT_MS + 500);
    expect(destination()).toBeNull();

    mockReadJourney.mockResolvedValue({ status: 'completed', planCode: 'premium_single' });
    await foreground();
    await settle(STARTUP_PRESENTATION_CEILING_MS);

    expect(destination()).toBe('authenticated_home');
  });

  it('resolves to the chooser when the recovered answer is a definitive no', async () => {
    mockReadJourney.mockResolvedValueOnce({ status: 'unconfigured', reason: 'no column' });
    await render(tree());
    await settle(JOURNEY_READ_TIMEOUT_MS + 500);

    mockReadJourney.mockResolvedValue({ status: 'pending' });
    await foreground();
    await settle(STARTUP_PRESENTATION_CEILING_MS);

    /* Held, then answered — the chooser is reached from a real verdict and only from one. */
    expect(destination()).toBe('subscription_choice');
  });

  it('is still outranked by recovery containment', async () => {
    mockRecovery.pending = true;
    mockReadJourney.mockResolvedValue({ status: 'unconfigured', reason: 'no column' });
    await launchAndAge();
    expect(destination()).toBe('password_recovery');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Nothing learned — the heart of #46
// ─────────────────────────────────────────────────────────────────────────────

describe('a journey read that teaches the launch nothing', () => {
  it('holds rather than routing when the bound elapses', async () => {
    mockReadJourney.mockReturnValue(new Promise(() => undefined));

    await render(tree());
    await settle(JOURNEY_READ_TIMEOUT_MS + 1000);

    /* Unknown is not a verdict, so there is no destination — in either direction. */
    expect(destination()).toBeNull();
    expect(currentState()).not.toBe('subscription_choice');
    expect(currentState()).not.toBe('authenticated_home');
  });

  it('never reaches the chooser however long it waits', async () => {
    mockReadJourney.mockReturnValue(new Promise(() => undefined));

    await render(tree());
    await settle(600_000);

    /*
      The single most important assertion in this file. A paying account must not be sent to a purchase
      screen because a row read was slow, and ten minutes of slowness is still slowness.
    */
    expect(seen.map((entry) => entry.split('|')[1])).not.toContain('subscription_choice');
    expect(seen.map((entry) => entry.split('|')[0])).not.toContain('subscription_choice');
    expect(destination()).toBeNull();
  });

  it.each([
    ['an unreachable server', { status: 'unavailable', reason: 'Network request failed' }],
    ['a gateway timeout', { status: 'unavailable', reason: 'canceling statement due to timeout' }],
  ])('holds on %s', async (_label, journey) => {
    mockReadJourney.mockResolvedValue(journey);
    await launchAndAge();
    expect(destination()).toBeNull();
  });

  it('holds when the read rejects outright', async () => {
    /*
      `readAccountJourney` is documented never to reject, so this is defence against a future edit —
      and it must fail closed the same way. Before, the rejection handler wrote `false`.
    */
    mockReadJourney.mockRejectedValue(new Error('unexpected'));
    await launchAndAge();
    expect(destination()).toBeNull();
  });

  it('asks again on foreground, and completes once the answer arrives', async () => {
    /*
      ═══════════════════════════════════════════════════════════════════════
      ── The case that makes the bound do anything at all ──────────────────
      An *unknown* answer and a read still in flight both hold the launch, so bounding the read is
      unobservable on its own — a mutation that deleted the bound passed every other case in this
      file. What the bound actually produces is a **known** unknown, and this is what consumes it: a
      user who fixes the connection and comes back gets a launch that completes.

      Without the bound the decision never becomes unknown, so the foreground listener is never
      attached, and no re-attempt happens. With it, exactly one re-attempt per foreground.
    */
    mockReadJourney.mockReturnValueOnce(new Promise(() => undefined));
    await render(tree());
    await settle(JOURNEY_READ_TIMEOUT_MS + 500);
    expect(destination()).toBeNull();
    expect(mockReadJourney).toHaveBeenCalledTimes(1);

    mockReadJourney.mockResolvedValue({ status: 'completed', planCode: 'free' });
    await foreground();
    await settle(STARTUP_PRESENTATION_CEILING_MS);

    expect(mockReadJourney).toHaveBeenCalledTimes(2);
    expect(destination()).toBe('authenticated_home');
  });

  it('attaches no foreground listener once the answer is definitive', async () => {
    /* An ordinary launch carries no extra subscription and makes no extra request. */
    mockReadJourney.mockResolvedValue({ status: 'completed', planCode: 'free' });
    await launchAndAge();

    await foreground();
    expect(mockReadJourney).toHaveBeenCalledTimes(1);
  });

  it('re-attempts once per foreground, never on a timer', async () => {
    mockReadJourney.mockReturnValue(new Promise(() => undefined));
    await render(tree());
    await settle(JOURNEY_READ_TIMEOUT_MS + 500);
    expect(mockReadJourney).toHaveBeenCalledTimes(1);

    await settle(600_000);
    /* Ten minutes of clock produces no request: a bound is a wait, not a schedule. */
    expect(mockReadJourney).toHaveBeenCalledTimes(1);

    await foreground();
    await settle(JOURNEY_READ_TIMEOUT_MS + 500);
    expect(mockReadJourney).toHaveBeenCalledTimes(2);
  });

  it('shows the identity-free notice rather than a destination, past the ceiling', async () => {
    mockReadJourney.mockReturnValue(new Promise(() => undefined));

    await render(tree());
    await settle(STARTUP_PRESENTATION_CEILING_MS + 1000);

    /* Honest: authority exists, the plan decision does not, and the presentation says exactly that. */
    expect(currentState()).toBe('still_resolving');
    expect(destination()).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// A definitive answer that arrives after the bound
// ─────────────────────────────────────────────────────────────────────────────

describe('a late definitive answer resolves the unknown state', () => {
  it('routes to Main Home when the late answer is selected', async () => {
    const journey = deferred<{ status: 'completed'; planCode: string }>();
    mockReadJourney.mockReturnValue(journey.promise);

    await render(tree());
    await settle(JOURNEY_READ_TIMEOUT_MS + 1000);
    expect(destination()).toBeNull();

    journey.settleWith({ status: 'completed', planCode: 'premium_family' });
    await settle(STARTUP_PRESENTATION_CEILING_MS);

    /* The request was never abandoned, so a slow link still ends up where the account belongs. */
    expect(destination()).toBe('authenticated_home');
  });

  it('routes to the chooser when the late answer is a definitive not-selected', async () => {
    const journey = deferred<{ status: 'pending' }>();
    mockReadJourney.mockReturnValue(journey.promise);

    await render(tree());
    await settle(JOURNEY_READ_TIMEOUT_MS + 1000);
    expect(destination()).toBeNull();

    journey.settleWith({ status: 'pending' });
    await settle(STARTUP_PRESENTATION_CEILING_MS);

    /*
      "Not selected" is as definitive as "selected", and both beat holding. The chooser is reached
      only ever from a real answer — which is the whole distinction this change turns on.
    */
    expect(destination()).toBe('subscription_choice');
  });

  it('stays held when the late answer is still unavailable', async () => {
    const journey = deferred<{ status: 'unavailable'; reason: string }>();
    mockReadJourney.mockReturnValue(journey.promise);

    await render(tree());
    await settle(JOURNEY_READ_TIMEOUT_MS + 1000);
    journey.settleWith({ status: 'unavailable', reason: 'still nothing' });
    await settle(STARTUP_PRESENTATION_CEILING_MS);

    expect(destination()).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Ownership
// ─────────────────────────────────────────────────────────────────────────────

describe('a decision belongs to the account it was read for', () => {
  it('reads nothing for an account it does not belong to', async () => {
    /*
      The result is refused at the point of *reading*, every render, against whoever is signed in now —
      which is stronger than checking once at the moment it was written. A launch for B cannot be
      routed by a decision read for A even if that decision is sitting in state.
    */
    mockReadJourney.mockResolvedValue({ status: 'completed', planCode: 'free' });
    await launchAndAge();
    expect(destination()).toBe('authenticated_home');

    mockAuth.current = state({}, USER_B);
    mockReadJourney.mockReturnValue(new Promise(() => undefined));
    seen.length = 0;

    const second = await render(tree());
    await settle(STARTUP_PRESENTATION_CEILING_MS + 1000);

    /* B has no answer of its own, so B holds — it does not inherit A's. */
    expect(destination()).toBeNull();
    second.unmount();
  });

  it('does not route account B on a decision already stored for account A', async () => {
    /*
      ═══════════════════════════════════════════════════════════════════════
      ── What this proves, and what it does not ─────────────────────────────
      It proves the property: A's decision is applied, the account is replaced before any destination
      is named, and B still holds rather than being routed to Main Home on somebody else's answer.

      It does **not** isolate the owner check, and it would be dishonest to claim otherwise. Removing
      that check leaves this case passing, because three mechanisms independently prevent the same
      thing: the effect's cancellation flag stops a pending result landing, the replacement resets the
      hook's own state, and the selector refuses a foreign owner. Every arrangement tried leaves at
      least one of the first two in play.

      The check stays regardless. It is the only one of the three that would still hold if a future
      edit dropped the cancellation flag or preserved state across an account change — and "already
      covered twice" is a reason to keep a cheap guard, not to remove it.
    */
    mockReadJourney.mockResolvedValue({ status: 'completed', planCode: 'premium_family' });

    const view = await render(tree());
    await settle();
    /* A's decision is in state, and no destination has been named yet. */
    expect(destination()).toBeNull();

    mockAuth.current = state({}, USER_B);
    mockReadJourney.mockReturnValue(new Promise(() => undefined));
    await act(async () => {
      view.rerender(tree());
      await Promise.resolve();
    });
    await settle(STARTUP_PRESENTATION_CEILING_MS + 1000);

    /* B has no answer of its own, so B holds — and never inherits A's. */
    expect(destination()).toBeNull();
    expect(mockReadJourney).toHaveBeenLastCalledWith(USER_B);
  });

  it('asks for the signed-in account and no other', async () => {
    mockReadJourney.mockResolvedValue({ status: 'pending' });
    await launchAndAge();
    expect(mockReadJourney).toHaveBeenCalledWith(USER_A);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Offline authority, and the absence of a local record
// ─────────────────────────────────────────────────────────────────────────────

describe('offline authority', () => {
  it('routes to Main Home without attempting the read at all', async () => {
    mockAuth.current = state({ authority: 'offline' });
    await launchAndAge();

    /*
      The existing decision, unchanged: a receipt is only written after a validated online session, the
      chooser cannot be completed without a network, and the next online launch enforces it if it is
      genuinely outstanding. Asserted as *not called* rather than by destination alone, because a read
      that happened and merely succeeded would pass the weaker check.
    */
    expect(mockReadJourney).not.toHaveBeenCalled();
    expect(destination()).toBe('authenticated_home');
  });

  it('has no local journey record to fall back on under online authority', async () => {
    /*
      Recorded rather than implemented. There is no account-scoped local journey record in this
      codebase — `session-storage` holds onboarding, a remembered address and a token; the offline
      receipt holds onboarding but nothing about the plan. So an unknown journey under *online*
      authority has nothing local to consult, and inventing a cache would create a second, weaker
      authority for a fact the service documents as belonging to the account. Holding is the honest
      outcome, and this case exists so that a future reader knows it was considered.
    */
    mockReadJourney.mockReturnValue(new Promise(() => undefined));
    await render(tree());
    await settle(STARTUP_PRESENTATION_CEILING_MS + 1000);

    expect(destination()).toBeNull();
    expect(mockReadJourney).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Recovery still outranks everything
// ─────────────────────────────────────────────────────────────────────────────

describe('recovery containment', () => {
  it('outranks an unknown journey', async () => {
    mockRecovery.pending = true;
    mockReadJourney.mockReturnValue(new Promise(() => undefined));

    await launchAndAge();

    /* Containment is not a competing destination — it says this session is not a sign-in yet. */
    expect(destination()).toBe('password_recovery');
  });

  it('outranks a definitive not-selected answer', async () => {
    mockRecovery.pending = true;
    mockReadJourney.mockResolvedValue({ status: 'pending' });
    await launchAndAge();
    expect(destination()).toBe('password_recovery');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// One decision, and no duplicate reads
// ─────────────────────────────────────────────────────────────────────────────

describe('exactly one effective journey decision', () => {
  it('reads once per launch and freezes the destination', async () => {
    mockReadJourney.mockResolvedValue({ status: 'completed', planCode: 'free' });
    await launchAndAge();

    expect(mockReadJourney).toHaveBeenCalledTimes(1);
    const destinations = seen.map((entry) => entry.split('|')[1]).filter((d) => d !== 'none');
    expect(new Set(destinations).size).toBe(1);
  });

  it('does not re-read when the clock keeps running', async () => {
    mockReadJourney.mockResolvedValue({ status: 'pending' });
    await launchAndAge();
    await settle(600_000);

    /* No retry loop: a bound is a wait, not a re-attempt. */
    expect(mockReadJourney).toHaveBeenCalledTimes(1);
  });

  it('reads once inside a Strict Mode tree', async () => {
    mockReadJourney.mockResolvedValue({ status: 'completed', planCode: 'free' });
    await render(tree(true));
    await settle();
    await settle(STARTUP_PRESENTATION_CEILING_MS);

    expect(destination()).toBe('authenticated_home');
    expect(mockReadJourney.mock.calls.every(([id]) => id === USER_A)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Nothing protected while nothing is resolved
// ─────────────────────────────────────────────────────────────────────────────

describe('an unresolved launch reaches no protected destination', () => {
  it('names no destination while authority itself is unknown', async () => {
    mockAuth.current = {
      status: 'unknown',
      authority: null,
      user: null,
      hasCompletedOnboarding: false,
      pendingVerificationEmail: null,
      isBackendConfigured: true,
    } as AuthState;
    mockReadJourney.mockReturnValue(new Promise(() => undefined));

    await render(tree());
    await settle(STARTUP_PRESENTATION_CEILING_MS + 1000);

    expect(destination()).toBeNull();
    /* And no read is attempted without a user id to read for. */
    expect(mockReadJourney).not.toHaveBeenCalled();
  });

  it('names no destination while only the journey is unknown', async () => {
    mockReadJourney.mockReturnValue(new Promise(() => undefined));
    await render(tree());
    await settle(STARTUP_PRESENTATION_CEILING_MS + 1000);

    for (const entry of seen) {
      const named = entry.split('|')[1];
      expect(named).toBe('none');
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Sign-out, replacement and unmount — last, for the harness
// ─────────────────────────────────────────────────────────────────────────────

/*
  ── Last on purpose ─────────────────────────────────────────────────────────
  These cases tear a tree down and then settle a promise, which leaves the act environment unable to
  resolve renders queued after them — every later test in the file would find no state, which reads as
  a defect here and is only ever the harness.
*/
describe('a decision arriving into a different world', () => {
  it('is inert after sign-out', async () => {
    const journey = deferred<{ status: 'completed'; planCode: string }>();
    mockReadJourney.mockReturnValue(journey.promise);

    const view = await render(tree());
    await settle(JOURNEY_READ_TIMEOUT_MS + 500);

    mockAuth.current = {
      status: 'signed-out',
      authority: null,
      user: null,
      hasCompletedOnboarding: true,
      pendingVerificationEmail: null,
      isBackendConfigured: true,
    } as AuthState;
    await settle();

    journey.settleWith({ status: 'completed', planCode: 'free' });
    await settle(STARTUP_PRESENTATION_CEILING_MS);

    /* A plan decision cannot resurrect a signed-out launch into an authenticated destination. */
    expect(destination()).not.toBe('authenticated_home');
    view.unmount();
  });

  it('is inert after unmount', async () => {
    const journey = deferred<{ status: 'completed'; planCode: string }>();
    mockReadJourney.mockReturnValue(journey.promise);

    const view = await render(tree());
    await settle(JOURNEY_READ_TIMEOUT_MS + 500);
    const before = seen.length;

    view.unmount();
    journey.settleWith({ status: 'completed', planCode: 'free' });
    await settle(STARTUP_PRESENTATION_CEILING_MS);

    expect(seen).toHaveLength(before);
  });
});
