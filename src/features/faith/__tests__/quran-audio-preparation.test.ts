import AsyncStorage from '@react-native-async-storage/async-storage';
import fs from 'node:fs';
import path from 'node:path';

import { mockFileSystem } from '../../../../jest.setup';

import {
  audioFileName,
  createExpoAudioStore,
  createRecitationAudio,
  createRecitationPreparation,
  isPlausibleAudio,
  LOW_STORAGE_FLOOR_BYTES,
  MIN_AUDIO_BYTES,
  parseAudioFileName,
  type AudioStore,
} from '../data/audio';
import { MAX_CACHE_AGE_MS } from '../data/quran-foundation/quran-foundation.contract';
import type { AyahRecitation } from '../data/quran-content.repository';
import { readSurahDownloads } from '../storage/faith-audio-downloads';

/**
 * Bounded local preparation of recitation audio.
 *
 * ── The defect this whole layer exists to close ─────────────────────────────
 * Recitation streamed verse by verse, so every ayah began with a full network open — DNS, TLS, first
 * byte, buffer fill — *after* the previous one had already ended. The silence between two verses was
 * a request round trip, every time.
 *
 * ── What is under test here, and what deliberately is not ───────────────────
 * Everything below drives the **real** engine over the **real** `expo-file-system` store, on top of
 * the in-memory filesystem double. So the atomic promote, the header validation, the licence-ceiling
 * expiry and the eviction budget are all the shipped code paths.
 *
 * What is *not* claimed anywhere here is a measurement of the audible gap. That is a property of the
 * platform player on a device and no Jest assertion can stand in for it; it is measured on the
 * emulator and reported separately. What these cases pin is the thing that makes the measurement
 * possible: that the next ayah is already a validated local file when the transport reaches it.
 */

const CACHE = 'file:///cache/faith-recitations';

function recitation(ayah: number, reciterId = '3', surah = 1): AyahRecitation {
  return {
    surah: surah as never,
    ayah: ayah as never,
    reciterId,
    url: `https://verses.quran.foundation/a/${surah}-${ayah}.mp3`,
  };
}

