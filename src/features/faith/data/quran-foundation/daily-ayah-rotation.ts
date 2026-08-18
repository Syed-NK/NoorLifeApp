/**
 * Which verse the Daily Ayah card shows today.
 *
 * ── Why NoorLife chooses the verse and Quran Foundation supplies the text ───
 * There is no "verse of the day" endpoint. The Content API offers `/verses/random`, and it is the
 * wrong tool twice over: it is random *per call*, so the card would change on every render and on
 * every device, and a Daily Ayah that is different for two people on the same day is not a daily
 * ayah. The alternative — NoorLife generating or storing verse text — is forbidden outright.
 *
 * So the responsibilities split. **NoorLife decides which verse**, from the fixed list below, indexed
 * by the date. **Quran Foundation supplies the text**, fetched live for that verse key. No scripture
 * is stored here: this file contains surah and ayah *numbers* and nothing else, which is why it can
 * be read at a glance and why a diff to it is a visible product decision rather than a content change.
 *
 * ── How the verses were chosen ──────────────────────────────────────────────
 * Widely-known verses of comfort, patience and remembrance, appropriate to a card a user sees once a
 * day without asking for it. The list is deliberately short and deliberately unsurprising: a rotation
 * is a curatorial act, and a long list assembled without review would be a larger one.
 */

export type DailyAyahReference = {
  readonly surah: number;
  readonly ayah: number;
  /** Present so a reader of this file knows what each entry is without looking it up. */
  readonly note: string;
};

export const DAILY_AYAH_ROTATION: readonly DailyAyahReference[] = [
  { surah: 94, ayah: 5, note: 'Ash-Sharh — with hardship comes ease' },
  { surah: 94, ayah: 6, note: 'Ash-Sharh — the verse repeated' },
  { surah: 2, ayah: 286, note: 'Al-Baqarah — no soul is burdened beyond its capacity' },
  { surah: 13, ayah: 28, note: 'Ar-Ra’d — hearts find rest in remembrance' },
  { surah: 65, ayah: 3, note: 'At-Talaq — sufficiency for those who trust' },
  { surah: 39, ayah: 53, note: 'Az-Zumar — do not despair of mercy' },
  { surah: 3, ayah: 139, note: 'Ali ’Imran — do not lose heart' },
  { surah: 2, ayah: 153, note: 'Al-Baqarah — seek help in patience and prayer' },
  { surah: 55, ayah: 13, note: 'Ar-Rahman — which of the favours will you deny' },
  { surah: 1, ayah: 5, note: 'Al-Fatihah — You alone we worship' },
  { surah: 18, ayah: 10, note: 'Al-Kahf — the supplication of the companions of the cave' },
  { surah: 112, ayah: 1, note: 'Al-Ikhlas — say, He is Allah, One' },
];

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Today's verse, chosen from the date and nothing else.
 *
 * ── Deterministic on purpose, in three directions at once ───────────────────
 * The same day gives the same verse for the whole of that day, so the card does not change while the
 * user is looking at it; it gives the same verse on every device, so two people can talk about it;
 * and it gives the same verse in a test, so the home screen is testable without freezing a clock into
 * the fixture.
 *
 * The index is days since the Unix epoch in **UTC**. Local midnight would have been the more natural
 * reading, and it is deliberately not used: a user who travels would see the card change mid-flight,
 * and the family features mean two members in different timezones would disagree about the day's
 * verse. One boundary the whole product shares is the less surprising of the two.
 */
export function dailyAyahFor(date: Date = new Date()): DailyAyahReference {
  const time = date.getTime();
  const index = Number.isFinite(time) ? Math.floor(time / DAY_MS) : 0;
  const length = DAILY_AYAH_ROTATION.length;
  // `%` yields a negative result for dates before 1970, which the second modulo folds back.
  const position = ((index % length) + length) % length;
  // Non-null: `position` is inside the array by construction, and the array is a non-empty literal.
  return DAILY_AYAH_ROTATION[position] as DailyAyahReference;
}
