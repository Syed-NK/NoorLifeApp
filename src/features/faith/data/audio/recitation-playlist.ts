import type { AyahRecitation } from '../quran-content.repository';

/**
 * The ordered set of local tracks one surah's playback is built from.
 *
 * ── Why the playlist is a validated model rather than an array of URIs ──────
 * Because the thing being ordered is the Qur'an. The architecture this replaces asked the transport
 * "what is at index N of the recitation list?" and trusted the answer; the reader's deep-link defect
 * came from exactly that habit, and a mis-ordered *playlist* would be the same class of error with
 * audio instead of text — a verse recited under another verse's number, with nothing on screen
 * disagreeing.
 *
 * So a track carries its own identity, `<reciter>:<surah>:<ayah>`, the build refuses anything it
 * cannot vouch for, and nothing downstream derives a reference from a position. The native player is
 * handed a list it cannot misinterpret because every element already says what it is.
 */

/**
 * The stable name of one track: `3:93:5` — reciter resource, surah, ayah.
 *
 * The reciter is part of it because the same ayah recited by two reciters is two different files,
 * and a queue that identified tracks by `surah:ayah` alone would silently accept a mixed one.
 */
export function playlistTrackName(reciterId: string, surah: number, ayah: number): string {
  return `${reciterId}:${surah}:${ayah}`;
}

export function parsePlaylistTrackName(
  name: string,
): { readonly reciterId: string; readonly surah: number; readonly ayah: number } | null {
  const match = /^([^:]+):(\d+):(\d+)$/.exec(name);
  if (match === null) {
    return null;
  }
  const [, reciterId, surah, ayah] = match;
  if (reciterId === undefined || surah === undefined || ayah === undefined) {
    return null;
  }
  return { reciterId, surah: Number(surah), ayah: Number(ayah) };
}

/** One entry in the native queue, with everything needed to map it back to a verse. */
export type PlaylistTrack = {
  /** `<reciter>:<surah>:<ayah>`. Unique within a playlist. */
  readonly name: string;
  /** A validated `file://` URI. Never a remote URL — see `buildPlaylistTracks`. */
  readonly uri: string;
  readonly reciterId: string;
  readonly surah: number;
  readonly ayah: number;
};

/**
 * Why a playlist could not be built from what was offered.
 *
 * Each is a *programming* fault rather than a user-facing one — the screen shows "preparing" or
 * "unavailable" — so they exist to make a wrong queue impossible rather than to be rendered.
 */
export type PlaylistBuildFailure =
  /** Nothing local was available for the requested span. */
  | 'no-local-audio'
  /** Two recitations claimed the same ayah. */
  | 'duplicate-ayah'
  /** The span skipped an ayah, so playback would jump a verse. */
  | 'non-contiguous'
  /** A recitation belonged to another surah or reciter. */
  | 'mixed-scope';

export type PlaylistBuild =
  | {
      readonly kind: 'ok';
      readonly tracks: readonly PlaylistTrack[];
      /** Where playback should begin. Always a valid index into `tracks`. */
      readonly startIndex: number;
    }
  | { readonly kind: 'failed'; readonly failure: PlaylistBuildFailure };

export type PlaylistBuildInput = {
  readonly reciterId: string;
  readonly surah: number;
  /** The recitations for this surah, in any order. Filtered and sorted here. */
  readonly recitations: readonly AyahRecitation[];
  /**
   * The validated local URI for an ayah, or `null` when it is not on disk.
   *
   * Synchronous by contract — see `RecitationPreparation.localUriFor`. A playlist may only contain
   * files that already exist, so this is the gate that keeps a remote URL out of the native queue.
   */
  readonly localUriFor: (recitation: AyahRecitation) => string | null;
  /** The ayah playback should start at. Clamped into the built span. */
  readonly startAyah: number;
  /**
   * How many contiguous tracks to take, starting at the first prepared ayah at or before
   * `startAyah`. Bounds the native queue for a long surah.
   */
  readonly maxTracks: number;
};

/**
 * Builds the contiguous run of locally-available tracks that contains `startAyah`.
 *
 * ── Contiguity is a requirement, not a preference ───────────────────────────
 * A queue assembled from whatever happened to be on disk would play 3, 4, then 9 — a silent
 * omission of five verses, which is the single worst thing this feature could do. So the build takes
 * the **unbroken run** the start ayah falls inside and stops at the first gap, and the caller
 * prepares more before extending. A short queue is honest; a queue with a hole is not.
 */