/** A store that counts what it was asked to download, so "was this refetched" is answerable. */
function countingStore(): { readonly store: AudioStore; readonly downloads: string[] } {
  const inner = createExpoAudioStore();
  const downloads: string[] = [];
  return {
    downloads,
    store: {
      ...inner,
      download: async (request) => {
        downloads.push(request.name);
        return await inner.download(request);
      },
    },
  };
}

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe('a file is validated before anything may play it', () => {
  it('accepts an ID3 header and an MPEG frame sync, and nothing else', () => {
    const id3 = new Uint8Array([0x49, 0x44, 0x33, 0x04]);
    const mpeg = new Uint8Array([0xff, 0xfb, 0x90, 0x00]);
    const html = new Uint8Array([0x3c, 0x21, 0x44, 0x4f]); // `<!DO` — a captive-portal page.
    const json = new Uint8Array([0x7b, 0x22, 0x65, 0x72]); // `{"er` — an error document.

    expect(isPlausibleAudio(id3, 8192)).toBe(true);
    expect(isPlausibleAudio(mpeg, 8192)).toBe(true);
    expect(isPlausibleAudio(html, 8192)).toBe(false);
    expect(isPlausibleAudio(json, 8192)).toBe(false);
  });

  it('refuses a file below the size floor however its bytes begin', () => {
    // A truncated transfer that produced a valid-looking first frame is still not a recitation.
    const id3 = new Uint8Array([0x49, 0x44, 0x33, 0x04]);
    expect(isPlausibleAudio(id3, MIN_AUDIO_BYTES - 1)).toBe(false);
    expect(isPlausibleAudio(id3, MIN_AUDIO_BYTES)).toBe(true);
  });

  it('removes a corrupt download rather than caching it', async () => {
    // A `200` carrying an HTML error page, which is what a captive portal answers with.
    mockFileSystem.respondWith(() => {
      const html = new Uint8Array(8192);
      html.set([0x3c, 0x21, 0x44, 0x4f, 0x43], 0);
      return html;
    });

    const preparation = createRecitationPreparation({ store: createExpoAudioStore() });
    const outcome = await preparation.prepare(recitation(1));

    expect(outcome).toEqual({ kind: 'failed', failure: 'corrupt' });
    // Nothing survives: not under the playable name, and not as a partial either.
    expect(mockFileSystem.uris()).toEqual([]);
    expect(preparation.localUriFor(recitation(1))).toBeNull();
  });

  it('removes a partial left by an interrupted transfer', async () => {
    mockFileSystem.respondWith(() => new Error('ECONNRESET'));

    const preparation = createRecitationPreparation({ store: createExpoAudioStore() });
    const outcome = await preparation.prepare(recitation(1));

    expect(outcome).toEqual({ kind: 'failed', failure: 'interrupted' });
    expect(mockFileSystem.uris()).toEqual([]);
  });

  it('sweeps a partial that no `catch` in this process ever saw', async () => {
    /**
     * The case a failure path cannot reach: the process was killed mid-transfer, so nothing ran. The
     * file is invisible to `list` — partials are never listed — so without an explicit sweep it would
     * occupy the cache until the OS reclaimed the directory.
     */
    mockFileSystem.seed(`${CACHE}/r3-s1-a1.mp3.part`, mockFileSystem.audioBytes(4096));

    const preparation = createRecitationPreparation({ store: createExpoAudioStore() });
    preparation.sweep();

    expect(mockFileSystem.uris()).toEqual([]);
  });

  it('never lets a partial be mistaken for a playable file', async () => {
    // The `.part` name is what makes the atomic promote observable: a reader looking for
    // `r3-s1-a1.mp3` cannot find a transfer that is still in flight under `r3-s1-a1.mp3.part`.
    mockFileSystem.seed(`${CACHE}/r3-s1-a1.mp3.part`, mockFileSystem.audioBytes(4096));

    const preparation = createRecitationPreparation({ store: createExpoAudioStore() });

    expect(preparation.localUriFor(recitation(1))).toBeNull();
    expect(preparation.usage()).toEqual({ files: 0, bytes: 0 });
  });
});

describe('the prepared window', () => {
  it('prepares the current ayah before it can be played', async () => {
    const preparation = createRecitationPreparation({ store: createExpoAudioStore() });

    // Nothing local yet: the transport would have no source, which is why it shows "Preparing".
    expect(preparation.localUriFor(recitation(1))).toBeNull();

    const outcome = await preparation.prepare(recitation(1));

    expect(outcome).toEqual({ kind: 'ready', uri: `${CACHE}/r3-s1-a1.mp3` });
    expect(preparation.localUriFor(recitation(1))).toBe(`${CACHE}/r3-s1-a1.mp3`);
  });

  it('prefetches the next three ayat and no more', async () => {
    const { store, downloads } = countingStore();
    const preparation = createRecitationPreparation({ store });
    const list = [1, 2, 3, 4, 5, 6, 7].map((ayah) => recitation(ayah));

    preparation.prefetchAfter(list, 1);
    await new Promise((resolve) => setTimeout(resolve, 0));

    /**
     * Three ahead, bounded. The bound is the point: a prefetch with no ceiling downloads the surah,
     * which is both a worse use of the connection and an accumulation the developer terms forbid.
     */
    expect(downloads.sort()).toEqual(['r3-s1-a2.mp3', 'r3-s1-a3.mp3', 'r3-s1-a4.mp3']);
  });

  it('plays a prefetched ayah without fetching it again', async () => {
    /**
     * THE REQUIREMENT. This is what removes the network from the transition between two ayat: by the
     * time the transport advances, the next file is already on disk, so `prepare` resolves from the
     * filesystem and the download counter does not move.
     */
    const { store, downloads } = countingStore();
    const preparation = createRecitationPreparation({ store });
    const list = [1, 2, 3].map((ayah) => recitation(ayah));

    await preparation.prepare(list[0] as AyahRecitation);
    preparation.prefetchAfter(list, 1);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const before = [...downloads];
    const advanced = await preparation.prepare(list[1] as AyahRecitation);

    expect(advanced).toEqual({ kind: 'ready', uri: `${CACHE}/r3-s1-a2.mp3` });
    // Not one more transfer than the prefetch already performed.
    expect(downloads).toEqual(before);
  });

  it('deduplicates two preparations of the same ayah started together', async () => {
    /**
     * Not a hypothetical race: the transport prepares the ayah it is about to play at the same moment
     * the prefetch reaches it, and a re-render during navigation restarts a prefetch that has not
     * settled. Each duplicate is a second transfer of the same bytes over the connection the first
     * one needs.
     */
    const { store, downloads } = countingStore();
    const preparation = createRecitationPreparation({ store });

    const [first, second] = await Promise.all([
      preparation.prepare(recitation(1)),
      preparation.prepare(recitation(1)),
    ]);

    expect(first).toEqual(second);
    expect(downloads).toEqual(['r3-s1-a1.mp3']);
  });

  it('reports low storage rather than competing for the last of the device', async () => {
    mockFileSystem.setFreeBytes(LOW_STORAGE_FLOOR_BYTES - 1);

    const preparation = createRecitationPreparation({ store: createExpoAudioStore() });
    const outcome = await preparation.prepare(recitation(1));

    // A named state the player can act on, rather than a download that fails for no stated reason.
    expect(outcome).toEqual({ kind: 'failed', failure: 'low-storage' });
    expect(mockFileSystem.uris()).toEqual([]);
  });
});

