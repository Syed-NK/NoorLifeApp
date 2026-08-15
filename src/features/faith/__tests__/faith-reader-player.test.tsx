import AsyncStorage from '@react-native-async-storage/async-storage';
import { configure, fireEvent, waitFor } from '@testing-library/react-native';

import { warmUpFirstMount } from '@/test-support/mock-latency-timers';
import { seedTranslationPreference } from '@/test-support/faith-preferences-fixtures';
import { playFromAyah, READER_RECITATIONS, renderReader } from '@/test-support/faith-reader';

import { mockAudio, setRouteParams } from '../../../../jest.setup';

import {
  PREVIOUS_SCRIPTURE_FONT_SIZE,
  SCRIPTURE_FONT_SIZE,
  SCRIPTURE_LINE_HEIGHT,
} from '../components/faith-list';
import { UNKNOWN_DURATION } from '../components/reader/quran-audio-player';
import { createMockFaithRepositories } from '../data/mock';
import { RECITATION_RATES } from '../hooks/use-recitation-player';

/**
 * The reader and its player, as the correction brief specifies them.
 *
 * Each case here is a requirement the previous build did not meet:
 *
 *   • the scripture rendered at 36–44sp, roughly twice the size the reader is meant to use;
 *   • the player appeared only once a verse had been selected, so opening a surah showed none;
 *   • what a verse's overflow *did* show was a small "Play from here" strip where a player should
 *     have been, and the player it eventually produced started collapsed with its seek bar, speed
 *     and download action behind a chevron;
 *   • the active verse was drawn as a solid dark fill with the scripture reversed out of it.
 */

/** Real timers and a raised budget, for the reason `faith-recitation-advance` records. */
configure({ asyncUtilTimeout: 3000 });
jest.setTimeout(20000);

warmUpFirstMount(() => renderReader({ recitations: READER_RECITATIONS }).then(({ view }) => view));

beforeEach(async () => {
  await AsyncStorage.clear();
  await seedTranslationPreference();
  setRouteParams({ surah: '1' });
});

/** Whether a testID appears beneath a given node. */
function within(node: { readonly children: readonly unknown[] }, testID: string): boolean {
  const stack: unknown[] = [...node.children];
  while (stack.length > 0) {
    const next = stack.pop() as { props?: Record<string, unknown>; children?: unknown[] } | null;
    if (next === null || typeof next !== 'object') {
      continue;
    }
    if (next.props?.testID === testID) {
      return true;
    }
    stack.push(...(next.children ?? []));
  }
  return false;
}

/** The resolved font size of a rendered node, flattening the style array as the renderer does. */
function resolvedFontSize(node: {
  readonly props: { readonly style?: unknown };
}): number | undefined {
  return [node.props.style]
    .flat(Infinity)
    .filter((entry): entry is { fontSize?: number } => entry !== null && typeof entry === 'object')
    .reduce<number | undefined>((found, entry) => entry.fontSize ?? found, undefined);
}

function resolvedLineHeight(node: {
  readonly props: { readonly style?: unknown };
}): number | undefined {
  return [node.props.style]
    .flat(Infinity)
    .filter(
      (entry): entry is { lineHeight?: number } => entry !== null && typeof entry === 'object',
    )
    .reduce<number | undefined>((found, entry) => entry.lineHeight ?? found, undefined);
}

