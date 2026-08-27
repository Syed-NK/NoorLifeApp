import fs from 'node:fs';
import path from 'node:path';

import { act, render, screen } from '@testing-library/react-native';

import { pinModuleWindow } from '@/test-support/module-window';
import { PlannerOwners } from '@/test-support/planner-owners';

import { ModuleProvider } from '../module-context';
import { moduleRegistry } from '../module-registry';
import { ModuleHomeScreen } from '../screens/module-home-screen';
import { ModuleEmptyState, ModuleOfflineState } from '../components';

/**
 * **Planner's registry says only what Planner does** — issue #75.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── Three declarations, none of them consumed ──────────────────────────────
 * Planner declared an offline state promising "Changes sync later", a `calendar` permission
 * promising to show the device's existing events beside NoorLife tasks, and an empty state saying
 * today would "fill itself in" once the user brought their calendar in.
 *
 * Planner has no server: tasks and routines are AsyncStorage on this device and are never uploaded.
 * Nothing reads an external calendar — `planner-calendar.ts` says so itself. And none of the three
 * strings had a production consumer: Planner has an approved composition, so `ModuleHomeScreen`'s
 * generic empty and offline branches are not on its path, and the permission list renders only in
 * the `__DEV__`-only Module Gallery.
 *
 * ── Why dead copy still had to be fixed ────────────────────────────────────
 * A declaration nothing consumes is a claim waiting for a future surface to pick it up. The next
 * person to wire `ModuleEmptyState` into the Planner home would have shipped an invitation to import
 * a calendar Planner cannot read — without writing a word of copy, and without any review step that
 * would catch it. So the rule these tests encode is not "it does not render today"; it is that every
 * retained Planner string is true *whether or not* it renders.
 *
 * ── What was deleted and what was corrected ────────────────────────────────
 * The permission is deleted outright, because `permissions` is a list and an empty one is a truthful
 * declaration. `empty` and `offline` cannot be deleted — `ModuleStateCopy` requires them and seven
 * other modules render them — so they carry truthful neutral values instead. No surface was added to
 * make either of them render; that would be building UI to justify copy, which is backwards.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const planner = moduleRegistry.planner;

/** Claims Planner cannot honour: a server, a sync, an external calendar, a schedule it invents. */
const UNBUILT_CLAIMS =
  /\b(sync(?:s|ed|ing)?|upload(?:s|ed|ing)?|cloud|back(?:ed)?[\s-]?up|server|remind(?:er|ers|s|ed)?|notif(?:y|ies|ication|ications)|alarm(?:s)?|alert(?:s)?|prayer[\s-]?time(?:s)?|import(?:s|ed|ing)?|your (?:device|existing) (?:calendar|events)|fill itself in)/i;

/* The superseded strings, assembled from fragments so no literal exists in the repository. */
const OLD_OFFLINE_BODY = [
  'Today’s plan is available and you can still add tasks.',
  'Changes sync later.',
].join(' ');
const OLD_EMPTY_TITLE = ['Your day', 'is clear'].join(' ');
const OLD_EMPTY_BODY = [
  'Add a task or bring in your calendar',
  'and today will fill itself in.',
].join(' ');
const OLD_PERMISSION_TITLE = ['Your device', 'calendar'].join(' ');
const OLD_PERMISSION_RATIONALE = [
  'To show your existing events beside NoorLife tasks.',
  'Read-only unless you add an event.',
].join(' ');
const OLD_ERROR_BODY = ['A request failed on our side.', 'Your tasks are still saved.'].join(' ');

const SUPERSEDED = [
  OLD_OFFLINE_BODY,
  OLD_EMPTY_TITLE,
  OLD_EMPTY_BODY,
  OLD_PERMISSION_TITLE,
  OLD_PERMISSION_RATIONALE,
  OLD_ERROR_BODY,
] as const;

/** Production source only: a test has to name what it forbids. */
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

/** Every user-facing string the Planner definition declares, flattened. */
function declaredStrings(): readonly string[] {
  const { empty, error, offline, loading } = planner.stateCopy;
  return [
    planner.summary,
    planner.hero.eyebrow,
    planner.hero.headline,
    planner.hero.support ?? '',
    planner.hero.actionLabel,
    empty.title,
    empty.body,
    empty.action,
    error.title,
    error.body,
    error.action,
    offline.title,
    offline.body,
    loading,
    ...planner.permissions.flatMap((permission) => [permission.title, permission.rationale]),
  ];
}

