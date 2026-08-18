import { useLocalSearchParams } from 'expo-router';

import { PlanDetailsScreen } from '@features/subscription/screens/plan-details-screen';
import { parsePeriodParam } from '@features/subscription/subscription-routes';

/** Screen 03 — Premium Single Details (Phase 5 §5.03). */
export default function Screen() {
  const { period } = useLocalSearchParams<{ period?: string }>();
  return <PlanDetailsScreen plan="premium_single" initialPeriod={parsePeriodParam(period)} />;
}
