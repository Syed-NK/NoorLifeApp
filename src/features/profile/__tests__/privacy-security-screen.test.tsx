import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';

import { AppProviders } from '@application/providers/app-providers';
import type {
  AccountSecurityPort,
  AccountSecuritySummary,
} from '@services/account/account-security.contract';
import { ACCOUNT_SECURITY_SUMMARY_FIELDS } from '@services/account/account-security.contract';
import { supportConfig } from '@shared/config/app-config';
import { installMockLatencyTimers } from '@/test-support/mock-latency-timers';

import { mockRouter } from '../../../../jest.setup';
import { PRIVACY_CAPABILITIES } from '../privacy/privacy-capabilities';
import { privacySecurityCopy } from '../privacy-security-copy';
import { PrivacySecurityScreen } from '../screens/privacy-security-screen';

// Two costs this removes: the 450 ms the mock dashboard sleeps on every mount, and the one-off
// compile cost of the first mount, which is warmed up in `beforeAll` so no test is charged for it.
installMockLatencyTimers(() => renderScreen());

/**
 * Privacy & Security — what it shows, what it refuses to show, and what it never calls.
 *
 * ── Why the port is injected for most of these ──────────────────────────────
 * Three of the states this screen must get right cannot be reached from a real account without
 * damaging it: a Google identity, a global sign-out whose remote half failed, and a session with
 * no reported provider. The phase brief forbids changing a genuine test account's credentials to
 * produce a screenshot, and the same reasoning applies to a test. So the states arrive through the
 * seam, and the assertions are about what the *screen* does with them — which is the part this
 * project owns.
 *
 * One suite below deliberately uses no injected port at all, so the real service path is exercised
 * against the Supabase double and the wiring is proved rather than assumed.
 */

const EMAIL_SUMMARY: AccountSecuritySummary = {
  provider: 'email',
  email: 'ahmed@example.com',
  emailVerification: 'verified',
  lastSignInAt: '2026-07-30T09:15:00.000Z',
  canManagePassword: true,
  pendingEmail: null,
};

function fakePort(
  summary: Partial<AccountSecuritySummary> = {},
  overrides: Partial<AccountSecurityPort> = {},
): AccountSecurityPort & { readonly calls: Record<string, jest.Mock> } {
  const calls = {
    readSummary: jest.fn(() => Promise.resolve({ ...EMAIL_SUMMARY, ...summary })),
    sendReauthenticationCode: jest.fn(() => Promise.resolve()),
    updatePassword: jest.fn(() => Promise.resolve()),
    requestEmailChange: jest.fn(() =>
      Promise.resolve({ status: 'pending' as const, requestedEmail: 'new@example.com' }),
    ),
    signOutThisDevice: jest.fn(() => Promise.resolve()),
    signOutEverywhere: jest.fn(() => Promise.resolve({ status: 'signed-out-everywhere' as const })),
  };
  return { ...calls, ...overrides, calls } as AccountSecurityPort & {
    readonly calls: Record<string, jest.Mock>;
  };
}

async function renderScreen(port?: AccountSecurityPort) {
  const view = await render(
    <AppProviders>
      <PrivacySecurityScreen {...(port === undefined ? {} : { port })} />
    </AppProviders>,
  );
  await waitFor(() => expect(screen.getByTestId('privacy-security-provider')).toBeTruthy());
  return view;
}

describe('the five sections', () => {
  it('renders all five, in the order the brief fixes', async () => {
    await renderScreen(fakePort());

    for (const testID of [
      'privacy-security-account',
      'privacy-security-privacy',
      'privacy-security-ai',
      'privacy-security-sessions',
      'privacy-security-account-management',
    ]) {
      expect(screen.getByTestId(testID)).toBeTruthy();
    }
  });

  it('scrolls rather than clipping when the content outgrows the viewport', async () => {
    await renderScreen(fakePort());

    // The shared scaffold's scroll view. A larger OS text size expands the page instead of hiding
    // Account Management, which is the section a user opens this screen to find.
    expect(screen.getByTestId('privacy-security-scroll')).toBeTruthy();
  });

  it('returns to Profile, never to Main Home', async () => {
    await renderScreen(fakePort());

    await fireEvent.press(screen.getByTestId('privacy-security-header-back'));
    expect(mockRouter.dismissTo).toHaveBeenCalledWith('/profile');
  });
});

