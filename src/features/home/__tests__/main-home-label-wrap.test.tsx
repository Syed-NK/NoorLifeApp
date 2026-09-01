import { cleanup, render, screen, within } from '@testing-library/react-native';
import { Dimensions, StyleSheet, type ViewStyle } from 'react-native';

import { AppProviders } from '@application/providers/app-providers';
import { TodayAgendaProvider } from '@application/providers/today-agenda-provider';
import { installMockLatencyTimers } from '@/test-support/mock-latency-timers';

import { LOCKED } from '../main-home-metrics';
import { MainHomeScreen } from '../screens/main-home-screen';

/**
 * **Three Main Home labels that clipped once the screen started scaling** — issue #148.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * #141 restored dynamic text scaling. §8 asks for scaling *without* clipping, and the second half was
 * not met: measured on a Samsung SM-G556B at 384 dp, three labels rendered in full at font scale 1.0
 * and ellipsized at 1.5 —
 *
 *   `Nothing planned for today`  →  `Nothing planned for tod…`
 *   `Family Check-in`            →  `Family Check…`
 *   `Unlock family connection`   →  `Unlock family conne…`
 *
 * They could not clip before, because `HomeText` was `allowFontScaling={false}` and drew them at
 * their 1.0 size whatever the OS setting. So this is the remainder of #141's requirement, not a
 * reason to undo it — and the fix must not touch scaling, the cap, or the locked ramp.
 *
 * ── Why two lines, and why the containers already allow it ─────────────────
 * The same role already wraps on the card beside it: `progressSupport` renders `Included with
 * Premium` on two lines and always has. `home-summary-row.tsx` also records that "§10 forbids
 * truncating, not resizing", so an ellipsis on a locked label is against the lock. The summary card
 * carries `minHeight` (since #141) and the Today card carries `minHeight` too, so a second line has
 * somewhere to go, and #141 made the column's measured height drive the scroll decision — growth
 * reaches the fallback instead of being cropped.
 *
 * ── What Jest can and cannot show here ────────────────────────────────────
 * Not the ellipsis: no font is registered under Jest, so no glyph has a width and nothing truncates.
 * What is pinned instead is the property that made truncation possible — a label pinned to one line
 * inside a box that could not grow — asserted as the line allowance, the absence of a clipping
 * height, and scaling still being on. The ellipsis itself is a device measurement, recorded in the PR.
 * ═══════════════════════════════════════════════════════════════════════════
 */

installMockLatencyTimers(() => renderHome());

const BASELINE = { width: 393, height: 1400, scale: 3 } as const;

function pinWindow(fontScale: number): void {
  const window = { ...BASELINE, fontScale };
  (Dimensions as unknown as { set: (d: unknown) => void }).set({ window, screen: window });
}

/**
 * Renders and waits for the dashboard to resolve.
 *
 * The body is a skeleton until the mock dashboard settles, so a query fired straight after `render`
 * finds the navigation and nothing else. Every case here is about the resolved content, so the wait
 * belongs in the helper rather than being repeated — and forgotten once.
 */
/**
 * A plan that was read successfully and is empty.
 *
 * Without it the timeline renders `Your plan is unavailable — open Planner`, which is a different
 * sentence for a different situation. The label under test is the *empty* one, so the port has to say
 * `ready` with nothing in it.
 */
const EMPTY_PLAN = {
  status: 'ready',
  items: [],
  today: '2026-09-01',
  reload: async () => {},
} as const;

async function renderHome(fontScale = 1) {
  pinWindow(fontScale);
  const view = await render(
    <AppProviders>
      <TodayAgendaProvider state={EMPTY_PLAN}>
        <MainHomeScreen simulateFailure={false} />
      </TodayAgendaProvider>
    </AppProviders>,
  );
  await screen.findByTestId('main-home-timeline');
  return view;
}

/* Unmount before touching `Dimensions` again — a mounted tree would take that update outside `act`. */
afterEach(async () => {
  await cleanup();
  pinWindow(1);
});

function flatten(style: unknown): ViewStyle {
  return (StyleSheet.flatten(style as ViewStyle) ?? {}) as ViewStyle;
}

/**
 * The three strings this issue is about, exactly as the product renders them.
 *
 * Queried by their visible text rather than a testID: the defect was about *these words* being cut,
 * so a case that stopped matching the copy should fail rather than quietly assert about some other
 * label.
 */
