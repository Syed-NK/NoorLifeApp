import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { render, screen, waitFor } from '@testing-library/react-native';

import { installMockLatencyTimers } from '@/test-support/mock-latency-timers';
import { pinModuleWindow } from '@/test-support/module-window';

import { ModuleHomeScreen } from '../screens/module-home-screen';
import { ModuleSectionScreen } from '../screens/module-section-screen';

/**
 * **A placeholder has to be readable to be honest** — the second half of issue #37.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── What the copy fix could not fix ────────────────────────────────────────
 * The nineteen placeholder screens were rewritten to say what is planned rather than what happened.
 * Then measurement on a physical device showed the new copy clipping — *at font scale 1.0*, not only
 * at 1.3 — to "Controls pl…" and "…before each mo…", and on Noor AI the text ran across the robot.
 *
 * The cause is that `ModuleHeroCard` is built for a module **home**: an approved short phrase beside
 * artwork, in a copy column fixed at 52% of the content width, with one line of display type. That is
 * right for a home and wrong for a screen whose whole job is to explain that a destination does not
 * exist yet. Honest copy that cannot be read is not honest.
 *
 * ── The change, and its blast radius ───────────────────────────────────────
 * One opt-in prop, `layout`, defaulting to `'hero'`. Section mode drops the decorative artwork, gives
 * the copy the whole card, sets the headline at heading rather than display size, and swaps `height`
 * for `minHeight` so a larger font lengthens the card instead of cutting the sentence.
 *
 * Every module home keeps the default, so the home hero is untouched — which is the property this
 * file spends most of its assertions on, because a shared component is exactly where a scoped fix
 * leaks.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const MODULES_ROOT = join(__dirname, '..');
const CARD = join(MODULES_ROOT, 'components', 'module-hero-card.tsx');
const APP_ROOT = join(MODULES_ROOT, '..', '..', 'app');

installMockLatencyTimers(async () => {
  await render(
    <ModuleSectionScreen
      moduleId="noor-ai"
      activeKey="ask-ai"
      title="AI Permissions"
      heroTitle="Controls planned"
      heroBody="Not built yet. Today Noor AI asks before each module read."
    />,
  );
});

function code(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

/** Every route file under `src/app`, discovered rather than listed. */
function routeFiles(): readonly string[] {
  const found: string[] = [];
  const walk = (dir: string, prefix: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full, prefix === '' ? entry : `${prefix}/${entry}`);
        continue;
      }
      if (entry.endsWith('.tsx')) {
        found.push(prefix === '' ? entry : `${prefix}/${entry}`);
      }
    }
  };
  walk(APP_ROOT, '');
  return found;
}

const PLACEHOLDER_ROUTES = routeFiles().filter((file) =>
  code(join(APP_ROOT, file)).includes('ModuleSectionScreen'),
);

describe('the module home hero is untouched', () => {
  /*
    The whole risk of this change. `ModuleHeroCard` is the hero for Health, Planner, Finance,
    Learning, Family and Goals, and a presentation prop added for placeholders must not reach any of
    them.
  */
  it('defaults to the home presentation', () => {
    expect(code(CARD)).toContain("layout = 'hero'");
  });

  it('is opted into by the section screen and nothing else', () => {
    /*
      Both candidate populations, checked with absolute paths: every route under `src/app`, and every
      screen in this feature. Exactly one file may ask for the section presentation, so a module home
      cannot acquire it by accident.
    */
    const candidates: string[] = [
      ...routeFiles().map((file) => join(APP_ROOT, file)),
      ...readdirSync(join(MODULES_ROOT, 'screens'))
        .filter((file) => file.endsWith('.tsx'))
        .map((file) => join(MODULES_ROOT, 'screens', file)),
    ];

    const optIn = candidates.filter((path) => /layout=("section"|{'section'})/.test(code(path)));

    expect(optIn.map((path) => path.split(/[\\/]/).pop())).toEqual(['module-section-screen.tsx']);
  });

  it('keeps the home column and the home type token', () => {
    /*
      ── Updated for issue #50, and what it still guards ──────────────────────
      This began as #37's guard that adding the section presentation had not disturbed the home hero.
      Two of its four assertions have been deliberately overtaken:

        • `height` became `minHeight` **unconditionally**, because a fixed box cannot honour wrapping —
          it is exactly what turned "this headline needs a second line" into an ellipsis. It is a
          floor, so copy that fits still renders at the height it always did;
        • the home headline went from one line to three, which is the fix.

      The two that still matter are asserted unchanged in shape: the copy column is still a ratio of
      the content width, so text does not move over the busy part of the locked artwork, and the two
      presentations keep distinct type tokens. Those are what "the home hero is still the home hero"
      actually rests on.

      The ratio itself moved from 0.52 to `heroCopyColumnRatio` in #50's final refinement, so that
      Planner's headline fits beside its artwork on an ordinary phone rather than displacing it. The
      value, its derivation and Noor AI's untouched 0.52 are pinned in `hero-copy-fit.test.ts`.
    */
    const card = code(CARD);
    expect(card).toContain('minHeight: dp(moduleLayout.heroHeight)');
    expect(card).not.toContain('{ height: dp(moduleLayout.heroHeight) }');
    expect(card).toContain('{ width: contentWidth * moduleLayout.heroCopyColumnRatio }');
    expect(card).toMatch(/token=\{section \? 'cardHeading' : 'heroDisplay'\}/);
    expect(card).toMatch(/numberOfLines=\{section \? 2 : 3\}/);
  });

  it('still draws the artwork on a module home', async () => {
    /*
      ── Why this moved from Planner to Finance (issue #50) ────────────────────
      It used to render Planner, on the reasonable assumption that any module home would do. Planner
      is now the one module that will not: its headline contains "manageable", which is wider on its
      own than the 52% column, so its hero gives the copy the whole card and the decorative artwork
      steps aside. Finance's widest word clears the column by more than double, so it is the honest
      witness for "an ordinary module home still draws its artwork".

      The rule that decides this, and the per-module outcome across every tested width and text size,
      are pinned in `hero-copy-fit.test.ts`.
    */
    // Pinned to an ordinary phone: at the Jest mock's font scale 2 every hero drops its artwork so
    // that its approved copy stays whole, which is the opposite of what this case is about.
    pinModuleWindow();
    await render(<ModuleHomeScreen moduleId="finance" />);
    await waitFor(() => expect(screen.getByTestId('finance-hero')).toBeTruthy());
    // The home hero keeps its locked artwork layer.
    expect(screen.getByTestId('finance-hero-artwork')).toBeTruthy();
  });
});

