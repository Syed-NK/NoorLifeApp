import { faithStorageKeys, hasString, isRecord, readJson, writeJson } from './faith-storage';

/**
 * Bookmarks across every Faith content type.
 *
 * ── One store rather than three ─────────────────────────────────────────────
 * A bookmark is "this thing, saved" regardless of whether the thing is an ayah, a hadith
 * or a dua. Keying by `${kind}:${id}` gives one list the Bookmarks screen can render in
 * one pass, one toggle the three content screens share, and one place where a future
 * sync writes — instead of three near-identical implementations that drift.
 */

export type BookmarkKind = 'ayah' | 'hadith' | 'dua';

export type Bookmark = {
  readonly kind: BookmarkKind;
  /** Stable identifier within its kind, e.g. `18:32` for an ayah. */
  readonly id: string;
  /** Denormalised so the Bookmarks list renders without nine repository calls. */
  readonly label: string;
  readonly subtitle: string;
  readonly savedAt: string;
};

function isBookmark(value: unknown): value is Bookmark {
  return (
    isRecord(value) &&
    hasString(value, 'kind') &&
    hasString(value, 'id') &&
    hasString(value, 'label') &&
    hasString(value, 'savedAt')
  );
}

function isBookmarkArray(value: unknown): value is Bookmark[] {
  return Array.isArray(value) && value.every(isBookmark);
}

export function bookmarkKey(kind: BookmarkKind, id: string): string {
  return `${kind}:${id}`;
}

export async function readBookmarks(): Promise<readonly Bookmark[]> {
  return readJson(faithStorageKeys.bookmarks, [] as Bookmark[], isBookmarkArray);
}

export async function isBookmarked(kind: BookmarkKind, id: string): Promise<boolean> {
  const all = await readBookmarks();
  return all.some((entry) => entry.kind === kind && entry.id === id);
}

/**
 * Adds or removes, and reports which happened.
 *
 * Returning the resulting state rather than void means the caller re-renders from the
 * persisted truth. A toggle that assumed success would show a filled bookmark for an item
 * that was never saved.
 */
export async function toggleBookmark(
  entry: Omit<Bookmark, 'savedAt'>,
  now: string,
): Promise<{ readonly bookmarked: boolean; readonly all: readonly Bookmark[] }> {
  const current = await readBookmarks();
  const exists = current.some((item) => item.kind === entry.kind && item.id === entry.id);

  const all = exists
    ? current.filter((item) => !(item.kind === entry.kind && item.id === entry.id))
    : [{ ...entry, savedAt: now }, ...current];

  await writeJson(faithStorageKeys.bookmarks, all);
  return { bookmarked: !exists, all };
}

export async function removeBookmark(kind: BookmarkKind, id: string): Promise<readonly Bookmark[]> {
  const current = await readBookmarks();
  const all = current.filter((item) => !(item.kind === kind && item.id === id));
  await writeJson(faithStorageKeys.bookmarks, all);
  return all;
}
