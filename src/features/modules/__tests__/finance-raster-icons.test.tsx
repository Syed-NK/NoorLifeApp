import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { render } from '@testing-library/react-native';

import {
  COMMISSIONED_CANVAS,
  commissionedAssetViolations,
  inspectOpticalBounds,
  inspectRasterIcon,
  isBrandNeutral,
} from '@/test-support/raster-icon-contract';
import { pinModuleWindow } from '@/test-support/module-window';

import { ModuleFeatureGrid } from '../components/module-feature-grid';
import { ModuleQuickActionRow } from '../components/module-quick-action';
import { ModuleProvider } from '../module-context';
import { moduleRegistry } from '../module-registry';
import {
  moduleRasterIcon,
  modulesWithRasterIcons,
  rasterIconNamesFor,
} from '../module-raster-icons';
import { FINANCE_ASSET_FILES, FINANCE_UNASSIGNED_ASSETS } from '../assets/finance-icon-assets';
import { FRAMEWORK_MODULE_IDS } from '../module-tokens';

/**
 * **Finance's commissioned artwork, and everything it must not disturb** — issue #68.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * The first batch on #66's primitive. The risk is not that artwork fails to appear — that is visible
 * immediately. It is the three quieter failures:
 *
 *   • artwork leaking into another module, because four of the icon names Finance uses are shared;
 *   • a disabled tile losing its grey, because artwork cannot be tinted;
 *   • a surface silently falling back to the flat glyph after artwork was assigned to it.
 *
 * So most of what is asserted here is scoping and absence, driven off the registry rather than a
 * hand-written list, so a future batch is covered by construction.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const ASSET_DIR = join(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  'assets',
  'images',
  'modules',
  'finance',
  'pictograms',
);

/** The Finance icon names that must render artwork, derived from the resolver rather than restated. */
const ASSIGNED = rasterIconNamesFor('finance');

const HIDDEN = { includeHiddenElements: true } as const;

function flat(style: unknown): Record<string, unknown> {
  return (Array.isArray(style) ? style.flat(4) : [style])
    .filter((e): e is Record<string, unknown> => typeof e === 'object' && e !== null)
    .reduce<Record<string, unknown>>((all, e) => ({ ...all, ...e }), {});
}

// ─────────────────────────────────────────────────────────────────────────────
// The assets on disk
// ─────────────────────────────────────────────────────────────────────────────

