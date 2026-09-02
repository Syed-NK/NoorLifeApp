import AsyncStorage from '@react-native-async-storage/async-storage';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';

import { TEST_FAITH_USER_ID } from '@/test-support/faith-storage-address';
import { warmUpFirstMount } from '@/test-support/mock-latency-timers';

import { REVIEWED_DUA_MANIFEST } from '../data/dhikr/reviewed-dua-manifest';
import { DUA_CATEGORIES } from '../data/duas/dua-categories';
import type { RetainedQuran, RetainedQuranSource } from '../data/offline/retained-quran.source';
import { createMockFaithRepositories } from '../data/mock';
import { createLocalTasbihRepository } from '../data/tasbih/local-tasbih.repository';
import { FaithRepositoryProvider } from '../di/faith-repository-context';
import { DuaCategoryScreen } from '../screens/dua-category-screen';
import { DuasScreen } from '../screens/duas-screen';
import {
  markQuranSelectionUsed,
  readQuranSelections,
  saveQuranSelection,
  toggleQuranSelectionFavourite,
} from '../storage/faith-quran-selections';
import { setActiveFaithScope } from '../storage/faith-user-scope';

/**
 * **The Duas category library: the locked grid, and the rules underneath it.**
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── What changed, and what deliberately did not ────────────────────────────
 * The screen went from four stacked lists to a two-column grid of ten categories. Nothing about
 * what may be *shown* moved: the review gate, the reference-only store, the account boundary and
 * the Quran Foundation attribution are all where they were, and the cases below assert the new
 * navigation without relaxing any of them.
 *
 * ── The fixture's Arabic is not Qur'anic ───────────────────────────────────
 * Synthetic Arabic-script text with a Latin marker, the same rule the rest of this module follows.
 * Nothing asserted here needs the text to be scripture, and a fixture is exactly where unverified
 * religious content survives a deletion.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const PROBE_ARABIC = 'ألف-probe-١';
const TRANSLATOR = 'A Named Translator';

function retainedDouble(): RetainedQuranSource {
  const content: RetainedQuran = {
    generationId: 'test-generation',
    arabic: {
      generationId: 'test-generation',
      script: 'text_uthmani',
      lastCheckedAt: 0,
      source: { name: 'Quran Foundation', edition: 'Uthmani', verified: true },
      bySurah: new Map([[2, [{ ayah: 255, text: PROBE_ARABIC }]]]),
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
      bySurah: new Map([[2, [{ ayah: 255, text: 'a rendering of the meaning' }]]]),
    },
  };
  return { read: async () => content };
}

function wrap(node: React.ReactElement) {
  return (
    <FaithRepositoryProvider
      repositories={{ ...createMockFaithRepositories(), retainedQuran: retainedDouble() }}
    >
      {node}
    </FaithRepositoryProvider>
  );
}

async function renderGrid(): Promise<typeof screen> {
  await render(wrap(<DuasScreen />));
  return screen;
}

async function renderCategory(id: string): Promise<typeof screen> {
  await render(wrap(<DuaCategoryScreen categoryId={id} />));
  return screen;
}

warmUpFirstMount(() => renderGrid());

beforeEach(async () => {
  await AsyncStorage.clear();
  setActiveFaithScope(TEST_FAITH_USER_ID);
});

afterEach(async () => {
  await cleanup();
});

describe('the locked grid', () => {
  it('draws all ten cards', async () => {
    const view = await renderGrid();
    await view.findByTestId('faith-duas-grid');

    for (const category of DUA_CATEGORIES) {
      expect(view.getByTestId(`faith-duas-category-${category.id}`)).toBeTruthy();
    }
  });

  it('draws them in the approved order, top to bottom', async () => {
    const view = await renderGrid();
    await view.findByTestId('faith-duas-grid');

    /*
      Read off the rendered tree rather than the source array, so a screen that reordered or filtered
      the cards on its way to the view would fail here even though the domain test still passed.
      `getAllByTestId` returns matches in tree order, which is the order they are drawn in.
    */
    const rendered = view
      .getAllByTestId(/^faith-duas-category-[a-z-]+$/)
      .map((node) => String(node.props.testID).replace('faith-duas-category-', ''))
      /* The card's own testID, not its count or icon child, which share the prefix. */
      .filter((id) => !id.endsWith('-count') && !id.endsWith('-icon'));

    expect(rendered).toEqual(DUA_CATEGORIES.map((category) => category.id));
  });

  it('labels every card for a screen reader with what it is and what it holds', async () => {
    const view = await renderGrid();
    await view.findByTestId('faith-duas-grid');

    for (const category of DUA_CATEGORIES) {
      const label = String(
        view.getByTestId(`faith-duas-category-${category.id}`).props.accessibilityLabel,
      );
      expect(label).toContain(category.label);
      expect(label).toContain(category.description);
    }
  });

  it('shows a dash on a reviewed card and a real number on a personal one', async () => {
    await saveQuranSelection({ surah: 2, startAyah: 255, endAyah: 255 }, null);
    const view = await renderGrid();
    await view.findByTestId('faith-duas-grid');

    await waitFor(() => {
      expect(
        String(view.getByTestId('faith-duas-category-my-quran-selections-count').props.children),
      ).toBe('1');
    });
    expect(String(view.getByTestId('faith-duas-category-travel-count').props.children)).toBe('–');
  });

  it('highlights no card while nothing is pressed', async () => {
    const view = await renderGrid();
    await view.findByTestId('faith-duas-grid');

    /*
      The approved mock draws Morning & Evening on mint to record what the pressed state looks like.
      A permanent highlight would tell the user something is selected when nothing is.
    */
    const flat = JSON.stringify(view.toJSON());
    const mintOccurrences = flat.split('#E9F6F1').length - 1;
    expect(mintOccurrences).toBe(0);
  });

  it('does not draw a hero, because the locked design has none', async () => {
    const view = await renderGrid();
    await view.findByTestId('faith-duas-grid');
    expect(view.queryByTestId('faith-hero-duas')).toBeNull();
  });

  it('keeps the Quran Foundation attribution reachable', async () => {
    const view = await renderGrid();
    const attribution = await view.findByTestId('faith-duas-attribution');
    expect(String(attribution.props.accessibilityLabel)).toMatch(/where this content comes from/i);
  });
});

