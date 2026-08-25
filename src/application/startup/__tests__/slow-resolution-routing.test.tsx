import { act, render } from '@testing-library/react-native';
import { StrictMode } from 'react';
import { Text } from 'react-native';

import type { AuthState } from '@application/providers/auth-provider';

import { STARTUP_PRESENTATION_CEILING_MS } from '../startup-machine';
import { useStartupRouting } from '../use-startup-routing';
import { StartupPresentationProvider } from '@application/startup/startup-presentation-provider';

/**
 * **A slow launch still arrives** — issue #31, through the real hook rather than the pure machine.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── What only this level can prove ─────────────────────────────────────────
 * `startup-authority-resolution.test.ts` proves `nextStartupState` never converts an unanswered launch
 * into a signed-out one. It cannot see the *freeze*: `useStartupRouting` records the first destination
 * the machine names and never revises it, and that is what turned a ten-second ceiling into a
 * permanent verdict. Whether a late answer still reaches its destination is a property of the hook, so
 * it is asserted here — the session is held unresolved past the ceiling and then flipped, which is
 * exactly the sequence measured on device.
 *
 * ── Why the clock is faked including `Date` ────────────────────────────────
 * The hook measures elapsed time with `Date.now()` and ticks on `setInterval`. Faking timers while
 * leaving `Date` real — what `installMockLatencyTimers` does, deliberately, for suites that measure
 * nothing — would leave `elapsedMs` at zero however far the timers advanced, so the ceiling could
 * never be reached and every case here would pass for the wrong reason. So this suite fakes both and
 * advances explicitly. No sleeps, no retries, no inflated timeouts.
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

jest.mock('@services/account/account-journey', () => ({
  readAccountJourney: async () => ({ status: 'completed' }),
}));

jest.mock('@services/onboarding/onboarding-preferences', () => ({
  readOnboardingState: async () => ({ completed: true, isFirstLaunch: false }),
}));

/** The containment verdict, controllable: `null` is "the read has not answered". */
const mockRecovery = {
  current: { pending: false as boolean | null, containment: null as unknown },
};
jest.mock('@application/providers/recovery-containment-provider', () => ({
  useRecoveryContainmentState: () => mockRecovery.current,
}));

const USER = {
  id: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa',
  fullName: 'A Name',
  givenName: 'A',
  subscriptionTier: 'free' as const,
  greeting: 'Assalamu Alaikum,',
};

const UNRESOLVED: AuthState = {
  status: 'unknown',
  authority: null,
  user: null,
  hasCompletedOnboarding: false,
  pendingVerificationEmail: null,
  isBackendConfigured: true,
};

function signedIn(authority: 'online' | 'offline'): AuthState {
  return {
    status: 'signed-in',
    authority,
    user: USER,
    hasCompletedOnboarding: true,
    pendingVerificationEmail: null,
    isBackendConfigured: true,
  };
}

const SIGNED_OUT: AuthState = {
  status: 'signed-out',
  authority: null,
  user: null,
  hasCompletedOnboarding: true,
  pendingVerificationEmail: null,
  isBackendConfigured: true,
};

/** Reports the hook's two outputs as text, so a test reads them rather than inferring them. */
function ProbeInner() {
  const { state, destination } = useStartupRouting();
  return (
    <>
      <Text testID="state">{state}</Text>
      <Text testID="destination">{destination ?? 'none'}</Text>
    </>
  );
}

/**
 * The launch clock is owned by a provider now, not by the hook — issue #58.
 *
 * `useStartupRouting` reads `elapsedMs` from `StartupPresentationProvider` so the authentication
 * boundary can read the same number on a deep-linked launch that never mounts the entry gate. With
 * no provider the context default reports a launch that has only just begun and never advances, so
 * the owner has to be declared here for any case whose subject is elapsed time.
 */
function Probe() {
  return (
    <StartupPresentationProvider>
      <ProbeInner />
    </StartupPresentationProvider>
  );
}
beforeEach(() => {
  mockAuth.current = UNRESOLVED;
  mockRecovery.current = { pending: false, containment: null };
  // Microtasks stay real: the hook awaits reads, and faking them would deadlock those awaits.
  jest.useFakeTimers({ doNotFake: ['queueMicrotask', 'nextTick'] });
});

afterEach(() => {
  jest.useRealTimers();
});

async function advance(ms: number) {
  await act(async () => {
    jest.advanceTimersByTime(ms);
    await Promise.resolve();
  });
}

/*
  Several flushes, not two.

  The hook drives `readOnboardingState` and `readAccountJourney` through chained awaits, and each link
  needs its own microtask turn before the state it sets is visible. Two flushes left the launch
  unresolved and every case in this file failed identically — which looked like the production defect
  rather than a shallow harness.
*/
async function settle() {
  await act(async () => {
    for (let i = 0; i < 12; i += 1) {
      await Promise.resolve();
    }
  });
}

/*
  Publishes a new authority and lets React see it.

  `useAuth` is mocked as a function over a mutable ref, so mutating the ref alone notifies nobody —
  in production it is a context, and a context change re-renders its consumers. The tick interval is
  also deliberately cleared once the ceiling is reached, so past that point there is no timer left to
  cause an incidental re-render either. `rerender` supplies the notification the context would, and
  the hook's own effects re-run because their auth dependencies changed.
*/
async function publish(view: Awaited<ReturnType<typeof render>>, next: AuthState) {
  mockAuth.current = next;
  await act(async () => {
    await view.rerender(<Probe />);
  });
  await settle();
}

/** The same notification, for the containment verdict. */
async function publishRecovery(view: Awaited<ReturnType<typeof render>>, pending: boolean | null) {
  mockRecovery.current = { pending, containment: null };
  await act(async () => {
    await view.rerender(<Probe />);
  });
  await settle();
}