describe('the section presentation makes the copy readable', () => {
  const LONGEST_BODY = 'Not built yet. Today Noor AI asks before each module read.';

  async function renderSection() {
    return await render(
      <ModuleSectionScreen
        moduleId="noor-ai"
        activeKey="ask-ai"
        title="AI Permissions"
        heroTitle="Controls planned"
        heroBody={LONGEST_BODY}
      />,
    );
  }

  it('draws no decorative artwork behind the copy', async () => {
    await renderSection();
    /*
      The overlap, removed at its cause. Noor AI's robot sits on the left, which is exactly where this
      card puts its copy — so on four screens the explanation was printed over it.
    */
    expect(screen.queryByTestId('noor-ai-ask-ai-hero-artwork')).toBeNull();
  });

  it('exposes the complete headline and body to accessibility', async () => {
    await renderSection();
    expect(screen.getByText('Controls planned')).toBeTruthy();
    expect(screen.getByText(LONGEST_BODY)).toBeTruthy();
  });

  it('renders both halves of the AI permission sentence', async () => {
    /*
      Named explicitly because this is the screen whose old copy claimed a privacy control. Both the
      caveat and the statement of what actually happens today have to be present.
    */
    await renderSection();
    const body = screen.getByText(LONGEST_BODY);
    expect(String(body.props.children)).toContain('Not built yet.');
    expect(String(body.props.children)).toContain('Today Noor AI asks before each module read.');
  });

  it('lets the copy use the whole card and the card grow', async () => {
    const view = await renderSection();
    const hero = view.getByTestId('noor-ai-ask-ai-hero');
    const flat = (Array.isArray(hero.props.style) ? hero.props.style : [hero.props.style])
      .filter(
        (entry: unknown): entry is Record<string, unknown> =>
          typeof entry === 'object' && entry !== null,
      )
      .reduce<Record<string, unknown>>((all, entry) => ({ ...all, ...entry }), {});

    // Grows rather than clips: no fixed height, a floor instead.
    expect(flat.height).toBeUndefined();
    expect(typeof flat.minHeight).toBe('number');
  });

  it('gives the body four lines in both presentations', () => {
    /*
      This asserted four in section mode against two on a home. Issue #50 measured the home at 320 dp
      and OS scale 1.5 — where the support line, which carries no multiplier cap, needs four — so the
      two limits converged on the larger number.

      That is not a loss of distinction. The presentations still differ in type token, in whether the
      artwork is drawn, and in how many lines the *headline* may take, and each of those is asserted
      elsewhere in this file. A sentence needs the same room whichever card it is in.
    */
    expect(code(CARD)).toMatch(/numberOfLines=\{4\}/);
  });
});

describe('every placeholder route gets the readable presentation', () => {
  it('routes them all through the one screen that opts in', () => {
    /*
      Filesystem-enumerated, so a twentieth placeholder inherits the fix without anyone remembering.
      Each route renders `ModuleSectionScreen`, and that screen — asserted above as the only opt-in —
      passes `layout="section"`.
    */
    /*
      Seventeen since #94, which built Budgets and so removed another placeholder from the set —
      #93 had already removed Spending. The floor moves down as modules get built, which is the
      direction it is supposed to move, and it stays a floor rather than an exact count so a *new*
      placeholder still inherits the fix without anyone remembering to update a number.
    */
    expect(PLACEHOLDER_ROUTES.length).toBeGreaterThanOrEqual(17);
    expect(code(join(MODULES_ROOT, 'screens', 'module-section-screen.tsx'))).toContain(
      'layout="section"',
    );
  });

  it.each(PLACEHOLDER_ROUTES)('%s passes no layout of its own', (route) => {
    // The presentation is the screen's decision, not each route's, so there is one place to change it.
    expect(code(join(APP_ROOT, route))).not.toContain('layout=');
  });
});

describe('the section screen keeps everything else', () => {
  const shell = code(join(MODULES_ROOT, 'screens', 'module-section-screen.tsx'));

  it('keeps its banner, its suppressed action and its navigation', async () => {
    expect(shell).toContain('ModuleStatusBanner');
    expect(shell).toContain('hideAction');
    expect(shell).toContain('ModuleFeatureGrid');

    await render(
      <ModuleSectionScreen
        moduleId="health"
        activeKey="track"
        title="Track"
        heroTitle="Logging planned"
        heroBody="Not built yet. A walk or a glass of water, in seconds."
      />,
    );
    expect(screen.getByTestId('health-track-banner')).toBeTruthy();
    expect(screen.queryByTestId('health-track-hero-action')).toBeNull();
  });

  it('keeps the card radius and the palette', () => {
    const card = code(CARD);
    expect(card).toContain('borderRadius: dp(moduleLayout.cardRadius)');
    expect(card).toContain('backgroundColor: module.theme.gradientStart');
  });
});
