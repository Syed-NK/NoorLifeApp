import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import {
  actionOverflowsColumn,
  headlineOverflowsColumn,
  heroActionColumnHeadroom,
  heroCopyColumnHeadroom,
  shouldWidenHeroCopy,
  textWidthEm,
  widestWordEm,
  type HeroCopyFitInput,
  type HeroFace,
} from '../hero-copy-fit';
import { allModuleDefinitions } from '../module-registry';
import { moduleLayout, moduleScale, moduleType } from '../module-tokens';

/**
 * The rule that keeps a hero's approved copy readable in the space it has — issue #50.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── Two conditions, one outcome ────────────────────────────────────────────
 * A headline whose widest word exceeds its line is split between letters. A pill whose single-line
 * label plus its own chrome exceeds the column is ellipsised. Same defect at opposite ends of the
 * card, and one answer: give the copy the whole card and drop the decorative artwork.
 *
 * ── Why this file measures instead of estimating ────────────────────────────
 * Both answers are decided in the third significant figure, and both were first got wrong by
 * estimating. `module-hero-copy-fit.test.ts` keeps the deliberately pessimistic character-count
 * bound, which is the right instrument for "does this wrap inside three lines". It is the wrong one
 * for "does this single word, or this one-line label, fit" — so everything here comes from the three
 * Poppins faces the hero actually sets type in, read out of the committed TTFs and drift-checked
 * against them below.
 *
 * ── What the devices confirmed ─────────────────────────────────────────────
 * Not predictions. The phone split "manageabl / e" at 384 dp and font 1.0 and "today man / ageable"
 * at 1.3; the emulator held it intact at 411 dp and 1.0 and split it at 1.3. Finance, Learning and
 * Goals showed "Add your first g…" and its siblings from font 1.3 upward at every tested width. The
 * arithmetic here reproduces every one of those observations.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const MODULES_ROOT = join(__dirname, '..');
const CARD = join(MODULES_ROOT, 'components', 'module-hero-card.tsx');
const TEXT = join(MODULES_ROOT, 'components', 'module-text.tsx');
const RULE = join(MODULES_ROOT, 'hero-copy-fit.ts');
const FONT_DIR = join(MODULES_ROOT, '..', '..', '..', 'assets', 'fonts');

/** The face file behind each token this hero uses. */
const FACE_FILE: Readonly<Record<HeroFace, string>> = {
  semiBold: 'Poppins_600SemiBold.ttf',
  medium: 'Poppins_500Medium.ttf',
  regular: 'Poppins_400Regular.ttf',
};

function code(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

/** The pill's chrome, as the component declares it. Read from source so the two cannot drift. */
function chromeConstant(name: string): number {
  const found = new RegExp(`const ${name} = (\\d+(?:\\.\\d+)?);`).exec(readFileSync(CARD, 'utf8'));
  if (found === null) throw new Error(`the card no longer declares ${name}`);
  return Number(found[1]);
}
const ACTION_PADDING_H = chromeConstant('HERO_ACTION_PADDING_H');
const ACTION_GAP = chromeConstant('HERO_ACTION_GAP');
const ACTION_CHEVRON = chromeConstant('HERO_ACTION_CHEVRON');

/** Every module whose home hero is the shared card. Faith, Noor AI and Health draw their own. */
const OWN_HERO = new Set(['faith', 'noor-ai', 'health']);
const SHARED = allModuleDefinitions.filter((module) => !OWN_HERO.has(module.id));

/** The nine cells issue #50 names: three widths against three OS text sizes. */
const WIDTHS = [320, 384, 411] as const;
const FONT_SCALES = [1, 1.3, 1.5] as const;
const CELLS = WIDTHS.flatMap((width) => FONT_SCALES.map((fontScale) => ({ width, fontScale })));

/** What the component caps the *headline* multiplier at. The action label caps nothing. */
const HEADLINE_MAX_MULTIPLIER = 1.1;

/** The line limits the component gives a module-home hero. */
const HEADLINE_LINES = 3;
const SUPPORT_LINES = 4;

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
    contentWidth(width) * moduleLayout.heroCopyColumnRatio -
    scaledDp(width)(moduleLayout.heroPadding) * 2
  );
}

/** Text width when the copy takes the whole card — the constrained presentation. */
function fullBox(width: number): number {
  return contentWidth(width) - scaledDp(width)(moduleLayout.heroPadding) * 2;
}

/**
 * A token's size at the layout scale only — which is exactly what the component passes the rule.
 *
 * `useModuleMetrics.type()` does not multiply by the OS text size, because React Native applies that
 * itself when it turns a `fontSize` into pixels. So the rule takes the OS scale as its own argument
 * and applies it once. A test that pre-multiplied here would apply it twice, and at OS scale 1.3 that
 * is a 10-21% overstatement — enough to move a marginal decision and report a defect that is not
 * there.
 */
function layoutSize(
  token: 'heroDisplay' | 'cardAction' | 'eyebrow' | 'heroBody',
  width: number,
): number {
  return +(moduleType[token][0] * moduleScale(width)).toFixed(1);
}

/** A token's size as it finally renders: layout scale, then the OS scale under whatever cap applies. */
function renderedSize(
  token: 'heroDisplay' | 'cardAction' | 'eyebrow' | 'heroBody',
  width: number,
  fontScale: number,
): number {
  const applied =
    token === 'heroDisplay'
      ? Math.min(Math.max(fontScale, 1), HEADLINE_MAX_MULTIPLIER)
      : Math.max(fontScale, 1);
  return layoutSize(token, width) * applied;
}

