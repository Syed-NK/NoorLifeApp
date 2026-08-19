import { Directory, File } from 'expo-file-system';

import {
  ARABIC_SCRIPT,
  type ArabicRow,
  type ArabicScript,
  MAX_SURAH,
  TOTAL_AYAH_COUNT,
  validateArabicDataset,
} from './faith-arabic-rows';
import { arabicStagingDirectory } from './faith-sync-generation';
import { isRecord } from './faith-storage';

/**
 * A resumable build area for the Arabic baseline. Never a source anything reads.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── Why partial work has to be durable ─────────────────────────────────────
 * The complete Arabic text arrives through `list_verses`, one surah at a time, fifty verses per
 * page — roughly 180 authenticated requests. A run that had to finish all of them or lose everything
 * would fail in the ordinary case rather than the exceptional one: a rate limit, a lost connection,
 * a backgrounded app killed by the OS. And each restart would spend the vendor's rate limit — shared
 * by every NoorLife device — to arrive back where it started.
 *
 * So each surah is written as it completes, and the next run resumes at the first surah that is
 * missing. The cost of an interruption is the pages already in flight, not the whole Qur'an.
 *
 * ── Why this is not a generation, and must never be read as one ────────────
 * It has no manifest, no pointer and no reader. Nothing outside the sync transaction opens it. A
 * partial Arabic text is precisely what the permission does not allow to be presented — the grant is
 * for the **complete, unmodified** text — so there is deliberately no path from here to a screen.
 * The only exit is `collectArabicBaseline`, which validates the whole 6,236-verse set in one act and
 * returns nothing at all if any part of it is missing, duplicated or in the wrong script.
 *
 * ── The plan, and what invalidates it ──────────────────────────────────────
 * Ayah counts come from the publisher's own chapter list and are recorded in the plan. They are what
 * "complete" is measured against, so a run whose counts differ from the stored ones is building a
 * different dataset and starts over. The same is true of the script and of this module's version.
 * Continuing across such a change would blend two publisher answers into one dataset, and a Qur'an
 * assembled from two sources is not the unmodified text of either.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/** Bumped when the on-disk shape changes. A plan at another version is discarded, never migrated. */
const ARABIC_STAGING_VERSION = 1;

const PLAN_FILE = 'plan.json';
const PART_SUFFIX = '.part';

function surahFile(surah: number): string {
  return `s-${surah}.json`;
}

export type ArabicStagingPlan = {
  readonly version: number;
  readonly script: ArabicScript;
  /** One entry per surah, in order, from the publisher's chapter list. Never authored here. */
  readonly ayahCounts: readonly number[];
  readonly startedAt: number;
  /** Surahs whose complete verse set is on disk, validated at the moment it was written. */
  readonly completed: readonly number[];
};

/**
 * Whether a set of ayah counts can describe the Qur'an at all.
 *
 * The sum is the load-bearing check, and it is not an invented table: 6,236 is the complete ayah
 * count the rest of this feature already states as a constant. A chapter list that sums to anything
 * else is one this device cannot build a complete dataset from, and finding that out before 180
 * requests are spent is the whole point of checking here.
 */
export function areAyahCountsUsable(counts: readonly number[]): boolean {
  if (counts.length !== MAX_SURAH) {
    return false;
  }
  let total = 0;
  for (const count of counts) {
    if (typeof count !== 'number' || !Number.isInteger(count) || count < 1) {
      return false;
    }
    total += count;
  }
  return total === TOTAL_AYAH_COUNT;
}

/** The verse keys one surah must produce, in order. Built from the publisher's count for it. */
function surahVerseKeys(surah: number, ayahCount: number): readonly string[] {
  const keys: string[] = [];
  for (let ayah = 1; ayah <= ayahCount; ayah += 1) {
    keys.push(`${surah}:${ayah}`);
  }
  return keys;
}

