import fs from 'node:fs';
import path from 'node:path';

import { moduleRegistry } from '../module-registry';
import type { ModuleDefinition } from '../module-definition';

/**
 * Planner's registry declaration, and the promise it is no longer allowed to make.
 *
 * Planner declared a `notifications` permission whose title and rationale told the user a task
 * would alert them at a time they set. Nothing in Planner schedules: `planner-routine.ts` records a
 * routine's preferred time as "never a reminder — nothing notifies", no Planner code requests a
 * notification permission, and no Planner code reads a prayer time.
 *
 * A declared permission is not decoration — `module-gallery-screen.tsx` renders the first entry as
 * a real permission prompt, and the registry is the module framework's single source of truth for
 * what a module asks the user for. So the entry was removed rather than softened: the honest form
 * of an unbuilt permission is its absence.
 *
 * These tests pin the absence. Re-adding the entry, or reintroducing the claim through a
 * capability, quick action, hero line or state string, has to fail here.
 */

/** Every claim Planner cannot honour, matched against its own declaration. */
const UNBUILT_CLAIMS =
  /\b(remind(?:er|ers|s|ed)?|notif(?:y|ies|ication|ications)|alarm(?:s)?|alert(?:s)?|prayer[\s-]?time(?:s)?|nudge(?:s)?|automatically\s+schedul|auto[\s-]?schedul)/i;

/*
  The removed strings, assembled from fragments.

  Written whole, they would be present in this file and the source sweep below would either match
  itself or need an exemption. Assembling them keeps the sweep total: the literal appears in no
  file in the repository, so a paste into any of them — production or test — is caught.
*/
const REMOVED_PERMISSION_TITLE = ['Task and', 'event', 'reminders'].join(' ');
const REMOVED_PERMISSION_RATIONALE = ['So a task can', 'remind you at the time', 'you set.'].join(
  ' ',
);

/** Production source only: tests are allowed to name what they forbid. */
function productionSourceFiles(): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (
          entry.name === 'node_modules' ||
          entry.name === '__tests__' ||
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

/** Every user-visible string a module definition carries, flattened. */
function declaredCopy(definition: ModuleDefinition): string {
  return JSON.stringify({
    summary: definition.summary,
    hero: definition.hero,
    quickActions: definition.quickActions,
    capabilities: definition.capabilities,
    permissions: definition.permissions,
    ai: definition.ai,
    stateCopy: definition.stateCopy,
  });
}

describe('the Planner permissions Planner actually asks for', () => {
  it('is nothing at all', () => {
    /*
      Was "the device calendar, and nothing else" when #74 landed. Issue #75 removed that entry too:
      nothing in Planner reads an external calendar, so declaring the permission was the same class
      of claim as declaring the notification one. Planner now asks the user for nothing.
    */
    expect(moduleRegistry.planner.permissions).toEqual([]);
  });

  it('declares no notifications permission', () => {
    const keys = moduleRegistry.planner.permissions.map((permission) => permission.key);
    expect(keys).not.toContain('notifications');
  });

  it('has no permission title or rationale that promises scheduling', () => {
    for (const permission of moduleRegistry.planner.permissions) {
      expect(permission.title).not.toMatch(UNBUILT_CLAIMS);
      expect(permission.rationale).not.toMatch(UNBUILT_CLAIMS);
    }
  });

  it('still satisfies the framework rule that a module explains what it asks for', () => {
    /*
      The rule is "explain whatever you declare", not "declare at least one" — `module-registry.test`
      records why. An empty set explains nothing because it asks for nothing, and the gallery's
      permission section already renders only when there is an entry to show.
    */
    for (const permission of moduleRegistry.planner.permissions) {
      expect(permission.rationale.length).toBeGreaterThan(20);
    }
  });
});

describe('nothing else in the Planner declaration promises scheduling', () => {
  it('declares no reminder, notification, alarm, alert or prayer-time capability', () => {
    for (const capability of moduleRegistry.planner.capabilities) {
      expect(capability.label).not.toMatch(UNBUILT_CLAIMS);
      expect(capability.unavailableReason ?? '').not.toMatch(UNBUILT_CLAIMS);
    }
  });

  it('offers no Plan AI capability that schedules or notifies', () => {
    // Plan AI mutates Planner data, so a capability here is as much a promise as a permission is.
    for (const capability of moduleRegistry.planner.ai.capabilities) {
      expect(capability.label).not.toMatch(UNBUILT_CLAIMS);
    }
  });

  it('carries no such claim anywhere in its declaration', () => {
    // The whole definition — summary, hero, quick actions, capabilities, permissions, AI policy and
    // every state string — so the claim cannot reappear through a surface these tests did not name.
    expect(declaredCopy(moduleRegistry.planner)).not.toMatch(UNBUILT_CLAIMS);
  });
});

describe('the removed registry strings', () => {
  it('appear in no production source file', () => {
    const offenders = productionSourceFiles().filter((file) => {
      const contents = fs.readFileSync(file, 'utf8');
      return (
        contents.includes(REMOVED_PERMISSION_TITLE) ||
        contents.includes(REMOVED_PERMISSION_RATIONALE)
      );
    });

    expect(offenders).toEqual([]);
  });
});

describe('the other modules’ permission entries are untouched', () => {
  // Recorded verbatim, keys and titles in declaration order. #74 removes one Planner entry; a
  // module that legitimately schedules — Faith's prayer reminders, Goals' habit reminders — keeps
  // its declaration exactly as it was.
  it.each([
    [
      'noor-ai',
      [
        ['notifications', 'Noor AI suggestions'],
        ['microphone', 'Voice input'],
      ],
    ],
    [
      'faith',
      [
        ['notifications', 'Prayer reminders'],
        ['location', 'Accurate prayer times'],
      ],
    ],
    [
      'health',
      [
        ['health-data', 'Activity and sleep data'],
        ['notifications', 'Habit reminders'],
      ],
    ],
    // Emptied by #90 — Finance schedules nothing and its Receipts capability is unavailable.
    ['finance', []],
    ['learning', [['notifications', 'Study reminders']]],
    [
      'family',
      [
        ['notifications', 'Family updates'],
        ['photos', 'Shared memories'],
        ['contacts', 'Inviting family'],
      ],
    ],
    ['goals', [['notifications', 'Habit reminders']]],
  ] as const)('%s is unchanged', (moduleId, expected) => {
    const actual = moduleRegistry[moduleId].permissions.map((permission) => [
      permission.key,
      permission.title,
    ]);

    expect(actual).toEqual(expected.map((entry) => [...entry]));
  });

  it('leaves Planner as the only module whose permission set changed', () => {
    // Eight modules; Planner (#75) and Finance (#90) declare none.
    const counts = Object.fromEntries(
      Object.entries(moduleRegistry).map(([id, definition]) => [id, definition.permissions.length]),
    );

    expect(counts).toEqual({
      'noor-ai': 2,
      faith: 2,
      health: 2,
      planner: 0,
      finance: 0,
      learning: 1,
      family: 3,
      goals: 1,
    });
  });
});
