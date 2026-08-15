import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  configure,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react-native';
import React from 'react';
import { Share } from 'react-native';

import { seedTranslationPreference } from '@/test-support/faith-preferences-fixtures';
import { READER_RECITATIONS, renderReader } from '@/test-support/faith-reader';
import { warmUpFirstMount } from '@/test-support/mock-latency-timers';

import { mockPlaylist, mockRouter, setRouteParams } from '../../../../jest.setup';

import {
  PREVIOUS_ACTIVE_AYAH_SURFACE,
  moduleNeutrals,
  readerAyahColors,
} from '@features/modules/module-tokens';

import { AYAH_ACTION_KEYS, dismissesOnRelease } from '../components/reader/ayah-action-sheet';
import * as ayahFocus from '../components/reader/ayah-focus';
import { composeVerseShare, preservesScripture } from '../components/reader/verse-share';
import type { FaithAiQuestion } from '../data/faith-ai.repository';
import { createMockFaithRepositories } from '../data/mock';
import type { AyahText, AyahTranslation } from '../data/quran-content.repository';
import { FaithRepositoryProvider } from '../di/faith-repository-context';
import { faithAiHref } from '../faith-routes';
import { todayIsoDate } from '../hooks/use-reading-log';
import { readNotes } from '../storage/faith-notes';
import { readPlaylists } from '../storage/faith-playlists';
import { readOn, readReadingLog } from '../storage/faith-reading-log';
import { FaithAiScreen } from '../screens/faith-ai-screen';

/**
 * The reader's verse interaction, as the correction brief specifies it.
 *
 * Every case here is a requirement the previous build did not meet:
 *
 *   • the reciting wash was two percent of a luminance step away from the page, which is not a
 *     state a reader following a recitation can find;
 *   • it carried a vertical rule as well, and the deep-linked verse carried a second one;
 *   • every verse drew a bookmark glyph and an overflow glyph in its margin, 572 controls in
 *     Al-Baqarah, two of them duplicating an action the third also offered;
 *   • the citation read `1:1`, which beside a paragraph of Arabic could be a range, a page or a juz;
 *   • and there was nowhere to put a note, a playlist or a question, because a 24 dp margin has no
 *     room for them.
 *
 * Real timers, for the reason the sibling reader suites record: these screens become ready through
 * promise chains rather than through a timer, and the sheet's own entrance is an `Animated` value.
 */
configure({ asyncUtilTimeout: 3000 });
jest.setTimeout(20000);

warmUpFirstMount(() => renderReader({ recitations: READER_RECITATIONS }).then(({ view }) => view));

beforeEach(async () => {
  await AsyncStorage.clear();
  await seedTranslationPreference();
  mockPlaylist.reset();
  mockRouter.push.mockClear();
});

// ─────────────────────────────────────────────────────────────────────────────
// Colour
// ─────────────────────────────────────────────────────────────────────────────

