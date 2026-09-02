import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { StyleSheet, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';

import { AppProviders } from '@application/providers/app-providers';
import { installMockLatencyTimers } from '@/test-support/mock-latency-timers';

import {
  AccountSecurityError,
  type AccountSecurityPort,
  type AccountSecuritySummary,
} from '@services/account/account-security.contract';

import { mockRouter } from '../../../../jest.setup';
import { privacySecurityCopy } from '../privacy-security-copy';
import { ChangeEmailScreen } from '../screens/change-email-screen';

// Mounts screens backed by simulated-latency mocks, and warms the first mount so no test is
// charged for compiling the provider stack.
installMockLatencyTimers(() => renderScreen(fakePort()));

/**
 * Change Email — and the two failures this suite exists to prevent.
 *
 * The first is a screen that shows the new address as the account's address after a *request*: with
 * Secure Email Change enabled the session's address does not move until both mailboxes confirm, so
 * the visible authenticated email must come from the session on every render and never from the
 * field.
 *
 * The second is the one the device pass found. Send Confirmation was enabled over an empty field —
 * the control invited a press, took it, and answered with a validation message. For an action that
 * emails two mailboxes that is the wrong order, so the button's `disabled` state and the handler's
 * refusal are now the same function's answer, and both are asserted below.
 */

const SUMMARY: AccountSecuritySummary = {
  provider: 'email',
  email: 'ahmed@example.com',
  emailVerification: 'verified',
  lastSignInAt: null,
  canManagePassword: true,
  pendingEmail: null,
};

type Fake = AccountSecurityPort & { readonly requests: jest.Mock; readonly reads: jest.Mock };

function fakePort(
  options: {
    readonly summary?: Partial<AccountSecuritySummary>;
    /** Applied to the summary after a successful request, as Supabase's `new_email` would be. */
    readonly afterRequest?: Partial<AccountSecuritySummary>;
    readonly fails?: AccountSecurityError;
  } = {},
): Fake {
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
  const view = await render(
    <AppProviders>
      <ChangeEmailScreen port={port} />
    </AppProviders>,
  );
  await waitFor(() => expect(screen.getByTestId(testID)).toBeTruthy());
  return view;
}

describe('the form', () => {
  it('shows the current authenticated address, read-only', async () => {
    await renderScreen(fakePort());

    expect(screen.getByTestId('change-email-current-value')).toHaveTextContent('ahmed@example.com');
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

/**
 * The submit gate.
 *
 * ── Why every case asserts three things ─────────────────────────────────────
 * A control can be refused in three independent places, and shipping two of them is how the device
 * defect happened: the button *looked* pressable, the press *was* accepted, and only the handler
 * said no. Each case below therefore checks the accessibility state a screen reader reads, the
 * press a finger makes, and the service call that must not have happened. Any one of them passing
 * alone would not have caught the original bug.
 */
describe('the submit gate', () => {
  const submit = () => screen.getByTestId('change-email-submit');
  const field = () => screen.getByTestId('change-email-new');

  /** Every disabled case, as the user would produce it. */
  const REFUSED = [
    ['an empty field', '', privacySecurityCopy.email.errors.empty],
    ['whitespace only', '   ', privacySecurityCopy.email.errors.empty],
    ['a tab and spaces', ' \t ', privacySecurityCopy.email.errors.empty],
    ['no @ at all', 'not-an-address', privacySecurityCopy.email.errors.invalid],
    ['no domain', 'someone@', privacySecurityCopy.email.errors.invalid],
    ['no local part', '@example.com', privacySecurityCopy.email.errors.invalid],
    ['an internal space', 'some one@example.com', privacySecurityCopy.email.errors.invalid],
    ['the current address', 'ahmed@example.com', privacySecurityCopy.email.errors.unchanged],
    [
      'the current address in another case',
      'AHMED@Example.COM',
      privacySecurityCopy.email.errors.unchanged,
    ],
    [
      'the current address padded',
      '  ahmed@example.com  ',
      privacySecurityCopy.email.errors.unchanged,
    ],
    [
      'the current address padded and re-cased',
      '  Ahmed@Example.COM ',
      privacySecurityCopy.email.errors.unchanged,
    ],
  ] as const;

  it('starts disabled, before anything has been typed', async () => {
    await renderScreen(fakePort());

    expect(submit().props.accessibilityState.disabled).toBe(true);
  });

  it.each(REFUSED)('is disabled for %s', async (_label, text) => {
    const port = fakePort();
    await renderScreen(port);

    await fireEvent.changeText(field(), text);

    expect(submit().props.accessibilityState.disabled).toBe(true);
  });

  it.each(REFUSED)('calls no service when pressed with %s', async (_label, text) => {
    const port = fakePort();
    await renderScreen(port);

    await fireEvent.changeText(field(), text);
    await fireEvent.press(submit());

    expect(port.requests).not.toHaveBeenCalled();
  });

  it.each(REFUSED)('calls no service on keyboard Submit with %s', async (_label, text) => {
    // The keyboard's own Done key reaches `submit` directly, bypassing the button's `disabled`
    // prop entirely. It has to be refused by the handler, or the gate has a hole in it.
    const port = fakePort();
    await renderScreen(port);

    await fireEvent.changeText(field(), text);
    await fireEvent(field(), 'submitEditing');

    expect(port.requests).not.toHaveBeenCalled();
  });

  it.each(REFUSED)('explains %s once the field has been left', async (_label, text, message) => {
    await renderScreen(fakePort());

    await fireEvent.changeText(field(), text);
    await fireEvent(field(), 'blur');

    expect(screen.getByTestId('change-email-new-error')).toHaveTextContent(message);
  });

  it('says nothing about an untouched field', async () => {
    // Opening the screen must not greet the user with a validation error over a field they have
    // not reached yet.
    await renderScreen(fakePort());

    expect(screen.queryByTestId('change-email-new-error')).toBeNull();
  });

  it('enables for a valid address that differs from the current one', async () => {
    await renderScreen(fakePort());

    await fireEvent.changeText(field(), 'new@example.com');

    expect(submit().props.accessibilityState.disabled).toBe(false);
    expect(screen.queryByTestId('change-email-new-error')).toBeNull();
  });

  it('enables for a valid address that only needs trimming', async () => {
    await renderScreen(fakePort());

    await fireEvent.changeText(field(), '  New@Example.com  ');

    expect(submit().props.accessibilityState.disabled).toBe(false);
  });

  it('re-disables when a valid address is edited back into an invalid one', async () => {
    await renderScreen(fakePort());

    await fireEvent.changeText(field(), 'new@example.com');
    expect(submit().props.accessibilityState.disabled).toBe(false);

    await fireEvent.changeText(field(), 'new@');
    expect(submit().props.accessibilityState.disabled).toBe(true);
  });

  it('never rewrites the address the account actually has', async () => {
    // Normalization is applied to the draft for comparison and for sending. The current address is
    // read from the session and rendered as the session reports it.
    const port = fakePort({ summary: { email: 'Ahmed@Example.com' } });
    await renderScreen(port);

    await fireEvent.changeText(field(), '  AHMED@example.COM ');

    expect(screen.getByTestId('change-email-current-value')).toHaveTextContent('Ahmed@Example.com');
    expect(submit().props.accessibilityState.disabled).toBe(true);
  });

  it('reads as disabled to a screen reader, and says what would enable it', async () => {
    await renderScreen(fakePort());

    expect(submit().props.accessibilityState.disabled).toBe(true);
    expect(submit().props.accessibilityHint).toBe(privacySecurityCopy.email.submitDisabledHint);
  });

  it('swaps to the action hint once it is enabled', async () => {
    await renderScreen(fakePort());

    await fireEvent.changeText(field(), 'new@example.com');

    expect(submit().props.accessibilityHint).toBe(privacySecurityCopy.email.submitHint);
  });

  it('keeps a 44 dp target and the same geometry in both states', async () => {
    // A disabled control that shrinks is a disabled control the user cannot reliably hit when it
    // comes back. The fill changes; nothing else does.
    await renderScreen(fakePort());

    const disabledStyle = StyleSheet.flatten(submit().props.style as StyleProp<ViewStyle>);
    await fireEvent.changeText(field(), 'new@example.com');
    const enabledStyle = StyleSheet.flatten(submit().props.style as StyleProp<ViewStyle>);

    expect(disabledStyle.height).toBeGreaterThanOrEqual(44);
    expect(enabledStyle.height).toBe(disabledStyle.height);
    expect(enabledStyle.borderRadius).toBe(disabledStyle.borderRadius);
    // And the fill really does change, so "obviously disabled" is not just a claim.
    expect(enabledStyle.backgroundColor).not.toBe(disabledStyle.backgroundColor);
  });

  it('reads its disabled label against the disabled fill, not white on grey', async () => {
    await renderScreen(fakePort());

    const disabledLabel = within(submit()).getByText(privacySecurityCopy.email.submit);
    const style = StyleSheet.flatten(disabledLabel.props.style as StyleProp<TextStyle>);
    // #FFFFFF on the #C8CED8 disabled fill measures 1.9:1. Anything but white is the assertion.
    expect(String(style.color).toUpperCase()).not.toBe('#FFFFFF');
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
      void fireEvent.press(submit);
      void fireEvent.press(submit);
    });

    await waitFor(() => expect(port.requests).toHaveBeenCalledTimes(1));
    expect(port.requests).toHaveBeenCalledWith('new@example.com');
  });

  it('swallows a keyboard Submit fired while the first request is still running', async () => {
    // The other way in. A press and a Done key in the same frame both reach `submit`, and only the
    // in-flight ref is written soon enough to stop the second.
    const port = fakePort();
    await renderScreen(port);

    await fireEvent.changeText(screen.getByTestId('change-email-new'), 'new@example.com');
    await act(async () => {
      void fireEvent.press(screen.getByTestId('change-email-submit'));
      void fireEvent(screen.getByTestId('change-email-new'), 'submitEditing');
    });

    await waitFor(() => expect(port.requests).toHaveBeenCalledTimes(1));
  });

  it('disables the control again once the field is cleared by a successful request', async () => {
    const port = fakePort({ afterRequest: { pendingEmail: 'new@example.com' } });
    await renderScreen(port);

    await fireEvent.changeText(screen.getByTestId('change-email-new'), 'new@example.com');
    await fireEvent.press(screen.getByTestId('change-email-submit'));
    await waitFor(() => expect(screen.getByTestId('change-email-pending')).toBeTruthy());

    // The field is empty again, so a second confirmation cannot be sent by pressing twice slowly.
    expect(screen.getByTestId('change-email-submit').props.accessibilityState.disabled).toBe(true);
    expect(screen.queryByTestId('change-email-new-error')).toBeNull();
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
    expect(screen.getByTestId('change-email-current-value')).toHaveTextContent('ahmed@example.com');
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
