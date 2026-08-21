import {
  STARTUP_PRESENTATION_CEILING_MS,
  isDestination,
  isResolved,
  nextStartupState,
  type StartupInput,
  type StartupState,
} from '../startup-machine';

/**
 * **A performance ceiling may not decide who you are** — the guard for issue #31.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── The defect ─────────────────────────────────────────────────────────────
 * Past `STARTUP_PRESENTATION_CEILING_MS` with nothing resolved, the machine returned
 * `'authentication'` — the signed-out entry point — and `useStartupRouting` froze there, because
 * `'authentication'` is a destination. Measured on both targets after installing a current APK: a
 * first launch takes 20–28 s to render at all, so a valid live session and a valid offline receipt
 * each reached Authentication Options. The user was told they were signed out while holding authority.
 *
 * The ceiling had already been raised once for this, 4000 → 10000. Raising it again would buy silence
 * until the next slow device, so the value stays and the *conclusion* goes.
 *
 * ── Why the clock is a parameter here ──────────────────────────────────────
 * `nextStartupState` takes `elapsedMs` as an input, so every timing case below is an exact value
 * rather than a wall-clock race: 9.9 s, exactly 10 s, 10.1 s, 20 s and 30 s are all deterministic and
 * none of them sleeps. No fake timers, no inflated timeouts, no retries.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const CEILING = STARTUP_PRESENTATION_CEILING_MS;

/** A resolved, ordinary signed-in launch. Individual cases unresolve exactly what they mean to. */
function input(over: Partial<StartupInput> = {}): StartupInput {
  return {
    elapsedMs: 2000,
    fontsReady: true,
    isSignedIn: true,
    hasCompletedOnboarding: true,
    hasCompletedPlanSelection: true,
    failed: false,
    isFirstLaunch: false,
    hasPendingRecovery: false,
    ...over,
  };
}

/** Nothing has answered yet — the state every timing case below is measured in. */
const UNRESOLVED: Partial<StartupInput> = {
  isSignedIn: null,
  hasCompletedOnboarding: null,
  hasPendingRecovery: null,
  hasCompletedPlanSelection: null,
};

describe('an unanswered launch never becomes a signed-out one', () => {
  it.each([
    ['9.9 s — just under the ceiling', 9_900, 'branded_splash'],
    ['exactly at the ceiling', CEILING, 'still_resolving'],
    ['10.1 s — just past it', 10_100, 'still_resolving'],
    ['20 s', 20_000, 'still_resolving'],
    ['30 s', 30_000, 'still_resolving'],
  ] as const)('%s', (_label, elapsedMs, expected) => {
    const state = nextStartupState(input({ ...UNRESOLVED, elapsedMs }));
    expect(state).toBe(expected as StartupState);
  });

  it.each([9_900, CEILING, 10_100, 20_000, 30_000])(
    'at %i ms it reaches neither authentication nor a home',
    (elapsedMs) => {
      /*
        The invariant, stated per timing rather than only at the boundary. Every one of these used to
        produce `'authentication'` at or past 10 s.
      */
      const state = nextStartupState(input({ ...UNRESOLVED, elapsedMs }));
      expect(state).not.toBe('authentication');
      expect(state).not.toBe('onboarding');
      expect(state).not.toBe('authenticated_home');
      expect(state).not.toBe('subscription_choice');
    },
  );

  it('names no destination while unresolved, so nothing can freeze', () => {
    /*
      The second half of the defect. `useStartupRouting` freezes the first destination the machine
      names, which is correct — a user must not be yanked between screens by a late input. It was fatal
      only because the ceiling named one on a non-answer.
    */
    for (const elapsedMs of [CEILING, 15_000, 30_000, 99_000]) {
      expect(isDestination(nextStartupState(input({ ...UNRESOLVED, elapsedMs })))).toBe(false);
    }
  });

  it('does not raise the ceiling to hide the race', () => {
    // The value is unchanged; only its meaning is. A raise would be the third instance of the same fix.
    expect(CEILING).toBe(10_000);
  });
});

