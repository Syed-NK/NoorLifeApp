import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { AppProviders } from '@application/providers/app-providers';
import {
  AccountSecurityError,
  type AccountSecurityPort,
  type AccountSecuritySummary,
} from '@services/account/account-security.contract';

import { mockRouter } from '../../../../jest.setup';
import { privacySecurityCopy } from '../privacy-security-copy';
import { ChangePasswordScreen } from '../screens/change-password-screen';

/**
 * Change Password — validation, single submission, the backend's reauthentication flow, and what
 * never leaves the screen.
 *
 * ── Why every state here is injected ────────────────────────────────────────
 * A genuine test account's password must not be changed to produce these results, and the
 * reauthentication path is unreachable without a session more than 24 hours old. Both constraints
 * point the same way: drive the port, assert the screen.
 */

jest.setTimeout(30000);

const EMAIL_SUMMARY: AccountSecuritySummary = {
  provider: 'email',
  email: 'ahmed@example.com',
  emailVerification: 'verified',
  lastSignInAt: null,
  canManagePassword: true,
  pendingEmail: null,
};

type Fake = AccountSecurityPort & {
  readonly updates: jest.Mock;
  readonly codes: jest.Mock;
};

function fakePort(options: {
  readonly summary?: Partial<AccountSecuritySummary>;
  readonly updateFails?: AccountSecurityError;
  /** Fails the first call only, so the reauthentication retry can succeed. */
  readonly updateFailsOnce?: AccountSecurityError;
} = {}): Fake {
  let attempts = 0;
  const updates = jest.fn(async () => {
    attempts += 1;
    // Resolving on a later tick is what lets the "exactly once" test press twice while the first
    // request is genuinely still open.
    await Promise.resolve();
    if (options.updateFails !== undefined) {
      throw options.updateFails;
    }
    if (options.updateFailsOnce !== undefined && attempts === 1) {
      throw options.updateFailsOnce;
    }
  });
  const codes = jest.fn(() => Promise.resolve());

  return {
    readSummary: () => Promise.resolve({ ...EMAIL_SUMMARY, ...options.summary }),
    sendReauthenticationCode: codes,
    updatePassword: updates,
    requestEmailChange: () =>
      Promise.resolve({ status: 'pending' as const, requestedEmail: 'x@example.com' }),
    signOutThisDevice: () => Promise.resolve(),
    signOutEverywhere: () => Promise.resolve({ status: 'signed-out-everywhere' as const }),
    updates,
    codes,
  };
}

async function renderScreen(port: AccountSecurityPort, testID = 'change-password-form') {
  const view = render(
    <AppProviders>
      <ChangePasswordScreen port={port} />
    </AppProviders>,
  );
  await waitFor(() => expect(screen.getByTestId(testID)).toBeTruthy(), { timeout: 15000 });
  return view;
}

describe('an email and password account', () => {
  it('shows the real supported form', async () => {
    await renderScreen(fakePort());

    expect(screen.getByTestId('change-password-new')).toBeTruthy();
    expect(screen.getByTestId('change-password-confirm')).toBeTruthy();
    expect(screen.getByTestId('change-password-submit')).toBeTruthy();
  });

  it('masks both fields by default and offers a reveal on each', async () => {
    await renderScreen(fakePort());

    expect(screen.getByTestId('change-password-new').props.secureTextEntry).toBe(true);
    expect(screen.getByTestId('change-password-confirm').props.secureTextEntry).toBe(true);

    await fireEvent.press(screen.getByTestId('change-password-new-reveal'));
    expect(screen.getByTestId('change-password-new').props.secureTextEntry).toBe(false);
    // Revealing one does not reveal the other.
    expect(screen.getByTestId('change-password-confirm').props.secureTextEntry).toBe(true);
  });

  it('declares password-manager hints so autofill can offer to save', async () => {
    await renderScreen(fakePort());

    for (const testID of ['change-password-new', 'change-password-confirm']) {
      expect(screen.getByTestId(testID).props.autoComplete).toBe('new-password');
      expect(screen.getByTestId(testID).props.textContentType).toBe('newPassword');
    }
  });

  it('does not show a reauthentication step until the backend asks for one', async () => {
    await renderScreen(fakePort());

    expect(screen.queryByTestId('change-password-reauth')).toBeNull();
  });
});