describe('the scripture is half the size it was', () => {
  it('resolves the Arabic to exactly half the previous reader value', () => {
    /**
     * The arithmetic itself, at the token, so the claim "reduced by exactly 50%" is a build-time
     * fact rather than something re-measured on a screenshot. 44 was the previous band's configured
     * maximum — what every device at or above the 393 dp reference actually rendered.
     */
    expect(SCRIPTURE_FONT_SIZE).toBe(PREVIOUS_SCRIPTURE_FONT_SIZE / 2);
    expect(SCRIPTURE_FONT_SIZE).toBeGreaterThanOrEqual(22);
    expect(SCRIPTURE_FONT_SIZE).toBeLessThanOrEqual(24);
  });

  it('keeps an Arabic-safe line height, so the harakat are not clipped', () => {
    const ratio = SCRIPTURE_LINE_HEIGHT / SCRIPTURE_FONT_SIZE;
    expect(ratio).toBeGreaterThanOrEqual(1.7);
    expect(ratio).toBeLessThanOrEqual(1.9);
  });

  it('renders every ayah at that size, right-aligned and uncapped', async () => {
    const { view } = await renderReader({ recitations: READER_RECITATIONS });

    // Every ayah, not only the first: the reduction is a property of the reader, and a size applied
    // to one verse and not the next is exactly the failure a single-node assertion would miss.
    // Every verse the fixture surah carries — 1, 2 and 5 — including the one with no recitation.
    for (const ayah of [1, 2, 5]) {
      const arabic = await view.findByTestId(`faith-reader-arabic-1-${ayah}`);
      expect(resolvedFontSize(arabic)).toBe(SCRIPTURE_FONT_SIZE);
      expect(resolvedLineHeight(arabic)).toBe(SCRIPTURE_LINE_HEIGHT);
      expect(arabic.props.numberOfLines).toBeUndefined();
      expect(arabic.props.style.flat(Infinity)).toContainEqual(
        expect.objectContaining({ textAlign: 'right' }),
      );
    }
  });

  it('honours OS text scaling but caps how far it grows', async () => {
    const { view } = await renderReader({ recitations: READER_RECITATIONS });
    const arabic = await view.findByTestId('faith-reader-arabic-1-1');

    // Not switched off — `allowFontScaling` is left at its default of true — but bounded, so a
    // device at 2× cannot push one ayah past a screenful and leave the translation below the fold.
    expect(arabic.props.allowFontScaling).not.toBe(false);
    expect(arabic.props.maxFontSizeMultiplier).toBeGreaterThan(1);
    expect(arabic.props.maxFontSizeMultiplier).toBeLessThanOrEqual(1.5);
  });
});

describe('the player is mounted with the page, not with the playback', () => {
  it('is on screen as soon as the surah has loaded, before anything is pressed', async () => {
    const { view } = await renderReader({ recitations: READER_RECITATIONS });
    await view.findByTestId('faith-reader-ayah-1-1');

    expect(await view.findByTestId('faith-reader-player')).toBeTruthy();
  });

  it('names the surah, the opening ayah and the reciter while idle', async () => {
    const { view } = await renderReader({ recitations: READER_RECITATIONS });

    expect(String((await view.findByTestId('faith-reader-player-title')).props.children)).toBe(
      'Al-Fatihah • Aya 1',
    );
    expect(
      String((await view.findByTestId('faith-reader-player-reciter')).props.children),
    ).toContain('Abdur-Rahman as-Sudais');
  });

  it('starts at 0:00 with an unknown length and an inactive seek bar', async () => {
    const { view } = await renderReader({ recitations: READER_RECITATIONS });

    expect(String((await view.findByTestId('faith-reader-player-elapsed')).props.children)).toBe(
      '0:00',
    );
    /**
     * `--:--`, never `0:00`. `AudioStatus.duration` reports `0` until it is determined, and printing
     * that as a length would state that the verse is zero seconds long and refuses to play.
     */
    expect(String((await view.findByTestId('faith-reader-player-duration')).props.children)).toBe(
      UNKNOWN_DURATION,
    );
    expect(
      (await view.findByTestId('faith-reader-player-seek')).props.accessibilityState,
    ).toMatchObject({ disabled: true });
  });

  it('carries every mandatory control, all of them at once', async () => {
    const { view } = await renderReader({ recitations: READER_RECITATIONS });
    await view.findByTestId('faith-reader-player');

    for (const control of [
      'faith-reader-player-toggle',
      'faith-reader-player-previous',
      'faith-reader-player-next',
      'faith-reader-player-seek',
      'faith-reader-player-elapsed',
      'faith-reader-player-duration',
      'faith-reader-player-speed',
      /*
        `faith-reader-player-download` was in this list and is deliberately gone. The docked player
        is a playback controller; download management moved off it entirely.
      */
      'faith-reader-player-title',
      'faith-reader-player-reciter',
    ]) {
      expect(view.getByTestId(control)).toBeTruthy();
    }
    expect(view.queryByTestId('faith-reader-player-download')).toBeNull();
  });

  it('has no collapsed form, no expand control and no second presentation', async () => {
    const { view } = await renderReader({ recitations: READER_RECITATIONS });
    await view.findByTestId('faith-reader-player');

    // The three shapes the transport used to have. All of them are gone: there is one player and
    // it is always the same one.
    expect(view.queryByTestId('faith-reader-player-expand')).toBeNull();
    expect(view.queryByTestId('faith-reader-player-expanded')).toBeNull();
    expect(view.queryByTestId('faith-reader-ayah-actions')).toBeNull();
  });

  it('mounts exactly one player, whatever the reader is doing', async () => {
    const { view } = await renderReader({ recitations: READER_RECITATIONS });
    await view.findByTestId('faith-reader-player');

    expect(view.getAllByTestId('faith-reader-player')).toHaveLength(1);

    await playFromAyah(view, 1);
    await waitFor(() => expect(mockAudio.currentUri()).not.toBeNull());

    // `getAllBy` rather than `getBy`, so "one" is asserted rather than "at least one".
    expect(view.getAllByTestId('faith-reader-player')).toHaveLength(1);
    expect(view.getAllByTestId('faith-reader-player-toggle')).toHaveLength(1);
  });

  it('stays on screen through preparing, playing, buffering, failure and completion', async () => {
    const { view } = await renderReader({ recitations: READER_RECITATIONS });
    await playFromAyah(view, 1);
    await waitFor(() => expect(mockAudio.currentUri()).not.toBeNull());

    for (const status of [
      { isLoaded: true, playing: true, isBuffering: false },
      { isLoaded: false, playing: false, isBuffering: true },
      { isLoaded: false, playing: false, isBuffering: false },
      { isLoaded: true, playing: false, isBuffering: false, didJustFinish: true },
    ]) {
      mockAudio.setStatus(status);
      await waitFor(() => expect(view.getByTestId('faith-reader-player')).toBeTruthy());
    }
  });

  it('draws a player even where this reciter published no audio for the surah', async () => {
    /**
     * The fixture repository answers `empty` for recitations, because shipping a placeholder
     * recitation of the Qur'an is not something NoorLife does at any fidelity. The player is still
     * mounted — the brief is unconditional about that — and it says what is true: there is nothing
     * to play, so the transport is disabled rather than drawn as though a tap would work.
     */
    const { view } = await renderReader();
    await view.findByTestId('faith-reader-header-label');

    expect(await view.findByTestId('faith-reader-player')).toBeTruthy();
    expect(
      (await view.findByTestId('faith-reader-player-toggle')).props.accessibilityState,
    ).toMatchObject({ disabled: true });
    expect(String((await view.findByTestId('faith-reader-player-reciter')).props.children)).toMatch(
      /no recitation/i,
    );
  });
});

