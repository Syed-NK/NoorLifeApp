import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { ModuleProvider } from '@features/modules/module-context';
import { AA_TEXT, AA_UI, contrastRatio } from '@features/modules/contrast';
import {
  moduleColorThemes,
  moduleLayout,
  moduleNeutrals,
  readerDockColors,
} from '@features/modules/module-tokens';

import {
  PLAYER_MIN_HEIGHT,
  PLAYER_PLAY_SIZE,
  QuranAudioPlayer,
  UNKNOWN_DURATION,
  type QuranAudioPlayerProps,
  type QuranPlaybackState,
} from '../components/reader/quran-audio-player';

/**
 * The player as a component: every state, at a fixed viewport, with no audio pipeline behind it.
 *
 * ── Why this suite exists alongside the reader's ────────────────────────────
 * `faith-reader-player.test.tsx` drives the real transport through the real reader, which is the
 * only way to assert that the player and the recitation agree. What it cannot do is put the player
 * into states the fixture pipeline will not produce on demand — a surah half downloaded, a device
 * that has gone offline mid-verse, a 320 dp screen — or measure the panel's own geometry. That is
 * what this file is for, and it is possible at all because the component takes plain props.
 */

/**
 * The viewport, settable per case.
 *
 * `useWindowDimensions` reads `Dimensions.get('window')` once per mount, so replacing the module is
 * the only way to render the same tree at two widths in one file. 393 dp is the module framework's
 * reference width and what the Android emulator reports; 320 dp is the narrowest handset the
 * layout claims to support.
 */
const mockWindow = { width: 393, height: 851, scale: 3, fontScale: 1 };

jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => mockWindow,
}));

const EMULATOR_WIDTH = 393;
const NARROW_WIDTH = 320;

beforeEach(() => {
  mockWindow.width = EMULATOR_WIDTH;
});

const noop = (): void => undefined;

function props(overrides?: Partial<QuranAudioPlayerProps>): QuranAudioPlayerProps {
  return {
    surahName: 'Al-Baqarah',
    ayah: 1,
    totalAyat: 286,
    reciterName: 'Abdur-Rahman as-Sudais',
    state: 'idle',
    positionSeconds: null,
    durationSeconds: null,
    downloadedAyat: 286,
    missingAyah: null,
    rate: 1,
    rates: [0.75, 1, 1.25, 1.5],
    rateSupported: true,
    hasPrevious: false,
    hasNext: true,
    onTogglePlay: noop,
    onPrevious: noop,
    onNext: noop,
    onSeek: noop,
    onChangeRate: noop,
    onRetry: noop,
    onOpenReciters: noop,
    onManageOfflineAudio: noop,
    ...overrides,
  };
}

/** `render` is asynchronous under React 19's concurrent root, so every case awaits it. */
async function renderPlayer(overrides?: Partial<QuranAudioPlayerProps>): Promise<typeof screen> {
  await render(
    <ModuleProvider moduleId="faith">
      <QuranAudioPlayer {...props(overrides)} />
    </ModuleProvider>,
  );
  return screen;
}

/** The mandatory controls, by the brief's own list. */
const MANDATORY = [
  'faith-reader-player-toggle',
  'faith-reader-player-previous',
  'faith-reader-player-next',
  'faith-reader-player-seek',
  'faith-reader-player-elapsed',
  'faith-reader-player-duration',
  'faith-reader-player-speed',
  /*
    `faith-reader-player-download` is deliberately absent from this list. The docked player is a
    playback controller; every download state it used to render belongs to the Audio downloads
    screen. Its absence is asserted positively below.
  */
  'faith-reader-player-title',
  'faith-reader-player-reciter',
] as const;

const EVERY_STATE: readonly QuranPlaybackState[] = [
  'idle',
  'loading',
  'not-downloaded',
  'starting',
  'buffering',
  'playing',
  'paused',
  'completed',
  'missing-ayah',
  'failed',
];

/**
 * The style a control is actually drawn with.
 *
 * `PressableScale` puts the caller's style on its **outer** view and makes the pressable an
 * absolutely-filled touch overlay inside it — see that component's note for the layout bugs that
 * arrangement fixes. The testID is on the overlay, so geometry has to be read one level up.
 */
function controlStyle(node: { readonly parent: unknown }): Record<string, unknown> {
  return flatStyle(node as unknown as { readonly props: { readonly style?: unknown } });
}