export function buildPlaylistTracks(input: PlaylistBuildInput): PlaylistBuild {
  const { reciterId, surah, recitations, localUriFor, startAyah, maxTracks } = input;

  /* Anything from another surah or reciter is a caller error, not something to quietly drop. */
  if (recitations.some((entry) => entry.surah !== surah || entry.reciterId !== reciterId)) {
    return { kind: 'failed', failure: 'mixed-scope' };
  }

  const byAyah = new Map<number, AyahRecitation>();
  for (const entry of recitations) {
    if (byAyah.has(entry.ayah)) {
      return { kind: 'failed', failure: 'duplicate-ayah' };
    }
    byAyah.set(entry.ayah, entry);
  }

  const ordered = [...byAyah.values()].sort((left, right) => left.ayah - right.ayah);
  if (ordered.length === 0) {
    return { kind: 'failed', failure: 'no-local-audio' };
  }

  /*
    Walk back from the start ayah while the previous verse is also local, then forward. The run is
    anchored on what the user asked to hear rather than on the surah's first verse, so a deep link
    to 2:255 does not require 254 files it will never play.
  */
  const isLocal = (ayah: number): boolean => {
    const entry = byAyah.get(ayah);
    return entry !== undefined && localUriFor(entry) !== null;
  };

  const anchor = isLocal(startAyah)
    ? startAyah
    : /* The requested verse is not prepared. Nothing to build — the caller prepares and retries. */
      null;
  if (anchor === null) {
    return { kind: 'failed', failure: 'no-local-audio' };
  }

  let first = anchor;
  while (isLocal(first - 1)) {
    first -= 1;
  }

  const tracks: PlaylistTrack[] = [];
  for (let ayah = first; tracks.length < maxTracks && isLocal(ayah); ayah += 1) {
    const entry = byAyah.get(ayah);
    if (entry === undefined) {
      break;
    }
    const uri = localUriFor(entry);
    if (uri === null) {
      break;
    }
    tracks.push({
      name: playlistTrackName(reciterId, surah, ayah),
      uri,
      reciterId,
      surah,
      ayah,
    });
  }

  if (tracks.length === 0) {
    return { kind: 'failed', failure: 'no-local-audio' };
  }

  /*
    The run was built by stepping one ayah at a time, so a gap is structurally impossible here. The
    check stays because it costs nothing and it is the invariant the whole module exists for: if it
    ever fires, the loop above changed and playback would have skipped a verse.
  */
  for (let index = 1; index < tracks.length; index += 1) {
    if ((tracks[index]?.ayah ?? 0) !== (tracks[index - 1]?.ayah ?? 0) + 1) {
      return { kind: 'failed', failure: 'non-contiguous' };
    }
  }

  const startIndex = tracks.findIndex((track) => track.ayah === startAyah);
  return { kind: 'ok', tracks, startIndex: startIndex < 0 ? 0 : startIndex };
}

/**
 * The ayah a native track index refers to, or `null`.
 *
 * The one place an index becomes a verse. Every caller goes through it rather than indexing the
 * array directly, so "which ayah is playing?" is answered by a lookup that can fail loudly instead
 * of by arithmetic that cannot.
 */
export function trackAt(tracks: readonly PlaylistTrack[], index: number): PlaylistTrack | null {
  return tracks[index] ?? null;
}

/** The index a given ayah occupies, or `-1`. Used to point the queue at a chosen verse. */
/**
 * Whether a queue can move forward from `index`.
 *
 * ── Why this is a function and not `index < tracks.length - 1` at the call site ──
 * That arithmetic is wrong in exactly one case, and it is the case that shipped: an **empty**
 * queue makes `tracks.length - 1` equal `-1`, so `0 >= -1` reports that index zero is the last
 * track of a queue that has no tracks. The player then drew "unavailable on the last ayah" while
 * sitting on verse one, and the terminal-state effect concluded that a surah nobody had started had
 * finished. An empty queue has no first track and no last one, and the only way to keep saying that
 * everywhere is to ask here rather than to subtract at each call site.
 */
export function hasNextTrack(tracks: readonly PlaylistTrack[], index: number): boolean {
  if (tracks.length === 0) {
    return false;
  }
  return index >= 0 && index < tracks.length - 1;
}

export function hasPreviousTrack(tracks: readonly PlaylistTrack[], index: number): boolean {
  if (tracks.length === 0) {
    return false;
  }
  return index > 0 && index < tracks.length;
}

/**
 * Whether `index` is the final track of a queue that actually has tracks.
 *
 * The guard the terminal-state effect was missing. A finish reported over an empty queue is not the
 * end of a surah — nothing played — so it may never produce `completed`.
 */
export function isLastTrack(tracks: readonly PlaylistTrack[], index: number): boolean {
  return tracks.length > 0 && index >= tracks.length - 1;
}

export function indexOfAyah(tracks: readonly PlaylistTrack[], ayah: number): number {
  return tracks.findIndex((track) => track.ayah === ayah);
}

/**
 * Whether two track lists describe the same queue.
 *
 * Compared by name, in order — the identity, not the URI. A prepared file re-promoted under the same
 * name is the same track, and rebuilding the native playlist for it would interrupt playback to
 * change nothing.
 */
export function sameTracks(
  left: readonly PlaylistTrack[],
  right: readonly PlaylistTrack[],
): boolean {
  return (
    left.length === right.length && left.every((track, index) => track.name === right[index]?.name)
  );
}
