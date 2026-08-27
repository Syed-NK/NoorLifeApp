import { render, screen, userEvent } from '@testing-library/react-native';

import { pinModuleWindow } from '@/test-support/module-window';

import { ModuleBottomNavigation } from '../components/module-bottom-navigation';
import { ModuleProvider } from '../module-context';
import { FRAMEWORK_MODULE_IDS, moduleLayout, moduleNavigationHeight } from '../module-tokens';
import { moduleRegistry } from '../module-registry';

/**
 * **Every navigation tab is at least 44 × 44 dp** — issue #84.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── What was wrong ─────────────────────────────────────────────────────────
 * The bar is 68 dp, but each tab's pressable shrink-wrapped to its icon plus its label:
 * `alignSelf: 'stretch'` stretched the width and nothing set the height. At font scale 1.0 that
 * left a 38–40 dp target inside a 68 dp bar, so a tap in the top third of a tab hit nothing. On a
 * release build a tap at the bar's own top edge did not navigate; the same column 75 px lower did.
 *
 * The raised centre control failed differently. `marginTop: -navAIRaise` lifts it 15 dp above the
 * bar's top edge, and Android delivers no touch to a child rendered outside its parent's bounds —
 * so a 58 dp button was pressable over about 42 dp of its height.
 *
 * Both are invisible at font scale 1.5, where the larger label pushes the tab past 44 dp on its
 * own. The defect lived in the default configuration, which is why both scales are asserted below.
 *
 * ── What these tests measure ───────────────────────────────────────────────
 * Jest has no layout engine, so nothing here can read a rendered frame. What it can read is the
 * style the renderer was handed, which is where the defect was: a missing height. The assertions
 * are therefore about the *contract* — the pressable fills its slot and carries an unscalable
 * floor — plus the press behaviour that contract exists to guarantee.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const MIN = moduleLayout.minTouchTarget;

/** The reference phone, and a deliberately narrow one where `dp()` scales hardest. */
const WIDTHS = [393, 360] as const;
const SCALES = [1, 1.5] as const;

type StyledNode = {
  readonly props: { readonly style?: unknown };
  readonly parent?: StyledNode | null;
};

function merge(style: unknown): Record<string, number | undefined> {
  const parts = Array.isArray(style) ? style.flat(4) : [style];
  return Object.assign({}, ...parts.filter(Boolean)) as Record<string, number | undefined>;
}

/** The style on a node itself. Enough for a plain `View`. */
function flatStyle(node: StyledNode): Record<string, number | undefined> {
  return merge(node.props.style);
}

/**
 * The nearest style up the tree that actually declares `key`.
 *
 * `PressableScale` hangs the `testID` on an absolute-fill overlay — `{position:'absolute', left:0,
 * right:0, top:0, bottom:0}` — so the node a test can find by id carries none of the geometry; its
 * ancestor does. Walking up is therefore not a convenience, it is the only way to read the box the
 * user presses. Bounded, so a missing value fails the assertion rather than climbing to the root.
 */
function geometry(node: StyledNode, key: string): number | undefined {
  let current: StyledNode | null | undefined = node;
  for (let depth = 0; depth < 6 && current; depth += 1) {
    const style = merge(current.props.style);
    if (style[key] !== undefined) {
      return style[key];
    }
    current = current.parent;
  }
  return undefined;
}

function renderNav(moduleId: (typeof FRAMEWORK_MODULE_IDS)[number] = 'planner') {
  return render(
    <ModuleProvider moduleId={moduleId}>
      <ModuleBottomNavigation activeKey={moduleRegistry[moduleId].navigation[0].key} testID="nav" />
    </ModuleProvider>,
  );
}

describe.each(WIDTHS)('at %i dp wide', (width) => {
  describe.each(SCALES)('at font scale %s', (fontScale) => {
    beforeEach(() => {
      pinModuleWindow({ width, fontScale });
    });

    it('gives every ordinary tab a pressable that fills its slot', async () => {
      await renderNav();

      for (const item of moduleRegistry.planner.navigation) {
        if (item.isAI === true) {
          continue;
        }
        const node = screen.getByTestId(`nav-${item.key}`) as unknown as StyledNode;

        /*
          `flex: 1` is the fix: the pressable *is* the slot, so its height is the bar's, not the
          content's. Asserting the style rather than a measured box is the honest form here — the
          renderer was handed no height at all before.
        */
        expect(geometry(node, 'flex')).toBe(1);
        expect(geometry(node, 'minHeight')).toBeGreaterThanOrEqual(MIN);
      }
    });

    it('floors the tab minimum without letting the module scale shrink it', async () => {
      await renderNav();

      /*
        The floor must not pass through `dp()`. On a narrow device the module scale is below 1, so a
        scaled 44 would land under 44 — on precisely the device where a small target hurts most.
      */
      const node = screen.getByTestId('nav-today') as unknown as StyledNode;
      expect(geometry(node, 'minHeight')).toBe(MIN);
    });

    it('keeps the bar tall enough that a filled slot clears the minimum', async () => {
      await renderNav();

      // The slot inherits the bar's height, so the bar itself has to clear the minimum for
      // `flex: 1` to be sufficient rather than merely necessary.
      const bar = flatStyle(screen.getByTestId('nav-bar'));
      expect(bar.height).toBeGreaterThanOrEqual(MIN);
    });

    it('contains the raised centre control inside the touchable carrier', async () => {
      await renderNav();

      /*
        The Android constraint, expressed as arithmetic. The carrier must be at least the bar plus
        the raise, or the lifted part of the button renders outside its parent and stops responding.
      */
      const root = flatStyle(screen.getByTestId('nav'));
      const bar = flatStyle(screen.getByTestId('nav-bar'));

      expect(root.height!).toBeGreaterThanOrEqual(bar.height! + root.paddingTop!);
      expect(root.paddingTop!).toBeGreaterThan(0);
    });

    it('keeps the centre control itself at or above the minimum', async () => {
      await renderNav();

      const ai = screen.getByTestId('nav-ai') as unknown as StyledNode;
      expect(geometry(ai, 'width')).toBeGreaterThanOrEqual(MIN);
      expect(geometry(ai, 'height')).toBeGreaterThanOrEqual(MIN);
    });
  });
});