describe('the Continue card', () => {
  it('is absent when nothing has been used', async () => {
    await saveQuranSelection({ surah: 2, startAyah: 255, endAyah: 255 }, null);
    const view = await renderGrid();
    await view.findByTestId('faith-duas-grid');

    /*
      Saved is not used. `recentSelections` only returns what was sent to Tasbih or opened, so a card
      promising to resume something the user never started cannot appear.
    */
    expect(view.queryByTestId('faith-duas-continue')).toBeNull();
  });

  it('appears once a selection has actually been used, and names it', async () => {
    await saveQuranSelection({ surah: 2, startAyah: 255, endAyah: 255 }, null);
    await markQuranSelectionUsed('q.2.255.255');
    const view = await renderGrid();

    const card = await view.findByTestId('faith-duas-continue');
    const label = String(card.props.accessibilityLabel);
    expect(label).toContain('Continue');
    expect(label).toContain('Your Quran selection');
    expect(label).toContain('2:255');
  });

  it('prefers the user’s own label over the neutral title', async () => {
    await saveQuranSelection({ surah: 2, startAyah: 255, endAyah: 255 }, 'For the evening');
    await markQuranSelectionUsed('q.2.255.255');
    const view = await renderGrid();

    const card = await view.findByTestId('faith-duas-continue');
    expect(String(card.props.accessibilityLabel)).toContain('For the evening');
  });

  it('says where it goes, and goes to the reader rather than switching the counter', async () => {
    await saveQuranSelection({ surah: 2, startAyah: 255, endAyah: 255 }, null);
    await markQuranSelectionUsed('q.2.255.255');
    const view = await renderGrid();

    const card = await view.findByTestId('faith-duas-continue');
    /*
      Sending it to Tasbih would also switch the active counter — a side effect a card the user
      tapped to resume must not cause. The spoken label states the destination.
    */
    expect(String(card.props.accessibilityLabel)).toMatch(/opens in the reader/i);
  });
});

