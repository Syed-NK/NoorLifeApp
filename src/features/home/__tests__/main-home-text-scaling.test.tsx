import { act, cleanup, render, screen } from '@testing-library/react-native';
import { Dimensions } from 'react-native';

import { AppProviders } from '@application/providers/app-providers';
import { installMockLatencyTimers } from '@/test-support/mock-latency-timers';

import { LOCKED_TYPE, SCROLL_FALLBACK_USABLE_HEIGHT } from '../main-home-metrics';
import { MainHomeScreen } from '../screens/main-home-screen';

/**
 * **Main Home honours the OS text size** — issue #141.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * `HomeText` rendered with `allowFontScaling={false}`, so at font scale 1.5 every text node on the
 * app's primary screen reported byte-identical `uiautomator` bounds to 1.0 — a user who asked for
 * larger text got none of it. That was a validation concession recorded in the source as needing a
 * product decision, and §8 requires the opposite.
 *
 * ── Why turning the flag on was not the whole fix ──────────────────────────
 * The old note argued the two requirements could not both hold, and it was right about the layout as
 * it was. Two section roots carried a fixed `height`, so a scaled string would have overflowed inside
 * a card that could not grow — and the screen's own `ScrollView` fallback would never have seen it,
 * because the column's total height would not have changed. Those two roots now carry `minHeight`,
 * and the scroll decision reads the column's **measured** height instead of a constant.
 *
 * The three remaining sub-44 dp controls were left exactly as they were: `PressableScale` already
 * floors `minHeight` to 44 dp and applies it last, so the timeline row (23 dp), quick-action tile
 * (42 dp) and hero button (31 dp) are already 44 dp tall and hold a 1.5x line without help. Changing
 * them would only have deleted the locked figure their guards read.
 *
 * ── What the ramp did and did not gain ─────────────────────────────────────
 * Nothing about the ramp changed. `main-home-metrics.ts` is design-locked and untouched — the
 * protected-files guard proves that separately. This changed whether the ramp scales, never what it
 * says, and no clamp was introduced: a clamp would be the same defect in a milder form.
 * ═══════════════════════════════════════════════════════════════════════════
 */

installMockLatencyTimers(() => renderAt({ height: TALL }));

/** Comfortably taller than the content, so the static branch is the honest starting point. */
const TALL = 1400;

/** Below `SCROLL_FALLBACK_USABLE_HEIGHT`, so the constant alone already asks for scrolling. */
const SHORT = 600;

const BASELINE = { width: 393, scale: 3 } as const;

function pinWindow(height: number, fontScale: number): void {
  const window = { ...BASELINE, height, fontScale };
  (Dimensions as unknown as { set: (d: unknown) => void }).set({ window, screen: window });
}

async function renderAt(options: { readonly height: number; readonly fontScale?: number }) {
  pinWindow(options.height, options.fontScale ?? 1);
  return render(
    <AppProviders>
      <MainHomeScreen simulateFailure={false} />
    </AppProviders>,
  );
}

/*
  Unmount before touching `Dimensions` again. `Dimensions.set` emits a change event, and a still-
  mounted tree would take that update outside `act` — which shows up as "overlapping act() calls" and
  then as an empty screen in every later case in the file.
*/
afterEach(async () => {
  await cleanup();
  pinWindow(TALL, 1);
});

/**
 * Reports the column's laid-out height, the way the native layout pass does.
 *
 * The handler is invoked directly rather than through `fireEvent(node, 'layout')`, which does not
 * reach `onLayout` in this version of RNTL — it leaves the branch unchanged, so a test written that
 * way passes or fails on nothing. Verified by calling both against the same tree.
 */
async function reportColumnHeight(height: number): Promise<void> {
  const column = screen.getByTestId('main-home-column');
  await act(async () => {
    column.props.onLayout({
      nativeEvent: { layout: { x: 0, y: 0, width: BASELINE.width, height } },
    });
  });
}

const scrolling = (): boolean => screen.queryByTestId('main-home-scroll') !== null;
const staticBranch = (): boolean => screen.queryByTestId('main-home-static') !== null;

