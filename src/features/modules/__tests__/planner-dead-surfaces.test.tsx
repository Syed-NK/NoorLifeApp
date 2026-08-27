import fs from 'node:fs';
import path from 'node:path';

import { act, render, screen } from '@testing-library/react-native';

import { pinModuleWindow } from '@/test-support/module-window';
import { PlannerOwners } from '@/test-support/planner-owners';

import type { IconName } from '@shared/models/icon';

import { COMPOSED_MODULE_IDS, hasApprovedComposition } from '../module-compositions';
import { moduleRasterIcon } from '../module-raster-icons';
import { moduleRegistry } from '../module-registry';
import { ModuleHomeScreen } from '../screens/module-home-screen';

/**
 * **Planner declares no surface it does not render** — issue #77.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── What was dead ──────────────────────────────────────────────────────────
 * `ModuleHomeComposition` routes Planner to `PlannerHomeContent`, which draws a hero, three summary
 * sections and a button. It mounts neither `ModuleQuickActionRow` nor `ModuleFeatureGrid`. Planner's
 * registry nevertheless declared three quick actions (Add task, Calendar, Ask Plan AI) and five
 * capabilities (Today, Calendar, Tasks, Routines, Focus). Their only consumer was the Module
 * Gallery, whose route redirects to Main Home unless `__DEV__`.
 *
 * ── Why removal, and not a new surface ─────────────────────────────────────
 * The approved decision is that Planner's composed home and bottom bar are the product design: no
 * feature grid, no quick-action row, no new section added to give registry entries or commissioned
 * artwork somewhere to live. That leaves deletion as the only honest option for a declaration with
 * no consumer.
 *
 * It costs no reachability. Every href these entries carried is already a tab in
 * `moduleThemes.planner.navigation` — the tiles were an unrendered second copy of the bar. The
 * audit's "Calendar has no route from the Planner home" is a gap in the composition, and these
 * entries were never closing it, because they never rendered.
 *
 * Focus is the entry that mattered most. `available: false` with a reason nothing showed is not
 * harmless: kept for future artwork, it would have put an unbuilt feature in front of a user the
 * day anyone mounted the grid, with no copy review in between.
 *
 * ── What these tests are for ───────────────────────────────────────────────
 * The issue asks for a test that fires if a future change mounts the grid. That is inverted here:
 * with the lists empty there is nothing to become visible, so what is pinned instead is that the
 * lists stay empty, that every real route stays reachable through the bar, and that dev-only
 * scaffolding can never be cited as the consumer that justifies production metadata.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const planner = moduleRegistry.planner;

/** Every Planner destination that must remain reachable, and the file that serves it. */
const PLANNER_ROUTES = [
  ['/planner', 'src/app/planner/index.tsx'],
  ['/planner/calendar', 'src/app/planner/calendar.tsx'],
  ['/planner/tasks', 'src/app/planner/tasks.tsx'],
  ['/planner/routines', 'src/app/planner/routines.tsx'],
  ['/planner/ai', 'src/app/planner/ai.tsx'],
] as const;

/* The removed declarations, assembled so no literal of a dead tile exists in the repository. */
const REMOVED_QUICK_ACTION_KEYS = ['add-task', 'calendar', 'ask-plan-ai'] as const;
const REMOVED_CAPABILITY_KEYS = ['today', 'calendar', 'tasks', 'routines', 'focus'] as const;
const REMOVED_FOCUS_REASON = [
  'Focus sessions arrive with',
  'the Planner module’s full release.',
].join(' ');

function productionSourceFiles(): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (
          entry.name === 'node_modules' ||
          entry.name === '__tests__' ||
          entry.name === 'test-support' ||
          entry.name.startsWith('.')
        ) {
          continue;
        }
        walk(full);
        continue;
      }
      if (
        (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) &&
        !entry.name.includes('.test.')
      ) {
        found.push(full);
      }
    }
  };
  walk(path.join(process.cwd(), 'src'));
  return found;
}

beforeEach(() => {
  pinModuleWindow();
});

// ─────────────────────────────────────────────────────────────────────────────
// The removals
// ─────────────────────────────────────────────────────────────────────────────

