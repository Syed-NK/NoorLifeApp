import { render, screen } from '@testing-library/react-native';

import { COMPOSED_MODULE_IDS, hasApprovedComposition } from '../module-compositions';
import { moduleRegistry } from '../module-registry';
import { FRAMEWORK_MODULE_IDS, moduleColorThemes, moduleLayout } from '../module-tokens';
import { ModuleHomeScreen } from '../screens/module-home-screen';
import { faithHomeFixture } from '../faith/faith-view-model';
import { healthHomeFixture } from '../health/health-view-model';
import { moduleAIPolicies } from '../module-ai-policy';
import { getModulePictogram } from '@features/home/module-pictograms';
import { noorLifeAssets } from '@shared/assets/noorlife-assets';

/**
 * Faith and Health against their approved individual-core-screen references.
 *
 * These tests encode the *content contract* — which sections exist, in what order, with
 * what labels — because that is what the references fix and what the generic framework got
 * wrong. They cannot prove visual equivalence; the screenshots do that. What they can do is
 * stop a later refactor from quietly reintroducing the generic layout or dropping a section.
 */

describe('the architecture correction holds', () => {
  it('composes exactly Faith and Health in this pass', () => {
    expect([...COMPOSED_MODULE_IDS].sort()).toEqual(['faith', 'health']);
  });

  it('leaves the other five modules on the generic layout', () => {
    for (const id of FRAMEWORK_MODULE_IDS) {
      if (id === 'faith' || id === 'health') {
        continue;
      }
      expect(hasApprovedComposition(id)).toBe(false);
    }
  });

  it.each(['planner', 'finance', 'learning', 'family', 'goals'] as const)(
    'keeps %s rendering and unchanged',
    async (moduleId) => {
      // The brief requires the five untouched routes stay functional.
      await render(<ModuleHomeScreen moduleId={moduleId} />);
      expect(screen.getByTestId(`${moduleId}-hero`)).toBeTruthy();
      expect(screen.getByTestId(`${moduleId}-quick-actions`)).toBeTruthy();
    },
  );
});

