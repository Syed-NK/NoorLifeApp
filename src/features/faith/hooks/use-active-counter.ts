import { useMemo } from 'react';

import { referenceLabel, type CuratedDhikrReference } from '../data/dhikr/quran-dhikr-catalogue';
import { reviewedQuranDuas } from '../data/dhikr/reviewed-dua-manifest';
import {
  isSelectionCounterId,
  selectionReferenceLabel,
  type QuranSelection,
  type QuranSelectionRef,
} from '../data/quran-selection/quran-selection';
import type { SelectionResolution } from '../data/quran-selection/retained-selection.resolver';
import type { CounterLabel } from '../data/tasbih.repository';
import { DEFAULT_COUNTER } from '../data/tasbih/local-tasbih.repository';
import { useQuranSelections } from './use-quran-selections';

/**
 * What the counter is currently counting, resolved for display.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── Three kinds of counter, one place that tells them apart ────────────────
 * A private label the user wrote, a Quran selection they chose, or a scholarly-reviewed entry. They
 * are counted identically and displayed differently, and the difference is not cosmetic: a private
 * note must never be presented as something NoorLife vouched for, and a reviewed entry must never
 * lose the review that makes it one.
 *
 * Deciding which is which lives here rather than in the screen, because three screens ask the
 * question and a fourth will, and "does this id start with `q.`?" spread across four call sites is
 * four chances to get it wrong in a direction that mislabels scripture.
 *
 * ── Why the reviewed branch resolves through the retained generation too ───
 * `useQuranDhikr` resolves reviewed entries through `QuranContentRepository`, which can reach the
 * network. That is right for the selector, which is a browsing surface. It is wrong for the counter,
 * where mounting it would put a request behind a screen whose job is to count — on every open.
 *
 * A reviewed entry is a surah and a range, exactly like a selection, so the same offline resolver
 * answers both. The branch is real and currently unreachable, because the reviewed manifest holds
 * nothing; it is written now so that populating the manifest is a data change rather than a screen
 * change.
 *
 * ── `none` is a real state and is not an error ─────────────────────────────
 * A counter id with no label, no selection and no reviewed entry behind it is a counter whose
 * subject was removed. The count is still the user's and is still shown; what is not shown is a
 * guess about what it was for. It is never silently swapped for another entry — a substitution here
 * would attach somebody's count to scripture they did not choose.
 * ═══════════════════════════════════════════════════════════════════════════
 */

export type ActiveCounterView =
  /** The neutral default, or a private label. NoorLife makes no claim about it. */
  | { readonly kind: 'personal'; readonly label: CounterLabel }
  /** The user's own Quran selection. Labelled as theirs wherever it appears. */
  | {
      readonly kind: 'selection';
      readonly selection: QuranSelection;
      readonly resolution: SelectionResolution;
      readonly reference: string;
    }
  /** A reference a named reviewer approved. Zero of these exist until a manifest supplies them. */
  | {
      readonly kind: 'reviewed';
      readonly entry: CuratedDhikrReference;
      readonly resolution: SelectionResolution;
      readonly reference: string;
    }
  /** Nothing is selected, or what was selected no longer exists. */
  | { readonly kind: 'none' };

export type UseActiveCounter = {
  readonly loading: boolean;
  readonly view: ActiveCounterView;
};

/** The reference a reviewed entry names, in the shape the offline resolver takes. */
function refOf(entry: CuratedDhikrReference): QuranSelectionRef {
  return { surah: entry.surah, startAyah: entry.startAyah, endAyah: entry.endAyah };
}

export function useActiveCounter(
  counterId: string | null,
  labels: readonly CounterLabel[],
): UseActiveCounter {
  const selections = useQuranSelections();
  const { resolve } = selections;

  const reviewed = useMemo(() => reviewedQuranDuas(), []);

  const view = useMemo<ActiveCounterView>(() => {
    if (counterId === null) {
      return { kind: 'none' };
    }

    if (isSelectionCounterId(counterId)) {
      const selection = selections.selections.find((item) => item.id === counterId);
      if (selection === undefined) {
        /*
          The selection was removed while its counter stayed active. Reported as nothing rather than
          as a blank selection: the count survives and the screen says what is true, which is that
          there is nothing selected.
        */
        return { kind: 'none' };
      }
      return {
        kind: 'selection',
        selection,
        resolution: resolve(selection),
        reference: selectionReferenceLabel(selection),
      };
    }

    const entry = reviewed.find((item) => item.id === counterId);
    if (entry !== undefined) {
      return {
        kind: 'reviewed',
        entry,
        resolution: resolve(refOf(entry)),
        reference: referenceLabel(entry),
      };
    }

    const label = labels.find((item) => item.id === counterId);
    return label === undefined ? { kind: 'none' } : { kind: 'personal', label };
  }, [counterId, labels, reviewed, selections.selections, resolve]);

  return { loading: selections.loading, view };
}

/**
 * The one-line name of what is being counted, or `null` when nothing has been chosen.
 *
 * A reference for a selection, the reviewer-supplied title for a reviewed entry, the user's own
 * words for a personal counter. Never a phrase NoorLife composed for scripture, and never the
 * Arabic — a truncated verse in a caption slot is a verse rendered wrongly.
 *
 * ── The neutral default counts as "nothing chosen" ─────────────────────────
 * It is the counter every install starts on, before anybody has chosen anything, and it is itself
 * called "My counter" — so naming it here would print the control card's own second row back into
 * its first, and would replace an honest empty state with a label that reads like a choice somebody
 * made. `null` keeps the row saying "Not selected" and keeps the action that fixes that in view.
 */
export function counterSummaryLine(view: ActiveCounterView): string | null {
  switch (view.kind) {
    case 'personal':
      return view.label.id === DEFAULT_COUNTER.id ? null : view.label.name;
    case 'selection':
      return view.selection.label ?? `Qur’an ${view.reference}`;
    case 'reviewed':
      return view.entry.title;
    case 'none':
      return null;
  }
}

/**
 * What the counter is called, for something that is spoken rather than laid out.
 *
 * ── Why this is not `counterSummaryLine` ───────────────────────────────────
 * That one returns `null` for the neutral default, because the *visible* value slot sits directly
 * above a row that already says "My counter" and printing it twice is a layout mistake dressed as
 * information.
 *
 * A screen reader has no such adjacency. Somebody hearing "0 of 33" needs to know what they are
 * counting, and answering "Your counter" where the counter has a name is strictly less than the
 * screen shows. So the spoken form always names it, and the two functions differ precisely where
 * the two media do.
 */
export function counterSpokenName(view: ActiveCounterView): string {
  switch (view.kind) {
    case 'personal':
      return view.label.name;
    case 'selection':
      return view.selection.label === null
        ? `Qur’an ${view.reference}`
        : `${view.selection.label}. Qur’an ${view.reference}`;
    case 'reviewed':
      return `${view.entry.title}. Qur’an ${view.reference}`;
    case 'none':
      return 'Nothing selected';
  }
}