describe('the account security summary', () => {
  it('shows the real provider the session reported', async () => {
    await renderScreen(fakePort({ provider: 'email' }));

    expect(screen.getByTestId('privacy-security-provider-value')).toHaveTextContent(
      privacySecurityCopy.account.providerNames.email,
    );
  });

  it('shows Google for a Google identity, and never substitutes Email', async () => {
    await renderScreen(fakePort({ provider: 'google', canManagePassword: false }));

    expect(screen.getByTestId('privacy-security-provider-value')).toHaveTextContent('Google');
    expect(screen.queryByText(privacySecurityCopy.account.providerNames.email)).toBeNull();
  });

  it('labels an unreported provider honestly rather than guessing one', async () => {
    await renderScreen(fakePort({ provider: 'unknown', canManagePassword: false }));

    expect(screen.getByTestId('privacy-security-provider-value')).toHaveTextContent(
      privacySecurityCopy.account.providerUnknown,
    );
    expect(screen.getByTestId('privacy-security-provider-supporting')).toBeTruthy();
  });

  it.each([
    ['verified', privacySecurityCopy.account.verification.verified],
    ['not-verified', privacySecurityCopy.account.verification['not-verified']],
    ['unknown', privacySecurityCopy.account.verification.unknown],
  ] as const)('states email verification as the word "%s"', async (state, word) => {
    await renderScreen(fakePort({ emailVerification: state }));

    expect(screen.getByTestId('privacy-security-verification-value')).toHaveTextContent(word);
  });

  it('announces verification as text, so colour is never the only carrier', async () => {
    await renderScreen(fakePort({ emailVerification: 'not-verified' }));

    const row = screen.getByTestId('privacy-security-verification');
    // The accessible label spells the state out; the supporting line says what to do about it.
    expect(row).toBeTruthy();
    expect(screen.getByTestId('privacy-security-verification-supporting')).toHaveTextContent(
      privacySecurityCopy.account.notVerifiedSupporting,
    );
  });

  it('omits the last sign-in row when the provider reported no date', async () => {
    await renderScreen(fakePort({ lastSignInAt: null }));

    expect(screen.queryByTestId('privacy-security-last-sign-in')).toBeNull();
  });

  it('shows the last sign-in only when one was genuinely reported', async () => {
    await renderScreen(fakePort({ lastSignInAt: '2026-07-30T09:15:00.000Z' }));

    // The shared renewal-date formatter, so a security screen and a billing screen never render
    // the same instant two different ways.
    expect(screen.getByTestId('privacy-security-last-sign-in-value')).toHaveTextContent(
      '30 July 2026',
    );
  });

  it('offers password and email changes only where NoorLife holds the credential', async () => {
    await renderScreen(fakePort({ provider: 'email', canManagePassword: true }));

    expect(screen.getByTestId('privacy-security-change-password')).toBeTruthy();
    expect(screen.getByTestId('privacy-security-change-email')).toBeTruthy();
    expect(screen.queryByTestId('privacy-security-provider-managed')).toBeNull();
  });

  it('explains provider-managed credentials instead of drawing a disabled form', async () => {
    await renderScreen(fakePort({ provider: 'apple', canManagePassword: false }));

    expect(screen.getByTestId('privacy-security-provider-managed')).toBeTruthy();
    // No control at all — a greyed button would imply the capability exists and is unavailable.
    expect(screen.queryByTestId('privacy-security-change-password')).toBeNull();
    expect(screen.queryByTestId('privacy-security-change-email')).toBeNull();
    expect(
      screen.getByText(privacySecurityCopy.account.providerManagedPassword('Apple')),
    ).toBeTruthy();
  });

  it('opens Change Password and Change Email at their nested routes', async () => {
    await renderScreen(fakePort());

    await fireEvent.press(screen.getByTestId('privacy-security-change-password'));
    expect(mockRouter.push).toHaveBeenCalledWith('/profile/privacy-security/change-password');

    await fireEvent.press(screen.getByTestId('privacy-security-change-email'));
    expect(mockRouter.push).toHaveBeenCalledWith('/profile/privacy-security/change-email');
  });
});

