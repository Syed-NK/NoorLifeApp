import {
  isDestination,
  isResolved,
  nextStartupState,
  STARTUP_PRESENTATION_CEILING_MS,
  type StartupInput,
} from '@application/startup/startup-machine';
import { protectedRouteAccess } from '@application/navigation/protected-routes';
import { SESSION_RESOLUTION_TIMEOUT_MS } from '@application/providers/auth-provider';
import type { AuthState } from '@application/providers/auth-provider';

/**
 * What the faster launch is allowed to *show*, at each point where it is now faster.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * Bounding the session lookup and moving the profile read off the critical path changes *when*
 * authority exists. It must change nothing about what may be rendered before it does — which is the
 * guarantee #28 and #31 both rest on, and the one a performance change is most likely to erode
 * quietly.
 *
 * These cases are the machine and the route boundary as pure functions: no renders, no clock, and no
 * provider. That is deliberate. The question here is not "did this launch behave" but "is this state
 * reachable at all", and enumerating the inputs answers it more completely than mounting ever could.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/** A launch whose session has not resolved: the state a fired bound with no receipt leaves behind. */
const UNRESOLVED_LAUNCH: StartupInput = {
  elapsedMs: 0,
  fontsReady: true,
  isSignedIn: null,
  hasCompletedOnboarding: null,
  hasCompletedPlanSelection: null,
  failed: false,
  isFirstLaunch: false,
  hasPendingRecovery: null,
};

const SIGNED_IN: StartupInput = {
  ...UNRESOLVED_LAUNCH,
  isSignedIn: true,
  hasCompletedOnboarding: true,
  hasCompletedPlanSelection: true,
  hasPendingRecovery: false,
  elapsedMs: 2000,
};

const AUTH_STATE: AuthState = {
  status: 'unknown',
  authority: null,
  user: null,
  hasCompletedOnboarding: false,
  pendingVerificationEmail: null,
  isBackendConfigured: true,
};

// ─────────────────────────────────────────────────────────────────────────────
// The state a fired bound leaves behind
// ─────────────────────────────────────────────────────────────────────────────

