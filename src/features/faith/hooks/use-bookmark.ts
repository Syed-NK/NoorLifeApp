import { useCallback, useEffect, useState } from 'react';

import {
  isBookmarked as readIsBookmarked,
  toggleBookmark,
  type Bookmark,
  type BookmarkKind,
} from '../storage/faith-bookmarks';

/**
 * The bookmark toggle contract, for one item.
 *
 * ── Why the state comes back from storage rather than being assumed ─────────
 * `toggle` awaits the write and sets state from what the store reports, not from
 * `!bookmarked`. On a storage failure the icon therefore stays as it was, which is
 * honest — an optimistic toggle would show a filled bookmark for something that was
 * never saved, and the user would only find out when the Bookmarks screen was empty.
 */

export type UseBookmark = {
  readonly bookmarked: boolean;
  /** Resolves once the write has settled. */
  readonly toggle: () => Promise<void>;
  readonly ready: boolean;
};

export function useBookmark(entry: Omit<Bookmark, 'savedAt'>): UseBookmark {
  const [bookmarked, setBookmarked] = useState(false);
  const [ready, setReady] = useState(false);

  const { kind, id } = entry;

  useEffect(() => {
    let active = true;
    void readIsBookmarked(kind, id).then((value) => {
      if (active) {
        setBookmarked(value);
        setReady(true);
      }
    });
    return () => {
      active = false;
    };
  }, [kind, id]);

  const toggle = useCallback(async () => {
    const result = await toggleBookmark(entry, new Date().toISOString());
    setBookmarked(result.bookmarked);
    // `entry` is a fresh object each render, so it is destructured to its stable parts
    // for the dependency list rather than depended on wholesale.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, id, entry.label, entry.subtitle]);

  return { bookmarked, toggle, ready };
}

/** Kinds in the order the Bookmarks screen groups them. */
export const bookmarkKindOrder: readonly BookmarkKind[] = ['ayah', 'hadith', 'dua'];

export const bookmarkKindLabel: Readonly<Record<BookmarkKind, string>> = {
  ayah: 'Qur’an',
  hadith: 'Hadith',
  dua: 'Duas',
};
