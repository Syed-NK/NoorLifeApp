import {
  FIRST_LAUNCH_SPLASH_MS,
  RETURNING_LAUNCH_SPLASH_MS,
  STARTUP_TIMEOUT_MS,
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
  it('cannot hang: past the ceiling it routes even with nothing resolved', () => {
    const stuck = input({ elapsedMs: STARTUP_TIMEOUT_MS, isSignedIn: null, fontsReady: false });
    expect(isResolved(stuck)).toBe(false);
    expect(nextStartupState(stuck)).toBe('authentication');
  });

  it('never invents a session when it gives up', () => {
    // The safe direction to be wrong in: an unresolved session means "we do not know who you are",
    // and the honest answer to that is the signed-out entry point, never Main Home.
    const stuck = input({ elapsedMs: 10000, isSignedIn: null, hasCompletedOnboarding: null });
    expect(nextStartupState(stuck)).not.toBe('authenticated_home');
    expect(nextStartupState(stuck)).toBe('authentication');
  });

  it('reports a hard failure as startup_error', () => {
    expect(nextStartupState(input({ failed: true }))).toBe('startup_error');
    // Failure wins over everything, including an otherwise valid session.
    expect(nextStartupState(input({ failed: true, isSignedIn: true, elapsedMs: 5000 }))).toBe(
      'startup_error',
    );
  });

  it('has a 4 second ceiling', () => {
    expect(STARTUP_TIMEOUT_MS).toBe(4000);
    // Just under it, still waiting.
    expect(nextStartupState(input({ elapsedMs: 3999, isSignedIn: null }))).toBe('branded_splash');
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
