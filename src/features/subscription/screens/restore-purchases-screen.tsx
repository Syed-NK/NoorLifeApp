import { useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { globalRoutes, moduleRoutes } from '@application/navigation/routes';
import { EntryAuthText } from '@features/entry-auth/components/entry-auth-text';
import { PrimaryButton } from '@features/entry-auth/components/primary-button';
import { SecondaryButton } from '@features/entry-auth/components/secondary-button';
import { useEntryAuthMetrics } from '@features/entry-auth/use-entry-auth-metrics';

import { SubscriptionScreenScaffold } from '../components/subscription-screen-scaffold';
import {
  SubscriptionLoadingState,
  SubscriptionStateBanner,
} from '../components/subscription-states';
import { describeRestoreOutcome } from '../domain/restore-outcome';
import type { RestoreOutcome } from '../services/purchase-adapter';
import { useEntitlement, useEntitlementActions } from '../services/entitlement-context';
import { restoreCopy } from '../subscription-copy';
import { subscriptionColors } from '../subscription-tokens';

/**
 * Screen 08 — Restore Purchases.
 *
 * ── Every outcome is a designed state ───────────────────────────────────────
 * Initial, restoring, restored, nothing found, store unavailable, offline and unexpected error
 * are the seven the brief lists, and each gets its own heading, body and action. "Nothing found"
 * is deliberately not styled as an error: a user with no prior purchase has done nothing wrong,
 * and the useful thing to tell them is that a different store account might be the reason.
 */
export function RestorePurchasesScreen() {
  const router = useRouter();
  const { dp } = useEntryAuthMetrics();
  const { entitlement, isMockMode } = useEntitlement();
  const { restore } = useEntitlementActions();

  const [outcome, setOutcome] = useState<RestoreOutcome | null>(null);
  const [isRestoring, setIsRestoring] = useState(false);

  const run = async () => {
    setIsRestoring(true);
    setOutcome(null);
    try {
      const result = await restore();
      setOutcome(result.outcome);
    } finally {
      setIsRestoring(false);
    }
  };

  // Shared with Family & Membership, which runs the same service inline — see `restore-outcome`.
  const presentation = describeRestoreOutcome(outcome, entitlement.plan);

  return (
    <SubscriptionScreenScaffold
      title={restoreCopy.heading}
      subtitle={restoreCopy.body}
      onBack={() => router.back()}
      isMockMode={isMockMode}
      footer={
        <View style={{ rowGap: dp(8) }}>
          {outcome === 'restored' ? (
            <PrimaryButton
              label="Continue"
              onPress={() => router.replace(globalRoutes.home)}
              testID="restore-continue"
            />
          ) : (
            <PrimaryButton
              label={restoreCopy.action}
              onPress={() => void run()}
              loading={isRestoring}
              testID="restore-action"
            />
          )}
          <SecondaryButton
            label="Continue to Faith"
            onPress={() => router.replace(moduleRoutes.faith.home)}
            testID="restore-faith"
          />
        </View>
      }
      testID="restore-purchases"
    >
      <View style={{ rowGap: dp(10) }}>
        {isRestoring ? (
          <SubscriptionLoadingState message={restoreCopy.restoring} testID="restore-restoring" />
        ) : presentation === null ? (
          // Initial state: no banner, just the explanation from the subtitle above.
          <EntryAuthText token="caption" color={subscriptionColors.textSecondary}>
            {restoreCopy.body}
          </EntryAuthText>
        ) : (
          <View style={{ rowGap: dp(6) }}>
            <SubscriptionStateBanner
              tone={presentation.tone}
              message={presentation.title}
              testID={`restore-${outcome}`}
            />
            <EntryAuthText token="caption" color={subscriptionColors.textSecondary}>
              {presentation.body}
            </EntryAuthText>
          </View>
        )}
      </View>
    </SubscriptionScreenScaffold>
  );
}

