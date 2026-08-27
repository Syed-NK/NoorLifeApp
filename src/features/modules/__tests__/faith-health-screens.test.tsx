import { render, screen, waitFor } from '@testing-library/react-native';

import { COMPOSED_MODULE_IDS, hasApprovedComposition } from '../module-compositions';
import { moduleRegistry } from '../module-registry';
import { FRAMEWORK_MODULE_IDS, moduleColorThemes, moduleLayout } from '../module-tokens';
import { PlannerOwners } from '@/test-support/planner-owners';

import { ModuleHomeScreen } from '../screens/module-home-screen';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { createMockFaithRepositories } from '@features/faith/data/mock';
import { todayIsoDate } from '@features/faith/hooks/use-reading-log';
import { FaithRepositoryProvider } from '@features/faith/di/faith-repository-context';
import { faithSubmenu } from '@features/faith/faith-submenu-assets';
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
installMockLatencyTimers(() =>
  render(
    <PlannerOwners>
      <ModuleHomeScreen moduleId="planner" />
    </PlannerOwners>,
  ),
);

describe('the architecture correction holds', () => {
  it('composes Noor AI, Faith, Health, Planner and Finance', () => {
    /*
      Finance joined in #93. Its composition is not a redesign — it renders the generic arrangement
      with the summary read from its own ledger instead of the shared mock, which is what a module
      with a real repository needs and what the mock deliberately will not provide (#23).
    */
    expect([...COMPOSED_MODULE_IDS].sort()).toEqual([
      'faith',
      'finance',
      'health',
      'noor-ai',
      'planner',
    ]);
  });

  it('leaves the other three modules on the generic layout', () => {
    for (const id of FRAMEWORK_MODULE_IDS) {
      if (COMPOSED_MODULE_IDS.includes(id)) {
        continue;
      }
      expect(hasApprovedComposition(id)).toBe(false);
    }
  });

  it.each(['learning', 'family', 'goals'] as const)(
    'keeps %s rendering and unchanged',
    async (moduleId) => {
      // The brief requires the five untouched routes stay functional.
      await render(
        <PlannerOwners>
          <ModuleHomeScreen moduleId={moduleId} />
        </PlannerOwners>,
      );
      expect(screen.getByTestId(`${moduleId}-hero`)).toBeTruthy();
      expect(screen.getByTestId(`${moduleId}-quick-actions`)).toBeTruthy();
    },
  );

  it('gives Planner its own truthful task composition', async () => {
    await render(
      <PlannerOwners>
        <ModuleHomeScreen moduleId="planner" />
      </PlannerOwners>,
    );
    expect(screen.getByTestId('planner-hero')).toBeTruthy();
    expect(screen.queryByTestId('planner-quick-actions')).toBeNull();
  });
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
    await render(
      <PlannerOwners>
        <ModuleHomeScreen moduleId="faith" />
      </PlannerOwners>,
    );

    expect(await screen.findByText(/Today’s verse could not be loaded/)).toBeTruthy();
    // The screen still stands: the grid, the hero and the AI card do not depend on the network.
    expect(screen.getByTestId('faith-features')).toBeTruthy();
    expect(screen.getByTestId('faith-hero')).toBeTruthy();
    expect(screen.getByTestId('faith-insight')).toBeTruthy();
  });

  it('offers to set a location rather than naming a prayer time', async () => {
    await render(
      <PlannerOwners>
        <ModuleHomeScreen moduleId="faith" />
      </PlannerOwners>,
    );

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
    await render(
      <PlannerOwners>
        <ModuleHomeScreen moduleId="faith" />
      </PlannerOwners>,
    );
    await screen.findByText(/Today’s verse could not be loaded/);

    // The verse that used to be a string literal in the bundle must not appear from anywhere.
    expect(screen.queryByText('إِنَّ مَعَ الْعُسْرِ يُسْرًا')).toBeNull();
    expect(screen.queryByTestId('faith-ayah-arabic')).toBeNull();
  });
});