/** WCAG relative luminance, from the sRGB definition rather than a perceptual approximation. */
function luminance(hex: string): number {
  const channel = (at: number): number => {
    const value = Number.parseInt(hex.replace('#', '').slice(at, at + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
}

function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

describe('the active ayah is a darker ground and nothing else', () => {
  it('is measurably darker than the wash it replaces', () => {
    /*
      The rejection was "too pale", which is a statement about luminance and is therefore
      checkable. The old wash sat at 0.914; a page of ivory is 0.94. There was almost nothing to
      see.
    */
    expect(luminance(readerAyahColors.active)).toBeLessThan(
      luminance(PREVIOUS_ACTIVE_AYAH_SURFACE),
    );
    // And the difference is a real step, not a rounding: at least a tenth of the scale.
    expect(
      luminance(PREVIOUS_ACTIVE_AYAH_SURFACE) - luminance(readerAyahColors.active),
    ).toBeGreaterThan(0.09);
  });

  it('keeps the scripture far above the 7:1 the brief requires, on all three grounds', () => {
    // The requirement is 7:1 — AAA for body text. Each ground clears it with room to spare, which
    // is what lets the Arabic keep its ordinary ink in every state instead of being restyled.
    for (const ground of Object.values(readerAyahColors)) {
      expect(contrast(moduleNeutrals.textPrimary, ground)).toBeGreaterThanOrEqual(7);
    }
  });

  it('separates the three states, so a paused player never claims to be reciting', () => {
    // Distinct values, and the reciting one is the darkest of them. A paused or merely selected
    // verse that shared the recitation's ground would be a false statement about the audio.
    const values = Object.values(readerAyahColors);
    expect(new Set(values).size).toBe(values.length);
    expect(luminance(readerAyahColors.active)).toBeLessThan(luminance(readerAyahColors.focused));
    expect(luminance(readerAyahColors.active)).toBeLessThan(luminance(readerAyahColors.selected));
  });

  it('draws the fill with no border, marker, rail or stripe of any kind', async () => {
    const { view } = await renderReader({ recitations: READER_RECITATIONS });
    await playAndReport(view, 1);

    const block = await view.findByTestId('faith-reader-ayah-active-1-1');
    const style = flatten(block.props.style);

    expect(style.backgroundColor).toBe(readerAyahColors.active);
    // The 3 dp dark-green bar down the leading edge is gone, and so is every relative of it.
    for (const banned of [
      'borderLeftWidth',
      'borderRightWidth',
      'borderTopWidth',
      'borderBottomWidth',
      'borderWidth',
    ]) {
      expect(style[banned] ?? 0).toBe(0);
    }
    expect(style.borderRadius).toBeGreaterThan(0);
    // Comfortable internal padding, as specified — the fill is a ground, not a hairline.
    expect(Number(style.paddingHorizontal ?? 0)).toBeGreaterThanOrEqual(8);
    expect(Number(style.paddingVertical ?? 0)).toBeGreaterThanOrEqual(8);
  });

  it('never tints the translation', async () => {
    const { view } = await renderReader({ recitations: READER_RECITATIONS });
    await playAndReport(view, 1);

    // Structural, not visual: the translation node is not a descendant of the tinted block, so it
    // cannot inherit the ground however the fill is later restyled.
    const block = await view.findByTestId('faith-reader-ayah-active-1-1');
    expect(within(block).queryByTestId('faith-reader-translation-1-1')).toBeNull();
    expect(within(block).getByTestId('faith-reader-arabic-1-1')).toBeTruthy();
  });
});

/** Style props as one object, since a React Native `style` may be an array of them. */
function flatten(style: unknown): Record<string, number | string | undefined> {
  const parts = Array.isArray(style) ? style.flat(Infinity) : [style];
  return Object.assign(
    {},
    ...parts.filter((part) => part !== null && typeof part === 'object'),
  ) as Record<string, number | string | undefined>;
}

/**
 * Types into a field and waits for the value to land before the caller presses anything.
 *
 * ── Why the wait is not optional ────────────────────────────────────────────
 * This project's Jest environment does not set `IS_REACT_ACT_ENVIRONMENT`, so `act` is a no-op and
 * React's scheduler flushes on a later tick rather than inside `fireEvent`. A press issued in the
 * same turn as the keystroke therefore runs against the *previous* state — which for a note editor
 * means saving an empty draft, and an empty draft is a delete. Waiting for the rendered value is
 * what makes the sequence the one a user performs.
 */
async function typeInto(view: typeof screen, testID: string, text: string): Promise<void> {
  fireEvent.changeText(await view.findByTestId(testID), text);
  await waitFor(() => expect(String(view.getByTestId(testID).props.value)).toBe(text));
}

/** Plays a verse and reports the platform playing it, which is what `active` means. */
async function playAndReport(view: typeof screen, ayah: number): Promise<void> {
  fireEvent.press(await view.findByTestId(`faith-reader-ayah-1-${ayah}`));
  fireEvent.press(await view.findByTestId('faith-reader-action-play'));
  await waitFor(() => expect(mockPlaylist.currentUri()).not.toBeNull());
  mockPlaylist.setStatus({ playing: true, isLoaded: true });
  await view.findByTestId(`faith-reader-ayah-active-1-${ayah}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// The margin
// ─────────────────────────────────────────────────────────────────────────────

describe('the ayah number reads as a citation', () => {
  it('names the verse as “Aya surah:ayah”, never as a bare pair of numbers', async () => {
    const { view } = await renderReader({ recitations: READER_RECITATIONS });

    expect(await view.findByText('Aya 1:1')).toBeTruthy();
    expect(view.getByText('Aya 1:2')).toBeTruthy();
    // The defect: a bare `1:1` beside a paragraph of Arabic is ambiguous in a way this is not.
    expect(view.queryByText('1:1')).toBeNull();
    expect(view.queryByText('1:2')).toBeNull();
  });

  it('uses the same form in another surah', async () => {
    // Al-Inshirah in the fixture carries verses 5 and 6, so the surah number in the citation is
    // genuinely varying rather than always the fixture's first.
    const { view } = await renderReader({ surah: '94' });

    expect(await view.findByText('Aya 94:5')).toBeTruthy();
    expect(view.getByText('Aya 94:6')).toBeTruthy();
    expect(view.queryByText('94:5')).toBeNull();
  });

  it('lets the pill size to its own text rather than clipping it', async () => {
    const { view } = await renderReader({ recitations: READER_RECITATIONS });
    const label = await view.findByText('Aya 1:1');

    // A fixed width is what truncated the longer references. No line cap either — a compact pill
    // that clips its own citation is worse than a pill a few points wider.
    expect(label.props.numberOfLines).toBeUndefined();
    expect(flatten(label.props.style).width).toBeUndefined();
  });

  it('announces the verse, and its bookmark and reading state, in words', async () => {
    const { view } = await renderReader({ recitations: READER_RECITATIONS });
    const pill = await view.findByTestId('faith-reader-ayah-number-1-1');

    expect(String(pill.props.accessibilityLabel)).toContain('Aya 1 verse 1');
    expect(pill.props.accessibilityRole).toBe('button');
    expect(String(pill.props.accessibilityHint)).toMatch(/actions for this aya/i);
  });
});

describe('there are no permanent action icons beside an ayah', () => {
  it('draws no inline bookmark control', async () => {
    const { view } = await renderReader({ recitations: READER_RECITATIONS });
    await view.findByTestId('faith-reader-ayah-1-1');

    expect(view.queryByTestId('faith-reader-bookmark-1-1')).toBeNull();
    expect(view.queryByTestId('faith-reader-bookmark-1-2')).toBeNull();
    // Nor an unlabelled one under a different id: nothing in the reading column mentions bookmarks
    // until a sheet is opened.
    expect(view.queryAllByLabelText(/bookmark/i)).toHaveLength(0);
  });

  it('draws no inline three-dot overflow', async () => {
    const { view } = await renderReader({ recitations: READER_RECITATIONS });
    await view.findByTestId('faith-reader-ayah-1-1');

    expect(view.queryByTestId('faith-reader-overflow-1-1')).toBeNull();
    expect(view.queryByTestId('faith-reader-overflow-1-2')).toBeNull();
    expect(view.queryAllByLabelText(/more actions/i)).toHaveLength(0);
  });

  it('drops the per-verse “save my place” link the sheet’s Read replaced', async () => {
    const { view } = await renderReader({ recitations: READER_RECITATIONS });
    await view.findByTestId('faith-reader-ayah-1-1');

    // One implementation of each action, which is the whole point of the sheet.
    expect(view.queryByTestId('faith-reader-save-1-1')).toBeNull();
    expect(view.queryByText('Save my place here')).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Opening the sheet
// ─────────────────────────────────────────────────────────────────────────────

describe('any part of an ayah opens its actions', () => {
  it('opens from the number pill', async () => {
    const { view } = await renderReader({ recitations: READER_RECITATIONS });
    fireEvent.press(await view.findByTestId('faith-reader-ayah-number-1-1'));

    const sheet = await view.findByTestId('faith-reader-ayah-actions');
    // The sheet names the verse it belongs to, in the same words the pill uses.
    expect(within(sheet).getByText('Aya 1:1')).toBeTruthy();
  });

  it('opens the same sheet from the Arabic', async () => {
    const { view } = await renderReader({ recitations: READER_RECITATIONS });
    fireEvent.press(await view.findByTestId('faith-reader-arabic-1-1'));

    const sheet = await view.findByTestId('faith-reader-ayah-actions');
    expect(within(sheet).getByTestId('faith-reader-action-play')).toBeTruthy();
  });

  it('opens the same sheet from the translation', async () => {
    const { view } = await renderReader({ recitations: READER_RECITATIONS });
    fireEvent.press(await view.findByTestId('faith-reader-translation-1-1'));

    const sheet = await view.findByTestId('faith-reader-ayah-actions');
    expect(within(sheet).getByTestId('faith-reader-action-play')).toBeTruthy();
  });

  it('names the selected aya and its surah in the sheet’s own title', async () => {
    const { view } = await renderReader({ recitations: READER_RECITATIONS });
    fireEvent.press(await view.findByTestId('faith-reader-ayah-1-2'));

    const sheet = await view.findByTestId('faith-reader-ayah-actions');
    expect(within(sheet).getByText('Aya 1:2')).toBeTruthy();
    expect(within(sheet).getByText('Al-Fatihah')).toBeTruthy();
  });

  it('marks the selected aya behind the overlay, without claiming it is being recited', async () => {
    const { view } = await renderReader({ recitations: READER_RECITATIONS });
    fireEvent.press(await view.findByTestId('faith-reader-ayah-1-2'));

    const marked = await view.findByTestId('faith-reader-ayah-selected-1-2');
    expect(flatten(marked.props.style).backgroundColor).toBe(readerAyahColors.selected);
    // Selected is not active. Nothing is playing, and the reader does not pretend otherwise.
    expect(view.queryByTestId('faith-reader-ayah-active-1-2')).toBeNull();
  });
});

describe('the sheet offers exactly the seven approved actions', () => {
  it('shows them in the specified order, and nothing else', async () => {
    const { view } = await renderReader({ recitations: READER_RECITATIONS });
    fireEvent.press(await view.findByTestId('faith-reader-ayah-1-1'));
    await view.findByTestId('faith-reader-ayah-actions');

    const rendered = view
      .getAllByTestId(/^faith-reader-action-/)
      .map((node) => String(node.props.testID));

    expect(rendered).toEqual(AYAH_ACTION_KEYS.map((key) => `faith-reader-action-${key}`));
  });

  it('carries Learn and Memorize nowhere, because neither has an implementation', async () => {
    const { view } = await renderReader({ recitations: READER_RECITATIONS });
    fireEvent.press(await view.findByTestId('faith-reader-ayah-1-1'));
    await view.findByTestId('faith-reader-ayah-actions');

    expect(view.queryByText(/^Learn$/)).toBeNull();
    expect(view.queryByText(/^Memorize$/)).toBeNull();
  });

  it('gives every row a label, a hit target and a visible pressed state', async () => {
    const { view } = await renderReader({ recitations: READER_RECITATIONS });
    fireEvent.press(await view.findByTestId('faith-reader-ayah-1-1'));
    await view.findByTestId('faith-reader-ayah-actions');

    for (const key of AYAH_ACTION_KEYS) {
      const row = view.getByTestId(`faith-reader-action-${key}`);
      expect(row.props.accessibilityRole).toBe('button');
      expect(String(row.props.accessibilityLabel).length).toBeGreaterThan(3);
      // 48 dp, above the 44 dp both platforms require.
      expect(Number(flatten(row.props.style).minHeight)).toBeGreaterThanOrEqual(48);
    }
  });

  it('shows a pressed state, and returns to rest when the finger lifts', async () => {
    const { view } = await renderReader({ recitations: READER_RECITATIONS });
    fireEvent.press(await view.findByTestId('faith-reader-ayah-1-1'));
    await view.findByTestId('faith-reader-ayah-actions');

    // One row is enough: they are all the same component, and pressing all seven in sequence spends
    // the suite's time budget proving that a shared implementation is shared.
    const row = () => view.getByTestId('faith-reader-action-bookmark');
    const resting = flatten(row().props.style).backgroundColor;

    fireEvent(row(), 'pressIn');
    await waitFor(() => expect(flatten(row().props.style).backgroundColor).not.toBe(resting));

    fireEvent(row(), 'pressOut');
    await waitFor(() => expect(flatten(row().props.style).backgroundColor).toBe(resting));
  });

  it('scrolls, so a large font scale cannot hide the last actions', async () => {
    const { view } = await renderReader({ recitations: READER_RECITATIONS });
    fireEvent.press(await view.findByTestId('faith-reader-ayah-1-1'));

    expect(await view.findByTestId('faith-reader-sheet-scroll')).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Closing it
// ─────────────────────────────────────────────────────────────────────────────

describe('the sheet closes the four ways it must', () => {
  it('closes on a tap outside it', async () => {
    const { view } = await renderReader({ recitations: READER_RECITATIONS });
    fireEvent.press(await view.findByTestId('faith-reader-ayah-1-1'));
    await view.findByTestId('faith-reader-ayah-actions');

    fireEvent.press(view.getByTestId('faith-reader-ayah-actions-scrim'));
    await waitFor(() => expect(view.queryByTestId('faith-reader-ayah-actions')).toBeNull());
  });

  it('closes on Android Back', async () => {
    const { view } = await renderReader({ recitations: READER_RECITATIONS });
    fireEvent.press(await view.findByTestId('faith-reader-ayah-1-1'));
    const modal = await view.findByTestId('faith-reader-ayah-actions-modal');

    // The hardware button reaches a `Modal` as `onRequestClose` and nothing else, so this is the
    // gesture rather than a stand-in for it.
    fireEvent(modal, 'requestClose');
    await waitFor(() => expect(view.queryByTestId('faith-reader-ayah-actions')).toBeNull());
  });

  it('closes on its own close button', async () => {
    const { view } = await renderReader({ recitations: READER_RECITATIONS });
    fireEvent.press(await view.findByTestId('faith-reader-ayah-1-1'));
    await view.findByTestId('faith-reader-ayah-actions');

    fireEvent.press(view.getByTestId('faith-reader-sheet-close'));
    await waitFor(() => expect(view.queryByTestId('faith-reader-ayah-actions')).toBeNull());
  });

  it('closes on a downward swipe', async () => {
    /*
      Two halves, because a synthetic `PanResponder` gesture would only assert the test's own
      arithmetic — `gestureState` is computed from the platform's touch history, which Jest has
      none of. So: the header really does carry a drag responder, and the rule that responder
      applies on release really does dismiss on both a long drag and a short flick.
    */
    const { view } = await renderReader({ recitations: READER_RECITATIONS });
    fireEvent.press(await view.findByTestId('faith-reader-ayah-1-1'));
    const sheet = await view.findByTestId('faith-reader-ayah-actions');

    expect(findPanHandlers(sheet).onResponderRelease).toBeInstanceOf(Function);

    expect(dismissesOnRelease({ dy: 140, vy: 0.1 })).toBe(true);
    expect(dismissesOnRelease({ dy: 20, vy: 1.2 })).toBe(true);
    // A small settle, and an upward flick, both spring back rather than dismissing.
    expect(dismissesOnRelease({ dy: 12, vy: 0.2 })).toBe(false);
    expect(dismissesOnRelease({ dy: -80, vy: -1.5 })).toBe(false);
  });

  it('returns the screen reader to the aya it was opened from', async () => {
    /*
      Without this TalkBack falls back to the top of the screen, so dismissing the sheet on verse
      210 puts the user back at the surah header with two hundred verses to swipe through.
    */
    const focus = jest.fn(() => true);
    const spy = jest
      .spyOn(ayahFocus, 'createAyahFocusRegistry')
      .mockReturnValue({ register: jest.fn(), focus });

    try {
      const { view } = await renderReader({ recitations: READER_RECITATIONS });
      fireEvent.press(await view.findByTestId('faith-reader-ayah-1-2'));
      await view.findByTestId('faith-reader-ayah-actions');

      fireEvent.press(view.getByTestId('faith-reader-sheet-close'));
      await waitFor(() => expect(focus).toHaveBeenCalledWith(2));
    } finally {
      spy.mockRestore();
    }
  });
});

/** The header's pan handlers, wherever in the sheet's subtree they were attached. */
function findPanHandlers(node: {
  readonly props: Record<string, unknown>;
  readonly children: readonly unknown[];
}): Record<string, ((event: unknown, gesture: unknown) => void) | undefined> {
  if (typeof node.props.onResponderRelease === 'function') {
    return node.props as never;
  }
  for (const child of node.children) {
    if (typeof child === 'object' && child !== null && 'props' in child) {
      const found = findPanHandlers(child as never);
      if (found.onResponderRelease !== undefined) {
        return found;
      }
    }
  }
  return {};
}

// ─────────────────────────────────────────────────────────────────────────────
// The actions themselves
// ─────────────────────────────────────────────────────────────────────────────

describe('Play', () => {
  it('points the one global player at the selected aya and starts it', async () => {
    const { view } = await renderReader({ recitations: READER_RECITATIONS });
    fireEvent.press(await view.findByTestId('faith-reader-ayah-1-2'));
    fireEvent.press(await view.findByTestId('faith-reader-action-play'));

    await waitFor(() => expect(mockPlaylist.currentUri()).toContain('s1-a2'));
    // The label, the audio and the highlight are three views of one selection.
    await waitFor(() =>
      expect(String(view.getByTestId('faith-reader-player-title').props.children)).toContain(
        'Aya 2',
      ),
    );
    // And the sheet gets out of the way, because the thing it was opened for has happened.
    await waitFor(() => expect(view.queryByTestId('faith-reader-ayah-actions')).toBeNull());
  });

  it('creates no second player, whatever the sheet is doing', async () => {
    const { view } = await renderReader({ recitations: READER_RECITATIONS });
    await view.findByTestId('faith-reader-player');
    expect(view.getAllByTestId('faith-reader-player')).toHaveLength(1);

    fireEvent.press(await view.findByTestId('faith-reader-ayah-1-1'));
    await view.findByTestId('faith-reader-ayah-actions');
    expect(view.getAllByTestId('faith-reader-player')).toHaveLength(1);

    fireEvent.press(view.getByTestId('faith-reader-action-play'));
    await waitFor(() => expect(mockPlaylist.currentUri()).not.toBeNull());
    expect(view.getAllByTestId('faith-reader-player')).toHaveLength(1);
  });

  it('does not autoplay merely because the sheet opened', async () => {
    const { view } = await renderReader({ recitations: READER_RECITATIONS });
    fireEvent.press(await view.findByTestId('faith-reader-ayah-1-1'));
    await view.findByTestId('faith-reader-ayah-actions');

    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(mockPlaylist.currentUri()).toBeNull();
    expect(mockPlaylist.played()).toBe(false);
  });
});

describe('Read', () => {
  it('records the aya once, however many times it is pressed', async () => {
    const { view } = await renderReader({ recitations: READER_RECITATIONS });
    fireEvent.press(await view.findByTestId('faith-reader-ayah-1-2'));
    fireEvent.press(await view.findByTestId('faith-reader-action-read'));
    await view.findByTestId('faith-reader-success');

    await waitFor(async () => expect((await readReadingLog()).furthest['1']).toBe(2));
    expect(readOn(await readReadingLog(), todayIsoDate())).toBe(2);

    // Pressed again on the same verse. `applyReading` returns `added: 0`, so nothing is written and
    // the day's count cannot be inflated by repetition.
    fireEvent.press(view.getByTestId('faith-reader-action-read'));
    await waitFor(() =>
      expect(String(view.getByTestId('faith-reader-success').props.accessibilityLabel)).toMatch(
        /already recorded as read/i,
      ),
    );
    expect(readOn(await readReadingLog(), todayIsoDate())).toBe(2);
  });

  it('records nothing from opening the sheet', async () => {
    const { view } = await renderReader({ recitations: READER_RECITATIONS });
    fireEvent.press(await view.findByTestId('faith-reader-ayah-1-2'));
    await view.findByTestId('faith-reader-ayah-actions');
    await new Promise((resolve) => setTimeout(resolve, 60));

    // The whole reason "selected" is a state of its own: looking at a verse is not reading it.
    expect(readOn(await readReadingLog(), todayIsoDate())).toBe(0);
  });
});

describe('Bookmark', () => {
  it('toggles, persists, and renames itself to Remove bookmark', async () => {
    const { view } = await renderReader({ recitations: READER_RECITATIONS });
    fireEvent.press(await view.findByTestId('faith-reader-ayah-1-2'));
    fireEvent.press(await view.findByTestId('faith-reader-action-bookmark'));

    await waitFor(() => expect(view.getByText('Remove bookmark')).toBeTruthy());
    const stored = JSON.parse(
      (await AsyncStorage.getItem('noorlife.faith.bookmarks')) as string,
    ) as { kind: string; id: string; label: string }[];
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ kind: 'ayah', id: '1:2' });
    // The surah's name travels with it, so the Bookmarks screen can cite it without a lookup.
    expect(stored[0]?.label).toContain('Al-Fatihah');

    fireEvent.press(view.getByTestId('faith-reader-action-bookmark'));
    await waitFor(() => expect(view.getByText('Bookmark')).toBeTruthy());
    expect(
      JSON.parse((await AsyncStorage.getItem('noorlife.faith.bookmarks')) as string),
    ).toHaveLength(0);
  });
});

describe('Add note', () => {
  it('creates, edits and deletes against the verse rather than a list position', async () => {
    const { view } = await renderReader({ recitations: READER_RECITATIONS });
    fireEvent.press(await view.findByTestId('faith-reader-ayah-1-2'));
    fireEvent.press(await view.findByTestId('faith-reader-action-note'));

    await typeInto(view, 'faith-reader-note-input', 'Read this at Fajr.');
    fireEvent.press(view.getByTestId('faith-reader-note-save'));

    await waitFor(async () => expect(await readNotes()).toHaveLength(1));
    // The identity is the verse. An index would silently re-attach this to a different ayah the
    // moment the reader loaded a second page.
    expect((await readNotes())[0]).toMatchObject({ surah: 1, ayah: 2, text: 'Read this at Fajr.' });

    // Edit.
    fireEvent.press(await view.findByTestId('faith-reader-action-note'));
    await typeInto(view, 'faith-reader-note-input', 'Read this at Isha.');
    fireEvent.press(view.getByTestId('faith-reader-note-save'));
    await waitFor(async () => expect((await readNotes())[0]?.text).toBe('Read this at Isha.'));
    expect(await readNotes()).toHaveLength(1);

    // Delete.
    fireEvent.press(await view.findByTestId('faith-reader-action-note'));
    fireEvent.press(await view.findByTestId('faith-reader-note-delete'));
    await waitFor(async () => expect(await readNotes()).toHaveLength(0));
  });

  it('keeps one verse’s note off another verse', async () => {
    const { view } = await renderReader({ recitations: READER_RECITATIONS });
    fireEvent.press(await view.findByTestId('faith-reader-ayah-1-1'));
    fireEvent.press(await view.findByTestId('faith-reader-action-note'));
    await typeInto(view, 'faith-reader-note-input', 'On the first verse.');
    fireEvent.press(view.getByTestId('faith-reader-note-save'));
    await waitFor(async () => expect(await readNotes()).toHaveLength(1));

    fireEvent.press(view.getByTestId('faith-reader-sheet-close'));
    await waitFor(() => expect(view.queryByTestId('faith-reader-ayah-actions')).toBeNull());

    fireEvent.press(await view.findByTestId('faith-reader-ayah-1-2'));
    fireEvent.press(await view.findByTestId('faith-reader-action-note'));
    const input = await view.findByTestId('faith-reader-note-input');
    await waitFor(() => expect(String(input.props.value)).toBe(''));
  });
});

describe('Add to playlist', () => {
  it('creates a playlist, stores the verse and the reciter, and refuses a duplicate', async () => {
    const { view } = await renderReader({ recitations: READER_RECITATIONS });
    fireEvent.press(await view.findByTestId('faith-reader-ayah-1-2'));
    fireEvent.press(await view.findByTestId('faith-reader-action-playlist'));

    await typeInto(view, 'faith-reader-playlist-name', 'Morning');
    fireEvent.press(view.getByTestId('faith-reader-playlist-create'));

    await waitFor(async () => expect(await readPlaylists()).toHaveLength(1));
    const [playlist] = await readPlaylists();
    expect(playlist?.name).toBe('Morning');
    // A reference and the reciter it was chosen under. No URL, no host, no audio.
    expect(playlist?.entries).toHaveLength(1);
    expect(playlist?.entries[0]).toMatchObject({ surah: 1, ayah: 2, reciterId: '3' });
    expect(Object.keys(playlist?.entries[0] ?? {})).not.toContain('url');

    // Adding it again writes nothing and says so, rather than appending it twice or silently
    // doing nothing — the third outcome the storage layer exists to report.
    fireEvent.press(view.getByTestId(`faith-reader-playlist-${playlist?.id}`));
    await waitFor(() =>
      expect(String(view.getByTestId('faith-reader-playlist-status').props.children)).toMatch(
        /already in Morning/i,
      ),
    );
    expect((await readPlaylists())[0]?.entries).toHaveLength(1);
  });
});

describe('Ask Noor AI', () => {
  it('opens Noor AI with the verse as a route reference, never as a copy of the text', async () => {
    const { view } = await renderReader({ recitations: READER_RECITATIONS });
    fireEvent.press(await view.findByTestId('faith-reader-ayah-1-2'));
    fireEvent.press(await view.findByTestId('faith-reader-action-ask-noor-ai'));

    expect(mockRouter.push).toHaveBeenCalledWith(faithAiHref(1, 2));
    // A pair of integers. Nothing that could carry, corrupt or become an unattributed verse.
    const href = mockRouter.push.mock.calls[0]?.[0] as { params: Record<string, string> };
    expect(href.params).toEqual({ surah: '1', ayah: '2' });
  });

  it('resolves the aya through the approved content boundary and shows it attributed', async () => {
    const mocks = createMockFaithRepositories();
    const listAyahs = jest.fn(mocks.quran.listAyahs);
    setRouteParams({ surah: '1', ayah: '2' });

    await render(
      <FaithRepositoryProvider repositories={{ ...mocks, quran: { ...mocks.quran, listAyahs } }}>
        <FaithAiScreen />
      </FaithRepositoryProvider>,
    );

    expect(await screen.findByTestId('faith-ai-verse-context')).toBeTruthy();
    expect(screen.getByTestId('faith-ai-verse-context-title').props.children).toBe('Aya 1:2');
    // The Arabic on screen came from the repository, which is the only source that attaches a
    // `ContentSource` to what it returns.
    expect(listAyahs).toHaveBeenCalled();
    expect(await screen.findByTestId('faith-ai-verse-context-arabic')).toBeTruthy();
    expect(await screen.findByTestId('faith-ai-verse-context-translation')).toBeTruthy();
    expect(screen.getByText(/Translated by/)).toBeTruthy();
  });

  it('passes the verse to the assistant as structured context, not inside the question', async () => {
    const mocks = createMockFaithRepositories();
    const asked: FaithAiQuestion[] = [];
    setRouteParams({ surah: '1', ayah: '2' });

    await render(
      <FaithRepositoryProvider
        repositories={{
          ...mocks,
          ai: {
            ...mocks.ai,
            ask: async (question) => {
              asked.push(question);
              return mocks.ai.ask(question);
            },
          },
        }}
      >
        <FaithAiScreen />
      </FaithRepositoryProvider>,
    );

    await typeInto(screen, 'faith-ai-input', 'What does this mean?');
    fireEvent.press(screen.getByTestId('faith-ai-send'));

    await waitFor(() => expect(asked).toHaveLength(1));
    expect(asked[0]?.context).toEqual({ kind: 'ayah', surah: 1, ayah: 2 });
    // The scripture is not in the question. It is fetched, once, from the repository.
    expect(asked[0]?.text).toBe('What does this mean?');
  });
});

describe('Share', () => {
  const ARABIC = 'بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ';

  const TEXT = {
    surah: 1,
    ayah: 1,
    arabic: ARABIC,
    source: { name: 'Quran Foundation Content API', verified: true },
  } as unknown as AyahText;

  const TRANSLATION = {
    surah: 1,
    ayah: 1,
    translationId: 'en.sahih',
    text: 'In the name of Allah, the Entirely Merciful, the Especially Merciful.',
    source: {
      name: 'Quran Foundation Content API',
      verified: true,
      attribution: 'Saheeh International',
      edition: 'Saheeh International',
    },
  } as unknown as AyahTranslation;

  it('carries the scripture unchanged, the translation, the citation and the attribution', () => {
    const message = composeVerseShare({
      surahName: 'Al-Fatihah',
      text: TEXT,
      translation: TRANSLATION,
    });

    // Byte for byte. This is the last point the Arabic passes through before it leaves the app.
    expect(preservesScripture(message, TEXT)).toBe(true);
    expect(message).toContain(TRANSLATION.text);
    expect(message).toContain('Al-Fatihah 1:1');
    expect(message).toContain('Saheeh International');
    expect(message).toContain('Quran Foundation Content API');
  });

  it('adds no commentary of its own', () => {
    const message = composeVerseShare({
      surahName: 'Al-Fatihah',
      text: TEXT,
      translation: TRANSLATION,
    });

    /*
      Every line is either the verse, its translation, its citation, an attribution, or the app's
      own one-line credit. There is no explanation, no summary and no generated gloss — and no
      parameter through which one could be supplied.
    */
    const lines = message.split('\n').filter((line) => line.trim() !== '');
    expect(lines).toEqual([
      ARABIC,
      TRANSLATION.text,
      'Al-Fatihah 1:1',
      'Translation: Saheeh International — Saheeh International',
      'Qur’an text from Quran Foundation Content API',
      'Shared from NoorLife',
    ]);
  });

  it('ships the Arabic alone rather than an unattributed rendering', () => {
    const message = composeVerseShare({ surahName: 'Al-Fatihah', text: TEXT, translation: null });

    expect(preservesScripture(message, TEXT)).toBe(true);
    expect(message).not.toContain('Translation:');
  });

  it('opens the platform’s share sheet with that message', async () => {
    const share = jest
      .spyOn(Share, 'share')
      .mockResolvedValue({ action: Share.sharedAction, activityType: null });

    try {
      const { view } = await renderReader({ recitations: READER_RECITATIONS });
      fireEvent.press(await view.findByTestId('faith-reader-ayah-1-1'));
      fireEvent.press(await view.findByTestId('faith-reader-action-share'));

      await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
      const message = String((share.mock.calls[0]?.[0] as { message: string }).message);
      expect(message).toContain('Al-Fatihah 1:1');
      expect(message).toMatch(/Translation:/);
    } finally {
      share.mockRestore();
    }
  });
});
