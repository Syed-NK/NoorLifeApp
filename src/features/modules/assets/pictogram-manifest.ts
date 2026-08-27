import type { ImageSourcePropType } from 'react-native';

import { faithPictograms, type FaithPictogramId } from '@features/faith/faith-pictogram-assets';
import { faithSubmenu, type FaithSubmenuKey } from '@features/faith/faith-submenu-assets';
import { modulePictograms } from '@features/home/module-pictograms';
import type { IconName } from '@shared/models/icon';

import type { FrameworkModuleId } from '../module-tokens';
import { financeIconAssets } from './finance-icon-assets';

/**
 * The one contract for every commissioned raster pictogram NoorLife ships — issue #104.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── What this owns, and what it deliberately does not ───────────────────────
 * Four issues each fixed one part of this system. #66 gave `AppIcon` a raster path and made tinting
 * artwork a compile error. #68 mapped Finance's five assets, module-scoped. #70 added
 * `commissionedAssetViolations` after artwork shipped at 63% of Main Home's optical size. #78 ran
 * five staged Planner candidates through that validator and correctly installed none of them.
 *
 * None of them owned the *system*. Thirty-six commissioned PNGs sit in four governed
 * directories under three unrelated registries, and before this file nothing asserted that the set
 * on disk equalled the set that is mapped, that a mapped asset still had the bytes it was reviewed
 * with, or that a new batch could not be delivered to the looser numbers two older sets sit at.
 *
 * So this file owns the **contract** and nothing else. The registries keep owning their `require`
 * calls, because moving them here would duplicate three working tables and give Metro two places to
 * resolve the same asset from:
 *
 *   `modulePictograms`   Main Home's eight module tiles       features/home/module-pictograms.ts
 *   `faithSubmenu`       Faith's eight submenu cards          features/faith/faith-submenu-assets.ts
 *   `faithPictograms`    Faith's sixteen dimensional slots    features/faith/faith-pictogram-assets.ts
 *   `financeIconAssets`  Finance's module-scoped mapping      ./finance-icon-assets.ts
 *
 * Each entry below *reads* its source back out of the registry that owns it. That is the whole
 * ownership model: one contract, four owners, no second copy of any `require`.
 *
 * ── Why the source is resolved rather than re-required ──────────────────────
 * A second `require('…/finance-budgets.png')` here would bundle identically and read correctly, and
 * would still be wrong: the manifest could then describe an asset the app does not actually render,
 * and the guard that exists to catch exactly that would be comparing this file against itself.
 * Resolving through the owner means a mapping removed from `financeIconAssets` fails this manifest
 * rather than being quietly re-supplied by it.
 *
 * ── Three optical standards, and why all of them are recorded ───────────────
 * Measured at `852f28c`, twenty-three of those thirty-six would be rejected by this
 * repository's own validator:
 *
 *   Main Home `normalized/`  256 · RGBA · 71.1% box · 37 px margin   passes
 *   Finance                  256 · RGBA · 78.5–83.2% · 21–37 px      passes
 *   Faith `submenu/`         256 · RGBA · 85.9% · 18 px              fails box and margin
 *   Faith `pictograms/`      1024 · indexed · 85.8–87.1% · 66–72 px  fails canvas and colour type
 *
 * They are not defects. They are two standards that predate #70, on approved artwork that is
 * shipping and must stay byte-identical. Re-exporting them to satisfy a rule written after they
 * were drawn would change approved screens to make a test pass.
 *
 * What was missing is the record that they are *grandfathered*. `optical` names the standard each
 * asset was delivered under; `LEGACY_OPTICAL_POLICIES` is a closed set, and the guard asserts that
 * the ids carrying a legacy policy are exactly the ids frozen here. A new asset therefore cannot
 * adopt a legacy policy by pointing at a neighbour that already has one — the only policy open to
 * new work is `commissioned-256`, which is `commissionedAssetViolations` unmodified.
 *
 * ── What this cannot check ──────────────────────────────────────────────────
 * Every property below is mechanical. Whether a drawing belongs to the family is not, and nothing
 * here should be read as saying otherwise: a green build means the bytes are right, never that the
 * artwork is. `docs/NOORLIFE_UI_DESIGN_SPEC.md` §2.6 names the reference-sheet review that a
 * delivery has to pass in addition to this file, and it is a human gate on purpose.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/**
 * Which optical standard an asset was delivered under.
 *
 * `commissioned-256` is the only one open to new work. The rest are closed sets, frozen by id.
 */
export type PictogramOpticalPolicy =
  /** #70's contract: 256², RGBA, ≥19 px margin, ≤85% box, ≤1 px centre. The validator, unmodified. */
  | 'commissioned-256'
  /** Faith's submenu eight, delivered at 85.9% box / 18 px margin before #70 existed. */
  | 'legacy-faith-submenu-256'
  /** Faith's dimensional fifteen: 1024², indexed palette, Faith's own 84–87% occupancy rule. */
  | 'legacy-faith-dimensional-1024'
  /** Main Home's cleaned originals, kept as the source of record and rendered by nothing. */
  | 'legacy-main-home-original-256';

