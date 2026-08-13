import {
  faithStorageKeys,
  hasNumber,
  hasString,
  isRecord,
  readJson,
  writeJson,
} from './faith-storage';

/**
 * The user's own notes on individual ayat.
 *
 * ── The identity is the verse, never a position in a list ───────────────────
 * A note is stored against `surah` and `ayah` as numbers, and looked up by the `surah:ayah`
 * reference those two produce. That is deliberate and it is the one rule this file exists to
 * enforce: the reader pages, so the ayah at index 4 of what is on screen is verse 5 of the first
 * page and verse 25 of the second. A note keyed on an index would silently re-attach itself to a
 * different verse the moment the user loaded more of the surah — and a note about 2:255 appearing
 * under 2:275 is not a bug the user can diagnose.
 *
 * The same reference is what a bookmark uses (`faith-bookmarks.ts` stores `18:32`), so a future
 * sync can join the two without a migration.
 *
 * ── A note carries no scripture ─────────────────────────────────────────────
 * `text` is the user's writing and nothing else. There is no field for the Arabic, the translation
 * or a rendering of either, so a note can never become a second, unattributed copy of the verse
 * living outside the approved content boundary. The reader resolves the verse from the repository
 * whenever it needs to show one beside a note.
 *
 * Everything here is local and unencrypted, under the rules recorded in `faith-storage.ts`: it is
 * the user's own reflection, it never leaves the device in this phase, and no credential may join
 * it.
 */

export type AyahNote = {
  readonly surah: number;
  readonly ayah: number;
  /** The user's words. Trimmed of surrounding whitespace, otherwise untouched. */
  readonly text: string;
  readonly createdAt: string;
  readonly updatedAt: string;
};

/** The stable reference a note is filed under, e.g. `4:1`. */
export function verseKey(surah: number, ayah: number): string {
  return `${surah}:${ayah}`;
}

function isAyahNote(value: unknown): value is AyahNote {
  return (
    isRecord(value) &&
    hasNumber(value, 'surah') &&
    hasNumber(value, 'ayah') &&
    hasString(value, 'text') &&
    hasString(value, 'createdAt') &&
    hasString(value, 'updatedAt')
  );
}

function isAyahNoteArray(value: unknown): value is AyahNote[] {
  return Array.isArray(value) && value.every(isAyahNote);
}

export async function readNotes(): Promise<readonly AyahNote[]> {
  return readJson(faithStorageKeys.quranNotes, [] as AyahNote[], isAyahNoteArray);
}

export async function readNote(surah: number, ayah: number): Promise<AyahNote | null> {
  const all = await readNotes();
  return all.find((entry) => entry.surah === surah && entry.ayah === ayah) ?? null;
}

/**
 * Creates or replaces the note on one verse, and reports what it became.
 *
 * ── Saving nothing is a delete, and that is the whole of the delete affordance ─
 * Clearing the field and saving removes the note. The alternative — a note that persists as an
 * empty record — leaves a verse permanently marked as annotated with nothing to read, and it makes
 * "has a note" a fact the reader cannot state honestly. A separate `deleteNote` exists as well,
 * because a delete the user reaches deliberately should not require them to select-all first.
 *
 * `createdAt` survives an edit. The first time the user wrote about a verse is not something a
 * later edit changes.
 */
export async function saveNote(
  surah: number,
  ayah: number,
  text: string,
  now: string,
): Promise<{ readonly note: AyahNote | null; readonly all: readonly AyahNote[] }> {
  const trimmed = text.trim();
  const current = await readNotes();
  const existing = current.find((entry) => entry.surah === surah && entry.ayah === ayah) ?? null;
  const others = current.filter((entry) => !(entry.surah === surah && entry.ayah === ayah));

  if (trimmed === '') {
    await writeJson(faithStorageKeys.quranNotes, others);
    return { note: null, all: others };
  }

  const note: AyahNote = {
    surah,
    ayah,
    text: trimmed,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  const all = [note, ...others];
  await writeJson(faithStorageKeys.quranNotes, all);
  return { note, all };
}

export async function deleteNote(surah: number, ayah: number): Promise<readonly AyahNote[]> {
  const current = await readNotes();
  const all = current.filter((entry) => !(entry.surah === surah && entry.ayah === ayah));
  await writeJson(faithStorageKeys.quranNotes, all);
  return all;
}
