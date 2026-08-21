import { act, render, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';

import type { AuthState } from '@application/providers/auth-provider';
import { useStartupRouting } from '../use-startup-routing';

/**
 * Where an **offline** launch is routed, through the real hook rather than the pure machine.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── The gap this closes ────────────────────────────────────────────────────
 * `startup-machine.test.ts` tests `nextStartupState`, a pure function. It cannot see
 * `use-startup-routing.ts` at all — so the fix that stopped an airplane-mode launch landing on the
 * subscription chooser had no unit test, and a mutation proof aimed at that suite came back
 * UNPROVEN for the honest reason that the suite could not detect the change.
 *
 * The defect it guards: `readAccountJourney` is a Supabase read. Offline it rejects, the handler
 * writes `planSelected = false`, and the machine reads that as "has not chosen a plan" and routes a
 * signed-in user to a purchase flow that needs a network to complete. Observed on device as
 * "Choose how NoorLife supports you" instead of Home.
 *
 * ── Why the journey read is asserted as *not called* ───────────────────────
 * "Did not route to the chooser" alone would pass if the read happened and merely succeeded. The
 * property is that offline authority does not *attempt* the remote read — so the mock's call count
 * is the assertion, not the destination alone.
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

/*
  Containment moved out of `useStartupRouting` and into `RecoveryContainmentProvider` for issue #30,
  so this substitutes the *consumer* rather than the hook. The verdict supplied is the same one:
  answered, with no recovery pending, which is what every case in this file is about.
*/
jest.mock('@application/providers/recovery-containment-provider', () => ({
  useRecoveryContainmentState: () => ({ pending: false, containment: { action: 'proceed' } }),
}));

function state(over: Partial<AuthState> = {}): AuthState {
  return {
    status: 'signed-in',
    authority: 'offline',
    user: { id: 'user-a', fullName: 'A', givenName: 'A', subscriptionTier: 'free', greeting: 'x' },
    hasCompletedOnboarding: true,
    pendingVerificationEmail: null,
    isBackendConfigured: true,
    ...over,
  } as AuthState;
}

function Probe() {
  const { state: current, destination } = useStartupRouting();
  return <Text testID="probe">{`${destination ?? current}`}</Text>;
}

async function launch() {
  return await render(<Probe />);
}

beforeEach(() => {
  jest.useRealTimers();
  mockAuth.current = state();
  mockReadJourney.mockReset().mockResolvedValue({ status: 'completed' });
});

describe('offline authority', () => {
  it('routes into the app rather than the subscription chooser', async () => {
    const { getByTestId } = await launch();
    await waitFor(() => expect(getByTestId('probe')).toHaveTextContent('authenticated_home'), {
      timeout: 15000,
    });
  });

  it('never attempts the remote account-journey read', async () => {
    /* The property, not just the destination: offline must not start a Supabase read at all. */
    await launch();
    await waitFor(() => expect(mockReadJourney).not.toHaveBeenCalled());
  });

  it('cannot be pushed to the chooser by a rejecting journey read', async () => {
    /*
      The exact device failure. Even if something did call it and it rejected, the offline branch must
      not let `planSelected = false` decide the destination.
    */
    mockReadJourney.mockRejectedValue(new Error('offline'));
    const { getByTestId } = await launch();
    await waitFor(() => expect(getByTestId('probe')).toHaveTextContent('authenticated_home'), {
      timeout: 15000,
    });
  });

  it('is not reached through the stuck-startup ceiling', async () => {
    /*
      The ceiling is a fallback for a launch that never answers, not the ordinary offline route. An
      offline launch resolves on its own and arrives at Home well inside it — if this only passed
      after `STARTUP_TIMEOUT_MS`, the fix would be the timeout rather than the routing.
    */
    const { getByTestId } = await launch();
    await waitFor(() => expect(getByTestId('probe')).toHaveTextContent('authenticated_home'), {
      timeout: 15000,
    });
    /*
      Asserted on the destination rather than on the wall clock. The ceiling routes to
      `authentication`, so arriving at `authenticated_home` *is* the proof that it did not fire —
      and unlike a stopwatch that conclusion cannot be broken by a loaded CI machine.
    */
    expect(getByTestId('probe')).not.toHaveTextContent('authentication');
  });
});

describe('every other authority is unchanged', () => {
  it('follows the real journey result when online', async () => {
    mockAuth.current = state({ authority: 'online' });
    mockReadJourney.mockResolvedValue({ status: 'completed' });

    const { getByTestId } = await launch();
    await waitFor(() => expect(getByTestId('probe')).toHaveTextContent('authenticated_home'), {
      timeout: 15000,
    });
    await waitFor(() => expect(mockReadJourney).toHaveBeenCalled(), { timeout: 15000 });
  });

  it('sends an online user who has not chosen a plan to the chooser', async () => {
    /*
      The behaviour the offline bypass must not have broken. If this regressed, a genuinely new
      account would skip the subscription introduction entirely.
    */
    mockAuth.current = state({ authority: 'online' });
    mockReadJourney.mockResolvedValue({ status: 'unconfigured', reason: 'no-column' });

    const { getByTestId } = await launch();
    await waitFor(() => expect(getByTestId('probe')).toHaveTextContent('subscription_choice'), {
      timeout: 15000,
    });
  });

  it('routes a signed-out launch to authentication', async () => {
    mockAuth.current = state({ status: 'signed-out', authority: null, user: null });

    const { getByTestId } = await launch();
    await waitFor(() => expect(getByTestId('probe')).toHaveTextContent('authentication'), {
      timeout: 15000,
    });
    expect(mockReadJourney).not.toHaveBeenCalled();
  });

  it('cannot have a terminal authentication failure hidden by offline state', async () => {
    /*
      A server verdict outranks the receipt. Once the provider has resolved `signed-out`, no offline
      branch may route into the app — that would be the revocation being ignored.
    */
    mockAuth.current = state({ status: 'signed-out', authority: null, user: null });
    const { getByTestId } = await launch();
    await waitFor(() => expect(getByTestId('probe')).toHaveTextContent('authentication'), {
      timeout: 15000,
    });
  });

  it('holds the splash while the session is still unknown', async () => {
    mockAuth.current = state({ status: 'unknown', authority: null, user: null });
    const { getByTestId } = await launch();
    await act(async () => {
      await Promise.resolve();
    });
    expect(getByTestId('probe')).toHaveTextContent('branded_splash');
    expect(mockReadJourney).not.toHaveBeenCalled();
  });
});
