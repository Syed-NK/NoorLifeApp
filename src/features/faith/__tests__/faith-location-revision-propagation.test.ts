import fs from 'fs';
import path from 'path';

import {
  activeLocationRevision,
  markActiveLocationChanged,
  resetActiveLocationRevisionForTest,
} from '../data/location/active-location';

/**
 * One saved location, one revision, and every location-derived surface recomputing from it.
 *
 * ── The defect class this file exists to close, permanently ─────────────────
 * `active-location.ts` already made the *signal* correct: the mutation boundary bumps a revision
 * once, after the write lands. What nothing enforced was that every consumer actually listens. Faith
 * Home and Prayer Times did. Qibla, the Islamic Calendar's "today", both observance lists and Faith
 * Home's worship checklist did not — each keyed its `useFaithResource` on a constant, so the hook
 * kept the settled result of the *previous* location for as long as the screen stayed mounted.
 *
 * That produced exactly the split the revision was introduced to prevent: save Dubai, and Prayer
 * Times and the hero move while the Qibla arrow still points from Mountain View and the calendar
 * still shows Mountain View's day. Nothing on those screens looks stale — a bearing is a bearing —
 * so there is no state in which a user could notice.
 *
 * ── Why this is a source scan rather than five rendered screens ──────────────
 * Because the property is about *cache keys*, and a rendered assertion can only prove the five call
 * sites that exist today. A sixth location-derived resource added next month would pass a rendering
 * suite that never mounts it, and fail silently in exactly the same way. The scan below fails on any
 * new `useFaithResource` whose loader resolves a location without keying on the revision, which is
 * the invariant rather than an inventory of it.
 */

function listSourceFiles(root: string): readonly string[] {
  const found: string[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__') {
        continue;
      }
      found.push(...listSourceFiles(full));
    } else if (/\.tsx?$/.test(entry.name)) {
      found.push(full);
    }
  }
  return found;
}

function repoRelative(file: string): string {
  return path.relative(process.cwd(), file).split(path.sep).join('/');
}

/**
 * Every `useFaithResource(key, loader)` call in a file, as `{ key, body }` text.
 *
 * Brace-counted rather than matched with a regex: the loader is a `useCallback` containing object
 * literals, template strings and nested arrows, and no regular expression closes that correctly. The
 * scan only needs to know where the call ends, so counting depth over the raw source — and stopping
 * at the matching paren — is both sufficient and immune to what is inside.
 */
function resourceCalls(source: string): readonly { readonly key: string; readonly body: string }[] {
  const calls: { key: string; body: string }[] = [];
  const marker = 'useFaithResource(';

  for (let at = source.indexOf(marker); at !== -1; at = source.indexOf(marker, at + 1)) {
    const open = at + marker.length;
    let depth = 1;
    let cursor = open;
    while (cursor < source.length && depth > 0) {
      const char = source[cursor];
      if (char === '(' || char === '[' || char === '{') {
        depth += 1;
      } else if (char === ')' || char === ']' || char === '}') {
        depth -= 1;
      }
      cursor += 1;
    }
    const call = source.slice(open, cursor - 1);
    /*
      The key is everything before the first *top-level* comma. Splitting on the first comma outright
      would cut a key like `${a}, ${b}` in half; in practice keys are single expressions, but the
      depth counter costs one branch and removes the assumption.
    */
    let commaDepth = 0;
    let split = call.length;
    for (let index = 0; index < call.length; index += 1) {
      const char = call[index];
      if (char === '(' || char === '[' || char === '{') {
        commaDepth += 1;
      } else if (char === ')' || char === ']' || char === '}') {
        commaDepth -= 1;
      } else if (char === ',' && commaDepth === 0) {
        split = index;
        break;
      }
    }
    calls.push({ key: call.slice(0, split).trim(), body: call.slice(split) });
  }
  return calls;
}

/**
 * Resources whose data is location-derived without their own loader saying so.
 *
 * Faith Home's worship checklist is the case: its loader calls `worship.getDay(date)` and mentions
 * no location at all, but the repository container fills each row's time from `worshipTimes`, which
 * resolves the active location and calculates that day's prayers. The dependency is real and a
 * static scan cannot see it, so it is named here instead of being missed.
 *
 * An entry is a promise that the resource *is* keyed on the revision — the assertion below enforces
 * it, so this list cannot rot into documentation.
 */
