import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { minimumTouchTargetSize } from '@shared/utils/a11y';

import type { FinanceDirection } from '../data/finance-ledger';
import type { FinanceCurrency } from '../data/finance-money';
import { useFinance } from '../di/finance-provider';
import { financeMoney, useFinanceLocale } from '../di/use-finance-money';
import {
  discardRetainedImage,
  discardStagedImage,
  retainReceiptImage,
  stageReceiptImage,
  type RetainedReceiptImage,
  type StagedReceiptImage,
} from '../receipts/receipt-image-store';
import type { ReceiptOcrPort } from '../receipts/receipt-ocr.port';
import {
  currencyMismatch,
  readReceiptLines,
  type ReceiptReading,
} from '../receipts/receipt-reading';
import type { ReceiptSourceKind, ReceiptSourcePort } from '../receipts/receipt-source.port';

/**
 * **Receipts — read it here, record it only when you say so** — issue #101.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── The one rule this screen exists to keep ────────────────────────────────
 * Nothing reaches the ledger until the user presses Confirm. Not on mount, not when an image is
 * chosen, not when recognition finishes, not when a suggestion is accepted into a field. There is
 * exactly one call to `finance.createTransaction` in this file and it is inside `confirm`, which
 * only a press can reach — and a test asserts the count of that call from the source as well as from
 * the behaviour.
 *
 * The reason is not caution about bugs. An automatic write would make a machine's reading of a
 * photograph into a financial record the user never agreed to, and the user's only recourse would be
 * noticing it later in a list. A receipt is evidence; a transaction is a claim; the person spending
 * the money makes the claim.
 *
 * ── The duplicate guard is a ref, and that matters ─────────────────────────
 * A real double tap delivers both presses inside one React batch, so a second handler still closes
 * over `saving === false` and a state-based guard never fires. `confirmingRef` is written
 * synchronously, so the second press sees it. `saving` remains for the button's busy appearance — it
 * is the *display* of the guard, not the guard. Spending settled this at #93 and the reasoning is
 * identical here, except that here the duplicate would be a second copy of a receipt rather than of
 * a typed entry.
 *
 * ── Recognition is a suggestion; the fields are the truth ──────────────────
 * Every proposed value lands in an ordinary editable field. Choosing a different amount, retyping
 * the date, clearing the category — all of it overrides the reading, and the reading is never
 * consulted again once a field has been touched. The screen says which fields the receipt
 * established and which it did not, because "we could not read the date, so this is today" is
 * information and a silently-filled date is a small lie.
 *
 * ── Currency is never inferred and never converted ─────────────────────────
 * Three cases, three different screens. No ledger currency: the workflow stops and sends the user to
 * the existing setup in Spending, because there is no honest minor-unit reading of "12.34" without
 * knowing what it is in. A recognised currency that disagrees with the ledger's: stated plainly, and
 * confirmation is withheld until the user says what they want to do — no rate is applied, ever.
 * Nothing recognised: manual entry proceeds in the ledger's currency, and the screen does not
 * pretend the receipt established it.
 *
 * ── The image is the app's, briefly ────────────────────────────────────────
 * What the camera or the picker returns is copied into an app-owned staging file, and it is the copy
 * that is recognised, previewed and deleted. Cancel, replace, confirm and unmount all clean up; the
 * user's own photograph is never touched. Keeping the original is a separate, explicit choice that
 * defaults to off, and — because retention is confirmed by *recording the transaction* — a kept copy
 * whose transaction is abandoned is removed again.
 *
 * Cleanup runs **after** the ledger write and cannot fail it. A filesystem that refuses to delete a
 * temporary file is an inconvenience; a transaction lost or duplicated because of one would be a
 * defect in somebody's money.
 * ═══════════════════════════════════════════════════════════════════════════
 */