describe('a late answer still arrives at the right destination', () => {
  it.each([10_100, 20_000, 28_000, 45_000])(
    'a live session resolving at %i ms reaches its authenticated destination',
    (elapsedMs) => {
      expect(nextStartupState(input({ elapsedMs }))).toBe('authenticated_home');
    },
  );

  it('sends a late-resolving account that owes a plan choice to the chooser, not to Home', () => {
    expect(nextStartupState(input({ elapsedMs: 25_000, hasCompletedPlanSelection: false }))).toBe(
      'subscription_choice',
    );
    /*
      An *unanswered* plan read is a different thing from a negative one, and `isResolved` requires the
      answer while signed in — so this stays `still_resolving` rather than routing. Which is the fix
      working: at 25 s with the plan read outstanding, the old behaviour produced `'authentication'`,
      throwing a signed-in account out over a read that had nothing to do with identity.
    */
    expect(nextStartupState(input({ elapsedMs: 25_000, hasCompletedPlanSelection: null }))).toBe(
      'still_resolving',
    );
  });

  it('admits permitted-offline authority the same as a live session', () => {
    /*
      The machine sees `isSignedIn`, which is true under either authority — the distinction between a
      live session and a receipt belongs to `AuthState.authority` and to the operations that need a
      server. A receipt adopted at 20 s reaches the app, where before it reached a sign-in screen it
      could not have completed.
    */
    expect(nextStartupState(input({ elapsedMs: 20_000 }))).toBe('authenticated_home');
  });
});

describe('a real verdict still routes immediately, before and after the ceiling', () => {
  it.each([1_000, 9_900, CEILING, 20_000])(
    'a definitive signed-out verdict at %i ms goes to authentication',
    (elapsedMs) => {
      /*
        This is the case the old behaviour was imitating, and it must keep working: the server said
        there is no session, or there is no receipt to fall back to. `isSignedIn: false` is an answer,
        so `isResolved` is true and the destination is named.
      */
      const state = input({
        elapsedMs,
        isSignedIn: false,
        hasCompletedOnboarding: true,
        hasPendingRecovery: null,
        hasCompletedPlanSelection: null,
      });
      expect(isResolved(state)).toBe(true);
      expect(nextStartupState(state)).toBe('authentication');
    },
  );

  it('sends a never-onboarded signed-out launch to onboarding, at any elapsed time', () => {
    for (const elapsedMs of [1_000, CEILING, 30_000]) {
      expect(
        nextStartupState(
          input({
            elapsedMs,
            isSignedIn: false,
            hasCompletedOnboarding: false,
            hasPendingRecovery: null,
            hasCompletedPlanSelection: null,
          }),
        ),
      ).toBe('onboarding');
    }
  });

  it('keeps a hard dependency failure routing to startup_error', () => {
    // Unchanged, and distinct from slowness. `failed` is hard-coded false in production today.
    expect(nextStartupState(input({ failed: true, elapsedMs: 100 }))).toBe('startup_error');
    expect(nextStartupState(input({ ...UNRESOLVED, failed: true, elapsedMs: 30_000 }))).toBe(
      'startup_error',
    );
  });

  it('treats an invalid, expired or revoked receipt as the verdict it is', () => {
    /*
      Fails closed, and not by a new branch. The auth layer clears the receipt on a definitive
      server verdict and publishes `signed-out`, so by the time the machine sees it there is an answer
      — which routes to authentication at any elapsed time, exactly as the case above.
    */
    const revoked = input({
      elapsedMs: 30_000,
      isSignedIn: false,
      hasPendingRecovery: null,
      hasCompletedPlanSelection: null,
    });
    expect(nextStartupState(revoked)).toBe('authentication');
    expect(nextStartupState(revoked)).not.toBe('still_resolving');
  });
});

describe('recovery containment outranks a slow launch', () => {
  it('routes to the password screen once the read answers, however late', () => {
    for (const elapsedMs of [CEILING, 20_000, 40_000]) {
      expect(nextStartupState(input({ elapsedMs, hasPendingRecovery: true }))).toBe(
        'password_recovery',
      );
    }
  });

  it('waits rather than guessing while the recovery read is outstanding', () => {
    /*
      The worst case of the old behaviour: unable to tell whether a recovery was open, it routed to
      authentication. A launch mid-recovery was resolved by sending the user to sign in.
    */
    const waiting = input({ elapsedMs: 30_000, hasPendingRecovery: null });
    expect(isResolved(waiting)).toBe(false);
    expect(nextStartupState(waiting)).toBe('still_resolving');
  });

  it('never reaches an authenticated destination while a recovery is open', () => {
    for (const elapsedMs of [1_000, CEILING, 30_000]) {
      const state = nextStartupState(input({ elapsedMs, hasPendingRecovery: true }));
      expect(state).not.toBe('authenticated_home');
      expect(state).not.toBe('subscription_choice');
    }
  });
});

describe('the brand minimum is unchanged', () => {
  it('still holds the splash for a resolved launch inside the minimum', () => {
    expect(nextStartupState(input({ elapsedMs: 100, isFirstLaunch: true }))).toBe('branded_splash');
  });

  it('does not let the ceiling shorten or extend it', () => {
    // Resolved at 2 s on a returning launch is past the 900 ms minimum and routes; the ceiling is
    // irrelevant to a resolved launch.
    expect(nextStartupState(input({ elapsedMs: 2_000 }))).toBe('authenticated_home');
  });
});
