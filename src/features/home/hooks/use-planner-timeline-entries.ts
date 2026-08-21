import { useTodayAgenda } from '@application/providers/today-agenda-provider';
import { modulePalettes } from '@ds/tokens';
import type { TimelineEntry } from '@shared/models/dashboard';

/**
 * **The Planner rows of "Today at a Glance"** — the user's real open tasks due today, or an honest
 * sentence saying there are none.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── What replaced what ─────────────────────────────────────────────────────
 * Three fixtures — School drop-off 8:00, Work focus time 10:00, Family dinner 17:30 — that no user
 * created and no store contained. They are gone. Every row this hook returns is either a task the
 * user made or a statement about the absence of one.
 *
 * The third fixture was a *Family* row. Family owns no task store in this codebase, so it cannot be
 * made real in this change and is simply not claimed. Saying nothing about Family is honest; inventing
 * its dinner was not.
 *
 * ── Why an instructional row rather than the section's empty state ─────────
 * `TodayTimeline` has an honest empty state, but it renders only when the *whole* section is empty —
 * and the section also carries the live prayer row, which is real and must stay. So "you have no tasks
 * today" is expressed the way the prayer row already expresses "I have no location": one row, no time,
 * and a title that is a statement rather than an event. That pattern is established in this component,
 * the accessible-name builder already drops an empty time, and the locked geometry is untouched.
 *
 * A row is also the only shape that keeps a route to Planner: tapping it goes to Planner exactly as a
 * task row would, or raises the upgrade explanation when Planner is locked.
 *
 * ── This hook makes no claim it cannot support ─────────────────────────────
 * It reads a port that reports `loading`, `ready` or `unavailable` and says something different for
 * each. It never falls back to sample data — there is no sample data left to fall back to.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/** Stable ids, so a state row and a task row can never collide in a keyed list. */
const EMPTY_ROW_ID = 'planner-nothing-today';
const UNAVAILABLE_ROW_ID = 'planner-unavailable';

/**
 * The accent every Planner row carries.
 *
 * Planner's own palette primary, taken from the design tokens rather than written here — a literal
 * would be a new colour entering a reopened Main Home file, which the design lock forbids.
 */
const PLANNER_ACCENT = modulePalettes.planner.primary;

const BASE = {
  icon: 'tasks' as const,
  sourceModule: 'planner' as const,
  accent: PLANNER_ACCENT,
};

export function usePlannerTimelineEntries(): readonly TimelineEntry[] {
  const agenda = useTodayAgenda();

  if (agenda.status === 'loading') {
    /*
      Nothing at all while Planner's first read is in flight. The dashboard holds its skeleton until
      the agenda settles, so this branch is normally invisible; contributing a placeholder row that
      appeared and then changed into something else would be worse than contributing none.
    */
    return [];
  }

  if (agenda.status === 'unavailable') {
    return [
      {
        ...BASE,
        id: UNAVAILABLE_ROW_ID,
        time: '',
        title: 'Your plan is unavailable — open Planner',
      },
    ];
  }

  if (agenda.items.length === 0) {
    return [{ ...BASE, id: EMPTY_ROW_ID, time: '', title: 'Nothing planned for today' }];
  }

  /*
    Order is Planner's, untouched. `time` arrives already formatted by Planner, and `title` is the
    user's own text. Notes are not in the port's shape at all, so no summary surface can render the
    private prose somebody wrote on the Tasks screen.
  */
  return agenda.items.map((item) => ({
    ...BASE,
    id: item.id,
    time: item.time,
    title: item.title,
  }));
}