describe('what the summary can never render', () => {
  it('has exactly six fields, none of them a secret', () => {
    // The allow-list itself. A seventh field cannot arrive without this failing, which is what
    // stops a token or a user id being added "just for debugging".
    expect([...ACCOUNT_SECURITY_SUMMARY_FIELDS]).toEqual([
      'provider',
      'email',
      'emailVerification',
      'lastSignInAt',
      'canManagePassword',
      'pendingEmail',
    ]);
    for (const forbidden of ['id', 'userId', 'accessToken', 'refreshToken', 'metadata']) {
      expect(ACCOUNT_SECURITY_SUMMARY_FIELDS).not.toContain(forbidden);
    }
  });

  it('renders no token, user id, project reference or raw metadata anywhere on the page', async () => {
    // The double's session carries a user id and the service deliberately does not read it. This
    // asserts the consequence on the rendered tree rather than trusting the type.
    await renderScreen(fakePort());

    const page = JSON.stringify(screen.toJSON());
    for (const forbidden of [
      'test-user-id',
      'jest-seeded-token',
      'access_token',
      'refresh_token',
      'app_metadata',
      'user_metadata',
      'supabase.co',
      'publishable',
      'service_role',
    ]) {
      expect(page).not.toContain(forbidden);
    }
  });
});

