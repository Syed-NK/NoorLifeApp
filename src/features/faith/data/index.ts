import type { DuaRepository } from './dua.repository';
import type { FaithAiRepository } from './faith-ai.repository';
import type { FaithCalendarRepository } from './faith-calendar.repository';
import type { LocationPort } from './location/location.port';
import type { NotificationPort } from './notifications/notification.port';
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
  /**
   * The device's location and compass.
   *
   * ── Why a port sits alongside eight repositories ────────────────────────────
   * It is not a repository — it answers no domain question and returns no domain type. It is here
   * because it is the seam a *screen* needs: prayer times and the Qibla both have to raise a
   * permission prompt in response to a control the user pressed, and a prompt raised from inside a
   * repository would fire on render, unasked.
   *
   * Bundling it means a test replaces one object to reach denied permission, a device with no
   * compass, and a heading too poorly calibrated to trust — none of which are reachable through the
   * real module in Jest.
   */
  readonly location: LocationPort;
  /**
   * Local notifications, for prayer alerts.
   *
   * Alongside the location port and for the same reason: it raises a permission prompt, so it has to
   * be replaceable in a test, and the prompt has to be traceable to one control the user pressed.
   * Nothing here schedules anything on its own — see `prayer-notifications.service.ts`.
   */
  readonly notifications: NotificationPort;
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
export * from './location/location.port';
