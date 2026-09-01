import { useLocalSearchParams } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppTextInput } from '@ds/typography/app-text-input';
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
import { minimumTouchTargetSize } from '@shared/utils/a11y';

import { FinanceChoiceRow } from '../components/finance-choice-row';
import {
  compareFinanceMonths,
  type FinanceCategoryChange,
  type FinanceChange,
  type FinanceMonthComparison,
} from '../data/finance-comparison';
import {
  INCOME_SUBJECT,
  NET_SUBJECT,
  SPENDING_SUBJECT,
  announceChange,
  describeChange,
  describeMovement,
  type ComparisonSubject,
} from '../data/finance-comparison-copy';
import { FINANCE_CURRENCY_NAMES, searchCurrencies } from '../data/finance-format';
import type { FinanceDirection, FinanceTransaction } from '../data/finance-ledger';
import type { FinanceCurrency } from '../data/finance-money';
import {
  currentMonthOf,
  formatMonth,
  nextMonth,
  previousMonth,
  type FinanceMonth,
} from '../data/finance-month';
import {
  NO_FINANCE_FILTERS,
  canStepBack,
  canStepForward,
  clampMonth,
  filterFinanceTransactions,
  financeCategories,
  financeMonthBounds,
  groupFinanceByDay,
  hasActiveFilters,
  hasCustomRange,
  normaliseRange,
  totalFinance,
  type FinanceFilters,
  type FinanceScope,
} from '../data/finance-selectors';
import { useFinance } from '../di/finance-provider';
import { financeMoney, useFinanceLocale } from '../di/use-finance-money';
import {
  DELETED_SAVINGS_GOAL_LABEL,
  isRefund,
  isSavingsTransfer,
  savingsTransferLabel,
} from '../data/finance-record-kind';

/**
 * **Spending — the first Finance screen that does anything** — issue #93.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── The currency comes first, and it is chosen ─────────────────────────────
 * A ledger with no currency cannot hold money, so this screen's first state is a picker, not a
 * composer. Nothing infers the choice: the list is the app's own registry, searchable by code and
 * by name, and it is the same list the repository validates against — so the picker cannot offer a
 * code the store would refuse. `Intl.supportedValuesOf` is deliberately not used; it is absent on
 * some Hermes builds this app ships to, and a list that exists on one device and not another is
 * worse than a shorter one that is always there.
 *
 * The choice is changeable only while the ledger is empty (#92). This screen shows that as a stated
 * rule with the reason, rather than a disabled control with no explanation.
 *
 * ── Amounts never touch a float ────────────────────────────────────────────
 * `parseAmountToMinor` does string work. `Math.round(parseFloat('1.005') * 100)` is 100, a cent
 * short of what the user typed, and a ledger is exactly the wrong place to be a cent short.
 *
 * ── Everything shown is derived ────────────────────────────────────────────
 * Groups, filters and totals are computed from the one stored list on each read. No total is
 * written down, so no total can disagree with the records it totals — and filtering, being pure,
 * cannot alter anything.
 *
 * ── What this screen does not claim ────────────────────────────────────────
 * No sync, no server, no receipt capture, no automatic categorisation and no forecast. The category
 * is a free-text field the user types, deliberately: inventing a fixed taxonomy here would be a
 * product decision smuggled in as an implementation detail, and #94 is where categories acquire
 * meaning.
 * ═══════════════════════════════════════════════════════════════════════════
 */

export function FinanceSpendingScreen() {
  return (
    <ModuleScaffold
      moduleId="finance"
      activeKey="transactions"
      title="Spending"
      testID="finance-spending"
    >
      <SpendingBody />
    </ModuleScaffold>
  );
}

