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

import { formatPercentTenths } from '../data/finance-comparison-copy';
import { formatAmount, formatMinor, parseAmountToMinor } from '../data/finance-format';
import type { FinanceGoal } from '../data/finance-goal';
import {
  contributionsForGoal,
  goalsProgress,
  targetDateStanding,
  type FinanceGoalProgress,
} from '../data/finance-goal-progress';
import type { FinanceTransaction } from '../data/finance-ledger';
import type { FinanceCurrency } from '../data/finance-money';
import { useFinance } from '../di/finance-provider';

/**
 * **Savings — a target, and the contributions actually recorded against it** — issue #95.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── Nothing on this screen is stored ───────────────────────────────────────
 * The name, the target and the optional target date are the user's. Everything else — set aside,
 * remaining, above target, the percentage, the status, the contribution count — is computed from the
 * transactions on every read. #95: "progress derived from the ledger — an intent is stored, a total
 * never is". Editing a contribution rewrites no goal record; the next render simply reads a
 * different answer, and there is no synchronisation step that could leave a total contradicting the
 * money it claims to total.
 *
 * ── A contribution is a transaction, and the screen says so ────────────────
 * #95 makes the ledger the single record of money moved, so recording a contribution here creates a
 * transaction there. That has a visible consequence — the same amount appears in Spending — and the
 * screen discloses it in a sentence rather than letting somebody discover it and wonder which figure
 * is real. Both are real; there is one record, shown in two places.
 *
 * ── What it does not claim ─────────────────────────────────────────────────
 * No interest. No projected completion date. No "on track". No automatic transfer, and no reading of
 * a month's surplus as money saved. Nothing here says funds are held by NoorLife, that a bank is
 * connected, or that an amount is available to spend — because none of that is true, and #95 rules
 * every one of them out by name. A target date that has passed is stated as a date that has passed:
 * not a failure, not a warning, and nothing that changes the goal.
 *
 * The states are sentences, not colours. The bar repeats what the words already say, is hidden from
 * assistive technology, and takes the module's own ink — so a greyscale screenshot and a screen
 * reader both get the whole answer.
 *
 * ── One negative is possible, and it is not hidden ─────────────────────────
 * A user who records taking more back out than they put in has created a real state, and the screen
 * states it. It is never printed as a negative amount — `formatMinor` is an unsigned formatter and a
 * minus sign smuggled through it would render nonsense — so the sign is carried by the wording and
 * every figure handed to the formatter is a magnitude.
 * ═══════════════════════════════════════════════════════════════════════════
 */

export function FinanceSavingsScreen() {
  return (
    <ModuleScaffold moduleId="finance" activeKey="goals" title="Savings" testID="finance-savings">
      <SavingsBody />
    </ModuleScaffold>
  );
}