/** The pill's chrome at one width: both paddings, the gap and the chevron. */
function actionChrome(width: number): number {
  const dp = scaledDp(width);
  return dp(ACTION_PADDING_H) * 2 + dp(ACTION_GAP) + dp(ACTION_CHEVRON);
}

/** Width the pill needs: its label at the action token, plus that chrome. */
function actionNeed(label: string, width: number, fontScale: number): number {
  return (
    textWidthEm(label, 'medium') * renderedSize('cardAction', width, fontScale) +
    actionChrome(width)
  );
}

/** Width the headline's widest word needs. */
function headlineNeed(headline: string, width: number, fontScale: number): number {
  return widestWordEm(headline) * renderedSize('heroDisplay', width, fontScale);
}

type SharedModule = (typeof SHARED)[number];

/** Everything the predicate needs for one module in one cell. */
function inputFor(
  module: SharedModule,
  width: number,
  fontScale: number,
  overrides: Partial<HeroCopyFitInput> = {},
): HeroCopyFitInput {
  return {
    headline: module.hero.headline,
    actionLabel: module.hero.actionLabel,
    columnWidth: columnBox(width),
    // Layout-scaled, as the component passes them: the rule applies the OS scale itself.
    headlineFontSize: layoutSize('heroDisplay', width),
    actionFontSize: layoutSize('cardAction', width),
    actionChromeWidth: actionChrome(width),
    fontScale,
    ...overrides,
  };
}

function moduleNamed(id: string): SharedModule {
  const found = SHARED.find((module) => module.id === id);
  if (found === undefined) throw new Error(`${id} is no longer a shared-hero module`);
  return found;
}

/** Lines a string needs, wrapped greedily on words at exact advances. */
function linesNeeded(text: string, face: HeroFace, boxWidth: number, fontSize: number): number {
  const space = textWidthEm(' ', face) * fontSize;
  let lines = 1;
  let used = 0;
  for (const word of text.split(/\s+/).filter((entry) => entry !== '')) {
    const wordWidth = textWidthEm(word, face) * fontSize;
    if (used === 0) {
      used = wordWidth;
      continue;
    }
    if (used + space + wordWidth <= boxWidth) {
      used += space + wordWidth;
    } else {
      lines += 1;
      used = wordWidth;
    }
  }
  return lines;
}

/** Widest single word in a string, at a given face and size. */
function widestWord(text: string, face: HeroFace, fontSize: number): number {
  return Math.max(
    ...text
      .split(/\s+/)
      .filter((entry) => entry !== '')
      .map((word) => textWidthEm(word, face) * fontSize),
  );
}

