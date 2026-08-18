import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import React, { type ReactElement } from 'react';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';

import type { FaithRepositories } from '@features/faith/data';
import {
  createExpoAudioStore,
  createExpoManifestFile,
  createOfflineDownloadService,
  createOfflineManifestStore,
  type BoundGeneration,
  type OfflineDownloadService,
  type RecitationUrlResolver,
} from '@features/faith/data/audio';
import { createMockFaithRepositories } from '@features/faith/data/mock';
import {
  OFFLINE_STATE,
  type ConnectivityPort,
} from '@features/faith/data/connectivity/connectivity.port';
import { FaithRepositoryProvider } from '@features/faith/di/faith-repository-context';
import { OfflineRecitationProvider } from '@features/faith/di/offline-recitation-context';
import { ReaderScreen } from '@features/faith/screens/reader-screen';
import {
  offlineFileName,
  PERMITTED_RESOURCE_ID,
  verseKeyOf,
} from '@features/faith/storage/faith-offline-recitation';

import { mockFileSystem, setRouteParams } from '../../jest.setup';

/**
 * Shared scaffolding for the Qur'an reader's suites.
 *
 * ── Why the *real* offline service is used and not a stub ───────────────────
 * The behaviour these suites exist to pin is that playback is sourced from validated local files and
 * from nothing else: a queue is built only from what is on disk, it stops at a gap rather than
 * skipping or streaming it, and a surah with nothing downloaded produces an honest refusal rather
 * than silence. A stubbed service would let all four of those pass while none of them worked.
 *
 * So the tests drive `createOfflineDownloadService` over `createExpoAudioStore`, on top of the
 * in-memory filesystem double in `jest.setup.ts`. Every layer between the press and the bytes is the
 * shipped one; only the disk, the network and the clock are fake.
 *
 * ── A fresh service per render, deliberately ────────────────────────────────
 * The production service is a module-level singleton because its manifest has to survive navigation.
 * That is exactly what must **not** survive between tests: files left behind by one case would make
 * the next case's "is this surah downloaded" assertion pass for the wrong reason. Each render gets
 * its own.
 */

/** Al-Fatihah, as the published generation states it. Seven verses, no published sizes. */
export const FATIHAH_GENERATION: BoundGeneration = {
  generationId: 'gen-test',
  rows: Array.from({ length: 7 }, (_, index) => ({
    surah: 1,
    ayah: index + 1,
    verseKey: verseKeyOf(1, index + 1),
    bytes: null,
    durationSeconds: null,
    sequence: index + 1,
  })),
};

/** A generation covering one surah of any length, for the longer-run suites. */
export function generationFor(
  surah: number,
  ayahCount: number,
  options?: {
    readonly bytes?: number | null;
    readonly durationSeconds?: number | null;
    readonly generationId?: string;
  },
): BoundGeneration {
  return {
    generationId: options?.generationId ?? 'gen-test',
    rows: Array.from({ length: ayahCount }, (_, index) => ({
      surah,
      ayah: index + 1,
      verseKey: verseKeyOf(surah, index + 1),
      bytes: options?.bytes ?? null,
      durationSeconds: options?.durationSeconds ?? null,
      sequence: index + 1,
    })),
  };
}

/**
 * A generation shaped exactly like the one on the device: a duration per ayah, a size on none.
 *
 * Read off the emulator's published generation — every one of the 6,236 resource-3 rows carries
 * `"bytes":null` and a `durationSeconds`. A fixture that gave rows sizes tests a feed NoorLife does
 * not receive, so anything asserting what the *user* will actually see uses this one.
 */
export function liveShapeGeneration(surah: number, ayahCount: number): BoundGeneration {
  return generationFor(surah, ayahCount, { bytes: null, durationSeconds: 15 });
}

/**
 * Puts validated audio for a set of verses directly on the fake disk **and** in the manifest.
 *
 * ── Why this seeds through the real service rather than writing rows ────────
 * Writing manifest rows by hand would let a suite assert playback over files that were never
 * validated, which is the one thing the manifest exists to prevent. Running `start` against a
 * resolver that answers instantly exercises the real download, validation and promotion path, so a
 * seeded fixture is a fixture the shipped code produced.
 */