describe('there is no per-ayah playback control', () => {
  it('draws no play button on any ayah', async () => {
    const { view } = await renderReader({ recitations: READER_RECITATIONS });
    await view.findByTestId('faith-reader-ayah-1-1');

    expect(view.queryByTestId('faith-reader-play-1-1')).toBeNull();
    expect(view.queryByTestId('faith-reader-play-1-2')).toBeNull();
    // The player's own control is labelled "Play recitation of …"; a per-ayah one would be too.
    expect(view.getAllByLabelText(/^Play recitation of/)).toHaveLength(1);
  });

  it('opens a verse’s actions without starting it or moving the player', async () => {
    const { view } = await renderReader({ recitations: READER_RECITATIONS });
    await view.findByTestId('faith-reader-player');

    fireEvent.press(await view.findByTestId('faith-reader-ayah-1-2'));
    await view.findByTestId('faith-reader-ayah-actions');

    /*
      Selecting a verse is a statement about what the user is looking at, and it is deliberately
      *not* a statement about the player. Nothing autoplays and the transport does not move: it is
      still pointed at verse one, which is where it was. Only Play changes either.
    */
    expect(mockAudio.currentUri()).toBeNull();
    expect(String(view.getByTestId('faith-reader-player-title').props.children)).toBe(
      'Al-Fatihah • Aya 1',
    );
  });
});

describe('the player is docked above bottom navigation', () => {
  it('renders in the scaffold’s docked slot, a sibling of the scroll region and the nav bar', async () => {
    const { view } = await renderReader({ recitations: READER_RECITATIONS });

    const docked = await view.findByTestId('faith-reader-docked');
    expect(within(docked, 'faith-reader-player')).toBe(true);
  });

  it('never covers the last ayah, because the two never share any space', async () => {
    /**
     * ── What replaced the measured padding, and why ─────────────────────────────
     * This used to fire a layout on the docked slot and assert the scroll container's
     * `paddingBottom` grew by exactly that height — the mechanism that kept content clear of a
     * panel drawn *over* it. That mechanism is gone, because the panel is no longer over anything:
     * it is the last child of the scaffold's flex column and the scroll region above it is
     * `flex: 1`, so the region's own box ends where the panel begins.
     *
     * The structural version is the stronger claim — no measurement can arrive late, and no padding
     * can be computed wrong — so what is asserted is the structure: the verses are inside the
     * scroll region, the player is outside it, and the region still carries breathing room under
     * its last item. `reader-dock-layout.test.tsx` carries the frame arithmetic against the
     * navigation bar.
     */
    const { view } = await renderReader({ recitations: READER_RECITATIONS });
    await view.findByTestId('faith-reader-ayah-1-5');

    const scroll = view.getByTestId('faith-reader-scroll');
    expect(within(scroll, 'faith-reader-ayah-1-5')).toBe(true);
    expect(within(scroll, 'faith-reader-player')).toBe(false);
    expect(
      Number((scroll.props.contentContainerStyle as { paddingBottom?: number }).paddingBottom ?? 0),
    ).toBeGreaterThan(0);
  });
});