/** The policies no new asset may be delivered under. */
export const LEGACY_OPTICAL_POLICIES: readonly PictogramOpticalPolicy[] = [
  'legacy-faith-submenu-256',
  'legacy-faith-dimensional-1024',
  'legacy-main-home-original-256',
];

/**
 * When an asset is allowed to resolve.
 *
 * `available-only` is the rule #68 wrote into `moduleRasterIcon`: an unavailable capability tints
 * its icon to `textTertiary`, artwork cannot be tinted, so an unavailable surface gets the glyph.
 * `staged` means installed on disk and deliberately mapped to nothing — it must resolve nowhere.
 */
export type PictogramAvailabilityRule = 'available-only' | 'always' | 'staged';

/**
 * What the file on disk is for.
 *
 * `preserved-original` is a master kept as the source of record. It has no consumer by design, and
 * is the one role exempt from the no-orphan rule.
 */
export type PictogramRole = 'installed' | 'staged' | 'preserved-original';

export type PictogramManifestEntry = {
  /** Stable id. Survives a file rename; never reused for different artwork. */
  readonly id: string;
  /** The module the artwork belongs to. `main` is Main Home's module-tile set. */
  readonly module: FrameworkModuleId | 'main';
  /**
   * The semantic name this artwork answers to *within its module*.
   *
   * For Finance this is an `IconName` and the mapping is keyed on (module, icon) — never on icon
   * name alone, which is what would put Finance's wallet on Planner's add button.
   */
  readonly icon: string;
  /** Path from the repository root. The guard reads the bytes at this path. */
  readonly file: string;
  /** Resolved from the owning registry. `null` for staged and preserved files, which resolve nowhere. */
  readonly source: ImageSourcePropType | null;
  /** Named production consumers, `file:Component(surface)`. Empty only for staged and preserved. */
  readonly consumers: readonly string[];
  /** `shared` only where one asset serves several consumers whose meaning is identical. */
  readonly scope: 'module-specific' | 'shared';
  readonly sha256: string;
  readonly pixels: { readonly width: number; readonly height: number };
  readonly optical: PictogramOpticalPolicy;
  readonly availability: PictogramAvailabilityRule;
  readonly role: PictogramRole;
  /**
   * Part of the reference family a new delivery is reviewed against.
   *
   * Faith and Main Home. Finance is deliberately `false`: #104 records that new Finance artwork
   * must move *toward* Faith's softer weight, so it is not itself a reference.
   */
  readonly canonicalReference: boolean;
};

/** Directories this manifest governs. A commissioned PNG here must have an entry. */
export const GOVERNED_PICTOGRAM_DIRECTORIES: readonly string[] = [
  'assets/images/pictograms',
  'assets/images/pictograms/normalized',
  'assets/images/modules/faith/submenu',
  'assets/images/modules/faith/pictograms',
  'assets/images/modules/finance/pictograms',
];

/**
 * Directories holding the large-artwork class, which is a different contract entirely.
 *
 * Hero illustrations are full-bleed fields behind copy, not compact objects in a well. They have
 * their own sizing, their own scrim and no optical-box rule. A hero that reached the pictogram
 * registry would render at 40 dp as an unreadable smudge, so the guard asserts that no manifest
 * file sits under any of these.
 */
export const HERO_ARTWORK_DIRECTORIES: readonly string[] = [
  'assets/images/modules/heroes',
  'assets/images/modules/faith/hero',
];

function faithSubmenuSource(key: FaithSubmenuKey): ImageSourcePropType {
  const entry = faithSubmenu.find((candidate) => candidate.key === key);
  if (entry === undefined) {
    throw new Error(`faith submenu key not in its registry: ${key}`);
  }
  return entry.source;
}

function faithPictogramSource(id: FaithPictogramId): ImageSourcePropType {
  const entry = faithPictograms.find((candidate) => candidate.id === id);
  if (entry === undefined || entry.asset.status !== 'installed') {
    throw new Error(`faith pictogram is not installed in its registry: ${id}`);
  }
  return entry.asset.source;
}

function financeSource(icon: IconName): ImageSourcePropType {
  const source = financeIconAssets[icon];
  if (source === undefined) {
    throw new Error(`finance icon not in its registry: ${icon}`);
  }
  return source;
}

/**
 * Every commissioned pictogram NoorLife installs, staged and preserved files included.
 *
 * Hashes and pixel dimensions were measured from the bytes at `852f28c`, not transcribed. They are
 * pinned so that a re-export — which changes no rule this repository states and every pixel it
 * ships — fails a build instead of arriving unannounced.
 */
