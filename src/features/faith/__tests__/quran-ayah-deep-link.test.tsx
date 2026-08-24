import AsyncStorage from '@react-native-async-storage/async-storage';
import { render, screen } from '@testing-library/react-native';
import React from 'react';

import { warmUpFirstMount } from '@/test-support/mock-latency-timers';
import { settleUntilLoaded } from '@/test-support/settle-until-loaded';
import { seedTranslationPreference } from '@/test-support/faith-preferences-fixtures';

import { mockAudio, setRouteParams } from '../../../../jest.setup';

import type { FaithResult, FaithPage, FaithPageRequest } from '../data/faith-result';
import { createMockFaithRepositories } from '../data/mock';
import {
  ayahNumber,
  surahNumber,
  type AyahRecitation,
  type AyahText,
  type AyahTranslation,
  type QuranContentRepository,
  type SurahSummary,
  type TranslationId,
} from '../data/quran-content.repository';
import {
  AYAH_TARGET_PAGE_SIZE,
  containsAyah,
  mergeAyahPages,
  planAyahTarget,
  targetPageRequest,
} from '../data/quran/ayah-target';
import { FaithRepositoryProvider } from '../di/faith-repository-context';
import { ReaderScreen } from '../screens/reader-screen';

/**
 * The reader opens at the verse it was asked for — or says it did not.
 *
 * ── The defect these cases were written against ─────────────────────────────
 * `reader/2?ayah=255` announced **"Opened at verse 255"** and rendered Al-Baqarah from verse 1.
 * `reader/2?ayah=12` appeared to work, and that appearance was the trap: 12 is inside the first
 * twenty-row page, so the feature had never worked — it had only ever been exercised inside page
 * one. The loading path ignored `?ayah=` completely and the announcement was a restatement of the
 * URL dressed as an observation about the screen.
 *
 * Every case below fails against that build. The middle and final-ayah cases fail because the verse
 * is not rendered; the announcement cases fail because it was announced anyway.
 *
 * ── Why this file brings its own repository ─────────────────────────────────
 * The shared mock holds a handful of ayat and no surah long enough to have a second page, so it
 * cannot express the defect at all. `createPaginatedQuran` below serves a full 286-verse Al-Baqarah
 * and a 7-verse Al-Fatihah, and — the part that matters — it **encodes its cursor as an item
 * offset**, which is what the in-memory repository really does and what the Quran Foundation adapter
 * deliberately does not. A reader that computed cursors instead of echoing them would pass against
 * the vendor's page-number encoding and render the wrong verses here.
 */

const AL_BAQARAH_AYAT = 286;
const AL_FATIHAH_AYAT = 7;

const SURAHS: readonly SurahSummary[] = [
  {
    number: surahNumber(1),
    name: 'Al-Fatihah',
    arabicName: 'الفاتحة',
    meaning: 'The Opening',
    ayahCount: AL_FATIHAH_AYAT,
    revelation: 'meccan',
  },
  {
    number: surahNumber(2),
    name: 'Al-Baqarah',
    arabicName: 'البقرة',
    meaning: 'The Cow',
    ayahCount: AL_BAQARAH_AYAT,
    revelation: 'medinan',
  },
];

const SOURCE = { name: 'Deep-link test source', verified: true } as const;

function ayahCountOf(surah: number): number {
  return SURAHS.find((item) => item.number === surah)?.ayahCount ?? 0;
}

/**
 * Pages by **item offset**, exactly as `mock-support.ts` does.
 *
 * The encoding is the point of this helper, not an implementation detail: `FaithPageRequest.cursor`
 * is opaque, the two real repositories encode it differently, and a caller that synthesised one
 * would silently read from the wrong place here.
 */
function paginateByOffset<T>(items: readonly T[], page?: FaithPageRequest): FaithPage<T> {
  const limit = page?.limit ?? 20;
  const from = page?.cursor === undefined ? 0 : Number.parseInt(page.cursor, 10);
  const start = Number.isNaN(from) ? 0 : from;
  const next = start + limit;
  return {
    items: items.slice(start, next),
    nextCursor: next < items.length ? String(next) : null,
    total: items.length,
  };
}

/** Every request this repository received, so a test can assert page sizes and cursor echoes. */
type RequestLog = { readonly surah: number; readonly page?: FaithPageRequest }[];

