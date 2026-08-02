import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { EntryAuthText } from '@features/entry-auth/components/entry-auth-text';
import { SecondaryButton } from '@features/entry-auth/components/secondary-button';
import { useEntryAuthMetrics } from '@features/entry-auth/use-entry-auth-metrics';
import { PLAN_CAPABILITIES, FREE_ENTITLEMENT } from '@features/subscription/domain/entitlement';
import { MockPurchaseAdapter } from '@features/subscription/services/mock-purchase-adapter';
import { EntitlementProvider } from '@features/subscription/services/entitlement-context';
import { subscriptionColors } from '@features/subscription/subscription-tokens';
import {
  AccountSecurityError,
  type AccountSecurityPort,
  type AccountSecuritySummary,
} from '@services/account/account-security.contract';

import { ProfileDetailCard } from '../components/profile-detail-card';
import { ChangeEmailScreen } from './change-email-screen';
import { ChangePasswordScreen } from './change-password-screen';
import { PrivacySecurityScreen } from './privacy-security-screen';

/**
 * The Privacy & Security fixture harness — development only.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * Five of the states these screens must get right cannot be reached from a real account without
 * damaging it or waiting a day: a Google identity, a session old enough that Supabase demands
 * reauthentication, an outstanding email confirmation, a global sign-out whose remote half failed,
 * and a paid entitlement with a revoked grant. The phase brief forbids changing a genuine test
 * account's email or password merely to obtain a screenshot, and it is right to — a capture run
 * must not be able to lock somebody out of their own account.
 *
 * So the states are supplied through `AccountSecurityPort`, which is the same seam the tests use.
 * Every fixture below performs **no network call of any kind**: `updatePassword` and
 * `requestEmailChange` resolve or reject locally, and `signOutEverywhere` returns an outcome
 * without asking a server. Nothing here can change an account.
 *
 * ── Why it cannot be reached in a release build ─────────────────────────────
 * The route guards on `__DEV__` and redirects to Main Home otherwise, exactly as `module-gallery`
 * and `hero-audit` already do. That guard is what makes the harness unreachable, and it is the
 * only entry point — nothing in the product links here.
 *
 * It is **not** removed from the release bundle. The route file imports this module at the top
 * level, so Metro includes it regardless of the branch below; grepping the built
 * `index.android.bundle` for `privacy-security-fixture` finds it, and the same grep finds
 * `Module Gallery` for the same reason. Saying otherwise would be a claim this project's own build
 * disproves, so what is claimed is exactly what is true: present in the bundle, unreachable in the
 * app, and incapable of touching an account wherever it runs.
 */

const BASE: AccountSecuritySummary = {
  provider: 'email',
  email: 'test@gmail.com',
  emailVerification: 'verified',
  lastSignInAt: '2026-08-01T08:30:00.000Z',
  canManagePassword: true,
  pendingEmail: null,
};

/** A port that performs nothing. Every method resolves locally or rejects with a mapped code. */
function inertPort(
  summary: Partial<AccountSecuritySummary>,
  overrides: Partial<AccountSecurityPort> = {},
): AccountSecurityPort {
  return {
    readSummary: () => Promise.resolve({ ...BASE, ...summary }),
    sendReauthenticationCode: () => Promise.resolve(),
    updatePassword: () => Promise.resolve(),
    requestEmailChange: (newEmail) =>
      Promise.resolve({ status: 'pending' as const, requestedEmail: newEmail }),
    signOutThisDevice: () => Promise.resolve(),
    signOutEverywhere: () => Promise.resolve({ status: 'signed-out-everywhere' as const }),
    ...overrides,
  };
}

type Fixture = {
  readonly key: string;
  readonly label: string;
  readonly note: string;
  readonly render: () => React.ReactElement;
};

