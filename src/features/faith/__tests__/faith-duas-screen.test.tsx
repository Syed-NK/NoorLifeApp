import AsyncStorage from '@react-native-async-storage/async-storage';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';

import { warmUpFirstMount } from '@/test-support/mock-latency-timers';
import { TEST_FAITH_USER_ID } from '@/test-support/faith-storage-address';

import { createMockFaithRepositories } from '../data/mock';
import type { RetainedQuran, RetainedQuranSource } from '../data/offline/retained-quran.source';
import { REVIEWED_DUA_MANIFEST } from '../data/dhikr/reviewed-dua-manifest';
import { FaithRepositoryProvider } from '../di/faith-repository-context';
import { DuasScreen } from '../screens/duas-screen';
import {
  markQuranSelectionUsed,
  readQuranSelections,
  saveQuranSelection,
  toggleQuranSelectionFavourite,
} from '../storage/faith-quran-selections';
import { setActiveFaithScope } from '../storage/faith-user-scope';

/**
 * **Duas, now that it does something — and the line it still must not cross.**
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── What replaced the locked library, and what did not change ──────────────
 * The screen used to be three disabled preview rows over "Verified supplications will appear here".
 * It now lists the user's own Quran selections, their favourites and what they used lately, with
 * the Arabic resolved from the copy this device retained.
 *
 * The permission position is unchanged: no approved supplication provider, and no scholarly review
 * of any Quran-derived catalogue. So the assertions here are in two halves — that the working part
 * works, and that the part that does not exist is neither faked nor described as breakage.
 *
 * ── The scans that survive from the locked-library suite ───────────────────
 * No Hadith grading vocabulary, no collection citation, and no Arabic *until the user has chosen a
 * verse*. The last one is the interesting change: Arabic on this screen used to prove a defect and
 * now proves the feature, so the assertion moved from "never" to "not before the user asked for it".
 *
 * The fixture's Arabic is synthetic and carries a Latin marker. A test fixture is exactly where
 * unverified religious text survives a deletion, and no property here needs the text to be
 * scripture.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const PROBE_ARABIC = 'ألف-probe-١';
const PROBE_TRANSLATION = 'a rendering of the meaning';
const TRANSLATOR = 'A Named Translator';

function retainedDouble(): RetainedQuranSource {
  const content: RetainedQuran = {
    generationId: 'test-generation',
    arabic: {
      generationId: 'test-generation',
      script: 'text_uthmani',
      lastCheckedAt: 0,
      source: { name: 'Quran Foundation', edition: 'Uthmani', verified: true },
      bySurah: new Map([[2, [{ ayah: 1, text: PROBE_ARABIC }]]]),
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
      bySurah: new Map([[2, [{ ayah: 1, text: PROBE_TRANSLATION }]]]),
    },
  };
  return { read: async () => content };
}

async function renderDuas(): Promise<typeof screen> {
  await render(
    <FaithRepositoryProvider
      repositories={{ ...createMockFaithRepositories(), retainedQuran: retainedDouble() }}
    >
      <DuasScreen />
    </FaithRepositoryProvider>,
  );
  return screen;
}

warmUpFirstMount(() => renderDuas());

beforeEach(async () => {
  await AsyncStorage.clear();
  setActiveFaithScope(TEST_FAITH_USER_ID);
});

afterEach(async () => {
  await cleanup();
});

describe('the sections the screen offers', () => {
  it('offers selections, favourites and recently used', async () => {
    const view = await renderDuas();

    expect(await view.findByTestId('faith-duas-selections')).toBeTruthy();
    expect(view.getByTestId('faith-duas-favourites')).toBeTruthy();
    expect(view.getByTestId('faith-duas-recent')).toBeTruthy();
  });

  it('shows no reviewed section, because no entry has been approved', async () => {
    const view = await renderDuas();
    await view.findByTestId('faith-duas-selections');

    expect(REVIEWED_DUA_MANIFEST).toHaveLength(0);
    /*
      Absent rather than empty or locked. An empty section invites "try again"; a locked one implies
      the screen is broken. What is true is stated once, in its own card, beside the part that works.
    */
    expect(view.queryByTestId('faith-duas-reviewed')).toBeNull();
    expect(view.getByTestId('faith-duas-awaiting-review')).toBeTruthy();
  });

  it('never describes the whole screen as unavailable', async () => {
    const view = await renderDuas();
    await view.findByTestId('faith-duas-selections');
    const text = JSON.stringify(view.toJSON());

    /*
      The old locked copy promised a provider and nothing else. Repeating it now would tell somebody
      that a feature they can use does not work — which is its own false statement, and the exact one
      this screen was rewritten to stop making.
    */
    expect(text).not.toContain('Verified supplications will appear here');
    expect(text).not.toMatch(/coming soon/i);
    // The honest sentence names the thing that is missing, not the screen.
    expect(view.getByText(/scholarly-reviewed duas are not ready yet/i)).toBeTruthy();
  });

  it('states the empty case without proposing anything to fill it', async () => {
    const view = await renderDuas();

    const empty = await view.findByTestId('faith-duas-selections-empty');
    expect(String(empty.props.children)).toMatch(/not kept any verses yet/i);
    expect(view.getByTestId('faith-duas-favourites-empty')).toBeTruthy();
    expect(view.getByTestId('faith-duas-recent-empty')).toBeTruthy();
    // The way out is an action, not a suggested verse.
    expect(view.getByTestId('faith-duas-add-selection')).toBeTruthy();
  });
});

