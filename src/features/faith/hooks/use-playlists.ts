import { useCallback, useEffect, useState } from 'react';

import {
  addVerse,
  createPlaylist,
  readPlaylists,
  type Playlist,
  type PlaylistAddOutcome,
  type PlaylistEntry,
} from '../storage/faith-playlists';

/**
 * The user's listening playlists, with write-through updates.
 *
 * ── `add` returns the outcome rather than swallowing it ─────────────────────
 * Adding a verse that is already in the list is not a failure and it is not a success either — it
 * is a third thing the user has to be told about, because otherwise a tap that appears to work
 * leaves the list exactly as it was. The outcome is handed back so the screen can say which of the
 * three happened, which is the requirement "prevent duplicate entries or clearly communicate
 * duplicates" expressed as a return type instead of a convention.
 */

export type UsePlaylists = {
  readonly playlists: readonly Playlist[];
  readonly ready: boolean;
  /** Creates, or returns the existing list when the name is already taken. */
  readonly create: (name: string) => Promise<Playlist>;
  readonly add: (
    playlistId: string,
    entry: Omit<PlaylistEntry, 'addedAt'>,
  ) => Promise<PlaylistAddOutcome['kind']>;
};

export function usePlaylists(): UsePlaylists {
  const [playlists, setPlaylists] = useState<readonly Playlist[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;
    void readPlaylists().then((stored) => {
      if (active) {
        setPlaylists(stored);
        setReady(true);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  const create = useCallback(async (name: string) => {
    const result = await createPlaylist(name, new Date().toISOString());
    setPlaylists(result.playlists);
    return result.playlist;
  }, []);

  const add = useCallback(async (playlistId: string, entry: Omit<PlaylistEntry, 'addedAt'>) => {
    const outcome = await addVerse(playlistId, entry, new Date().toISOString());
    setPlaylists(outcome.playlists);
    return outcome.kind;
  }, []);

  return { playlists, ready, create, add };
}
