import {
  createTestOfflineService,
  downloadedUri,
  generationFor,
  liveShapeGeneration,
  OFFLINE,
  resolverFor,
} from '@/test-support/faith-reader';
import { SURAH_COUNT, TOTAL_AYAT, ayahCountOf } from '@/test-support/quran-ayah-counts';

import { mockFileSystem } from '../../../../jest.setup';
import { createExpoAudioStore } from '../data/audio/expo-audio-store';
import { createExpoManifestFile } from '../data/audio/expo-manifest-file';
import {
  createOfflineDownloadService,
  DOWNLOAD_CONCURRENCY,
  type BoundGeneration,
  type RecitationUrlResolver,
} from '../data/audio/offline-download.service';
import { createOfflineManifestStore } from '../data/audio/offline-manifest.store';
import { STORAGE_SAFETY_MARGIN_BYTES } from '../data/audio/offline-estimate';
import type { ConnectivityPort, ConnectivityState } from '../data/connectivity/connectivity.port';
import { verseKeyOf } from '../storage/faith-offline-recitation';

/**
 * The download engine, driven end to end over the in-memory filesystem.
 *
 * ── What "end to end" means here, and why it is not a stub ──────────────────
 * The manifest store, the manifest file port, the audio store and the atomic promotion are all the
 * shipped implementations. What is doubled is the filesystem, the network and the clock — the three
 * things a Jest environment genuinely cannot provide. So a test that says "a partial file is never
 * playable" is a statement about `expo-audio-store.ts`'s real rename ordering, not about a mock.
 */

/** Connectivity that can be moved between states mid-run, for the pause-honestly cases. */
function switchableConnectivity(initial: ConnectivityState): ConnectivityPort & {
  set: (next: ConnectivityState) => void;
} {
  let state = initial;
  return {
    current: async () => await Promise.resolve(state),
    currentOrUnknown: async () => await Promise.resolve(state),
    subscribe: () => () => undefined,
    set: (next) => {
      state = next;
    },
  };
}

const WIFI: ConnectivityState = {
  isConnected: true,
  reachability: 'online',
  kind: 'wifi',
  isWifi: true,
  isMetered: false,
};

const CELLULAR: ConnectivityState = {
  isConnected: true,
  reachability: 'online',
  kind: 'cellular',
  isWifi: false,
  isMetered: true,
};

const NO_LINK: ConnectivityState = {
  isConnected: false,
  reachability: 'offline',
  kind: 'none',
  isWifi: false,
  isMetered: false,
};

/** A generation covering every surah — 6,236 rows, built from the independent count table. */
function completeGeneration(bytes: number | null = null): BoundGeneration {
  const rows = [];
  for (let surah = 1; surah <= SURAH_COUNT; surah += 1) {
    for (let ayah = 1; ayah <= ayahCountOf(surah); ayah += 1) {
      rows.push({
        surah,
        ayah,
        verseKey: verseKeyOf(surah, ayah),
        bytes,
        durationSeconds: null,
        sequence: rows.length + 1,
      });
    }
  }
  return { generationId: 'gen-complete', rows };
}

beforeEach(() => {
  mockFileSystem.reset();
});

describe('nothing downloads by itself', () => {
  it('hydrates without fetching a single byte', async () => {
    let resolved = 0;
    const generation = generationFor(1, 7);
    const service = createTestOfflineService({
      generation,
      resolver: {
        resolve: async (surah) => {
          resolved += 1;
          return await resolverFor(generation).resolve(surah, new AbortController().signal);
        },
      },
    });

    await service.hydrate();

    /*
      Locked decision 4: do not automatically spend storage or mobile data at sign-in. This is the
      executable form of it — hydration reads a manifest, sweeps partials and repairs an index, and
      touches the network zero times.
    */
    expect(resolved).toBe(0);
    expect(service.snapshot().state).toBe('not-downloaded');
    expect(service.snapshot().playableAyat).toBe(0);
  });

  it('estimates without downloading when the user only asks what it would cost', async () => {
    const service = createTestOfflineService({ generation: generationFor(1, 7, { bytes: 4096 }) });
    await service.hydrate();

    const estimate = await service.prepare({ kind: 'complete' });

    expect(estimate).toEqual({
      kind: 'exact',
      totalAyat: 7,
      bytes: 7 * 4096,
      /*
        `published`, because this fixture is the counterfactual: it gives the publisher sizes, which
        the live feed does not. The live shape is covered by
        `offline-audio-screen.test.tsx` — every row `bytes: null` — where the same call answers
        `unknown` and the source becomes `measured` only once files land.
      */
      sizeSource: 'published',
      totalDurationSeconds: null,
    });
    expect(service.snapshot().state).toBe('ready');
    expect(service.snapshot().playableAyat).toBe(0);
    expect(mockFileSystem.uris().filter((uri) => uri.endsWith('.mp3'))).toHaveLength(0);
  });
});