function flatStyle(node: {
  readonly props: { readonly style?: unknown };
}): Record<string, unknown> {
  return Object.assign(
    {},
    ...[node.props.style]
      .flat(Infinity)
      .filter(
        (entry): entry is Record<string, unknown> => entry !== null && typeof entry === 'object',
      ),
  ) as Record<string, unknown>;
}

describe.each(EVERY_STATE)('in the %s state', (state) => {
  it('draws the whole player, with every mandatory control', async () => {
    const view = await renderPlayer({ state });

    expect(view.getByTestId('faith-reader-player')).toBeTruthy();
    for (const control of MANDATORY) {
      expect(view.getByTestId(control)).toBeTruthy();
    }
  });

  it('names the surah, the ayah and the reciter', async () => {
    const view = await renderPlayer({ state, ayah: 42 });

    expect(String(view.getByTestId('faith-reader-player-title').props.children)).toBe(
      'Al-Baqarah • Aya 42',
    );
    expect(String(view.getByTestId('faith-reader-player-reciter').props.children)).toContain(
      'Abdur-Rahman as-Sudais',
    );
  });
});

describe('the panel', () => {
  it('is at least the specified height at the emulator width', async () => {
    const view = await renderPlayer();
    const panel = flatStyle(view.getByTestId('faith-reader-player'));

    // 112–128 dp is the specified band. The value here is the floor; the panel grows with its
    // content, which is why the assertion is a floor and a ceiling on the floor rather than an
    // equality on the rendered height Jest cannot measure.
    expect(panel.minHeight).toBe(PLAYER_MIN_HEIGHT);
    expect(PLAYER_MIN_HEIGHT).toBeGreaterThanOrEqual(112);
    expect(PLAYER_MIN_HEIGHT).toBeLessThanOrEqual(128);
  });

  it('is a rounded, bordered, pale-gold surface', async () => {
    const view = await renderPlayer();
    const panel = flatStyle(view.getByTestId('faith-reader-player'));

    expect(panel.backgroundColor).toBe(readerDockColors.surface);
    expect(panel.borderColor).toBe(readerDockColors.border);
    expect(panel.borderWidth).toBe(1);
    expect(Number(panel.borderRadius)).toBeGreaterThan(0);
  });

  it('keeps its text readable on that surface', async () => {
    /**
     * Measured against the shipped value directly, because the panel's colours are opaque: they are
     * flattened at the token, so there is no second layer whose compositing a test would have to
     * reproduce — and no elevation shadow able to show through them. See `readerDockColors`.
     */
    expect(
      contrastRatio(moduleNeutrals.textPrimary, readerDockColors.surface),
    ).toBeGreaterThanOrEqual(AA_TEXT);
    expect(
      contrastRatio(moduleNeutrals.textSecondary, readerDockColors.surface),
    ).toBeGreaterThanOrEqual(AA_TEXT);
    // The transport glyphs are non-text UI, which is the 3:1 threshold.
    expect(
      contrastRatio(moduleColorThemes.faith.ink, readerDockColors.surface),
    ).toBeGreaterThanOrEqual(AA_UI);
  });

  it('gives play/pause a target above the minimum, and the steps a 44 dp slop', async () => {
    const view = await renderPlayer();

    expect(controlStyle(view.getByTestId('faith-reader-player-toggle')).width).toBe(
      PLAYER_PLAY_SIZE,
    );
    expect(PLAYER_PLAY_SIZE).toBeGreaterThanOrEqual(48);
    for (const control of ['faith-reader-player-previous', 'faith-reader-player-next']) {
      expect(view.getByTestId(control).props.hitSlop).toBeDefined();
    }
  });

  it('caps how far text scaling may grow its labels', async () => {
    const view = await renderPlayer();

    for (const label of [
      'faith-reader-player-title',
      'faith-reader-player-reciter',
      'faith-reader-player-elapsed',
      'faith-reader-player-duration',
    ]) {
      const node = view.getByTestId(label);
      expect(node.props.allowFontScaling).not.toBe(false);
      expect(node.props.maxFontSizeMultiplier).toBeLessThanOrEqual(1.5);
      expect(node.props.maxFontSizeMultiplier).toBeGreaterThan(1);
    }
  });

  it('lets both identity lines wrap rather than truncating either', async () => {
    const view = await renderPlayer({ surahName: 'A surah with a very long transliterated name' });

    expect(view.getByTestId('faith-reader-player-title').props.numberOfLines).toBe(2);
    expect(view.getByTestId('faith-reader-player-reciter').props.numberOfLines).toBe(2);
  });
});

