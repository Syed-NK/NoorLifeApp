import { render, screen } from '@testing-library/react-native';
import React from 'react';
import { Text, View } from 'react-native';

import { mockPlaylist } from '../../../../jest.setup';

import {
  hasNextTrack,
  hasPreviousTrack,
  isLastTrack,
  type PlaylistTrack,
} from '../data/audio/recitation-playlist';
import type { RecitationPreparation } from '../data/audio/recitation-preparation';
import { ayahNumber, surahNumber, type AyahRecitation } from '../data/quran-content.repository';
import { useRecitationPlayerWith, type RecitationTransport } from '../hooks/use-recitation-player';

/**
 * A transport holding no tracks is a valid state, and every claim it makes has to be true.
 *
 * ── The device run these cases are written from ─────────────────────────────
 * A release build, Sudais selected, Ad-Duhaa open, nothing downloaded. The panel said **Ready to
 * play** over a queue with zero tracks, the Next control said **unavailable on the last ayah** while
 * pointed at verse one, the caption then moved to **Finished, verse 11 of 11** without a single
 * sound having been produced, and a press on Play did nothing at all — no sound, no message, no
 * change of state.
 *
 * Four separate statements, all false, all from the same root: an empty queue was being described by
 * arithmetic (`index >= tracks.length - 1`, which is `0 >= -1`) and by facts the panel could reach
 * without the transport — the route's surah, the reader's verse and the reciter catalogue's name.
 *
 * These cases pin the repaired behaviour. They are deliberately about the *empty* and *recovering*
 * cases only; the ordinary multi-track queue is covered by `quran-recitation-playlist.test.tsx`.
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

const AD_DUHAA = Array.from({ length: 11 }, (_unused, index) => recitation(93, index + 1));

function track(ayah: number): PlaylistTrack {
  return {
    name: `${RECITER}:93:${ayah}`,
    uri: `file:///cache/r3-s93-a${ayah}.mp3`,
    reciterId: RECITER,
    surah: surahNumber(93),
    ayah: ayahNumber(ayah),
  };
}

/** A preparation engine that can be told to produce files, refuse, or never resolve. */
function createPreparation(options?: {
  readonly refuse?: boolean;
  readonly never?: boolean;
}): RecitationPreparation {
  const present = new Set<number>();
  return {
    localUriFor: (entry) =>
      present.has(entry.ayah) ? `file:///cache/r3-s93-a${entry.ayah}.mp3` : null,
    prepare: async (entry) => {
      if (options?.never === true) {
        return await new Promise(() => undefined);
      }
      if (options?.refuse === true) {
        return { kind: 'failed', failure: 'interrupted' };
      }
      present.add(entry.ayah);
      return { kind: 'ready', uri: `file:///cache/r3-s93-a${entry.ayah}.mp3` };
    },
    prefetchAfter: () => undefined,
    progressFor: () => null,
    setScope: () => undefined,
    sweep: () => undefined,
    usage: () => ({ files: present.size, bytes: 0 }),
  };
}

const probe: { transport: RecitationTransport | null } = { transport: null };

function Probe({
  available,
  preparation,
}: {
  readonly available: readonly AyahRecitation[];
  readonly preparation: RecitationPreparation;
}) {
  const transport = useRecitationPlayerWith(available, preparation);
  /* The test's side channel; see the same note in `quran-recitation-playlist.test.tsx`. */
  // eslint-disable-next-line react-hooks/immutability
  probe.transport = transport;
  return (
    <View>
      <Text testID="phase">{transport.phase}</Text>
      <Text testID="queued">{String(transport.queuedCount)}</Text>
      <Text testID="completed">{String(transport.completed)}</Text>
      <Text testID="hasnext">{String(transport.hasNext)}</Text>
      <Text testID="hasprev">{String(transport.hasPrevious)}</Text>
      <Text testID="unavailable">{String(transport.unavailable)}</Text>
    </View>
  );
}

