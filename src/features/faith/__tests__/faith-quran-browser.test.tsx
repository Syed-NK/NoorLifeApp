import AsyncStorage from '@react-native-async-storage/async-storage';
import { cleanup, fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';
import { useWindowDimensions } from 'react-native';

import { TEST_FAITH_USER_ID } from '@/test-support/faith-storage-address';
import { warmUpFirstMount } from '@/test-support/mock-latency-timers';

import { BROWSE_ACTION_HINT, BROWSE_ACTION_LABEL } from '../components/dua-library-items';
import { createMockFaithRepositories } from '../data/mock';
import type { RetainedQuran, RetainedQuranSource } from '../data/offline/retained-quran.source';
import { MAX_SELECTION_AYAT } from '../data/quran-selection/quran-selection';
import { FaithRepositoryProvider } from '../di/faith-repository-context';
import { QuranSelectionScreen } from '../screens/quran-selection-screen';
import { readQuranSelections } from '../storage/faith-quran-selections';
import { setActiveFaithScope } from '../storage/faith-user-scope';

/**
 * **Reaching a verse without knowing where it is.**
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── The product change these cases are about ───────────────────────────────
 * The browser could find a surah by name and a verse by an exact reference, and both require you to
 * already know where you are going. Its own empty state said as much. Somebody who remembers the words
 * had no way in, which made the whole personal-selection feature conditional on knowing Qur'an
 * coordinates.
 *
 * So the cases below drive the path a user without coordinates actually takes: type remembered words,
 * see verses, open one, preview it, keep it. The surah and reference routes are still asserted, because
 * making the new way work must not have cost the old ones.
 *
 * ── The fixture's Arabic is not Qur'anic and its renderings are not a translation ──
 * Synthetic Arabic-script probes with Latin markers, and plain placeholder English. The same rule the
 * rest of this module follows: nothing asserted needs the text to be scripture, and a fixture is
 * exactly where unverified religious content survives a deletion.
 *
 * The retained double also proves the offline claim by construction — it has no network, so a screen
 * that renders from it cannot have fetched anything.
 * ═══════════════════════════════════════════════════════════════════════════
 */

jest.mock('react-native/Libraries/Utilities/useWindowDimensions');

const mockedDimensions = useWindowDimensions as unknown as jest.Mock;

const TRANSLATOR = 'A Named Translator';
const EDITION = 'A Named Edition';

/** The three acceptance sizes, plus the phone width the layout defects were measured on. */
const MATRIX = [
  ['411 dp at font 1.0', 411, 1.0],
  ['393 dp at font 1.3', 393, 1.3],
  ['320 dp at font 1.5', 320, 1.5],
  ['384 dp at font 1.0', 384, 1.0],
] as const;

function viewport(width = 411, fontScale = 1): void {
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
            { ayah: 1, text: 'ألف-probe-١' },
            { ayah: 2, text: 'باء-probe-٢' },
            { ayah: 3, text: 'جيم-probe-٣' },
          ],
        ],
        [112, [{ ayah: 1, text: 'دال-probe-١' }]],
      ]),
    },
    translations: {
      generationId: 'test-generation',
      resourceId: 85,
      source: {
        name: 'Quran Foundation',
        edition: EDITION,
        attribution: TRANSLATOR,
        verified: true,
      },
      bySurah: new Map([
        [
          2,
          [
            { ayah: 1, text: 'a placeholder rendering about guardianship' },
            { ayah: 2, text: 'a placeholder rendering about patience' },
            { ayah: 3, text: 'a placeholder rendering about gratitude' },
          ],
        ],
        [112, [{ ayah: 1, text: 'a placeholder rendering about oneness' }]],
      ]),
    },
  };
  return { read: async () => content };
}

/** A device that has retained nothing — the state before the Qur'an has downloaded. */
const emptyRetained: RetainedQuranSource = { read: async () => null };

/** Arabic retained, translation not: a real intermediate state, and a different absence. */
function arabicOnly(): RetainedQuranSource {
  const content: RetainedQuran = {
    generationId: 'test-generation',
    arabic: {
      generationId: 'test-generation',
      script: 'text_uthmani',
      lastCheckedAt: 0,
      source: { name: 'Quran Foundation', edition: 'Uthmani', verified: true },
      bySurah: new Map([[2, [{ ayah: 1, text: 'ألف-probe-١' }]]]),
    },
    translations: null,
  };
  return { read: async () => content };
}