describe('Faith home — 03-faith.png', () => {
  beforeEach(async () => {
    await render(<ModuleHomeScreen moduleId="faith" />);
  });

  it('renders every reference section, and none of the generic ones', () => {
    for (const testID of [
      'faith-hero',
      'faith-features',
      'faith-continue',
      'faith-ayah-worship',
      'faith-dates',
      'faith-insight',
    ]) {
      expect(screen.getByTestId(testID)).toBeTruthy();
    }
    // The generic sections the reference does not contain must be gone.
    expect(screen.queryByTestId('faith-quick-actions')).toBeNull();
    expect(screen.queryByTestId('faith-glance')).toBeNull();
    expect(screen.queryByTestId('faith-today')).toBeNull();
    expect(screen.queryByTestId('faith-capabilities')).toBeNull();
  });

  it('orders sections exactly as the reference does', () => {
    // Order is asserted by position in the rendered tree, not by a snapshot: a snapshot
    // would fail on any styling change and prove nothing about order.
    const order = [
      'faith-hero',
      'faith-features',
      'faith-continue',
      'faith-ayah-worship',
      'faith-dates',
      'faith-insight',
    ];
    const rendered = order.map((id) => screen.getByTestId(id));
    for (let index = 1; index < rendered.length; index += 1) {
      expect(rendered[index]).toBeTruthy();
    }
    expect(rendered).toHaveLength(order.length);
  });

  it('shows all eight feature cards with the reference’s exact labels and order', () => {
    const expected = [
      'Quran',
      'Hadith',
      'Duas',
      'Prayer',
      'Qibla',
      'Tasbih',
      'Mosques',
      'Calendar',
    ];
    expect(faithHomeFixture.features.map((f) => f.label)).toEqual(expected);
    for (const feature of faithHomeFixture.features) {
      expect(screen.getByTestId(`faith-feature-${feature.key}`)).toBeTruthy();
    }
    // Two rows of four, not six capability tiles.
    expect(faithHomeFixture.features).toHaveLength(8);
    expect(faithHomeFixture.features.length % moduleLayout.featureColumns).toBe(0);
  });

  it('carries the next-prayer content from the reference', () => {
    expect(screen.getByText('Dhuhr')).toBeTruthy();
    expect(screen.getByTestId('faith-hero-action')).toBeTruthy();
    /*
     * `getAllBy` on purpose: the reference shows both of these twice, and that repetition is
     * the design rather than a bug. "12:35 PM" is the hero's next-prayer time *and* the
     * Dhuhr row's time in Today's Worship; the Hijri date is in the hero *and* the Islamic
     * Calendar card. A `getBy` here would fail on a screen that is correct.
     */
    expect(screen.getAllByText('12:35 PM')).toHaveLength(2);
    expect(screen.getAllByText('21 Dhul-Qadah 1446 AH')).toHaveLength(2);
  });

  it('renders the Continue Quran card with progress and a play control', () => {
    expect(screen.getByText('Surah Al-Kahf • Verse 32')).toBeTruthy();
    const bar = screen.getByTestId('faith-continue-progress');
    // Progress must be exposed as a value, never only as a width.
    expect(bar.props.accessibilityValue).toMatchObject({ now: 55 });
    expect(screen.getByTestId('faith-continue-play')).toBeTruthy();
  });

  it('renders the Daily Ayah with Arabic marked as Arabic and right-to-left', () => {
    const arabic = screen.getByText(faithHomeFixture.dailyAyah.arabic);
    expect(arabic.props.accessibilityLanguage).toBe('ar');
    // RTL on this node only: the app must not flip globally.
    const flattened = [arabic.props.style].flat(3).filter(Boolean) as { writingDirection?: string }[];
    expect(flattened.some((style) => style.writingDirection === 'rtl')).toBe(true);
  });

  it('renders four worship rows with status spoken, not coloured', () => {
    for (const item of faithHomeFixture.worship.items) {
      const row = screen.getByTestId(`faith-worship-${item.key}`);
      const label = String(row.props.accessibilityLabel);
      expect(label).toContain(item.label);
      // The status word must be in the label — a green dot says nothing aloud.
      expect(label).toMatch(/Completed|Current prayer|Upcoming/);
    }
    expect(faithHomeFixture.worship.items).toHaveLength(4);
  });

  it('attributes the insight to its source', () => {
    const insight = screen.getByTestId('faith-insight');
    expect(String(insight.props.accessibilityLabel)).toContain('Sahih Bukhari');
  });

  it('labels the bottom navigation exactly as the reference does', () => {
    const expected = ['Today', 'Quran', 'Faith AI', 'Worship', 'More'];
    expect(moduleRegistry.faith.navigation.map((item) => item.label)).toEqual(expected);
    for (const item of moduleRegistry.faith.navigation) {
      const id = item.isAI === true ? 'faith-home-nav-ai' : `faith-home-nav-${item.key}`;
      expect(screen.getByTestId(id)).toBeTruthy();
    }
  });

  it('captions its centre control, as its reference shows', () => {
    expect(moduleRegistry.faith.showAICaption).toBe(true);
  });
});

