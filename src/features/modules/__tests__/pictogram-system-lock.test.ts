import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { commissionedAssetViolations, isBrandNeutral } from '@/test-support/raster-icon-contract';
import type { IconName } from '@shared/models/icon';

import {
  GOVERNED_PICTOGRAM_DIRECTORIES,
  HERO_ARTWORK_DIRECTORIES,
  LEGACY_OPTICAL_POLICIES,
  canonicalReferencePictograms,
  installedPictograms,
  pictogramManifest,
  strictlyCommissionedPictograms,
} from '../assets/pictogram-manifest';
import { FINANCE_ASSET_FILES, financeIconAssets } from '../assets/finance-icon-assets';
import { FRAMEWORK_MODULE_IDS } from '../module-tokens';
import { moduleRegistry } from '../module-registry';
import {
  moduleRasterIcon,
  modulesWithRasterIcons,
  rasterIconNamesFor,
} from '../module-raster-icons';

/**
 * **One pictogram system, locked** — issue #104.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── What this file is for ───────────────────────────────────────────────────
 * `pictogram-sizing-standard.test.tsx` (#70) asserts that artwork renders at the right *size*.
 * `finance-raster-icons.test.tsx` (#68) asserts that Finance's five assets are mapped and valid.
 * Neither can see the failures that come from the system having no owner: an asset installed and
 * mapped to nothing, a mapping that leaks across modules, a canonical reference quietly re-exported,
 * a hero illustration dropped into the pictogram registry, a control glyph reclassified as a
 * pictogram to raise PNG coverage.
 *
 * Those are what this file is about. Each assertion below corresponds to a failure mode named in
 * #104, and each was proved by mutation — the mutation log is in the pull request, not restated here.
 *
 * ── What it deliberately does not assert ────────────────────────────────────
 * Nothing here reads a pixel and concludes anything about whether a drawing belongs to the family.
 * That judgement is a reference-sheet review by a person, required by
 * `docs/NOORLIFE_UI_DESIGN_SPEC.md` §2.6. A green run on this file means the bytes are right and the
 * wiring is honest. It never means the artwork is good, and a reviewer who reads it that way has
 * been misled by the test rather than informed by it.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const REPO_ROOT = join(__dirname, '..', '..', '..', '..');

const abs = (file: string): string => join(REPO_ROOT, file);

const read = (file: string): string => readFileSync(abs(file), 'utf8');

const sha256 = (file: string): string =>
  createHash('sha256')
    .update(readFileSync(abs(file)))
    .digest('hex');

/** IHDR sits at a fixed offset, so dimensions need no inflate. */
function pngDimensions(file: string): { width: number; height: number } {
  const buf = readFileSync(abs(file));
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function pngsIn(directory: string): readonly string[] {
  const full = abs(directory);
  if (!existsSync(full)) {
    return [];
  }
  return readdirSync(full, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.png'))
    .map((entry) => `${directory}/${entry.name}`)
    .sort();
}

const MANIFEST_FILES = new Set(pictogramManifest.map((entry) => entry.file));

/**
 * Icon names that are controls, wayfinding or status.
 *
 * These are the class-2 glyphs from §2.6. They are shared across every module and mean the same
 * thing everywhere, which is exactly why they must not be commissioned: artwork keyed per module
 * would make "back" look like eight different actions, and a coloured pictogram on a destructive
 * control reads as decoration rather than as a warning.
 */
const CONTROL_AND_STATUS_ICONS: readonly IconName[] = [
  'back',
  'help',
  'close',
  'add',
  'minus',
  'check',
  'check-circle',
  'chevron-back',
  'chevron-down',
  'chevron-forward',
  'chevron-up',
  'search',
  'settings',
  'more',
  'retry',
  'warning',
  'error',
  'info',
  'info-outline',
  'download',
  'downloading',
  'play',
  'pause',
  'skip-next',
  'skip-previous',
  'share',
  'edit',
  'delete',
  'send',
  'microphone',
  'notification',
  'lock',
  'bookmark',
];

// ─────────────────────────────────────────────────────────────────────────────
// The manifest describes exactly what is on disk
// ─────────────────────────────────────────────────────────────────────────────

describe('manifest coverage', () => {
  it('is not vacuous', () => {
    expect(pictogramManifest.length).toBeGreaterThan(0);
    expect(installedPictograms().length).toBeGreaterThan(0);
    expect(canonicalReferencePictograms().length).toBeGreaterThan(0);
  });

  it('uses a stable, unique id and a unique file for every entry', () => {
    const ids = pictogramManifest.map((entry) => entry.id);
    const files = pictogramManifest.map((entry) => entry.file);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(files).size).toBe(files.length);
  });

  it('points every entry at a file that exists', () => {
    const missing = pictogramManifest.filter((entry) => !existsSync(abs(entry.file)));
    expect(missing.map((entry) => entry.file)).toEqual([]);
  });

  it('leaves no commissioned PNG in a governed directory unmanifested', () => {
    /*
      The direction that matters. A manifest listing assets that exist proves nothing about the ones
      it forgot, and "somebody dropped a PNG in and wired it up locally" is precisely how a ninth
      batch would escape every rule in this file.
    */
    const onDisk = GOVERNED_PICTOGRAM_DIRECTORIES.flatMap((directory) => pngsIn(directory));
    expect(onDisk.length).toBeGreaterThan(0);
    expect(onDisk.filter((file) => !MANIFEST_FILES.has(file))).toEqual([]);
  });

  it('pins the bytes of every entry', () => {
    const drifted = pictogramManifest
      .filter((entry) => sha256(entry.file) !== entry.sha256)
      .map((entry) => ({ id: entry.id, expected: entry.sha256, actual: sha256(entry.file) }));
    expect(drifted).toEqual([]);
  });

  it('pins the pixel dimensions of every entry', () => {
    const wrong = pictogramManifest
      .filter((entry) => {
        const actual = pngDimensions(entry.file);
        return actual.width !== entry.pixels.width || actual.height !== entry.pixels.height;
      })
      .map((entry) => entry.id);
    expect(wrong).toEqual([]);
  });

  it('keeps every id and path brand-neutral', () => {
    const branded = pictogramManifest
      .filter((entry) => !isBrandNeutral(entry.id) || !isBrandNeutral(entry.file))
      .map((entry) => entry.id);
    expect(branded).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Delivery rules
// ─────────────────────────────────────────────────────────────────────────────

describe('the delivery contract', () => {
  it('validates every strictly-commissioned asset against commissionedAssetViolations, unmodified', () => {
    const strict = strictlyCommissionedPictograms();
    expect(strict.length).toBeGreaterThan(0);

    const failures = strict
      .map((entry) => ({ id: entry.id, reasons: commissionedAssetViolations(abs(entry.file)) }))
      .filter((result) => result.reasons.length > 0);
    expect(failures).toEqual([]);
  });

  it('freezes the legacy policies to the exact ids that already carry them', () => {
    /*
      The load-bearing assertion of this file.

      Twenty-three installed assets predate #70 and cannot satisfy it without being redrawn, so they
      carry a legacy policy. The risk is not that they exist — it is that a *new* asset delivered to
      the looser numbers gets labelled `legacy-faith-submenu-256` and passes, because a neighbour
      already does. Freezing the id list means adopting a legacy policy is a diff to this array, in
      review, and not a field somebody set while wiring a batch up.
    */
    const legacy = pictogramManifest
      .filter((entry) => LEGACY_OPTICAL_POLICIES.includes(entry.optical))
      .map((entry) => entry.id)
      .sort();

    expect(legacy).toEqual(
      [
        'faith-pictogram/d1',
        'faith-pictogram/d2',
        'faith-pictogram/h1',
        'faith-pictogram/h2',
        'faith-pictogram/h3',
        'faith-pictogram/p1',
        'faith-pictogram/p2-asr',
        'faith-pictogram/p2-dhuhr',
        'faith-pictogram/p2-fajr',
        'faith-pictogram/p2-isha',
        'faith-pictogram/p2-maghrib',
        'faith-pictogram/p2-sunrise',
        'faith-pictogram/p3',
        'faith-pictogram/p4',
        'faith-pictogram/s1',
        'faith-submenu/calendar',
        'faith-submenu/duas',
        'faith-submenu/hadith',
        'faith-submenu/mosques',
        'faith-submenu/prayer',
        'faith-submenu/qibla',
        'faith-submenu/quran',
        'faith-submenu/tasbih',
        'main-home-original/family',
        'main-home-original/faith',
        'main-home-original/finance',
        'main-home-original/goals',
        'main-home-original/health',
        'main-home-original/learning',
        'main-home-original/noor-ai',
        'main-home-original/planner',
      ].sort(),
    );
  });

  it('keeps the margin and centring rules at the values #70 measured', () => {
    /*
      Pinned, not imported for convenience. Weakening MIN_SAFETY_MARGIN_PX or MAX_CENTRE_OFFSET_PX is
      the cheapest way to make a sloppy delivery pass, and #70 records that the 8 px centring
      tolerance it started with let a 7 px misplacement through. If these move, this test should fail
      and be re-read rather than silently follow them.
    */
    const contract = jest.requireActual<typeof import('@/test-support/raster-icon-contract')>(
      '@/test-support/raster-icon-contract',
    );

    expect(contract.COMMISSIONED_CANVAS).toBe(256);
    expect(contract.MIN_SAFETY_MARGIN_PX).toBe(19);
    expect(contract.MAX_OPTICAL_BOX_RATIO).toBe(0.85);
    expect(contract.MAX_CENTRE_OFFSET_PX).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Nothing is installed without a consumer, and nothing staged resolves
// ─────────────────────────────────────────────────────────────────────────────

describe('installation and consumers', () => {
  it('gives every installed asset at least one named production consumer', () => {
    const orphans = installedPictograms()
      .filter((entry) => entry.consumers.length === 0)
      .map((entry) => entry.id);
    expect(orphans).toEqual([]);
  });

  it('gives every installed asset a resolvable source', () => {
    const unresolved = installedPictograms()
      .filter((entry) => entry.source === null)
      .map((entry) => entry.id);
    expect(unresolved).toEqual([]);
  });

  it('lets a staged or preserved asset resolve nowhere and claim no consumer', () => {
    /*
      `finance-track.png` and `p3-reminder-bell.png` are installed on disk and deliberately mapped to
      nothing — Finance has no surface that means "track", and a dimensional gold bell beside a row
      that schedules no notification would assert that reminders work. Both decisions were prose in
      the file that declined to use them. This is the machine-checkable half.
    */
    const wrong = pictogramManifest
      .filter((entry) => entry.role !== 'installed')
      .filter((entry) => entry.source !== null || entry.consumers.length > 0)
      .map((entry) => entry.id);
    expect(wrong).toEqual([]);
  });

  it('marks every non-installed asset staged, and no installed asset staged', () => {
    const inconsistent = pictogramManifest
      .filter((entry) => (entry.role === 'installed') === (entry.availability === 'staged'))
      .map((entry) => entry.id);
    expect(inconsistent).toEqual([]);
  });

  it('shares an asset only where more than one consumer needs it', () => {
    const wrong = pictogramManifest
      .filter((entry) => entry.scope === 'shared' && entry.consumers.length < 2)
      .map((entry) => entry.id);
    expect(wrong).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The mapping layer agrees with the manifest
// ─────────────────────────────────────────────────────────────────────────────

describe('module-scoped mapping', () => {
  const financeIcons = Object.keys(financeIconAssets) as IconName[];

  it('manifests every raster the module mapping can actually resolve', () => {
    const mapped = modulesWithRasterIcons().flatMap((moduleId) =>
      rasterIconNamesFor(moduleId).map((icon) => `${moduleId}/${icon}`),
    );
    expect(mapped.length).toBeGreaterThan(0);

    const manifested = new Set(
      pictogramManifest
        .filter((entry) => entry.availability === 'available-only')
        .map((entry) => `${entry.module}/${entry.icon}`),
    );
    expect(mapped.filter((key) => !manifested.has(key))).toEqual([]);
  });

  it('refuses artwork for every mapped icon when the surface is unavailable', () => {
    /*
      The rule #68 built and #70 relied on. An unavailable tile greys its icon to `textTertiary` and
      artwork cannot be tinted, so a disabled tile that resolved a full-colour pictogram would lose
      the only affordance that says it is disabled.

      Asserted over the pairs that **can** resolve, not over the registry's unavailable capabilities.
      The obvious version — walk every `available: false` tile and check it gets no artwork — is
      vacuous today and would stay vacuous: Finance's two unavailable tiles are `money` and
      `document`, neither of which is in any artwork table, so it passes whether the `available`
      guard exists or not. Deleting the guard entirely would not move it.

      So this asks the question the guard actually answers: for every (module, icon) pair that has
      artwork, does `available: false` withhold it? That fails the moment the early return goes.
    */
    const mapped = modulesWithRasterIcons().flatMap((moduleId) =>
      rasterIconNamesFor(moduleId).map((icon) => ({ moduleId, icon })),
    );
    expect(mapped.length).toBeGreaterThan(0);

    const leaks = mapped
      .filter(({ moduleId, icon }) => moduleRasterIcon(moduleId, icon, false) !== null)
      .map(({ moduleId, icon }) => `${moduleId}/${icon}`);
    expect(leaks).toEqual([]);

    /* Non-vacuous in the other direction too: the same pairs do resolve when available. */
    const available = mapped.filter(
      ({ moduleId, icon }) => moduleRasterIcon(moduleId, icon, true) !== null,
    );
    expect(available.length).toBe(mapped.length);
  });

  it('gives every unavailable capability in the registry a glyph, on every module', () => {
    const leaks = FRAMEWORK_MODULE_IDS.flatMap((moduleId) =>
      moduleRegistry[moduleId].capabilities
        .filter((capability) => !capability.available)
        .filter((capability) => moduleRasterIcon(moduleId, capability.icon, false) !== null)
        .map((capability) => `${moduleId}/${capability.key}`),
    );
    expect(leaks).toEqual([]);
  });

  it('never resolves one module’s artwork for another module', () => {
    /*
      `add-circle` is Family's, Goals' and Planner's icon as well as Finance's; `home` is Health's;
      `target` is Goals'. A lookup keyed on icon name alone would put Finance's wallet on Planner's
      add button, and wrong artwork reads as a bug where a flat glyph only reads as unfinished.
    */
    const leaks = FRAMEWORK_MODULE_IDS.filter((moduleId) => moduleId !== 'finance').flatMap(
      (moduleId) =>
        financeIcons
          .filter((icon) => moduleRasterIcon(moduleId, icon) !== null)
          .map((icon) => `${moduleId}/${icon}`),
    );
    expect(leaks).toEqual([]);
  });

  it('leaves Finance’s mapping behaviourally exactly as #68 and #70 left it', () => {
    expect(modulesWithRasterIcons()).toEqual(['finance']);
    expect([...rasterIconNamesFor('finance')].sort()).toEqual([
      'add-circle',
      'budgets',
      'home',
      'target',
      'transactions',
    ]);
    for (const icon of financeIcons) {
      expect(moduleRasterIcon('finance', icon)).not.toBeNull();
      expect(moduleRasterIcon('finance', icon, false)).toBeNull();
    }
    /* Bank sync and Receipts are `available: false`, and neither has artwork to resolve. */
    expect(moduleRasterIcon('finance', 'document')).toBeNull();
    expect(moduleRasterIcon('finance', 'money')).toBeNull();
  });

  it('keeps finance-track installed, manifested and mapped to nothing', () => {
    expect(FINANCE_ASSET_FILES).toContain('finance-track.png');
    expect(financeIconAssets.track).toBeUndefined();
    expect(moduleRasterIcon('finance', 'track')).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Class boundaries: controls stay glyphs, heroes stay heroes
// ─────────────────────────────────────────────────────────────────────────────

describe('visual class boundaries', () => {
  it('keeps every control, wayfinding and status icon a glyph', () => {
    const commissioned = new Set(pictogramManifest.map((entry) => entry.icon));
    expect(CONTROL_AND_STATUS_ICONS.filter((icon) => commissioned.has(icon))).toEqual([]);
  });

  it('resolves no artwork for a control icon on any module', () => {
    const leaks = FRAMEWORK_MODULE_IDS.flatMap((moduleId) =>
      CONTROL_AND_STATUS_ICONS.filter((icon) => moduleRasterIcon(moduleId, icon) !== null).map(
        (icon) => `${moduleId}/${icon}`,
      ),
    );
    expect(leaks).toEqual([]);
  });

  it('draws every bottom-navigation slot through the glyph path, never the raster one', () => {
    /*
      Class D of #70's sizing standard: the navigation bar is not enlarged and not commissioned. Its
      five slots are wayfinding — they say where you are, not what a thing is — and the AI centre
      control is `robot` on seven modules, the clearest case of a shared mark that must look
      identical everywhere.

      Asserted on the component and *not* on the lookup, because the lookup cannot answer it. Finance
      names its Spending tab and its Spending tile with the same `transactions` icon — correctly, it
      is one concept — so `moduleRasterIcon('finance', 'transactions')` returns artwork and should.
      What keeps the tab a glyph is that the navigation bar never asks. A version of this test that
      demanded a null lookup would fail the moment any module's tab shared a name with a tile it also
      commissioned, and the only way to make it pass would be to break the tile.
    */
    const navigationComponents: readonly string[] = [
      'src/features/modules/components/module-bottom-navigation.tsx',
      'src/design-system/components/module-bottom-navigation.tsx',
      'src/features/home/components/home-bottom-navigation.tsx',
    ];

    for (const file of navigationComponents) {
      const source = read(file);
      expect({ file, consultsRaster: /moduleRasterIcon/.test(source) }).toEqual({
        file,
        consultsRaster: false,
      });
      expect({ file, rendersRaster: /<AppIcon[^>]*\bsource=/s.test(source) }).toEqual({
        file,
        rendersRaster: false,
      });
      /* Non-vacuous: the bar does draw icons, and every one of them is a glyph. */
      expect(source).toMatch(/<AppIcon\s+name=\{item\.icon\}/);
    }
  });

  it('admits no hero illustration into the pictogram manifest', () => {
    const heroes = pictogramManifest
      .filter((entry) => HERO_ARTWORK_DIRECTORIES.some((dir) => entry.file.startsWith(`${dir}/`)))
      .map((entry) => entry.id);
    expect(heroes).toEqual([]);
  });

  it('keeps the hero directories non-empty, so the previous assertion is not vacuous', () => {
    for (const directory of HERO_ARTWORK_DIRECTORIES) {
      expect(pngsIn(directory).length).toBeGreaterThan(0);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Source-level rules the type system cannot express
// ─────────────────────────────────────────────────────────────────────────────

describe('source rules', () => {
  const REGISTRY_SOURCES: readonly string[] = [
    'src/features/modules/assets/finance-icon-assets.ts',
    'src/features/modules/assets/pictogram-manifest.ts',
    'src/features/faith/faith-pictogram-assets.ts',
    'src/features/faith/faith-submenu-assets.ts',
    'src/features/home/module-pictograms.ts',
  ];

  it('resolves every asset through a static literal require', () => {
    /*
      Metro resolves `require` at build time. A template string, a variable or a dynamic import
      resolves to nothing in a release bundle — silently, and only in release, which is how an icon
      font fallback gets reintroduced by accident.
    */
    const dynamic = REGISTRY_SOURCES.flatMap((file) =>
      [...read(file).matchAll(/require\(([^)]*)\)/g)]
        .filter((match) => !/^\s*'[^']+'\s*$/.test(match[1] ?? ''))
        .map((match) => `${file}: require(${(match[1] ?? '').trim()})`),
    );
    expect(dynamic).toEqual([]);
  });

  it('has at least one static require to find, so the scan is not vacuous', () => {
    const total = REGISTRY_SOURCES.reduce(
      (count, file) => count + [...read(file).matchAll(/require\('[^']+'\)/g)].length,
      0,
    );
    expect(total).toBeGreaterThan(30);
  });

  it('keeps a tint on raster artwork a compile error rather than a convention', () => {
    /*
      Asserted on the type, not on behaviour, because behaviour cannot see it: the raster branch
      declares `color?: never`, so a caller who tries to tint a pictogram fails to compile. If that
      became `color?: string` every test in this repository would still pass and every commissioned
      asset would become tintable.
    */
    const appIcon = read('src/design-system/components/app-icon.tsx');
    const rasterProps = appIcon.slice(appIcon.indexOf('export type AppRasterIconProps'));
    const rasterBlock = rasterProps.slice(0, rasterProps.indexOf('export type AppIconProps'));

    expect(rasterBlock).toMatch(/readonly color\?: never;/);
    expect(rasterBlock).not.toMatch(/readonly color\?: string/);
    expect(rasterBlock).not.toMatch(/tintColor/);
  });

  it('never tints or boxes a pictogram at a render site', () => {
    const renderSites: readonly string[] = [
      'src/features/home/components/module-grid.tsx',
      'src/features/modules/components/module-feature-grid.tsx',
      'src/features/modules/components/module-quick-action.tsx',
      'src/features/faith/components/faith-locked-library.tsx',
    ];
    const tinted = renderSites.filter((file) => /tintColor/.test(read(file)));
    expect(tinted).toEqual([]);
  });

  it('samples no theme colour from artwork', () => {
    /*
      A palette read out of a PNG is a colour nobody reviewed and no contrast ratio was measured
      against. Every module colour is a recorded token with its measured ratio beside it.
    */
    const sampled = REGISTRY_SOURCES.filter((file) =>
      /getPixel|samplePixel|dominantColou?r|averageColou?r|extractColou?r/i.test(read(file)),
    );
    expect(sampled).toEqual([]);
  });
});
