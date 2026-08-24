import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { allModuleDefinitions } from '../module-registry';
import { moduleLayout, moduleScale, moduleType } from '../module-tokens';

/**
 * Does every approved hero string fit the space the hero gives it — issue #50.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── The defect this measures ───────────────────────────────────────────────
 * The module-home headline was `numberOfLines={1}`, on the recorded reasoning that "every approved
 * headline is short". Five of the eight are not: Planner rendered `Make toda…` and Finance
 * `Know wher…` on an ordinary phone at OS font scale **1.0**. The card was also a fixed `height`, so
 * allowing more lines without allowing growth would have changed nothing.
 *
 * ── What this file can and cannot prove ────────────────────────────────────
 * Jest has no text engine: there is no glyph advance to ask for, so nothing here can claim a string
 * *renders* on N lines. What it can do is arithmetic on the real tokens — the same `moduleScale`
 * rounding, the same `moduleType` ramp, the same column ratio and padding the component uses — and
 * bound the demand from above.
 *
 * So the estimate is deliberately **pessimistic**: `WIDEST_ADVANCE_RATIO` is set above the average
 * advance of the faces actually used, so a string that passes here has margin on a device rather than
 * being on the edge of it. A test that flattered the layout would be worse than none — the whole
 * defect is a layout that was assumed to fit and never measured.
 *
 * The device is still the arbiter, and the matrix below is what the device verification checks.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/**
 * Average glyph advance as a fraction of font size, chosen high on purpose.
 *
 * Poppins SemiBold at display sizes averages nearer 0.52 across mixed-case Latin; 0.60 is used so
 * that "it fits" here means "it fits with room", and a string that only just passes on a device
 * cannot pass here. Digits and capitals are wider than lower case, and the approved copy is
 * sentence case, so the real average sits comfortably below this.
 */
const WIDEST_ADVANCE_RATIO = 0.6;

/** The widths and OS font scales issue #50 requires, and one wider layout. */
const MATRIX: readonly { readonly width: number; readonly fontScale: number }[] = [
  { width: 320, fontScale: 1 },
  { width: 320, fontScale: 1.5 },
  { width: 384, fontScale: 1 },
  { width: 384, fontScale: 1.3 },
  { width: 411, fontScale: 1 },
  { width: 411, fontScale: 1.3 },
  { width: 480, fontScale: 1 },
];

/** What the component sets on the headline, so the arithmetic uses the same cap. */
const HEADLINE_MAX_MULTIPLIER = 1.1;

/** The line limits the component gives a module-home hero. */
const HOME_HEADLINE_LINES = 3;
const HOME_SUPPORT_LINES = 4;

/**
 * The text box a module-home hero gives its copy, at a given width.
 *
 * Mirrors the component exactly: `dp` rounds, the content column is capped at the reference width,
 * the copy view takes `heroTextColumnRatio` of it, and `heroPadding` is applied on both sides
 * *inside* that column.
 */
function textBoxWidth(width: number): number {
  const scale = moduleScale(width);
  const dp = (value: number): number => Math.round(value * scale);
  const columnWidth = Math.min(width, moduleLayout.referenceWidth);
  const contentWidth = columnWidth - dp(moduleLayout.pagePadding) * 2;
  const copyColumn = contentWidth * moduleLayout.heroTextColumnRatio;
  return copyColumn - dp(moduleLayout.heroPadding) * 2;
}

/** Font size as the component renders it: token × layout scale × OS scale, capped where capped. */
function renderedFontSize(
  token: 'heroDisplay' | 'heroBody',
  width: number,
  fontScale: number,
): number {
  const [size] = moduleType[token];
  const layoutScaled = +(size * moduleScale(width)).toFixed(1);
  const applied =
    token === 'heroDisplay' ? Math.min(fontScale, HEADLINE_MAX_MULTIPLIER) : fontScale;
  return layoutScaled * applied;
}

/**
 * Lines a string needs, wrapped greedily on words at the given capacity.
 *
 * Greedy word wrapping is what the platform does, and it is what makes a long word matter: a single
 * token wider than the box cannot be split, so it is reported as a line of its own and the caller
 * sees the overflow rather than a flattering average.
 */
function linesNeeded(text: string, boxWidth: number, fontSize: number): number {
  const capacity = boxWidth / (fontSize * WIDEST_ADVANCE_RATIO);
  let lines = 1;
  let used = 0;
  for (const word of text.split(/\s+/)) {
    const wordWidth = word.length;
    if (used === 0) {
      used = wordWidth;
      continue;
    }
    if (used + 1 + wordWidth <= capacity) {
      used += 1 + wordWidth;
    } else {
      lines += 1;
      used = wordWidth;
    }
  }
  return lines;
}