function isPlan(value: unknown): value is ArabicStagingPlan {
  if (!isRecord(value)) {
    return false;
  }
  const { version, script, ayahCounts, startedAt, completed } = value;
  return (
    version === ARABIC_STAGING_VERSION &&
    script === ARABIC_SCRIPT &&
    Array.isArray(ayahCounts) &&
    areAyahCountsUsable(ayahCounts as number[]) &&
    typeof startedAt === 'number' &&
    Array.isArray(completed) &&
    completed.every(
      (surah) =>
        typeof surah === 'number' && Number.isInteger(surah) && surah >= 1 && surah <= MAX_SURAH,
    )
  );
}

function readText(directory: Directory, name: string): string | null {
  try {
    const file = new File(directory, name);
    return file.exists ? file.textSync() : null;
  } catch {
    return null;
  }
}

/** `<name>.part`, reopened, then renamed — the same discipline the generation writer uses. */
function stage(directory: Directory, name: string, text: string): boolean {
  try {
    const partial = new File(directory, `${name}${PART_SUFFIX}`);
    if (partial.exists) {
      partial.delete();
    }
    partial.create();
    partial.write(text);
    if (partial.textSync() !== text) {
      partial.delete();
      return false;
    }
    /*
      `overwrite` is not optional here. The plan file is rewritten after every surah, so its
      destination exists from the second write onward — and the option defaults to false, which is
      how a baseline that looked correct in every test stalled after one surah on a real device.
    */
    partial.moveSync(new File(directory, name), { overwrite: true });
    return true;
  } catch {
    return false;
  }
}

/** Removes every trace of a partial baseline. Called when it is unusable or no longer needed. */
export function discardArabicStaging(): void {
  try {
    const directory = arabicStagingDirectory();
    for (const entry of directory.list()) {
      try {
        entry.delete();
      } catch {
        /* One file left behind cannot make a discarded plan readable: the plan itself is gone. */
      }
    }
  } catch {
    /* Nothing to release. */
  }
}

