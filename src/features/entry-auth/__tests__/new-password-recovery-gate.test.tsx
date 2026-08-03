import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { useEffect } from 'react';

import { AppProviders } from '@application/providers/app-providers';
import { useAuthCallbackActions } from '@application/providers/auth-callback-provider';
import * as authService from '@services/auth/auth.service';

import { mockRouter } from '../../../../jest.setup';
import { newPasswordCopy } from '../entry-auth-copy';
import { NewPasswordScreen } from '../screens/new-password-screen';

/**
 * Screen 11 can no longer rotate the signed-in account's password.
 *
 * ── The defect this suite exists to keep closed ─────────────────────────────
 * The audited screen read a `code` route parameter and showed a banner when it was absent — then called
 * `updateUser({ password })` regardless. The code was never exchanged and never checked, so the
 * parameter was decoration: reached with an ordinary live session, which the shared Supabase double
 * provides here, the screen silently became an unauthenticated Change Password.
 *
 * The tests below are therefore mostly about what does *not* happen. `updatePassword` on the real
 * service is spied rather than replaced, so a call that got through would be visible even if the screen
 * routed around the auth provider.
 */

const STRONG = 'NoorLife2026!';
/** The id the shared Supabase double's session reports. */
const SESSION_USER_ID = 'test-user-id';

/** Mints the grant a successful recovery exchange would have left behind. */
function GrantRecovery({ userId }: { readonly userId: string }) {
  const { grantRecovery } = useAuthCallbackActions();
  useEffect(() => {
    grantRecovery({ userId });
  }, [grantRecovery, userId]);
  return null;
}

let updateSpy: jest.SpyInstance;

beforeEach(() => {
  updateSpy = jest.spyOn(authService, 'updatePassword').mockResolvedValue(undefined);
});

afterEach(() => {
  updateSpy.mockRestore();
});

async function renderScreen(options: { readonly grantFor?: string } = {}) {
  const view = await render(
    <AppProviders>
      {options.grantFor === undefined ? null : <GrantRecovery userId={options.grantFor} />}
      <NewPasswordScreen />
    </AppProviders>,
  );
  await act(async () => {
    await Promise.resolve();
  });
  await waitFor(() => expect(screen.getByTestId('new-password-screen')).toBeTruthy());
  return view;
}

async function fill(password: string, confirm = password) {
  await fireEvent.changeText(screen.getByTestId('new-password-field'), password);
  await fireEvent.changeText(screen.getByTestId('new-password-confirm'), confirm);
}

const submit = () => screen.getByTestId('new-password-submit');

describe('without a recovery grant', () => {
  it('says a link is needed', async () => {
    await renderScreen();

    expect(screen.getByTestId('new-password-no-link')).toHaveTextContent(newPasswordCopy.noLink);
  });

  it('disables the control instead of accepting a press and refusing', async () => {
    await renderScreen();
    await fill(STRONG);

    // The previous version's parameter check refused nothing: the button was live and the only guard
    // was inside the handler, after the request had already been decided on.
    expect(submit().props.accessibilityState.disabled).toBe(true);
  });

  it('makes no update call even with a perfectly valid password typed', async () => {
    await renderScreen();
    await fill(STRONG);

    await fireEvent.press(submit());
    await act(async () => {
      await Promise.resolve();
    });

    /**
     * The whole point. A live ordinary session exists here — the shared double provides one — so a
     * screen that submitted would have changed that account's password without any recovery having
     * happened.
     */
    expect(updateSpy).not.toHaveBeenCalled();
    expect(mockRouter.replace).not.toHaveBeenCalledWith('/sign-in');
  });

  it('explains the refusal to a screen reader rather than describing the action', async () => {
    await renderScreen();
    expect(submit().props.accessibilityHint).toBe(newPasswordCopy.noLink);
  });

  it('is not enabled by a code in the route, which is an untrusted claim', async () => {
    /**
     * `useLocalSearchParams` is stubbed to `{}` for every suite, so this asserts the *absence of the
     * dependency*: the screen no longer consults a route parameter at all, and could not be re-enabled
     * by one. The grant is a fact this device established; a parameter is a claim on a link.
     */
    await renderScreen();
    await fill(STRONG);
    expect(submit().props.accessibilityState.disabled).toBe(true);
  });
});

describe('with a recovery grant', () => {
  it('enables the control and drops the no-link banner', async () => {
    await renderScreen({ grantFor: SESSION_USER_ID });

    expect(screen.queryByTestId('new-password-no-link')).toBeNull();
    expect(submit().props.accessibilityState.disabled).toBe(false);
  });

  it('sets the password and routes with replace', async () => {
    await renderScreen({ grantFor: SESSION_USER_ID });
    await fill(STRONG);

    await fireEvent.press(submit());

    await waitFor(() => expect(updateSpy).toHaveBeenCalledTimes(1));
    expect(updateSpy).toHaveBeenCalledWith(STRONG);
    // `replace`, so Back cannot re-enter a completed recovery.
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/sign-in'));
  });

  it('still refuses a weak password and a mismatch', async () => {
    await renderScreen({ grantFor: SESSION_USER_ID });

    await fill('abc');
    await fireEvent.press(submit());
    expect(updateSpy).not.toHaveBeenCalled();

    await fill(STRONG, 'NoorLife2027!');
    await fireEvent.press(submit());
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it('renders the password nowhere outside the masked field', async () => {
    await renderScreen({ grantFor: SESSION_USER_ID });
    await fill(STRONG);

    expect(screen.queryAllByText(STRONG)).toHaveLength(0);
  });
});

describe('Reset Link Sent', () => {
  it('no longer offers a shortcut into a screen that would refuse it', async () => {
    // The "I have the link — set a new password" affordance existed so the flow could be walked before a
    // real emailed link did anything. New Password now needs a grant, so the shortcut would have been a
    // control that invited a press and refused — the pattern this phase removed elsewhere.
    const source = readFileSync(
      join(__dirname, '..', 'screens', 'reset-link-sent-screen.tsx'),
      'utf8',
    );

    expect(source).not.toContain('testID="reset-sent-continue"');
    expect(source).not.toContain('authRoutes.newPassword');
  });
});
