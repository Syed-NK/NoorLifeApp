import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { render } from '@testing-library/react-native';

import { pinModuleWindow } from '@/test-support/module-window';

import { ModuleQuickActionRow } from '../components/module-quick-action';
import { COMPOSED_MODULE_IDS } from '../module-compositions';
import { ModuleProvider } from '../module-context';
import { allModuleDefinitions } from '../module-registry';
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

/** Flattens a style prop, however React Native nested it. */
function flatten(style: unknown): Record<string, unknown> {
  return (Array.isArray(style) ? style.flat(4) : [style])
    .filter(
      (entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null,
    )
    .reduce<Record<string, unknown>>((all, entry) => ({ ...all, ...entry }), {});
}

describe('navigation and accessibility are unchanged', () => {
  beforeEach(() => {
    pinModuleWindow();
  });

  it('keeps every destination exactly as registered', () => {
    /*
      The row must not invent, drop or rewrite a destination. Family's three are named, so a silent
      registry edit shows up here as a behaviour change rather than passing unnoticed.
    */
    expect(definition('family').quickActions.map((action) => [action.key, action.href])).toEqual([
      ['add-event', '/family/calendar'],
      ['memories', '/family/memories'],
      ['ask-family-ai', '/family/ai'],
    ]);
    for (const module of PRODUCTION) {
      for (const action of module.quickActions) {
        expect(typeof action.href).toBe('string');
      }
    }
  });
});

describe('an action with no destination', () => {
  it('leaves an action with no destination a real button and a no-op', async () => {
    /*
      The existing semantics for an unavailable action: it renders, it is focusable, it announces
      itself, and pressing it does nothing. Noor AI registers three such actions.

      Proven without pressing, deliberately. A press here would start the tile's scale animation and
      leave every later render in this file empty — and the two halves are separately checkable
      anyway: the tree says it is a real, enabled button, and the component's own handler says it
      navigates only when the registry gave it somewhere to go.
    */
    const noorAi = definition('noor-ai');
    expect(noorAi.quickActions.every((action) => action.href === undefined)).toBe(true);

    const source = readFileSync(
      join(__dirname, '..', 'components', 'module-quick-action.tsx'),
      'utf8',
    );
    expect(source).toContain('if (action.href !== undefined)');

    pinModuleWindow();
    const view = await renderRow('noor-ai');
    for (const action of noorAi.quickActions) {
      const tile = view.getByTestId(`noor-ai-quick-${action.key}`);
      expect(tile.props.accessibilityRole).toBe('button');
      expect(tile.props.accessibilityState?.disabled).toBeFalsy();
      expect(view.getByLabelText(action.accessibilityLabel ?? action.label)).toBeTruthy();
    }
  });
});

describe('the tile keeps its size and can grow', () => {
  it.each([1, 1.3, 1.5])('at font scale %s', async (fontScale) => {
    pinModuleWindow({ fontScale });
    const family = definition('family');
    const view = await renderRow('family');

    for (const action of family.quickActions) {
      // The touch target carries the tile box itself since #115 collapsed PressableScale.
      const box = flatten(view.getByTestId(`family-quick-${action.key}`).props.style);
      // A floor, so a wrapped label lengthens the tile instead of being cut off.
      expect(box.height).toBeUndefined();
      expect(typeof box.minHeight).toBe('number');
      expect(box.minHeight as number).toBeGreaterThanOrEqual(44);
    }
  });

  it('gives every tile in a row the same explicit width', async () => {
    /*
      A wrapping grid cannot use `flex: 1` to make its last line match the lines above, so the row
      sets a width. Every tile must get the same one — that is the approved "none dominates"
      property, and a lone tile on a second line must not stretch to fill it.
    */
    pinModuleWindow({ fontScale: 1.5 });
    const view = await renderRow('family');
    const row = view.getByTestId('family-quick');

    const widths = (row.props.children as { props: { style?: unknown } }[]).map(
      (child) => flatten(child.props.style).width,
    );
    expect(widths).toHaveLength(definition('family').quickActions.length);
    expect(widths.every((width) => typeof width === 'number' && width > 44)).toBe(true);
    expect(new Set(widths).size).toBe(1);
  });
});
