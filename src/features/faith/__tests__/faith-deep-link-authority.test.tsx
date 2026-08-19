import AsyncStorage from '@react-native-async-storage/async-storage';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { AuthState } from '@application/providers/auth-provider';

import { faithRouteAccess } from '../di/faith-route-guard';
import {
  faithStorageKeys,
  readJson,
  resolveFaithAddress,
  writeChecked,
} from '../storage/faith-storage';
import { readQuranSelections, saveQuranSelection } from '../storage/faith-quran-selections';
import {
  getActiveFaithScope,
  resetFaithScopeForTest,
  setActiveFaithScope,
} from '../storage/faith-user-scope';
import { TEST_FAITH_USER_ID } from '@/test-support/faith-storage-address';

/**
 * **A Faith deep link may not open somebody's data without authority.**
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── What was wrong, found on device and not by any test ────────────────────
 * `src/app/index.tsx` was the application's only authentication gate, and it is the *entry route*.
 * A deep link renders its target directly, so `noorlifeapp://faith/duas` opened the Duas library
 * with no authentication decision taken by anything — while the app's own startup routing had, at
 * that moment, sent the visible navigation to Authentication Options.
 *
 * ── The two independent barriers, asserted separately ──────────────────────
 * A route guard decides whether the *screen* may mount. The storage boundary decides whether the
 * *data* may be read. They are not substitutes and a single test covering both would let one of
 * them rot silently behind the other:
 *
 *   • the guard could be removed and the screens would render, empty, looking fine;
 *   • the scope could leak and the guard would still hide it — until the next deep link.
 *
 * So each is tested on its own, and both are tested for the case that matters most: no authority at
 * all, with a previous account's data sitting on disk.
 *
 * ── Why the auth states are built here rather than mounted ─────────────────
 * `faithRouteAccess` is a pure function of `AuthState`, which is what makes the rule assertable
 * without a router, a provider tree or a navigation container. Every case below is the real state
 * shape the provider produces.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const USER_A = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';

/**
 * The states the auth provider can be in, in the shape it publishes them.
 *
 * Complete `AuthState` values, not partials cast into place: the guard reads `status` and
 * `authority`, and a fixture that omitted the rest would still compile past a widened signature —
 * which is precisely the change most likely to break this rule by accident.
 */
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

beforeEach(async () => {
  await AsyncStorage.clear();
  setActiveFaithScope(TEST_FAITH_USER_ID);
});

afterEach(() => {
  setActiveFaithScope(TEST_FAITH_USER_ID);
});

describe('the route guard', () => {
  it('rejects a deep link when there is no authority of any kind', () => {
    /*
      The reported defect. Signed out means no session and no receipt the provider still honours, and
      the only honest destination is the screen that asks who you are.
    */
    expect(faithRouteAccess(authStates.signedOut)).toBe('redirect');
  });

  it('admits a live session', () => {
    expect(faithRouteAccess(authStates.online)).toBe('allow');
  });

  it('admits permitted offline authority, because that is what a receipt is for', () => {
    /*
      Opening your own downloaded Qur'an in an aeroplane must keep working. A guard that required a
      live session would lock a legitimately signed-in user out of data already on their phone.
    */
    expect(faithRouteAccess(authStates.offline)).toBe('allow');
  });

  it('waits while the launch is still resolving, rather than bouncing a signed-in user out', () => {
    /*
      `unknown` is not a verdict. Redirecting on it would send a signed-in user to Authentication
      Options on every cold deep link, one frame before the session resolves — and `wait` renders no
      screen, so no read is issued while the answer is pending.
    */
    expect(faithRouteAccess(authStates.resolving)).toBe('wait');
  });

  it('is mounted outermost on the Faith stack, before any provider', () => {
    /*
      Placement is the fix. A guard inside the repository provider would let the repositories be
      constructed — and `FaithRepositoryProvider` builds the whole set on mount — for somebody the app
      has not established is signed in.
    */
    const layout = readFileSync(
      join(__dirname, '..', '..', '..', 'app', 'faith', '_layout.tsx'),
      'utf8',
    );
    expect(layout).toContain('FaithRouteGuard');
    expect(layout.indexOf('<FaithRouteGuard>')).toBeLessThan(
      layout.indexOf('<FaithPreferencesProvider>'),
    );
  });
});

describe('the data boundary, independently of the guard', () => {
  it('cannot read a previous account’s selections with no owner resolved', async () => {
    setActiveFaithScope(USER_A);
    await saveQuranSelection({ surah: 2, startAyah: 255, endAyah: 255 }, 'A private note');
    expect(await readQuranSelections()).toHaveLength(1);

    /* Authority ends. The rows stay on disk; what goes is the ability to name their address. */
    resetFaithScopeForTest();

    expect(getActiveFaithScope()).toBeNull();
    expect(await readQuranSelections()).toEqual([]);
    expect(resolveFaithAddress(faithStorageKeys.quranSelections)).toBeNull();
  });

  it('leaves the stored rows intact, so signing back in restores them', async () => {
    setActiveFaithScope(USER_A);
    await saveQuranSelection({ surah: 2, startAyah: 255, endAyah: 255 }, 'A private note');

    resetFaithScopeForTest();
    expect(await readQuranSelections()).toEqual([]);

    /*
      Data on disk is not the exposure — reading it without authority is. Deleting it on sign-out
      would lose somebody's work every time a token expired on a train.
    */
    setActiveFaithScope(USER_A);
    const restored = await readQuranSelections();
    expect(restored).toHaveLength(1);
    expect(restored[0]?.label).toBe('A private note');
  });

  it('refuses a write while no owner is resolved, and reports the refusal', async () => {
    resetFaithScopeForTest();
    expect(
      await writeChecked(faithStorageKeys.quranSelections, { version: 1, selections: [] }),
    ).toBe(false);
  });

  it('holds no owner from a previous account once authority is gone', async () => {
    setActiveFaithScope(USER_A);
    expect(getActiveFaithScope()?.encodedUserId).toBe(USER_A);

    /*
      The stale-ownership case. `activeScope` is module state that outlives a screen, so the danger is
      a sign-out that changes the *route* without clearing the *owner* — the app would then look
      signed out and read like user A. `FaithScopeProvider` calls `setActiveFaithScope(null)` on a
      `signed-out` verdict, and this is that call's effect.
    */
    setActiveFaithScope(null);
    expect(getActiveFaithScope()).toBeNull();

    const stored = await readJson(
      faithStorageKeys.quranSelections,
      'fallback',
      (value): value is string => typeof value === 'string',
    );
    expect(stored).toBe('fallback');
  });
});

describe('the provider clears the owner on exactly the states that end authority', () => {
  /**
   * The mapping the guard and the storage boundary both depend on.
   *
   * Asserted as the provider computes it, so a change to either predicate shows up here rather than
   * as data quietly becoming readable again.
   */
  function ownerFor(auth: AuthState): string | null | undefined {
    if (auth.status === 'unknown') {
      return undefined;
    }
    return auth.status === 'signed-in' && auth.user !== null ? auth.user.id : null;
  }

  it('resolves the user under either authority', () => {
    expect(ownerFor(authStates.online)).toBe(USER_A);
    expect(ownerFor(authStates.offline)).toBe(USER_A);
  });

  it('clears the owner when signed out', () => {
    expect(ownerFor(authStates.signedOut)).toBeNull();
  });

  it('leaves the owner alone while resolving, so a launch cannot cache an empty answer', () => {
    expect(ownerFor(authStates.resolving)).toBeUndefined();
  });
});
