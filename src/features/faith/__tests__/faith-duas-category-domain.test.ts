import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { reviewedQuranDuas } from '../data/dhikr/reviewed-dua-manifest';
import {
  categoryCountLabel,
  duaCategoryById,
  DUA_CATEGORIES,
  type DuaCategory,
} from '../data/duas/dua-categories';
import {
  reviewedForCategory,
  searchDuaLibrary,
  selectionsForCategory,
  DUA_LIBRARY_FILTERS,
  type DuaLibraryFilter,
} from '../data/duas/dua-library';
import {
  duaCategoryAssetGaps,
  duaCategoryIcon,
  duaCategoryIcons,
  duaCategoryIconSlot,
} from '../faith-dua-category-assets';
import type { QuranSelection } from '../data/quran-selection/quran-selection';

/**
 * **The Duas category library, asserted where its rules live rather than through a render.**
 *
 * ── The three claims worth proving here ────────────────────────────────────
 * That the grid is the approved grid — ten cards, that order, those labels. That nothing unapproved
 * can reach a category or a search result, whatever the manifest happens to hold. And that a user's
 * own selection is never filed into a religious category by the code.
 *
 * The last one is the one that needs a test rather than a comment: placing somebody's saved verse
 * under "Travel" would be an editorial religious act, it would look like a helpful feature, and
 * nothing about the rendered screen would announce it.
 */

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

/** A complete, approved, gate-passing entry — built here so no fixture file ships one. */
const approvedEntry = {
  id: 'test.reviewed',
  surah: 2,
  startAyah: 255,
  endAyah: 255,
  title: 'A reviewer-supplied title',
  category: 'morning-evening' as const,
  recommendedTarget: null,
  reviewStatus: 'approved' as const,
  review: { reviewer: 'A named reviewer', source: 'A citable basis', reviewedOn: '2026-08-19' },
  contextNote: 'Why this reference is offered.',
  enabled: true,
  version: 1,
};

describe('the locked grid', () => {
  it('is exactly ten cards in the approved order', () => {
    /*
      Stated in full rather than derived. The order is part of the locked design, and a test that
      recomputed it from the array would pass whatever the array said.
    */
    expect(DUA_CATEGORIES.map((category) => category.id)).toEqual([
      'daily-remembrances',
      'morning-evening',
      'food-drink',
      'travel',
      'home-family',
      'joy-distress',
      'essential-duas',
      'adhkar',
      'my-quran-selections',
      'favourites',
    ]);
  });

  it('carries the approved labels, spelled as the design draws them', () => {
    expect(DUA_CATEGORIES.map((category) => category.label)).toEqual([
      'Daily Remembrances',
      'Morning & Evening',
      'Food & Drink',
      'Travel',
      'Home & Family',
      'Joy & Distress',
      'Essential Duas',
      'Adhkar',
      'My Quran Selections',
      'Favorites',
    ]);
  });

  it('gives every card a spoken description, so none is announced by label alone', () => {
    for (const category of DUA_CATEGORIES) {
      expect(category.description.trim().length).toBeGreaterThan(0);
    }
  });

  it('marks exactly the two user-owned cards as personal', () => {
    const personal = DUA_CATEGORIES.filter((category) => category.kind === 'personal');
    expect(personal.map((category) => category.id)).toEqual(['my-quran-selections', 'favourites']);
  });

  it('resolves a card by id and refuses anything that is not one', () => {
    expect(duaCategoryById('travel')?.label).toBe('Travel');
    expect(duaCategoryById('not-a-category')).toBeUndefined();
    expect(duaCategoryById('')).toBeUndefined();
  });
});