describe('search', () => {
  it('finds a personal selection with zero reviewed entries', async () => {
    await saveQuranSelection({ surah: 2, startAyah: 255, endAyah: 255 }, 'For the evening');
    const view = await renderGrid();
    await view.findByTestId('faith-duas-grid');

    await fireEvent.changeText(view.getByTestId('faith-duas-search'), 'evening');

    await waitFor(() => {
      expect(view.getByTestId('faith-duas-result-q.2.255.255')).toBeTruthy();
    });
    // The grid gives way to results rather than sitting above them.
    expect(view.queryByTestId('faith-duas-grid')).toBeNull();
  });

  it('offers a clear action only once there is something to clear', async () => {
    const view = await renderGrid();
    await view.findByTestId('faith-duas-grid');
    expect(view.queryByTestId('faith-duas-search-clear')).toBeNull();

    await fireEvent.changeText(view.getByTestId('faith-duas-search'), 'x');
    await waitFor(() => {
      expect(view.getByTestId('faith-duas-search-clear')).toBeTruthy();
    });
  });

  it('says nothing matched rather than implying the library is broken', async () => {
    const view = await renderGrid();
    await view.findByTestId('faith-duas-grid');

    await fireEvent.changeText(view.getByTestId('faith-duas-search'), 'zzzz');
    await waitFor(() => {
      expect(view.getByTestId('faith-duas-search-empty')).toBeTruthy();
    });
    expect(view.getByText(/nothing matched that/i)).toBeTruthy();
  });

  it('shows a personal result badged as the user’s own', async () => {
    await saveQuranSelection({ surah: 2, startAyah: 255, endAyah: 255 }, null);
    const view = await renderGrid();
    await view.findByTestId('faith-duas-grid');

    await fireEvent.changeText(view.getByTestId('faith-duas-search'), '2:255');
    await waitFor(() => {
      expect(view.getByTestId('faith-duas-result-q.2.255.255')).toBeTruthy();
    });
    expect(view.getAllByText('Your selection').length).toBeGreaterThan(0);
    expect(view.queryByText('Scholarly-reviewed')).toBeNull();
  });
});

describe('filters', () => {
  it('opens a sheet offering exactly the four filters', async () => {
    const view = await renderGrid();
    await view.findByTestId('faith-duas-grid');

    await fireEvent.press(view.getByTestId('faith-duas-filter'));
    await waitFor(() => {
      expect(view.getByTestId('faith-duas-filter-all')).toBeTruthy();
    });
    for (const id of ['all', 'selections', 'favourites', 'reviewed']) {
      expect(view.getByTestId(`faith-duas-filter-${id}`)).toBeTruthy();
    }
  });

  it('filters to My Quran Selections', async () => {
    await saveQuranSelection({ surah: 2, startAyah: 255, endAyah: 255 }, null);
    const view = await renderGrid();
    await view.findByTestId('faith-duas-grid');

    await fireEvent.press(view.getByTestId('faith-duas-filter'));
    await waitFor(() => expect(view.getByTestId('faith-duas-filter-selections')).toBeTruthy());
    await fireEvent.press(view.getByTestId('faith-duas-filter-selections'));

    await waitFor(() => {
      expect(view.getByTestId('faith-duas-result-q.2.255.255')).toBeTruthy();
    });
  });

  it('filters to Favorites and shows only starred selections', async () => {
    await saveQuranSelection({ surah: 2, startAyah: 255, endAyah: 255 }, null);
    await saveQuranSelection({ surah: 112, startAyah: 1, endAyah: 1 }, null);
    await toggleQuranSelectionFavourite('q.2.255.255');
    const view = await renderGrid();
    await view.findByTestId('faith-duas-grid');

    await fireEvent.press(view.getByTestId('faith-duas-filter'));
    await waitFor(() => expect(view.getByTestId('faith-duas-filter-favourites')).toBeTruthy());
    await fireEvent.press(view.getByTestId('faith-duas-filter-favourites'));

    await waitFor(() => {
      expect(view.getByTestId('faith-duas-result-q.2.255.255')).toBeTruthy();
    });
    expect(view.queryByTestId('faith-duas-result-q.112.1.1')).toBeNull();
  });

  it('filters to Reviewed and says so honestly rather than looking broken', async () => {
    await saveQuranSelection({ surah: 2, startAyah: 255, endAyah: 255 }, null);
    const view = await renderGrid();
    await view.findByTestId('faith-duas-grid');

    await fireEvent.press(view.getByTestId('faith-duas-filter'));
    await waitFor(() => expect(view.getByTestId('faith-duas-filter-reviewed')).toBeTruthy());
    await fireEvent.press(view.getByTestId('faith-duas-filter-reviewed'));

    await waitFor(() => {
      expect(view.getByTestId('faith-duas-search-empty')).toBeTruthy();
    });
    expect(view.getByText(/no reviewed duas yet/i)).toBeTruthy();
    // And it does not leak the user's own selection into a reviewed-only view.
    expect(view.queryByTestId('faith-duas-result-q.2.255.255')).toBeNull();
  });
});

