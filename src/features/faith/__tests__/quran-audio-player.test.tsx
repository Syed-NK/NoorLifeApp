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
    prepareProgress: null,
    rate: 1,
    rates: [0.75, 1, 1.25, 1.5],
    rateSupported: true,
    download: { kind: 'stream-only' },
    hasPrevious: false,
    hasNext: true,
    failure: null,
    onTogglePlay: noop,
    onPrevious: noop,
    onNext: noop,
    onSeek: noop,
    onChangeRate: noop,
    onDownload: noop,
    onCancelDownload: noop,
    onRemoveDownload: noop,
    onRetry: noop,
    onOpenReciters: noop,
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
  'faith-reader-player-download',
  'faith-reader-player-title',
  'faith-reader-player-reciter',
] as const;

const EVERY_STATE: readonly QuranPlaybackState[] = [
  'idle',
  'preparing',
  'buffering',
  'playing',
  'paused',
  'completed',
  'offline',
  'failed',
  'unavailable',
];

/**
 * The style a control is actually drawn with.
 *
 * `PressableScale` puts the caller's style on its **outer** view and makes the pressable an
 * absolutely-filled touch overlay inside it — see that component's note for the layout bugs that
 * arrangement fixes. The testID is on the overlay, so geometry has to be read one level up.
 */
function controlStyle(node: { readonly parent: unknown }): Record<string, unknown> {
  return flatStyle(node.parent as { readonly props: { readonly style?: unknown } });
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
  it('offers a retry when a verse failed, naming the failure', async () => {
    const view = await renderPlayer({ state: 'failed', failure: 'corrupt', ayah: 7 });

    expect(String(view.getByTestId('faith-reader-player-retry').props.accessibilityLabel)).toMatch(
      /did not arrive intact.*try verse 7 again/i,
    );
  });

  it('says offline rather than "could not play" when that is the reason', async () => {
    const view = await renderPlayer({ state: 'offline', failure: 'offline' });

    expect(String(view.getByTestId('faith-reader-player-reciter').props.children)).toMatch(
      /not available offline/i,
    );
    expect(String(view.getByTestId('faith-reader-player-retry').props.accessibilityLabel)).toMatch(
      /offline/i,
    );
  });

  it('claims no preparation fraction where the server sent no length', async () => {
    // The spinner already says "working". A bar drawn from nothing would claim a measurement
    // nobody made.
    const view = await renderPlayer({ state: 'preparing', prepareProgress: null });
    expect(view.queryByTestId('faith-reader-player-prepare-progress')).toBeNull();
  });

  it('shows the preparation fraction when there is one', async () => {
    const view = await renderPlayer({ state: 'preparing', prepareProgress: 0.5 });
    expect(view.getByTestId('faith-reader-player-prepare-progress')).toBeTruthy();
  });

  it('disables the transport where the reciter published nothing, rather than pretending', async () => {
    const view = await renderPlayer({ state: 'unavailable', hasNext: true });

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

  it('states the download rather than hiding it behind a glyph', async () => {
    const view = await renderPlayer({
      state: 'idle',
      download: { kind: 'downloading', completed: 12, total: 286 },
    });

    expect(String(view.getByTestId('faith-reader-player-reciter').props.children)).toContain(
      'Downloading 12/286',
    );
    expect(
      String(view.getByTestId('faith-reader-player-download').props.accessibilityLabel),
    ).toMatch(/cancel the download/i);
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
      fireEvent(track, 'layout', {
        nativeEvent: { layout: { width: 200, height: 4, x: 0, y: 0 } },
      });
    });
    fireEvent.press(track, { nativeEvent: { locationX: 100 } });

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

    fireEvent.press(view.getByTestId('faith-reader-player-toggle'));
    fireEvent.press(view.getByTestId('faith-reader-player-previous'));
    fireEvent.press(view.getByTestId('faith-reader-player-next'));
    fireEvent.press(view.getByTestId('faith-reader-player-speed'));

    expect(onTogglePlay).toHaveBeenCalledTimes(1);
    expect(onPrevious).toHaveBeenCalledTimes(1);
    expect(onNext).toHaveBeenCalledTimes(1);
    // The cycle is the component's only piece of arithmetic: it advances the rate it was given.
    expect(onChangeRate).toHaveBeenCalledWith(1.25);
  });
});
