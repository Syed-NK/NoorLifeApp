import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { render, screen, waitFor } from '@testing-library/react-native';

import { installMockLatencyTimers } from '@/test-support/mock-latency-timers';

import { hasApprovedComposition } from '../module-compositions';
import { moduleRegistry } from '../module-registry';
import { FRAMEWORK_MODULE_IDS, type FrameworkModuleId } from '../module-tokens';
import { ModuleHomeScreen } from '../screens/module-home-screen';
import {
  createMockModuleRepository,
  mockModuleRepositoryProvider,
} from '../services/mock-module-repository';
import type { ModuleRepositoryProvider } from '../services/module-data.contract';

/**
 * **Module homes claim nothing the user did not do** — the regression guard for issue #23.
 *
 * The defect: a `FIXTURES` table in `mock-module-repository.ts` gave every module a populated
 * overview, and the generic module homes rendered it as the signed-in user's own record. Finance
 * showed a monthly spend and a grocery transaction with an amount; Health a step count and a sleep
 * figure with a comparison to "your average"; Family a dinner, a trip and photos credited to a named
 * person; Goals and Learning streaks. Each also carried an "insight" that was a causal claim about
 * the user's life. No store existed behind any of it.
 */

const GENERIC_MODULE_IDS = FRAMEWORK_MODULE_IDS.filter((id) => !hasApprovedComposition(id));

installMockLatencyTimers(async () => {
  await render(<ModuleHomeScreen moduleId="finance" />);
});

/** Every production source under the modules feature, minus tests. */
function moduleSources(): readonly string[] {
  const root = join(__dirname, '..');
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
  walk(root);
  return found;
}