describe('the measurement both conditions rest on', () => {
  it.each(Object.keys(FACE_FILE) as HeroFace[])(
    'matches the bundled %s face, glyph for glyph',
    (face) => {
      /*
        The tables are generated data, so they need a generator that runs in CI. This is it: the
        `hmtx` advances are read straight out of the committed faces and compared with what the rule
        believes. Replace a font and this fails, which is the point — every decision below is only as
        true as these tables.
      */
      const font = readFileSync(join(FONT_DIR, FACE_FILE[face]));
      const tableCount = font.readUInt16BE(4);
      const tables = new Map<string, number>();
      for (let i = 0; i < tableCount; i += 1) {
        const offset = 12 + i * 16;
        tables.set(font.toString('ascii', offset, offset + 4), font.readUInt32BE(offset + 8));
      }
      const tableAt = (tag: string): number => {
        const offset = tables.get(tag);
        if (offset === undefined) throw new Error(`${FACE_FILE[face]} has no ${tag} table`);
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
          const glyph = font.readUInt16BE(
            rangeBase + s * 2 + rangeOffset + (codePoint - start) * 2,
          );
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
          // Whitespace never forms part of a word, and a newline has no glyph to compare against.
          .filter((character) => !/\s/.test(character)),
      );
      expect(used.size).toBeGreaterThan(20);
      for (const character of used) {
        expect({ face, character, em: +textWidthEm(character, face).toFixed(3) }).toEqual({
          face,
          character,
          em: +advanceEm(character).toFixed(3),
        });
      }
    },
  );

  it('measures each string in the face and token that renders it', () => {
    /*
      The rule is only right if it measures the right type. A headline in Medium or an action label
      in SemiBold would be a plausible-looking number and a wrong decision, so the face map and the
      four token sizes are pinned to what `ModuleText` and `moduleType` actually say.
    */
    const faces = code(TEXT);
    expect(faces).toMatch(/heroDisplay: 'semiBold'/);
    expect(faces).toMatch(/cardAction: 'medium'/);
    expect(faces).toMatch(/eyebrow: 'medium'/);
    expect(faces).toMatch(/heroBody: 'regular'/);

    expect(moduleType.heroDisplay[0]).toBe(24);
    expect(moduleType.cardAction[0]).toBe(10.5);
    expect(moduleType.eyebrow[0]).toBe(11);
    expect(moduleType.heroBody[0]).toBe(12.5);
  });

  it('takes the pill’s padding from the same constants the pill is styled with', () => {
    /*
      The reason "Add your first goal" ellipsised is the label *plus* the pill's own width. Omitting
      that chrome understates the need by 33-40 dp — a quarter of the column — so the style and the
      rule must read one source. They do, by name.
    */
    const card = code(CARD);
    expect(card).toContain('paddingHorizontal: dp(HERO_ACTION_PADDING_H)');
    expect(card).toContain('columnGap: dp(HERO_ACTION_GAP)');
    expect(card).toContain('size={dp(HERO_ACTION_CHEVRON)}');
    expect(card).toContain(
      'return dp(HERO_ACTION_PADDING_H) * 2 + dp(HERO_ACTION_GAP) + dp(HERO_ACTION_CHEVRON);',
    );
    expect(card).toContain('actionChromeWidth: heroActionChromeWidth(dp)');
    expect([ACTION_PADDING_H, ACTION_GAP, ACTION_CHEVRON]).toEqual([11, 5, 13]);
  });

  it('measures the action label in Medium, not in the headline’s face', () => {
    /*
      A source assertion alone would not catch this: swapping the face changes a number, not a name.
      So the boundary is constructed instead. SemiBold is wider than Medium at the same size, so a
      column sized to fit the Medium measurement but not the SemiBold one has exactly one right
      answer, and the rule has to give it.
    */
    const label = 'Add your first goal';
    const fontSize = 10.5;
    const chromeWidth = 40;
    const medium = textWidthEm(label, 'medium') * fontSize + chromeWidth;
    const semiBold = textWidthEm(label, 'semiBold') * fontSize + chromeWidth;
    expect(semiBold).toBeGreaterThan(medium);

    // Room for the Medium pill with its headroom, but not for the SemiBold one.
    const columnWidth =
      (medium * heroActionColumnHeadroom + semiBold * heroActionColumnHeadroom) / 2;
    expect(
      actionOverflowsColumn({
        actionLabel: label,
        columnWidth,
        actionFontSize: fontSize,
        actionChromeWidth: chromeWidth,
        fontScale: 1,
      }),
    ).toBe(false);
  });

  it('measures the action label at the action token, not the body or display one', () => {
    /*
      Same construction for the token. `cardAction` is 10.5 and `heroBody` is 12.5, so a column sized
      between what those two need separates them — and a rule reading the wrong token answers wrongly.
    */
    const label = 'Add your first goal';
    const chromeWidth = 40;
    const need = (fontSize: number) => textWidthEm(label, 'medium') * fontSize + chromeWidth;
    const atAction = need(moduleType.cardAction[0]);
    const atBody = need(moduleType.heroBody[0]);
    expect(atBody).toBeGreaterThan(atAction);

    const columnWidth =
      (atAction * heroActionColumnHeadroom + atBody * heroActionColumnHeadroom) / 2;
    expect(
      actionOverflowsColumn({
        actionLabel: label,
        columnWidth,
        actionFontSize: moduleType.cardAction[0],
        actionChromeWidth: chromeWidth,
        fontScale: 1,
      }),
    ).toBe(false);
  });

  it('finds the one headline word and the three labels that will not fit a column', () => {
    const widestHeadlines = SHARED.map((module) => ({
      id: module.id,
      em: +widestWordEm(module.hero.headline).toFixed(3),
    })).sort((a, b) => b.em - a.em);
    expect(widestHeadlines[0]).toEqual({ id: 'planner', em: 6.611 });
    expect(widestHeadlines[1]!.em).toBeLessThan(4);

    // The pills, at the reference width and OS scale 1.5 — the cell the devices showed clipped.
    const overflowing = SHARED.filter(
      (module) => columnBox(411) < actionNeed(module.hero.actionLabel, 411, 1.5),
    ).map((module) => module.id);
    expect(overflowing.sort()).toEqual(['finance', 'goals', 'learning']);
  });
});

