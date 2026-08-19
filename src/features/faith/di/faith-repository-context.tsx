import { createContext, useContext, useMemo, type ReactNode } from 'react';

import type { FaithRepositories } from '../data';
import { hasData } from '../data/faith-result';
import { formattedHijriForCalendarDay } from '../data/calendar-day';
import { createHijriCalendarRepository } from '../data/hijri/hijri-calendar.repository';
import { createExpoLocationPort } from '../data/location/expo-location.port';
import { createExpoNotificationPort } from '../data/notifications/expo-notifications.port';
import { createMockFaithRepositories } from '../data/mock';
import {
  createMockWorshipRepository,
  type WorshipTimeSource,
} from '../data/mock/mock-worship.repository';
import { createAdhanPrayerTimesRepository } from '../data/prayer/adhan-prayer-times.repository';
import { createProductionQuranRepository } from '../data/quran-foundation';
import { createOfflineQuranRepository } from '../data/offline/offline-quran.repository';
import { createRetainedQuranSource } from '../data/offline/retained-quran.source';
import { createLocalTasbihRepository } from '../data/tasbih/local-tasbih.repository';
import { readFaithPreferences } from '../storage/faith-preferences';

/**
 * Dependency injection for the Faith module.
 *
 * ── What this buys, concretely ──────────────────────────────────────────────
 * The phase requires that the future Quran Foundation implementation be swappable
 * "without changing presentation components". That is only true if no screen ever
 * imports a concrete repository. This context is the enforcement point: screens call
 * `useFaithRepositories()`, which returns an interface, and the only file that names a
 * concrete implementation is this one's default.
 *
 * A lint-visible consequence worth stating: if you find yourself importing anything from
 * `data/mock/` inside a screen, the swap has already been broken.
 *
 * ── Why the default is the mock rather than null ────────────────────────────
 * A null default would force every test and every route to wrap in a provider before
 * anything rendered, which in practice means people wrap at the top and forget the
 * seam exists. Defaulting to the mock keeps the app runnable with no provider, while
 * `FaithRepositoryProvider` remains the single place a different set is supplied.
 */
const FaithRepositoryContext = createContext<FaithRepositories | null>(null);

export type FaithRepositoryProviderProps = {
  /**
   * Overrides any subset of the repositories.
   *
   * Partial on purpose: a test that exercises the Tasbih screen should supply a Tasbih
   * repository and inherit the other eight, rather than constructing a full set it does
   * not care about.
   */
  readonly repositories?: Partial<FaithRepositories>;
  readonly children: ReactNode;
};

/**
 * Builds the repository set this build actually ships.
 *
 * ── The Qur'an repository is the one that is no longer a fixture ────────────
 * Quran Foundation approved production Content API access on 2026-08-10, so when a Supabase project
 * is configured the Qur'an repository is the approved adapter and the other eight remain fixtures
 * until their own sources are built. That asymmetry is the honest state of the product and is better
 * stated in one line here than implied by nine.
 *
 * ── Why the condition is configuration and not "is somebody signed in" ──────
 * Whether a session exists is asynchronous and changes while the app runs, so a provider that
 * branched on it would rebuild every repository on sign-out and hand screens a different object for
 * the same question. The adapter answers that question per request instead: no session yields an
 * `unauthorized` result the screen renders as "please sign in", which is honest and does not require
 * the tree to be reconstructed.
 *
 * ── What deliberately does not happen when the approved source fails ────────
 * There is **no fallback to the mock.** Once the approved repository is in place it stays in place:
 * an outage is an error state, an empty cache offline is an offline state, and a missing session is
 * an authentication state. Falling back would put unverified verses on screen at exactly the moment
 * nobody is watching for them — and the source badge, which reads the repository's own `source`,
 * would have already said "verified" before the swap happened.
 *
 * The only branch is whether an approved repository could be built at all. A build with no Supabase
 * project has no edge function to call, and `createProductionQuranRepository` answers `null` for it.
 *
 * ── The calendar is unconditionally real ────────────────────────────────────
 * `createHijriCalendarRepository` needs no backend and no approval: a Hijri date is arithmetic. It
 * therefore overrides the fixture in every build, including one with no Supabase project, because
 * there is no configuration under which a calculated date is worse than a hard-coded one. The
 * fixture it replaces returned 21 Dhul-Qadah 1446 AH to every caller on every day.
 */
