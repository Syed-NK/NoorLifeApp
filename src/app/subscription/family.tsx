import { useLocalSearchParams } from 'expo-router';

import { PlanDetailsScreen } from '@features/subscription/screens/plan-details-screen';
import { parsePeriodParam } from '@features/subscription/subscription-routes';

/** Screen 04 — Premium Family Details (Phase 5 §5.04). Six accounts: organizer plus five. */
export default function Screen() {
  const { period } = useLocalSearchParams<{ period?: string }>();
  return <PlanDetailsScreen plan="premium_family" initialPeriod={parsePeriodParam(period)} />;
}