describe('what a card is allowed to claim', () => {
  it('shows a dash for a reviewed category rather than a zero', () => {
    const reviewed = DUA_CATEGORIES.find((c) => c.id === 'travel') as DuaCategory;
    /*
      "0" is a measurement and reads as one — NoorLife looked and found none. The truth is weaker:
      nobody has reviewed anything, so nothing has been counted at all.
    */
    expect(categoryCountLabel(reviewed, 0, 0)).toBe('–');
    expect(categoryCountLabel(reviewed, 0, 0)).not.toBe('0');
  });

  it('shows a real number once a reviewed category has approved entries', () => {
    const reviewed = DUA_CATEGORIES.find((c) => c.id === 'morning-evening') as DuaCategory;
    expect(categoryCountLabel(reviewed, 0, 3)).toBe('3');
  });

  it('counts a personal card honestly, including when it is genuinely zero', () => {
    const personal = DUA_CATEGORIES.find((c) => c.id === 'favourites') as DuaCategory;
    // The user's own selections can actually be counted, so zero of them is a real zero.
    expect(categoryCountLabel(personal, 0, 0)).toBe('0');
    expect(categoryCountLabel(personal, 4, 0)).toBe('4');
  });

  it('leaves four cards with no reviewed bucket, rather than inventing a plausible one', () => {
    /*
      Food & Drink, Travel, Home & Family and Joy & Distress have no counterpart in the reviewed
      taxonomy. Filing a travel dua under `protection` to make the card look populated would be an
      editorial religious decision taken by a developer, invisibly — so the mapping stays empty and
      the card says so.
    */
    const unmapped = DUA_CATEGORIES.filter(
      (category) => category.kind === 'reviewed' && category.reviewedCategories.length === 0,
    );
    expect(unmapped.map((category) => category.id)).toEqual([
      'food-drink',
      'travel',
      'home-family',
      'joy-distress',
    ]);
  });

  it('never maps a personal card to a reviewed bucket', () => {
    for (const category of DUA_CATEGORIES.filter((c) => c.kind === 'personal')) {
      expect(category.reviewedCategories).toEqual([]);
    }
  });
});

describe('a user’s selection is never filed into a religious category', () => {
  const saved = [selection(2, 255), selection(112, 1, { favourite: true })];

  it.each([
    'daily-remembrances',
    'morning-evening',
    'food-drink',
    'travel',
    'home-family',
    'joy-distress',
    'essential-duas',
    'adhkar',
  ])('returns nothing for %s, whatever the user has saved', (categoryId) => {
    expect(selectionsForCategory(categoryId, saved)).toEqual([]);
  });

  it('returns everything under My Quran Selections', () => {
    expect(selectionsForCategory('my-quran-selections', saved)).toHaveLength(2);
  });

  it('returns only the starred ones under Favorites', () => {
    const favourites = selectionsForCategory('favourites', saved);
    expect(favourites).toHaveLength(1);
    expect(favourites[0]?.id).toBe('q.112.1.1');
  });
});

describe('reviewed content reaches a category only through the gate', () => {
  it('ships zero approved entries, so every reviewed card is empty today', () => {
    expect(reviewedQuranDuas()).toHaveLength(0);
    for (const category of DUA_CATEGORIES.filter((c) => c.kind === 'reviewed')) {
      expect(reviewedForCategory(category.reviewedCategories, reviewedQuranDuas())).toEqual([]);
    }
  });

  it('narrows approved entries to the buckets the card names', () => {
    const entries = [
      approvedEntry,
      { ...approvedEntry, id: 'test.other', category: 'praise' as const },
    ];
    expect(reviewedForCategory(['morning-evening'], entries).map((e) => e.id)).toEqual([
      'test.reviewed',
    ]);
    expect(reviewedForCategory(['praise'], entries).map((e) => e.id)).toEqual(['test.other']);
  });

  it('returns nothing for a card that names no bucket, whatever is approved', () => {
    expect(reviewedForCategory([], [approvedEntry])).toEqual([]);
  });
});

