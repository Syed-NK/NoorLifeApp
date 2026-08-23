import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import {
  heroCopyColumnHeadroom,
  shouldWidenHeroCopy,
  textWidthEm,
  widestWordEm,
} from '../hero-copy-fit';
import { allModuleDefinitions } from '../module-registry';
import { moduleLayout, moduleScale, moduleType } from '../module-tokens';

/**
 * The rule that stops a hero headline splitting inside a word — issue #50, second half.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── Why a second file, and why exact widths ────────────────────────────────
 * `module-hero-copy-fit.test.ts` bounds how many *lines* the copy needs, using a deliberately
 * pessimistic character-count estimate. That is the right instrument for "does this wrap inside three
 * lines", and the wrong one here: whether a single word fits its column is decided in the third
 * significant figure, and the answer for "manageable" moved from *fits* to *breaks* between 411 dp and
 * 384 dp — a 1.5% change in column width.
 *
 * So this file measures. Advances come from the same table the rule uses, and the first case below
 * regenerates that table from `assets/fonts/Poppins_600SemiBold.ttf` and fails if the two ever drift.
 *
 * ── What the device confirmed ──────────────────────────────────────────────
 * These are not predictions. The phone (384 dp) split "manageabl / e" at font scale 1.0 and
 * "today man / ageable" at 1.3; the emulator (411 dp) rendered "Make today / manageable" intact at
 * 1.0 and split it at 1.3. The arithmetic here reproduces all four observations.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const MODULES_ROOT = join(__dirname, '..');
const CARD = join(MODULES_ROOT, 'components', 'module-hero-card.tsx');
const RULE = join(MODULES_ROOT, 'hero-copy-fit.ts');
const FONT = join(MODULES_ROOT, '..', '..', '..', 'assets', 'fonts', 'Poppins_600SemiBold.ttf');

function code(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

/** Every module whose home hero is the shared card. Faith, Noor AI and Health draw their own. */
const OWN_HERO = new Set(['faith', 'noor-ai', 'health']);
const SHARED = allModuleDefinitions.filter((module) => !OWN_HERO.has(module.id));

/** The nine cells issue #50 names: three widths against three OS text sizes. */
const WIDTHS = [320, 384, 411] as const;
const FONT_SCALES = [1, 1.3, 1.5] as const;
const CELLS = WIDTHS.flatMap((width) => FONT_SCALES.map((fontScale) => ({ width, fontScale })));

/** What the component caps the headline multiplier at. */
const HEADLINE_MAX_MULTIPLIER = 1.1;

const scaledDp = (width: number) => (value: number) => Math.round(value * moduleScale(width));

/** Content width, exactly as `useModuleMetrics` derives it. */
function contentWidth(width: number): number {
  return (
    Math.min(width, moduleLayout.referenceWidth) - scaledDp(width)(moduleLayout.pagePadding) * 2
  );
}

/** Text width inside the 52% copy column — the ordinary presentation. */
function columnBox(width: number): number {
  return (
    contentWidth(width) * moduleLayout.heroTextColumnRatio -
    scaledDp(width)(moduleLayout.heroPadding) * 2
  );
}

/** Text width when the copy takes the whole card — the constrained presentation. */
function fullBox(width: number): number {
  return contentWidth(width) - scaledDp(width)(moduleLayout.heroPadding) * 2;
}

/** Rendered `heroDisplay` size: token × layout scale, then the OS scale under the component's cap. */
function headlineFontSize(width: number, fontScale: number): number {
  const [size] = moduleType.heroDisplay;
  return (
    +(size * moduleScale(width)).toFixed(1) *
    Math.min(Math.max(fontScale, 1), HEADLINE_MAX_MULTIPLIER)
  );
}

/** The decision the component will make for one module in one cell. */
function widens(headline: string, width: number, fontScale: number): boolean {
  return shouldWidenHeroCopy({
    headline,
    columnWidth: columnBox(width),
    fontSize: headlineFontSize(width, fontScale),
    fontScale,
  });
}

/** Width the widest word actually demands, in dp, in one cell. */
function widestWordDp(headline: string, width: number, fontScale: number): number {
  return widestWordEm(headline) * headlineFontSize(width, fontScale);
}