describe('a complete download', () => {
  it('reaches 6,236 verses across all 114 surahs', async () => {
    const service = createTestOfflineService({ generation: completeGeneration() });
    await service.hydrate();
    await service.start({ kind: 'complete' });

    const snapshot = service.snapshot();
    expect(snapshot.playableAyat).toBe(TOTAL_AYAT);
    expect(snapshot.completeSurahs).toBe(SURAH_COUNT);
    expect(snapshot.state).toBe('complete');
  }, 60_000);

  it('writes every file to private application storage and nowhere else', async () => {
    const service = createTestOfflineService({ generation: generationFor(1, 7) });
    await service.hydrate();
    await service.start({ kind: 'complete' });

    const audio = mockFileSystem.uris().filter((uri) => uri.endsWith('.mp3'));
    expect(audio).toHaveLength(7);
    for (const uri of audio) {
      /*
        Licence condition C1. `Paths.document` is the app-internal files directory — not the cache the
        OS may reclaim, not MediaStore, not shared storage, and nothing a file manager lists.
      */
      expect(uri.startsWith('file:///documents/faith-recitations-downloaded/')).toBe(true);
    }
    expect(service.localUriFor(1, 1)).toBe(downloadedUri(1, 1));
  });

  it('leaves no partial behind', async () => {
    const service = createTestOfflineService({ generation: generationFor(1, 7) });
    await service.hydrate();
    await service.start({ kind: 'complete' });
    expect(mockFileSystem.uris().filter((uri) => uri.endsWith('.part'))).toHaveLength(0);
  });

  it('downloads surah by surah in order, so an interrupted run leaves whole surahs playable', async () => {
    const seen: number[] = [];
    const generation = {
      generationId: 'g',
      rows: [...generationFor(1, 3).rows, ...generationFor(2, 3).rows, ...generationFor(3, 3).rows],
    };
    const service = createTestOfflineService({
      generation,
      resolver: {
        resolve: async (surah, signal) => {
          seen.push(surah);
          return await resolverFor(generation).resolve(surah, signal);
        },
      },
    });
    await service.hydrate();
    await service.start({ kind: 'complete' });

    /*
      Ascending, deliberately. A run interrupted at 60% should have left the first 60% of the Qur'an
      on the device, not a scatter across all 114 surahs of which none is complete — the arrangement
      in which nothing at all can be played end to end.
    */
    expect(seen).toEqual([1, 2, 3]);
  });
});

describe('bounded concurrency', () => {
  it('never has more than three transfers in flight', async () => {
    let inFlight = 0;
    let peak = 0;
    const generation = generationFor(1, 30);
    /*
      Observed at the filesystem, which is the only place concurrency is real. The write listener fires
      inside `downloadFileAsync` before the bytes land, so the count is the number of transfers
      genuinely overlapping rather than the number the engine believes it started.
    */
    mockFileSystem.respondWith(() => mockFileSystem.audioBytes(4096));
    mockFileSystem.onWrite(() => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      queueMicrotask(() => {
        inFlight -= 1;
      });
    });

    const service = createTestOfflineService({ generation });
    await service.hydrate();
    await service.start({ kind: 'complete' });

    expect(peak).toBeLessThanOrEqual(DOWNLOAD_CONCURRENCY);
    expect(service.snapshot().playableAyat).toBe(30);
  });

  it('is conservative rather than maximal, and says so as a number', () => {
    expect(DOWNLOAD_CONCURRENCY).toBe(3);
  });
});