/** Split out so the hooks below read the module context the scaffold creates. */
function SpendingBody() {
  const finance = useFinance();
  const theme = useModuleTheme();
  const surfaces = useModuleSurfaces();
  const { dp } = useModuleMetrics();
  const { today } = usePlannerDay();
  const params = useLocalSearchParams<{ intent?: string | string[] }>();

  /*
    The typed entry parameter. "Add expense" on the Finance home opens this screen with the expense
    direction preselected; ordinary Transactions navigation opens the list with nothing forced. The
    value is read once as initial state rather than through an effect, so it cannot snap the form
    back while somebody is filling it in.
  */
  const intent = Array.isArray(params.intent) ? params.intent[0] : params.intent;

  const [recordKind, setRecordKind] = useState<ComposerKind>('expense');
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState('');
  const [note, setNote] = useState('');
  const [occurredOn, setOccurredOn] = useState(today);
  const [editing, setEditing] = useState<FinanceTransaction | null>(null);
  const [pendingRemoval, setPendingRemoval] = useState<FinanceTransaction | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [composerOpen, setComposerOpen] = useState(intent === 'add-expense');
  const [currencyQuery, setCurrencyQuery] = useState('');
  const [changingCurrency, setChangingCurrency] = useState(false);
  const [filters, setFilters] = useState<FinanceFilters>(NO_FINANCE_FILTERS);

  /*
    The month the list is showing, or `null` for "whichever month it currently is".

    That distinction is the whole design. A screen that stored the current month as a value would
    stop following the shared day source the instant it mounted, so a phone left open across midnight
    on the 31st would still be showing last month in the morning — and the user has no way to know
    the figure is stale. `null` means the month is *derived*, so a midnight roll-over, a timezone
    change and a foreground reconciliation all move it, with no second clock and no effect.

    Stepping away records a real choice, which is then kept: yanking somebody back out of July
    because the calendar turned over would be worse than the staleness it avoided. Stepping back onto
    the current month returns to following it.
  */
  const [chosenMonth, setChosenMonth] = useState<FinanceMonth | null>(null);

  /*
    The duplicate-submit guard is a ref, not the `saving` state, and that distinction is the whole
    point. A real double tap delivers both presses inside one React batch, so the second handler
    still closes over `saving === false` and the guard it was supposed to hit never fires. A ref is
    written synchronously, so the second press sees it. `saving` remains, because the button needs to
    render as busy — it is the *display* of the guard, not the guard.
  */
  const savingRef = useRef(false);

  /* Read unconditionally: the early returns below run before the currency is known. */
  const locale = useFinanceLocale();

  const ledger = finance.ledger;
  const categories = useMemo(() => financeCategories(ledger), [ledger]);

  /*
    Goal names, for labelling savings transfers in the list — the cross-feature audit.

    A transfer is an ordinary ledger record and belongs in this history; what it must not do is read
    as an ordinary purchase. So the row names the goal, and a transfer whose goal has been deleted
    falls back to a neutral phrase rather than borrowing a name or losing its meaning. Resolved here,
    where the goal list is already held, because `finance-record-kind` deliberately refuses to guess
    a name it cannot see.
  */
  const goalNames = useMemo(
    () => new Map(finance.goals.map((goal) => [goal.id, goal.name])),
    [finance.goals],
  );
  const savingsDetail = (transaction: FinanceTransaction): string | null => {
    if (!isSavingsTransfer(transaction)) {
      return null;
    }
    return goalNames.get(transaction.goalId ?? '') ?? DELETED_SAVINGS_GOAL_LABEL;
  };

  const currentMonth = currentMonthOf(today);
  const bounds = useMemo(() => financeMonthBounds(ledger, currentMonth), [ledger, currentMonth]);
  /*
    The bounds move underneath the selection — deleting the last record of the only future month, or
    the day rolling into a new one, both change what is reachable. Clamping on read rather than in an
    effect means the screen can never render a month it would refuse to step to.
  */
  const month = clampMonth(chosenMonth ?? currentMonth, bounds);

  /* Landing back on the current month resumes following it, rather than pinning it as a choice. */
  const goToMonth = (next: FinanceMonth): void => {
    setChosenMonth(next === currentMonth ? null : next);
  };
  const ranging = hasCustomRange(filters);
  const scope = useMemo<FinanceScope>(
    () => (ranging ? { kind: 'range' } : { kind: 'month', month }),
    [ranging, month],
  );

  const visible = useMemo(
    () => filterFinanceTransactions(ledger, filters, scope),
    [ledger, filters, scope],
  );
  const groups = useMemo(() => groupFinanceByDay(visible), [visible]);
  const totals = useMemo(() => totalFinance(visible), [visible]);
  const filtering = hasActiveFilters(filters);

  /*
    The comparison, derived from the **ledger** — issue #102.

    Not from `visible`, and the distinction is the whole reason this line reads the way it does. The
    list above is narrowed by the category chips and by a custom date range; a monthly comparison
    taken from those rows would report a slice of August as August, and would move every time
    somebody touched a filter. `compareFinanceMonths` takes the whole owner ledger and scopes it to
    the two months itself.

    It recomputes when the ledger changes and when the selected month changes — and `month` follows
    the shared day source while no month has been chosen, so a midnight roll-over into a new month
    moves both sides of the comparison with no timer and no second clock here.
  */
  const comparison = useMemo(() => compareFinanceMonths(ledger, month), [ledger, month]);

  if (finance.loading) {
    return <ModuleLoadingState />;
  }

  if (finance.fault === 'corrupt-data') {
    /*
      Quarantine, stated plainly. #92 keeps the stored bytes untouched, and this copy says so rather
      than offering a retry that would look like it might repair something.
    */
    return (
      <ModuleErrorState
        title="Your Finance records could not be read"
        body="They have been left exactly as they are on this device. Nothing was changed or deleted."
        retryLabel="Try again"
        onRetry={() => void finance.reload()}
        testID="finance-spending-corrupt"
      />
    );
  }

  if (finance.fault === 'storage-unavailable') {
    return (
      <ModuleErrorState
        onRetry={() => void finance.reload()}
        testID="finance-spending-unavailable"
      />
    );
  }

  if (ledger.currency === null || changingCurrency) {
    return (
      <CurrencySetup
        query={currencyQuery}
        onQuery={setCurrencyQuery}
        onSelect={async (code) => {
          if (savingRef.current) {
            return;
          }
          savingRef.current = true;
          setSaving(true);
          const result = await finance.setCurrency(code);
          savingRef.current = false;
          setSaving(false);
          if (result.kind === 'ok') {
            setChangingCurrency(false);
            return;
          }
          /*
            #92 refuses a change once a transaction exists. The button that opens this picker is
            withdrawn in that case, so reaching here means the ledger changed underneath — say so
            and put the picker away rather than leaving it open over a refusal.
          */
          setChangingCurrency(false);
          setMessage('That currency could not be set.');
        }}
        onCancel={ledger.currency === null ? null : () => setChangingCurrency(false)}
        busy={saving}
      />
    );
  }

  const currency = ledger.currency;
  const money = financeMoney(currency, locale);

  function clearComposer(): void {
    setRecordKind('expense');
    setAmount('');
    setCategory('');
    setNote('');
    setOccurredOn(today);
    setEditing(null);
  }

  async function submit(): Promise<void> {
    /*
      The duplicate-submit guard. A second tap while the first write is in flight would create a
      second record of the same spend — and on a ledger that is a real, silent data defect, not a
      cosmetic one.
    */
    if (savingRef.current) {
      return;
    }
    const parsed = money.parse(amount);
    if (parsed.kind !== 'ok') {
      setMessage(AMOUNT_MESSAGE[parsed.reason] ?? 'That amount could not be read.');
      return;
    }

    savingRef.current = true;
    setSaving(true);
    const draft = {
      ...composerFields(recordKind),
      amountMinor: parsed.minor,
      occurredOn,
      category: category.trim() === '' ? null : category.trim(),
      note: note.trim() === '' ? null : note.trim(),
    };
    const result =
      editing === null
        ? await finance.createTransaction(draft)
        : await finance.updateTransaction(editing.id, draft);
    savingRef.current = false;
    setSaving(false);

    if (result.kind === 'ok') {
      setMessage(editing === null ? 'Transaction saved' : 'Changes saved');
      clearComposer();
      setComposerOpen(false);
      return;
    }
    setMessage(
      result.kind === 'invalid'
        ? (SAVE_FAULT_MESSAGE[result.fault] ?? 'That could not be saved.')
        : 'That could not be saved.',
    );
  }

  async function confirmRemoval(): Promise<void> {
    if (pendingRemoval === null || savingRef.current) {
      return;
    }
    savingRef.current = true;
    setSaving(true);
    const result = await finance.removeTransaction(pendingRemoval.id);
    savingRef.current = false;
    setSaving(false);
    setPendingRemoval(null);
    setMessage(result.kind === 'ok' ? 'Transaction deleted' : 'That could not be deleted.');
  }

  /*
    Four different kinds of nothing, and they are not interchangeable. "You have not started" and
    "August was quiet" and "your filters exclude everything" are three different facts about the
    user's money, and showing the first when the third is true would be a lie about their records.
  */
  const emptyReason =
    ledger.transactions.length === 0
      ? {
          title: 'Nothing recorded yet',
          body: 'Add what you spent or received. Everything stays on this device.',
        }
      : filtering
        ? {
            title: 'Nothing matches these filters',
            body: 'Your entries are still here. Clear the filters to see them again.',
          }
        : {
            title: `Nothing recorded in ${formatMonth(month)}`,
            body: 'Your other entries are still here. Step to another month to see them.',
          };

  return (
    <View style={{ rowGap: dp(moduleLayout.sectionGap) }}>
      {message === null ? null : (
        <ModuleStatusBanner
          tone="info"
          message={message}
          onDismiss={() => setMessage(null)}
          testID="finance-spending-message"
        />
      )}

      <ModuleSection title="Your ledger" testID="finance-spending-ledger">
        <ModuleCard testID="finance-spending-currency-card">
          <View style={{ rowGap: dp(6) }}>
            <ModuleText token="cardTitle" accessibilityRole="header">
              {`${FINANCE_CURRENCY_NAMES[currency]} (${currency})`}
            </ModuleText>
            {/*
              The lock now counts budgets as well as transactions — issue #94.

              #92's reason applies to both without change: there is no honest conversion, so the
              change is offered exactly while it costs nothing. A budget is an amount of money in
              this currency, and a ledger with no transactions but a 600.00 grocery budget must not
              be allowed to reinterpret that as 600 yen. The copy names whichever records are
              holding it, so "why can I not change this" always has an answer on screen.
            */}
            <ModuleText token="caption" color={moduleNeutrals.textSecondary}>
              {finance.canChangeCurrency
                ? 'You can still change this. Once you record a transaction or set a budget it is fixed, because past amounts cannot be honestly relabelled.'
                : ledger.transactions.length > 0
                  ? 'Fixed now that you have recorded a transaction — past amounts cannot be honestly relabelled. Delete every entry to change it.'
                  : 'Fixed now that you have set a budget — a budgeted amount cannot be honestly relabelled. Delete every budget to change it.'}
            </ModuleText>
            {finance.canChangeCurrency ? (
              <ModuleButton
                label="Change currency"
                variant="tertiary"
                fullWidth={false}
                onPress={() => {
                  setCurrencyQuery('');
                  setChangingCurrency(true);
                }}
                testID="finance-change-currency"
              />
            ) : null}
          </View>
        </ModuleCard>
      </ModuleSection>

      {composerOpen || editing !== null ? (
        <ModuleCard tinted accentBorder testID="finance-composer">
          <View style={{ rowGap: dp(10) }}>
            <ModuleText token="cardTitle" accessibilityRole="header">
              {editing === null ? 'Add a transaction' : 'Edit transaction'}
            </ModuleText>

            <FinanceChoiceRow
              label="What this is"
              choices={[
                { key: 'expense', label: 'Expense' },
                { key: 'income', label: 'Income' },
                { key: 'refund', label: 'Refund' },
              ]}
              selected={recordKind}
              onSelect={(value) => setRecordKind(value as ComposerKind)}
              testID="finance-direction"
            />

            {recordKind === 'refund' ? (
              <ModuleText
                token="caption"
                color={moduleNeutrals.textSecondary}
                testID="finance-refund-explainer"
              >
                A refund reduces what you have recorded spending — in the month, in the category and
                against any budget for it. It is not counted as income.
              </ModuleText>
            ) : null}

            <Field
              value={amount}
              onChangeText={setAmount}
              placeholder={`Amount in ${currency}`}
              label={`Amount in ${currency}`}
              keyboardType="decimal-pad"
              testID="finance-amount"
            />
            <Field
              value={occurredOn}
              onChangeText={setOccurredOn}
              placeholder="YYYY-MM-DD"
              label="Date"
              testID="finance-date"
            />
            <Field
              value={category}
              onChangeText={setCategory}
              placeholder="Category (optional)"
              label="Category"
              maxLength={40}
              testID="finance-category"
            />
            <Field
              value={note}
              onChangeText={setNote}
              placeholder="Note (optional)"
              label="Note"
              maxLength={280}
              testID="finance-note"
            />

            <ModuleButton
              label={editing === null ? 'Save transaction' : 'Save changes'}
              onPress={() => void submit()}
              loading={saving}
              disabled={saving}
              testID="finance-save"
            />
            <ModuleButton
              label="Cancel"
              variant="tertiary"
              onPress={() => {
                clearComposer();
                setComposerOpen(false);
              }}
              testID="finance-cancel"
            />
          </View>
        </ModuleCard>
      ) : (
        <ModuleButton
          label="Add a transaction"
          onPress={() => setComposerOpen(true)}
          testID="finance-open-composer"
        />
      )}

      {pendingRemoval === null ? null : (
        <ModuleCard accentBorder testID="finance-removal-confirmation">
          <View style={{ rowGap: dp(8) }}>
            <ModuleText token="cardTitle" accessibilityRole="header">
              Delete this transaction?
            </ModuleText>
            <ModuleText token="caption" color={moduleNeutrals.textSecondary}>
              {`${money.amount(pendingRemoval.amountMinor)} will be permanently removed. This cannot be undone.`}
            </ModuleText>
            <ModuleButton
              label="Delete transaction"
              onPress={() => void confirmRemoval()}
              disabled={saving}
              testID="finance-confirm-delete"
            />
            <ModuleButton
              label="Keep transaction"
              variant="tertiary"
              onPress={() => setPendingRemoval(null)}
              testID="finance-cancel-delete"
            />
          </View>
        </ModuleCard>
      )}

      <ModuleSection title="This month" testID="finance-month">
        <ModuleCard testID="finance-month-card">
          <View style={{ rowGap: dp(10) }}>
            <View style={[styles.row, styles.spread, { columnGap: dp(8) }]}>
              <StepButton
                label="Previous month"
                glyph="‹"
                disabled={ranging || !canStepBack(month, bounds)}
                onPress={() => goToMonth(previousMonth(month))}
                testID="finance-month-previous"
              />
              <ModuleText token="cardTitle" accessibilityRole="header" testID="finance-month-label">
                {formatMonth(month)}
              </ModuleText>
              <StepButton
                label="Next month"
                glyph="›"
                disabled={ranging || !canStepForward(month, bounds)}
                onPress={() => goToMonth(nextMonth(month))}
                testID="finance-month-next"
              />
            </View>

            {ranging ? (
              <ModuleText
                token="caption"
                color={moduleNeutrals.textSecondary}
                testID="finance-month-superseded"
              >
                {`A date range is in force, so these figures cover it instead of ${formatMonth(month)}. Clear it to go back to months.`}
              </ModuleText>
            ) : null}

            {/*
              Totals for whatever is in scope, derived on every read. Nothing here is stored, so no
              figure can disagree with the records it adds up.
            */}
            <ModuleText token="caption" color={moduleNeutrals.textSecondary}>
              {`${totals.count} ${totals.count === 1 ? 'entry' : 'entries'}`}
            </ModuleText>
            <View style={{ rowGap: dp(4) }} testID="finance-month-totals">
              <Total
                label="Received"
                minor={totals.incomeMinor}
                currency={currency}
                testID="finance-total-income"
              />
              <Total
                label="Spent"
                minor={totals.expenseMinor}
                currency={currency}
                testID="finance-total-expense"
              />
              <Total
                label="Net"
                minor={totals.netMinor}
                currency={currency}
                testID="finance-total-net"
                signed
              />
            </View>
          </View>
        </ModuleCard>
      </ModuleSection>

      <MonthComparison comparison={comparison} currency={currency} />

      <Filters
        filters={filters}
        categories={categories}
        onChange={setFilters}
        testID="finance-filters"
      />

      <ModuleSection
        title={
          ranging
            ? `Selected range (${visible.length})`
            : `${formatMonth(month)} (${visible.length})`
        }
        testID="finance-list"
      >
        {groups.length === 0 ? (
          <ModuleCard testID="finance-empty">
            <View style={{ rowGap: dp(6) }}>
              <ModuleText token="cardTitle" accessibilityRole="header">
                {emptyReason.title}
              </ModuleText>
              <ModuleText token="caption" color={moduleNeutrals.textSecondary}>
                {emptyReason.body}
              </ModuleText>
            </View>
          </ModuleCard>
        ) : (
          <View style={{ rowGap: dp(10) }}>
            {groups.map((group) => (
              <View key={group.day} style={{ rowGap: dp(6) }} testID={`finance-day-${group.day}`}>
                <ModuleText token="caption" color={moduleNeutrals.textSecondary}>
                  {group.day === today ? `Today · ${group.day}` : group.day}
                </ModuleText>
                {group.transactions.map((transaction) => (
                  <ModuleCard key={transaction.id} testID={`finance-row-${transaction.id}`}>
                    <View style={{ rowGap: dp(6) }}>
                      <View style={[styles.row, { columnGap: dp(8) }]}>
                        {/*
                          What the record *is*, as a word rather than only a colour — two hues alone
                          would leave a colour-blind reader unable to tell a refund from a purchase.

                          A savings transfer says so here instead of reading "Expense", which is what
                          made it indistinguishable from a purchase before the cross-feature audit.
                          It is still listed, and still counted in the row count above; it is simply
                          no longer described as money spent, and the totals no longer add it.
                        */}
                        <ModuleText
                          token="caption"
                          color={theme.ink}
                          testID={`finance-kind-${transaction.id}`}
                        >
                          {isSavingsTransfer(transaction)
                            ? savingsTransferLabel(transaction)
                            : isRefund(transaction)
                              ? 'Refund'
                              : transaction.direction === 'expense'
                                ? 'Expense'
                                : 'Income'}
                        </ModuleText>
                        <ModuleText token="cardTitle">
                          {money.amount(transaction.amountMinor)}
                        </ModuleText>
                      </View>
                      {[savingsDetail(transaction), transaction.category, transaction.note].filter(
                        Boolean,
                      ).length === 0 ? null : (
                        <ModuleText token="caption" color={moduleNeutrals.textSecondary}>
                          {[savingsDetail(transaction), transaction.category, transaction.note]
                            .filter(Boolean)
                            .join(' · ')}
                        </ModuleText>
                      )}
                      <View style={[styles.row, { columnGap: dp(8) }]}>
                        <ModuleButton
                          label="Edit"
                          variant="tertiary"
                          fullWidth={false}
                          onPress={() => {
                            setEditing(transaction);
                            setComposerOpen(true);
                            setRecordKind(composerKindOf(transaction));
                            setAmount(money.plain(transaction.amountMinor));
                            setCategory(transaction.category ?? '');
                            setNote(transaction.note ?? '');
                            setOccurredOn(transaction.occurredOn);
                          }}
                          testID={`finance-edit-${transaction.id}`}
                        />
                        <ModuleButton
                          label="Delete"
                          variant="tertiary"
                          fullWidth={false}
                          onPress={() => setPendingRemoval(transaction)}
                          testID={`finance-delete-${transaction.id}`}
                        />
                      </View>
                    </View>
                  </ModuleCard>
                ))}
              </View>
            ))}
          </View>
        )}
      </ModuleSection>

      <View
        style={{ height: 1, backgroundColor: surfaces.divider }}
        accessible={false}
        testID="finance-list-rule"
      />
    </View>
  );
}

