import { useRouter } from 'expo-router';
import { View } from 'react-native';

import { EntryAuthText } from '@features/entry-auth/components/entry-auth-text';
import { PrimaryButton } from '@features/entry-auth/components/primary-button';
import { SecondaryButton } from '@features/entry-auth/components/secondary-button';
import { useEntryAuthMetrics } from '@features/entry-auth/use-entry-auth-metrics';
import { globalRoutes } from '@application/navigation/routes';

import { PlanComparisonTable } from '../components/plan-comparison-table';
import { SubscriptionLegalLinks } from '../components/disclosures';
import { SubscriptionScreenScaffold } from '../components/subscription-screen-scaffold';
import { useEntitlement } from '../services/entitlement-context';
import { familyWording, welcomeCopy } from '../subscription-copy';
import { subscriptionColors } from '../subscription-tokens';
import { subscriptionRoutes } from '../subscription-routes';

/**
 * Screen 02 — Plan Comparison.
 *
 * The twelve rows the brief specifies, with Faith first and marked "Always included" under every
 * plan. The table is the screen's whole purpose, so it scrolls and the actions stay pinned.
 *
 * The family seat wording appears here in full — headline plus the supporting line — because this
 * is where a user comparing plans meets the "6" in the Family accounts row and needs to know the
 * organizer is one of the six.
 */
export function PlanComparisonScreen() {
  const router = useRouter();
  const { dp } = useEntryAuthMetrics();
  const { isMockMode } = useEntitlement();

  return (
    <SubscriptionScreenScaffold
      title="Compare plans"
      subtitle="Faith is included on every plan, always."
      onBack={() => router.back()}
      isMockMode={isMockMode}
      footer={
        <View style={{ rowGap: dp(8) }}>
          <PrimaryButton
            label="Choose a plan"
            onPress={() => router.push(subscriptionRoutes.welcome)}
            testID="comparison-choose"
          />
          <SecondaryButton
            label={welcomeCopy.continueFree}
            onPress={() => router.replace(globalRoutes.home)}
            testID="comparison-free"
          />
          <SubscriptionLegalLinks testID="comparison-legal" />
        </View>
      }
      testID="plan-comparison"
    >
      <View style={{ rowGap: dp(10) }}>
        <PlanComparisonTable testID="comparison-table" />

        <View style={{ rowGap: dp(3) }}>
          <EntryAuthText token="label" color={subscriptionColors.textPrimary}>
            {familyWording.headline}
          </EntryAuthText>
          <EntryAuthText token="caption" color={subscriptionColors.textSecondary}>
            {familyWording.supporting}
          </EntryAuthText>
        </View>
      </View>
    </SubscriptionScreenScaffold>
  );
}
