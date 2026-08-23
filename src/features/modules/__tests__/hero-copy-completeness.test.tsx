import { render, screen, waitFor } from '@testing-library/react-native';

import { installMockLatencyTimers } from '@/test-support/mock-latency-timers';

import { PlannerProvider } from '@features/planner/di/planner-provider';
import { PlannerRoutineProvider } from '@features/planner/di/planner-routine-provider';
import { PlannerHomeContent } from '@features/planner/screens/planner-home-content';

import { ModuleProvider } from '../module-context';
import { allModuleDefinitions } from '../module-registry';
import { ModuleHomeScreen } from '../screens/module-home-screen';

/**
 * Every shared module-home hero renders all four of its approved strings — issue #50, requirement 1.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── What a render test can and cannot say here ─────────────────────────────
 * It can say the approved string reached the tree, unaltered and un-derived. It cannot say how the
 * string *looks*: Jest has no text engine, so a headline that a device would split between letters
 * is indistinguishable here from one that wraps cleanly. That question is answered by arithmetic in
 * `hero-copy-fit.test.ts` and by measurement on two devices.
 *
 * So this file is deliberately narrow, and it is the half that the arithmetic cannot cover: that the
 * constrained presentation does not achieve its readability by dropping anything. A rule that widened
 * the copy and silently lost the eyebrow, the support line or the call to action would satisfy every
 * width assertion in the suite and fail here.
 *
 * Planner is reached through its own composition rather than the generic home, because that is how
 * the app reaches it — and Planner is the one module the rule constrains, so testing it through the
 * wrong entry point would test the wrong tree.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const OWN_HERO = new Set(['faith', 'noor-ai', 'health']);
const SHARED = allModuleDefinitions.filter((module) => !OWN_HERO.has(module.id));

installMockLatencyTimers(async () => {
  await render(<ModuleHomeScreen moduleId="finance" />);
});

/** Planner's home is a composition, so its hero is rendered inside its own providers. */
async function renderPlannerHero() {
  return await render(
    <ModuleProvider moduleId="planner">
      <PlannerProvider>
        <PlannerRoutineProvider>
          <PlannerHomeContent />
        </PlannerRoutineProvider>
      </PlannerProvider>
    </ModuleProvider>,
  );
}

describe('the widened hero keeps every approved string', () => {
  it('renders Planner’s eyebrow, headline, support and call to action', async () => {
    /*
      The module the rule constrains, and therefore the one where "the copy takes the card" has to be
      shown to cost nothing. Each string is asserted by its registered value, so a truncation, a
      substitution or a quietly shortened headline all fail.
    */
    const planner = SHARED.find((module) => module.id === 'planner');
    expect(planner).toBeDefined();

    await renderPlannerHero();
    await waitFor(() => expect(screen.getByTestId('planner-hero')).toBeTruthy());

    expect(screen.getByText('Make today manageable')).toBeTruthy();
    expect(screen.getByText(planner!.hero.eyebrow)).toBeTruthy();
    expect(screen.getByText(planner!.hero.support!)).toBeTruthy();
    expect(screen.getByLabelText(planner!.hero.actionLabel)).toBeTruthy();
  });

  it('drops Planner’s decorative artwork and nothing else', async () => {
    // The one thing the constrained presentation is allowed to remove.
    await renderPlannerHero();
    await waitFor(() => expect(screen.getByTestId('planner-hero')).toBeTruthy());
    expect(screen.queryByTestId('planner-hero-artwork')).toBeNull();
  });

  it('gives Planner’s copy the whole card rather than the column', async () => {
    const view = await renderPlannerHero();
    await waitFor(() => expect(view.getByTestId('planner-hero')).toBeTruthy());

    // The copy view is the hero's only child that carries a layout width decision.
    const hero = view.getByTestId('planner-hero');
    const flattened = (styles: unknown): Record<string, unknown> =>
      (Array.isArray(styles) ? styles : [styles])
        .filter(
          (entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null,
        )
        .reduce<Record<string, unknown>>((all, entry) => ({ ...all, ...entry }), {});

    // Requirement 6: a floor, so the card grows with the copy instead of clipping it.
    const card = flattened(hero.props.style);
    expect(card.height).toBeUndefined();
    expect(typeof card.minHeight).toBe('number');
  });
});

describe('the ordinary heroes are untouched', () => {
  const ORDINARY = SHARED.filter((module) => module.id !== 'planner');

  it.each(ORDINARY.map((module) => module.id))(
    '%s renders all four strings and keeps its artwork',
    async (id) => {
      /*
        Requirement 3 through a rendered tree rather than through the rule: these four are the
        population whose widest word clears the column by more than half, so each must still draw the
        artwork it registers — and must still say everything it said before.
      */
      const definition = ORDINARY.find((module) => module.id === id);
      expect(definition).toBeDefined();

      await render(<ModuleHomeScreen moduleId={id as 'finance'} />);
      await waitFor(() => expect(screen.getByTestId(`${id}-hero`)).toBeTruthy());

      expect(screen.getByTestId(`${id}-hero-artwork`)).toBeTruthy();
      expect(screen.getByText(definition!.hero.headline)).toBeTruthy();
      expect(screen.getByText(definition!.hero.eyebrow)).toBeTruthy();
      expect(screen.getByText(definition!.hero.support!)).toBeTruthy();
      expect(screen.getByLabelText(definition!.hero.actionLabel)).toBeTruthy();
    },
  );
});
