import { render, screen, waitFor } from '@testing-library/react-native';

import { AuthProvider } from '@application/providers/auth-provider';

import { ENTRY_STEP_COUNT, entryStepIndex } from '../entry-steps';
import { LoginScreen } from '../screens/login-screen';
import { SignUpScreen } from '../screens/sign-up-screen';
import { WelcomeScreen } from '../screens/welcome-screen';

/**
 * The entry sequence's dot row on the screens past onboarding.
 *
 * The shape being locked here is that Welcome and both credentials screens are part of one
 * three-dot onboarding sequence, and that every backward move is a `replace` — Welcome is usually
 * the stack root, so `router.back()` from it does nothing at all.
 */

describe('the step model', () => {
  it('has exactly three steps, one per onboarding panel', () => {
    // The approved product flow is three onboarding pages. This was five — the three panels plus
    // Welcome plus a shared dot for Sign In and Sign Up — which described a journey through
    // authentication that does not exist.
    expect(ENTRY_STEP_COUNT).toBe(3);
  });

  it('maps the three panels to the three dots in order', () => {
    expect([
      entryStepIndex.onboardingOne,
      entryStepIndex.onboardingTwo,
      entryStepIndex.onboardingThree,
    ]).toEqual([0, 1, 2]);
  });

  it('has no step for Welcome or the credentials screens', () => {
    // Guards the removal: authentication screens carry no indicator at all.
    expect(Object.keys(entryStepIndex)).toEqual([
      'onboardingOne',
      'onboardingTwo',
      'onboardingThree',
    ]);
  });
});

describe('the authentication screens', () => {
  it('shows no step indicator on Welcome', async () => {
    await render(
      <AuthProvider>
        <WelcomeScreen />
      </AuthProvider>,
    );

    // Phase 5C removed it. A progress indicator promises a finite sequence, and a user may sit on
    // Welcome indefinitely or move between Sign In and Sign Up — neither is progress toward
    // anything, so there is nothing honest for a dot to report.
    await waitFor(() => expect(screen.getByTestId('welcome-screen')).toBeTruthy());
    expect(screen.queryByTestId('welcome-dots')).toBeNull();
    expect(screen.queryByLabelText(/^Step \d+ of \d+$/)).toBeNull();
  });

  it('shows no step indicator on Login', async () => {
    await render(
      <AuthProvider>
        <LoginScreen />
      </AuthProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('login-screen')).toBeTruthy());
    expect(screen.queryByTestId('login-dots')).toBeNull();
  });

  it('shows no step indicator on Sign Up', async () => {
    await render(
      <AuthProvider>
        <SignUpScreen />
      </AuthProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('signup-screen')).toBeTruthy());
    expect(screen.queryByTestId('signup-dots')).toBeNull();
  });
});
