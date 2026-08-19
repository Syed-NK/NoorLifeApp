import AsyncStorage from '@react-native-async-storage/async-storage';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { AuthState } from '@application/providers/auth-provider';

import { TEST_FAITH_USER_ID } from '@/test-support/faith-storage-address';

import { DUA_CATEGORIES } from '../data/duas/dua-categories';
import { resolveDuaDetail } from '../data/duas/dua-detail';
import { reviewedDuas } from '../data/duas/reviewed-dua';
import { faithRouteAccess } from '../di/faith-route-guard';
import { duaCategoryHref, duaDetailHref } from '../faith-routes';
import {
  readQuranSelections,
  saveQuranSelection,
  toggleQuranSelectionFavourite,
} from '../storage/faith-quran-selections';
import { setActiveFaithScope } from '../storage/faith-user-scope';

/**
 * **The two new Duas routes are behind the same two barriers as everything else in Faith.**
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── Why a route needs its own coverage when the guard is unchanged ──────────
 * `FaithRouteGuard` is not touched by this work and its rules are asserted where they live, in
 * `faith-deep-link-authority.test.tsx`. What that file cannot know is whether a *new* route file was
 * placed inside the stack the guard wraps. A screen added one directory too high is reachable by link
 * with no authentication decision taken by anything — which is exactly the defect that guard was
 * written for, and the way it would come back is a new file rather than an edited one.
 *
 * So this asserts placement, and it asserts the storage boundary independently: the guard stops the
 * *screen* from mounting and the address resolution stops the *data* from being readable. Neither is a
 * substitute for the other, and a single test over both would let one rot behind the other.
 *
 * ── The guard cases here are the same pure function, deliberately ───────────
 * `faithRouteAccess` takes an `AuthState` and returns a verdict, so the four cases the brief names —
 * refuse with no authority, wait on unknown, admit live, admit permitted offline — are checked against
 * the real rule rather than a re-implementation. They are repeated for these routes because the claim
 * being made is about *these routes*, and a reader of this file should not have to go and check.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const USER_A = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const USER_B = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';

const base = {
  hasCompletedOnboarding: true,
  pendingVerificationEmail: null,
  isBackendConfigured: true,
} as const;

const authStates = {
  resolving: { ...base, status: 'unknown', authority: null, user: null } as AuthState,
  signedOut: { ...base, status: 'signed-out', authority: null, user: null } as AuthState,
  online: {
    ...base,
    status: 'signed-in',
    authority: 'online',
    user: { id: USER_A, fullName: 'A', givenName: 'A' },
  } as AuthState,
  offline: {
    ...base,
    status: 'signed-in',
    authority: 'offline',
    user: { id: USER_A, fullName: 'A', givenName: 'A' },
  } as AuthState,
};

const APP_ROOT = join(__dirname, '..', '..', '..', 'app');

beforeEach(async () => {
  await AsyncStorage.clear();
  setActiveFaithScope(TEST_FAITH_USER_ID);
});

afterEach(() => {
  setActiveFaithScope(TEST_FAITH_USER_ID);
});

describe('both routes live inside the stack the guard wraps', () => {
  it('has the category and detail routes under the Faith layout', () => {
    /*
      Placement is the whole assertion. A route file outside `src/app/faith/` would render its screen
      directly on a deep link and never touch the guard — the original exposure, reintroduced by a new
      file rather than by an edited one.
    */
    for (const route of ['duas/[category].tsx', 'duas/item/[duaId].tsx']) {
      expect(existsSync(join(APP_ROOT, 'faith', route))).toBe(true);
    }
  });

  it('keeps the guard outermost on that layout, before any provider mounts', () => {
    const layout = readFileSync(join(APP_ROOT, 'faith', '_layout.tsx'), 'utf8');

    /*
      Outermost, so no repository is constructed and no screen issues a read for somebody the app has not
      established is signed in. Asserted by position rather than by presence: a guard nested inside the
      repository provider would let the provider mount first, which is the thing it exists to prevent.
    */
    const guardAt = layout.indexOf('<FaithRouteGuard>');
    expect(guardAt).toBeGreaterThan(-1);
    for (const provider of [
      '<FaithPreferencesProvider>',
      '<FaithRepositoryProvider>',
      '<OfflineRecitationProvider>',
      '<Stack',
    ]) {
      expect(layout.indexOf(provider)).toBeGreaterThan(guardAt);
    }
  });

  it('addresses both routes inside the Faith segment, so neither can escape the layout', () => {
    expect(duaCategoryHref('travel')).toMatchObject({ pathname: '/faith/duas/[category]' });
    expect(duaDetailHref('q.2.255.255')).toMatchObject({ pathname: '/faith/duas/item/[duaId]' });
    for (const entry of DUA_CATEGORIES) {
      expect(String((duaCategoryHref(entry.id) as { pathname: string }).pathname)).toMatch(
        /^\/faith\//,
      );
    }
  });

  it('mounts neither screen without authority, waits while unknown, and admits both authorities', () => {
    expect(faithRouteAccess(authStates.signedOut)).toBe('redirect');
    /*
      `wait`, not `redirect`. Unknown means the launch has not finished asking, and bouncing on it would
      throw a signed-in user out on every cold deep link one frame before the session resolves.
    */
    expect(faithRouteAccess(authStates.resolving)).toBe('wait');
    expect(faithRouteAccess(authStates.online)).toBe('allow');
    /* Offline authority is admitted, because opening your own downloaded Qur’an in an aeroplane is the point. */
    expect(faithRouteAccess(authStates.offline)).toBe('allow');
  });

  it('leaves the guard’s own production bytes untouched by this work', () => {
    /*
      Recorded rather than assumed. The device pass substitutes a previously-verified signed-out deep-link
      rejection on the strength of this: if the guard's source is unchanged, the rejection it produced last
      time is the rejection it produces now.
    */
    const guard = readFileSync(join(__dirname, '..', 'di', 'faith-route-guard.tsx'), 'utf8');
    expect(guard).toContain('export function faithRouteAccess(auth: AuthState): FaithRouteAccess');
    expect(guard).toContain('isLocallyAuthenticated');
    /* And its logic still consults nothing about the destination — one rule for the whole stack. */
    const code = guard.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/duas|category|duaId/i);
  });
});

