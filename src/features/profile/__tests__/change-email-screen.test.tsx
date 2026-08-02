import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { AppProviders } from '@application/providers/app-providers';
import {
  AccountSecurityError,
  type AccountSecurityPort,
  type AccountSecuritySummary,
} from '@services/account/account-security.contract';

import { mockRouter } from '../../../../jest.setup';
import { privacySecurityCopy } from '../privacy-security-copy';
import { ChangeEmailScreen } from '../screens/change-email-screen';

/**
 * Change Email — and the single failure this suite exists to prevent.
 *
 * A screen that shows the new address as the account's address after a *request* has told the user
 * something that has not happened. With Secure Email Change enabled the session's address does not
 * move until both mailboxes confirm, so the visible authenticated email must come from the session
 * on every render and never from the field.
 */

jest.setTimeout(30000);

const SUMMARY: AccountSecuritySummary = {
  provider: 'email',
  email: 'ahmed@example.com',
  emailVerification: 'verified',
  lastSignInAt: null,
  canManagePassword: true,
  pendingEmail: null,
};

type Fake = AccountSecurityPort & { readonly requests: jest.Mock; readonly reads: jest.Mock };

function fakePort(options: {
  readonly summary?: Partial<AccountSecuritySummary>;
  /** Applied to the summary after a successful request, as Supabase's `new_email` would be. */
  readonly afterRequest?: Partial<AccountSecuritySummary>;
  readonly fails?: AccountSecurityError;
} = {}): Fake {
  let current: AccountSecuritySummary = { ...SUMMARY, ...options.summary };

  const reads = jest.fn(() => Promise.resolve(current));
  const requests = jest.fn(async (newEmail: string) => {
    await Promise.resolve();
    if (options.fails !== undefined) {
      throw options.fails;
    }
    if (options.afterRequest !== undefined) {
      current = { ...current, ...options.afterRequest };
    }
    return { status: 'pending' as const, requestedEmail: newEmail };
  });

  return {
    readSummary: reads,
    sendReauthenticationCode: () => Promise.resolve(),
    updatePassword: () => Promise.resolve(),
    requestEmailChange: requests,
    signOutThisDevice: () => Promise.resolve(),
    signOutEverywhere: () => Promise.resolve({ status: 'signed-out-everywhere' as const }),
    requests,
    reads,
  };
}

async function renderScreen(port: AccountSecurityPort, testID = 'change-email-form') {
  const view = render(
    <AppProviders>
      <ChangeEmailScreen port={port} />
    </AppProviders>,
  );
  await waitFor(() => expect(screen.getByTestId(testID)).toBeTruthy(), { timeout: 15000 });
  return view;
}

describe('the form', () => {
  it('shows the current authenticated address, read-only', async () => {
    await renderScreen(fakePort());

    expect(screen.getByTestId('change-email-current-value')).toHaveTextContent(
      'ahmed@example.com',
    );
    // A read-only row, not an editable field: there is exactly one text input on the screen.
    expect(screen.getByTestId('change-email-new')).toBeTruthy();
    expect(screen.queryByTestId('change-email-current-input')).toBeNull();
  });

  it('explains that confirmation is required on both addresses before anything is typed', async () => {
    await renderScreen(fakePort());

    const intro = String(screen.getByTestId('change-email-intro').props.children);
    expect(intro).toContain('both your current address and the new one');
    expect(intro).toContain('stays on the current address');
  });

  it('reports the delivery limitation honestly and without configuration detail', async () => {
    await renderScreen(fakePort());

    const note = String(screen.getByTestId('change-email-delivery-note').props.children);
    expect(note).toContain('still being set up');
    // No project reference, no SMTP host, no dashboard path.
    expect(note.toLowerCase()).not.toContain('smtp');
    expect(note.toLowerCase()).not.toContain('supabase');
  });
});