describe('obsolete preparation is cancelled, not merely ignored', () => {
  it('aborts transfers outside the surah being listened to', async () => {
    const preparation = createRecitationPreparation({ store: createExpoAudioStore() });
    preparation.setScope({ reciterId: '3', surah: 1 });

    const pending = preparation.prepare(recitation(2));
    // The user opens a different surah before the transfer lands.
    preparation.setScope({ reciterId: '3', surah: 18 });

    expect(await pending).toEqual({ kind: 'cancelled' });
    // Cancelled means nothing was written, not that a partial was left behind.
    expect(mockFileSystem.uris()).toEqual([]);
  });

  it('aborts transfers for a reciter the user has moved away from', async () => {
    const preparation = createRecitationPreparation({ store: createExpoAudioStore() });
    preparation.setScope({ reciterId: '3', surah: 1 });

    const pending = preparation.prepare(recitation(2));
    preparation.setScope({ reciterId: '7', surah: 1 });

    expect(await pending).toEqual({ kind: 'cancelled' });
    expect(mockFileSystem.uris()).toEqual([]);
  });

  it('leaves in-scope preparation alone when the scope is re-declared unchanged', async () => {
    const preparation = createRecitationPreparation({ store: createExpoAudioStore() });
    preparation.setScope({ reciterId: '3', surah: 1 });

    const pending = preparation.prepare(recitation(2));
    // A re-render re-declares the same scope; nothing about that invalidates work in flight.
    preparation.setScope({ reciterId: '3', surah: 1 });

    expect(await pending).toEqual({ kind: 'ready', uri: `${CACHE}/r3-s1-a2.mp3` });
  });
});

