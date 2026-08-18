import {
  faithStorageKeys,
  hasNumber,
  isRecord,
  readJson,
  removeKey,
  writeJson,
} from './faith-storage';

/**
 * The user's real Qur'an reading activity.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHEN AN AYAH COUNTS AS READ
 *
 * **An ayah counts as read when the reader's furthest position in that surah advances past it.**
 *
 * Concretely: saving your place at verse 32 of a surah whose furthest recorded verse was 20 records
 * twelve ayat read, today. Saving at verse 10 of that same surah records nothing — you have not read
 * anything new, you have gone back.
 *
 * ── Why this rule and not the obvious ones ──────────────────────────────────
 * *On render* was rejected outright, and is the rule the brief specifically forbids: a reader that
 * counts an ayah because a card mounted would credit twenty verses to somebody who opened the screen
 * and closed it, and would credit them again on every return.
 *
 * *On scroll-past with a dwell timer* is the most faithful rule and was seriously considered. It
 * needs per-verse viewport geometry threaded through a scroll container this module does not own,
 * and it fails in a specific and unfixable way: a fast scroll to the end of a surah credits every
 * verse it flew past. A measurement that can be gamed by a flick is not a measurement.
 *
 * *On furthest position* is what a reader actually does: they read forward, and they mark where they
 * got to. It cannot be inflated by rendering, by returning to a surah, or by scrolling. It
 * undercounts a user who reads without ever saving their place — which is the honest direction to be
 * wrong in, and the reader's save control is deliberately at the foot of every verse.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── What is stored, and what is deliberately not ────────────────────────────
 * Per-surah furthest verse, and a per-day count of verses newly reached. No timestamps beyond the
 * date, no session durations, no reading speed. "Minutes read" is absent for the same reason a
 * streak is: this module has no way to know whether the phone was in a pocket, and a number nobody
 * can verify is a number nobody should be shown.
 *
 * Everything here is local. It is the user's worship record, it never leaves the device in this
 * phase, and `docs/FAITH_DATA_MODEL.md` holds the row-level-security design for when it does.
 */

/** ISO `YYYY-MM-DD` → verses newly reached that day. */
export type ReadingDays = Readonly<Record<string, number>>;

/** Surah number → the furthest verse reached in it. */
export type SurahFurthest = Readonly<Record<string, number>>;

export type ReadingLog = {
  readonly days: ReadingDays;
  readonly furthest: SurahFurthest;
  /** Ayat per day the user is aiming for. */
  readonly dailyGoal: number;
};

/**
 * The default daily goal.
 *
 * Ten ayat — reachable in a few minutes, and chosen so the first day a user opens the reader they
 * are likely to meet it rather than be shown a bar at 4%. It is editable, and the edit control is on
 * the progress screen rather than buried in preferences.
 */
export const DEFAULT_DAILY_GOAL = 10;

/** The goal's bounds. One is the smallest meaningful target; the longest surah is the largest. */
export const MIN_DAILY_GOAL = 1;
export const MAX_DAILY_GOAL = 286;

export const emptyReadingLog: ReadingLog = {
  days: {},
  furthest: {},
  dailyGoal: DEFAULT_DAILY_GOAL,
};

function isNumberRecord(value: unknown): value is Record<string, number> {
  return (
    isRecord(value) &&
    Object.values(value).every((entry) => typeof entry === 'number' && entry >= 0)
  );
}

function isReadingLog(value: unknown): value is ReadingLog {
  return (
    isRecord(value) &&
    isNumberRecord(value.days) &&
    isNumberRecord(value.furthest) &&
    hasNumber(value, 'dailyGoal')
  );
}

export async function readReadingLog(): Promise<ReadingLog> {
  const stored = await readJson(faithStorageKeys.readingLog, emptyReadingLog, isReadingLog);
  // Merged over the defaults so a field added in a later build is present even when the stored blob
  // predates it — the same reason `readFaithPreferences` merges.
  return { ...emptyReadingLog, ...stored };
}

/**
 * Records that the reader reached `ayah` in `surah`, and reports what that added.
 *
 * ── Pure, so the rule is testable without storage ───────────────────────────
 * The decision — how many ayat this advance is worth — is separated from the write, because the
 * decision is the part with the product judgement in it and the write is bookkeeping.
 */
export function applyReading(
  log: ReadingLog,
  surah: number,
  ayah: number,
  isoDate: string,
): { readonly log: ReadingLog; readonly added: number } {
  const key = String(surah);
  const previous = log.furthest[key] ?? 0;

  if (ayah <= previous) {
    // Re-reading, or going back. Real, and not new — so it changes nothing.
    return { log, added: 0 };
  }

  const added = ayah - previous;
  return {
    log: {
      ...log,
      furthest: { ...log.furthest, [key]: ayah },
      days: { ...log.days, [isoDate]: (log.days[isoDate] ?? 0) + added },
    },
    added,
  };
}

