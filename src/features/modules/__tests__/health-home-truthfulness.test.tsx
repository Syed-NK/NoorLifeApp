import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { render, screen, waitFor } from '@testing-library/react-native';

import { installMockLatencyTimers } from '@/test-support/mock-latency-timers';

import { moduleRegistry } from '../module-registry';
import { hasApprovedComposition } from '../module-compositions';
import { ModuleHomeScreen } from '../screens/module-home-screen';
import { createMockModuleRepository, type MockScenario } from '../services/mock-module-repository';
import type { ModuleRepositoryProvider } from '../services/module-data.contract';

/**
 * **Health claims nothing about anybody's health** — the regression guard for issue #27.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── The defect ─────────────────────────────────────────────────────────────
 * The composed Health home rendered a complete set of health claims from `healthHomeFixture`, a
 * hard-coded view model with no source behind it: a wellness score of 86 over a progress ring, 7,542
 * steps, 7h 15m sleep, 6 cups of water, mood "Good", a "Medication Reminder" reading *Vitamin D ·
 * 8:00 AM · Taken*, a weekly trend chart asserting activity was "trending up", three timestamped
 * recent-activity rows, two "Today's Focus" suggestions, and an AI insight praising the user's
 * activity.
 *
 * There is no health data layer in this codebase — no repository, no provider, no storage namespace —
 * so every value was invented. The medication row was the serious one: it told a user the application
 * had recorded a dose of a named supplement at a specific time.
 *
 * ── Why so much of this reads the filesystem ────────────────────────────────
 * Because the assertions that matter are about *absence*, and a render can only prove a string is not
 * on the one screen the test drove. Reading the source proves the values do not exist to be
 * reintroduced — which is what stops a fixture quietly coming back the next time somebody wants a
 * screenshot to look alive.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const HEALTH_DIR = join(__dirname, '..', 'health');
const MODULES_ROOT = join(__dirname, '..');

installMockLatencyTimers(async () => {
  await render(<ModuleHomeScreen moduleId="health" />);
});

/** Every production source under the modules feature, tests excluded. */
function moduleSources(): readonly string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        if (entry !== '__tests__') {
          walk(full);
        }
        continue;
      }
      if (/\.tsx?$/.test(entry)) {
        found.push(full);
      }
    }
  };
  walk(MODULES_ROOT);
  return found;
}

