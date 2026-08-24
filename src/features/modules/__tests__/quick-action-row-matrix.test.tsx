import { render } from '@testing-library/react-native';

import { pinModuleWindow } from '@/test-support/module-window';

import { ModuleQuickActionRow } from '../components/module-quick-action';
import { COMPOSED_MODULE_IDS } from '../module-compositions';
import { ModuleProvider } from '../module-context';
import { allModuleDefinitions } from '../module-registry';
import { moduleLayout, moduleScale, moduleType } from '../module-tokens';
import { quickActionColumns } from '../quick-action-fit';
import type { FrameworkModuleId } from '../module-tokens';

/**
 * What the quick-action row must keep while its column count becomes responsive — issue #52.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * The arithmetic is in `quick-action-fit.test.ts`: which column count each cell gets, and that every
 * label then fits. This file covers what that arithmetic cannot say — that reflowing the grid did
 * not disturb anything a user depends on. Order, destinations, accessibility labels, the no-href
 * behaviour and the tile's own size are properties of the rendered tree, and a rule that fixed the
 * wrapping while dropping a tile or reordering two would satisfy every width assertion.
 *
 * This half is the registry matrix — one render per (module, text size) cell. It lives apart from
 * `quick-action-row-behaviour.test.tsx` because this project's act environment stops producing trees
 * after enough renders in a single file, and thirteen cells plus four behaviour renders crossed that
 * line. Splitting them keeps each file well inside it.
 *
 * ── Two things about rendering this component ──────────────────────────────
 * `PressableScale` puts the caller's `style` on an outer animated view and spreads the remaining
 * props — `testID`, `accessibilityRole`, `accessibilityLabel` — onto an inner `Pressable`. So the
 * node a `testID` finds is the touch target, and the tile's own box is its parent.
 *
 * And each case renders exactly once. Repeated renders inside one test are what makes this project's
 * act environment unreliable, so the matrix is expressed as `it.each` rather than as a loop.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const PRODUCTION = allModuleDefinitions.filter(
  (module) => !COMPOSED_MODULE_IDS.includes(module.id),
);

/** Every (module, text size) pair, so the matrix is one render per case. */
/** The window every case in this file pins, so the expected widths are computable. */
const WINDOW_WIDTH = 393;

const MATRIX = PRODUCTION.flatMap((module) =>
  [1, 1.3, 1.5].map((fontScale) => ({ id: module.id, fontScale })),
);

async function renderRow(moduleId: FrameworkModuleId, onSelect?: (key: string) => void) {
  return await render(
    <ModuleProvider moduleId={moduleId}>
      <ModuleQuickActionRow
        testID={`${moduleId}-quick`}
        onSelect={onSelect === undefined ? undefined : (action) => onSelect(action.key)}
      />
    </ModuleProvider>,
  );
}

function definition(id: string) {
  const found = allModuleDefinitions.find((module) => module.id === id);
  if (found === undefined) throw new Error(`${id} is not registered`);
  return found;
}

describe('every registered action renders, in order, at every text size', () => {
  it.each(MATRIX)('$id at font scale $fontScale', async ({ id, fontScale }) => {
    /*
      The column count changes with the text size; the actions do not. A reflow that dropped the last
      tile or sorted the grid fails here rather than on a device.
    */
    pinModuleWindow({ width: WINDOW_WIDTH, fontScale });
    const module = definition(id);
    const view = await renderRow(id);

    for (const action of module.quickActions) {
      expect(view.getByTestId(`${id}-quick-${action.key}`)).toBeTruthy();
      expect(view.getByText(action.label)).toBeTruthy();
      // The accessible name is the registry's, not something derived from the layout.
      expect(view.getByLabelText(action.accessibilityLabel ?? action.label)).toBeTruthy();
    }

    /*
      ── The rendered grid matches the rule ────────────────────────────────────
      The assertion that ties the tree to the predicate. Every tile's width must be the width the
      chosen column count implies, so a row that ignored the rule — hard-coding three columns, or
      collapsing to one — fails here even though every label would still be *present*.
    */
    const dp = (value: number) => Math.round(value * moduleScale(WINDOW_WIDTH));
    const contentWidth = WINDOW_WIDTH - dp(moduleLayout.pagePadding) * 2;
    const columnGap = dp(moduleLayout.cardGap);
    const expectedColumns = quickActionColumns({
      labels: module.quickActions.map((action) => action.label),
      contentWidth,
      columnGap,
      tileChromeWidth: 1 * 2 + dp(8) * 2 + dp(26) + dp(6),
      fontSize: +(moduleType.quickAction[0] * moduleScale(WINDOW_WIDTH)).toFixed(1),
      fontScale,
      maxLines: 2,
    });
    const expectedWidth = (contentWidth - columnGap * (expectedColumns - 1)) / expectedColumns;

    const grid = view.getByTestId(`${id}-quick`);
    const widths = (grid.props.children as { props: { style?: { width?: number } } }[]).map(
      (child) => child.props.style?.width,
    );
    expect({ id, fontScale, widths }).toEqual({
      id,
      fontScale,
      widths: module.quickActions.map(() => expectedWidth),
    });

    // Source order, read back from the row's own children rather than assumed.
    const row = view.getByTestId(`${id}-quick`);
    const order = (row.props.children as { key: string | null }[]).map((child) =>
      String(child.key).replace(/^\.\$/, ''),
    );
    expect(order).toEqual(module.quickActions.map((action) => action.key));
  });
});