export async function seedDownloaded(
  service: OfflineDownloadService,
  surah: number,
  ayat: readonly number[],
): Promise<void> {
  await service.start({ kind: 'selected', surahs: [surah] });
  /*
    Anything the caller did not ask for is removed afterwards rather than withheld during, so the gap
    is a genuinely missing file on disk and not merely an absent row.
  */
  const wanted = new Set(ayat);
  const store = createExpoAudioStore('downloaded');
  for (const file of store.list()) {
    const match = /^r\d+-s(\d+)-a(\d+)\.mp3$/.exec(file.name);
    if (match !== null && Number(match[1]) === surah && !wanted.has(Number(match[2]))) {
      store.remove(file.name);
    }
  }
  await service.hydrate();
}

/** A resolver that answers immediately for every ayah of the generation it is given. */
export function resolverFor(generation: BoundGeneration): RecitationUrlResolver {
  return {
    async resolve(surah) {
      const urls = new Map<number, string>();
      for (const row of generation.rows.filter((entry) => entry.surah === surah)) {
        /*
          A URL shaped like the vendor's, so a test that accidentally leaked one into a playlist or a
          log would be recognisable. It is never fetched — the filesystem double answers every
          transfer from `mockFileSystem.respondWith`.
        */
        urls.set(row.ayah, `https://verses.quran.foundation/${row.verseKey}.mp3`);
      }
      return await Promise.resolve({ kind: 'ok', urls });
    },
  };
}

/** Always online, on Wi-Fi. The state in which a download is permitted to run. */
export const ONLINE_WIFI: ConnectivityPort = {
  current: async () =>
    await Promise.resolve({
      isConnected: true,
      reachability: 'online' as const,
      kind: 'wifi' as const,
      isWifi: true,
      isMetered: false,
    }),
  currentOrUnknown: async () =>
    await Promise.resolve({
      isConnected: true,
      reachability: 'online' as const,
      kind: 'wifi' as const,
      isWifi: true,
      isMetered: false,
    }),
  subscribe: () => () => undefined,
};

export const OFFLINE: ConnectivityPort = {
  current: async () => await Promise.resolve(OFFLINE_STATE),
  currentOrUnknown: async () => await Promise.resolve(OFFLINE_STATE),
  subscribe: () => () => undefined,
};

/**
 * A download service over the in-memory filesystem, with everything else injectable.
 *
 * The manifest file port is the real one, so the atomic write, the checksum envelope and the decode
 * are all exercised — the double is the filesystem underneath them, which is the only layer a Jest
 * environment genuinely cannot provide.
 */
export function createTestOfflineService(options?: {
  readonly generation?: BoundGeneration | null;
  readonly connectivity?: ConnectivityPort;
  readonly resolver?: RecitationUrlResolver;
  readonly now?: () => number;
  readonly concurrency?: number;
}): OfflineDownloadService {
  const generation = options?.generation === undefined ? FATIHAH_GENERATION : options.generation;
  return createOfflineDownloadService({
    manifest: createOfflineManifestStore({ file: createExpoManifestFile() }),
    store: createExpoAudioStore('downloaded'),
    resolver:
      options?.resolver ??
      (generation === null
        ? { resolve: async () => await Promise.resolve({ kind: 'failed', reason: 'unavailable' }) }
        : resolverFor(generation)),
    connectivity: options?.connectivity ?? ONLINE_WIFI,
    generations: {
      active: async () => await Promise.resolve(generation),
      open: (id) => (generation !== null && generation.generationId === id ? generation : null),
    },
    ...(options?.now === undefined ? {} : { now: options.now }),
    ...(options?.concurrency === undefined ? {} : { concurrency: options.concurrency }),
  });
}

/** The private path a downloaded ayah occupies, for the suites that assert where bytes live. */
export function downloadedUri(surah: number, ayah: number): string {
  return `file:///documents/faith-recitations-downloaded/${offlineFileName(PERMITTED_RESOURCE_ID, surah, ayah)}`;
}

/** Places validated audio directly, bypassing the transfer. For migration and repair suites. */
export function seedFileOnDisk(
  kind: 'downloaded' | 'prepared',
  surah: number,
  ayah: number,
  bytes = 4096,
): string {
  const directory =
    kind === 'downloaded'
      ? 'file:///documents/faith-recitations-downloaded'
      : 'file:///cache/faith-recitations';
  const uri = `${directory}/${offlineFileName(PERMITTED_RESOURCE_ID, surah, ayah)}`;
  mockFileSystem.seed(uri, mockFileSystem.audioBytes(bytes));
  return uri;
}

