import type { FaithResult } from '../faith-result';
import type {
  DailyPrayerTimes,
  NextPrayer,
  PrayerCalculationSettings,
  PrayerKey,
  PrayerLocation,
  PrayerNotificationPreference,
  PrayerTime,
  PrayerTimesRepository,
} from '../prayer-times.repository';
import { readFaithPreferences, writeFaithPreferences } from '../../storage/faith-preferences';
import { delay, matches, todayIso } from './mock-support';

/**
 * Local prayer-time fixtures.
 *
 * ── What is real and what is not ────────────────────────────────────────────
 * The *times* are the approved reference's times, held fixed. They are not calculated
 * from a coordinate, and this mock does not implement any astronomical algorithm —
 * doing so would produce numbers that look authoritative while being unvalidated, which
 * for prayer times is worse than obviously-sample data. The real implementation will
 * either call a vetted service or use an audited library.
 *
 * What *is* real is the shape: a resolved location, a calculation method, per-prayer
 * offsets, and a next-prayer derivation that the UI counts down against. That is what the
 * screens need to be built correctly.
 *
 * Notification preferences persist through `faith-preferences`, so toggling a reminder
 * survives a restart even though nothing is scheduled with the OS yet.
 */

const DEFAULT_LOCATION: PrayerLocation = {
  coordinate: { latitude: 53.4808, longitude: -2.2426 },
  label: 'Manchester, United Kingdom',
  timeZone: 'Europe/London',
  manual: false,
};

const CITIES: readonly PrayerLocation[] = [
  DEFAULT_LOCATION,
  {
    coordinate: { latitude: 51.5072, longitude: -0.1276 },
    label: 'London, United Kingdom',
    timeZone: 'Europe/London',
    manual: true,
  },
  {
    coordinate: { latitude: 21.4225, longitude: 39.8262 },
    label: 'Makkah, Saudi Arabia',
    timeZone: 'Asia/Riyadh',
    manual: true,
  },
  {
    coordinate: { latitude: 41.0082, longitude: 28.9784 },
    label: 'Istanbul, Türkiye',
    timeZone: 'Europe/Istanbul',
    manual: true,
  },
  {
    coordinate: { latitude: 40.7128, longitude: -74.006 },
    label: 'New York, United States',
    timeZone: 'America/New_York',
    manual: true,
  },
];

/** Reference times from `03-faith.png`, as local wall-clock. */
const BASE_TIMES: readonly {
  readonly key: PrayerKey;
  readonly label: string;
  readonly hhmm: string;
}[] = [
  { key: 'fajr', label: 'Fajr', hhmm: '05:02' },
  { key: 'sunrise', label: 'Sunrise', hhmm: '06:31' },
  { key: 'dhuhr', label: 'Dhuhr', hhmm: '12:35' },
  { key: 'asr', label: 'Asr', hhmm: '16:15' },
  { key: 'maghrib', label: 'Maghrib', hhmm: '20:44' },
  { key: 'isha', label: 'Isha', hhmm: '22:10' },
];

function buildTimes(date: string, settings: PrayerCalculationSettings): readonly PrayerTime[] {
  return BASE_TIMES.map((entry) => {
    const offset = settings.offsetsMinutes[entry.key] ?? 0;
    const [h, m] = entry.hhmm.split(':').map(Number);
    const at = new Date(`${date}T00:00:00`);
    at.setHours(h!, m! + offset, 0, 0);
    return { key: entry.key, label: entry.label, at: at.toISOString() };
  });
}

export function createMockPrayerTimesRepository(): PrayerTimesRepository {
  return {
    async resolveCurrentLocation(): Promise<FaithResult<PrayerLocation>> {
      const prefs = await readFaithPreferences();
      if (prefs.locationLabel !== null) {
        const chosen = CITIES.find((city) => city.label === prefs.locationLabel);
        if (chosen !== undefined) {
          return delay({ kind: 'ok' as const, data: chosen });
        }
      }
      // The mock grants location so the happy path is reachable without a device prompt.
      // The `permission-required` branch is exercised by the Qibla and Mosques screens,
      // which is where the phase requires that state to be visible.
      return delay({ kind: 'ok' as const, data: DEFAULT_LOCATION });
    },

    async searchLocations(query: string): Promise<FaithResult<readonly PrayerLocation[]>> {
      const trimmed = query.trim();
      if (trimmed.length < 2) {
        return delay({ kind: 'no-results' as const, query: trimmed }, 60);
      }
      const hits = CITIES.filter((city) => matches(city.label, trimmed));
      if (hits.length === 0) {
        return delay({ kind: 'no-results' as const, query: trimmed });
      }
      return delay({ kind: 'ok' as const, data: hits });
    },

    async getDailyTimes(
      location: PrayerLocation,
      date: string,
      settings: PrayerCalculationSettings,
    ): Promise<FaithResult<DailyPrayerTimes>> {
      return delay({
        kind: 'ok' as const,
        data: {
          date,
          hijriDate: '21 Dhul-Qadah 1446 AH',
          location,
          settings,
          times: buildTimes(date, settings),
        },
      });
    },

    async getMonthlyTimes(
      location: PrayerLocation,
      month: string,
      settings: PrayerCalculationSettings,
    ): Promise<FaithResult<readonly DailyPrayerTimes[]>> {
      const days = Array.from({ length: 30 }, (_, index) => {
        const date = `${month}-${String(index + 1).padStart(2, '0')}`;
        return {
          date,
          hijriDate: `${index + 1} Dhul-Qadah 1446 AH`,
          location,
          settings,
          times: buildTimes(date, settings),
        };
      });
      return delay({ kind: 'ok' as const, data: days });
    },

    async getNextPrayer(
      location: PrayerLocation,
      settings: PrayerCalculationSettings,
    ): Promise<FaithResult<NextPrayer>> {
      const times = buildTimes(todayIso(), settings).filter((time) => time.key !== 'sunrise');
      const now = Date.now();
      const upcoming = times.find((time) => new Date(time.at).getTime() > now) ?? times[0]!;
      const minutesUntil = Math.max(0, Math.round((new Date(upcoming.at).getTime() - now) / 60000));
      void location;
      return delay({ kind: 'ok' as const, data: { prayer: upcoming, minutesUntil } });
    },

    async readNotificationPreferences(): Promise<
      FaithResult<readonly PrayerNotificationPreference[]>
    > {
      const prefs = await readFaithPreferences();
      return { kind: 'ok', data: prefs.prayerNotifications };
    },

    async writeNotificationPreferences(
      preferences: readonly PrayerNotificationPreference[],
    ): Promise<FaithResult<readonly PrayerNotificationPreference[]>> {
      const next = await writeFaithPreferences({ prayerNotifications: preferences });
      return { kind: 'ok', data: next.prayerNotifications };
    },
  };
}

export const mockCitiesForTest = CITIES;
