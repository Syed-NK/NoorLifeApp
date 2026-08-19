import type { FaithRepositories } from '../index';
import { createHijriCalendarRepository } from '../hijri/hijri-calendar.repository';
import { createMockFaithAiRepository } from './mock-faith-ai.repository';
import { createExpoLocationPort } from '../location/expo-location.port';
import { createFakeNotificationPort } from '../notifications/fake-notification.port';
import { createAdhanPrayerTimesRepository } from '../prayer/adhan-prayer-times.repository';
import { formattedHijriForCalendarDay } from '../calendar-day';
import {
  createUnconfiguredDuaRepository,
  createUnconfiguredHadithRepository,
  createUnconfiguredMosqueRepository,
} from '../unconfigured-content.repository';
import { createMockQuranRepository } from './mock-quran.repository';
import { sharedRetainedQuranSource } from '../offline/retained-quran.source';
import { createLocalTasbihRepository } from '../tasbih/local-tasbih.repository';
import { createMockWorshipRepository } from './mock-worship.repository';

/**
 * The development repository set.
 *
 * ── The one file allowed to name concrete implementations ───────────────────
 * Screens depend on interfaces and reach them through `useFaithRepositories()`. This
 * factory and `FaithRepositoryProvider` are the only places a concrete class appears.
 * When Quran Foundation access is approved, `quran:` below becomes the real adapter and
 * nothing else in the module changes — that is the swap the phase asks for, and keeping
 * the naming confined to one line is what makes it a one-line swap.
 *
 * Content mocks are stateless and could be module constants; the tasbih and worship
 * mocks read and write AsyncStorage, so a fresh set per call keeps tests isolated when
 * they clear storage between cases.
 */
export function createMockFaithRepositories(): FaithRepositories {
  /**
   * One port instance, shared by the prayer repository and by the screens.
   *
   * Two instances would be two permission states in the same tree: a screen could believe it had
   * just been granted location while the repository, holding a different object, had not asked.
   */
  const location = createExpoLocationPort();

  return {
    location,
    /*
      An in-memory notification port, for the same reason the Qur'an and Hadith repositories are not
      the real ones here: a development fixture must not raise a system permission prompt, and a
      Jest run must not depend on a native module. `createFakeNotificationPort` is a real stateful
      implementation, so schedule/cancel/list behave as the service expects.
    */
    notifications: createFakeNotificationPort(),
    quran: createMockQuranRepository(),
    /**
     * The real retained source, even in the development set — and it is not a fixture.
     *
     * It reads the published generation and answers `null` when there is none, which on a machine
     * that has never synchronised is every time. A mock here would have to invent verses to be
     * useful, and inventing scripture for a development convenience is the one thing this module
     * does not do. Tests that need retained content supply their own through the provider.
     */
    retainedQuran: sharedRetainedQuranSource(),
    /**
     * Not mocks, and for the same reason as the calendar and the prayer times below.
     *
     * The fixtures these replace held graded narrations with real references and Arabic
     * supplications rendered at display size. Both are religious text a user may act on or recite,
     * and neither had been checked against a critical edition. They are deleted rather than kept —
     * see `data/unconfigured-content.repository.ts`.
     */
    hadith: createUnconfiguredHadithRepository(),
    dua: createUnconfiguredDuaRepository(),
    /**
     * Also not a mock, and for the same reason as the calendar.
     *
     * The fixture this replaces returned the design reference's five times — 05:02, 12:35, 16:15,
     * 20:44, 22:10 — for every coordinate and every date. It has been deleted rather than kept
     * behind a flag: a fabricated prayer time is the single most checkable false statement this app
     * could make, and a fixture that still exists is a fixture something can be wired back to.
     *
     * With no location granted this answers `permission-required`, which is the correct first-run
     * state and the one every screen renders a "set your location" affordance for.
     */
    prayerTimes: createAdhanPrayerTimesRepository({
      location,
      // A calendar day in, a Hijri date out — see `data/calendar-day.ts`. No `Date`, so no zone to
      // misread. This was `(date) => hijriDateFor(civilDateOf(date)).formatted`, the device-local read.
      hijriFor: formattedHijriForCalendarDay,
    }),
    worship: createMockWorshipRepository(),
    /**
     * Not a mock, and deliberately not given one.
     *
     * A Hijri date is arithmetic, so there is no configuration in which a fixture is preferable —
     * see `hijri/hijri-calendar.repository.ts`. Wiring the real implementation here as well as in
     * the DI means a test that takes the "mock set" still gets correct dates rather than a
     * fabricated May 2025.
     */
    calendar: createHijriCalendarRepository(),
    /**
     * Not a mock, and no longer able to be one.
     *
     * The counting engine is real — it persists, serialises its mutations and survives a force-stop
     * — and the five built-in dhikr that made this a fixture have been removed for want of any
     * recorded provenance. It lives at `data/tasbih/` now, so a development set cannot supply
     * religious content the production set would not.
     */
    tasbih: createLocalTasbihRepository(),
    /**
     * Also not a mock. The fixture listed two invented mosques with street addresses, facility
     * lists and distances in metres — a directional claim a user could act on by walking to an
     * address that does not exist. `getQiblaBearing` survives on this implementation because it is
     * trigonometry rather than a directory.
     */
    mosque: createUnconfiguredMosqueRepository(),
    ai: createMockFaithAiRepository(),
  };
}

export * from './mock-support';
export {
  createMockQuranRepository,
  mockAyatForTest,
  mockSurahsForTest,
} from './mock-quran.repository';
export { createMockWorshipRepository, worshipSeedForTest } from './mock-worship.repository';
export { createHijriCalendarRepository } from '../hijri/hijri-calendar.repository';
export { createAdhanPrayerTimesRepository } from '../prayer/adhan-prayer-times.repository';
export { createLocalTasbihRepository, DEFAULT_COUNTER } from '../tasbih/local-tasbih.repository';
/*
  The Hadith, Dua and mosque fixtures that used to be re-exported here are gone. Their replacements
  hold no content, so there is no `…ForTest` array to expose.
*/
export {
  createUnconfiguredDuaRepository,
  createUnconfiguredHadithRepository,
  createUnconfiguredMosqueRepository,
} from '../unconfigured-content.repository';
/*
  Re-exported from their new home so existing importers keep working. The Qibla maths is not mock
  data and no longer lives in this directory — see `data/qibla/qibla.ts`.
*/
export { greatCircleBearing, greatCircleDistanceKm, KAABA } from '../qibla/qibla';
/*
  `faithAiQuotesForTest` is gone with the quote set it exposed. The assistant produces no quotes, so
  there is no fixture for a test to reach for — see the note at the top of `mock-faith-ai.repository`.
*/
export {
  classifyFaithQuestion,
  createMockFaithAiRepository,
  faithAiSuggestionsForTest,
} from './mock-faith-ai.repository';
