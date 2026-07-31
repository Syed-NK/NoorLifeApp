import { render, screen, userEvent } from '@testing-library/react-native';

import { AuthProvider } from '@application/providers/auth-provider';

import { ENTRY_STEP_COUNT, entryStepIndex } from '../entry-steps';
import { LoginScreen } from '../screens/login-screen';
import { SignUpScreen } from '../screens/sign-up-screen';
import { WelcomeScreen } from '../screens/welcome-screen';
import { mockRouter } from '../../../../jest.setup';

/**
 * The entry sequence's dot row on the screens past onboarding.
 *
 * The shape being locked here is that Welcome and both credentials screens are part of one
 * five-dot sequence, and that every backward move is a `replace` — Welcome is usually the stack
 * root, so `router.back()` from it does nothing at all.
 */

describe('the step model', () => {
  it('gives Sign In and Sign Up the same dot', () => {
    // They are alternatives reached from Welcome, not consecutive steps: the screens swap places
    // with `replace`. Separate dots would draw an order the flow does not have.
    expect(entryStepIndex.credentials).toBe(4);
    expect(ENTRY_STEP_COUNT).toBe(5);
  });

  it('puts Welcome directly after the three onboarding panels', () => {
    expect([
      entryStepIndex.onboardingOne,
      entryStepIndex.onboardingTwo,
      entryStepIndex.onboardingThree,
      entryStepIndex.welcome,
    ]).toEqual([0, 1, 2, 3]);
  });
});

describe('Welcome', () => {
  it('shows the sequence with its own dot active', async () => {
    await render(
      <AuthProvider>
        <WelcomeScreen />
      </AuthProvider>,
    );

    expect(screen.getByTestId('welcome-dots-3-active')).toBeTruthy();
    expect(screen.getByLabelText('Step 4 of 5')).toBeTruthy();
  });

  it('returns to the last onboarding panel from its dot', async () => {
    const user = userEvent.setup();
    await render(
      <AuthProvider>
        <WelcomeScreen />
      </AuthProvider>,
    );

    await user.press(screen.getByTestId('welcome-dots-2'));

    expect(mockRouter.replace).toHaveBeenCalledWith('/onboarding/three');
  });
});

describe('the credentials screens', () => {
  it('lights the final dot on Login', async () => {
    await render(
      <AuthProvider>
        <LoginScreen />
      </AuthProvider>,
    );

    expect(screen.getByTestId('login-dots-4-active')).toBeTruthy();
    expect(screen.getByLabelText('Step 5 of 5')).toBeTruthy();
  });

  it('lights the same final dot on Sign Up', async () => {
    await render(
      <AuthProvider>
        <SignUpScreen />
      </AuthProvider>,
    );

    expect(screen.getByTestId('signup-dots-4-active')).toBeTruthy();
    expect(screen.getByLabelText('Step 5 of 5')).toBeTruthy();
  });

  it('goes back to Welcome from the form, not into the browser history', async () => {
    const user = userEvent.setup();
    await render(
      <AuthProvider>
        <SignUpScreen />
      </AuthProvider>,
    );

    await user.press(screen.getByTestId('signup-dots-3'));

    expect(mockRouter.replace).toHaveBeenCalledWith('/welcome');
  });
});
