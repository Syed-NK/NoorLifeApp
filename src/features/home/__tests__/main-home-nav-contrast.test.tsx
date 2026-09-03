import { cleanup, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AuthProvider } from '@application/providers/auth-provider';
import { DesignSystemProvider } from '@application/providers/design-system-provider';
import { FontProvider } from '@application/providers/font-provider';
import { LocalizationProvider } from '@application/providers/localization-provider';
import { moduleThemes } from '@ds/modules/module-themes';
import { navigationColors, neutralColors, semanticColors } from '@ds/tokens';
import { AA_TEXT, AA_UI, contrastRatio } from '@features/modules/contrast';
import { PLAN_CAPABILITIES, type Entitlement } from '@features/subscription/domain/entitlement';
import { EntitlementProvider } from '@features/subscription/services/entitlement-context';
import { MockPurchaseAdapter } from '@features/subscription/services/mock-purchase-adapter';
import { UpgradeSheetProvider } from '@features/subscription/services/upgrade-sheet-context';

import { HomeBottomNavigation } from '../components/home-bottom-navigation';
import { MainHomeMetricsProvider } from '../main-home-metrics-context';

/**
 * **Main Home's inactive navigation label clears AA on the bar it sits on** — issue #171.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── The defect ─────────────────────────────────────────────────────────────
 * `navigationColors.inactive` was `#7A8496`, the literal §3.2 and Main Home implementation-lock §13
 * both prescribed. On `neutralColors.surface` `#FFFFFF` — the bar this component paints — that
 * measures **3.7713:1** against AA's 4.5 for normal text, a shortfall of 0.73.
 *
 * It was found by #88, which raised the *module* bars' own token and deliberately did not touch this
 * one: the value was a specification literal on a locked screen, so it needed the specification
 * amended rather than the token quietly edited. #171 is that decision. `#667085` is
 * `neutralColors.textSecondary`, already in §2.2 and already used on this very screen for the
 * greeting and the timeline's time column, so nothing new entered the palette.
 *
 *     on neutralColors.surface #FFFFFF     3.7713  ->  4.9748
 *
 * ── Enabled and unselected, not disabled ───────────────────────────────────
 * An inactive tab navigates when tapped, so the full 4.5 applies. A *locked* tab is not a disabled
 * control either: it renders in exactly this tint and raises the upgrade sheet, with the padlock as
 * the whole signal — the component's own note records that dimming its icon was tried and measured
 * at 1.79:1 before being reverted. Both are asserted below, so no future edit can dim one and claim
 * the disabled exemption.
 *
 * ── Why this file renders instead of reading tokens ────────────────────────
 * Contrast is a property of a pair and a token file states neither half. `tokens.test.ts` owns the
 * §3.2 literal and the floor; what it cannot see is whether this component still *reads* the token,
 * or what ground it puts the label on. So every ratio here comes from colours read back off the
 * rendered tree: the tint the label and the icon were handed, and the `backgroundColor` the bar
 * actually declares.
 *
 * ── The relationship ───────────────────────────────────────────────────────
 * Unlike the module bars, this bar draws no marker under the active tab — selection is the hue step
 * to `semanticColors.primary` `#3157C8` plus `accessibilityState.selected`. So the *direction* of the
 * pair matters here, and it is preserved: `#3157C8` measures 6.3103 and stays the darker of the two.
 * The separation between the states narrows from 1.6733:1 to 1.2685:1, both far below the 3:1 at
 * which a lightness difference becomes legible on its own, so nothing that was carrying the state
 * has been given up. That Main Home has no non-colour selected cue at all is a pre-existing
 * observation about locked geometry, recorded in the last case rather than changed here.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const BAR = 'nav-bar';

function flatten(style: unknown): Record<string, unknown> {
  return (StyleSheet.flatten(style as never) ?? {}) as Record<string, unknown>;
}

/**
 * The colour a node was handed, wherever the renderer put it.
 *
 * The icon font takes a `color` prop; `HomeText` composes one into its style. Reading both keeps the
 * assertion about the value that reached the element rather than about which shape it arrived in.
 */
function renderedColor(node: { readonly props: Record<string, unknown> }): string {
  const direct = node.props.color;
  if (typeof direct === 'string') {
    return direct;
  }
  const styled = flatten(node.props.style).color;
  if (typeof styled !== 'string') {
    throw new Error(`no colour on node: ${JSON.stringify(Object.keys(node.props))}`);
  }
  return styled;
}

/** The ground the bar paints. Nothing else in this bar declares one — the last case proves it. */
function barGround(): string {
  const declared = flatten(screen.getByTestId(BAR).props.style).backgroundColor;
  if (typeof declared !== 'string') {
    throw new Error('the bar declares no background');
  }
  return declared;
}

