import AsyncStorage from '@react-native-async-storage/async-storage';
import { render, fireEvent, screen } from '@testing-library/react-native';
import React, { type ReactElement } from 'react';

import { warmUpFirstMount } from '@/test-support/mock-latency-timers';
import { seedTranslationPreference } from '@/test-support/faith-preferences-fixtures';

import { mockRouter, setRouteParams } from '../../../../jest.setup';

import type { FaithRepositories } from '../data';
import { createMockFaithRepositories } from '../data/mock';
import { readingProgress } from '../data/quran-content.repository';
import { FaithRepositoryProvider } from '../di/faith-repository-context';
import { readerHref } from '../faith-routes';
import { parseAyahBookmarkId, BookmarksScreen } from '../screens/bookmarks-screen';
import { ContentInfoScreen } from '../screens/content-info-screen';
import { QuranScreen } from '../screens/quran-screen';
import { parseAyahParam, parseSurahParam, ReaderScreen } from '../screens/reader-screen';

/**
 * The reader is addressable, and the things that point at it point correctly.
 *
 * ── The three defects this covers ───────────────────────────────────────────
 * The reader lived at `/faith/reader` — one address, no parameters — and rendered whatever reading
 * position happened to be in storage. Three consequences followed, and each is asserted here:
 *
 *   1. Every one of the 114 surah rows pushed that same address, so tapping Al-Baqarah opened
 *      whatever the user last read. The catalogue was decorative.
 *   2. A bookmark could not open its verse, because there was nowhere in the route to say which
 *      verse it meant. The rows had no `onPress` at all, so the feature was a write-only log.
 *   3. The stored position was seeded with Al-Kahf verse 32 at 55% before the user had read
 *      anything, and the reader wrote a literal 0.55 as progress for every verse it saved.
 *
 * Real timers, for the reason `faith-interactions.test.tsx` records: these screens become ready
 * through promise chains rather than through a timer.
 */
warmUpFirstMount(() => withRepositories(<QuranScreen />));

beforeEach(async () => {
  await AsyncStorage.clear();
  // A translation is a precondition of these cases, not their subject. See the helper's note.
  await seedTranslationPreference();
});

async function withRepositories(
  element: ReactElement,
  repositories?: Partial<FaithRepositories>,
): Promise<typeof screen> {
  await render(
    <FaithRepositoryProvider repositories={repositories ?? createMockFaithRepositories()}>
      {element}
    </FaithRepositoryProvider>,
  );
  return screen;
}

describe('route parameter parsing', () => {
  it('accepts the 114 surahs and nothing else', () => {
    expect(parseSurahParam('1')).toBe(1);
    expect(parseSurahParam('114')).toBe(114);
    expect(parseSurahParam('18')).toBe(18);

    // A hand-typed or corrupted address must reach a not-found state, not throw out of a brand.
    expect(parseSurahParam('0')).toBeNull();
    expect(parseSurahParam('115')).toBeNull();
    expect(parseSurahParam('-2')).toBeNull();
    expect(parseSurahParam('two')).toBeNull();
    expect(parseSurahParam('')).toBeNull();
    expect(parseSurahParam(undefined)).toBeNull();
  });

  it('takes the first value when the router hands back an array', () => {
    // Expo Router yields `string | string[]`, and a repeated query parameter is the array case.
    expect(parseSurahParam(['18', '2'])).toBe(18);
    expect(parseAyahParam(['32'])).toBe(32);
  });

  it('accepts any positive verse number and rejects the rest', () => {
    expect(parseAyahParam('1')).toBe(1);
    expect(parseAyahParam('286')).toBe(286);
    expect(parseAyahParam('0')).toBeNull();
    expect(parseAyahParam('x')).toBeNull();
    expect(parseAyahParam(undefined)).toBeNull();
  });
});

describe('readerHref', () => {
  it('names the surah, and the verse when there is one', () => {
    expect(readerHref(18)).toEqual({
      pathname: '/faith/reader/[surah]',
      params: { surah: '18' },
    });
    expect(readerHref(18, 32)).toEqual({
      pathname: '/faith/reader/[surah]',
      params: { surah: '18', ayah: '32' },
    });
  });
});

describe('the surah catalogue opens the surah it names', () => {
  it('pushes a different address for each row', async () => {
    const view = await withRepositories(<QuranScreen />);

    fireEvent.press(await view.findByTestId('faith-quran-surah-2'));
    fireEvent.press(await view.findByTestId('faith-quran-surah-18'));

    expect(mockRouter.push).toHaveBeenCalledWith(readerHref(2));
    expect(mockRouter.push).toHaveBeenCalledWith(readerHref(18));
    // The defect: both of these used to be the same parameterless push.
    expect(mockRouter.push).toHaveBeenCalledTimes(2);
  });

  it('offers no Qur’an search control, because the scope is not approved', async () => {
    const view = await withRepositories(<QuranScreen />);
    await view.findByTestId('faith-quran-actions');

    expect(view.queryByTestId('faith-quran-search')).toBeNull();
  });
});

