import { nextStartupState, isResolved, type StartupInput } from '../startup-machine';

/**
 * The post-signup journey decision.
 *
 * ── The defect these lock down ──────────────────────────────────────────────
 * A new account went signup → Main Home, skipping Account Success and the subscription
 * introduction. The cause was structural: a live Supabase session was treated as sufficient to
 * reach Home, and signing up produces one immediately. The machine now requires a *second* fact —
 * that the account has recorded a plan choice — and treats "unknown" as "not yet".
 */

function input(overrides: Partial<StartupInput> = {}): StartupInput {
  return {
    elapsedMs: 2000,
    fontsReady: true,
    isSignedIn: true,
    hasCompletedOnboarding: true,
    hasCompletedPlanSelection: true,
    failed: false,
    isFirstLaunch: false,
    ...overrides,
  };
}

describe('a session alone is not enough to reach Main Home', () => {
  it('sends a signed-in account with no recorded plan to the subscription choice', () => {
    expect(nextStartupState(input({ hasCompletedPlanSelection: false }))).toBe(
      'subscription_choice',
    );
  });

  it('treats an unknown plan answer as not chosen', () => {
    // Includes the case where the migration adding the column has not been applied. Reading
    // "cannot tell" as "already chose" is the exact bug: it routes a brand-new account to Home.
    expect(nextStartupState(input({ hasCompletedPlanSelection: null }))).not.toBe(
      'authenticated_home',
    );
  });

  it('lets a signed-in account through once a plan is recorded', () => {
    expect(nextStartupState(input({ hasCompletedPlanSelection: true }))).toBe('authenticated_home');
  });
});

describe('returning journeys', () => {
  it('A — returning authenticated user who chose a plan goes to Main Home', () => {
    expect(nextStartupState(input())).toBe('authenticated_home');
  });

  it('B — returning signed-out user goes to authentication', () => {
    expect(nextStartupState(input({ isSignedIn: false, hasCompletedPlanSelection: false }))).toBe(
      'authentication',
    );
  });

  it('C — newly authenticated user without a plan resumes at the subscription choice', () => {
    // Resuming here rather than at Home is what makes an interrupted signup recoverable.
    expect(nextStartupState(input({ hasCompletedPlanSelection: false }))).toBe(
      'subscription_choice',
    );
  });

  it('E — a user who selected Free goes straight to Main Home on later launches', () => {
    expect(nextStartupState(input({ hasCompletedPlanSelection: true }))).toBe('authenticated_home');
  });

  it('F — an expired paid subscriber still reaches Main Home', () => {
    // Expiry is an entitlement question handled by the module gate, not a startup routing one.
    // Sending them to a plan chooser on every launch would be a paywall on the whole app.
    expect(nextStartupState(input({ hasCompletedPlanSelection: true }))).toBe('authenticated_home');
  });
});

describe('a signed-out user is never held up by journey state', () => {
  it('resolves without a plan answer', () => {
    // A signed-out user has no account for the answer to describe; waiting would hold the splash
    // up for nothing.
    expect(isResolved(input({ isSignedIn: false, hasCompletedPlanSelection: null }))).toBe(true);
  });

  it('does not resolve for a signed-in user until the answer arrives', () => {
    expect(isResolved(input({ isSignedIn: true, hasCompletedPlanSelection: null }))).toBe(false);
    expect(isResolved(input({ isSignedIn: true, hasCompletedPlanSelection: false }))).toBe(true);
  });
});

describe('onboarding still precedes authentication', () => {
  it('sends a first-time signed-out user to onboarding, not the plan chooser', () => {
    expect(
      nextStartupState(
        input({
          isSignedIn: false,
          hasCompletedOnboarding: false,
          hasCompletedPlanSelection: false,
        }),
      ),
    ).toBe('onboarding');
  });
});
