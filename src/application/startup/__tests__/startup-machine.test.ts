import {
  FIRST_LAUNCH_SPLASH_MS,
  RETURNING_LAUNCH_SPLASH_MS,
  STARTUP_PRESENTATION_CEILING_MS,
  isDestination,
  isResolved,
  minimumSplashMs,
  nextStartupState,
  type StartupInput,
} from '../startup-machine';

/**
 * The startup routing rules.
 *
 * Pure-function tests, so the 1.8-second minimum is asserted by passing an elapsed time rather
 * than by waiting one — the suite never spends real seconds proving a timing rule.
 */

function input(overrides: Partial<StartupInput> = {}): StartupInput {
  return {
    elapsedMs: 0,
    fontsReady: true,
    isSignedIn: false,
    hasCompletedOnboarding: false,
    // No recovery in progress unless a case says so; the signed-out default never consults it.
    hasPendingRecovery: false,
    // Signed-out by default in this helper, where the value is not consulted.
    hasCompletedPlanSelection: true,
    failed: false,
    isFirstLaunch: true,
    ...overrides,
  };
}

describe('the branded splash comes first', () => {
  it('is the state at t=0 on any launch', () => {
    expect(nextStartupState(input({ elapsedMs: 0 }))).toBe('branded_splash');
    expect(nextStartupState(input({ elapsedMs: 0, isFirstLaunch: false }))).toBe('branded_splash');
  });

  it('holds while startup is unresolved, however long that takes', () => {
    const unresolved = input({ elapsedMs: 3000, isSignedIn: null });
    expect(isResolved(unresolved)).toBe(false);
    expect(nextStartupState(unresolved)).toBe('branded_splash');
  });

  it('holds while fonts are still loading', () => {
    expect(nextStartupState(input({ elapsedMs: 3000, fontsReady: false }))).toBe('branded_splash');
  });

  it('holds while onboarding state is still unknown', () => {
    expect(nextStartupState(input({ elapsedMs: 3000, hasCompletedOnboarding: null }))).toBe(
      'branded_splash',
    );
  });
});

describe('first launch minimum', () => {
  it('is 1800 ms', () => {
    expect(FIRST_LAUNCH_SPLASH_MS).toBe(1800);
    expect(minimumSplashMs(true)).toBe(1800);
  });

  it('keeps the splash up at 1799 ms even when everything has resolved', () => {
    // The regression this prevents: routing the instant state resolves, which on a fast device
    // flashes the brand for a few hundred milliseconds.
    expect(nextStartupState(input({ elapsedMs: 1799 }))).toBe('branded_splash');
  });

  it('routes at exactly 1800 ms', () => {
    expect(nextStartupState(input({ elapsedMs: 1800 }))).toBe('onboarding');
  });
});

describe('returning launch minimum', () => {
  it('is 900 ms', () => {
    expect(RETURNING_LAUNCH_SPLASH_MS).toBe(900);
    expect(minimumSplashMs(false)).toBe(900);
  });

  it('observes the shorter minimum', () => {
    const returning = { isFirstLaunch: false, hasCompletedOnboarding: true };
    expect(nextStartupState(input({ ...returning, elapsedMs: 899 }))).toBe('branded_splash');
    expect(nextStartupState(input({ ...returning, elapsedMs: 900 }))).toBe('authentication');
  });

  it('does not apply the first-launch minimum to a returning user', () => {
    // A returning user at 1000 ms has passed their minimum but not the first-launch one.
    expect(
      nextStartupState(
        input({ elapsedMs: 1000, isFirstLaunch: false, hasCompletedOnboarding: true }),
      ),
    ).toBe('authentication');
  });
});

describe('destinations', () => {
  it('sends a first-time user to onboarding', () => {
    expect(
      nextStartupState(
        input({ elapsedMs: 2000, hasCompletedOnboarding: false, isSignedIn: false }),
      ),
    ).toBe('onboarding');
  });

  it('sends a signed-out user who finished onboarding to authentication', () => {
    expect(
      nextStartupState(input({ elapsedMs: 2000, hasCompletedOnboarding: true, isSignedIn: false })),
    ).toBe('authentication');
  });

  it('sends an authenticated user to Main Home', () => {
    expect(
      nextStartupState(input({ elapsedMs: 2000, isSignedIn: true, hasCompletedOnboarding: true })),
    ).toBe('authenticated_home');
  });

  it('never shows onboarding to an authenticated user', () => {
    // Even with onboarding unrecorded — a signed-in user has clearly used the app before.
    expect(
      nextStartupState(input({ elapsedMs: 2000, isSignedIn: true, hasCompletedOnboarding: false })),
    ).toBe('authenticated_home');
  });
});

