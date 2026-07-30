import { render, screen, waitFor } from '@testing-library/react-native';

import { ModuleProvider } from '../module-context';
import { moduleRegistry } from '../module-registry';
import { FRAMEWORK_MODULE_IDS, type FrameworkModuleId } from '../module-tokens';
import { ModuleHomeScreen } from '../screens/module-home-screen';
import { ModuleAIScreen } from '../screens/module-ai-screen';
import { ModuleSectionScreen } from '../screens/module-section-screen';
import { createMockModuleRepository, type MockScenario } from '../services/mock-module-repository';
import {
  ModuleEmptyState,
  ModuleErrorState,
  ModuleFeatureGrid,
  ModuleOfflineState,
  ModulePermissionState,
} from '../components';

/**
 * The framework, rendered.
 *
 * The registry tests prove the configuration is well formed; these prove the shared
 * components actually build a screen from it, for every module and in every state. That
 * distinction earned its place in this project: an entry-flow panel lost its artwork to
 * a single `alignItems` value while every unit test still passed, because nothing
 * rendered it.
 */

/** A provider pinned to one scenario, so a screen's non-content states are reachable. */
const scenarioProvider = (scenario: MockScenario) => (moduleId: FrameworkModuleId) =>
  createMockModuleRepository(moduleId, scenario);

describe.each(FRAMEWORK_MODULE_IDS)('module home: %s', (moduleId) => {
  const definition = moduleRegistry[moduleId];

  it('renders the header, hero and five-slot navigation', async () => {
    await render(<ModuleHomeScreen moduleId={moduleId} provider={scenarioProvider('populated')} />);

    expect(screen.getByTestId(`${moduleId}-home-header`)).toBeTruthy();
    expect(screen.getByTestId(`${moduleId}-hero`)).toBeTruthy();

    // Every one of the five slots, with the AI control in the centre.
    for (const item of definition.navigation) {
      const testID = item.isAI === true ? `${moduleId}-home-nav-ai` : `${moduleId}-home-nav-${item.key}`;
      expect(screen.getByTestId(testID)).toBeTruthy();
    }
  });

  it('gives the header Back, profile and module Help', async () => {
    await render(<ModuleHomeScreen moduleId={moduleId} provider={scenarioProvider('populated')} />);

    expect(screen.getByTestId(`${moduleId}-home-header-back`)).toBeTruthy();
    expect(screen.getByTestId(`${moduleId}-home-header-profile`)).toBeTruthy();
    expect(screen.getByTestId(`${moduleId}-home-header-help`)).toBeTruthy();
    expect(screen.getByLabelText('Back to Main Home')).toBeTruthy();
    expect(screen.getByLabelText(`Help with ${definition.name}`)).toBeTruthy();
  });

  it('renders the hero artwork rather than collapsing it', async () => {
    // The exact defect an entry-flow panel shipped with: a centring style collapsed the
    // illustration to zero width and no test noticed.
    await render(<ModuleHomeScreen moduleId={moduleId} provider={scenarioProvider('populated')} />);

    const box = screen.getByTestId(`${moduleId}-hero-artbox`);
    const style = box.props.style as { width?: number; height?: number };
    // The approved band is 78–92 dp, and the box is what fixes it — the Image inside
    // fills its parent, so a collapsed box is the only way the artwork can vanish.
    expect(style.width ?? 0).toBeGreaterThanOrEqual(78);
    expect(style.height ?? 0).toBeGreaterThanOrEqual(78);
    expect(style.width ?? 0).toBeLessThanOrEqual(92);
  });

  it('renders the module’s approved PNG, untinted and uncropped', async () => {
    // The artwork lock, asserted where it actually matters: at render. A hero pointing at
    // any other asset — a generic icon, a second illustration — fails here.
    await render(<ModuleHomeScreen moduleId={moduleId} provider={scenarioProvider('populated')} />);

    const art = screen.getByTestId(`${moduleId}-hero-art`);
    expect(art.props.source).toBe(definition.heroPictogram);
    expect(art.props.source).toBe(definition.pictogram);
    // `contain` never stretches or crops; a tint would recolour approved artwork.
    expect(art.props.resizeMode).toBe('contain');
    const style = (art.props.style ?? {}) as { tintColor?: string; backgroundColor?: string };
    expect(style.tintColor).toBeUndefined();
    expect(style.backgroundColor).toBeUndefined();
  });

  it('names the AI centre control after this module’s assistant', async () => {
    await render(<ModuleHomeScreen moduleId={moduleId} provider={scenarioProvider('populated')} />);

    const ai = screen.getByTestId(`${moduleId}-home-nav-ai`);
    // Even with no visible caption, the control must announce which AI it opens.
    expect(String(ai.props.accessibilityLabel)).toContain(definition.ai.label);
  });

  it('shows the module’s content once loaded', async () => {
    await render(<ModuleHomeScreen moduleId={moduleId} provider={scenarioProvider('populated')} />);

    await waitFor(() => {
      expect(screen.getByTestId(`${moduleId}-summary`)).toBeTruthy();
    });
    expect(screen.getByTestId(`${moduleId}-activity`)).toBeTruthy();
    expect(screen.getByTestId(`${moduleId}-insight`)).toBeTruthy();
  });

  it('shows a loading state before the data settles', async () => {
    await render(<ModuleHomeScreen moduleId={moduleId} provider={scenarioProvider('populated')} />);
    // Derived from the request key, so it is present on the first render.
    expect(screen.getByTestId('module-loading-state')).toBeTruthy();
  });

  it.each(['empty', 'offline', 'error'] as const)('handles the %s outcome', async (scenario) => {
    await render(<ModuleHomeScreen moduleId={moduleId} provider={scenarioProvider(scenario)} />);

    const expected = {
      empty: 'module-empty-state',
      offline: 'module-offline-state',
      error: 'module-error-state',
    }[scenario];

    await waitFor(() => {
      expect(screen.getByTestId(expected)).toBeTruthy();
    });
    // Content and a non-content state must never coexist.
    expect(screen.queryByTestId(`${moduleId}-summary`)).toBeNull();
  });
});

