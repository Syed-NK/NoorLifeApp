/**
 * The ordered set of local tracks one surah's playback is built from.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── Why the playlist is a validated model rather than an array of URIs ──────
 * Because the thing being ordered is the Qur'an. The architecture this replaces asked the transport
 * "what is at index N of the recitation list?" and trusted the answer; the reader's deep-link defect
 * came from exactly that habit, and a mis-ordered *playlist* would be the same class of error with
 * audio instead of text — a verse recited under another verse's number, with nothing on screen
 * disagreeing.
 *
 * So a track carries its own identity, `<resource>:<surah>:<ayah>`, the build refuses anything it
 * cannot vouch for, and nothing downstream derives a reference from a position. The native player is
 * handed a list it cannot misinterpret because every element already says what it is.
 *
 * ── This module no longer knows what a network recitation is ───────────────
 * It used to take `AyahRecitation`, which carries a vendor URL. Taking ayah *numbers* instead is what
 * makes "no URL-based playlist track" a property of the type system rather than of a code review:
 * there is no field on any type here that could hold a remote address, so a future edit cannot pass
 * one through by accident. The only strings that enter are `file://` URIs, and they arrive through
 * `localUriFor`, which is the offline manifest's own accessor and answers `null` for anything not
 * verified.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/**
 * The stable name of one track: `3:2:255` — resource, surah, ayah.
 *
 * The resource is part of it because the same ayah recited by two reciters is two different files,
 * and a queue that identified tracks by `surah:ayah` alone would silently accept a mixed one.
 */
export function playlistTrackName(resourceId: number, surah: number, ayah: number): string {
  return `${resourceId}:${surah}:${ayah}`;
}

export function parsePlaylistTrackName(
  name: string,
): { readonly resourceId: number; readonly surah: number; readonly ayah: number } | null {
  const match = /^(\d+):(\d+):(\d+)$/.exec(name);
  if (match === null) {
    return null;
  }
  const [, resourceId, surah, ayah] = match;
  if (resourceId === undefined || surah === undefined || ayah === undefined) {
    return null;
  }
  return { resourceId: Number(resourceId), surah: Number(surah), ayah: Number(ayah) };
}

/** One entry in the native queue, with everything needed to map it back to a verse. */
export type PlaylistTrack = {
  /** `<resource>:<surah>:<ayah>`. Unique within a playlist. */
  readonly name: string;
  /** A validated `file://` URI. Never a remote URL — see the note at the top of this file. */
  readonly uri: string;
  readonly resourceId: number;
  readonly surah: number;
  readonly ayah: number;
};

/**
 * Why a playlist could not be built from what was offered.
 *
 * `no-local-audio` is the one a screen actually renders, and it means something specific now that
 * playback is local-only: the requested verse is not on the device. That is not a failure to be
 * retried — it is a download the user has not made, and the honest response is to say so and offer
 * the Offline audio screen, never to fall back to streaming.
 */
export type PlaylistBuildFailure =
  /** The requested verse is not verified-local. */
  | 'no-local-audio'
  /** The same ayah was offered twice. */
  | 'duplicate-ayah'
  /** The built span skipped an ayah. Structurally impossible; kept as the module's invariant. */
  | 'non-contiguous';

export type PlaylistBuild =
  | {
      readonly kind: 'ok';
      readonly tracks: readonly PlaylistTrack[];
      /** Where playback should begin. Always a valid index into `tracks`. */
      readonly startIndex: number;
      /**
       * The first ayah after the run that is *not* local, or `null` when the run reaches the end.
       *
       * The whole reason the reader can stop honestly at a gap rather than skipping it. A queue that
       * ended without saying why would be indistinguishable from a surah that finished.
       */
      readonly nextMissingAyah: number | null;
    }
  | { readonly kind: 'failed'; readonly failure: PlaylistBuildFailure };

export type LocalPlaylistInput = {
  readonly resourceId: number;
  readonly surah: number;
  /** Every ayah of this surah that is verified-local. Any order; sorted and deduplicated here. */
  readonly availableAyat: readonly number[];
  /**
   * The validated local URI for an ayah, or `null`.
   *
   * Synchronous by contract. A playlist may only contain files that already exist, so this is the
   * gate that keeps anything unverified out of the native queue — and it consults the filesystem, so
   * a file the OS reclaimed since the manifest was written answers `null` here rather than becoming a
   * track that fails to open.
   */
  readonly localUriFor: (ayah: number) => string | null;
  /** The ayah playback should begin at. */
  readonly startAyah: number;
  /** How many ayat the surah has, so the run can tell "end of surah" from "gap". */
  readonly totalAyat: number;
  /**
   * An upper bound on queue length.
   *
   * Present as a safety valve rather than as policy: the run is normally the whole contiguous span,
   * because rebuilding the native playlist mid-surah is the source replacement this architecture
   * exists to remove. Al-Baqarah at 286 items is well inside what a prepared ExoPlayer queue holds.
   */
  readonly maxTracks?: number;
};