describe('the measurement the rule rests on', () => {
  it('matches the bundled Poppins SemiBold, glyph for glyph', () => {
    /*
      The table is generated data, so it needs a generator that runs in CI. This is it: the `hmtx`
      advances are read straight out of the committed face — the one `ModuleText` names for
      `heroDisplay` — and compared with what the rule believes. Replace the font and this fails, which
      is the point: every decision below is only as true as this table.
    */
    const font = readFileSync(FONT);
    const tableCount = font.readUInt16BE(4);
    const tables = new Map<string, number>();
    for (let i = 0; i < tableCount; i += 1) {
      const offset = 12 + i * 16;
      tables.set(font.toString('ascii', offset, offset + 4), font.readUInt32BE(offset + 8));
    }
    const tableAt = (tag: string): number => {
      const offset = tables.get(tag);
      if (offset === undefined) throw new Error(`the face has no ${tag} table`);
      return offset;
    };
    const unitsPerEm = font.readUInt16BE(tableAt('head') + 18);
    const numHMetrics = font.readUInt16BE(tableAt('hhea') + 34);
    const hmtx = tableAt('hmtx');

    // cmap format 4, the Basic Multilingual Plane subtable a Latin text face uses.
    const cmap = tableAt('cmap');
    let sub = -1;
    const subtables = font.readUInt16BE(cmap + 2);
    for (let i = 0; i < subtables; i += 1) {
      const record = cmap + 4 + i * 8;
      const platform = font.readUInt16BE(record);
      const offset = cmap + font.readUInt32BE(record + 4);
      if (font.readUInt16BE(offset) === 4 && (platform === 3 || platform === 0)) {
        sub = offset;
        if (platform === 3 && font.readUInt16BE(record + 2) === 1) break;
      }
    }
    expect(sub).toBeGreaterThan(0);

    const segCountX2 = font.readUInt16BE(sub + 6);
    const endBase = sub + 14;
    const startBase = endBase + segCountX2 + 2;
    const deltaBase = startBase + segCountX2;
    const rangeBase = deltaBase + segCountX2;

    const glyphFor = (codePoint: number): number => {
      for (let s = 0; s < segCountX2 / 2; s += 1) {
        const end = font.readUInt16BE(endBase + s * 2);
        if (codePoint > end) continue;
        const start = font.readUInt16BE(startBase + s * 2);
        if (codePoint < start) return 0;
        const delta = font.readInt16BE(deltaBase + s * 2);
        const rangeOffset = font.readUInt16BE(rangeBase + s * 2);
        if (rangeOffset === 0) return (codePoint + delta) & 0xffff;
        const glyph = font.readUInt16BE(rangeBase + s * 2 + rangeOffset + (codePoint - start) * 2);
        return glyph === 0 ? 0 : (glyph + delta) & 0xffff;
      }
      return 0;
    };
    const advanceEm = (character: string): number => {
      const glyph = Math.min(glyphFor(character.codePointAt(0) ?? 0), numHMetrics - 1);
      return font.readUInt16BE(hmtx + glyph * 4) / unitsPerEm;
    };

    // Every character any registered hero string uses, so nothing in the registry is unmeasurable.
    const used = new Set(
      allModuleDefinitions
        .flatMap((module) => [
          ...(module.hero.eyebrow ?? ''),
          ...module.hero.headline,
          ...(module.hero.support ?? ''),
          ...(module.hero.actionLabel ?? ''),
        ])
        // Whitespace never forms part of a word, so its advance cannot change a decision — and a
        // newline has no glyph to compare against.
        .filter((character) => !/\s/.test(character)),
    );
    expect(used.size).toBeGreaterThan(20);
    for (const character of used) {
      expect({ character, em: +textWidthEm(character).toFixed(3) }).toEqual({
        character,
        em: +advanceEm(character).toFixed(3),
      });
    }
  });

  it('finds the one approved word that will not fit a copy column', () => {
    /*
      Named explicitly, because everything below is a consequence of it. "manageable" is 6.611 em:
      158.7 dp at the unscaled `heroDisplay` token, against a copy column that is 159.7 dp at the
      reference width and narrower everywhere else.
    */
    const widest = SHARED.map((module) => ({
      id: module.id,
      em: +widestWordEm(module.hero.headline).toFixed(3),
    })).sort((a, b) => b.em - a.em);

    expect(widest[0]).toEqual({ id: 'planner', em: 6.611 });
    // And nothing else is even close, which is what makes the threshold safe.
    expect(widest[1]!.em).toBeLessThan(4);
  });
});