/**
 * What the composer offers, and how each choice lands in the two stored fields — issue #96.
 *
 * A refund is an expense whose `kind` says money came back, so the user picks one thing and the
 * mapping happens once, here. Offering "Refund" as a *direction* would have made it a third way for
 * money to move, which is exactly what #96 says it is not.
 */
type ComposerKind = 'expense' | 'income' | 'refund';

function composerFields(kind: ComposerKind): {
  readonly direction: FinanceDirection;
  readonly kind: 'ordinary' | 'refund';
} {
  switch (kind) {
    case 'expense':
      return { direction: 'expense', kind: 'ordinary' };
    case 'income':
      return { direction: 'income', kind: 'ordinary' };
    case 'refund':
      return { direction: 'expense', kind: 'refund' };
  }
}

/** Which choice an existing record corresponds to, so editing opens on the truth. */
function composerKindOf(transaction: FinanceTransaction): ComposerKind {
  if (isRefund(transaction)) {
    return 'refund';
  }
  return transaction.direction === 'expense' ? 'expense' : 'income';
}

/**
 * The refusals a caller can actually act on.
 *
 * The two refund faults are unreachable from this composer — it never builds a refund that is also
 * income or a savings transfer — but they are the domain's guards, and a refusal a user could ever
 * see should say what happened rather than shrug.
 */