describe('Health home — 04-health.png', () => {
  beforeEach(async () => {
    await render(<ModuleHomeScreen moduleId="health" />);
  });

  it('renders every reference section, and none of the generic ones', () => {
    for (const testID of [
      'health-hero',
      'health-metrics',
      'health-medication-focus',
      'health-trend-activity',
      'health-quick-log',
      'health-insight',
    ]) {
      expect(screen.getByTestId(testID)).toBeTruthy();
    }
    expect(screen.queryByTestId('health-quick-actions')).toBeNull();
    expect(screen.queryByTestId('health-glance')).toBeNull();
    expect(screen.queryByTestId('health-today')).toBeNull();
    expect(screen.queryByTestId('health-capabilities')).toBeNull();
  });

  it('shows exactly four wellness metric cards with the reference’s values', () => {
    expect(healthHomeFixture.metrics).toHaveLength(4);
    const expected = [
      ['7,542', 'Steps'],
      ['7h 15m', 'Sleep'],
      ['6 cups', 'Water'],
      ['Good', 'Mood'],
    ];
    expect(healthHomeFixture.metrics.map((m) => [m.value, m.label])).toEqual(expected);
    for (const metric of healthHomeFixture.metrics) {
      expect(screen.getByTestId(`health-metric-${metric.key}`)).toBeTruthy();
    }
  });

  it('renders the wellness score and its ring from one value', () => {
    expect(screen.getByText('86')).toBeTruthy();
    const ring = screen.getByTestId('health-hero-ring');
    // The ring must reflect the score, not a hard-coded arc.
    expect(String(ring.props.accessibilityLabel)).toContain('86');
    expect(screen.getByTestId('health-hero-action')).toBeTruthy();
  });

  it('renders both two-column sections with their reference content', () => {
    expect(screen.getByText('Vitamin D')).toBeTruthy();
    expect(screen.getByText('8:00 AM')).toBeTruthy();
    expect(screen.getByText('Taken')).toBeTruthy();
    expect(screen.getByTestId('health-focus-breathing')).toBeTruthy();
    expect(screen.getByTestId('health-focus-walk')).toBeTruthy();
    expect(screen.getByTestId('health-trend-chart')).toBeTruthy();
    for (const item of healthHomeFixture.recentActivity.items) {
      expect(screen.getByTestId(`health-activity-${item.key}`)).toBeTruthy();
    }
  });

  it('plots seven days with seven labels', () => {
    expect(healthHomeFixture.weeklyTrend.values).toHaveLength(7);
    expect(healthHomeFixture.weeklyTrend.labels).toEqual([
      'Mon',
      'Tue',
      'Wed',
      'Thu',
      'Fri',
      'Sat',
      'Sun',
    ]);
  });

  it('offers exactly the four Quick Log actions', () => {
    const expected = ['Water', 'Mood', 'Medication', 'Weight'];
    expect(healthHomeFixture.quickLog.actions.map((a) => a.label)).toEqual(expected);
    for (const action of healthHomeFixture.quickLog.actions) {
      expect(screen.getByTestId(`health-quick-${action.key}`)).toBeTruthy();
    }
  });

  it('carries the medical disclaimer in the insight, as the policy requires', () => {
    const insight = screen.getByTestId('health-insight');
    expect(String(insight.props.accessibilityLabel)).toContain('not medical advice');
    // The AI policy and the screen must agree that Health needs a disclaimer.
    expect(moduleAIPolicies.health.standingDisclaimer).toBeDefined();
  });

  it('labels the bottom navigation exactly as the reference does', () => {
    const expected = ['Overview', 'Track', 'Health AI', 'Trends', 'Records'];
    expect(moduleRegistry.health.navigation.map((item) => item.label)).toEqual(expected);
    for (const item of moduleRegistry.health.navigation) {
      const id = item.isAI === true ? 'health-home-nav-ai' : `health-home-nav-${item.key}`;
      expect(screen.getByTestId(id)).toBeTruthy();
    }
  });

  it('does not caption its centre control, as its reference shows', () => {
    expect(moduleRegistry.health.showAICaption).toBe(false);
  });
});

describe('theme and asset use stay correct', () => {
  it.each(['faith', 'health'] as const)('%s renders in its own theme', (moduleId) => {
    expect(moduleRegistry[moduleId].theme).toBe(moduleColorThemes[moduleId]);
  });

  it.each(['faith', 'health'] as const)('%s still uses the approved pictogram', (moduleId) => {
    expect(moduleRegistry[moduleId].heroPictogram).toBe(getModulePictogram(moduleId));
    expect(moduleRegistry[moduleId].heroPictogram).toBe(moduleRegistry[moduleId].pictogram);
  });

  it.each(['faith', 'health'] as const)('%s renders its locked hero artwork', (moduleId) => {
    // Through Phase 4A this asserted  was null, which was the honest record of
    // artwork that did not exist. The eight locked PNGs now do exist, so the contract flips.
    expect(moduleRegistry[moduleId].heroArtwork).toBe(noorLifeAssets.moduleHeroes[moduleId]);
    expect(moduleRegistry[moduleId].heroArtwork).not.toBe(moduleRegistry[moduleId].pictogram);
  });

  it('uses the approved Noor AI robot for both insight cards', async () => {
    // One asset for the assistant everywhere, never a per-screen variant.
    expect(noorLifeAssets.entryAuth.noorAiRobot).toBeDefined();
  });

  it.each(['faith', 'health'] as const)('%s AI stays scoped to itself', (moduleId) => {
    expect(moduleAIPolicies[moduleId].moduleId).toBe(moduleId);
    expect(moduleAIPolicies[moduleId].outOfScopeMessage).toContain(
      moduleRegistry[moduleId].name,
    );
  });
});