/** Split out so the hooks below read the module context the scaffold creates. */
function SavingsBody() {
  const finance = useFinance();
  const { dp } = useModuleMetrics();
  const { today } = usePlannerDay();

  const [editingGoal, setEditingGoal] = useState<FinanceGoal | null>(null);
  const [goalComposerOpen, setGoalComposerOpen] = useState(false);
  const [name, setName] = useState('');
  const [target, setTarget] = useState('');
  const [targetOn, setTargetOn] = useState('');
  const [pendingGoalRemoval, setPendingGoalRemoval] = useState<FinanceGoal | null>(null);

  /** Which goal's contributions are open. One at a time — a screen of every list is unreadable. */
  const [openGoalId, setOpenGoalId] = useState<string | null>(null);
  const [contributionComposerFor, setContributionComposerFor] = useState<string | null>(null);
  const [editingContribution, setEditingContribution] = useState<FinanceTransaction | null>(null);
  const [direction, setDirection] = useState<'expense' | 'income'>('expense');
  const [amount, setAmount] = useState('');
  const [occurredOn, setOccurredOn] = useState(today);
  const [note, setNote] = useState('');
  const [pendingContributionRemoval, setPendingContributionRemoval] =
    useState<FinanceTransaction | null>(null);

  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  /*
    The duplicate-submit guard is a ref, not the `saving` state — a real double tap delivers both
    presses inside one React batch, so the second handler still closes over `saving === false`.
    Budgets and Spending record the same reasoning; here the defect it prevents is a contribution
    counted twice, which would overstate somebody's savings by the amount they just entered.
  */
  const savingRef = useRef(false);

  const ledger = finance.ledger;
  /*
    Derived from the whole ledger, not from a filtered view of it. A goal measures deliberate
    transfers whenever they were recorded, so narrowing to a month first would report a slice of
    somebody's savings as the whole of it.
  */
  const view = useMemo(() => goalsProgress(ledger, finance.goals), [ledger, finance.goals]);

  if (finance.loading) {
    return <ModuleLoadingState />;
  }

  if (finance.fault === 'corrupt-data' || finance.goalFault === 'corrupt-data') {
    /*
      Quarantine, stated plainly, and it says *which* store so the user knows whether their
      transactions or their targets are the thing that could not be read. Neither was overwritten.
    */
    return (
      <ModuleErrorState
        title={
          finance.goalFault === 'corrupt-data'
            ? 'Your savings goals could not be read'
            : 'Your Finance records could not be read'
        }
        body="They have been left exactly as they are on this device. Nothing was changed or deleted."
        retryLabel="Try again"
        onRetry={() => void finance.reload()}
        testID="finance-savings-corrupt"
      />
    );
  }

  if (finance.fault === 'storage-unavailable' || finance.goalFault === 'storage-unavailable') {
    return (
      <ModuleErrorState
        onRetry={() => void finance.reload()}
        testID="finance-savings-unavailable"
      />
    );
  }

  if (ledger.currency === null) {
    /*
      A target is an amount of money, and this ledger has no currency yet. Rather than duplicating
      #93's picker, this points at the one that already exists — two currency-setup paths would be
      two places for the choice to be made differently.
    */
    return (
      <ModuleCard tinted accentBorder testID="finance-savings-no-currency">
        <View style={{ rowGap: dp(6) }}>
          <ModuleText token="cardTitle" accessibilityRole="header">
            Choose your currency first
          </ModuleText>
          <ModuleText token="caption" color={moduleNeutrals.textSecondary}>
            A savings target is an amount of money, so NoorLife needs to know which currency your
            records are in. Open Spending to choose it — it is not guessed from your phone.
          </ModuleText>
        </View>
      </ModuleCard>
    );
  }

  const currency = ledger.currency;

  function clearGoalComposer(): void {
    setName('');
    setTarget('');
    setTargetOn('');
    setEditingGoal(null);
  }

  function clearContributionComposer(): void {
    setAmount('');
    setNote('');
    setDirection('expense');
    setOccurredOn(today);
    setEditingContribution(null);
    setContributionComposerFor(null);
  }

  async function submitGoal(): Promise<void> {
    if (savingRef.current) {
      return;
    }
    const parsed = parseAmountToMinor(target, currency);
    if (parsed.kind !== 'ok') {
      setMessage(AMOUNT_MESSAGE[parsed.reason] ?? 'That amount could not be read.');
      return;
    }
    if (name.trim() === '') {
      setMessage('Name what you are saving for.');
      return;
    }

    savingRef.current = true;
    setSaving(true);
    const draft = {
      name: name.trim(),
      targetMinor: parsed.minor,
      /* Empty means no target date, which is the documented optional case — not a validation error. */
      targetOn: targetOn.trim() === '' ? null : targetOn.trim(),
    };
    const result =
      editingGoal === null
        ? await finance.createGoal(draft)
        : await finance.updateGoal(editingGoal.id, draft);
    savingRef.current = false;
    setSaving(false);

    if (result.kind === 'ok') {
      setMessage(editingGoal === null ? 'Goal saved' : 'Changes saved');
      clearGoalComposer();
      setGoalComposerOpen(false);
      return;
    }
    setMessage(
      result.kind === 'invalid'
        ? (GOAL_FAULT_MESSAGE[result.fault] ?? 'That could not be saved.')
        : 'That could not be saved.',
    );
  }

  async function confirmGoalRemoval(): Promise<void> {
    if (pendingGoalRemoval === null || savingRef.current) {
      return;
    }
    savingRef.current = true;
    setSaving(true);
    const removed = pendingGoalRemoval.id;
    const result = await finance.removeGoal(removed);
    savingRef.current = false;
    setSaving(false);
    setPendingGoalRemoval(null);
    if (result.kind === 'ok' && openGoalId === removed) {
      setOpenGoalId(null);
    }
    setMessage(
      result.kind === 'ok'
        ? 'Goal deleted. Its transactions are still in your ledger.'
        : 'That could not be deleted.',
    );
  }

  /**
   * Records a contribution, or a withdrawal, as a transaction attributed to the goal.
   *
   * One write, to one address, in one lane. There is no second store to keep in step — which is
   * exactly why attribution lives on the transaction rather than in a list beside the goal.
   */
  async function submitContribution(goalId: string): Promise<void> {
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
      occurredOn: occurredOn.trim(),
      category: null,
      note: note.trim() === '' ? null : note.trim(),
      /* Explicit on the edit path too, so a revise cannot detach the record from its goal. */
      goalId,
    };
    const result =
      editingContribution === null
        ? await finance.createTransaction(draft)
        : await finance.updateTransaction(editingContribution.id, draft);
    savingRef.current = false;
    setSaving(false);

    if (result.kind === 'ok') {
      setMessage(editingContribution === null ? 'Contribution recorded' : 'Changes saved');
      clearContributionComposer();
      return;
    }
    setMessage(
      result.kind === 'invalid'
        ? (TRANSACTION_FAULT_MESSAGE[result.fault] ?? 'That could not be saved.')
        : 'That could not be saved.',
    );
  }

  async function confirmContributionRemoval(): Promise<void> {
    if (pendingContributionRemoval === null || savingRef.current) {
      return;
    }
    savingRef.current = true;
    setSaving(true);
    const result = await finance.removeTransaction(pendingContributionRemoval.id);
    savingRef.current = false;
    setSaving(false);
    setPendingContributionRemoval(null);
    setMessage(result.kind === 'ok' ? 'Transaction deleted' : 'That could not be deleted.');
  }

  return (
    <View style={{ rowGap: dp(moduleLayout.sectionGap) }}>
      {message === null ? null : (
        <ModuleStatusBanner
          tone="info"
          message={message}
          onDismiss={() => setMessage(null)}
          testID="finance-savings-message"
        />
      )}

      <ModuleSection
        title="Savings goals"
        subtitle="Every figure is worked out from the contributions you have recorded, each time this screen opens."
        testID="finance-savings-section"
      >
        {view.entries.length === 0 ? (
          <ModuleCard testID="finance-savings-empty">
            <View style={{ rowGap: dp(6) }}>
              <ModuleText token="cardTitle" accessibilityRole="header">
                No savings goals
              </ModuleText>
              <ModuleText token="caption" color={moduleNeutrals.textSecondary}>
                Name what you are saving for and set a target. Progress comes only from money you
                record setting aside — nothing is counted for you, and no transfer is made.
              </ModuleText>
            </View>
          </ModuleCard>
        ) : (
          <View style={{ rowGap: dp(10) }}>
            {view.entries.map((entry) => (
              <GoalRow
                key={entry.goal.id}
                entry={entry}
                currency={currency}
                today={today}
                open={openGoalId === entry.goal.id}
                onToggle={() =>
                  setOpenGoalId((current) => {
                    const next = current === entry.goal.id ? null : entry.goal.id;
                    /* Closing a goal must not leave its composer open over another goal's list. */
                    clearContributionComposer();
                    return next;
                  })
                }
                onEdit={() => {
                  setEditingGoal(entry.goal);
                  setGoalComposerOpen(true);
                  setName(entry.goal.name);
                  setTarget(formatMinor(entry.goal.targetMinor, currency));
                  setTargetOn(entry.goal.targetOn ?? '');
                }}
                onDelete={() => setPendingGoalRemoval(entry.goal)}
              />
            ))}
          </View>
        )}
      </ModuleSection>

      {openGoalId === null
        ? null
        : (() => {
            const entry = view.entries.find((candidate) => candidate.goal.id === openGoalId);
            if (entry === undefined) {
              return null;
            }
            const contributions = contributionsForGoal(ledger, entry.goal.id);
            return (
              <ModuleSection
                title={`Contributions to ${entry.goal.name}`}
                subtitle="Each one is a transaction in your ledger, so it appears in Spending as well. There is one record, shown in two places."
                testID="finance-savings-contributions"
              >
                <View style={{ rowGap: dp(10) }}>
                  {contributions.length === 0 ? (
                    <ModuleCard testID="finance-savings-contributions-empty">
                      <ModuleText token="caption" color={moduleNeutrals.textSecondary}>
                        No contributions recorded. Nothing has been counted toward this goal.
                      </ModuleText>
                    </ModuleCard>
                  ) : (
                    contributions.map((transaction) => (
                      <ContributionRow
                        key={transaction.id}
                        transaction={transaction}
                        currency={currency}
                        onEdit={() => {
                          setEditingContribution(transaction);
                          setContributionComposerFor(entry.goal.id);
                          setDirection(transaction.direction);
                          setAmount(formatMinor(transaction.amountMinor, currency));
                          setOccurredOn(transaction.occurredOn);
                          setNote(transaction.note ?? '');
                        }}
                        onDelete={() => setPendingContributionRemoval(transaction)}
                      />
                    ))
                  )}

                  {pendingContributionRemoval === null ? null : (
                    <ModuleCard accentBorder testID="finance-contribution-removal-confirmation">
                      <View style={{ rowGap: dp(8) }}>
                        <ModuleText token="cardTitle" accessibilityRole="header">
                          Delete this transaction?
                        </ModuleText>
                        <ModuleText token="caption" color={moduleNeutrals.textSecondary}>
                          {`${formatAmount(pendingContributionRemoval.amountMinor, currency)} on ${pendingContributionRemoval.occurredOn} will be permanently removed from your ledger. This cannot be undone.`}
                        </ModuleText>
                        <ModuleButton
                          label="Delete transaction"
                          onPress={() => void confirmContributionRemoval()}
                          disabled={saving}
                          testID="finance-contribution-confirm-delete"
                        />
                        <ModuleButton
                          label="Keep transaction"
                          variant="tertiary"
                          onPress={() => setPendingContributionRemoval(null)}
                          testID="finance-contribution-cancel-delete"
                        />
                      </View>
                    </ModuleCard>
                  )}

                  {contributionComposerFor === entry.goal.id ? (
                    <ModuleCard tinted accentBorder testID="finance-contribution-composer">
                      <View style={{ rowGap: dp(10) }}>
                        <ModuleText token="cardTitle" accessibilityRole="header">
                          {editingContribution === null
                            ? 'Record money set aside'
                            : 'Edit this transaction'}
                        </ModuleText>

                        <ChoiceRow
                          label="What happened"
                          choices={[
                            { key: 'expense', label: 'Set aside' },
                            { key: 'income', label: 'Taken back out' },
                          ]}
                          selected={direction}
                          onSelect={(value) =>
                            setDirection(value === 'income' ? 'income' : 'expense')
                          }
                          testID="finance-contribution-direction"
                        />

                        <Field
                          value={amount}
                          onChangeText={setAmount}
                          placeholder={`Amount in ${currency}`}
                          label={`Amount in ${currency}`}
                          keyboardType="decimal-pad"
                          testID="finance-contribution-amount"
                        />
                        <Field
                          value={occurredOn}
                          onChangeText={setOccurredOn}
                          placeholder="YYYY-MM-DD"
                          label="Date"
                          testID="finance-contribution-date"
                        />
                        <Field
                          value={note}
                          onChangeText={setNote}
                          placeholder="Note (optional)"
                          label="Note"
                          maxLength={280}
                          testID="finance-contribution-note"
                        />

                        <ModuleButton
                          label={editingContribution === null ? 'Record it' : 'Save changes'}
                          onPress={() => void submitContribution(entry.goal.id)}
                          loading={saving}
                          disabled={saving}
                          testID="finance-contribution-save"
                        />
                        <ModuleButton
                          label="Cancel"
                          variant="tertiary"
                          onPress={clearContributionComposer}
                          testID="finance-contribution-cancel"
                        />
                      </View>
                    </ModuleCard>
                  ) : (
                    <ModuleButton
                      label="Record money set aside"
                      onPress={() => {
                        clearContributionComposer();
                        setContributionComposerFor(entry.goal.id);
                      }}
                      testID="finance-contribution-open-composer"
                    />
                  )}
                </View>
              </ModuleSection>
            );
          })()}

      {pendingGoalRemoval === null ? null : (
        <ModuleCard accentBorder testID="finance-goal-removal-confirmation">
          <View style={{ rowGap: dp(8) }}>
            <ModuleText token="cardTitle" accessibilityRole="header">
              Delete this goal?
            </ModuleText>
            <ModuleText token="caption" color={moduleNeutrals.textSecondary}>
              {`The ${pendingGoalRemoval.name} goal will be permanently removed. This cannot be undone. The transactions you recorded toward it stay in your ledger, because the money did move — delete them from Spending if you want them gone.`}
            </ModuleText>
            <ModuleButton
              label="Delete goal"
              onPress={() => void confirmGoalRemoval()}
              disabled={saving}
              testID="finance-goal-confirm-delete"
            />
            <ModuleButton
              label="Keep goal"
              variant="tertiary"
              onPress={() => setPendingGoalRemoval(null)}
              testID="finance-goal-cancel-delete"
            />
          </View>
        </ModuleCard>
      )}

      {goalComposerOpen || editingGoal !== null ? (
        <ModuleCard tinted accentBorder testID="finance-goal-composer">
          <View style={{ rowGap: dp(10) }}>
            <ModuleText token="cardTitle" accessibilityRole="header">
              {editingGoal === null ? 'Add a savings goal' : 'Edit goal'}
            </ModuleText>

            <Field
              value={name}
              onChangeText={setName}
              placeholder="What are you saving for?"
              label="Goal name"
              maxLength={60}
              testID="finance-goal-name"
            />
            <Field
              value={target}
              onChangeText={setTarget}
              placeholder={`Target in ${currency}`}
              label={`Target in ${currency}`}
              keyboardType="decimal-pad"
              testID="finance-goal-target"
            />
            <Field
              value={targetOn}
              onChangeText={setTargetOn}
              placeholder="Target date, YYYY-MM-DD (optional)"
              label="Target date"
              testID="finance-goal-target-date"
            />
            <ModuleText token="caption" color={moduleNeutrals.textSecondary}>
              A target date is a date you are aiming at. NoorLife will not predict whether you will
              reach it, and nothing changes when it passes.
            </ModuleText>

            <ModuleButton
              label={editingGoal === null ? 'Save goal' : 'Save changes'}
              onPress={() => void submitGoal()}
              loading={saving}
              disabled={saving}
              testID="finance-goal-save"
            />
            <ModuleButton
              label="Cancel"
              variant="tertiary"
              onPress={() => {
                clearGoalComposer();
                setGoalComposerOpen(false);
              }}
              testID="finance-goal-cancel"
            />
          </View>
        </ModuleCard>
      ) : (
        <ModuleButton
          label="Add a savings goal"
          onPress={() => setGoalComposerOpen(true)}
          testID="finance-goal-open-composer"
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
  'too-large': 'That amount is larger than this can hold.',
};

const GOAL_FAULT_MESSAGE: Record<string, string> = {
  'invalid-amount': 'Enter a target greater than zero.',
  'invalid-name': 'Name what you are saving for, in 60 characters or fewer.',
  'invalid-date': 'Enter the target date as YYYY-MM-DD, or leave it empty.',
  'duplicate-name': 'You already have a goal with that name. Edit the existing one instead.',
  'not-found': 'That goal no longer exists.',
  'goals-full': 'You have as many goals as this can hold.',
};

const TRANSACTION_FAULT_MESSAGE: Record<string, string> = {
  'invalid-amount': 'Enter an amount greater than zero.',
  'invalid-date': 'Enter the date as YYYY-MM-DD.',
  'invalid-note': 'That note is longer than this can hold.',
  'invalid-goal': 'That goal could not be identified.',
  'not-found': 'That transaction no longer exists.',
  'ledger-full': 'Your ledger holds as many transactions as it can.',
  'no-currency': 'Choose your currency in Spending first.',
};

/**
 * The five states, as words. The sentence is the answer; nothing depends on a colour.
 *
 * Every amount handed to the formatter is a magnitude — the sign lives in the wording, because
 * `formatMinor` is unsigned and a negative pushed through it renders nonsense.
 */
export function goalStatusSentence(entry: FinanceGoalProgress, currency: FinanceCurrency): string {
  switch (entry.status) {
    case 'nothing-recorded':
      return 'No contributions recorded';
    case 'in-progress':
      return `${formatAmount(entry.remainingMinor, currency)} remaining`;
    case 'target-reached':
      return 'Target reached';
    case 'above-target':
      return `${formatAmount(entry.aboveTargetMinor, currency)} above the target`;
    case 'withdrawn-past-zero':
      return `${formatAmount(-entry.setAsideMinor, currency)} more taken back out than set aside`;
  }
}

/** The target date as a fact. Never a forecast, never a verdict, and never a failure. */
export function targetDateSentence(targetOn: string | null, todayKey: string): string | null {
  switch (targetDateStanding(targetOn, todayKey)) {
    case null:
      return null;
    case 'today':
      return `Target date is today, ${targetOn ?? ''}.`;
    case 'past':
      return `Target date ${targetOn ?? ''} has passed.`;
    case 'future':
      return `Target date ${targetOn ?? ''}.`;
  }
}

/** The percentage, signed in words so a withdrawn-past-nothing goal does not read as zero. */
function usedLabel(percentTenths: number): string {
  const magnitude = formatPercentTenths(percentTenths);
  return percentTenths < 0 ? `minus ${magnitude}` : magnitude;
}

/**
 * One goal, with what has been set aside toward it.
 *
 * The card is one accessible node carrying a composed label, so a screen reader states the name, the
 * amounts, the standing and the target date as a sentence rather than as fragments to reassemble.
 */
function GoalRow({
  entry,
  currency,
  today,
  open,
  onToggle,
  onEdit,
  onDelete,
}: {
  readonly entry: FinanceGoalProgress;
  readonly currency: FinanceCurrency;
  readonly today: string;
  readonly open: boolean;
  readonly onToggle: () => void;
  readonly onEdit: () => void;
  readonly onDelete: () => void;
}) {
  const theme = useModuleTheme();
  const surfaces = useModuleSurfaces();
  const { dp } = useModuleMetrics();

  const recorded = `${formatAmount(entry.contributedMinor, currency)} recorded toward ${formatAmount(entry.targetMinor, currency)}`;
  const sentence = goalStatusSentence(entry, currency);
  const dateSentence = targetDateSentence(entry.goal.targetOn, today);
  const used = usedLabel(entry.percentTenths);

  /*
    The withdrawal disclosure. Only shown when something was taken back out, and it states the net in
    words so a negative never reaches the unsigned formatter.
  */
  const withdrawnSentence =
    entry.withdrawnMinor === 0
      ? null
      : entry.setAsideMinor >= 0
        ? `${formatAmount(entry.withdrawnMinor, currency)} of that has been taken back out, leaving ${formatAmount(entry.setAsideMinor, currency)} set aside.`
        : `${formatAmount(entry.withdrawnMinor, currency)} has been taken back out, which is more than was put in.`;

  const countSentence =
    entry.contributionCount === 1
      ? '1 transaction recorded against this goal'
      : `${entry.contributionCount} transactions recorded against this goal`;

  /*
    Decoration only. Clamped at both ends: an above-target bar cannot overflow its track, and a goal
    withdrawn past nothing shows an empty one rather than a negative width. The *factual* totals are
    never clamped — that is the whole point of keeping them in the sentences above.
  */
  const filled = Math.min(100, Math.max(0, entry.percentTenths / 10));

  return (
    <ModuleCard testID={`finance-goal-${entry.goal.name}`}>
      <View
        style={{ rowGap: dp(8) }}
        accessible
        accessibilityLabel={`${entry.goal.name}. ${recorded}, ${used} of the target. ${sentence}.${withdrawnSentence === null ? '' : ` ${withdrawnSentence}`}${dateSentence === null ? '' : ` ${dateSentence}`}`}
      >
        <View style={[styles.row, styles.spread, { columnGap: dp(8) }]}>
          <ModuleText token="cardTitle" style={styles.grow}>
            {entry.goal.name}
          </ModuleText>
          <ModuleText token="caption" color={moduleNeutrals.textSecondary}>
            {used}
          </ModuleText>
        </View>

        <ModuleText token="caption" color={moduleNeutrals.textSecondary}>
          {recorded}
        </ModuleText>

        {/*
          A bar, and nothing but a bar. It repeats what the sentence below already states, is hidden
          from assistive technology, and takes the module's own ink rather than a hue that means
          "good" — the standing is carried by words, in greyscale, for everybody.
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
            testID={`finance-goal-bar-${entry.goal.name}`}
          />
        </View>

        <ModuleText
          token="caption"
          color={theme.ink}
          testID={`finance-goal-status-${entry.goal.name}`}
        >
          {sentence}
        </ModuleText>

        {withdrawnSentence === null ? null : (
          <ModuleText
            token="caption"
            color={moduleNeutrals.textSecondary}
            testID={`finance-goal-withdrawn-${entry.goal.name}`}
          >
            {withdrawnSentence}
          </ModuleText>
        )}

        {dateSentence === null ? null : (
          <ModuleText
            token="caption"
            color={moduleNeutrals.textSecondary}
            testID={`finance-goal-target-date-${entry.goal.name}`}
          >
            {dateSentence}
          </ModuleText>
        )}

        <ModuleText token="caption" color={moduleNeutrals.textTertiary}>
          {countSentence}
        </ModuleText>

        <View style={[styles.row, { columnGap: dp(8) }]}>
          <ModuleButton
            label={open ? 'Hide contributions' : 'Contributions'}
            variant="tertiary"
            fullWidth={false}
            onPress={onToggle}
            testID={`finance-goal-contributions-${entry.goal.name}`}
          />
          <ModuleButton
            label="Edit"
            variant="tertiary"
            fullWidth={false}
            onPress={onEdit}
            testID={`finance-goal-edit-${entry.goal.name}`}
          />
          <ModuleButton
            label="Delete"
            variant="tertiary"
            fullWidth={false}
            onPress={onDelete}
            testID={`finance-goal-delete-${entry.goal.name}`}
          />
        </View>
      </View>
    </ModuleCard>
  );
}

/** One transaction attributed to a goal, said in the words the user chose it with. */
function ContributionRow({
  transaction,
  currency,
  onEdit,
  onDelete,
}: {
  readonly transaction: FinanceTransaction;
  readonly currency: FinanceCurrency;
  readonly onEdit: () => void;
  readonly onDelete: () => void;
}) {
  const { dp } = useModuleMetrics();
  const amount = formatAmount(transaction.amountMinor, currency);
  const what = transaction.direction === 'expense' ? 'set aside' : 'taken back out';
  const sentence = `${amount} ${what} on ${transaction.occurredOn}`;

  return (
    <ModuleCard testID={`finance-contribution-${transaction.id}`}>
      <View
        style={{ rowGap: dp(6) }}
        accessible
        accessibilityLabel={`${sentence}.${transaction.note === null ? '' : ` ${transaction.note}.`}`}
      >
        <ModuleText token="caption">{sentence}</ModuleText>
        {transaction.note === null ? null : (
          <ModuleText token="caption" color={moduleNeutrals.textSecondary}>
            {transaction.note}
          </ModuleText>
        )}
        <View style={[styles.row, { columnGap: dp(8) }]}>
          <ModuleButton
            label="Edit"
            variant="tertiary"
            fullWidth={false}
            onPress={onEdit}
            testID={`finance-contribution-edit-${transaction.id}`}
          />
          <ModuleButton
            label="Delete"
            variant="tertiary"
            fullWidth={false}
            onPress={onDelete}
            testID={`finance-contribution-delete-${transaction.id}`}
          />
        </View>
      </View>
    </ModuleCard>
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
              testID={`${testID}-${choice.key}`}
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
