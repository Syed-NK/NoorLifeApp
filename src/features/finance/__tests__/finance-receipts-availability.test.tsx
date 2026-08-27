import fs from 'node:fs';
import path from 'node:path';

import { render } from '@testing-library/react-native';

import { pinModuleWindow } from '@/test-support/module-window';
import { installPlannerDaySource, type PlannerDayHarness } from '@/test-support/planner-day';

import {
  FINANCE_ASSET_FILES,
  FINANCE_HELD_ASSETS,
  financeIconAssets,
} from '@features/modules/assets/finance-icon-assets';
import { moduleRasterIcon, rasterIconNamesFor } from '@features/modules/module-raster-icons';
import { moduleRegistry } from '@features/modules/module-registry';
import { ModuleHomeScreen } from '@features/modules/screens/module-home-screen';

/**
 * **Receipts is built, and Receipts is still not a promise** — issue #101.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── Why a working feature stays switched off ───────────────────────────────
 * The workflow behind this branch runs, and it is verified on Android. It is *not* verified on an
 * iPhone, because installing a build on a physical iPhone requires a paid Apple Developer Program
 * membership this project does not have. An EAS iOS Simulator build proves the native dependencies
 * compile and link for iOS; it proves nothing whatsoever about a camera, a photo library, a
 * permission prompt or a file path on a real device.
 *
 * So the capability stays `available: false` and the tile stays a neutral glyph on both platforms.
 * Shipping it as available on the strength of one platform's evidence would be the same class of
 * claim #90 removed from this module's registry copy — a promise the app cannot keep everywhere it
 * is made.
 *
 * ── Why the artwork is part of the same gate ───────────────────────────────
 * The commissioned Receipts pictogram passed the raster contract in the same pass as Savings and is
 * deliberately held outside the repository. `moduleRasterIcon` refuses artwork for an unavailable
 * surface by construction (#104), so an installed Receipts asset would resolve nowhere, fail the
 * manifest's no-orphan rule, and sit in the bundle as a file nothing renders. Installing it and
 * flipping the tile are one commit, and that commit is gated on the iPhone.
 *
 * ── What this suite is for ─────────────────────────────────────────────────
 * A route that exists and is not reachable is exactly the arrangement that decays quietly. These
 * four conditions are the ones a future edit would break without noticing, so each of them is a
 * case: the capability is unavailable, no Receipts raster exists on disk, no mapping resolves to
 * one, and the route inherits both Finance gates rather than sidestepping them.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const ROOT = process.cwd();
const FINANCE_LAYOUT = path.join(ROOT, 'src', 'app', 'finance', '_layout.tsx');
const RECEIPTS_ROUTE = path.join(ROOT, 'src', 'app', 'finance', 'receipts.tsx');
const ICON_ASSETS = path.join(
  ROOT,
  'src',
  'features',
  'modules',
  'assets',
  'finance-icon-assets.ts',
);

/** Every file under a directory tree, so "nowhere in the repository" can actually be checked. */
function walk(directory: string): readonly string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.git') {
        continue;
      }
      out.push(...walk(full));
      continue;
    }
    out.push(full);
  }
  return out;
}

const financeCapabilities = moduleRegistry.finance.capabilities;

function capability(key: string) {
  return financeCapabilities.find((entry) => entry.key === key);
}

let harness: PlannerDayHarness | null = null;

beforeEach(() => {
  pinModuleWindow();
  harness = installPlannerDaySource(new Date(2026, 7, 27, 9, 0, 0));
});

