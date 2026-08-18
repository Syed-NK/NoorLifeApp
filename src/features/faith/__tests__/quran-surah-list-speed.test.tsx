import AsyncStorage from '@react-native-async-storage/async-storage';
import { configure, render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';

import { warmUpFirstMount } from '@/test-support/mock-latency-timers';

import { hasData } from '../data/faith-result';
import { createMockFaithRepositories } from '../data/mock';
import {
  resetSurahCatalogueWarmup,
  surahCatalogueSnapshot,
  warmSurahCatalogue,
} from '../data/quran-catalogue-warmup';
import {
  createQuranFoundationRepository,
  defaultQuranCachePolicy,
  type QuranContentPayload,
  type QuranContentRequest,
  type QuranEndpointOutcome,
  type SurahCatalogueStore,
  type WireChapter,
} from '../data/quran-foundation';
import type { QuranContentRepository, SurahSummary } from '../data/quran-content.repository';
import { FaithRepositoryProvider } from '../di/faith-repository-context';
import { QuranScreen } from '../screens/quran-screen';
import { readCachedCatalogue, SURAH_COUNT } from '../storage/faith-quran-catalogue';

/**
 * How fast the Qur'an screen can draw its 114 rows, and what it refuses to wait for.
 *
 * ── The measured cause, and why persisting the catalogue was not enough ─────
 * The catalogue already survived restarts, so the cold open no longer paid for a network round trip.
 * The screen was still slow, and the reason is that everything remaining was still *asynchronous*:
 * `useFaithResource` reports `loading` on any render where nothing has settled — which is,
 * unavoidably, the first one. The sequence on every open of the tab was
 *
 *   mount → skeleton → `await` AsyncStorage → 114 rows,
 *
 * and the await is single-digit milliseconds. The user does not perceive "3 ms of storage read";
 * they perceive a skeleton appearing and being replaced, which reads as slower than a plain pause of
 * the same length.
 *
 * The fix is the startup snapshot: the read happens once at application startup, into a module-level
 * value that `useSurahCatalogue` seeds its state from **during its first render**. These cases pin
 * that, and pin what the list must never block on.
 *
 * ── What is deliberately not asserted here ──────────────────────────────────
 * A millisecond figure. Jest's clock is not the device's, and a wall-clock budget asserted here would
 * either be so loose it proves nothing or so tight it fails on a busy CI worker. What is asserted is
 * the property that produces the speed on a device: **no loading state is rendered at all**. The
 * device timings are measured on the emulator and reported separately.
 */

const CHAPTERS: readonly WireChapter[] = Array.from({ length: SURAH_COUNT }, (_, index) => ({
  number: index + 1,
  name: `Surah ${index + 1}`,
  arabicName: 'اسم',
  meaning: 'Meaning',
  ayahCount: 7,
  revelation: index % 2 === 0 ? 'meccan' : 'medinan',
}));

/** Records every request the repository issues, so Edge Function invocations can be counted. */
function recordingEndpoint(options?: { readonly hold?: boolean }): {
  readonly endpoint: {
    request(r: QuranContentRequest): Promise<QuranEndpointOutcome<QuranContentPayload>>;
  };
  readonly calls: QuranContentRequest[];
  readonly release: () => void;
} {
  const calls: QuranContentRequest[] = [];
  let unblock: (() => void) | null = null;
  const gate =
    options?.hold === true
      ? new Promise<void>((resolve) => {
          unblock = resolve;
        })
      : null;

  return {
    calls,
    release: () => unblock?.(),
    endpoint: {
      async request(request) {
        calls.push(request);
        if (gate !== null) {
          await gate;
        }
        return {
          kind: 'ok',
          data: { operation: 'list_chapters', chapters: CHAPTERS },
          cacheMaxAgeMs: 24 * 60 * 60 * 1000,
        };
      },
    },
  };
}

function storeHolding(chapters: readonly WireChapter[], storedAt: number): SurahCatalogueStore {
  return {
    read: () => Promise.resolve({ chapters, storedAt }),
    write: () => Promise.resolve(),
  };
}

/**
 * Three seconds for `findBy*`/`waitFor`, and a matching per-test budget.
 *
 * Real timers are kept deliberately: this suite drives the catalogue through promise chains, and the
 * two "never answers" cases hold a promise open forever on purpose — under a fake clock `waitFor`
 * exhausts a simulated budget in microseconds before the rest of the tree settles. What the real
 * clock costs here is the Faith fixtures' 280 ms per read, several reads per mount. At the library's
 * one-second default the mount after a held request began timing out under parallel load, which is a
 * slow harness reported as a broken screen.
 */
configure({ asyncUtilTimeout: 3000 });
jest.setTimeout(15000);

warmUpFirstMount(async () => {
  await render(
    <FaithRepositoryProvider repositories={createMockFaithRepositories()}>
      <QuranScreen />
    </FaithRepositoryProvider>,
  );
  return screen;
});

beforeEach(async () => {
  await AsyncStorage.clear();
  resetSurahCatalogueWarmup();
});

async function renderQuran(quran: QuranContentRepository): Promise<typeof screen> {
  const mocks = createMockFaithRepositories();
  await render(
    <FaithRepositoryProvider repositories={{ ...mocks, quran }}>
      <QuranScreen />
    </FaithRepositoryProvider>,
  );
  return screen;
}

describe('the startup snapshot', () => {
  it('makes the catalogue readable synchronously once it has been warmed', async () => {
    const { endpoint } = recordingEndpoint();
    const quran = createQuranFoundationRepository({
      endpoint,
      cachePolicy: defaultQuranCachePolicy,
      serveStaleWhenOffline: true,
    });

    // Nothing warmed yet: the screen has no choice but its ordinary loading state.
    expect(surahCatalogueSnapshot()).toBeNull();

    await warmSurahCatalogue(quran);

    const snapshot = surahCatalogueSnapshot();
    expect(snapshot).not.toBeNull();
    expect(snapshot !== null && hasData(snapshot) ? snapshot.data.length : 0).toBe(SURAH_COUNT);
  });

  it('produces one read however many callers ask at once', async () => {
    /**
     * Startup calls it, the Qur'an screen calls it on mount, and the reader's surah picker calls it
     * too. Without the join those are three `listSurahs()` calls in the same second — and on a first
     * install, where nothing is stored, three authenticated round trips against a rate limit NoorLife
     * shares across every user.
     */
    const { endpoint, calls, release } = recordingEndpoint({ hold: true });
    const quran = createQuranFoundationRepository({
      endpoint,
      cachePolicy: defaultQuranCachePolicy,
      serveStaleWhenOffline: true,
    });

    const all = Promise.all([
      warmSurahCatalogue(quran),
      warmSurahCatalogue(quran),
      warmSurahCatalogue(quran),
    ]);
    release();
    await all;

    expect(calls.filter((call) => call.operation === 'list_chapters')).toHaveLength(1);
  });

  it('caches nothing when the source could not answer, so the next caller retries', async () => {
    const failing: QuranContentRepository = {
      ...createMockFaithRepositories().quran,
      listSurahs: () => Promise.resolve({ kind: 'offline' as const }),
    };

    await warmSurahCatalogue(failing);

    // An offline launch must not poison the snapshot with a failure a later launch inherits.
    expect(surahCatalogueSnapshot()).toBeNull();
  });
});

describe('the Qur’an screen renders its rows without a loading state', () => {
  it('draws all 114 surahs in the first committed frame when the snapshot is warm', async () => {
    const { endpoint, calls } = recordingEndpoint();
    const quran = createQuranFoundationRepository({
      endpoint,
      cachePolicy: defaultQuranCachePolicy,
      serveStaleWhenOffline: true,
    });
    await warmSurahCatalogue(quran);
    const callsAfterWarm = calls.length;

    const view = await renderQuran(quran);

    /**
     * THE ASSERTION. Not "the skeleton went away quickly" — the skeleton was never rendered. That is
     * the difference between an await of three milliseconds and no await at all, and it is what the
     * user was reporting as slowness.
     */
    expect(view.queryByTestId('faith-quran-list-loading')).toBeNull();
    expect(view.getByTestId('faith-quran-surah-1')).toBeTruthy();

    /**
     * All 114 are in the list's data; only a screenful is *mounted*.
     *
     * That is the point of the change and it is why the assertion is on `data` rather than on the
     * hundred-and-fourteenth row: mounting every row synchronously was measured at 420 ms of dead
     * time on a Samsung SM-G556B, against 33 ms for a Faith screen with a handful of rows. Asserting
     * that row 114 is rendered would be asserting the defect.
     */
    expect(view.getByTestId('faith-quran-surahs').props.data).toHaveLength(SURAH_COUNT);

    // And no further Edge Function invocation was needed to draw them.
    expect(calls.length).toBe(callsAfterWarm);
  });

  it('shows the stored catalogue rather than a loading screen while it re-checks', async () => {
    /**
     * A stored catalogue past the server's freshness instruction but inside the licence week is
     * `stale`: perfectly servable, and worth confirming. The re-check happens **behind** the rows.
     * Replacing 114 rows with grey blocks to confirm a table of contents that has not changed since
     * the seventh century is the behaviour this is written against.
     */
    const { endpoint, calls, release } = recordingEndpoint({ hold: true });
    const quran = createQuranFoundationRepository({
      endpoint,
      cachePolicy: defaultQuranCachePolicy,
      serveStaleWhenOffline: true,
      // Stored two days ago, against a one-day catalogue freshness window.
      catalogueStore: storeHolding(CHAPTERS, Date.now() - 2 * 24 * 60 * 60 * 1000),
    });

    const view = await renderQuran(quran);

    await waitFor(() => expect(view.getByTestId('faith-quran-surah-1')).toBeTruthy());
    // The refresh is in flight — and the rows are on screen throughout it.
    expect(view.queryByTestId('faith-quran-list-loading')).toBeNull();
    expect(calls.some((call) => call.operation === 'list_chapters')).toBe(true);

    release();
    await waitFor(() =>
      expect(view.getByTestId('faith-quran-surahs').props.data).toHaveLength(SURAH_COUNT),
    );
  });

  it('never replaces cached rows with a skeleton on a background refresh', async () => {
    const { endpoint, release } = recordingEndpoint({ hold: true });
    const quran = createQuranFoundationRepository({
      endpoint,
      cachePolicy: defaultQuranCachePolicy,
      serveStaleWhenOffline: true,
      catalogueStore: storeHolding(CHAPTERS, Date.now() - 2 * 24 * 60 * 60 * 1000),
    });

    const view = await renderQuran(quran);
    await waitFor(() => expect(view.getByTestId('faith-quran-surah-1')).toBeTruthy());

    // Held across several ticks, which is the window in which a naive implementation blanks.
    for (let tick = 0; tick < 5; tick += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(view.queryByTestId('faith-quran-list-loading')).toBeNull();
      expect(view.getByTestId('faith-quran-surah-1')).toBeTruthy();
    }

    release();
  });
});

describe('the surah list waits for nothing that is not the surah list', () => {
  it('renders while the translation is still being resolved', async () => {
    /**
     * A table of contents held up by a question about its footnotes. The screen reads no translation
     * preference at all, and this asserts it stays that way: the repository's translation methods
     * never settle, and the rows are on screen regardless.
     */
    const { endpoint } = recordingEndpoint();
    const base = createQuranFoundationRepository({
      endpoint,
      cachePolicy: defaultQuranCachePolicy,
      serveStaleWhenOffline: true,
    });
    const quran: QuranContentRepository = {
      ...base,
      availableTranslations: () => new Promise(() => undefined),
      listTranslations: () => new Promise(() => undefined),
    };

    const view = await renderQuran(quran);

    await waitFor(() => expect(view.getByTestId('faith-quran-surah-1')).toBeTruthy());
    expect(view.getByTestId('faith-quran-surahs').props.data).toHaveLength(SURAH_COUNT);
  });

  it('renders while the reciter catalogue and audio never answer', async () => {
    const { endpoint } = recordingEndpoint();
    const base = createQuranFoundationRepository({
      endpoint,
      cachePolicy: defaultQuranCachePolicy,
      serveStaleWhenOffline: true,
    });
    const quran: QuranContentRepository = {
      ...base,
      availableReciters: () => new Promise(() => undefined),
      listRecitations: () => new Promise(() => undefined),
    };

    const view = await renderQuran(quran);

    await waitFor(() => expect(view.getByTestId('faith-quran-surah-1')).toBeTruthy());
  });

  it('issues no request for anything but the catalogue while drawing the list', async () => {
    /**
     * Counted rather than asserted by absence, because the interesting failure is a *second*
     * operation creeping onto the first-paint path — a reciter catalogue fetched to decide a subtitle,
     * a verse fetched to compute progress. One operation, one invocation.
     */
    const { endpoint, calls } = recordingEndpoint();
    const quran = createQuranFoundationRepository({
      endpoint,
      cachePolicy: defaultQuranCachePolicy,
      serveStaleWhenOffline: true,
    });

    const view = await renderQuran(quran);
    await waitFor(() => expect(view.getByTestId('faith-quran-surah-1')).toBeTruthy());

    expect(calls.map((call) => call.operation)).toEqual(['list_chapters']);
  });
});

describe('a stored catalogue is complete or it is not served', () => {
  it('refuses a stored catalogue that is not all 114 surahs, and fetches instead', async () => {
    /**
     * 114 valid rows that are all surah 3 is 114 valid rows. Requiring the complete set is what makes
     * "validated" mean the catalogue is *usable* rather than merely parseable — and serving a short
     * one would put a Qur'an with a missing surah on screen.
     *
     * ── Driven through the real store, not a hand-written one ───────────────────
     * The validation is the store's job and the repository trusts the port, so a fake store returning
     * fifty rows would prove only that the repository trusts its port — which it does, by design. The
     * truncated blob is written to storage directly, so the code that rejects it is the shipped code.
     */
    await AsyncStorage.setItem(
      'noorlife.faith.quran.catalogue',
      JSON.stringify({ version: 1, storedAt: Date.now(), chapters: CHAPTERS.slice(0, 50) }),
    );

    expect(await readCachedCatalogue()).toBeNull();

    const { endpoint, calls } = recordingEndpoint();
    const quran = createQuranFoundationRepository({
      endpoint,
      cachePolicy: defaultQuranCachePolicy,
      serveStaleWhenOffline: true,
      catalogueStore: {
        read: readCachedCatalogue,
        write: () => Promise.resolve(),
      },
    });

    const result = await quran.listSurahs();

    // The store refused the short blob, so the approved source answered instead.
    expect(hasData(result) ? result.data.length : 0).toBe(SURAH_COUNT);
    expect(calls.map((call) => call.operation)).toEqual(['list_chapters']);
  });

  it('refuses 114 rows that are not 114 distinct surahs', async () => {
    await AsyncStorage.setItem(
      'noorlife.faith.quran.catalogue',
      JSON.stringify({
        version: 1,
        storedAt: Date.now(),
        // The right *count* of the wrong thing — the case a shape check alone would pass.
        chapters: Array.from({ length: SURAH_COUNT }, () => CHAPTERS[2]),
      }),
    );

    expect(await readCachedCatalogue()).toBeNull();
  });
});

/** Asserted separately from the screen, because it is a property of the summaries themselves. */
function isCompleteCatalogue(list: readonly SurahSummary[]): boolean {
  return new Set(list.map((entry) => entry.number)).size === SURAH_COUNT;
}

describe('the served catalogue is the whole Qur’an', () => {
  it('carries every surah number exactly once', async () => {
    const { endpoint } = recordingEndpoint();
    const quran = createQuranFoundationRepository({
      endpoint,
      cachePolicy: defaultQuranCachePolicy,
      serveStaleWhenOffline: true,
    });

    const result = await quran.listSurahs();
    expect(hasData(result) && isCompleteCatalogue(result.data)).toBe(true);
  });
});
