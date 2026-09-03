import { cleanup, fireEvent, render, screen } from '@testing-library/react-native';
import { Dimensions, StyleSheet, View } from 'react-native';

import { AuthHeader } from '../components/auth-header';
import { touchTarget } from '@ds/tokens';
import { minimumTouchTargetSize } from '@shared/utils/a11y';

/**
 * **The back control's whole target has to be inside the parent that clips it** — issue #123.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── The defect, and why the style looked right ─────────────────────────────
 * `AuthHeader` asked for a 44 dp square and got one: `minimumTouchTargetSize()` was applied as
 * `width`, `height`, `minWidth` and `minHeight`. Then the stylesheet pulled the whole box 10 dp left
 * with `marginLeft: -10`, to line the chevron's visual edge up with the page gutter.
 *
 * The parent is the scroll container whose own left edge *is* that gutter. So the negative margin did
 * not move the target into a margin — it moved 10 dp of the target outside the parent, which clipped
 * it. Measured on a Samsung SM-G556B at 384 dp:
 *
 *     plan-details-single-scroll       bounds=[45,100][1035,1560]   <- parent's left edge
 *     plan-details-single-header-back  bounds=[45,100][141,224]     <- clipped flush against it
 *                                      96 x 124 px = 34.133 x 44.089 dp
 *
 * Height correct, width 10 dp short of the floor #115 established. `hitSlop={8}` could not rescue it:
 * the slop is clipped by the same edge, reaching 41.96 dp at best.
 *
 * ── Why this file asserts the *composed* style ─────────────────────────────
 * Two weaker things were considered and rejected. A source scan cannot see it — the floor was inline
 * and the margin was in the stylesheet, so each half reads correctly on its own; that is exactly the
 * disguise #123 describes. And Jest has no layout engine, so nothing here can measure a rendered box
 * or prove a parent clipped it.
 *
 * What is provable here is the property that did the clipping: the style the element actually ends up
 * with, flattened across the stylesheet and the inline object together. A target that carries the
 * floor and no negative offset cannot leave its parent by this route. The reachability itself — taps
 * landing on all four edges, outside the glyph — is device evidence, recorded on the pull request.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const flatten = (style: unknown): Record<string, unknown> =>
  (StyleSheet.flatten(style as never) ?? {}) as Record<string, unknown>;

/** Every way a box can be pushed off its own origin, not just the one that caused #123. */
const OFFSETS = [
  'margin',
  'marginLeft',
  'marginRight',
  'marginTop',
  'marginBottom',
  'marginHorizontal',
  'marginVertical',
  'marginStart',
  'marginEnd',
  'left',
  'right',
  'top',
  'bottom',
] as const;

function backStyle(): Record<string, unknown> {
  return flatten(screen.getByTestId('probe-header-back').props.style);
}

async function renderHeader(title = 'Welcome back') {
  /*
    Wrapped in a clipping parent, because that is the shape the defect needs: `overflow: 'hidden'`
    with the header flush against its left edge is the scroll container, reduced to its essentials.
  */
  await render(
    <View style={{ overflow: 'hidden' }}>
      <AuthHeader onBack={() => undefined} title={title} testID="probe-header" />
    </View>,
  );
}

afterEach(async () => {
  await cleanup();
});

