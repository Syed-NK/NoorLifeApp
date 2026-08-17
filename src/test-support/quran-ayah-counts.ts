/**
 * The number of ayat in each of the 114 surahs, for test fixtures only.
 *
 * ── Why this exists here and emphatically not in `src/features` ─────────────
 * Production derives every ayah count from the published Content Sync generation, because the one
 * thing that can say how many verses resource 3 publishes for a surah is the publication itself. A
 * table compiled into the app would be a second, unsourced copy of the structure of the Qur'an, and
 * the first time it disagreed with the publisher the disagreement would be invisible.
 *
 * A *test* needs the opposite: a fixed, independent statement of the truth to check the code against.
 * A suite that built its fixture from the same source the code reads would prove only that the code
 * agrees with itself. So this table is the independent witness — it lives in `test-support`, nothing
 * under `src/features` imports it, and `offline-audio-source-scan.test.ts` asserts that stays true.
 *
 * The counts are the Ḥafṣ ʿan ʿĀṣim numbering, which is what Quran Foundation publishes and what the
 * 6,236 total refers to.
 */
export const AYAH_COUNTS: readonly number[] = [
  7, 286, 200, 176, 120, 165, 206, 75, 129, 109, 123, 111, 43, 52, 99, 128, 111, 110, 98, 135, 112,
  78, 118, 64, 77, 227, 93, 88, 69, 60, 34, 30, 73, 54, 45, 83, 182, 88, 75, 85, 54, 53, 89, 59, 37,
  35, 38, 29, 18, 45, 60, 49, 62, 55, 78, 96, 29, 22, 24, 13, 14, 11, 11, 18, 12, 12, 30, 52, 52,
  44, 28, 28, 20, 56, 40, 31, 50, 40, 46, 42, 29, 19, 36, 25, 22, 17, 19, 26, 30, 20, 15, 21, 11, 8,
  8, 19, 5, 8, 8, 11, 11, 8, 3, 9, 5, 4, 7, 3, 6, 3, 5, 4, 5, 6,
];

/** 6,236 — the complete recitation, counted rather than asserted. */
export const TOTAL_AYAT = AYAH_COUNTS.reduce((sum, count) => sum + count, 0);

export const SURAH_COUNT = AYAH_COUNTS.length;

export function ayahCountOf(surah: number): number {
  const count = AYAH_COUNTS[surah - 1];
  if (count === undefined) {
    throw new Error(`No ayah count for surah ${surah}`);
  }
  return count;
}