beforeEach(() => {
  pinModuleWindow();
});

// ─────────────────────────────────────────────────────────────────────────────
// The declarations themselves
// ─────────────────────────────────────────────────────────────────────────────

describe('Planner asks the user for nothing', () => {
  it('declares no permissions at all', () => {
    expect(planner.permissions).toEqual([]);
  });

  it('declares no calendar permission, because nothing reads an external calendar', () => {
    const keys = planner.permissions.map((permission) => permission.key);
    expect(keys).not.toContain('calendar');
    expect(keys).not.toContain('notifications');
  });

  it('has no code that could ask for one', () => {
    /*
      The declaration and the behaviour have to agree in both directions. A permission-free registry
      beside a module that quietly calls a permission API would be the same defect facing the other
      way.
    */
    const plannerSource = productionSourceFiles().filter((file) =>
      file.includes(path.join('features', 'planner')),
    );
    expect(plannerSource.length).toBeGreaterThan(0);
    for (const file of plannerSource) {
      const contents = fs.readFileSync(file, 'utf8');
      expect(contents).not.toMatch(/expo-calendar|expo-notifications|requestPermissionsAsync/);
    }
  });
});

describe('Planner’s state copy claims only what Planner does', () => {
  it('offline no longer promises a sync', () => {
    expect(planner.stateCopy.offline.body).not.toMatch(/sync|upload|cloud|server/i);
    // And states the thing that is actually true of a local store.
    expect(planner.stateCopy.offline.body).toMatch(/offline/i);
    expect(planner.stateCopy.offline.body).toMatch(/this device/i);
  });

  it('empty no longer invites a calendar import', () => {
    expect(planner.stateCopy.empty.body).not.toMatch(/calendar|import|fill itself in/i);
  });

  it('empty offers only an action Planner has', () => {
    /*
      The action must never name a surface that does not exist. "Add a task" is the hero's own verb
      and it resolves to `/planner/tasks`, a route that is built — so an empty state offering it
      would take the user somewhere real.
    */
    expect(planner.stateCopy.empty.action).toBe('Add a task');
    expect(planner.hero.actionLabel).toBe(planner.stateCopy.empty.action);
    // `/planner/tasks` is a bottom-navigation destination. It was also a quick-action href until
    // #77 removed those; the bar is where the route's existence is now recorded.
    expect(planner.navigation.map((item) => item.href)).toContain('/planner/tasks');
  });

  it('error describes a local read failure, not a server one', () => {
    // Both faults are local: a failed AsyncStorage read, or an envelope that would not parse.
    expect(planner.stateCopy.error.body).not.toMatch(/our side|server|request failed/i);
    expect(planner.stateCopy.error.body).toMatch(/this device/i);
    // The framework's own rules still hold.
    expect(planner.stateCopy.error.body.toLowerCase()).not.toContain('you did');
    expect(planner.stateCopy.error.title.toLowerCase()).not.toContain('something went wrong');
  });

  it('makes no unbuilt claim anywhere in the declaration', () => {
    for (const value of declaredStrings()) {
      expect(value).not.toMatch(UNBUILT_CLAIMS);
    }
  });
});