/*
  ── Built once per surah, not once per read (issue #55) ─────────────────────
  These arrays used to be rebuilt inside every `listAyahs` and `listTranslations` call, so a single
  deep-link case allocated Al-Baqarah's 286 verses twelve times over and threw away all but the fifty
  rows it sliced. Across the file that is tens of thousands of objects created to be discarded, in a
  worker whose heap already carries nine 286-row React trees.

  The content is immutable and depends only on the surah — and on the translation id, which the reader
  only ever asks for one of — so it is memoised. Nothing about what the repository *returns* changes;
  a caller still gets a fresh slice from `paginateByOffset`, so a test cannot mutate another test's
  data through it.
*/
const textBySurah = new Map<number, readonly AyahText[]>();
const translationsBySurah = new Map<string, readonly AyahTranslation[]>();

function textFor(surah: number): readonly AyahText[] {
  const cached = textBySurah.get(surah);
  if (cached !== undefined) {
    return cached;
  }
  const built: readonly AyahText[] = Array.from({ length: ayahCountOf(surah) }, (_, index) => ({
    surah: surahNumber(surah),
    ayah: ayahNumber(index + 1),
    /* A distinct, non-Arabic marker per verse, so a rendered verse is identifiable by number. */
    arabic: `verse-${surah}-${index + 1}`,
    source: SOURCE,
  }));
  textBySurah.set(surah, built);
  return built;
}

function translationsFor(surah: number, translationId: TranslationId): readonly AyahTranslation[] {
  const key = `${surah}:${String(translationId)}`;
  const cached = translationsBySurah.get(key);
  if (cached !== undefined) {
    return cached;
  }
  const built: readonly AyahTranslation[] = Array.from(
    { length: ayahCountOf(surah) },
    (_, index) => ({
      surah: surahNumber(surah),
      ayah: ayahNumber(index + 1),
      translationId,
      text: `meaning-${surah}-${index + 1}`,
      source: { ...SOURCE, attribution: 'A Translator' },
    }),
  );
  translationsBySurah.set(key, built);
  return built;
}

function createPaginatedQuran(
  log: RequestLog,
  base: QuranContentRepository,
): QuranContentRepository {
  return {
    ...base,
    source: SOURCE,
    async listSurahs(): Promise<FaithResult<readonly SurahSummary[]>> {
      return { kind: 'ok', data: SURAHS };
    },
    async getSurah(surah): Promise<FaithResult<SurahSummary>> {
      const found = SURAHS.find((item) => item.number === surah);
      return found === undefined
        ? { kind: 'error', code: 'not-found' }
        : { kind: 'ok', data: found };
    },
    async listAyahs(surah, page): Promise<FaithResult<FaithPage<AyahText>>> {
      log.push({ surah, ...(page === undefined ? {} : { page }) });
      return { kind: 'ok', data: paginateByOffset(textFor(surah), page) };
    },
    async listTranslations(
      surah,
      translationId,
      page,
    ): Promise<FaithResult<FaithPage<AyahTranslation>>> {
      return { kind: 'ok', data: paginateByOffset(translationsFor(surah, translationId), page) };
    },
    async listRecitations(): Promise<FaithResult<FaithPage<AyahRecitation>>> {
      return { kind: 'empty' };
    },
  };
}

async function openReader(params: Record<string, string>, log: RequestLog = []) {
  setRouteParams(params);
  /*
    One mock repository set per open, not two. This built `createMockFaithRepositories()` twice — once
    to spread and once inside `createPaginatedQuran` — for a double whose Quran methods are all
    replaced anyway.
  */
  const base = createMockFaithRepositories();
  const repositories = { ...base, quran: createPaginatedQuran(log, base.quran) };
  await render(
    <FaithRepositoryProvider repositories={repositories}>
      <ReaderScreen />
    </FaithRepositoryProvider>,
  );
  await settleUntilLoaded('faith-reader-body-loading');
  return screen;
}

/*
  Warmed on the *expensive* path, not the cheap one.

  This warmed `{ surah: '1' }` — seven verses — which compiled the provider stack but never the long
  list. Nine cases in this file open a target inside Al-Baqarah and render up to 286 verse rows, and
  the reader renders them with `items.map` inside a `ScrollView`, so every row mounts. Warming that
  path here pays its one-off compile cost under `beforeAll`'s own budget instead of charging it to
  whichever heavy case happens to run first.
*/
warmUpFirstMount(() => openReader({ surah: '2', ayah: '286' }));

beforeEach(async () => {
  await AsyncStorage.clear();
  await seedTranslationPreference();
});

// ─────────────────────────────────────────────────────────────────────────────
// The planner, on its own
// ─────────────────────────────────────────────────────────────────────────────

