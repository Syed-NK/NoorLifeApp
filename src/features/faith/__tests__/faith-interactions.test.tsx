import AsyncStorage from '@react-native-async-storage/async-storage';
import { render, fireEvent, screen } from '@testing-library/react-native';
import React, { type ReactElement } from 'react';

import { warmUpFirstMount } from '@/test-support/mock-latency-timers';
import { seedTranslationPreference } from '@/test-support/faith-preferences-fixtures';

import { setRouteParams } from '../../../../jest.setup';

import type { FaithRepositories } from '../data';
import { createMockFaithRepositories } from '../data/mock';
import { FaithRepositoryProvider } from '../di/faith-repository-context';
import { FaithAiScreen } from '../screens/faith-ai-screen';
import { ReaderScreen } from '../screens/reader-screen';
import { SearchScreen } from '../screens/search-screen';
import { TasbihScreen } from '../screens/tasbih-screen';
import { WorshipScreen } from '../screens/worship-screen';

/**
 * Faith screen interactions.
 *
 * ── Separate from the mount smoke suite ─────────────────────────────────────
 * `faith-screens.test.tsx` asserts that seventeen screens render. This file asserts that
 * pressing things does what it should, which is a different claim and needs a longer
 * async budget: every interaction here goes render → repository → storage → re-render.
 *
 * ── One harness note worth recording ────────────────────────────────────────
 * `findBy*` already retries until its timeout. Wrapping one in `waitFor` nests two retry
 * loops, and the inner one exhausts the outer one's budget before it can succeed — which
 * looks exactly like a broken screen and cost an hour to diagnose. Every assertion below
 * uses `findBy*` on its own.
 *
 * ── Real timers, and a warmed first mount ───────────────────────────────────
 * The sibling suites advance fake timers to skip the 280 ms every Faith mock repository sleeps.
 * This one cannot: its screens become ready through promise chains rather than through a timer, and
 * `waitFor` under fake timers exhausts its simulated budget in microseconds before those chains
 * settle. What it can take is the other half — the first mount, which measured 3.4 s against 200 ms
 * for the ones after it, paid for in `beforeAll` instead of by whichever test happens to run first.
 */
warmUpFirstMount(() => withRepositories(<SearchScreen />));

beforeEach(async () => {
  // Tasbih and worship genuinely persist, so a count left by one case would otherwise be
  // the starting state of the next.
  await AsyncStorage.clear();
  // A translation is a precondition of these cases, not their subject. See the helper's note.
  await seedTranslationPreference();
});

/**
 * Renders a screen against the **fixtures**, plus any overrides the case supplies.
 *
 * The mock set is passed explicitly rather than relied on as the provider's default. Since Quran
 * Foundation access was approved that default is environment-dependent: a build with
 * `EXPO_PUBLIC_SUPABASE_URL` set gets the approved adapter, and `EXPO_PUBLIC_*` values are inlined
 * at transform time — so whether a developer happens to have a `.env` would otherwise decide which
 * repository these cases exercise. Naming the fixtures makes every one of them say what it means.
 */
async function withRepositories(element: ReactElement, repositories?: Partial<FaithRepositories>) {
  await render(
    <FaithRepositoryProvider repositories={{ ...createMockFaithRepositories(), ...repositories }}>
      {element}
    </FaithRepositoryProvider>,
  );
  return screen;
}

describe('search', () => {
  it('prompts before a query is entered', async () => {
    const view = await withRepositories(<SearchScreen />);
    expect(await view.findByTestId('faith-search-results-no-results')).toBeTruthy();
  });

  it('shows no-results for a term that matches nothing', async () => {
    const view = await withRepositories(<SearchScreen />);
    fireEvent.changeText(await view.findByTestId('faith-search-input'), 'zzzznothing');
    fireEvent.press(await view.findByTestId('faith-search-submit'));

    expect(await view.findByText(/No results found/)).toBeTruthy();
  });

  it('finds a verse by its translation', async () => {
    const view = await withRepositories(<SearchScreen />);
    fireEvent.changeText(await view.findByTestId('faith-search-input'), 'hardship');
    fireEvent.press(await view.findByTestId('faith-search-submit'));

    expect(await view.findByTestId('faith-search-ayat')).toBeTruthy();
  });
});