describe.each(FRAMEWORK_MODULE_IDS)('module AI screen: %s', (moduleId) => {
  const definition = moduleRegistry[moduleId];

  it('is honest that the assistant is not connected', async () => {
    await render(<ModuleAIScreen moduleId={moduleId} />);
    const banner = screen.getByTestId(`${moduleId}-ai-banner`);
    expect(String(banner.props.accessibilityLabel)).toMatch(/not connected yet/i);
  });

  it('shows every capability as a chip', async () => {
    await render(<ModuleAIScreen moduleId={moduleId} />);
    for (const capability of definition.ai.capabilities) {
      expect(screen.getByTestId(`${moduleId}-ai-chip-${capability.key}`)).toBeTruthy();
    }
  });

  it('marks the chips disabled, since there is nothing to send to', async () => {
    await render(<ModuleAIScreen moduleId={moduleId} />);
    const first = definition.ai.capabilities[0]!;
    const chip = screen.getByTestId(`${moduleId}-ai-chip-${first.key}`);
    expect(chip.props.accessibilityState).toMatchObject({ disabled: true });
  });
});

describe('standing disclaimers appear on the AI screen', () => {
  it.each(['health', 'finance'] as const)('%s shows its disclaimer', async (moduleId) => {
    await render(<ModuleAIScreen moduleId={moduleId} />);
    const disclaimer = screen.getByTestId(`${moduleId}-ai-disclaimer`);
    expect(String(disclaimer.props.accessibilityLabel)).toContain(
      moduleRegistry[moduleId].ai.standingDisclaimer,
    );
  });

  it('faith shows none, so the ones that matter stand out', async () => {
    await render(<ModuleAIScreen moduleId="faith" />);
    expect(screen.queryByTestId('faith-ai-disclaimer')).toBeNull();
  });
});

