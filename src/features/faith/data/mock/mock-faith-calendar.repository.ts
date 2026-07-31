import type {
  CalendarMonth,
  FaithCalendarRepository,
  HijriDate,
  Observance,
} from '../faith-calendar.repository';
import type { FaithResult } from '../faith-result';
import { delay } from './mock-support';

/**
 * Local Hijri calendar fixtures.
 *
 * Every date is marked `basis: 'calculated'`, never `'confirmed-sighting'`. The mock has
 * no sighting authority to defer to, and claiming one would be exactly the overstatement
 * the `basis` field exists to prevent. The UI renders calculated observances as
 * "expected".
 *
 * Values match the approved reference: 21 Dhul-Qadah 1446 AH / 19 May 2025, with Ramadan
 * 1447 as the next observance.
 */

const TODAY_HIJRI: HijriDate = {
  day: 21,
  month: 11,
  monthName: 'Dhul-Qadah',
  year: 1446,
  formatted: '21 Dhul-Qadah 1446 AH',
  basis: 'calculated',
};

const OBSERVANCES: readonly Observance[] = [
  {
    id: 'ramadan-1447',
    name: 'Ramadan 1446 AH',
    kind: 'ramadan',
    hijri: {
      day: 1,
      month: 9,
      monthName: 'Ramadan',
      year: 1447,
      formatted: '1 Ramadan 1447 AH',
      basis: 'calculated',
    },
    gregorian: '2026-03-01',
    daysUntil: 296,
    description: 'The month of fasting begins, subject to local moon sighting.',
  },
  {
    id: 'eid-fitr-1447',
    name: 'Eid al-Fitr',
    kind: 'eid',
    hijri: {
      day: 1,
      month: 10,
      monthName: 'Shawwal',
      year: 1447,
      formatted: '1 Shawwal 1447 AH',
      basis: 'calculated',
    },
    gregorian: '2026-03-31',
    daysUntil: 326,
    description: 'The festival marking the end of Ramadan.',
  },
  {
    id: 'hajj-1447',
    name: 'Day of Arafah',
    kind: 'hajj',
    hijri: {
      day: 9,
      month: 12,
      monthName: 'Dhul-Hijjah',
      year: 1447,
      formatted: '9 Dhul-Hijjah 1447 AH',
      basis: 'calculated',
    },
    gregorian: '2026-06-06',
    daysUntil: 393,
    description: 'The second day of Hajj, and a recommended fast for those not on pilgrimage.',
  },
  {
    id: 'ashura-1448',
    name: 'Day of Ashura',
    kind: 'ashura',
    hijri: {
      day: 10,
      month: 1,
      monthName: 'Muharram',
      year: 1448,
      formatted: '10 Muharram 1448 AH',
      basis: 'calculated',
    },
    gregorian: '2026-06-26',
    daysUntil: 413,
    description: 'A recommended fast on the tenth of Muharram.',
  },
];

export function createMockFaithCalendarRepository(): FaithCalendarRepository {
  return {
    async getToday(): Promise<
      FaithResult<{ readonly hijri: HijriDate; readonly gregorian: string }>
    > {
      return delay({
        kind: 'ok' as const,
        data: { hijri: TODAY_HIJRI, gregorian: '2025-05-19' },
      });
    },

    async getMonth(hijriYear: number, hijriMonth: number): Promise<FaithResult<CalendarMonth>> {
      const monthName = hijriMonth === 11 ? 'Dhul-Qadah' : `Month ${hijriMonth}`;
      const days = Array.from({ length: 30 }, (_, index) => {
        const day = index + 1;
        const gregorianDay = new Date('2025-04-29T00:00:00Z');
        gregorianDay.setUTCDate(gregorianDay.getUTCDate() + index);
        return {
          hijri: {
            day,
            month: hijriMonth,
            monthName,
            year: hijriYear,
            formatted: `${day} ${monthName} ${hijriYear} AH`,
            basis: 'calculated' as const,
          },
          gregorian: gregorianDay.toISOString().slice(0, 10),
          observanceIds: [] as readonly string[],
        };
      });
      return delay({
        kind: 'ok' as const,
        data: { hijriMonth, hijriYear, monthName, days },
      });
    },

    async getNextObservance(): Promise<FaithResult<Observance>> {
      return delay({ kind: 'ok' as const, data: OBSERVANCES[0]! });
    },

    async listUpcomingObservances(limit = 10): Promise<FaithResult<readonly Observance[]>> {
      return delay({ kind: 'ok' as const, data: OBSERVANCES.slice(0, limit) });
    },

    async convertGregorian(date: string): Promise<FaithResult<HijriDate>> {
      void date;
      return delay({ kind: 'ok' as const, data: TODAY_HIJRI });
    },
  };
}

export const mockObservancesForTest = OBSERVANCES;