describe('a reviewed category, with nothing approved', () => {
  it('says the approved sentence, and does not call the module unavailable', async () => {
    expect(REVIEWED_DUA_MANIFEST).toHaveLength(0);
    const view = await renderCategory('travel');

    await view.findByTestId('faith-dua-category-empty');
    expect(view.getByText('Reviewed content for this category is not available yet.')).toBeTruthy();
    expect(view.getByText(/does not publish supplications/i)).toBeTruthy();

    const flat = JSON.stringify(view.toJSON());
    expect(flat).not.toMatch(/duas is unavailable/i);
    expect(flat).not.toMatch(/coming soon/i);
  });

  it('offers a way back to the categories and across to the working list', async () => {
    const view = await renderCategory('morning-evening');

    expect(await view.findByTestId('faith-dua-category-back')).toBeTruthy();
    expect(view.getByTestId('faith-dua-category-open-selections')).toBeTruthy();
  });

  it('renders no Arabic, because there is nothing approved to render', async () => {
    const view = await renderCategory('adhkar');
    await view.findByTestId('faith-dua-category-empty');
    expect(JSON.stringify(view.toJSON())).not.toMatch(/[؀-ۿ]/);
  });

  it('answers a category id that does not exist rather than silently redirecting', async () => {
    const view = await renderCategory('not-a-category');
    expect(await view.findByTestId('faith-dua-category-unknown')).toBeTruthy();
  });
});