/** Comment-stripped, so prose describing the defect cannot fail an assertion about committing it. */
function code(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

/**
 * Every claim the audit found on the screen.
 *
 * Listed exhaustively rather than by pattern: a pattern would have to guess what a fabricated health
 * value looks like, and the point of this list is that each entry was *actually rendered*.
 */
const AUDITED_CLAIMS: readonly string[] = [
  // Wellness score and its encouragement
  'Wellness Score',
  'Today’s Wellness',
  'You’re building a balanced day.',
  // Metrics
  '7,542',
  '7h 15m',
  '6 cups',
  // Medication — the highest-risk claim
  'Medication Reminder',
  'Vitamin D',
  '8:00 AM',
  // Trend
  'Weekly Trend',
  'Your activity is trending up!',
  // Recent activity
  'Recent Activity',
  'Morning Walk',
  'Water Logged',
  'Sleep Logged',
  '7:45 AM',
  '10:20 AM',
  '11:30 PM',
  '2 cups',
  // Focus
  'Today’s Focus',
  'Mindful Breathing',
  '5 min • Calm your mind',
  '20-minute Walk',
  'Keep your body moving',
  // Quick log and AI
  'Quick Log',
  'Health AI Insight',
  'Great job staying active!',
  'A short afternoon walk can improve energy and focus.',
];

describe('no audited health claim survives in production source', () => {
  it.each(AUDITED_CLAIMS)('%s appears nowhere under the modules feature', (claim) => {
    moduleSources().forEach((path) => {
      expect(code(path)).not.toContain(claim);
    });
  });

  it('holds no Health view model or fixture at all', () => {
    /*
      The file is deleted, not emptied. A typed shape with no data is an invitation to fill it in, and
      the types described exactly the cards that had to go.
    */
    expect(() => readFileSync(join(HEALTH_DIR, 'health-view-model.ts'), 'utf8')).toThrow();
    const health = readdirSync(HEALTH_DIR);
    expect(health.some((file) => /view-model|fixture/.test(file))).toBe(false);
  });

  it('names no Health fixture anywhere in the feature', () => {
    for (const path of moduleSources()) {
      expect(code(path)).not.toMatch(/healthHomeFixture|HealthHomeViewModel/);
    }
  });

  it('keeps no populated dataset in the Health sources themselves', () => {
    /*
      Scoped to `health/`, not the whole feature. The Module Gallery legitimately holds a
      `SAMPLE_FIXTURE` with a `metrics: [{ … }]` shape — added by issue #23, every value naming itself
      a sample, in a `__DEV__`-gated screen — and a feature-wide pattern would flag that instead of
      what this is looking for, which is a *Health* dataset returning.
    */
    for (const path of moduleSources().filter((file) => file.includes(join('modules', 'health')))) {
      expect(code(path)).not.toMatch(
        /(metrics|recentActivity|weeklyTrend|quickLog|medication|focus):\s*\{?\s*\[?\s*\{/,
      );
    }
  });
});

describe('the Health screen states no medical or wellness value', () => {
  beforeEach(async () => {
    await render(<ModuleHomeScreen moduleId="health" />);
  });

  it.each(AUDITED_CLAIMS)('renders no "%s"', (claim) => {
    expect(screen.queryByText(claim)).toBeNull();
  });

  it('shows no medication surface of any kind', () => {
    /*
      Asserted by surface as well as by text. A medication card that lost its values but kept its
      heading would still imply the app is tracking doses.
    */
    for (const id of ['health-medication', 'health-medication-focus', 'health-quick-log']) {
      expect(screen.queryByTestId(id)).toBeNull();
    }
  });

  it('draws no score, ring, progress or trend graphic', () => {
    for (const id of ['health-hero-ring', 'health-trend', 'health-trend-chart', 'health-metrics']) {
      expect(screen.queryByTestId(id)).toBeNull();
    }
    expect(moduleRegistry.health.hero.progress).toBeUndefined();
  });

  it('issues no AI health assessment', () => {
    expect(screen.queryByTestId('health-insight')).toBeNull();
    /*
      The AI *policy* keeps its boundaries and its standing disclaimer — those are refusals, not
      claims, and they are asserted where they live. What must not exist is generated praise or advice
      about a body on the home screen.
    */
    expect(screen.queryByText(/great job|keep listening to your body/i)).toBeNull();
  });

  it('states that tracking is unavailable, not that the user logged nothing', async () => {
    /*
      The second correction. The first pass rendered the framework’s empty state — "No entries
      yet — Log one thing today" — which is only honest when an entry is *possible*. Nothing on
      this screen can create one: every logging destination is a placeholder. So it read as the
      user's own omission, which is worse than a wrong number because it assigns blame for it.
    */
    await waitFor(() => expect(screen.getByTestId('health-unavailable')).toBeTruthy());
    expect(screen.queryByTestId('module-empty-state')).toBeNull();
    expect(screen.queryByText(moduleRegistry.health.stateCopy.empty.title)).toBeNull();
    expect(screen.queryByText(/no entries yet/i)).toBeNull();
  });
});

describe('the five states stay five', () => {
  const scenarioProvider =
    (scenario: MockScenario): ModuleRepositoryProvider =>
    (moduleId) =>
      createMockModuleRepository(moduleId, scenario);

  /*
    "You have logged nothing", "we could not reach it" and "it failed" are three different truths, and
    collapsing them is how a fault gets presented as an empty record — which on a health screen would
    mean telling somebody they logged nothing when their entries could not be read.
  */
  it('shows the offline state, and not the empty one', async () => {
    await render(<ModuleHomeScreen moduleId="health" provider={scenarioProvider('offline')} />);

    await waitFor(() => expect(screen.getByTestId('module-offline-state')).toBeTruthy());
    expect(screen.queryByTestId('module-empty-state')).toBeNull();
  });

  it('shows the error state, and not the empty one', async () => {
    await render(<ModuleHomeScreen moduleId="health" provider={scenarioProvider('error')} />);

    await waitFor(() => expect(screen.getByTestId('module-error-state')).toBeTruthy());
    expect(screen.queryByTestId('module-empty-state')).toBeNull();
  });

  it('shows a loading state before anything settles', async () => {
    await render(<ModuleHomeScreen moduleId="health" provider={scenarioProvider('empty')} />);

    expect(screen.getByTestId('module-loading-state')).toBeTruthy();
    expect(screen.queryByTestId('module-empty-state')).toBeNull();
  });

  it('keeps a distinct permission state available for the features that need one', () => {
    /*
      Health is the module with permission-gated capabilities, and the framework has a state for it.
      Asserted as available rather than rendered: nothing requests health permissions today, and this
      change does not add that.
    */
    const permission = readFileSync(
      join(__dirname, '..', 'components', 'module-permission-state.tsx'),
      'utf8',
    );
    expect(permission).toContain('export function ModulePermissionState');
    const unavailable = moduleRegistry.health.capabilities.filter((c) => c.available === false);
    expect(unavailable.length).toBeGreaterThan(0);
    for (const capability of unavailable) {
      // Every unavailable capability says why, rather than looking broken.
      expect(capability.unavailableReason).toBeTruthy();
    }
  });
});

describe('rendering Health touches no account storage', () => {
  const composed = [
    join(HEALTH_DIR, 'health-home-content.tsx'),
    join(HEALTH_DIR, 'health-hero.tsx'),
  ];

  it('parses no storage and builds no account key', () => {
    for (const path of composed) {
      const source = code(path);
      expect(source).not.toMatch(/AsyncStorage|SecureStore|JSON\.parse/);
      expect(source).not.toMatch(/noorlife\./);
      expect(source).not.toMatch(/ownerId|userId/);
    }
  });

  it('constructs no repository and starts no read of its own', () => {
    /*
      One state, one read. The overview state is passed in from `ModuleHomeScreen`, which already
      computes it — it used to be computed there and discarded while this screen read a fixture. A
      second `useModuleOverview` here would be a second request per navigation.
    */
    const content = code(join(HEALTH_DIR, 'health-home-content.tsx'));
    expect(content).not.toMatch(/useModuleOverview|createMockModuleRepository|Repository\(/);
    expect(content).toContain('state: UseModuleOverview');
  });

  it('writes nothing while rendering the empty state', () => {
    for (const path of composed) {
      const source = code(path);
      expect(source).not.toMatch(/setItem|write|save|create[A-Z]\w*Record|seed/i);
    }
  });

  it('adds no health integration, sensor or permission request', () => {
    for (const path of composed) {
      const source = code(path);
      expect(source).not.toMatch(/HealthKit|HealthConnect|Health Connect|AppleHealth|Pedometer/i);
      expect(source).not.toMatch(/requestPermission|Notifications|expo-sensors/i);
      expect(source).not.toMatch(/fetch\(|axios|supabase|https?:\/\//);
    }
  });
});

describe('the approved composition and the framework are intact', () => {
  it('keeps Health composed rather than demoting it to the generic home', () => {
    expect(hasApprovedComposition('health')).toBe(true);
    for (const id of ['faith', 'planner', 'noor-ai'] as const) {
      expect(hasApprovedComposition(id)).toBe(true);
    }
  });

  it('keeps the palette, artwork and navigation the composition existed for', () => {
    const hero = code(join(HEALTH_DIR, 'health-hero.tsx'));
    expect(hero).toContain('ModuleHeroArtwork');
    expect(hero).toContain('module.heroArtwork');
    expect(hero).toContain('module.theme.gradientEnd');
    expect(hero).toContain('moduleLayout.heroHeight');
    // No literal colours introduced to the launch palette.
    expect(hero).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  it('keeps large-font behaviour on the copy that can grow', () => {
    const hero = code(join(HEALTH_DIR, 'health-hero.tsx'));
    expect(hero).toContain('maxFontSizeMultiplier');
    // The headline is a sentence now, so it is allowed to wrap where a two-digit number never had to.
    expect(hero).toMatch(/numberOfLines=\{2\}/);
  });

  it('navigates nowhere from the home, because nothing here performs an action', () => {
    /*
      This used to allow `/health/log` and the AI route. `/health/log` renders the framework’s
      section screen, which says the destination arrives with the module’s full release — so the CTA
      named an action that does not happen. The home now navigates from nowhere: the capability grid
      does its own routing and marks the unavailable ones, and Health AI stays reachable through the
      bottom navigation rather than being promoted as a stand-in for tracking.
    */
    const content = code(join(HEALTH_DIR, 'health-home-content.tsx'));
    expect(content).not.toMatch(/router\.push|useRouter/);
    expect(content).not.toContain('comingSoon');
  });
});

describe('no action promises what its destination cannot do', () => {
  /**
   * Every Health destination reachable from the home, and what it actually does.
   *
   * `ModuleSectionScreen` is the framework’ honest "not yet" shell — real chrome, real
   * navigation, a banner saying the destination arrives with the module’s full release, and no
   * content. Reaching one is not performing the action its name promises, which is the distinction
   * this describe exists for: a route existing does not make its named action real.
   */
  const PLACEHOLDER_ROUTES = ['log', 'trends', 'records'] as const;

  it.each(PLACEHOLDER_ROUTES)('/health/%s is only a placeholder', (route) => {
    const source = readFileSync(
      join(__dirname, '..', '..', '..', 'app', 'health', `${route}.tsx`),
      'utf8',
    );
    expect(source).toContain('ModuleSectionScreen');
  });

  it('names no logging, tracking, trend or records action anywhere on the home', () => {
    /*
      An *invitation* is the defect, not the vocabulary. "Health tracking isn't available yet" has to
      be allowed to name the thing that is unavailable — that is the whole message — so this looks for
      the imperative instead: a line that tells the user to do something the app cannot do.

      The first version of this assertion banned the words outright and failed on the honest copy,
      which is worth recording: a rule that forbids naming a limitation makes the limitation harder to
      state than to hide.
    */
    const hero = moduleRegistry.health.hero;
    const lines = [hero.eyebrow, hero.headline, hero.support, hero.supportSecondary].filter(
      (value): value is string => value !== undefined,
    );
    for (const line of lines) {
      expect(line).not.toMatch(/^(log|track|record|start|add|view|see|check)\b/i);
    }
    // And no button at all, so there is nothing to name an action with.
    expect(hero.actionLabel).toBe('');
  });

  it('offers a quick action only where the destination performs it', () => {
    /*
      The quick-action row has no unavailable affordance — every tile is live and routes on tap — so
      an unavailable capability cannot be represented there honestly. Health keeps exactly the one
      whose destination works.
    */
    const actions = moduleRegistry.health.quickActions;
    expect(actions.map((action) => action.href)).toEqual(['/health/ai']);
    for (const action of actions) {
      expect(action.href).not.toMatch(/\/health\/(log|trends|records)$/);
    }
  });

  it('marks every placeholder capability unavailable, with a reason', () => {
    /*
      Before the tap, which is the requirement. The grid greys these, disables them, announces "not
      available yet" and puts the reason in the hint.
    */
    const byKey = new Map(moduleRegistry.health.capabilities.map((c) => [c.key, c]));
    for (const key of ['track', 'trends', 'records', 'sleep', 'water']) {
      const capability = byKey.get(key);
      expect(capability?.available).toBe(false);
      expect(capability?.unavailableReason).toBeTruthy();
    }
    // Overview is the screen the user is already on, so it genuinely works.
    expect(byKey.get('overview')?.available).toBe(true);
  });

  it('does not present Health AI as a substitute for tracking', () => {
    /*
      It stays reachable — bottom navigation, under its own policy — and is deliberately not offered
      beside "tracking is not available", where it would read as the replacement for recording.
    */
    const content = code(join(HEALTH_DIR, 'health-home-content.tsx'));
    expect(content).not.toMatch(/routes\.ai|health\/ai|Ask Health AI/);
  });
});

describe('the no-data hero carries no data imagery', () => {
  it('registers no hero artwork while there is no provider', () => {
    /*
      `04-health-hero.png` draws a rising line chart with plotted node markers across the sky. On a
      screen stating that no health source exists, that reads as the user's trend. Unregistered rather
      than cropped: `resizeMode="cover"` gives no crop control, so an offset would depend on the
      hero's aspect ratio and could expose the chart again at another width.

      This also covers Track, Trends and Records, which render `ModuleHeroCard` over the same field —
      the chart was on four Health screens, not one.
    */
    expect(moduleRegistry.health.heroArtwork).toBeUndefined();
  });

  it('draws no ring, chart, gauge or progress in the Health hero', () => {
    const hero = code(join(HEALTH_DIR, 'health-hero.tsx'));
    expect(hero).not.toMatch(/ProgressRing|ModuleLineChart|Chart|Gauge|Svg|Polyline/);
    expect(moduleRegistry.health.hero.progress).toBeUndefined();
  });

  it('keeps the hero geometry it always had', () => {
    // The artwork layer is absent; the box is not. Height, radius and theme fill are unchanged.
    const hero = code(join(HEALTH_DIR, 'health-hero.tsx'));
    expect(hero).toContain('moduleLayout.heroHeight');
    expect(hero).toContain('moduleLayout.cardRadius');
    expect(hero).toContain('module.theme.gradientEnd');
  });

  it('lets the artwork layer be absent without a scrim over nothing', () => {
    const artwork = code(join(__dirname, '..', 'components', 'module-hero-artwork.tsx'));
    expect(artwork).toMatch(/source === undefined/);
    expect(artwork).toContain('return null');
  });
});