describe('the combined predicate', () => {
  it('activates on headline overflow alone', () => {
    /*
      Planner at OS scale 1.3: the widest word no longer clears the column, while its short pill
      clears it by more than half. Exactly one condition fires, and the outcome is full width.

      This case used to be Planner at scale 1.0. It moved because that cell is now the requirement in
      the other direction — Planner keeps its artwork on an ordinary phone at the default text size,
      asserted below — so 1.3 is the nearest cell where the headline alone still constrains it.
    */
    const input = inputFor(moduleNamed('planner'), 384, 1.3);
    expect(headlineOverflowsColumn(input)).toBe(true);
    expect(actionOverflowsColumn(input)).toBe(false);
    expect(shouldWidenHeroCopy(input)).toBe(true);
  });

  it('activates on action overflow alone', () => {
    /*
      Goals at OS scale 1.5: the headline clears the column by half, the pill does not. The other
      condition, on its own, and the same outcome — this is the case the previous commit missed.
    */
    const input = inputFor(moduleNamed('goals'), 384, 1.5);
    expect(headlineOverflowsColumn(input)).toBe(false);
    expect(actionOverflowsColumn(input)).toBe(true);
    expect(shouldWidenHeroCopy(input)).toBe(true);
  });

  it('does not activate when both fit', () => {
    // Goals at 1.0, and Family at every cell: both conditions clear, so the ordinary layout stands.
    const atDefault = inputFor(moduleNamed('goals'), 384, 1);
    expect(headlineOverflowsColumn(atDefault)).toBe(false);
    expect(actionOverflowsColumn(atDefault)).toBe(false);
    expect(shouldWidenHeroCopy(atDefault)).toBe(false);

    for (const { width, fontScale } of CELLS) {
      expect(shouldWidenHeroCopy(inputFor(moduleNamed('family'), width, fontScale))).toBe(false);
    }
  });

  it('treats either failure as sufficient, and both together the same way', () => {
    /*
      The truth table, built by forcing each condition independently rather than by hunting for a
      registry cell that happens to produce it. A column wide enough for neither must widen; a column
      wide enough for both must not.
    */
    const base = inputFor(moduleNamed('goals'), 384, 1);
    const roomy = { ...base, columnWidth: 1_000 };
    const cramped = { ...base, columnWidth: 1 };
    const headlineOnly = { ...roomy, headlineFontSize: 2_000 };
    const actionOnly = { ...roomy, actionFontSize: 2_000 };

    const verdicts = (input: HeroCopyFitInput) => [
      headlineOverflowsColumn(input),
      actionOverflowsColumn(input),
      shouldWidenHeroCopy(input),
    ];
    expect(verdicts(roomy)).toEqual([false, false, false]);
    expect(verdicts(headlineOnly)).toEqual([true, false, true]);
    expect(verdicts(actionOnly)).toEqual([false, true, true]);
    expect(verdicts(cramped)).toEqual([true, true, true]);
  });

  it('ignores the action condition when there is no action', () => {
    // A suppressed or empty label is not a zero-width pill; it is no pill at all.
    const goals = moduleNamed('goals');
    const noAction = inputFor(goals, 320, 1.5, { actionLabel: '' });
    expect(actionOverflowsColumn(noAction)).toBe(false);
    expect(shouldWidenHeroCopy(noAction)).toBe(false);
    // With the label restored the same cell widens, so the guard above is load-bearing.
    expect(shouldWidenHeroCopy(inputFor(goals, 320, 1.5))).toBe(true);
  });

  it('reproduces what the devices actually did, at the column each was measured with', () => {
    /*
      The device observations are the calibration for all of this, so they are asserted against the
      column that was in force when each was taken. The first six were measured at the original 52%
      column; the last two at the refined one, which is why the same question gets the opposite answer
      at 384 dp and scale 1.0 — that reversal *is* this refinement.
    */
    const columnAt = (ratio: number, width: number): number =>
      contentWidth(width) * ratio - scaledDp(width)(moduleLayout.heroPadding) * 2;
    const ORIGINAL_RATIO = 0.52;

    const headlineFitsOriginal = (width: number, fontScale: number): boolean =>
      headlineNeed(moduleNamed('planner').hero.headline, width, fontScale) <=
      columnAt(ORIGINAL_RATIO, width);
    const pillFitsOriginal = (width: number, fontScale: number): boolean =>
      actionNeed(moduleNamed('goals').hero.actionLabel, width, fontScale) <=
      columnAt(ORIGINAL_RATIO, width);

    expect(headlineFitsOriginal(411, 1)).toBe(true); //   emulator: "Make today / manageable", intact
    expect(headlineFitsOriginal(384, 1)).toBe(false); //  phone:    "manageabl / e"
    expect(headlineFitsOriginal(384, 1.3)).toBe(false); // phone:   "today man / ageable"
    expect(pillFitsOriginal(320, 1)).toBe(true); //       emulator: full label
    expect(pillFitsOriginal(320, 1.5)).toBe(false); //    emulator: "Add your first g…"
    expect(pillFitsOriginal(384, 1.3)).toBe(false); //    phone:   pill 160 dp, 155 dp column

    // The refined column, which is what the two protected cells are measured against now.
    const headlineFitsNow = (width: number, fontScale: number): boolean =>
      headlineNeed(moduleNamed('planner').hero.headline, width, fontScale) <= columnBox(width);
    expect(headlineFitsNow(384, 1)).toBe(true); //  phone:    intact, beside its artwork
    expect(headlineFitsNow(411, 1)).toBe(true); //  emulator: intact, beside its artwork
  });

  it('names every cell that enters full width, and why', () => {
    /*
      The whole decision surface in one assertion, so a change to either threshold, any font or any
      approved string has to be seen and re-approved rather than merely re-passing. At OS scale 1.0
      every hero keeps its column and its artwork; from 1.3 the copy no longer fits, and four of the
      five widen — Planner because "manageable" exceeds the column once the type grows, and Finance,
      Learning and Goals because their pills do. Family's copy fits everywhere, so Family never widens.

      The 1.0 row is the outcome this refinement exists for: at the previous 52% column and 25%
      reserve, Planner widened here too and lost its locked artwork on an ordinary phone at the
      default text size.
    */
    const surface = CELLS.map(({ width, fontScale }) => ({
      cell: `${width}dp x${fontScale}`,
      widened: SHARED.filter((module) => shouldWidenHeroCopy(inputFor(module, width, fontScale)))
        .map((module) => module.id)
        .sort(),
    }));

    const NONE: string[] = [];
    const HEADLINE_AND_ACTION = ['finance', 'goals', 'learning', 'planner'];
    expect(surface).toEqual([
      { cell: '320dp x1', widened: NONE },
      { cell: '320dp x1.3', widened: HEADLINE_AND_ACTION },
      { cell: '320dp x1.5', widened: HEADLINE_AND_ACTION },
      { cell: '384dp x1', widened: NONE },
      { cell: '384dp x1.3', widened: HEADLINE_AND_ACTION },
      { cell: '384dp x1.5', widened: HEADLINE_AND_ACTION },
      { cell: '411dp x1', widened: NONE },
      { cell: '411dp x1.3', widened: HEADLINE_AND_ACTION },
      { cell: '411dp x1.5', widened: HEADLINE_AND_ACTION },
    ]);

    // Family never widens, so the artwork has not quietly been removed from the whole app.
    expect(surface.every((row) => !row.widened.includes('family'))).toBe(true);
  });
});