/** The stored plan, or `null` when there is none or it is unreadable. */
export function readArabicStagingPlan(): ArabicStagingPlan | null {
  try {
    const text = readText(arabicStagingDirectory(), PLAN_FILE);
    if (text === null) {
      return null;
    }
    const parsed: unknown = JSON.parse(text);
    return isPlan(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function writePlan(plan: ArabicStagingPlan): boolean {
  try {
    return stage(arabicStagingDirectory(), PLAN_FILE, JSON.stringify(plan));
  } catch {
    return false;
  }
}

/**
 * Opens a plan for this run, resuming the stored one when it describes the same dataset.
 *
 * "The same dataset" means the same version, the same script and the same ayah counts. Anything else
 * starts over from an empty directory rather than continuing — see the module note on why a dataset
 * assembled from two publisher answers is not the unmodified text of either.
 */
export function openArabicStaging(
  ayahCounts: readonly number[],
  script: ArabicScript,
  at: number,
): ArabicStagingPlan | null {
  if (!areAyahCountsUsable(ayahCounts) || script !== ARABIC_SCRIPT) {
    return null;
  }
  const stored = readArabicStagingPlan();
  if (
    stored !== null &&
    stored.script === script &&
    stored.ayahCounts.length === ayahCounts.length &&
    stored.ayahCounts.every((count, index) => count === ayahCounts[index])
  ) {
    return stored;
  }

  discardArabicStaging();
  const fresh: ArabicStagingPlan = {
    version: ARABIC_STAGING_VERSION,
    script,
    ayahCounts,
    startedAt: at,
    completed: [],
  };
  return writePlan(fresh) ? fresh : null;
}

/** The surahs still to fetch, in ascending order, so a resumed run is deterministic. */
export function pendingSurahs(plan: ArabicStagingPlan): readonly number[] {
  const done = new Set(plan.completed);
  const pending: number[] = [];
  for (let surah = 1; surah <= plan.ayahCounts.length; surah += 1) {
    if (!done.has(surah)) {
      pending.push(surah);
    }
  }
  return pending;
}

/**
 * Records one complete surah, or says which way it failed.
 *
 * Validated at the moment it is written rather than only at the end. A surah short by one verse that
 * was accepted here would be found 180 requests later, and the only remedy then is to discard
 * everything and start again — so the cheap check happens where the mistake is cheap.
 *
 * ── Why "rejected" and "unwritable" are different answers ──────────────────
 * They were one answer once, and the first run on a real device showed the cost: a plan file that
 * could not be rewritten surfaced as `invalid-response`, which is a claim about the **publisher**.
 * An operator reading that would go and look at the vendor's payloads for a fault that was entirely
 * local. The publisher sending the wrong number of verses and this device being unable to store the
 * right ones are different problems with different remedies, and the failure record should say which
 * one happened.
 */
export type ArabicSurahRecord =
  | { readonly kind: 'recorded'; readonly plan: ArabicStagingPlan }
  /** The publisher's answer did not match the publisher's own count for this surah. */
  | { readonly kind: 'rejected' }
  /** The answer was fine and this device could not store it. */
  | { readonly kind: 'unwritable' };

export function recordArabicSurah(
  plan: ArabicStagingPlan,
  surah: number,
  rows: readonly unknown[],
): ArabicSurahRecord {
  const ayahCount = plan.ayahCounts[surah - 1];
  if (ayahCount === undefined) {
    return { kind: 'rejected' };
  }
  const validation = validateArabicDataset(rows, surahVerseKeys(surah, ayahCount));
  if (!validation.ok) {
    return { kind: 'rejected' };
  }
  const text = JSON.stringify({ surah, script: plan.script, rows: validation.rows });
  let directory: Directory;
  try {
    directory = arabicStagingDirectory();
  } catch {
    return { kind: 'unwritable' };
  }
  if (!stage(directory, surahFile(surah), text)) {
    return { kind: 'unwritable' };
  }
  /*
    The surah file is written before the plan names it. The other order would leave a plan claiming a
    surah that is not on disk, and the next run would skip it and then fail the whole-dataset
    validation with nothing to point at. This order is merely wasteful in the crash case: an
    unclaimed file that the next run overwrites.
  */
  const next: ArabicStagingPlan = {
    ...plan,
    completed: [...plan.completed.filter((entry) => entry !== surah), surah].sort((a, b) => a - b),
  };
  return writePlan(next) ? { kind: 'recorded', plan: next } : { kind: 'unwritable' };
}

/**
 * The complete Arabic Qur'an, or nothing.
 *
 * ── There is no partial success here, by design ────────────────────────────
 * The permission is for the complete, unmodified text. A dataset missing one verse is not a smaller
 * licensed artefact; it is an unlicensed one, and a reader built on it would silently omit a verse
 * without ever being able to say so. So a single unreadable file, one short surah or one row in
 * another script returns `null` and the caller publishes no Arabic at all.
 *
 * Every surah is re-read from disk rather than trusted from the plan, and the assembled set is
 * validated as a whole against the publisher's own counts. A file that decayed between being written
 * and being collected is caught here, which is the last point before publication at which it can be.
 */
export function collectArabicBaseline(plan: ArabicStagingPlan): readonly ArabicRow[] | null {
  let directory: Directory;
  try {
    directory = arabicStagingDirectory();
  } catch {
    return null;
  }

  const rows: ArabicRow[] = [];
  const expected: string[] = [];
  for (let surah = 1; surah <= plan.ayahCounts.length; surah += 1) {
    const ayahCount = plan.ayahCounts[surah - 1] ?? 0;
    expected.push(...surahVerseKeys(surah, ayahCount));

    const text = readText(directory, surahFile(surah));
    if (text === null) {
      return null;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return null;
    }
    if (!isRecord(parsed) || parsed.surah !== surah || parsed.script !== plan.script) {
      return null;
    }
    const stored = parsed.rows;
    if (!Array.isArray(stored)) {
      return null;
    }
    rows.push(...(stored as ArabicRow[]));
  }

  const validation = validateArabicDataset(rows, expected);
  return validation.ok ? validation.rows : null;
}