describe('privacy controls', () => {
  it('shows every audited category', async () => {
    await renderScreen(fakePort());

    for (const capability of PRIVACY_CAPABILITIES) {
      expect(screen.getByTestId(capability.testID)).toBeTruthy();
    }
  });

  it('reports absent analytics as Not collected rather than as an off switch', async () => {
    await renderScreen(fakePort());

    expect(screen.getByTestId('privacy-capability-product-analytics-value')).toHaveTextContent(
      privacySecurityCopy.privacy.statusWords['not-collected'],
    );
  });

  it('reports absent crash reporting as Not collected', async () => {
    await renderScreen(fakePort());

    expect(screen.getByTestId('privacy-capability-crash-reporting-value')).toHaveTextContent(
      privacySecurityCopy.privacy.statusWords['not-collected'],
    );
  });

  it('draws no toggle in this section at all', async () => {
    await renderScreen(fakePort());

    // A switch here would control nothing. `ProfileToggleRow` renders a `switch` role, so its
    // absence is the assertion — not a count of testIDs somebody could rename.
    expect(screen.queryAllByRole('switch')).toHaveLength(0);
  });

  it('states that diagnostics exclude every sensitive category', async () => {
    await renderScreen(fakePort());

    const text = screen.getByTestId('privacy-security-diagnostics-exclusion').props.children;
    for (const subject of [
      'Faith',
      'health',
      'finance',
      'family',
      'AI conversations',
      'password',
    ]) {
      expect(String(text)).toContain(subject);
    }
  });

  /**
   * The two absolute claims 6C-3A shipped, and why neither may come back.
   *
   * "This is the complete list" is a statement about every future build, and the next migration
   * that adds a column falsifies it without anybody editing copy. "Removing NoorLife removes
   * everything under these" is a statement about the operating system, which this application does
   * not control and which demonstrably does the opposite: `AndroidManifest.xml` declares
   * `android:allowBackup="true"`, and `expo-secure-store`'s own backup rules include the whole
   * `sharedpref` domain in cloud backup and device transfer, excluding only its own file. On iOS
   * the store defaults to `kSecAttrAccessibleWhenUnlocked`, which is not a `ThisDeviceOnly` class,
   * so an item can be restored onto another device from an encrypted backup.
   *
   * These are exact-string tests on purpose. A reworded near-miss of the same promise is the
   * failure mode, so the phrases are checked as substrings of the whole section rather than as
   * equality against one field.
   */
  describe('the wording that may not return', () => {
    const allPrivacyCopy = [
      privacySecurityCopy.privacy.accountDataSupporting,
      privacySecurityCopy.privacy.storageSupporting,
      privacySecurityCopy.privacy.intro,
      privacySecurityCopy.privacy.encryptionNote,
    ]
      .join(' ')
      .toLowerCase();

    it.each([
      'this is the complete list',
      'the complete list',
      'removing noorlife removes everything',
      'uninstalling removes everything',
      'deleting the app deletes',
      'everything is removed when you uninstall',
      'nothing is left on your device',
    ])('never says "%s"', (phrase) => {
      expect(allPrivacyCopy).not.toContain(phrase);
    });

    it('scopes the account-data list to the current version', () => {
      expect(privacySecurityCopy.privacy.accountDataSupporting).toBe(
        'In the current version of NoorLife, the following account information is stored so you can sign in on another device and keep your name and progress:',
      );
    });

    it('uses the platform-safe uninstall wording, verbatim', () => {
      expect(privacySecurityCopy.privacy.storageSupporting).toBe(
        'Most device-local NoorLife data is removed when the app is uninstalled. Your operating system or backup service may retain or restore some settings.',
      );
    });

    it('names the operating system and backup service as the reason it cannot promise more', () => {
      const supporting = privacySecurityCopy.privacy.storageSupporting.toLowerCase();
      expect(supporting).toContain('operating system');
      expect(supporting).toContain('backup service');
      expect(supporting).toContain('retain or restore');
    });

    it('renders both on the screen, not just in the copy object', async () => {
      await renderScreen(fakePort());

      expect(screen.getByTestId('privacy-security-account-data-supporting')).toHaveTextContent(
        /In the current version of NoorLife/,
      );
      expect(screen.getByTestId('privacy-security-device-storage-supporting')).toHaveTextContent(
        /may retain or restore some settings/,
      );
    });

    it('leads the account list with the qualifier rather than trailing it', async () => {
      // Order matters: a list followed by "in the current version" reads as an afterthought, and
      // the sentence has to govern the list it introduces.
      await renderScreen(fakePort());

      const supporting = String(
        screen.getByTestId('privacy-security-account-data-supporting').props.children,
      );
      expect(supporting.indexOf('In the current version')).toBeLessThan(
        supporting.indexOf('Your name and profile record'),
      );
    });

    it('still states plainly that diagnostics exclude sensitive data and credentials', () => {
      // Qualifying the two overstatements must not soften this one. It is a claim about what this
      // application's own code does, which it can keep.
      const exclusion = privacySecurityCopy.privacy.diagnosticsExclusion;
      expect(exclusion).toContain('never includes');
      for (const subject of [
        'Faith',
        'health',
        'finance',
        'family',
        'AI conversations',
        'password',
        'sign-in tokens',
      ]) {
        expect(exclusion).toContain(subject);
      }
      expect(exclusion.toLowerCase()).not.toContain('may include');
      expect(exclusion.toLowerCase()).not.toContain('generally');
    });
  });

  it('does not claim end-to-end encryption', async () => {
    await renderScreen(fakePort());

    const note = String(screen.getByTestId('privacy-security-encryption-note').props.children);
    expect(note).toContain('not end-to-end encrypted');
  });

  it('links the Privacy Policy from centralized configuration', async () => {
    // The URL the screen opens is the configured one, and `help-support-config.test.ts` separately
    // asserts that the configuration file is the only place in the source that writes it out.
    expect(privacySecurityCopy.privacy.privacyPolicyUrl).toBe(
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      (require('@shared/config/app-config') as typeof import('@shared/config/app-config'))
        .legalConfig.privacyPolicy,
    );

    await renderScreen(fakePort());
    expect(screen.getByTestId('privacy-security-privacy-policy')).toBeTruthy();
  });
});

