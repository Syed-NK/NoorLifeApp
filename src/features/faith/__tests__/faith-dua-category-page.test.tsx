import AsyncStorage from '@react-native-async-storage/async-storage';
import { cleanup, fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';
import { useWindowDimensions } from 'react-native';

import { moduleLayout } from '@features/modules/module-tokens';

import { TEST_FAITH_USER_ID } from '@/test-support/faith-storage-address';
import { warmUpFirstMount } from '@/test-support/mock-latency-timers';

import { DUA_CATEGORIES } from '../data/duas/dua-categories';
import {
  categoryFilterAvailable,
  categoryFilterOptions,
  duaCategoryEmptyCopy,
  duaCategoryResults,
} from '../data/duas/dua-category-results';
import { createMockFaithRepositories } from '../data/mock';
import type { RetainedQuran, RetainedQuranSource } from '../data/offline/retained-quran.source';
import type { QuranSelection } from '../data/quran-selection/quran-selection';
import { FaithRepositoryProvider } from '../di/faith-repository-context';
import { duaCategoryHref, duaDetailHref } from '../faith-routes';
import { DuaCategoryScreen } from '../screens/dua-category-screen';
import {
  saveQuranSelection,
  toggleQuranSelectionFavourite,
} from '../storage/faith-quran-selections';
import { setActiveFaithScope } from '../storage/faith-user-scope';

/**
 * **Inside a category: the search, the filters, the five kinds of nothing, and the way out to a dua.**
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── The composition is the behaviour, so it is driven and not inspected ────
 * "Sunnah, matching 'travel', in Food & Drink" has one right answer, and the failure mode this suite
 * exists for is the page giving a *plausible* one: telling somebody their search found nothing when the
 * truth is that no reviewed content exists for the category at all. Those are different sentences and
 * the user acts differently on each. So the cases below assert which sentence appears, by its own
 * testID, rather than that *some* empty state did.
 *
 * ── The fixture's Arabic is not Qur’anic ───────────────────────────────────
 * Synthetic Arabic-script text with a Latin marker, the same rule the rest of this module follows.
 * Nothing asserted here needs the text to be scripture, and a fixture is exactly where unverified
 * religious content survives a deletion.
 *
 * ── Zero reviewed entries is the state under test, not a limitation of it ───
 * Every reviewed category is empty in this build, and that is what most of these cases are about: the
 * page has to be *complete* anyway. The reviewed ordering rules that cannot be exercised through a
 * render while the manifest is empty are asserted directly against synthetic fixtures in
 * `faith-reviewed-dua-contract.test.ts`, which is the only honest place for them.
 * ═══════════════════════════════════════════════════════════════════════════
 */

jest.mock('react-native/Libraries/Utilities/useWindowDimensions');

const mockedDimensions = useWindowDimensions as unknown as jest.Mock;

/** The three acceptance sizes from the brief, and nothing invented beside them. */
const MATRIX = [
  ['411 dp at font 1.0', 411, 1.0],
  ['393 dp at font 1.3', 393, 1.3],
  ['320 dp at font 1.5', 320, 1.5],
] as const;

const PROBE_ARABIC = 'ألف-probe-١';
const TRANSLATOR = 'A Named Translator';

function viewport(width: number, fontScale: number): void {
  mockedDimensions.mockReturnValue({ width, height: 852, scale: 3, fontScale });
}

function retainedDouble(): RetainedQuranSource {
  const content: RetainedQuran = {
    generationId: 'test-generation',
    arabic: {
      generationId: 'test-generation',
      script: 'text_uthmani',
      lastCheckedAt: 0,
      source: { name: 'Quran Foundation', edition: 'Uthmani', verified: true },
      bySurah: new Map([
        [
          2,
          [
            { ayah: 255, text: PROBE_ARABIC },
            { ayah: 286, text: PROBE_ARABIC },
          ],
        ],
        [112, [{ ayah: 1, text: PROBE_ARABIC }]],
      ]),
    },
    translations: {
      generationId: 'test-generation',
      resourceId: 85,
      source: {
        name: 'Quran Foundation',
        edition: 'A Named Edition',
        attribution: TRANSLATOR,
        verified: true,
      },
      bySurah: new Map([
        [
          2,
          [
            { ayah: 255, text: 'a rendering of the meaning' },
            { ayah: 286, text: 'a rendering of the meaning' },
          ],
        ],
        [112, [{ ayah: 1, text: 'a rendering of the meaning' }]],
      ]),
    },
  };
  return { read: async () => content };
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

/*
  Drained rather than awaited through `findBy*`. One `findBy*` in a file with no act environment leaves
  the next render in this file reading stale state — the trap `jest-overlapping-act` records — and every
  case here renders its own screen.
*/
async function drain(passes = 8): Promise<void> {
  for (let pass = 0; pass < passes; pass += 1) {
    await settle();
  }
}

async function renderCategory(
  categoryId: string,
  width = 411,
  fontScale = 1,
): Promise<typeof screen> {
  viewport(width, fontScale);
  render(
    <FaithRepositoryProvider
      repositories={{ ...createMockFaithRepositories(), retainedQuran: retainedDouble() }}
    >
      <DuaCategoryScreen categoryId={categoryId} />
    </FaithRepositoryProvider>,
  );
  await drain();
  return screen;
}

const selection = (
  surah: number,
  ayah: number,
  over: Partial<QuranSelection> = {},
): QuranSelection => ({
  id: `q.${surah}.${ayah}.${ayah}`,
  surah,
  startAyah: ayah,
  endAyah: ayah,
  label: null,
  favourite: false,
  createdAt: 1,
  lastUsedAt: null,
  ...over,
});

const category = (id: string) => {
  const found = DUA_CATEGORIES.find((entry) => entry.id === id);
  if (found === undefined) {
    throw new Error(`no such category: ${id}`);
  }
  return found;
};

warmUpFirstMount(async () => {
  viewport(411, 1);
  return renderCategory('travel');
});

beforeEach(async () => {
  await AsyncStorage.clear();
  setActiveFaithScope(TEST_FAITH_USER_ID);
  viewport(411, 1);
});

afterEach(async () => {
  await cleanup();
  mockedDimensions.mockReset();
});

describe('all ten categories are real routes, addressed by a stable id', () => {
  it.each(DUA_CATEGORIES.map((entry) => [entry.id, entry.label]))(
    'opens %s and names it',
    async (id, label) => {
      const view = await renderCategory(id as string);

      expect(view.getByTestId('faith-dua-category')).toBeTruthy();

      /*
        The standard Faith header, from `ModuleScaffold`: Back, the title, module Help and the profile
        affordance. Asserted here rather than assumed, because the page is reachable by link and the header
        is the only way back out of it.
      */
      for (const slot of [
        'header',
        'header-title',
        'header-back',
        'header-help',
        'header-profile',
      ]) {
        expect(view.getByTestId(`faith-dua-category-${slot}`)).toBeTruthy();
      }

      /* And the category's own summary beneath it: the icon, the label again, and a neutral description. */
      expect(view.getByTestId('faith-dua-category-about')).toBeTruthy();
      expect(view.getAllByText(label as string).length).toBeGreaterThan(0);
      expect(view.getByTestId('faith-dua-category-description')).toBeTruthy();
      expect(view.getByTestId('faith-dua-category-icon')).toBeTruthy();
    },
  );

  it('routes on the id and never on the display label', () => {
    /*
      A label is copy and changes; an id is persisted in a route and must not. `duaCategoryHref` takes the
      id, and no label appears anywhere in the produced address.
    */
    for (const entry of DUA_CATEGORIES) {
      const href = duaCategoryHref(entry.id);
      expect(href).toEqual({
        pathname: '/faith/duas/[category]',
        params: { category: entry.id },
      });
      expect(JSON.stringify(href)).not.toContain(entry.label);
    }
  });

  it('answers a category id that does not exist rather than silently redirecting', async () => {
    const view = await renderCategory('not-a-category');
    expect(view.getByTestId('faith-dua-category-unknown')).toBeTruthy();
  });
});

describe('the search field and the filter control are on every category', () => {
  it.each(DUA_CATEGORIES.map((entry) => [entry.id]))('%s carries both controls', async (id) => {
    const view = await renderCategory(id as string);
    expect(view.getByTestId('faith-dua-category-search')).toBeTruthy();
    expect(view.getByTestId('faith-dua-category-filter')).toBeTruthy();
  });

  it('names the search field in full and says what it searches', async () => {
    const view = await renderCategory('my-quran-selections');
    const field = view.getByTestId('faith-dua-category-search');

    expect(String(field.props.accessibilityLabel)).toBe('Find a remembrance');
    expect(String(field.props.accessibilityHint).length).toBeGreaterThan(0);
    /* The placeholder is whole at the reference size — it shortens only where it would clip. */
    expect(String(field.props.placeholder)).toBe('Find a remembrance');
  });

  it('offers a clear action only once there is something to clear', async () => {
    const view = await renderCategory('my-quran-selections');
    expect(view.queryByTestId('faith-dua-category-search-clear')).toBeNull();

    fireEvent.changeText(view.getByTestId('faith-dua-category-search'), '2:255');
    await drain();
    expect(view.getByTestId('faith-dua-category-search-clear')).toBeTruthy();
  });

  it('says which filter is active, in the control’s own name', async () => {
    const view = await renderCategory('my-quran-selections');
    expect(String(view.getByTestId('faith-dua-category-filter').props.accessibilityLabel)).toBe(
      'Filter. Currently All.',
    );
  });
});

describe('which filters a card offers, and which are absent rather than empty', () => {
  it('offers All, Qur’an and Sunnah on a reviewed card', () => {
    /*
      Sunnah is offered even though it is legitimately empty, which is the module's existing convention: a
      filter that appears only once content exists teaches a control out of nowhere and hides the fact that
      NoorLife distinguishes the two kinds at all.
    */
    expect(categoryFilterOptions(category('travel')).map((option) => option.id)).toEqual([
      'all',
      'quran',
      'sunnah',
    ]);
  });

  it('does not offer Favorites on a reviewed card, because the rows cannot have it', () => {
    /* A reviewed entry has no favourite state anywhere in this app — see `ReviewedItem`. */
    expect(categoryFilterAvailable(category('adhkar'), 'favourites')).toBe(false);
  });

  it('offers All and Favorites on My Quran Selections, and neither source filter', () => {
    /* Every selection is a Qur’an reference, so "Qur’an" would be a synonym for All and Sunnah a blank. */
    expect(
      categoryFilterOptions(category('my-quran-selections')).map((option) => option.id),
    ).toEqual(['all', 'favourites']);
  });

  it('offers only All inside Favorites, which is already the starred subset', () => {
    expect(categoryFilterOptions(category('favourites')).map((option) => option.id)).toEqual([
      'all',
    ]);
  });

  it('renders exactly the offered filters in the sheet, with the active one marked', async () => {
    const view = await renderCategory('travel');
    fireEvent.press(view.getByTestId('faith-dua-category-filter'));
    await drain();

    for (const id of ['all', 'quran', 'sunnah']) {
      expect(view.getByTestId(`faith-dua-category-filter-${id}`)).toBeTruthy();
    }
    expect(view.queryByTestId('faith-dua-category-filter-favourites')).toBeNull();

    /* Selection is carried in accessibility state, never by colour alone. */
    expect(
      view.getByTestId('faith-dua-category-filter-all').props.accessibilityState,
    ).toMatchObject({ selected: true });
    expect(
      view.getByTestId('faith-dua-category-filter-quran').props.accessibilityState,
    ).toMatchObject({ selected: false });
  });
});

describe('Popular is absent at zero reviewed entries, and nothing stands in for it', () => {
  it.each(DUA_CATEGORIES.map((entry) => [entry.id]))(
    '%s draws no popular section at all',
    async (id) => {
      const view = await renderCategory(id as string);

      /* No heading, no cards, no placeholder — the section does not exist rather than being empty. */
      expect(view.queryByTestId('faith-dua-category-popular')).toBeNull();
      expect(view.queryByText('Popular Duas')).toBeNull();
    },
  );

  it('never calls a personal selection popular, even with selections present', async () => {
    await saveQuranSelection({ surah: 2, startAyah: 255, endAyah: 255 }, null);
    const view = await renderCategory('my-quran-selections');

    expect(view.getByTestId('faith-dua-category-selection-q.2.255.255')).toBeTruthy();
    expect(view.queryByTestId('faith-dua-category-popular')).toBeNull();
    expect(JSON.stringify(view.toJSON())).not.toMatch(/popular/i);
  });

  it('says nothing about content arriving later, anywhere on the page', async () => {
    const view = await renderCategory('food-drink');
    const flat = JSON.stringify(view.toJSON());

    expect(flat).not.toMatch(/coming soon/i);
    expect(flat).not.toMatch(/duas is unavailable/i);
    /* And it does not claim the absence is permanent either. */
    expect(flat).not.toMatch(/never|not supported|unavailable forever/i);
  });
});

describe('the five kinds of nothing, each in its own words', () => {
  it('says reviewed content is not available yet, and the three things that must accompany it', async () => {
    const view = await renderCategory('travel');

    expect(view.getByTestId('faith-dua-category-empty')).toBeTruthy();
    expect(view.getByText('Reviewed content for this category is not available yet.')).toBeTruthy();
    expect(view.getByText(/does not publish supplications/i)).toBeTruthy();
    expect(view.getByText(/own Qur’an selections are unaffected/i)).toBeTruthy();
  });

  it('renders no Arabic on a reviewed category, because there is nothing approved to render', async () => {
    const view = await renderCategory('adhkar');
    expect(view.getByTestId('faith-dua-category-empty')).toBeTruthy();
    expect(JSON.stringify(view.toJSON())).not.toMatch(/[؀-ۿ]/);
  });

  it('says a personal category is empty in its own words, not the reviewed ones', async () => {
    const view = await renderCategory('favourites');

    expect(view.getByTestId('faith-dua-category-personal-empty')).toBeTruthy();
    expect(view.queryByTestId('faith-dua-category-empty')).toBeNull();
    expect(view.getByText(/nothing starred yet/i)).toBeTruthy();
  });

  it('distinguishes an empty search from an unreviewed category', async () => {
    /*
      ── The distinction this whole group exists for ───────────────────────────
      Both are "no rows". One is advice to try another word; the other is a statement about NoorLife's
      publishing policy that no word will change. A shared empty state would send the user hunting for
      content that does not exist.
    */
    await saveQuranSelection({ surah: 2, startAyah: 255, endAyah: 255 }, null);
    const view = await renderCategory('my-quran-selections');

    fireEvent.changeText(view.getByTestId('faith-dua-category-search'), 'zzzz-no-match');
    await drain();

    expect(view.getByTestId('faith-dua-category-search-empty')).toBeTruthy();
    expect(view.getByText(/nothing matched that/i)).toBeTruthy();
    expect(view.queryByTestId('faith-dua-category-empty')).toBeNull();
    expect(view.queryByTestId('faith-dua-category-personal-empty')).toBeNull();
  });

  it('reports the reason rather than a count, for every combination', () => {
    const surahNames = new Map<number, string>();
    const one = [selection(2, 255)];

    /* An unsearched reviewed card: the policy statement. */
    expect(
      duaCategoryResults({
        category: category('travel'),
        filter: 'all',
        query: '',
        selections: one,
        reviewed: [],
        surahNames,
      }).emptyReason,
    ).toBe('no-reviewed-content');

    /* A searched card, whatever kind: the search answer wins, because the user asked a question. */
    expect(
      duaCategoryResults({
        category: category('travel'),
        filter: 'all',
        query: 'travel',
        selections: one,
        reviewed: [],
        surahNames,
      }).emptyReason,
    ).toBe('no-search-match');

    expect(
      duaCategoryResults({
        category: category('my-quran-selections'),
        filter: 'all',
        query: '',
        selections: [],
        reviewed: [],
        surahNames,
      }).emptyReason,
    ).toBe('no-personal-selections');

    expect(
      duaCategoryResults({
        category: category('favourites'),
        filter: 'all',
        query: '',
        selections: one,
        reviewed: [],
        surahNames,
      }).emptyReason,
    ).toBe('no-favourites');

    expect(
      duaCategoryResults({
        category: category('my-quran-selections'),
        filter: 'all',
        query: '',
        selections: one,
        reviewed: [],
        surahNames,
      }).emptyReason,
    ).toBe('not-empty');
  });

  it('never describes a working feature as unavailable', () => {
    for (const reason of [
      'no-search-match',
      'no-reviewed-content',
      'no-personal-selections',
      'no-favourites',
    ] as const) {
      const copy = duaCategoryEmptyCopy(reason, category('travel'));
      const text = `${copy.title} ${copy.body} ${copy.note ?? ''}`;
      expect(text).not.toMatch(/unavailable|coming soon|not supported|error/i);
      expect(copy.title.length).toBeGreaterThan(0);
      expect(copy.body.length).toBeGreaterThan(0);
    }
  });
});

describe('search and filters compose deterministically', () => {
  const surahNames = new Map([[2, 'Al-Baqarah']]);
  const two = [selection(2, 255, { favourite: true }), selection(112, 1)];

  it('finds a personal selection by its reference', () => {
    const rows = duaCategoryResults({
      category: category('my-quran-selections'),
      filter: 'all',
      query: '2:255',
      selections: two,
      reviewed: [],
      surahNames,
    }).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.kind === 'personal' && rows[0].selection.id).toBe('q.2.255.255');
  });

  it('finds one by surah name, and by a note the user wrote', () => {
    const labelled = [selection(2, 255, { label: 'for the morning' })];
    const byName = duaCategoryResults({
      category: category('my-quran-selections'),
      filter: 'all',
      query: 'baqarah',
      selections: labelled,
      reviewed: [],
      surahNames,
    });
    const byNote = duaCategoryResults({
      category: category('my-quran-selections'),
      filter: 'all',
      query: 'morning',
      selections: labelled,
      reviewed: [],
      surahNames,
    });
    expect(byName.rows).toHaveLength(1);
    expect(byNote.rows).toHaveLength(1);
  });

  it('composes the filter with the query rather than letting one win', () => {
    /* Favorites narrows to the starred one; the query then narrows within it, and misses the other. */
    const hit = duaCategoryResults({
      category: category('my-quran-selections'),
      filter: 'favourites',
      query: '2:255',
      selections: two,
      reviewed: [],
      surahNames,
    });
    const miss = duaCategoryResults({
      category: category('my-quran-selections'),
      filter: 'favourites',
      query: '112:1',
      selections: two,
      reviewed: [],
      surahNames,
    });
    expect(hit.rows).toHaveLength(1);
    expect(miss.rows).toHaveLength(0);
    expect(miss.emptyReason).toBe('no-search-match');
  });

  it('gives the same answer for the same inputs, every time', () => {
    const input = {
      category: category('my-quran-selections'),
      filter: 'all' as const,
      query: '',
      selections: two,
      reviewed: [],
      surahNames,
    };
    const first = duaCategoryResults(input);
    const second = duaCategoryResults(input);
    expect(
      second.rows.map((row) => (row.kind === 'personal' ? row.selection.id : row.dua.id)),
    ).toEqual(first.rows.map((row) => (row.kind === 'personal' ? row.selection.id : row.dua.id)));
  });

  it('returns nothing for Sunnah, honestly, rather than borrowing from elsewhere', () => {
    const results = duaCategoryResults({
      category: category('travel'),
      filter: 'sunnah',
      query: '',
      selections: two,
      reviewed: [],
      surahNames,
    });
    expect(results.rows).toEqual([]);
    expect(results.emptyReason).toBe('no-reviewed-content');
  });

  it('files a selection into no religious category, whatever is stored', () => {
    for (const entry of DUA_CATEGORIES) {
      const rows = duaCategoryResults({
        category: entry,
        filter: 'all',
        query: '',
        selections: two,
        reviewed: [],
        surahNames,
      }).rows;
      const expected = entry.id === 'my-quran-selections' ? 2 : entry.id === 'favourites' ? 1 : 0;
      expect(rows).toHaveLength(expected);
    }
  });

  it('shows Favorites through the real account-scoped state, in a render', async () => {
    await saveQuranSelection({ surah: 2, startAyah: 255, endAyah: 255 }, null);
    await saveQuranSelection({ surah: 112, startAyah: 1, endAyah: 1 }, null);
    await toggleQuranSelectionFavourite('q.2.255.255');

    const view = await renderCategory('favourites');
    expect(view.getByTestId('faith-dua-category-selection-q.2.255.255')).toBeTruthy();
    expect(view.queryByTestId('faith-dua-category-selection-q.112.1.1')).toBeNull();
  });
});

describe('a row opens the dua', () => {
  it('offers a labelled target that names what it opens', async () => {
    await saveQuranSelection({ surah: 2, startAyah: 255, endAyah: 255 }, null);
    const view = await renderCategory('my-quran-selections');

    const target = view.getByTestId('faith-dua-category-selection-open-q.2.255.255');
    expect(String(target.props.accessibilityLabel)).toContain('2:255');
    expect(target.props.accessibilityRole).toBe('button');
  });

  it('keeps the row’s own four actions beside it, so neither replaces the other', async () => {
    await saveQuranSelection({ surah: 2, startAyah: 255, endAyah: 255 }, null);
    const view = await renderCategory('my-quran-selections');

    for (const action of ['read', 'use', 'favourite', 'remove']) {
      expect(view.getByTestId(`faith-dua-category-selection-${action}-q.2.255.255`)).toBeTruthy();
    }
    expect(JSON.stringify(view.toJSON())).not.toMatch(/share|export|save to files/i);
  });

  it('addresses the detail route by the selection’s own stable id', () => {
    expect(duaDetailHref('q.2.255.255')).toEqual({
      pathname: '/faith/duas/item/[duaId]',
      params: { duaId: 'q.2.255.255' },
    });
  });
});

describe('the responsive matrix', () => {
  it.each(MATRIX)('%s renders the whole page with no control lost', async (_name, width, scale) => {
    await saveQuranSelection({ surah: 2, startAyah: 255, endAyah: 255 }, null);
    const view = await renderCategory('my-quran-selections', width, scale);

    for (const testID of [
      'faith-dua-category-about',
      'faith-dua-category-description',
      'faith-dua-category-search',
      'faith-dua-category-filter',
      'faith-dua-category-results-heading',
      'faith-dua-category-selection-q.2.255.255',
      'faith-dua-category-add-selection',
      'faith-dua-category-back',
      'faith-dua-category-attribution',
    ]) {
      expect(view.getByTestId(testID)).toBeTruthy();
    }
  });

  it.each(MATRIX)('%s keeps the reviewed explanation whole', async (_name, width, scale) => {
    const view = await renderCategory('travel', width, scale);

    expect(view.getByTestId('faith-dua-category-empty')).toBeTruthy();
    expect(view.getByTestId('faith-dua-category-empty-note')).toBeTruthy();
    expect(view.getByTestId('faith-dua-category-open-selections')).toBeTruthy();
  });

  it.each(MATRIX)(
    '%s shortens no accessible name and clips no placeholder',
    async (_name, width, scale) => {
      const view = await renderCategory('travel', width, scale);
      const field = view.getByTestId('faith-dua-category-search');

      /*
      The visible placeholder may shorten to "Search" where the full phrase would clip; the spoken name
      never does. Both branches are legitimate and neither is an ellipsis or a fragment.
    */
      expect(String(field.props.accessibilityLabel)).toBe('Find a remembrance');
      expect(['Find a remembrance', 'Search']).toContain(String(field.props.placeholder));
    },
  );

  it.each(MATRIX)('%s gives every control its minimum height', async (_name, width, scale) => {
    const view = await renderCategory('travel', width, scale);

    for (const testID of ['faith-dua-category-filter', 'faith-dua-category-back']) {
      const style = [view.getByTestId(testID).props.style].flat(4).filter(Boolean);
      const merged = Object.assign({}, ...(style as Record<string, unknown>[]));
      const height = Number(merged.minHeight ?? merged.height ?? 0);
      if (height > 0) {
        /* Scaled by the layout scale, which is what `dp()` applies — never below the 44 dp floor. */
        expect(height).toBeGreaterThanOrEqual(
          Math.round(moduleLayout.minTouchTarget * Math.min(1, width / 411)),
        );
      }
    }
  });

  it('wraps the longest label rather than breaking it, at every size', async () => {
    /*
      "Daily Remembrances" split to "Daily Remembr / ances" on device at 393 dp with a 1.3 scale, on the
      grid. The header here has the same word in a wider box; what this pins is that it is allowed two
      lines to wrap into, which is what stops React Native breaking it mid-word.
    */
    for (const [, width, scale] of MATRIX) {
      const view = await renderCategory('daily-remembrances', width, scale);
      /*
        The summary card's own title, not the header's. The module header is a single-line band by design
        and truncates; this is the one that has to wrap, because it is the one with room to.
      */
      const heading = view.getByTestId('faith-dua-category-about-title');
      expect(Number(heading.props.numberOfLines)).toBeGreaterThanOrEqual(2);
      await cleanup();
    }
  });
});

describe('accessibility of the page’s own controls', () => {
  it('gives every interactive control a specific name', async () => {
    await saveQuranSelection({ surah: 2, startAyah: 255, endAyah: 255 }, null);
    const view = await renderCategory('my-quran-selections');

    const named: readonly [string, RegExp][] = [
      ['faith-dua-category-filter', /^Filter\./],
      ['faith-dua-category-back', /Back to all categories/],
      ['faith-dua-category-add-selection', /Choose a verse/],
      ['faith-dua-category-selection-favourite-q.2.255.255', /favourites/i],
      ['faith-dua-category-selection-read-q.2.255.255', /reader/i],
      ['faith-dua-category-selection-use-q.2.255.255', /Tasbih/],
    ];

    for (const [testID, pattern] of named) {
      const label = String(view.getByTestId(testID).props.accessibilityLabel);
      /* Specific, not "button" — and never a bare id or an undefined leaking into a spoken name. */
      expect(label).toMatch(pattern);
      expect(label).not.toMatch(/undefined|null|NaN/);
    }
  });

  it('marks the results heading and the empty state as headings', async () => {
    const view = await renderCategory('travel');
    expect(view.getByTestId('faith-dua-category-results-heading').props.accessibilityRole).toBe(
      'header',
    );
  });

  it('announces the category icon to nobody, because the heading already names it', async () => {
    const view = await renderCategory('travel');
    const icon = view.getByTestId('faith-dua-category-icon');
    /* Decorative. `FaithPictogram` marks it inaccessible so it is not read out beside the label. */
    expect(icon.props.accessible === false || icon.props.accessibilityElementsHidden === true).toBe(
      true,
    );
  });
});