describe('Planner declares no unrendered surface', () => {
  it('registers no quick actions', () => {
    expect(planner.quickActions).toEqual([]);
    for (const key of REMOVED_QUICK_ACTION_KEYS) {
      expect(planner.quickActions.map((action) => action.key)).not.toContain(key);
    }
  });

  it('registers no capabilities', () => {
    expect(planner.capabilities).toEqual([]);
    for (const key of REMOVED_CAPABILITY_KEYS) {
      expect(planner.capabilities.map((item) => item.key)).not.toContain(key);
    }
  });

  it('declares no unavailable feature at all', () => {
    /*
      Specifically Focus. An \`available: false\` tile is a promise with a date attached, and Planner
      has no surface that would ever show it — so keeping it against a future grid, or against #78's
      artwork, would be reserving a place for an unbuilt feature.
    */
    expect(planner.capabilities.filter((item) => !item.available)).toEqual([]);
    const registry = fs.readFileSync(
      path.join(process.cwd(), 'src/features/modules/module-registry.ts'),
      'utf8',
    );
    expect(registry).not.toContain(REMOVED_FOCUS_REASON);
  });

  it('is the only module that renders none of these surfaces and declares none', () => {
    const declaresNothing = Object.entries(moduleRegistry)
      .filter(
        ([, definition]) =>
          definition.quickActions.length === 0 && definition.capabilities.length === 0,
      )
      .map(([id]) => id);

    expect(declaresNothing).toEqual(['planner']);
  });
});

