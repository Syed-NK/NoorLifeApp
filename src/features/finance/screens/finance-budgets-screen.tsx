import { useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import {
  ModuleButton,
  ModuleErrorState,
  ModuleLoadingState,
  ModuleScaffold,
  ModuleSection,
  ModuleStatusBanner,
  ModuleText,
} from '@features/modules/components';
import { ModuleCard } from '@features/modules/components/module-card';
import { useModuleTheme } from '@features/modules/module-context';
import { useModuleSurfaces } from '@features/modules/module-surfaces';
import { moduleLayout, moduleNeutrals } from '@features/modules/module-tokens';
import { useModuleMetrics } from '@features/modules/use-module-metrics';
import { usePlannerDay } from '@features/planner/di/planner-day-source';

import type { FinanceBudget } from '../data/finance-budget';
import { financeCategoryKey } from '../data/finance-budget';
import {
  progressForMonth,
  type FinanceBudgetProgress,
  type FinanceBudgetStatus,
} from '../data/finance-budget-progress';
import { formatPercentTenths } from '../data/finance-comparison-copy';
import type { FinanceCurrency } from '../data/finance-money';
import { currentMonthOf, formatMonth } from '../data/finance-month';
import { financeCategories } from '../data/finance-selectors';
import { useFinance } from '../di/finance-provider';
import { financeMoney, useFinanceLocale, type FinanceMoney } from '../di/use-finance-money';

/**
 * **Budgets — an amount per category, measured against the ledger** — issue #94.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── Nothing on this screen is stored ───────────────────────────────────────
 * The limit is the user's. Spent, remaining, over and the percentage used are all computed from the
 * transactions on every read, which is what #94 means by "spend is always derived, so a budget
 * cannot drift from the transactions it measures". Editing a transaction rewrites no budget; the
 * next render simply reads a different answer.
 *
 * ── The period is named, never assumed ─────────────────────────────────────
 * A budget is a standing monthly amount, and the month it is being measured against comes from the
 * shared day source. So the heading says which month these figures are for — "spent 500 of 600" is
 * meaningless without it, and a phone left open across a month boundary must not keep showing the
 * old month's spend under the new month's plan. There is no timer here and no second clock: the day
 * source moves, and this moves with it.
 *
 * ── Four states, in words ──────────────────────────────────────────────────
 * No spending, below, exactly at, over. Each one is a sentence, not a colour — the bar is decoration
 * and carries an `accessibilityLabel` that repeats what the text already says, so a greyscale
 * screenshot and a screen reader both get the whole answer. #94 defines no warning threshold, so
 * there is no "nearly there" state: inventing one would be this screen deciding when somebody should
 * feel uneasy about their own money.
 *
 * ── What it does not claim ─────────────────────────────────────────────────
 * No alerts, and no permission to deliver them — #90 removed that promise and #94 says in as many
 * words that it must not come back. No forecast, no advice, no judgement. A budget that is over is
 * shown when the user looks; nothing notifies.
 * ═══════════════════════════════════════════════════════════════════════════
 */

export function FinanceBudgetsScreen() {
  return (
    <ModuleScaffold moduleId="finance" activeKey="budgets" title="Budgets" testID="finance-budgets">
      <BudgetsBody />
    </ModuleScaffold>
  );
}

/** Split out so the hooks below read the module context the scaffold creates. */
function BudgetsBody() {
  const finance = useFinance();
  const { dp } = useModuleMetrics();
  const { today } = usePlannerDay();

  const [editing, setEditing] = useState<FinanceBudget | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [category, setCategory] = useState('');
  const [amount, setAmount] = useState('');
  const [pendingRemoval, setPendingRemoval] = useState<FinanceBudget | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  /*
    The duplicate-submit guard is a ref, not the `saving` state — a real double tap delivers both
    presses inside one React batch, so the second handler still closes over `saving === false`.
    Spending records the same reasoning; two budgets for one category is the defect it prevents here.
  */
  const savingRef = useRef(false);

  /* Read unconditionally: the early returns below run before the currency is known. */
  const locale = useFinanceLocale();

  const ledger = finance.ledger;
  const month = currentMonthOf(today);
  /*
    Derived from the **ledger**, not from any filtered view of it. The Spending screen's chips and
    date range narrow that screen's list; a budget taken from those rows would report a slice of the
    month as the month and would move whenever somebody touched a filter.
  */
  const view = useMemo(
    () => progressForMonth(ledger, finance.budgets, month),
    [ledger, finance.budgets, month],
  );
  /* Categories already present in the ledger, offered as shortcuts so a budget can match spending. */
  const known = useMemo(() => financeCategories(ledger), [ledger]);
  const budgetedKeys = useMemo(
    () => new Set(finance.budgets.map((budget) => financeCategoryKey(budget.category))),
    [finance.budgets],
  );

  if (finance.loading) {
    return <ModuleLoadingState />;
  }

  if (finance.fault === 'corrupt-data' || finance.budgetFault === 'corrupt-data') {
    /*
      Quarantine, stated plainly, and it says *which* store so the user knows whether their
      transactions or their plan is the thing that could not be read. Neither was overwritten.
    */
    return (
      <ModuleErrorState
        title={
          finance.budgetFault === 'corrupt-data'
            ? 'Your budgets could not be read'
            : 'Your Finance records could not be read'
        }
        body="They have been left exactly as they are on this device. Nothing was changed or deleted."
        retryLabel="Try again"
        onRetry={() => void finance.reload()}
        testID="finance-budgets-corrupt"
      />
    );
  }

  if (finance.fault === 'storage-unavailable' || finance.budgetFault === 'storage-unavailable') {
    return (
      <ModuleErrorState
        onRetry={() => void finance.reload()}
        testID="finance-budgets-unavailable"
      />
    );
  }

  if (ledger.currency === null) {
    /*
      A budget is an amount of money, and this ledger has no currency yet. Rather than duplicating
      #93's picker, this points at the one that already exists — two currency-setup paths would be
      two places for the choice to be made differently.
    */
    return (
      <ModuleCard tinted accentBorder testID="finance-budgets-no-currency">
        <View style={{ rowGap: dp(6) }}>
          <ModuleText token="cardTitle" accessibilityRole="header">
            Choose your currency first
          </ModuleText>
          <ModuleText token="caption" color={moduleNeutrals.textSecondary}>
            A budget is an amount of money, so NoorLife needs to know which currency your records
            are in. Open Spending to choose it — it is not guessed from your phone.
          </ModuleText>
        </View>
      </ModuleCard>
    );
  }

  const currency = ledger.currency;
  const money = financeMoney(currency, locale);

  function clearComposer(): void {
    setCategory('');
    setAmount('');
    setEditing(null);
  }

  async function submit(): Promise<void> {
    if (savingRef.current) {
      return;
    }
    const parsed = money.parse(amount);
    if (parsed.kind !== 'ok') {
      setMessage(AMOUNT_MESSAGE[parsed.reason] ?? 'That amount could not be read.');
      return;
    }
    if (category.trim() === '') {
      setMessage('Enter a category to budget for.');
      return;
    }

    savingRef.current = true;
    setSaving(true);
    const draft = { category: category.trim(), limitMinor: parsed.minor };
    const result =
      editing === null
        ? await finance.createBudget(draft)
        : await finance.updateBudget(editing.id, draft);
    savingRef.current = false;
    setSaving(false);

    if (result.kind === 'ok') {
      setMessage(editing === null ? 'Budget saved' : 'Changes saved');
      clearComposer();
      setComposerOpen(false);
      return;
    }
    setMessage(
      result.kind === 'invalid'
        ? (BUDGET_FAULT_MESSAGE[result.fault] ?? 'That could not be saved.')
        : 'That could not be saved.',
    );
  }

  async function confirmRemoval(): Promise<void> {
    if (pendingRemoval === null || savingRef.current) {
      return;
    }
    savingRef.current = true;
    setSaving(true);
    const result = await finance.removeBudget(pendingRemoval.id);
    savingRef.current = false;
    setSaving(false);
    setPendingRemoval(null);
    setMessage(result.kind === 'ok' ? 'Budget deleted' : 'That could not be deleted.');
  }

  return (
    <View style={{ rowGap: dp(moduleLayout.sectionGap) }}>
      {message === null ? null : (
        <ModuleStatusBanner
          tone="info"
          message={message}
          onDismiss={() => setMessage(null)}
          testID="finance-budgets-message"
        />
      )}

      <ModuleSection
        title={`Budgets for ${formatMonth(month)}`}
        subtitle="Each figure is worked out from your transactions every time this screen opens."
        testID="finance-budgets-section"
      >
        {view.entries.length === 0 ? (
          <ModuleCard testID="finance-budgets-empty">
            <View style={{ rowGap: dp(6) }}>
              <ModuleText token="cardTitle" accessibilityRole="header">
                No budgets set
              </ModuleText>
              <ModuleText token="caption" color={moduleNeutrals.textSecondary}>
                Set an amount for a category and this screen will show what you have spent against
                it this month.
              </ModuleText>
            </View>
          </ModuleCard>
        ) : (
          <View style={{ rowGap: dp(10) }}>
            {view.entries.map((entry) => (
              <BudgetRow
                key={entry.budget.id}
                entry={entry}
                currency={currency}
                onEdit={() => {
                  setEditing(entry.budget);
                  setComposerOpen(true);
                  setCategory(entry.budget.category);
                  setAmount(money.plain(entry.budget.limitMinor));
                }}
                onDelete={() => setPendingRemoval(entry.budget)}
              />
            ))}
          </View>
        )}
      </ModuleSection>

      {view.uncategorisedMinor === 0 ? null : (
        <ModuleCard testID="finance-budgets-uncategorised">
          <View style={{ rowGap: dp(4) }}>
            {/*
              Money the user spent that no budget can measure. Omitting it would make the budgets
              look as though they covered the month when they cover only part of it.
            */}
            <ModuleText token="caption" color={moduleNeutrals.textSecondary}>
              {`${money.amount(view.uncategorisedMinor)} spent in ${formatMonth(month)} without a category, so it counts towards no budget.`}
            </ModuleText>
          </View>
        </ModuleCard>
      )}

      {pendingRemoval === null ? null : (
        <ModuleCard accentBorder testID="finance-budget-removal-confirmation">
          <View style={{ rowGap: dp(8) }}>
            <ModuleText token="cardTitle" accessibilityRole="header">
              Delete this budget?
            </ModuleText>
            <ModuleText token="caption" color={moduleNeutrals.textSecondary}>
              {`The ${pendingRemoval.category} budget will be permanently removed. This cannot be undone. Your transactions are not affected.`}
            </ModuleText>
            <ModuleButton
              label="Delete budget"
              onPress={() => void confirmRemoval()}
              disabled={saving}
              testID="finance-budget-confirm-delete"
            />
            <ModuleButton
              label="Keep budget"
              variant="tertiary"
              onPress={() => setPendingRemoval(null)}
              testID="finance-budget-cancel-delete"
            />
          </View>
        </ModuleCard>
      )}

      {composerOpen || editing !== null ? (
        <ModuleCard tinted accentBorder testID="finance-budget-composer">
          <View style={{ rowGap: dp(10) }}>
            <ModuleText token="cardTitle" accessibilityRole="header">
              {editing === null ? 'Add a budget' : 'Edit budget'}
            </ModuleText>

            <Field
              value={category}
              onChangeText={setCategory}
              placeholder="Category"
              label="Category"
              maxLength={40}
              testID="finance-budget-category"
            />

            {known.length === 0 ? null : (
              <View style={{ rowGap: dp(6) }} testID="finance-budget-known-categories">
                <ModuleText token="caption" color={moduleNeutrals.textSecondary}>
                  Categories you have already used
                </ModuleText>
                <View style={[styles.choices, { gap: dp(6) }]}>
                  {known.map((name) => {
                    /* A category that already has a budget cannot have a second one. */
                    const taken =
                      budgetedKeys.has(financeCategoryKey(name)) &&
                      financeCategoryKey(editing?.category ?? '') !== financeCategoryKey(name);
                    return (
                      <CategoryChip
                        key={name}
                        label={name}
                        disabled={taken}
                        onPress={() => setCategory(name)}
                        testID={`finance-budget-known-${name}`}
                      />
                    );
                  })}
                </View>
              </View>
            )}

            <Field
              value={amount}
              onChangeText={setAmount}
              placeholder={`Amount in ${currency}`}
              label={`Amount in ${currency}`}
              keyboardType="decimal-pad"
              testID="finance-budget-amount"
            />

            <ModuleButton
              label={editing === null ? 'Save budget' : 'Save changes'}
              onPress={() => void submit()}
              loading={saving}
              disabled={saving}
              testID="finance-budget-save"
            />
            <ModuleButton
              label="Cancel"
              variant="tertiary"
              onPress={() => {
                clearComposer();
                setComposerOpen(false);
              }}
              testID="finance-budget-cancel"
            />
          </View>
        </ModuleCard>
      ) : (
        <ModuleButton
          label="Add a budget"
          onPress={() => setComposerOpen(true)}
          testID="finance-budget-open-composer"
        />
      )}
    </View>
  );
}

const AMOUNT_MESSAGE: Record<string, string> = {
  empty: 'Enter an amount.',
  malformed: 'Enter digits and at most one decimal point.',
  'too-precise': 'That is more decimal places than this currency has.',
  'not-positive': 'Enter an amount greater than zero.',
  'too-large': 'That amount is larger than a budget can hold.',
};

const BUDGET_FAULT_MESSAGE: Record<string, string> = {
  'invalid-amount': 'Enter an amount greater than zero.',
  'invalid-category': 'Enter a category to budget for.',
  'duplicate-category': 'That category already has a budget. Edit the existing one instead.',
  'not-found': 'That budget no longer exists.',
  'budgets-full': 'You have as many budgets as this can hold.',
};

/** The four states, as words. The sentence is the answer; nothing depends on a colour. */
function statusSentence(
  status: FinanceBudgetStatus,
  differenceMinor: number,
  money: FinanceMoney,
): string {
  switch (status) {
    case 'no-spending':
      return 'No spending recorded';
    case 'below':
      return `${money.amount(differenceMinor)} remaining`;
    case 'at-limit':
      return 'Budget fully used';
    case 'over':
      return `${money.amount(Math.abs(differenceMinor))} over the budget`;
  }
}

/**
 * One budget, with what has been spent against it this month.
 *
 * The whole row is one accessible node carrying a composed label, so a screen reader states the
 * category, the amounts and the standing as a sentence rather than as fragments to reassemble.
 */
function BudgetRow({
  entry,
  currency,
  onEdit,
  onDelete,
}: {
  readonly entry: FinanceBudgetProgress;
  readonly currency: FinanceCurrency;
  readonly onEdit: () => void;
  readonly onDelete: () => void;
}) {
  const theme = useModuleTheme();
  const surfaces = useModuleSurfaces();
  const { dp } = useModuleMetrics();
  const money = financeMoney(currency, useFinanceLocale());

  const spent = money.amount(entry.spentMinor);
  const limit = money.amount(entry.limitMinor);
  const sentence = statusSentence(entry.status, entry.differenceMinor, money);
  const used = formatPercentTenths(entry.percentTenths);

  /* Decoration only, and clamped so an over-budget bar cannot overflow its track. */
  const filled = Math.min(100, entry.percentTenths / 10);

  return (
    <ModuleCard testID={`finance-budget-${entry.budget.category}`}>
      <View
        style={{ rowGap: dp(8) }}
        accessible
        accessibilityLabel={`${entry.budget.category}. ${spent} spent of ${limit}, ${used} used. ${sentence}.`}
      >
        <View style={[styles.row, styles.spread, { columnGap: dp(8) }]}>
          <ModuleText token="cardTitle" style={styles.grow}>
            {entry.budget.category}
          </ModuleText>
          <ModuleText token="caption" color={moduleNeutrals.textSecondary}>
            {used}
          </ModuleText>
        </View>

        <ModuleText token="caption" color={moduleNeutrals.textSecondary}>
          {`${spent} spent of ${limit}`}
        </ModuleText>

        {/*
          A bar, and nothing but a bar. It repeats what the sentence below already states, is hidden
          from assistive technology, and takes the module's own ink rather than a hue that means
          "bad" — the standing is carried by words, in greyscale, for everybody.
        */}
        <View
          style={[
            styles.track,
            { height: dp(6), borderRadius: dp(3), backgroundColor: surfaces.well },
          ]}
          accessible={false}
          importantForAccessibility="no"
        >
          <View
            style={{
              width: `${filled}%`,
              height: '100%',
              borderRadius: dp(3),
              backgroundColor: theme.ink,
            }}
          />
        </View>

        <ModuleText
          token="caption"
          color={theme.ink}
          testID={`finance-budget-status-${entry.budget.category}`}
        >
          {sentence}
        </ModuleText>

        <View style={[styles.row, { columnGap: dp(8) }]}>
          <ModuleButton
            label="Edit"
            variant="tertiary"
            fullWidth={false}
            onPress={onEdit}
            testID={`finance-budget-edit-${entry.budget.category}`}
          />
          <ModuleButton
            label="Delete"
            variant="tertiary"
            fullWidth={false}
            onPress={onDelete}
            testID={`finance-budget-delete-${entry.budget.category}`}
          />
        </View>
      </View>
    </ModuleCard>
  );
}

function CategoryChip({
  label,
  disabled,
  onPress,
  testID,
}: {
  readonly label: string;
  readonly disabled: boolean;
  readonly onPress: () => void;
  readonly testID: string;
}) {
  const theme = useModuleTheme();
  const surfaces = useModuleSurfaces();
  const { dp } = useModuleMetrics();
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={disabled ? `${label}, already budgeted` : `Use category ${label}`}
      accessibilityState={{ disabled }}
      style={[
        styles.choice,
        {
          /* The accessibility minimum, unscaled — it is a bound, not a dimension. */
          minHeight: moduleLayout.minTouchTarget,
          borderRadius: dp(12),
          borderColor: surfaces.border,
          backgroundColor: disabled ? surfaces.well : surfaces.card,
          opacity: disabled ? 0.5 : 1,
          paddingHorizontal: dp(10),
        },
      ]}
      testID={testID}
    >
      <ModuleText token="button" color={disabled ? moduleNeutrals.textTertiary : theme.ink}>
        {label}
      </ModuleText>
    </Pressable>
  );
}