export type ReaderHarness = {
  readonly view: typeof screen;
  /** The service the tree is using, for asserting offline state directly. */
  readonly offline: OfflineDownloadService;
};

/**
 * The verses the reader suites assume are on the device.
 *
 * Two, not seven, and that is the point: Al-Fatihah half-downloaded is the state in which the panel
 * has to stop honestly at verse three rather than skip it or fetch it, and a fixture with the whole
 * surah present could not exercise that at all.
 */
export const READER_DOWNLOADED: readonly number[] = [1, 2];

export async function renderReader(options?: {
  readonly repositories?: Partial<FaithRepositories>;
  readonly surah?: string;
  readonly offline?: OfflineDownloadService;
  /**
   * Ayat of the rendered surah to place on disk before the tree mounts.
   *
   * Replaces the old `recitations` option, and the rename is not cosmetic. That option supplied the
   * *publisher's* list, which under the previous architecture was also what could be played — the
   * reader fetched from it on demand. Playback is local-only now, so what a suite has to state is
   * which verses are **on the device**, and passing a list of URLs would be stating something that no
   * longer decides anything.
   */
  readonly downloaded?: readonly number[];
  /**
   * Safe-area insets for this render, for the suites that assert the layout arithmetic.
   *
   * The library's Jest double answers zero on every edge, which is the one value that makes an inset
   * added twice indistinguishable from an inset added once. Supplying a real bottom inset is how the
   * docked player's clearance can be checked at all.
   */
  readonly insets?: { readonly top: number; readonly bottom: number };
}): Promise<ReaderHarness> {
  setRouteParams({ surah: options?.surah ?? '1' });
  const mocks = createMockFaithRepositories();
  const surah = Number(options?.surah ?? '1');
  const offline =
    options?.offline ?? createTestOfflineService({ generation: generationFor(surah, 7) });

  if (options?.downloaded !== undefined && options.downloaded.length > 0) {
    await seedDownloaded(offline, surah, options.downloaded);
  }

  const quran = {
    ...mocks.quran,
    availableReciters: async () =>
      await Promise.resolve({
        kind: 'ok' as const,
        data: [{ id: '3', name: 'Abdur-Rahman as-Sudais', style: 'Murattal' }],
      }),
    ...options?.repositories?.quran,
  };

  const tree = (
    <FaithRepositoryProvider repositories={{ ...mocks, ...options?.repositories, quran }}>
      <OfflineRecitationProvider service={offline}>
        <ReaderScreen />
      </OfflineRecitationProvider>
    </FaithRepositoryProvider>
  );

  await render(
    options?.insets === undefined ? (
      tree
    ) : (
      <SafeAreaInsetsContext.Provider
        value={{ ...options.insets, left: 0, right: 0 }}
        // The library's own hook reads this context first and falls back to its zero double, so
        // providing it is the supported way to render a screen on a device with a gesture bar.
      >
        {tree}
      </SafeAreaInsetsContext.Provider>
    ),
  );

  return { view: screen, offline };
}

/** Renders `element` inside both Faith providers, for suites that are not the reader itself. */
export async function renderInFaith(
  element: ReactElement,
  repositories?: Partial<FaithRepositories>,
  offline?: OfflineDownloadService,
): Promise<typeof screen> {
  const mocks = createMockFaithRepositories();
  await render(
    <FaithRepositoryProvider repositories={{ ...mocks, ...repositories }}>
      <OfflineRecitationProvider service={offline ?? createTestOfflineService()}>
        {element}
      </OfflineRecitationProvider>
    </FaithRepositoryProvider>,
  );
  return screen;
}

/**
 * Starts playback the only way the reader offers: press the verse, then **Play** in its sheet.
 *
 * There is no per-ayah play button and no overflow menu any more, and this helper is the executable
 * statement of that: every suite that wants audio playing has to go through the same two deliberate
 * taps a user makes, and a regression that reintroduced a one-tap control would not make any of them
 * pass more easily.
 */
export async function playFromAyah(view: typeof screen, ayah: number): Promise<void> {
  fireEvent.press(await view.findByTestId(`faith-reader-ayah-1-${ayah}`));
  fireEvent.press(await view.findByTestId('faith-reader-action-play'));
}

/** Waits until the docked player has rendered its identity line. */
export async function waitForPlayer(view: typeof screen): Promise<void> {
  await waitFor(() => expect(view.getByTestId('faith-reader-player-title')).toBeTruthy());
}