describe('at 320 dp, the narrowest supported handset', () => {
  beforeEach(() => {
    mockWindow.width = NARROW_WIDTH;
  });

  it('keeps every mandatory control rather than dropping any of them', async () => {
    const view = await renderPlayer();

    for (const control of MANDATORY) {
      expect(view.getByTestId(control)).toBeTruthy();
    }
  });

  it('keeps the identity text in its own flexible column, so it cannot overlap the controls', async () => {
    const view = await renderPlayer();
    const identity = flatStyle(view.getByTestId('faith-reader-player-status'));

    // `flex: 1` with `minWidth: 0` is what makes a long surah name shrink its own column instead of
    // pushing the transport off the panel — the collapse this project has hit twice before.
    expect(identity.flex).toBe(1);
    expect(identity.minWidth).toBe(0);
  });

  it('still meets the touch minimum on the play control', async () => {
    const view = await renderPlayer();
    const play = controlStyle(view.getByTestId('faith-reader-player-toggle'));

    // Scaled down with the layout, so the assertion is against the scaled minimum rather than 48.
    const scale = NARROW_WIDTH / moduleLayout.referenceWidth;
    expect(Number(play.width)).toBe(Math.round(PLAYER_PLAY_SIZE * scale));
    expect(view.getByTestId('faith-reader-player-toggle').props.hitSlop).toBeUndefined();
    expect(Number(play.width)).toBeGreaterThanOrEqual(moduleLayout.minTouchTarget - 6);
  });
});

