import { render, screen } from '@testing-library/react-native';
import React from 'react';
import { Text, View } from 'react-native';

import { mockPlaylist } from '../../../../jest.setup';

import {
  buildPlaylistTracks,
  indexOfAyah,
  parsePlaylistTrackName,
  playlistTrackName,
  sameTracks,
  trackAt,
} from '../data/audio/recitation-playlist';
import type {
  PreparationOutcome,
  RecitationPreparation,
} from '../data/audio/recitation-preparation';
import {
  extensionWindow,
  prepareSurahRun,
  preparationWindow,
} from '../data/audio/surah-preparation';
import { ayahNumber, surahNumber, type AyahRecitation } from '../data/quran-content.repository';
import {
  useRecitationPlayerWith,
  type RecitationTransport,
} from '../hooks/use-recitation-player';

/**
 * Recitation plays from one surah-scoped native playlist, not from a player whose source is swapped.
 *
 * ── The architecture these cases replace ────────────────────────────────────
 * `useAudioPlayer(uri)` keyed on the source, so every ayah constructed a **new native player**: the
 * verse finished, JavaScript chose the next one, fetched it if it was not local, React released the
 * old native object and built a new one, and the new one loaded. All of that sat between two verses
 * of the Qur'an and was audible.
 *
 * Three suites used to pin that design in detail — `faith-recitation-advance`,
 * `faith-recitation-lifecycle` and `faith-recitation`. They asserted things that are now impossible
 * rather than merely unused: that a completion advances the transport, that a leaked `didJustFinish`
 * must not double-advance, that swapping verses swaps players, that a released player must not be
 * touched on unmount. This file replaces them, keeping every *property* that mattered and asserting
 * it against the queue instead:
 *
 * | Old property | Where it lives now |
 * |---|---|
 * | one advance per completion, no double | one `trackChanged` → one ayah, asserted below |
 * | no skip, no wrap at the end | transition cases |
 * | no released-object call on unmount | lifecycle cases |
 * | player swapped per verse | *inverted*: the native object must **not** be recreated |
 */

const RECITER = '3';

function recitation(surah: number, ayah: number): AyahRecitation {
  return {
    surah: surahNumber(surah),
    ayah: ayahNumber(ayah),
    reciterId: RECITER,
    url: `https://example.invalid/${surah}/${ayah}.mp3`,
  };
}

/** Ad-Duhaa's eleven ayat, which is the shape the device matrix uses. */
const AD_DUHAA = Array.from({ length: 11 }, (_unused, index) => recitation(93, index + 1));

/**
 * A preparation engine whose files can be declared present, absent or failing.
 *
 * A double rather than the real engine: the properties under test are about *what the transport
 * queues and when*, and the real engine's business — byte budgets, eviction, atomic promotion — is
 * covered by `quran-audio-preparation.test.ts`.
 */
function createPreparation(options?: {
  readonly localFrom?: number;
  readonly failWith?: PreparationOutcome;
  readonly onPrepare?: (recitation: AyahRecitation) => void;
}): RecitationPreparation & { readonly prepared: number[] } {
  const prepared: number[] = [];
  const present = new Set<number>();
  for (let ayah = 1; ayah < (options?.localFrom ?? 1); ayah += 1) {
    present.add(ayah);
  }
  return {
    prepared,
    localUriFor: (entry) =>
      present.has(entry.ayah) ? `file:///cache/faith-recitations/r3-s93-a${entry.ayah}.mp3` : null,
    prepare: async (entry) => {
      options?.onPrepare?.(entry);
      if (options?.failWith !== undefined) {
        return options.failWith;
      }
      prepared.push(entry.ayah);
      present.add(entry.ayah);
      return { kind: 'ready', uri: `file:///cache/faith-recitations/r3-s93-a${entry.ayah}.mp3` };
    },
    prefetchAfter: () => undefined,
    progressFor: () => null,
    setScope: () => undefined,
    sweep: () => undefined,
    usage: () => ({ files: present.size, bytes: 0 }),
  };
}

/**
 * Renders the transport in a probe so its state is readable without a whole reader.
 *
 * A holder object rather than a bare `let`: assigning to a module variable from a component body is
 * a write to state React does not own, and the lint rules reject it for good reason. The object is
 * stable, so mutating its field is an ordinary side-channel a test may use.
 */
const probe: { transport: RecitationTransport | null } = { transport: null };