export type FinanceReceiptsScreenProps = {
  /** On-device recognition. Injected so the native package is imported in exactly one place. */
  readonly ocr: ReceiptOcrPort;
  /** Camera and library access, including the permission request. See `receipt-source.port`. */
  readonly source: ReceiptSourcePort;
};

export function FinanceReceiptsScreen(props: FinanceReceiptsScreenProps) {
  return (
    <ModuleScaffold
      moduleId="finance"
      activeKey="receipts"
      title="Receipts"
      testID="finance-receipts"
    >
      <ReceiptsBody {...props} />
    </ModuleScaffold>
  );
}

type Denial = { readonly kind: ReceiptSourceKind; readonly retryable: boolean };
type OcrStatus = 'idle' | 'running' | 'read' | 'nothing' | 'failed';

/** Split out so the hooks below read the module context the scaffold creates. */
function ReceiptsBody({ ocr, source }: FinanceReceiptsScreenProps) {
  const finance = useFinance();
  /*
    From the ledger's own owner, not from the session read a second time — see `FinanceState`. A
    retained image has to belong to the account the transaction was written under, and taking both
    from one place is what makes that true by construction rather than by agreement.
  */
  const ownerId = finance.ownerId;
  const router = useRouter();
  const { dp } = useModuleMetrics();
  const { today } = usePlannerDay();

  const [staged, setStaged] = useState<StagedReceiptImage | null>(null);
  const [acquiring, setAcquiring] = useState<ReceiptSourceKind | null>(null);
  const [denial, setDenial] = useState<Denial | null>(null);
  const [status, setStatus] = useState<OcrStatus>('idle');
  const [reading, setReading] = useState<ReceiptReading | null>(null);
  /** The recognised lines, for the note control only. Never stored, never logged, dropped on reset. */
  const [lines, setLines] = useState<readonly string[]>([]);

  const [direction, setDirection] = useState<FinanceDirection>('expense');
  const [amount, setAmount] = useState('');
  const [occurredOn, setOccurredOn] = useState(today);
  const [category, setCategory] = useState('');
  const [note, setNote] = useState('');
  const [retain, setRetain] = useState(false);
  const [mismatchResolved, setMismatchResolved] = useState(false);

  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  /*
    The synchronous duplicate guard. See the note at the top of the file: a ref, because two presses
    in one batch both read the same `saving` state and only a ref is written between them.
  */
  const confirmingRef = useRef(false);

  /*
    Two refs the *cleanup* needs, because an unmount runs with whatever the closure captured. Reading
    the live values through refs is what lets a single mount-scoped effect abort the recognition in
    flight and delete the temporary file, without re-arming every time the image changes — a
    reload-shaped dependency that re-arms its own effect is how ninety-nine tests once hung.
  */
  const abortRef = useRef<AbortController | null>(null);
  const stagedRef = useRef<StagedReceiptImage | null>(null);
  const ownerRef = useRef(ownerId);
  const committedRef = useRef(false);

  /*
    Synced after each commit rather than during render. A ref written in the render body is a
    side effect in a function React may call twice, discard, or replay — `react-hooks/refs` refuses
    it for that reason, and the refusal is right here: this component's whole cleanup contract
    depends on the ref describing what was actually *committed*, not what a speculative render
    produced. An effect with no dependency array runs after every commit, which is exactly that.
  */
  useEffect(() => {
    stagedRef.current = staged;
    ownerRef.current = ownerId;
  });

  useEffect(
    () => () => {
      abortRef.current?.abort();
      if (committedRef.current) {
        return;
      }
      /*
        An abandoned draft leaves nothing behind. Only the staged copy can exist at this point, and
        that is the invariant rather than an omission: a receipt image is kept at the *moment of
        confirmation* and never before, so a draft that was abandoned has nothing kept to remove. The
        toggle is a statement of intent; the intent is carried out by a transaction that exists.
      */
      discardStagedImage(stagedRef.current);
    },
    [],
  );

  const ledger = finance.ledger;
  const currency = ledger.currency;
  /* Read unconditionally; bound below wherever the currency has been narrowed. */
  const locale = useFinanceLocale();

  const mismatch = useMemo(
    () => (reading === null || currency === null ? null : currencyMismatch(reading, currency)),
    [reading, currency],
  );

  /** Everything a draft accumulated, back to nothing. Deletes the temporary copy on the way. */
  const reset = useCallback((): void => {
    abortRef.current?.abort();
    abortRef.current = null;
    discardStagedImage(stagedRef.current);
    setStaged(null);
    setStatus('idle');
    setReading(null);
    setLines([]);
    setDirection('expense');
    setAmount('');
    setOccurredOn(today);
    setCategory('');
    setNote('');
    setRetain(false);
    setMismatchResolved(false);
    setDenial(null);
  }, [today]);

  const recognise = useCallback(
    async (image: StagedReceiptImage): Promise<void> => {
      const controller = new AbortController();
      abortRef.current?.abort();
      abortRef.current = controller;
      setStatus('running');

      const outcome = await ocr.recognise({ uri: image.uri, signal: controller.signal });
      if (controller.signal.aborted) {
        /* The draft this belonged to is gone. Publishing its text would be somebody else's receipt. */
        return;
      }

      if (outcome.kind === 'failed') {
        setStatus('failed');
        return;
      }
      if (outcome.kind === 'empty') {
        setStatus('nothing');
        return;
      }

      const read = readReceiptLines(outcome.lines, currency);
      setLines(outcome.lines);
      setReading(read);
      setStatus('read');
      /*
        Suggestions land in the fields, and that is *all* that happens. Nothing is written, nothing is
        confirmed, and every one of these is editable from this moment on.
      */
      const best = read.amounts[0];
      if (best !== undefined && currency !== null) {
        setAmount(financeMoney(currency, locale).plain(best.minor));
      }
      if (read.occurredOn !== null) {
        setOccurredOn(read.occurredOn);
      }
    },
    [ocr, currency, locale],
  );

  const acquire = useCallback(
    async (kind: ReceiptSourceKind): Promise<void> => {
      if (acquiring !== null) {
        return;
      }
      setDenial(null);
      setMessage(null);
      setAcquiring(kind);
      /*
        The permission prompt happens inside this call and nowhere else — which is what ties it to
        this press. See `receipt-source.port` for why that is structural rather than a convention.
      */
      const acquired = await source.acquire(kind);
      setAcquiring(null);

      if (acquired.kind === 'cancelled') {
        return;
      }
      if (acquired.kind === 'denied') {
        setDenial({ kind, retryable: acquired.retryable });
        return;
      }
      if (acquired.kind === 'failed') {
        setMessage(
          kind === 'camera'
            ? 'The camera could not be opened. You can still add this transaction by hand.'
            : 'That image could not be opened. You can still add this transaction by hand.',
        );
        return;
      }

      /* Replacing an image removes the copy this app made, and only that copy. */
      abortRef.current?.abort();
      discardStagedImage(stagedRef.current);
      setReading(null);
      setLines([]);
      setMismatchResolved(false);

      const image = stageReceiptImage(acquired.uri);
      if (image === null) {
        setStaged(null);
        setStatus('failed');
        setMessage('That image could not be prepared on this device.');
        return;
      }
      setStaged(image);
      stagedRef.current = image;
      await recognise(image);
    },
    [acquiring, source, recognise],
  );

  async function confirm(): Promise<void> {
    /* Synchronous, before anything can await. The second press of a double tap returns here. */
    if (confirmingRef.current || currency === null) {
      return;
    }
    const parsed = financeMoney(currency, locale).parse(amount);
    if (parsed.kind !== 'ok') {
      setMessage(AMOUNT_MESSAGE[parsed.reason] ?? 'That amount could not be read.');
      return;
    }

    confirmingRef.current = true;
    setSaving(true);

    /*
      Retention happens before the write, so a failure to keep the image is reported *instead of* a
      transaction rather than after one. The copy is removed again if the write then fails — the only
      state that must never exist is a kept image with no record of why it was kept.
    */
    let kept: RetainedReceiptImage | null = null;
    if (retain && staged !== null) {
      kept = retainReceiptImage(staged, ownerId);
      if (kept === null) {
        confirmingRef.current = false;
        setSaving(false);
        setMessage('That image could not be saved on this device, so nothing was recorded.');
        return;
      }
    }

    const result = await finance.createTransaction({
      direction,
      amountMinor: parsed.minor,
      occurredOn,
      category: category.trim() === '' ? null : category.trim(),
      note: note.trim() === '' ? null : note.trim(),
    });

    if (result.kind !== 'ok') {
      discardRetainedImage(kept, ownerId);
      confirmingRef.current = false;
      setSaving(false);
      setMessage(
        result.kind === 'invalid' && result.fault === 'no-currency'
          ? 'Your ledger has no currency yet, so nothing was recorded.'
          : 'That could not be recorded. Nothing was changed.',
      );
      return;
    }

    /*
      Recorded. Everything after this point is best-effort and none of it can undo the line above —
      `discardStagedImage` swallows its own failure and returns whether the file is gone, which is
      reported to the user rather than treated as an error in the transaction.
    */
    committedRef.current = true;
    const removed = discardStagedImage(staged);
    setStaged(null);
    stagedRef.current = null;
    setSaving(false);
    confirmingRef.current = false;

    router.replace('/finance/transactions');
    if (!removed) {
      setMessage('Recorded. The temporary copy of the image could not be removed.');
    }
  }

  if (finance.loading) {
    return <ModuleLoadingState />;
  }

  if (finance.fault === 'corrupt-data') {
    return (
      <ModuleErrorState
        title="Your Finance records could not be read"
        body="They have been left exactly as they are on this device. Nothing was changed or deleted."
        retryLabel="Try again"
        onRetry={() => void finance.reload()}
        testID="finance-receipts-corrupt"
      />
    );
  }

  if (finance.fault === 'storage-unavailable') {
    return (
      <ModuleErrorState
        onRetry={() => void finance.reload()}
        testID="finance-receipts-unavailable"
      />
    );
  }

  if (currency === null) {
    /*
      The ledger has no currency, so no amount on this receipt has a meaning yet. Rather than
      duplicating the picker, this sends the user to the one that already exists — the same setup
      Spending shows on its first run, with the same rules about when it can be changed.
    */
    return (
      <View style={{ rowGap: dp(moduleLayout.sectionGap) }} testID="finance-receipts-no-currency">
        <ModuleCard tinted accentBorder>
          <View style={{ rowGap: dp(6) }}>
            <ModuleText token="cardTitle" accessibilityRole="header">
              Choose your currency first
            </ModuleText>
            <ModuleText token="caption" color={moduleNeutrals.textSecondary}>
              A receipt cannot be read into money until your ledger knows what money it is in.
              NoorLife does not guess this from your phone.
            </ModuleText>
            <ModuleButton
              label="Set up your currency"
              onPress={() => router.push('/finance/transactions')}
              testID="finance-receipts-currency-setup"
            />
          </View>
        </ModuleCard>
      </View>
    );
  }

  const confirmBlocked = mismatch !== null && !mismatchResolved;

  return (
    <View style={{ rowGap: dp(moduleLayout.sectionGap) }}>
      {message === null ? null : (
        <ModuleStatusBanner
          tone="info"
          message={message}
          onDismiss={() => setMessage(null)}
          testID="finance-receipts-message"
        />
      )}

      <Disclosure />

      <ModuleSection title="Add a receipt" testID="finance-receipts-actions">
        <ModuleCard>
          <View style={{ rowGap: dp(10) }}>
            <ModuleText token="caption" color={moduleNeutrals.textSecondary}>
              NoorLife asks for the camera only when you choose Capture, and for your photos only
              when you choose Import.
            </ModuleText>
            <ModuleButton
              label={staged === null ? 'Capture receipt' : 'Take another photo'}
              onPress={() => void acquire('camera')}
              loading={acquiring === 'camera'}
              disabled={acquiring !== null || saving}
              testID="finance-receipts-capture"
            />
            <ModuleButton
              label={staged === null ? 'Import receipt' : 'Choose another photo'}
              variant="secondary"
              onPress={() => void acquire('library')}
              loading={acquiring === 'library'}
              disabled={acquiring !== null || saving}
              testID="finance-receipts-import"
            />
            <ModuleButton
              label="Enter it by hand"
              variant="tertiary"
              onPress={() => router.push('/finance/transactions?intent=add-expense')}
              testID="finance-receipts-manual"
            />
          </View>
        </ModuleCard>
      </ModuleSection>

      {denial === null ? null : (
        <PermissionDenied denial={denial} onRetry={() => void acquire(denial.kind)} />
      )}

      {staged === null ? null : (
        <>
          <ModuleSection title="This receipt" testID="finance-receipts-preview-section">
            <ModuleCard>
              <View style={{ rowGap: dp(10) }}>
                <Image
                  source={{ uri: staged.uri }}
                  style={[styles.preview, { borderRadius: dp(12) }]}
                  contentFit="contain"
                  accessibilityLabel="The receipt you selected"
                  accessible
                  testID="finance-receipts-preview"
                />
                <Progress status={status} />
              </View>
            </ModuleCard>
          </ModuleSection>

          <ReviewFields
            currency={currency}
            reading={reading}
            status={status}
            direction={direction}
            onDirection={setDirection}
            amount={amount}
            onAmount={setAmount}
            occurredOn={occurredOn}
            onOccurredOn={setOccurredOn}
            category={category}
            onCategory={setCategory}
            note={note}
            onNote={setNote}
            lines={lines}
          />

          {mismatch === null ? null : (
            <ModuleCard accentBorder testID="finance-receipts-mismatch">
              <View style={{ rowGap: dp(8) }}>
                <ModuleText token="cardTitle" accessibilityRole="header">
                  This receipt is not in {currency}
                </ModuleText>
                <ModuleText token="caption" color={moduleNeutrals.textSecondary}>
                  {`It appears to be in ${mismatch}, and your ledger records ${currency}. NoorLife does not convert between currencies — no rate it invented would be the rate you paid. Enter the amount in ${currency} yourself, or record this somewhere else.`}
                </ModuleText>
                {mismatchResolved ? (
                  <ModuleText
                    token="caption"
                    color={moduleNeutrals.textSecondary}
                    testID="finance-receipts-mismatch-resolved"
                  >
                    {`This will be recorded in ${currency}, using the amount in the field above.`}
                  </ModuleText>
                ) : (
                  <ModuleButton
                    label={`Record it in ${currency}`}
                    variant="secondary"
                    onPress={() => setMismatchResolved(true)}
                    testID="finance-receipts-mismatch-accept"
                  />
                )}
              </View>
            </ModuleCard>
          )}

          <ModuleCard testID="finance-receipts-retention">
            <View style={{ rowGap: dp(8) }}>
              <Toggle
                label="Keep a copy of this receipt image"
                value={retain}
                onChange={setRetain}
                testID="finance-receipts-retain"
              />
              <ModuleText token="caption" color={moduleNeutrals.textSecondary}>
                {retain
                  ? 'The image will be kept inside NoorLife on this device, in a folder only your account uses. It is never uploaded. Deleting the transaction later does not delete this image.'
                  : 'Off. The photo NoorLife made is deleted once you record this, and if you cancel.'}
              </ModuleText>
            </View>
          </ModuleCard>

          <ModuleCard tinted accentBorder testID="finance-receipts-confirm-card">
            <View style={{ rowGap: dp(8) }}>
              <ModuleText token="cardTitle" accessibilityRole="header">
                Nothing has been recorded yet
              </ModuleText>
              <ModuleText token="caption" color={moduleNeutrals.textSecondary}>
                {confirmBlocked
                  ? 'Resolve the currency above before recording this.'
                  : 'Recording this creates one ordinary transaction in your ledger, exactly as if you had typed it.'}
              </ModuleText>
              <ModuleButton
                label="Record this transaction"
                onPress={() => void confirm()}
                loading={saving}
                disabled={saving || confirmBlocked}
                testID="finance-receipts-confirm"
              />
              <ModuleButton
                label="Cancel and delete"
                variant="tertiary"
                onPress={reset}
                disabled={saving}
                testID="finance-receipts-cancel"
              />
            </View>
          </ModuleCard>
        </>
      )}
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

/**
 * What actually happens to a receipt, said plainly and without overclaiming.
 *
 * The third line is the one that took care. NoorLife does not upload the image or the recognised
 * text, and that is a promise this codebase keeps — there is no network client behind the OCR port
 * and a test asserts there is none. But on Android the reading is done by Google's ML Kit, and a
 * Google SDK may contact Google for diagnostics, performance measurement and compatibility
 * information. Saying "no network activity" would be easier to read and would be untrue, and a
 * privacy claim that is nearly true is worse than a longer one that is exactly true.
 *
 * It names **Android** because iOS does not use ML Kit at all — `modules/noorlife-text-recognition`
 * reads iOS receipts with Apple Vision, an operating-system API with no third-party SDK behind it. A
 * disclosure describing a Google component on a platform that has none would be the same untruth in
 * the other direction.
 */
function Disclosure() {
  const { dp } = useModuleMetrics();
  return (
    <ModuleCard testID="finance-receipts-disclosure">
      <View style={{ rowGap: dp(6) }}>
        <ModuleText token="cardTitle" accessibilityRole="header">
          How this works
        </ModuleText>
        <ModuleText token="caption" color={moduleNeutrals.textSecondary}>
          Reading the receipt happens on this device. NoorLife does not upload the receipt image or
          the text read from it. On Android the reading is done by a Google ML Kit component, which
          may contact Google about itself — diagnostics, performance and compatibility — and which
          NoorLife does not control. Keeping the original image is optional and is off unless you
          turn it on.
        </ModuleText>
      </View>
    </ModuleCard>
  );
}

/** Truthful, non-blocking progress. Nothing here is a spinner over the whole screen. */
function Progress({ status }: { readonly status: OcrStatus }) {
  const copy: Record<OcrStatus, string | null> = {
    idle: null,
    running: 'Reading this receipt on your device…',
    read: 'Read. Check every field below — these are suggestions, not decisions.',
    nothing:
      'No text could be read from this image. You can retake it, or fill the fields in yourself.',
    failed: 'This image could not be read on this device. You can fill the fields in yourself.',
  };
  const text = copy[status];
  return text === null ? null : (
    <ModuleText
      token="caption"
      color={moduleNeutrals.textSecondary}
      accessibilityLiveRegion="polite"
      testID={`finance-receipts-status-${status}`}
    >
      {text}
    </ModuleText>
  );
}

function PermissionDenied({
  denial,
  onRetry,
}: {
  readonly denial: Denial;
  readonly onRetry: () => void;
}) {
  const { dp } = useModuleMetrics();
  const thing = denial.kind === 'camera' ? 'the camera' : 'your photos';
  return (
    <ModuleCard accentBorder testID={`finance-receipts-denied-${denial.kind}`}>
      <View style={{ rowGap: dp(8) }}>
        <ModuleText token="cardTitle" accessibilityRole="header">
          {`NoorLife does not have access to ${thing}`}
        </ModuleText>
        <ModuleText token="caption" color={moduleNeutrals.textSecondary}>
          {denial.retryable
            ? `You can allow it and try again, or add this transaction by hand — nothing here needs ${thing}.`
            : `Your phone will not ask again. You can turn it on in Settings, or add this transaction by hand — nothing here needs ${thing}.`}
        </ModuleText>
        {denial.retryable ? (
          <ModuleButton
            label="Ask again"
            variant="secondary"
            onPress={onRetry}
            testID={`finance-receipts-retry-${denial.kind}`}
          />
        ) : null}
      </View>
    </ModuleCard>
  );
}

function ReviewFields({
  currency,
  reading,
  status,
  direction,
  onDirection,
  amount,
  onAmount,
  occurredOn,
  onOccurredOn,
  category,
  onCategory,
  note,
  onNote,
  lines,
}: {
  readonly currency: FinanceCurrency;
  readonly reading: ReceiptReading | null;
  readonly status: OcrStatus;
  readonly direction: FinanceDirection;
  readonly onDirection: (value: FinanceDirection) => void;
  readonly amount: string;
  readonly onAmount: (value: string) => void;
  readonly occurredOn: string;
  readonly onOccurredOn: (value: string) => void;
  readonly category: string;
  readonly onCategory: (value: string) => void;
  readonly note: string;
  readonly onNote: (value: string) => void;
  readonly lines: readonly string[];
}) {
  const { dp } = useModuleMetrics();
  /* This component receives a narrowed currency, so it binds the contract itself. */
  const money = financeMoney(currency, useFinanceLocale());
  const candidates = reading?.amounts ?? [];
  const dateEstablished = reading?.occurredOn ?? null;

  return (
    <ModuleSection
      title="Check before recording"
      subtitle="Everything here can be changed. What the receipt says is only a starting point."
      testID="finance-receipts-review"
    >
      <ModuleCard>
        <View style={{ rowGap: dp(10) }}>
          <ChoiceRow
            label="Direction"
            choices={[
              { key: 'expense', label: 'Expense' },
              { key: 'income', label: 'Income' },
            ]}
            selected={direction}
            onSelect={(value) => onDirection(value as FinanceDirection)}
            testID="finance-receipts-direction"
          />
          {/*
            Expense is the default because a receipt workflow is about money going out — that is
            what the screen is for and what its copy says throughout. It is a default, not a finding:
            the control is right here, a refund receipt is one tap away from being income, and
            nothing in the reading claims to have established a direction.
          */}

          <Field
            value={amount}
            onChangeText={onAmount}
            placeholder={`Amount in ${currency}`}
            label={`Amount in ${currency}`}
            keyboardType="decimal-pad"
            testID="finance-receipts-amount"
          />

          {candidates.length === 0 ? null : (
            <View style={{ rowGap: dp(6) }} testID="finance-receipts-candidates">
              <ModuleText token="caption" color={moduleNeutrals.textSecondary}>
                {candidates.length === 1
                  ? 'The amount read from this receipt:'
                  : 'Amounts read from this receipt — pick the one you paid:'}
              </ModuleText>
              <View style={[styles.choices, { gap: dp(6) }]}>
                {candidates.map((candidate) => (
                  <Pressable
                    key={candidate.minor}
                    onPress={() => onAmount(money.plain(candidate.minor))}
                    accessibilityRole="button"
                    accessibilityLabel={`Use ${money.amount(candidate.minor)}${candidate.emphasis === 'total' ? ', read as the total' : ''}`}
                    style={[
                      styles.chip,
                      {
                        minHeight: minimumTouchTargetSize(),
                        borderRadius: dp(12),
                        paddingHorizontal: dp(10),
                      },
                    ]}
                    testID={`finance-receipts-candidate-${candidate.minor}`}
                  >
                    <ModuleText token="button">{money.amount(candidate.minor)}</ModuleText>
                  </Pressable>
                ))}
              </View>
            </View>
          )}

          <Field
            value={occurredOn}
            onChangeText={onOccurredOn}
            placeholder="YYYY-MM-DD"
            label="Date"
            testID="finance-receipts-date"
          />
          {status === 'read' && dateEstablished === null ? (
            <ModuleText
              token="caption"
              color={moduleNeutrals.textSecondary}
              testID="finance-receipts-date-unread"
            >
              {reading?.dateAmbiguous === true
                ? 'A date was printed but its day and month could be either way round, so this is today. Change it if you know which.'
                : 'No date could be read from this receipt, so this is today. Change it if that is wrong.'}
            </ModuleText>
          ) : null}

          <Field
            value={category}
            onChangeText={onCategory}
            placeholder="Category (optional)"
            label="Category"
            maxLength={40}
            testID="finance-receipts-category"
          />

          <Field
            value={note}
            onChangeText={onNote}
            placeholder="Note (optional)"
            label="Note"
            maxLength={280}
            testID="finance-receipts-note"
          />
          {/*
            The only path by which recognised text can reach storage, and it is a press. Text read
            off a receipt is not automatically a note: it is somebody's shopping, and putting it in
            the ledger without being asked would store what they bought as well as what they spent.
          */}
          {lines.length === 0 || note.trim() !== '' ? null : (
            <>
              <ModuleText token="caption" color={moduleNeutrals.textSecondary}>
                The text read from this receipt is not saved anywhere unless you put some of it in
                the note yourself.
              </ModuleText>
              <ModuleButton
                label="Use the first line"
                variant="tertiary"
                onPress={() => onNote((lines[0] ?? '').slice(0, 280))}
                testID="finance-receipts-note-from-text"
              />
            </>
          )}
        </View>
      </ModuleCard>
    </ModuleSection>
  );
}

function Toggle({
  label,
  value,
  onChange,
  testID,
}: {
  readonly label: string;
  readonly value: boolean;
  readonly onChange: (next: boolean) => void;
  readonly testID: string;
}) {
  const theme = useModuleTheme();
  const surfaces = useModuleSurfaces();
  const { dp } = useModuleMetrics();
  return (
    <Pressable
      onPress={() => onChange(!value)}
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      accessibilityLabel={label}
      style={[
        styles.row,
        styles.spread,
        {
          /* The accessibility minimum, unscaled — it is a bound, not a dimension. */
          minHeight: minimumTouchTargetSize(),
          columnGap: dp(8),
        },
      ]}
      testID={testID}
    >
      <ModuleText token="button" color={moduleNeutrals.textPrimary}>
        {label}
      </ModuleText>
      <View
        style={[
          styles.chip,
          {
            minHeight: minimumTouchTargetSize(),
            minWidth: minimumTouchTargetSize(),
            borderRadius: dp(12),
            borderColor: value ? theme.ink : surfaces.border,
            backgroundColor: value ? surfaces.well : surfaces.card,
            paddingHorizontal: dp(10),
          },
        ]}
      >
        {/* A word, not only a colour — a switch state carried by hue alone is unreadable to some. */}
        <ModuleText token="button" color={value ? theme.ink : moduleNeutrals.textSecondary}>
          {value ? 'On' : 'Off'}
        </ModuleText>
      </View>
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
                styles.chip,
                {
                  /* The accessibility minimum, unscaled — it is a bound, not a dimension. */
                  minHeight: minimumTouchTargetSize(),
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

const styles = StyleSheet.create({
  input: { borderWidth: 1 },
  row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
  spread: { justifyContent: 'space-between' },
  choices: { flexDirection: 'row', flexWrap: 'wrap' },
  chip: { alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  /* A bounded preview: tall enough to read a receipt, never tall enough to push the fields away. */
  preview: { width: '100%', aspectRatio: 3 / 4, maxHeight: 320 },
});
