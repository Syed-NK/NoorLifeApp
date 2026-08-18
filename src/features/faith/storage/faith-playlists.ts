import {
  faithStorageKeys,
  hasNumber,
  hasString,
  isRecord,
  readJson,
  writeJson,
} from './faith-storage';

/**
 * Listening playlists: named, ordered lists of verses the user chose to keep together.
 *
 * ── What a playlist entry is, and what it deliberately is not ───────────────
 * An entry is a **reference** — a surah, an ayah and the reciter it was added under — and never
 * content. There is no URL, no host and no audio here, so a playlist cannot become a second store
 * of licensed recitation living outside the offline manifest `faith-offline-recitation.ts` owns.
 * Playing an entry resolves it back through `QuranContentRepository.listRecitations`, which is the
 * same boundary the reader itself plays through.
 *
 * The reciter travels with the entry rather than being read from preferences at playback time. A
 * user who built a list while listening to one reciter and later changed their default did not ask
 * for the list to change voice, and a reference that omitted the reciter could not tell the
 * difference.
 *
 * ── A verse appears in a playlist once ──────────────────────────────────────
 * Membership is keyed on `surah:ayah`, not on `surah:ayah:reciter`. Two recordings of the same
 * verse are the same verse, and a list that held 2:255 twice because it was added under two
 * reciters would play it twice with no way for the user to see why. `addVerse` therefore reports a
 * duplicate rather than silently appending or silently discarding — the caller has to say
 * something.
 */

export type PlaylistEntry = {
  readonly surah: number;
  readonly ayah: number;
  /** The reciter the verse was added under. Preserved, never re-read from preferences. */
  readonly reciterId: string;
  readonly addedAt: string;
};

export type Playlist = {
  /** Stable, derived from the name at creation. Never re-derived, so a rename cannot orphan it. */
  readonly id: string;
  readonly name: string;
  readonly createdAt: string;
  readonly entries: readonly PlaylistEntry[];
};

/** What adding a verse did. Every outcome is reportable; none of them is silent. */
export type PlaylistAddOutcome =
  | { readonly kind: 'added'; readonly playlists: readonly Playlist[] }
  /** The verse is already in this playlist. Nothing was written. */
  | { readonly kind: 'duplicate'; readonly playlists: readonly Playlist[] }
  /** The playlist id does not exist — a list deleted on another screen. */
  | { readonly kind: 'missing'; readonly playlists: readonly Playlist[] };

function isEntry(value: unknown): value is PlaylistEntry {
  return (
    isRecord(value) &&
    hasNumber(value, 'surah') &&
    hasNumber(value, 'ayah') &&
    hasString(value, 'reciterId') &&
    hasString(value, 'addedAt')
  );
}

function isPlaylist(value: unknown): value is Playlist {
  return (
    isRecord(value) &&
    hasString(value, 'id') &&
    hasString(value, 'name') &&
    hasString(value, 'createdAt') &&
    Array.isArray(value.entries) &&
    value.entries.every(isEntry)
  );
}

function isPlaylistArray(value: unknown): value is Playlist[] {
  return Array.isArray(value) && value.every(isPlaylist);
}

/** The longest name the selector will store. Long enough to be descriptive, short enough to render. */
export const MAX_PLAYLIST_NAME = 60;

/**
 * A playlist id, derived from its name and made unique against the lists that already exist.
 *
 * Derived rather than random for one reason: `Math.random` and `Date.now` make a stored value that
 * cannot be asserted, and the whole point of persisting a playlist is that a test can prove it came
 * back. A name that collides gets a numeric suffix, which is also what makes two lists the user
 * genuinely called the same thing distinguishable.
 */
export function playlistIdFor(name: string, existing: readonly Playlist[]): string {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'playlist';

  if (!existing.some((list) => list.id === base)) {
    return base;
  }
  let suffix = 2;
  while (existing.some((list) => list.id === `${base}-${suffix}`)) {
    suffix += 1;
  }
  return `${base}-${suffix}`;
}

export function containsVerse(playlist: Playlist, surah: number, ayah: number): boolean {
  return playlist.entries.some((entry) => entry.surah === surah && entry.ayah === ayah);
}

export async function readPlaylists(): Promise<readonly Playlist[]> {
  return readJson(faithStorageKeys.quranPlaylists, [] as Playlist[], isPlaylistArray);
}

/**
 * Creates an empty playlist, or returns the existing one when the name is already taken.
 *
 * Matching on the trimmed, case-folded name means "New playlist → Morning" twice produces one list
 * rather than two the user cannot tell apart in a selector.
 */
export async function createPlaylist(
  name: string,
  now: string,
): Promise<{ readonly playlist: Playlist; readonly playlists: readonly Playlist[] }> {
  const trimmed = name.trim().slice(0, MAX_PLAYLIST_NAME);
  const current = await readPlaylists();
  const existing = current.find(
    (list) => list.name.trim().toLowerCase() === trimmed.toLowerCase() && trimmed !== '',
  );
  if (existing !== undefined) {
    return { playlist: existing, playlists: current };
  }

  const playlist: Playlist = {
    id: playlistIdFor(trimmed, current),
    name: trimmed === '' ? 'Playlist' : trimmed,
    createdAt: now,
    entries: [],
  };
  const playlists = [...current, playlist];
  await writeJson(faithStorageKeys.quranPlaylists, playlists);
  return { playlist, playlists };
}

export async function addVerse(
  playlistId: string,
  entry: Omit<PlaylistEntry, 'addedAt'>,
  now: string,
): Promise<PlaylistAddOutcome> {
  const current = await readPlaylists();
  const target = current.find((list) => list.id === playlistId);
  if (target === undefined) {
    return { kind: 'missing', playlists: current };
  }
  if (containsVerse(target, entry.surah, entry.ayah)) {
    // Reported, not written and not silently dropped. See the note at the head of this file.
    return { kind: 'duplicate', playlists: current };
  }

  const playlists = current.map((list) =>
    list.id === playlistId
      ? { ...list, entries: [...list.entries, { ...entry, addedAt: now }] }
      : list,
  );
  await writeJson(faithStorageKeys.quranPlaylists, playlists);
  return { kind: 'added', playlists };
}

export async function removeVerse(
  playlistId: string,
  surah: number,
  ayah: number,
): Promise<readonly Playlist[]> {
  const current = await readPlaylists();
  const playlists = current.map((list) =>
    list.id === playlistId
      ? {
          ...list,
          entries: list.entries.filter((entry) => !(entry.surah === surah && entry.ayah === ayah)),
        }
      : list,
  );
  await writeJson(faithStorageKeys.quranPlaylists, playlists);
  return playlists;
}

export async function deletePlaylist(playlistId: string): Promise<readonly Playlist[]> {
  const current = await readPlaylists();
  const playlists = current.filter((list) => list.id !== playlistId);
  await writeJson(faithStorageKeys.quranPlaylists, playlists);
  return playlists;
}