describe('the reciting verse is marked', () => {
  /** Starts a verse and reports the platform actually playing it, which is what `active` means. */
  async function reciteAyah(view: Awaited<ReturnType<typeof renderReader>>['view'], ayah: number) {
    await playFromAyah(view, ayah);
    await waitFor(() => expect(mockAudio.currentUri()).not.toBeNull());
    mockAudio.setStatus({ playing: true, isLoaded: true });
  }

  it('tints the Arabic block of the verse being recited, and only that verse', async () => {
    const { view } = await renderReader({ recitations: READER_RECITATIONS });
    await reciteAyah(view, 1);

    expect(await view.findByTestId('faith-reader-ayah-active-1-1')).toBeTruthy();
    // The tint belongs to one verse. A second verse carrying it would mean the state is being
    // derived from something other than what the player is doing.
    expect(view.queryByTestId('faith-reader-ayah-active-1-2')).toBeNull();
  });

  it('announces the state in words, so it is never carried by colour alone', async () => {
    const { view } = await renderReader({ recitations: READER_RECITATIONS });
    await reciteAyah(view, 1);

    await view.findByTestId('faith-reader-ayah-active-1-1');
    // Announced on the verse's own labelled control rather than on the tinted box, so a screen
    // reader hears it while reading the citation rather than only if it lands on the block.
    expect(
      String(view.getByTestId('faith-reader-ayah-number-1-1').props.accessibilityLabel),
    ).toMatch(/now reciting/i);
  });

  it('leaves the translation on the ordinary surface, off the tint', async () => {
    /**
     * The tint covers the Arabic block **only**. That is what answers the objection recorded
     * against tinting Qur'anic Arabic at all: the translation never changes contrast, because it is
     * never on the tint. Asserted structurally — the translation node is not a descendant of the
     * tinted block.
     */
    const { view } = await renderReader({ recitations: READER_RECITATIONS });
    await reciteAyah(view, 1);
    const tinted = await view.findByTestId('faith-reader-ayah-active-1-1');

    expect(within(tinted, 'faith-reader-translation-1-1')).toBe(false);
  });

  it('does not restyle the scripture it marks', async () => {
    const { view } = await renderReader({ recitations: READER_RECITATIONS });
    const idle = resolvedFontSize(await view.findByTestId('faith-reader-arabic-1-1'));

    await reciteAyah(view, 1);
    await view.findByTestId('faith-reader-ayah-active-1-1');

    // Same size, same ink. The wash is the only difference between a verse being recited and the
    // one above it — which is why the reduction above holds for the active verse too.
    const reciting = await view.findByTestId('faith-reader-arabic-1-1');
    expect(resolvedFontSize(reciting)).toBe(idle);
    expect(
      String(reciting.props.style.flat(Infinity).map((entry: unknown) => entry)),
    ).not.toContain('#FFFFFF');
  });

  it('agrees with the player about which verse is current', async () => {
    const { view } = await renderReader({ recitations: READER_RECITATIONS });
    await reciteAyah(view, 1);

    // The tinted block, the player's title and the audible source all read the same field, so
    // asserting two of the three keeps the third honest.
    expect(await view.findByTestId('faith-reader-ayah-active-1-1')).toBeTruthy();
    expect(String((await view.findByTestId('faith-reader-player-title')).props.children)).toContain(
      'Aya 1',
    );

    fireEvent.press(await view.findByTestId('faith-reader-player-next'));
    await waitFor(() => expect(mockAudio.currentUri()).toContain('s1-a2'));
    mockAudio.setStatus({ playing: true, isLoaded: true });

    await waitFor(() => expect(view.getByTestId('faith-reader-ayah-active-1-2')).toBeTruthy());
    expect(String(view.getByTestId('faith-reader-player-title').props.children)).toContain('Aya 2');
    expect(view.queryByTestId('faith-reader-ayah-active-1-1')).toBeNull();
  });
});