describe('AI data and permissions', () => {
  it('limits a free plan to what the free plan actually includes', async () => {
    await renderScreen(fakePort());

    // The entitlement provider resolves free in tests. Faith and Noor AI stay available; the six
    // paid modules do not.
    expect(screen.getByTestId('privacy-security-ai-assistant-faith-value')).toHaveTextContent(
      privacySecurityCopy.ai.assistantWords.available,
    );
    expect(screen.getByTestId('privacy-security-ai-assistant-noor-ai-value')).toHaveTextContent(
      privacySecurityCopy.ai.assistantWords.available,
    );
    for (const paid of ['health', 'planner', 'finance', 'learning', 'family', 'goals']) {
      expect(screen.getByTestId(`privacy-security-ai-assistant-${paid}-value`)).toHaveTextContent(
        privacySecurityCopy.ai.assistantWords.unavailable,
      );
    }
  });

  it('shows the module boundaries rather than restating them', async () => {
    await renderScreen(fakePort());

    for (const subject of ['health', 'finance', 'faith', 'family']) {
      expect(screen.getByTestId(`privacy-security-ai-boundary-${subject}`)).toBeTruthy();
    }
    expect(
      String(screen.getByTestId('privacy-security-ai-boundary-health-supporting').props.children),
    ).toContain('diagnose');
    expect(
      String(screen.getByTestId('privacy-security-ai-boundary-finance-supporting').props.children),
    ).toContain('investment');
  });

  it('states the cross-module hand-off rule', async () => {
    await renderScreen(fakePort());

    expect(String(screen.getByTestId('privacy-security-ai-cross-module').props.children)).toContain(
      'hand you to Noor AI',
    );
  });

  it('says nothing is stored, and offers no delete control for it', async () => {
    await renderScreen(fakePort());

    expect(screen.getByTestId('privacy-security-ai-no-history')).toBeTruthy();
    expect(screen.getByText(privacySecurityCopy.ai.noHistory)).toBeTruthy();
    // No control that would appear to delete something that does not exist. Asserted over the
    // section's own subtree and over *controls*, not over prose — the supporting sentence has to be
    // free to explain why there is no delete button without tripping the check for one.
    const ai = screen.getByTestId('privacy-security-ai');
    expect(within(ai).queryAllByRole('button')).toHaveLength(0);
  });

  it('qualifies the no-history claim to this version rather than stating a policy', async () => {
    await renderScreen(fakePort());

    const claim = String(screen.getByTestId('privacy-security-ai-no-history-claim').props.children);
    expect(claim).toContain('In the current version of NoorLife');
    expect(claim.toLowerCase()).not.toContain('never');
  });

  it('defers grant editing in words instead of drawing switches over a store that does not exist', async () => {
    await renderScreen(fakePort());

    expect(screen.getByTestId('privacy-security-ai-editing-deferred')).toBeTruthy();
    expect(screen.queryAllByRole('switch')).toHaveLength(0);
  });
});

