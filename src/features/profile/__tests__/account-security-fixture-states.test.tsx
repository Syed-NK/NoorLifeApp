import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { AppProviders } from '@application/providers/app-providers';
import { installMockLatencyTimers } from '@/test-support/mock-latency-timers';

import {
  emailChangePendingPort,
  FIXTURE_EMAIL,
  globalSignOutFailurePort,
  reauthenticationRequiredPort,
  socialIdentityPort,
} from '@/test-support/account-security-fixtures';

import { privacySecurityCopy } from '../privacy-security-copy';
import { ChangeEmailScreen } from '../screens/change-email-screen';
import { ChangePasswordScreen } from '../screens/change-password-screen';
import { PrivacySecurityScreen } from '../screens/privacy-security-screen';

installMockLatencyTimers(() =>
  render(
    <AppProviders>
      <PrivacySecurityScreen port={socialIdentityPort()} />
    </AppProviders>,
  ),
);

/**
 * The four account-security states a real account cannot safely be put into.
 *
 * ── What this replaces ──────────────────────────────────────────────────────
 * Phase 6C-3A reached these through a fixture screen at `/profile/privacy-security/fixtures`,
 * guarded by `__DEV__`. The guard stopped it rendering in release and did not stop Metro compiling
 * it, so the harness and its fake account shipped in the bundle. The route and the screen are gone;
 * the states moved to `src/test-support/account-security-fixtures.ts`, and this file is what now
 * proves them.
 *
 * That is a strictly better arrangement than the harness was. A harness let somebody *look* at a
 * state. These assert it, on every run, without anybody remembering to open a development route.
 *
 * ── Nothing here touches an account ─────────────────────────────────────────
 * Every port resolves in memory. No Supabase client is constructed, no request is made, and the
 * only address involved is an `example.com` one that cannot receive mail.
 */

describe('a Google identity', () => {
  it('explains that the provider owns the credential, and draws no password form', async () => {
    await render(
      <AppProviders>
        <PrivacySecurityScreen port={socialIdentityPort()} />
      </AppProviders>,
    );
    await waitFor(() => expect(screen.getByTestId('privacy-security-provider')).toBeTruthy());

    expect(screen.getByTestId('privacy-security-provider-value')).toHaveTextContent('Google');
    expect(screen.getByTestId('privacy-security-provider-managed')).toBeTruthy();
    // Not a disabled form. There is no NoorLife password for this identity to change.
    expect(screen.queryByTestId('privacy-security-change-password')).toBeNull();
  });

  it('offers no email form either, because the address comes from Google', async () => {
    await render(
      <AppProviders>
        <ChangeEmailScreen port={socialIdentityPort()} />
      </AppProviders>,
    );
    await waitFor(() =>
      expect(screen.getByTestId('change-email-provider-managed')).toBeTruthy(),
    );

    expect(screen.queryByTestId('change-email-new')).toBeNull();
    expect(screen.queryByTestId('change-email-submit')).toBeNull();
  });
});

describe('a session Supabase wants reauthenticated', () => {
  it('shows the emailed-code step only after GoTrue asks for it', async () => {
    await render(
      <AppProviders>
        <ChangePasswordScreen port={reauthenticationRequiredPort()} />
      </AppProviders>,
    );
    await waitFor(() => expect(screen.getByTestId('change-password-form')).toBeTruthy());

    // Before the attempt, the app makes no prediction about the requirement.
    expect(screen.queryByTestId('change-password-reauth')).toBeNull();

    await fireEvent.changeText(screen.getByTestId('change-password-new'), 'NoorLife2026!');
    await fireEvent.changeText(screen.getByTestId('change-password-confirm'), 'NoorLife2026!');
    await fireEvent.press(screen.getByTestId('change-password-submit'));

    expect(await screen.findByTestId('change-password-reauth')).toBeTruthy();
  });
});

describe('an outstanding email confirmation', () => {
  it('shows the pending address and leaves the signed-in one alone', async () => {
    await render(
      <AppProviders>
        <ChangeEmailScreen port={emailChangePendingPort()} />
      </AppProviders>,
    );
    await waitFor(() => expect(screen.getByTestId('change-email-pending')).toBeTruthy());

    expect(screen.getByTestId('change-email-pending-row-value')).toHaveTextContent(
      'pending.address@example.com',
    );
    // The authenticated address has not moved, and the screen does not pretend otherwise.
    expect(screen.getByTestId('change-email-current-value')).toHaveTextContent(FIXTURE_EMAIL);
    expect(screen.getByTestId('change-email-pending-row-supporting')).toHaveTextContent(
      privacySecurityCopy.email.pendingSupporting,
    );
  });
});

describe('a global sign-out whose remote half failed', () => {
  it('claims this device only, and does not say the others ended', async () => {
    await render(
      <AppProviders>
        <PrivacySecurityScreen port={globalSignOutFailurePort()} />
      </AppProviders>,
    );
    await waitFor(() => expect(screen.getByTestId('privacy-security-provider')).toBeTruthy());

    await fireEvent.press(screen.getByTestId('privacy-security-sign-out-all'));
    await fireEvent.press(screen.getByTestId('privacy-security-sign-out-all-accept'));

    const dialog = await screen.findByTestId('privacy-security-sign-out-local-only');
    expect(dialog).toBeTruthy();
    expect(
      String(screen.getByTestId('privacy-security-sign-out-local-only-body').props.children),
    ).toBe(privacySecurityCopy.sessions.localOnlyBody);
    // The words that would be the lie.
    expect(screen.queryByText(/signed out everywhere/i)).toBeNull();
    expect(screen.queryByText(/all devices are signed out/i)).toBeNull();
  });
});