describe('an item, once the user has kept one', () => {
  it('shows the Arabic, the reference, the translation and the translator', async () => {
    await saveQuranSelection({ surah: 2, startAyah: 1, endAyah: 1 }, null);
    const view = await renderDuas();

    const arabic = await view.findByTestId('faith-duas-selection-body-q.2.1.1-arabic-2:1');
    expect(String(arabic.props.children)).toBe(PROBE_ARABIC);

    expect(
      String(view.getByTestId('faith-duas-selection-body-q.2.1.1-translation-2:1').props.children),
    ).toBe(PROBE_TRANSLATION);
    expect(
      String(view.getByTestId('faith-duas-selection-body-q.2.1.1-translator').props.children),
    ).toContain(TRANSLATOR);
    expect(view.getByText('Qur’an 2:1')).toBeTruthy();
  });

  it('says whose item it is, on the item', async () => {
    await saveQuranSelection({ surah: 2, startAyah: 1, endAyah: 1 }, null);
    const view = await renderDuas();
    await view.findByTestId('faith-duas-selection-q.2.1.1');

    // The badge is on the row, not only on the heading — a row is what somebody remembers.
    expect(view.getAllByText('Your selection').length).toBeGreaterThan(0);
    expect(view.queryByText('Scholarly-reviewed')).toBeNull();
  });

  it('offers read, count, favourite and remove — and no share', async () => {
    await saveQuranSelection({ surah: 2, startAyah: 1, endAyah: 1 }, null);
    const view = await renderDuas();

    expect(await view.findByTestId('faith-duas-selection-read-q.2.1.1')).toBeTruthy();
    expect(view.getByTestId('faith-duas-selection-use-q.2.1.1')).toBeTruthy();
    expect(view.getByTestId('faith-duas-selection-favourite-q.2.1.1')).toBeTruthy();
    expect(view.getByTestId('faith-duas-selection-remove-q.2.1.1')).toBeTruthy();

    /*
      No share, no export, no copy-out. The permission prohibits emitting the retained text as a file
      or a standalone distribution, and a control that refused at the point of use would be a control
      that lies about what it does — so the affordance does not exist.
    */
    expect(JSON.stringify(view.toJSON())).not.toMatch(/share|export|save to files|copy/i);
  });

  it('favourites from the item, and the favourites section picks it up', async () => {
    await saveQuranSelection({ surah: 2, startAyah: 1, endAyah: 1 }, null);
    const view = await renderDuas();

    fireEvent.press(await view.findByTestId('faith-duas-selection-favourite-q.2.1.1'));

    await waitFor(() => {
      expect(view.getByTestId('faith-duas-favourite-q.2.1.1')).toBeTruthy();
    });
  });

  it('removes a personal selection', async () => {
    await saveQuranSelection({ surah: 2, startAyah: 1, endAyah: 1 }, null);
    const view = await renderDuas();

    fireEvent.press(await view.findByTestId('faith-duas-selection-remove-q.2.1.1'));

    await waitFor(async () => {
      expect(await readQuranSelections()).toHaveLength(0);
    });
  });

  it('lists what was used lately, and only what was used', async () => {
    await saveQuranSelection({ surah: 2, startAyah: 1, endAyah: 1 }, null);
    await markQuranSelectionUsed('q.2.1.1');
    const view = await renderDuas();

    expect(await view.findByTestId('faith-duas-recent-item-q.2.1.1')).toBeTruthy();
  });

  it('separates favourites from the full list rather than reordering one list', async () => {
    await saveQuranSelection({ surah: 2, startAyah: 1, endAyah: 1 }, null);
    await toggleQuranSelectionFavourite('q.2.1.1');
    const view = await renderDuas();

    // The same reference appears under both headings, as itself, with its own controls.
    expect(await view.findByTestId('faith-duas-selection-q.2.1.1')).toBeTruthy();
    expect(view.getByTestId('faith-duas-favourite-q.2.1.1')).toBeTruthy();
  });
});

describe('what may never appear here', () => {
  const GRADING = /\b(sahih|hasan|da'?if|mutawatir|authentic(ated)? narration)\b/i;
  const CITATION = /\b(bukhari|muslim|tirmidhi|nawawi|abu dawud|ibn majah)\b/i;
  const ARABIC = /[؀-ۿ]/;

  it('renders no Hadith grading vocabulary and no collection citation', async () => {
    await saveQuranSelection({ surah: 2, startAyah: 1, endAyah: 1 }, null);
    const view = await renderDuas();
    await view.findByTestId('faith-duas-selection-q.2.1.1');
    const text = JSON.stringify(view.toJSON());

    /*
      Both survive from the locked-library suite unchanged. The screen shows Qur'an now; it has never
      been permitted to show a narration, and a Dua screen quietly acquiring a grading word is how
      that would start.
    */
    expect(GRADING.test(text)).toBe(false);
    expect(CITATION.test(text)).toBe(false);
  });

  it('renders no Arabic at all until the user has chosen a verse', async () => {
    const view = await renderDuas();
    await view.findByTestId('faith-duas-selections-empty');

    /*
      The assertion that used to read "never" now reads "not before the user asked for it". With no
      selections there is no verse anybody chose, so any Arabic on screen would be text NoorLife put
      there — which is precisely what the removed fixture did.
    */
    expect(ARABIC.test(JSON.stringify(view.toJSON()))).toBe(false);
  });

  it('carries the required attribution and a way to read the fuller record', async () => {
    const view = await renderDuas();

    const attribution = await view.findByTestId('faith-duas-attribution');
    expect(String(attribution.props.accessibilityLabel)).toMatch(/where this content comes from/i);
    expect(view.getByText(/Quran text and translations provided by Quran Foundation/)).toBeTruthy();
  });
});