describe('module sub-screen', () => {
  it('says plainly that the destination is not built yet', async () => {
    await render(
      <ModuleSectionScreen
        moduleId="faith"
        activeKey="quran"
        title="Qur’an"
        heroTitle="Read a little, every day"
        heroBody="Your place is kept."
      />,
    );

    const banner = screen.getByTestId('faith-quran-banner');
    expect(String(banner.props.accessibilityLabel)).toMatch(/full release/i);
    expect(screen.getByTestId('faith-quran-hero')).toBeTruthy();
    expect(screen.getByTestId('faith-quran-empty')).toBeTruthy();
  });

  it('marks its own navigation slot active rather than the home slot', async () => {
    await render(
      <ModuleSectionScreen
        moduleId="health"
        activeKey="trends"
        title="Trends"
        heroTitle="The pattern, not the day"
        heroBody="One bad night means nothing."
      />,
    );

    expect(screen.getByTestId('health-trends-nav-trends').props.accessibilityState).toMatchObject({
      selected: true,
    });
    expect(screen.getByTestId('health-trends-nav-overview').props.accessibilityState).toMatchObject({
      selected: false,
    });
  });
});

describe('feature grid', () => {
  it('marks an unavailable capability disabled and explains why', async () => {
    await render(
      <ModuleProvider moduleId="faith">
        <ModuleFeatureGrid testID="grid" />
      </ModuleProvider>,
    );

    const unavailable = moduleRegistry.faith.capabilities.find((item) => !item.available)!;
    const tile = screen.getByTestId(`grid-${unavailable.key}`);
    expect(tile.props.accessibilityState).toMatchObject({ disabled: true });
    // The reason must reach the user, not just the code comment.
    expect(tile.props.accessibilityHint).toBe(unavailable.unavailableReason);
  });

  it('leaves an available capability pressable', async () => {
    await render(
      <ModuleProvider moduleId="faith">
        <ModuleFeatureGrid testID="grid" />
      </ModuleProvider>,
    );

    const available = moduleRegistry.faith.capabilities.find((item) => item.available)!;
    const tile = screen.getByTestId(`grid-${available.key}`);
    expect(tile.props.accessibilityState?.disabled ?? false).toBe(false);
  });
});

describe('state components', () => {
  it('announce themselves to a screen reader', async () => {
    await render(
      <ModuleProvider moduleId="goals">
        <ModuleEmptyState onAction={() => undefined} />
      </ModuleProvider>,
    );

    const state = screen.getByTestId('module-empty-state');
    expect(state.props.accessibilityLiveRegion).toBe('polite');
    expect(String(state.props.accessibilityLabel)).toContain(moduleRegistry.goals.stateCopy.empty.title);
  });

  it('always give an error state a way out', async () => {
    const retry = jest.fn();
    await render(
      <ModuleProvider moduleId="planner">
        <ModuleErrorState onRetry={retry} />
      </ModuleProvider>,
    );

    expect(screen.getByTestId('module-error-state-primary')).toBeTruthy();
  });

  it('tell the user what still works offline', async () => {
    await render(
      <ModuleProvider moduleId="health">
        <ModuleOfflineState />
      </ModuleProvider>,
    );

    // Health's offline copy promises logging still works — the distinction between
    // "offline" and "broken" that the two separate states exist to preserve.
    const state = screen.getByTestId('module-offline-state');
    expect(String(state.props.accessibilityLabel)).toContain('still log entries');
  });

  it('let a user decline an optional permission', async () => {
    const skip = jest.fn();
    await render(
      <ModuleProvider moduleId="family">
        <ModulePermissionState
          permission={moduleRegistry.family.permissions[0]!}
          onGrant={() => undefined}
          onSkip={skip}
        />
      </ModuleProvider>,
    );

    expect(screen.getByTestId('module-permission-state-secondary')).toBeTruthy();
  });

  it('explain the permission before the OS prompt appears', async () => {
    const permission = moduleRegistry.health.permissions[0]!;
    await render(
      <ModuleProvider moduleId="health">
        <ModulePermissionState permission={permission} onGrant={() => undefined} onSkip={() => undefined} />
      </ModuleProvider>,
    );

    const state = screen.getByTestId('module-permission-state');
    expect(String(state.props.accessibilityLabel)).toContain(permission.rationale);
  });
});

describe('shared components refuse to render outside a module', () => {
  it('throws a message that names the fix', async () => {
    // Rendering in some arbitrary module's colour would be worse than failing.
    // `render` is async in RNTL 14, so the error arrives as a rejection.
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(render(<ModuleFeatureGrid />)).rejects.toThrow(/ModuleProvider/);
    consoleError.mockRestore();
  });
});