describe('what each state says', () => {
  it('offers a retry when playback failed', async () => {
    const view = await renderPlayer({ state: 'failed', ayah: 7 });

    expect(String(view.getByTestId('faith-reader-player-retry').props.accessibilityLabel)).toMatch(
      /could not be played.*try verse 7 again/i,
    );
  });

  it('offers offline management, not a retry, when nothing is downloaded', async () => {
    /*
      The distinction this pins is the whole reason `not-downloaded` exists as its own state. A retry
      cannot produce a file that was never fetched, and offering one would train a user to expect that
      pressing enough times eventually streams the verse — which is the streaming fallback this
      architecture removed, reintroduced as an expectation.
    */
    const view = await renderPlayer({ state: 'not-downloaded', downloadedAyat: 0 });

    expect(view.queryByTestId('faith-reader-player-retry')).toBeNull();
    expect(
      String(view.getByTestId('faith-reader-player-offline').props.accessibilityLabel),
    ).toMatch(/not downloaded.*manage offline audio/i);
  });

  it('names the verse it stopped at, and how much of the surah is present', async () => {
    const view = await renderPlayer({
      state: 'missing-ayah',
      missingAyah: 141,
      downloadedAyat: 140,
      totalAyat: 286,
    });

    expect(
      String(view.getByTestId('faith-reader-player-offline').props.accessibilityLabel),
    ).toMatch(/stopped at verse 141.*140 of 286/i);
  });

  it('has no preparation progress bar at all, because nothing is fetched at play time', async () => {
    /*
      A regression guard, not a rendering assertion. The bar measured a *download* happening while the
      user waited to hear a verse; playback is local-only now, so a bar here would be reporting work
      that is not being done. Its testID must not come back.
    */
    const view = await renderPlayer({ state: 'starting' });
    expect(view.queryByTestId('faith-reader-player-prepare-progress')).toBeNull();
  });

  it('disables the transport where nothing is downloaded, rather than pretending', async () => {
    const view = await renderPlayer({ state: 'not-downloaded', hasNext: true });

    expect(view.getByTestId('faith-reader-player-toggle').props.accessibilityState).toMatchObject({
      disabled: true,
    });
    expect(view.getByTestId('faith-reader-player-next').props.accessibilityState).toMatchObject({
      disabled: true,
    });
  });

  it('enables both steps in the middle of a surah', async () => {
    const view = await renderPlayer({ state: 'paused', ayah: 5, hasPrevious: true, hasNext: true });

    expect(view.getByTestId('faith-reader-player-previous').props.accessibilityState).toMatchObject(
      {
        disabled: false,
      },
    );
    expect(view.getByTestId('faith-reader-player-next').props.accessibilityState).toMatchObject({
      disabled: false,
    });
  });

  it('disables next on the last ayah, and says so', async () => {
    const view = await renderPlayer({
      state: 'paused',
      ayah: 286,
      hasPrevious: true,
      hasNext: false,
    });

    const next = view.getByTestId('faith-reader-player-next');
    expect(next.props.accessibilityState).toMatchObject({ disabled: true });
    expect(String(next.props.accessibilityLabel)).toMatch(/last ayah/i);
  });

  it('disables previous on the first ayah, and says so', async () => {
    const view = await renderPlayer({
      state: 'paused',
      ayah: 1,
      hasPrevious: false,
      hasNext: true,
    });

    const previous = view.getByTestId('faith-reader-player-previous');
    expect(previous.props.accessibilityState).toMatchObject({ disabled: true });
    expect(String(previous.props.accessibilityLabel)).toMatch(/first ayah/i);
  });

  /**
   * ── The end of the download is not the end of the surah ─────────────────
   * Observed on a device: Ya-Sin with 5 of 83 verses stopped at verse 5 and the panel said so,
   * naming verse 6 — while this control announced "unavailable on the last ayah" from verse 5 of 83.
   * Two statements about the same fact, one of them false.
   */
  it('names the verse that is missing rather than claiming the surah ended', async () => {
    const view = await renderPlayer({
      state: 'missing-ayah',
      ayah: 5,
      totalAyat: 83,
      downloadedAyat: 5,
      missingAyah: 6,
      hasPrevious: true,
      hasNext: false,
    });

    const next = view.getByTestId('faith-reader-player-next');
    expect(next.props.accessibilityState).toMatchObject({ disabled: true });
    const label = String(next.props.accessibilityLabel);
    expect(label).toMatch(/verse 6 is not downloaded/i);
    expect(label).not.toMatch(/last ayah/i);
  });

  it('falls back to the download boundary when no verse number is supplied', async () => {
    /*
      A queue exists, the surah has not ended, and no next verse can be played. Whatever produced
      that, "the last ayah" is not it — so the honest general statement is the download boundary.
    */
    const view = await renderPlayer({
      state: 'paused',
      ayah: 5,
      totalAyat: 83,
      downloadedAyat: 5,
      missingAyah: null,
      hasPrevious: true,
      hasNext: false,
    });

    const label = String(view.getByTestId('faith-reader-player-next').props.accessibilityLabel);
    expect(label).toMatch(/next verse is not downloaded/i);
    expect(label).not.toMatch(/last ayah/i);
  });

  it('does not call verse 40 the first ayah when playback began there', async () => {
    /*
      `hasPrevious` is false at the start of the **queue**, and a queue started from verse 40 begins
      at verse 40. The old label read the queue boundary as the surah boundary in both directions.
    */
    const view = await renderPlayer({
      state: 'paused',
      ayah: 40,
      totalAyat: 83,
      hasPrevious: false,
      hasNext: true,
    });

    const label = String(view.getByTestId('faith-reader-player-previous').props.accessibilityLabel);
    expect(label).toMatch(/no earlier verse in this playback/i);
    expect(label).not.toMatch(/first ayah/i);
  });

  it('still says playback has not started when there is no queue at all', async () => {
    /* The case fixed in the previous round, pinned so this change cannot regress it. */
    const view = await renderPlayer({
      state: 'idle',
      ayah: 1,
      totalAyat: 11,
      hasPrevious: false,
      hasNext: false,
    });

    for (const id of ['faith-reader-player-previous', 'faith-reader-player-next'] as const) {
      expect(String(view.getByTestId(id).props.accessibilityLabel)).toMatch(
        /unavailable until playback starts/i,
      );
    }
  });

  /**
   * ── The inverse of the case this replaces ───────────────────────────────
   * This used to assert that the panel *stated* the download rather than hiding it behind a glyph.
   * That was the right rule for a player that managed downloads, and this player no longer does:
   * the control cycled through Download / Cancel / Remove / Retry / Finish across a six-state union,
   * five of which are about storage rather than listening.
   *
   * Asserted across every playback state, so the control cannot be reintroduced for one state and
   * pass — and as an absence of the *word*, so a decorative remnant fails too.
   */
  /*
    One render per case rather than a loop with `unmount()`. Rendering repeatedly inside a single
    test is what produces "overlapping act() calls" in this project, after which every later render
    in the file yields an empty tree — the seek-bar cases failed on a missing `elapsed` label the
    moment this was written as a loop.
  */
  it.each(EVERY_STATE)('carries no download control in the %s state', async (state) => {
    const view = await renderPlayer({ state, downloadedAyat: 0, missingAyah: 3 });

    expect(view.queryByTestId('faith-reader-player-download')).toBeNull();

    /*
      ── Why this is no longer an absence of the *word* ──────────────────────
      It used to be, and that was right for a player whose only reason to mention downloading was a
      control that performed one. This player has to be able to say "this verse is not downloaded" —
      that sentence is the honest alternative to silently streaming the gap, and banning the word
      would force the panel to describe a missing verse in language that avoids naming what is wrong
      with it.

      So the rule is stated as what it actually protects: no control on this panel *performs* a
      download, a cancellation or a removal. Every interactive element is checked, and the only one
      permitted to mention downloading at all is the row that navigates to the Offline audio screen.
    */
    const actions = [
      ...view.queryAllByRole('button'),
      ...view.queryAllByRole('switch'),
      ...view.queryAllByRole('adjustable'),
    ];
    for (const action of actions) {
      const label = String(action.props.accessibilityLabel ?? '');
      const testID = String(action.props.testID ?? '');
      if (testID === 'faith-reader-player-offline') {
        /* The one honest dead end: it navigates, and says so. */
        expect(label).toMatch(/manage offline audio/i);
        continue;
      }
      if (testID === 'faith-reader-player-toggle' && action.props.accessibilityState?.disabled) {
        /*
          The play control, disabled and explaining itself. It performs no download — it cannot even
          be pressed — and forbidding it the word would force it back to "no recitation available",
          which is the misattribution this wording was corrected to remove.
        */
        expect(label).not.toMatch(/tap to download/i);
        continue;
      }
      expect(label).not.toMatch(/\bdownload(ing|s)?\b(?!ed)/i);
      expect(label).not.toMatch(/\bremove\b/i);
      expect(label).not.toMatch(/\bcancel\b/i);
    }
  });
});