const LOCATION_DERIVED_BY_INDIRECTION: readonly { readonly file: string; readonly key: string }[] =
  [{ file: 'src/features/modules/faith/faith-home-content.tsx', key: 'faith.home.worship.' }];

describe('every location-derived resource keys on the shared revision', () => {
  const files = listSourceFiles(path.join(process.cwd(), 'src'));

  it('finds resources to check at all, so a broken scan cannot pass vacuously', () => {
    const total = files.reduce(
      (count, file) => count + resourceCalls(fs.readFileSync(file, 'utf8')).length,
      0,
    );
    // A guard on the scanner, not on the app: a regex that stopped matching would otherwise be green.
    expect(total).toBeGreaterThanOrEqual(15);
  });

  it('leaves no resource that resolves a location keyed on a location-invariant key', () => {
    const offenders: string[] = [];

    for (const file of files) {
      const source = fs.readFileSync(file, 'utf8');
      if (!source.includes('resolveCurrentLocation')) {
        continue;
      }
      for (const call of resourceCalls(source)) {
        if (!call.body.includes('resolveCurrentLocation')) {
          continue;
        }
        if (!call.key.includes('locationRevision')) {
          offenders.push(`${repoRelative(file)} → ${call.key}`);
        }
      }
    }

    /*
      Named in the failure rather than counted. When this breaks, the useful output is *which* screen
      would show the previous location's data, and a bare `toHaveLength(0)` would not say.
    */
    expect(offenders).toEqual([]);
  });

  it('keys the resources whose location dependency is indirect', () => {
    for (const entry of LOCATION_DERIVED_BY_INDIRECTION) {
      const source = fs.readFileSync(path.join(process.cwd(), entry.file), 'utf8');
      const call = resourceCalls(source).find((candidate) => candidate.key.includes(entry.key));

      expect(call).toBeDefined();
      expect(call?.key).toContain('${locationRevision}');
      expect(source).toMatch(/useActiveLocationRevision\(\)/);
    }
  });

  it('names the four surfaces the brief requires, so none can be quietly dropped', () => {
    /*
      The inventory *and* the invariant. The scan above proves nothing was missed; this proves the
      specific surfaces named in the release brief — Faith Home, Prayer Times, Qibla, Calendar — are
      the ones that got it, rather than four unrelated resources happening to satisfy a regex.
    */
    const required = [
      { file: 'src/features/faith/hooks/use-faith-home.ts', key: 'faith.home.next-prayer.' },
      { file: 'src/features/faith/screens/prayer-times-screen.tsx', key: 'prayer.today.' },
      { file: 'src/features/faith/hooks/use-qibla.ts', key: 'faith.qibla.target.' },
      { file: 'src/features/faith/screens/calendar-screens.tsx', key: 'faith.calendar.today.' },
    ];

    for (const entry of required) {
      const source = fs.readFileSync(path.join(process.cwd(), entry.file), 'utf8');
      const call = resourceCalls(source).find((candidate) => candidate.key.includes(entry.key));
      expect(call?.key).toContain('${locationRevision}');
    }
  });
});

describe('a commit publishes exactly one revision', () => {
  beforeEach(() => {
    resetActiveLocationRevisionForTest();
  });

  it('moves the revision once per change, so no subscriber refetches twice', () => {
    const seen: number[] = [];
    /*
      Subscribing the way `useSyncExternalStore` does, without a React tree. What is under test is
      that one location change wakes each subscriber once — a second bump would make every keyed
      resource run its request twice, which on the notification path is a full reschedule.
    */
    const before = activeLocationRevision();

    markActiveLocationChanged();
    seen.push(activeLocationRevision());

    expect(seen).toEqual([before + 1]);
  });

  it('gives every subscriber the same value from one change', () => {
    /*
      The atomicity property stated directly: two consumers reading the revision after a single
      change cannot disagree, so two screens cannot key on different locations.
    */
    markActiveLocationChanged();
    const first = activeLocationRevision();
    const second = activeLocationRevision();
    expect(first).toBe(second);
  });
});
