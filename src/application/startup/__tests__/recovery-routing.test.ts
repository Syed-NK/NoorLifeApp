import {
  isDestination,
  isResolved,
  nextStartupState,
  type StartupInput,
} from '../startup-machine';

/**
 * Startup routing while a password recovery is unfinished.
 *
 * ── The condition ───────────────────────────────────────────────────────────
 * A recovery exchange creates a real authenticated session *before* the password is set. So from
 * the machine's point of view the user is signed in, and every input that normally sends a
 * signed-in user somewhere is satisfied. These cases assert that none of them win.
 */

function input(overrides: Partial<StartupInput> = {}): StartupInput {
  return {
    // Past both the resolution work and the brand minimum, so the destination is the only variable.
    elapsedMs: 2000,
    fontsReady: true,
    isSignedIn: true,
    hasCompletedOnboarding: true,
    hasCompletedPlanSelection: true,
    failed: false,
    isFirstLaunch: false,
    hasPendingRecovery: false,
    ...overrides,
  };
}

describe('an unfinished recovery outranks every authenticated destination', () => {
  it('routes to the recovery journey instead of Main Home', () => {
    expect(nextStartupState(input({ hasPendingRecovery: true }))).toBe('password_recovery');
  });

  it('routes to the recovery journey instead of the subscription chooser', () => {
    // The account has not chosen a plan, which would normally win. It must not.
    expect(
      nextStartupState(input({ hasPendingRecovery: true, hasCompletedPlanSelection: false })),
    ).toBe('password_recovery');
  });

  it('wins regardless of plan state', () => {
    for (const hasCompletedPlanSelection of [true, false, null]) {
      expect(nextStartupState(input({ hasPendingRecovery: true, hasCompletedPlanSelection }))).toBe(
        'password_recovery',
      );
    }
  });

  it('never reaches Home or subscriptions while contained', () => {
    const forbidden = ['authenticated_home', 'subscription_choice'];
    for (const isFirstLaunch of [true, false]) {
      for (const hasCompletedPlanSelection of [true, false, null]) {
        const state = nextStartupState(
          input({
            hasPendingRecovery: true,
            hasCompletedPlanSelection,
            isFirstLaunch,
            elapsedMs: 5000,
          }),
        );
        expect(forbidden).not.toContain(state);
      }
    }
  });

  it('is a destination the router navigates to', () => {
    expect(isDestination('password_recovery')).toBe(true);
  });
});

describe('the recovery read is waited for rather than assumed', () => {
  it('is unresolved while the read is in flight on a signed-in launch', () => {
    /**
     * Null must not read as false. Defaulting an unanswered recovery read to "no recovery" is
     * exactly the assumption that lets an unfinished one reach Main Home — the splash waits
     * instead.
     */
    expect(isResolved(input({ hasPendingRecovery: null }))).toBe(false);
  });

  it('holds the branded splash rather than routing', () => {
    expect(nextStartupState(input({ hasPendingRecovery: null }))).toBe('branded_splash');
  });

  it('does not wait for it on a signed-out launch', () => {
    // A signed-out user has no session for a marker to describe; waiting would slow every ordinary
    // launch for a value that cannot change the answer.
    expect(
      isResolved(input({ isSignedIn: false, hasPendingRecovery: null, hasCompletedPlanSelection: null })),
    ).toBe(true);
  });

  it('still times out to a safe route rather than hanging', () => {
    // Past the ceiling with the read never answering. Authentication, never Home.
    expect(nextStartupState(input({ hasPendingRecovery: null, elapsedMs: 99_000 }))).toBe(
      'authentication',
    );
  });
});

describe('everything else is unaffected', () => {
  it('sends an ordinary signed-in account to Main Home', () => {
    expect(nextStartupState(input())).toBe('authenticated_home');
  });

  it('still sends an account owing a plan choice to the chooser', () => {
    expect(nextStartupState(input({ hasCompletedPlanSelection: false }))).toBe(
      'subscription_choice',
    );
  });

  it('still sends a signed-out returning user to authentication', () => {
    expect(nextStartupState(input({ isSignedIn: false }))).toBe('authentication');
  });

  it('still sends a first-time user to onboarding', () => {
    expect(
      nextStartupState(input({ isSignedIn: false, hasCompletedOnboarding: false })),
    ).toBe('onboarding');
  });

  it('cannot contain a signed-out user', () => {
    /**
     * Signup confirmation and every other signed-out journey are untouched. The marker is only
     * consulted for a signed-in session, and `use-startup-routing.ts` substitutes false otherwise —
     * so even a stale marker cannot divert a signed-out launch.
     */
    expect(nextStartupState(input({ isSignedIn: false, hasPendingRecovery: true }))).toBe(
      'authentication',
    );
  });
});
