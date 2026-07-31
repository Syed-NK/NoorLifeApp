import type { DuaRepository } from './dua.repository';
import type { FaithAiRepository } from './faith-ai.repository';
import type { FaithCalendarRepository } from './faith-calendar.repository';
import type { HadithRepository } from './hadith.repository';
import type { MosqueRepository } from './mosque.repository';
import type { PrayerTimesRepository } from './prayer-times.repository';
import type { QuranContentRepository } from './quran-content.repository';
import type { TasbihRepository } from './tasbih.repository';
import type { WorshipRepository } from './worship.repository';

/**
 * The complete set of Faith data sources.
 *
 * Bundling them means a screen declares one dependency and a test swaps one object.
 * The alternative — nine separate contexts — would make partial overrides in tests
 * verbose enough that people would stop writing them.
 */
export type FaithRepositories = {
  readonly quran: QuranContentRepository;
  readonly hadith: HadithRepository;
  readonly dua: DuaRepository;
  readonly prayerTimes: PrayerTimesRepository;
  readonly worship: WorshipRepository;
  readonly calendar: FaithCalendarRepository;
  readonly tasbih: TasbihRepository;
  readonly mosque: MosqueRepository;
  readonly ai: FaithAiRepository;
};

export * from './faith-result';
export * from './quran-content.repository';
export * from './hadith.repository';
export * from './dua.repository';
export * from './prayer-times.repository';
export * from './worship.repository';
export * from './faith-calendar.repository';
export * from './tasbih.repository';
export * from './mosque.repository';
export * from './faith-ai.repository';
