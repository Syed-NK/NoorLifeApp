import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { render } from '@testing-library/react-native';

import {
  commissionedAssetViolations,
  inspectOpticalBounds,
} from '@/test-support/raster-icon-contract';
import { pinModuleWindow } from '@/test-support/module-window';

import {
  FINANCE_ASSET_FILES,
  FINANCE_HELD_ASSETS,
  FINANCE_UNASSIGNED_ASSETS,
  financeIconAssets,
} from '../assets/finance-icon-assets';
import { pictogramById, pictogramManifest } from '../assets/pictogram-manifest';
import { ModuleFeatureGrid } from '../components/module-feature-grid';
import { ModuleProvider } from '../module-context';
import { moduleRasterIcon } from '../module-raster-icons';
import { moduleRegistry } from '../module-registry';
import { FRAMEWORK_MODULE_IDS } from '../module-tokens';

/**
 * **The commissioned Savings pictogram** — issue #106.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * Finance's Savings tile drew a flat `target` glyph while its four available siblings drew
 * commissioned artwork. This installs one asset and maps it to one surface.
 *
 * The two assertions that carry weight are the ones about what this must *not* do. `target` is also
 * Goals' primary tile icon, so a lookup keyed on the icon name alone would put a Finance coin pouch
 * on a Goals tile — wrong artwork reads as a bug where a flat glyph only reads as unfinished. And
 * `finance-receipts.png` was validated in the same pass and is deliberately not here: its capability
 * is `available: false`, so an installed asset would resolve nowhere and sit in the bundle unused.
 * #101 is the sole gate for it.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const HIDDEN = { includeHiddenElements: true } as const;
const REPO_ROOT = join(__dirname, '..', '..', '..', '..');
const ASSET_DIR = join(REPO_ROOT, 'assets', 'images', 'modules', 'finance', 'pictograms');
const INSTALLED = join(ASSET_DIR, 'finance-goals.png');

const EXPECTED_SHA = '5e4804ffb513d45425d621783096c8f26cf4064409ce3d27c922191717ffa85a';

function flat(style: unknown): Record<string, unknown> {
  return (Array.isArray(style) ? style.flat(4) : [style])
    .filter((e): e is Record<string, unknown> => typeof e === 'object' && e !== null)
    .reduce<Record<string, unknown>>((all, e) => ({ ...all, ...e }), {});
}

// ─────────────────────────────────────────────────────────────────────────────
// The asset itself
// ─────────────────────────────────────────────────────────────────────────────

describe('the delivered asset', () => {
  it('is installed at the bytes that were reviewed', () => {
    expect(existsSync(INSTALLED)).toBe(true);
    expect(createHash('sha256').update(readFileSync(INSTALLED)).digest('hex')).toBe(EXPECTED_SHA);
  });

  it('satisfies the commissioned contract with no violations', () => {
    expect(commissionedAssetViolations(INSTALLED)).toEqual([]);
  });

  it('sits inside the optical contract rather than at its edge', () => {
    /*
      Recorded, not merely passed. #78's Planner candidates failed on exactly these three numbers, and
      a later re-export that drifted toward the limits would still pass a boolean check while looking
      visibly different beside its siblings.
    */
    const optical = inspectOpticalBounds(INSTALLED);
    expect(optical.canvas).toBe(256);
    expect(optical.boxWidth).toBe(156);
    expect(optical.boxHeight).toBe(200);
    expect(Number(optical.boxRatio.toFixed(3))).toBe(0.781);
    expect(optical.margins).toEqual([50, 28, 50, 28]);
    expect(optical.minMargin).toBe(28);
    expect(optical.centreOffset).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Manifest, mapping and consumer
// ─────────────────────────────────────────────────────────────────────────────

describe('the manifest entry', () => {
  const entry = pictogramById('finance/target');

  it('records the module, semantic name, scope and policy', () => {
    expect(entry).toMatchObject({
      module: 'finance',
      icon: 'target',
      file: 'assets/images/modules/finance/pictograms/finance-goals.png',
      scope: 'module-specific',
      sha256: EXPECTED_SHA,
      pixels: { width: 256, height: 256 },
      optical: 'commissioned-256',
      availability: 'available-only',
      role: 'installed',
      canonicalReference: false,
    });
  });

  it('names exactly one production consumer, the Savings feature tile', () => {
    expect(entry.consumers).toEqual([
      'features/modules/components/module-feature-grid.tsx:ModuleFeatureGrid(finance/goals)',
    ]);
  });

  it('resolves its source through the registry that owns the require', () => {
    expect(entry.source).not.toBeNull();
    expect(entry.source).toBe(financeIconAssets.target);
  });

  it('takes the strict policy, leaving the frozen legacy set untouched', () => {
    const legacy = pictogramManifest.filter((e) => e.optical.startsWith('legacy-'));
    expect(legacy).toHaveLength(31);
    expect(legacy.some((e) => e.id === 'finance/target')).toBe(false);
  });

  it('joins the file inventory and leaves finance-track unassigned', () => {
    expect([...FINANCE_ASSET_FILES].sort()).toEqual([
      'finance-add-circle.png',
      'finance-budgets.png',
      'finance-goals.png',
      'finance-money.png',
      'finance-track.png',
      'finance-transactions.png',
    ]);
    expect(FINANCE_UNASSIGNED_ASSETS).toEqual(['finance-track.png']);
    expect(financeIconAssets.track).toBeUndefined();
  });
});