/** Generous enough that no surah reaches it, low enough to bound a corrupted input. */
export const MAX_PLAYLIST_TRACKS = 300;

/**
 * Builds the contiguous run of locally-available tracks that contains `startAyah`.
 *
 * ── Contiguity is a requirement, not a preference ───────────────────────────
 * A queue assembled from whatever happened to be on disk would play 3, 4, then 9 — a silent omission
 * of five verses, which is the single worst thing this feature could do. So the build takes the
 * **unbroken run** the start ayah falls inside, stops at the first gap, and reports where that gap is
 * so the caller can stop there and say so.
 *
 * The run is anchored on what the user asked to hear and extends backwards as well as forwards, so a
 * deep link to 2:255 begins at 255 while `previous` still reaches 254 when 254 is on the device.
 */
export function buildLocalPlaylist(input: LocalPlaylistInput): PlaylistBuild {
  const { resourceId, surah, localUriFor, startAyah, totalAyat } = input;
  const maxTracks = input.maxTracks ?? MAX_PLAYLIST_TRACKS;

  const seen = new Set<number>();
  for (const ayah of input.availableAyat) {
    if (seen.has(ayah)) {
      return { kind: 'failed', failure: 'duplicate-ayah' };
    }
    seen.add(ayah);
  }

  /*
    Local means both: the manifest lists it *and* the filesystem still holds it. Asking both is what
    keeps a reclaimed file from becoming a track that opens to nothing.
  */
  const uriCache = new Map<number, string | null>();
  const uriOf = (ayah: number): string | null => {
    if (!seen.has(ayah)) {
      return null;
    }
    const cached = uriCache.get(ayah);
    if (cached !== undefined) {
      return cached;
    }
    const resolved = localUriFor(ayah);
    uriCache.set(ayah, resolved);
    return resolved;
  };

  if (uriOf(startAyah) === null) {
    return { kind: 'failed', failure: 'no-local-audio' };
  }

  let first = startAyah;
  while (first > 1 && uriOf(first - 1) !== null) {
    first -= 1;
  }

  const tracks: PlaylistTrack[] = [];
  let ayah = first;
  for (; tracks.length < maxTracks; ayah += 1) {
    const uri = uriOf(ayah);
    if (uri === null) {
      break;
    }
    tracks.push({
      name: playlistTrackName(resourceId, surah, ayah),
      uri,
      resourceId,
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

  const last = tracks[tracks.length - 1]?.ayah ?? 0;
  const startIndex = tracks.findIndex((track) => track.ayah === startAyah);

  return {
    kind: 'ok',
    tracks,
    startIndex: startIndex < 0 ? 0 : startIndex,
    /*
      Only a verse the surah actually has counts as missing. Running off the end of the last ayah is
      the surah finishing, and reporting that as a gap would put "verse 287 is not downloaded" under
      Al-Baqarah.
    */
    nextMissingAyah: last < totalAyat ? last + 1 : null,
  };
}

/**
 * The ayah a native track index refers to, or `null`.
 *
 * The one place an index becomes a verse. Every caller goes through it rather than indexing the array
 * directly, so "which ayah is playing?" is answered by a lookup that can fail loudly instead of by
 * arithmetic that cannot.
 */
export function trackAt(tracks: readonly PlaylistTrack[], index: number): PlaylistTrack | null {
  return tracks[index] ?? null;
}

/**
 * Whether a queue can move forward from `index`.
 *
 * ── Why this is a function and not `index < tracks.length - 1` at the call site ──
 * That arithmetic is wrong in exactly one case, and it is the case that shipped: an **empty** queue
 * makes `tracks.length - 1` equal `-1`, so `0 >= -1` reports that index zero is the last track of a
 * queue that has no tracks. The player then drew "unavailable on the last ayah" while sitting on
 * verse one, and the terminal-state effect concluded that a surah nobody had started had finished. An
 * empty queue has no first track and no last one, and the only way to keep saying that everywhere is
 * to ask here rather than to subtract at each call site.
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
 * Compared by name, in order — the identity, not the URI. A file re-promoted under the same name is
 * the same track, and rebuilding the native playlist for it would interrupt playback to change
 * nothing.
 */
export function sameTracks(
  left: readonly PlaylistTrack[],
  right: readonly PlaylistTrack[],
): boolean {
  return (
    left.length === right.length && left.every((track, index) => track.name === right[index]?.name)
  );
}