const SAVE_FAULT_MESSAGE: Record<string, string> = {
  'refund-must-be-expense': 'A refund reduces spending, so it cannot be recorded as income.',
  'refund-cannot-be-savings': 'A savings contribution cannot also be a refund.',
  'unknown-goal': 'That savings goal no longer exists.',
};

const AMOUNT_MESSAGE: Record<string, string> = {
  empty: 'Enter an amount.',
  malformed: 'Enter digits and at most one decimal point.',
  'too-precise': 'That is more decimal places than this currency has.',
  'not-positive': 'Enter an amount greater than zero.',
  'too-large': 'That amount is larger than this ledger can hold.',
};

function CurrencySetup({
  query,
  onQuery,
  onSelect,
  onCancel,
  busy,
}: {
  readonly query: string;
  readonly onQuery: (value: string) => void;
  readonly onSelect: (code: string) => void;
  /** `null` on first setup: there is no configured currency to go back to. */
  readonly onCancel: (() => void) | null;
  readonly busy: boolean;
}) {
  const { dp } = useModuleMetrics();
  const options = useMemo(() => searchCurrencies(query), [query]);

  return (
    <View style={{ rowGap: dp(moduleLayout.sectionGap) }} testID="finance-currency-setup">
      <ModuleCard tinted accentBorder testID="finance-currency-intro">
        <View style={{ rowGap: dp(6) }}>
          <ModuleText token="cardTitle" accessibilityRole="header">
            Choose your currency
          </ModuleText>
          <ModuleText token="caption" color={moduleNeutrals.textSecondary}>
            Every amount you record will be in this currency. NoorLife does not guess it from your
            phone, and you can change it until you record your first transaction.
          </ModuleText>
        </View>
      </ModuleCard>

      <Field
        value={query}
        onChangeText={onQuery}
        placeholder="Search by code or name"
        label="Search currencies"
        testID="finance-currency-search"
      />

      <View style={{ rowGap: dp(6) }}>
        {options.length === 0 ? (
          <ModuleCard testID="finance-currency-none">
            <ModuleText token="caption" color={moduleNeutrals.textSecondary}>
              No currency matches that search.
            </ModuleText>
          </ModuleCard>
        ) : (
          options.map((option) => (
            <ModuleButton
              key={option.code}
              label={`${option.code} — ${option.name}`}
              variant="tertiary"
              disabled={busy}
              onPress={() => onSelect(option.code)}
              testID={`finance-currency-${option.code}`}
            />
          ))
        )}
      </View>

      {onCancel === null ? null : (
        <ModuleButton
          label="Keep current currency"
          variant="tertiary"
          onPress={onCancel}
          testID="finance-currency-cancel"
        />
      )}
    </View>
  );
}

