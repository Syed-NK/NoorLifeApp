import fs from 'node:fs';
import path from 'node:path';

import { act, render, screen } from '@testing-library/react-native';

import { pinModuleWindow } from '@/test-support/module-window';

import { contrastRatio as contrast } from '../contrast';
import { ModuleProvider } from '../module-context';
import { ModuleStatusBanner } from '../components/module-status-banner';
import {
  SURFACE_ROLE_MODULES,
  moduleSurfaces,
  statusNeedsInkBorder,
  usesSurfaceRoles,
} from '../module-surfaces';
import { moduleRegistry } from '../module-registry';
import { FRAMEWORK_MODULE_IDS, moduleColorThemes, moduleNeutrals } from '../module-tokens';
import { ModuleHomeScreen } from '../screens/module-home-screen';

/**
 * **Finance paints from the contract; seven modules do not move** — issue #91.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── What the rollout is ────────────────────────────────────────────────────
 * #86 defined six surface roles and spent none of them. This applies them, behind one list:
 * `SURFACE_ROLE_MODULES`. A shared component never asks "is this Finance?" — it asks
 * `moduleSurfaces(id)` for a ground and gets either the module's roles or today's neutrals.
 *
 * That is the property most of this file defends. A rollout like this fails by moving a module
 * nobody was looking at, so the neutral branch is asserted **value by value** against the literals
 * the components read before, for all seven modules, on every role.
 *
 * ── The two distinctions that are easy to get wrong ────────────────────────
 * `surfaceMuted` means two different things: a decorative nested row, and an unavailable control.
 * Only the first is decoration. Tinting the second would make Finance's Bank sync and Receipts read
 * as available — the opposite of what #90 asserted — so the disabled branch stays neutral and that
 * is pinned here.
 *
 * Finance's `pageSurface` and `warningSurface` are **1.02:1** apart: the same colour to any eye. A
 * banner there cannot be identified by its fill, so it keeps the semantic fill and gains a border in
 * its semantic ink. Neutral pages get no border, because theirs are already distinguishable.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const AA_TEXT = 4.5;
const AA_UI = 3;
const OTHERS = FRAMEWORK_MODULE_IDS.filter((id) => id !== 'finance');

function productionSourceFiles(root: string): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (
          entry.name === 'node_modules' ||
          entry.name === '__tests__' ||
          entry.name.startsWith('.')
        ) {
          continue;
        }
        walk(full);
        continue;
      }
      if (
        (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) &&
        !entry.name.includes('.test.')
      ) {
        found.push(full);
      }
    }
  };
  walk(path.join(process.cwd(), root));
  return found;
}

const rel = (file: string): string => path.relative(process.cwd(), file).split(path.sep).join('/');

beforeEach(() => {
  pinModuleWindow();
});

// ─────────────────────────────────────────────────────────────────────────────
// The opt-in
// ─────────────────────────────────────────────────────────────────────────────

describe('exactly one module opts in', () => {
  it('lists Finance and nothing else', () => {
    expect(SURFACE_ROLE_MODULES).toEqual(['finance']);
    expect(usesSurfaceRoles('finance')).toBe(true);
  });

  it.each(OTHERS)('%s does not opt in', (moduleId) => {
    expect(usesSurfaceRoles(moduleId)).toBe(false);
  });

  it('treats an unknown module as neutral', () => {
    // Fail safe: a component that cannot tell which module it is in must not guess at a tint.
    expect(usesSurfaceRoles('')).toBe(false);
    expect(moduleSurfaces('').page).toBe(moduleNeutrals.pageBackground);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Exact values
// ─────────────────────────────────────────────────────────────────────────────

describe('Finance resolves every role from its theme', () => {
  const theme = moduleColorThemes.finance;
  const surfaces = moduleSurfaces('finance');

  it.each([
    ['page', 'pageSurface'],
    ['card', 'cardSurface'],
    ['elevated', 'elevatedSurface'],
    ['well', 'wellSurface'],
    ['navSelected', 'navSelectedSurface'],
  ] as const)('%s comes from %s', (surface, role) => {
    expect(surfaces[surface]).toBe(theme[role]);
  });

  it('takes both border and divider from borderTint', () => {
    expect(surfaces.border).toBe(theme.borderTint);
    expect(surfaces.divider).toBe(theme.borderTint);
  });

  it('is the orange family, not a neutral', () => {
    // The user-visible point of the whole issue, stated as values.
    expect(surfaces.page).toBe('#FFF3E6');
    expect(surfaces.well).toBe('#FFF5E8');
    expect(surfaces.elevated).toBe('#FFFAF4');
    expect(surfaces.border).toBe('#C8792C');
    expect(surfaces.navSelected).toBe('#FFF7EE');
    // The card stays white — the contrast headroom every card depends on.
    expect(surfaces.card).toBe('#FFFFFF');
  });
});

describe('every other module renders exactly what it rendered before', () => {
  it.each(OTHERS)('%s keeps the neutral set, value by value', (moduleId) => {
    /*
      Not "is neutral" — the literal values the shared components read before this change. A module
      that shifted by a shade would still look neutral; only the value catches it.
    */
    expect(moduleSurfaces(moduleId)).toEqual({
      page: moduleNeutrals.pageBackground,
      card: moduleNeutrals.surface,
      elevated: moduleNeutrals.surfaceMuted,
      well: moduleColorThemes[moduleId].wellSurface,
      border: moduleNeutrals.border,
      divider: moduleNeutrals.divider,
      navSelected: moduleNeutrals.navBackground,
    });
  });

  it.each(OTHERS)('%s keeps its well, which was already per module', (moduleId) => {
    expect(moduleSurfaces(moduleId).well).toBe(moduleColorThemes[moduleId].wellSurface);
  });

  it('leaves the selected navigation slot untinted where a module has not opted in', () => {
    // The bar's own white: the marker and the ink still carry selection there, exactly as before.
    for (const moduleId of OTHERS) {
      expect(moduleSurfaces(moduleId).navSelected).toBe(moduleNeutrals.navBackground);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Disabled is not decoration
// ─────────────────────────────────────────────────────────────────────────────

describe('the disabled state stays neutral', () => {
  it('exposes no disabled role, so a caller cannot tint one by accident', () => {
    expect(moduleSurfaces('finance')).not.toHaveProperty('disabled');
  });

  it('keeps the feature grid’s unavailable branch on the neutral muted surface', () => {
    /*
      Read from the source, because this is a branch a refactor would "tidy" into `surfaces.elevated`
      without noticing that it means *unavailable*, not *nested*. Finance's Bank sync and Receipts
      tiles have to keep reading as unavailable.
    */
    const grid = fs.readFileSync(
      path.join(process.cwd(), 'src/features/modules/components/module-feature-grid.tsx'),
      'utf8',
    );
    expect(grid).toContain('disabled ? moduleNeutrals.surfaceMuted : module.theme.wellSurface');
    expect(grid).toContain('disabled ? moduleNeutrals.border : module.theme.wellSurface');
  });

  it('keeps Finance’s two unavailable capabilities unavailable', () => {
    for (const key of ['bank-sync', 'receipts']) {
      const capability = moduleRegistry.finance.capabilities.find((item) => item.key === key);
      expect(capability?.available).toBe(false);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Semantic banners
// ─────────────────────────────────────────────────────────────────────────────

describe('status banners stay semantic, and gain an edge where the fill cannot carry them', () => {
  it('measures the Finance collision this rule exists for', () => {
    const ratio = contrast(moduleSurfaces('finance').page, moduleNeutrals.warningSurface);
    expect(ratio).toBeLessThan(1.1);
  });

  it('requires the ink border on Finance and on no other module', () => {
    expect(statusNeedsInkBorder('finance')).toBe(true);
    for (const moduleId of OTHERS) {
      expect(statusNeedsInkBorder(moduleId)).toBe(false);
    }
  });

  it('keeps every status ink able to carry that edge on the Finance page', () => {
    for (const ink of [
      moduleNeutrals.success,
      moduleNeutrals.warning,
      moduleNeutrals.error,
      moduleNeutrals.info,
    ]) {
      expect(contrast(ink, moduleSurfaces('finance').page)).toBeGreaterThanOrEqual(AA_UI);
    }
  });

  it('draws the border on Finance', async () => {
    await render(
      <ModuleProvider moduleId="finance">
        <ModuleStatusBanner tone="warning" message="Close to your limit" testID="banner" />
      </ModuleProvider>,
    );

    const style = Object.assign(
      {},
      ...[screen.getByTestId('banner').props.style].flat(3).filter(Boolean),
    ) as Record<string, unknown>;

    expect(style.borderWidth).toBe(1);
    expect(style.borderColor).toBe(moduleNeutrals.warning);
    // The semantic fill is kept, not replaced.
    expect(style.backgroundColor).toBe(moduleNeutrals.warningSurface);
  });

  it('draws no border on a module that has not opted in', async () => {
    await render(
      <ModuleProvider moduleId="planner">
        <ModuleStatusBanner tone="warning" message="Close to your limit" testID="banner" />
      </ModuleProvider>,
    );

    const style = Object.assign(
      {},
      ...[screen.getByTestId('banner').props.style].flat(3).filter(Boolean),
    ) as Record<string, unknown>;

    expect(style.borderWidth).toBeUndefined();
    expect(style.backgroundColor).toBe(moduleNeutrals.warningSurface);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Text on the Finance page
// ─────────────────────────────────────────────────────────────────────────────

describe('body text on the Finance page', () => {
  const page = moduleSurfaces('finance').page;

  it('keeps both neutral text roles at AA', () => {
    expect(contrast(moduleNeutrals.textPrimary, page)).toBeGreaterThanOrEqual(AA_TEXT);
    expect(contrast(moduleNeutrals.textSecondary, page)).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it('treats Finance ink as an accent there, never as body copy', () => {
    /*
      Measured at 4.45:1 — under AA for normal text, which is why #86 made this a stated rule rather
      than lowering the bar. On the page ink is an icon and accent colour at the non-text threshold.
    */
    const ink = moduleColorThemes.finance.ink;
    expect(contrast(ink, page)).toBeLessThan(AA_TEXT);
    expect(contrast(ink, page)).toBeGreaterThanOrEqual(AA_UI);
    // And it does clear AA on every surface it actually labels.
    for (const surface of [
      moduleSurfaces('finance').card,
      moduleSurfaces('finance').elevated,
      moduleSurfaces('finance').well,
      moduleSurfaces('finance').navSelected,
    ]) {
      expect(contrast(ink, surface)).toBeGreaterThanOrEqual(AA_TEXT);
    }
  });

  it('keeps the selected navigation slot distinguishable from the bar it sits on', () => {
    const surfaces = moduleSurfaces('finance');
    expect(surfaces.navSelected).not.toBe(moduleNeutrals.navBackground);
    // The inactive label stays neutral, so selection reads as selection rather than as hue.
    expect(
      contrast(moduleNeutrals.navInactive, moduleNeutrals.navBackground),
    ).toBeGreaterThanOrEqual(AA_TEXT);
    /* And it holds up on Finance's own selected ground too — issue #88. */
    expect(contrast(moduleNeutrals.navInactive, surfaces.navSelected)).toBeGreaterThanOrEqual(
      AA_TEXT,
    );
    expect(contrast(moduleColorThemes.finance.ink, surfaces.navSelected)).toBeGreaterThanOrEqual(
      AA_TEXT,
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Source guards and coverage
// ─────────────────────────────────────────────────────────────────────────────

describe('the rollout lives in one place', () => {
  it('names no module inside a shared component', () => {
    /*
      The point of the whole mechanism. A `moduleId === 'finance'` in the component layer would be a
      second place to update, and the Faith pattern this programme keeps unwinding began exactly
      there.
    */
    const offenders = productionSourceFiles('src/features/modules/components')
      .filter((file) =>
        /['"](finance|faith|health|planner|learning|family|goals)['"]/.test(
          fs.readFileSync(file, 'utf8'),
        ),
      )
      .map(rel);

    expect(offenders).toEqual([]);
  });

  it('declares no local module palette constant in a shared component', () => {
    const offenders = productionSourceFiles('src/features/modules/components')
      .filter((file) => /modulePalettes/.test(fs.readFileSync(file, 'utf8')))
      .map(rel);

    expect(offenders).toEqual([]);
  });

  it('samples no pixel and tints no raster', () => {
    const surfacesSource = fs.readFileSync(
      path.join(process.cwd(), 'src/features/modules/module-surfaces.ts'),
      'utf8',
    );
    expect(surfacesSource).not.toMatch(/getPixel|ImageColors|dominantColou?r|require\(.*\.png/);

    const raster = fs.readFileSync(
      path.join(process.cwd(), 'src/features/modules/module-raster-icons.ts'),
      'utf8',
    );
    expect(raster).not.toMatch(/tintColor|pageSurface|wellSurface|borderTint|moduleSurfaces/);
  });

  it('leaves no shared surface consumer silently neutral', () => {
    /*
      Coverage, not spot checks. Every component #91 names must read the contract; a file that kept a
      hard-coded neutral ground would look right on seven modules and wrong on Finance, which is the
      hardest kind of miss to see in review.
    */
    const MUST_CONSUME = [
      'module-scaffold.tsx',
      'module-state-view.tsx',
      'module-hero-card.tsx',
      'module-card.tsx',
      'module-quick-action.tsx',
      'module-summary-card.tsx',
      'module-section.tsx',
      'module-bottom-navigation.tsx',
      'module-status-banner.tsx',
    ];

    for (const name of MUST_CONSUME) {
      const source = fs.readFileSync(
        path.join(process.cwd(), 'src/features/modules/components', name),
        'utf8',
      );
      expect({ name, consumes: /module-surfaces/.test(source) }).toEqual({ name, consumes: true });
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Rendered
// ─────────────────────────────────────────────────────────────────────────────

describe('the rendered Finance home', () => {
  it('paints its page from the contract while a neutral module keeps the grey ground', async () => {
    const grounds: Record<string, unknown> = {};

    /*
      Goals rather than Planner: Planner's composed home needs its own state owners, and this test
      is about the ground a scaffold paints, not about what a composition can mount.
    */
    for (const moduleId of ['finance', 'goals'] as const) {
      const view = await render(<ModuleHomeScreen moduleId={moduleId} />);
      await act(async () => {
        await Promise.resolve();
      });
      const style = Object.assign(
        {},
        ...[screen.getByTestId(`${moduleId}-home`).props.style].flat(3).filter(Boolean),
      ) as Record<string, unknown>;
      grounds[moduleId] = style.backgroundColor;
      await view.unmount();
    }

    expect(grounds).toEqual({
      finance: moduleColorThemes.finance.pageSurface,
      goals: moduleNeutrals.pageBackground,
    });
  });
});
