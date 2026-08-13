import { prayerIntervalProgress, prayerMarkerState } from '../data/prayer/prayer-interval';
import { formatDurationParts, formatRemaining } from '../data/prayer/prayer-clock';

/**
 * The arithmetic behind the next-prayer ring and the timeline's three states.
 *
 * ── Why these are unit tests rather than render assertions ──────────────────
 * Both are pure functions of timestamps and a clock, and both are the things that would be *wrong*
 * if this screen were wrong — a ring drawn from an invented start, or a completed prayer highlighted
 * as next after Isha. Proving them through a rendered tree would mean fixing a clock, mounting a
 * repository and then inferring the answer from a style, which tests the plumbing rather than the
 * rule. The rendering side is covered in `prayer-timeline-layout.test.tsx`.
 *
 * ── Every timestamp below carries an offset, and several are deliberately not the machine's ─
 * The whole prayer path rests on comparing *instants*, so the suite is written to fail if anything
 * here started reading calendar fields: the same moment is expressed in two different offsets and
 * the answers must be identical.
 */

/** A day at +03:00 — a zone the CI machine is very unlikely to be in. */
const DAY = [
  { at: '2026-08-13T04:44:00+03:00' }, // Fajr
  { at: '2026-08-13T06:22:00+03:00' }, // Sunrise
  { at: '2026-08-13T13:14:00+03:00' }, // Dhuhr
  { at: '2026-08-13T16:59:00+03:00' }, // Asr
  { at: '2026-08-13T20:04:00+03:00' }, // Maghrib
  { at: '2026-08-13T21:35:00+03:00' }, // Isha
] as const;

const at = (iso: string): number => Date.parse(iso);

describe('the progress ring measures a real interval', () => {
  it('measures from the marker that has just passed to the one being waited for', () => {
    // Half past nine: Sunrise has passed, Dhuhr is next.
    const result = prayerIntervalProgress(
      DAY,
      '2026-08-13T13:14:00+03:00',
      at('2026-08-13T09:30:00+03:00'),
    );

    expect(result.kind).toBe('known');
    if (result.kind !== 'known') return;
    expect(result.startAt).toBe(new Date(at('2026-08-13T06:22:00+03:00')).toISOString());
    // 188 minutes of the 412-minute Sunrise→Dhuhr wait.
    expect(result.elapsedFraction).toBeCloseTo(188 / 412, 5);
  });

  it('counts Sunrise as an interval bound even though it is not a prayer', () => {
    /*
      Between Fajr and Sunrise the wait is *for* Dhuhr, but the interval visibly passes through
      Sunrise. Excluding it would make the ring jump backwards the moment the sun came up.
    */
    const early = prayerIntervalProgress(
      DAY,
      '2026-08-13T13:14:00+03:00',
      at('2026-08-13T05:30:00+03:00'),
    );
    const late = prayerIntervalProgress(
      DAY,
      '2026-08-13T13:14:00+03:00',
      at('2026-08-13T06:30:00+03:00'),
    );

    expect(early.kind).toBe('known');
    expect(late.kind).toBe('known');
    if (early.kind !== 'known' || late.kind !== 'known') return;
    expect(early.startAt).toBe(new Date(at('2026-08-13T04:44:00+03:00')).toISOString());
    expect(late.startAt).toBe(new Date(at('2026-08-13T06:22:00+03:00')).toISOString());
  });

  it('measures tomorrow’s Fajr from today’s Isha, not from the last marker in the list', () => {
    const result = prayerIntervalProgress(
      DAY,
      '2026-08-14T04:45:00+03:00',
      at('2026-08-13T22:35:00+03:00'),
    );

    expect(result.kind).toBe('known');
    if (result.kind !== 'known') return;
    expect(result.startAt).toBe(new Date(at('2026-08-13T21:35:00+03:00')).toISOString());
    expect(result.elapsedFraction).toBeGreaterThan(0);
    expect(result.elapsedFraction).toBeLessThan(0.2);
  });

  /**
   * The one moment the interval genuinely cannot be known, and it is not filled in.
   *
   * Between midnight at the location and Fajr the interval began at *yesterday's* Isha, which is not
   * in today's list. Every candidate substitute — midnight, an hour ago, the top of the hour — draws
   * a proportion that looks identical to a real one and means nothing.
   */
  it('reports the pre-dawn interval as unknown rather than inventing a start', () => {
    const result = prayerIntervalProgress(
      DAY,
      '2026-08-13T04:44:00+03:00',
      at('2026-08-13T02:00:00+03:00'),
    );

    expect(result).toEqual({ kind: 'unknown', reason: 'no-preceding-marker' });
  });

  it('never reports a fraction outside 0 to 1', () => {
    const past = prayerIntervalProgress(
      DAY,
      '2026-08-13T13:14:00+03:00',
      at('2026-08-13T18:00:00+03:00'),
    );
    expect(past.kind).toBe('known');
    if (past.kind !== 'known') return;
    expect(past.elapsedFraction).toBe(1);
  });

  it('is the same answer whichever offset the same instant is written in', () => {
    // 09:30+03:00 and 06:30Z are one moment. A function reading calendar fields would disagree.
    const plusThree = prayerIntervalProgress(
      DAY,
      '2026-08-13T13:14:00+03:00',
      at('2026-08-13T09:30:00+03:00'),
    );
    const utc = prayerIntervalProgress(
      DAY.map((marker) => ({ at: new Date(at(marker.at)).toISOString() })),
      new Date(at('2026-08-13T13:14:00+03:00')).toISOString(),
      at('2026-08-13T06:30:00Z'),
    );

    expect(plusThree).toEqual(utc);
  });

  it('refuses to measure an interval that is not one', () => {
    expect(prayerIntervalProgress(DAY, 'not a timestamp', at('2026-08-13T09:30:00+03:00'))).toEqual(
      {
        kind: 'unknown',
        reason: 'not-an-interval',
      },
    );
  });
});