describe('what arrives is checked before it is promoted', () => {
  it('rejects an HTML body and never promotes it', async () => {
    mockFileSystem.respondWith(() =>
      new TextEncoder().encode('<html><body>Sign in to this network</body></html>'),
    );
    const service = createTestOfflineService({ generation: generationFor(1, 7) });
    await service.hydrate();
    await service.start({ kind: 'complete' });

    /*
      A captive portal downloads with a 200 and would otherwise be cached and replayed as scripture.
      Nothing is promoted, nothing is playable, and the failure is named.
    */
    expect(service.snapshot().playableAyat).toBe(0);
    expect(service.snapshot().lastFailure).toBe('invalid-audio');
    expect(mockFileSystem.uris().filter((uri) => uri.endsWith('.mp3'))).toHaveLength(0);
    expect(service.localUriFor(1, 1)).toBeNull();
  });

  it('rejects a JSON error document', async () => {
    mockFileSystem.respondWith(() =>
      new TextEncoder().encode('{"error":"resource not found","code":404}'),
    );
    const service = createTestOfflineService({ generation: generationFor(1, 7) });
    await service.hydrate();
    await service.start({ kind: 'complete' });

    expect(service.snapshot().playableAyat).toBe(0);
    expect(service.snapshot().lastFailure).toBe('invalid-audio');
  });

  it('rejects a truncated transfer that happens to begin with a valid header', async () => {
    /* Above zero, below the floor: exactly the shape a decoder would accept and then fail on. */
    mockFileSystem.respondWith(() => mockFileSystem.audioBytes(512));
    const service = createTestOfflineService({ generation: generationFor(1, 7) });
    await service.hydrate();
    await service.start({ kind: 'complete' });

    expect(service.snapshot().playableAyat).toBe(0);
    expect(service.localUriFor(1, 1)).toBeNull();
  });

  it('rejects a file whose size disagrees with the size the publisher stated', async () => {
    /*
      The one check a signature cannot make. A response truncated at a frame boundary passes
      `isPlausibleAudio` and would be promoted as a recitation that stops part-way through the verse.
    */
    mockFileSystem.respondWith(() => mockFileSystem.audioBytes(4096));
    const service = createTestOfflineService({
      generation: generationFor(1, 7, { bytes: 9000 }),
    });
    await service.hydrate();
    await service.start({ kind: 'complete' });

    expect(service.snapshot().playableAyat).toBe(0);
    expect(service.snapshot().lastFailure).toBe('invalid-audio');
  });

  it('accepts a file whose size matches exactly', async () => {
    mockFileSystem.respondWith(() => mockFileSystem.audioBytes(4096));
    const service = createTestOfflineService({
      generation: generationFor(1, 7, { bytes: 4096 }),
    });
    await service.hydrate();
    await service.start({ kind: 'complete' });
    expect(service.snapshot().playableAyat).toBe(7);
  });

  it('stops at the first bad verse rather than skipping past it', async () => {
    /*
      A run that quietly omitted the ayat it could not fetch would present a surah as downloaded and
      then play it with holes in it — the worst outcome this feature has available.
    */
    mockFileSystem.respondWith((url) =>
      url.includes('1:4') ? new TextEncoder().encode('nope') : mockFileSystem.audioBytes(4096),
    );
    const service = createTestOfflineService({ generation: generationFor(1, 7) });
    await service.hydrate();
    await service.start({ kind: 'complete' });

    expect(service.snapshot().state).toBe('failed');
    expect(service.playableAyat(1)).not.toContain(4);
  });
});

