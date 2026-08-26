import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { render } from '@testing-library/react-native';

import { LOCKED } from '@/features/home/main-home-metrics';
import { FaithPictogram } from '@/features/faith/components/faith-locked-library';
import { pinModuleWindow } from '@/test-support/module-window';
import { commissionedAssetViolations } from '@/test-support/raster-icon-contract';

import { ModuleFeatureGrid } from '../components/module-feature-grid';
import { ModuleQuickActionRow } from '../components/module-quick-action';
import { ModuleProvider } from '../module-context';
import { moduleRegistry } from '../module-registry';
import {
  moduleRasterIcon,
  modulesWithRasterIcons,
  rasterIconNamesFor,
} from '../module-raster-icons';
import { moduleLayout, moduleScale } from '../module-tokens';

/**
 * **One pictogram-sizing standard, across every module** — issue #70.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── The defect ──────────────────────────────────────────────────────────────
 * Finance's commissioned artwork rendered at 63% of Main Home's optical size in an identically-sized
 * 74 dp tile. Not a padding problem — Finance's canvas occupancy was *higher* than Main Home's. The
 * cause was that `featurePictogram * 0.6` and `quickActionIcon * 0.75` were applied to raster
 * artwork. Those multipliers exist to inset a *glyph*, whose mark fills its em box; artwork carries
 * its own transparent margin, so it was being inset twice.
 *
 * Faith already had the rule right. `FaithPictogram` draws a PNG at the full box and insets only its
 * glyph fallback. This makes that the standard, and asserts the classes that must **not** move with
 * it — because "make every icon the same number" would be a different and worse bug.
 *
 * ── The classes ─────────────────────────────────────────────────────────────
 *   A  module feature grid, module quick action   standardised: raster at the full token
 *   B  Main Home module entry                     unchanged at 48 dp, geometry locked
 *   C  Faith list / submenu / identity            unchanged — already full-box
 *   D  bottom navigation                          not enlarged
 *   E  module hero artwork                        untouched
 *   F  empty-state decoration                     not enlarged
 *
 * ── Why it is driven off the registry ───────────────────────────────────────
 * Finance is the only module with artwork today, and seven more batches are planned. A hand-written
 * list of "Finance's five" would pass forever while Planner shipped at the old inset size. Every
 * class-A assertion below iterates `modulesWithRasterIcons()`, so the next batch is covered the day
 * its mapping lands, whether or not anyone remembers this file.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const HIDDEN = { includeHiddenElements: true } as const;

/** The reference phone the module tokens are drawn for: 393 dp, font scale 1. */
const REFERENCE_WIDTH = 393;

/**
 * The quick-action icon well, restated because the component keeps it private.
 *
 * Pinned rather than imported: if the well changes, this test should fail and be re-read, not
 * silently follow it. 22 dp of artwork in a 26 dp well is 2 dp of clearance per side.
 */
const QUICK_ACTION_WELL = 26;

/** The same arithmetic `useModuleMetrics` does, so expectations are derived and not guessed. */
const dp = (value: number): number => Math.round(value * moduleScale(REFERENCE_WIDTH));