const FIXTURES: readonly Fixture[] = [
  {
    key: 'social-provider',
    label: 'Google identity',
    note: 'Provider-managed credentials. No password or email form is drawn.',
    render: () => (
      <PrivacySecurityScreen
        port={inertPort({ provider: 'google', canManagePassword: false })}
      />
    ),
  },
  {
    key: 'reauthentication-required',
    label: 'Reauthentication required',
    note: 'Supabase answers reauthentication_needed. The confirmation step appears.',
    render: () => (
      <ChangePasswordScreen
        port={inertPort(
          {},
          {
            updatePassword: () =>
              Promise.reject(new AccountSecurityError('reauthentication-required')),
          },
        )}
      />
    ),
  },
  {
    key: 'email-pending',
    label: 'Email change pending',
    note: 'An outstanding confirmation. The signed-in address is unchanged.',
    render: () => (
      <ChangeEmailScreen port={inertPort({ pendingEmail: 'new.address@example.com' })} />
    ),
  },
  {
    key: 'global-signout-failure',
    label: 'Global sign-out failure',
    note: 'The remote half failed. The screen claims this device only.',
    render: () => (
      <PrivacySecurityScreen
        port={inertPort(
          {},
          {
            signOutEverywhere: () =>
              Promise.resolve({ status: 'local-only' as const, code: 'offline' as const }),
          },
        )}
      />
    ),
  },
  {
    key: 'paid-revoked',
    label: 'Paid plan, no grants',
    note: 'Premium Single. Every module reads "Asks first" — paying is not permission.',
    render: () => (
      <EntitlementProvider
        adapter={
          new MockPurchaseAdapter({
            initialEntitlement: {
              ...FREE_ENTITLEMENT,
              plan: 'premium_single',
              status: 'active',
              capabilities: PLAN_CAPABILITIES.premium_single,
            },
          })
        }
      >
        <PrivacySecurityScreen port={inertPort({})} />
      </EntitlementProvider>
    ),
  },
];

export function PrivacySecurityFixturesScreen() {
  const { dp } = useEntryAuthMetrics();
  const insets = useSafeAreaInsets();
  const [active, setActive] = useState<string | null>(null);

  const fixture = FIXTURES.find((entry) => entry.key === active);
  if (fixture !== undefined) {
    return (
      <View style={styles.fill} testID={`privacy-security-fixture-${fixture.key}`}>
        {fixture.render()}
        <View style={[styles.bar, { padding: dp(8), paddingBottom: insets.bottom + dp(8) }]}>
          <SecondaryButton
            label="← Fixtures"
            onPress={() => setActive(null)}
            testID="privacy-security-fixture-back"
          />
        </View>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.page}
      // The top inset is applied here rather than by a scaffold: this list is not a product screen
      // and must not inherit one, but a title under the status bar is unreadable either way.
      contentContainerStyle={{
        paddingHorizontal: dp(16),
        paddingTop: insets.top + dp(12),
        paddingBottom: insets.bottom + dp(16),
        rowGap: dp(12),
      }}
      testID="privacy-security-fixtures"
    >
      <EntryAuthText token="titleCompact" color={subscriptionColors.textPrimary}>
        Privacy &amp; Security fixtures
      </EntryAuthText>
      <EntryAuthText token="caption" color={subscriptionColors.warning}>
        Development only. Every fixture is local — no account is read, changed or signed out.
      </EntryAuthText>

      {FIXTURES.map((entry) => (
        <ProfileDetailCard key={entry.key} testID={`privacy-security-fixture-card-${entry.key}`}>
          <EntryAuthText token="body" color={subscriptionColors.textPrimary}>
            {entry.label}
          </EntryAuthText>
          <EntryAuthText token="caption" color={subscriptionColors.textSecondary}>
            {entry.note}
          </EntryAuthText>
          <SecondaryButton
            label="Open"
            onPress={() => setActive(entry.key)}
            testID={`privacy-security-fixture-open-${entry.key}`}
          />
        </ProfileDetailCard>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  page: {
    flex: 1,
    backgroundColor: subscriptionColors.pageBackground,
  },
  bar: {
    backgroundColor: subscriptionColors.surface,
    borderTopWidth: 1,
    borderTopColor: subscriptionColors.border,
  },
});
