import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { useEffect } from 'react';

import { useAuthCallbackActions } from '@application/providers/auth-callback-provider';
import { AppProviders } from '@application/providers/app-providers';
import { installMockLatencyTimers } from '@/test-support/mock-latency-timers';
import {
  AccountSecurityError,
  type AccountSecurityPort,
} from '@services/account/account-security.contract';

import { mockRouter } from '../../../../jest.setup';
import { authCallbackCopy } from '../auth-callback-copy';
import { SetNewPasswordScreen } from '../screens/set-new-password-screen';

installMockLatencyTimers(() => renderScreen());

/**
 * `/auth/set-new-password` — the recovery gate, and the credential it is allowed to rotate.
 *
 * ── What this suite is really about ─────────────────────────────────────────
 * The screen it replaces read a `code` route parameter, showed a banner when it was absent, and then
 * called `updateUser({ password })` anyway — so the password it set belonged to whatever session
 * existed. These tests assert the opposite property from three directions: no grant means no form, a
 * grant for another account means a refusal, and a spent grant cannot be used twice.
 *
 * The port is injected so no real account's password is changed to produce any of it.
 */

const copy = authCallbackCopy.setNewPassword;
const STRONG = 'NoorLife2026!';
/** The signed-in id the shared Supabase double reports, so a matching grant is the realistic case. */
const SESSION_USER_ID = 'test-user-id';

type Fake = AccountSecurityPort & { readonly updates: jest.Mock };

function fakePort(options: { readonly updateFails?: AccountSecurityError } = {}): Fake {
  const updates = jest.fn(async () => {
    await Promise.resolve();
    if (options.updateFails !== undefined) {
      throw options.updateFails;
    }
  });
  return {
    readSummary: () =>
      Promise.resolve({
        provider: 'email' as const,
        email: 'ahmed@example.com',
        emailVerification: 'verified' as const,
        lastSignInAt: null,
        canManagePassword: true,
        pendingEmail: null,
      }),
    sendReauthenticationCode: () => Promise.resolve(),
    updatePassword: updates,
    requestEmailChange: () =>
      Promise.resolve({ status: 'pending' as const, requestedEmail: 'x@example.com' }),
    signOutThisDevice: () => Promise.resolve(),
    signOutEverywhere: () => Promise.resolve({ status: 'signed-out-everywhere' as const }),
    updates,
  };
}

/**
 * Mints the grant a successful recovery exchange would have left behind.
 *
 * Rendered beside the screen inside `AppProviders`, so the grant travels the same `AuthCallbackProvider`
 * context the real flow uses rather than being injected as a prop the production path does not have.
 */
function GrantRecovery({ userId }: { readonly userId: string }) {
  const { grantRecovery } = useAuthCallbackActions();
  useEffect(() => {
    grantRecovery({ userId });
  }, [grantRecovery, userId]);
  return null;
}

async function renderScreen(
  options: { readonly grantFor?: string | null; readonly port?: AccountSecurityPort } = {},
) {
  const view = await render(
    <AppProviders>
      {options.grantFor === null || options.grantFor === undefined ? null : (
        <GrantRecovery userId={options.grantFor} />
      )}
      <SetNewPasswordScreen port={options.port ?? fakePort()} />
    </AppProviders>,
  );
  await act(async () => {
    await Promise.resolve();
  });
  return view;
}

