import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { render } from '@testing-library/react-native';

import { iconSize, neutralColors } from '@ds/tokens';

import { AppIcon } from '../app-icon';

/**
 * **The coloured raster path, and the glyph path it must not disturb** — issue #66.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * `AppIcon` was the only icon primitive and could only draw one monochrome glyph, tinted. So every
 * surface that is not a commissioned pictogram — quick actions, feature grids, navigation, empty
 * states, settings rows — was flat by construction, and eight planned asset batches had nothing safe
 * to render into.
 *
 * The risk in adding a second path is not that the new one misbehaves. It is that the old one
 * changes: 139 call sites across 76 files pass a semantic name, and none of them was edited. So the
 * first group below is about the glyph path being exactly what it was, and the rest are about the
 * raster path being unable to do the four things that would ruin commissioned artwork — tint it,
 * stretch it, hide it from a reader who needs it, or announce it to one who does not.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/**
 * Queries include accessibility-hidden nodes.
 *
 * Decorative icons set `accessibilityElementsHidden`, which is the behaviour under test — and which
 * RNTL's queries exclude by default. Without this every decorative case would fail for the reason it
 * is supposed to pass.
 */
const HIDDEN = { includeHiddenElements: true } as const;

/**
 * Flattens whatever RN nested the style prop into.
 *
 * The glyph path renders a `Text` whose size and colour arrive as `fontSize` and `color` *in the
 * style*, not as props — the icon library composes them that way. Asserting on props would have
 * passed vacuously against `undefined`, so the values are read where they actually are.
 */
function flat(style: unknown): Record<string, unknown> {
  return (Array.isArray(style) ? style.flat(4) : [style])
    .filter((e): e is Record<string, unknown> => typeof e === 'object' && e !== null)
    .reduce<Record<string, unknown>>((all, e) => ({ ...all, ...e }), {});
}

/** A NoorLife-owned commissioned pictogram, used as-is. Not moved, copied or modified. */
const PICTOGRAM_DIR = join(__dirname, '..', '..', '..', '..', 'assets', 'images', 'pictograms');
const FIXTURE = join(PICTOGRAM_DIR, 'finance.png');
const FIXTURE_SOURCE = require('../../../../assets/images/pictograms/finance.png');

describe('the glyph path is unchanged', () => {
  it('renders a glyph at the token size, tinted with the default', async () => {
    const view = await render(<AppIcon name="home" testID="icon" />);
    const style = flat(view.getByTestId('icon', HIDDEN).props.style);
    expect(style.fontSize).toBe(iconSize.md);
    expect(style.color).toBe(neutralColors.textSecondary);
  });

  it('honours an explicit colour and an explicit pixel size', async () => {
    const view = await render(<AppIcon name="home" size={31} color="#123456" testID="icon" />);
    const style = flat(view.getByTestId('icon', HIDDEN).props.style);
    expect(style.fontSize).toBe(31);
    expect(style.color).toBe('#123456');
  });

  it('is hidden from a reader by default, because the control around it carries the label', async () => {
    /*
      136 of the 139 call sites pass no label. A second announcement beside a row or button that
      already said what it does is noise, so decorative is the default on both paths.
    */
    const view = await render(<AppIcon name="home" testID="icon" />);
    const icon = view.getByTestId('icon', HIDDEN);
    expect(icon.props.accessible).toBe(false);
    expect(icon.props.accessibilityElementsHidden).toBe(true);
    expect(icon.props.importantForAccessibility).toBe('no');
  });

  it('is announced when it is the sole carrier of meaning', async () => {
    const view = await render(<AppIcon name="home" accessibilityLabel="Home" testID="icon" />);
    const icon = view.getByTestId('icon', HIDDEN);
    expect(icon.props.accessible).toBe(true);
    expect(icon.props.accessibilityRole).toBe('image');
    expect(icon.props.accessibilityLabel).toBe('Home');
  });
});

describe('the raster path', () => {
  it('renders the artwork contained in a square box at the token size', async () => {
    /*
      `contain` is the whole layout rule and the one the shipped assets were drawn for. `cover` would
      crop a pictogram's edges; a single-axis dimension would distort it. Both are silent on a small
      icon and obvious on a large one, which is why this is asserted rather than reviewed.
    */
    const view = await render(<AppIcon source={FIXTURE_SOURCE} size="lg" testID="art" />);
    const image = view.getByTestId('art', HIDDEN);
    expect(image.props.resizeMode).toBe('contain');
    const style = flat(image.props.style);
    expect(style.width).toBe(iconSize.lg);
    expect(style.height).toBe(iconSize.lg);
  });

  it('applies no tint of any kind', async () => {
    /*
      Not merely "no colour prop was passed" — the rendered image must carry no tint property at all.
      Tinting a commissioned pictogram destroys the thing it was commissioned for, and `tintColor` is
      a style, so a type that forbids the prop does not by itself forbid the effect.
    */
    const view = await render(<AppIcon source={FIXTURE_SOURCE} testID="art" />);
    const image = view.getByTestId('art', HIDDEN);
    const style = flat(image.props.style);
    expect(style.tintColor).toBeUndefined();
    expect(image.props.tintColor).toBeUndefined();
    expect(image.props.color).toBeUndefined();
  });

  it('preserves aspect ratio by never scaling one axis alone', async () => {
    const view = await render(<AppIcon source={FIXTURE_SOURCE} size={40} testID="art" />);
    const style = flat(view.getByTestId('art', HIDDEN).props.style);
    expect(style.width).toBe(style.height);
    expect(style.aspectRatio).toBeUndefined();
  });

  it('is decorative by default and announced when labelled', async () => {
    const plain = await render(<AppIcon source={FIXTURE_SOURCE} testID="a" />);
    expect(plain.getByTestId('a', HIDDEN).props.accessible).toBe(false);
    expect(plain.getByTestId('a', HIDDEN).props.accessibilityElementsHidden).toBe(true);

    const labelled = await render(
      <AppIcon source={FIXTURE_SOURCE} accessibilityLabel="Finance" testID="b" />,
    );
    expect(labelled.getByTestId('b', HIDDEN).props.accessible).toBe(true);
    expect(labelled.getByTestId('b', HIDDEN).props.accessibilityLabel).toBe('Finance');
    expect(labelled.getByTestId('b', HIDDEN).props.accessibilityRole).toBe('image');
  });

  it('claims no tap target, because the interactive parent owns hit size', async () => {
    const view = await render(<AppIcon source={FIXTURE_SOURCE} size="sm" testID="art" />);
    const image = view.getByTestId('art', HIDDEN);
    expect(image.props.hitSlop).toBeUndefined();
    expect(image.props.onPress).toBeUndefined();
    expect(image.props.accessibilityRole).not.toBe('button');
  });

  it('fetches nothing: the source is a resolved local module', async () => {
    /*
      `require` returns a number or an object in this environment, never a `{ uri }`. A URI would mean
      a network image — a spinner, a failure state and a privacy question this primitive has no
      business introducing.
    */
    const view = await render(<AppIcon source={FIXTURE_SOURCE} testID="art" />);
    const source = view.getByTestId('art', HIDDEN).props.source;
    expect(typeof source === 'object' && source !== null && 'uri' in source).toBe(false);
  });
});