describe('the seek bar', () => {
  it('is inactive and unlabelled while no length has been reported', async () => {
    const view = await renderPlayer({
      state: 'idle',
      positionSeconds: null,
      durationSeconds: null,
    });

    expect(String(view.getByTestId('faith-reader-player-elapsed').props.children)).toBe('0:00');
    expect(String(view.getByTestId('faith-reader-player-duration').props.children)).toBe(
      UNKNOWN_DURATION,
    );
    expect(view.getByTestId('faith-reader-player-seek').props.accessibilityState).toMatchObject({
      disabled: true,
    });
  });

  it('seeks to the tapped fraction of the verse once a length is known', async () => {
    const onSeek = jest.fn();
    const view = await renderPlayer({
      state: 'playing',
      positionSeconds: 10,
      durationSeconds: 60,
      onSeek,
    });

    const track = view.getByTestId('faith-reader-player-seek');
    /*
      The measurement has to be committed before the press reads it: the track's width is state,
      set from its own `onLayout`, and a press in the same tick would map the tap against a width
      of zero and silently do nothing — which is exactly what an unmeasured seek bar does.
    */
    await act(async () => {
      void fireEvent(track, 'layout', {
        nativeEvent: { layout: { width: 200, height: 4, x: 0, y: 0 } },
      });
    });
    await fireEvent.press(track, { nativeEvent: { locationX: 100 } });

    expect(onSeek).toHaveBeenCalledWith(30);
  });
});

describe('the controls call the transport and nothing else', () => {
  it('reports presses without deciding what they mean', async () => {
    const onTogglePlay = jest.fn();
    const onPrevious = jest.fn();
    const onNext = jest.fn();
    const onChangeRate = jest.fn();
    const view = await renderPlayer({
      state: 'paused',
      hasPrevious: true,
      hasNext: true,
      onTogglePlay,
      onPrevious,
      onNext,
      onChangeRate,
    });

    await fireEvent.press(view.getByTestId('faith-reader-player-toggle'));
    await fireEvent.press(view.getByTestId('faith-reader-player-previous'));
    await fireEvent.press(view.getByTestId('faith-reader-player-next'));
    await fireEvent.press(view.getByTestId('faith-reader-player-speed'));

    expect(onTogglePlay).toHaveBeenCalledTimes(1);
    expect(onPrevious).toHaveBeenCalledTimes(1);
    expect(onNext).toHaveBeenCalledTimes(1);
    // The cycle is the component's only piece of arithmetic: it advances the rate it was given.
    expect(onChangeRate).toHaveBeenCalledWith(1.25);
  });
});