afterEach(() => {
  harness?.restore();
  harness = null;
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. The capability is unavailable
// ─────────────────────────────────────────────────────────────────────────────

describe('Receipts is still an unavailable capability', () => {
  it('is declared unavailable in the registry', () => {
    expect(capability('receipts')?.available).toBe(false);
  });

  it('has no href, so nothing can navigate to it from the registry', () => {
    /*
      The route file exists for direct development access and for these tests. The *registry* is what
      every Finance surface reads to build its grid and its links, and an unavailable capability with
      no href cannot become a tap target by accident.
    */
    expect(capability('receipts')).not.toHaveProperty('href');
  });

  it('says why, without describing a feature that does not exist', () => {
    const reason = capability('receipts')?.unavailableReason ?? '';

    expect(reason.length).toBeGreaterThan(0);
    expect(reason).not.toMatch(/upload|cloud|sync|server|scan your|automatic/i);
  });

  it('leaves bank sync unavailable, which this branch did not touch', () => {
    expect(capability('bank-sync')?.available).toBe(false);
  });

  it('still promises no permissions at module level', () => {
    /*
      #90 emptied this list because Finance asked the OS for nothing. Receipts asks for the camera and
      the photo library — but only from inside the workflow, and only from a press. A registry entry
      here would advertise the module as wanting them, which is a claim about entering Finance rather
      than about pressing Capture, and it would be false for every user who never opens Receipts.
    */
    expect(moduleRegistry.finance.permissions).toEqual([]);
  });

  it('renders the Receipts tile as unavailable on the Finance home', async () => {
    const view = await render(<ModuleHomeScreen moduleId="finance" />);

    expect(view.queryByTestId('finance-features-receipts-art')).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. No Receipts raster exists in the repository
// ─────────────────────────────────────────────────────────────────────────────

describe('the Receipts artwork is still held outside the repository', () => {
  it('has no receipts image anywhere under assets', () => {
    const offenders = walk(path.join(ROOT, 'assets')).filter((file) =>
      /receipt/i.test(path.basename(file)),
    );

    expect(offenders).toEqual([]);
  });

  it('still records it as held, and not as installed', () => {
    expect(FINANCE_HELD_ASSETS).toEqual(['finance-receipts.png']);
    expect(FINANCE_ASSET_FILES).not.toContain('finance-receipts.png');
  });

  it('installs exactly the files it says it installs, and no more', () => {
    const directory = path.join(ROOT, 'assets', 'images', 'modules', 'finance', 'pictograms');
    const onDisk = fs.readdirSync(directory).sort();

    expect(onDisk).toEqual([...FINANCE_ASSET_FILES].sort());
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. No mapping resolves Receipts artwork
// ─────────────────────────────────────────────────────────────────────────────

describe('no mapping resolves a Receipts pictogram', () => {
  it('has no static require naming a receipts file', () => {
    const source = fs.readFileSync(ICON_ASSETS, 'utf8');
    const requires = [...source.matchAll(/require\('([^']+)'\)/g)].map((match) => match[1] ?? '');

    expect(requires.some((specifier) => /receipt/i.test(specifier))).toBe(false);
  });

  it('maps nothing to the icon name the Receipts capability uses', () => {
    const icon = capability('receipts')?.icon ?? 'document';

    expect(financeIconAssets[icon]).toBeUndefined();
    expect(rasterIconNamesFor('finance')).not.toContain(icon);
  });

  it('refuses artwork for an unavailable surface, whatever the table says', () => {
    /*
      The construction that makes the whole gate hold. Even if a future batch added a `document` row
      to Finance's table, an unavailable tile would still get its neutral glyph — the rule is in
      `moduleRasterIcon`, not in the caller's memory. Asserted here on a name that *is* mapped, so
      this fails if the guard is ever weakened rather than if the table merely changes.
    */
    expect(moduleRasterIcon('finance', 'target', false)).toBeNull();
    expect(moduleRasterIcon('finance', 'document', false)).toBeNull();
    expect(moduleRasterIcon('finance', 'document', true)).toBeNull();
  });

  it('leaves the Savings mapping exactly as #106 left it', () => {
    /*
      The one thing this branch must not disturb. Savings is live, its pictogram is installed, and it
      is mapped to `target` for Finance only — Goals keeps its glyph.
    */
    expect(financeIconAssets.target).toBeDefined();
    expect(moduleRasterIcon('finance', 'target', true)).toBe(financeIconAssets.target);
    expect(moduleRasterIcon('goals', 'target', true)).toBeNull();
    expect(capability('goals')?.available).toBe(true);
  });

  it('changes no other Finance mapping', () => {
    expect([...rasterIconNamesFor('finance')].sort()).toEqual([
      'add-circle',
      'budgets',
      'home',
      'target',
      'transactions',
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. The route is not a way past the gates
// ─────────────────────────────────────────────────────────────────────────────

describe('the Receipts route inherits both Finance gates', () => {
  it('exists inside the gated Finance stack', () => {
    expect(fs.existsSync(RECEIPTS_ROUTE)).toBe(true);
    expect(path.dirname(RECEIPTS_ROUTE)).toBe(path.dirname(FINANCE_LAYOUT));
  });

  it('is wrapped by the authentication boundary and then the entitlement gate', () => {
    const layout = fs.readFileSync(FINANCE_LAYOUT, 'utf8');
    const auth = layout.indexOf('<ProtectedRouteBoundary>');
    const entitlement = layout.indexOf('<ModuleEntitlementGate');

    /*
      The order is the assertion, not merely the presence of both. Reversed, a signed-out visitor
      arriving by direct link is shown a purchase offer — which is what issue #28 observed on device.
      Who are you, then what may you use.
    */
    expect(auth).toBeGreaterThanOrEqual(0);
    expect(entitlement).toBeGreaterThan(auth);
  });

  it('carries no gate, redirect or entitlement decision of its own', () => {
    const route = fs
      .readFileSync(RECEIPTS_ROUTE, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');

    /*
      A route that made its own decision would be a second answer to a question the layout already
      answers — and a second answer is one that can differ.
    */
    expect(route).not.toMatch(/Redirect|ProtectedRouteBoundary|ModuleEntitlementGate|Stack\b/);
  });

  it('does not appear in any Finance capability href', () => {
    const hrefs = financeCapabilities
      .map((entry) => ('href' in entry ? String(entry.href) : ''))
      .concat(moduleRegistry.finance.quickActions.map((action) => String(action.href)));

    expect(hrefs.some((href) => href.includes('receipts'))).toBe(false);
  });
});