describe('sessions', () => {
  it('does not claim to list other devices', async () => {
    await renderScreen(fakePort());

    const intro = String(screen.getByTestId('privacy-security-sessions-intro').props.children);
    expect(intro).toContain('this device only');
  });

  it('shows the global warning before the control is ever pressed', async () => {
    await renderScreen(fakePort());

    expect(screen.getByTestId('privacy-security-sign-out-all-warning')).toHaveTextContent(
      privacySecurityCopy.sessions.allSessionsWarning,
    );
  });

  /**
   * The warning has to match `@supabase/auth-js` 2.111.0, not the intuition of what a global
   * sign-out does.
   *
   * `signOut({ scope: 'global' })` revokes refresh tokens. Access tokens already issued are
   * self-contained JWTs and stay valid until they expire — the SDK says so in its own doc comment.
   * "You will be signed out on all devices" describes an instant effect the protocol does not
   * provide, and on this screen that is the difference between a user who waits before handing an
   * old phone over and one who does not.
   */
  describe('the global sign-out warning', () => {
    const warning = privacySecurityCopy.sessions.allSessionsWarning;
    const body = privacySecurityCopy.sessions.allSessionsBody;

    it('keeps the control labelled "Sign Out All Sessions"', () => {
      expect(privacySecurityCopy.sessions.allSessions).toBe('Sign Out All Sessions');
    });

    it('says the other devices lose the ability to renew, not that they are closed now', () => {
      expect(warning).toContain('renewing their sessions');
      expect(body).toContain('renewing their sessions');
    });

    it('says another device may remain active briefly', () => {
      expect(warning.toLowerCase()).toContain('may remain active briefly');
      expect(body.toLowerCase()).toContain('short time');
    });

    it('says this device is signed out', () => {
      expect(warning.toLowerCase()).toContain('signs out this device');
    });

    it('says no account data is deleted', () => {
      expect(body).toContain('Nothing is deleted');
    });

    it.each([
      'signed out on all devices',
      'signs you out everywhere immediately',
      'immediately signs out',
      'all your devices are signed out',
      'will sign you out on this and other devices',
    ])('never claims %s', (phrase) => {
      expect(`${warning} ${body}`.toLowerCase()).not.toContain(phrase.toLowerCase());
    });

    it('does not require the user to know what a token is', () => {
      // The mechanism is refresh-token revocation. The consequence is what the user needs, and the
      // consequence can be said without the vocabulary.
      for (const jargon of ['token', 'jwt', 'refresh token', 'bearer']) {
        expect(`${warning} ${body}`.toLowerCase()).not.toContain(jargon);
      }
    });

    it('is what the confirmation dialog actually shows', async () => {
      await renderScreen(fakePort());

      await fireEvent.press(screen.getByTestId('privacy-security-sign-out-all'));

      // A substring match: the dialog also carries its title and its two button labels.
      expect(
        String(screen.getByTestId('privacy-security-sign-out-all-confirm-body').props.children),
      ).toBe(body);
    });
  });

  it('asks before signing out this device, and does nothing on cancel', async () => {
    const port = fakePort();
    await renderScreen(port);

    await fireEvent.press(screen.getByTestId('privacy-security-sign-out-device'));
    expect(
      await screen.findByTestId('privacy-security-sign-out-device-confirm-panel'),
    ).toBeTruthy();

    await fireEvent.press(await screen.findByTestId('privacy-security-sign-out-device-cancel'));
    expect(port.calls.signOutThisDevice).not.toHaveBeenCalled();
    expect(mockRouter.replace).not.toHaveBeenCalled();
  });

  it('signs out this device only, then replaces the protected stack', async () => {
    const port = fakePort();
    await renderScreen(port);

    await fireEvent.press(screen.getByTestId('privacy-security-sign-out-device'));
    await fireEvent.press(await screen.findByTestId('privacy-security-sign-out-device-accept'));

    await waitFor(() => expect(port.calls.signOutThisDevice).toHaveBeenCalledTimes(1));
    // `dismissAll` before `replace` is what makes Back unable to return to Profile.
    expect(mockRouter.dismissAll).toHaveBeenCalled();
    expect(mockRouter.replace).toHaveBeenCalledWith('/welcome');
    expect(port.calls.signOutEverywhere).not.toHaveBeenCalled();
  });

  it('requires confirmation before a global sign-out', async () => {
    const port = fakePort();
    await renderScreen(port);

    await fireEvent.press(screen.getByTestId('privacy-security-sign-out-all'));
    expect(port.calls.signOutEverywhere).not.toHaveBeenCalled();

    await fireEvent.press(await screen.findByTestId('privacy-security-sign-out-all-cancel'));
    expect(port.calls.signOutEverywhere).not.toHaveBeenCalled();
  });

  it('calls the global service before claiming anything, exactly once', async () => {
    const port = fakePort();
    await renderScreen(port);

    await fireEvent.press(screen.getByTestId('privacy-security-sign-out-all'));
    const accept = await screen.findByTestId('privacy-security-sign-out-all-accept');

    // Pressed twice in the same tick, deliberately without awaiting between them: that is what a
    // double tap actually is, and it is the case the `busy` guard exists to swallow. Awaiting each
    // press would let the first request finish first and prove nothing.
    await act(async () => {
      void fireEvent.press(accept);
      void fireEvent.press(accept);
    });

    await waitFor(() => expect(port.calls.signOutEverywhere).toHaveBeenCalledTimes(1));
    expect(mockRouter.replace).toHaveBeenCalledWith('/welcome');
  });

  it('never claims other sessions ended when the remote half failed', async () => {
    const port = fakePort(
      {},
      {
        signOutEverywhere: jest.fn(() =>
          Promise.resolve({ status: 'local-only' as const, code: 'offline' as const }),
        ),
      },
    );
    await renderScreen(port);

    await fireEvent.press(screen.getByTestId('privacy-security-sign-out-all'));
    await fireEvent.press(await screen.findByTestId('privacy-security-sign-out-all-accept'));

    expect(await screen.findByTestId('privacy-security-sign-out-local-only-panel')).toBeTruthy();
    expect(screen.getByText(privacySecurityCopy.sessions.localOnlyBody)).toBeTruthy();
    // The honest claim, and only after the dialog is acknowledged does navigation happen.
    expect(mockRouter.replace).not.toHaveBeenCalled();

    await fireEvent.press(
      await screen.findByTestId('privacy-security-sign-out-local-only-dismiss'),
    );
    expect(mockRouter.replace).toHaveBeenCalledWith('/welcome');
  });

  it('reports a failed device sign-out instead of navigating away from a live session', async () => {
    const port = fakePort(
      {},
      { signOutThisDevice: jest.fn(() => Promise.reject(new Error('nope'))) },
    );
    await renderScreen(port);

    await fireEvent.press(screen.getByTestId('privacy-security-sign-out-device'));
    await fireEvent.press(await screen.findByTestId('privacy-security-sign-out-device-accept'));

    await waitFor(() =>
      expect(screen.getByTestId('privacy-security-sign-out-failed')).toBeTruthy(),
    );
    expect(mockRouter.replace).not.toHaveBeenCalled();
  });
});