describe('every approved string renders complete, in whichever presentation it gets', () => {
  it.each(CELLS)('at $width dp, font scale $fontScale', ({ width, fontScale }) => {
    /*
      The requirement itself, as one property per string rather than as a decision table. The box a
      string gets is whichever one the rule chose; inside that box:

        • the eyebrow is one line, so it must fit outright;
        • the headline may wrap to three, so no single word may exceed the box;
        • the support may wrap to four, same condition, plus the line count;
        • the pill is one line plus its chrome, so it must fit outright.

      This is also the no-overlap proof for the ordinary presentation: the artwork sits beside the 52%
      column, so a string that fits its box cannot reach the artwork.
    */
    for (const module of SHARED) {
      const widened = shouldWidenHeroCopy(inputFor(module, width, fontScale));
      const box = widened ? fullBox(width) : columnBox(width);
      const hero = module.hero;
      const headlineSize = renderedSize('heroDisplay', width, fontScale);
      const supportSize = renderedSize('heroBody', width, fontScale);

      expect({
        module: module.id,
        eyebrowFits:
          textWidthEm(hero.eyebrow, 'medium') * renderedSize('eyebrow', width, fontScale) <= box,
        headlineNoSplit: widestWord(hero.headline, 'semiBold', headlineSize) <= box,
        supportNoSplit: widestWord(hero.support!, 'regular', supportSize) <= box,
        actionFits: actionNeed(hero.actionLabel, width, fontScale) <= box,
      }).toEqual({
        module: module.id,
        eyebrowFits: true,
        headlineNoSplit: true,
        supportNoSplit: true,
        actionFits: true,
      });

      expect(linesNeeded(hero.headline, 'semiBold', box, headlineSize)).toBeLessThanOrEqual(
        HEADLINE_LINES,
      );
      expect(linesNeeded(hero.support!, 'regular', box, supportSize)).toBeLessThanOrEqual(
        SUPPORT_LINES,
      );
    }
  });

  it('keeps "manageable" one intact word in every cell', () => {
    const planner = moduleNamed('planner');
    expect(planner.hero.headline).toBe('Make today manageable');
    for (const { width, fontScale } of CELLS) {
      const box = shouldWidenHeroCopy(inputFor(planner, width, fontScale))
        ? fullBox(width)
        : columnBox(width);
      const word =
        textWidthEm('manageable', 'semiBold') * renderedSize('heroDisplay', width, fontScale);
      expect({ width, fontScale, fits: word <= box }).toEqual({ width, fontScale, fits: true });
    }
  });

  it('keeps every action label whole in every cell', () => {
    // The three that clipped, and the two that did not, all asserted the same way.
    for (const { width, fontScale } of CELLS) {
      for (const module of SHARED) {
        const box = shouldWidenHeroCopy(inputFor(module, width, fontScale))
          ? fullBox(width)
          : columnBox(width);
        expect({
          module: module.id,
          width,
          fontScale,
          whole: actionNeed(module.hero.actionLabel, width, fontScale) <= box,
        }).toEqual({ module: module.id, width, fontScale, whole: true });
      }
    }
  });
});

