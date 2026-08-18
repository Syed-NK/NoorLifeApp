import fs from 'node:fs';
import path from 'node:path';

import { moduleThemes } from '@ds/modules/module-themes';

import { faithNavKeys, faithRoutes } from '../faith-routes';

/**
 * The route map, checked against the filesystem.
 *
 * ── Why this test exists when `Href` already type-checks the paths ──────────
 * `Href` proves each string names a route file *at the time the app is built with a
 * generated route type*. It does not prove the reverse — that every route file is
 * reachable — and it does not run in CI unless a typecheck does. This walks the actual
 * directory both ways, which catches an orphaned screen nobody can navigate to as well as
 * a missing one.
 */

const APP_FAITH_DIR = path.join(process.cwd(), 'src', 'app', 'faith');

function routeFiles(): readonly string[] {
  return fs
    .readdirSync(APP_FAITH_DIR)
    .filter((name) => name.endsWith('.tsx') && !name.startsWith('_'))
    .map((name) => name.replace(/\.tsx$/, ''));
}

/** `/faith/quran` → `quran`; `/faith` → `index`. */
function segmentOf(href: string): string {
  const rest = href.replace(/^\/faith\/?/, '');
  return rest === '' ? 'index' : rest;
}

describe('Faith route map', () => {
  it('points every declared route at a file that exists', () => {
    const files = new Set(routeFiles());
    for (const [key, href] of Object.entries(faithRoutes)) {
      expect({ key, segment: segmentOf(href), exists: files.has(segmentOf(href)) }).toEqual({
        key,
        segment: segmentOf(href),
        exists: true,
      });
    }
  });

  it('leaves no route file unreachable from the route map', () => {
    const declared = new Set(Object.values(faithRoutes).map(segmentOf));
    for (const file of routeFiles()) {
      // An orphan here means a screen a user can only reach by typing a deep link,
      // which in practice means a screen nobody reviews.
      expect({ file, reachable: declared.has(file) }).toEqual({ file, reachable: true });
    }
  });

  it('declares every route under the /faith prefix', () => {
    for (const href of Object.values(faithRoutes)) {
      expect(href.startsWith('/faith')).toBe(true);
    }
  });
});

describe('Faith bottom navigation', () => {
  const navigation = moduleThemes.faith.navigation;

  it('has exactly five slots with AI third', () => {
    expect(navigation).toHaveLength(5);
    expect(navigation[2]!.isAI).toBe(true);
  });

  it('uses the keys the screens name', () => {
    expect(navigation.map((item) => item.key)).toEqual([
      faithNavKeys.today,
      faithNavKeys.quran,
      faithNavKeys.ai,
      faithNavKeys.worship,
      faithNavKeys.more,
    ]);
  });

  it('points each slot at a route in the map', () => {
    const declared = new Set<string>(Object.values(faithRoutes));
    for (const item of navigation) {
      expect({ key: item.key, declared: declared.has(item.href as string) }).toEqual({
        key: item.key,
        declared: true,
      });
    }
  });

  it('sends Worship to the worship record rather than the prayer schedule', () => {
    // These were the same destination while neither screen existed. They are different
    // things and the approved reference labels the slot "Worship".
    const worship = navigation.find((item) => item.key === 'worship');
    expect(worship?.href).toBe(faithRoutes.worship);
    expect(worship?.href).not.toBe(faithRoutes.prayerTimes);
  });
});