function Probe({
  available,
  preparation,
}: {
  readonly available: readonly AyahRecitation[];
  readonly preparation: RecitationPreparation;
}) {
  const transport = useRecitationPlayerWith(available, preparation);
  /* The test's side channel. See the note on `probe`. */
  // eslint-disable-next-line react-hooks/immutability
  probe.transport = transport;
  return (
    <View>
      <Text testID="probe-ayah">{String(transport.current?.ayah ?? 'none')}</Text>
      <Text testID="probe-pointed">{String(transport.pointedAyah ?? 'none')}</Text>
      <Text testID="probe-playing">{String(transport.playing)}</Text>
      <Text testID="probe-completed">{String(transport.completed)}</Text>
      <Text testID="probe-preparing">{String(transport.preparing)}</Text>
      <Text testID="probe-failure">{String(transport.preparationFailure ?? 'none')}</Text>
      <Text testID="probe-hasnext">{String(transport.hasNext)}</Text>
      <Text testID="probe-hasprev">{String(transport.hasPrevious)}</Text>
    </View>
  );
}

/**
 * Drains the promise chain by hand.
 *
 * This project has no act environment, so an asynchronous RNTL query while preparation is in flight
 * corrupts React for the rest of the file. Every case advances the loop explicitly and then reads
 * synchronously.
 */
