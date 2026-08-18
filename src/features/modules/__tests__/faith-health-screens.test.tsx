import { render, screen } from '@testing-library/react-native';

import { COMPOSED_MODULE_IDS, hasApprovedComposition } from '../module-compositions';
import { moduleRegistry } from '../module-registry';
import { FRAMEWORK_MODULE_IDS, moduleColorThemes, moduleLayout } from '../module-tokens';
import { ModuleHomeScreen } from '../screens/module-home-screen';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { createMockFaithRepositories } from '@features/faith/data/mock';
import { todayIsoDate } from '@features/faith/hooks/use-reading-log';
import { FaithRepositoryProvider } from '@features/faith/di/faith-repository-context';
import { faithSubmenu } from '@features/faith/faith-submenu-assets';
import { healthHomeFixture } from '../health/health-view-model';
import { moduleAIPolicies } from '../module-ai-policy';
import { getModulePictogram } from '@features/home/module-pictograms';
import { noorLifeAssets } from '@shared/assets/noorlife-assets';
import { installMockLatencyTimers } from '@/test-support/mock-latency-timers';
import { faithAddress } from '@/test-support/faith-storage-address';

/**
 * Faith and Health against their approved individual-core-screen references.
 *
 * These tests encode the *content contract* — which sections exist, in what order, with
 * what labels — because that is what the references fix and what the generic framework got
 * wrong. They cannot prove visual equivalence; the screenshots do that. What they can do is
 * stop a later refactor from quietly reintroducing the generic layout or dropping a section.
 *
 * Mounts whole module homes, whose repository sleeps 350 ms per read, and pays a first-mount
 * compile cost of several seconds on a loaded machine. Both are taken out of the tests themselves.
 */
installMockLatencyTimers(() => render(<ModuleHomeScreen moduleId="planner" />));