async function drain(passes = 10): Promise<void> {
  for (let pass = 0; pass < passes; pass += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

async function renderBrowser(
  retainedQuran: RetainedQuranSource = retainedDouble(),
  width = 411,
  fontScale = 1,
): Promise<typeof screen> {
  viewport(width, fontScale);
  render(
    <FaithRepositoryProvider repositories={{ ...createMockFaithRepositories(), retainedQuran }}>
      <QuranSelectionScreen />
    </FaithRepositoryProvider>,
  );
  await drain();
  return screen;
}

async function type(view: typeof screen, text: string): Promise<void> {
  await fireEvent.changeText(view.getByTestId('faith-quran-selection-search'), text);
  await drain();
}

warmUpFirstMount(async () => {
  viewport();
  return renderBrowser();
});

beforeEach(async () => {
  await AsyncStorage.clear();
  setActiveFaithScope(TEST_FAITH_USER_ID);
  viewport();
});

afterEach(async () => {
  await cleanup();
  mockedDimensions.mockReset();
});

describe('the way in no longer asks for coordinates', () => {
  it('names the task rather than the outcome, and says what the search accepts', () => {
    expect(BROWSE_ACTION_LABEL).toBe('Browse the Qur’an');
    expect(BROWSE_ACTION_HINT).toBe('Search by surah, reference, or words you remember.');
  });

  it('titles the browser with the same words', async () => {
    const view = await renderBrowser();
    expect(view.getByTestId('faith-quran-selection-header-title').props.children).toBe(
      BROWSE_ACTION_LABEL,
    );
  });

  it('tells assistive technology all three ways in', async () => {
    const view = await renderBrowser();
    const field = view.getByTestId('faith-quran-selection-search');
    expect(String(field.props.accessibilityLabel)).toBe(
      'Search by surah, reference, or words you remember',
    );
  });
});

describe('finding a verse by remembered words', () => {
  it('shows nothing about verses until the query is worth scanning', async () => {
    const view = await renderBrowser();
    expect(view.queryByTestId('faith-quran-selection-verse-matches')).toBeNull();

    await type(view, 'gu');
    /* Two characters is a search that has not run, not a search that found nothing. */
    expect(view.queryByTestId('faith-quran-selection-verse-matches')).toBeNull();
    expect(view.queryByTestId('faith-quran-selection-verse-empty')).toBeNull();
  });

  it('lists the verses whose words match, with their references', async () => {
    const view = await renderBrowser();
    await type(view, 'guardianship');

    expect(view.getByTestId('faith-quran-selection-verse-matches')).toBeTruthy();
    expect(view.getByTestId('faith-quran-selection-verse-2:1')).toBeTruthy();
    /* And only that one — the other renderings do not contain the word. */
    expect(view.queryByTestId('faith-quran-selection-verse-2:2')).toBeNull();
  });

  it('names the translator beside the snippets, because a snippet is translation text', async () => {
    const view = await renderBrowser();
    await type(view, 'placeholder');

    const credit = String(
      view.getByTestId('faith-quran-selection-verse-translator').props.children,
    );
    expect(credit).toContain(TRANSLATOR);
    expect(credit).toContain(EDITION);
  });

  it('announces a verse row with its reference and the words that matched', async () => {
    const view = await renderBrowser();
    await type(view, 'oneness');

    const row = view.getByTestId('faith-quran-selection-verse-112:1');
    const label = String(row.props.accessibilityLabel);
    expect(row.props.accessibilityRole).toBe('button');
    expect(label).toContain('112:1');
    expect(label).toContain('oneness');
    expect(String(row.props.accessibilityHint)).toContain('choose');
  });

  it('opens the chosen verse as a single ayah, with no range guessed for the user', async () => {
    const view = await renderBrowser();
    await type(view, 'gratitude');
    await fireEvent.press(view.getByTestId('faith-quran-selection-verse-2:3'));
    await drain();

    /*
      The range picker, opened at 2:3 with both endpoints on that verse. Where a passage runs on, only
      the reader knows where it should end — pre-selecting a range would put NoorLife's judgement into
      somebody's saved reference.
    */
    expect(view.getByTestId('faith-quran-selection-range')).toBeTruthy();
    expect(String(view.getByTestId('faith-quran-selection-start-input').props.value)).toBe('3');
    expect(String(view.getByTestId('faith-quran-selection-end-input').props.value)).toBe('3');
  });

  it('previews the verse it opened, with Arabic, rendering and translator', async () => {
    const view = await renderBrowser();
    await type(view, 'patience');
    await fireEvent.press(view.getByTestId('faith-quran-selection-verse-2:2'));
    await drain();

    const body = view.getByTestId('faith-quran-selection-preview-body-arabic-2:2');
    expect(String(body.props.children)).toBe('باء-probe-٢');
    expect(
      String(view.getByTestId('faith-quran-selection-preview-body-translator').props.children),
    ).toContain(TRANSLATOR);
  });

  it('saves what was previewed, as the user’s own selection', async () => {
    const view = await renderBrowser();
    await type(view, 'guardianship');
    await fireEvent.press(view.getByTestId('faith-quran-selection-verse-2:1'));
    await drain();
    await fireEvent.press(view.getByTestId('faith-quran-selection-save'));
    await drain(20);

    const stored = await readQuranSelections();
    expect(stored.map((s) => s.id)).toEqual(['q.2.1.1']);
    /* Saved as a reference and nothing else — no title, no category, no religious claim. */
    expect(stored[0]?.favourite).toBe(false);
    expect(stored[0]?.label).toBeNull();
  });
});

describe('the routes that already worked still work', () => {
  it('finds a surah by name', async () => {
    const view = await renderBrowser();
    await type(view, 'baqarah');
    /* The surah list narrows; whether a name resolves depends on the metadata cache, not on this path. */
    expect(view.getByTestId('faith-quran-selection-surahs')).toBeTruthy();
  });

  it('offers a typed reference as its own destination', async () => {
    const view = await renderBrowser();
    await type(view, '2:2');

    const jump = view.getByTestId('faith-quran-selection-jump');
    expect(String(jump.props.accessibilityLabel)).toContain('2:2');
    await fireEvent.press(jump);
    await drain();
    expect(view.getByTestId('faith-quran-selection-range')).toBeTruthy();
  });

  it('keeps contiguous ranges available, bounded where they always were', async () => {
    /* The contract is unchanged: contiguous only, two endpoints, ten ayat, single ayah the default. */
    expect(MAX_SELECTION_AYAT).toBe(10);

    const view = await renderBrowser();
    await type(view, '2:1');
    await fireEvent.press(view.getByTestId('faith-quran-selection-jump'));
    await drain();

    expect(String(view.getByTestId('faith-quran-selection-start-input').props.value)).toBe('1');
    expect(String(view.getByTestId('faith-quran-selection-end-input').props.value)).toBe('1');
    await fireEvent.changeText(view.getByTestId('faith-quran-selection-end-input'), '3');
    await drain();
    expect(view.getByTestId('faith-quran-selection-preview')).toBeTruthy();
  });
});

describe('offline, and the two ways content can be absent', () => {
  it('searches and browses with no network anywhere in the tree', async () => {
    /*
      The double exposes `read()` and nothing else, so a screen that renders verses from it cannot have
      fetched them. That is the offline claim as a property of the dependency rather than a rule.
    */
    const view = await renderBrowser();
    await type(view, 'oneness');
    expect(view.getByTestId('faith-quran-selection-verse-112:1')).toBeTruthy();
  });

  it('says the Qur’an is not on the device when no generation is retained', async () => {
    const view = await renderBrowser(emptyRetained);
    await type(view, 'oneness');

    expect(view.getByTestId('faith-quran-selection-verse-unavailable')).toBeTruthy();
    /*
      Two cards legitimately say this at once — the verse search and the surah list — so the assertion
      names the one under test rather than counting matches. `getByText` would fail on the ambiguity.
    */
    expect(view.getAllByText(/not on this device yet/i).length).toBeGreaterThan(0);
    /* And points at the two things that still work rather than dead-ending. */
    expect(view.getByText(/browse by surah below|reference like 2:255/i)).toBeTruthy();
  });

  it('distinguishes a missing translation from a missing generation', async () => {
    const view = await renderBrowser(arabicOnly());
    await type(view, 'oneness');

    expect(view.getByTestId('faith-quran-selection-verse-unavailable')).toBeTruthy();
    /* A different sentence: the Arabic is here, so there is nothing wrong with the download. */
    expect(view.getByText(/meaning is not on this device yet/i)).toBeTruthy();
  });

  it('answers a real miss as a miss, and names the rendering it searched', async () => {
    const view = await renderBrowser();
    await type(view, 'unmatchable-phrase');

    expect(view.getByTestId('faith-quran-selection-verse-empty')).toBeTruthy();
    expect(view.getByText(new RegExp(TRANSLATOR))).toBeTruthy();
  });
});

describe('a verse found this way is still only the user’s own', () => {
  it('is saved with no reviewed or popular classification anywhere on it', async () => {
    const view = await renderBrowser();
    await type(view, 'guardianship');
    await fireEvent.press(view.getByTestId('faith-quran-selection-verse-2:1'));
    await drain();
    await fireEvent.press(view.getByTestId('faith-quran-selection-save'));
    await drain(20);

    const stored = await readQuranSelections();
    const asText = JSON.stringify(stored);
    /* The stored record has no field in which a review or a rank could be written. */
    expect(asText).not.toMatch(/review|popular|approved|scholar/i);
  });

  it('says nothing on the browser that claims review or popularity', async () => {
    const view = await renderBrowser();
    await type(view, 'placeholder');

    /*
      Queried rather than serialised. `JSON.stringify(view.toJSON())` throws on this tree — a provider's
      value closes a cycle — and `queryAllByText` states the assertion directly anyway: no rendered text
      anywhere on the browser claims review or popularity for a verse the user found themselves.
    */
    expect(view.queryAllByText(/scholarly|reviewed|popular/i)).toEqual([]);
  });

  it('belongs to the account that saved it and to no other', async () => {
    const USER_A = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
    const USER_B = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';

    setActiveFaithScope(USER_A);
    const view = await renderBrowser();
    await type(view, 'oneness');
    await fireEvent.press(view.getByTestId('faith-quran-selection-verse-112:1'));
    await drain();
    await fireEvent.press(view.getByTestId('faith-quran-selection-save'));
    await drain(20);
    expect(await readQuranSelections()).toHaveLength(1);

    setActiveFaithScope(USER_B);
    expect(await readQuranSelections()).toEqual([]);
    /* Cleared for B, not deleted: signing back in as A restores it. */
    setActiveFaithScope(USER_A);
    expect(await readQuranSelections()).toHaveLength(1);
  });
});

describe('the responsive matrix and the page’s accessibility', () => {
  it.each(MATRIX)('%s renders the browser and its search', async (_name, width, scale) => {
    const view = await renderBrowser(retainedDouble(), width, scale);
    expect(view.getByTestId('faith-quran-selection-search')).toBeTruthy();
    expect(view.getByTestId('faith-quran-selection-surahs')).toBeTruthy();
    expect(String(view.getByTestId('faith-quran-selection-search').props.accessibilityLabel)).toBe(
      'Search by surah, reference, or words you remember',
    );
  });

  it.each(MATRIX)('%s gives every verse row a name and a target', async (_name, width, scale) => {
    const view = await renderBrowser(retainedDouble(), width, scale);
    await type(view, 'placeholder');

    for (const reference of ['2:1', '2:2', '2:3', '112:1']) {
      const row = view.getByTestId(`faith-quran-selection-verse-${reference}`);
      const label = String(row.props.accessibilityLabel);
      expect(label).toContain(reference);
      expect(label).not.toMatch(/undefined|null|NaN/);
    }
  });

  it('marks the matched-verses heading as a heading', async () => {
    const view = await renderBrowser();
    await type(view, 'placeholder');
    expect(view.getByText(/verses matched|One verse matched/)).toBeTruthy();
  });
});
