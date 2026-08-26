import { render, screen } from '@testing-library/react-native';
import { StyleSheet, type ViewStyle } from 'react-native';
import React from 'react';

import { AI_INSIGHT_GEOMETRY } from '@ds/components/ai-insight-geometry';
import { FaithRepositoryProvider } from '@features/faith/di/faith-repository-context';
import { getModulePictogram } from '@features/home/module-pictograms';
import { installMockLatencyTimers } from '@/test-support/mock-latency-timers';

import { ModuleProvider } from '../module-context';
import { moduleColorThemes, FRAMEWORK_MODULE_IDS, type FrameworkModuleId } from '../module-tokens';
import { ModuleAIInsightCard } from '../components/module-ai-insight-card';
import { PlannerOwners } from '@/test-support/planner-owners';

import { ModuleHomeScreen } from '../screens/module-home-screen';
import type { ModuleRepositoryProvider } from '../services/module-data.contract';

/**
 * A populated overview, so a generic module home actually renders an insight card to measure.
 *
 * These screens used to get one from the mock repository's `populated` fixtures, and that table was
 * issue #23 — invented totals and activity shown to a signed-in user as their own record. The table
 * is gone, so this suite supplies its own self-evidently sample insight. The card's *geometry* is
 * what is under test here, not its content.
 */
const insightProvider: ModuleRepositoryProvider = (moduleId) => ({
  moduleId,
  getOverview: async () => ({
    kind: 'ok' as const,
    data: {
      moduleId,
      metrics: [],
      activity: [],
      insight: 'Sample insight text for geometry review.',
      generatedAt: null,
    },
  }),
});

// Two costs this removes: the simulated latency the mock data sources sleep through on every
// mount, and the one-off compile cost of the first mount, warmed up in `beforeAll` so that no
// individual test is charged for it.
installMockLatencyTimers(() =>
  render(
    <PlannerOwners>
      <ModuleHomeScreen moduleId="planner" />
    </PlannerOwners>,
  ),
);

/**
 * Every module's AI Insight card is the same card.
 *
 * ── The defect this locks out ───────────────────────────────────────────────
 * Three different components rendered "an AI insight": Faith's banner with a source pill,
 * Health's banner with a tiled robot and a disclaimer line, and the generic card. They had
 * three different heights and Faith's was the tallest. Now there is one component, and
 * these tests assert that rendering it in eight themes produces eight identical boxes.
 */

const LONG_COPY =
  'This is a deliberately long insight that runs well past two lines so that the card ' +
  'has every opportunity to grow taller than Main Home’s, which is exactly the failure ' +
  'this component exists to make impossible, and it keeps going for good measure.';

/** Awaited so `screen` is bound before any query — this setup binds on settle. */
async function renderCard(moduleId: FrameworkModuleId, message = 'A short insight.') {
  await render(
    <ModuleProvider moduleId={moduleId}>
      <ModuleAIInsightCard message={message} onPress={() => undefined} testID="insight" />
    </ModuleProvider>,
  );
}

/**
 * The card's resolved layout style.
 *
 * `PressableScale` puts the caller's style on its outer `Animated.View` and the testID on
 * the inner `Pressable` (which carries only `absoluteFill`), so the geometry lives one
 * level up. `StyleSheet.flatten` resolves registry ids and nested arrays, which
 * `Object.assign` over a raw array does not.
 */
function styleOf(testID: string): ViewStyle {
  const node = screen.getByTestId(testID);
  return StyleSheet.flatten(node.parent?.props.style) as ViewStyle;
}

function cardStyle(): ViewStyle {
  return styleOf('insight');
}