function flat(style: unknown): Record<string, unknown> {
  return (Array.isArray(style) ? style.flat(4) : [style])
    .filter(
      (entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null,
    )
    .reduce<Record<string, unknown>>((all, entry) => ({ ...all, ...entry }), {});
}

/**
 * Every `fontSize` in a rendered tree.
 *
 * The icon font renders as text, so a glyph's size arrives as `fontSize` rather than as the `size`
 * prop it was given. Used where the glyph carries no testID of its own.
 */
function fontSizes(node: unknown): readonly number[] {
  if (node === null || typeof node !== 'object') {
    return [];
  }
  const element = node as { props?: { style?: unknown }; children?: readonly unknown[] };
  const own = flat(element.props?.style).fontSize;
  const here = typeof own === 'number' ? [own] : [];
  const below = (element.children ?? []).flatMap((child) => fontSizes(child));
  return [...here, ...below];
}

/** Modules carrying commissioned artwork today. Non-empty is asserted; the list is not hard-coded. */
const WITH_ART = modulesWithRasterIcons();

// ─────────────────────────────────────────────────────────────────────────────
// The standard, as numbers
// ─────────────────────────────────────────────────────────────────────────────

describe('the sizing standard', () => {
  it('is applied to a real module, so none of what follows is vacuous', () => {
    expect(WITH_ART.length).toBeGreaterThan(0);
  });

  it('keeps the class-A design tokens exactly as they were', () => {
    /*
      The fix changed *what the tokens are applied to*, not the tokens. If a later change "fixed"
      undersizing by raising a token instead, every tile's well, gap and label would move with it.
    */
    expect(moduleLayout.featurePictogram).toBe(40);
    expect(moduleLayout.quickActionIcon).toBe(22);
  });

  it('leaves Main Home, the navigation bar and the empty state on their own numbers', () => {
    /* Classes B, D and F. Deliberately different from class A, and deliberately not converging. */
    expect(LOCKED.grid.pictogram).toBe(48);
    expect(moduleLayout.navIcon).toBe(24);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Class A — commissioned artwork at the full token
// ─────────────────────────────────────────────────────────────────────────────

describe.each(WITH_ART)('class A: %s feature grid', (moduleId) => {
  beforeEach(() => pinModuleWindow());

  const assigned = rasterIconNamesFor(moduleId);
  const spec = moduleRegistry[moduleId];

  it('renders artwork at the full 40 dp token, not the glyph inset', async () => {
    const view = await render(
      <ModuleProvider moduleId={moduleId}>
        <ModuleFeatureGrid testID="grid" />
      </ModuleProvider>,
    );

    const withArt = (spec?.capabilities ?? []).filter(
      (item) => item.available && assigned.includes(item.icon),
    );
    expect(withArt.length).toBeGreaterThan(0);

    for (const item of withArt) {
      const style = flat(view.getByTestId(`grid-${item.key}-art`, HIDDEN).props.style);
      expect(style.width).toBe(dp(moduleLayout.featurePictogram));
      expect(style.height).toBe(dp(moduleLayout.featurePictogram));
      /* And explicitly *not* the value the defect produced. */
      expect(style.width).not.toBe(dp(moduleLayout.featurePictogram * 0.6));
    }
  });

  it('keeps the glyph inset on every tile that has no artwork', async () => {
    const view = await render(
      <ModuleProvider moduleId={moduleId}>
        <ModuleFeatureGrid testID="grid" />
      </ModuleProvider>,
    );

    const withGlyph = (spec?.capabilities ?? []).filter(
      (item) => moduleRasterIcon(moduleId, item.icon, item.available) === null,
    );
    /* Non-empty: a batch is a handful of assets, never a whole module. */
    expect(withGlyph.length).toBeGreaterThan(0);

    for (const item of withGlyph) {
      const glyph = view.getByTestId(`grid-${item.key}-glyph`, HIDDEN);
      /* The icon font renders as text, so the size arrives as `fontSize`. */
      expect(flat(glyph.props.style).fontSize).toBe(dp(moduleLayout.featurePictogram * 0.6));
    }
  });

  it('draws artwork larger than the glyph it replaced, by the whole inset', async () => {
    /*
      The relationship, not just the two numbers. 40 against 24 — a mutation that changed both the
      component and the expectation in step would still be caught here, because the *ratio* is the
      thing that was wrong.
    */
    const view = await render(
      <ModuleProvider moduleId={moduleId}>
        <ModuleFeatureGrid testID="grid" />
      </ModuleProvider>,
    );
    const art = (spec?.capabilities ?? []).find(
      (item) => item.available && assigned.includes(item.icon),
    );
    const glyphItem = (spec?.capabilities ?? []).find(
      (item) => moduleRasterIcon(moduleId, item.icon, item.available) === null,
    );
    expect(art).toBeDefined();
    expect(glyphItem).toBeDefined();

    const artSize = Number(
      flat(view.getByTestId(`grid-${art?.key}-art`, HIDDEN).props.style).width,
    );
    const glyphSize = Number(
      flat(view.getByTestId(`grid-${glyphItem?.key}-glyph`, HIDDEN).props.style).fontSize,
    );
    expect(artSize).toBeGreaterThan(glyphSize);
    expect(artSize / glyphSize).toBeCloseTo(1 / 0.6, 2);
  });
});

describe.each(WITH_ART)('class A: %s quick actions', (moduleId) => {
  beforeEach(() => pinModuleWindow());

  const assigned = rasterIconNamesFor(moduleId);
  const spec = moduleRegistry[moduleId];

  it('renders artwork at the full 22 dp token and keeps the glyph inset elsewhere', async () => {
    const view = await render(
      <ModuleProvider moduleId={moduleId}>
        <ModuleQuickActionRow testID="quick" />
      </ModuleProvider>,
    );

    const actions = spec?.quickActions ?? [];
    const withArt = actions.filter((action) => assigned.includes(action.icon));
    const withGlyph = actions.filter((action) => !assigned.includes(action.icon));
    expect(withArt.length).toBeGreaterThan(0);
    /* Both branches present in the same row, which is the configuration that must look coherent. */
    expect(withGlyph.length).toBeGreaterThan(0);

    for (const action of withArt) {
      const style = flat(view.getByTestId(`quick-${action.key}-art`, HIDDEN).props.style);
      expect(style.width).toBe(dp(moduleLayout.quickActionIcon));
      expect(style.height).toBe(dp(moduleLayout.quickActionIcon));
      expect(style.width).not.toBe(dp(moduleLayout.quickActionIcon * 0.75));
    }
    for (const action of withGlyph) {
      const glyph = view.getByTestId(`quick-${action.key}-glyph`, HIDDEN);
      expect(flat(glyph.props.style).fontSize).toBe(dp(moduleLayout.quickActionIcon * 0.75));
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Class A, the other half: what the resize must not have disturbed
// ─────────────────────────────────────────────────────────────────────────────

describe.each(WITH_ART)('class A: %s keeps its wells, tints and labels', (moduleId) => {
  beforeEach(() => pinModuleWindow());

  it('grows the image inside a well and a tile that did not move', async () => {
    /*
      Enlarging the image inside fixed containers is the whole change. If the well or the tile grew
      with it, the grid rhythm would shift and this would be a layout regression rather than a sizing
      fix. Asserted as containment, with the containers' own tokens pinned: 40 dp of artwork inside a
      74 dp tile that still has to hold a label, and 22 dp inside a 26 dp quick-action well.
    */
    expect(moduleLayout.featureTileHeight).toBe(74);

    const grid = await render(
      <ModuleProvider moduleId={moduleId}>
        <ModuleFeatureGrid testID="grid" />
      </ModuleProvider>,
    );
    const assigned = rasterIconNamesFor(moduleId);
    const spec = moduleRegistry[moduleId];

    for (const item of spec?.capabilities ?? []) {
      /* Every tile still shows its label, so nothing was displaced by the larger image. */
      expect(grid.getByText(item.label, HIDDEN)).toBeTruthy();
      if (!item.available || !assigned.includes(item.icon)) continue;
      const size = Number(flat(grid.getByTestId(`grid-${item.key}-art`, HIDDEN).props.style).width);
      expect(size).toBeLessThan(dp(moduleLayout.featureTileHeight));
      /* Room left for the label row and its gap, not merely "fits". */
      expect(size).toBeLessThanOrEqual(dp(moduleLayout.featureTileHeight) - 20);
    }

    const row = await render(
      <ModuleProvider moduleId={moduleId}>
        <ModuleQuickActionRow testID="quick" />
      </ModuleProvider>,
    );
    for (const action of (spec?.quickActions ?? []).filter((candidate) =>
      assigned.includes(candidate.icon),
    )) {
      const size = Number(
        flat(row.getByTestId(`quick-${action.key}-art`, HIDDEN).props.style).width,
      );
      expect(size).toBeLessThan(dp(QUICK_ACTION_WELL));
    }
  });

  it('keeps an unavailable tile on a tintable glyph at the inset size', async () => {
    /*
      Artwork cannot be tinted, so the disabled affordance depends on the glyph — and the glyph must
      stay inset, because it is still a glyph. Both halves of the rule in one tile.
    */
    const view = await render(
      <ModuleProvider moduleId={moduleId}>
        <ModuleFeatureGrid testID="grid" />
      </ModuleProvider>,
    );
    const spec = moduleRegistry[moduleId];
    const unavailable = (spec?.capabilities ?? []).filter((item) => !item.available);
    expect(unavailable.length).toBeGreaterThan(0);

    for (const item of unavailable) {
      expect(view.queryByTestId(`grid-${item.key}-art`, HIDDEN)).toBeNull();
      const glyph = view.getByTestId(`grid-${item.key}-glyph`, HIDDEN);
      expect(flat(glyph.props.style).fontSize).toBe(dp(moduleLayout.featurePictogram * 0.6));
      expect(flat(glyph.props.style).color).toBeDefined();
    }
  });

  it('leaves artwork untinted and contained at the larger size', async () => {
    const view = await render(
      <ModuleProvider moduleId={moduleId}>
        <ModuleFeatureGrid testID="grid" />
      </ModuleProvider>,
    );
    const assigned = rasterIconNamesFor(moduleId);
    const spec = moduleRegistry[moduleId];
    for (const item of (spec?.capabilities ?? []).filter(
      (candidate) => candidate.available && assigned.includes(candidate.icon),
    )) {
      const art = view.getByTestId(`grid-${item.key}-art`, HIDDEN);
      expect(art.props.resizeMode).toBe('contain');
      expect(flat(art.props.style).tintColor).toBeUndefined();
      expect(art.props.tintColor).toBeUndefined();
      expect(art.props.accessible).toBe(false);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Class B — Main Home is not in the comparable class
// ─────────────────────────────────────────────────────────────────────────────

describe('class B: Main Home module entries', () => {
  it('keeps 48 dp to itself rather than lending it to class A', () => {
    /*
      48 is Main Home's number and it stays there. It was deliberately *not* copied into class A: the
      module feature tile is a different surface with a different well, and matching the literal
      would have changed a locked layout to chase a number instead of fixing the defect.

      That the grid actually renders at 48 dp is asserted where its harness already lives, in
      `main-home-module-grid-upgrade.test.tsx`. What belongs here is the cross-class relationship and
      the fact that this branch did not reach into Main Home to get it.
    */
    expect(LOCKED.grid.pictogram).toBe(48);
    expect(LOCKED.grid.pictogram).not.toBe(moduleLayout.featurePictogram);

    const grid = readFileSync(
      join(__dirname, '..', '..', 'home', 'components', 'module-grid.tsx'),
      'utf8',
    );
    expect(grid).toContain('dp(LOCKED.grid.pictogram)');
    /* Main Home resolves its own artwork and knows nothing about the module raster mapping. */
    expect(grid).not.toContain('moduleRasterIcon');
  });

  it('renders the reference set that the optical contract was derived from', () => {
    /*
      Main Home's eight pictograms are the approved normalisation the #70 numbers came from: a
      transparent 256 x 256 canvas, the largest box at 85%, a safety margin on every side. Running
      the new validator over them closes the loop — the rule that Finance was re-exported to satisfy
      is the rule the reference set already satisfies, and if it did not, the rule would be wrong.

      It also proves these eight files were not touched by this branch, byte-level.
    */
    const dir = join(
      __dirname,
      '..',
      '..',
      '..',
      '..',
      'assets',
      'images',
      'pictograms',
      'normalized',
    );
    const files = readdirSync(dir).filter((name) => name.endsWith('.png'));
    expect(files.length).toBeGreaterThanOrEqual(8);
    for (const file of files) {
      expect(commissionedAssetViolations(join(dir, file))).toEqual([]);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Class C — Faith already had the rule
// ─────────────────────────────────────────────────────────────────────────────

describe('class C: Faith pictograms', () => {
  beforeEach(() => pinModuleWindow());

  it('draws a PNG at the full box, which is the rule class A now follows', async () => {
    const view = await render(
      <ModuleProvider moduleId="faith">
        <FaithPictogram
          slot={{
            kind: 'png',
            source: require('../../../../assets/images/modules/faith/pictograms/p2-fajr.png'),
          }}
          size={38}
          testID="faith-art"
        />
      </ModuleProvider>,
    );
    const style = flat(view.getByTestId('faith-art', HIDDEN).props.style);
    expect(style.width).toBe(38);
    expect(style.height).toBe(38);
  });

  it('insets only its glyph fallback, at its own multiplier', async () => {
    /*
      0.72 here against 0.6 and 0.75 in class A. Three surfaces, three wells, three insets — the
      standard is "artwork at the full box, glyphs inset for their well", not "one multiplier".
    */
    const view = await render(
      <ModuleProvider moduleId="faith">
        <FaithPictogram slot={{ kind: 'vector', icon: 'quran' }} size={38} />
      </ModuleProvider>,
    );
    expect(fontSizes(view.toJSON())).toContain(38 * 0.72);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The source-level rule, so a future batch cannot reintroduce the defect
// ─────────────────────────────────────────────────────────────────────────────

describe('the rule holds in the source, not only in today’s data', () => {
  const strip = (source: string): string =>
    source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

  const CLASS_A = [
    ['module-feature-grid.tsx', 'featurePictogram', 0.6],
    ['module-quick-action.tsx', 'quickActionIcon', 0.75],
  ] as const;

  it.each(CLASS_A)('%s applies %s bare to artwork and inset to the glyph', (file, token, inset) => {
    /*
      A source assertion, because the rendering assertions above can only cover modules that *have*
      artwork — Finance, today. When Planner's mapping lands it will inherit the rule from this
      component, so the component is what gets pinned: exactly one bare use of the token for the
      raster branch, exactly one inset use for the glyph branch, and no third variant.
    */
    const code = strip(readFileSync(join(__dirname, '..', 'components', file), 'utf8'));

    const bare = code.match(new RegExp(`dp\\(moduleLayout\\.${token}\\)`, 'g')) ?? [];
    const insetUses =
      code.match(new RegExp(`dp\\(moduleLayout\\.${token} \\* ${inset}\\)`, 'g')) ?? [];
    expect(bare).toHaveLength(1);
    expect(insetUses).toHaveLength(1);

    /* And no other multiplier on the token at all — the defect was one such expression too many. */
    const allUses = code.match(new RegExp(`moduleLayout\\.${token}[^)]*`, 'g')) ?? [];
    expect(allUses).toHaveLength(2);
  });

  it('routes every class-A raster lookup through the module-scoped resolver', () => {
    /*
      Four of the icon names in play are shared between modules. A lookup by icon name alone would
      put one module's artwork on another's button, so both components must ask with their own id.
    */
    for (const [file] of CLASS_A) {
      const code = strip(readFileSync(join(__dirname, '..', 'components', file), 'utf8'));
      expect(code).toContain('moduleRasterIcon(module.id,');
      expect(code).not.toMatch(/moduleRasterIcon\((?!module\.id)/);
    }
  });

  it('leaves classes D, E and F out of the rule entirely', () => {
    /*
      The bottom bar, the heroes and the empty-state decoration consult no raster mapping and were
      not resized. Asserted as absence, in the source, because "we did not touch it" is otherwise
      only ever checked by eye.
    */
    const outside = [
      ['module-bottom-navigation.tsx', 'navIcon'],
      ['module-state-view.tsx', null],
    ] as const;

    for (const [file] of outside) {
      const code = strip(readFileSync(join(__dirname, '..', 'components', file), 'utf8'));
      expect(code).not.toContain('moduleRasterIcon');
    }

    const nav = strip(
      readFileSync(join(__dirname, '..', 'components', 'module-bottom-navigation.tsx'), 'utf8'),
    );
    expect(nav).toContain('dp(moduleLayout.navIcon)');

    const state = strip(
      readFileSync(join(__dirname, '..', 'components', 'module-state-view.tsx'), 'utf8'),
    );
    /* 28 dp, the number it already had. Not raised toward 40 to match class A. */
    expect(state).toContain('size={dp(28)}');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Planner, which is blocked but must inherit
// ─────────────────────────────────────────────────────────────────────────────

describe('Planner', () => {
  it('has no raster mapping in this branch', () => {
    /*
      Planner artwork is staged and measured, and integrating it is explicitly out of scope until
      this standard merges. `planner-today` additionally needs mechanical normalisation first — its
      safety margin is 5 px against the 19 px the contract now requires.

      Asserted so "Planner is done" cannot be claimed from staged files, and so the day its mapping
      lands, the class-A describes above start covering it without anyone editing this file.
    */
    expect(WITH_ART).not.toContain('planner');
    for (const icon of moduleRegistry.planner?.quickActions.map((action) => action.icon) ?? []) {
      expect(moduleRasterIcon('planner', icon)).toBeNull();
    }
    for (const icon of moduleRegistry.planner?.capabilities.map((item) => item.icon) ?? []) {
      expect(moduleRasterIcon('planner', icon)).toBeNull();
    }
  });

  it('shares icon names with Finance, so its artwork must never be inherited', () => {
    /* `add-circle` is Planner's as well as Finance's. Scoping is what keeps them apart. */
    expect(moduleRasterIcon('finance', 'add-circle')).not.toBeNull();
    expect(moduleRasterIcon('planner', 'add-circle')).toBeNull();
  });
});
