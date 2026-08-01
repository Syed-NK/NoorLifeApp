import {
  PIXEL_8,
  PROFILE_CONTENT_HEIGHT,
  PROFILE_HEIGHTS,
  PROFILE_LAYOUT,
  PROFILE_REFERENCE_WIDTH,
  menuCardHeight,
  profileScale,
  shouldEnableScroll,
  usableHeight,
} from '../profile-metrics';
import { PROFILE_MENU } from '../profile-routes';

/**
 * Profile Home's dimensional contract.
 *
 * "It fits one Pixel 8 viewport" is the claim this phase exists to make good on, and a claim
 * checked by eye is a claim that quietly stops being true. These assert it as arithmetic, plus the
 * bands the brief sets for each card, so a component that grows fails here rather than in a
 * screenshot three sessions later.
 */

describe('scale model', () => {
  it('shares Main Home’s 393 dp reference width', () => {
    expect(PROFILE_REFERENCE_WIDTH).toBe(393);
  });

  it('never upscales above 1, whatever the screen width', () => {
    for (const width of [393, 411, 412, 430, 480, 600]) {
      expect(profileScale(width)).toBe(1);
    }
  });

  it('renders a Pixel 8 at exactly baseline scale', () => {
    expect(profileScale(PIXEL_8.width)).toBe(1);
  });

  it('downscales below the reference width', () => {
    expect(profileScale(360)).toBeCloseTo(0.916, 3);
  });
});

describe('the compact vertical budget', () => {
  it('fits the complete screen in one Pixel 8 viewport', () => {
    expect(PROFILE_CONTENT_HEIGHT).toBeLessThanOrEqual(usableHeight(PIXEL_8));
  });

  it('sums the five sections and their gaps to 598 dp', () => {
    expect(PROFILE_CONTENT_HEIGHT).toBe(598);
  });

  it('keeps every section gap inside the 10–12 dp band', () => {
    const gaps = Object.entries(PROFILE_HEIGHTS)
      .filter(([key]) => key.startsWith('gapAfter'))
      .map(([, value]) => value);

    expect(gaps).toHaveLength(4);
    for (const gap of gaps) {
      expect(gap).toBeGreaterThanOrEqual(10);
      expect(gap).toBeLessThanOrEqual(12);
    }
  });

  it('leaves the identity card inside its 76–88 dp band', () => {
    expect(PROFILE_HEIGHTS.identityCard).toBeGreaterThanOrEqual(76);
    expect(PROFILE_HEIGHTS.identityCard).toBeLessThanOrEqual(88);
  });

  it('leaves the membership card inside its 100–116 dp band', () => {
    expect(PROFILE_HEIGHTS.membershipCard).toBeGreaterThanOrEqual(100);
    expect(PROFILE_HEIGHTS.membershipCard).toBeLessThanOrEqual(116);
  });

  it('keeps menu rows inside the 44–48 dp band and above the touch minimum', () => {
    expect(PROFILE_LAYOUT.menu.rowHeight).toBeGreaterThanOrEqual(44);
    expect(PROFILE_LAYOUT.menu.rowHeight).toBeLessThanOrEqual(48);
    expect(PROFILE_LAYOUT.menu.rowHeight).toBeGreaterThanOrEqual(PROFILE_LAYOUT.minTouchTarget);
  });

  it('gives every interactive row at least a 44 dp target', () => {
    for (const height of [
      PROFILE_LAYOUT.minTouchTarget,
      PROFILE_LAYOUT.menu.rowHeight,
      PROFILE_LAYOUT.logout.height,
      PROFILE_LAYOUT.membership.actionHeight,
    ]) {
      expect(height).toBeGreaterThanOrEqual(44);
    }
  });

  it('derives the menu card from five rows rather than restating a number', () => {
    expect(PROFILE_LAYOUT.menu.rows).toBe(PROFILE_MENU.length);
    expect(menuCardHeight()).toBe(5 * 46 + 4 * 1 + 2 * 1);
    expect(PROFILE_HEIGHTS.menuCard).toBe(menuCardHeight());
  });

  it('spends its 112 dp membership budget exactly, with nothing left decorative', () => {
    const { membership } = PROFILE_LAYOUT;
    const used =
      membership.padding * 2 +
      membership.titleRow +
      membership.gapAfterTitle +
      membership.supportingRow +
      membership.gapAfterSupporting +
      membership.actionHeight;

    expect(used).toBe(membership.height);
  });

  it('holds the identity card’s three text lines and its portrait', () => {
    const { identity } = PROFILE_LAYOUT;
    // 21 name + 16 email + 22 plan badge, with the card's two internal gaps.
    const textBlock = 21 + identity.rowGap + 16 + identity.rowGap + 22;

    expect(textBlock + identity.padding * 2).toBeLessThanOrEqual(identity.height);
    expect(identity.avatar + identity.padding * 2).toBeLessThanOrEqual(identity.height);
    // ~44 dp, as the brief specifies for the portrait.
    expect(identity.avatar).toBe(44);
  });

  it('reuses the approved module header geometry', () => {
    expect(PROFILE_LAYOUT.header).toEqual({ height: 54, control: 36, icon: 19 });
  });

  it('uses the locked 16 dp page padding', () => {
    expect(PROFILE_LAYOUT.pagePadding).toBe(16);
  });
});

describe('scroll enablement', () => {
  const pixel8Usable = usableHeight(PIXEL_8);

  it('does not scroll the reference device at the reference font scale', () => {
    expect(shouldEnableScroll(PROFILE_CONTENT_HEIGHT, pixel8Usable)).toBe(false);
  });

  it('scrolls rather than clips once large text grows the content past the viewport', () => {
    // What a large accessibility font size actually produces: wrapped menu labels, a three-line
    // supporting sentence, a taller identity block. The exact number is not the point — that
    // anything past the viewport turns scrolling on is.
    expect(shouldEnableScroll(pixel8Usable + 1, pixel8Usable)).toBe(true);
    expect(shouldEnableScroll(1180, pixel8Usable)).toBe(true);
  });

  it('ignores sub-pixel overflow, so a fitting screen never bounces', () => {
    expect(shouldEnableScroll(pixel8Usable + 0.25, pixel8Usable)).toBe(false);
  });

  it('stays off before either measurement has arrived', () => {
    expect(shouldEnableScroll(0, 0)).toBe(false);
    expect(shouldEnableScroll(900, 0)).toBe(false);
    expect(shouldEnableScroll(0, 840)).toBe(false);
  });

  it('scrolls a short device even at the reference font scale', () => {
    // A 640 dp usable height — a small handset — cannot hold 598 dp plus its chrome comfortably.
    expect(shouldEnableScroll(PROFILE_CONTENT_HEIGHT, 560)).toBe(true);
  });
});