describe('the mapping', () => {
  it('resolves for Finance only when the surface is available', () => {
    expect(moduleRasterIcon('finance', 'target')).not.toBeNull();
    expect(moduleRasterIcon('finance', 'target', false)).toBeNull();
  });

  it('never resolves for Goals, whose primary tile uses the same icon name', () => {
    /*
      The load-bearing case. Goals' `goals` capability is `target`, available and glyph-drawn.
    */
    const goalsPrimary = moduleRegistry.goals.capabilities.find((c) => c.key === 'goals');
    expect(goalsPrimary?.icon).toBe('target');
    expect(goalsPrimary?.available).toBe(true);
    expect(moduleRasterIcon('goals', 'target')).toBeNull();
  });

  it('never resolves for any module other than Finance', () => {
    const leaks = FRAMEWORK_MODULE_IDS.filter((id) => id !== 'finance').filter(
      (id) => moduleRasterIcon(id, 'target') !== null,
    );
    expect(leaks).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Receipts stays out
// ─────────────────────────────────────────────────────────────────────────────

describe('Receipts artwork', () => {
  it('is absent from the repository entirely', () => {
    const stray = readdirSync(ASSET_DIR).filter((f) => /receipt/i.test(f));
    expect(stray).toEqual([]);
  });

  it('is absent from every mapping and from the manifest', () => {
    expect(financeIconAssets.document).toBeUndefined();
    expect(moduleRasterIcon('finance', 'document')).toBeNull();
    expect(moduleRasterIcon('finance', 'document', false)).toBeNull();
    expect(pictogramManifest.some((e) => /receipt/i.test(e.file))).toBe(false);
    expect(pictogramManifest.some((e) => e.icon === 'document')).toBe(false);
  });

  it('is recorded as held, with #101 named as the gate', () => {
    expect(FINANCE_HELD_ASSETS).toEqual(['finance-receipts.png']);
    const source = readFileSync(
      join(REPO_ROOT, 'src', 'features', 'modules', 'assets', 'finance-icon-assets.ts'),
      'utf8',
    );
    expect(source).toMatch(/#101 is the sole gate/);
  });

  it('leaves the Receipts and Bank sync capabilities unavailable', () => {
    const capabilities = moduleRegistry.finance.capabilities;
    expect(capabilities.find((c) => c.key === 'receipts')?.available).toBe(false);
    expect(capabilities.find((c) => c.key === 'bank-sync')?.available).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The rendered tile
// ─────────────────────────────────────────────────────────────────────────────

describe('the Savings feature tile', () => {
  beforeEach(() => pinModuleWindow());

  it('draws the artwork untinted, and leaves label, destination and role unchanged', async () => {
    const view = await render(
      <ModuleProvider moduleId="finance">
        <ModuleFeatureGrid testID="finance-grid" />
      </ModuleProvider>,
    );

    const tile = view.getByTestId('finance-grid-goals', HIDDEN);
    const art = view.getByTestId('finance-grid-goals-art', HIDDEN);

    expect(art.props.resizeMode).toBe('contain');
    expect(flat(art.props.style).tintColor).toBeUndefined();
    expect(art.props.tintColor).toBeUndefined();
    /* Decorative: the tile carries the label, so the artwork stays out of the reader. */
    expect(art.props.accessible).toBe(false);

    expect(tile.props.accessibilityRole).toBe('button');
    expect(tile.props.accessibilityLabel).toBe('Savings');

    const capability = moduleRegistry.finance.capabilities.find((c) => c.key === 'goals');
    expect(capability?.label).toBe('Savings');
    expect(capability?.href).toBe('/finance/goals');
    expect(capability?.available).toBe(true);
  });

  it('leaves Bank sync and Receipts on their glyphs', async () => {
    const view = await render(
      <ModuleProvider moduleId="finance">
        <ModuleFeatureGrid testID="finance-grid" />
      </ModuleProvider>,
    );
    expect(view.queryByTestId('finance-grid-bank-sync-art', HIDDEN)).toBeNull();
    expect(view.queryByTestId('finance-grid-receipts-art', HIDDEN)).toBeNull();
  });

  it('leaves the Goals module’s own target tile on its glyph', async () => {
    const view = await render(
      <ModuleProvider moduleId="goals">
        <ModuleFeatureGrid testID="goals-grid" />
      </ModuleProvider>,
    );
    expect(view.getByTestId('goals-grid-goals', HIDDEN)).toBeTruthy();
    expect(view.queryByTestId('goals-grid-goals-art', HIDDEN)).toBeNull();
  });
});