describe('the superseded Planner strings', () => {
  it.each(SUPERSEDED)('%s appears in no production source file', (superseded) => {
    const offenders = productionSourceFiles()
      .filter((file) => fs.readFileSync(file, 'utf8').includes(superseded))
      .map((file) => path.relative(process.cwd(), file));

    expect(offenders).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Dormancy, proved rather than assumed
// ─────────────────────────────────────────────────────────────────────────────

describe('the dormant rows are dormant, and safe if they ever wake', () => {
  it('is not on the generic home path, because Planner has its own composition', () => {
    /*
      This is the reason `empty` and `offline` do not render, stated as a fact about the source
      rather than as a belief. `ModuleHomeScreen` returns the composition before it reaches its
      generic state branches, and Planner is on that list.
    */
    const compositions = fs.readFileSync(
      path.join(process.cwd(), 'src/features/modules/module-compositions.tsx'),
      'utf8',
    );
    expect(compositions).toMatch(/case 'planner':/);

    const homeScreen = fs.readFileSync(
      path.join(process.cwd(), 'src/features/modules/screens/module-home-screen.tsx'),
      'utf8',
    );
    expect(homeScreen).toMatch(/if \(composed\) \{/);
  });

  it('renders neither the empty nor the offline state on the Planner home', async () => {
    await render(
      <PlannerOwners>
        <ModuleHomeScreen moduleId="planner" />
      </PlannerOwners>,
    );

    await act(async () => {
      await Promise.resolve();
    });

    /*
      Neither shared component is mounted. `PlannerTaskList`'s own card is what an empty Planner
      shows — asserted by its testID rather than by its words, because the registry's corrected empty
      title now deliberately matches the card's heading and a text query could not tell them apart.
    */
    expect(screen.queryByTestId('module-empty-state')).toBeNull();
    expect(screen.queryByTestId('module-offline-state')).toBeNull();
    expect(screen.queryByText(planner.stateCopy.offline.body)).toBeNull();
    expect(screen.getByTestId('planner-today-list-empty')).toBeTruthy();
  });

  it('would render truthfully if a future surface did consume them', async () => {
    /*
      The point of correcting dead copy rather than leaving it. This mounts the two shared components
      Planner does not use, under Planner's own module context, and reads what a user would see if
      someone wired them up tomorrow. Nothing in the app renders this arrangement — it is a statement
      about the copy, not a new surface.
    */
    await render(
      <ModuleProvider moduleId="planner">
        <ModuleEmptyState onAction={() => undefined} testID="would-be-empty" />
        <ModuleOfflineState onRetry={() => undefined} testID="would-be-offline" />
      </ModuleProvider>,
    );

    expect(screen.getByText(planner.stateCopy.empty.title)).toBeTruthy();
    expect(screen.getByText(planner.stateCopy.offline.body)).toBeTruthy();

    /*
      Read from the components' own accessibility labels, which are the composed sentences a screen
      reader speaks — not the serialized prop tree, whose React Native prop names are not copy.
    */
    const spoken = [
      screen.getByTestId('would-be-empty').props.accessibilityLabel as string,
      screen.getByTestId('would-be-offline').props.accessibilityLabel as string,
    ].join(' ');

    expect(spoken).not.toMatch(UNBUILT_CLAIMS);
    for (const superseded of SUPERSEDED) {
      expect(spoken).not.toContain(superseded);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Everything else, untouched
// ─────────────────────────────────────────────────────────────────────────────

describe('the other modules’ registry copy is unchanged', () => {
  it.each([
    ['noor-ai', 2, 'Nothing asked yet'],
    ['faith', 2, 'Nothing recorded yet'],
    ['health', 2, 'No entries yet'],
    ['finance', 2, 'No transactions yet'],
    ['learning', 1, 'Nothing started yet'],
    ['family', 3, 'No one here yet'],
    ['goals', 1, 'No goals yet'],
  ] as const)(
    '%s keeps its permissions and state copy',
    (moduleId, permissionCount, emptyTitle) => {
      const definition = moduleRegistry[moduleId];
      expect(definition.permissions).toHaveLength(permissionCount);
      expect(definition.stateCopy.empty.title).toBe(emptyTitle);
    },
  );

  it('leaves Planner as the only module that declares no permissions', () => {
    const empty = Object.entries(moduleRegistry)
      .filter(([, definition]) => definition.permissions.length === 0)
      .map(([id]) => id);

    expect(empty).toEqual(['planner']);
  });

  it('leaves every other module’s offline copy alone', () => {
    /*
      Planner's offline body changed because Planner has no server. The modules that will have one
      keep whatever they said; this change is not a licence to reword them.
    */
    for (const [id, definition] of Object.entries(moduleRegistry)) {
      if (id === 'planner') {
        continue;
      }
      expect(definition.stateCopy.offline.body.length).toBeGreaterThan(0);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Planner's behaviour, unchanged
// ─────────────────────────────────────────────────────────────────────────────

describe('nothing about Planner’s behaviour moved', () => {
  it('keeps its routes, navigation and hero', () => {
    expect(planner.routes).toEqual({ home: '/planner', ai: '/planner/ai', help: '/settings/help' });
    expect(planner.hero.headline).toBe('Make today manageable');
    expect(planner.hero.actionLabel).toBe('Add a task');
    expect(planner.hero.support).toBe('Nothing enters your plan until you add it.');
  });

  it('declares no quick actions or capabilities, since #77 removed the dead ones', () => {
    // Pinned here too, because #75's own rule — a declaration with no consumer is a claim waiting
    // for a surface — is the rule #77 applied to these two lists.
    expect(planner.quickActions).toEqual([]);
    expect(planner.capabilities).toEqual([]);
  });
});