describe('search', () => {
  const surahNames = new Map([
    [2, 'Al-Baqarah'],
    [112, 'Al-Ikhlas'],
  ]);
  const selections = [
    selection(2, 255, { label: 'For the evening' }),
    selection(112, 1, { favourite: true }),
  ];
  const base = { selections, reviewed: [], surahNames, filter: 'all' as DuaLibraryFilter };

  it('works on personal selections with zero reviewed entries', () => {
    expect(searchDuaLibrary({ ...base, query: '' })).toHaveLength(2);
  });

  it.each([
    ['a user label', 'evening', 'q.2.255.255'],
    ['a surah name', 'ikhlas', 'q.112.1.1'],
    ['a reference', '2:255', 'q.2.255.255'],
  ])('matches on %s', (_name, query, expectedId) => {
    const hits = searchDuaLibrary({ ...base, query });
    expect(hits).toHaveLength(1);
    expect(hits[0]?.kind).toBe('personal');
    expect(hits[0]?.kind === 'personal' && hits[0].selection.id).toBe(expectedId);
  });

  it('distinguishes a personal selection from a reviewed entry in its results', () => {
    const hits = searchDuaLibrary({ ...base, reviewed: [approvedEntry], query: '2:255' });
    expect(hits.map((hit) => hit.kind).sort()).toEqual(['personal', 'reviewed']);
  });

  it('matches a reviewed entry on its reviewer-supplied title', () => {
    const hits = searchDuaLibrary({
      ...base,
      selections: [],
      reviewed: [approvedEntry],
      query: 'reviewer-supplied',
    });
    expect(hits).toHaveLength(1);
    expect(hits[0]?.kind).toBe('reviewed');
  });

  it('returns nothing for a query that matches nothing', () => {
    expect(searchDuaLibrary({ ...base, query: 'zzzz' })).toEqual([]);
  });

  it('cannot surface an entry the caller did not put through the gate', () => {
    /*
      The function has no access to the raw manifest — `reviewed` is what the gate already approved —
      so an unapproved entry has no route in. Asserted by handing it an empty approved set beside a
      populated store: the only hits are the user's own.
    */
    const hits = searchDuaLibrary({ ...base, reviewed: [], query: '' });
    expect(hits.every((hit) => hit.kind === 'personal')).toBe(true);
  });
});

describe('filters', () => {
  const surahNames = new Map([[2, 'Al-Baqarah']]);
  const selections = [selection(2, 255), selection(112, 1, { favourite: true })];
  const base = { selections, reviewed: [approvedEntry], surahNames, query: '' };

  it('offers exactly the four honest filters', () => {
    expect(DUA_LIBRARY_FILTERS.map((f) => f.id)).toEqual([
      'all',
      'selections',
      'favourites',
      'reviewed',
    ]);
  });

  it('All returns both kinds', () => {
    expect(searchDuaLibrary({ ...base, filter: 'all' })).toHaveLength(3);
  });

  it('My Quran Selections returns only the user’s own', () => {
    const hits = searchDuaLibrary({ ...base, filter: 'selections' });
    expect(hits).toHaveLength(2);
    expect(hits.every((hit) => hit.kind === 'personal')).toBe(true);
  });

  it('Favorites returns only starred personal selections, never a reviewed entry', () => {
    const hits = searchDuaLibrary({ ...base, filter: 'favourites' });
    expect(hits).toHaveLength(1);
    expect(hits[0]?.kind).toBe('personal');
  });

  it('Reviewed returns only reviewed entries, and is empty in this build', () => {
    expect(
      searchDuaLibrary({ ...base, filter: 'reviewed' }).every((h) => h.kind === 'reviewed'),
    ).toBe(true);
    expect(
      searchDuaLibrary({ ...base, reviewed: reviewedQuranDuas(), filter: 'reviewed' }),
    ).toEqual([]);
  });
});

