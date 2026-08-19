import {
  MAX_SELECTION_AYAT,
  normaliseSelectionLabel,
  sanitiseSelection,
  selectionIdFor,
  type QuranSelection,
  type QuranSelectionRef,
} from '../data/quran-selection/quran-selection';
import { faithStorageKeys, readJson, writeChecked } from './faith-storage';

/**
 * The user's own Quran selections — **references and decisions, never scripture.**
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── The one rule, and how it is guaranteed rather than promised ────────────
 * Not one character of Arabic, translation or transliteration is written here. That is not enforced
 * by a review convention or a comment asking people to be careful: every record that goes in is
 * rebuilt by `sanitiseSelection` from a fixed allow-list of eight fields, so a caller that handed
 * this module a *resolved* selection — reference plus verses plus translator — stores the reference
 * and silently drops the rest. There is no path on which the text could be persisted, which is what
 * makes `quran-selection-privacy.test.ts` able to prove it by writing scripture in and reading the
 * store back.
 *
 * Two independent reasons, and either alone would be sufficient:
 *
 *   • **The licence.** Quran Foundation's grant covers retaining *user favorites, selected
 *     references, recents, counts and targets indefinitely* (§2 A4). It does not make this key a
 *     second, unmanaged copy of the mushaf sitting outside the refresh obligations that govern the
 *     generation — and a copy here would be exactly that: never refreshed, never corrected, immune
 *     to a withdrawal, and still on the device long after the reader's copy was replaced.
 *   • **Correctness.** Text resolved at render time is whatever the publisher currently says. Text
 *     copied at save time is whatever they said the day somebody tapped Save.
 *
 * ── Why this is a separate key from the dhikr user state ───────────────────
 * `faith-dhikr-state.ts` holds the user's state about the **reviewed catalogue** — ids of entries a
 * qualified reviewer approved. This holds the user's **own** selections, which nobody reviewed and
 * which NoorLife makes no claim about. Merging them into one list would be one blob in which a
 * private choice and a scholarly-reviewed reference are the same kind of thing, and the whole
 * product boundary between them rests on their not being.
 *
 * ── Account ownership ──────────────────────────────────────────────────────
 * `quranSelections` is in `USER_SCOPED_KEY_NAMES`, so every address carries its owner. Signed out
 * there is no owner, reads return the empty list and writes are dropped — see `faith-storage.ts`.
 * A second account on the same phone cannot name this account's address, so it cannot read these
 * selections, their labels, their favourites or when they were last used.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/**
 * How many selections one account may keep.
 *
 * A bound rather than none, for the ordinary reason: AsyncStorage is one SQLite database with a
 * shared cursor window, and an unbounded list of user records in it is the shape of a failure that
 * only appears on a real device after months of use. Two hundred references is a few kilobytes and
 * far more than a personal list of passages ever becomes.
 */
export const MAX_QURAN_SELECTIONS = 200;

/** The stored shape's version. A bump discards prior entries rather than migrating them. */
const SELECTIONS_VERSION = 1;

type StoredSelections = {
  readonly version: number;
  readonly selections: readonly QuranSelection[];
};

/**
 * Every stored selection, newest first, with anything unreadable dropped.
 *
 * Total: a corrupt blob, an absent key or a store that will not answer all yield the empty list.
 * A Faith screen must not fail to render because one record would not parse.
 */
export async function readQuranSelections(): Promise<readonly QuranSelection[]> {
  const stored = await readJson<StoredSelections | null>(
    faithStorageKeys.quranSelections,
    null,
    (value): value is StoredSelections | null =>
      value === null ||
      (typeof value === 'object' &&
        value !== null &&
        !Array.isArray(value) &&
        Array.isArray((value as StoredSelections).selections)),
  );
  if (stored === null || stored.version !== SELECTIONS_VERSION) {
    return [];
  }
  /*
    Sanitised on the way out as well as on the way in. The two are not redundant: a record written by
    a build older than the current allow-list is only ever seen on this path, and dropping the fields
    it no longer may hold is what stops them reaching a screen.
  */
  const clean: QuranSelection[] = [];
  const seen = new Set<string>();
  for (const raw of stored.selections) {
    const selection = sanitiseSelection(raw);
    if (selection === null || seen.has(selection.id)) {
      continue;
    }
    seen.add(selection.id);
    clean.push(selection);
  }
  return clean;
}

/** Writes the list, sanitising every record. Reports failure, because a lost save must be visible. */
async function writeSelections(selections: readonly QuranSelection[]): Promise<boolean> {
  const clean = selections
    .map((selection) => sanitiseSelection(selection))
    .filter((selection): selection is QuranSelection => selection !== null)
    .slice(0, MAX_QURAN_SELECTIONS);
  const payload: StoredSelections = { version: SELECTIONS_VERSION, selections: clean };
  return writeChecked(faithStorageKeys.quranSelections, payload);
}