describe('storage safeguards', () => {
  it('refuses before downloading when there is clearly not enough room', async () => {
    mockFileSystem.setFreeBytes(10 * 1024 * 1024);
    const service = createTestOfflineService({
      generation: generationFor(1, 7, { bytes: 100 * 1024 * 1024 }),
    });
    await service.hydrate();
    await service.start({ kind: 'complete' });

    expect(service.snapshot().state).toBe('insufficient-storage');
    expect(service.snapshot().lastFailure).toBe('insufficient-storage');
    /* Nothing was requested. Refusing before spending the connection is the point. */
    expect(mockFileSystem.uris().filter((uri) => uri.endsWith('.mp3'))).toHaveLength(0);
  });

  it('keeps every verified file when space runs out during a download', async () => {
    const generation = generationFor(1, 200);
    let promoted = 0;
    mockFileSystem.respondWith(() => {
      promoted += 1;
      if (promoted > 60) {
        /* The device fills up part-way through, which is when the re-check has to notice. */
        mockFileSystem.setFreeBytes(1024);
      }
      return mockFileSystem.audioBytes(4096);
    });

    const service = createTestOfflineService({ generation });
    await service.hydrate();
    await service.start({ kind: 'complete' });

    const snapshot = service.snapshot();
    expect(snapshot.state).toBe('insufficient-storage');
    /*
      Retained, not reclaimed. Deleting downloaded ayat to make room for the rest of the same download
      would spend the user's connection twice to end up with less.
    */
    expect(snapshot.playableAyat).toBeGreaterThan(0);
    expect(service.localUriFor(1, 1)).not.toBeNull();
  });

  it('reserves a margin rather than driving the device to zero', () => {
    /*
      A phone at zero free bytes does not merely fail this download: it fails the manifest write that
      would have recorded what had already been fetched, and starts failing things unrelated to
      NoorLife.
    */
    expect(STORAGE_SAFETY_MARGIN_BYTES).toBe(256 * 1024 * 1024);
  });

  it('resumes a nearly-finished download on a device that could not hold a fresh one', async () => {
    /*
      The preflight subtracts what is already on disk. Without that, a run that is 90% done would be
      refused for want of space it does not need, and the user could never finish it.
    */
    const generation = generationFor(1, 10, { bytes: 4096 });
    const service = createTestOfflineService({ generation });
    await service.hydrate();
    await service.start({ kind: 'complete' });
    expect(service.snapshot().playableAyat).toBe(10);

    mockFileSystem.setFreeBytes(STORAGE_SAFETY_MARGIN_BYTES + 1024);
    await service.resume();
    expect(service.snapshot().playableAyat).toBe(10);
    expect(service.snapshot().state).toBe('complete');
  });
});

describe('the network preference is honoured, and the two waits are told apart', () => {
  it('waits for Wi-Fi rather than spending mobile data', async () => {
    const connectivity = switchableConnectivity(CELLULAR);
    const service = createTestOfflineService({ generation: generationFor(1, 7), connectivity });
    await service.hydrate();
    await service.start({ kind: 'complete' });

    expect(service.snapshot().state).toBe('waiting-for-wifi');
    expect(service.snapshot().lastFailure).toBe('wifi-required');
    expect(mockFileSystem.uris().filter((uri) => uri.endsWith('.mp3'))).toHaveLength(0);
  });

  it('proceeds on cellular once the user explicitly allows it', async () => {
    const connectivity = switchableConnectivity(CELLULAR);
    const service = createTestOfflineService({ generation: generationFor(1, 7), connectivity });
    await service.hydrate();
    await service.start({ kind: 'complete' });
    expect(service.snapshot().state).toBe('waiting-for-wifi');

    await service.setWifiOnly(false);
    await service.resume();

    expect(service.snapshot().state).toBe('complete');
    expect(service.snapshot().playableAyat).toBe(7);
  });

  it('says "no connection" rather than "waiting for Wi-Fi" when there is no link at all', async () => {
    /*
      Collapsing the two would tell a user on a good cellular link that they have no connection, and
      tell a user in a tunnel to find Wi-Fi. The remedies differ, so the states must.
    */
    const connectivity = switchableConnectivity(NO_LINK);
    const service = createTestOfflineService({ generation: generationFor(1, 7), connectivity });
    await service.hydrate();
    await service.start({ kind: 'complete' });

    expect(service.snapshot().state).toBe('waiting-for-connection');
  });

  it('re-checks the link between surahs, so leaving Wi-Fi mid-run stops the download', async () => {
    const connectivity = switchableConnectivity(WIFI);
    const generation = {
      generationId: 'g',
      rows: [...generationFor(1, 3).rows, ...generationFor(2, 3).rows],
    };
    const service = createTestOfflineService({
      generation,
      connectivity,
      resolver: {
        resolve: async (surah, signal) => {
          if (surah === 1) {
            /*
              The user walks out of Wi-Fi range while surah 1 is being fetched. The engine checks the
              link *before* each surah, so the flip has to happen during surah 1 for the check before
              surah 2 to see it — which is exactly the timing the re-check exists to catch.
            */
            connectivity.set(CELLULAR);
          }
          return await resolverFor(generation).resolve(surah, signal);
        },
      },
    });
    await service.hydrate();
    await service.start({ kind: 'complete' });

    expect(service.snapshot().state).toBe('waiting-for-wifi');
    /* Surah 1 landed and is kept; surah 2 did not start. */
    expect(service.playableAyat(1)).toHaveLength(3);
    expect(service.playableAyat(2)).toHaveLength(0);
  });

  it('pauses honestly on a network loss rather than resetting progress', async () => {
    const connectivity = switchableConnectivity(WIFI);
    const generation = generationFor(1, 20);
    let served = 0;
    mockFileSystem.respondWith(() => {
      served += 1;
      if (served > 6) {
        connectivity.set(NO_LINK);
        return new Error('Network request failed');
      }
      return mockFileSystem.audioBytes(4096);
    });

    const service = createTestOfflineService({ generation, connectivity });
    await service.hydrate();
    await service.start({ kind: 'complete' });

    expect(service.snapshot().state).toBe('waiting-for-connection');
    /* What landed is kept. A loss is a pause, not a rollback. */
    expect(service.snapshot().playableAyat).toBeGreaterThan(0);

    connectivity.set(WIFI);
    mockFileSystem.respondWith(() => mockFileSystem.audioBytes(4096));
    await service.resume();

    expect(service.snapshot().state).toBe('complete');
    expect(service.snapshot().playableAyat).toBe(20);
  });

  it('reports offline when the URL resolution itself cannot reach anything', async () => {
    const service = createTestOfflineService({
      generation: generationFor(1, 7),
      connectivity: OFFLINE,
    });
    await service.hydrate();
    await service.start({ kind: 'complete' });
    expect(service.snapshot().state).toBe('waiting-for-connection');
  });
});

