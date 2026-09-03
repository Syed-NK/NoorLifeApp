import { cleanup, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { pinModuleWindow } from '@/test-support/module-window';

import { ModuleBottomNavigation } from '../components/module-bottom-navigation';
import { contrastRatio } from '../contrast';
import { ModuleProvider } from '../module-context';
import { moduleRegistry } from '../module-registry';
import { moduleSurfaces } from '../module-surfaces';
import { FRAMEWORK_MODULE_IDS, moduleColorThemes, moduleNeutrals } from '../module-tokens';
import { navigationColors, neutralColors } from '@ds/tokens';

/**
 * **The inactive navigation label clears AA on the bar it actually sits on** — issue #88.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── The defect ─────────────────────────────────────────────────────────────
 * `moduleNeutrals.navInactive` was `#6B7896`. On `navBackground` `#FFFFFF` — the bar it renders on,
 * on all eight module themes — that measures **4.4191:1** against AA's 4.5 for normal text. #86
 * measured it while asserting that a selected slot reads as selection rather than as hue, and
 * pinned it rather than moving it, because #86 preserved every rendered colour.
 *
 * The label is enabled, unselected navigation. It is not a disabled control, so the 4.5 bar applies
 * to it in full; there is no non-text exemption to claim for a word.
 *
 * ── Why the fix is one hex and not a new colour ────────────────────────────
 * `#5A6B8C` is `moduleNeutrals.textSecondary`, already in the palette: inactive navigation *is*
 * secondary text on a light ground. It measures 5.3619:1 on the bar and 4.8583:1 on the worst of
 * the eight `navSelectedSurface` grounds #91 will paint.
 *
 * ── Why this file renders instead of reading tokens ────────────────────────
 * Contrast is a property of a *pair*, and a token file states neither half. A test that asserts
 * `contrastRatio(navInactive, navBackground)` passes just as happily if the component stops reading
 * `navInactive`, or starts painting the inactive slot on some other ground — the number would still
 * be about two constants that nothing renders together. So every ratio below is computed from
 * colours read back off the rendered tree: the tint the label and icon were handed, and the
 * `backgroundColor` the slot underneath them actually declares.
 *
 * ── The relationship, which lightness never carried ────────────────────────
 * #88 names the real risk: darken the inactive label too far and the selected one stops reading as
 * selected. Measured, that distinction was never lightness's job. Against the eight module inks the
 * old value separated by 1.0998–1.2780:1 and the new one by 1.0480–1.1032:1 — both far below the
 * 3:1 at which a lightness difference becomes legible, so on the Health bar the old separation was
 * already 1.0998. Selection is carried instead by the marker above the slot, the hue shift, the
 * tinted ground on an opted-in module, and `accessibilityState.selected`. Those are what the last
 * describe block measures, and they are unchanged by this token.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const AA_TEXT = 4.5;
const AA_NON_TEXT = 3;

const MODULE_IDS = FRAMEWORK_MODULE_IDS;

function flatten(style: unknown): Record<string, unknown> {
  return (StyleSheet.flatten(style as never) ?? {}) as Record<string, unknown>;
}

/**
 * The colour a node was handed, wherever the renderer put it.
 *
 * The icon font takes a `color` prop; `ModuleText` composes one into its style. Reading both means
 * the assertion is about the value that reached the element, not about which of two shapes the
 * element happens to use this month.
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

/**
 * The ground under a slot.
 *
 * Only the selected slot paints one; an unselected slot declares no `backgroundColor` and so sits
 * on the bar. Falling back to the bar's own colour is therefore the render, not a convenience.
 */
function groundUnder(moduleId: string, itemKey: string): string {
  const declared = flatten(
    screen.getByTestId(`${moduleId}-nav-${itemKey}-slot`).props.style,
  ).backgroundColor;
  return typeof declared === 'string' ? declared : barColor(moduleId);
}

/**
 * A decorative icon, which is deliberately hidden from assistive technology.
 *
 * `AppIcon` sets `accessibilityElementsHidden` and `importantForAccessibility: 'no'` when no label
 * is passed — right for a glyph whose tab already announces itself — and RNTL's default queries skip
 * hidden elements. The icon is still painted, and its tint is still the thing under test, so it is
 * asked for explicitly rather than made accessible to suit a test.
 */
function iconNode(moduleId: string, itemKey: string) {
  return screen.getByTestId(`${moduleId}-nav-${itemKey}-icon`, { includeHiddenElements: true });
}

function barColor(moduleId: string): string {
  return flatten(screen.getByTestId(`${moduleId}-nav-bar`).props.style).backgroundColor as string;
}

/** Every tab except the raised centre control, which has no inactive tint of its own. */
function tabsOf(moduleId: (typeof MODULE_IDS)[number]) {
  const nav = moduleRegistry[moduleId].navigation;
  return nav.filter((item) => screen.queryByTestId(`${moduleId}-nav-${item.key}-slot`) !== null);
}

async function renderBar(moduleId: (typeof MODULE_IDS)[number], activeKey: string) {
  await render(
    <ModuleProvider moduleId={moduleId}>
      <ModuleBottomNavigation activeKey={activeKey} onNavigate={() => undefined} />
    </ModuleProvider>,
  );
}

/** The first non-centre tab, used as "something else is selected". */
function firstTab(moduleId: (typeof MODULE_IDS)[number]) {
  const first = moduleRegistry[moduleId].navigation[0];
  if (first === undefined) {
    throw new Error(`${moduleId} has no navigation`);
  }
  return first;
}

function firstTabKey(moduleId: (typeof MODULE_IDS)[number]): string {
  return firstTab(moduleId).key;
}

/** The first tab that is not the selected one, so a case cannot silently measure nothing. */
function anInactiveTab(moduleId: (typeof MODULE_IDS)[number], active: string) {
  const other = tabsOf(moduleId).filter((item) => item.key !== active)[0];
  if (other === undefined) {
    throw new Error(`${moduleId} has no inactive tab beside ${active}`);
  }
  return other;
}

beforeAll(() => {
  pinModuleWindow({ width: 393 });
});

afterEach(async () => {
  await cleanup();
});

describe('the inactive label and icon, measured on their rendered ground', () => {
  it.each(MODULE_IDS.map((id) => [id] as const))(
    'clears AA for text and 3:1 for the icon on the %s bar',
    async (moduleId) => {
      await renderBar(moduleId, firstTabKey(moduleId));

      const inactive = tabsOf(moduleId).filter((item) => item.key !== firstTabKey(moduleId));
      /* Nothing is proved by an empty loop, so the bar has to have inactive tabs to measure. */
      expect(inactive.length).toBeGreaterThan(0);

      for (const item of inactive) {
        const ground = groundUnder(moduleId, item.key);
        const label = renderedColor(screen.getByText(item.label));
        const icon = renderedColor(iconNode(moduleId, item.key));

        /* An unselected slot paints nothing, so both sit on the bar's own white. */
        expect(ground).toBe(moduleNeutrals.navBackground);

        /*
          The label is the assertion #88 turns on. `toBeGreaterThanOrEqual` on the unrounded ratio:
          4.4191 does not become 4.5 by display rounding, and neither may anything after it.
        */
        expect(
          `${moduleId}/${item.key} label ${label} ${contrastRatio(label, ground) >= AA_TEXT}`,
        ).toBe(`${moduleId}/${item.key} label ${label} true`);
        /* The icon duplicates the label, so it is held to the non-text bar it must also clear. */
        expect(contrastRatio(icon, ground)).toBeGreaterThanOrEqual(AA_NON_TEXT);
        /* Both halves of a slot are one state, so they may not drift apart. */
        expect(icon).toBe(label);
      }
    },
  );

  it('renders the palette token rather than a colour of its own', async () => {
    await renderBar('faith', firstTabKey('faith'));
    const other = anInactiveTab('faith', firstTabKey('faith'));

    /*
      The link between this file and the token. Without it the suite could keep passing while the
      component hard-coded some other readable grey, and #88's token would sit unused.
    */
    expect(renderedColor(screen.getByText(other.label))).toBe(moduleNeutrals.navInactive);
    expect(moduleNeutrals.navInactive).toBe(moduleNeutrals.textSecondary);
  });

  it('is normal-sized text, so the 3:1 large-text allowance is not available to it', async () => {
    /*
      Foreclosing the wrong exemption rather than relying on nobody reaching for it. WCAG drops the
      bar to 3:1 for large text — 24 px, or 18.66 px bold — and a nav label at font scale 1.5 is the
      obvious place to argue it qualifies. It does not: `navLabel` renders around 13 dp and
      `maxFontSizeMultiplier` caps growth at 1.2, so the largest it can ever be is well under the
      smaller of the two thresholds. Nor is it a disabled control, which is the other exemption #88
      warns against claiming: it is an enabled tab that navigates.
    */
    const active = firstTabKey('planner');
    await renderBar('planner', active);
    const node = screen.getByText(anInactiveTab('planner', active).label);
    const size = Number(flatten(node.props.style).fontSize);
    const cap = Number(node.props.maxFontSizeMultiplier);

    expect(size).toBeGreaterThan(0);
    expect(cap).toBeGreaterThan(0);
    /* 18.66 px is the bold large-text threshold, the stricter of the two. */
    expect(size * cap).toBeLessThan(18.66);
  });

  it('fails if the old below-AA value comes back', () => {
    /*
      The regression stated as the defect rather than as a threshold. `#6B7896` is readable-looking
      and 0.08 short; a future edit reaching for it — or for anything else under the bar — has to
      fail somewhere that says why.
    */
    expect(contrastRatio('#6B7896', moduleNeutrals.navBackground)).toBeLessThan(AA_TEXT);
    expect(moduleNeutrals.navInactive).not.toBe('#6B7896');
    expect(
      contrastRatio(moduleNeutrals.navInactive, moduleNeutrals.navBackground),
    ).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it('holds up on the selected grounds #91 will paint, not only on the bar', async () => {
    /*
      #88 requires the new value to survive `navSelectedSurface` as well as the bar. No inactive
      label renders on one today — only the selected slot paints a ground, and it uses `theme.ink` —
      so this is headroom for the opt-in rather than a pairing the tree can show. Asserted from the
      surface roles for exactly that reason, and kept separate from the rendered cases above.
    */
    for (const moduleId of MODULE_IDS) {
      const surface = moduleColorThemes[moduleId].navSelectedSurface;
      expect(`${moduleId} ${contrastRatio(moduleNeutrals.navInactive, surface) >= AA_TEXT}`).toBe(
        `${moduleId} true`,
      );
    }
  });
});

describe('the selected state, on both grounds it can have', () => {
  it.each(MODULE_IDS.map((id) => [id] as const))(
    'clears AA for its label and 3:1 for its marker on %s',
    async (moduleId) => {
      const active = firstTabKey(moduleId);
      await renderBar(moduleId, active);

      const ground = groundUnder(moduleId, active);
      const label = renderedColor(screen.getByText(firstTab(moduleId).label));
      const marker = flatten(screen.getByTestId(`${moduleId}-nav-${active}-marker`).props.style)
        .backgroundColor as string;

      /* Whatever ground the module opted into, the selected slot is what declares it. */
      expect(ground).toBe(moduleSurfaces(moduleId).navSelected);
      expect(label).toBe(moduleColorThemes[moduleId].ink);

      expect(`${moduleId} selected ${contrastRatio(label, ground) >= AA_TEXT}`).toBe(
        `${moduleId} selected true`,
      );
      /* The marker is a 2.5 dp shape carrying state, so 3:1 non-text is its bar. */
      expect(`${moduleId} marker ${contrastRatio(marker, ground) >= AA_NON_TEXT}`).toBe(
        `${moduleId} marker true`,
      );
      expect(marker).toBe(moduleColorThemes[moduleId].ink);
    },
  );

  it('measures the ink on the bar as well, for the seven that have not opted in', () => {
    /*
      Both grounds, as #88 asks: an opted-in module's selected label sits on its tint, and the rest
      sit on the bar. Read from the tokens because the second ground is the one the tree above
      already shows — this covers the pairing a future opt-in would move away from.
    */
    for (const moduleId of MODULE_IDS) {
      const ink = moduleColorThemes[moduleId].ink;
      expect(
        `${moduleId} onBar ${contrastRatio(ink, moduleNeutrals.navBackground) >= AA_TEXT}`,
      ).toBe(`${moduleId} onBar true`);
    }
  });
});

describe('selected and inactive stay distinguishable from each other', () => {
  it.each(MODULE_IDS.map((id) => [id] as const))(
    'separates the two states by a marker and a hue, not by lightness, on %s',
    async (moduleId) => {
      const active = firstTabKey(moduleId);
      await renderBar(moduleId, active);

      const others = tabsOf(moduleId).filter((item) => item.key !== active);
      const selectedTint = renderedColor(screen.getByText(firstTab(moduleId).label));
      const inactiveTint = renderedColor(screen.getByText(anInactiveTab(moduleId, active).label));

      /* The hue shift: the two states are never the same colour. */
      expect(inactiveTint).not.toBe(selectedTint);

      /*
        The non-colour cue, which is what actually answers "which tab am I on". Exactly one slot
        carries a marker, and it is the selected one — so the state survives a viewer who cannot
        separate two near-equiluminant greys, which at 1.05–1.10:1 is everyone.
      */
      expect(screen.queryByTestId(`${moduleId}-nav-${active}-marker`)).not.toBeNull();
      for (const item of others) {
        expect(`${item.key} marker`).toBe(
          screen.queryByTestId(`${moduleId}-nav-${item.key}-marker`) === null
            ? `${item.key} marker`
            : `${item.key} unexpected marker`,
        );
      }

      /* And it is announced, so the state is not carried by pixels alone. */
      expect(screen.getByTestId(`${moduleId}-nav-${active}`).props.accessibilityState).toEqual(
        expect.objectContaining({ selected: true }),
      );
      expect(
        screen.getByTestId(`${moduleId}-nav-${anInactiveTab(moduleId, active).key}`).props
          .accessibilityState,
      ).toEqual(expect.objectContaining({ selected: false }));
    },
  );

  it('records that lightness was never the cue, so raising the inactive value cannot remove one', () => {
    /*
      The measurement behind the paragraph in the token comment, kept executable so the claim cannot
      quietly stop being true. If a future palette move ever lifted a separation over 3:1, lightness
      would start carrying state and this case should be revisited deliberately rather than deleted.
    */
    for (const moduleId of MODULE_IDS) {
      const ink = moduleColorThemes[moduleId].ink;
      const now = contrastRatio(moduleNeutrals.navInactive, ink);
      const before = contrastRatio('#6B7896', ink);
      expect(`${moduleId} before ${before < AA_NON_TEXT}`).toBe(`${moduleId} before true`);
      expect(`${moduleId} now ${now < AA_NON_TEXT}`).toBe(`${moduleId} now true`);
    }
  });
});

describe('the change stops at the module bars', () => {
  it('leaves Main Home on its own token, which #88 misattributes to this one', () => {
    /*
      #88 says `navInactive` renders on "all eight module themes plus Main Home". The first half
      is right; the second is not. Main Home's bar — and the placeholder bar in the design system
      — read `navigationColors.inactive` instead, which #88 measured at `#7A8496` / 3.7713:1 and
      left alone, because it was a §3.2 specification value on locked Main Home and therefore a
      product decision rather than an implementation one.

      That decision was taken in **issue #171**: §3.2 and the Main Home lock were amended and the
      token raised to `#667085` (4.9748:1). So both bars now clear AA, by two separate tokens, and
      this case has stopped recording a shortfall and become what it always meant — the two are
      *different* tokens, and neither fix may quietly reach across into the other.

      The AA floor for Main Home lives with its own contract, in `tokens.test.ts` §3.2 and in
      `main-home-nav-contrast.test.tsx`, which measures it off the rendered bar.
    */
    expect(navigationColors.inactive).not.toBe(moduleNeutrals.navInactive);
    /* Each is its own palette’s secondary text, and the two palettes differ. */
    expect(navigationColors.inactive).toBe(neutralColors.textSecondary);
    expect(moduleNeutrals.navInactive).toBe(moduleNeutrals.textSecondary);
    /* Both above the bar now; neither borrowed the other’s value to get there. */
    expect(contrastRatio(navigationColors.inactive, neutralColors.surface)).toBeGreaterThanOrEqual(
      AA_TEXT,
    );
    expect(
      contrastRatio(moduleNeutrals.navInactive, moduleNeutrals.navBackground),
    ).toBeGreaterThanOrEqual(AA_TEXT);
  });
});
