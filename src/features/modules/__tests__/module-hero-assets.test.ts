import { moduleThemes } from '@ds/modules/module-themes';
import { getModulePictogram, modulePictograms } from '@features/home/module-pictograms';
import { noorLifeAssets } from '@shared/assets/noorlife-assets';

import { moduleRegistry } from '../module-registry';
import { FRAMEWORK_MODULE_IDS, moduleLayout } from '../module-tokens';

/**
 * The module hero asset lock.
 *
 * Module heroes must show the *same approved PNG pictogram* Main Home's grid shows —
 * never a second illustration, a vector substitute, or a differently-cropped copy. That
 * is a property nothing in the type system enforces, so it is enforced here.
 *
 * The tests are deliberately about identity rather than appearance: they assert that the
 * hero's asset **is the same object** as the tile's, which no amount of visual review can
 * establish and no future refactor can quietly break.
 */

describe.each(FRAMEWORK_MODULE_IDS)('hero asset lock: %s', (moduleId) => {
  const definition = moduleRegistry[moduleId];

  it('uses the same asset for its hero as for its pictogram', () => {
    // The assertion the correction brief asks for by name.
    expect(definition.heroPictogram).toBe(definition.pictogram);
  });

  it('uses the exact asset Main Home renders in its module grid', () => {
    // Main Home is locked, so this is the fixed reference point. If a hero ever diverges
    // from the tile, it fails here rather than at a design review.
    expect(definition.heroPictogram).toBe(getModulePictogram(moduleId));
  });

  it('resolves to a real, non-null asset', () => {
    expect(definition.heroPictogram).toBeDefined();
    expect(definition.heroPictogram).not.toBeNull();
  });
});

describe('there is one canonical asset per module', () => {
  it('gives all seven modules distinct heroes', () => {
    // Guards the opposite failure: every module pointing at one shared placeholder.
    const serialized = FRAMEWORK_MODULE_IDS.map((id) =>
      JSON.stringify(moduleRegistry[id].heroPictogram),
    );
    expect(new Set(serialized).size).toBe(FRAMEWORK_MODULE_IDS.length);
  });

  it('draws every hero from the locked pictogram registry, not a feature-local copy', () => {
    const locked = new Set(Object.values(modulePictograms).map((s) => JSON.stringify(s)));
    for (const id of FRAMEWORK_MODULE_IDS) {
      expect(locked.has(JSON.stringify(moduleRegistry[id].heroPictogram))).toBe(true);
    }
  });

  it('never uses the Noor AI robot as a module hero', () => {
    // Noor AI is the global assistant. A module hero showing it would misrepresent which
    // module the user is in.
    const robot = JSON.stringify(modulePictograms.ai);
    for (const id of FRAMEWORK_MODULE_IDS) {
      expect(JSON.stringify(moduleRegistry[id].heroPictogram)).not.toBe(robot);
    }
  });

  it('covers every module Main Home offers, with no extras', () => {
    // Main Home's grid is the product's module list; the framework must match it exactly
    // apart from the global Noor AI destination.
    const fromMainHome = Object.values(moduleThemes)
      .map((theme) => theme.id)
      .filter((id) => id !== 'main' && id !== 'noor-ai')
      .sort();
    expect([...FRAMEWORK_MODULE_IDS].sort()).toEqual(fromMainHome);
  });
});

describe('hero geometry follows the locked artwork', () => {
  it(`sizes the hero to the artwork’s own aspect ratio`, () => {
    // 1083 x 396 at 3x is 361 x 132 dp, and 361 dp is the content column. Matching it means
    // `cover` neither crops nor stretches the locked asset.
    const contentWidth = moduleLayout.referenceWidth - moduleLayout.pagePadding * 2;
    expect(moduleLayout.heroHeight).toBe(Math.round(contentWidth / (1083 / 396)));
  });

  it(`keeps the copy inside the artwork’s quiet band`, () => {
    /*
     * Was 60-65%, measured off the individual-core-screen mockups where the hero was a flat
     * gradient with a small pictogram on the right. The locked artwork moved the constraint:
     * each asset leaves roughly the left half quiet and puts its subject in the right half,
     * so the copy column follows the artwork. At 62% Finance’s body copy ran over the wallet.
     */
    expect(moduleLayout.heroTextColumnRatio).toBeGreaterThanOrEqual(0.45);
    expect(moduleLayout.heroTextColumnRatio).toBeLessThanOrEqual(0.55);
  });
});

describe('the Entry/Auth medallion inconsistency is real and recorded', () => {
  it('still reads the pre-normalization originals', () => {
    /*
     * Not a passing-by-accident test — an intentional record of a known difference.
     *
     * The onboarding medallions use `noorLifeAssets.modules`, which resolves the
     * originals in `assets/images/pictograms/`, while Main Home and the module heroes use
     * the normalized set. Same artwork, different transparent padding.
     *
     * Correcting it would change an approved Entry/Auth layout, which this pass is scoped
     * out of, so it is tracked in docs/PRE_RELEASE_BACKLOG.md. This test documents the
     * difference so that when the medallions are migrated, the failure here is the
     * reminder to delete it.
     */
    expect(JSON.stringify(noorLifeAssets.modules.faith)).not.toBe(
      JSON.stringify(getModulePictogram('faith')),
    );
  });
});