describe('reader pagination', () => {
  /**
   * A surah that does not fit in one page.
   *
   * The fixtures carry a handful of ayat per surah, so one page was always the whole thing and the
   * reader could ignore paging. The approved source returns a bounded page — twenty verses by
   * default, fifty at most — so a reader that rendered the first page and stopped would show twenty
   * ayat of Al-Baqarah's 286 and give no sign the surah continues. That is a false statement about
   * the text, not a missing feature, which is why it is asserted here.
   */
  const SOURCE = { name: 'Test source', verified: false } as const;

  function versePage(from: number, to: number, nextCursor: string | null) {
    return {
      kind: 'ok' as const,
      data: {
        items: Array.from({ length: to - from + 1 }, (_unused, offset) => ({
          surah: 2 as never,
          ayah: (from + offset) as never,
          arabic: `verse-${from + offset}`,
          source: SOURCE,
        })),
        nextCursor,
        total: 286,
      },
    };
  }

  /**
   * The surah the reader is told to open.
   *
   * It used to be told by *storage* — the reader read the saved position and showed whatever was
   * there, which is why every surah row in the catalogue opened the same verses. It is now a route
   * parameter, so the test says which surah it means the same way the app does.
   */
  async function readerWithPages() {
    setRouteParams({ surah: '2' });

    const requestedCursors: (string | undefined)[] = [];
    return {
      requestedCursors,
      view: await withRepositories(<ReaderScreen />, {
        quran: {
          ...createMockFaithRepositories().quran,
          listAyahs: async (_surah, page) => {
            requestedCursors.push(page?.cursor);
            return page?.cursor === '2' ? versePage(3, 4, null) : versePage(1, 2, '2');
          },
          listTranslations: async () => ({ kind: 'empty' }),
        },
      }),
    };
  }

  it('says how far through the surah it is rather than ending silently', async () => {
    const { view } = await readerWithPages();

    expect(await view.findByTestId('faith-reader-more')).toBeTruthy();
    expect(await view.findByText(/Showing 2 of 286 verses/)).toBeTruthy();
  });

  it('appends the next page instead of replacing what is on screen', async () => {
    const { view, requestedCursors } = await readerWithPages();

    fireEvent.press(await view.findByTestId('faith-reader-load-more'));

    // The new verses are there…
    expect(await view.findByTestId('faith-reader-ayah-2-3')).toBeTruthy();
    // …and so are the ones the user was already reading.
    expect(await view.findByTestId('faith-reader-ayah-2-1')).toBeTruthy();
    expect(requestedCursors).toEqual([undefined, '2']);
  });

  it('stops offering more once the surah ends', async () => {
    const { view } = await readerWithPages();

    fireEvent.press(await view.findByTestId('faith-reader-load-more'));
    expect(await view.findByTestId('faith-reader-ayah-2-4')).toBeTruthy();

    expect(view.queryByTestId('faith-reader-load-more')).toBeNull();
  });

  it('keeps the verses on screen when the next page fails', async () => {
    /**
     * The verses already rendered are correct and still worth reading. Replacing them with an error
     * state to report that the *next* page did not arrive would lose the user's place to tell them
     * about something that did not affect it.
     */
    setRouteParams({ surah: '2' });

    const view = await withRepositories(<ReaderScreen />, {
      quran: {
        ...createMockFaithRepositories().quran,
        listAyahs: async (_surah, page) =>
          page?.cursor === undefined
            ? versePage(1, 2, '2')
            : { kind: 'error' as const, code: 'unavailable' as const },
        listTranslations: async () => ({ kind: 'empty' }),
      },
    });

    fireEvent.press(await view.findByTestId('faith-reader-load-more'));

    expect(await view.findByText(/could not be loaded/)).toBeTruthy();
    expect(await view.findByTestId('faith-reader-ayah-2-1')).toBeTruthy();
  });
});