describe('a launch left unresolved by a fired bound', () => {
  it('is not a destination at any elapsed time', () => {
    /*
      The bound produces `unknown` when there is no receipt, and `isSignedIn: null` is how that
      reaches the machine. Every elapsed time is enumerated across the interesting range rather than
      sampled, because "it happened not to route at the moment I checked" is not the property wanted.
    */
    for (const elapsedMs of [0, 900, 1800, SESSION_RESOLUTION_TIMEOUT_MS, 9999, 10_000, 60_000]) {
      const state = nextStartupState({ ...UNRESOLVED_LAUNCH, elapsedMs });
      expect(isDestination(state)).toBe(false);
      expect(state).not.toBe('authentication');
      expect(state).not.toBe('onboarding');
      expect(state).not.toBe('authenticated_home');
    }
  });

  it('shows the branded splash before the ceiling and the notice after it', () => {
    expect(nextStartupState({ ...UNRESOLVED_LAUNCH, elapsedMs: 0 })).toBe('branded_splash');
    expect(
      nextStartupState({ ...UNRESOLVED_LAUNCH, elapsedMs: STARTUP_PRESENTATION_CEILING_MS - 1 }),
    ).toBe('branded_splash');
    expect(
      nextStartupState({ ...UNRESOLVED_LAUNCH, elapsedMs: STARTUP_PRESENTATION_CEILING_MS }),
    ).toBe('still_resolving');
  });

  it('is still unresolved at the moment the bound fires, so the notice has not appeared yet', () => {
    /*
      The relationship the bound was chosen for. At `SESSION_RESOLUTION_TIMEOUT_MS` the launch either
      has an answer or has none, and either way the ceiling has not been reached — so #31's notice is
      reserved for launches that are *genuinely* unresolved rather than merely slow. If the bound were
      raised past the ceiling, every bounded launch would show the notice first and the notice would
      stop meaning what it says.
    */
    expect(
      nextStartupState({ ...UNRESOLVED_LAUNCH, elapsedMs: SESSION_RESOLUTION_TIMEOUT_MS }),
    ).toBe('branded_splash');
    expect(2000 + SESSION_RESOLUTION_TIMEOUT_MS).toBeLessThan(STARTUP_PRESENTATION_CEILING_MS);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The notice means what it says
// ─────────────────────────────────────────────────────────────────────────────

describe('the still-resolving notice appears only while authority is genuinely unresolved', () => {
  it('never appears once the session has answered', () => {
    for (const elapsedMs of [0, 1800, 9999, 10_000, 45_000]) {
      expect(nextStartupState({ ...SIGNED_IN, elapsedMs })).not.toBe('still_resolving');
      expect(
        nextStartupState({
          ...UNRESOLVED_LAUNCH,
          isSignedIn: false,
          hasCompletedOnboarding: true,
          hasPendingRecovery: false,
          elapsedMs,
        }),
      ).not.toBe('still_resolving');
    }
  });

  it('does not appear merely because the profile has not arrived', () => {
    /*
      The change most likely to make the notice lie. Authority now publishes with the local onboarding
      flag, so `hasCompletedOnboarding` is never null for a signed-in launch and the machine resolves
      — a slow *profile* cannot hold the splash or show the notice, because nothing is waiting on it.
    */
    const resolvedWithoutProfile: StartupInput = {
      ...SIGNED_IN,
      elapsedMs: STARTUP_PRESENTATION_CEILING_MS + 5000,
    };
    expect(isResolved(resolvedWithoutProfile)).toBe(true);
    expect(nextStartupState(resolvedWithoutProfile)).toBe('authenticated_home');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// What still holds a launch after this change — found on a device
// ─────────────────────────────────────────────────────────────────────────────

describe('the plan-selection read is the remaining unbounded step', () => {
  it('holds an online launch indefinitely while it has not answered', () => {
    /*
      ═══════════════════════════════════════════════════════════════════════
      ── A device measurement, pinned so it is not lost ─────────────────────
      Measured on both targets against a link where the platform reports
      connectivity and nothing answers (a black-hole proxy — a captive portal in effect), with a
      valid stored session: **neither the before nor the after build reaches Main Home**, and both
      show #31's notice from about thirteen seconds onward, indefinitely.

      The session bound does not help there, and this is why. `getSession()` returns immediately from
      the stored session when the token has not expired, so authority publishes as `online` at once —
      nothing times out. `use-startup-routing` then attempts `readAccountJourney`, which is a Supabase
      read that is **not** bounded and, on that link, never answers. `isResolved` requires
      `hasCompletedPlanSelection !== null` for an online signed-in launch, so the launch waits forever
      on the third network read rather than on either of the two #34 names.

      It is deliberately **not** bounded as part of this change. The existing failure handler maps a
      failed journey read to `planSelected: false`, which routes to the subscription chooser — so a
      bound here would not resolve the launch honestly, it would send a paying user to a purchase
      screen because the network was slow. That is the same class of mistake as the sign-out defect,
      and it deserves its own issue rather than a timer bolted on to this one.

      Offline authority is exempt, which is the one case that does get faster: the read is skipped
      entirely and the input substituted.
      ═══════════════════════════════════════════════════════════════════════
    */
    for (const elapsedMs of [1800, SESSION_RESOLUTION_TIMEOUT_MS, 10_000, 45_000, 120_000]) {
      const input: StartupInput = {
        ...SIGNED_IN,
        hasCompletedPlanSelection: null,
        elapsedMs,
      };
      expect(isResolved(input)).toBe(false);
      expect(isDestination(nextStartupState(input))).toBe(false);
    }
  });

  it('does not hold an offline launch, because that read is skipped', () => {
    /* The substitution in `use-startup-routing` is what makes the bound's own outcome routable. */
    expect(isResolved({ ...SIGNED_IN, hasCompletedPlanSelection: true })).toBe(true);
    expect(nextStartupState({ ...SIGNED_IN, hasCompletedPlanSelection: true })).toBe(
      'authenticated_home',
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Recovery containment still outranks everything
// ─────────────────────────────────────────────────────────────────────────────

describe('recovery containment survives every slow path', () => {
  it('contains a signed-in launch whatever else is outstanding', () => {
    /*
      #30 must be armed on every launch path, including the new ones. A contained session is contained
      whether the plan read has answered, the profile has not, the bound fired, or the ceiling passed.
    */
    for (const hasCompletedPlanSelection of [true, false, null]) {
      for (const elapsedMs of [1800, SESSION_RESOLUTION_TIMEOUT_MS, 10_000, 60_000]) {
        expect(
          nextStartupState({
            ...SIGNED_IN,
            hasPendingRecovery: true,
            hasCompletedPlanSelection,
            elapsedMs,
          }),
        ).toBe('password_recovery');
      }
    }
  });

  it('does not let offline authority skip containment', () => {
    /*
      The bound's own outcome. A receipt adopted at the bound is a signed-in launch, so containment
      applies to it exactly as it does to an online one — a faster route to authority must not become
      a route around recovery.
    */
    expect(
      nextStartupState({
        ...SIGNED_IN,
        hasPendingRecovery: true,
        hasCompletedPlanSelection: true,
        elapsedMs: SESSION_RESOLUTION_TIMEOUT_MS,
      }),
    ).toBe('password_recovery');
  });

  it('still waits for the recovery read before routing a signed-in launch', () => {
    /* Authority arriving sooner must not let the launch route before containment is known. */
    expect(isResolved({ ...SIGNED_IN, hasPendingRecovery: null })).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Nothing protected renders before authority
// ─────────────────────────────────────────────────────────────────────────────

describe('protected content never mounts early', () => {
  it('waits rather than allowing while the session is unknown', () => {
    /* Exactly the state a fired bound with no receipt leaves. `wait`, not `allow` and not `redirect`. */
    expect(protectedRouteAccess({ ...AUTH_STATE, status: 'unknown' })).toBe('wait');
  });

  it('allows under either authority once one exists, and redirects when signed out', () => {
    expect(
      protectedRouteAccess({
        ...AUTH_STATE,
        status: 'signed-in',
        authority: 'offline',
        user: { id: 'x', fullName: 'A', givenName: 'A', subscriptionTier: 'free', greeting: 'x' },
      }),
    ).toBe('allow');
    expect(
      protectedRouteAccess({
        ...AUTH_STATE,
        status: 'signed-in',
        authority: 'online',
        user: { id: 'x', fullName: 'A', givenName: 'A', subscriptionTier: 'free', greeting: 'x' },
      }),
    ).toBe('allow');
    expect(protectedRouteAccess({ ...AUTH_STATE, status: 'signed-out' })).toBe('redirect');
  });

  it('is unaffected by whether the profile has arrived', () => {
    /*
      The boundary reads status and authority, never the display name — so an authority published
      before its profile is exactly as admissible as one published after. Asserted so that a future
      change adding an identity condition here has to confront this case.
    */
    const withSessionName = {
      ...AUTH_STATE,
      status: 'signed-in' as const,
      authority: 'online' as const,
      user: {
        id: 'x',
        fullName: 'Signup Name',
        givenName: 'Signup',
        subscriptionTier: 'free' as const,
        greeting: 'x',
      },
    };
    const withDurableName = {
      ...withSessionName,
      user: { ...withSessionName.user, fullName: 'Durable Name', givenName: 'Durable' },
    };
    expect(protectedRouteAccess(withSessionName)).toBe(protectedRouteAccess(withDurableName));
    expect(protectedRouteAccess(withSessionName)).toBe('allow');
  });
});
