import AsyncStorage from '@react-native-async-storage/async-storage';
import { configure, fireEvent } from '@testing-library/react-native';

import { seedTranslationPreference } from '@/test-support/faith-preferences-fixtures';
import { warmUpFirstMount } from '@/test-support/mock-latency-timers';
import { READER_DOWNLOADED, renderReader } from '@/test-support/faith-reader';

import { mockRouter, setRouteParams } from '../../../../jest.setup';

import {
  moduleDockClearance,
  moduleLayout,
  moduleNavigationHeight,
  moduleScale,
} from '@features/modules/module-tokens';
import { PLAYER_MIN_HEIGHT } from '../components/reader/quran-audio-player';

/**
 * Where the docked player sits relative to the bottom navigation.
 *
 * ── The defect this suite exists for ────────────────────────────────────────
 * `ModuleBottomNavigation` is `position: absolute; bottom: 0`, mirroring locked Main Home, so it
 * takes **no space in the scaffold's flex column** — it draws over whatever the column put at the
 * bottom of the screen. The docked slot was the last child of that column and was described in its
 * own comment as "a sibling of both, so it can cover neither". It was a sibling of one of them: on
 * a device the navigation bar drew straight over the audio player and only the player's top edge
 * showed. No amount of scrolling could reveal it, because it was not the scroll region that was
 * covering it.
 *
 * The fix reserves the bar's space in the column with a bottom margin on the docked container, so
 * the panel's box genuinely ends above the bar. It is not a `zIndex`, which would have produced the
 * opposite and equally wrong screen — a player floating on top of the tabs.
 *
 * ── Why these assertions are arithmetic and not pixels ──────────────────────
 * Jest has no layout engine, so no test here can measure a rendered frame. What it *can* do is read
 * the styles the renderer was actually given and compute the frames from them, against the same
 * screen height the tree was rendered at. That fails against every way this regresses — a dropped
 * margin, a margin that stops including the safe-area inset, a bar that grows without the panel
 * following, or a panel moved back inside the scroll region.
 */

configure({ asyncUtilTimeout: 3000 });
jest.setTimeout(20000);

/**
 * The viewport and the device's gesture bar, both settable.
 *
 * 411 dp is what the current Android emulator reports (1080 px at 420 dpi); 320 dp is the narrowest
 * handset the layout claims to support. The 48 dp bottom inset is a real gesture-navigation bar —
 * the library's Jest double answers zero on every edge, which is the one value that would make an
 * inset added twice indistinguishable from an inset added once.
 */
const mockWindow = { width: 411, height: 914, scale: 3, fontScale: 1 };

jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => mockWindow,
}));

const EMULATOR_WIDTH = 411;
const NARROW_WIDTH = 320;
const SCREEN_HEIGHT = 914;
const SAFE_AREA_BOTTOM = 48;
const INSETS = { top: 24, bottom: SAFE_AREA_BOTTOM } as const;

warmUpFirstMount(() =>
  renderReader({ downloaded: READER_DOWNLOADED, insets: INSETS }).then(({ view }) => view),
);

beforeEach(async () => {
  await AsyncStorage.clear();
  await seedTranslationPreference();
  setRouteParams({ surah: '1' });
  mockWindow.width = EMULATOR_WIDTH;
});