describe('a marker’s state comes from instants at the location', () => {
  const NOW = at('2026-08-13T09:30:00+03:00');
  const DHUHR = '2026-08-13T13:14:00+03:00';

  it('marks what has happened, what is next and what is still to come', () => {
    expect(prayerMarkerState('2026-08-13T04:44:00+03:00', DHUHR, NOW)).toBe('passed');
    expect(prayerMarkerState('2026-08-13T06:22:00+03:00', DHUHR, NOW)).toBe('passed');
    expect(prayerMarkerState(DHUHR, DHUHR, NOW)).toBe('next');
    expect(prayerMarkerState('2026-08-13T16:59:00+03:00', DHUHR, NOW)).toBe('upcoming');
  });

  it('reads the same however the offsets are written', () => {
    // Fajr as +03:00 and as the identical instant in Z. Both are before now, both are passed.
    expect(prayerMarkerState('2026-08-13T04:44:00+03:00', DHUHR, NOW)).toBe(
      prayerMarkerState('2026-08-13T01:44:00Z', DHUHR, NOW),
    );
    // And the highlight matches across offsets too, because it is compared as an instant.
    expect(prayerMarkerState('2026-08-13T10:14:00Z', DHUHR, NOW)).toBe('next');
  });

  /**
   * The day boundary, stated as the rule that closes it.
   *
   * After Isha the next prayer is tomorrow's Fajr. The screen looks that instant up in *today's*
   * list, finds nothing, and passes `null` — so every row on the card is `passed` and none is
   * highlighted. Matching by prayer key instead would light today's Fajr, which passed before dawn.
   */
  it('highlights nothing on today’s card once the day is over', () => {
    const afterIsha = at('2026-08-13T22:30:00+03:00');
    const states = DAY.map((marker) => prayerMarkerState(marker.at, null, afterIsha));

    expect(states).toEqual(['passed', 'passed', 'passed', 'passed', 'passed', 'passed']);
  });

  it('treats the exact prayer instant as next rather than as already done', () => {
    expect(prayerMarkerState(DHUHR, DHUHR, at(DHUHR))).toBe('next');
  });
});

describe('the countdown is set twice from one number', () => {
  it('splits into at most two lines for the ring', () => {
    expect(formatDurationParts(509)).toEqual(['8 hr', '29 min']);
    expect(formatDurationParts(14)).toEqual(['14 min']);
    expect(formatDurationParts(120)).toEqual(['2 hr']);
    expect(formatDurationParts(0)).toEqual(['now']);
  });

  it('joins the same parts into the card’s sentence', () => {
    expect(formatRemaining(509)).toBe('8 hr 29 min remaining');
    expect(formatRemaining(14)).toBe('14 min remaining');
    expect(formatRemaining(0)).toBe('now');
  });

  it('never disagrees with itself about the same duration', () => {
    for (const minutes of [1, 59, 60, 61, 509, 1439]) {
      expect(formatRemaining(minutes)).toBe(`${formatDurationParts(minutes).join(' ')} remaining`);
    }
  });
});