describe('the icon registry', () => {
  it('covers every card and the Continue slot', () => {
    const ids = duaCategoryIcons.map((entry) => entry.id);
    for (const category of DUA_CATEGORIES) {
      expect(ids).toContain(category.id);
    }
    expect(ids).toContain('continue');
    expect(ids).toHaveLength(DUA_CATEGORIES.length + 1);
  });

  it('reuses one bundled image for Essential Duas and Continue rather than two copies', () => {
    const essential = duaCategoryIcon('essential-duas');
    const continues = duaCategoryIcon('continue');
    expect(essential.file).toBe(continues.file);
    if (essential.asset.status !== 'installed' || continues.asset.status !== 'installed') {
      throw new Error('both slots are expected to be installed');
    }
    // The same literal path, so Metro bundles it once and both hand over one source object.
    expect(essential.asset.source).toBe(continues.asset.source);
  });

  it('has every one of the eleven slots installed', () => {
    /*
      The seven commissioned icons landed, so no slot renders scaffolding any more. Asserted as a
      count rather than a list of ids: what matters is that none is missing, and naming them here
      would be a second copy of the registry.
    */
    const installed = duaCategoryIcons.filter((entry) => entry.asset.status === 'installed');
    expect(installed).toHaveLength(duaCategoryIcons.length);
    expect(duaCategoryAssetGaps()).toEqual([]);
  });

  it('points the seven commissioned subjects at the delivered files', () => {
    const byId = new Map(duaCategoryIcons.map((entry) => [entry.id, entry.file]));
    expect(byId.get('daily-remembrances')).toBe('duas/dc1-daily-remembrances.png');
    expect(byId.get('morning-evening')).toBe('duas/dc2-morning-evening.png');
    expect(byId.get('food-drink')).toBe('duas/dc3-food-drink.png');
    expect(byId.get('travel')).toBe('duas/dc4-travel.png');
    expect(byId.get('home-family')).toBe('duas/dc5-home-family.png');
    expect(byId.get('joy-distress')).toBe('duas/dc6-joy-distress.png');
    expect(byId.get('favourites')).toBe('duas/dc7-favourites.png');
  });

  it('keeps the four reused Faith assets pointed at their original files', () => {
    const byId = new Map(duaCategoryIcons.map((entry) => [entry.id, entry.file]));
    expect(byId.get('essential-duas')).toBe('submenu/01-quran.png');
    expect(byId.get('continue')).toBe('submenu/01-quran.png');
    expect(byId.get('adhkar')).toBe('submenu/06-tasbih.png');
    expect(byId.get('my-quran-selections')).toBe('pictograms/h2-bookmarked-book.png');
  });

  it('has the delivered artwork on disk, at the size it was approved at', () => {
    /*
      The registry naming a file proves nothing about the file existing. Read the PNG header directly:
      1254×1254 with an alpha channel is what was delivered and what `contain` rendering assumes.
    */
    for (const name of [
      'dc1-daily-remembrances.png',
      'dc2-morning-evening.png',
      'dc3-food-drink.png',
      'dc4-travel.png',
      'dc5-home-family.png',
      'dc6-joy-distress.png',
      'dc7-favourites.png',
    ]) {
      const file = join(
        __dirname,
        '..',
        '..',
        '..',
        '..',
        'assets',
        'images',
        'modules',
        'faith',
        'duas',
        name,
      );
      const header = readFileSync(file).subarray(0, 26);
      expect(header.subarray(1, 4).toString('latin1')).toBe('PNG');
      expect(header.readUInt32BE(16)).toBe(1254);
      expect(header.readUInt32BE(20)).toBe(1254);
      // Colour type 6 is RGBA — an icon without alpha would sit on a white square.
      expect(header[25]).toBe(6);
    }
  });

  it('renders every slot as bundled artwork — never an emoji or a glyph', () => {
    for (const entry of duaCategoryIcons) {
      expect(duaCategoryIconSlot(entry.id).kind).toBe('png');
    }
    const source = readFileSync(join(__dirname, '..', 'faith-dua-category-assets.ts'), 'utf8');
    /*
      An emoji would render differently on every OS and font, and a remote source would make the grid
      depend on a network it must not touch. Both are scanned for rather than trusted.
    */
    expect(source).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
    expect(source).not.toMatch(/https?:\/\//);
    expect(source).not.toMatch(/\buri\s*:/);
  });
});