function createFaithRepositories(): FaithRepositories {
  const mocks = createMockFaithRepositories();
  /**
   * Prayer times are calculated, unconditionally, for the same reason the calendar is.
   *
   * `adhan` needs no backend and no approval, and the fixture it replaces returned the design
   * reference's five times — 05:02, 12:35, 16:15, 20:44, 22:10 — for every location and every date.
   * There is no configuration under which that is preferable to a real calculation, so there is no
   * branch here.
   *
   * The location port is the real one. It raises no prompt on construction: `getPermission` reads
   * state, and only a control the user pressed reaches `requestPermission`.
   */
  const location = createExpoLocationPort();
  const prayerTimes = createAdhanPrayerTimesRepository({
    location,
    /*
      A calendar day in, a Hijri date out. No `Date`, so no zone, so nothing here can read a device
      getter — the crossing from an instant to a day already happened, once, inside the repository
      at `locationCalendarDay`. This line used to be
      `(date) => hijriDateFor(civilDateOf(date)).formatted`, and `civilDateOf` is the device-local
      read that put one day's Hijri date beside another day's prayer times.
    */
    hijriFor: formattedHijriForCalendarDay,
  });

  /**
   * The Hijri calendar takes no location wiring, because every date it produces is asked for one.
   *
   * ── What was here, and why it is gone ───────────────────────────────────────
   * A `todayCivilDate` resolver that cached the user's zone in the background and served the
   * *device's* calendar day until the lookup landed. That is a silent plausible-but-wrong fallback:
   * around midnight it could render one location's prayer times beside another location's Hijri
   * date, briefly, with nothing on screen to say so.
   *
   * The repository's methods now take a `PrayerLocation`, so the caller resolves once and both the
   * prayer times and the date derive from the same object. There is no window in which they can
   * disagree, no background cell to race, and no branch that can reach the device.
   */
  const calendar = createHijriCalendarRepository();

  /**
   * The approved adapter, wrapped so it reads what the device has already retained first.
   *
   * ── Why a wrapper and not a change to the adapter ─────────────────────────
   * The adapter is the approved Content API client and its shape is what the Quran Foundation
   * approval was granted against. Retention is a different permission, granted later, with its own
   * conditions — so it is a separate layer with its own file and its own tests, and removing it
   * leaves the approved adapter exactly as it was.
   *
   * The wrapper is applied whenever the approved adapter exists. With no published generation it is
   * a pass-through, so a build that has never synchronised behaves precisely as before.
   */
  const approvedQuran = createProductionQuranRepository();
  const quran =
    approvedQuran === null
      ? null
      : createOfflineQuranRepository(approvedQuran, createRetainedQuranSource());

  /**
   * The worship checklist's prayer times come from the same calculation the hero uses.
   *
   * ── Why this wiring exists ──────────────────────────────────────────────────
   * The checklist's seed used to carry `5:02 AM / 12:35 PM / 4:15 PM / 8:44 PM / 10:10 PM` — the
   * constants the deleted prayer-times fixture returned. They outlived that fixture, so Faith Home
   * showed a calculated next prayer in its hero and those five hard-coded ones in the worship card
   * directly below it: one screen, two different claims about the same day.
   *
   * ── Why it reads preferences from storage rather than taking them as an argument ──
   * Because the times have to agree with the hero's, and the hero calculates with the user's own
   * method and Asr convention. Calculating the checklist with defaults instead would have replaced
   * a visible contradiction with a subtler one — the same prayers, minutes apart, for no reason a
   * user could see.
   *
   * ── Why a denied location is not an error here ──────────────────────────────
   * `resolveCurrentLocation` reads permission state; it never prompts. Without a location there is
   * no calculation, so this resolves to an empty map and every prayer row renders its label and
   * tick state with no time — which is what the checklist is for. The user's own marks are on this
   * device and have nothing to do with whether the OS would give up a coordinate.
   */
  const worshipTimes: WorshipTimeSource = async (date) => {
    const resolved = await prayerTimes.resolveCurrentLocation();
    if (!hasData(resolved)) {
      return new Map();
    }
    const preferences = await readFaithPreferences();
    const day = await prayerTimes.getDailyTimes(resolved.data, date, {
      method: preferences.calculationMethod,
      asr: preferences.asrMethod,
      offsetsMinutes: {},
    });
    if (!hasData(day)) {
      return new Map();
    }
    return new Map(day.data.times.map((time) => [time.key, time.at]));
  };

  const base = {
    ...mocks,
    calendar,
    prayerTimes,
    location,
    notifications: createExpoNotificationPort(),
    /**
     * Constructed here rather than taken from the spread above.
     *
     * ── The leak this closes ──────────────────────────────────────────────
     * `...mocks` is `createMockFaithRepositories()`, and whatever that set happens to supply for a
     * key nothing below overrides becomes production's implementation. Tasbih reached production
     * that way — as `mock-tasbih.repository.ts`, shipping five built-in dhikr with no recorded
     * provenance. Nothing was wrong with the wiring in the sense of failing; it simply meant a
     * development fixture decided what a production screen rendered.
     *
     * Naming it here makes the production choice explicit, so a future key added to the development
     * set cannot silently become production behaviour for this one. `local-tasbih.repository.ts` is
     * the real implementation and lives at a production path.
     */
    tasbih: createLocalTasbihRepository(),
    worship: createMockWorshipRepository(worshipTimes),
  };
  return quran === null ? base : { ...base, quran };
}

export function FaithRepositoryProvider({ repositories, children }: FaithRepositoryProviderProps) {
  const value = useMemo<FaithRepositories>(
    () => ({ ...createFaithRepositories(), ...repositories }),
    [repositories],
  );

  return (
    <FaithRepositoryContext.Provider value={value}>{children}</FaithRepositoryContext.Provider>
  );
}

/**
 * The Faith data sources for the current tree.
 *
 * Falls back to the mock set when no provider is mounted, so a route file does not have
 * to wrap itself. The returned object is stable across renders within a provider, which
 * matters because these go into effect dependency arrays.
 */
export function useFaithRepositories(): FaithRepositories {
  const injected = useContext(FaithRepositoryContext);
  // Module-level singleton so the no-provider path is referentially stable too —
  // building a fresh set per render would re-run every data effect forever.
  return injected ?? defaultRepositories;
}

const defaultRepositories: FaithRepositories = createFaithRepositories();