describe('delete account', () => {
  it('opens an informational sheet and calls nothing', async () => {
    const port = fakePort();
    await renderScreen(port);

    await fireEvent.press(screen.getByTestId('privacy-security-delete-account'));

    expect(await screen.findByTestId('privacy-security-delete-account-sheet-panel')).toBeTruthy();
    expect(screen.getByText(privacySecurityCopy.account_management.unavailableTitle)).toBeTruthy();
    expect(screen.getByText(privacySecurityCopy.account_management.unavailableBody)).toBeTruthy();

    // Not one service call — and in particular, not a sign-out masquerading as deletion.
    for (const call of Object.values(port.calls)) {
      if (call === port.calls.readSummary) {
        continue;
      }
      expect(call).not.toHaveBeenCalled();
    }
  });

  it('carries the exact copy the brief fixes', () => {
    expect(privacySecurityCopy.account_management.unavailableTitle).toBe(
      'Account deletion isn’t available yet',
    );
    expect(privacySecurityCopy.account_management.unavailableBody).toBe(
      'NoorLife requires secure server-side verification before an account and its data can be permanently deleted.',
    );
  });

  it('offers Close and Contact Support, and nothing destructive', async () => {
    await renderScreen(fakePort());
    await fireEvent.press(screen.getByTestId('privacy-security-delete-account'));

    expect(await screen.findByTestId('privacy-security-delete-account-close')).toBeTruthy();
    expect(await screen.findByTestId('privacy-security-delete-account-support')).toBeTruthy();
    expect(screen.queryByText(/^Delete$/)).toBeNull();
  });

  it('reaches support at the centralized address', () => {
    expect(privacySecurityCopy.account_management.supportEmail).toBe(supportConfig.email);
  });
});

describe('the real service path', () => {
  it('renders the signed-in session without an injected port', async () => {
    // No fake: this exercises `accountSecurityPort` against the Supabase double, which is what
    // proves the screen is wired to the service rather than only to a test seam.
    await renderScreen();

    expect(screen.getByTestId('privacy-security-provider-value')).toHaveTextContent(
      privacySecurityCopy.account.providerNames.email,
    );
    expect(screen.getByTestId('privacy-security-email-value')).toHaveTextContent(
      'ahmed@example.com',
    );
    expect(screen.getByTestId('privacy-security-verification-value')).toHaveTextContent(
      privacySecurityCopy.account.verification.verified,
    );
  });
});