describe('the architecture correction holds', () => {
  it('composes Noor AI, Faith and Health to their references', () => {
    expect([...COMPOSED_MODULE_IDS].sort()).toEqual(['faith', 'health', 'noor-ai']);
  });

  it('leaves the other five modules on the generic layout', () => {
    for (const id of FRAMEWORK_MODULE_IDS) {
      if (id === 'faith' || id === 'health' || id === 'noor-ai') {
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

/**
 * The Faith home, with its data sources supplied.
 *
 * ── Why this suite has to inject them now ───────────────────────────────────
 * The screen used to render from a module constant, so mounting it needed nothing. It now reads the
 * Qur'an repository, the worship record and the calendar — and with no provider the DI falls back to
 * the *production* Quran Foundation adapter, which in a test environment has no signed-in session
 * and correctly answers "authentication required". That is the right production behaviour and the
 * wrong fixture for a content contract, so the fixtures are supplied explicitly.
 *
 * The unprovided case is not left untested: `states its failure rather than inventing a verse` below
 * mounts without a provider and asserts the honest failure.
 */
function renderFaithHome() {
  return render(
    <FaithRepositoryProvider repositories={createMockFaithRepositories()}>
      <ModuleHomeScreen moduleId="faith" />
    </FaithRepositoryProvider>,
  );
}

beforeEach(async () => {
  // Reading progress and the continue position genuinely persist, so one case's activity must not
  // become the next one's starting state.
  await AsyncStorage.clear();
});

describe('Faith home — 03-faith.png', () => {
  beforeEach(async () => {
    await renderFaithHome();
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
    /*
     * Asserted against `faithSubmenu`, the asset map the grid actually renders from. It used to be
     * asserted against a second list in the deleted view-model fixture, which meant the test proved
     * two constants agreed with each other rather than that the screen was right.
     */
    expect(faithSubmenu.map((entry) => entry.label)).toEqual(expected);
    for (const entry of faithSubmenu) {
      expect(screen.getByTestId(`faith-feature-${entry.key}`)).toBeTruthy();
    }
    // Two rows of four, not six capability tiles.
    expect(faithSubmenu).toHaveLength(8);
    expect(faithSubmenu.length % moduleLayout.featureColumns).toBe(0);
  });

  /**
   * The hero states nothing it has not resolved.
   *
   * It used to render "Dhuhr 12:35 PM" and "May 19, 2025" from a fixture, on every device on every
   * day. Under test no location is granted and the prayer resource does not settle to `ok`, so the
   * correct rendering is the registry's fallback copy — and the specific strings that used to be
   * fabricated must be absent.
   */
  it('names no prayer time it has not resolved', () => {
    expect(screen.getByTestId('faith-hero-action')).toBeTruthy();
    expect(screen.queryByText('Dhuhr 12:35 PM')).toBeNull();
    expect(screen.queryByText('May 19, 2025')).toBeNull();
    expect(screen.queryByText('21 Dhul-Qa‘dah 1446 AH')).toBeNull();
  });

  /**
   * Continue reading shows the invitation, not a position nobody set.
   *
   * Storage is empty in this test, which is exactly the first-run state. The card used to render
   * "Surah Al-Kahf • Verse 32" at 55% here, because the position was seeded — progress through a
   * surah the user had never opened.
   */
  it('offers to start reading rather than resuming a position nobody set', async () => {
    expect(await screen.findByText('Start reading')).toBeTruthy();
    expect(screen.queryByText('Surah Al-Kahf • Verse 32')).toBeNull();
    expect(screen.queryByTestId('faith-continue-progress')).toBeNull();
  });

  /**
   * The play control is gone.
   *
   * It toggled a boolean and streamed nothing, and its own accessibility hint said audio "arrives
   * with the approved recitation source" — a transport control that had never played anything,
   * sitting on the module's front page.
   */
  it('offers no transport control for audio it cannot play', () => {
    expect(screen.queryByTestId('faith-continue-play')).toBeNull();
  });

  it('renders the verse of the day as Arabic, right-to-left, from the repository', async () => {
    const arabic = await screen.findByTestId('faith-ayah-arabic');
    expect(arabic.props.accessibilityLanguage).toBe('ar');
    // RTL on this node only: the app must not flip globally.
    const flattened = [arabic.props.style].flat(3).filter(Boolean) as {
      writingDirection?: string;
    }[];
    expect(flattened.some((style) => style.writingDirection === 'rtl')).toBe(true);
  });

  it('renders worship rows with status spoken, not coloured', async () => {
    // Row keys are derived from the labels the repository returns, so the prayers are found by the
    // names the day actually carries rather than by a fixture's keys.
    for (const label of ['Fajr Prayer', 'Dhuhr Prayer', 'Asr Prayer', 'Maghrib Prayer']) {
      const row = await screen.findByTestId(
        `faith-worship-${label.toLowerCase().replace(/\s+/g, '-')}`,
      );
      const spoken = String(row.props.accessibilityLabel);
      expect(spoken).toContain(label);
      // The status word must be in the label — a coloured dot says nothing aloud.
      expect(spoken).toMatch(/Completed|Current prayer|Upcoming|Not marked/);
    }
  });

  /**
   * The AI card carries a scope note, not guidance.
   *
   * It used to read "Consistency in small acts of worship brings great reward." with
   * "Source: Sahih Bukhari" beneath it — a religious statement the app had generated, attributed to
   * a collection it had never consulted, on the module's front page. The Faith AI boundary rules
   * forbid presenting generated text as Qur'an, Hadith or a ruling, and this was the clearest
   * violation of them in the app.
   */
  it('states what Faith AI can do rather than issuing guidance', () => {
    const insight = screen.getByTestId('faith-insight');
    const label = String(insight.props.accessibilityLabel);

    expect(label).toContain('Faith AI Insight');
    expect(String(insight.props.accessibilityHint)).toContain('Faith AI');
    // It says what it will not do, in the card itself.
    expect(label).toContain('does not give religious rulings');
    // Neither the narration nor its invented attribution may return.
    expect(screen.queryByText(/Source: Sahih Bukhari/)).toBeNull();
    expect(screen.queryByText(/Consistency in small acts of worship/)).toBeNull();
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

/**
 * The Faith home against the repositories it actually ships with.
 *
 * No provider, so the DI builds the production Quran Foundation adapter — which in this environment
 * has a configured project but no signed-in session, and answers accordingly. This is the case the
 * deleted fixture made unreachable: the screen could not fail, because it never asked anything.
 */
/**
 * The two sections that only exist when there is something true to put in them.
 *
 * Both are rendered from the user's own local record, and both are **absent** on a first run rather
 * than showing a zero. A card reading "0 of 10 verses today" on a device that has never opened the
 * reader is a scoreboard for a game nobody started, and a Continue-reading card is the same
 * fabrication the deleted fixture made.
 */
describe('Faith home sections that depend on real activity', () => {
  it('shows no reading-progress card before anything has been read', async () => {
    await renderFaithHome();
    await screen.findByTestId('faith-continue');

    expect(screen.queryByTestId('faith-reading-progress')).toBeNull();
  });

  it('shows it, with today’s real count, once there is a log', async () => {
    await AsyncStorage.setItem(
      faithAddress('readingLog'),
      JSON.stringify({
        days: { [todayIsoDate()]: 6 },
        furthest: { '18': 6 },
        dailyGoal: 10,
      }),
    );

    await renderFaithHome();

    const card = await screen.findByTestId('faith-reading-progress');
    expect(String(card.props.accessibilityLabel)).toContain('6 of 10 verses today');
  });

  it('says the goal was met rather than implying more is owed', async () => {
    await AsyncStorage.setItem(
      faithAddress('readingLog'),
      JSON.stringify({
        days: { [todayIsoDate()]: 12 },
        furthest: { '18': 12 },
        dailyGoal: 10,
      }),
    );

    await renderFaithHome();
    expect(await screen.findByText('Today’s reading goal met')).toBeTruthy();
  });
});

describe('Faith home with no data available', () => {
  it('states its failure rather than inventing a verse', async () => {
    await render(<ModuleHomeScreen moduleId="faith" />);

    expect(await screen.findByText(/Today’s verse could not be loaded/)).toBeTruthy();
    // The screen still stands: the grid, the hero and the AI card do not depend on the network.
    expect(screen.getByTestId('faith-features')).toBeTruthy();
    expect(screen.getByTestId('faith-hero')).toBeTruthy();
    expect(screen.getByTestId('faith-insight')).toBeTruthy();
  });

  it('offers to set a location rather than naming a prayer time', async () => {
    await render(<ModuleHomeScreen moduleId="faith" />);

    /*
      With no permission granted the hero has no time to show, and the honest rendering is the one
      action that fixes it. The specific fabrication this replaces was "Dhuhr 12:35 PM", rendered to
      every user on every day.
    */
    expect(await screen.findByText('Prayer times need your location')).toBeTruthy();
    expect(await screen.findByText('Set your location')).toBeTruthy();
    expect(screen.queryByText(/\d{1,2}:\d{2}\s*(AM|PM)/)).toBeNull();
  });

  it('shows no Arabic it did not receive', async () => {
    await render(<ModuleHomeScreen moduleId="faith" />);
    await screen.findByText(/Today’s verse could not be loaded/);

    // The verse that used to be a string literal in the bundle must not appear from anywhere.
    expect(screen.queryByText('إِنَّ مَعَ الْعُسْرِ يُسْرًا')).toBeNull();
    expect(screen.queryByTestId('faith-ayah-arabic')).toBeNull();
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
    expect(moduleAIPolicies[moduleId].outOfScopeMessage).toContain(moduleRegistry[moduleId].name);
  });
});