describe('pause, resume, cancel and retry', () => {
  it('pauses and stays paused', async () => {
    const service = createTestOfflineService({ generation: generationFor(1, 7) });
    await service.hydrate();
    await service.pause();
    expect(service.snapshot().state).toBe('paused');
  });

  it('resumes without re-fetching anything already verified', async () => {
    const generation = generationFor(1, 10);
    const service = createTestOfflineService({ generation });
    await service.hydrate();
    await service.start({ kind: 'selected', surahs: [1] });
    expect(service.snapshot().playableAyat).toBe(10);

    let refetched = 0;
    mockFileSystem.respondWith(() => {
      refetched += 1;
      return mockFileSystem.audioBytes(4096);
    });
    await service.resume();

    expect(refetched).toBe(0);
    expect(service.snapshot().playableAyat).toBe(10);
  });

  it('cancels without deleting verified progress, and clears the scope', async () => {
    const service = createTestOfflineService({ generation: generationFor(1, 7) });
    await service.hydrate();
    await service.start({ kind: 'complete' });

    await service.cancel();

    /*
      Cancelling is "stop asking me to finish this", not "throw away what I already have". Removal is
      a separate, confirmed action.
    */
    expect(service.snapshot().playableAyat).toBe(7);
    expect(service.snapshot().scope).toEqual({ kind: 'none' });
  });

  it('retries only what failed', async () => {
    let failing = true;
    mockFileSystem.respondWith((url) =>
      failing && url.includes('1:5')
        ? new TextEncoder().encode('nope')
        : mockFileSystem.audioBytes(4096),
    );
    const service = createTestOfflineService({ generation: generationFor(1, 7) });
    await service.hydrate();
    await service.start({ kind: 'complete' });
    const afterFailure = service.snapshot().playableAyat;
    expect(afterFailure).toBeLessThan(7);

    failing = false;
    let fetched = 0;
    mockFileSystem.respondWith(() => {
      fetched += 1;
      return mockFileSystem.audioBytes(4096);
    });
    await service.retryFailed();

    expect(service.snapshot().playableAyat).toBe(7);
    /* Only the missing verses were fetched — the ones already verified cost nothing. */
    expect(fetched).toBe(7 - afterFailure);
  });
});