describe('validation', () => {
  it('rejects an empty address without calling the service', async () => {
    const port = fakePort();
    await renderScreen(port);

    await fireEvent.press(screen.getByTestId('change-email-submit'));

    expect(screen.getByTestId('change-email-new-error')).toHaveTextContent(
      privacySecurityCopy.email.errors.empty,
    );
    expect(port.requests).not.toHaveBeenCalled();
  });

  it('rejects an invalid address', async () => {
    const port = fakePort();
    await renderScreen(port);

    await fireEvent.changeText(screen.getByTestId('change-email-new'), 'not-an-address');
    await fireEvent.press(screen.getByTestId('change-email-submit'));

    expect(screen.getByTestId('change-email-new-error')).toHaveTextContent(
      privacySecurityCopy.email.errors.invalid,
    );
    expect(port.requests).not.toHaveBeenCalled();
  });

  it('rejects the unchanged address, including a differently-cased or padded form', async () => {
    const port = fakePort();
    await renderScreen(port);

    await fireEvent.changeText(screen.getByTestId('change-email-new'), '  Ahmed@Example.COM ');
    await fireEvent.press(screen.getByTestId('change-email-submit'));

    expect(screen.getByTestId('change-email-new-error')).toHaveTextContent(
      privacySecurityCopy.email.errors.unchanged,
    );
    expect(port.requests).not.toHaveBeenCalled();
  });
});

describe('requesting the change', () => {
  it('calls the secure update service exactly once, with the normalized address', async () => {
    const port = fakePort();
    await renderScreen(port);

    await fireEvent.changeText(screen.getByTestId('change-email-new'), '  NEW@Example.com ');

    // Both presses in the same tick, deliberately unawaited — the `busy` guard is what has to
    // swallow the second, not the field having been cleared by the first.
    const submit = screen.getByTestId('change-email-submit');
    await act(async () => {
      fireEvent.press(submit);
      fireEvent.press(submit);
    });

    await waitFor(() => expect(port.requests).toHaveBeenCalledTimes(1));
    expect(port.requests).toHaveBeenCalledWith('new@example.com');
  });

  it('shows a pending-confirmation state rather than a success', async () => {
    const port = fakePort({ afterRequest: { pendingEmail: 'new@example.com' } });
    await renderScreen(port);

    await fireEvent.changeText(screen.getByTestId('change-email-new'), 'new@example.com');
    await fireEvent.press(screen.getByTestId('change-email-submit'));

    await waitFor(() => expect(screen.getByTestId('change-email-pending')).toBeTruthy());
    const banner = screen.getByTestId('change-email-pending-banner');
    expect(banner).toHaveTextContent(/new@example\.com/);
    // The words that would be a lie.
    expect(banner).not.toHaveTextContent(/email updated/i);
    expect(banner).not.toHaveTextContent(/has been changed/i);
  });

  it('leaves the visible authenticated email on the current address', async () => {
    const port = fakePort({ afterRequest: { pendingEmail: 'new@example.com' } });
    await renderScreen(port);

    await fireEvent.changeText(screen.getByTestId('change-email-new'), 'new@example.com');
    await fireEvent.press(screen.getByTestId('change-email-submit'));
    await waitFor(() => expect(screen.getByTestId('change-email-pending')).toBeTruthy());

    // The session still reports the old address, so the screen still shows it.
    expect(screen.getByTestId('change-email-current-value')).toHaveTextContent(
      'ahmed@example.com',
    );
  });

  it('adopts the new address only once the session itself reports it', async () => {
    // The confirmed state: Supabase has moved `email` and cleared `new_email`.
    const port = fakePort({
      summary: { email: 'new@example.com', pendingEmail: null },
    });
    await renderScreen(port);

    expect(screen.getByTestId('change-email-current-value')).toHaveTextContent('new@example.com');
    expect(screen.queryByTestId('change-email-pending')).toBeNull();
  });

  it('re-reads the session after a request rather than trusting its own state', async () => {
    const port = fakePort({ afterRequest: { pendingEmail: 'new@example.com' } });
    await renderScreen(port);
    const readsBefore = port.reads.mock.calls.length;

    await fireEvent.changeText(screen.getByTestId('change-email-new'), 'new@example.com');
    await fireEvent.press(screen.getByTestId('change-email-submit'));

    await waitFor(() => expect(port.reads.mock.calls.length).toBeGreaterThan(readsBefore));
  });

  it('shows a pending row on arrival when one was already outstanding', async () => {
    await renderScreen(fakePort({ summary: { pendingEmail: 'waiting@example.com' } }));

    expect(screen.getByTestId('change-email-pending-row-value')).toHaveTextContent(
      'waiting@example.com',
    );
    expect(screen.getByTestId('change-email-pending-row-supporting')).toHaveTextContent(
      privacySecurityCopy.email.pendingSupporting,
    );
  });
});