function code(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

/**
 * Every string the audit found being displayed as the user's own record.
 *
 * Listed exhaustively rather than by pattern: a pattern would have to guess at what a fabricated
 * record looks like, and the point of this list is that each entry was *actually on screen*.
 */
const AUDITED_FABRICATIONS: readonly string[] = [
  // Health
  '6,240',
  '6h 20m',
  '40 minutes less than your average',
  'Morning walk',
  '5 of 8 glasses',
  'Evening stretch',
  'Weekly weigh-in',
  // Planner
  'Team stand-up',
  'Send the report',
  'School pick-up',
  'File the invoice',
  '2 more than last week',
  // Finance — the repository's fixture, then the registry hero
  '£412',
  '$2,450',
  '62% spent',
  '68%',
  '£38.40',
  '£6.20',
  '£9.99',
  'Missed on the 1st',
  'rose 14% this month',
  // Learning — fixture, then hero
  'Tajweed basics',
  'Learning Streak',
  '12 days',
  'Saved: focus habits',
  'Arabic vocabulary',
  'Your longest so far',
  // Family — fixture, then hero
  'Family dinner',
  'Family Connection',
  '+18 points from last week',
  'Weekend trip',
  'Eid photos added',
  'By Fatima',
  // Goals — fixture, then hero
  'Read 10 pages',
  'Walk 8,000 steps',
  'Practise Arabic',
  'Sleep by 11 pm',
  'Up from 2 last week',
];

describe('no audited fabrication survives in module production source', () => {
  /*
    A source scan, not only a render assertion. A render proves the strings are absent from the one
    path the test drives; this proves they do not exist to be reintroduced — which is what stops the
    table quietly coming back the next time somebody wants a screenshot to look alive.
  */
  it.each(AUDITED_FABRICATIONS)('%s appears nowhere', (fabrication) => {
    moduleSources().forEach((path) => {
      expect(code(path)).not.toContain(fabrication);
    });
  });

  it('holds no fixture dataset in the repository at all', () => {
    const source = code(join(__dirname, '..', 'services', 'mock-module-repository.ts'));

    // No table, and no `populated` path to fill one in through.
    expect(source).not.toMatch(/FIXTURES|const fixture|populated/);
    expect(source).not.toMatch(/metrics:\s*\[\s*\{/);
    expect(source).not.toMatch(/activity:\s*\[\s*\{/);
  });

  /*
    Fake timers are installed for the whole file, so the mock's deliberate 350 ms sleep has to be
    advanced rather than waited on — a bare await here never settles.
  */
  it('offers no scenario that returns invented content', async () => {
    for (const scenario of ['empty', 'offline', 'error'] as const) {
      const pending = createMockModuleRepository('finance', scenario).getOverview();
      await jest.advanceTimersByTimeAsync(500);
      expect((await pending).kind).not.toBe('ok');
    }
  });
});

describe('a module claims no activity when its real source is empty', () => {
  it.each(GENERIC_MODULE_IDS)(
    '%s shows its own onboarding copy, not a record',
    async (moduleId) => {
      await render(<ModuleHomeScreen moduleId={moduleId} />);

      await waitFor(() => {
        expect(screen.getByTestId('module-empty-state')).toBeTruthy();
      });

      // The module's own honest copy, from the registry — not a generic shrug and not a figure.
      expect(screen.getByText(moduleRegistry[moduleId].stateCopy.empty.title)).toBeTruthy();

      // And none of the summary, activity or insight surfaces exist to carry a claim.
      expect(screen.queryByTestId(`${moduleId}-summary`)).toBeNull();
      expect(screen.queryByTestId(`${moduleId}-activity`)).toBeNull();
      expect(screen.queryByTestId(`${moduleId}-insight`)).toBeNull();
    },
  );

  it.each(GENERIC_MODULE_IDS)('%s renders none of the audited strings', async (moduleId) => {
    const view = await render(<ModuleHomeScreen moduleId={moduleId} />);

    await waitFor(() => {
      expect(screen.getByTestId('module-empty-state')).toBeTruthy();
    });

    AUDITED_FABRICATIONS.forEach((fabrication) => {
      expect(view.queryAllByText(fabrication)).toHaveLength(0);
    });
  });
});

describe('unavailable and failed are not presented as empty or successful', () => {
  const scenarioProvider =
    (scenario: 'empty' | 'offline' | 'error'): ModuleRepositoryProvider =>
    (moduleId: FrameworkModuleId) =>
      createMockModuleRepository(moduleId, scenario);

  /*
    Three different truths. "You have nothing yet" invites the user to add something; "we could not
    reach it" and "it failed" do not, and collapsing them is how a fault gets presented as an empty
    account.

    Learning is the subject rather than Finance since #93. The property is the *generic* home's, and
    Finance left that branch when it gained a composition reading its own ledger — a local store with
    no network has no offline state to distinguish, and its loading and error states now come from
    the store rather than the overview. Learning is still generic, so it exercises the same rule.
  */
  it('renders the offline state, and not the empty state', async () => {
    await render(<ModuleHomeScreen moduleId="learning" provider={scenarioProvider('offline')} />);

    await waitFor(() => {
      expect(screen.getByTestId('module-offline-state')).toBeTruthy();
    });
    expect(screen.queryByTestId('module-empty-state')).toBeNull();
    expect(screen.queryByTestId('learning-summary')).toBeNull();
  });

  it('renders the error state, and not the empty state', async () => {
    await render(<ModuleHomeScreen moduleId="learning" provider={scenarioProvider('error')} />);

    await waitFor(() => {
      expect(screen.getByTestId('module-error-state')).toBeTruthy();
    });
    expect(screen.queryByTestId('module-empty-state')).toBeNull();
    expect(screen.queryByTestId('learning-summary')).toBeNull();
  });

  it('shows a loading state before anything settles, rather than an empty claim', async () => {
    await render(<ModuleHomeScreen moduleId="learning" provider={scenarioProvider('empty')} />);

    expect(screen.getByTestId('module-loading-state')).toBeTruthy();
    expect(screen.queryByTestId('module-empty-state')).toBeNull();
  });
});

describe('there is no account data to leak', () => {
  /*
    Signed-out safety, established structurally rather than by simulating a session. These modules
    have no account-scoped store: the repository takes no owner, reads no storage and holds no state
    between calls, so there is no previous account's data for a later session to read.
  */
  it('reads no storage and takes no owner', () => {
    const source = code(join(__dirname, '..', 'services', 'mock-module-repository.ts'));

    expect(source).not.toMatch(/AsyncStorage|getItem|setItem|SecureStore/);
    expect(source).not.toMatch(/ownerId|userId|account/i);
    expect(source).not.toMatch(/JSON\.parse/);
  });

  it('returns the same stateless answer whoever asks, twice running', async () => {
    const firstPending = mockModuleRepositoryProvider('family').getOverview();
    const secondPending = mockModuleRepositoryProvider('family').getOverview();
    await jest.advanceTimersByTimeAsync(500);

    expect(await firstPending).toEqual({ kind: 'empty' });
    expect(await secondPending).toEqual({ kind: 'empty' });
  });

  it('creates no second storage parser anywhere in the modules feature', () => {
    const offenders = moduleSources().filter((path) => {
      const source = code(path);
      return /noorlife\.[a-z]+\.user/.test(source) || /parse[A-Z]\w*Envelope/.test(source);
    });

    expect(offenders).toEqual([]);
  });

  it('adds no network, notification or AI generation to the module data path', () => {
    const source = code(join(__dirname, '..', 'services', 'mock-module-repository.ts'));

    expect(source).not.toMatch(/fetch\(|axios|supabase|https?:\/\//);
    expect(source).not.toMatch(/expo-notifications|scheduleNotification/);
    expect(source).not.toMatch(/generateInsight|askAI|completion\(/);
  });
});

describe('the development gallery is not a product path', () => {
  /*
    The gallery still needs content to review overflow and truncation across seven themes. It builds
    its own, in a `__DEV__`-only screen, and every value names itself a sample — so a reader can never
    mistake it for a record, and it cannot reach a signed-in user.
  */
  it('keeps its sample content local and self-evidently sample', () => {
    const source = code(join(__dirname, '..', 'screens', 'module-gallery-screen.tsx'));

    expect(source).toContain('SAMPLE_FIXTURE');
    AUDITED_FABRICATIONS.forEach((fabrication) => {
      expect(source).not.toContain(fabrication);
    });
  });

  it('is the only module source holding sample content, and it is dev-gated', () => {
    const routeGuard = readFileSync(
      join(__dirname, '..', '..', '..', 'app', 'module-gallery.tsx'),
      'utf8',
    );
    expect(routeGuard).toContain('__DEV__');

    const holders = moduleSources().filter((path) => /SAMPLE_FIXTURE/.test(code(path)));
    expect(holders.map((path) => path.split(/[\\/]/).pop())).toEqual(['module-gallery-screen.tsx']);
  });
});

describe('a hero states no figure it has no source for', () => {
  /*
    The half of issue #23 the first audit walked past. The fixtures were the obvious fabrication —
    a table named FIXTURES, in a file named mock-* — but the *largest type on each screen* was
    fabricated too, and it lived in the registry beside the routes and the theme where it read as
    configuration. Finance's hero said "$2,450 left / 62% spent" and drew a part-filled bar from a
    hard-coded 0.62; Learning claimed a 12-day streak; Family rated the user's family "Strong" and
    credited it "+18 points from last week"; Goals declared "68% — You're on track!".

    A hero has no empty state — it renders before any data arrives and stays up in every branch — so
    a figure there is not a placeholder that a real source later replaces. It is a claim the user
    reads first and cannot dismiss. The four now carry an invitation, which is the same slot, the
    same geometry and the same character budget.
  */
  it.each(GENERIC_MODULE_IDS)('%s: no digit, no suffix and no progress bar', (moduleId) => {
    const hero = moduleRegistry[moduleId].hero;

    // A bar is a figure drawn rather than written, so it goes with the numerals.
    expect(hero.progress).toBeUndefined();
    expect(hero.headlineSuffix).toBeUndefined();
    expect(`${hero.headline} ${hero.support ?? ''} ${hero.supportSecondary ?? ''}`).not.toMatch(
      /[0-9]/,
    );
  });

  it.each(GENERIC_MODULE_IDS)('%s: invites an action rather than reporting one', (moduleId) => {
    const module = moduleRegistry[moduleId];

    // The hero's CTA is the module's own empty-state action — one honest verb per module, not two
    // that can drift apart, and it is already reviewed copy.
    expect(module.hero.actionLabel).toBe(module.stateCopy.empty.action);
  });

  it('leaves the honest heroes alone', () => {
    // Planner and Faith already invited rather than claimed; they are the pattern the four follow.
    expect(moduleRegistry.planner.hero.headline).toBe('Make today manageable');
    expect(moduleRegistry.faith.hero.headline).toBe('Times for where you are');
  });
});

describe('no protected design file changed', () => {
  /*
    This is a data-contract fix. The locked geometry files and the approved compositions are not part
    of it, and `protected-files.test.ts` enforces the byte lock — this asserts the narrower thing that
    matters here: the fix did not reach for a layout file to solve a truthfulness problem.
  */
  it('leaves the module home screen rendering the same surfaces it always did', () => {
    const source = readFileSync(join(__dirname, '..', 'screens', 'module-home-screen.tsx'), 'utf8');

    for (const surface of [
      'ModuleHeroCard',
      'ModuleQuickActionRow',
      'ModuleSummaryCard',
      'ModuleActivityCard',
      'ModuleAIInsightCard',
      'ModuleEmptyState',
      'ModuleOfflineState',
      'ModuleErrorState',
      'ModuleLoadingState',
      'ModuleFeatureGrid',
    ]) {
      expect(source).toContain(surface);
    }
  });

  it('keeps every approved composition composed', () => {
    expect(hasApprovedComposition('faith')).toBe(true);
    expect(hasApprovedComposition('health')).toBe(true);
    expect(hasApprovedComposition('planner')).toBe(true);
    expect(hasApprovedComposition('noor-ai')).toBe(true);
    /*
      Finance joined them in #93, so it reads its own ledger rather than the shared mock. The three
      still on the generic branch are the three with no repository of their own.
    */
    expect(hasApprovedComposition('finance')).toBe(true);
    expect(GENERIC_MODULE_IDS.slice().sort()).toEqual(['family', 'goals', 'learning']);
  });
});
