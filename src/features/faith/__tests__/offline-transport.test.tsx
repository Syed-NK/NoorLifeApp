import { render, waitFor } from '@testing-library/react-native';
import React from 'react';

import {
  createTestOfflineService,
  generationFor,
  downloadedUri,
} from '@/test-support/faith-reader';

import { mockFileSystem, mockPlaylist } from '../../../../jest.setup';
import type { OfflineDownloadService } from '../data/audio/offline-download.service';
import {
  clearRecitationTrace,
  measuredTransitions,
  recitationTrace,
} from '../data/audio/recitation-diagnostics';
import { useRecitationPlayerWith, type RecitationTransport } from '../hooks/use-recitation-player';

/**
 * The reader's transport, driven directly over a real offline service.
 *
 * ── What a Jest environment can and cannot prove here ──────────────────────
 * It can prove everything about **structure**: that one native playlist is built and not rebuilt per
 * ayah, that the queue holds only `file://` sources, that no ayah is skipped, that a deep link starts
 * on its own verse, and that a finish is reported exactly once. All of those are decisions this code
 * makes, and all of them are observable through the playlist double.
 *
 * ── Why nothing here is wrapped in `act` ──────────────────────────────────
 * This project configures no React act environment, so `act` does not flush — a state update read
 * back inside one is the value from before the call. Every assertion below therefore invokes the
 * transport and then **awaits the consequence**, which is also what a user-driven test does: press,
 * then wait for what the press produced.
 *
 * It cannot prove anything about **sound**. How a transition is heard is a property of ExoPlayer on a
 * device, and no assertion in this file claims otherwise — `measuredTransitions` is exercised below
 * only to show the measurement exists and what it measures, not to assert a gap is inaudible.
 */

/**
 * A probe component, because this version of the testing library exports no `renderHook`.
 *
 * The transport is published to a mutable box on every render, so a test reads the *current* value
 * rather than one captured at mount — which is the whole difficulty with asserting on a hook whose
 * state is driven by native events.
 */
/** Reads the live transport, failing loudly rather than silently when the probe never mounted. */
function transport(box: { current: RecitationTransport | null }): RecitationTransport {
  if (box.current === null) {
    throw new Error('the transport probe did not mount');
  }
  return box.current;
}

function TransportProbe({
  surah,
  offline,
  publish,
}: {
  readonly surah: number;
  readonly offline: OfflineDownloadService;
  readonly publish: (value: RecitationTransport) => void;
}) {
  /*
    Handed to a callback rather than assigned onto a captured object. Assigning to `box.current` here
    is a mutation during render, which the compiler rule correctly refuses — and the refusal is right
    even in a test, because the same shape in production is how a value written during one render is
    read during another.
  */
  publish(useRecitationPlayerWith(surah, offline, 1));
  return null;
}

async function mountTransport(
  surah: number,
  offline: OfflineDownloadService,
): Promise<{ readonly result: { current: RecitationTransport | null } }> {
  const box: { current: RecitationTransport | null } = { current: null };
  const publish = (value: RecitationTransport): void => {
    box.current = value;
  };
  await render(<TransportProbe surah={surah} offline={offline} publish={publish} />);
  return { result: box };
}

/**
 * Fires a native track-change event past the double's own filtering.
 *
 * The double models a *well-behaved* player: its `skipTo` refuses a move to the current index or to
 * one outside the queue. The transport's guards exist because the real native layer does neither, so
 * reaching them means emitting at the listener directly.
 */
function emitTrackChanged(previousIndex: number, currentIndex: number): void {
  const playlist = mockPlaylist.current();
  if (playlist === null) {
    throw new Error('no playlist to emit from');
  }
  for (const listener of [...playlist.__trackListeners]) {
    listener({ previousIndex, currentIndex });
  }
}

/** A service with a contiguous run of one surah already downloaded. */
async function serviceWith(surah: number, ayahCount: number, present?: readonly number[]) {
  const service = createTestOfflineService({ generation: generationFor(surah, ayahCount) });
  await service.hydrate();
  await service.start({ kind: 'selected', surahs: [surah] });
  if (present !== undefined) {
    const wanted = new Set(present);
    for (let ayah = 1; ayah <= ayahCount; ayah += 1) {
      if (!wanted.has(ayah)) {
        mockFileSystem.files.delete(downloadedUri(surah, ayah));
      }
    }
    await service.hydrate();
  }
  return service;
}