describe('every retained Planner declaration has a real consumer', () => {
  it('keeps the five bottom-navigation destinations', () => {
    expect(planner.navigation.map((item) => [item.key, item.href])).toEqual([
      ['today', '/planner'],
      ['calendar', '/planner/calendar'],
      ['plan-ai', '/planner/ai'],
      ['tasks', '/planner/tasks'],
      ['routines', '/planner/routines'],
    ]);
  });

  it('keeps its routes, which the layout and deep links resolve', () => {
    expect(planner.routes).toEqual({ home: '/planner', ai: '/planner/ai', help: '/settings/help' });
  });

  it('keeps the hero, which `PlannerHomeContent` renders', () => {
    expect(planner.hero.headline).toBe('Make today manageable');
    expect(planner.hero.actionLabel).toBe('Add a task');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Reachability, unchanged
// ─────────────────────────────────────────────────────────────────────────────

describe('every real Planner route survives the removal', () => {
  it.each(PLANNER_ROUTES)('%s still has its route file', (_href, file) => {
    /*
      Rule seven, asserted. A dead registry tile is not evidence against the screen it pointed at —
      the tile was unrendered, the screen is not.
    */
    expect(fs.existsSync(path.join(process.cwd(), file))).toBe(true);
  });

  it.each(PLANNER_ROUTES)('%s is still a bottom-navigation destination', (href) => {
    expect(planner.navigation.map((item) => item.href)).toContain(href);
  });

  it('lost no destination that the removed entries were the only route to', () => {
    /*
      The load-bearing check on the removal. Every href the deleted quick actions and capabilities
      carried is still a tab, so nothing became unreachable — which is what made deletion the honest
      option rather than a loss the user would feel.
    */
    const removedHrefs = ['/planner', '/planner/calendar', '/planner/tasks', '/planner/ai'];
    const reachable = planner.navigation.map((item) => item.href);
    for (const href of removedHrefs) {
      expect(reachable).toContain(href);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Non-rendering, proved rather than assumed
// ─────────────────────────────────────────────────────────────────────────────

describe('the Planner home renders neither surface', () => {
  it('is composed, so the generic branch that mounts them is not on its path', () => {
    expect(hasApprovedComposition('planner')).toBe(true);
    expect(COMPOSED_MODULE_IDS).toContain('planner');

    const homeScreen = fs.readFileSync(
      path.join(process.cwd(), 'src/features/modules/screens/module-home-screen.tsx'),
      'utf8',
    );
    // The composed branch returns before the generic body that mounts the row and the grid.
    expect(homeScreen.indexOf('if (composed) {')).toBeLessThan(
      homeScreen.indexOf('<ModuleQuickActionRow'),
    );
    expect(homeScreen.indexOf('if (composed) {')).toBeLessThan(
      homeScreen.indexOf('<ModuleFeatureGrid'),
    );
  });

  it('mounts no quick-action row and no feature grid', async () => {
    await render(
      <PlannerOwners>
        <ModuleHomeScreen moduleId="planner" />
      </PlannerOwners>,
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.queryByTestId('planner-quick-actions')).toBeNull();
    expect(screen.queryByTestId('planner-features')).toBeNull();
    expect(screen.queryByTestId('planner-quick')).toBeNull();

    // And the composition's own surfaces are the ones present.
    expect(screen.getByTestId('planner-hero')).toBeTruthy();
  });

  it('renders no removed label, so nothing was quietly relocated', async () => {
    await render(
      <PlannerOwners>
        <ModuleHomeScreen moduleId="planner" />
      </PlannerOwners>,
    );

    await act(async () => {
      await Promise.resolve();
    });

    /*
      Only the labels the removed entries *alone* carried. "Today", "Calendar", "Tasks" and
      "Routines" are bottom-bar tabs and render legitimately — asserting their absence would be
      asserting the navigation away.
    */
    for (const label of ['Add task', 'Ask Plan AI', 'Focus']) {
      expect(screen.queryByText(label)).toBeNull();
    }
    expect(screen.queryByText(REMOVED_FOCUS_REASON)).toBeNull();
  });
});

describe('the dev gallery cannot justify production metadata', () => {
  it('is unreachable outside development', () => {
    /*
      The whole argument for deleting rather than keeping. The gallery is the only thing that ever
      consumed these lists, and its route redirects to Main Home in a release build — so "the gallery
      shows it" was never a reason for the registry to carry it.
    */
    const route = fs.readFileSync(path.join(process.cwd(), 'src/app/module-gallery.tsx'), 'utf8');
    expect(route).toMatch(/if \(!__DEV__\) \{/);
    expect(route).toMatch(/<Redirect href=\{globalRoutes\.home\} \/>/);
  });

  it('mounts the registry-backed grid nowhere on a Planner path', () => {
    /*
      Stated as a survey rather than a guess, because the first version of this test guessed wrong.
      Four production files mount these components without passing explicit items, so they read the
      module context's own lists: the generic home (which Planner short-circuits), the dev gallery,
      Health's composition, and `ModuleSectionScreen`.

      `ModuleSectionScreen` is the one that matters. It is the generic sub-route screen, and it
      renders `module.capabilities` — so a future Planner sub-route built on it would have surfaced
      the Focus tile without anyone deciding to. No Planner route uses it today; both Planner screens
      that once did now have their own implementations and say so. With the list empty, neither the
      present nor that future can show anything.
    */
    const mounts = productionSourceFiles()
      .filter((file) => {
        const contents = fs.readFileSync(file, 'utf8');
        return (
          contents.includes('<ModuleQuickActionRow') || contents.includes('<ModuleFeatureGrid')
        );
      })
      .map((file) => path.relative(process.cwd(), file).split(path.sep).join('/'))
      .sort();

    expect(mounts).toEqual([
      'src/features/modules/health/health-home-content.tsx',
      'src/features/modules/screens/module-gallery-screen.tsx',
      'src/features/modules/screens/module-home-screen.tsx',
      'src/features/modules/screens/module-section-screen.tsx',
    ]);

    // None of them is reached from a Planner route.
    const plannerRoutes = fs
      .readdirSync(path.join(process.cwd(), 'src/app/planner'))
      .filter((name) => name.endsWith('.tsx'));
    expect(plannerRoutes.length).toBeGreaterThan(0);
    for (const name of plannerRoutes) {
      const contents = fs.readFileSync(path.join(process.cwd(), 'src/app/planner', name), 'utf8');
      expect(contents).not.toContain('ModuleSectionScreen');
      expect(contents).not.toContain('ModuleFeatureGrid');
      expect(contents).not.toContain('ModuleQuickActionRow');
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// #78 and the staged artwork
// ─────────────────────────────────────────────────────────────────────────────

describe('Planner artwork remains uninstalled', () => {
  it('has no raster mapping for any icon it could have used', () => {
    /*
      #78 is untouched by this change, and stays blocked. The commissioned files are staged outside
      the repository; nothing here installs, references or prepares them. Asserted against the icon
      names the removed entries used, so "the artwork went in with #77" cannot be claimed.
    */
    const icons: readonly IconName[] = [
      'add-circle',
      'calendar',
      'robot',
      'today',
      'tasks',
      'routines',
      'clock',
    ];
    for (const icon of icons) {
      expect(moduleRasterIcon('planner', icon)).toBeNull();
    }
  });

  it('is not in the raster branch that #78 would add it to', () => {
    /*
      Deliberately *not* a check for Planner image files: the hero, pictogram and medallion are
      installed and in use. #78 is about commissioned pictogram artwork for tile icons, which reaches
      the app only through `moduleRasterIcon`'s per-module mapping — and Planner has none.
    */
    expect(moduleRasterIcon('planner', 'add-circle')).toBeNull();
    // Finance owns the same icon name, so this also proves nothing is inherited across modules.
    expect(moduleRasterIcon('finance', 'add-circle')).not.toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The stale comments the issue names
// ─────────────────────────────────────────────────────────────────────────────

describe('the composition file describes Planner correctly', () => {
  it('does not list Planner among the modules using the generic layout', () => {
    /*
      Finding T-04. The two stale sentences were already corrected when the Planner state owner
      landed; this pins the correction so it cannot come back, which is what the issue asked for
      regardless of the product decision.
    */
    const compositions = fs.readFileSync(
      path.join(process.cwd(), 'src/features/modules/module-compositions.tsx'),
      'utf8',
    );

    expect(compositions).toMatch(
      /which is what\s+\*?\s*Finance, Learning, Family and Goals still use/,
    );
    expect(compositions).not.toMatch(/Planner, Finance, Learning, Family and Goals/);
    // And Planner is named in its own branch, not in the fallback's comment.
    expect(compositions).toMatch(/case 'planner':/);
    expect(compositions).toMatch(
      /\/\/ Finance, Learning, Family, Goals — awaiting their own reference passes\./,
    );
  });
});