/** Every module whose home hero is the shared `ModuleHeroCard`, read from the registry. */
const OWN_HERO = new Set(['faith', 'noor-ai', 'health']);
const SHARED_HERO_MODULES = allModuleDefinitions.filter((module) => !OWN_HERO.has(module.id));

describe('every module-home hero is the shared card, or is named as an exception', () => {
  it('covers the registry rather than a hand-written list', () => {
    /*
      Registry-driven, so a ninth module inherits the matrix below without anybody remembering. The
      three exceptions are the modules with their own hero component, and each is named — Faith
      centres its copy, Noor AI puts copy beside the robot, and Health has no artwork.
    */
    expect(allModuleDefinitions.length).toBeGreaterThanOrEqual(8);
    expect(SHARED_HERO_MODULES.map((m) => m.id).sort()).toEqual([
      'family',
      'finance',
      'goals',
      'learning',
      'planner',
    ]);
  });

  it('names the exceptions against their real hero files', () => {
    const heroFile = (relative: string) =>
      readFileSync(join(process.cwd(), 'src/features/modules', relative), 'utf8');
    /* Each exception has its own component, and each already allows its headline to wrap. */
    expect(heroFile('faith/faith-hero.tsx')).toMatch(/numberOfLines=\{2\}/);
    expect(heroFile('noor-ai/noor-ai-hero.tsx')).toMatch(/numberOfLines=\{2\}/);
    expect(heroFile('health/health-hero.tsx')).toMatch(/numberOfLines=\{2\}/);
  });
});

describe('the copy-fit matrix', () => {
  it.each(MATRIX)('fits every headline at $width dp, font $fontScale', ({ width, fontScale }) => {
    const box = textBoxWidth(width);
    const size = renderedFontSize('heroDisplay', width, fontScale);

    for (const module of SHARED_HERO_MODULES) {
      const needed = linesNeeded(module.hero.headline, box, size);
      expect({ module: module.id, needed }).toEqual({
        module: module.id,
        needed: expect.any(Number),
      });
      /*
        The assertion that would have failed before this fix at every single cell: one line was the
        limit, and no approved headline fits one line in a 52% column at display size.
      */
      expect(needed).toBeLessThanOrEqual(HOME_HEADLINE_LINES);
    }
  });

  it.each(MATRIX)(
    'fits every support line at $width dp, font $fontScale',
    ({ width, fontScale }) => {
      const box = textBoxWidth(width);
      const size = renderedFontSize('heroBody', width, fontScale);

      for (const module of SHARED_HERO_MODULES) {
        const support = module.hero.support;
        if (support === undefined || support === '') {
          continue;
        }
        expect(linesNeeded(support, box, size)).toBeLessThanOrEqual(HOME_SUPPORT_LINES);
      }
    },
  );

  it('would not fit on one headline line anywhere — which is the defect', () => {
    /*
      Stated as its own case so the matrix above is not merely "passes with room to spare". At every
      cell, every shared-hero headline needs **more than one line**: that is why the old
      `numberOfLines={1}` ellipsised, and it is why raising the limit is the fix rather than a
      precaution.
    */
    for (const { width, fontScale } of MATRIX) {
      const box = textBoxWidth(width);
      const size = renderedFontSize('heroDisplay', width, fontScale);
      for (const module of SHARED_HERO_MODULES) {
        expect(linesNeeded(module.hero.headline, box, size)).toBeGreaterThan(1);
      }
    }
  });

  it('needs three headline lines even at a comfortable width', () => {
    /*
      ── A measurement that corrected the expectation ────────────────────────
      Three was chosen expecting two to be enough at ordinary widths, with a third needed only at the
      accessibility end. The arithmetic says otherwise: the widest headline needs three lines even at
      411 dp and OS scale 1.0, because the copy column is 52% of the card and display type is 24 dp —
      about eleven characters to a line.

      That agrees with the device evidence rather than contradicting it: the reported screenshot shows
      roughly nine characters before the ellipsis. So three is the requirement at every width, not a
      concession to large text, and a limit of two would still clip Planner and Goals.
    */
    for (const width of [320, 384, 411, 480]) {
      const box = textBoxWidth(width);
      const size = renderedFontSize('heroDisplay', width, 1);
      const worst = Math.max(
        ...SHARED_HERO_MODULES.map((m) => linesNeeded(m.hero.headline, box, size)),
      );
      expect(worst).toBe(3);
    }
  });
});