describe('a session that resolves after the ceiling still reaches its destination', () => {
  it.each([
    ['10.1 s', 10_100],
    ['20 s', 20_000],
    ['28 s', 28_000],
    ['45 s', 45_000],
  ])('resolves at %s and lands on the authenticated destination', async (_label, resolveAt) => {
    const view = await render(<Probe />);
    await settle();

    // Nothing has answered. Walk past the ceiling.
    await advance(resolveAt);
    expect(view.getByTestId('state').props.children).toBe('still_resolving');
    /*
      The assertion the defect turned on: no destination has been named, so nothing has frozen and
      nothing has navigated. Before this change the value here was `authentication`.
    */
    expect(view.getByTestId('destination').props.children).toBe('none');

    // The answer arrives, late.
    await publish(view, signedIn('online'));

    expect(view.getByTestId('destination').props.children).toBe('authenticated_home');
  });

  it('admits permitted-offline authority arriving late, without a network', async () => {
    const view = await render(<Probe />);
    await settle();
    await advance(22_000);
    expect(view.getByTestId('state').props.children).toBe('still_resolving');

    await publish(view, signedIn('offline'));

    expect(view.getByTestId('destination').props.children).toBe('authenticated_home');
  });

  it('holds nothing back when the answer is a real signed-out verdict', async () => {
    const view = await render(<Probe />);
    await settle();
    await advance(12_000);
    expect(view.getByTestId('state').props.children).toBe('still_resolving');

    await publish(view, SIGNED_OUT);

    // A verdict routes, at any elapsed time. This is the case the old ceiling was imitating.
    expect(view.getByTestId('destination').props.children).toBe('authentication');
  });
});

describe('below the ceiling nothing changed', () => {
  it('shows the branded splash at 9.9 s with no destination', async () => {
    const view = await render(<Probe />);
    await settle();
    await advance(9_900);

    expect(view.getByTestId('state').props.children).toBe('branded_splash');
    expect(view.getByTestId('destination').props.children).toBe('none');
  });

  it('routes an ordinary warm launch promptly, untouched by any of this', async () => {
    mockAuth.current = signedIn('online');
    const view = await render(<Probe />);
    await settle();
    await advance(1_000);
    await settle();

    expect(view.getByTestId('destination').props.children).toBe('authenticated_home');
  });
});

describe('containment outranks a slow launch, and is waited for', () => {
  it('routes to the password screen when the read answers late', async () => {
    mockRecovery.current = { pending: null, containment: null };
    const view = await render(<Probe />);
    await settle();
    await advance(20_000);

    // Signed in, but the recovery read is outstanding: unresolved, so no destination.
    await publish(view, signedIn('online'));
    expect(view.getByTestId('state').props.children).toBe('still_resolving');
    expect(view.getByTestId('destination').props.children).toBe('none');

    await publishRecovery(view, true);

    expect(view.getByTestId('destination').props.children).toBe('password_recovery');
  });

  it('never names an authenticated destination while containment is unanswered', async () => {
    mockRecovery.current = { pending: null, containment: null };
    mockAuth.current = signedIn('online');
    const view = await render(<Probe />);
    await settle();
    await advance(30_000);

    expect(view.getByTestId('destination').props.children).toBe('none');
  });
});

describe('stale asynchronous results are inert', () => {
  it('does not revise a destination once one is named', async () => {
    /*
      Freezing is still right, and this is why the fix had to be "do not name one on a non-answer"
      rather than "revise it later". A session replaced after the destination is taken must not yank
      the user to a different screen.
    */
    mockAuth.current = signedIn('online');
    const view = await render(<Probe />);
    await settle();
    await advance(1_000);
    await settle();
    expect(view.getByTestId('destination').props.children).toBe('authenticated_home');

    await publish(view, SIGNED_OUT);

    expect(view.getByTestId('destination').props.children).toBe('authenticated_home');
  });
});

describe('a double render decides once', () => {
  it('reaches one destination under Strict Mode', async () => {
    mockAuth.current = signedIn('online');
    const view = await render(
      <StrictMode>
        <Probe />
      </StrictMode>,
    );
    await settle();
    await advance(1_000);
    await settle();

    expect(view.getAllByTestId('destination')).toHaveLength(1);
    expect(view.getByTestId('destination').props.children).toBe('authenticated_home');
  });

  it('holds still_resolving under Strict Mode without naming a destination', async () => {
    const view = await render(
      <StrictMode>
        <Probe />
      </StrictMode>,
    );
    await settle();
    await advance(STARTUP_PRESENTATION_CEILING_MS + 500);

    expect(view.getByTestId('state').props.children).toBe('still_resolving');
    expect(view.getByTestId('destination').props.children).toBe('none');
  });
});

/*
  Kept last in the file, deliberately.

  `unmount()` detaches the shared render state this library keeps per module, so any case declared
  after one that unmounts finds an empty tree and fails for a reason that has nothing to do with what
  it asserts. Four cases in this file did exactly that before it was moved.
*/
describe('a launch abandoned mid-resolution leaves nothing behind', () => {
  it('survives unmounting mid-resolution without a late update', async () => {
    /*
      The hook clears its interval and flags its in-flight reads cancelled on unmount. Asserted by
      advancing the clock well past the ceiling *after* unmounting: a surviving timer or an
      uncancelled read would call `setState` on an unmounted tree, which fails the test.
    */
    const view = await render(<Probe />);
    await settle();
    await advance(5_000);
    view.unmount();

    await advance(60_000);
    await settle();
    // Reaching here without a React state-update error is the assertion.
    expect(true).toBe(true);
  });
});
