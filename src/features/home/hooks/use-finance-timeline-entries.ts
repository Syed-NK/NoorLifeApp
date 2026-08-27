import { modulePalettes } from '@ds/tokens';
import { summariseFinance } from '@features/finance/data/finance-selectors';
import { useOptionalFinance } from '@features/finance/di/finance-provider';
import { usePlannerDay } from '@features/planner/di/planner-day-source';
import { useOptionalModuleAccess } from '@features/subscription/use-module-lock';
import type { TimelineEntry } from '@shared/models/dashboard';

/**
 * **Finance's one Main Home row: a count for the entitled, an invitation for everyone else** — #93.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── Why the seam is here ───────────────────────────────────────────────────
 * `use-main-home-dashboard.ts` describes itself as "the seam where those module repositories will be
 * fanned in", and Faith and Planner already fan in through it. Finance takes the same route rather
 * than inventing a dashboard section — the screen is byte-locked, and a new section would be a
 * product decision arriving as a side effect of a data change.
 *
 * ── Why a count and no amount ──────────────────────────────────────────────
 * Main Home is the screen somebody hands to a child, reads on a train, or leaves face-up on a desk.
 * A row there is seen by whoever is looking at the phone, not only by whoever unlocked it.
 *
 * So this contributes **how many entries were recorded today** and nothing more. No amount, no
 * total, no category and no note — the note and category are free text the user typed about their
 * own spending, and a timeline row is the last place that belongs. The brief permits an aggregate
 * amount; a count is the smaller of the two permitted disclosures and it is enough for the row to be
 * useful, so it is what this takes.
 *
 * ── The entitlement boundary, and why it is a branch rather than a filter ──
 * The row stays visible when Finance is locked, because a module nobody can see is a module nobody
 * discovers. But a locked row must disclose *nothing* about the ledger — and "nothing" has to
 * include the row's own existence. If the locked row appeared only when something had been recorded
 * today, then its presence would be the disclosure: anyone glancing at the phone would learn that
 * this person spent money today, which is most of what the count would have told them anyway.
 *
 * That is why the unentitled path returns before the ledger is read at all, rather than reading it
 * and omitting the number. A zero ledger, a full one, a missing owner, a corrupt store and an
 * account mid-switch all produce the same row, byte for byte, because none of them is consulted.
 *
 * Every uncertain state resolves to that same row: no entitlement provider, an entitlement still
 * resolving, a signed-out session. `useOptionalModuleAccess` is closed by default, so the disclosure
 * is opt-in rather than opt-out — a surface that showed the figure during the half-second before the
 * entitlement resolved would have shown it, and no later correction takes that back.
 *
 * ── Why it reads the one provider ──────────────────────────────────────────
 * `useOptionalFinance` reads the app-scoped owner from #92. Reading it rather than building a second
 * store is what makes Main Home update the instant Spending writes, with no relaunch and no event
 * bus — the property Planner's #72/#73 established and its regression proved. The same is true in
 * the other direction: entitlement is read live, so granting or losing access reconciles on the next
 * render rather than at the next launch.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const FINANCE_ACCENT = modulePalettes.finance.primary;

/**
 * One id for every state this row can be in.
 *
 * The id becomes the row's `testID`, so a locked variant with an id of its own would put the
 * distinction into the accessibility tree — which is exactly where a disclosure is easiest to leave
 * by accident and hardest to notice.
 */
const ROW_ID = 'finance-today';

/**
 * The row that says nothing.
 *
 * An invitation rather than a report: it makes no claim about whether anything has been recorded, so
 * it is equally true of an empty ledger, a full one and no ledger at all.
 */
const NEUTRAL_ROW: TimelineEntry = {
  id: ROW_ID,
  time: 'Today',
  title: 'Track what you spend',
  icon: 'transactions',
  sourceModule: 'finance',
  accent: FINANCE_ACCENT,
};

export function useFinanceTimelineEntries(): readonly TimelineEntry[] {
  const finance = useOptionalFinance();
  const { today } = usePlannerDay();
  const { isEntitled } = useOptionalModuleAccess('finance');

  /*
    The boundary. Everything below this line may read the ledger; nothing above it does, and this
    returns before `finance.ledger` is touched — including on the paths where `finance` is null, the
    session is signed out, or the entitlement has not resolved yet.
  */
  if (!isEntitled) {
    return [NEUTRAL_ROW];
  }

  /*
    No owner, no ledger. Main Home is a consumer rather than a Finance surface, and a screen that
    crashed because a module store was absent would be a worse failure than a neutral line.
  */
  if (finance === null) {
    return [NEUTRAL_ROW];
  }

  /*
    Nothing derived while the first read is in flight, and nothing on a fault. This is also what
    contains an account change: the provider resets to loading during the render in which the
    repository identity changes, so the previous owner's figure is never published into the new
    owner's session — not even for the frame it would take a read to resolve.
  */
  if (finance.loading || finance.fault !== null) {
    return [NEUTRAL_ROW];
  }

  /*
    Nothing before a currency exists either. An unconfigured ledger has no transactions by
    construction (#92 refuses them), so a figure would be reporting on a ledger that cannot hold
    anything yet.
  */
  if (finance.ledger.currency === null) {
    return [NEUTRAL_ROW];
  }

  const summary = summariseFinance(finance.ledger, today);
  if (summary.todayCount === 0) {
    return [NEUTRAL_ROW];
  }

  return [
    {
      ...NEUTRAL_ROW,
      /* No clock of its own: the day is the shared source's, and the row is about that whole day. */
      title:
        summary.todayCount === 1 ? '1 entry recorded' : `${summary.todayCount} entries recorded`,
    },
  ];
}