describe('validation', () => {
  it('rejects an empty password without calling the service', async () => {
    const port = fakePort();
    await renderScreen(port);

    await fireEvent.press(screen.getByTestId('change-password-submit'));

    expect(screen.getByTestId('change-password-new-error')).toHaveTextContent(
      privacySecurityCopy.password.errors.empty,
    );
    expect(port.updates).not.toHaveBeenCalled();
  });

  it('rejects a weak password using the existing policy', async () => {
    const port = fakePort();
    await renderScreen(port);

    // Under the shared `scorePassword` minimum, which Sign Up and New Password already enforce.
    await fireEvent.changeText(screen.getByTestId('change-password-new'), 'abc');
    await fireEvent.changeText(screen.getByTestId('change-password-confirm'), 'abc');
    await fireEvent.press(screen.getByTestId('change-password-submit'));

    expect(screen.getByTestId('change-password-new-error')).toHaveTextContent(
      privacySecurityCopy.password.errors.weak,
    );
    expect(port.updates).not.toHaveBeenCalled();
  });

  it('rejects a mismatched confirmation', async () => {
    const port = fakePort();
    await renderScreen(port);

    await fireEvent.changeText(screen.getByTestId('change-password-new'), 'NoorLife2026!');
    await fireEvent.changeText(screen.getByTestId('change-password-confirm'), 'NoorLife2027!');
    await fireEvent.press(screen.getByTestId('change-password-submit'));

    expect(screen.getByTestId('change-password-confirm-error')).toHaveTextContent(
      privacySecurityCopy.password.errors.mismatch,
    );
    expect(port.updates).not.toHaveBeenCalled();
  });
});

describe('submission', () => {
  async function fillValid() {
    await fireEvent.changeText(screen.getByTestId('change-password-new'), 'NoorLife2026!');
    await fireEvent.changeText(screen.getByTestId('change-password-confirm'), 'NoorLife2026!');
  }

  it('calls the service exactly once, however many times the button is pressed', async () => {
    const port = fakePort();
    await renderScreen(port);
    await fillValid();

    // Three presses in the same tick, deliberately unawaited: that is what a double tap actually
    // is, and it is the case the `busy` guard exists to swallow. Awaiting each press would let the
    // first request finish and clear the fields, so the later presses would be rejected by
    // validation instead — the right count for the wrong reason.
    const submit = screen.getByTestId('change-password-submit');
    await act(async () => {
      fireEvent.press(submit);
      fireEvent.press(submit);
      fireEvent.press(submit);
    });

    await waitFor(() => expect(port.updates).toHaveBeenCalledTimes(1));
  });

  it('sends the typed password and no other credential', async () => {
    const port = fakePort();
    await renderScreen(port);
    await fillValid();

    await fireEvent.press(screen.getByTestId('change-password-submit'));

    await waitFor(() => expect(port.updates).toHaveBeenCalledTimes(1));
    expect(port.updates).toHaveBeenCalledWith({ newPassword: 'NoorLife2026!' });
  });

  it('confirms success and clears the fields', async () => {
    const port = fakePort();
    await renderScreen(port);
    await fillValid();

    await fireEvent.press(screen.getByTestId('change-password-submit'));

    await waitFor(() => expect(screen.getByTestId('change-password-success')).toBeTruthy());
    expect(screen.getByTestId('change-password-new').props.value).toBe('');
    expect(screen.getByTestId('change-password-confirm').props.value).toBe('');
  });

  it('returns safely to Privacy & Security after a success', async () => {
    const port = fakePort();
    await renderScreen(port);
    await fillValid();
    await fireEvent.press(screen.getByTestId('change-password-submit'));
    await waitFor(() => expect(screen.getByTestId('change-password-success')).toBeTruthy());

    await fireEvent.press(screen.getByTestId('change-password-success-back'));
    expect(mockRouter.dismissTo).toHaveBeenCalledWith('/profile/privacy-security');
  });

  it('keeps the entered password on a recoverable failure so the user retries rather than retypes', async () => {
    const port = fakePort({ updateFails: new AccountSecurityError('offline') });
    await renderScreen(port);
    await fillValid();

    await fireEvent.press(screen.getByTestId('change-password-submit'));

    await waitFor(() => expect(screen.getByTestId('change-password-error')).toBeTruthy());
    expect(screen.getByTestId('change-password-error')).toHaveTextContent(
      privacySecurityCopy.errors.offline,
    );
    expect(screen.getByTestId('change-password-new').props.value).toBe('NoorLife2026!');
    expect(screen.queryByTestId('change-password-success')).toBeNull();
  });

  it('clears the password when the session has expired, since it can no longer be used', async () => {
    const port = fakePort({ updateFails: new AccountSecurityError('session-expired') });
    await renderScreen(port);
    await fillValid();

    await fireEvent.press(screen.getByTestId('change-password-submit'));

    await waitFor(() => expect(screen.getByTestId('change-password-error')).toBeTruthy());
    expect(screen.getByTestId('change-password-new').props.value).toBe('');
  });

  it.each([
    ['same-password', privacySecurityCopy.errors['same-password']],
    ['weak-password', privacySecurityCopy.errors['weak-password']],
    ['rate-limited', privacySecurityCopy.errors['rate-limited']],
  ] as const)('renders the mapped message for %s and never a raw one', async (code, message) => {
    const port = fakePort({ updateFails: new AccountSecurityError(code) });
    await renderScreen(port);
    await fillValid();

    await fireEvent.press(screen.getByTestId('change-password-submit'));

    await waitFor(() => expect(screen.getByTestId('change-password-error')).toBeTruthy());
    expect(screen.getByTestId('change-password-error')).toHaveTextContent(message);
  });
});

