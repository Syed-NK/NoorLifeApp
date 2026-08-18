import {
  buildLocalPlaylist,
  hasNextTrack,
  hasPreviousTrack,
  indexOfAyah,
  isLastTrack,
  MAX_PLAYLIST_TRACKS,
  parsePlaylistTrackName,
  playlistTrackName,
  sameTracks,
  trackAt,
} from '../data/audio/recitation-playlist';
import { PERMITTED_RESOURCE_ID } from '../storage/faith-offline-recitation';

/**
 * The queue handed to the native player: local files, in order, with no gap in it.
 *
 * ── Why this module is tested this hard for its size ───────────────────────
 * Because the thing being ordered is the Qur'an. A queue that plays 3, 4, then 9 is a silent omission
 * of five verses, and nothing on screen would disagree — the highlight follows the queue. Every test
 * below is a form of one claim: **the queue is either right or short, and never wrong.**
 */

/** A local run with a stated set of present ayat. Everything else answers `null`. */
function localRun(present: readonly number[]) {
  const set = new Set(present);
  return {
    availableAyat: present,
    localUriFor: (ayah: number) =>
      set.has(ayah) ? `file:///documents/faith-recitations-downloaded/r3-s2-a${ayah}.mp3` : null,
  };
}

function build(input: {
  readonly present: readonly number[];
  readonly startAyah: number;
  readonly totalAyat: number;
  readonly maxTracks?: number;
}) {
  const run = localRun(input.present);
  return buildLocalPlaylist({
    resourceId: PERMITTED_RESOURCE_ID,
    surah: 2,
    availableAyat: run.availableAyat,
    localUriFor: run.localUriFor,
    startAyah: input.startAyah,
    totalAyat: input.totalAyat,
    ...(input.maxTracks === undefined ? {} : { maxTracks: input.maxTracks }),
  });
}

describe('track identity', () => {
  it('names a track by resource, surah and ayah, and reads all three back', () => {
    const name = playlistTrackName(PERMITTED_RESOURCE_ID, 2, 255);
    expect(name).toBe('3:2:255');
    expect(parsePlaylistTrackName(name)).toEqual({ resourceId: 3, surah: 2, ayah: 255 });
  });

  it('includes the resource, so a mixed queue is not silently accepted', () => {
    /*
      The same ayah recited by two reciters is two different files. A queue identified by
      `surah:ayah` alone would accept one of each and play a verse in another reciter's voice with
      nothing on screen saying so.
    */
    expect(playlistTrackName(3, 2, 255)).not.toBe(playlistTrackName(7, 2, 255));
  });
});

describe('the queue contains only local files', () => {
  it('builds from the verified run and carries file URIs', () => {
    const result = build({ present: [1, 2, 3], startAyah: 1, totalAyat: 3 });
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') {
      return;
    }
    expect(result.tracks).toHaveLength(3);
    for (const track of result.tracks) {
      expect(track.uri.startsWith('file://')).toBe(true);
      /*
        The regression this pins is the stop gate: the player must never require URL streaming. There
        is no field on `PlaylistTrack` that could hold a remote address, and this asserts none arrived
        through the URI either.
      */
      expect(track.uri).not.toMatch(/^https?:/);
    }
  });

  it('refuses to build when the requested verse is not on the device', () => {
    /*
      `no-local-audio` is not a failure to be retried — it is a download the user has not made. The
      reader's honest action is the Offline audio screen, never a fetch.
    */
    const result = build({ present: [1, 2], startAyah: 5, totalAyat: 7 });
    expect(result).toEqual({ kind: 'failed', failure: 'no-local-audio' });
  });

  it('refuses a verse the manifest lists but the filesystem no longer holds', () => {
    /*
      Both are asked. A row says the bytes were validated; only the store can say they are still
      there, and handing a player a URI for a file the OS reclaimed produces a playback error
      attributed to the verse rather than to the reclamation.
    */
    const result = buildLocalPlaylist({
      resourceId: PERMITTED_RESOURCE_ID,
      surah: 2,
      availableAyat: [1, 2, 3],
      localUriFor: (ayah) => (ayah === 1 ? null : `file:///x/a${ayah}.mp3`),
      startAyah: 1,
      totalAyat: 3,
    });
    expect(result).toEqual({ kind: 'failed', failure: 'no-local-audio' });
  });

  it('rejects a duplicated ayah rather than queueing it twice', () => {
    const result = buildLocalPlaylist({
      resourceId: PERMITTED_RESOURCE_ID,
      surah: 2,
      availableAyat: [1, 2, 2, 3],
      localUriFor: (ayah) => `file:///x/a${ayah}.mp3`,
      startAyah: 1,
      totalAyat: 3,
    });
    expect(result).toEqual({ kind: 'failed', failure: 'duplicate-ayah' });
  });
});