describe('the bar still reports the height everything else clears', () => {
  beforeEach(() => {
    pinModuleWindow({ width: 393, fontScale: 1 });
  });

  it('draws the visible bar at exactly `moduleNavigationHeight`', async () => {
    await renderNav();

    /*
      The carrier grew; the bar did not. `moduleNavigationHeight` answers "how much must a docked
      panel clear", and the reader dock and prayer dashboard both depend on that meaning — so the
      value the bar renders at must remain the value the helper returns.
    */
    const bar = flatStyle(screen.getByTestId('nav-bar'));
    expect(bar.height).toBe(moduleNavigationHeight((value: number) => value, 0));
  });

  it('carries the raise above the bar, not inside it', async () => {
    await renderNav();

    const root = flatStyle(screen.getByTestId('nav'));
    const bar = flatStyle(screen.getByTestId('nav-bar'));
    expect(root.height! - bar.height!).toBe(root.paddingTop);
  });
});

describe('press behaviour is unchanged by the geometry', () => {
  beforeEach(() => {
    pinModuleWindow({ width: 393, fontScale: 1 });
  });

  it('navigates from every ordinary tab and from the centre control', async () => {
    const pressed: string[] = [];
    await render(
      <ModuleProvider moduleId="planner">
        <ModuleBottomNavigation
          activeKey="today"
          onNavigate={(item) => pressed.push(item.key)}
          testID="nav"
        />
      </ModuleProvider>,
    );

    const user = userEvent.setup();
    for (const item of moduleRegistry.planner.navigation) {
      await user.press(screen.getByTestId(item.isAI === true ? 'nav-ai' : `nav-${item.key}`));
    }

    // Every declared destination, in declaration order — a bigger target must not merge or drop one.
    expect(pressed).toEqual(moduleRegistry.planner.navigation.map((item) => item.key));
  });

  it('keeps the selected state on the active tab only', async () => {
    await renderNav();

    for (const item of moduleRegistry.planner.navigation) {
      if (item.isAI === true) {
        continue;
      }
      const node = screen.getByTestId(`nav-${item.key}`);
      expect(node.props.accessibilityState?.selected).toBe(item.key === 'today');
    }
  });

  it('exposes every tab with its label and the tab role', async () => {
    await renderNav();

    for (const item of moduleRegistry.planner.navigation) {
      if (item.isAI === true) {
        continue;
      }
      const node = screen.getByTestId(`nav-${item.key}`);
      expect(node.props.accessibilityRole).toBe('tab');
      expect(node.props.accessibilityLabel).toBe(item.accessibilityLabel ?? item.label);
    }
  });

  it('declares no disabled or unavailable tab to exempt', () => {
    /*
      Checked rather than assumed. A navigation item is `{key, label, icon, href}` plus the optional
      `isAI` and `accessibilityLabel`; there is no availability flag anywhere in the registry, so
      every tab in every module is interactive and the minimum applies to all of them without
      exception.
    */
    for (const moduleId of FRAMEWORK_MODULE_IDS) {
      for (const item of moduleRegistry[moduleId].navigation) {
        expect(item).not.toHaveProperty('disabled');
        expect(item).not.toHaveProperty('available');
        expect(typeof item.href).toBe('string');
      }
    }
  });
});

describe('every module, not just the one under test', () => {
  it.each(FRAMEWORK_MODULE_IDS)('%s fills all five slots and floors them', async (moduleId) => {
    pinModuleWindow({ width: 393, fontScale: 1 });
    await renderNav(moduleId);

    const ordinary = moduleRegistry[moduleId].navigation.filter((item) => item.isAI !== true);
    expect(ordinary).toHaveLength(4);

    for (const item of ordinary) {
      const node = screen.getByTestId(`nav-${item.key}`) as unknown as StyledNode;
      expect(geometry(node, 'flex')).toBe(1);
      expect(geometry(node, 'minHeight')).toBe(MIN);
    }
  });
});
