import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { render, screen, waitFor } from '@testing-library/react-native';
import { StyleSheet, type ViewStyle } from 'react-native';

import { pinModuleWindow } from '@/test-support/module-window';
import { minimumTouchTargetSize } from '@shared/utils/a11y';

import { ModuleHeroCard } from '../components/module-hero-card';
import { AA_TEXT, AA_UI, contrastRatio, formatRatio } from '../contrast';
import { ModuleProvider } from '../module-context';
import { allModuleDefinitions } from '../module-registry';
import { moduleSurfaces } from '../module-surfaces';
import { moduleColorThemes } from '../module-tokens';
import { ModuleHomeScreen } from '../screens/module-home-screen';

/**
 * **A call to action needs a ground of its own** — issue #122.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── What went wrong ────────────────────────────────────────────────────────
 * `6509de9` (#91) deleted `backgroundColor: moduleNeutrals.surface` from the shared hero's pill and
 * left `/* Overridden per module *␀/` in its place. No override was ever written, so the label fell
 * through to `theme.ink` painted straight onto a photograph. Measured on a device: Finance **1.3:1**,
 * Planner **2.5:1**. Both are below even the 3:1 non-text bar, and Finance's is the module's primary
 * action.
 *
 * The ink was never the problem. `module-tokens.ts` records Finance's as `4.51 on surface · 4.87 on
 * white`, and both figures are still true — of a ground the button had stopped having.
 *
 * ── Why this file asserts against the button, not the picture ──────────────
 * The obvious test — sample the hero PNG and compute a ratio — is the wrong test. The artwork is
 * commissioned per module, lives outside this file, and can be replaced without touching a line of
 * it. A contrast claim measured against a bitmap is a claim with no owner, and it would go stale
 * silently the first time an illustrator delivered a lighter sky.
 *
 * So the contract is structural: the pill owns an **opaque** ground from the surface roles, and every
 * ratio is computed against *that*. The picture underneath stops being able to affect readability at
 * all, which is the only form of this guarantee that survives arbitrary imagery.
 *
 * The border earns its place on the same argument. An opaque white pill vanishes against a pale
 * region of a photograph, so the edge carries the module's ink — and because fill and edge are
 * themselves far apart, no single colour behind the pill can hide both.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const MODULES_ROOT = join(__dirname, '..');
const CARD = join(MODULES_ROOT, 'components', 'module-hero-card.tsx');
const ARTWORK = join(MODULES_ROOT, 'components', 'module-hero-artwork.tsx');
const FAITH_HERO = join(MODULES_ROOT, 'faith', 'faith-hero.tsx');
const HEALTH_HERO = join(MODULES_ROOT, 'health', 'health-hero.tsx');
const SURFACES = join(MODULES_ROOT, 'module-surfaces.ts');
const TOKENS = join(MODULES_ROOT, 'module-tokens.ts');

/** Source with comments removed, so a sentence explaining a rule cannot satisfy it. */
function code(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

/**
 * Modules whose home hero is the shared card.
 *
 * Faith, Noor AI and Health each draw their own — the same split `hero-copy-fit.test.ts` uses, and
 * the reason those three are exempt from every assertion below. Derived from the registry rather
 * than listed, so a new module joins this suite by existing.
 */
const OWN_HERO = new Set(['faith', 'noor-ai', 'health']);
const SHARED = allModuleDefinitions.filter((module) => !OWN_HERO.has(module.id));

/** Modules whose shared hero actually renders a pill. An empty label means no button. */
const WITH_ACTION = SHARED.filter((module) => module.hero.actionLabel !== '');

/** The widths and OS text sizes #122 has to hold across. */
const WIDTHS = [393, 360, 320] as const;
const FONT_SCALES = [1, 1.5] as const;

function flat(node: { props: { style?: unknown } }): ViewStyle {
  return (StyleSheet.flatten(node.props.style) ?? {}) as ViewStyle;
}

/**
 * Renders the shared hero for one module and hands back its pill.
 *
 * The card rather than the whole home, deliberately. Two of the five module homes bring their own
 * feature providers — Planner throws without one — and standing those up here would make this file
 * fail for reasons that have nothing to do with a button's ground. The consumers are covered instead
 * by reading how they wire this component, which is the part #122 could actually break.
 */
async function actionOf(moduleId: string, width = 393, fontScale = 1) {
  pinModuleWindow({ width, fontScale });
  await render(
    <ModuleProvider moduleId={moduleId as never}>
      <ModuleHeroCard onAction={() => undefined} testID={`${moduleId}-hero`} />
    </ModuleProvider>,
  );
  const id = `${moduleId}-hero-action`;
  await waitFor(() => expect(screen.getByTestId(id)).toBeTruthy());
  return screen.getByTestId(id);
}

describe('the pill owns an opaque ground from the surface roles', () => {
  it.each(WITH_ACTION.map((module) => module.id))(
    '%s paints the card surface behind its call to action',
    async (moduleId) => {
      const style = flat(await actionOf(moduleId));
      /*
        Not "some background" — *the* one the contract names. `moduleSurfaces` answers `cardSurface`
        for a module that has opted into the roles and `moduleNeutrals.surface` for one that has not,
        and both are `#FFFFFF`, which is why one expression serves every module and no `moduleId ===`
        branch is needed anywhere in this component.
      */
      expect(style.backgroundColor).toBe(moduleSurfaces(moduleId).card);
    },
  );

  it.each(WITH_ACTION.map((module) => module.id))(
    '%s leaves that ground opaque',
    async (moduleId) => {
      const style = flat(await actionOf(moduleId));
      const fill = String(style.backgroundColor);

      /*
        Three ways a fill stops being a guarantee, all refused. Eight-digit hex and `rgba()` carry an
        alpha channel, so what the user reads becomes a function of the picture again; `opacity` on
        the pill does the same thing one level up and would take the label's contrast with it.
      */
      expect(fill).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(fill).not.toMatch(/rgba|hsla/i);
      expect(style.opacity).toBeUndefined();
    },
  );

  it('names the role in source rather than repeating its value', () => {
    const card = code(CARD);
    expect(card).toContain('backgroundColor: surfaces.card');
    /*
      A literal would render identically today and drift the moment the role moves. #91's own lesson:
      the colour has to have an owner, and `module-surfaces.ts` is it.
    */
    const button = /style=\{\[\s*styles\.button[\s\S]*?\]\}/.exec(card)?.[0] ?? '';
    expect(button).not.toMatch(/#[0-9a-fA-F]{3,8}/);
    expect(button).not.toMatch(/rgba?\(/);
  });
});

describe('the ratios are computed against the pill, never against the artwork', () => {
  /*
    One row per module theme. These are the numbers #122 restores, and they are the numbers the token
    comments always claimed — `4.87 on white` for Finance, and so on across the set.
  */
  it.each(WITH_ACTION.map((module) => module.id))(
    '%s reads its label at AA against its own ground',
    (moduleId) => {
      const ground = moduleSurfaces(moduleId).card;
      const ink = moduleColorThemes[moduleId as keyof typeof moduleColorThemes].ink;
      const ratio = contrastRatio(ink, ground);
      /*
        Compared as a sentence rather than a bare number, so a failure names the pair and prints the
        ratio it actually got instead of "expected >= 4.5".
      */
      expect(`${ink} on ${ground} is ${formatRatio(ratio)}`).toBe(
        `${ink} on ${ground} is ${formatRatio(Math.max(ratio, AA_TEXT))}`,
      );
      expect(ratio).toBeGreaterThanOrEqual(AA_TEXT);
    },
  );

  it.each(WITH_ACTION.map((module) => module.id))(
    '%s draws its chevron above the graphical bar',
    (moduleId) => {
      const ground = moduleSurfaces(moduleId).card;
      const ink = moduleColorThemes[moduleId as keyof typeof moduleColorThemes].ink;
      /* Same ink, lower bar — an icon is not text. Asserted separately so weakening one is visible. */
      expect(contrastRatio(ink, ground)).toBeGreaterThanOrEqual(AA_UI);
    },
  );

  it.each(WITH_ACTION.map((module) => module.id))(
    '%s keeps an edge no single colour behind it can hide',
    async (moduleId) => {
      const style = flat(await actionOf(moduleId));
      const fill = String(style.backgroundColor);
      const edge = String(style.borderColor);

      expect(Number(style.borderWidth)).toBeGreaterThan(0);
      /*
        The boundary claim, stated so it survives arbitrary imagery. A photograph can match the fill
        or it can match the edge; it cannot do both, because the two are further apart than the bar
        we would demand of either one alone. That is a property of the button, provable here — unlike
        "the pill contrasts with the picture", which is a property of a PNG this file cannot see.
      */
      expect(contrastRatio(fill, edge)).toBeGreaterThanOrEqual(AA_TEXT);
    },
  );

  it('refuses any colour taken from the artwork', () => {
    const card = code(CARD);
    /*
      Sampling the hero, averaging it, or keying a colour off the asset name would all produce a
      number that looks like contrast and is not owned by anything. None of it appears, and this
      assertion is why it cannot start to.
    */
    expect(card).not.toMatch(/getPixel|sampleImage|averageColou?r|dominantColou?r/i);
    expect(card).not.toMatch(/heroArtwork\s*\.\s*(colou?r|tint)/i);
    const button = /style=\{\[\s*styles\.button[\s\S]*?\]\}/.exec(card)?.[0] ?? '';
    expect(button).not.toMatch(/heroArtwork|artwork|image/i);
  });

  it('leaves the artwork untinted', () => {
    /* The other way to "fix" contrast: darken the picture. It changes approved artwork, so it is out. */
    expect(code(ARTWORK)).not.toContain('tintColor');
    expect(code(CARD)).not.toContain('tintColor');
  });
});

describe('one implementation, no module knows its own name', () => {
  it('carries no per-module branch', () => {
    const card = code(CARD);
    /*
      The fix is shared or it is not a fix. A `moduleId === 'finance'` here would leave Planner at
      2.5:1 and the next module at whatever its artwork happened to be.
    */
    expect(card).not.toMatch(/moduleId\s*===/);
    expect(card).not.toMatch(/['"](finance|planner|learning|family|goals)['"]/);
  });

  it('keeps the surface roles themselves unchanged', () => {
    /*
      #122 restores a *consumer* of the contract. If it had needed the contract itself to move, that
      would be a decision about seven modules' pages, not about one button.
    */
    expect(moduleSurfaces('finance').card).toBe('#FFFFFF');
    expect(moduleSurfaces('planner').card).toBe('#FFFFFF');
    expect(code(TOKENS)).toContain("const CARD_SURFACE = '#FFFFFF'");
    expect(code(SURFACES)).toContain('card: theme.cardSurface');
    expect(code(SURFACES)).toContain('card: moduleNeutrals.surface');
  });

  it('leaves the #91 page and banner contract intact', () => {
    /*
      Finance's page ground and the ink-bordered banner are the other half of the surface work, and
      this change must not have moved either. Both are still 1.02:1 apart by fill and separated by ink.
    */
    expect(moduleColorThemes.finance.pageSurface).toBe('#FFF3E6');
    expect(contrastRatio(moduleColorThemes.finance.pageSurface, '#FFF6E6')).toBeLessThan(1.05);
    expect(code(SURFACES)).toContain('useStatusInkBorder');
  });
});

describe('everything the pill already guaranteed still holds', () => {
  const TARGET_CELLS: readonly [string, number, number][] = WITH_ACTION.flatMap((module) =>
    WIDTHS.flatMap((width) =>
      FONT_SCALES.map((fontScale): [string, number, number] => [module.id, width, fontScale]),
    ),
  );

  it.each(TARGET_CELLS)(
    '%s stays a 44 dp target at %i dp, font scale %s',
    async (moduleId, width, fontScale) => {
      const style = flat(await actionOf(moduleId, width, fontScale));
      const floor = minimumTouchTargetSize();
      /*
      #115 put the floor on the node itself and #120 proved a `hitSlop` cannot stand in for one. The
      pill's visual height is still the approved 34 dp token; `PressableScale` raises the *node*.
    */
      expect(Number(style.minWidth)).toBeGreaterThanOrEqual(floor);
      expect(Number(style.minHeight)).toBeGreaterThanOrEqual(floor);
    },
  );

  it.each(WITH_ACTION.map((module) => module.id))(
    '%s keeps its role, its label and one line',
    async (moduleId) => {
      const module = WITH_ACTION.find((entry) => entry.id === moduleId);
      const action = await actionOf(moduleId);
      expect(action.props.accessibilityRole).toBe('button');
      expect(action.props.accessibilityLabel).toBe(module?.hero.actionLabel);
      /* Meaning never rests on colour alone: the label says what the button does, in words. */
      expect(String(module?.hero.actionLabel ?? '')).not.toHaveLength(0);
    },
  );

  it('keeps the press feedback and declares no disabled state', () => {
    const card = code(CARD);
    /*
      Pressed feedback belongs to `PressableScale` and is unchanged — this file adds a ground, not a
      state machine. There is no disabled state to assert: the hero action always has a handler,
      falling back to a no-op, so a "disabled" appearance would be a lie about a live control.
    */
    expect(card).toContain('<PressableScale');
    expect(card).toContain('onPress={onAction ?? (() => undefined)}');
    expect(card).not.toContain('disabled');
  });

  it('leaves every consumer wiring the same destination', () => {
    /*
      The ground changed; the destinations did not. Read from the consumers rather than from a
      rendered node, because `PressableScale` hands the host view its own responder props and
      `onPress` is not among them — asserting it there would pass on a button that goes nowhere.

      These five files are the production consumers of the shared hero. Health, Faith and Noor AI
      draw their own and appear in the exemption block below.
    */
    const finance = code(
      join(MODULES_ROOT, '..', 'finance', 'screens', 'finance-home-content.tsx'),
    );
    expect(finance).toContain("router.push('/finance/transactions?intent=add-expense')");

    const planner = code(
      join(MODULES_ROOT, '..', 'planner', 'screens', 'planner-home-content.tsx'),
    );
    expect(planner).toContain("router.push('/planner/tasks')");

    /* The generic homes and the two developer surfaces pass no handler, so the pill is inert there. */
    for (const consumer of ['module-home-screen.tsx', 'module-section-screen.tsx']) {
      expect(code(join(MODULES_ROOT, 'screens', consumer))).toContain('ModuleHeroCard');
    }
  });

  it('leaves the hero image, its crop and the card geometry alone', () => {
    const card = code(CARD);
    expect(card).toContain('source={fullWidthCopy ? undefined : module.heroArtwork}');
    expect(card).toContain('scrim={module.heroScrim}');
    expect(card).toContain('copySide={module.heroCopySide}');
    expect(card).toContain('minHeight: dp(moduleLayout.heroHeight)');
    expect(card).toContain('borderRadius: dp(moduleLayout.cardRadius)');
    expect(card).toContain('backgroundColor: module.theme.gradientStart');
    /* The pill's own visual height is the approved token, not something this change chose. */
    expect(card).toContain('minHeight: dp(moduleLayout.heroButtonHeight)');
  });

  it('renders the artwork layer on an ordinary module home', async () => {
    pinModuleWindow();
    await render(<ModuleHomeScreen moduleId="finance" />);
    await waitFor(() => expect(screen.getByTestId('finance-hero')).toBeTruthy());
    expect(screen.getByTestId('finance-hero-artwork')).toBeTruthy();
  });
});

describe('the heroes this issue does not touch', () => {
  it('leaves Faith drawing its own gold pill', () => {
    const faith = code(FAITH_HERO);
    /*
      Faith is a separate component and was never affected — it measured 7.44:1 on device throughout.
      Pinned here so a later tidy-up cannot quietly route it through the shared card and inherit a
      decision that was made for a different picture.
    */
    expect(faith).toContain("const GOLD = '#E3BE73'");
    expect(faith).toContain('backgroundColor: GOLD');
    expect(faith).not.toContain('ModuleHeroCard');
  });

  it('leaves Health’s own hero with the fill it never lost', () => {
    /*
      The sibling #91 did not touch, and the clearest evidence the removal was an oversight: the same
      pill, in the same feature, still carries the same neutral ground.
    */
    expect(code(HEALTH_HERO)).toContain('backgroundColor: moduleNeutrals.surface');
  });

  it('leaves Main Home out of it', () => {
    /*
      Main Home is design-locked and draws neither this component nor this pill, so #122 has nothing
      to say about it. Asserted rather than assumed, because "shared component" is exactly where a
      scoped change leaks into a locked file.
    */
    const home = code(join(MODULES_ROOT, '..', 'home', 'components', 'home-hero.tsx'));
    expect(home).not.toContain('ModuleHeroCard');
    expect(home).not.toContain('heroActionChromeWidth');
  });
});

describe('the guard that stops this coming back', () => {
  it('refuses hero action ink with no ground under it', () => {
    const card = code(CARD);

    /*
      The shape of the regression, stated directly: the pill renders `theme.ink` for its label and its
      chevron, so the block that does so must also declare a `backgroundColor`. #91 removed one and
      left the other, and nothing in the suite noticed for a whole release.

      Read from the style array rather than the whole file, so a background belonging to some other
      element cannot satisfy it.
    */
    const button = /style=\{\[\s*styles\.button([\s\S]*?)\]\}/.exec(card)?.[1];
    expect(button).toBeDefined();
    expect(button).toContain('backgroundColor:');
    expect(button).toContain('borderColor:');

    /* And the stylesheet entry stays layout-only, so there is one place the ground can come from. */
    const stylesheet = /button: \{([\s\S]*?)\n  \}/.exec(card)?.[1];
    expect(stylesheet).toBeDefined();
    expect(stylesheet).not.toContain('backgroundColor');
    expect(stylesheet).not.toContain('borderColor');
  });

  it('keeps the ink used for text tied to a declared ground in every theme', () => {
    /*
      A whole-contract sweep rather than a spot check: if a future module's ink cannot be read on the
      card surface, this fails when that module is added, not when someone opens the app.
    */
    const failures = SHARED.filter(
      (module) =>
        contrastRatio(
          moduleColorThemes[module.id as keyof typeof moduleColorThemes].ink,
          moduleSurfaces(module.id).card,
        ) < AA_TEXT,
    ).map((module) => module.id);
    expect(failures).toEqual([]);
  });
});
