import type { FaithRepositories } from '../index';
import { createMockDuaRepository } from './mock-dua.repository';
import { createMockFaithAiRepository } from './mock-faith-ai.repository';
import { createMockFaithCalendarRepository } from './mock-faith-calendar.repository';
import { createMockHadithRepository } from './mock-hadith.repository';
import { createMockMosqueRepository } from './mock-mosque.repository';
import { createMockPrayerTimesRepository } from './mock-prayer-times.repository';
import { createMockQuranRepository } from './mock-quran.repository';
import { createMockTasbihRepository } from './mock-tasbih.repository';
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
  return {
    quran: createMockQuranRepository(),
    hadith: createMockHadithRepository(),
    dua: createMockDuaRepository(),
    prayerTimes: createMockPrayerTimesRepository(),
    worship: createMockWorshipRepository(),
    calendar: createMockFaithCalendarRepository(),
    tasbih: createMockTasbihRepository(),
    mosque: createMockMosqueRepository(),
    ai: createMockFaithAiRepository(),
  };
}

export * from './mock-support';
export {
  createMockQuranRepository,
  mockAyatForTest,
  mockSurahsForTest,
} from './mock-quran.repository';
export { createMockHadithRepository, mockHadithsForTest } from './mock-hadith.repository';
export { createMockDuaRepository, mockDuasForTest } from './mock-dua.repository';
export { createMockPrayerTimesRepository, mockCitiesForTest } from './mock-prayer-times.repository';
export { createMockWorshipRepository, worshipSeedForTest } from './mock-worship.repository';
export {
  createMockFaithCalendarRepository,
  mockObservancesForTest,
} from './mock-faith-calendar.repository';
export { createMockTasbihRepository, dhikrPresetsForTest } from './mock-tasbih.repository';
export {
  createMockMosqueRepository,
  greatCircleBearing,
  greatCircleDistanceKm,
  kaabaForTest,
  mockMosquesForTest,
} from './mock-mosque.repository';
export {
  classifyFaithQuestion,
  createMockFaithAiRepository,
  faithAiQuotesForTest,
  faithAiSuggestionsForTest,
} from './mock-faith-ai.repository';