describe('failure and timeout', () => {
  it('cannot hang: past the ceiling it changes what it shows, not what it concludes', () => {
    /*
      Reframed for issue #31. This asserted `'authentication'` — the signed-out entry point — as proof
      that the machine "cannot hang". It does still not hang: it leaves `branded_splash` for a state
      that says so. What it no longer does is draw a conclusion about identity from a stopwatch.
    */
    const stuck = input({
      elapsedMs: STARTUP_PRESENTATION_CEILING_MS,
      isSignedIn: null,
      fontsReady: false,
    });
    expect(isResolved(stuck)).toBe(false);
    expect(nextStartupState(stuck)).toBe('still_resolving');
    // And it is not a destination, so nothing navigates and nothing freezes.
    expect(isDestination('still_resolving')).toBe(false);
  });

  it('invents no session, and no absence of one either', () => {
    /*
      The original half of this still holds and is the more important one: an unresolved launch never
      reaches Main Home. What changed with issue #31 is the other half. "The safe direction to be wrong
      in" was the signed-out entry point — safe about exposure, wrong about truth, and the thing that
      told a signed-in user to sign in again. Being wrong in *neither* direction is available: say
      nothing about identity until there is something to say.
    */
    const stuck = input({ elapsedMs: 10000, isSignedIn: null, hasCompletedOnboarding: null });
    expect(nextStartupState(stuck)).not.toBe('authenticated_home');
    expect(nextStartupState(stuck)).not.toBe('authentication');
    expect(nextStartupState(stuck)).not.toBe('onboarding');
    expect(nextStartupState(stuck)).toBe('still_resolving');
  });

  it('reports a hard failure as startup_error', () => {
    expect(nextStartupState(input({ failed: true }))).toBe('startup_error');
    // Failure wins over everything, including an otherwise valid session.
    expect(nextStartupState(input({ failed: true, isSignedIn: true, elapsedMs: 5000 }))).toBe(
      'startup_error',
    );
  });

  it('waits out a cold offline launch before falling through', () => {
    /*
      ── This asserted 4000 and that is what broke offline access ─────────────
      Measured on the emulator against a release build in airplane mode, the session resolves at
      roughly 4.3 s from splash mount — Hermes cold start, a connectivity probe bounded at 2 s, then
      a Keystore read. The old ceiling fired a few hundred milliseconds earlier, routed to
      `authentication` assuming signed-out, and froze there; the correct answer arrived immediately
      afterwards with nowhere to go.

      So the ceiling is now a "this is stuck" bound rather than a "this is slow" one. The assertion
      is a floor rather than an equality: raising it further is a judgement call, lowering it back
      under the measurement is the regression.
    */
    expect(STARTUP_PRESENTATION_CEILING_MS).toBeGreaterThanOrEqual(8000);
    // A cold offline launch is still waiting where the old ceiling would have given up.
    expect(nextStartupState(input({ elapsedMs: 4500, isSignedIn: null }))).toBe('branded_splash');
    // Just under the ceiling, still waiting.
    expect(
      nextStartupState(input({ elapsedMs: STARTUP_PRESENTATION_CEILING_MS - 1, isSignedIn: null })),
    ).toBe('branded_splash');
    /*
      At the ceiling the *presentation* changes and the conclusion does not — issue #31.

      This asserted `'authentication'`, which is what the ceiling used to produce: the signed-out entry
      point, chosen for a session nobody had established was signed out. That is the defect. The state
      is now `'still_resolving'`, which `isDestination` excludes, so no navigation happens and the real
      destination is still reached when the answer lands.
    */
    expect(
      nextStartupState(input({ elapsedMs: STARTUP_PRESENTATION_CEILING_MS, isSignedIn: null })),
    ).toBe('still_resolving');
  });
});

describe('destination classification', () => {
  it('treats only terminal states as destinations', () => {
    expect(isDestination('branded_splash')).toBe(false);
    expect(isDestination('resolving')).toBe(false);
    expect(isDestination('native_boot')).toBe(false);
    expect(isDestination('onboarding')).toBe(true);
    expect(isDestination('authentication')).toBe(true);
    expect(isDestination('authenticated_home')).toBe(true);
    expect(isDestination('startup_error')).toBe(true);
  });
});