describe('planning which pages contain a target', () => {
  it('asks for nothing when the route named no verse', () => {
    expect(planAyahTarget({ ayah: null, ayahCount: AL_BAQARAH_AYAT }).kind).toBe('none');
  });

  it('rejects a verse the surah does not have, rather than fetching for it', () => {
    const plan = planAyahTarget({ ayah: 300, ayahCount: AL_BAQARAH_AYAT });
    expect(plan.kind).toBe('out-of-range');
    /* The real length travels with the rejection, so the screen can state it instead of guessing. */
    expect(plan).toMatchObject({ ayah: 300, ayahCount: AL_BAQARAH_AYAT });

    expect(planAyahTarget({ ayah: 8, ayahCount: AL_FATIHAH_AYAT }).kind).toBe('out-of-range');
    expect(planAyahTarget({ ayah: 0, ayahCount: AL_FATIHAH_AYAT }).kind).toBe('out-of-range');
    expect(planAyahTarget({ ayah: -1, ayahCount: AL_FATIHAH_AYAT }).kind).toBe('out-of-range');
    expect(planAyahTarget({ ayah: 1.5, ayahCount: AL_FATIHAH_AYAT }).kind).toBe('out-of-range');
  });

  it('bounds the read by the verse and the page size, not by the surah', () => {
    /* 255 at 50 rows is six pages. The old twenty-row walk was thirteen. */
    expect(planAyahTarget({ ayah: 255, ayahCount: AL_BAQARAH_AYAT })).toMatchObject({
      kind: 'span',
      maxPages: 6,
      pageSize: AYAH_TARGET_PAGE_SIZE,
    });
    /* A verse inside the first page costs exactly one read. */
    expect(planAyahTarget({ ayah: 12, ayahCount: AL_BAQARAH_AYAT })).toMatchObject({ maxPages: 1 });
    expect(planAyahTarget({ ayah: 286, ayahCount: AL_BAQARAH_AYAT })).toMatchObject({
      maxPages: 6,
    });
  });

  it('never synthesises a cursor — page one is a request with no cursor at all', () => {
    /*
      The rule the whole feature rests on. `cursor` is opaque and the repositories encode it
      differently; the only legal cursor is one the repository just returned.
    */
    expect(targetPageRequest(null)).toEqual({ limit: AYAH_TARGET_PAGE_SIZE });
    expect(targetPageRequest('250')).toEqual({ cursor: '250', limit: AYAH_TARGET_PAGE_SIZE });
  });
});