export type SaveSelectionOutcome =
  | { readonly kind: 'saved'; readonly selection: QuranSelection; readonly created: boolean }
  | { readonly kind: 'failed'; readonly reason: 'write-failed' | 'limit-reached' };

/**
 * Saves a reference, or updates the label on the one already there.
 *
 * ── Saving twice is not an error and does not duplicate ────────────────────
 * The id is the reference, so the second save of 2:255 finds the first. It keeps the original
 * `createdAt` and its favourite state — a user re-saving a verse has not un-favourited it — and
 * takes the new label only when one was supplied. Returning `created: false` lets the screen say
 * "already saved" rather than implying a second copy now exists.
 *
 * The range must already have been checked against the surah's length by the caller, which is the
 * only place the length is known. `sanitiseSelection` re-checks everything that can be checked
 * without it.
 */
export async function saveQuranSelection(
  ref: QuranSelectionRef,
  label: string | null = null,
  now: () => number = Date.now,
): Promise<SaveSelectionOutcome> {
  const id = selectionIdFor(ref);
  const current = await readQuranSelections();
  const existing = current.find((selection) => selection.id === id);

  if (existing === undefined && current.length >= MAX_QURAN_SELECTIONS) {
    return { kind: 'failed', reason: 'limit-reached' };
  }

  const normalised = normaliseSelectionLabel(label);
  const next: QuranSelection = {
    id,
    surah: ref.surah,
    startAyah: ref.startAyah,
    endAyah: ref.endAyah,
    label: normalised ?? existing?.label ?? null,
    favourite: existing?.favourite ?? false,
    createdAt: existing?.createdAt ?? now(),
    lastUsedAt: existing?.lastUsedAt ?? null,
  };

  const sanitised = sanitiseSelection(next);
  if (sanitised === null) {
    /* The range did not survive its own check. Refused rather than stored malformed. */
    return { kind: 'failed', reason: 'write-failed' };
  }

  const written = await writeSelections([
    sanitised,
    ...current.filter((selection) => selection.id !== id),
  ]);
  return written
    ? { kind: 'saved', selection: sanitised, created: existing === undefined }
    : { kind: 'failed', reason: 'write-failed' };
}

/** Removes one selection. Its Tasbih counting state is not touched — see `forgetSelectionCounter`. */
export async function removeQuranSelection(id: string): Promise<readonly QuranSelection[]> {
  const current = await readQuranSelections();
  const remaining = current.filter((selection) => selection.id !== id);
  await writeSelections(remaining);
  return remaining;
}

/** Adds or removes a favourite. */
export async function toggleQuranSelectionFavourite(
  id: string,
): Promise<readonly QuranSelection[]> {
  const current = await readQuranSelections();
  const next = current.map((selection) =>
    selection.id === id ? { ...selection, favourite: !selection.favourite } : selection,
  );
  await writeSelections(next);
  return next;
}

/** Replaces the user's note on one selection. An empty note clears it. */
export async function labelQuranSelection(
  id: string,
  label: string | null,
): Promise<readonly QuranSelection[]> {
  const current = await readQuranSelections();
  const next = current.map((selection) =>
    selection.id === id ? { ...selection, label: normaliseSelectionLabel(label) } : selection,
  );
  await writeSelections(next);
  return next;
}

/**
 * Stamps a selection as used, which is what puts it in Recently used.
 *
 * Called when it is sent to Tasbih or opened in the Reader — the two things that constitute using
 * one. Deliberately **not** called by rendering a list: a screen that stamped every row it drew
 * would make "recently used" mean "recently scrolled past".
 */
export async function markQuranSelectionUsed(
  id: string,
  now: () => number = Date.now,
): Promise<readonly QuranSelection[]> {
  const current = await readQuranSelections();
  const next = current.map((selection) =>
    selection.id === id ? { ...selection, lastUsedAt: now() } : selection,
  );
  await writeSelections(next);
  return next;
}

/** The favourites, in the order they were saved. */
export function favouriteSelections(
  selections: readonly QuranSelection[],
): readonly QuranSelection[] {
  return selections.filter((selection) => selection.favourite);
}

/**
 * The ones actually used, most recent first.
 *
 * `limit` is a display bound, not a retention one: nothing is deleted for falling off the end, so a
 * selection used a year ago is still in My selections with its favourite state and its label.
 */
export function recentSelections(
  selections: readonly QuranSelection[],
  limit = 8,
): readonly QuranSelection[] {
  return selections
    .filter((selection) => selection.lastUsedAt !== null)
    .slice()
    .sort((left, right) => (right.lastUsedAt ?? 0) - (left.lastUsedAt ?? 0))
    .slice(0, limit);
}

/** Re-exported so a caller enforcing the range bound imports one module. */
export { MAX_SELECTION_AYAT };
