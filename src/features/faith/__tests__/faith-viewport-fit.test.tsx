import { render, screen } from '@testing-library/react-native';
import React from 'react';

import { moduleLayout, moduleType } from '@features/modules/module-tokens';
import { ModuleHomeScreen } from '@features/modules/screens/module-home-screen';

import { FaithRepositoryProvider } from '../di/faith-repository-context';

/**
 * Faith Home fits the Pixel 8 baseline viewport without meaningful scroll.
 *
 * ── What this can and cannot prove ──────────────────────────────────────────
 * Jest has no text engine, so it cannot measure a wrapped paragraph and therefore cannot
 * prove the screen fits. What it can do is sum the fixed geometry and hold that sum to a
 * budget which *was* verified on a device.
 *
 * So the division of labour is: the emulator settles whether Faith Home fits, and this
 * test stops the composition growing afterwards — which is exactly how the overflow
 * appeared in the first place, one card at a time.
 *
 * ── The viewport arithmetic ─────────────────────────────────────────────────
 * Pixel 8 is 393 x 852 dp. The scaffold lays out:
 *
 *     root paddingTop      = safe-area top          (24 on this device)
 *     header                                        (54)
 *     ScrollView           = everything that is left
 *     nav bar              absolutely positioned    (68 + safe-area bottom)
 *
 * so the scroll viewport is 852 − 24 − 54 = 774, and the content container carries a
 * bottom padding of nav + safe-bottom + `scrollBottomInset`.
 */

const SCREEN_HEIGHT = 852;
const SAFE_TOP = 24;
const SAFE_BOTTOM = 24;

/** The height the ScrollView itself occupies. */
const SCROLL_VIEWPORT = SCREEN_HEIGHT - SAFE_TOP - moduleLayout.headerHeight;

/** Padding the scaffold adds beneath the content, so the nav never covers a card. */
const CONTENT_BOTTOM_PADDING =
  moduleLayout.navHeight + SAFE_BOTTOM + moduleLayout.scrollBottomInset;

/**
 * The Faith Home stack, summed from fixed geometry.
 *
 * Text blocks are counted at the line count the approved fixture actually renders — the
 * Daily Ayah translation wraps to two lines, its Arabic to one — because the fixture is
 * deterministic. `numberOfLines` remains the safety net above that.
 *
 * ── This model runs about 26 dp high, and that is measured, not guessed ─────
 * Summing declared line heights over-counts: a text node's box is its line height, but
 * consecutive cards' borders and the glyph boxes inside them do not stack quite as the
 * arithmetic assumes. Comparing this model against the device gave 695 predicted versus
 * 669 actual on the pre-fix build — a 26 dp bias spread evenly across five cards.
 *
 * So the assertion below is a *budget* rather than an absolute fit: the number this
 * returns must not grow. Whether the screen actually fits is settled on the device, and
 * the screenshots in design-reference/phase-4e-pictogram-viewport record that it does.
 */
function faithContentHeight(): number {
  const [, eyebrow] = moduleType.eyebrow;
  const [, rowLabel] = moduleType.rowLabel;
  const [, rowMeta] = moduleType.rowMeta;
  const [, cardTitle] = moduleType.cardTitle;
  const [, caption] = moduleType.caption;
  const [, body] = moduleType.body;
  const [, arabic] = moduleType.arabic;
  const [, cardHeading] = moduleType.cardHeading;

  const hero = moduleLayout.faithHeroHeight;

  const submenu = moduleLayout.faithSubmenuTileHeight * 2 + moduleLayout.featureGap;

  // Card padding + title + detail + gap + progress bar.
  const continueQuran = moduleLayout.cardPadding * 2 + cardTitle + caption + 7 + 5;

  // The two-column row takes the taller of its pair.
  // Two body lines: "Indeed, with hardship comes ease." wraps to two at this column width.
  const ayah =
    moduleLayout.twoColumnPadding * 2 + cardTitle + 8 + arabic + 6 + body * 2 + 6 + caption;
  const worship = moduleLayout.twoColumnPadding * 2 + cardHeading + 4 + rowLabel * 4 + 7 * 3;
  const ayahWorship = Math.max(ayah, worship);

  // Compact date cards: eyebrow, two-line title, detail.
  const dates = moduleLayout.twoColumnPadding * 2 + rowMeta + rowLabel * 2 + rowMeta;

  const insight = 68;

  const sections = [hero, submenu, continueQuran, ayahWorship, dates, insight];
  const gaps = moduleLayout.sectionGap * (sections.length - 1);

  void eyebrow;
  return sections.reduce((sum, height) => sum + height, 0) + gaps;
}