describe('without a recovery grant', () => {
  it('shows no form at all', async () => {
    await renderScreen();

    await waitFor(() => expect(screen.getByTestId('set-new-password-no-grant')).toBeTruthy());
    // Not a disabled form, and certainly not one that submits against the ambient session.
    expect(screen.queryByTestId('set-new-password-form')).toBeNull();
    expect(screen.queryByTestId('set-new-password-new')).toBeNull();
    expect(screen.queryByTestId('set-new-password-submit')).toBeNull();
  });

  it('explains where a reset has to start', async () => {
    await renderScreen();

    await waitFor(() => expect(screen.getByTestId('set-new-password-no-grant')).toBeTruthy());
    expect(screen.getByTestId('set-new-password-no-grant-banner')).toHaveTextContent(
      copy.noGrantTitle,
    );
  });

  it('cannot reach the service by any route on the screen', async () => {
    const port = fakePort();
    await renderScreen({ port });

    await waitFor(() => expect(screen.getByTestId('set-new-password-no-grant')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('set-new-password-no-grant-request'));

    /**
     * The property the previous screen did not have. With no grant there is no control that reaches
     * `updateUser`, so an ordinary live session cannot have its password rotated from here.
     */
    expect(port.updates).not.toHaveBeenCalled();
    expect(mockRouter.replace).toHaveBeenCalledWith('/forgot-password');
  });
});

describe('with a grant for another account', () => {
  it('refuses rather than changing the wrong account’s password', async () => {
    const port = fakePort();
    await renderScreen({ grantFor: 'somebody-else', port });

    await waitFor(() => expect(screen.getByTestId('set-new-password-mismatch')).toBeTruthy());
    expect(screen.getByTestId('set-new-password-mismatch-banner')).toHaveTextContent(
      copy.mismatchTitle,
    );
    expect(screen.queryByTestId('set-new-password-form')).toBeNull();
    expect(port.updates).not.toHaveBeenCalled();
  });

  it('offers a fresh link rather than a way through', async () => {
    await renderScreen({ grantFor: 'somebody-else' });
    await waitFor(() =>
      expect(screen.getByTestId('set-new-password-mismatch-request')).toBeTruthy(),
    );

    await fireEvent.press(screen.getByTestId('set-new-password-mismatch-request'));
    expect(mockRouter.replace).toHaveBeenCalledWith('/forgot-password');
  });
});

describe('with a valid grant', () => {
  async function renderWithGrant(options: { readonly port?: AccountSecurityPort } = {}) {
    const view = await renderScreen({ grantFor: SESSION_USER_ID, ...options });
    await waitFor(() => expect(screen.getByTestId('set-new-password-form')).toBeTruthy());
    return view;
  }

  async function fill(password: string, confirm = password) {
    await fireEvent.changeText(screen.getByTestId('set-new-password-new'), password);
    await fireEvent.changeText(screen.getByTestId('set-new-password-confirm'), confirm);
  }

  const isDisabled = () =>
    screen.getByTestId('set-new-password-submit').props.accessibilityState.disabled === true;

  it('shows the form', async () => {
    await renderWithGrant();
    expect(screen.getByTestId('set-new-password-new')).toBeTruthy();
    expect(screen.getByTestId('set-new-password-confirm')).toBeTruthy();
  });

  it('uses the same disabled rules as Change Password', async () => {
    await renderWithGrant();

    expect(isDisabled()).toBe(true);
    await fill('   ');
    expect(isDisabled()).toBe(true);
    await fill('abc');
    expect(isDisabled()).toBe(true);
    await fill(STRONG, 'NoorLife2027!');
    expect(isDisabled()).toBe(true);
    await fill(STRONG);
    expect(isDisabled()).toBe(false);
  });

  it('sets the password once, however many times it is pressed', async () => {
    const port = fakePort();
    await renderWithGrant({ port });
    await fill(STRONG);

    const submit = screen.getByTestId('set-new-password-submit');
    await act(async () => {
      void fireEvent.press(submit);
      void fireEvent.press(submit);
      void fireEvent.press(submit);
    });

    await waitFor(() => expect(port.updates).toHaveBeenCalledTimes(1));
    expect(port.updates).toHaveBeenCalledWith({ newPassword: STRONG });
  });

  it('accepts the keyboard’s own Submit through the same evaluator', async () => {
    const port = fakePort();
    await renderWithGrant({ port });
    await fill(STRONG);

    await fireEvent(screen.getByTestId('set-new-password-confirm'), 'submitEditing');

    await waitFor(() => expect(port.updates).toHaveBeenCalledTimes(1));
  });

  it('refuses a keyboard Submit when the form is not submittable', async () => {
    const port = fakePort();
    await renderWithGrant({ port });
    await fill(STRONG, 'NoorLife2027!');

    await fireEvent(screen.getByTestId('set-new-password-confirm'), 'submitEditing');

    expect(port.updates).not.toHaveBeenCalled();
  });

  it('confirms success, clears the fields and routes with replace', async () => {
    await renderWithGrant();
    await fill(STRONG);

    await fireEvent.press(screen.getByTestId('set-new-password-submit'));

    await waitFor(() => expect(screen.getByTestId('set-new-password-success')).toBeTruthy());
    expect(screen.queryByTestId('set-new-password-new')).toBeNull();

    await fireEvent.press(screen.getByTestId('set-new-password-success-sign-in'));
    /**
     * The entry gate, not Sign In (changed in Phase 6C-3D).
     *
     * The recovery session is kept and becomes an ordinary one the moment the update succeeds, so
     * sending the user to Sign In would ask a signed-in account to sign in again. Routing to the
     * gate re-runs the startup machine — with the containment marker now cleared — and lands on
     * whichever destination this account actually has, including the plan chooser if it still owes
     * that choice.
     *
     * Still `replace`, so Back cannot re-enter a completed recovery.
     */
    expect(mockRouter.replace).toHaveBeenCalledWith('/');
    expect(mockRouter.push).not.toHaveBeenCalled();
  });

  it('renders no password anywhere outside the masked field', async () => {
    await renderWithGrant();
    await fill(STRONG);

    expect(screen.queryAllByText(STRONG)).toHaveLength(0);
  });

  it('logs nothing during a full submission', async () => {
    const spies = (['log', 'warn', 'error', 'info', 'debug'] as const).map((level) =>
      jest.spyOn(console, level).mockImplementation(() => undefined),
    );

    await renderWithGrant();
    await fill(STRONG);
    await fireEvent.press(screen.getByTestId('set-new-password-submit'));
    await waitFor(() => expect(screen.getByTestId('set-new-password-success')).toBeTruthy());

    const emitted = spies.flatMap((spy) => spy.mock.calls.flat().map(String)).join(' ');
    expect(emitted).not.toContain(STRONG);
    for (const spy of spies) {
      spy.mockRestore();
    }
  });

  it('renders a mapped failure and keeps the typed password for a retry', async () => {
    const port = fakePort({ updateFails: new AccountSecurityError('offline') });
    await renderWithGrant({ port });
    await fill(STRONG);

    await fireEvent.press(screen.getByTestId('set-new-password-submit'));

    await waitFor(() => expect(screen.getByTestId('set-new-password-error')).toBeTruthy());
    expect(screen.getByTestId('set-new-password-new').props.value).toBe(STRONG);
    expect(screen.queryByTestId('set-new-password-success')).toBeNull();
  });

  it('drops the grant and the password when the recovery session has expired', async () => {
    const port = fakePort({ updateFails: new AccountSecurityError('session-expired') });
    await renderWithGrant({ port });
    await fill(STRONG);

    await fireEvent.press(screen.getByTestId('set-new-password-submit'));

    // Holding a password for a request that can no longer be made is pointless risk, and the grant it
    // depended on is no longer meaningful.
    await waitFor(() => expect(screen.getByTestId('set-new-password-no-grant')).toBeTruthy());
    expect(screen.queryByTestId('set-new-password-form')).toBeNull();
  });
});

describe('replay', () => {
  it('cannot be used a second time, because the grant was consumed', async () => {
    const port = fakePort();
    const view = await renderScreen({ grantFor: SESSION_USER_ID, port });
    await waitFor(() => expect(screen.getByTestId('set-new-password-form')).toBeTruthy());

    await fireEvent.changeText(screen.getByTestId('set-new-password-new'), STRONG);
    await fireEvent.changeText(screen.getByTestId('set-new-password-confirm'), STRONG);
    await fireEvent.press(screen.getByTestId('set-new-password-submit'));
    await waitFor(() => expect(screen.getByTestId('set-new-password-success')).toBeTruthy());
    expect(port.updates).toHaveBeenCalledTimes(1);

    /**
     * Returning to the route after a completed recovery.
     *
     * The grant was cleared on success, so a fresh mount finds none and shows the expired state. A grant
     * left live would let a second submission act on the same authorisation.
     */
    view.unmount();
    const second = await render(
      <AppProviders>
        <SetNewPasswordScreen port={port} />
      </AppProviders>,
    );
    await act(async () => {
      await Promise.resolve();
    });

    expect(second.getByTestId('set-new-password-no-grant')).toBeTruthy();
    expect(port.updates).toHaveBeenCalledTimes(1);
  });
});