describe('both thresholds are derived, and neither sits near an edge', () => {
  const headlineHeadroom = (module: SharedModule, width: number, fontScale: number) =>
    columnBox(width) / headlineNeed(module.hero.headline, width, fontScale);
  const actionHeadroom = (module: SharedModule, width: number, fontScale: number) =>
    columnBox(width) / actionNeed(module.hero.actionLabel, width, fontScale);

  /** Planner must keep its artwork here: an ordinary phone at the default text size. */
  const PROTECTED: readonly { readonly width: number; readonly fontScale: number }[] = [
    { width: 384, fontScale: 1 },
    { width: 411, fontScale: 1 },
  ];

  it('puts the headline margin inside the window the required outcomes leave open', () => {
    /*
      ── The derivation, as a test rather than as a comment ────────────────────
      The margin is not free to be anything. Two kinds of cell bound it:

        • a cell whose word genuinely does not fit its column **must** widen, so the margin has to
          exceed that cell's headroom — otherwise the rule keeps a column that clips;
        • the two protected cells **must not** widen, so the margin cannot exceed their headroom —
          otherwise Planner loses its artwork on an ordinary phone, which is the outcome this
          refinement exists to prevent.

      That leaves a window, and this asserts the margin is inside it with real clearance either side.
      Nothing here hard-codes the number: change the column ratio or an approved string and the window
      moves, and the assertion still says the same thing.
    */
    let floor = 0;
    for (const { width, fontScale } of CELLS) {
      for (const module of SHARED) {
        const headroom = headlineHeadroom(module, width, fontScale);
        if (headroom < 1) floor = Math.max(floor, headroom);
      }
    }
    // Planner at 320 dp and scale 1.5 must widen even though its word is only marginally too wide.
    floor = Math.max(floor, headlineHeadroom(moduleNamed('planner'), 320, 1.5));

    const ceiling = Math.min(
      ...PROTECTED.map(({ width, fontScale }) =>
        headlineHeadroom(moduleNamed('planner'), width, fontScale),
      ),
    );

    expect(floor).toBeLessThan(ceiling);
    expect(heroCopyColumnHeadroom).toBeGreaterThan(floor);
    expect(heroCopyColumnHeadroom).toBeLessThanOrEqual(ceiling);
    // At least 3% either side, so a device that shapes slightly differently cannot flip an outcome.
    expect(heroCopyColumnHeadroom / floor).toBeGreaterThan(1.03);
    expect(ceiling / heroCopyColumnHeadroom).toBeGreaterThan(1.03);
  });

  it('reserves the measured model error and not a great deal more', () => {
    /*
      The margin's size has to come from something. Two device observations at the previous 52% column
      bracket how wrong this arithmetic can be: a headroom of 1.0067 rendered "manageable" intact on
      the emulator, and 0.998 split it on the phone, so the true boundary is inside (0.998, 1.0067]
      and the model's error is under 0.67%. A few times that is a rendering allowance; the 25% reserve
      this replaced was large enough to declare an ordinary layout unfittable.
    */
    const measuredError = 0.0067;
    expect(heroCopyColumnHeadroom).toBeGreaterThan(1 + measuredError);
    expect(heroCopyColumnHeadroom).toBeLessThan(1 + measuredError * 6);
  });

  it('keeps Planner beside its artwork at both ordinary widths', () => {
    /*
      The product requirement, stated directly against the predicate. Both conditions must be quiet:
      the headline fits the wider column, and Planner's short pill was never the problem.
    */
    for (const { width, fontScale } of PROTECTED) {
      const input = inputFor(moduleNamed('planner'), width, fontScale);
      expect({
        width,
        headline: headlineOverflowsColumn(input),
        action: actionOverflowsColumn(input),
        widened: shouldWidenHeroCopy(input),
      }).toEqual({ width, headline: false, action: false, widened: false });
    }
  });

  it('still constrains Planner at the narrow width and above the default text size', () => {
    // The other half of the same requirement: the refinement must not weaken the rule.
    for (const { width, fontScale } of [
      { width: 320, fontScale: 1.5 },
      { width: 320, fontScale: 1.3 },
      { width: 384, fontScale: 1.3 },
      { width: 411, fontScale: 1.3 },
    ]) {
      const input = inputFor(moduleNamed('planner'), width, fontScale);
      expect({ width, fontScale, headline: headlineOverflowsColumn(input) }).toEqual({
        width,
        fontScale,
        headline: true,
      });
    }
  });

  it('keeps a gap around the action threshold, and the threshold inside it', () => {
    /*
      The pill band is computed rather than pinned, because widening the shared column moves every
      pill headroom with it. What must survive is the shape: a gap between the pills that overflow and
      the pills that fit, with the threshold inside it and clearance on both sides.
    */
    const below: number[] = [];
    const above: number[] = [];
    for (const { width, fontScale } of CELLS) {
      for (const module of SHARED) {
        const value = actionHeadroom(module, width, fontScale);
        (value < heroActionColumnHeadroom ? below : above).push(value);
      }
    }
    const top = Math.max(...below);
    const bottom = Math.min(...above);
    expect(bottom / top).toBeGreaterThan(1.1);
    expect(heroActionColumnHeadroom).toBeGreaterThan(top);
    expect(heroActionColumnHeadroom).toBeLessThan(bottom);
    expect(heroActionColumnHeadroom / top).toBeGreaterThan(1.03);
    expect(bottom / heroActionColumnHeadroom).toBeGreaterThan(1.03);
  });

  it('gives every ordinary cell at least its documented margin of slack', () => {
    /*
      What the two margins *mean*, asserted rather than described: a hero that keeps its column has a
      headline with at least `heroCopyColumnHeadroom` of room and a pill with at least
      `heroActionColumnHeadroom`. That is the perturbation tolerance — a device whose shaping differs
      from the `hmtx` advances by less than the margin still renders both without clipping.
    */
    for (const { width, fontScale } of CELLS) {
      for (const module of SHARED) {
        if (shouldWidenHeroCopy(inputFor(module, width, fontScale))) continue;
        expect({
          module: module.id,
          width,
          fontScale,
          headlineSlack:
            headlineNeed(module.hero.headline, width, fontScale) * heroCopyColumnHeadroom <=
            columnBox(width),
          actionSlack:
            actionNeed(module.hero.actionLabel, width, fontScale) * heroActionColumnHeadroom <=
            columnBox(width),
        }).toEqual({
          module: module.id,
          width,
          fontScale,
          headlineSlack: true,
          actionSlack: true,
        });
      }
    }
  });

  it.each([0.98, 0.9, 0.8])(
    'never clips when the column turns out ×%s narrower than measured',
    (perturbation) => {
      /*
        A narrower-than-measured column can only push a cell *into* full width, which is the safe
        direction — so this holds far beyond the margin. Asserted against the perturbed column, since
        that is the box the copy would actually get.
      */
      for (const { width, fontScale } of CELLS) {
        for (const module of SHARED) {
          const narrowed = columnBox(width) * perturbation;
          const widened = shouldWidenHeroCopy(
            inputFor(module, width, fontScale, { columnWidth: narrowed }),
          );
          const box = widened ? fullBox(width) : narrowed;
          expect({
            module: module.id,
            width,
            fontScale,
            perturbation,
            headlineSafe: headlineNeed(module.hero.headline, width, fontScale) <= box,
            actionSafe: actionNeed(module.hero.actionLabel, width, fontScale) <= box,
          }).toEqual({
            module: module.id,
            width,
            fontScale,
            perturbation,
            headlineSafe: true,
            actionSafe: true,
          });
        }
      }
    },
  );

  it.each([1.01, 1.02])(
    'never clips when the measured need turns out ×%s wider than modelled',
    (perturbation) => {
      /*
        The dangerous direction: an understated measurement could let a hero keep a column it cannot
        fill. The headline margin is exactly the tolerance for that, so anything within the margin is
        safe — asserted at the margin itself rather than at an arbitrary ten percent.
      */
      expect(perturbation).toBeLessThanOrEqual(heroCopyColumnHeadroom);
      for (const { width, fontScale } of CELLS) {
        for (const module of SHARED) {
          const widened = shouldWidenHeroCopy(inputFor(module, width, fontScale));
          const box = widened ? fullBox(width) : columnBox(width);
          expect({
            module: module.id,
            width,
            fontScale,
            perturbation,
            headlineSafe:
              headlineNeed(module.hero.headline, width, fontScale) * perturbation <= box,
            actionSafe: actionNeed(module.hero.actionLabel, width, fontScale) * perturbation <= box,
          }).toEqual({
            module: module.id,
            width,
            fontScale,
            perturbation,
            headlineSafe: true,
            actionSafe: true,
          });
        }
      }
    },
  );

  it.each([0.98, 1, 1.02])(
    'reaches the same decisions under a ×%s perturbation',
    (perturbation) => {
      /*
        The decision surface is stable across the headline margin's own width, on both conditions.
        Stated at the margin rather than at a round ten percent: the margin is what the measurements
        support, and claiming more would be the same mistake as the character-count estimate this
        issue started with.
      */
      for (const { width, fontScale } of CELLS) {
        for (const module of SHARED) {
          expect(
            shouldWidenHeroCopy(
              inputFor(module, width, fontScale, {
                columnWidth: columnBox(width) * perturbation,
              }),
            ),
          ).toBe(shouldWidenHeroCopy(inputFor(module, width, fontScale)));
        }
      }
    },
  );

  it('does not depend on which side of the headline cap the OS setting is', () => {
    /*
      The headline caps at 1.1 and the label does not, so 1.3 and 1.5 must agree on the headline
      condition. They also agree on the combined one, because every pill that overflows at 1.3 also
      overflows at 1.5 — asserted so the cap keeps being applied where the rule reads it.
    */
    for (const width of WIDTHS) {
      for (const module of SHARED) {
        expect(headlineOverflowsColumn(inputFor(module, width, 1.3))).toBe(
          headlineOverflowsColumn(inputFor(module, width, 1.5)),
        );
        expect(shouldWidenHeroCopy(inputFor(module, width, 1.3))).toBe(
          shouldWidenHeroCopy(inputFor(module, width, 1.5)),
        );
      }
    }
  });
});

