import fs from 'node:fs';
import path from 'node:path';

import { render, screen } from '@testing-library/react-native';
import React from 'react';

import { installMockLatencyTimers } from '@/test-support/mock-latency-timers';

import { FaithRepositoryProvider } from '../di/faith-repository-context';
import { noorAIRobot, noorAIRobotAccessibilityLabel } from '../faith-ai-assets';
import { FaithAiScreen } from '../screens/faith-ai-screen';

/**
 * The approved Noor AI robot is used as approved.
 *
 * ── What this protects, and why arithmetic rather than a screenshot ─────────
 * The brief's rules for this asset are "preserve its aspect ratio and colours; do not crop its face,
 * stretch it, recolour it or overlay text on it". Four of those five are properties of how the image
 * is *drawn*, and three of them are checkable exactly:
 *
 *   • aspect ratio — the rendered box's ratio against the file's own ratio;
 *   • no crop and no stretch — `resizeMode="contain"`, which is the only mode that does neither;
 *   • no recolour — the absence of `tintColor` on every render of it.
 *
 * A screenshot review catches a stretched robot only if the reviewer measures it, and catches a
 * regression only if somebody looks again. These assertions fail on the commit that breaks them.
 *
 * "No text over it" is the one rule left to review: it is a question about sibling layout rather than
 * about the image, and asserting the absence of an overlay would mean enumerating every element that
 * is not one.
 */

installMockLatencyTimers(() => renderAi());

async function renderAi() {
  await render(
    <FaithRepositoryProvider>
      <FaithAiScreen />
    </FaithRepositoryProvider>,
  );
  return screen;
}

/** The asset's intrinsic ratio, read from the PNG header rather than restated as a constant. */
const ASSET = (() => {
  const file = path.join(
    process.cwd(),
    'assets',
    'images',
    'modules',
    'faith',
    'noor-ai-robot.png',
  );
  const bytes = fs.readFileSync(file);
  // PNG: the IHDR width and height are big-endian uint32s at byte 16 and byte 20.
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  return { width, height, ratio: width / height, bytes: bytes.length };
})();

describe('the robot asset itself', () => {
  it('is the resampled approved artwork, at the source aspect ratio', () => {
    // The approved source is 1024x1536. Halved on both axes, so the ratio is identical rather than
    // merely close, and a future resample that changed the shape would fail here.
    expect(ASSET.width).toBe(512);
    expect(ASSET.height).toBe(768);
    expect(ASSET.ratio).toBeCloseTo(1024 / 1536, 6);
  });

  it('is small enough to ship on the hero of a screen that must open promptly', () => {
    // 395 KB at the time of writing. The bound is a ceiling, not a measurement to chase — it exists
    // so a re-export at full resolution (1,239 KB) cannot land unnoticed.
    expect(ASSET.bytes).toBeLessThan(600_000);
  });

  it('is reached through the shared constant, which carries its own spoken label', () => {
    expect(noorAIRobot).toBeDefined();
    expect(noorAIRobotAccessibilityLabel).toContain('Noor AI');
  });
});

describe('every place the robot is drawn', () => {
  /**
   * Both touchpoints, by testID.
   *
   * The hero and the welcome card are the two the brief names, and they are the two that exist:
   * the welcome card *is* the empty state — it renders exactly while `turns.length === 0` — so
   * there is no third surface to cover.
   */
  const SITES: readonly string[] = ['faith-hero-ai-artwork', 'faith-ai-welcome-robot'];

  it.each(SITES)('%s neither crops, stretches nor recolours the robot', async (testID) => {
    const view = await renderAi();
    const image = await view.findByTestId(testID);

    const style = image.props.style as { tintColor?: unknown } | undefined;

    /**
     * `contain` is what carries "preserve the aspect ratio", "do not crop" and "do not stretch" —
     * all three, at every box shape.
     *
     * `cover` crops to fill, `stretch` distorts to fill, and `center` can overflow the box. `contain`
     * is the only mode that fits the whole image inside the box with its proportions intact, so it
     * holds the guarantee independently of what shape the box happens to be. That matters here: see
     * the hero case below, where the box is deliberately square.
     */
    expect(image.props.resizeMode).toBe('contain');

    // Never tinted. A tint on a full-colour asset recolours it wholesale, which the brief forbids.
    expect(style?.tintColor).toBeUndefined();
  });

  /**
   * The welcome card's box is sized *for this asset*, so its own ratio is asserted.
   *
   * 72x108 dp is 2:3, the robot's own proportions, so it fills the box exactly with no letterboxing.
   * This is the assertion that would catch somebody "fixing" a layout by nudging one axis.
   */
  it('gives the welcome card a box at the robot’s own 2:3 proportions', async () => {
    const view = await renderAi();
    const image = await view.findByTestId('faith-ai-welcome-robot');
    const style = image.props.style as { width: number; height: number };

    expect(typeof style.width).toBe('number');
    expect(typeof style.height).toBe('number');
    expect(style.width / style.height).toBeCloseTo(ASSET.ratio, 3);
  });

  /**
   * The hero's box is square, and that is correct rather than a defect.
   *
   * ── Why it is not sized to the robot ────────────────────────────────────────
   * `FaithSectionHero` draws the artwork band for all ten Faith heroes, and the other nine carry
   * square tile pictograms. Its box is `pictogram x pictogram` for that reason, and the geometry is
   * locked by `faith-hero-geometry` so that every Faith hero is measurably the same rectangle.
   *
   * A 2:3 robot inside a square box with `contain` letterboxes: it renders at full height and about
   * two thirds of the band's width, centred, with its proportions exact. Nothing is cropped and
   * nothing is distorted — the robot is simply narrower than the reserved band, which is the honest
   * trade for one shared hero component. Asserted so the square box is understood as a decision.
   */
  it('draws the hero robot in the shared square pictogram band, letterboxed not distorted', async () => {
    const view = await renderAi();
    const image = await view.findByTestId('faith-hero-ai-artwork');
    const style = image.props.style as { width: number; height: number };

    expect(style.width).toBe(style.height);
    expect(image.props.resizeMode).toBe('contain');
  });

  it('does not announce itself twice on the welcome card', async () => {
    const view = await renderAi();
    const image = await view.findByTestId('faith-ai-welcome-robot');
    // The greeting beside it already names Noor AI, so the image is decorative there.
    expect(image.props.accessible).toBe(false);
  });
});