describe('errors', () => {
  it.each([
    ['email-already-used', privacySecurityCopy.errors['email-already-used']],
    ['invalid-email', privacySecurityCopy.errors['invalid-email']],
    ['rate-limited', privacySecurityCopy.errors['rate-limited']],
    ['offline', privacySecurityCopy.errors.offline],
    ['provider-unsupported', privacySecurityCopy.errors['provider-unsupported']],
    ['server-unavailable', privacySecurityCopy.errors['server-unavailable']],
  ] as const)('maps %s to locked copy and never a raw message', async (code, message) => {
    const port = fakePort({ fails: new AccountSecurityError(code) });
    await renderScreen(port);

    await fireEvent.changeText(screen.getByTestId('change-email-new'), 'new@example.com');
    await fireEvent.press(screen.getByTestId('change-email-submit'));

    await waitFor(() => expect(screen.getByTestId('change-email-error')).toBeTruthy());
    expect(screen.getByTestId('change-email-error')).toHaveTextContent(message);
    expect(screen.queryByTestId('change-email-pending')).toBeNull();
  });

  it('does not widen what the backend was willing to say about an existing account', () => {
    // "That address is already registered to another account" would turn this form into an
    // account-existence oracle. The mapped copy deliberately does not.
    const message = privacySecurityCopy.errors['email-already-used'].toLowerCase();
    expect(message).not.toContain('another account');
    expect(message).not.toContain('already registered');
    expect(message).not.toContain('exists');
  });
});

describe('a social account', () => {
  it('shows the provider explanation and no field', async () => {
    const port = fakePort({ summary: { provider: 'google', canManagePassword: false } });
    await renderScreen(port, 'change-email-provider-managed');

    expect(screen.getByText(privacySecurityCopy.email.providerManagedTitle('Google'))).toBeTruthy();
    expect(screen.queryByTestId('change-email-new')).toBeNull();
    expect(screen.queryByTestId('change-email-submit')).toBeNull();
  });
});

describe('the profiles table is never used as a substitute', () => {
  it('never writes an email through the profile service', () => {
    const source = readFileSync(
      join(__dirname, '..', 'screens', 'change-email-screen.tsx'),
      'utf8',
    );
    // Imports, not prose: the file's own commentary explains *why* it does not use the profile
    // service, and a naive substring check would flag that explanation as the offence.
    const imports = source
      .split('\n')
      .filter((line) => line.trimStart().startsWith('import'))
      .join('\n');
    expect(imports).not.toContain('profile.service');
    expect(source).not.toContain('updateFullName(');
    expect(source).not.toContain("from('profiles')");
  });

  it('leaves the profile service without any email write to call', () => {
    const source = readFileSync(
      join(__dirname, '..', '..', '..', 'services', 'profile', 'profile.service.ts'),
      'utf8',
    );
    // The service writes `full_name` and nothing else. An `email:` key in an update patch here
    // would be a display-only edit dressed up as an account change.
    expect(source).not.toMatch(/update\(\{[^}]*email/);
  });

  it('returns to Privacy & Security, never to Profile Home', async () => {
    await renderScreen(fakePort());

    await fireEvent.press(screen.getByTestId('change-email-header-back'));
    expect(mockRouter.dismissTo).toHaveBeenCalledWith('/profile/privacy-security');
  });
});
