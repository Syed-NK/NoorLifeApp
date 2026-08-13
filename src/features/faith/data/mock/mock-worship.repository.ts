import type { FaithResult } from '../faith-result';
import type { PrayerKey } from '../prayer-times.repository';
import type {
  WorshipDay,
  WorshipEntry,
  WorshipEntryStatus,
  WorshipRepository,
  WorshipSummary,
} from '../worship.repository';
import { faithStorageKeys, isRecord, readJson, writeJson } from '../../storage/faith-storage';
import { formatPrayerClock } from '../prayer/prayer-clock';
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

/**
 * The day's trackable acts.
 *
 * ── Structure only. No times. ───────────────────────────────────────────────
 * This list used to carry a `detail` per prayer — `5:02 AM`, `12:35 PM`, `4:15 PM`, `8:44 PM`,
 * `10:10 PM`. Those are the deleted prayer-times fixture's constants, and they survived here after
 * that fixture was replaced by the `adhan` calculation, so Faith Home rendered a calculated next
 * prayer above a card of hard-coded ones.
 *
 * What is genuinely local is *which* acts a day contains and whether the user marked them. When
 * each prayer falls is a calculation about a place, and it now comes from the prayer-times
 * repository via `resolveTimes` — or from nowhere at all, when there is no location to calculate
 * from.
 *
 * `Morning Adhkar` lost its `detail` too. It read `'Completed'` — a status word in a field the UI
 * renders as a subtitle, so an unmarked entry described itself as done.
 */
const SEED: readonly Omit<WorshipEntry, 'status' | 'completedAt'>[] = [
  { key: 'fajr', label: 'Fajr Prayer', kind: 'prayer', prayer: 'fajr' },
  { key: 'dhuhr', label: 'Dhuhr Prayer', kind: 'prayer', prayer: 'dhuhr' },
  { key: 'asr', label: 'Asr Prayer', kind: 'prayer', prayer: 'asr' },
  { key: 'maghrib', label: 'Maghrib Prayer', kind: 'prayer', prayer: 'maghrib' },
  { key: 'isha', label: 'Isha Prayer', kind: 'prayer', prayer: 'isha' },
  { key: 'adhkar', label: 'Morning Adhkar', kind: 'adhkar' },
  { key: 'quran', label: 'Qur’an reading', kind: 'quran', detail: 'Daily portion' },
];

/**
 * Today's calculated prayer times, keyed by prayer, or an empty map when there are none.
 *
 * Supplied by the DI factory rather than imported, so this repository still has exactly one
 * dependency direction and can be constructed with no time source at all in a test.
 */
export type WorshipTimeSource = (date: string) => Promise<ReadonlyMap<PrayerKey, string>>;

/** No time source: every prayer renders without a time, which is the honest empty case. */
const noTimes: WorshipTimeSource = async () => new Map();

/**
 * The default status for an unmarked entry.
 *
 * ── Derived from the real times, or not derived at all ──────────────────────
 * It used to compare the current hour against a literal `[5, 12, 16, 20, 22]` — the fixture's
 * hours again — so a user in a timezone or latitude where those are wrong saw prayers marked
 * `missed` that had not happened yet. Passing judgement on whether somebody missed a prayer is the
 * last place to guess.
 *
 * With real times, an unmarked prayer is `missed` once the following prayer has begun, `current`
 * inside its own window, and `upcoming` before it. Without them, everything is `upcoming`: the
 * checklist still works as a checklist, and it makes no claim it cannot support.
 */
function defaultStatus(
  entryKey: string,
  isToday: boolean,
  times: ReadonlyMap<PrayerKey, string>,
): WorshipEntryStatus {
  if (!isToday) {
    return 'upcoming';
  }
  const order: readonly PrayerKey[] = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];
  const index = order.indexOf(entryKey as PrayerKey);
  if (index === -1) {
    return 'upcoming';
  }

  const startsAt = times.get(order[index]!);
  if (startsAt === undefined) {
    return 'upcoming';
  }
  const now = Date.now();
  if (now < Date.parse(startsAt)) {
    return 'upcoming';
  }
  const next = order[index + 1];
  const nextAt = next === undefined ? undefined : times.get(next);
  // The last prayer of the day has no following window, so it stays `current` until the date rolls.
  return nextAt !== undefined && now >= Date.parse(nextAt) ? 'missed' : 'current';
}

async function buildDay(date: string, resolveTimes: WorshipTimeSource): Promise<WorshipDay> {
  const [stored, times] = await Promise.all([
    readJson(faithStorageKeys.worshipDays, {} as StoredDays, isStoredDays),
    /**
     * A failure to calculate is not a failure of the checklist.
     *
     * The user's own marks are on this device and have nothing to do with whether a location could
     * be resolved, so a rejected time lookup degrades to "no times" rather than failing `getDay`.
     */
    resolveTimes(date).catch((): ReadonlyMap<PrayerKey, string> => new Map()),
  ]);
  const marks = stored[date] ?? {};
  const isToday = date === todayIso();

  const seeded: WorshipEntry[] = SEED.map((entry) => {
    const mark = marks[entry.key];
    const at = entry.prayer === undefined ? undefined : times.get(entry.prayer);
    return {
      ...entry,
      detail: at === undefined ? entry.detail : formatPrayerClock(at),
      status: mark?.status ?? defaultStatus(entry.key, isToday, times),
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

export function createMockWorshipRepository(
  /** Defaults to no times, so a test constructs this repository without a prayer source. */
  resolveTimes: WorshipTimeSource = noTimes,
): WorshipRepository {
  return {
    async getDay(date: string): Promise<FaithResult<WorshipDay>> {
      return delay({ kind: 'ok' as const, data: await buildDay(date, resolveTimes) }, 120);
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
      return { kind: 'ok', data: await buildDay(date, resolveTimes) };
    },

    async getSummary(from: string, to: string): Promise<FaithResult<WorshipSummary>> {
      const day = await buildDay(to, resolveTimes);
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
      return { kind: 'ok', data: await buildDay(date, resolveTimes) };
    },

    async removeCustomEntry(date: string, entryKey: string): Promise<FaithResult<WorshipDay>> {
      await writeMark(date, entryKey, null);
      return { kind: 'ok', data: await buildDay(date, resolveTimes) };
    },
  };
}

export const worshipSeedForTest = SEED;