describe('the back control', () => {
  it('carries the pixel-safe floor on all four dimensions', async () => {
    await renderHeader();
    const style = backStyle();
    const floor = minimumTouchTargetSize();

    for (const key of ['width', 'height', 'minWidth', 'minHeight']) {
      expect(`${key}: ${Number(style[key]) >= floor}`).toBe(`${key}: true`);
    }
    /* And the floor is the shared 44 dp token, not a number that happens to be near it. */
    expect(floor).toBeGreaterThanOrEqual(touchTarget.minimum);
  });

  it('carries no negative offset, so no part of it can fall outside the parent', async () => {
    await renderHeader();
    const style = backStyle();

    /*
      The property responsible for #123. Re-adding `marginLeft: -10` — or reaching for `left: -10`
      instead — fails here, which is the point: the target may not start outside its own origin.
    */
    const pushed = OFFSETS.filter((key) => Number(style[key] ?? 0) < 0).map(
      (key) => `${key}=${String(style[key])}`,
    );
    expect(pushed).toEqual([]);
  });

  it('keeps the chevron where it was, by insetting it instead', async () => {
    await renderHeader();
    const style = backStyle();

    /*
      The optical intent survives: the glyph still sits about 7 dp from the page gutter rather than
      centred in a 44 dp box. It moves inside the target now, so the target itself stays put.
    */
    expect(Number(style.paddingLeft)).toBeGreaterThan(0);
    expect(Number(style.paddingLeft)).toBeLessThan(Number(style.width));
    expect(style.alignItems).toBe('flex-start');
    /* Still vertically centred — the axis that was never wrong. */
    expect(style.justifyContent).toBe('center');
  });

  it('is reachable by its own box rather than by slop the parent also clips', async () => {
    await renderHeader();
    const node = screen.getByTestId('probe-header-back');

    /*
      `hitSlop` stays — it is a courtesy beyond the floor. What it must not be is the thing that
      carries the floor, because it was clipped by the same edge as the box it was extending.
      Deleting it must not drop the control below the minimum, which the first case proves.
    */
    expect(node.props.hitSlop).toBe(8);
    expect(Number(backStyle().width)).toBeGreaterThanOrEqual(minimumTouchTargetSize());
  });

  it('keeps its label, role and destination', async () => {
    const onBack = jest.fn();
    await render(
      <View style={{ overflow: 'hidden' }}>
        <AuthHeader onBack={onBack} title="Welcome back" testID="probe-header" />
      </View>,
    );
    const node = screen.getByTestId('probe-header-back');

    expect(node.props.accessibilityLabel).toBe('Go back');
    expect(node.props.accessibilityRole).toBe('button');
    /* Fired rather than read: a Pressable renders a responder, not an `onPress` prop. */
    await fireEvent.press(node);
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('reserves the full target height in the row above the heading', async () => {
    await renderHeader();
    /*
      Ancestor geometry, in the one dimension a unit test can see: the row is given the target's own
      height, so the box is not asked to fit a shorter parent. The heading stays in its own row below,
      which is what keeps it centred on the page rather than pushed by the control.
    */
    const row = flatten(screen.getByTestId('probe-header-back-row').props.style);
    const floor = minimumTouchTargetSize();

    expect(Number(row.height)).toBeGreaterThanOrEqual(floor);
    /* And the row does not push itself off its own origin either. */
    const pushed = OFFSETS.filter((key) => Number(row[key] ?? 0) < 0);
    expect(pushed).toEqual([]);
  });

  it('renders no control at all when the workflow gives no destination', async () => {
    await render(
      <View style={{ overflow: 'hidden' }}>
        <AuthHeader title="Verify your email" testID="probe-header" />
      </View>,
    );
    /* Absent rather than disabled: focus order must not include a control that does nothing. */
    expect(screen.queryByTestId('probe-header-back')).toBeNull();
  });
});

describe('materially different parents', () => {
  const ORIGINAL = Dimensions.get('window');

  afterEach(async () => {
    await cleanup();
    Dimensions.set({ window: ORIGINAL, screen: ORIGINAL } as never);
  });

  /*
    The layout scale is derived from width, and it only ever downscales. So a narrow device shrinks
    the chevron and the paddings while the floor — read from density — does not move. That asymmetry
    is where a naive `(target - chevron) / 2 - 10` could have gone negative and put the box back
    outside its parent by a different route.
  */
  it.each([
    ['a 320 dp phone', 320],
    ['the 393 dp baseline', 393],
    ['a 480 dp large phone', 480],
  ])('holds the floor and stays inside its origin on %s', async (_label, width) => {
    await cleanup();
    Dimensions.set({
      window: { ...ORIGINAL, width, height: 800 },
      screen: { ...ORIGINAL, width, height: 800 },
    } as never);

    await render(
      <View style={{ overflow: 'hidden' }}>
        <AuthHeader onBack={() => undefined} title="Welcome back" testID="probe-header" />
      </View>,
    );
    const style = backStyle();

    expect(Number(style.width)).toBeGreaterThanOrEqual(minimumTouchTargetSize());
    expect(Number(style.height)).toBeGreaterThanOrEqual(minimumTouchTargetSize());
    expect(Number(style.paddingLeft)).toBeGreaterThanOrEqual(0);
    const pushed = OFFSETS.filter((key) => Number(style[key] ?? 0) < 0);
    expect(pushed).toEqual([]);
  });
});