async function drain(turns = 12): Promise<void> {
  for (let turn = 0; turn < turns; turn += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

const read = (id: string): string => String(screen.getByTestId(id).props.children);

beforeEach(() => {
  probe.transport = null;
});

// ─────────────────────────────────────────────────────────────────────────────
// The predicates the arithmetic replaced
// ─────────────────────────────────────────────────────────────────────────────

describe('queue predicates', () => {
  it('reports no next, no previous and no last track for an empty queue', () => {
    /*
      The whole defect in three assertions. `0 >= [].length - 1` is `0 >= -1`, which is true — so the
      old code believed index zero was the final track of a queue with nothing in it.
    */
    expect(hasNextTrack([], 0)).toBe(false);
    expect(hasPreviousTrack([], 0)).toBe(false);
    expect(isLastTrack([], 0)).toBe(false);
  });

  it('reports the boundaries of a one-track queue', () => {
    const one = [track(1)];
    expect(hasNextTrack(one, 0)).toBe(false);
    expect(hasPreviousTrack(one, 0)).toBe(false);
    /* One track is both the first and the last, which is exactly when `completed` is legitimate. */
    expect(isLastTrack(one, 0)).toBe(true);
  });

  it('reports the boundaries of a multi-track queue', () => {
    const three = [track(1), track(2), track(3)];
    expect([hasPreviousTrack(three, 0), hasNextTrack(three, 0)]).toEqual([false, true]);
    expect([hasPreviousTrack(three, 1), hasNextTrack(three, 1)]).toEqual([true, true]);
    expect([hasPreviousTrack(three, 2), hasNextTrack(three, 2)]).toEqual([true, false]);
    expect([isLastTrack(three, 1), isLastTrack(three, 2)]).toEqual([false, true]);
  });

  it('refuses an index outside the queue rather than extrapolating', () => {
    const three = [track(1), track(2), track(3)];
    expect(hasNextTrack(three, -1)).toBe(false);
    expect(hasPreviousTrack(three, 9)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// A transport with nothing to play
// ─────────────────────────────────────────────────────────────────────────────

describe('a transport handed no recitations', () => {
  it('is unavailable, with an empty queue and no navigation', async () => {
    await render(<Probe available={[]} preparation={createPreparation()} />);
    await drain();

    expect({
      phase: read('phase'),
      queued: read('queued'),
      completed: read('completed'),
      hasNext: read('hasnext'),
      hasPrevious: read('hasprev'),
    }).toEqual({
      phase: 'unavailable',
      queued: '0',
      completed: 'false',
      hasNext: 'false',
      hasPrevious: 'false',
    });
  });

  it('answers a Play press instead of ignoring it', async () => {
    await render(<Probe available={[]} preparation={createPreparation()} />);
    await drain();

    /*
      The press used to be dropped by the adapter, which guarded the call with `focus !== null`. The
      transport answers it now: no native command is issued — there is nothing to command — and the
      state stays the honest one rather than becoming a start that never happens.
    */
    probe.transport?.requestPlay();
    await drain();

    expect(read('phase')).toBe('unavailable');
    expect(read('unavailable')).toBe('true');
    expect(mockPlaylist.commands()).toEqual([]);
  });

  it('never reports completed when the empty playlist claims a finish', async () => {
    await render(<Probe available={[]} preparation={createPreparation()} />);
    await drain();

    /*
      The native status this reproduces: a playlist constructed from zero sources reports itself
      loaded and, on this platform, finished. Believing it turned "nothing has played" into
      "Finished, verse 11 of 11".
    */
    mockPlaylist.setStatus({ isLoaded: true, didJustFinish: true, trackCount: 0 });
    await drain();

    expect(read('completed')).toBe('false');
    expect(read('phase')).toBe('unavailable');
  });

  it('never reports completed when an empty playlist claims to be loaded and playing', async () => {
    await render(<Probe available={[]} preparation={createPreparation()} />);
    await drain();

    mockPlaylist.setStatus({ isLoaded: true, playing: true, trackCount: 0 });
    await drain();

    expect(read('completed')).toBe('false');
    expect(read('queued')).toBe('0');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// A transport whose preparation cannot produce files
// ─────────────────────────────────────────────────────────────────────────────

describe('a transport whose preparation fails', () => {
  it('reports failed, not completed, and keeps the queue empty', async () => {
    await render(<Probe available={AD_DUHAA} preparation={createPreparation({ refuse: true })} />);
    await drain();

    probe.transport?.requestPlay();
    await drain(20);

    expect({ phase: read('phase'), queued: read('queued'), completed: read('completed') }).toEqual({
      phase: 'failed',
      queued: '0',
      completed: 'false',
    });
  });

  it('is preparing — never ready — while files are still being produced', async () => {
    await render(<Probe available={AD_DUHAA} preparation={createPreparation({ never: true })} />);
    await drain();

    probe.transport?.requestPlay();
    await drain(6);

    /*
      The state that must not be reachable here is `queueReady`: nothing has been validated, and a
      panel that says otherwise is claiming readiness from the reader's route rather than from a file.
    */
    expect(read('phase')).toBe('preparing');
    expect(read('queued')).toBe('0');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Recovery without a remount
// ─────────────────────────────────────────────────────────────────────────────

describe('a transport whose recitations arrive late', () => {
  it('moves from unavailable to a playable queue when the list is published', async () => {
    /*
      The reciter-switch case in miniature: reciter A resolves to nothing, the user selects Sudais,
      Sudais's rows arrive, and the transport must publish them **without a remount**. Before this,
      `unavailable` was resolved once from a null focus and the panel never asked again.
    */
    const preparation = createPreparation();
    const view = await render(<Probe available={[]} preparation={preparation} />);
    await drain();
    expect(read('phase')).toBe('unavailable');

    await view.rerender(<Probe available={AD_DUHAA} preparation={preparation} />);
    await drain();
    expect(read('phase')).toBe('idle');

    probe.transport?.requestPlay();
    await drain(20);

    expect({ phase: read('phase'), queued: read('queued') }).toEqual({
      phase: 'playing',
      queued: '11',
    });
    expect(read('hasnext')).toBe('true');
    expect(read('hasprev')).toBe('false');
  });

  it('plays a single-verse queue without claiming a next verse', async () => {
    await render(<Probe available={[recitation(93, 1)]} preparation={createPreparation()} />);
    await drain();

    probe.transport?.requestPlay();
    await drain(20);

    expect({
      queued: read('queued'),
      hasNext: read('hasnext'),
      hasPrevious: read('hasprev'),
    }).toEqual({
      queued: '1',
      hasNext: 'false',
      hasPrevious: 'false',
    });
  });
});