describe('contiguity, and stopping honestly at a gap', () => {
  it('stops at the first missing verse and says which one it is', () => {
    const result = build({ present: [1, 2, 3, 4, 6, 7], startAyah: 1, totalAyat: 7 });
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') {
      return;
    }
    expect(result.tracks.map((track) => track.ayah)).toEqual([1, 2, 3, 4]);
    /*
      The whole reason the reader can stop honestly rather than looking like a surah that ended
      early. Without this, verse 5 would be silently skipped and 6 would play under its number.
    */
    expect(result.nextMissingAyah).toBe(5);
  });

  it('never skips a verse to reach one that is present', () => {
    const result = build({ present: [1, 2, 9, 10], startAyah: 1, totalAyat: 10 });
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') {
      return;
    }
    expect(result.tracks.map((track) => track.ayah)).toEqual([1, 2]);
    expect(result.tracks.map((track) => track.ayah)).not.toContain(9);
  });

  it('reports no missing verse when the run reaches the end of the surah', () => {
    /*
      Running off the end of the last ayah is the surah finishing. Reporting that as a gap would put
      "verse 8 is not downloaded" under a seven-verse surah.
    */
    const result = build({ present: [1, 2, 3, 4, 5, 6, 7], startAyah: 1, totalAyat: 7 });
    expect(result.kind === 'ok' && result.nextMissingAyah).toBeNull();
  });

  it('produces a strictly consecutive run, always', () => {
    const result = build({ present: [3, 4, 5, 6, 7], startAyah: 5, totalAyat: 10 });
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') {
      return;
    }
    for (let index = 1; index < result.tracks.length; index += 1) {
      expect(result.tracks[index]?.ayah).toBe((result.tracks[index - 1]?.ayah ?? 0) + 1);
    }
  });
});

describe('a deep link starts at the verse it names', () => {
  it('begins at 2:255 while still reaching backwards for previous', () => {
    const present = Array.from({ length: 20 }, (_, index) => 246 + index);
    const result = build({ present, startAyah: 255, totalAyat: 286 });
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') {
      return;
    }
    /*
      The run is anchored on what the user asked to hear and extends both ways, so a bookmark to
      2:255 starts on 255 and `previous` still reaches 254 when 254 is on the device — rather than
      the reader silently starting at verse one, which is the defect this ordering exists to prevent.
    */
    expect(result.tracks[result.startIndex]?.ayah).toBe(255);
    expect(result.tracks[0]?.ayah).toBe(246);
    expect(hasPreviousTrack(result.tracks, result.startIndex)).toBe(true);
  });

  it('starts at verse one when that is what was asked for', () => {
    const result = build({ present: [1, 2, 3], startAyah: 1, totalAyat: 3 });
    expect(result.kind === 'ok' && result.startIndex).toBe(0);
  });

  it('does not require the verses before the start to exist', () => {
    const result = build({ present: [255, 256], startAyah: 255, totalAyat: 286 });
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') {
      return;
    }
    expect(result.tracks.map((track) => track.ayah)).toEqual([255, 256]);
    expect(result.startIndex).toBe(0);
  });
});

