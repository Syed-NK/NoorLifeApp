import AsyncStorage from '@react-native-async-storage/async-storage';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';

import { warmUpFirstMount } from '@/test-support/mock-latency-timers';

import { createMockFaithRepositories } from '../data/mock';
import type { RetainedQuran, RetainedQuranSource } from '../data/offline/retained-quran.source';
import { createLocalTasbihRepository } from '../data/tasbih/local-tasbih.repository';
import { FaithRepositoryProvider } from '../di/faith-repository-context';
import { QuranSelectionScreen } from '../screens/quran-selection-screen';
import { TasbihScreen } from '../screens/tasbih-screen';
import { readQuranSelections, saveQuranSelection } from '../storage/faith-quran-selections';
import { setActiveFaithScope } from '../storage/faith-user-scope';
import { TEST_FAITH_USER_ID } from '@/test-support/faith-storage-address';

/**
 * **The visible half: choosing a verse, previewing it, and counting it.**
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── Why the fixture's Arabic is not Qur'anic ───────────────────────────────
 * Every string below is synthetic Arabic-script text with a Latin marker in it. That is deliberate
 * and it is the same rule the rest of this module follows: a test fixture is exactly where
 * unverified religious content survives a deletion, and there is no property asserted here that
 * needs the text to be scripture. What is under test is that *whatever the generation holds* is
 * rendered unchanged, matched to the right verse key, and credited — and a probe proves all three
 * more clearly than a real ayah would, because a probe cannot be mistaken for something the app is
 * entitled to ship.
 *
 * ── Why the retained source is a double and the repositories are not ───────
 * The generation is a validated 6,236-row dataset on disk. Building one in Jest would test the
 * storage layer, which has its own suites; what these cases need is a device that *has* content, so
 * the seam is replaced and everything above it is the real thing — the real resolver, the real
 * storage, the real counter.
 *
 * The double also proves the offline claim by construction: it has no network, so a screen that
 * renders from it cannot have fetched anything.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const ARABIC = {
  '2:1': 'ألف-probe-١',
  '2:2': 'باء-probe-٢',
  '2:3': 'جيم-probe-٣',
  '112:1': 'دال-probe-١',
} as const;

const TRANSLATION = {
  '2:1': 'a rendering of the meaning, one',
  '2:2': 'a rendering of the meaning, two',
  '2:3': 'a rendering of the meaning, three',
} as const;

const TRANSLATOR = 'A Named Translator';
const EDITION = 'A Named Edition';

function retainedDouble(): RetainedQuranSource {
  const arabicBySurah = new Map<number, readonly { ayah: number; text: string }[]>([
    [
      2,
      [
        { ayah: 1, text: ARABIC['2:1'] },
        { ayah: 2, text: ARABIC['2:2'] },
        { ayah: 3, text: ARABIC['2:3'] },
      ],
    ],
    [112, [{ ayah: 1, text: ARABIC['112:1'] }]],
  ]);
  const translationBySurah = new Map<number, readonly { ayah: number; text: string }[]>([
    [
      2,
      [
        { ayah: 1, text: TRANSLATION['2:1'] },
        { ayah: 2, text: TRANSLATION['2:2'] },
        { ayah: 3, text: TRANSLATION['2:3'] },
      ],
    ],
  ]);

  const content: RetainedQuran = {
    generationId: 'test-generation',
    arabic: {
      generationId: 'test-generation',
      script: 'text_uthmani',
      lastCheckedAt: 0,
      source: { name: 'Quran Foundation', edition: 'Uthmani', verified: true },
      bySurah: arabicBySurah,
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
      bySurah: translationBySurah,
    },
  };

  return { read: async () => content };
}

/** A device that has retained nothing — the state before the Qur'an has downloaded. */
function emptyRetained(): RetainedQuranSource {
  return { read: async () => null };
}

function withRepositories(node: React.ReactElement, retainedQuran: RetainedQuranSource) {
  return (
    <FaithRepositoryProvider repositories={{ ...createMockFaithRepositories(), retainedQuran }}>
      {node}
    </FaithRepositoryProvider>
  );
}

async function renderSelection(retained = retainedDouble()): Promise<typeof screen> {
  await render(withRepositories(<QuranSelectionScreen />, retained));
  return screen;
}

async function renderTasbih(retained = retainedDouble()): Promise<typeof screen> {
  await render(withRepositories(<TasbihScreen />, retained));
  return screen;
}

warmUpFirstMount(() => renderSelection());

beforeEach(async () => {
  await AsyncStorage.clear();
  setActiveFaithScope(TEST_FAITH_USER_ID);
});

afterEach(async () => {
  await cleanup();
});