describe('the licence ceiling is enforced on read', () => {
  it('refuses and deletes a file older than the maximum cache age', async () => {
    const now = Date.now();
    mockFileSystem.seed(
      `${CACHE}/r3-s1-a1.mp3`,
      mockFileSystem.audioBytes(4096),
      now - MAX_CACHE_AGE_MS - 1,
    );

    const preparation = createRecitationPreparation({
      store: createExpoAudioStore(),
      now: () => now,
    });

    /**
     * Checked on **read**, not only on write. An entry cannot outlive the policy by having been
     * stored under an older one — the same rule `quran-cache` and the catalogue store apply, for the
     * same licence reason.
     */
    expect(preparation.localUriFor(recitation(1))).toBeNull();
    expect(mockFileSystem.uris()).toEqual([]);
  });

  it('refuses a file whose timestamp is in the future', async () => {
    // A device clock that moved backwards across a timezone fix or an NTP correction. An age that
    // cannot be reasoned about is not a freshness claim.
    const now = Date.now();
    mockFileSystem.seed(`${CACHE}/r3-s1-a1.mp3`, mockFileSystem.audioBytes(4096), now + 60_000);

    const preparation = createRecitationPreparation({
      store: createExpoAudioStore(),
      now: () => now,
    });

    expect(preparation.localUriFor(recitation(1))).toBeNull();
  });

  it('serves a file inside the window', async () => {
    const now = Date.now();
    mockFileSystem.seed(
      `${CACHE}/r3-s1-a1.mp3`,
      mockFileSystem.audioBytes(4096),
      now - MAX_CACHE_AGE_MS + 60_000,
    );

    const preparation = createRecitationPreparation({
      store: createExpoAudioStore(),
      now: () => now,
    });

    expect(preparation.localUriFor(recitation(1))).toBe(`${CACHE}/r3-s1-a1.mp3`);
  });

  it('clamps a configured window that exceeds the licence ceiling', async () => {
    /**
     * A caller passing a longer window is a bug, and honouring it would put the app outside a term of
     * the Quran Foundation agreement — which is not a thing a configuration value may do.
     */
    const now = Date.now();
    mockFileSystem.seed(
      `${CACHE}/r3-s1-a1.mp3`,
      mockFileSystem.audioBytes(4096),
      now - MAX_CACHE_AGE_MS - 1,
    );

    const preparation = createRecitationPreparation({
      store: createExpoAudioStore(),
      now: () => now,
      maxAgeMs: MAX_CACHE_AGE_MS * 10,
    });

    expect(preparation.localUriFor(recitation(1))).toBeNull();
  });
});

describe('the automatic cache stays bounded', () => {
  it('evicts the oldest unpinned files when the budget is exceeded', async () => {
    /**
     * The **real** clock, deliberately.
     *
     * A test that both seeds files and downloads one cannot inject a fixed `now`: the download stamps
     * the file from the filesystem's own clock, which is then a millisecond ahead of the injected
     * reading, and the engine treats a file dated in the future as a device clock that moved backwards
     * and drops it. Correct production behaviour, broken fixture. Only the read-only expiry cases
     * above inject a clock.
     */
    const now = Date.now();
    const store = createExpoAudioStore();
    // Three files of 4 KB each, against a 9 KB budget: the oldest has to go.
    mockFileSystem.seed(`${CACHE}/r3-s1-a1.mp3`, mockFileSystem.audioBytes(4096), now - 3000);
    mockFileSystem.seed(`${CACHE}/r3-s1-a2.mp3`, mockFileSystem.audioBytes(4096), now - 2000);

    const preparation = createRecitationPreparation({
      store,
      maxPreparedBytes: 9000,
    });
    // Nothing is in scope, so nothing is protected from eviction beyond the budget itself.
    await preparation.prepare(recitation(3));

    const remaining = mockFileSystem.uris().sort();
    expect(remaining).not.toContain(`${CACHE}/r3-s1-a1.mp3`);
    expect(remaining).toContain(`${CACHE}/r3-s1-a3.mp3`);
  });

  it('never evicts the surah currently being listened to', async () => {
    const now = Date.now();
    const store = createExpoAudioStore();
    mockFileSystem.seed(`${CACHE}/r3-s1-a1.mp3`, mockFileSystem.audioBytes(4096), now - 3000);

    const preparation = createRecitationPreparation({
      store,
      maxPreparedBytes: 1,
    });
    preparation.setScope({ reciterId: '3', surah: 1 });
    await preparation.prepare(recitation(2));

    // Evicting what is playing is the one eviction guaranteed to be wrong.
    expect(mockFileSystem.uris()).toContain(`${CACHE}/r3-s1-a1.mp3`);
  });
});