describe('a slot whose artwork is deliberately absent', () => {
  it('renders nothing when no substitute was named', async () => {
    /*
      Nothing, not a glyph. A silent revert to a flat glyph is indistinguishable from artwork that was
      never commissioned — which is how the monochrome fallback this issue removes would come back.
    */
    const view = await render(<AppIcon source={null} testID="art" />);
    expect(view.queryByTestId('art', HIDDEN)).toBeNull();
    expect(view.toJSON()).toBeNull();
  });

  it('renders the named substitute when one was explicitly supplied', async () => {
    const view = await render(<AppIcon source={null} fallbackName="home" testID="art" />);
    const style = flat(view.getByTestId('art', HIDDEN).props.style);
    expect(style.fontSize).toBe(iconSize.md);
    expect(style.color).toBe(neutralColors.textSecondary);
  });
});

describe('the source contract', () => {
  const COMPONENT = readFileSync(join(__dirname, '..', 'app-icon.tsx'), 'utf8');
  const code = COMPONENT.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

  it('remains the only direct importer of the icon library', () => {
    /*
      The rule `eslint.config.js` enforces, asserted here as well so it survives a config edit. Two
      importers means two families, which the registry's own docblock explains at length is the thing
      it exists to prevent.
    */
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
          continue;
        }
        if (!/\.(ts|tsx)$/.test(entry.name)) continue;
        /* A suite asserting this rule must be allowed to name the module it forbids. */
        if (full.includes('__tests__')) {
          continue;
        }
        const body = readFileSync(full, 'utf8');
        if (body.includes('@expo/vector-icons') && !full.endsWith('app-icon.tsx')) {
          offenders.push(full);
        }
      }
    };
    walk(join(__dirname, '..', '..', '..'));
    expect(offenders).toEqual([]);
  });

  it('builds no asset path dynamically', () => {
    /*
      Metro resolves `require` at build time, so a template string or a variable lookup silently
      resolves to nothing in a release bundle. The type already forbids a string source; this forbids
      the component constructing one.
    */
    expect(code).not.toMatch(/require\(`/);
    expect(code).not.toMatch(/require\([a-zA-Z]/);
    expect(code).not.toMatch(/\{ uri:/);
  });

  it('never applies a tint on the raster branch', () => {
    expect(code).not.toContain('tintColor');
  });

  it('makes the four invalid prop combinations compile errors', () => {
    /*
      The enforcement is the type, and the type is the thing that can be softened by one keystroke.
      Verified with `tsc` against a throwaway probe — glyph+raster, neither, a raster tint and a
      `fallbackName` on a glyph each produced TS2322 — and pinned here so the markers that produce
      those errors cannot quietly become optional.

      Asserted on the declarations rather than by type-checking in Jest, because this project runs no
      type-level test harness and adding one for four assertions would be a larger commitment than the
      thing it guards.
    */
    expect(code).toContain('readonly source?: never');
    expect(code).toContain('readonly fallbackName?: never');
    expect(code).toContain('readonly name?: never');
    expect(code).toContain('readonly color?: never');
    /* And the union itself, without which each branch would just be an optional-prop bag. */
    expect(code).toContain('AppGlyphIconProps | AppRasterIconProps');
  });

  it('renders artwork with contain and nothing else', () => {
    expect(code).toContain('resizeMode="contain"');
    expect(code).not.toContain('"cover"');
    expect(code).not.toContain('"stretch"');
  });
});

describe('the fixture this suite renders', () => {
  it('is a NoorLife-owned commissioned pictogram, unmodified', () => {
    /*
      Named so the evidence is checkable: these tests are only meaningful against a real asset of the
      quality the batches must match. `module-pictograms.test.ts` owns the registry-level checks for
      the same eight files; nothing here moves, copies, normalises or rewrites them.
    */
    expect(readdirSync(PICTOGRAM_DIR)).toContain('finance.png');
    expect(readFileSync(FIXTURE).length).toBeGreaterThan(10_000);
  });
});