export async function recordReading(
  surah: number,
  ayah: number,
  isoDate: string,
): Promise<ReadingLog> {
  const current = await readReadingLog();
  const { log, added } = applyReading(current, surah, ayah, isoDate);
  if (added === 0) {
    // Nothing changed, so nothing is written. A no-op write would churn storage on every re-read.
    return current;
  }
  await writeJson(faithStorageKeys.readingLog, log);
  return log;
}

export async function setDailyGoal(goal: number): Promise<ReadingLog> {
  const current = await readReadingLog();
  const next: ReadingLog = { ...current, dailyGoal: clampGoal(goal) };
  await writeJson(faithStorageKeys.readingLog, next);
  return next;
}

export function clampGoal(goal: number): number {
  if (!Number.isFinite(goal)) {
    return DEFAULT_DAILY_GOAL;
  }
  return Math.min(Math.max(Math.round(goal), MIN_DAILY_GOAL), MAX_DAILY_GOAL);
}

/** Erases every reading record. Destructive; the caller must have confirmed. */
export async function clearReadingLog(): Promise<ReadingLog> {
  await removeKey(faithStorageKeys.readingLog);
  return emptyReadingLog;
}

// ─────────────────────────────────────────────────────────────────────────────
// Derivations
// ─────────────────────────────────────────────────────────────────────────────

/** One day in the weekly view. `read` is 0 for a day with no record — never interpolated. */
export type ReadingDay = {
  readonly isoDate: string;
  readonly read: number;
  /** True when the day's count met or passed the goal. */
  readonly metGoal: boolean;
};

/**
 * The last `length` days ending at `endIso`, oldest first.
 *
 * ── Days with no record are zero, not absent and not guessed ────────────────
 * The weekly chart draws from this, and a day the user did not read is an empty bar. There is no
 * interpolation, no carry-forward and no "average" filling a gap — a chart that invented a bar would
 * be the same fabrication as the fixture this whole module is being cleaned of, in graphical form.
 */
export function recentDays(log: ReadingLog, endIso: string, length = 7): readonly ReadingDay[] {
  const end = Date.parse(`${endIso}T00:00:00Z`);
  if (Number.isNaN(end)) {
    return [];
  }

  return Array.from({ length }, (_unused, index) => {
    const date = new Date(end - (length - 1 - index) * 86_400_000);
    const isoDate = date.toISOString().slice(0, 10);
    const read = log.days[isoDate] ?? 0;
    return { isoDate, read, metGoal: read >= log.dailyGoal };
  });
}

/** Ayat read on a given day. Zero when nothing was recorded — a fact, not a gap. */
export function readOn(log: ReadingLog, isoDate: string): number {
  return log.days[isoDate] ?? 0;
}

/** How many of the last `length` days met the goal. Derived only from recorded days. */
export function daysMetGoal(log: ReadingLog, endIso: string, length = 7): number {
  return recentDays(log, endIso, length).filter((day) => day.metGoal).length;
}

export type SurahProgress = {
  readonly surah: number;
  readonly furthest: number;
  /** 0–1, or null when the surah's length is not known to the caller. */
  readonly fraction: number | null;
};

/**
 * Per-surah completion, for the surahs the user has actually opened.
 *
 * `ayahCounts` is supplied by the caller from the live catalogue rather than held here: this module
 * stores the user's activity, and the Qur'an's structure is not the user's activity. A surah whose
 * length the caller could not resolve yields `null` rather than a fraction over a guessed
 * denominator.
 */
export function surahProgress(
  log: ReadingLog,
  ayahCounts: Readonly<Record<number, number>>,
): readonly SurahProgress[] {
  return Object.entries(log.furthest)
    .map(([key, furthest]) => {
      const surah = Number(key);
      const total = ayahCounts[surah];
      return {
        surah,
        furthest,
        fraction:
          total === undefined || total <= 0 ? null : Math.min(1, Math.max(0, furthest / total)),
      };
    })
    .filter((entry) => Number.isInteger(entry.surah) && entry.surah >= 1 && entry.surah <= 114)
    .sort((a, b) => a.surah - b.surah);
}

/** Total ayat reached across every surah opened. The honest "how much have I read". */
export function totalAyatRead(log: ReadingLog): number {
  return Object.values(log.furthest).reduce((sum, furthest) => sum + furthest, 0);
}