/**
 * Resolves a label unambiguously.
 *
 * `Family Check-in` names both the summary card and a quick action, so a screen-level query matches
 * two nodes and throws. The summary card is the one this issue is about, so the lookup is scoped to
 * it; the other two strings are unique.
 */
function label(text: string) {
  if (text === 'Family Check-in') {
    return within(screen.getByTestId('family-check-in-card')).getByText(text);
  }
  return screen.getByText(text);
}

const CLIPPED_LABELS = [
  'Nothing planned for today',
  'Family Check-in',
  'Unlock family connection',
] as const;

describe('every label that clipped may now take a second line', () => {
  it.each(CLIPPED_LABELS)('gives "%s" more than one line', async (text) => {
    await renderHome();

    const node = label(text);
    // One line is the defect, and it is the only value that reproduces it.
    expect(node.props.numberOfLines).toBeGreaterThanOrEqual(2);
  });

  it.each(CLIPPED_LABELS)('keeps "%s" scaling with the OS text size', async (text) => {
    await renderHome(1.5);

    const node = label(text);
    /*
      Disabling scaling on these three would "fix" the ellipsis by reintroducing the #141 defect in
      miniature, so it is refused here as well as there.
    */
    expect(node.props.allowFontScaling).not.toBe(false);
    expect(node.props.maxFontSizeMultiplier ?? null).toBeNull();
  });

  it.each(CLIPPED_LABELS)('does not shrink "%s" to fit instead of wrapping', async (text) => {
    await renderHome(1.5);

    const node = label(text);
    // `adjustsFontSizeToFit` would trade the ellipsis for text smaller than the locked ramp.
    expect(node.props.adjustsFontSizeToFit).not.toBe(true);
  });
});

describe('the containers can absorb the second line', () => {
  /**
   * Both parents, and the property that matters is the same for each: a floor, never a fixed height.
   *
   * A `height` here is what turns a wrapped label back into a cropped one — the label grows, the box
   * does not, and nothing reports an error. This is the "text growth without parent-layout growth"
   * case, asserted on the two containers that hold the three labels.
   */
  it.each([
    ['main-home-timeline', LOCKED.today.cardHeight],
    ['family-check-in-card', LOCKED.summary.height],
    ['overall-progress-card', LOCKED.summary.height],
  ] as const)('gives %s a floor rather than a fixed height', async (testID, locked) => {
    await renderHome();

    const style = flatten(screen.getByTestId(testID).props.style);
    expect(style.minHeight).toBe(locked);
    expect(style.height).toBeUndefined();
    expect(style.maxHeight).toBeUndefined();
  });

  /**
   * The timeline row, which is the one container whose height is not its own.
   *
   * Its style still declares the locked 23 dp row height, but `PressableScale` floors `minHeight` to
   * the 44 dp touch target and applies it last, so 44 is the real minimum — measured at 44.1 dp on
   * the device. Two lines of `activity` at a 1.5 scale measure about 39 dp, which fits, and the PR
   * records the device measurement rather than resting on that arithmetic. What is asserted here is
   * that nothing caps it: no `maxHeight`, and the 44 dp floor intact.
   */
  it('leaves the timeline row uncapped and at the touch-target floor', async () => {
    await renderHome();

    const row = flatten(screen.getByTestId('timeline-row-next-prayer').props.style);
    expect(row.maxHeight).toBeUndefined();
    expect(Number(row.minHeight)).toBeGreaterThanOrEqual(44);
  });
});

describe('nothing else about these surfaces moved', () => {
  it('keeps the locked presentation and its accessible names', async () => {
    await renderHome();

    // The lock badges and the locked wording are what #148 must not disturb.
    expect(screen.getByTestId('family-check-in-lock')).toBeTruthy();
    expect(screen.getByTestId('overall-progress-lock')).toBeTruthy();
    expect(
      screen.getAllByLabelText('Family Check-in, Premium feature').length,
    ).toBeGreaterThanOrEqual(1);
  });

  it('leaves the short labels on one line, so the change is scoped to the roles that clipped', async () => {
    await renderHome();

    /*
      `summaryValue` and `time` never clipped and are not part of this. If a future edit relaxed every
      `HomeText` in the file, this is what would notice.
    */
    expect(screen.getByText('Premium').props.numberOfLines).toBe(1);
  });
});