describe('the installed Finance assets', () => {
  it('are the five this batch delivered', () => {
    expect(
      readdirSync(ASSET_DIR)
        .filter((f) => f.endsWith('.png'))
        .sort(),
    ).toEqual([...FINANCE_ASSET_FILES].sort());
  });

  it.each(FINANCE_ASSET_FILES)('%s satisfies the shared raster contract', (file) => {
    /*
      The same validator #66 introduced, unmodified. An earlier 1254 px delivery failed it — two
      masters carried one bottom-left pixel at alpha 1/255 — and the fix was on the asset side.

      The canvas is 256 as of #70. This batch first shipped at 512, which the header rules could not
      see was wrong because there was no canvas rule yet; there is one now, and these five were
      mechanically re-exported from their preserved masters to satisfy it.
    */
    const report = inspectRasterIcon(join(ASSET_DIR, file));
    expect(report.width).toBe(COMMISSIONED_CANVAS);
    expect(report.height).toBe(COMMISSIONED_CANVAS);
    expect(report.bitDepth).toBe(8);
    expect(report.colourType).toBe(6);
    expect(report.hasAlpha).toBe(true);
    expect(report.interlaced).toBe(false);
    expect(report.transparentCorners).toBe(true);
    expect(report.whiteBoxCorner).toBe(false);
    expect(report.forbiddenChunks).toEqual([]);
    expect(isBrandNeutral(join('assets/images/modules/finance/pictograms', file))).toBe(true);
  });

  it.each(FINANCE_ASSET_FILES)('%s satisfies the full commissioned standard', (file) => {
    /*
      The whole contract in one call — issue #70. Canvas, colour type, depth, interlace, corners,
      metadata, optical box, safety margin and centring, as one list of reasons that must be empty.

      This is the assertion the first delivery would have failed, and it is deliberately the *same*
      call every future batch will make, so no batch gets its own softer rules.
    */
    expect(commissionedAssetViolations(join(ASSET_DIR, file))).toEqual([]);
  });

  it('carries a real safety margin on every side, not just on average', () => {
    /*
      Measured per side. A mark pushed into one corner can hold a compliant box ratio and a compliant
      *mean* margin while touching an edge, which is how the staged `planner-today` asset reads at
      5 px. Reported here as the actual numbers so a regression names itself.
    */
    for (const file of FINANCE_ASSET_FILES) {
      const optical = inspectOpticalBounds(join(ASSET_DIR, file));
      expect(optical.canvas).toBe(COMMISSIONED_CANVAS);
      expect(optical.boxWidth).toBe(optical.boxWidth); // measured, not assumed square
      expect(optical.minMargin).toBeGreaterThanOrEqual(19);
      expect(optical.boxRatio).toBeLessThanOrEqual(0.85);
      /* Non-vacuous: there is artwork, and it is not a single pixel. */
      expect(optical.boxRatio).toBeGreaterThan(0.5);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Scoping: the failure that would be worse than the flat glyph it replaced
// ─────────────────────────────────────────────────────────────────────────────

describe('artwork is scoped to Finance', () => {
  it('is the only module with commissioned artwork today', () => {
    expect(modulesWithRasterIcons()).toEqual(['finance']);
  });

  it.each(['add-circle', 'home', 'target', 'robot'] as const)(
    'gives no other module Finance’s artwork for the shared name %s',
    (icon) => {
      /*
        The load-bearing case. These four names are shared — `add-circle` with Family, Goals and
        Planner, `home` with Health, `target` with Goals, `robot` with six others. A lookup keyed on
        the icon name alone would put Finance's wallet on Planner's add button, which reads as a bug
        rather than as unfinished work.
      */
      for (const moduleId of FRAMEWORK_MODULE_IDS) {
        if (moduleId === 'finance') continue;
        expect(moduleRasterIcon(moduleId, icon)).toBeNull();
      }
    },
  );

  it('returns nothing for a module it does not know', () => {
    expect(moduleRasterIcon('not-a-module', 'budgets')).toBeNull();
  });

  it('resolves every assigned Finance name to a static module reference', () => {
    /*
      A resolved `require`, never a `{ uri }` and never a string. Metro resolves `require` at build
      time; a path built from a variable resolves to nothing in a release bundle.
    */
    expect(ASSIGNED.length).toBeGreaterThan(0);
    for (const icon of ASSIGNED) {
      const source = moduleRasterIcon('finance', icon);
      expect(source).not.toBeNull();
      expect(typeof source === 'string').toBe(false);
      expect(typeof source === 'object' && source !== null && 'uri' in source).toBe(false);
    }
  });

  it('builds no asset path dynamically', () => {
    const registry = readFileSync(
      join(__dirname, '..', 'assets', 'finance-icon-assets.ts'),
      'utf8',
    );
    const code = registry.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/require\(`/);
    expect(code).not.toMatch(/require\([a-zA-Z]/);
    /* One literal `require` per assigned slot, and nothing else. */
    expect((code.match(/require\('\.\.\//g) ?? []).length).toBe(ASSIGNED.length);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Mapping completeness, from the registry
// ─────────────────────────────────────────────────────────────────────────────

describe('the mapping', () => {
  it('assigns artwork only to icon names Finance actually uses', () => {
    /*
      Driven off the registry. An asset mapped to a name Finance does not render would be dead weight
      that looks installed, which is the mistake this whole batch was told not to make.
    */
    const financeIcons = new Set<string>([
      ...moduleRegistry.finance.quickActions.map((a) => a.icon),
      ...moduleRegistry.finance.capabilities.map((c) => c.icon),
    ]);
    for (const icon of ASSIGNED) {
      expect(financeIcons.has(icon)).toBe(true);
    }
  });

  it('maps each asset to at most one icon name', () => {
    const sources = ASSIGNED.map((icon) => moduleRasterIcon('finance', icon));
    expect(new Set(sources.map((s) => JSON.stringify(s))).size).toBe(sources.length);
  });

  it('records the asset with no honest consumer rather than forcing it', () => {
    /*
      `finance-track` depicts tracking. The `track` icon belongs to Health and is itself unavailable;
      Finance's nearest tiles are Spending and Savings, which mean other things and have their own
      artwork. Left unused deliberately, and named so it stays a decision.
    */
    expect(FINANCE_UNASSIGNED_ASSETS).toEqual(['finance-track.png']);
    expect(readdirSync(ASSET_DIR)).toContain('finance-track.png');
    const financeIcons = new Set<string>([
      ...moduleRegistry.finance.quickActions.map((a) => a.icon),
      ...moduleRegistry.finance.capabilities.map((c) => c.icon),
    ]);
    expect(financeIcons.has('track')).toBe(false);
  });

  it('leaves every unassigned Finance icon on its glyph', () => {
    const financeIcons = [
      ...moduleRegistry.finance.quickActions.map((a) => a.icon),
      ...moduleRegistry.finance.capabilities.map((c) => c.icon),
    ];
    const unassigned = financeIcons.filter((i) => !ASSIGNED.includes(i));
    /* Not empty: this batch is five assets, not the whole module. */
    expect(unassigned.length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Rendering: artwork where assigned, glyph where not, disabled untouched
// ─────────────────────────────────────────────────────────────────────────────

describe('the Finance quick-action row', () => {
  beforeEach(() => pinModuleWindow());

  it('renders artwork for an assigned action and no tint', async () => {
    const view = await render(
      <ModuleProvider moduleId="finance">
        <ModuleQuickActionRow testID="finance-quick" />
      </ModuleProvider>,
    );
    /* `add-expense` uses `add-circle`, which this batch assigned. */
    const tile = view.getByTestId('finance-quick-add-expense', HIDDEN);
    const art = view.getByTestId('finance-quick-add-expense-art', HIDDEN);
    expect(art.props.resizeMode).toBe('contain');
    expect(flat(art.props.style).tintColor).toBeUndefined();
    expect(art.props.tintColor).toBeUndefined();
    /* Decorative: the tile carries the label, so the artwork stays out of the reader. */
    expect(art.props.accessible).toBe(false);
    /* Navigation and label untouched. */
    expect(tile.props.accessibilityRole).toBe('button');
    expect(tile.props.accessibilityLabel).toBe('Add expense');

    /* And `ask-money-ai` uses the shared `robot`, which this batch left on its glyph. */
    expect(view.queryByTestId('finance-quick-ask-money-ai-art', HIDDEN)).toBeNull();
  });
});

describe('the Finance feature grid', () => {
  beforeEach(() => pinModuleWindow());

  it('keeps an unavailable tile on its tintable glyph, greyed and disabled', async () => {
    /*
      The disabled affordance greys the icon, and artwork cannot be tinted. `moduleRasterIcon`
      refuses artwork for anything unavailable, so `bank-sync` — whose icon name `money` Finance owns
      exclusively — must still render a glyph.
    */
    const view = await render(
      <ModuleProvider moduleId="finance">
        <ModuleFeatureGrid testID="finance-features" />
      </ModuleProvider>,
    );
    const bankSync = view.getByTestId('finance-features-bank-sync', HIDDEN);
    expect(bankSync.props.accessibilityState).toMatchObject({ disabled: true });
    expect(String(bankSync.props.accessibilityLabel)).toContain('not available yet');
    expect(view.queryByTestId('finance-features-bank-sync-art', HIDDEN)).toBeNull();
    expect(view.queryByTestId('finance-features-receipts-art', HIDDEN)).toBeNull();
  });

  it('refuses artwork for an unavailable surface even when the icon has some', () => {
    /*
      The guard, asserted where it can actually fail.

      No assigned icon currently sits on an unavailable Finance tile, so the behaviour is unexercised
      by today's data — and a mutation removing the guard passed every case until this one existed.
      Asked with an icon that *does* have artwork, so the answer depends on availability and nothing
      else.
    */
    for (const icon of ASSIGNED) {
      expect(moduleRasterIcon('finance', icon, true)).not.toBeNull();
      expect(moduleRasterIcon('finance', icon, false)).toBeNull();
    }
  });

  it('renders every assigned available tile as untinted contained artwork', async () => {
    /*
      Asserted on the grid as well as the quick-action row, and not only on one tile. `tintColor` is a
      *style*, so the type that forbids a `color` prop does not forbid the effect — a mutation
      tinting the grid passed every case until this existed.
    */
    const view = await render(
      <ModuleProvider moduleId="finance">
        <ModuleFeatureGrid testID="finance-features" />
      </ModuleProvider>,
    );
    const withArt = moduleRegistry.finance.capabilities.filter(
      (item) => item.available && ASSIGNED.includes(item.icon),
    );
    expect(withArt.length).toBeGreaterThan(0);
    for (const item of withArt) {
      const art = view.getByTestId(`finance-features-${item.key}-art`, HIDDEN);
      expect(art.props.resizeMode).toBe('contain');
      expect(flat(art.props.style).tintColor).toBeUndefined();
      expect(art.props.tintColor).toBeUndefined();
      /* Square box, so nothing is stretched. */
      const style = flat(art.props.style);
      expect(style.width).toBe(style.height);
      /* Decorative: the tile carries the label. */
      expect(art.props.accessible).toBe(false);
    }
  });

  it('preserves every tile’s destination and label', async () => {
    /*
      Artwork must change nothing about where a tile goes or what it says. Asserted from the
      registry, so a copy or href edit fails here rather than being noticed on a device.
    */
    const view = await render(
      <ModuleProvider moduleId="finance">
        <ModuleFeatureGrid testID="finance-features" />
      </ModuleProvider>,
    );
    for (const item of moduleRegistry.finance.capabilities) {
      const tile = view.getByTestId(`finance-features-${item.key}`, HIDDEN);
      const label = item.available ? (item.accessibilityLabel ?? item.label) : undefined;
      if (label !== undefined) {
        expect(tile.props.accessibilityLabel).toBe(label);
      }
      expect(tile.props.accessibilityRole).toBe('button');
    }
  });
});