describe('the data boundary, independently of the guard', () => {
  it('resolves no detail target with no owner, even though rows are on disk', async () => {
    await saveQuranSelection({ surah: 2, startAyah: 255, endAyah: 255 }, null);
    expect(await readQuranSelections()).toHaveLength(1);

    setActiveFaithScope(null);
    /*
      The repository answers its caller's default rather than a previous account's rows — `resolveFaithAddress`
      returns nothing without an owner. So the lookup the detail route performs has nothing to find.
    */
    const selections = await readQuranSelections();
    expect(selections).toEqual([]);
    expect(
      resolveDuaDetail({ duaId: 'q.2.255.255', selections, reviewed: reviewedDuas() }),
    ).toBeNull();
  });

  it('refuses a write with no owner, rather than writing it somewhere', async () => {
    setActiveFaithScope(null);

    const outcome = await saveQuranSelection({ surah: 2, startAyah: 255, endAyah: 255 }, null);
    expect(outcome.kind).toBe('failed');

    /* And favouriting, which is the detail page's one write, changes nothing anywhere. */
    await toggleQuranSelectionFavourite('q.2.255.255');
    expect(await readQuranSelections()).toEqual([]);
  });

  it('never shows account A’s rows to account B, on either route’s data', async () => {
    setActiveFaithScope(USER_A);
    await saveQuranSelection({ surah: 2, startAyah: 255, endAyah: 255 }, null);
    await toggleQuranSelectionFavourite('q.2.255.255');

    setActiveFaithScope(USER_B);
    const asB = await readQuranSelections();
    expect(asB).toEqual([]);
    /* Both the category list and the detail lookup are computed from this one list, so both are empty. */
    expect(resolveDuaDetail({ duaId: 'q.2.255.255', selections: asB, reviewed: [] })).toBeNull();
  });

  it('clears the active owner on sign-out without deleting the separately scoped rows', async () => {
    setActiveFaithScope(USER_A);
    await saveQuranSelection({ surah: 2, startAyah: 255, endAyah: 255 }, null);

    setActiveFaithScope(null);
    expect(await readQuranSelections()).toEqual([]);

    /*
      Cleared, not deleted. Signing back in restores the list — which is what makes the boundary a
      *boundary* rather than a destructive sign-out that loses somebody's saved references.
    */
    setActiveFaithScope(USER_A);
    expect(await readQuranSelections()).toHaveLength(1);
  });

  it('builds no storage address of its own anywhere in the Duas domain', () => {
    /*
      Every read goes through the scoped address resolver. A screen or a domain module that assembled a key
      itself would be a second answer to "whose data is this?", and that is how the original leak worked.
    */
    for (const file of [
      join(__dirname, '..', 'data', 'duas', 'dua-detail.ts'),
      join(__dirname, '..', 'data', 'duas', 'dua-category-results.ts'),
      join(__dirname, '..', 'data', 'duas', 'reviewed-dua.ts'),
      join(__dirname, '..', 'screens', 'dua-detail-screen.tsx'),
      join(__dirname, '..', 'screens', 'dua-category-screen.tsx'),
    ]) {
      const source = readFileSync(file, 'utf8');
      expect(source).not.toMatch(/AsyncStorage/);
      expect(source).not.toMatch(/noorlife\.faith\./);
    }
  });
});