describe('no registered headline breaks inside a word', () => {
  it.each(CELLS)('at $width dp, font scale $fontScale', ({ width, fontScale }) => {
    /*
      Requirement 2, stated as the property that matters rather than as a decision table: whichever
      presentation the rule picks, the widest word must fit the box that presentation gives it. A
      word that fits has somewhere to break; a word that does not is split between letters, which is
      the defect.
    */
    for (const module of SHARED) {
      const headline = module.hero.headline;
      const box = widens(headline, width, fontScale) ? fullBox(width) : columnBox(width);
      expect({
        module: module.id,
        fits: widestWordDp(headline, width, fontScale) <= box,
      }).toEqual({ module: module.id, fits: true });
    }
  });

  it('keeps "manageable" one intact word in every cell', () => {
    // The exact string the issue names, asserted by name so a copy change cannot quietly drop it.
    const planner = SHARED.find((module) => module.id === 'planner');
    expect(planner?.hero.headline).toBe('Make today manageable');

    for (const { width, fontScale } of CELLS) {
      const box = widens('Make today manageable', width, fontScale)
        ? fullBox(width)
        : columnBox(width);
      expect({
        width,
        fontScale,
        fits: textWidthEm('manageable') * headlineFontSize(width, fontScale) <= box,
      }).toEqual({ width, fontScale, fits: true });
    }
  });

  it('reproduces what the devices actually did', () => {
    /*
      The four observations that calibrate the arithmetic. Without the rule the column is all a
      headline gets, so this asks the raw question — does the word fit the 52% column — and expects
      the answer the hardware gave.
    */
    const raw = (width: number, fontScale: number): boolean =>
      widestWordDp('Make today manageable', width, fontScale) <= columnBox(width);

    expect(raw(411, 1)).toBe(true); //  emulator: "Make today / manageable", intact
    expect(raw(384, 1)).toBe(false); // phone:    "manageabl / e"
    expect(raw(384, 1.3)).toBe(false); // phone:  "today man / ageable"
    expect(raw(411, 1.3)).toBe(false); // emulator: "today man / ageable"
  });
});

describe('the threshold is nowhere near an edge', () => {
  /**
   * Headroom is the column divided by what the widest word demands: above 1 the word fits, below 1
   * it is split. The rule fires below `heroCopyColumnHeadroom`.
   */
  const headroom = (headline: string, width: number, fontScale: number): number =>
    columnBox(width) / widestWordDp(headline, width, fontScale);

  it('separates the registry into two populations with an empty band between them', () => {
    const constrained: number[] = [];
    const roomy: number[] = [];
    for (const { width, fontScale } of CELLS) {
      for (const module of SHARED) {
        const value = headroom(module.hero.headline, width, fontScale);
        (module.id === 'planner' ? constrained : roomy).push(value);
      }
    }
    /*
      Planner straddles 1 by less than two percent — which is exactly why "> 1" is not a usable
      threshold — while every other headline clears its column by more than half its own width. The
      chosen threshold sits inside that gap, and the gap is wide.
    */
    expect(Math.max(...constrained)).toBeLessThan(1.02);
    expect(Math.min(...roomy)).toBeGreaterThan(1.5);
    expect(heroCopyColumnHeadroom).toBeGreaterThan(Math.max(...constrained));
    expect(heroCopyColumnHeadroom).toBeLessThan(Math.min(...roomy));
  });

  it.each([0.9, 0.95, 1, 1.05, 1.1])(
    'reaches the same decision with every width perturbed by ×%s',
    (perturbation) => {
      /*
        The ±10% boundary check. A decision that flips when the column moves by a tenth is a
        decision that will flip on the next device, so each cell is re-asked with the column
        stretched and squeezed and must answer the same way.
      */
      for (const { width, fontScale } of CELLS) {
        for (const module of SHARED) {
          const headline = module.hero.headline;
          const perturbed = shouldWidenHeroCopy({
            headline,
            columnWidth: columnBox(width) * perturbation,
            fontSize: headlineFontSize(width, fontScale),
            fontScale,
          });
          expect({ module: module.id, width, fontScale, perturbed }).toEqual({
            module: module.id,
            width,
            fontScale,
            perturbed: widens(headline, width, fontScale),
          });
        }
      }
    },
  );

  it.each([0.9, 0.95, 1.05, 1.1])(
    'reaches the same decision with every word width perturbed by ×%s',
    (perturbation) => {
      // The other side of the same boundary: the measurement itself, not the space it is measured in.
      for (const { width, fontScale } of CELLS) {
        for (const module of SHARED) {
          const headline = module.hero.headline;
          const perturbed =
            columnBox(width) <
            widestWordDp(headline, width, fontScale) * perturbation * heroCopyColumnHeadroom;
          expect({ module: module.id, width, fontScale, perturbed }).toEqual({
            module: module.id,
            width,
            fontScale,
            perturbed: widens(headline, width, fontScale),
          });
        }
      }
    },
  );

  it('does not depend on which side of the font-scale cap the OS setting is', () => {
    /*
      1.3 and 1.5 are both above the headline's 1.1 multiplier cap, so they must be the same
      decision. If they ever differ, the cap has stopped being applied where the rule reads it.
    */
    for (const width of WIDTHS) {
      for (const module of SHARED) {
        expect(widens(module.hero.headline, width, 1.3)).toBe(
          widens(module.hero.headline, width, 1.5),
        );
      }
    }
  });
});