describe('the whole contiguous run is queued at once', () => {
  it('queues all 286 verses of a fully-downloaded Al-Baqarah', () => {
    /*
      One playlist per surah, built in a single pass. The architecture this replaces queued a
      twenty-ayah window and appended more while playing, which raced the needle on a slow link and
      needed a re-entrancy guard to avoid queueing the same ayat twice.
    */
    const present = Array.from({ length: 286 }, (_, index) => index + 1);
    const result = build({ present, startAyah: 1, totalAyat: 286 });
    expect(result.kind === 'ok' && result.tracks).toHaveLength(286);
  });

  it('bounds a corrupted input rather than building without limit', () => {
    const present = Array.from({ length: 1000 }, (_, index) => index + 1);
    const result = build({ present, startAyah: 1, totalAyat: 1000 });
    expect(result.kind === 'ok' && result.tracks.length).toBe(MAX_PLAYLIST_TRACKS);
  });
});

describe('index and verse are mapped by lookup, never by arithmetic', () => {
  it('answers null for an index outside the queue', () => {
    /*
      Every caller goes through `trackAt` rather than indexing the array, so "which ayah is playing?"
      is answered by a lookup that can fail loudly instead of by arithmetic that cannot — the habit
      that produced the reader's deep-link defect.
    */
    const built = build({ present: [1, 2, 3], startAyah: 1, totalAyat: 3 });
    expect(built.kind).toBe('ok');
    if (built.kind !== 'ok') {
      return;
    }
    expect(trackAt(built.tracks, 0)?.ayah).toBe(1);
    expect(trackAt(built.tracks, 3)).toBeNull();
    expect(trackAt(built.tracks, -1)).toBeNull();
    expect(indexOfAyah(built.tracks, 99)).toBe(-1);
  });

  it('reports no first and no last track over an empty queue', () => {
    /*
      ── The arithmetic bug this replaced ───────────────────────────────────────
      `index < tracks.length - 1` makes `length - 1` equal `-1` on an empty queue, so `0 >= -1`
      reported that index zero was the last track of a queue with no tracks. The player then drew
      "unavailable on the last ayah" while sitting on verse one, and the terminal-state effect
      concluded that a surah nobody had started had finished.
    */
    expect(hasNextTrack([], 0)).toBe(false);
    expect(hasPreviousTrack([], 0)).toBe(false);
    expect(isLastTrack([], 0)).toBe(false);
  });

  it('reports the true ends of a real queue', () => {
    const built = build({ present: [1, 2, 3], startAyah: 1, totalAyat: 3 });
    if (built.kind !== 'ok') {
      throw new Error('expected a queue');
    }
    expect(hasPreviousTrack(built.tracks, 0)).toBe(false);
    expect(hasNextTrack(built.tracks, 0)).toBe(true);
    expect(hasNextTrack(built.tracks, 2)).toBe(false);
    expect(isLastTrack(built.tracks, 2)).toBe(true);
  });
});

describe('two queues are the same queue when their identities are', () => {
  it('compares by name and order rather than by URI', () => {
    /*
      A file re-promoted under the same name is the same track, and rebuilding the native playlist
      for it would interrupt playback to change nothing.
    */
    const first = build({ present: [1, 2], startAyah: 1, totalAyat: 2 });
    const second = buildLocalPlaylist({
      resourceId: PERMITTED_RESOURCE_ID,
      surah: 2,
      availableAyat: [1, 2],
      localUriFor: (ayah) => `file:///somewhere-else/a${ayah}.mp3`,
      startAyah: 1,
      totalAyat: 2,
    });
    if (first.kind !== 'ok' || second.kind !== 'ok') {
      throw new Error('expected two queues');
    }
    expect(sameTracks(first.tracks, second.tracks)).toBe(true);
  });

  it('tells a longer queue from a shorter one', () => {
    const short = build({ present: [1, 2], startAyah: 1, totalAyat: 3 });
    const long = build({ present: [1, 2, 3], startAyah: 1, totalAyat: 3 });
    if (short.kind !== 'ok' || long.kind !== 'ok') {
      throw new Error('expected two queues');
    }
    expect(sameTracks(short.tracks, long.tracks)).toBe(false);
  });
});