describe('reauthentication', () => {
  it('reveals the confirmation step only after the backend requires it', async () => {
    const port = fakePort({
      updateFailsOnce: new AccountSecurityError('reauthentication-required'),
    });
    await renderScreen(port);

    expect(screen.queryByTestId('change-password-reauth')).toBeNull();

    await fireEvent.changeText(screen.getByTestId('change-password-new'), 'NoorLife2026!');
    await fireEvent.changeText(screen.getByTestId('change-password-confirm'), 'NoorLife2026!');
    await fireEvent.press(screen.getByTestId('change-password-submit'));

    await waitFor(() => expect(screen.getByTestId('change-password-reauth')).toBeTruthy());
    expect(screen.getByTestId('change-password-error')).toHaveTextContent(
      privacySecurityCopy.errors['reauthentication-required'],
    );
  });

  it('uses the supported Supabase flow rather than verifying anything locally', async () => {
    const port = fakePort({
      updateFailsOnce: new AccountSecurityError('reauthentication-required'),
    });
    await renderScreen(port);

    await fireEvent.changeText(screen.getByTestId('change-password-new'), 'NoorLife2026!');
    await fireEvent.changeText(screen.getByTestId('change-password-confirm'), 'NoorLife2026!');
    await fireEvent.press(screen.getByTestId('change-password-submit'));
    await waitFor(() => expect(screen.getByTestId('change-password-reauth')).toBeTruthy());

    await fireEvent.press(screen.getByTestId('change-password-reauth-send'));
    await waitFor(() => expect(port.codes).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId('change-password-reauth-sent')).toBeTruthy();
  });

  it('will not resubmit without the emailed code', async () => {
    const port = fakePort({
      updateFailsOnce: new AccountSecurityError('reauthentication-required'),
    });
    await renderScreen(port);

    await fireEvent.changeText(screen.getByTestId('change-password-new'), 'NoorLife2026!');
    await fireEvent.changeText(screen.getByTestId('change-password-confirm'), 'NoorLife2026!');
    await fireEvent.press(screen.getByTestId('change-password-submit'));
    await waitFor(() => expect(screen.getByTestId('change-password-reauth')).toBeTruthy());
    expect(port.updates).toHaveBeenCalledTimes(1);

    await fireEvent.press(screen.getByTestId('change-password-submit'));
    // Still one: the missing nonce is caught before a second pointless request.
    expect(port.updates).toHaveBeenCalledTimes(1);
  });

  it('passes the emailed nonce through to the update call', async () => {
    const port = fakePort({
      updateFailsOnce: new AccountSecurityError('reauthentication-required'),
    });
    await renderScreen(port);

    await fireEvent.changeText(screen.getByTestId('change-password-new'), 'NoorLife2026!');
    await fireEvent.changeText(screen.getByTestId('change-password-confirm'), 'NoorLife2026!');
    await fireEvent.press(screen.getByTestId('change-password-submit'));
    await waitFor(() => expect(screen.getByTestId('change-password-reauth')).toBeTruthy());

    await fireEvent.press(screen.getByTestId('change-password-reauth-send'));
    await waitFor(() => expect(screen.getByTestId('change-password-reauth-code')).toBeTruthy());

    await fireEvent.changeText(screen.getByTestId('change-password-reauth-code'), '123456');
    await fireEvent.press(screen.getByTestId('change-password-submit'));

    await waitFor(() => expect(port.updates).toHaveBeenCalledTimes(2));
    expect(port.updates).toHaveBeenLastCalledWith({
      newPassword: 'NoorLife2026!',
      nonce: '123456',
    });
    await waitFor(() => expect(screen.getByTestId('change-password-success')).toBeTruthy());
  });
});

