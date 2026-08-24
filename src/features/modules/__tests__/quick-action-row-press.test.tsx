import { fireEvent, render } from '@testing-library/react-native';

import { ModuleQuickActionRow } from '../components/module-quick-action';
import { ModuleProvider } from '../module-context';
import { allModuleDefinitions } from '../module-registry';
import type { FrameworkModuleId } from '../module-tokens';

/*
  Reduced motion, so a press starts no animation.

  `PressableScale` runs an `Animated.timing` on press unless motion is reduced, and a pending
  animation leaves the next render in this file returning an empty tree. Asking for reduced motion is
  both the fix and a truthful configuration — it is what the setting does on a real device — and it
  keeps these assertions about the control rather than about the animation.
*/
jest.mock('@shared/utils/a11y', () => ({
  ...jest.requireActual('@shared/utils/a11y'),
  useReducedMotion: () => true,
}));

/**
 * The quick-action row's press behaviour — issue #52.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * Every tile must stay its own control: separately focusable, separately labelled, separately
 * pressable, and inert where the registry gives it nowhere to go. Reflowing the grid is exactly the
 * kind of change that could collapse three tiles into one pressable region without any width
 * assertion noticing.
 *
 * ── Why the presses live in their own file ─────────────────────────────────
 * `fireEvent.press` on a `PressableScale` starts its scale animation, and a render *after* that in
 * the same file comes back as an empty tree. Both press cases are therefore isolated here, and the
 * render-only assertions stay in `quick-action-row-behaviour.test.tsx` and
 * `quick-action-row-matrix.test.tsx`.
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

describe('each tile is its own control', () => {
  it('gives every tile the button role and its own press target', async () => {
    /*
      Each tile is independently focusable and tappable. Asserted by pressing each one and seeing its
      own handler fire — a grid that wrapped the row in a single pressable would pass a style check
      and fail this.
    */
    // Last in the file on purpose: pressing starts the tile's scale animation, and a suite that
    // renders again afterwards can find an empty tree.
    const pressed: string[] = [];
    const family = definition('family');
    const view = await renderRow('family', (key) => pressed.push(key));

    for (const action of family.quickActions) {
      const tile = view.getByTestId(`family-quick-${action.key}`);
      expect(tile.props.accessibilityRole).toBe('button');
      fireEvent.press(tile);
    }
    expect(pressed).toEqual(family.quickActions.map((action) => action.key));
  });
});
