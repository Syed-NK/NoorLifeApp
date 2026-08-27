import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { View } from 'react-native';

import {
  ModuleAIInsightCard,
  ModuleErrorState,
  ModuleFeatureGrid,
  ModuleHeroCard,
  ModuleLoadingState,
  ModuleQuickActionRow,
  ModuleSection,
  ModuleSummaryCard,
  ModuleText,
} from '@features/modules/components';
import { ModuleCard } from '@features/modules/components/module-card';
import { moduleLayout, moduleNeutrals } from '@features/modules/module-tokens';
import { moduleRegistry } from '@features/modules/module-registry';
import { useModuleMetrics } from '@features/modules/use-module-metrics';
import type { UseModuleOverview } from '@features/modules/use-module-overview';
import { usePlannerDay } from '@features/planner/di/planner-day-source';

import { formatAmount } from '../data/finance-format';
import type { FinanceLedger } from '../data/finance-ledger';
import { summariseFinance } from '../data/finance-selectors';
import { useOptionalFinance } from '../di/finance-provider';

/**
 * **The Finance home, reading the live ledger** — issue #93.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── Why a composition, and why it reproduces the generic arrangement ───────
 * The generic module home reads `useModuleOverview`, which resolves `empty` from the shared mock —
 * Finance has no entry there and should not: that mock deliberately returns no dataset (#23), and
 * teaching it to read a repository would give every module a second path to its own data.
 *
 * `ModuleHomeComposition` is the existing per-module seam, so Finance takes it. What this renders is
 * the generic arrangement — hero, quick actions, "At a glance", the capability grid — with the
 * summary derived from the real ledger instead of a fixture. Every surface Finance had before is
 * still here; unlike Planner (#77), Finance's quick actions and capability grid *do* render, and
 * dropping them would be a regression dressed as a rewrite.
 *
 * ── Nothing here is stored ─────────────────────────────────────────────────
 * The figures come from `summariseFinance` on each read. A written-down total can disagree with the
 * records it totals, and then there are two answers with no way to tell which is right.
 *
 * ── Before a currency exists ───────────────────────────────────────────────
 * An unconfigured ledger shows no figures at all. Rendering "0.00" in a currency the user has not
 * chosen would be inventing the label this module refuses to infer.
 * ═══════════════════════════════════════════════════════════════════════════
 */
/*
  One shared value for "no owner, so nothing recorded". A fresh object literal here would be a new
  reference on every render, which would make the memo below recompute every time and defeat its own
  purpose — and this value is never written, so sharing it is safe.
*/
const NO_LEDGER: FinanceLedger = { currency: null, transactions: [] };

export function FinanceHomeContent({ state }: { readonly state: UseModuleOverview }) {
  const router = useRouter();
  /*
    Read-only, so it degrades rather than throws — issue #93.

    The split is deliberate. A surface that *writes* must have the owner, because writing through a
    private copy is the defect #73 removed from Planner, so `FinanceSpendingScreen` uses `useFinance`
    and throws without one. This home only *reads* a summary, and `today-agenda-provider` records
    why a read on a home screen must not take the screen down: a missing owner means no ledger, which
    means nothing recorded — which is exactly what this renders.
  */
  const finance = useOptionalFinance();
  const { dp } = useModuleMetrics();
  const { today } = usePlannerDay();

  const definition = moduleRegistry.finance;
  const ledger = finance?.ledger ?? NO_LEDGER;
  const summary = useMemo(() => summariseFinance(ledger, today), [ledger, today]);
  const currency = ledger.currency;
  const loading = finance?.loading ?? false;
  const fault = finance?.fault ?? null;

  return (
    <View style={{ rowGap: dp(moduleLayout.sectionGap) }}>
      <ModuleHeroCard
        onAction={() => router.push('/finance/transactions?intent=add-expense')}
        testID="finance-hero"
      />

      <ModuleQuickActionRow testID="finance-quick-actions" />

      {loading ? <ModuleLoadingState /> : null}

      {fault === null ? null : (
        <ModuleErrorState
          onRetry={() => void finance?.reload()}
          developerDetail={fault}
          testID="finance-home-error"
        />
      )}

      {!loading && fault === null ? (
        <ModuleSection title="At a glance" testID="finance-glance">
          {currency === null ? (
            <ModuleCard testID="finance-no-currency">
              <View style={{ rowGap: dp(6) }}>
                <ModuleText token="cardTitle" accessibilityRole="header">
                  No transactions yet
                </ModuleText>
                <ModuleText token="caption" color={moduleNeutrals.textSecondary}>
                  Choose your currency in Spending, then record what you spend. Everything stays on
                  this device.
                </ModuleText>
              </View>
            </ModuleCard>
          ) : (
            <ModuleSummaryCard
              metrics={[
                {
                  key: 'entries',
                  label: 'Entries',
                  value: String(summary.count),
                  icon: 'transactions',
                },
                {
                  key: 'spent',
                  label: 'Spent',
                  value: formatAmount(summary.expenseMinor, currency),
                  icon: 'budgets',
                },
                {
                  key: 'received',
                  label: 'Received',
                  value: formatAmount(summary.incomeMinor, currency),
                  icon: 'trends',
                },
              ]}
              testID="finance-summary"
            />
          )}
        </ModuleSection>
      ) : null}

      {/*
        The module's AI insight, still from the shared overview — issue #93.

        The summary above moved to the live ledger; this did not, and must not. It is Money AI's
        line about the module, not a figure about the user's records, and the composition inherits
        the overview state precisely so a surface like this keeps one read rather than growing a
        second. Dropping it would have been a silent regression: Finance rendered this card before.
      */}
      {state.status === 'ready' && state.overview.insight !== null ? (
        <ModuleAIInsightCard
          message={state.overview.insight}
          onPress={() => router.push(definition.routes.ai)}
          testID="finance-insight"
        />
      ) : null}

      <ModuleSection
        title={`All of ${definition.name}`}
        subtitle={definition.summary}
        testID="finance-capabilities"
      >
        <ModuleFeatureGrid testID="finance-features" />
      </ModuleSection>
    </View>
  );
}