export const pictogramManifest: readonly PictogramManifestEntry[] = [
  {
    id: 'main-home/noor-ai',
    module: 'main',
    icon: 'noor-ai',
    file: 'assets/images/pictograms/normalized/noor-ai.png',
    source: modulePictograms.ai,
    consumers: [
      'features/home/components/module-grid.tsx:ModuleTile',
      'features/modules/module-registry.ts:ASSET',
    ],
    scope: 'module-specific',
    sha256: '13489e8ee5ba7b66fbfa8bf9faf6be8862cd9e3165a02f0d5ea6d1d6ca079a85',
    pixels: { width: 256, height: 256 },
    optical: 'commissioned-256',
    availability: 'always',
    role: 'installed',
    canonicalReference: true,
  },
  {
    id: 'main-home/faith',
    module: 'main',
    icon: 'faith',
    file: 'assets/images/pictograms/normalized/faith.png',
    source: modulePictograms.faith,
    consumers: [
      'features/home/components/module-grid.tsx:ModuleTile',
      'features/modules/module-registry.ts:ASSET',
    ],
    scope: 'module-specific',
    sha256: '5459243cc5ba419ba8ce3a0f00d6838a3e0c7799bda1000fe3c4e1001838a0af',
    pixels: { width: 256, height: 256 },
    optical: 'commissioned-256',
    availability: 'always',
    role: 'installed',
    canonicalReference: true,
  },
  {
    id: 'main-home/health',
    module: 'main',
    icon: 'health',
    file: 'assets/images/pictograms/normalized/health.png',
    source: modulePictograms.health,
    consumers: [
      'features/home/components/module-grid.tsx:ModuleTile',
      'features/modules/module-registry.ts:ASSET',
    ],
    scope: 'module-specific',
    sha256: '6a0945019e08b757c4b6b3e9c91c1ee820df23141d2261ec94f846ad8fa86add',
    pixels: { width: 256, height: 256 },
    optical: 'commissioned-256',
    availability: 'always',
    role: 'installed',
    canonicalReference: true,
  },
  {
    id: 'main-home/planner',
    module: 'main',
    icon: 'planner',
    file: 'assets/images/pictograms/normalized/planner.png',
    source: modulePictograms.planner,
    consumers: [
      'features/home/components/module-grid.tsx:ModuleTile',
      'features/modules/module-registry.ts:ASSET',
    ],
    scope: 'module-specific',
    sha256: 'f6ae2a6c6e0b68689874cfa7ee15942715728ad39965c0f5f71f46de921ec4b8',
    pixels: { width: 256, height: 256 },
    optical: 'commissioned-256',
    availability: 'always',
    role: 'installed',
    canonicalReference: true,
  },
  {
    id: 'main-home/finance',
    module: 'main',
    icon: 'finance',
    file: 'assets/images/pictograms/normalized/finance.png',
    source: modulePictograms.finance,
    consumers: [
      'features/home/components/module-grid.tsx:ModuleTile',
      'features/modules/module-registry.ts:ASSET',
    ],
    scope: 'module-specific',
    sha256: '9dbf03e02a300403cf167b14c7f8b571a9b8119853e40ff5425227967fee008f',
    pixels: { width: 256, height: 256 },
    optical: 'commissioned-256',
    availability: 'always',
    role: 'installed',
    canonicalReference: true,
  },
  {
    id: 'main-home/learning',
    module: 'main',
    icon: 'learning',
    file: 'assets/images/pictograms/normalized/learning.png',
    source: modulePictograms.learning,
    consumers: [
      'features/home/components/module-grid.tsx:ModuleTile',
      'features/modules/module-registry.ts:ASSET',
    ],
    scope: 'module-specific',
    sha256: '931d3189db7759b0ec871c8528e68379ae0d93d8716629a5e187bfab86e474b2',
    pixels: { width: 256, height: 256 },
    optical: 'commissioned-256',
    availability: 'always',
    role: 'installed',
    canonicalReference: true,
  },
  {
    id: 'main-home/family',
    module: 'main',
    icon: 'family',
    file: 'assets/images/pictograms/normalized/family.png',
    source: modulePictograms.family,
    consumers: [
      'features/home/components/module-grid.tsx:ModuleTile',
      'features/modules/module-registry.ts:ASSET',
    ],
    scope: 'module-specific',
    sha256: 'c4f90b97306f754d6baa7b806617f9b5137fe83b534159fd620324c20844a773',
    pixels: { width: 256, height: 256 },
    optical: 'commissioned-256',
    availability: 'always',
    role: 'installed',
    canonicalReference: true,
  },
  {
    id: 'main-home/goals',
    module: 'main',
    icon: 'goals',
    file: 'assets/images/pictograms/normalized/goals.png',
    source: modulePictograms.goals,
    consumers: [
      'features/home/components/module-grid.tsx:ModuleTile',
      'features/modules/module-registry.ts:ASSET',
    ],
    scope: 'module-specific',
    sha256: '05cadcd0f0f015a50687780b84645d9c92cca806850f434a4e227e55063a1d07',
    pixels: { width: 256, height: 256 },
    optical: 'commissioned-256',
    availability: 'always',
    role: 'installed',
    canonicalReference: true,
  },
  {
    id: 'main-home-original/noor-ai',
    module: 'main',
    icon: 'noor-ai',
    file: 'assets/images/pictograms/noor-ai.png',
    source: null,
    consumers: [],
    scope: 'module-specific',
    sha256: 'caf3843155e6d1ea1052684d5924baa4164246b8e50b9e3385d0c43ab34d42da',
    pixels: { width: 256, height: 256 },
    optical: 'legacy-main-home-original-256',
    availability: 'staged',
    role: 'preserved-original',
    canonicalReference: false,
  },
  {
    id: 'main-home-original/faith',
    module: 'main',
    icon: 'faith',
    file: 'assets/images/pictograms/faith.png',
    source: null,
    consumers: [],
    scope: 'module-specific',
    sha256: '69cce4cecf0d787f227e221a198baf8abc5dc570953cfb11569ec8d5c56fa845',
    pixels: { width: 256, height: 256 },
    optical: 'legacy-main-home-original-256',
    availability: 'staged',
    role: 'preserved-original',
    canonicalReference: false,
  },
  {
    id: 'main-home-original/health',
    module: 'main',
    icon: 'health',
    file: 'assets/images/pictograms/health.png',
    source: null,
    consumers: [],
    scope: 'module-specific',
    sha256: '7c80df3aff00f9935f46de8fb237d610247bf4227d8a4c95673ecfb585818260',
    pixels: { width: 256, height: 256 },
    optical: 'legacy-main-home-original-256',
    availability: 'staged',
    role: 'preserved-original',
    canonicalReference: false,
  },
  {
    id: 'main-home-original/planner',
    module: 'main',
    icon: 'planner',
    file: 'assets/images/pictograms/planner.png',
    source: null,
    consumers: [],
    scope: 'module-specific',
    sha256: '3637ca70a12c70660821818cd10dd5c5e2dcd68d1d85c3c086b81ff6d1b36305',
    pixels: { width: 256, height: 256 },
    optical: 'legacy-main-home-original-256',
    availability: 'staged',
    role: 'preserved-original',
    canonicalReference: false,
  },
  {
    id: 'main-home-original/finance',
    module: 'main',
    icon: 'finance',
    file: 'assets/images/pictograms/finance.png',
    source: null,
    consumers: [],
    scope: 'module-specific',
    sha256: '545c159530f2103d6209fb83ec7e6113732e1bc2c1f104293b21840a765fcbb3',
    pixels: { width: 256, height: 256 },
    optical: 'legacy-main-home-original-256',
    availability: 'staged',
    role: 'preserved-original',
    canonicalReference: false,
  },
  {
    id: 'main-home-original/learning',
    module: 'main',
    icon: 'learning',
    file: 'assets/images/pictograms/learning.png',
    source: null,
    consumers: [],
    scope: 'module-specific',
    sha256: 'e68b51d1301ab193a3e7f1b56906cc0ced7de24fd171e8e864dbd9470759bf0a',
    pixels: { width: 256, height: 256 },
    optical: 'legacy-main-home-original-256',
    availability: 'staged',
    role: 'preserved-original',
    canonicalReference: false,
  },
  {
    id: 'main-home-original/family',
    module: 'main',
    icon: 'family',
    file: 'assets/images/pictograms/family.png',
    source: null,
    consumers: [],
    scope: 'module-specific',
    sha256: 'eacac467922e5f89b06508006723ff8968ac0605d3aedd11d81562189be021d8',
    pixels: { width: 256, height: 256 },
    optical: 'legacy-main-home-original-256',
    availability: 'staged',
    role: 'preserved-original',
    canonicalReference: false,
  },
  {
    id: 'main-home-original/goals',
    module: 'main',
    icon: 'goals',
    file: 'assets/images/pictograms/goals.png',
    source: null,
    consumers: [],
    scope: 'module-specific',
    sha256: 'd21202999af9c913045dbc03aa5afd4e9c0cc4d3e9967aa45533af6eb70d088e',
    pixels: { width: 256, height: 256 },
    optical: 'legacy-main-home-original-256',
    availability: 'staged',
    role: 'preserved-original',
    canonicalReference: false,
  },
  {
    id: 'faith-submenu/quran',
    module: 'faith',
    icon: 'quran',
    file: 'assets/images/modules/faith/submenu/01-quran.png',
    source: faithSubmenuSource('quran'),
    consumers: [
      'features/faith/components/faith-identity.tsx:FaithIdentity',
      'features/faith/components/faith-section-hero.tsx:FaithSectionHero',
    ],
    scope: 'module-specific',
    sha256: '91a7f906061122ad08e2076d4b9ad53a5047b34d57839467242a873a3d1883c6',
    pixels: { width: 256, height: 256 },
    optical: 'legacy-faith-submenu-256',
    availability: 'always',
    role: 'installed',
    canonicalReference: true,
  },
  {
    id: 'faith-submenu/hadith',
    module: 'faith',
    icon: 'hadith',
    file: 'assets/images/modules/faith/submenu/02-hadith.png',
    source: faithSubmenuSource('hadith'),
    consumers: [
      'features/faith/components/faith-identity.tsx:FaithIdentity',
      'features/faith/components/faith-section-hero.tsx:FaithSectionHero',
    ],
    scope: 'module-specific',
    sha256: '4f0776dd56158ea9812f6bf55120ef3244e7f9b74e0f513aa0eb6aeb72fc5168',
    pixels: { width: 256, height: 256 },
    optical: 'legacy-faith-submenu-256',
    availability: 'always',
    role: 'installed',
    canonicalReference: true,
  },
  {
    id: 'faith-submenu/duas',
    module: 'faith',
    icon: 'duas',
    file: 'assets/images/modules/faith/submenu/03-duas.png',
    source: faithSubmenuSource('duas'),
    consumers: [
      'features/faith/components/faith-identity.tsx:FaithIdentity',
      'features/faith/components/faith-section-hero.tsx:FaithSectionHero',
    ],
    scope: 'module-specific',
    sha256: '659e51708b37c46e4a36b3b0596152d8e1f5a698530370b407b588de2c43988d',
    pixels: { width: 256, height: 256 },
    optical: 'legacy-faith-submenu-256',
    availability: 'always',
    role: 'installed',
    canonicalReference: true,
  },
  {
    id: 'faith-submenu/prayer',
    module: 'faith',
    icon: 'prayer',
    file: 'assets/images/modules/faith/submenu/04-prayer.png',
    source: faithSubmenuSource('prayer'),
    consumers: [
      'features/faith/components/faith-identity.tsx:FaithIdentity',
      'features/faith/components/faith-section-hero.tsx:FaithSectionHero',
    ],
    scope: 'module-specific',
    sha256: 'e4bf7bafae2c258b7c1171c6c13ade2b6d151281e07f67512cedcad72a802d4e',
    pixels: { width: 256, height: 256 },
    optical: 'legacy-faith-submenu-256',
    availability: 'always',
    role: 'installed',
    canonicalReference: true,
  },
  {
    id: 'faith-submenu/qibla',
    module: 'faith',
    icon: 'qibla',
    file: 'assets/images/modules/faith/submenu/05-qibla.png',
    source: faithSubmenuSource('qibla'),
    consumers: [
      'features/faith/components/faith-identity.tsx:FaithIdentity',
      'features/faith/components/faith-section-hero.tsx:FaithSectionHero',
    ],
    scope: 'module-specific',
    sha256: 'cd9ef45bdbd8c0a8939f29099b63dea1511d2d2380526f7f1430df791e4fc323',
    pixels: { width: 256, height: 256 },
    optical: 'legacy-faith-submenu-256',
    availability: 'always',
    role: 'installed',
    canonicalReference: true,
  },
  {
    id: 'faith-submenu/tasbih',
    module: 'faith',
    icon: 'tasbih',
    file: 'assets/images/modules/faith/submenu/06-tasbih.png',
    source: faithSubmenuSource('tasbih'),
    consumers: [
      'features/faith/components/faith-identity.tsx:FaithIdentity',
      'features/faith/components/faith-section-hero.tsx:FaithSectionHero',
    ],
    scope: 'module-specific',
    sha256: '10b36fcc16e9ff318ac6e34ed048b672e5b4e349a22cc7a6e989be8d088c51ab',
    pixels: { width: 256, height: 256 },
    optical: 'legacy-faith-submenu-256',
    availability: 'always',
    role: 'installed',
    canonicalReference: true,
  },
  {
    id: 'faith-submenu/mosques',
    module: 'faith',
    icon: 'mosques',
    file: 'assets/images/modules/faith/submenu/07-mosques.png',
    source: faithSubmenuSource('mosques'),
    consumers: [
      'features/faith/components/faith-identity.tsx:FaithIdentity',
      'features/faith/components/faith-section-hero.tsx:FaithSectionHero',
    ],
    scope: 'module-specific',
    sha256: '254e046a0ec0a6d3f1661816aef016f719a061eb24a534f208baee5db0b78672',
    pixels: { width: 256, height: 256 },
    optical: 'legacy-faith-submenu-256',
    availability: 'always',
    role: 'installed',
    canonicalReference: true,
  },
  {
    id: 'faith-submenu/calendar',
    module: 'faith',
    icon: 'calendar',
    file: 'assets/images/modules/faith/submenu/08-calendar.png',
    source: faithSubmenuSource('calendar'),
    consumers: [
      'features/faith/components/faith-identity.tsx:FaithIdentity',
      'features/faith/components/faith-section-hero.tsx:FaithSectionHero',
    ],
    scope: 'module-specific',
    sha256: 'd4c350a4125e168a5725ef2c67d63a503203e937321b4aa39e541f1050992415',
    pixels: { width: 256, height: 256 },
    optical: 'legacy-faith-submenu-256',
    availability: 'always',
    role: 'installed',
    canonicalReference: true,
  },
  {
    id: 'faith-pictogram/h1',
    module: 'faith',
    icon: 'h1',
    file: 'assets/images/modules/faith/pictograms/h1-hadith-collections.png',
    source: faithPictogramSource('h1'),
    consumers: ['features/faith/components/faith-locked-library.tsx:FaithPictogram'],
    scope: 'module-specific',
    sha256: '97a25bda9b9718cf684e9e6a8d7bb453734593af6138b3a24ee7a89b490c67b4',
    pixels: { width: 1024, height: 1024 },
    optical: 'legacy-faith-dimensional-1024',
    availability: 'always',
    role: 'installed',
    canonicalReference: true,
  },
  {
    id: 'faith-pictogram/h2',
    module: 'faith',
    icon: 'h2',
    file: 'assets/images/modules/faith/pictograms/h2-bookmarked-book.png',
    source: faithPictogramSource('h2'),
    consumers: [
      'features/faith/components/faith-locked-library.tsx:FaithPictogram(h2)',
      'features/faith/components/faith-locked-library.tsx:FaithPictogram(d3)',
    ],
    scope: 'shared',
    sha256: '04426cff3dcbe259f96828221564c9e551e348294921ca1552f230f1e396a057',
    pixels: { width: 1024, height: 1024 },
    optical: 'legacy-faith-dimensional-1024',
    availability: 'always',
    role: 'installed',
    canonicalReference: true,
  },
  {
    id: 'faith-pictogram/h3',
    module: 'faith',
    icon: 'h3',
    file: 'assets/images/modules/faith/pictograms/h3-reading-history.png',
    source: faithPictogramSource('h3'),
    consumers: ['features/faith/components/faith-locked-library.tsx:FaithPictogram'],
    scope: 'module-specific',
    sha256: '775134083bbe5293d6ee60386126bd0c3b63a50a1dc2ef709e3b6125437f5ce0',
    pixels: { width: 1024, height: 1024 },
    optical: 'legacy-faith-dimensional-1024',
    availability: 'always',
    role: 'installed',
    canonicalReference: true,
  },
  {
    id: 'faith-pictogram/d1',
    module: 'faith',
    icon: 'd1',
    file: 'assets/images/modules/faith/pictograms/d1-morning-evening.png',
    source: faithPictogramSource('d1'),
    consumers: ['features/faith/components/faith-locked-library.tsx:FaithPictogram'],
    scope: 'module-specific',
    sha256: '8adbf5e351282a4a5aaa82e227e71e8fdfb335330e12a55bb757fe6471f37b78',
    pixels: { width: 1024, height: 1024 },
    optical: 'legacy-faith-dimensional-1024',
    availability: 'always',
    role: 'installed',
    canonicalReference: true,
  },
  {
    id: 'faith-pictogram/d2',
    module: 'faith',
    icon: 'd2',
    file: 'assets/images/modules/faith/pictograms/d2-everyday-moments.png',
    source: faithPictogramSource('d2'),
    consumers: ['features/faith/components/faith-locked-library.tsx:FaithPictogram'],
    scope: 'module-specific',
    sha256: 'ebb184bad8a52d8034040caed70331dee79e06b08bfb448d7cb62a08a9824594',
    pixels: { width: 1024, height: 1024 },
    optical: 'legacy-faith-dimensional-1024',
    availability: 'always',
    role: 'installed',
    canonicalReference: true,
  },
  {
    id: 'faith-pictogram/s1',
    module: 'faith',
    icon: 's1',
    file: 'assets/images/modules/faith/pictograms/s1-verified-shield.png',
    source: faithPictogramSource('s1'),
    consumers: ['features/faith/components/faith-locked-library.tsx:FaithPictogram'],
    scope: 'module-specific',
    sha256: '9df8d66a8f8bba48450a7b29ebb136d8700862d5f37bd9397b845d949eecf921',
    pixels: { width: 1024, height: 1024 },
    optical: 'legacy-faith-dimensional-1024',
    availability: 'always',
    role: 'installed',
    canonicalReference: true,
  },
  {
    id: 'faith-pictogram/p1',
    module: 'faith',
    icon: 'p1',
    file: 'assets/images/modules/faith/pictograms/p1-location-mosque-pin.png',
    source: faithPictogramSource('p1'),
    consumers: ['features/faith/components/faith-locked-library.tsx:FaithPictogram'],
    scope: 'module-specific',
    sha256: 'a889545d8e351d6eb4370b5b4ca729f03d37098fc2dc5e747112a9cf335f011b',
    pixels: { width: 1024, height: 1024 },
    optical: 'legacy-faith-dimensional-1024',
    availability: 'always',
    role: 'installed',
    canonicalReference: true,
  },
  {
    id: 'faith-pictogram/p2-fajr',
    module: 'faith',
    icon: 'p2-fajr',
    file: 'assets/images/modules/faith/pictograms/p2-fajr.png',
    source: faithPictogramSource('p2-fajr'),
    consumers: ['features/faith/components/faith-locked-library.tsx:FaithPictogram'],
    scope: 'module-specific',
    sha256: 'cb26e98f8959374e71d9842acd7e9fbfdc1c429fc92cb04252c5b4fc3bc60169',
    pixels: { width: 1024, height: 1024 },
    optical: 'legacy-faith-dimensional-1024',
    availability: 'always',
    role: 'installed',
    canonicalReference: true,
  },
  {
    id: 'faith-pictogram/p2-sunrise',
    module: 'faith',
    icon: 'p2-sunrise',
    file: 'assets/images/modules/faith/pictograms/p2-sunrise.png',
    source: faithPictogramSource('p2-sunrise'),
    consumers: ['features/faith/components/faith-locked-library.tsx:FaithPictogram'],
    scope: 'module-specific',
    sha256: 'bf1751e6463922c6b6954c7c10008925e4f661b69d08755b6140643ea8762d77',
    pixels: { width: 1024, height: 1024 },
    optical: 'legacy-faith-dimensional-1024',
    availability: 'always',
    role: 'installed',
    canonicalReference: true,
  },
  {
    id: 'faith-pictogram/p2-dhuhr',
    module: 'faith',
    icon: 'p2-dhuhr',
    file: 'assets/images/modules/faith/pictograms/p2-dhuhr.png',
    source: faithPictogramSource('p2-dhuhr'),
    consumers: ['features/faith/components/faith-locked-library.tsx:FaithPictogram'],
    scope: 'module-specific',
    sha256: 'da690a1e9421f3af0c218b4cd1acb278a823886acccf79ff9fd30fed12cfd0a4',
    pixels: { width: 1024, height: 1024 },
    optical: 'legacy-faith-dimensional-1024',
    availability: 'always',
    role: 'installed',
    canonicalReference: true,
  },
  {
    id: 'faith-pictogram/p2-asr',
    module: 'faith',
    icon: 'p2-asr',
    file: 'assets/images/modules/faith/pictograms/p2-asr.png',
    source: faithPictogramSource('p2-asr'),
    consumers: ['features/faith/components/faith-locked-library.tsx:FaithPictogram'],
    scope: 'module-specific',
    sha256: '995ad8d1d883fa0cc27bcf46a0fcd7ca2de661def4c10de7419eb9567df80085',
    pixels: { width: 1024, height: 1024 },
    optical: 'legacy-faith-dimensional-1024',
    availability: 'always',
    role: 'installed',
    canonicalReference: true,
  },
  {
    id: 'faith-pictogram/p2-maghrib',
    module: 'faith',
    icon: 'p2-maghrib',
    file: 'assets/images/modules/faith/pictograms/p2-maghrib.png',
    source: faithPictogramSource('p2-maghrib'),
    consumers: ['features/faith/components/faith-locked-library.tsx:FaithPictogram'],
    scope: 'module-specific',
    sha256: 'e31182f313ccc6269d46e76a8db0c16e6856a92762d29a6b124aaf3d807c2074',
    pixels: { width: 1024, height: 1024 },
    optical: 'legacy-faith-dimensional-1024',
    availability: 'always',
    role: 'installed',
    canonicalReference: true,
  },
  {
    id: 'faith-pictogram/p2-isha',
    module: 'faith',
    icon: 'p2-isha',
    file: 'assets/images/modules/faith/pictograms/p2-isha.png',
    source: faithPictogramSource('p2-isha'),
    consumers: ['features/faith/components/faith-locked-library.tsx:FaithPictogram'],
    scope: 'module-specific',
    sha256: '00eb373ba3a4f1f4d7fbdb543f9e923f04f085e208c448f1fc00e88e3e55243e',
    pixels: { width: 1024, height: 1024 },
    optical: 'legacy-faith-dimensional-1024',
    availability: 'always',
    role: 'installed',
    canonicalReference: true,
  },
  {
    id: 'faith-pictogram/p4',
    module: 'faith',
    icon: 'p4',
    file: 'assets/images/modules/faith/pictograms/p4-calculation-gear.png',
    source: faithPictogramSource('p4'),
    consumers: ['features/faith/components/faith-locked-library.tsx:FaithPictogram'],
    scope: 'module-specific',
    sha256: '4a02f194bbb558ed59a53e69b264a1139918ae4233b9c898db724eb05598f6c2',
    pixels: { width: 1024, height: 1024 },
    optical: 'legacy-faith-dimensional-1024',
    availability: 'always',
    role: 'installed',
    canonicalReference: true,
  },
  {
    id: 'faith-pictogram/p3',
    module: 'faith',
    icon: 'p3',
    file: 'assets/images/modules/faith/pictograms/p3-reminder-bell.png',
    source: null,
    consumers: [],
    scope: 'module-specific',
    sha256: 'fc8f96f520464f2c3e5c1309c3332394265eddd345c4dbeac636c6d2a170f639',
    pixels: { width: 1024, height: 1024 },
    optical: 'legacy-faith-dimensional-1024',
    availability: 'staged',
    role: 'staged',
    canonicalReference: true,
  },
  {
    id: 'finance/add-circle',
    module: 'finance',
    icon: 'add-circle',
    file: 'assets/images/modules/finance/pictograms/finance-add-circle.png',
    source: financeSource('add-circle'),
    consumers: [
      'features/modules/components/module-quick-action.tsx:ModuleQuickActionRow(finance/add-expense)',
    ],
    scope: 'module-specific',
    sha256: '4726eeccf17ccd282f277433b027b7bcf738aa2951878cb31ee25bc8560d7b33',
    pixels: { width: 256, height: 256 },
    optical: 'commissioned-256',
    availability: 'available-only',
    role: 'installed',
    canonicalReference: false,
  },
  {
    id: 'finance/budgets',
    module: 'finance',
    icon: 'budgets',
    file: 'assets/images/modules/finance/pictograms/finance-budgets.png',
    source: financeSource('budgets'),
    consumers: [
      'features/modules/components/module-quick-action.tsx:ModuleQuickActionRow(finance/budgets)',
      'features/modules/components/module-feature-grid.tsx:ModuleFeatureGrid(finance/budgets)',
    ],
    scope: 'shared',
    sha256: '098f1b850a5a3f7a32e397b8e0a6a41819fd4c278d3f25eec29fe3c5f4c97975',
    pixels: { width: 256, height: 256 },
    optical: 'commissioned-256',
    availability: 'available-only',
    role: 'installed',
    canonicalReference: false,
  },
  {
    id: 'finance/transactions',
    module: 'finance',
    icon: 'transactions',
    file: 'assets/images/modules/finance/pictograms/finance-transactions.png',
    source: financeSource('transactions'),
    consumers: [
      'features/modules/components/module-feature-grid.tsx:ModuleFeatureGrid(finance/transactions)',
    ],
    scope: 'module-specific',
    sha256: '67a918414cc4a92d7ab3d7a629a7e3f27899800e758e388506756f48261e9276',
    pixels: { width: 256, height: 256 },
    optical: 'commissioned-256',
    availability: 'available-only',
    role: 'installed',
    canonicalReference: false,
  },
  {
    id: 'finance/home',
    module: 'finance',
    icon: 'home',
    file: 'assets/images/modules/finance/pictograms/finance-money.png',
    source: financeSource('home'),
    consumers: [
      'features/modules/components/module-feature-grid.tsx:ModuleFeatureGrid(finance/overview)',
    ],
    scope: 'module-specific',
    sha256: '564fe6d4378293360a37d63b0159c7b1581ccaa13f94623f693b94d5eb5c4bb9',
    pixels: { width: 256, height: 256 },
    optical: 'commissioned-256',
    availability: 'available-only',
    role: 'installed',
    canonicalReference: false,
  },
  {
    id: 'finance/track',
    module: 'finance',
    icon: 'track',
    file: 'assets/images/modules/finance/pictograms/finance-track.png',
    source: null,
    consumers: [],
    scope: 'module-specific',
    sha256: 'c4ef0fbcfbc191259bd4ef6059377a1fb25445568ce0870d794560c85aedf6e8',
    pixels: { width: 256, height: 256 },
    optical: 'commissioned-256',
    availability: 'staged',
    role: 'staged',
    canonicalReference: false,
  },
];

/** Entries that render somewhere. */
export function installedPictograms(): readonly PictogramManifestEntry[] {
  return pictogramManifest.filter((entry) => entry.role === 'installed');
}

/** Entries whose optical policy is the one open to new work. */
export function strictlyCommissionedPictograms(): readonly PictogramManifestEntry[] {
  return pictogramManifest.filter((entry) => entry.optical === 'commissioned-256');
}

/** The reference family a delivery is reviewed against — Faith and Main Home. */
export function canonicalReferencePictograms(): readonly PictogramManifestEntry[] {
  return pictogramManifest.filter((entry) => entry.canonicalReference);
}

export function pictogramById(id: string): PictogramManifestEntry {
  const entry = pictogramManifest.find((candidate) => candidate.id === id);
  if (entry === undefined) {
    throw new Error(`no pictogram manifest entry: ${id}`);
  }
  return entry;
}