async function drain(turns = 12): Promise<void> {
  for (let turn = 0; turn < turns; turn += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

async function mount(
  available: readonly AyahRecitation[],
  preparation: RecitationPreparation,
): Promise<void> {
  await render(<Probe available={available} preparation={preparation} />);
  await drain();
}

const read = (id: string): string => String(screen.getByTestId(id).props.children);

beforeEach(() => {
  probe.transport = null;
});

// ─────────────────────────────────────────────────────────────────────────────
// Playlist construction
// ─────────────────────────────────────────────────────────────────────────────

describe('playlist construction', () => {
  const localFor = (present: readonly number[]) => (entry: AyahRecitation) =>
    present.includes(entry.ayah) ? `file:///a${entry.ayah}.mp3` : null;

  it('names every track with reciter, surah and ayah', () => {
    expect(playlistTrackName('3', 93, 5)).toBe('3:93:5');
    expect(parsePlaylistTrackName('3:93:5')).toEqual({ reciterId: '3', surah: 93, ayah: 5 });
    expect(parsePlaylistTrackName('nonsense')).toBeNull();
  });

  it('builds an ordered contiguous run and starts at the requested ayah', () => {
    const build = buildPlaylistTracks({
      reciterId: RECITER,
      surah: 93,
      recitations: AD_DUHAA,
      localUriFor: localFor([1, 2, 3, 4, 5]),
      startAyah: 3,
      maxTracks: 20,
    });

    expect(build.kind).toBe('ok');
    if (build.kind !== 'ok') {
      return;
    }
    expect(build.tracks.map((track) => track.ayah)).toEqual([1, 2, 3, 4, 5]);
    expect(build.tracks.map((track) => track.name)).toEqual([
      '3:93:1',
      '3:93:2',
      '3:93:3',
      '3:93:4',
      '3:93:5',
    ]);
    /* The queue holds the run around the request; playback begins on the verse asked for. */
    expect(build.startIndex).toBe(2);
  });

  it('stops at the first gap rather than queueing across it', () => {
    /*
      The property that matters most here. A queue assembled from whatever happened to be on disk
      would play 1, 2, then 5 — a silent omission of two verses of the Qur'an.
    */
    const build = buildPlaylistTracks({
      reciterId: RECITER,
      surah: 93,
      recitations: AD_DUHAA,
      localUriFor: localFor([1, 2, 5, 6]),
      startAyah: 1,
      maxTracks: 20,
    });

    expect(build.kind).toBe('ok');
    if (build.kind !== 'ok') {
      return;
    }
    expect(build.tracks.map((track) => track.ayah)).toEqual([1, 2]);
  });

  it('refuses a queue when the requested ayah is not local', () => {
    expect(
      buildPlaylistTracks({
        reciterId: RECITER,
        surah: 93,
        recitations: AD_DUHAA,
        localUriFor: localFor([1, 2]),
        startAyah: 7,
        maxTracks: 20,
      }),
    ).toEqual({ kind: 'failed', failure: 'no-local-audio' });
  });

  it('refuses a mixed reciter or surah, and a duplicated ayah', () => {
    expect(
      buildPlaylistTracks({
        reciterId: RECITER,
        surah: 93,
        recitations: [recitation(93, 1), { ...recitation(94, 2) }],
        localUriFor: () => 'file:///a.mp3',
        startAyah: 1,
        maxTracks: 20,
      }),
    ).toEqual({ kind: 'failed', failure: 'mixed-scope' });

    expect(
      buildPlaylistTracks({
        reciterId: RECITER,
        surah: 93,
        recitations: [recitation(93, 1), recitation(93, 1)],
        localUriFor: () => 'file:///a.mp3',
        startAyah: 1,
        maxTracks: 20,
      }),
    ).toEqual({ kind: 'failed', failure: 'duplicate-ayah' });
  });

  it('bounds the queue for a long surah', () => {
    const alBaqarah = Array.from({ length: 286 }, (_unused, index) => ({
      ...recitation(2, index + 1),
      surah: surahNumber(2),
    }));
    const build = buildPlaylistTracks({
      reciterId: RECITER,
      surah: 2,
      recitations: alBaqarah,
      localUriFor: () => 'file:///a.mp3',
      startAyah: 255,
      maxTracks: 20,
    });

    expect(build.kind).toBe('ok');
    if (build.kind !== 'ok') {
      return;
    }
    /* Anchored at the request and running forward — not 254 files nobody asked for. */
    expect(build.tracks).toHaveLength(20);
    expect(build.tracks[0]?.ayah).toBe(1);
  });

  it('maps indices to verses through a lookup rather than arithmetic', () => {
    const build = buildPlaylistTracks({
      reciterId: RECITER,
      surah: 93,
      recitations: AD_DUHAA,
      localUriFor: () => 'file:///a.mp3',
      startAyah: 1,
      maxTracks: 20,
    });
    if (build.kind !== 'ok') {
      throw new Error('expected a queue');
    }
    expect(trackAt(build.tracks, 4)?.ayah).toBe(5);
    expect(trackAt(build.tracks, 99)).toBeNull();
    expect(indexOfAyah(build.tracks, 5)).toBe(4);
    expect(indexOfAyah(build.tracks, 99)).toBe(-1);
    expect(sameTracks(build.tracks, build.tracks)).toBe(true);
    expect(sameTracks(build.tracks, build.tracks.slice(1))).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Preparation
// ─────────────────────────────────────────────────────────────────────────────

describe('surah preparation', () => {
  it('prepares the window forward from the requested ayah', () => {
    expect(preparationWindow(AD_DUHAA, 5, 4).map((entry) => entry.ayah)).toEqual([5, 6, 7, 8]);
  });

  it('extends only when the queue is running out ahead of the needle', () => {
    /* Eight ahead is enough — nothing is fetched. */
    expect(extensionWindow(AD_DUHAA, 10, 2, 8)).toEqual([]);
    /* Two ahead is not, so the next run is requested. */
    expect(extensionWindow(AD_DUHAA, 4, 3, 4).map((entry) => entry.ayah)).toEqual([5, 6, 7, 8]);
  });

  it('counts already-local ayat without touching the network', async () => {
    const preparation = createPreparation({ localFrom: 6 });
    const outcome = await prepareSurahRun({ preparation, recitations: AD_DUHAA.slice(0, 5) });

    expect(outcome).toEqual({ kind: 'ready', prepared: 5 });
    /* Ayat 1–5 were already present, so nothing was fetched. */
    expect(preparation.prepared).toEqual([]);
  });

  it('reports progress and stops at the first failure', async () => {
    const seen: number[] = [];
    const preparation = createPreparation({
      failWith: { kind: 'failed', failure: 'offline' },
    });
    const outcome = await prepareSurahRun({
      preparation,
      recitations: AD_DUHAA.slice(0, 5),
      concurrency: 1,
      onProgress: (progress) => seen.push(progress.completed),
    });

    expect(outcome).toMatchObject({ kind: 'failed', failure: 'offline' });
    expect(seen[0]).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The transport
// ─────────────────────────────────────────────────────────────────────────────

describe('the transport queues locally before it plays', () => {
  it('prepares the run, builds one queue and starts at the chosen verse', async () => {
    const preparation = createPreparation();
    await mount(AD_DUHAA, preparation);

    probe.transport?.play(AD_DUHAA[2] as AyahRecitation);
    await drain(20);

    expect(read('probe-ayah')).toBe('3');
    /*
      Nine tracks, not eleven: the preparation window is anchored at the verse asked for and runs
      forward, so ayat 1 and 2 are not fetched for a listener who asked to start at 3.
    */
    expect(mockPlaylist.queue()).toHaveLength(9);
    expect(mockPlaylist.commands()).toContain('play');
    /* Everything queued is a local file — never a remote URL. */
    expect(mockPlaylist.queue().every((uri) => uri.startsWith('file://'))).toBe(true);
  });

  it('reuses the queue for a verse already in it, with no rebuild', async () => {
    const preparation = createPreparation();
    await mount(AD_DUHAA, preparation);

    probe.transport?.play(AD_DUHAA[0] as AyahRecitation);
    await drain(20);
    const afterFirst = mockPlaylist.creations();

    probe.transport?.play(AD_DUHAA[6] as AyahRecitation);
    await drain(10);

    /* A skip, not a new native object — the whole point of the architecture. */
    expect(mockPlaylist.creations()).toBe(afterFirst);
    expect(mockPlaylist.commands()).toContain('skipTo:6');
  });

  it('reports preparation failure honestly rather than falling back to streaming', async () => {
    const preparation = createPreparation({ failWith: { kind: 'failed', failure: 'offline' } });
    await mount(AD_DUHAA, preparation);

    probe.transport?.play(AD_DUHAA[0] as AyahRecitation);
    await drain(20);

    expect(read('probe-failure')).toBe('offline');
    /* Nothing was queued, so nothing remote could have been played instead. */
    expect(mockPlaylist.queue()).toHaveLength(0);
  });
});

describe('one native transition is one ayah', () => {
  async function playing(): Promise<void> {
    const preparation = createPreparation();
    await mount(AD_DUHAA, preparation);
    probe.transport?.play(AD_DUHAA[0] as AyahRecitation);
    await drain(20);
  }

  it('advances exactly one verse per track change', async () => {
    await playing();
    expect(read('probe-ayah')).toBe('1');

    mockPlaylist.advance();
    await drain(4);
    expect(read('probe-ayah')).toBe('2');

    mockPlaylist.advance();
    await drain(4);
    expect(read('probe-ayah')).toBe('3');
  });

  it('does not advance on a finished flag — that authority is gone', async () => {
    await playing();

    /*
      The old architecture advanced from `didJustFinish` and needed a per-selection token to stop one
      completion being honoured twice. Reporting the flag here must move nothing at all.
    */
    mockPlaylist.setStatus({ didJustFinish: true });
    await drain(4);
    expect(read('probe-ayah')).toBe('1');

    mockPlaylist.setStatus({ didJustFinish: true });
    await drain(4);
    expect(read('probe-ayah')).toBe('1');
  });

  it('goes back exactly one on previous and never below the first track', async () => {
    await playing();
    mockPlaylist.advance();
    mockPlaylist.advance();
    await drain(4);
    expect(read('probe-ayah')).toBe('3');

    probe.transport?.previous();
    await drain(4);
    expect(read('probe-ayah')).toBe('2');

    probe.transport?.previous();
    await drain(4);
    expect(read('probe-ayah')).toBe('1');

    probe.transport?.previous();
    await drain(4);
    expect(read('probe-ayah')).toBe('1');
    expect(read('probe-hasprev')).toBe('false');
  });

  it('stops at the end rather than wrapping to the first verse', async () => {
    await playing();
    for (let step = 0; step < 10; step += 1) {
      mockPlaylist.advance();
    }
    await drain(6);
    expect(read('probe-ayah')).toBe('11');
    expect(read('probe-hasnext')).toBe('false');

    probe.transport?.next();
    await drain(4);
    /* No wrap: the surah ended, and the transport says so instead of restarting. */
    expect(read('probe-ayah')).toBe('11');

    mockPlaylist.setStatus({ didJustFinish: true });
    await drain(4);
    expect(read('probe-completed')).toBe('true');
  });
});

describe('playlist lifecycle', () => {
  it('does not recreate the native playlist on re-render', async () => {
    const preparation = createPreparation();
    const view = await render(<Probe available={AD_DUHAA} preparation={preparation} />);
    await drain();
    probe.transport?.play(AD_DUHAA[0] as AyahRecitation);
    await drain(20);
    const created = mockPlaylist.creations();

    view.rerender(<Probe available={AD_DUHAA} preparation={preparation} />);
    await drain(6);

    expect(mockPlaylist.creations()).toBe(created);
  });

  it('does not recreate it while advancing through the surah', async () => {
    const preparation = createPreparation();
    await mount(AD_DUHAA, preparation);
    probe.transport?.play(AD_DUHAA[0] as AyahRecitation);
    await drain(20);
    const created = mockPlaylist.creations();

    for (let step = 0; step < 5; step += 1) {
      mockPlaylist.advance();
    }
    await drain(8);

    /* One native object across the whole run — the structural evidence for smooth transitions. */
    expect(mockPlaylist.creations()).toBe(created);
    expect(read('probe-ayah')).toBe('6');
  });

  it('commands nothing after unmount', async () => {
    const preparation = createPreparation();
    const view = await render(<Probe available={AD_DUHAA} preparation={preparation} />);
    await drain();
    probe.transport?.play(AD_DUHAA[0] as AyahRecitation);
    await drain(20);

    const before = mockPlaylist.commands().length;
    view.unmount();
    await drain(6);

    /*
      The old architecture called `pause()` in a cleanup and hit a released shared object. Nothing
      here may command the playlist on the way out — the SDK releases it, and the listener
      subscription is removed without touching the object.
    */
    expect(mockPlaylist.commands()).toHaveLength(before);
  });
});

describe('failure is a preparation outcome, not a status heuristic', () => {
  it('reports the failure and offers retry, then recovers when preparation succeeds', async () => {
    /*
      The old transport inferred failure from "a source is set and the player is neither loading nor
      loaded". That inference is wrong for a queue of validated local files — an idle queue looks
      exactly like that — so failure is now the preparation outcome itself.
    */
    let offline = true;
    /* Files land on disk only when preparation succeeds, exactly as the real engine behaves. */
    const present = new Set<number>();
    const preparation: RecitationPreparation = {
      localUriFor: (entry) => (present.has(entry.ayah) ? `file:///a${entry.ayah}.mp3` : null),
      prepare: async (entry) => {
        if (offline) {
          return { kind: 'failed', failure: 'offline' };
        }
        present.add(entry.ayah);
        return { kind: 'ready', uri: `file:///a${entry.ayah}.mp3` };
      },
      prefetchAfter: () => undefined,
      progressFor: () => null,
      setScope: () => undefined,
      sweep: () => undefined,
      usage: () => ({ files: 0, bytes: 0 }),
    };

    await mount(AD_DUHAA, preparation);
    probe.transport?.play(AD_DUHAA[0] as AyahRecitation);
    await drain(20);

    expect(read('probe-failure')).toBe('offline');
    expect(mockPlaylist.queue()).toHaveLength(0);

    /* The connection returns and the same retry now builds a queue. */
    offline = false;
    probe.transport?.retry();
    await drain(20);

    expect(read('probe-failure')).toBe('none');
    expect(read('probe-ayah')).toBe('1');
    expect(mockPlaylist.queue().length).toBeGreaterThan(0);
  });

  it('cancels an in-flight preparation without starting playback', async () => {
    const preparation = createPreparation();
    await mount(AD_DUHAA, preparation);

    probe.transport?.play(AD_DUHAA[0] as AyahRecitation);
    probe.transport?.cancelPreparation();
    await drain(20);

    /*
      The session generation moved, so the run that was in flight cannot deliver into the transport
      it was started for — nothing is queued and nothing plays.
    */
    expect(read('probe-preparing')).toBe('false');
    expect(mockPlaylist.played()).toBe(false);
  });
});

describe('playback starts on the playlist that holds the queue', () => {
  it('does not command the instance that was live before the queue was built', async () => {
    /*
      ── The device defect this pins ─────────────────────────────────────────
      Building a queue sets the sources, which makes `useAudioPlaylist` construct a **new** native
      object — so the playlist captured when Play was pressed is the previous, empty one. Commanding
      it started nothing, and on a release build it is a call into an object the SDK is releasing.

      Observed on the emulator before the fix: `ExoPlayerImpl Init` for the real queue landed after
      the play call, and the panel sat at "Paused, 0:00" over a queue that had loaded correctly.
      Playback is now issued by an effect that runs against the live instance.
    */
    const preparation = createPreparation();
    await mount(AD_DUHAA, preparation);
    const before = mockPlaylist.current();

    probe.transport?.play(AD_DUHAA[0] as AyahRecitation);
    await drain(20);

    const after = mockPlaylist.current();
    /* The queue really was rebuilt — otherwise this case would prove nothing. */
    expect(after).not.toBe(before);
    /* And the *live* instance is the one that is playing. */
    expect(after?.__status.playing).toBe(true);
    expect(mockPlaylist.currentUri()).toContain('a1.mp3');
  });

  it('starts at the requested verse rather than the head of the queue', async () => {
    const preparation = createPreparation({ localFrom: 12 });
    await mount(AD_DUHAA, preparation);

    probe.transport?.play(AD_DUHAA[6] as AyahRecitation);
    await drain(20);

    expect(read('probe-ayah')).toBe('7');
    expect(mockPlaylist.current()?.__status.playing).toBe(true);
  });
});