describe('the reader opens what the route names', () => {
  it('renders the surah in the path, not the one in storage', async () => {
    // A stored position for a *different* surah, which is precisely what used to win.
    await AsyncStorage.setItem(
      'noorlife.faith.quran.position',
      JSON.stringify({
        surah: 18,
        surahName: 'Al-Kahf',
        ayah: 32,
        ayahCount: 110,
        progress: 0.29,
        updatedAt: new Date().toISOString(),
      }),
    );
    setRouteParams({ surah: '1' });

    const view = await withRepositories(<ReaderScreen />);

    const header = await view.findByTestId('faith-reader-header-label');
    expect(String(header.props.accessibilityLabel)).toContain('Al-Fatihah');
    expect(String(header.props.accessibilityLabel)).not.toContain('Al-Kahf');
  });

  it('names the surah, its meaning, where it was revealed and how long it is', async () => {
    setRouteParams({ surah: '1' });
    const view = await withRepositories(<ReaderScreen />);

    const header = await view.findByTestId('faith-reader-header-label');
    const spoken = String(header.props.accessibilityLabel);

    expect(spoken).toContain('Surah 1');
    expect(spoken).toContain('Al-Fatihah');
    expect(spoken).toContain('The Opening');
    expect(spoken).toContain('Meccan');
    expect(spoken).toContain('7 verses');
  });

  it('cites every verse by surah and ayah rather than by a bare number', async () => {
    setRouteParams({ surah: '1' });
    const view = await withRepositories(<ReaderScreen />);

    /**
     * ── The citation moved form, not meaning ────────────────────────────────────
     * It used to read "Al-Fatihah 1:1" above every verse. In a continuous reader that repeats the
     * surah's name once per ayah — 286 times in Al-Baqarah — and the repetition is exactly the
     * chrome the layout exists to remove.
     *
     * What replaces it is the standard Qur'anic reference with the product's own word for a verse
     * in front of it — `Aya 1:1`. Still a citation and not a bare ordinal: it names the surah by
     * number, and the word removes the ambiguity a bare `1:1` beside a paragraph of Arabic carries.
     * The surah's *name* is carried where it is read once — the header — and in the action sheet a
     * verse opens, which is where a screen-reader user encounters it.
     */
    expect(await view.findByText('Aya 1:1')).toBeTruthy();
    expect(view.queryByText('Verse 1')).toBeNull();

    // The name, once, in the header rather than once per ayah.
    const header = await view.findByTestId('faith-reader-header-label');
    expect(String(header.props.accessibilityLabel)).toContain('Al-Fatihah');

    // And reachable per verse: the pill announces the reference, and the sheet it opens names the
    // surah — so nothing is reachable only by sight.
    expect(
      String(view.getByTestId('faith-reader-ayah-number-1-1').props.accessibilityLabel),
    ).toContain('Aya 1 verse 1');
  });

  it('announces the verse the route opened at', async () => {
    setRouteParams({ surah: '1', ayah: '2' });
    const view = await withRepositories(<ReaderScreen />);

    const header = await view.findByTestId('faith-reader-header-label');
    expect(String(header.props.accessibilityLabel)).toContain('Opened at verse 2');
  });

  it('reports a surah number that does not exist rather than throwing', async () => {
    setRouteParams({ surah: '999' });
    const view = await withRepositories(<ReaderScreen />);

    expect(await view.findByTestId('faith-reader-body-error')).toBeTruthy();
  });
});