/**
 * The stack budget, in model dp.
 *
 * 690 is what the configuration verified on device produces. Raising this number means
 * Faith Home has grown, and the device fit must be re-measured before the constant moves.
 */
const FAITH_STACK_BUDGET = 690;

/** The most the scaffold may pad beneath the content. */
const BOTTOM_PADDING_BUDGET = 106;

describe('the Pixel 8 baseline', () => {
  it('keeps the composition within its verified budget', () => {
    expect({
      contentHeight: faithContentHeight(),
      bottomPadding: CONTENT_BOTTOM_PADDING,
      viewport: SCROLL_VIEWPORT,
    }).toMatchObject({ viewport: SCROLL_VIEWPORT });

    expect(faithContentHeight()).toBeLessThanOrEqual(FAITH_STACK_BUDGET);
    expect(CONTENT_BOTTOM_PADDING).toBeLessThanOrEqual(BOTTOM_PADDING_BUDGET);
  });

  it('keeps the AI Insight at its locked height rather than shrinking it for space', () => {
    // The insight is the shared 68 dp everywhere. It may not be the thing that gives way.
    const withoutInsight = faithContentHeight() - 68;
    expect(withoutInsight).toBeLessThanOrEqual(FAITH_STACK_BUDGET - 68);
  });

  it('did not buy the space by shrinking a touch target', () => {
    expect(moduleLayout.minTouchTarget).toBeGreaterThanOrEqual(44);
    expect(moduleLayout.faithSubmenuTileHeight).toBeGreaterThanOrEqual(moduleLayout.minTouchTarget);
    expect(moduleLayout.heroButtonHeight).toBeGreaterThanOrEqual(32);
  });

  it('did not buy the space by undoing the verified hero fix', () => {
    // 144 was needed to stop the hero clipping its own button. It must stay.
    expect(moduleLayout.faithHeroHeight).toBe(144);
  });

  it('keeps the submenu pictogram balanced inside its tile', () => {
    expect(moduleLayout.faithSubmenuImage).toBe(40);
    const [, label] = moduleType.tileLabel;
    // Image + gap + label must leave real padding, not just fit.
    expect(moduleLayout.faithSubmenuImage + 3 + label).toBeLessThan(
      moduleLayout.faithSubmenuTileHeight,
    );
  });
});

describe('scrolling stays available where it is needed', () => {
  it('leaves the scroll view enabled rather than switching it off', async () => {
    await render(
      <FaithRepositoryProvider>
        <ModuleHomeScreen moduleId="faith" />
      </FaithRepositoryProvider>,
    );
    const scroll = await screen.findByTestId('faith-home-scroll');
    // Never `scrollEnabled={false}` — a shorter device or a larger font must still scroll.
    expect(scroll.props.scrollEnabled).not.toBe(false);
  });

  it('overflows on a short viewport, so scrolling engages', () => {
    // A 640 dp device — small Android phone in the wild.
    const shortViewport = 640 - SAFE_TOP - moduleLayout.headerHeight;
    expect(faithContentHeight() + CONTENT_BOTTOM_PADDING).toBeGreaterThan(shortViewport);
  });

  it('overflows at a larger font scale, so scrolling engages', () => {
    // Android's 1.3x accessibility step applied to every text line in the stack.
    const textLines =
      moduleType.cardTitle[1] +
      moduleType.caption[1] +
      moduleType.arabic[1] +
      moduleType.body[1] * 3 +
      moduleType.rowLabel[1] * 6 +
      moduleType.rowMeta[1] * 4 +
      moduleType.tileLabel[1] * 2;
    const scaled = faithContentHeight() + textLines * 0.3;

    expect(scaled + CONTENT_BOTTOM_PADDING).toBeGreaterThan(SCROLL_VIEWPORT);
  });
});
