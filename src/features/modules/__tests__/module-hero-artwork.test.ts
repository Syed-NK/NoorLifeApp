import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { getModulePictogram } from '@features/home/module-pictograms';
import { noorLifeAssets } from '@shared/assets/noorlife-assets';

import { moduleRegistry } from '../module-registry';
import { FRAMEWORK_MODULE_IDS, moduleLayout } from '../module-tokens';

/**
 * The locked hero artwork.
 *
 * These assets are authoritative: not to be regenerated, redrawn, substituted, tinted, or
 * replaced by a module pictogram. Most of that is a review rule, but the parts a test can
 * hold, it holds — the canvas, the mapping, and the separation from the pictogram registry.
 */

const HEROES_DIR = join(process.cwd(), 'assets', 'images', 'modules', 'heroes');

/** Reads a PNG's IHDR without decoding it. */
function intrinsicSize(file: string): { width: number; height: number } {
  const buffer = readFileSync(join(HEROES_DIR, file));
  // PNG: 8-byte signature, then a length+type chunk header, then IHDR's width/height.
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

const EXPECTED_MAPPING = [
  ['noorAI', '02-noor-ai-hero.png'],
  ['faith', '03-faith-hero.png'],
  ['health', '04-health-hero.png'],
  ['planner', '05-planner-hero.png'],
  ['finance', '06-finance-hero.png'],
  ['learning', '07-learning-hero.png'],
  ['family', '08-family-hero.png'],
  ['goals', '09-goals-hero.png'],
] as const;

describe('the eight hero files', () => {
  it.each(EXPECTED_MAPPING)('%s → %s exists at the locked canvas', (_key, file) => {
    // The README fixes 1083 x 396. That is 361 x 132 dp at 3x — exactly the content
    // column — which is why the hero height can render each asset one-to-one.
    expect(intrinsicSize(file)).toEqual({ width: 1083, height: 396 });
  });

  it('gives all eight identical intrinsic dimensions', () => {
    const sizes = EXPECTED_MAPPING.map(([, file]) => JSON.stringify(intrinsicSize(file)));
    expect(new Set(sizes).size).toBe(1);
  });

  it('matches the hero height token to the artwork’s own aspect ratio', () => {
    const { width, height } = intrinsicSize('03-faith-hero.png');
    const contentWidth = moduleLayout.referenceWidth - moduleLayout.pagePadding * 2;
    // If these ever disagree, `cover` starts cropping or the card starts letterboxing.
    expect(moduleLayout.heroHeight).toBe(Math.round(contentWidth / (width / height)));
  });

  it('does not ship the preview contact sheet', () => {
    // `00-module-hero-contact-sheet.png` is preview-only and must never reach the bundle.
    expect(() => intrinsicSize('00-module-hero-contact-sheet.png')).toThrow();
  });
});

describe('the asset registry', () => {
  it('exposes exactly the eight heroes', () => {
    expect(Object.keys(noorLifeAssets.moduleHeroes).sort()).toEqual(
      EXPECTED_MAPPING.map(([key]) => key).sort(),
    );
  });

  it('gives every hero a distinct asset', () => {
    const sources = Object.values(noorLifeAssets.moduleHeroes).map((s) => JSON.stringify(s));
    expect(new Set(sources).size).toBe(sources.length);
  });
});

describe.each(FRAMEWORK_MODULE_IDS)('module hero artwork: %s', (moduleId) => {
  const definition = moduleRegistry[moduleId];

  it('references its own locked hero, or none where none is honest', () => {
    /*
      Health is the exception, and the exception is the point.

      `04-health-hero.png` draws a rising line chart with plotted node markers across the sky. On a
      screen that states no health source exists, that reads as the user’s trend — so issue #27
      unregisters it rather than crop it, because `resizeMode="cover"` gives no crop and any offset
      would depend on the hero’s aspect ratio. The asset stays in the repository for whenever a real
      provider makes a trend true.
    */
    if (moduleId === 'health') {
      expect(definition.heroArtwork).toBeUndefined();
      return;
    }
    // The asset registry keys Noor AI as `noorAI`; module ids are kebab-case.
    const key = moduleId === 'noor-ai' ? 'noorAI' : moduleId;
    expect(definition.heroArtwork).toBe(noorLifeAssets.moduleHeroes[key]);
  });

  it('never uses a pictogram as its hero artwork', () => {
    /*
     * The rule this exists for: "Never place the small Main Home module pictogram over
     * these hero images", and its corollary — never use one *as* the hero. The two
     * registries must stay disjoint, and identity comparison is the only way to be sure.
     */
    expect(definition.heroArtwork).not.toBe(definition.pictogram);
    expect(definition.heroArtwork).not.toBe(getModulePictogram(moduleId));
    expect(JSON.stringify(definition.heroArtwork)).not.toBe(
      JSON.stringify(getModulePictogram(moduleId)),
    );
  });

  it('places its copy on whichever side its artwork leaves quiet', () => {
    // Seven assets put their subject right and leave the left quiet. Noor AI is the mirror:
    // the waving robot is on the left, so its copy goes right.
    expect(definition.heroCopySide).toBe(moduleId === 'noor-ai' ? 'right' : 'left');
  });

  it('carries only the scrim its own artwork requires', () => {
    /*
     * Measured per asset: the 95th-percentile luminance of its copy area, solved for the
     * opacity at which white text clears 4.5:1. Faith's night sky needs none at 8.90:1;
     * Health's bright sky needs the most at 1.60:1. An arbitrary blanket overlay would dim
     * artwork that does not need it, which the brief rules out.
     */
    const REQUIRED: Readonly<Record<string, number>> = {
      'noor-ai': 0, //  its copy area measures 8.61:1 — no scrim needed
      faith: 0,
      health: 0.45,
      planner: 0,
      finance: 0.2,
      learning: 0,
      family: 0,
      goals: 0.2,
    };
    expect(definition.heroScrim).toBe(REQUIRED[moduleId]);
    expect(definition.heroScrim).toBeGreaterThanOrEqual(0);
    // A scrim heavy enough to hide the artwork would defeat the point of having it.
    expect(definition.heroScrim).toBeLessThanOrEqual(0.5);
  });
});