describe('tasbih', () => {
  it('offers exactly the controls the approved design allows', async () => {
    const view = await withRepositories(<TasbihScreen />);
    expect(await view.findByTestId('faith-tasbih-count')).toBeTruthy();
    expect(await view.findByTestId('faith-tasbih-undo')).toBeTruthy();
    expect(await view.findByTestId('faith-tasbih-change')).toBeTruthy();
    expect(await view.findByTestId('faith-tasbih-target')).toBeTruthy();
    expect(await view.findByTestId('faith-tasbih-haptics-switch')).toBeTruthy();

    /*
      Reset is deliberately absent. The locked design carries three control groups — Undo, Target,
      Haptics — and naming the omissions here is what stops a later pass quietly restoring the
      settings-form arrangement that was rejected.
    */
    expect(view.queryByTestId('faith-tasbih-reset')).toBeNull();
    expect(view.queryByTestId('faith-tasbih-target-up-leap')).toBeNull();
    expect(view.queryByTestId('faith-tasbih-target-down-leap')).toBeNull();
  });

  it('increments the visible count on press', async () => {
    const view = await withRepositories(<TasbihScreen />);
    const value = await view.findByTestId('faith-tasbih-count-value');
    expect(value.props.children).toBe('0');

    fireEvent.press(await view.findByTestId('faith-tasbih-count'));

    expect(await view.findByText('1')).toBeTruthy();
  });

  it('undoes a mis-tap without going below zero', async () => {
    const view = await withRepositories(<TasbihScreen />);
    fireEvent.press(await view.findByTestId('faith-tasbih-undo'));
    expect(await view.findByText('0')).toBeTruthy();
  });

  it('opens the dhikr selector when Change is pressed', async () => {
    /*
      `Change` is a destination now, not an inline list. Counter management outgrew a strip under
      the counting surface once it had to carry search, category filters, five sections and the
      create/rename/remove flow — and the approved reference puts `Change` on the Current Dhikr
      sheet, which is what opens it.
    */
    const view = await withRepositories(<TasbihScreen />);
    const change = await view.findByTestId('faith-tasbih-change');

    expect(change.props.accessibilityRole).toBe('button');
    expect(String(change.props.accessibilityLabel)).toMatch(/change dhikr/i);
    fireEvent.press(change);

    // The counting screen itself never grows a counter list; the selector owns that.
    expect(view.queryByTestId('faith-tasbih-counters')).toBeNull();
  });
});

describe('worship checklist', () => {
  it('marks an entry and reflects it in the summary', async () => {
    const view = await withRepositories(<WorshipScreen />);
    expect(await view.findByTestId('faith-worship-summary')).toBeTruthy();

    fireEvent.press(await view.findByTestId('faith-worship-entry-fajr'));

    // The repository returns the whole day, so the row renders from the persisted answer
    // rather than from an optimistic guess.
    expect(await view.findByTestId('faith-worship-row-fajr')).toBeTruthy();
  });
});

describe('Faith AI', () => {
  it('states that it is not connected', async () => {
    const view = await withRepositories(<FaithAiScreen />);
    expect(await view.findByTestId('faith-ai-banner')).toBeTruthy();
  });

  it('renders a limitation for a jurisprudential question', async () => {
    const view = await withRepositories(<FaithAiScreen />);
    fireEvent.changeText(
      await view.findByTestId('faith-ai-input'),
      'is it permissible to do this?',
    );
    fireEvent.press(await view.findByTestId('faith-ai-send'));

    expect(await view.findByTestId('faith-ai-limitation')).toBeTruthy();
  });

  it('offers a hand-off and renders no answer for an out-of-scope question', async () => {
    const view = await withRepositories(<FaithAiScreen />);
    fireEvent.changeText(await view.findByTestId('faith-ai-input'), 'how did I sleep?');
    fireEvent.press(await view.findByTestId('faith-ai-send'));

    expect(await view.findByTestId('faith-ai-handoff')).toBeTruthy();
    expect(view.queryByTestId('faith-ai-answer')).toBeNull();
  });

  /**
   * ── What this asserted, and why the assertion inverted ──────────────────────
   * It required an in-scope question to come back with an *attributed quote*, and checked that the
   * "not a verified source" badge appeared beside it. Both halves were satisfied by the fixture's
   * Qur'an 94:6 entry.
   *
   * That quote is deleted. It named a real surah and ayah, and nobody had verified the Arabic against
   * an approved source — the badge admitted as much rather than excusing it. So the guarantee is now
   * the stronger one: an in-scope question is answered, and the answer carries **no** quote, because a
   * mock has nothing it is entitled to quote. There is no badge to look for because there is nothing to
   * label.
   */
  it('answers an in-scope question without quoting scripture', async () => {
    const view = await withRepositories(<FaithAiScreen />);
    fireEvent.changeText(await view.findByTestId('faith-ai-input'), 'explain this ayah');
    fireEvent.press(await view.findByTestId('faith-ai-send'));

    expect(await view.findByTestId('faith-ai-answer')).toBeTruthy();
    // Nothing is presented as scripture, so nothing needs a provenance badge.
    expect(view.queryByText(/not a verified source/i)).toBeNull();
    // And the reply points at the reader, which does hold approved text.
    expect(await view.findByText(/Qur’an reader/)).toBeTruthy();
  });
});
