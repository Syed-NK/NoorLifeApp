import { render, screen } from '@testing-library/react-native';

import { SPLASH_SOURCE } from '../entry-auth-assets';
import { entryAuthColors, entryAuthLayout, entryAuthScale } from '../entry-auth-tokens';
import { SplashScreen, resolveSplashResizeMode } from '../screens/splash-screen';

describe('splash resize mode', () => {
  /** Source-pixel crop per side that `cover` would take at a given viewport aspect. */
  const cropPerSide = (w: number, h: number) =>
    (SPLASH_SOURCE.width - (w / h) * SPLASH_SOURCE.height) / 2;

  it('uses cover on a Pixel 8, where the crop stays inside the background band', () => {
    // 411.4 x 914.3 dp: cover crops ~11 px per side of an 852 px-wide source, and the artwork
    // carries 38 px of pure background there, so nothing meaningful is lost.
    expect(cropPerSide(411.4, 914.3)).toBeLessThan(SPLASH_SOURCE.contentSafeInsetX);
    expect(resolveSplashResizeMode(411.4, 914.3)).toBe('cover');
  });

  it('uses cover at the locked 393 x 852 baseline', () => {
    expect(resolveSplashResizeMode(393, 852)).toBe('cover');
  });

  it('falls back to contain once cover would cut into the artwork', () => {
    // A 21.9:9 viewport crops past the 38 px safe band.
    const tall = { w: 393, h: 956 };
    expect(cropPerSide(tall.w, tall.h)).toBeGreaterThan(SPLASH_SOURCE.contentSafeInsetX);
    expect(resolveSplashResizeMode(tall.w, tall.h)).toBe('contain');
  });

  it('uses contain on a viewport wider than the artwork, which cover would crop vertically', () => {
    // A tablet in landscape: cover would scale to fill width and cut the tagline off the bottom.
    expect(resolveSplashResizeMode(1024, 768)).toBe('contain');
  });

  it('never reports a mode for a degenerate viewport that could divide by zero', () => {
    expect(resolveSplashResizeMode(0, 0)).toBe('contain');
    expect(resolveSplashResizeMode(393, 0)).toBe('contain');
  });
});

describe('Splash screen', () => {
  it('renders the locked artwork and nothing else', async () => {
    await render(<SplashScreen />);

    expect(screen.getByTestId('splash-artwork')).toBeTruthy();
    // No spinner, no progress text, no re-typeset wordmark: the design lock forbids altering
    // the composition, and the phase prompt forbids a fake progress indicator.
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(screen.queryByText(/loading/i)).toBeNull();
    expect(screen.queryByText('NoorLife')).toBeNull();
  });

  it('announces the brand and tagline to a screen reader', async () => {
    await render(<SplashScreen />);

    expect(
      screen.getByLabelText('NoorLife — Your family, your day, beautifully in sync.'),
    ).toBeTruthy();
  });

  it('paints the Soft Mint page background behind the artwork', async () => {
    await render(<SplashScreen />);

    const root = screen.getByTestId('splash-screen');
    expect(root.props.style).toEqual(
      expect.objectContaining({ backgroundColor: entryAuthColors.pageBackground }),
    );
  });
});

describe('entry-auth layout scale', () => {
  it('never scales above 1, so a wider handset gets margins rather than bigger cards', () => {
    expect(entryAuthScale(411.4)).toBe(1);
    expect(entryAuthScale(430)).toBe(1);
    expect(entryAuthScale(entryAuthLayout.referenceWidth)).toBe(1);
  });

  it('scales down proportionally on a narrower handset', () => {
    expect(entryAuthScale(360)).toBeCloseTo(0.916, 4);
    expect(entryAuthScale(320)).toBeCloseTo(0.8142, 4);
  });

  it('keeps controls within the rejection gates', () => {
    // "Buttons exceed 50dp height without accessibility reason" is a listed reject.
    expect(entryAuthLayout.buttonHeight).toBeLessThanOrEqual(50);
    expect(entryAuthLayout.buttonHeight).toBeGreaterThanOrEqual(entryAuthLayout.minTouchTarget);
    expect(entryAuthLayout.inputHeight).toBeGreaterThanOrEqual(48);
    expect(entryAuthLayout.pagePadding).toBe(16);
    expect(entryAuthLayout.cardRadius).toBeGreaterThanOrEqual(14);
    expect(entryAuthLayout.cardRadius).toBeLessThanOrEqual(16);
  });
});