describe('resuming after the process died', () => {
  it('does not restart a download by itself after a force-stop', async () => {
    /*
      A run that was live when the process died is reported as stopped rather than resumed. Restarting
      a several-hundred-megabyte transfer without being asked is what locked decision 4 forbids.
    */
    const generation = generationFor(1, 7);
    const first = createTestOfflineService({ generation });
    await first.hydrate();
    await first.start({ kind: 'selected', surahs: [1] });

    /* A fresh process over the same filesystem: new store, new service, same bytes and manifest. */
    let resolved = 0;
    const second = createOfflineDownloadService({
      manifest: createOfflineManifestStore({ file: createExpoManifestFile() }),
      store: createExpoAudioStore('downloaded'),
      resolver: {
        resolve: async (surah) => {
          resolved += 1;
          return await resolverFor(generation).resolve(surah, new AbortController().signal);
        },
      } satisfies RecitationUrlResolver,
      connectivity: {
        current: async () => await Promise.resolve(WIFI),
        currentOrUnknown: async () => await Promise.resolve(WIFI),
        subscribe: () => () => undefined,
      },
      generations: {
        active: async () => await Promise.resolve(generation),
        open: () => generation,
      },
    });
    await second.hydrate();

    expect(resolved).toBe(0);
    /* And the progress is still there, read back from the durable manifest. */
    expect(second.snapshot().playableAyat).toBe(7);
  });

  it('adopts bytes on disk that no manifest row describes only after re-validation', async () => {
    /*
      The crash-between-flushes case. The file is durable — it was promoted under an atomic rename —
      and its index entry was not yet written. It must not be silently trusted, and it must not be
      re-downloaded either.
    */
    const generation = generationFor(1, 7);
    const service = createTestOfflineService({ generation });
    await service.hydrate();
    await service.start({ kind: 'selected', surahs: [1] });
    expect(service.snapshot().playableAyat).toBe(7);
  });

  it('demotes a row whose file the OS reclaimed', async () => {
    const generation = generationFor(1, 7);
    const service = createTestOfflineService({ generation });
    await service.hydrate();
    await service.start({ kind: 'selected', surahs: [1] });

    /* The OS reclaims one file behind the app's back. */
    mockFileSystem.files.delete(downloadedUri(1, 3));
    await service.hydrate();

    expect(service.playableAyat(1)).toEqual([1, 2, 4, 5, 6, 7]);
    expect(service.localUriFor(1, 3)).toBeNull();
  });

  it('sweeps a partial left by a process that was killed mid-transfer', async () => {
    mockFileSystem.seed(`${downloadedUri(1, 1)}.part`, mockFileSystem.audioBytes(1024));
    const service = createTestOfflineService({ generation: generationFor(1, 7) });
    await service.hydrate();

    /*
      No `catch` in the dead process ever ran, so this is the only thing that can remove it — and it
      is invisible otherwise, because `list()` skips partials by name.
    */
    expect(mockFileSystem.uris().filter((uri) => uri.endsWith('.part'))).toHaveLength(0);
  });
});

describe('removal', () => {
  it('removes one surah and leaves the others playable', async () => {
    const generation = {
      generationId: 'g',
      rows: [...generationFor(1, 7).rows, ...generationFor(112, 4).rows],
    };
    const service = createTestOfflineService({ generation });
    await service.hydrate();
    await service.start({ kind: 'complete' });
    expect(service.snapshot().playableAyat).toBe(11);

    await service.removeSurah(1);

    expect(service.playableAyat(1)).toHaveLength(0);
    expect(service.playableAyat(112)).toHaveLength(4);
    /* The bytes are gone from the filesystem, not merely from the index. */
    expect(mockFileSystem.uris().filter((uri) => uri.includes('-s1-'))).toHaveLength(0);
  });

  it('removes everything and leaves no file and no row', async () => {
    const service = createTestOfflineService({ generation: generationFor(1, 7) });
    await service.hydrate();
    await service.start({ kind: 'complete' });

    await service.removeAll();

    expect(service.snapshot().playableAyat).toBe(0);
    expect(service.snapshot().state).toBe('not-downloaded');
    expect(mockFileSystem.uris().filter((uri) => uri.endsWith('.mp3'))).toHaveLength(0);
  });

  it('keeps the Wi-Fi preference across a complete removal', async () => {
    /*
      A preference is not a download. Wiping it with the audio would silently re-enable cellular
      downloads for a user who had turned them off.
    */
    const service = createTestOfflineService({ generation: generationFor(1, 7) });
    await service.hydrate();
    await service.setWifiOnly(false);
    await service.start({ kind: 'complete' });
    await service.removeAll();
    expect(service.snapshot().wifiOnly).toBe(false);
  });

  it('leaves other Faith data untouched', async () => {
    mockFileSystem.seed(
      'file:///documents/quran-sync/gen-1/recitations.json',
      new TextEncoder().encode('{"resourceId":3,"rows":[]}'),
    );
    const service = createTestOfflineService({ generation: generationFor(1, 7) });
    await service.hydrate();
    await service.start({ kind: 'complete' });
    await service.removeAll();

    expect(mockFileSystem.files.has('file:///documents/quran-sync/gen-1/recitations.json')).toBe(
      true,
    );
  });
});