describe('the card can grow to hold what it now wraps', () => {
  const CARD = join(process.cwd(), 'src/features/modules/components/module-hero-card.tsx');
  const source = readFileSync(CARD, 'utf8');

  it('is a floor rather than a fixed height', () => {
    /*
      The half of the fix that is not about line counts. A fixed `height` cannot honour wrapping, so
      raising the limit alone would have produced the same ellipsis in a taller-looking box.
    */
    expect(source).toContain('minHeight: dp(moduleLayout.heroHeight)');
    expect(source).not.toMatch(/\bheight: dp\(moduleLayout\.heroHeight\)/);
  });

  it('keeps the artwork layer for the modules that define one', () => {
    /*
      Growth must not have been bought by dropping the locked artwork wholesale — that is section
      mode's trade. It is now also the trade a *home* makes, but only where the copy cannot fit
      beside the artwork: the source is keyed on `fullWidthCopy`, whose derivation and per-module
      outcome are pinned in `hero-copy-fit.test.ts`. Every shared hero still registers artwork, so
      the constrained case is a decision rather than a missing asset.
    */
    expect(source).toContain('source={fullWidthCopy ? undefined : module.heroArtwork}');
    for (const module of SHARED_HERO_MODULES) {
      expect(module.heroArtwork).toBeDefined();
    }
  });

  it('gives the call to action a reachable target', () => {
    /*
      `heroButtonHeight` is 34 and `dp()` scales it *down* on a narrow phone, so the pill was a 28–34 dp
      target against a 44 dp minimum. The visual geometry is approved and unchanged; the slop is what
      makes it reachable.
    */
    expect(source).toContain('hitSlop={minimumHitSlop(dp(moduleLayout.heroButtonHeight))}');
    expect(moduleLayout.heroButtonHeight).toBeLessThan(44);
  });
});

describe('Faith is untouched by this change', () => {
  it('keeps the two facts that make its headline render in full', () => {
    /*
      ── Why invariants rather than a byte hash ──────────────────────────────
      A hash needs a baseline, and the only durable one available in a test is
      `PROTECTED_BASE_SHA` — a commit old enough that Faith's hero has legitimately changed since,
      through work already merged. Comparing against it fails for reasons that have nothing to do with
      this change, which is worse than not comparing at all.

      The byte-level guarantee is asserted where it can be honest: `git diff` at the gate, which shows
      `faith-hero.tsx` absent from this branch's range. What is asserted here is what would actually
      break if a later change tried to fold Faith into the shared card — its own line limit and its own
      height. `faith-hero-layout.test.tsx` covers its geometry in full.
    */
    const faith = readFileSync(
      join(process.cwd(), 'src/features/modules/faith/faith-hero.tsx'),
      'utf8',
    );
    expect(faith).toMatch(/numberOfLines=\{2\}/);
    expect(faith).not.toMatch(/<ModuleHeroCard\b/);
    expect(moduleLayout.faithHeroHeight).not.toBe(moduleLayout.heroHeight);
  });
});

describe('every production module-home call site inherits the fix', () => {
  /** Every file under src that mentions the shared hero, so a new call site cannot hide. */
  function callSites(): { file: string; source: string }[] {
    const found: { file: string; source: string }[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== '__tests__' && entry.name !== 'node_modules') {
            walk(path);
          }
          continue;
        }
        if (!entry.name.endsWith('.tsx')) {
          continue;
        }
        const source = readFileSync(path, 'utf8');
        if (/<ModuleHeroCard\b/.test(source)) {
          found.push({ file: path, source });
        }
      }
    };
    walk(join(process.cwd(), 'src'));
    return found;
  }

  it('finds every call site by walking the tree', () => {
    const sites = callSites();
    /*
      Enumerated rather than listed, which is the point: the defect existed because one branch of one
      shared component was never measured, and a hand-written list would let the next module home slip
      past the same way.
    */
    expect(sites.length).toBeGreaterThanOrEqual(4);
    const names = sites.map((s) => s.file.replace(process.cwd(), '').replace(/\\/g, '/')).sort();
    expect(names).toEqual([
      '/src/features/modules/screens/module-gallery-screen.tsx',
      '/src/features/modules/screens/module-home-screen.tsx',
      '/src/features/modules/screens/module-section-screen.tsx',
      '/src/features/planner/screens/planner-home-content.tsx',
    ]);
  });

  it('opts into section mode in exactly one place', () => {
    /*
      So "module home" is the default and needs no opt-in. Every home call site therefore inherits the
      wrapping behaviour automatically, and the only screen that asks for the placeholder presentation
      is the placeholder screen.
    */
    const optIns = callSites().filter((s) => /layout="section"/.test(s.source));
    expect(optIns).toHaveLength(1);
    expect(optIns[0]?.file).toContain('module-section-screen');
  });

  it('gives the development gallery the production presentation', () => {
    /*
      The gallery is how a hero is reviewed without walking to it, so a bypass there would hide exactly
      this class of defect from the person looking for it. It passes no layout override at all.
    */
    const gallery = callSites().find((s) => s.file.includes('module-gallery-screen'));
    expect(gallery).toBeDefined();
    expect(gallery?.source).not.toMatch(/<ModuleHeroCard[^>]*layout=/);
  });

  it('leaves Faith’s hero out of this component entirely', () => {
    const sites = callSites();
    expect(sites.some((s) => s.file.includes('faith'))).toBe(false);
  });
});