/** The scaled-dp helper for the width currently being rendered, exactly as the tree computes it. */
function dpAt(width: number): (value: number) => number {
  const scale = moduleScale(width);
  return (value) => Math.round(value * scale);
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

/**
 * The four edges this suite reasons about, in dp from the top of the screen.
 *
 * The docked container is the last child of a full-height flex column, so its bottom edge is the
 * screen's bottom minus its own bottom margin. The navigation bar is absolute at `bottom: 0`, so
 * its top edge is the screen's bottom minus its height. Both are read from the rendered styles
 * rather than recomputed from tokens, which is what makes this a test of the tree and not of the
 * arithmetic in the file it is testing.
 */
async function frames(width: number): Promise<{
  readonly dockBottom: number;
  readonly dockHeight: number;
  readonly navTop: number;
  readonly navHeight: number;
  readonly aiTop: number;
}> {
  mockWindow.width = width;
  const { view } = await renderReader({ downloaded: READER_DOWNLOADED, insets: INSETS });

  const dock = flatStyle(await view.findByTestId('faith-reader-docked'));
  /*
    The *visible* bar, not the carrier around it — issue #84.

    `faith-reader-nav` is the navigation's outer view, which since #84 is taller than the bar it
    draws: it extends upward by `navAIRaise` so the raised centre control falls inside its parent's
    bounds and can therefore receive a touch on Android. The bar the reader has to clear is the
    inner one, which is the height `moduleNavigationHeight` has always described.
  */
  const nav = flatStyle(view.getByTestId('faith-reader-nav-bar'));
  const player = flatStyle(view.getByTestId('faith-reader-player'));

  const dp = dpAt(width);
  const navHeight = Number(nav.height);
  const navTop = SCREEN_HEIGHT - navHeight;

  return {
    dockBottom: SCREEN_HEIGHT - Number(dock.marginBottom ?? 0),
    // The panel's floor. Its rendered height is at least this, never less.
    dockHeight: Number(player.minHeight),
    navTop,
    navHeight,
    /** The raised centre control stands this far above the bar's own top edge. */
    aiTop: navTop - dp(moduleLayout.navAIRaise),
  };
}

describe.each([
  ['the emulator width', EMULATOR_WIDTH],
  ['the narrowest supported handset', NARROW_WIDTH],
])('at %s', (_label, width) => {
  it('puts the player’s bottom edge at or above the navigation’s top edge', async () => {
    const frame = await frames(width);

    expect(frame.dockBottom).toBeLessThanOrEqual(frame.navTop);
  });

  it('leaves no gap beyond the raised centre control’s own space', async () => {
    const frame = await frames(width);

    /**
     * The panel ends exactly where the raised AI button begins. Not lower — the button would then
     * cover the seek row — and not higher, which would be a strip of empty page background between
     * the player and the bar.
     */
    expect(frame.dockBottom).toBe(frame.aiTop);
  });

  it('keeps the Faith AI centre button clear of the player', async () => {
    const frame = await frames(width);

    expect(frame.aiTop).toBeGreaterThanOrEqual(frame.dockBottom);
  });

  it('leaves room for the whole player between the header and the navigation', async () => {
    const frame = await frames(width);
    const dp = dpAt(width);

    // The panel's full height fits above the bar rather than only its top edge — the symptom the
    // device screenshot showed.
    expect(frame.dockBottom - frame.dockHeight).toBeGreaterThan(0);
    expect(frame.dockHeight).toBe(dp(PLAYER_MIN_HEIGHT));
    expect(frame.dockHeight).toBeGreaterThanOrEqual(dp(112));
    expect(frame.dockHeight).toBeLessThanOrEqual(dp(128));
  });

  it('derives both frames from the shared navigation helpers', async () => {
    const frame = await frames(width);
    const dp = dpAt(width);

    // One source of truth: the bar's own height and the panel's clearance are the same two
    // functions the layout uses, so a change to either moves both together.
    expect(frame.navHeight).toBe(moduleNavigationHeight(dp, SAFE_AREA_BOTTOM));
    expect(SCREEN_HEIGHT - frame.dockBottom).toBe(moduleDockClearance(dp, SAFE_AREA_BOTTOM));
  });
});

describe('the safe-area inset is applied exactly once', () => {
  it('appears once in the navigation’s height and once in the dock’s clearance', async () => {
    const frame = await frames(EMULATOR_WIDTH);
    const dp = dpAt(EMULATOR_WIDTH);

    /**
     * The bar's height is the token plus **one** inset. Doubling it is the classic form of this
     * bug — the bar pads itself by the inset and something above it adds the inset again — and it
     * would show here as a bar 48 dp taller than the token allows.
     */
    expect(frame.navHeight).toBe(dp(moduleLayout.navHeight) + SAFE_AREA_BOTTOM);

    // The clearance is the bar's height plus the raise, and the inset arrives in it only through
    // the bar's height. Not twice.
    expect(SCREEN_HEIGHT - frame.dockBottom).toBe(
      dp(moduleLayout.navHeight) + SAFE_AREA_BOTTOM + dp(moduleLayout.navAIRaise),
    );
  });

  it('does not add the inset to the scroll padding as well', async () => {
    const { view } = await renderReader({ downloaded: READER_DOWNLOADED, insets: INSETS });
    // The dock exists only once the page has loaded, and the padding is a function of the dock.
    await view.findByTestId('faith-reader-player');
    const dp = dpAt(EMULATOR_WIDTH);

    /**
     * With a docked panel the scroll region's box already ends above it, and the panel's box ends
     * above the bar — so the content is not overlapped by either and needs no padding for them.
     * What remains is the breathing room under the last verse.
     *
     * Padding for the bar here would be the *third* place the inset was counted, and would show up
     * as an inch of dead space under the last ayah of every surah.
     */
    const padding = (
      view.getByTestId('faith-reader-scroll').props.contentContainerStyle as {
        paddingBottom?: number;
      }
    ).paddingBottom;

    expect(padding).toBe(dp(moduleLayout.scrollBottomInset));
  });
});

describe('the player is fixed and the content scrolls under nothing', () => {
  it('renders outside the scroll region, so scrolling cannot move it', async () => {
    const { view } = await renderReader({ downloaded: READER_DOWNLOADED, insets: INSETS });

    const scroll = view.getByTestId('faith-reader-scroll');
    expect(contains(scroll, 'faith-reader-player')).toBe(false);
    expect(contains(await view.findByTestId('faith-reader-docked'), 'faith-reader-player')).toBe(
      true,
    );
  });

  it('keeps the player in place across a scroll event', async () => {
    const { view } = await renderReader({ downloaded: READER_DOWNLOADED, insets: INSETS });
    const before = flatStyle(await view.findByTestId('faith-reader-docked')).marginBottom;

    await fireEvent.scroll(view.getByTestId('faith-reader-scroll'), {
      nativeEvent: {
        contentOffset: { y: 400, x: 0 },
        contentSize: { height: 2000, width: 361 },
        layoutMeasurement: { height: 600, width: 361 },
      },
    });

    expect(flatStyle(view.getByTestId('faith-reader-docked')).marginBottom).toBe(before);
  });

  it('lets the last ayah scroll clear of the player, because they share no space', async () => {
    /**
     * Structural rather than measured: the scroll region is `flex: 1` in a column whose last child
     * is the docked panel, so the region's own box ends where the panel begins. Every verse is
     * inside that box, and the last one reaches the top of the panel and no further.
     *
     * Asserted as the two facts that make it true — the last verse is in the scroll region, the
     * player is not — plus the breathing room under it.
     */
    const { view } = await renderReader({ downloaded: READER_DOWNLOADED, insets: INSETS });
    await view.findByTestId('faith-reader-ayah-1-5');
    const scroll = view.getByTestId('faith-reader-scroll');

    expect(contains(scroll, 'faith-reader-ayah-1-5')).toBe(true);
    expect(contains(scroll, 'faith-reader-translation-1-5')).toBe(true);
    expect(contains(scroll, 'faith-reader-player')).toBe(false);
    expect(
      Number((scroll.props.contentContainerStyle as { paddingBottom?: number }).paddingBottom ?? 0),
    ).toBeGreaterThan(0);
  });
});

describe('the navigation is still a navigation', () => {
  it('remains tappable with the player docked above it', async () => {
    const { view } = await renderReader({ downloaded: READER_DOWNLOADED, insets: INSETS });
    await view.findByTestId('faith-reader-player');

    await fireEvent.press(view.getByTestId('faith-reader-nav-worship'));

    expect(mockRouter.navigate).toHaveBeenCalled();
  });

  it('keeps the centre AI control reachable', async () => {
    const { view } = await renderReader({ downloaded: READER_DOWNLOADED, insets: INSETS });
    await view.findByTestId('faith-reader-player');

    await fireEvent.press(view.getByTestId('faith-reader-nav-ai'));

    expect(mockRouter.navigate).toHaveBeenCalled();
  });
});

/** Whether a testID appears beneath a given node. */
function contains(node: { readonly children: readonly unknown[] }, testID: string): boolean {
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