/**
 * A decorative icon, hidden from assistive technology on purpose.
 *
 * `AppIcon` sets `accessibilityElementsHidden` when given no label — right for a glyph whose tab
 * already announces itself — and RNTL's default queries skip hidden elements. It is asked for
 * explicitly rather than made accessible to suit a test.
 */
function iconNode(key: string) {
  return screen.getByTestId(`nav-${key}-icon`, { includeHiddenElements: true });
}

function entitlement(plan: Entitlement['plan']): Entitlement {
  return {
    plan,
    billingPeriod: plan === 'free' ? 'none' : 'yearly',
    status: plan === 'free' ? 'free' : 'active',
    provider: 'development_mock',
    currentPeriodEnd: plan === 'free' ? null : '2027-03-01T00:00:00.000Z',
    trialEnd: null,
    cancelAtPeriodEnd: false,
    isFamilyOrganizer: false,
    capabilities: PLAN_CAPABILITIES[plan],
  };
}

/** The four side tabs, in order. The centre control is a raised button with no label of its own. */
const SIDE_TABS = moduleThemes.main.navigation.filter((_item, index) => index !== 2);

async function renderBar(activeKey: string, plan: Entitlement['plan'] = 'free') {
  await render(
    <SafeAreaProvider>
      <DesignSystemProvider>
        <LocalizationProvider>
          <FontProvider>
            <AuthProvider>
              <EntitlementProvider
                adapter={new MockPurchaseAdapter({ initialEntitlement: entitlement(plan) })}
              >
                <MainHomeMetricsProvider>
                  <UpgradeSheetProvider>
                    <HomeBottomNavigation
                      theme={moduleThemes.main}
                      activeKey={activeKey}
                      onNavigate={() => undefined}
                      testID="nav"
                    />
                  </UpgradeSheetProvider>
                </MainHomeMetricsProvider>
              </EntitlementProvider>
            </AuthProvider>
          </FontProvider>
        </LocalizationProvider>
      </DesignSystemProvider>
    </SafeAreaProvider>,
  );
}

afterEach(async () => {
  await cleanup();
});

describe('the inactive label and icon, measured on the ground the bar paints', () => {
  it('puts every inactive tab on the bar white, and clears AA there', async () => {
    await renderBar('home');
    const ground = barGround();
    expect(ground).toBe(neutralColors.surface);

    const inactive = SIDE_TABS.filter((item) => item.key !== 'home');
    /* Nothing is proved by an empty loop. */
    expect(inactive.length).toBeGreaterThan(0);

    for (const item of inactive) {
      const label = renderedColor(screen.getByText(item.label));
      const icon = renderedColor(iconNode(item.key));

      /*
        The assertion #171 turns on, on the unrounded ratio: 3.7713 does not become 4.5 by display
        rounding, and neither may anything after it.
      */
      expect(`${item.key} label ${label} ${contrastRatio(label, ground) >= AA_TEXT}`).toBe(
        `${item.key} label ${label} true`,
      );
      /* The icon duplicates the label, so it answers to the non-text bar it must also clear. */
      expect(contrastRatio(icon, ground)).toBeGreaterThanOrEqual(AA_UI);
      /* Both halves of a slot are one state and may not drift apart. */
      expect(icon).toBe(label);
    }
  });

  it('renders the palette token rather than a colour of its own', async () => {
    await renderBar('home');
    /*
      The link between this file and the token. Without it the suite could keep passing while the
      component hard-coded some other readable grey and #171's token sat unused.
    */
    expect(renderedColor(screen.getByText('Modules'))).toBe(navigationColors.inactive);
    expect(navigationColors.inactive).toBe(neutralColors.textSecondary);
  });

  it('fails if the old below-AA literal comes back', async () => {
    await renderBar('home');
    /*
      The regression stated as the defect rather than as a threshold. `#7A8496` looks readable and is
      0.73 short; an edit reaching for it again has to fail somewhere that says why.
    */
    expect(contrastRatio('#7A8496', barGround())).toBeLessThan(AA_TEXT);
    expect(navigationColors.inactive).not.toBe('#7A8496');
  });

  it('is normal-sized text at every scale, so the 3:1 large-text allowance never applies', async () => {
    await renderBar('home');
    /*
      Foreclosing the wrong exemption rather than trusting nobody to reach for it. Main Home honours
      the OS font scale with no clamp — deliberately, since #141 — so unlike the module bars there is
      no `maxFontSizeMultiplier` to read. The bound is the ramp plus Android's own ceiling: `navLabel`
      is 9.5 dp, and 9.5 × 2.0 = 19 dp against the 24 px non-bold large-text threshold. The face is
      Poppins Medium, so the 18.66 px bold threshold is not the applicable one either.
    */
    const style = flatten(screen.getByText('Modules').props.style);
    const size = Number(style.fontSize);

    expect(size).toBeGreaterThan(0);
    expect(size * 2).toBeLessThan(24);
    expect(String(style.fontFamily)).not.toMatch(/bold/i);
  });
});

