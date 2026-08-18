import { useCallback, useEffect, useState } from 'react';

import {
  deleteNote,
  readNote,
  readNotes,
  saveNote,
  verseKey,
  type AyahNote,
} from '../storage/faith-notes';

/**
 * The note on one verse, with write-through updates.
 *
 * ── State comes back from storage, never from the draft ─────────────────────
 * `save` awaits the write and sets state from what the store reports, for the reason
 * `use-bookmark.ts` records: a hook that set state from its own argument would show the user a
 * saved note that was never persisted, and they would find out on the next launch. The same is why
 * `remove` reads its result rather than assuming `null`.
 *
 * Keyed on the verse, so pointing the hook at another ayah re-reads rather than carrying the
 * previous verse's note across — which is the defect the `surah:ayah` identity exists to prevent.
 */

export type UseAyahNote = {
  readonly note: AyahNote | null;
  readonly ready: boolean;
  /** Saving an empty string deletes. Resolves once the write has settled. */
  readonly save: (text: string) => Promise<void>;
  readonly remove: () => Promise<void>;
};

export function useAyahNote(surah: number, ayah: number): UseAyahNote {
  const [note, setNote] = useState<AyahNote | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;
    /*
      `ready` is deliberately *not* reset here. It starts false, and the only way a second read is
      triggered is the hook being pointed at another verse — which in this module means a new sheet,
      and therefore a fresh mount. Clearing it would be a synchronous `setState` inside an effect,
      which cascades a render and which this project's lint rules fail the build on.
    */
    void readNote(surah, ayah).then((stored) => {
      if (active) {
        setNote(stored);
        setReady(true);
      }
    });
    return () => {
      active = false;
    };
  }, [surah, ayah]);

  const save = useCallback(
    async (text: string) => {
      const result = await saveNote(surah, ayah, text, new Date().toISOString());
      setNote(result.note);
    },
    [surah, ayah],
  );

  const remove = useCallback(async () => {
    await deleteNote(surah, ayah);
    setNote(null);
  }, [surah, ayah]);

  return { note, ready, save, remove };
}

/**
 * Which verses on the page have a note, as a set of `surah:ayah` references.
 *
 * ── Why the reader holds an index rather than a hook per verse ──────────────
 * The verse blocks announce "has a note" as part of their accessibility label, and a 286-ayah surah
 * would otherwise mount 286 copies of `useAyahNote`, each reading the whole stored list to answer a
 * question about one verse. One read, one set, and the reader refreshes it when the sheet that can
 * change it closes.
 */
export type UseNoteIndex = {
  readonly keys: ReadonlySet<string>;
  readonly refresh: () => void;
};

export function useNoteIndex(): UseNoteIndex {
  const [keys, setKeys] = useState<ReadonlySet<string>>(() => new Set());
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let active = true;
    void readNotes().then((stored) => {
      if (active) {
        setKeys(new Set(stored.map((note) => verseKey(note.surah, note.ayah))));
      }
    });
    return () => {
      active = false;
    };
  }, [tick]);

  const refresh = useCallback(() => setTick((value) => value + 1), []);

  return { keys, refresh };
}
