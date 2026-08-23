import { act, render, screen, waitFor } from '@testing-library/react-native';

import { AppProviders } from '@application/providers/app-providers';
import { clearRecoveryPending, writeRecoveryPending } from '@services/auth/recovery-pending';

import Index from '../../../app/index';

/**
 * **Moving the containment actor did not break the startup destination** — the regression guard for
 * the change made for issue #30.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── The failure this exists to catch ───────────────────────────────────────
 * `useStartupRouting` used to own the containment actor; it now consumes its verdict from
 * `RecoveryContainmentProvider`, so that a launch which never mounts the entry gate is still
 * contained. The startup machine treats an unanswered verdict as *not resolved yet* and holds the
 * branded splash — so if the verdict stopped reaching the machine, **every** signed-in launch would
 * sit on the splash until the ten-second ceiling expired and then fall back to Authentication
 * Options.
 *
 * No existing test would have caught that. `callback-routing.test.tsx` asserts only that the
 * destination is *not* the callback route, which a fallback to the entry point satisfies.
 *
 * ── Why this file fakes `Date` and the containment suites do not ────────────
 * The gate holds the branded splash for a real elapsed-time minimum, measured with `Date.now()`.
 * `installMockLatencyTimers` deliberately leaves `Date` real — faking it would make every suite that
 * measures duration report the advanced clock — so under it the minimum can never elapse and the gate
 * never names a destination. Suites that drive the gate therefore fake the clock too, exactly as
 * `callback-routing.test.tsx` does, and advance past the minimum explicitly.
 *
 * Worth recording because the first version of this test used the wrong harness, sat on the splash,
 * and looked exactly like the regression it was written to detect.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/*
  ── The journey read is scripted, because this suite is not about the journey ──
  This file drives the whole gate through `AppProviders`, so before it was mocked here the *real*
  `readAccountJourney` ran against the global Supabase double and answered `unconfigured` — the
  migration is not applied in the test environment.

  For as long as `unconfigured` routed to the plan chooser, that resolved the launch by accident and
  this suite passed on it. It no longer routes anywhere: a deployment that cannot record a plan choice
  has not given an answer, so the launch holds the splash — which looks exactly like the #30 regression
  this file exists to catch, while being nothing of the kind.

  So the answer is scripted to a definitive one. The subject here is whether the containment verdict
  still reaches the machine, and that question needs the *other* inputs answered rather than
  incidental.
*/
jest.mock('@services/account/account-journey', () => ({
  readAccountJourney: async () => ({ status: 'completed', planCode: 'free' }),
  completeAccountJourney: async () => ({ ok: true }),
  CURRENT_ACCOUNT_JOURNEY_VERSION: 1,
}));

beforeEach(() => {
  // Microtasks stay real: promise resolution runs on them and faking them deadlocks the auth double.
  jest.useFakeTimers({ doNotFake: ['queueMicrotask', 'nextTick'] });
});

afterEach(async () => {
  jest.useRealTimers();
  await clearRecoveryPending();
});

/** Past the first-launch splash minimum and the startup ceiling, so the gate has certainly decided. */
const PAST_SPLASH_MINIMUM_MS = 2500;

async function renderGate() {
  const view = await render(
    <AppProviders>
      <Index />
    </AppProviders>,
  );
  // Two flushes: the session and onboarding reads, and the marker read behind them.
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  await act(async () => {
    jest.advanceTimersByTime(PAST_SPLASH_MINIMUM_MS);
    await Promise.resolve();
  });
  return view;
}

describe('the entry gate still names a destination', () => {
  it('resolves a signed-in launch to an authenticated destination', async () => {
    await renderGate();

    await waitFor(() => expect(screen.getByTestId('router-redirect')).toBeTruthy());
    /*
      Asserted as "not the signed-out entry" rather than as a specific route: the exact authenticated
      destination depends on the onboarding and plan fixtures, and the regression this guards against
      is precisely a fall-back to `/welcome`.
    */
    expect(screen.getByTestId('router-redirect').props.accessibilityLabel).not.toBe('/welcome');
  });

  it('leaves the branded splash once the verdict arrives', async () => {
    await renderGate();

    await waitFor(() => expect(screen.getByTestId('router-redirect')).toBeTruthy());
    expect(screen.queryByTestId('startup-branded-splash')).toBeNull();
  });

  it('routes a resumable recovery to the password screen, as it always did', async () => {
    /*
      The behaviour that must not change for the launch path that *did* work before. The entry gate
      reads the same verdict from the same actor; only the actor's mounting point moved.
    */
    await writeRecoveryPending('test-user-id');

    await renderGate();

    await waitFor(() =>
      expect(screen.getByTestId('router-redirect').props.accessibilityLabel).toBe(
        '/auth/set-new-password',
      ),
    );
  });
});