describe('file names carry identifiers, never a URL', () => {
  it('derives the name from reciter, surah and ayah', () => {
    expect(audioFileName('3', 2, 255)).toBe('r3-s2-a255.mp3');
    expect(parseAudioFileName('r3-s2-a255.mp3')).toEqual({
      reciterId: '3',
      surah: 2,
      ayah: 255,
    });
  });

  it('sanitises a reciter id so a stored preference cannot escape the audio directory', () => {
    /**
     * Preferences persist, so a value written by an older build, an interrupted migration or a
     * hand-edited store can contain anything. A path separator reaching the filename would make the
     * cache write outside its own directory.
     */
    expect(audioFileName('../../etc/3', 1, 1)).toBe('retc3-s1-a1.mp3');
    expect(audioFileName('3/../..', 1, 1)).not.toContain('/');
  });

  it('does not treat a foreign file in the directory as one of ours', () => {
    expect(parseAudioFileName('something-else.mp3')).toBeNull();
    expect(parseAudioFileName('r3-s1-a1.mp3.part')).toBeNull();
  });
});

describe('explicit surah downloads', () => {
  it('downloads every ayah, records the result, and reports it as downloaded', async () => {
    const audio = createRecitationAudio({ store: createExpoAudioStore() });
    const list = [1, 2, 3].map((ayah) => recitation(ayah));

    const progress: number[] = [];
    const outcome = await audio.downloadSurah('3', 1, list, (completed) =>
      progress.push(completed),
    );

    expect(outcome.kind).toBe('complete');
    expect(progress).toEqual([1, 2, 3]);

    const state = audio.stateFor('3', 1);
    expect(state.kind).toBe('downloaded');

    // Recorded in storage, so the management screen can describe it after a restart.
    const stored = await readSurahDownloads();
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ reciterId: '3', surah: 1, files: 3, ayahCount: 3 });
  });

  it('stops on the first failure rather than downloading a surah with holes in it', async () => {
    let seen = 0;
    mockFileSystem.respondWith(() => {
      seen += 1;
      return seen > 1 ? new Error('ECONNRESET') : mockFileSystem.audioBytes(4096);
    });

    const audio = createRecitationAudio({ store: createExpoAudioStore() });
    const list = [1, 2, 3, 4].map((ayah) => recitation(ayah));

    const outcome = await audio.downloadSurah('3', 1, list);

    /**
     * A surah download that quietly omitted the ayat it could not fetch would present itself as
     * complete and then play a surah with verses missing — the same class of defect as the transport
     * skipping an ayah, and worse for being invisible until somebody listened.
     */
    expect(outcome.kind).toBe('failed');
    expect(audio.stateFor('3', 1).kind).toBe('incomplete');
  });

  it('resumes from what already landed rather than refetching it', async () => {
    const { store, downloads } = countingStore();
    const audio = createRecitationAudio({ store });
    const list = [1, 2, 3].map((ayah) => recitation(ayah));

    let seen = 0;
    mockFileSystem.respondWith(() => {
      seen += 1;
      return seen === 3 ? new Error('ECONNRESET') : mockFileSystem.audioBytes(4096);
    });

    await audio.downloadSurah('3', 1, list);
    const afterFailure = downloads.length;

    mockFileSystem.respondWith(() => mockFileSystem.audioBytes(4096));
    const retry = await audio.downloadSurah('3', 1, list);

    expect(retry.kind).toBe('complete');
    // The retry fetched strictly fewer files than a fresh download would have: every file already
    // promoted resolves from disk.
    expect(downloads.length - afterFailure).toBeLessThan(list.length);
  });

  it('reports an expired download as expired and refuses to serve it', async () => {
    /**
     * The download runs on the **real** clock, and only the second service is moved forward.
     *
     * Injecting a fixed `now` for the download too would stamp the record before the filesystem
     * stamps the file, so the file would be a millisecond *ahead* of the clock reading it — which the
     * engine treats as a device clock that moved backwards and drops, exactly as `quran-cache` does.
     * That is correct production behaviour and a broken fixture; the fixture is what changes.
     */
    const audio = createRecitationAudio({ store: createExpoAudioStore() });
    await audio.downloadSurah('3', 1, [recitation(1)]);

    expect(audio.stateFor('3', 1).kind).toBe('downloaded');

    // A week and a moment later.
    const now = Date.now();
    const later = createRecitationAudio({
      store: createExpoAudioStore(),
      now: () => now + MAX_CACHE_AGE_MS + 1,
    });
    await later.hydrate();

    expect(later.stateFor('3', 1).kind).toBe('expired');
    // And the preparation layer will not serve the bytes either, whatever the index says.
    expect(later.preparation.localUriFor(recitation(1))).toBeNull();
  });

  it('removes the files and the record when a download is removed', async () => {
    const audio = createRecitationAudio({ store: createExpoAudioStore() });
    await audio.downloadSurah('3', 1, [recitation(1), recitation(2)]);

    await audio.removeDownload('3', 1, 2);

    expect(mockFileSystem.uris()).toEqual([]);
    expect(await readSurahDownloads()).toEqual([]);
    expect(audio.stateFor('3', 1).kind).toBe('stream-only');
  });

  it('does not start a second download of a surah already downloading', async () => {
    const { store, downloads } = countingStore();
    const audio = createRecitationAudio({ store });
    const list = [1, 2].map((ayah) => recitation(ayah));

    const [first, second] = await Promise.all([
      audio.downloadSurah('3', 1, list),
      audio.downloadSurah('3', 1, list),
    ]);

    // One of the two is refused outright; between them they fetch each file once.
    expect([first.kind, second.kind]).toContain('cancelled');
    expect(new Set(downloads).size).toBe(downloads.length);
  });

  it('never evicts a deliberate download to make room for a prefetch', async () => {
    /**
     * The pin registry, asserted end to end. Without it a user who downloaded a surah on a train
     * would watch the prefetch quietly delete half of it to make room for whatever they were
     * listening to, while the management screen went on reporting bytes that were no longer there.
     */
    const audio = createRecitationAudio({ store: createExpoAudioStore() });
    await audio.downloadSurah('3', 18, [recitation(1, '3', 18), recitation(2, '3', 18)]);

    const downloaded = mockFileSystem.uris().filter((uri) => uri.includes('-s18-'));
    expect(downloaded).toHaveLength(2);

    // A different surah is now streamed, with a budget far below what the download occupies.
    const streaming = createRecitationPreparation({
      store: createExpoAudioStore(),
      maxPreparedBytes: 1,
      isPinned: (reciterId, surah) => reciterId === '3' && surah === 18,
    });
    streaming.setScope({ reciterId: '3', surah: 1 });
    await streaming.prepare(recitation(1));

    for (const uri of downloaded) {
      expect(mockFileSystem.uris()).toContain(uri);
    }
  });
});

