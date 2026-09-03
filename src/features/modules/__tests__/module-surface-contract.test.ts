import fs from 'node:fs';
import path from 'node:path';

import { modulePalettes, neutralColors, semanticColors } from '@ds/tokens';

import { contrastRatio as contrast } from '../contrast';
import { FRAMEWORK_MODULE_IDS, moduleColorThemes, moduleNeutrals } from '../module-tokens';

/**
 * **One owner for a module screen's colour family** — issue #86.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── What this contract replaces ────────────────────────────────────────────
 * Every module carried two near-identical light tints with no rule to choose between them:
 * `modulePalettes[id].soft` and the locally derived `lightSurface`. Faith used the first, through
 * six hand-declared constants outside the token system; the shared components used the second. A
 * Faith screen could therefore show two greens a few units apart, and the next module to want a
 * tint had no way to know which was correct.
 *
 * `ModuleColorTheme` is now the single public owner, and the two values keep their exact hexes
 * under the roles they were always filling: `soft` → `pageSurface`, `lightSurface` → `wellSurface`.
 * Three roles are new — `elevatedSurface`, `borderTint`, `navSelectedSurface` — and nothing renders
 * them yet. That is deliberate: this change defines ownership, and Finance applies it first.
 *
 * ── Why so much of this is about what did *not* change ─────────────────────
 * A contract that silently moved a colour would be indistinguishable from a redesign. The value
 * assertions below are the proof that adopting it is a rename: every hex that renders today is
 * asserted to be the hex that renders after.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const AA_TEXT = 4.5;
const AA_UI = 3;
const CARD = '#FFFFFF';

/** The three roles that carry no rendered pixel yet, recorded so a change to one is deliberate. */
const NEW_ROLES = {
  'noor-ai': { elevatedSurface: '#F8F7FF', borderTint: '#6556C8', navSelectedSurface: '#F5F2FF' },
  faith: { elevatedSurface: '#F6FCF9', borderTint: '#23856D', navSelectedSurface: '#F0F9F5' },
  health: { elevatedSurface: '#F6FCFF', borderTint: '#4492C7', navSelectedSurface: '#F0F9FD' },
  planner: { elevatedSurface: '#F8F8FF', borderTint: '#5A72C9', navSelectedSurface: '#F3F5FC' },
  finance: { elevatedSurface: '#FFFAF4', borderTint: '#C8792C', navSelectedSurface: '#FFF7EE' },
  learning: { elevatedSurface: '#F9F7FF', borderTint: '#7657D6', navSelectedSurface: '#F5F2FF' },
  family: { elevatedSurface: '#FFF8FA', borderTint: '#D95B82', navSelectedSurface: '#FEF2F6' },
  goals: { elevatedSurface: '#F6FCFB', borderTint: '#269B94', navSelectedSurface: '#EFF9F8' },
} as const;

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

/** The contract's own file, which is allowed every access the guards forbid elsewhere. */
const OWNER = path.join('features', 'modules', 'module-tokens.ts');

const rel = (file: string): string => path.relative(process.cwd(), file).split(path.sep).join('/');

// ─────────────────────────────────────────────────────────────────────────────
// Ownership and exact values
// ─────────────────────────────────────────────────────────────────────────────