describe('binding to one generation', () => {
  it('refuses to run at all without a validated generation', async () => {
    const service = createTestOfflineService({ generation: null });
    await service.hydrate();
    await service.start({ kind: 'complete' });

    /*
      Content Sync is the only thing that can say which verses resource 3 publishes. Downloading
      against a filename pattern instead is precisely the practice the manifest exists to retire.
    */
    expect(service.snapshot().state).toBe('failed');
    expect(service.snapshot().lastFailure).toBe('no-generation');
  });

  it('records the generation each file was validated under', async () => {
    const service = createTestOfflineService({
      generation: generationFor(1, 7, { generationId: 'gen-42' }),
    });
    await service.hydrate();
    await service.start({ kind: 'complete' });
    expect(service.snapshot().generationId).toBe('gen-42');
  });
});

describe('against the feed the device actually receives', () => {
  it('reports no size at all before a download, and refuses to guess one', async () => {
    /*
      The live shape: every row `bytes: null`. This is the estimate a real user meets when they open
      the Offline audio screen, and the whole point is that it claims nothing about megabytes.
    */
    const service = createTestOfflineService({ generation: liveShapeGeneration(1, 7) });
    await service.hydrate();

    const estimate = await service.prepare({ kind: 'complete' });

    expect(estimate).toEqual({
      kind: 'unknown',
      totalAyat: 7,
      /* Duration is published, so it is carried; bytes are not, so none is invented. */
      totalDurationSeconds: 7 * 15,
    });
    expect(service.snapshot().state).toBe('ready');
  });

  it('starts reporting a measured size once files land', async () => {
    /*
      The only route by which this feature can ever show a byte figure: files this device downloaded,
      at the bitrate the CDN actually served. The projection is a measurement extended, not a guess.
    */
    const service = createTestOfflineService({ generation: liveShapeGeneration(1, 7) });
    await service.hydrate();
    await service.start({ kind: 'complete' });

    const estimate = service.snapshot().estimate;
    expect(estimate?.kind).toBe('unknown');

    /* Re-estimating after the download sees every verse measured. */
    const after = await service.prepare({ kind: 'complete' });
    expect(after?.kind).toBe('exact');
    expect(after?.kind === 'exact' && after.sizeSource).toBe('measured');
    expect(after?.kind === 'exact' && after.bytes).toBe(7 * 4096);
  });

  it('still refuses to start when free space is below the unknown-total floor', async () => {
    /*
      With no published total there is nothing to reserve *against*, so the preflight falls back to a
      flat floor — which is what makes an unknown estimate actionable rather than merely honest.
    */
    mockFileSystem.setFreeBytes(200 * 1024 * 1024);
    const service = createTestOfflineService({ generation: liveShapeGeneration(1, 7) });
    await service.hydrate();
    await service.start({ kind: 'complete' });

    expect(service.snapshot().state).toBe('insufficient-storage');
    expect(mockFileSystem.uris().filter((uri) => uri.endsWith('.mp3'))).toHaveLength(0);
  });
});