function Filters({
  filters,
  categories,
  onChange,
  testID,
}: {
  readonly filters: FinanceFilters;
  readonly categories: readonly string[];
  readonly onChange: (next: FinanceFilters) => void;
  readonly testID: string;
}) {
  const { dp } = useModuleMetrics();
  const active = hasActiveFilters(filters);

  return (
    <ModuleSection
      title="Filter"
      subtitle="A date range replaces the month above. A category narrows whichever is in force."
      testID={testID}
    >
      <ModuleCard>
        <View style={{ rowGap: dp(10) }}>
          <FinanceChoiceRow
            label="Category"
            choices={[
              { key: '', label: 'All' },
              ...categories.map((name) => ({ key: name, label: name })),
            ]}
            selected={filters.category ?? ''}
            onSelect={(value) => onChange({ ...filters, category: value === '' ? null : value })}
            testID={`${testID}-category`}
          />
          <Field
            value={filters.from ?? ''}
            onChangeText={(value) => onChange({ ...filters, from: value === '' ? null : value })}
            placeholder="From (YYYY-MM-DD)"
            label="From date"
            testID={`${testID}-from`}
          />
          <Field
            value={filters.to ?? ''}
            onChangeText={(value) => onChange({ ...filters, to: value === '' ? null : value })}
            placeholder="To (YYYY-MM-DD)"
            label="To date"
            testID={`${testID}-to`}
          />
          {active ? (
            <ModuleButton
              label={
                hasCustomRange(filters) ? 'Clear filters and return to months' : 'Clear filters'
              }
              variant="tertiary"
              onPress={() => onChange(NO_FINANCE_FILTERS)}
              testID={`${testID}-clear`}
            />
          ) : null}
          {normaliseRange(filters).from !== filters.from ? (
            <ModuleText token="caption" color={moduleNeutrals.textSecondary}>
              Those dates were the other way round, so they have been read as a range.
            </ModuleText>
          ) : null}
        </View>
      </ModuleCard>
    </ModuleSection>
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
    <AppTextInput
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

/**
 * One month backwards or forwards.
 *
 * Disabled rather than hidden at a bound, so the control does not move under the thumb as the ledger
 * grows — and disabled state is announced, because a button that silently does nothing is worse than
 * one that says why it cannot.
 */
function StepButton({
  label,
  glyph,
  disabled,
  onPress,
  testID,
}: {
  readonly label: string;
  readonly glyph: string;
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
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      style={[
        styles.choice,
        {
          /* The accessibility minimum, unscaled — a bound, not a dimension. */
          minHeight: minimumTouchTargetSize(),
          minWidth: minimumTouchTargetSize(),
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
        {glyph}
      </ModuleText>
    </Pressable>
  );
}

/**
 * One derived figure, labelled.
 *
 * The net carries an explicit sign rather than a colour, because "you spent more than you received"
 * has to survive a colour-blind reader and a greyscale screenshot. Nothing here is judgemental: a
 * negative month is stated, not scored.
 */
function Total({
  label,
  minor,
  currency,
  testID,
  signed = false,
}: {
  readonly label: string;
  readonly minor: number;
  readonly currency: FinanceCurrency;
  readonly testID: string;
  readonly signed?: boolean;
}) {
  const { dp } = useModuleMetrics();
  const money = financeMoney(currency, useFinanceLocale());
  /*
    `signed` prefixes an explicit direction onto a magnitude — that is the net row, where "+" and
    "−" are the point. Everything else renders the value **as it is**, because since #96 a spending
    total can legitimately be negative: a month refunded more than it spent. Passing that through
    `Math.abs` printed 150.00 of spending that never happened, which is the one thing a money screen
    must never do. The formatter carries its own sign, so unsigned rows simply do not intervene.
  */
  const text =
    signed && minor !== 0
      ? `${minor < 0 ? '−' : '+'}${money.amount(Math.abs(minor))}`
      : money.amount(minor);
  return (
    <View
      style={[styles.row, styles.spread, { columnGap: dp(8) }]}
      accessibilityLabel={`${label}, ${text}`}
      accessible
      testID={testID}
    >
      <ModuleText token="caption" color={moduleNeutrals.textSecondary}>
        {label}
      </ModuleText>
      <ModuleText token="cardTitle">{text}</ModuleText>
    </View>
  );
}

/**
 * **This month set against the one before it** — issue #102.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── It does no arithmetic ──────────────────────────────────────────────────
 * Every figure arrives already derived. A component that recomputed a total would be a second
 * implementation to disagree with the first, which is the same reason nothing here is stored.
 *
 * ── Both months are named, and both totals are shown ───────────────────────
 * The heading names the pair, each row states this month's figure, and each row restates last
 * month's beneath it. A comparison that showed only a delta would leave the reader unable to check
 * it — and the month names are spelled out rather than implied by position, because "last month" is
 * ambiguous the moment somebody steps the stepper backwards.
 *
 * ── Direction survives greyscale ───────────────────────────────────────────
 * Nothing in this section is coloured by direction. The glyph takes the module's own ink, exactly as
 * every other accent on the screen does, and the direction is carried by the words "more", "less",
 * "higher", "lower" and "the same". A colour-blind reader and a greyscale screenshot get the same
 * information as everybody else, which is #93's rule for the signed net applied again.
 *
 * ── The section is not withdrawn when a date range is in force ─────────────
 * The figures above it switch to the range; these do not, and cannot — they are about calendar
 * months. That is why the heading names them. Withdrawing the section instead would make a filter
 * look as though it had changed the user's monthly record.
 * ═══════════════════════════════════════════════════════════════════════════
 */
function MonthComparison({
  comparison,
  currency,
}: {
  readonly comparison: FinanceMonthComparison;
  readonly currency: FinanceCurrency;
}) {
  const { dp } = useModuleMetrics();
  const previousName = formatMonth(comparison.previous);
  const showCategories = comparison.categories.length > 0 || comparison.unchangedCategoryCount > 0;

  return (
    <ModuleSection
      title={`${formatMonth(comparison.month)} compared with ${previousName}`}
      subtitle="Every figure is worked out from your records each time this screen opens. Filters below do not change it."
      testID="finance-comparison"
    >
      <ModuleCard testID="finance-comparison-card">
        <View style={{ rowGap: dp(12) }}>
          <ChangeRow
            label={`Spent in ${formatMonth(comparison.month)}`}
            change={comparison.spending}
            subject={SPENDING_SUBJECT}
            currency={currency}
            previous={comparison.previous}
            previousLabel={`Spent in ${previousName}`}
            testID="finance-comparison-spending"
          />
          <ChangeRow
            label={`Received in ${formatMonth(comparison.month)}`}
            change={comparison.income}
            subject={INCOME_SUBJECT}
            currency={currency}
            previous={comparison.previous}
            previousLabel={`Received in ${previousName}`}
            testID="finance-comparison-income"
          />
          <ChangeRow
            label={`Net in ${formatMonth(comparison.month)}`}
            change={comparison.net}
            subject={NET_SUBJECT}
            currency={currency}
            previous={comparison.previous}
            previousLabel={`Net in ${previousName}`}
            signed
            testID="finance-comparison-net"
          />

          {showCategories ? (
            <View style={{ rowGap: dp(6) }} testID="finance-comparison-categories">
              <ModuleText token="caption" color={moduleNeutrals.textSecondary}>
                {comparison.categories.length === 0
                  ? 'No category of spending moved between these months.'
                  : 'Spending by category, largest movement first'}
              </ModuleText>
              {comparison.categories.map((entry) => (
                <CategoryRow
                  /*
                    A U+0000 prefix, written as an escape rather than a raw byte — issue #116.

                    The sentinel keys the one uncategorised row so it cannot collide with a real
                    category literally named `uncategorised`. That is worth keeping; the raw byte was
                    not. A NUL in the file made every standard source tool classify this TypeScript
                    as binary, so `grep` skipped it — which is how the undersized filter chips below
                    survived an audit that was looking for exactly them.

                    `\u0000` produces the identical string, so the key, its uniqueness and the row
                    order are unchanged.
                  */
                  key={entry.category ?? '\u0000uncategorised'}
                  entry={entry}
                  currency={currency}
                />
              ))}
              {comparison.unchangedCategoryCount === 0 ? null : (
                <ModuleText token="caption" color={moduleNeutrals.textSecondary}>
                  {`${comparison.unchangedCategoryCount} ${comparison.unchangedCategoryCount === 1 ? 'category was' : 'categories were'} exactly the same in both months.`}
                </ModuleText>
              )}
            </View>
          ) : null}
        </View>
      </ModuleCard>
    </ModuleSection>
  );
}

/**
 * One compared figure: this month's total, how it moved, and last month's total beneath it.
 *
 * The whole row is one accessible node with one composed label, so a screen reader states the
 * comparison as a sentence rather than reading four fragments the listener has to reassemble. The
 * percentage is absent from that label in exactly the states where it is absent from the screen.
 */
function ChangeRow({
  label,
  change,
  subject,
  currency,
  previous,
  previousLabel,
  signed = false,
  testID,
}: {
  readonly label: string;
  readonly change: FinanceChange;
  readonly subject: ComparisonSubject;
  readonly currency: FinanceCurrency;
  readonly previous: FinanceMonth;
  readonly previousLabel: string;
  readonly signed?: boolean;
  readonly testID: string;
}) {
  const theme = useModuleTheme();
  const { dp } = useModuleMetrics();
  const money = financeMoney(currency, useFinanceLocale());
  const phrasing = describeChange(change, subject, currency, previous, money.locale);

  /* Same rule as the totals row: only the signed variant strips and re-applies the sign. */
  const present = (minor: number): string =>
    signed && minor !== 0
      ? `${minor < 0 ? '−' : '+'}${money.amount(Math.abs(minor))}`
      : money.amount(minor);
  const current = present(change.currentMinor);
  const prior = present(change.previousMinor);

  return (
    <View
      style={{ rowGap: dp(4) }}
      accessible
      accessibilityLabel={`${announceChange(`${label}, ${current}`, phrasing)}. ${previousLabel}, ${prior}.`}
      testID={testID}
    >
      <View style={[styles.row, styles.spread, { columnGap: dp(8) }]}>
        <ModuleText token="caption" color={moduleNeutrals.textSecondary} style={styles.grow}>
          {label}
        </ModuleText>
        <ModuleText token="cardTitle">{current}</ModuleText>
      </View>
      <View style={[styles.row, { columnGap: dp(6) }]}>
        {/*
          Decoration beside the wording, never instead of it. It takes the module's ink like every
          other accent here, so no reader has to distinguish two hues to know which way this went.
        */}
        <ModuleText token="caption" color={theme.ink}>
          {phrasing.glyph}
        </ModuleText>
        <ModuleText token="caption" color={moduleNeutrals.textSecondary} style={styles.grow}>
          {phrasing.percent === null
            ? phrasing.sentence
            : `${phrasing.sentence} · ${phrasing.percent}`}
        </ModuleText>
      </View>
      <View style={[styles.row, styles.spread, { columnGap: dp(8) }]}>
        <ModuleText token="caption" color={moduleNeutrals.textTertiary} style={styles.grow}>
          {previousLabel}
        </ModuleText>
        <ModuleText token="caption" color={moduleNeutrals.textTertiary}>
          {prior}
        </ModuleText>
      </View>
    </View>
  );
}

/**
 * One category's movement.
 *
 * Transactions filed without a category are shown as "Uncategorised" rather than dropped: money the
 * user did not label is still money they spent, and omitting it would make the category rows fail to
 * add up to the month.
 */
function CategoryRow({
  entry,
  currency,
}: {
  readonly entry: FinanceCategoryChange;
  readonly currency: FinanceCurrency;
}) {
  const theme = useModuleTheme();
  const { dp } = useModuleMetrics();
  const phrasing = describeMovement(entry.change, SPENDING_SUBJECT, currency);
  const name = entry.category ?? 'Uncategorised';
  const detail =
    phrasing.percent === null ? phrasing.sentence : `${phrasing.sentence} · ${phrasing.percent}`;

  return (
    <View
      style={[styles.row, styles.spread, { columnGap: dp(8) }]}
      accessible
      accessibilityLabel={`${name}, ${detail}`}
      testID={`finance-comparison-category-${name}`}
    >
      <ModuleText token="caption" color={moduleNeutrals.textSecondary} style={styles.grow}>
        {name}
      </ModuleText>
      <View style={[styles.row, { columnGap: dp(6) }]}>
        <ModuleText token="caption" color={theme.ink}>
          {phrasing.glyph}
        </ModuleText>
        <ModuleText token="caption">{detail}</ModuleText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  input: { borderWidth: 1 },
  grow: { flexShrink: 1 },
  row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
  spread: { justifyContent: 'space-between' },
  choice: { alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
});
