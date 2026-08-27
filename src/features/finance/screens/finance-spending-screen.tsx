import { useLocalSearchParams } from 'expo-router';
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

import {
  FINANCE_CURRENCY_NAMES,
  formatAmount,
  formatMinor,
  parseAmountToMinor,
  searchCurrencies,
} from '../data/finance-format';
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

  const [direction, setDirection] = useState<FinanceDirection>('expense');
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

  const ledger = finance.ledger;
  const categories = useMemo(() => financeCategories(ledger), [ledger]);

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

  function clearComposer(): void {
    setDirection('expense');
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
    const parsed = parseAmountToMinor(amount, currency);
    if (parsed.kind !== 'ok') {
      setMessage(AMOUNT_MESSAGE[parsed.reason] ?? 'That amount could not be read.');
      return;
    }

    savingRef.current = true;
    setSaving(true);
    const draft = {
      direction,
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
    setMessage('That could not be saved.');
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
            <ModuleText token="caption" color={moduleNeutrals.textSecondary}>
              {ledger.transactions.length === 0
                ? 'You can still change this. Once you record a transaction it is fixed, because past amounts cannot be honestly relabelled.'
                : 'Fixed now that you have recorded a transaction — past amounts cannot be honestly relabelled. Delete every entry to change it.'}
            </ModuleText>
            {ledger.transactions.length === 0 ? (
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

            <ChoiceRow
              label="Direction"
              choices={[
                { key: 'expense', label: 'Expense' },
                { key: 'income', label: 'Income' },
              ]}
              selected={direction}
              onSelect={(value) => setDirection(value as FinanceDirection)}
              testID="finance-direction"
            />

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
              {`${formatAmount(pendingRemoval.amountMinor, currency)} will be permanently removed. This cannot be undone.`}
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
                          The direction is a word, not only a colour. Two hues alone would leave a
                          colour-blind reader unable to tell a refund from a purchase.
                        */}
                        <ModuleText token="caption" color={theme.ink}>
                          {transaction.direction === 'expense' ? 'Expense' : 'Income'}
                        </ModuleText>
                        <ModuleText token="cardTitle">
                          {formatAmount(transaction.amountMinor, currency)}
                        </ModuleText>
                      </View>
                      {transaction.category === null && transaction.note === null ? null : (
                        <ModuleText token="caption" color={moduleNeutrals.textSecondary}>
                          {[transaction.category, transaction.note].filter(Boolean).join(' · ')}
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
                            setDirection(transaction.direction);
                            setAmount(formatMinor(transaction.amountMinor, currency));
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
          <ChoiceRow
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

function ChoiceRow({
  label,
  choices,
  selected,
  onSelect,
  testID,
}: {
  readonly label: string;
  readonly choices: readonly { readonly key: string; readonly label: string }[];
  readonly selected: string;
  readonly onSelect: (value: string) => void;
  readonly testID: string;
}) {
  const theme = useModuleTheme();
  const surfaces = useModuleSurfaces();
  const { dp } = useModuleMetrics();
  return (
    <View style={{ rowGap: dp(6) }} testID={testID}>
      <ModuleText token="caption" color={moduleNeutrals.textSecondary}>
        {label}
      </ModuleText>
      <View style={[styles.choices, { gap: dp(6) }]}>
        {choices.map((choice) => {
          const isActive = selected === choice.key;
          return (
            <Pressable
              key={choice.key}
              onPress={() => onSelect(choice.key)}
              accessibilityRole="radio"
              accessibilityState={{ selected: isActive }}
              accessibilityLabel={`${label}: ${choice.label}`}
              style={[
                styles.choice,
                {
                  /* The accessibility minimum, unscaled — it is a bound, not a dimension. */
                  minHeight: moduleLayout.minTouchTarget,
                  borderRadius: dp(12),
                  borderColor: isActive ? theme.ink : surfaces.border,
                  backgroundColor: isActive ? surfaces.well : surfaces.card,
                  paddingHorizontal: dp(10),
                },
              ]}
              testID={`${testID}-${choice.key || 'all'}`}
            >
              <ModuleText
                token="button"
                color={isActive ? theme.ink : moduleNeutrals.textSecondary}
              >
                {choice.label}
              </ModuleText>
            </Pressable>
          );
        })}
      </View>
    </View>
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
          minHeight: moduleLayout.minTouchTarget,
          minWidth: moduleLayout.minTouchTarget,
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
  const magnitude = formatAmount(Math.abs(minor), currency);
  const text = signed && minor !== 0 ? `${minor < 0 ? '−' : '+'}${magnitude}` : magnitude;
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

const styles = StyleSheet.create({
  input: { borderWidth: 1 },
  row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
  spread: { justifyContent: 'space-between' },
  choices: { flexDirection: 'row', flexWrap: 'wrap' },
  choice: { alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
});