describe('the boundary around the real fit margin', () => {
  /*
    The margin is a boundary, so it gets boundary cases: a column a hair inside it must widen, a column
    at or above it must not. Both are expressed against the margin rather than against a literal, so
    they keep meaning if the derivation moves.
  */
  const plannerNeedAt = (width: number, fontScale: number) =>
    headlineNeed(moduleNamed('planner').hero.headline, width, fontScale);

  it.each([
    { width: 384, fontScale: 1 },
    { width: 411, fontScale: 1 },
  ])('widens at $width dp just below the margin', ({ width, fontScale }) => {
    // One part in a thousand under the required room: the rule must still take the whole card.
    const justUnder = plannerNeedAt(width, fontScale) * heroCopyColumnHeadroom * 0.999;
    expect(
      headlineOverflowsColumn(
        inputFor(moduleNamed('planner'), width, fontScale, { columnWidth: justUnder }),
      ),
    ).toBe(true);
  });

  it.each([
    { width: 384, fontScale: 1 },
    { width: 411, fontScale: 1 },
  ])('stays ordinary at $width dp at exactly the margin', ({ width, fontScale }) => {
    // Exactly the required room, and one part in a thousand over it: the ordinary layout stands.
    const exactly = plannerNeedAt(width, fontScale) * heroCopyColumnHeadroom;
    expect(
      headlineOverflowsColumn(
        inputFor(moduleNamed('planner'), width, fontScale, { columnWidth: exactly }),
      ),
    ).toBe(false);
    expect(
      headlineOverflowsColumn(
        inputFor(moduleNamed('planner'), width, fontScale, { columnWidth: exactly * 1.001 }),
      ),
    ).toBe(false);
  });

  it('has the real column on the ordinary side of that boundary at both protected cells', () => {
    /*
      The two cases above prove the predicate respects its boundary. This proves the *shipped* column
      is on the right side of it — which is the product requirement, and the thing a ratio change
      would break.
    */
    for (const { width, fontScale } of [
      { width: 384, fontScale: 1 },
      { width: 411, fontScale: 1 },
    ]) {
      expect({
        width,
        room: columnBox(width) >= plannerNeedAt(width, fontScale) * heroCopyColumnHeadroom,
      }).toEqual({ width, room: true });
    }
  });

  it('still widens on CTA overflow independently of the headline', () => {
    /*
      The refinement widened the column, which relaxes both conditions — so the CTA branch has to be
      shown still to fire on its own. Goals at scale 1.5: the headline clears the wider column
      comfortably, the pill does not.
    */
    for (const width of WIDTHS) {
      const input = inputFor(moduleNamed('goals'), width, 1.5);
      expect({
        width,
        headline: headlineOverflowsColumn(input),
        action: actionOverflowsColumn(input),
        widened: shouldWidenHeroCopy(input),
      }).toEqual({ width, headline: false, action: true, widened: true });
    }
  });

  it('leaves Noor AI’s own column exactly where it was', () => {
    /*
      Noor AI draws its own hero and reads `heroTextColumnRatio`; the shared card now reads
      `heroCopyColumnRatio`. Widening one must not move the other, so both the value and the wiring
      are asserted — otherwise "Noor AI is unchanged" would rest on nobody having edited the wrong
      token.
    */
    expect(moduleLayout.heroTextColumnRatio).toBe(0.52);
    expect(moduleLayout.heroCopyColumnRatio).toBeGreaterThan(moduleLayout.heroTextColumnRatio);

    const noorAiHero = code(join(MODULES_ROOT, 'noor-ai', 'noor-ai-hero.tsx'));
    expect(noorAiHero).toContain('contentWidth * moduleLayout.heroTextColumnRatio');
    expect(noorAiHero).not.toContain('heroCopyColumnRatio');

    const card = code(CARD);
    expect(card).not.toContain('heroTextColumnRatio');
  });

  it('widens the shared column only modestly', () => {
    /*
      A bound on the refinement itself. The artwork decides where the copy may go, and the approved
      assets leave a quiet band on the copy side — so the column may grow enough to hold the widest
      approved word and no further. 0.60 would put copy over the subject of several assets.
    */
    expect(moduleLayout.heroCopyColumnRatio).toBeGreaterThan(0.52);
    expect(moduleLayout.heroCopyColumnRatio).toBeLessThanOrEqual(0.56);
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
    expect(source).toContain('{ width: contentWidth * moduleLayout.heroCopyColumnRatio }');
  });

  it('grows the card rather than clipping it', () => {
    expect(source).toContain('minHeight: dp(moduleLayout.heroHeight)');
    expect(source).not.toMatch(/\bheight: dp\(moduleLayout\.heroHeight\)/);
  });

  it('keeps the action label on one line', () => {
    /*
      The pill is single-line by design and stays that way: the fix is to give it a column it fits in,
      not to let it wrap into a two-line button. A second line would change approved geometry and the
      44 dp target reasoning with it.
    */
    expect(source).toMatch(
      /<ModuleText token="cardAction" color=\{module\.theme\.ink\} numberOfLines=\{1\}>/,
    );
  });

  it('keeps the approved tokens, and does not shrink or hyphenate anything', () => {
    expect(source).toMatch(/token=\{section \? 'cardHeading' : 'heroDisplay'\}/);
    expect(source).not.toContain('adjustsFontSizeToFit');
    expect(source).not.toContain('minimumFontScale');
    expect(source).not.toContain('hyphenationFrequency');
  });

  it('renders the registered strings and nothing derived from them', () => {
    expect(source).toContain('{resolvedHeadline}');
    expect(source).toContain('{hero.actionLabel}');
    expect(source).not.toMatch(/\.slice\(|\.substring\(|…/);
  });

  it('reads the same column and type arithmetic the tests do', () => {
    expect(source).toMatch(
      /columnWidth:\s*contentWidth \* moduleLayout\.heroCopyColumnRatio - dp\(moduleLayout\.heroPadding\) \* 2/,
    );
    expect(source).toContain("headlineFontSize: type('heroDisplay').fontSize");
    expect(source).toContain("actionFontSize: type('cardAction').fontSize");
  });

  it('gives the call to action a reachable target', () => {
    expect(source).toContain('hitSlop={minimumHitSlop(dp(moduleLayout.heroButtonHeight))}');
    expect(moduleLayout.heroButtonHeight).toBeLessThan(44);
  });
});

describe('the section presentation neither consults nor inherits this decision', () => {
  const source = code(CARD);

  it('short-circuits the rule in section mode', () => {
    /*
      `widenCopy` is gated on `!section`, so a placeholder screen never evaluates either condition —
      it was always full width, and still is, for its own reason.
    */
    expect(source).toMatch(/const widenCopy =\s*!section &&/);
    expect(source).toContain('const fullWidthCopy = section || widenCopy;');
  });

  it('keeps the type token, row gap and headline limit keyed on section alone', () => {
    expect(source).toMatch(/token=\{section \? 'cardHeading' : 'heroDisplay'\}/);
    expect(source).toMatch(/rowGap: dp\(section \? 3 : 2\)/);
    expect(source).toMatch(/numberOfLines=\{section \? 2 : 3\}/);
    // None of the three may be keyed on the new decision, or section mode would have changed.
    expect(source).not.toMatch(/token=\{fullWidthCopy/);
    expect(source).not.toMatch(/rowGap: dp\(fullWidthCopy/);
    expect(source).not.toMatch(/numberOfLines=\{fullWidthCopy/);
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
      /* Finance's composition since #93 — it renders the shared hero it already had. */
      'finance-home-content.tsx',
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

  it('caps the headline scale and leaves the action scale uncapped', () => {
    /*
      The difference is the whole reason a pill overflows a column its headline fits, so flattening
      the two would hide the defect this commit exists to fix.
    */
    expect(source).toContain('Math.min(Math.max(fontScale, 1), 1.1)');
    expect(source).toContain('return Math.max(fontScale, 1);');
  });

  it('treats an unmeasurable character as the widest one rather than as nothing', () => {
    expect(widestWordEm('中文文字')).toBeGreaterThan(widestWordEm('iiii'));
    expect(textWidthEm('中', 'medium')).toBeGreaterThan(textWidthEm('i', 'medium'));
  });

  it('ignores leading, trailing and repeated whitespace', () => {
    expect(widestWordEm('  Make   today  manageable  ')).toBe(
      widestWordEm('Make today manageable'),
    );
    expect(widestWordEm('   ')).toBe(0);
  });

  it('measures the same string differently in different faces', () => {
    // A sanity check that the face argument reaches the table rather than being decoration.
    const semi = textWidthEm('Add your first goal', 'semiBold');
    const medium = textWidthEm('Add your first goal', 'medium');
    const regular = textWidthEm('Add your first goal', 'regular');
    expect(semi).not.toBe(medium);
    expect(medium).not.toBe(regular);
    expect(semi).toBeGreaterThan(regular);
  });
});