beforeEach(() => {
  mockFileSystem.reset();
  mockPlaylist.reset();
  clearRecitationTrace();
});

describe('the queue is built once, from local files', () => {
  it('holds only file:// sources and never a URL', async () => {
    const service = await serviceWith(1, 7);
    const { result } = await mountTransport(1, service);

    transport(result).play(1);
    await waitFor(() => expect(mockPlaylist.queue().length).toBe(7));

    for (const uri of mockPlaylist.queue()) {
      expect(uri.startsWith('file://')).toBe(true);
      /*
        The stop gate, asserted at the boundary that matters. If the player ever required URL
        streaming, it would show up here as an `https:` source in the native queue.
      */
      expect(uri).not.toMatch(/^https?:/);
    }
  });

  it('builds one native playlist for the whole surah, not one per ayah', async () => {
    const service = await serviceWith(2, 40);
    const { result } = await mountTransport(2, service);

    const before = mockPlaylist.creations();
    transport(result).play(1);
    await waitFor(() => expect(mockPlaylist.queue().length).toBe(40));
    const afterBuild = mockPlaylist.creations();

    /* Twenty consecutive boundaries, driven natively. */
    for (let index = 1; index <= 20; index += 1) {
      mockPlaylist.advance(index);
    }
    await waitFor(() => expect(transport(result).currentAyah).toBe(21));

    /*
      ── The architecture this replaces, stated as a number ────────────────────
      One player per ayah meant a native teardown, a construction and a load between two verses of the
      Qur'an. Twenty boundaries cost twenty rebuilds. Here they cost none.
    */
    expect(mockPlaylist.creations()).toBe(afterBuild);
    expect(afterBuild - before).toBeLessThanOrEqual(1);
  });

  it('queues every ayah of a fully downloaded surah in one pass', async () => {
    const service = await serviceWith(2, 120);
    const { result } = await mountTransport(2, service);

    transport(result).play(1);
    await waitFor(() => expect(transport(result).queuedCount).toBe(120));
    /*
      No extension effect, because there is nothing to extend. The architecture this replaces queued a
      twenty-ayah window and appended more while playing, which raced the needle on a slow link and
      needed a re-entrancy guard to avoid queueing the same ayat twice.
    */
    expect(mockPlaylist.queue()).toHaveLength(120);
  });
});