describe('nothing in the audio path can log a URL', () => {
  it('contains no console call in any module that holds one', () => {
    /**
     * ── Why this is a source scan and not a spy ─────────────────────────────────
     * A spy proves the paths a test exercised did not log. This proves no path can: an audio URL is
     * the one value in the app that must never reach a log line — for some hosts it carries a signed
     * path — and the guarantee worth having is that the modules holding one have no logger at all.
     */
    const files = [
      'src/features/faith/data/audio/audio-store.port.ts',
      'src/features/faith/data/audio/expo-audio-store.ts',
      'src/features/faith/data/audio/recitation-preparation.ts',
      'src/features/faith/data/audio/recitation-audio.ts',
      'src/features/faith/hooks/use-recitation-player.ts',
    ];

    for (const file of files) {
      const source = fs.readFileSync(path.join(process.cwd(), file), 'utf8');
      const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      expect({ file, hasConsole: /\bconsole\s*\./.test(code) }).toEqual({
        file,
        hasConsole: false,
      });
    }
  });

  it('writes no vendor host into a filename', () => {
    // The name is built from identifiers the app already owns, so the vendor's host and any signed
    // path fragment stay out of the filesystem, out of directory listings, and out of crash reports.
    expect(audioFileName('3', 1, 1)).not.toMatch(/quran|foundation|https?/i);
  });
});