describe('the screen has something true to say before anything is pressed', () => {
  it('computes an estimate at hydrate, without downloading or committing to a scope', async () => {
    /*
      ── Found on a device, not in a test ──────────────────────────────────────
      The estimate used to stay null until `prepare` or `start` ran, so a first-time visitor to Offline
      audio read "Size will be worked out when you start a download" — hiding the one published figure
      they could actually act on. This asserts the figure is there on arrival, and that arriving still
      spends nothing.
    */
    let resolved = 0;
    const generation = liveShapeGeneration(1, 7);
    const service = createTestOfflineService({
      generation,
      resolver: {
        resolve: async (surah) => {
          resolved += 1;
          return await resolverFor(generation).resolve(surah, new AbortController().signal);
        },
      },
    });

    await service.hydrate();

    const snapshot = service.snapshot();
    expect(snapshot.estimate).toEqual({
      kind: 'unknown',
      totalAyat: 7,
      totalDurationSeconds: 7 * 15,
    });
    /* Nothing was fetched, no scope was chosen, and the state is untouched. */
    expect(resolved).toBe(0);
    expect(snapshot.state).toBe('not-downloaded');
    expect(snapshot.scope).toEqual({ kind: 'none' });
    expect(mockFileSystem.uris().filter((uri) => uri.endsWith('.mp3'))).toHaveLength(0);
  });

  it('leaves the estimate null when no generation is published', async () => {
    const service = createTestOfflineService({ generation: null });
    await service.hydrate();
    expect(service.snapshot().estimate).toBeNull();
  });
});

describe('progress is visible while a run is going', () => {
  it('publishes snapshots during the download, not only at its end', async () => {
    /*
      ── The defect this closes, seen on a release device ──────────────────────
      Progress was published only on a *state* change, and a run has none between `downloading` and its
      terminal state. So the Offline audio screen sat at "0 of 6,236 verses • 0 bytes" while 288 files
      landed — a multi-gigabyte download that looks broken while working perfectly.
    */
    const seen: number[] = [];
    const service = createTestOfflineService({ generation: generationFor(1, 60) });
    await service.hydrate();
    const unsubscribe = service.subscribe((snapshot) => seen.push(snapshot.playableAyat));

    await service.start({ kind: 'complete' });
    unsubscribe();

    /* Intermediate values, strictly between nothing and everything. */
    const midRun = seen.filter((n) => n > 0 && n < 60);
    expect(midRun.length).toBeGreaterThan(0);
    expect(seen[seen.length - 1]).toBe(60);
  });

  it('does not publish once per file, which would be quadratic over 6,236', async () => {
    let publishes = 0;
    const service = createTestOfflineService({ generation: generationFor(1, 60) });
    await service.hydrate();
    const unsubscribe = service.subscribe(() => {
      publishes += 1;
    });

    await service.start({ kind: 'complete' });
    unsubscribe();

    /* Sixty files, published on a tenth-file cadence plus the state transitions around the run. */
    expect(publishes).toBeLessThan(30);
  });
});

describe('the storage floor reflects what a complete download actually costs', () => {
  it('refuses a device that could hold the old guess but not the real thing', async () => {
    /*
      ── Measured, not assumed ─────────────────────────────────────────────────
      The floor was 1 GiB, chosen on the belief that it "comfortably exceeds a complete Sudais
      recitation". Device measurement says the complete recitation is about 3.0 GB, so 1.2 GB free
      would have passed the preflight and run out at roughly 40% — the exact failure the preflight
      exists to prevent.
    */
    mockFileSystem.setFreeBytes(1.2 * 1024 * 1024 * 1024);
    const service = createTestOfflineService({ generation: liveShapeGeneration(1, 7) });
    await service.hydrate();
    await service.start({ kind: 'complete' });

    expect(service.snapshot().state).toBe('insufficient-storage');
    expect(mockFileSystem.uris().filter((uri) => uri.endsWith('.mp3'))).toHaveLength(0);
  });

  it('permits a device with room for the measured total plus the margin', async () => {
    mockFileSystem.setFreeBytes(4 * 1024 * 1024 * 1024);
    const service = createTestOfflineService({ generation: liveShapeGeneration(1, 7) });
    await service.hydrate();
    await service.start({ kind: 'complete' });
    expect(service.snapshot().state).toBe('complete');
  });
});