describe('no ayah is skipped, ever', () => {
  it('walks a surah in strict order across every boundary', async () => {
    const service = await serviceWith(1, 7);
    const { result } = await mountTransport(1, service);

    transport(result).play(1);
    await waitFor(() => expect(transport(result).currentAyah).toBe(1));

    const seen: number[] = [1];
    for (let index = 1; index < 7; index += 1) {
      mockPlaylist.advance(index);
      await waitFor(() => expect(transport(result).currentAyah).toBe(index + 1));
      seen.push(transport(result).currentAyah ?? -1);
    }

    expect(seen).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('refuses a repeated native event rather than advancing twice', async () => {
    /*
      `onMediaItemChanged` fires for reasons other than reaching the next track — a seek to the
      default position of the current item is one — and an event accepted twice is an ayah the
      listener never heard.
    */
    const service = await serviceWith(1, 7);
    const { result } = await mountTransport(1, service);
    transport(result).play(1);
    await waitFor(() => expect(transport(result).queuedCount).toBe(7));

    mockPlaylist.advance(1);
    await waitFor(() => expect(transport(result).currentAyah).toBe(2));

    /*
      Emitted straight at the listener, because the double's own `skipTo` filters a move to the
      current index — and a filtered event cannot exercise a guard that exists precisely because the
      *native* layer does not filter it. `onMediaItemChanged` fires on a seek to the default position
      of the current item, and an event accepted twice is an ayah the listener never heard.
    */
    emitTrackChanged(1, 1);

    expect(transport(result).currentAyah).toBe(2);
    expect(recitationTrace().some((entry) => entry.code === 'duplicate-event')).toBe(true);
  });

  it('refuses an index outside the queue rather than mapping it by arithmetic', async () => {
    const service = await serviceWith(1, 7);
    const { result } = await mountTransport(1, service);
    transport(result).play(1);
    await waitFor(() => expect(transport(result).queuedCount).toBe(7));

    emitTrackChanged(0, 99);

    expect(transport(result).currentAyah).toBe(1);
    expect(recitationTrace().some((entry) => entry.code === 'index-out-of-range')).toBe(true);
  });
});

describe('a partly downloaded surah stops at the gap', () => {
  it('queues the contiguous run and names the missing verse', async () => {
    const service = await serviceWith(2, 20, [1, 2, 3, 4, 5]);
    const { result } = await mountTransport(2, service);

    transport(result).play(1);
    await waitFor(() => expect(transport(result).queuedCount).toBe(5));

    expect(mockPlaylist.queue()).toHaveLength(5);
    expect(transport(result).missingAyah).toBe(6);
    expect(transport(result).partiallyDownloaded).toBe(true);
  });

  it('reports the gap rather than a finished surah when the run ends', async () => {
    /*
      ── The distinction this exists for ────────────────────────────────────────
      A queue that ended without saying why is indistinguishable from a surah that finished. One is
      "well done, you have heard Al-Baqarah"; the other is "verse 6 is not on your device". Reporting
      the first when the second is true is the quiet failure this whole design is arranged to avoid.
    */
    const service = await serviceWith(2, 20, [1, 2, 3]);
    const { result } = await mountTransport(2, service);
    transport(result).play(1);
    await waitFor(() => expect(transport(result).queuedCount).toBe(3));

    mockPlaylist.advance(2);
    await waitFor(() => expect(transport(result).currentAyah).toBe(3));
    mockPlaylist.setStatus({ didJustFinish: true, playing: false });

    await waitFor(() => expect(transport(result).phase).toBe('missing-ayah'));
    expect(transport(result).completed).toBe(false);
    expect(transport(result).missingAyah).toBe(4);
  });

  it('never streams or skips the missing verse', async () => {
    const service = await serviceWith(2, 20, [1, 2, 3]);
    const { result } = await mountTransport(2, service);
    transport(result).play(1);
    await waitFor(() => expect(transport(result).queuedCount).toBe(3));

    /* Nothing in the queue is verse 4, and nothing anywhere is a URL. */
    expect(mockPlaylist.queue().some((uri) => uri.includes('-a4.'))).toBe(false);
    expect(mockPlaylist.queue().every((uri) => uri.startsWith('file://'))).toBe(true);
  });

  it('refuses to start on a verse that is not downloaded', async () => {
    const service = await serviceWith(2, 20, [1, 2, 3]);
    const { result } = await mountTransport(2, service);

    transport(result).play(10);
    await waitFor(() => expect(transport(result).block).toBe('not-downloaded'));
    expect(mockPlaylist.played()).toBe(false);
  });
});

describe('a surah with nothing downloaded answers rather than doing nothing', () => {
  it('reports not-downloaded and does not queue anything', async () => {
    const service = createTestOfflineService({ generation: generationFor(1, 7) });
    await service.hydrate();
    const { result } = await mountTransport(1, service);

    expect(transport(result).phase).toBe('not-downloaded');
    expect(transport(result).downloadedAyat).toBe(0);

    /*
      A press is a question, and "there is no audio on this device" is the answer. The adapter used to
      drop the press entirely when there was no verse to pass, so a user got no sound, no message and
      no change of any kind.
    */
    transport(result).requestPlay();
    await waitFor(() => expect(transport(result).block).toBe('not-downloaded'));
    expect(mockPlaylist.played()).toBe(false);
  });
});

describe('a deep link starts at the verse it names', () => {
  it('begins at 2:255 rather than at verse one', async () => {
    const service = await serviceWith(2, 286);
    const { result } = await mountTransport(2, service);

    transport(result).play(255);
    await waitFor(() => expect(transport(result).currentAyah).toBe(255));

    /*
      The whole queue is present, and the needle is on 255 — not on index 0 of a queue that happens to
      contain it. `skipTo` was issued with the resolved index rather than assumed.
    */
    expect(mockPlaylist.currentUri()).toBe(downloadedUri(2, 255));
    expect(mockPlaylist.commands()).toContain('skipTo:254');
  });

  it('can still step backwards from a deep-linked verse', async () => {
    const service = await serviceWith(2, 286);
    const { result } = await mountTransport(2, service);
    transport(result).play(255);
    await waitFor(() => expect(transport(result).currentAyah).toBe(255));

    expect(transport(result).hasPrevious).toBe(true);
    transport(result).previous();
    expect(mockPlaylist.commands()).toContain('previous');
  });
});

describe('previous and next stay inside one queue', () => {
  it('steps without rebuilding the native playlist', async () => {
    const service = await serviceWith(1, 7);
    const { result } = await mountTransport(1, service);
    transport(result).play(3);
    await waitFor(() => expect(transport(result).currentAyah).toBe(3));
    const creations = mockPlaylist.creations();

    transport(result).next();
    transport(result).previous();

    expect(mockPlaylist.creations()).toBe(creations);
    expect(mockPlaylist.commands()).toContain('next');
    expect(mockPlaylist.commands()).toContain('previous');
  });

  it('is disabled at the true ends of the run and nowhere else', async () => {
    const service = await serviceWith(1, 7);
    const { result } = await mountTransport(1, service);

    transport(result).play(1);
    await waitFor(() => expect(transport(result).queuedCount).toBe(7));
    expect(transport(result).hasPrevious).toBe(false);
    expect(transport(result).hasNext).toBe(true);

    for (let index = 1; index < 7; index += 1) {
      mockPlaylist.advance(index);
    }
    await waitFor(() => expect(transport(result).currentAyah).toBe(7));
    expect(transport(result).hasNext).toBe(false);
    expect(transport(result).hasPrevious).toBe(true);
  });

  it('plays a queued verse with a skip rather than a rebuild', async () => {
    const service = await serviceWith(1, 7);
    const { result } = await mountTransport(1, service);
    transport(result).play(1);
    await waitFor(() => expect(transport(result).queuedCount).toBe(7));
    const creations = mockPlaylist.creations();

    transport(result).play(5);
    await waitFor(() => expect(transport(result).currentAyah).toBe(5));

    /*
      The ordinary case for every press after the first: the whole contiguous run is already queued,
      so pointing at another verse costs a `skipTo` and no native teardown.
    */
    expect(mockPlaylist.creations()).toBe(creations);
  });
});

describe('the final verse finishes exactly once', () => {
  it('reports completed on the last track and not before', async () => {
    const service = await serviceWith(1, 7);
    const { result } = await mountTransport(1, service);
    transport(result).play(1);
    await waitFor(() => expect(transport(result).queuedCount).toBe(7));

    /* A finish on a middle track is not the end of the surah. */
    mockPlaylist.advance(3);
    await waitFor(() => expect(transport(result).currentAyah).toBe(4));
    mockPlaylist.setStatus({ didJustFinish: true, playing: false });
    expect(transport(result).completed).toBe(false);

    for (let index = 4; index < 7; index += 1) {
      mockPlaylist.advance(index);
    }
    await waitFor(() => expect(transport(result).currentAyah).toBe(7));
    mockPlaylist.setStatus({ didJustFinish: true, playing: false });

    await waitFor(() => expect(transport(result).completed).toBe(true));
    expect(transport(result).phase).toBe('completed');
  });

  it('never reports completed over an empty queue', async () => {
    /*
      An empty queue has no first track and no last one. The arithmetic this replaced concluded that a
      surah nobody had started had finished.
    */
    const service = createTestOfflineService({ generation: generationFor(1, 7) });
    await service.hydrate();
    const { result } = await mountTransport(1, service);

    mockPlaylist.setStatus({ didJustFinish: true, playing: false });
    expect(transport(result).completed).toBe(false);
  });
});

describe('stopping does not restart at ayah one', () => {
  it('keeps the queue and the position', async () => {
    /*
      ── The defect this pins ──────────────────────────────────────────────────
      `stop` used to reset the index. The reader called it on teardown, and the next press played the
      first verse of the surah rather than the one the listener had reached.
    */
    const service = await serviceWith(1, 7);
    const { result } = await mountTransport(1, service);
    transport(result).play(1);
    await waitFor(() => expect(transport(result).queuedCount).toBe(7));
    mockPlaylist.advance(4);
    await waitFor(() => expect(transport(result).currentAyah).toBe(5));

    transport(result).stop();

    expect(transport(result).currentAyah).toBe(5);
    expect(transport(result).queuedCount).toBe(7);
  });
});

describe('removal while playing', () => {
  it('leaves the transport with nothing to source rather than a stale queue', async () => {
    const service = await serviceWith(1, 7);
    const { result } = await mountTransport(1, service);
    transport(result).play(1);
    await waitFor(() => expect(transport(result).queuedCount).toBe(7));

    await service.removeSurah(1);
    expect(service.localUriFor(1, 1)).toBeNull();
    expect(service.playableAyat(1)).toHaveLength(0);
  });
});

describe('speed and seek keep working', () => {
  it('applies a chosen rate to the native playlist', async () => {
    const service = await serviceWith(1, 7);
    const { result } = await mountTransport(1, service);
    transport(result).play(1);
    await waitFor(() => expect(transport(result).queuedCount).toBe(7));

    transport(result).setRate(1.25);
    await waitFor(() => expect(mockPlaylist.rate()).toBe(1.25));
  });

  it('refuses a rate outside the offered set', async () => {
    const service = await serviceWith(1, 7);
    const { result } = await mountTransport(1, service);
    transport(result).setRate(3);
    expect(transport(result).rate).toBe(1);
  });

  it('issues a seek within the current track', async () => {
    const service = await serviceWith(1, 7);
    const { result } = await mountTransport(1, service);
    transport(result).play(1);
    await waitFor(() => expect(transport(result).queuedCount).toBe(7));

    transport(result).seekTo(12);
    expect(mockPlaylist.commands()).toContain('seekTo:12');
  });

  it('ignores a nonsensical seek rather than passing it to the platform', async () => {
    const service = await serviceWith(1, 7);
    const { result } = await mountTransport(1, service);
    transport(result).play(1);
    await waitFor(() => expect(transport(result).queuedCount).toBe(7));
    const commands = mockPlaylist.commands().length;

    transport(result).seekTo(-5);
    transport(result).seekTo(Number.NaN);

    expect(mockPlaylist.commands()).toHaveLength(commands);
  });
});

describe('durations and positions are reported, never invented', () => {
  it('answers null for a length the platform has not determined', async () => {
    const service = await serviceWith(1, 7);
    const { result } = await mountTransport(1, service);
    transport(result).play(1);
    await waitFor(() => expect(transport(result).queuedCount).toBe(7));

    mockPlaylist.setStatus({ duration: 0, currentTime: 0 });

    /*
      A verse genuinely *is* at zero seconds the instant it starts, and a verse is never zero seconds
      *long*. A progress bar drawn from `duration: 0` claims a measurement nobody made.
    */
    expect(transport(result).durationSeconds).toBeNull();
    expect(transport(result).elapsedSeconds).toBe(0);
  });
});

describe('the transition measurement', () => {
  it('measures from a track change to the first playing status, and nothing else', async () => {
    /*
      ── What this can and cannot show ─────────────────────────────────────────
      It is the **application-visible** window: the time between the native track change and the first
      status reporting playback. It is the interval in which NoorLife could have introduced a delay.

      It is not a PCM measurement, it cannot see silence encoded in the vendor's own audio, and a small
      number here is evidence that this app added nothing rather than proof that nothing was audible.
      The device report says so explicitly; this test exists so the measurement is exercised at all.
    */
    const service = await serviceWith(1, 7);
    const { result } = await mountTransport(1, service);
    transport(result).play(1);
    await waitFor(() => expect(transport(result).queuedCount).toBe(7));

    mockPlaylist.advance(1);
    await waitFor(() => expect(transport(result).currentAyah).toBe(2));
    mockPlaylist.setStatus({ playing: true });

    const measured = measuredTransitions();
    expect(measured.length).toBeGreaterThan(0);
    expect(measured[0]?.toIndex).toBe(1);
    expect(typeof measured[0]?.ms).toBe('number');
  });
});