describe('the locked tab is not a disabled control', () => {
  it('renders in the same tint as an available tab, and clears the same bar', async () => {
    await renderBar('home', 'free');
    const ground = barGround();

    /*
      `Insights` maps to the premium Goals module, so on the free plan it is locked. The component's
      note records that dimming its icon was tried and measured 1.79:1 before being reverted, and
      that the label was never dimmed. So it owes the full 4.5 like any other enabled tab — a
      padlock is an additional signal, not a licence to reduce contrast.
    */
    expect(screen.getByTestId('nav-insights-lock')).toBeTruthy();

    const locked = renderedColor(screen.getByText('Insights'));
    const available = renderedColor(screen.getByText('Modules'));

    expect(locked).toBe(available);
    expect(contrastRatio(locked, ground)).toBeGreaterThanOrEqual(AA_TEXT);
    /* No opacity anywhere in the slot, which is the other way a tint gets quietly washed out. */
    const slotStyle = flatten(screen.getByTestId('nav-insights').props.style);
    expect(slotStyle.opacity ?? 1).toBe(1);
  });

  it('announces the restriction without dimming it, and still says it is a tab', async () => {
    await renderBar('home', 'free');
    const node = screen.getByTestId('nav-insights');

    expect(node.props.accessibilityRole).toBe('tab');
    expect(String(node.props.accessibilityLabel)).toContain('Premium');
    expect(node.props.accessibilityState).toEqual(expect.objectContaining({ selected: false }));
  });
});

describe('selected and inactive stay distinguishable', () => {
  it.each(SIDE_TABS.map((item) => [item.key] as const))(
    'gives %s the active tint when it is the active key, and the neutral otherwise',
    async (key) => {
      await renderBar(key);
      const ground = barGround();
      const item = SIDE_TABS.find((candidate) => candidate.key === key);
      if (item === undefined) {
        throw new Error(`no tab ${key}`);
      }

      const selected = renderedColor(screen.getByText(item.label));
      expect(selected).toBe(semanticColors.primary);
      expect(`${key} selected ${contrastRatio(selected, ground) >= AA_TEXT}`).toBe(
        `${key} selected true`,
      );

      /* The hue step: the two states are never the same colour. */
      const other = SIDE_TABS.find((candidate) => candidate.key !== key);
      if (other === undefined) {
        throw new Error('no second tab');
      }
      const inactive = renderedColor(screen.getByText(other.label));
      expect(inactive).toBe(navigationColors.inactive);
      expect(inactive).not.toBe(selected);

      /* And the active one stays the darker of the pair, which is the direction #171 preserved. */
      expect(contrastRatio(selected, ground)).toBeGreaterThan(contrastRatio(inactive, ground));
    },
  );

  it('announces exactly one selected tab, which is how the state survives the colour', async () => {
    await renderBar('modules');
    for (const item of SIDE_TABS) {
      const state = screen.getByTestId(`nav-${item.key}`).props.accessibilityState;
      expect(`${item.key} selected=${Boolean(state?.selected)}`).toBe(
        `${item.key} selected=${item.key === 'modules'}`,
      );
    }
  });

  it('paints no ground of its own on any slot, so the bar is the only background there is', async () => {
    await renderBar('modules');
    /*
      What makes `barGround()` the real pairing rather than a convenience. If a selected slot ever
      gained a tint — as the module bars did in #91 — the inactive label's ground would stop being
      the bar's white for the slots beside it, and every ratio above would need re-measuring against
      that instead. This fails when that day comes, which is the point.
    */
    for (const item of SIDE_TABS) {
      const style = flatten(screen.getByTestId(`nav-${item.key}`).props.style);
      expect(`${item.key} ground ${style.backgroundColor ?? 'none'}`).toBe(
        `${item.key} ground none`,
      );
    }
  });

  it('records that this bar has no non-colour selected cue, which #171 did not change', () => {
    /*
      An observation, deliberately not a fix. The module bars carry a 2.5 dp marker above the
      selected slot so the state is never colour-only; Main Home's locked geometry has no such
      element, and adding one would be a redesign rather than the colour correction #171 authorised.
      Kept executable so it is re-read the next time this bar is opened: `accessibilityState.selected`
      is currently the whole non-colour signal, and the hue step is the whole visual one.
    */
    const separation = contrastRatio(semanticColors.primary, navigationColors.inactive);
    expect(separation).toBeLessThan(AA_UI);
    expect(separation).toBeGreaterThan(1);
  });
});
