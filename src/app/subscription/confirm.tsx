import { useLocalSearchParams } from 'expo-router';

import { PurchaseConfirmScreen } from '@features/subscription/screens/purchase-flow-screens';
import { parsePeriodParam, parsePlanParam } from '@features/subscription/subscription-routes';

/** Screen 05 — Purchase Confirmation (Phase 5 §5.05). Not a checkout form. */
export default function Screen() {
  const { plan, period } = useLocalSearchParams<{ plan?: string; period?: string }>();
  return <PurchaseConfirmScreen plan={parsePlanParam(plan)} period={parsePeriodParam(period)} />;
}