describe('identical geometry in every theme', () => {
  it.each(FRAMEWORK_MODULE_IDS)('%s matches the locked geometry', async (moduleId) => {
    await renderCard(moduleId);
    const style = cardStyle();

    expect(style.height).toBe(AI_INSIGHT_GEOMETRY.height);
    expect(style.borderRadius).toBe(AI_INSIGHT_GEOMETRY.radius);
    expect(style.paddingLeft).toBe(AI_INSIGHT_GEOMETRY.paddingHorizontal);
    expect(style.paddingVertical).toBe(AI_INSIGHT_GEOMETRY.paddingVertical);
    expect(style.borderWidth).toBe(AI_INSIGHT_GEOMETRY.borderWidth);
  });

  /**
   * Cross-module identity follows from the case above.
   *
   * Every theme is asserted equal to the same constant, so they are equal to each other.
   * Restating it as a loop would need eight renders in one test, which this harness does
   * not support — and would prove nothing the per-theme cases do not.
   */
  it('exposes no per-module height, so a module cannot set its own', () => {
    const geometryKeys = Object.keys(AI_INSIGHT_GEOMETRY);
    expect(geometryKeys).toContain('height');
    // The card takes a message, a title and a handler. No size prop exists to pass.
    expect(Object.keys(moduleColorThemes.faith)).not.toContain('insightHeight');
  });

  it.each(FRAMEWORK_MODULE_IDS)('%s renders the robot at the locked size', async (moduleId) => {
    await renderCard(moduleId);
    const robot = screen.getByTestId('insight-robot');
    const robotStyle = StyleSheet.flatten(robot.props.style) as ViewStyle;

    expect(robotStyle.width).toBe(AI_INSIGHT_GEOMETRY.robot);
    expect(robotStyle.height).toBe(AI_INSIGHT_GEOMETRY.robot);
    // The same file Main Home's RobotAsset resolves, never tinted.
    expect(robot.props.source).toBe(getModulePictogram('noor-ai'));
    expect(robot.props.tintColor).toBeUndefined();
    expect(robot.props.resizeMode).toBe('contain');
  });
});

describe('long copy cannot grow the card', () => {
  it.each(FRAMEWORK_MODULE_IDS)('%s stays 68 dp with overflowing copy', async (moduleId) => {
    await renderCard(moduleId, LONG_COPY);
    expect(cardStyle().height).toBe(AI_INSIGHT_GEOMETRY.height);
  });

  it('caps the title at one line and the body at two', async () => {
    await renderCard('faith', LONG_COPY);
    expect(screen.getByTestId('insight-title').props.numberOfLines).toBe(1);
    expect(screen.getByTestId('insight-body').props.numberOfLines).toBe(2);
  });
});

describe('only tint varies', () => {
  it.each(FRAMEWORK_MODULE_IDS)('%s uses its own surface and border', async (moduleId) => {
    await renderCard(moduleId);
    const style = cardStyle();

    expect(style.backgroundColor).toBe(moduleColorThemes[moduleId].lightSurface);
    expect(style.borderColor).toBe(moduleColorThemes[moduleId].border);
    // …while every dimension stays the shared one.
    expect(style.height).toBe(AI_INSIGHT_GEOMETRY.height);
    expect(style.borderRadius).toBe(AI_INSIGHT_GEOMETRY.radius);
  });
});

describe('every module home renders the shared card', () => {
  const GENERIC: readonly FrameworkModuleId[] = ['finance', 'learning', 'family', 'goals'];

  it.each(GENERIC)('%s home renders it at the locked height', async (moduleId) => {
    await render(
      <PlannerOwners>
        <ModuleHomeScreen moduleId={moduleId} provider={insightProvider} />
      </PlannerOwners>,
    );
    await screen.findByTestId(`${moduleId}-insight`);
    const style = styleOf(`${moduleId}-insight`);
    expect(style.height).toBe(AI_INSIGHT_GEOMETRY.height);
  });

  /*
    Faith alone among the composed modules now.

    Health used to be asserted here too, and its card is gone — not resized. It read "Great job
    staying active! A short afternoon walk can improve energy and focus.", which is an AI assessment
    of somebody's body with no health data anywhere behind it, so issue #27 removed the card rather
    than the sentence. The geometry rule is unchanged and still binds every module that *has* the
    card; Health has none to measure.
  */
  it('faith home renders it at the locked height', async () => {
    await render(
      <FaithRepositoryProvider>
        <ModuleHomeScreen moduleId="faith" />
      </FaithRepositoryProvider>,
    );
    await screen.findByTestId('faith-insight');
    expect(styleOf('faith-insight').height).toBe(AI_INSIGHT_GEOMETRY.height);
  });

  it('health home renders no AI insight card at all', async () => {
    await render(
      <PlannerOwners>
        <ModuleHomeScreen moduleId="health" />
      </PlannerOwners>,
    );
    expect(screen.queryByTestId('health-insight')).toBeNull();
  });

  /**
   * Faith is no longer the tall one.
   *
   * Its card is asserted at the shared height by the case above, as is every other
   * module's, so the comparison the brief asks for is satisfied transitively. This case
   * pins the specific regression: Faith must not reintroduce a source pill.
   */
  it('renders Faith without the source pill that used to make it taller', async () => {
    await render(
      <FaithRepositoryProvider>
        <ModuleHomeScreen moduleId="faith" />
      </FaithRepositoryProvider>,
    );
    await screen.findByTestId('faith-insight');

    expect(styleOf('faith-insight').height).toBe(AI_INSIGHT_GEOMETRY.height);
    expect(screen.queryByText(/Source: Sahih Bukhari/)).toBeNull();
  });
});