describe('bookmarks open their verse', () => {
  it('splits a stored ayah id back into a surah and a verse', () => {
    expect(parseAyahBookmarkId('18:32')).toEqual({ surah: 18, ayah: 32 });
    expect(parseAyahBookmarkId('114:1')).toEqual({ surah: 114, ayah: 1 });

    expect(parseAyahBookmarkId('0:1')).toBeNull();
    expect(parseAyahBookmarkId('115:1')).toBeNull();
    expect(parseAyahBookmarkId('18:0')).toBeNull();
    expect(parseAyahBookmarkId('18')).toBeNull();
    expect(parseAyahBookmarkId('18:32:1')).toBeNull();
    expect(parseAyahBookmarkId('')).toBeNull();
  });

  it('navigates to the right surah and verse', async () => {
    await AsyncStorage.setItem(
      'noorlife.faith.bookmarks',
      JSON.stringify([
        {
          kind: 'ayah',
          id: '18:32',
          label: 'Al-Kahf 18:32',
          subtitle: 'A translation',
          savedAt: new Date().toISOString(),
        },
      ]),
    );

    const view = await withRepositories(<BookmarksScreen />);
    fireEvent.press(await view.findByTestId('faith-bookmark-ayah-18:32'));

    expect(mockRouter.push).toHaveBeenCalledWith(readerHref(18, 32));
  });

  it('leaves a non-ayah bookmark non-navigable rather than pointing it nowhere', async () => {
    await AsyncStorage.setItem(
      'noorlife.faith.bookmarks',
      JSON.stringify([
        {
          kind: 'hadith',
          id: 'bukhari-1',
          label: 'Sahih al-Bukhari 1',
          subtitle: 'A narration',
          savedAt: new Date().toISOString(),
        },
      ]),
    );

    const view = await withRepositories(<BookmarksScreen />);
    const row = await view.findByTestId('faith-bookmark-hadith-bukhari-1');

    fireEvent.press(row);
    // No hadith screen is addressable yet, so the row carries no handler and no chevron —
    // rather than a tap that silently does nothing.
    expect(mockRouter.push).not.toHaveBeenCalled();
  });
});

describe('reading progress is measured, not asserted', () => {
  it('is the fraction of the surah reached', () => {
    expect(readingProgress(1, 110)).toBeCloseTo(1 / 110);
    expect(readingProgress(55, 110)).toBeCloseTo(0.5);
    // Finishing the last verse is finishing the surah.
    expect(readingProgress(110, 110)).toBe(1);
  });

  it('clamps rather than exceeding one', () => {
    expect(readingProgress(300, 110)).toBe(1);
    expect(readingProgress(-4, 110)).toBe(0);
  });

  it('renders an empty bar rather than NaN when the length is unknown', () => {
    // A surah whose count did not arrive yields 0 — an honest statement about an unknown quantity.
    expect(readingProgress(32, 0)).toBe(0);
    expect(readingProgress(32, Number.NaN)).toBe(0);
  });

  it('writes the reached verse and the surah’s real length, not a literal', async () => {
    setRouteParams({ surah: '1' });
    const view = await withRepositories(<ReaderScreen />);

    fireEvent.press(await view.findByTestId('faith-reader-ayah-1-2'));
    fireEvent.press(await view.findByTestId('faith-reader-action-read'));
    await view.findByTestId('faith-reader-success');

    const stored = JSON.parse(
      (await AsyncStorage.getItem('noorlife.faith.quran.position')) as string,
    ) as Record<string, unknown>;

    expect(stored.surah).toBe(1);
    expect(stored.surahName).toBe('Al-Fatihah');
    expect(stored.ayah).toBe(2);
    expect(stored.ayahCount).toBe(7);
    // The defect: this was the literal 0.55 for every verse of every surah.
    expect(stored.progress).toBeCloseTo(2 / 7);
    expect(stored.progress).not.toBe(0.55);
  });
});

describe('continue reading starts empty', () => {
  it('shows no position before anything has been read', async () => {
    const view = await withRepositories(<QuranScreen />);
    await view.findByTestId('faith-quran-actions');

    /*
      The seed was `Al-Kahf` verse 32 at 55%, written on first read of storage — so a user who had
      never opened the reader was shown progress through a surah they had not read.
    */
    expect(view.queryByTestId('faith-quran-continue')).toBeNull();
  });

  it('shows the position and its fraction once something has been read', async () => {
    await AsyncStorage.setItem(
      'noorlife.faith.quran.position',
      JSON.stringify({
        surah: 18,
        surahName: 'Al-Kahf',
        ayah: 32,
        ayahCount: 110,
        progress: 32 / 110,
        updatedAt: new Date().toISOString(),
      }),
    );

    const view = await withRepositories(<QuranScreen />);

    expect(await view.findByText('Al-Kahf • verse 32')).toBeTruthy();
    // The bar's denominator, stated in words. A bar alone is not a measurement.
    expect(await view.findByText('32 of 110 verses')).toBeTruthy();
  });

  it('discards a position written before the surah name was stored', async () => {
    // The shape an older build wrote. Rendering it would produce "undefined • verse 32".
    await AsyncStorage.setItem(
      'noorlife.faith.quran.position',
      JSON.stringify({ surah: 18, ayah: 32, progress: 0.55, updatedAt: new Date().toISOString() }),
    );

    const view = await withRepositories(<QuranScreen />);
    await view.findByTestId('faith-quran-actions');

    expect(view.queryByTestId('faith-quran-continue')).toBeNull();
  });
});