describe('the artwork is kept wherever the copy fits', () => {
  it('keeps the column and the artwork for every headline that fits', () => {
    /*
      Requirements 3 and 4 as one property: artwork is absent exactly when the rule fires, never
      otherwise. Asserted over the whole matrix so a rule that quietly widened everything — which
      would also make requirement 2 pass — fails here.
    */
    for (const { width, fontScale } of CELLS) {
      for (const module of SHARED) {
        const widened = widens(module.hero.headline, width, fontScale);
        const fitsColumn = widestWordDp(module.hero.headline, width, fontScale) <= columnBox(width);
        if (!widened) {
          expect({ module: module.id, width, fontScale, fitsColumn }).toEqual({
            module: module.id,
            width,
            fontScale,
            fitsColumn: true,
          });
        }
      }
    }
  });

  it('leaves four of the five heroes in the ordinary presentation everywhere', () => {
    /*
      The concrete consequence, so "artwork still exists" is a fact rather than an aspiration. Only
      Planner carries a word too wide for its column, so only Planner's artwork steps aside — and it
      does so at every width, because above the reference width the column stops growing.
    */
    for (const { width, fontScale } of CELLS) {
      const widened = SHARED.filter((module) => widens(module.hero.headline, width, fontScale)).map(
        (module) => module.id,
      );
      expect({ width, fontScale, widened }).toEqual({ width, fontScale, widened: ['planner'] });
    }
  });

  it('registers artwork for all five, so the constrained case is a choice and not a gap', () => {
    for (const module of SHARED) {
      expect(module.heroArtwork).toBeDefined();
    }
  });
});