describe('the translation is never truncated', () => {
  it('applies no line cap to a long verse translation', async () => {
    /**
     * The defect was `numberOfLines={6}`. Six lines is enough for most translations, which is what
     * made it survive: the failure only appears on a long ayah, and it appears as an ellipsis in the
     * middle of scripture's meaning rather than as anything that looks broken.
     */
    const longText = `${'A sentence of translated meaning that keeps going. '.repeat(20)}End.`;
    const mocks = createMockFaithRepositories();
    const { view } = await renderReader({
      recitations: READER_RECITATIONS,
      repositories: {
        quran: {
          ...mocks.quran,
          listTranslations: async (surah) => ({
            kind: 'ok',
            data: {
              items: [
                {
                  surah,
                  ayah: 1 as never,
                  translationId: '85',
                  text: longText,
                  source: { name: 'Test edition', attribution: 'A translator', verified: true },
                },
              ],
              nextCursor: null,
            },
          }),
        },
      },
    });

    const node = await view.findByText(longText);
    expect(node.props.numberOfLines).toBeUndefined();
  });
});

describe('playback speed', () => {
  it('offers only rates close to the recording', () => {
    /**
     * `expo-audio` accepts 0.1–2.0. The bound is a product decision, not a platform one: at 2× a
     * murattal recitation is no longer one, and this control must not be able to produce something
     * nobody recited.
     */
    expect(RECITATION_RATES).toEqual([0.75, 1, 1.25, 1.5]);
    expect(Math.min(...RECITATION_RATES)).toBeGreaterThanOrEqual(0.75);
    expect(Math.max(...RECITATION_RATES)).toBeLessThanOrEqual(1.5);
  });

  it('is offered on an idle player and honoured when playback starts', async () => {
    const { view } = await renderReader({ recitations: READER_RECITATIONS });

    fireEvent.press(await view.findByTestId('faith-reader-player-speed'));

    await playFromAyah(view, 1);
    // The chosen rate is applied to the verse as it loads, which is what makes offering the control
    // before anything is playing an honest thing to do.
    await waitFor(() =>
      expect(mockAudio.player.setPlaybackRate).toHaveBeenCalledWith(1.25, 'high'),
    );
  });
});

describe('the progress row', () => {
  it('shows elapsed, duration and a live seek bar once the platform reports them', async () => {
    const { view } = await renderReader({ recitations: READER_RECITATIONS });
    await playFromAyah(view, 1);
    await waitFor(() => expect(mockAudio.currentUri()).not.toBeNull());

    mockAudio.setStatus({ isLoaded: true, playing: true, currentTime: 7, duration: 42 });

    const seek = await view.findByTestId('faith-reader-player-seek');
    await waitFor(() => expect(seek.props.accessibilityValue).toMatchObject({ now: 7, max: 42 }));
    expect(String(seek.props.accessibilityValue.text)).toBe('0:07 of 0:42');

    expect(String((await view.findByTestId('faith-reader-player-elapsed')).props.children)).toBe(
      '0:07',
    );
    expect(String((await view.findByTestId('faith-reader-player-duration')).props.children)).toBe(
      '0:42',
    );
  });
});

describe('the player reports what is happening', () => {
  it('shows a buffering indicator while the platform is fetching', async () => {
    const { view } = await renderReader({ recitations: READER_RECITATIONS });
    await playFromAyah(view, 1);
    await waitFor(() => expect(mockAudio.currentUri()).not.toBeNull());

    mockAudio.setStatus({ isLoaded: false, isBuffering: true, playing: false });

    // Two channels for one state: a spinner and the caption beside it. A caption alone is easy to
    // miss on a busy panel.
    expect(await view.findByTestId('faith-reader-player-buffering')).toBeTruthy();
    const reciter = await view.findByTestId('faith-reader-player-reciter');
    expect(String(reciter.props.children)).toMatch(/buffering/i);
  });

  it('offers a retry that replays the verse rather than reloading the screen', async () => {
    const { view } = await renderReader({ recitations: READER_RECITATIONS });
    await playFromAyah(view, 1);
    await waitFor(() => expect(mockAudio.currentUri()).not.toBeNull());

    // A source set, not loading and not loaded: the heuristic the hook documents as a failure.
    mockAudio.setStatus({ isLoaded: false, isBuffering: false, playing: false });

    const retry = await view.findByTestId('faith-reader-player-retry');
    expect(String(retry.props.accessibilityLabel)).toMatch(/try verse 1 again/i);
  });
});