describe('Health home — no fabricated health claim survives', () => {
  /*
    This described "04-health.png" and asserted the reference's values: four metric cards with "7,542"
    and "7h 15m", a wellness score with its ring drawn from one number, a seven-point weekly trend,
    three timestamped recent-activity rows, four Quick Log actions, and a medication card.

    Every one of those came from `healthHomeFixture`, which had no source behind it — no repository,
    no provider, no storage namespace — and the fixture's own docblock said "Nothing here is live".
    Issue #27 removed it. These cases are rewritten rather than deleted because the screen still
    exists and still needs asserting; what changed is that it is now asserted for what it must *not*
    say.
  */
  beforeEach(async () => {
    await render(
      <PlannerOwners>
        <ModuleHomeScreen moduleId="health" />
      </PlannerOwners>,
    );
  });

  it('renders the hero, the real actions and an honest state — and none of the fabricated cards', async () => {
    for (const testID of ['health-hero', 'health-unavailable', 'health-features']) {
      expect(screen.getByTestId(testID)).toBeTruthy();
    }
    /*
      Each of these existed only to present data that does not exist. Absent, not emptied: an empty
      metric card still says "Steps —", and an empty trend chart is a data graphic with no data.
    */
    for (const gone of [
      'health-metrics',
      'health-medication-focus',
      'health-medication',
      'health-focus',
      'health-trend-activity',
      'health-trend',
      'health-trend-chart',
      'health-activity',
      'health-quick-log',
      'health-insight',
      'health-hero-ring',
      /*
        The quick-action row went with the second correction: it has no unavailable affordance, so a
        "Log entry" tile there was an unqualified invitation to a placeholder route.
      */
      'health-quick-actions',
      // And no hero action, because no destination performs a named action today.
      'health-hero-action',
    ]) {
      expect(screen.queryByTestId(gone)).toBeNull();
    }
  });

  it('states no wellness score, and draws no ring for one', () => {
    /*
      The ring is gone rather than zeroed. A ring at zero claims the score *is* zero, and an unswept
      track reads as a load that never finishes.
    */
    expect(screen.queryByTestId('health-hero-ring')).toBeNull();
    expect(screen.queryByText('86')).toBeNull();
    expect(screen.queryByText('Wellness Score')).toBeNull();
  });

  it('says nothing about a medication having been taken', async () => {
    /*
      The highest-risk claim on the screen: "Vitamin D · 8:00 AM · Taken" told a user the application
      had recorded a dose. Asserted by text as well as by testID, because the danger is the words.
    */
    for (const claim of ['Medication Reminder', 'Vitamin D', 'Taken', '8:00 AM']) {
      expect(screen.queryByText(claim)).toBeNull();
    }
  });

  it('states that tracking is unavailable rather than that the user has logged nothing', async () => {
    /*
      This asserted the empty state, which was the first correction and turned out to be the wrong
      one: "No entries yet" is only honest when an entry is possible, and nothing here can create
      one. With no way to log, it reads as the user's own omission.
    */
    await waitFor(() => expect(screen.getByTestId('health-unavailable')).toBeTruthy());
    expect(screen.queryByTestId('module-empty-state')).toBeNull();
    expect(screen.queryByText(moduleRegistry.health.stateCopy.empty.title)).toBeNull();
  });

  it('says what is true in the hero, and offers no action it cannot perform', () => {
    const hero = moduleRegistry.health.hero;
    expect(hero.headline).toBe('Health tracking isn’t available yet');
    expect(hero.actionLabel).toBe('');
    // Non-numeric, in every field the hero renders.
    expect(`${hero.eyebrow} ${hero.headline} ${hero.support ?? ''}`).not.toMatch(/[0-9]/);
    expect(hero.progress).toBeUndefined();
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

  it('faith renders its locked hero artwork', () => {
    /*
      Through Phase 4A this asserted null, which was the honest record of artwork that did not
      exist. The locked PNGs now do exist, so the contract flipped.

      Health registers none, by issue #27: `04-health-hero.png` draws a rising line chart with
      plotted node markers, which reads as the user’s health trend on a screen stating no health
      source exists. Unregistered rather than cropped — `cover` gives no crop, and an offset would
      depend on the aspect ratio.
    */
    expect(moduleRegistry.faith.heroArtwork).toBe(noorLifeAssets.moduleHeroes.faith);
    expect(moduleRegistry.faith.heroArtwork).not.toBe(moduleRegistry.faith.pictogram);
  });

  it('health renders no hero artwork at all', () => {
    expect(moduleRegistry.health.heroArtwork).toBeUndefined();
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
