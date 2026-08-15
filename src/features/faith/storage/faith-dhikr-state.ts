import { faithStorageKeys, isRecord, isStringArray, readJson, writeJson } from './faith-storage';

/**
 * The user's own Dhikr state: what they favourited, what they chose, what they used recently.
 *
 * ── Why this is a separate key from the content cache ───────────────────────
 * Because it is retained under a different rule, indefinitely, and the separation is the mechanism
 * that guarantees it. Quran Foundation's permission is explicit that favorites, selected references,
 * recents, counts and targets may be kept **indefinitely**, while cached Arabic and translations are
 * subject to refresh and expiry. One blob with one timestamp would make a translation ageing out
 * capable of taking a user's counter history with it — the single worst failure available to this
 * feature, because it is silent, it is unrecoverable, and it punishes the user for the app's
 * housekeeping.
 *
 * So: `faith-dhikr-cache.ts` holds content and expires. This holds **references and the user's own
 * decisions** and never expires. Nothing here is Quran Foundation content: a catalogue id and a
 * timestamp are NoorLife's own data about NoorLife's own catalogue.
 *
 * ── The selection is a reference, never text ────────────────────────────────
 * `selectedEntryId` is a catalogue id. It is deliberately not a copy of the Arabic, the translation
 * or the title: a copied string would be an uncontrolled duplicate of scripture living in user
 * storage, outside the refresh path, immune to a correction upstream, and still on the device after
 * the entry was withdrawn. The id resolves through the catalogue every time.
 */

export type DhikrUserState = {
  /**
   * The Quran-derived entry currently selected, or `null` when a personal counter is.
   *
   * A reference, so the Tasbih row re-resolves it and picks up any correction. An id that is no
   * longer approved resolves to nothing and the screen says the selection is unavailable — it is
   * never silently swapped for another entry.
   */
  readonly selectedEntryId: string | null;
  readonly favouriteEntryIds: readonly string[];
  /** Most recent first. Bounded, because a recents list is a shortcut and not a history. */
  readonly recentEntryIds: readonly string[];
};

export const MAX_RECENT_DHIKR = 8;

export const defaultDhikrUserState: DhikrUserState = {
  selectedEntryId: null,
  favouriteEntryIds: [],
  recentEntryIds: [],
};

function isState(value: unknown): value is DhikrUserState {
  return (
    isRecord(value) &&
    (value.selectedEntryId === null || typeof value.selectedEntryId === 'string') &&
    isStringArray(value.favouriteEntryIds) &&
    isStringArray(value.recentEntryIds)
  );
}

export async function readDhikrUserState(): Promise<DhikrUserState> {
  return readJson<DhikrUserState>(faithStorageKeys.dhikrUserState, defaultDhikrUserState, isState);
}

export async function writeDhikrUserState(patch: Partial<DhikrUserState>): Promise<DhikrUserState> {
  const current = await readDhikrUserState();
  const next: DhikrUserState = { ...current, ...patch };
  await writeJson(faithStorageKeys.dhikrUserState, next);
  return next;
}

/** Adds or removes a favourite, preserving the order the user added them in. */
export async function toggleDhikrFavourite(entryId: string): Promise<DhikrUserState> {
  const current = await readDhikrUserState();
  const favouriteEntryIds = current.favouriteEntryIds.includes(entryId)
    ? current.favouriteEntryIds.filter((id) => id !== entryId)
    : [...current.favouriteEntryIds, entryId];
  return writeDhikrUserState({ favouriteEntryIds });
}

/**
 * Records that an entry was selected: it becomes current, and moves to the front of recents.
 *
 * The id is removed before it is prepended, so choosing the same entry twice does not put it in the
 * list twice — a recents list with duplicates is a list that slowly becomes one item.
 */
export async function recordDhikrSelection(entryId: string): Promise<DhikrUserState> {
  const current = await readDhikrUserState();
  const recentEntryIds = [entryId, ...current.recentEntryIds.filter((id) => id !== entryId)].slice(
    0,
    MAX_RECENT_DHIKR,
  );
  return writeDhikrUserState({ selectedEntryId: entryId, recentEntryIds });
}

/**
 * Forgets a reference that the catalogue no longer approves.
 *
 * ── What this deliberately does not touch ───────────────────────────────────
 * Counts. A withdrawn reference stops being *selectable* and stops appearing in favourites and
 * recents, because continuing to offer it would be offering content NoorLife may no longer show. The
 * user's counter history is in the Tasbih store and is not consulted here, under the permission's
 * indefinite retention of user state: what they counted, they counted.
 */
export async function forgetUnapprovedDhikr(
  approvedIds: ReadonlySet<string>,
): Promise<DhikrUserState> {
  const current = await readDhikrUserState();
  return writeDhikrUserState({
    selectedEntryId:
      current.selectedEntryId !== null && approvedIds.has(current.selectedEntryId)
        ? current.selectedEntryId
        : null,
    favouriteEntryIds: current.favouriteEntryIds.filter((id) => approvedIds.has(id)),
    recentEntryIds: current.recentEntryIds.filter((id) => approvedIds.has(id)),
  });
}
