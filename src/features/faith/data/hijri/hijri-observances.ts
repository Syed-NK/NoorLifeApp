import type { Observance, ObservanceKind } from '../faith-calendar.repository';
import {
  daysBetween,
  gregorianDateFor,
  hijriDateFor,
  hijriMonthName,
  toIsoDate,
  type CivilDate,
} from './hijri-calendar';

/**
 * The observances NoorLife dates, and how their dates are arrived at.
 *
 * ── The set is deliberately narrow ──────────────────────────────────────────
 * Six entries, each fixed to a Hijri day that Muslims broadly agree on. Observances whose
 * *observance* is itself disputed are not in this list — including one whose date is easy to compute
 * and which several Qur'an apps show. NoorLife dating an event it has no basis to take a position on
 * would be the app making a religious judgement on the user's behalf, which is not its role.
 *
 * Laylat al-Qadr is absent for the opposite reason: it falls in the last ten nights of Ramadan and
 * the exact night is not knowable. A card naming one would be stating something no one knows.
 *
 * ── Every date here is *expected*, and says so ──────────────────────────────
 * These are derived from the tabular calendar in `hijri-calendar.ts`, so they are calculations, not
 * sightings. `basis` is `calculated` on every one, `daysUntil` is measured from the caller's own
 * "today", and each description states that the start is subject to local sighting. Nothing in this
 * module can produce a confirmed date, because nothing in it has an authority to confirm against.
 */

type ObservanceSeed = {
  readonly id: string;
  readonly name: string;
  readonly kind: ObservanceKind;
  /** Hijri month, 1–12. */
  readonly month: number;
  /** Hijri day of that month. */
  readonly day: number;
  readonly description: string;
};

const SEEDS: readonly ObservanceSeed[] = [
  {
    id: 'islamic-new-year',
    name: 'Islamic New Year',
    kind: 'other',
    month: 1,
    day: 1,
    description: 'The first day of Muharram, beginning a new Hijri year.',
  },
  {
    id: 'ashura',
    name: 'Day of Ashura',
    kind: 'ashura',
    month: 1,
    day: 10,
    description: 'The tenth of Muharram. Expected date — subject to local moon sighting.',
  },
  {
    id: 'ramadan',
    name: 'Ramadan begins',
    kind: 'ramadan',
    month: 9,
    day: 1,
    description: 'The month of fasting. Expected date — subject to local moon sighting.',
  },
  {
    id: 'eid-al-fitr',
    name: 'Eid al-Fitr',
    kind: 'eid',
    month: 10,
    day: 1,
    description: 'The festival marking the end of Ramadan. Expected date — subject to sighting.',
  },
  {
    id: 'day-of-arafah',
    name: 'Day of Arafah',
    kind: 'hajj',
    month: 12,
    day: 9,
    description: 'The ninth of Dhul-Hijjah, the day of standing at Arafah. Expected date.',
  },
  {
    id: 'eid-al-adha',
    name: 'Eid al-Adha',
    kind: 'eid',
    month: 12,
    day: 10,
    description: 'The festival of sacrifice, the day after Arafah. Expected date.',
  },
];

function buildObservance(seed: ObservanceSeed, hijriYear: number, today: CivilDate): Observance {
  const gregorian = gregorianDateFor({ year: hijriYear, month: seed.month, day: seed.day });
  const monthName = hijriMonthName(seed.month);

  return {
    id: `${seed.id}-${hijriYear}`,
    name: seed.name,
    kind: seed.kind,
    hijri: {
      day: seed.day,
      month: seed.month,
      monthName,
      year: hijriYear,
      formatted: `${seed.day} ${monthName} ${hijriYear} AH`,
      basis: 'calculated',
    },
    gregorian: toIsoDate(gregorian),
    daysUntil: daysBetween(today, gregorian),
    description: seed.description,
  };
}

/**
 * Every seeded observance for this Hijri year and the next, in date order.
 *
 * Two years rather than one because the answer to "what is next?" in Dhul-Hijjah is in the following
 * year, and a list that stopped at the year boundary would report nothing upcoming for the last
 * fortnight of every year.
 */
export function observancesAround(today: CivilDate): readonly Observance[] {
  const hijriToday = hijriDateFor(today);

  return [hijriToday.year, hijriToday.year + 1]
    .flatMap((year) => SEEDS.map((seed) => buildObservance(seed, year, today)))
    .sort((a, b) => a.daysUntil - b.daysUntil);
}

/**
 * The observances still ahead, soonest first.
 *
 * "Ahead" includes today (`daysUntil === 0`): Eid is still Eid at nine in the morning, and dropping
 * it the moment the date arrives is the one day the card most needs to be right.
 */
export function upcomingObservances(today: CivilDate, limit?: number): readonly Observance[] {
  const ahead = observancesAround(today).filter((observance) => observance.daysUntil >= 0);
  return limit === undefined ? ahead : ahead.slice(0, limit);
}

/** The single next observance, or `null` when none could be derived. */
export function nextObservance(today: CivilDate): Observance | null {
  return upcomingObservances(today, 1)[0] ?? null;
}

/**
 * Which Gregorian days a Hijri year's observances fall on — for month-grid markers only.
 *
 * ── Why this exists rather than reusing `observancesAround` ─────────────────
 * A marker on a browsed month needs to know *which days to dot*, and nothing else. Building it from
 * a full `Observance` forced the month query to supply a "today" purely so that `daysUntil` — a
 * field the grid never reads — could be computed, and that dependency was the last thing keeping a
 * location-scoped value on a screen that is browsing an arbitrary month.
 *
 * It is also more correct. Markers now come from the Hijri year **being viewed**: browsing Ramadan
 * 1450 shows Ramadan 1450's marker, which the two-years-around-today window did not reach.
 */
export function observanceDatesInHijriYear(
  hijriYear: number,
): readonly { readonly id: string; readonly gregorian: string }[] {
  return SEEDS.map((seed) => ({
    id: `${seed.id}-${hijriYear}`,
    gregorian: toIsoDate(gregorianDateFor({ year: hijriYear, month: seed.month, day: seed.day })),
  }));
}
