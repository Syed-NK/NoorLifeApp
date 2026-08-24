import { render, screen, waitFor } from '@testing-library/react-native';

import { installMockLatencyTimers } from '@/test-support/mock-latency-timers';
import { pinModuleWindow } from '@/test-support/module-window';

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
 * the app reaches it — and Planner is the module whose headline decides its presentation, so testing
 * it through the wrong entry point would test the wrong tree.
 *
 * ── Every case names its device ─────────────────────────────────────────────
 * React Native's Jest mock reports a 750 dp window at font scale 2. That is not a phone, and at that
 * text size the rule constrains every hero — so a suite that did not pin the window would assert
 * "the ordinary hero keeps its artwork" in the one configuration where it must not. Each block below
 * pins the configuration its claim is about: an ordinary phone for the ordinary presentation, and a
 * large-text phone for the pill that overflows there.
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

describe('Planner keeps its artwork on an ordinary phone', () => {
  /*
    ── What #50's final refinement changed here ──────────────────────────────
    This block used to assert the opposite: that Planner's hero dropped its artwork and stretched its
    copy. That was true, and it was the wrong outcome — "manageable" is wider than a 52% column, so
    the one module with a long word in its headline lost its locked artwork on every device at the
    default text size.

    The shared column is now `heroCopyColumnRatio`, wide enough to hold that word with the measured
    rendering margin, so an ordinary phone gets the ordinary hero: artwork present, copy in its
    column, every approved string complete. The constrained presentation is still there for the cells
    where the copy genuinely does not fit, asserted in the block below.
  */
  beforeEach(() => {
    pinModuleWindow();
  });

  it('renders Planner’s eyebrow, headline, support and call to action', async () => {
    const planner = SHARED.find((module) => module.id === 'planner');
    expect(planner).toBeDefined();

    await renderPlannerHero();
    await waitFor(() => expect(screen.getByTestId('planner-hero')).toBeTruthy());

    expect(screen.getByText('Make today manageable')).toBeTruthy();
    expect(screen.getByText(planner!.hero.eyebrow)).toBeTruthy();
    expect(screen.getByText(planner!.hero.support!)).toBeTruthy();
    expect(screen.getByLabelText(planner!.hero.actionLabel)).toBeTruthy();
  });

  it('keeps its decorative artwork', async () => {
    // The requirement this refinement exists for.
    await renderPlannerHero();
    await waitFor(() => expect(screen.getByTestId('planner-hero')).toBeTruthy());
    expect(screen.getByTestId('planner-hero-artwork')).toBeTruthy();
  });

  it('still lets the card grow rather than clipping', async () => {
    const view = await renderPlannerHero();
    await waitFor(() => expect(view.getByTestId('planner-hero')).toBeTruthy());

    const hero = view.getByTestId('planner-hero');
    const flattened = (styles: unknown): Record<string, unknown> =>
      (Array.isArray(styles) ? styles : [styles])
        .filter(
          (entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null,
        )
        .reduce<Record<string, unknown>>((all, entry) => ({ ...all, ...entry }), {});

    // A floor, not a fixed box — unchanged by the refinement.
    const card = flattened(hero.props.style);
    expect(card.height).toBeUndefined();
    expect(typeof card.minHeight).toBe('number');
  });
});

describe('Planner is still constrained where its headline genuinely will not fit', () => {
  /*
    The other side of the refinement. At a large OS text size the headline outgrows even the wider
    column, so the copy takes the whole card and the artwork steps aside — and every approved string
    is still there, which is the property the constrained presentation must not buy its readability
    with.
  */
  beforeEach(() => {
    pinModuleWindow({ fontScale: 1.5 });
  });

  it('drops its artwork and keeps every approved string', async () => {
    const planner = SHARED.find((module) => module.id === 'planner');
    expect(planner).toBeDefined();

    await renderPlannerHero();
    await waitFor(() => expect(screen.getByTestId('planner-hero')).toBeTruthy());

    expect(screen.queryByTestId('planner-hero-artwork')).toBeNull();
    expect(screen.getByText('Make today manageable')).toBeTruthy();
    expect(screen.getByText(planner!.hero.eyebrow)).toBeTruthy();
    expect(screen.getByText(planner!.hero.support!)).toBeTruthy();
    expect(screen.getByLabelText(planner!.hero.actionLabel)).toBeTruthy();
  });
});

describe('the ordinary heroes are untouched', () => {
  const ORDINARY = SHARED.filter((module) => module.id !== 'planner');

  beforeEach(() => {
    pinModuleWindow();
  });

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

describe('a pill too wide for the column constrains the hero too', () => {
  /*
    The half of the rule the previous commit missed, in a rendered tree. At a large OS text size the
    action label plus its padding, gap and chevron is wider than the 52% column for the three long
    labels — so those heroes take the whole card and drop their artwork, while Family, whose label is
    short, keeps both. Same configuration for all four, so the difference is the copy and nothing else.
  */
  const LONG_LABEL = ['finance', 'learning', 'goals'] as const;

  beforeEach(() => {
    // A phone at the top of Android's text-size range, where the long pills no longer fit a column.
    pinModuleWindow({ fontScale: 1.5 });
  });

  it.each(LONG_LABEL)('%s drops its artwork and keeps its whole label', async (id) => {
    const definition = SHARED.find((module) => module.id === id);
    expect(definition).toBeDefined();

    await render(<ModuleHomeScreen moduleId={id} />);
    await waitFor(() => expect(screen.getByTestId(`${id}-hero`)).toBeTruthy());

    expect(screen.queryByTestId(`${id}-hero-artwork`)).toBeNull();
    expect(screen.getByText(definition!.hero.headline)).toBeTruthy();
    expect(screen.getByText(definition!.hero.eyebrow)).toBeTruthy();
    expect(screen.getByText(definition!.hero.support!)).toBeTruthy();
    expect(screen.getByLabelText(definition!.hero.actionLabel)).toBeTruthy();
    // Still one line: the fix is a column the label fits in, not a two-line button.
    expect(screen.getByText(definition!.hero.actionLabel).props.numberOfLines).toBe(1);
  });

  it('leaves Family alone at the same text size', async () => {
    // "Invite family" clears the column by 17% even at 1.5, so nothing about Family changes.
    const family = SHARED.find((module) => module.id === 'family');
    await render(<ModuleHomeScreen moduleId="family" />);
    await waitFor(() => expect(screen.getByTestId('family-hero')).toBeTruthy());

    expect(screen.getByTestId('family-hero-artwork')).toBeTruthy();
    expect(screen.getByLabelText(family!.hero.actionLabel)).toBeTruthy();
  });
});
