import { useLocalSearchParams } from 'expo-router';

import { PurchaseProcessingScreen } from '@features/subscription/screens/purchase-flow-screens';
import { parsePeriodParam, parsePlanParam } from '@features/subscription/subscription-routes';

/** Screen 06 — Purchase Processing (Phase 5 §5.06). Guards against a duplicate attempt. */
export default function Screen() {
  const { plan, period, intent } = useLocalSearchParams<{
    plan?: string;
    period?: string;
    intent?: string;
  }>();

  return (
    <PurchaseProcessingScreen
      plan={parsePlanParam(plan)}
      period={parsePeriodParam(period)}
      intentNonce={typeof intent === 'string' ? intent : undefined}
    />
  );
}
