import { render, screen, userEvent, waitFor } from '@testing-library/react-native';

import { AuthProvider } from '@application/providers/auth-provider';
import { supabase } from '@/lib/supabase';

import { SignUpScreen } from '../screens/sign-up-screen';
import { VerifyEmailScreen } from '../screens/verify-email-screen';
import { verifyEmailCopy } from '../entry-auth-copy';
import { mockRouter } from '../../../../jest.setup';

/**
 * Where signup goes next.
 *
 * The screen used to send every successful signup to Verify Email. When a project auto-confirms new
 * accounts — which is what happens with email confirmation off — Supabase returns a live session and
 * sends no email at all, so that screen sat there asking for a six-digit code that did not exist and
 * never would. These lock the branch.
 */

const client = supabase as unknown as {
  auth: { signUp: jest.Mock; getSession: jest.Mock };
};

async function fillAndSubmit() {
  const user = userEvent.setup();
  await user.type(screen.getByTestId('signup-name'), 'Syed Khamer');
  await user.type(screen.getByTestId('signup-email'), 'syed@example.com');
  await user.type(screen.getByTestId('signup-password'), 'NoorLife2026x');
  await user.type(screen.getByTestId('signup-confirm'), 'NoorLife2026x');
  await user.press(screen.getByTestId('signup-terms'));
  await user.press(screen.getByTestId('signup-submit'));
}

describe('signup routing', () => {
  const confirmedSession = {
    user: {
      id: 'u1',
      email: 'syed@example.com',
      email_confirmed_at: '2026-01-01T00:00:00Z',
      user_metadata: { full_name: 'Syed Khamer' },
    },
  };

  it('goes to Account Ready when the project auto-confirms and no email is sent', async () => {
    // Supabase returns a session immediately: nothing to verify.
    client.auth.signUp = jest.fn(() =>
      Promise.resolve({
        data: { session: confirmedSession, user: confirmedSession.user },
        error: null,
      }),
    );
    client.auth.getSession = jest.fn(() =>
      Promise.resolve({ data: { session: confirmedSession }, error: null }),
    );

    await render(
      <AuthProvider>
        <SignUpScreen />
      </AuthProvider>,
    );
    await fillAndSubmit();

    await waitFor(() => {
      expect(mockRouter.replace).toHaveBeenCalledWith('/account-ready');
    });
    // The dead end this test exists to prevent.
    expect(mockRouter.push).not.toHaveBeenCalledWith('/verify-email');
  });

  it('goes to Verify Email when confirmation really is required', async () => {
    // No session returned: Supabase has emailed a code.
    client.auth.signUp = jest.fn(() =>
      Promise.resolve({ data: { session: null, user: confirmedSession.user }, error: null }),
    );

    await render(
      <AuthProvider>
        <SignUpScreen />
      </AuthProvider>,
    );
    await fillAndSubmit();

    await waitFor(() => {
      expect(mockRouter.push).toHaveBeenCalledWith('/verify-email');
    });
  });
});

describe('Verify Email with nothing outstanding', () => {
  it('says no code is needed instead of promising one', async () => {
    // Rendered without a pending address, as a direct visit or an auto-confirmed signup would.
    await render(
      <AuthProvider>
        <VerifyEmailScreen />
      </AuthProvider>,
    );

    expect(screen.getByTestId('verify-nothing-pending')).toBeTruthy();
    expect(screen.getByText(verifyEmailCopy.nothingToVerify)).toBeTruthy();
    // The old subtitle claimed a code had been sent to "your email".
    expect(screen.queryByText(/We sent a 6-digit code/)).toBeNull();
  });

  it('disables Verify so it cannot submit a code that cannot exist', async () => {
    await render(
      <AuthProvider>
        <VerifyEmailScreen />
      </AuthProvider>,
    );

    expect(screen.getByTestId('verify-submit').props.accessibilityState.disabled).toBe(true);
  });
});