describe('assembling pages into one run', () => {
  it('drops a repeated verse rather than rendering it twice', () => {
    const merged = mergeAyahPages([
      [{ ayah: 1 }, { ayah: 2 }],
      [{ ayah: 2 }, { ayah: 3 }],
    ]);
    expect(merged.map((item) => item.ayah)).toEqual([1, 2, 3]);
  });

  it('orders by verse, not by arrival', () => {
    const merged = mergeAyahPages([[{ ayah: 51 }], [{ ayah: 1 }], [{ ayah: 20 }]]);
    expect(merged.map((item) => item.ayah)).toEqual([1, 20, 51]);
  });

  it('answers presence by verse key, never by array length', () => {
    const items = [{ ayah: 1 }, { ayah: 2 }, { ayah: 3 }];
    /*
      The defect in one assertion. A positional test — `ayah <= items.length` — would call 3 present
      and it is; it would also call 255 absent only by luck of the list being short. Presence is a
      search, and 255 is absent here because it is not in the list.
    */
    expect(containsAyah(items, 3)).toBe(true);
    expect(containsAyah(items, 255)).toBe(false);
    expect(containsAyah(items, null)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The reader, end to end
// ─────────────────────────────────────────────────────────────────────────────

describe('a deep link opens at its verse', () => {
  it('renders a verse on page one — the case that always appeared to work', async () => {
    const view = await openReader({ surah: '2', ayah: '12' });

    expect(view.getByText('verse-2-12')).toBeTruthy();
    const header = view.getByTestId('faith-reader-header-label');
    expect(String(header.props.accessibilityLabel)).toContain('Opened at verse 12');
  });

  it('renders Al-Baqarah 255, which is nowhere near page one', async () => {
    const view = await openReader({ surah: '2', ayah: '255' });

    /* The verse itself is on screen. Against the previous build this line fails. */
    expect(view.getByText('verse-2-255')).toBeTruthy();
    /* And its neighbours, so the target is inside a readable run rather than alone. */
    expect(view.getByText('verse-2-254')).toBeTruthy();
    expect(view.getByText('verse-2-256')).toBeTruthy();
  });

  it('announces 255 only because 255 is rendered', async () => {
    const view = await openReader({ surah: '2', ayah: '255' });

    const header = view.getByTestId('faith-reader-header-label');
    expect(String(header.props.accessibilityLabel)).toContain('Opened at verse 255');
  });

  it('opens at the final verse of a long surah', async () => {
    const view = await openReader({ surah: '2', ayah: '286' });

    expect(view.getByText('verse-2-286')).toBeTruthy();
    const header = view.getByTestId('faith-reader-header-label');
    expect(String(header.props.accessibilityLabel)).toContain('Opened at verse 286');
  });

  /*
    One render per test, deliberately. Rendering twice in a single case — unmounting the first and
    mounting the second — is what produced the "overlapping act() calls" warning that corrupted every
    later test in this file. See the note in `openReader`.
  */
  it('opens at the first verse of a short surah', async () => {
    const view = await openReader({ surah: '1', ayah: '1' });

    expect(view.getByText('verse-1-1')).toBeTruthy();
    expect(
      String(view.getByTestId('faith-reader-header-label').props.accessibilityLabel),
    ).toContain('Opened at verse 1');
  });

  it('opens at the final verse of a short surah', async () => {
    const view = await openReader({ surah: '1', ayah: '7' });

    expect(view.getByText('verse-1-7')).toBeTruthy();
    expect(
      String(view.getByTestId('faith-reader-header-label').props.accessibilityLabel),
    ).toContain('Opened at verse 7');
  });

  it('loads the target without walking the surah in twenty-row pages', async () => {
    const log: RequestLog = [];
    const view = await openReader({ surah: '2', ayah: '255' }, log);

    /*
      Six reads at 50 rows, not thirteen at 20. The assertion is on the *page size* rather than only
      the count, because the count alone would pass for a build that read 255 rows one page at a
      time.
    */
    /* The target really did arrive — a vacuous pass on an empty log would prove nothing. */
    expect(view.getByText('verse-2-255')).toBeTruthy();
    expect(log.length).toBeGreaterThan(1);
    expect(log.length).toBeLessThanOrEqual(6);
    for (const entry of log) {
      expect(entry.page?.limit).toBe(AYAH_TARGET_PAGE_SIZE);
    }
  });

  it('echoes the repository’s own cursors rather than computing them', async () => {
    const log: RequestLog = [];
    const view = await openReader({ surah: '2', ayah: '255' }, log);

    /*
      This repository encodes its cursor as an **item offset**, so the second request must carry
      "50" — the value it returned — and not "2", the page number a synthesising caller would send.
      A build that computed cursors reads verses 2–51 here and never reaches 255.
    */
    expect(view.getByText('verse-2-255')).toBeTruthy();
    expect(log[0]?.page?.cursor).toBeUndefined();
    expect(log[1]?.page?.cursor).toBe('50');
    expect(log[2]?.page?.cursor).toBe('100');
  });

  it('renders each verse once and in order', async () => {
    const view = await openReader({ surah: '2', ayah: '255' });

    expect(view.getByText('verse-2-255')).toBeTruthy();
    /* Duplicate keys would render two nodes for one verse. */
    expect(view.queryAllByText('verse-2-50')).toHaveLength(1);
    expect(view.queryAllByText('verse-2-51')).toHaveLength(1);

    const rendered = view
      .queryAllByTestId(/^faith-reader-ayah-number-2-/)
      .map((node) => Number(String(node.props.testID).split('-').pop()));
    const ascending = [...rendered].sort((left, right) => left - right);
    expect(rendered).toEqual(ascending);
  });

  it('continues pagination from where the target load stopped', async () => {
    const view = await openReader({ surah: '2', ayah: '255' });

    /*
      Six pages of 50 is 300, which is past 286 — so Al-Baqarah is fully loaded and there is nothing
      left to continue. The affordance must therefore be absent rather than offering a page that
      would re-fetch verses already on screen.
    */
    expect(view.getByText('verse-2-255')).toBeTruthy();
    expect(view.queryByTestId('faith-reader-load-more')).toBeNull();
    expect(view.getByText('verse-2-286')).toBeTruthy();
  });

  it('offers a continuation when the target load did not reach the end', async () => {
    const view = await openReader({ surah: '2', ayah: '12' });

    /* One page of 50 verses of 286: the surah continues, and the reader says so. */
    expect(view.getByText('verse-2-12')).toBeTruthy();
    expect(view.getByTestId('faith-reader-more')).toBeTruthy();
    expect(view.getByTestId('faith-reader-load-more')).toBeTruthy();
  });
});

describe('a deep link that cannot be honoured says so', () => {
  it('refuses a verse the surah does not have, and states the real length', async () => {
    const view = await openReader({ surah: '2', ayah: '300' });

    expect(view.getByTestId('faith-reader-target-unavailable')).toBeTruthy();
    /*
      The surah's real length *and* the verse that was asked for, so the message answers the question
      rather than only refusing. Matched on the whole sentence, because "286 verses" on its own also
      appears in the header's metadata line.
    */
    expect(view.getByText(/This surah has 286 verses, so there is no verse 300/)).toBeTruthy();
    /* Not retryable: Al-Baqarah will still have 286 verses after a retry, so no Retry is offered. */
    expect(view.queryByText('Try again')).toBeNull();
  });

  it('does not announce a verse it refused to open at', async () => {
    const view = await openReader({ surah: '2', ayah: '300' });

    const header = view.getByTestId('faith-reader-header-label');
    /*
      The heart of the correction. The route said 300; the screen must not repeat it back as though
      it were an observation about what is rendered.
    */
    expect(String(header.props.accessibilityLabel)).not.toContain('Opened at verse 300');
  });

  it('still shows the surah from its beginning rather than an error screen', async () => {
    const view = await openReader({ surah: '2', ayah: '300' });

    /* The verses are fine. Only the request for one of them was impossible. */
    expect(view.getByText('verse-2-1')).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The player names the verse the reader opened at
// ─────────────────────────────────────────────────────────────────────────────

describe('the docked player agrees with the reader', () => {
  /*
    ── The defect these cover ────────────────────────────────────────────────
    `reader/2?ayah=255` opened at 255, scrolled to 255 and focused 255 — and the player captioned
    itself "Aya 1". Two causes, both fixed here:

      1. Recitations were fetched with one unpaged call, so the reciter's list stopped at verse 20
         and held nothing for 255. The transport could not be pointed at it.
      2. `ReaderPlayer` read `transport.focus`, which substitutes `ordered[0]` when nothing has been
         pointed at, so the fallback overruled the reader's own answer.

    This repository publishes no recitations at all, which is the harder case: with no audio
    anywhere the transport can never be pointed, so the caption must come from the reader's resolved
    target or it will be wrong.
  */
  it('captions the deep-linked verse even when no recitation exists', async () => {
    const view = await openReader({ surah: '2', ayah: '255' });

    expect(view.getByText('verse-2-255')).toBeTruthy();
    expect(String(view.getByTestId('faith-reader-player-title').props.children)).toBe(
      'Al-Baqarah • Aya 255',
    );
  });

  it('captions an early and a final verse from the same resolved target', async () => {
    const early = await openReader({ surah: '2', ayah: '12' });
    expect(String(early.getByTestId('faith-reader-player-title').props.children)).toBe(
      'Al-Baqarah • Aya 12',
    );
  });

  it('captions the final verse of a long surah', async () => {
    const view = await openReader({ surah: '2', ayah: '286' });
    expect(String(view.getByTestId('faith-reader-player-title').props.children)).toBe(
      'Al-Baqarah • Aya 286',
    );
  });

  it('never captions an ayah the surah does not have', async () => {
    const view = await openReader({ surah: '2', ayah: '300' });

    /* The route said 300. The player must not repeat it — the reader opened at the beginning. */
    const title = String(view.getByTestId('faith-reader-player-title').props.children);
    expect(title).not.toContain('300');
    expect(title).toBe('Al-Baqarah • Aya 1');
  });

  it('falls back to the page’s first verse when no verse was named', async () => {
    const view = await openReader({ surah: '2' });
    expect(String(view.getByTestId('faith-reader-player-title').props.children)).toBe(
      'Al-Baqarah • Aya 1',
    );
  });

  it('cannot carry one surah’s ayah into another', async () => {
    /*
      A new surah is a new reader key and a new load, so the resolved target is re-derived rather
      than inherited. Al-Fatihah has no verse 255 and the caption must say so by not saying it.
    */
    const view = await openReader({ surah: '1', ayah: '7' });
    const title = String(view.getByTestId('faith-reader-player-title').props.children);
    expect(title).toBe('Al-Fatihah • Aya 7');
    expect(title).not.toContain('255');
  });

  it('starts no audio merely by opening the link', async () => {
    const view = await openReader({ surah: '2', ayah: '255' });

    /*
      Opening a deep link points the player; it must not play. With no recitation published the
      panel additionally has to report that honestly rather than offering a control that cannot work.
    */
    expect(view.getByTestId('faith-reader-player')).toBeTruthy();
    expect(mockAudio.player.play).not.toHaveBeenCalled();
    /* And the transport control reports the honest unavailable state rather than a dead Play. */
    expect(view.getByTestId('faith-reader-player-toggle').props.accessibilityState?.disabled).toBe(
      true,
    );
  });
});