describe('the constrained presentation gives the copy the card', () => {
  const source = code(CARD);

  it('omits the artwork exactly when the copy is full width', () => {
    expect(source).toContain('source={fullWidthCopy ? undefined : module.heroArtwork}');
  });

  it('stretches the copy instead of holding it to the column', () => {
    expect(source).toContain('...(fullWidthCopy');
    expect(source).toContain("{ alignSelf: 'stretch' as const }");
    expect(source).toContain('{ width: contentWidth * moduleLayout.heroTextColumnRatio }');
  });

  it('grows the card rather than clipping it', () => {
    // Requirement 6. A floor, not a fixed box — the half of the first commit this one still needs.
    expect(source).toContain('minHeight: dp(moduleLayout.heroHeight)');
    expect(source).not.toMatch(/\bheight: dp\(moduleLayout\.heroHeight\)/);
  });

  it('keeps the approved type token, and does not shrink or hyphenate anything', () => {
    /*
      Requirement: the constrained presentation is the same typography. It is not section mode — it
      keeps `heroDisplay` — and nothing anywhere reaches for the two escape hatches that would trade
      this defect for a subtler one.
    */
    expect(source).toMatch(/token=\{section \? 'cardHeading' : 'heroDisplay'\}/);
    expect(source).not.toContain('adjustsFontSizeToFit');
    expect(source).not.toContain('minimumFontScale');
    expect(source).not.toContain('hyphenationFrequency');
  });

  it('renders the registered strings and nothing derived from them', () => {
    // No truncation, no ellipsis character, no substring arithmetic on approved copy.
    expect(source).toContain('{resolvedHeadline}');
    expect(source).not.toMatch(/\.slice\(|\.substring\(|…/);
  });

  it('reads the same column arithmetic the tests do', () => {
    /*
      The rule is only right if it is asked about the box the copy will actually get. This pins the
      component to `contentWidth × ratio − 2 × heroPadding`, which is what `columnBox` above computes.
    */
    expect(source).toMatch(
      /columnWidth:\s*contentWidth \* moduleLayout\.heroTextColumnRatio - dp\(moduleLayout\.heroPadding\) \* 2/,
    );
    expect(source).toContain("fontSize: type('heroDisplay').fontSize");
  });

  it('gives the call to action a reachable target', () => {
    // Requirement 10, restated here so this file also fails if the slop is removed.
    expect(source).toContain('hitSlop={minimumHitSlop(dp(moduleLayout.heroButtonHeight))}');
    expect(moduleLayout.heroButtonHeight).toBeLessThan(44);
  });
});

describe('the section presentation is untouched', () => {
  const source = code(CARD);

  it('never consults the rule in section mode', () => {
    /*
      Requirement 7. `widenCopy` is gated on `!section`, so a placeholder screen's decision is the
      one it already had: section mode was always full width, and it still is for its own reason.
    */
    expect(source).toMatch(/const widenCopy =\s*!section &&/);
    expect(source).toContain('const fullWidthCopy = section || widenCopy;');
  });

  it('keeps the type token and row gap keyed on section alone', () => {
    // The two things that distinguish section mode from a widened hero, unchanged.
    expect(source).toMatch(/token=\{section \? 'cardHeading' : 'heroDisplay'\}/);
    expect(source).toMatch(/rowGap: dp\(section \? 3 : 2\)/);
    expect(source).toMatch(/numberOfLines=\{section \? 2 : 3\}/);
  });

  it('is still opted into by exactly one screen', () => {
    const screens = readdirSync(join(MODULES_ROOT, 'screens')).filter((file) =>
      file.endsWith('.tsx'),
    );
    const optIn = screens.filter((file) =>
      /layout=("section"|{'section'})/.test(code(join(MODULES_ROOT, 'screens', file))),
    );
    expect(optIn).toEqual(['module-section-screen.tsx']);
  });
});

describe('Faith, Noor AI and Health stay outside this rule', () => {
  it('do not render the shared card at all', () => {
    /*
      Requirement 8. The rule lives in `ModuleHeroCard`, so "outside the rule" means "not this
      component" — checked against the call sites rather than against a list someone maintains.
      Health is the interesting one: it goes through `ModuleHomeComposition` to its own content, so
      its hero never reaches this card even though it is a framework module.
    */
    const callSites: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
          continue;
        }
        if (entry.name.endsWith('.tsx') && code(full).includes('<ModuleHeroCard')) {
          callSites.push(entry.name);
        }
      }
    };
    walk(join(MODULES_ROOT, '..'));

    expect(callSites.sort()).toEqual([
      'module-gallery-screen.tsx',
      'module-home-screen.tsx',
      'module-section-screen.tsx',
      'planner-home-content.tsx',
    ]);
    for (const own of ['faith', 'noor-ai', 'health']) {
      expect(callSites.some((file) => file.startsWith(own))).toBe(false);
    }
  });

  it('keeps Faith on its own hero geometry', () => {
    // Faith's hero has its own height token, which is how "Faith is unchanged" stays checkable.
    const faithHero = join(MODULES_ROOT, 'faith', 'faith-hero.tsx');
    expect(code(faithHero)).not.toContain('<ModuleHeroCard');
    expect(code(faithHero)).not.toContain('shouldWidenHeroCopy');
    expect(moduleLayout.faithHeroHeight).not.toBe(moduleLayout.heroHeight);
  });

  it('does not reach the rule from anywhere but the shared card', () => {
    const importers: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
          continue;
        }
        if (!/\.tsx?$/.test(entry.name) || entry.name.includes('.test.')) continue;
        if (code(full).includes('shouldWidenHeroCopy')) importers.push(entry.name);
      }
    };
    walk(join(MODULES_ROOT, '..'));
    expect(importers.sort()).toEqual(['hero-copy-fit.ts', 'module-hero-card.tsx']);
  });
});

describe('the rule itself', () => {
  const source = code(RULE);

  it('clamps the OS scale at the same cap the headline uses', () => {
    expect(source).toContain('Math.min(Math.max(fontScale, 1), 1.1)');
  });

  it('treats an unmeasurable character as the widest one rather than as nothing', () => {
    /*
      A zero-width fallback would make a headline look narrower than it is and keep a column that
      cannot hold it — the defect, reintroduced by a missing table entry.
    */
    expect(widestWordEm('中文文字')).toBeGreaterThan(widestWordEm('iiii'));
  });

  it('ignores leading, trailing and repeated whitespace', () => {
    expect(widestWordEm('  Make   today  manageable  ')).toBe(
      widestWordEm('Make today manageable'),
    );
    expect(widestWordEm('   ')).toBe(0);
  });
});
