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

  it('renders Health’s own reviewed empty copy', async () => {
    await waitFor(() => expect(screen.getByTestId('module-empty-state')).toBeTruthy());
    expect(screen.getByText(moduleRegistry.health.stateCopy.empty.title)).toBeTruthy();
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

  it('offers only actions that lead to real routes', () => {
    const content = code(join(HEALTH_DIR, 'health-home-content.tsx'));
    const hrefs = [...content.matchAll(/router\.push\(([^)]+)\)/g)].map((m) => m[1]);
    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) {
      // Either a literal Health route that exists, or the module's own registered AI route.
      expect(href === "'/health/log'" || href === 'module.routes.ai').toBe(true);
    }
    expect(content).not.toContain('comingSoon');
  });
});