describe('font scaling is enabled', () => {
  it.each([1, 1.5])('lets the OS text size through at font scale %s', async (fontScale) => {
    await renderAt({ height: TALL, fontScale });

    const name = screen.getByText('Assalamu Alaikum,');
    /*
      `false` is the defect, and it is the only value that reproduces it — React Native's default is
      true, so an absent prop scales. Both are accepted here so the assertion is about the behaviour
      rather than about whether the prop is written out.
    */
    expect(name.props.allowFontScaling).not.toBe(false);
  });

  it('sets no clamp, so a large text setting is honoured rather than capped', async () => {
    await renderAt({ height: TALL, fontScale: 1.5 });

    const name = screen.getByText('Assalamu Alaikum,');
    // A clamp here would be the same defect in a milder form: the screen scrolls instead.
    expect(name.props.maxFontSizeMultiplier ?? null).toBeNull();
  });
});

describe('the documented ramp is preserved', () => {
  it('still renders the locked type ramp, not a reduced one', async () => {
    await renderAt({ height: TALL });

    const name = screen.getByText('Assalamu Alaikum,');
    const style = Array.isArray(name.props.style)
      ? Object.assign({}, ...name.props.style.filter(Boolean))
      : name.props.style;

    /*
      The ramp is read from the locked token rather than restated. A screen-specific "scaled ramp"
      was the rejected alternative in the #141 brief, and substituting one here would change this
      number while every other assertion in this file kept passing.
    */
    expect(style.fontSize).toBe(LOCKED_TYPE.greeting[0]);
    expect(style.lineHeight).toBe(LOCKED_TYPE.greeting[1]);
  });
});

describe('the existing scroll fallback carries the growth', () => {
  it('does not scroll when the content fits', async () => {
    await renderAt({ height: TALL });
    screen.getByTestId('main-home-column');

    await reportColumnHeight(400);

    expect(staticBranch()).toBe(true);
    expect(scrolling()).toBe(false);
  });

  it('scrolls once the measured column outgrows the viewport', async () => {
    await renderAt({ height: TALL });
    screen.getByTestId('main-home-column');

    // Taller than any viewport this test pins, which is what a 1.5x column does on a real phone.
    await reportColumnHeight(TALL * 2);

    expect(scrolling()).toBe(true);
    expect(staticBranch()).toBe(false);
  });

  /**
   * The assertion requirement 6 turns on.
   *
   * `needsScroll` has no `fontScale` term, and that is only acceptable if a real layout can move the
   * decision. So this drives it both ways from measurement alone: a fitting column stays static, the
   * same column re-measured tall switches to scrolling, and shrinking back returns it. A build that
   * went back to deciding from `dp(CONTENT_HEIGHT)` would hold one branch throughout.
   */
  it('lets a fresh measurement change the decision, in both directions', async () => {
    await renderAt({ height: TALL });
    screen.getByTestId('main-home-column');

    await reportColumnHeight(400);
    expect(scrolling()).toBe(false);

    await reportColumnHeight(TALL * 2);
    expect(scrolling()).toBe(true);

    await reportColumnHeight(400);
    expect(scrolling()).toBe(false);
  });

  it('still scrolls on a short viewport before anything has been measured', async () => {
    // The constant decides the first frame, so a genuinely short device never flashes the static
    // branch on its way to the right one.
    await renderAt({ height: SHORT });

    expect(scrolling()).toBe(true);
    expect(SHORT).toBeLessThan(SCROLL_FALLBACK_USABLE_HEIGHT);
  });
});

describe('the locked chrome is unchanged in both entitlement states', () => {
  it.each([1, 1.5])(
    'keeps navigation, header and hero reachable at font scale %s',
    async (fontScale) => {
      await renderAt({ height: TALL, fontScale });

      // The bottom navigation lives outside the scrolling container, so it must be present either way.
      expect(screen.getByTestId('main-home-header')).toBeTruthy();
      expect(screen.getByTestId('main-home-nav-bar')).toBeTruthy();
    },
  );

  it('keeps the navigation outside the scrolling container when the screen scrolls', async () => {
    await renderAt({ height: TALL, fontScale: 1.5 });
    screen.getByTestId('main-home-column');

    await reportColumnHeight(TALL * 2);

    expect(scrolling()).toBe(true);
    /*
      Inside the ScrollView the bar would scroll away with the content, which is what "bottom
      controls preserved" rules out. The nav is a sibling of the branch, so it survives the switch.
      */
    const nav = screen.getByTestId('main-home-nav-bar');
    expect(nav).toBeTruthy();
    expect(screen.getByTestId('main-home-scroll')).toBeTruthy();
  });
});
