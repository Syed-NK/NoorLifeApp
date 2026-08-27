import { modulePalettes } from '@ds/tokens';
import { useOptionalFinance } from '@features/finance/di/finance-provider';
import { summariseFinance } from '@features/finance/data/finance-selectors';
import { usePlannerDay } from '@features/planner/di/planner-day-source';
import type { TimelineEntry } from '@shared/models/dashboard';

/**
 * **Finance's one Main Home row: a count, and nothing else** — issue #93.
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
 * The full figures live one tap away on the Finance home, behind the module's own entitlement gate.
 *
 * ── Why it reads the one provider ──────────────────────────────────────────
 * `useOptionalFinance` reads the app-scoped owner from #92. Reading it rather than building a second store
 * is what makes Main Home update the instant Spending writes, with no relaunch and no event bus —
 * the property Planner's #72/#73 established and its regression proved.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const FINANCE_ACCENT = modulePalettes.finance.primary;
const ROW_ID = 'finance-today';

export function useFinanceTimelineEntries(): readonly TimelineEntry[] {
  const finance = useOptionalFinance();
  const { today } = usePlannerDay();

  /*
    No owner, no row. Main Home is a consumer rather than a Finance surface, and a screen that
    crashed because a module store was absent would be a worse failure than a missing line.
  */
  if (finance === null) {
    return [];
  }

  const summary = summariseFinance(finance.ledger, today);

  /*
    Nothing while the first read is in flight, and nothing on a fault. A row that appeared and then
    changed into something else would be worse than none — the same rule the Planner rows follow.
  */
  if (finance.loading || finance.fault !== null) {
    return [];
  }

  /*
    Nothing before a currency exists either. An unconfigured ledger has no transactions by
    construction (#92 refuses them), so a row would be reporting on a ledger that cannot hold
    anything yet.
  */
  if (finance.ledger.currency === null || summary.todayCount === 0) {
    return [];
  }

  return [
    {
      id: ROW_ID,
      /* No clock of its own: the day is the shared source's, and the row is about that whole day. */
      time: 'Today',
      title:
        summary.todayCount === 1 ? '1 entry recorded' : `${summary.todayCount} entries recorded`,
      icon: 'transactions',
      sourceModule: 'finance',
      accent: FINANCE_ACCENT,
    },
  ];
}