describe('browsing to a verse', () => {
  it('lists the surahs the device holds, by number, when no chapter names are cached', async () => {
    const view = await renderSelection();

    /*
      The metadata cache has its own one-week licence window and is empty here. The browser still
      works from the retained generation, which is the offline property that matters — numbers and
      verse counts, and no invented names.
    */
    expect(await view.findByTestId('faith-quran-selection-surah-2')).toBeTruthy();
    expect(view.getByTestId('faith-quran-selection-surah-112')).toBeTruthy();
  });

  it('offers a typed reference as its own destination', async () => {
    const view = await renderSelection();

    fireEvent.changeText(await view.findByTestId('faith-quran-selection-search'), '2:2');
    const jump = await view.findByTestId('faith-quran-selection-jump');
    expect(String(jump.props.accessibilityLabel)).toContain('2:2');
  });

  it('previews the exact retained Arabic with its reference and translator', async () => {
    const view = await renderSelection();

    fireEvent.press(await view.findByTestId('faith-quran-selection-surah-2'));

    const arabic = await view.findByTestId('faith-quran-selection-preview-body-arabic-2:1');
    // Rendered byte for byte, from the generation, matched on the verse key it was asked for.
    expect(String(arabic.props.children)).toBe(ARABIC['2:1']);

    const translator = view.getByTestId('faith-quran-selection-preview-body-translator');
    expect(String(translator.props.children)).toContain(TRANSLATOR);
    expect(String(translator.props.children)).toContain(EDITION);

    const attribution = view.getByTestId('faith-quran-selection-preview-body-attribution');
    expect(String(attribution.props.children)).toContain('Quran Foundation');
  });

  it('extends the preview to the whole range when the last verse moves', async () => {
    const view = await renderSelection();
    fireEvent.press(await view.findByTestId('faith-quran-selection-surah-2'));
    await view.findByTestId('faith-quran-selection-preview-body-arabic-2:1');

    fireEvent.press(view.getByTestId('faith-quran-selection-end-up'));

    const second = await view.findByTestId('faith-quran-selection-preview-body-arabic-2:2');
    expect(String(second.props.children)).toBe(ARABIC['2:2']);
  });

  it('refuses a range past the end of the surah rather than previewing a hole', async () => {
    const view = await renderSelection();
    fireEvent.press(await view.findByTestId('faith-quran-selection-surah-112'));

    // Surah 112 holds one verse in this generation, so the stepper has nowhere to go.
    const up = await view.findByTestId('faith-quran-selection-end-up');
    expect(up.props.accessibilityState?.disabled).toBe(true);
  });

  it('says the Qur’an is not downloaded rather than spinning against a network', async () => {
    const view = await renderSelection(emptyRetained());

    fireEvent.changeText(await view.findByTestId('faith-quran-selection-search'), '2:1');
    fireEvent.press(await view.findByTestId('faith-quran-selection-jump'));

    await view.findByTestId('faith-quran-selection-preview-body-unavailable');
    expect(view.getByText(/not on this device yet/i)).toBeTruthy();
  });
});

describe('saving a selection', () => {
  it('writes the reference and no scripture at all', async () => {
    const view = await renderSelection();
    fireEvent.press(await view.findByTestId('faith-quran-selection-surah-2'));
    fireEvent.press(await view.findByTestId('faith-quran-selection-save'));

    await waitFor(async () => {
      expect(await readQuranSelections()).toHaveLength(1);
    });

    const stored = await readQuranSelections();
    expect(stored[0]?.id).toBe('q.2.1.1');
    /*
      The end-to-end form of the guarantee the storage suite proves in isolation: a real screen, real
      retained Arabic on screen, and not one Arabic codepoint in what was written.
    */
    expect(JSON.stringify(stored)).not.toMatch(/[؀-ۿ]/);
  });

  it('confirms the save on the control that made it', async () => {
    const view = await renderSelection();
    fireEvent.press(await view.findByTestId('faith-quran-selection-surah-2'));
    const save = await view.findByTestId('faith-quran-selection-save');
    fireEvent.press(save);

    await waitFor(() => {
      expect(String(view.getByTestId('faith-quran-selection-save').props.accessibilityLabel)).toBe(
        'Saved to your selections',
      );
    });
  });
});

describe('counting a selection', () => {
  it('shows the selection’s Arabic, reference and translator on the counter', async () => {
    await saveQuranSelection({ surah: 2, startAyah: 1, endAyah: 1 }, null);
    await createLocalTasbihRepository().startSession('q.2.1.1', { target: 33 });

    const view = await renderTasbih();

    const arabic = await view.findByTestId('faith-tasbih-selection-body-arabic-2:1');
    expect(String(arabic.props.children)).toBe(ARABIC['2:1']);

    const value = view.getByTestId('faith-tasbih-dhikr-value');
    expect(String(value.props.children)).toContain('2:1');

    const translator = view.getByTestId('faith-tasbih-selection-body-translator');
    expect(String(translator.props.children)).toContain(TRANSLATOR);

    // …and it is badged as the user's own, never as something NoorLife reviewed.
    expect(view.getByTestId('faith-tasbih-selection-origin')).toBeTruthy();
    expect(view.getByText('Your selection')).toBeTruthy();
    expect(String(view.getByTestId('faith-tasbih-counter-kind').props.children)).toBe('Selection');
  });

  it('keeps the honest empty state when nothing has been chosen', async () => {
    const view = await renderTasbih();

    const value = await view.findByTestId('faith-tasbih-dhikr-value');
    expect(String(value.props.children)).toBe('Not selected');
    // No scripture is drawn for a counter with nothing behind it, and none is invented to fill it.
    expect(view.queryByTestId('faith-tasbih-selection')).toBeNull();
    expect(JSON.stringify(view.toJSON())).not.toMatch(/[؀-ۿ]/);
  });

  it('still counts, and still says so, on a device holding no Arabic', async () => {
    await saveQuranSelection({ surah: 2, startAyah: 1, endAyah: 1 }, null);
    await createLocalTasbihRepository().startSession('q.2.1.1', { target: 33 });

    const view = await renderTasbih(emptyRetained());

    /*
      The reference is NoorLife's own and is shown whatever the device holds; the scripture is not
      invented to fill the gap. The counter is fully usable either way — losing the ability to count
      because a download has not finished would be the app punishing somebody for its housekeeping.
    */
    await view.findByTestId('faith-tasbih-selection-body-unavailable');
    expect(String(view.getByTestId('faith-tasbih-dhikr-value').props.children)).toContain('2:1');
    expect(view.getByTestId('faith-tasbih-count')).toBeTruthy();
  });
});