function Field({
  value,
  onChangeText,
  placeholder,
  label,
  testID,
  keyboardType,
  maxLength,
}: {
  readonly value: string;
  readonly onChangeText: (value: string) => void;
  readonly placeholder: string;
  readonly label: string;
  readonly testID: string;
  readonly keyboardType?: 'decimal-pad';
  readonly maxLength?: number;
}) {
  const theme = useModuleTheme();
  const surfaces = useModuleSurfaces();
  const { dp } = useModuleMetrics();
  return (
    <TextInput
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={moduleNeutrals.textTertiary}
      accessibilityLabel={label}
      {...(keyboardType === undefined ? {} : { keyboardType })}
      {...(maxLength === undefined ? {} : { maxLength })}
      style={[
        styles.input,
        {
          minHeight: dp(48),
          borderRadius: dp(12),
          borderColor: theme.border,
          backgroundColor: surfaces.card,
          color: moduleNeutrals.textPrimary,
          paddingHorizontal: dp(12),
          fontSize: dp(14),
        },
      ]}
      testID={testID}
    />
  );
}

const styles = StyleSheet.create({
  input: { borderWidth: 1 },
  row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
  spread: { justifyContent: 'space-between' },
  grow: { flexShrink: 1 },
  choices: { flexDirection: 'row', flexWrap: 'wrap' },
  choice: { alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  track: { width: '100%', overflow: 'hidden' },
});