describe('a social account', () => {
  it('shows the provider explanation and no form at all', async () => {
    const port = fakePort({
      summary: { provider: 'google', canManagePassword: false },
    });
    await renderScreen(port, 'change-password-provider-managed');

    expect(
      screen.getByText(privacySecurityCopy.password.providerManagedTitle('Google')),
    ).toBeTruthy();
    // Not a disabled form — no form.
    expect(screen.queryByTestId('change-password-new')).toBeNull();
    expect(screen.queryByTestId('change-password-submit')).toBeNull();
  });

  it('invents no provider management URL', async () => {
    const port = fakePort({ summary: { provider: 'apple', canManagePassword: false } });
    await renderScreen(port, 'change-password-provider-managed');

    const page = JSON.stringify(screen.toJSON());
    expect(page).not.toMatch(/https?:\/\/(accounts\.google|appleid\.apple)/);
  });
});

describe('what the screen never does with a password', () => {
  it('logs nothing at all during a full submission', async () => {
    const spies = {
      log: jest.spyOn(console, 'log').mockImplementation(() => undefined),
      warn: jest.spyOn(console, 'warn').mockImplementation(() => undefined),
      error: jest.spyOn(console, 'error').mockImplementation(() => undefined),
      info: jest.spyOn(console, 'info').mockImplementation(() => undefined),
      debug: jest.spyOn(console, 'debug').mockImplementation(() => undefined),
    };
    const port = fakePort();
    await renderScreen(port);

    await fireEvent.changeText(screen.getByTestId('change-password-new'), 'NoorLife2026!');
    await fireEvent.changeText(screen.getByTestId('change-password-confirm'), 'NoorLife2026!');
    await fireEvent.press(screen.getByTestId('change-password-submit'));
    await waitFor(() => expect(screen.getByTestId('change-password-success')).toBeTruthy());

    for (const spy of Object.values(spies)) {
      const emitted = spy.mock.calls.flat().map(String).join(' ');
      expect(emitted).not.toContain('NoorLife2026!');
      spy.mockRestore();
    }
  });

  it('never renders the password as plain text outside the masked field', async () => {
    await renderScreen(fakePort());

    await fireEvent.changeText(screen.getByTestId('change-password-new'), 'NoorLife2026!');

    // The value lives on the secure input and nowhere else — no echo in a banner, a hint or a
    // status line.
    const matches = screen.queryAllByText('NoorLife2026!');
    expect(matches).toHaveLength(0);
  });
});