describe.each(FRAMEWORK_MODULE_IDS)('%s surface roles', (moduleId) => {
  const theme = moduleColorThemes[moduleId];

  it('declares all six roles', () => {
    for (const role of [
      'pageSurface',
      'cardSurface',
      'elevatedSurface',
      'wellSurface',
      'borderTint',
      'navSelectedSurface',
    ] as const) {
      expect(theme[role]).toMatch(/^#[0-9A-F]{6}$/i);
    }
  });

  it('takes its page surface from the locked palette, unchanged', () => {
    /*
      The rename, asserted as an identity. Anything that read `modulePalettes[id].soft` before and
      `pageSurface` after renders the same colour — which is what makes adopting this safe.
    */
    expect(theme.pageSurface).toBe(modulePalettes[moduleId].soft);
  });

  it('keeps the well at exactly the value the shared components already rendered', () => {
    expect(theme.wellSurface).toBe(theme.lightSurface);
  });

  it('keeps the card white', () => {
    expect(theme.cardSurface).toBe(CARD);
  });

  it('carries the recorded values for the three roles nothing renders yet', () => {
    expect({
      elevatedSurface: theme.elevatedSurface,
      borderTint: theme.borderTint,
      navSelectedSurface: theme.navSelectedSurface,
    }).toEqual(NEW_ROLES[moduleId]);
  });

  it('orders the ladder from the card down to the page', () => {
    // Lightest to deepest: card, elevated, well, page. A well must read as inset against its page.
    const light = (hex: string): number => contrast(hex, '#000000');
    expect(light(theme.cardSurface)).toBeGreaterThan(light(theme.elevatedSurface));
    expect(light(theme.elevatedSurface)).toBeGreaterThan(light(theme.wellSurface));
    expect(light(theme.wellSurface)).toBeGreaterThan(light(theme.pageSurface));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Contrast
// ─────────────────────────────────────────────────────────────────────────────

describe.each(FRAMEWORK_MODULE_IDS)('%s contrast', (moduleId) => {
  const theme = moduleColorThemes[moduleId];
  const surfaces = [
    theme.pageSurface,
    theme.cardSurface,
    theme.elevatedSurface,
    theme.wellSurface,
    theme.navSelectedSurface,
  ] as const;

  it('keeps both neutral text roles at AA on every surface', () => {
    // Body copy is the neutral roles, and they must be readable everywhere a module can put them.
    for (const surface of surfaces) {
      expect(contrast(moduleNeutrals.textPrimary, surface)).toBeGreaterThanOrEqual(AA_TEXT);
      expect(contrast(moduleNeutrals.textSecondary, surface)).toBeGreaterThanOrEqual(AA_TEXT);
    }
  });

  it('keeps module ink at AA on every surface it labels', () => {
    /*
      Card, elevated, well and the selected nav slot — the surfaces `ink` writes on.
    */
    for (const surface of [
      theme.cardSurface,
      theme.elevatedSurface,
      theme.wellSurface,
      theme.navSelectedSurface,
    ]) {
      expect(contrast(theme.ink, surface)).toBeGreaterThanOrEqual(AA_TEXT);
    }
  });

  it('treats ink as an accent on the page ground, not as body text', () => {
    /*
      Measured, and the reason this is a separate rule. `pageSurface` is the deepest tint in the
      ladder, and six of the eight modules' `ink` lands between 4.37 and 4.46 on it — just under AA
      for normal text. Faith 4.45, Health 4.42, Finance 4.45, Learning 4.46, Family 4.37, Goals 4.42;
      only Noor AI (4.91) and Planner (4.53) clear it.

      Raising `ink` would change a colour that renders today, which this contract does not do. So
      the rule is stated instead of the bar being quietly lowered: on a module page ground, `ink` is
      an icon and accent colour and must clear the 3:1 non-text bar; body copy there is
      `textPrimary` or `textSecondary`, both of which clear AA comfortably above.
    */
    expect(contrast(theme.ink, theme.pageSurface)).toBeGreaterThanOrEqual(AA_UI);
    expect(contrast(moduleNeutrals.textPrimary, theme.pageSurface)).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it('separates a card from its page with the border, not the fill', () => {
    /*
      Two near-whites cannot reach 3:1 against each other, and they should not try — a card is
      identified by its edge. So the requirement lands on `borderTint`, which must clear the
      non-text threshold against *both* grounds it can sit between.
    */
    expect(contrast(theme.borderTint, theme.pageSurface)).toBeGreaterThanOrEqual(AA_UI);
    expect(contrast(theme.borderTint, theme.cardSurface)).toBeGreaterThanOrEqual(AA_UI);
  });

  it('keeps a status banner identifiable on the page even when its fill is not', () => {
    /*
      Finance is the case that forced this rule: its page surface `#FFF3E6` and `warningSurface`
      `#FFF6E6` sit at 1.02:1 — visually the same colour. A banner therefore cannot rely on its
      fill on a module page, so the rule is that its *ink* must clear the non-text bar and carry the
      edge. Asserted for every module and every status, so no page can be adopted that hides one.
    */
    for (const ink of [
      moduleNeutrals.success,
      moduleNeutrals.warning,
      moduleNeutrals.error,
      moduleNeutrals.info,
    ]) {
      expect(contrast(ink, theme.pageSurface)).toBeGreaterThanOrEqual(AA_UI);
    }
  });
});

describe('the Finance page and the warning surface', () => {
  it('are indistinguishable by fill, which is why the ink rule exists', () => {
    // Recorded rather than asserted away: this is the measurement the rule above is built on.
    const ratio = contrast(moduleColorThemes.finance.pageSurface, moduleNeutrals.warningSurface);
    expect(ratio).toBeLessThan(1.1);
    // And the ink that must therefore do the identifying.
    expect(contrast(moduleNeutrals.warning, moduleColorThemes.finance.pageSurface)).toBeGreaterThan(
      AA_UI,
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// What the contract must not touch
// ─────────────────────────────────────────────────────────────────────────────

describe('semantic and neutral colours are excluded', () => {
  it('leaves every status, disabled, skeleton and scrim value unchanged', () => {
    expect({
      success: moduleNeutrals.success,
      warning: moduleNeutrals.warning,
      error: moduleNeutrals.error,
      info: moduleNeutrals.info,
      successSurface: moduleNeutrals.successSurface,
      warningSurface: moduleNeutrals.warningSurface,
      errorSurface: moduleNeutrals.errorSurface,
      infoSurface: moduleNeutrals.infoSurface,
      skeleton: moduleNeutrals.skeleton,
      skeletonHighlight: moduleNeutrals.skeletonHighlight,
      disabled: neutralColors.disabled,
      scrim: neutralColors.scrim,
    }).toEqual({
      success: '#1B8A5A',
      warning: '#B26A00',
      error: '#C4314B',
      info: '#2563EB',
      successSurface: '#EAF7F0',
      warningSurface: '#FFF6E6',
      errorSurface: '#FDEDEF',
      infoSurface: '#EDF3FF',
      skeleton: '#E8ECF3',
      skeletonHighlight: '#F2F5F9',
      disabled: '#C8CED8',
      scrim: 'rgba(17,24,39,0.45)',
    });
  });

  it('takes no status colour from any module palette', () => {
    const moduleHexes = new Set(
      FRAMEWORK_MODULE_IDS.flatMap((id) => Object.values(moduleColorThemes[id])),
    );
    for (const status of Object.values(semanticColors)) {
      expect(moduleHexes.has(status)).toBe(false);
    }
  });

  it('keeps the inactive navigation label neutral and readable on the neutral bar', () => {
    /*
      The bar stays `navBackground`; only the *selected slot* may take a module tint. So the
      inactive label's contrast is measured where it actually sits, and it must stay a neutral —
      a tinted inactive label would make the selected state read as hue rather than as selection.
    */
    expect(moduleNeutrals.navBackground).toBe('#FFFFFF');
    /*
      A bar, not a shortfall, since issue #88. This case used to pin `#6B7896` at 4.42:1 and assert
      it stayed *under* AA — "this is where we are" — because #86 changed no rendered colour. #88
      raised the value, so the shape inverts: the pin on the old hex is gone and the floor is the
      real one. Restoring `#6B7896` fails here.
    */
    const inactive = contrast(moduleNeutrals.navInactive, moduleNeutrals.navBackground);
    expect(inactive).toBeGreaterThanOrEqual(AA_TEXT);
    /*
      And it came out of the palette rather than being hand-tuned to just clear the bar: inactive
      navigation *is* secondary text on a light ground.
    */
    expect(moduleNeutrals.navInactive).toBe(moduleNeutrals.textSecondary);

    const moduleHexes = new Set(
      FRAMEWORK_MODULE_IDS.flatMap((id) => Object.values(moduleColorThemes[id])),
    );
    expect(moduleHexes.has(moduleNeutrals.navInactive)).toBe(false);
  });

  it('keeps the reader and Tasbih grounds out of the contract', () => {
    const tokens = fs.readFileSync(
      path.join(process.cwd(), 'src/features/modules/module-tokens.ts'),
      'utf8',
    );
    expect(tokens).toContain("readerPageBackground = '#FDFAF5'");
    expect(tokens).toContain("tasbihStageSurface = '#F6ECE4'");
  });
});

describe('Main Home is exempt', () => {
  it('keeps the neutral canvas', () => {
    /*
      Main Home combines eight module identities at once, so tinting it would mean choosing one.
      The exemption is asserted at the screen, not merely written down.
    */
    const screen = fs.readFileSync(
      path.join(process.cwd(), 'src/features/home/screens/main-home-screen.tsx'),
      'utf8',
    );
    expect(screen).toContain('neutralColors.canvas');
    expect(screen).not.toMatch(/pageSurface|moduleColorThemes/);
    expect(neutralColors.canvas).toBe('#F7F8FA');
  });

  it('is not a framework module, so no role resolves for it', () => {
    expect(FRAMEWORK_MODULE_IDS).not.toContain('main');
    expect(Object.keys(moduleColorThemes)).not.toContain('main');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Source guards
// ─────────────────────────────────────────────────────────────────────────────

describe('no consumer can reach past the contract', () => {
  it('declares no module palette constant of its own in a shared module component', () => {
    /*
      The Faith pattern, forbidden where the contract applies. Six Faith files hand-declared the
      palette's soft value; the shared framework must never do the same, because a constant there is
      a colour the contract cannot govern. `module-tokens.ts` is exempt — reading the palette is
      what being its owner means.
    */
    const offenders = productionSourceFiles('src/features/modules')
      .filter((file) => !file.endsWith(OWNER))
      .filter((file) =>
        /modulePalettes\.[A-Za-z'-]+\.(soft|primary|dark|supporting)/.test(
          fs.readFileSync(file, 'utf8'),
        ),
      )
      .map(rel);

    expect(offenders).toEqual([]);
  });

  it('reads no module surface through the deprecated `soft` field', () => {
    const offenders = [
      ...productionSourceFiles('src/features'),
      ...productionSourceFiles('src/app'),
    ]
      .filter((file) => !file.endsWith(OWNER))
      .filter((file) =>
        /modulePalettes(\[[^\]]+\]|\.[A-Za-z'-]+)\.soft/.test(fs.readFileSync(file, 'utf8')),
      )
      .map(rel);

    expect(offenders).toEqual([]);
  });

  it('uses the role name, not the deprecated alias, in every shared module component', () => {
    const offenders = productionSourceFiles('src/features/modules/components')
      .filter((file) => fs.readFileSync(file, 'utf8').includes('lightSurface'))
      .map(rel);

    expect(offenders).toEqual([]);
  });

  it('derives no colour from artwork and tints no raster', () => {
    /*
      Rule eight and nine of the brief, asserted rather than promised. Nothing in the contract may
      sample a pixel, and `moduleRasterIcon` — the only path to commissioned artwork — must carry no
      tint, so a module's colour can never be applied to a PNG.
      */
    const tokens = fs.readFileSync(
      path.join(process.cwd(), 'src/features/modules/module-tokens.ts'),
      'utf8',
    );
    expect(tokens).not.toMatch(
      /getPixel|ImageColors|sampleColou?r|dominantColou?r|require\(.*\.png/,
    );

    const raster = fs.readFileSync(
      path.join(process.cwd(), 'src/features/modules/module-raster-icons.ts'),
      'utf8',
    );
    expect(raster).not.toMatch(/tintColor|pageSurface|wellSurface|borderTint/);
  });
});