describe('the personal categories still work', () => {
  it('lists a selection with its Arabic, reference and translator', async () => {
    await saveQuranSelection({ surah: 2, startAyah: 255, endAyah: 255 }, null);
    const view = await renderCategory('my-quran-selections');

    const arabic = await view.findByTestId(
      'faith-dua-category-selection-body-q.2.255.255-arabic-2:255',
    );
    expect(String(arabic.props.children)).toBe(PROBE_ARABIC);
    expect(
      String(
        view.getByTestId('faith-dua-category-selection-body-q.2.255.255-translator').props.children,
      ),
    ).toContain(TRANSLATOR);
  });

  it('keeps read, count, favourite and remove — and offers no share', async () => {
    await saveQuranSelection({ surah: 2, startAyah: 255, endAyah: 255 }, null);
    const view = await renderCategory('my-quran-selections');
    await view.findByTestId('faith-dua-category-selection-q.2.255.255');

    for (const action of ['read', 'use', 'favourite', 'remove']) {
      expect(view.getByTestId(`faith-dua-category-selection-${action}-q.2.255.255`)).toBeTruthy();
    }
    expect(JSON.stringify(view.toJSON())).not.toMatch(/share|export|save to files/i);
  });

  it('removes a selection and forgets only that counter', async () => {
    await saveQuranSelection({ surah: 2, startAyah: 255, endAyah: 255 }, null);
    const repository = createLocalTasbihRepository();
    await repository.startSession('q.2.255.255', { target: 33 });
    await repository.increment();
    await repository.startSession('default');
    await repository.increment();
    await repository.increment();

    const view = await renderCategory('my-quran-selections');
    await fireEvent.press(
      await view.findByTestId('faith-dua-category-selection-remove-q.2.255.255'),
    );

    await waitFor(async () => {
      expect(await readQuranSelections()).toHaveLength(0);
    });

    /* The default counter's own count is untouched: removing one selection disturbs no other. */
    const session = await createLocalTasbihRepository().getSession();
    expect(session.kind).toBe('ok');
    if (session.kind !== 'ok') return;
    expect(session.data.counterId).toBe('default');
    expect(session.data.count).toBe(2);
  });

  it('shows only starred selections under Favorites', async () => {
    await saveQuranSelection({ surah: 2, startAyah: 255, endAyah: 255 }, null);
    await saveQuranSelection({ surah: 112, startAyah: 1, endAyah: 1 }, null);
    await toggleQuranSelectionFavourite('q.2.255.255');

    const view = await renderCategory('favourites');
    expect(await view.findByTestId('faith-dua-category-selection-q.2.255.255')).toBeTruthy();
    expect(view.queryByTestId('faith-dua-category-selection-q.112.1.1')).toBeNull();
  });

  it('says a personal category is empty in its own words, not the reviewed ones', async () => {
    const view = await renderCategory('favourites');

    await view.findByTestId('faith-dua-category-personal-empty');
    /*
      "You have not starred anything" and "nobody has reviewed anything" are different facts. A
      shared empty state would tell the user their own list was awaiting review.
    */
    expect(view.queryByTestId('faith-dua-category-empty')).toBeNull();
    expect(view.getByText(/nothing starred yet/i)).toBeTruthy();
  });

  it('offers the way to add one from My Quran Selections only', async () => {
    const withAdd = await renderCategory('my-quran-selections');
    expect(await withAdd.findByTestId('faith-dua-category-add-selection')).toBeTruthy();
    await cleanup();

    const withoutAdd = await renderCategory('favourites');
    await withoutAdd.findByTestId('faith-dua-category-personal-empty');
    expect(withoutAdd.queryByTestId('faith-dua-category-add-selection')).toBeNull();
  });
});

describe('sending a selection to Tasbih', () => {
  it('switches the counter before the screen that reads it is opened', async () => {
    /*
      ── The defect this pins, found on device ─────────────────────────────────
      The handler fired `markUsed`, `chooseCounter` and `router.push` without awaiting, so the Tasbih
      screen mounted and read the store before the counter switch had landed. Storage settled
      correctly; what was wrong was what the user saw — tapping count on 2:255 opened a counter still
      captioned 5:1, on the one screen whose entire job is to say what is being counted.

      Asserted by driving the real screen and reading the store back, because the ordering is the
      behaviour: a test that only checked the final value would pass against the broken version too.
    */
    await saveQuranSelection({ surah: 2, startAyah: 255, endAyah: 255 }, null);
    await saveQuranSelection({ surah: 112, startAyah: 1, endAyah: 1 }, null);

    const repository = createLocalTasbihRepository();
    await repository.startSession('q.112.1.1', { target: 33 });
    await repository.increment();

    const view = await renderCategory('my-quran-selections');
    await fireEvent.press(await view.findByTestId('faith-dua-category-selection-use-q.2.255.255'));

    await waitFor(async () => {
      const session = await createLocalTasbihRepository().getSession();
      expect(session.kind === 'ok' && session.data.counterId).toBe('q.2.255.255');
    });

    /* And the counter it moved away from kept its count, which is the guarantee underneath. */
    await repository.startSession('q.112.1.1');
    const previous = await repository.getSession();
    expect(previous.kind).toBe('ok');
    if (previous.kind !== 'ok') return;
    expect(previous.data.count).toBe(1);
  });
});