/**
 * A missing translation is reported, and the two kinds of missing are told apart.
 *
 * The reader used to render the Arabic alone whenever the translation request did not return `ok`,
 * which reads as "this verse has no translation" — a statement about the *text* rather than about a
 * request that failed. The case that actually happens is a stored edition id the vendor no longer
 * offers: every surah would quietly lose its meaning with nothing to say why.
 */
describe('when the chosen translation cannot be shown', () => {
  const mocks = createMockFaithRepositories();

  it('says the edition is gone and offers to change it, for a 404', async () => {
    setRouteParams({ surah: '1' });
    const view = await withRepositories(<ReaderScreen />, {
      ...mocks,
      quran: {
        ...mocks.quran,
        listTranslations: async () => ({ kind: 'error', code: 'not-found' }),
      },
    });

    const banner = await view.findByTestId('faith-reader-translation-unavailable');
    expect(String(banner.props.accessibilityLabel)).toMatch(/no longer available/);
    // A retry cannot help here, so the action offered is the one that can.
    expect(String(banner.props.accessibilityLabel)).not.toMatch(/try again/i);

    // And the scripture is unaffected — losing it to report a missing translation would be worse.
    expect(await view.findByTestId('faith-reader-arabic-1-1')).toBeTruthy();
  });

  it('says it could not be loaded, for a transient failure', async () => {
    setRouteParams({ surah: '1' });
    const view = await withRepositories(<ReaderScreen />, {
      ...mocks,
      quran: {
        ...mocks.quran,
        listTranslations: async () => ({ kind: 'error', code: 'unavailable' }),
      },
    });

    const banner = await view.findByTestId('faith-reader-translation-unavailable');
    expect(String(banner.props.accessibilityLabel)).toMatch(/could not be loaded/);
    expect(await view.findByTestId('faith-reader-arabic-1-1')).toBeTruthy();
  });

  it('says nothing when the edition simply has no rendering for this surah', async () => {
    // `empty` is a fact about the edition, not a failure — and a warning here would be wrong.
    setRouteParams({ surah: '1' });
    const view = await withRepositories(<ReaderScreen />, {
      ...mocks,
      quran: { ...mocks.quran, listTranslations: async () => ({ kind: 'empty' }) },
    });

    await view.findByTestId('faith-reader-arabic-1-1');
    expect(view.queryByTestId('faith-reader-translation-unavailable')).toBeNull();
  });

  it('credits the translator when one did arrive', async () => {
    setRouteParams({ surah: '1' });
    const view = await withRepositories(<ReaderScreen />);

    const credit = await view.findByTestId('faith-reader-translation-credit');
    expect(String(credit.props.accessibilityLabel)).toMatch(/Translation shown/);
    expect(view.queryByTestId('faith-reader-translation-unavailable')).toBeNull();
  });
});

describe('content information', () => {
  it('credits the translation edition and its translator', async () => {
    const view = await withRepositories(<ContentInfoScreen />);
    const row = await view.findByTestId('faith-content-info-translation');

    // The attribution the removed banner never carried: whose reading of the meaning this is.
    expect(String(row.props.accessibilityLabel)).toMatch(/translated by/i);
  });

  it('acknowledges Quran Foundation, away from the reading surfaces', async () => {
    const view = await withRepositories(<ContentInfoScreen />);

    expect(await view.findByTestId('faith-content-info-quran-foundation')).toBeTruthy();
    expect(await view.findByText(/Quran Foundation Content API/)).toBeTruthy();
  });

  /**
   * ── "Sample data" stopped being true, and the copy had not caught up ────────
   * The Hadith, Dua and mosque fixtures were deleted; those repositories now answer
   * `not-configured`. So the screen's claim that they were "sample data while their sources are
   * being arranged" understated it — there is no content at all — and its claim that "search covers
   * narrations and duas" was outright false, because with no provider behind either, search covers
   * nothing.
   *
   * The assertions below pin the corrected statements *and* the absence of the old one, so a
   * regression that restores the friendlier wording fails here rather than shipping.
   */
  it('states what is licensed and what has no source at all', async () => {
    const view = await withRepositories(<ContentInfoScreen />);
    expect(await view.findByTestId('faith-content-info-scope')).toBeTruthy();
    expect(await view.findByText(/Search is not available/)).toBeTruthy();
    expect(await view.findByText(/no content source in this build/i)).toBeTruthy();
    // The false claim must be gone, not merely reworded around.
    expect(view.queryByText(/search covers narrations and duas/i)).toBeNull();
    expect(view.queryByText(/are sample data/i)).toBeNull();
  });
});
