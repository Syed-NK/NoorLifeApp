import type { FaithResult } from '../faith-result';
import type {
  WorshipDay,
  WorshipEntry,
  WorshipEntryStatus,
  WorshipRepository,
  WorshipSummary,
} from '../worship.repository';
import { faithStorageKeys, isRecord, readJson, writeJson } from '../../storage/faith-storage';
import { delay, nowIso, todayIso } from './mock-support';

/**
 * The worship checklist, persisted on device.
 *
 * ── Genuinely persistent, not a fixture ─────────────────────────────────────
 * Unlike the content mocks, this one really stores what the user marks. Ticking Asr and
 * killing the app leaves Asr ticked. That matters because the phase asks for a working
 * checklist with "local/Supabase-ready persistence", and a checklist that forgets is not
 * a checklist.
 *
 * ── The shape on disk ───────────────────────────────────────────────────────
 * `Record<isoDate, Record<entryKey, {status, completedAt}>>` — an overlay, not a copy of
 * the whole day. The day's *structure* (which prayers exist, at what times) comes from
 * the seed below; only the user's marks are stored. That keeps the stored blob small and
 * means a change to the seed does not have to migrate every stored day.
 */

type StoredMark = { readonly status: WorshipEntryStatus; readonly completedAt: string | null };
type StoredDays = Record<string, Record<string, StoredMark>>;

function isStoredDays(value: unknown): value is StoredDays {
  if (!isRecord(value)) {
    return false;
  }
  return Object.values(value).every(isRecord);
}

/** The day's trackable acts, matching the approved reference's Today's Worship card. */
const SEED: readonly Omit<WorshipEntry, 'status' | 'completedAt'>[] = [
  { key: 'fajr', label: 'Fajr Prayer', kind: 'prayer', prayer: 'fajr', detail: '5:02 AM' },
  { key: 'dhuhr', label: 'Dhuhr Prayer', kind: 'prayer', prayer: 'dhuhr', detail: '12:35 PM' },
  { key: 'asr', label: 'Asr Prayer', kind: 'prayer', prayer: 'asr', detail: '4:15 PM' },
  { key: 'maghrib', label: 'Maghrib Prayer', kind: 'prayer', prayer: 'maghrib', detail: '8:44 PM' },
  { key: 'isha', label: 'Isha Prayer', kind: 'prayer', prayer: 'isha', detail: '10:10 PM' },
  { key: 'adhkar', label: 'Morning Adhkar', kind: 'adhkar', detail: 'Completed' },
  { key: 'quran', label: 'Qur’an reading', kind: 'quran', detail: 'Daily portion' },
];

/**
 * The default status for an unmarked entry.
 *
 * Derived from the clock rather than stored, so an untouched day reads correctly whenever
 * it is opened: past prayers show as missed, the current window shows as current, later
 * ones as upcoming. Storing a status for every entry up front would freeze the day at
 * whatever time it was first opened.
 */
function defaultStatus(entryKey: string, isToday: boolean): WorshipEntryStatus {
  if (!isToday) {
    return 'upcoming';
  }
  const order = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];
  const index = order.indexOf(entryKey);
  if (index === -1) {
    return 'upcoming';
  }
  const hours = [5, 12, 16, 20, 22];
  const nowHour = new Date().getHours();
  const start = hours[index]!;
  const next = hours[index + 1] ?? 24;
  if (nowHour >= start && nowHour < next) {
    return 'current';
  }
  return nowHour >= next ? 'missed' : 'upcoming';
}

async function buildDay(date: string): Promise<WorshipDay> {
  const stored = await readJson(faithStorageKeys.worshipDays, {} as StoredDays, isStoredDays);
  const marks = stored[date] ?? {};
  const isToday = date === todayIso();

  const seeded: WorshipEntry[] = SEED.map((entry) => {
    const mark = marks[entry.key];
    return {
      ...entry,
      status: mark?.status ?? defaultStatus(entry.key, isToday),
      completedAt: mark?.completedAt ?? null,
    };
  });

  // Custom entries live only in the overlay, so they appear after the seeded acts.
  const customKeys = Object.keys(marks).filter((key) => !SEED.some((entry) => entry.key === key));
  const custom: WorshipEntry[] = customKeys.map((key) => ({
    key,
    label: key.replace(/^custom:/, ''),
    kind: 'custom',
    detail: 'Added by you',
    status: marks[key]!.status,
    completedAt: marks[key]!.completedAt,
  }));

  const entries = [...seeded, ...custom];
  return {
    date,
    entries,
    completed: entries.filter((entry) => entry.status === 'completed').length,
    total: entries.length,
  };
}

async function writeMark(date: string, entryKey: string, mark: StoredMark | null): Promise<void> {
  const stored = await readJson(faithStorageKeys.worshipDays, {} as StoredDays, isStoredDays);
  const day = { ...(stored[date] ?? {}) };
  if (mark === null) {
    delete day[entryKey];
  } else {
    day[entryKey] = mark;
  }
  await writeJson(faithStorageKeys.worshipDays, { ...stored, [date]: day });
}

export function createMockWorshipRepository(): WorshipRepository {
  return {
    async getDay(date: string): Promise<FaithResult<WorshipDay>> {
      return delay({ kind: 'ok' as const, data: await buildDay(date) }, 120);
    },

    async setEntryStatus(
      date: string,
      entryKey: string,
      status: WorshipEntryStatus,
    ): Promise<FaithResult<WorshipDay>> {
      await writeMark(date, entryKey, {
        status,
        completedAt: status === 'completed' ? nowIso() : null,
      });
      return { kind: 'ok', data: await buildDay(date) };
    },

    async getSummary(from: string, to: string): Promise<FaithResult<WorshipSummary>> {
      const day = await buildDay(to);
      // A single-day rollup standing in for a range: enough for the Worship screen's
      // header to render honestly without inventing six days of history the user
      // never recorded.
      return delay({
        kind: 'ok' as const,
        data: {
          from,
          to,
          completed: day.completed,
          total: day.total,
          byPrayer: Object.fromEntries(
            day.entries
              .filter((entry) => entry.prayer !== undefined && entry.status === 'completed')
              .map((entry) => [entry.prayer!, 1]),
          ),
        },
      });
    },

    async addCustomEntry(date: string, label: string): Promise<FaithResult<WorshipDay>> {
      const trimmed = label.trim();
      if (trimmed === '') {
        return { kind: 'error', code: 'unknown', detail: 'empty label' };
      }
      await writeMark(date, `custom:${trimmed}`, { status: 'upcoming', completedAt: null });
      return { kind: 'ok', data: await buildDay(date) };
    },

    async removeCustomEntry(date: string, entryKey: string): Promise<FaithResult<WorshipDay>> {
      await writeMark(date, entryKey, null);
      return { kind: 'ok', data: await buildDay(date) };
    },
  };
}

export const worshipSeedForTest = SEED;
