import {
  formatCountdownTo,
  formatTimeUntil,
  minutesUntilInstant,
} from '../data/prayer/prayer-clock';
// Imported under a second name purely so the identity assertion at the bottom can compare the two.
import { formatTimeUntil as reExported } from '../hooks/use-faith-home';

/**
 * The countdown is measured from the stamped instant, and it is one implementation.
 *
 * ── The two defects these lock out ──────────────────────────────────────────
 * **Staleness.** The Faith home hero rendered `minutesUntil` as the repository computed it once, so a
 * screen left open showed "in 4 hr 14 min" while the prayer arrived and passed. The figure has to be
 * derived from the instant on every render, which is what `minutesUntilInstant` is for and what
 * `usePrayerCountdown` calls on a tick and on foreground.
 *
 * **Divergence.** The formatter lived in `use-faith-home.ts`, reachable only from Faith's own screens.
 * The Prayer times screen had no countdown at all and Main Home had none either, so adding them meant
 * either importing from a hook module — impossible from a data layer without an import cycle — or
 * writing a second copy. Two copies drift, and the drift shows up as two surfaces disagreeing about the
 * same prayer by a minute. Both functions are in `data/prayer/prayer-clock.ts` now, which has no
 * imports at all and can therefore be reached from anywhere.
 *
 * ── Why every case fixes `now` explicitly ───────────────────────────────────
 * A countdown test that reads the real clock is a test that fails at midnight. `now` is a parameter on
 * both functions precisely so these cases are arithmetic rather than timing.
 */

/** Mountain View, mid-August: Pacific Daylight Time, UTC-7. */
const PDT_FAJR = '2026-08-10T04:44:00-07:00';
/** The same location in January: Pacific Standard Time, UTC-8. */
const PST_FAJR = '2026-01-15T06:12:00-08:00';

describe('minutes until a prayer', () => {
  it('measures from the instant, not from the wall clock', () => {
    // 04:44 PDT is 11:44Z. An hour earlier in UTC is 60 minutes, whatever zone the reader is in.
    const now = new Date('2026-08-10T10:44:00Z');
    expect(minutesUntilInstant(PDT_FAJR, now)).toBe(60);
  });

  it('is unaffected by the device zone', () => {
    /*
      The same instant expressed three ways. All three are the same moment, so all three must give the
      same answer — which is the property that makes the countdown correct for a traveller whose phone
      is still set to the airport they flew from.
    */
    const answers = [
      new Date('2026-08-10T10:44:00Z'),
      new Date('2026-08-10T14:44:00+04:00'),
      new Date('2026-08-10T03:44:00-07:00'),
    ].map((now) => minutesUntilInstant(PDT_FAJR, now));

    expect(new Set(answers).size).toBe(1);
    expect(answers[0]).toBe(60);
  });

  it('is zero exactly at the prayer instant, not negative and not one', () => {
    // The boundary the brief names. `0` renders as "now".
    expect(minutesUntilInstant(PDT_FAJR, new Date('2026-08-10T11:44:00Z'))).toBe(0);
  });

  it('never goes negative once the prayer has passed', () => {
    for (const minutes of [1, 5, 60, 1_440]) {
      const past = new Date(new Date(PDT_FAJR).getTime() + minutes * 60_000);
      expect(minutesUntilInstant(PDT_FAJR, past)).toBe(0);
    }
  });

  it('rounds up, so the figure shown is never less than the time remaining', () => {
    // 90 seconds out. Flooring would display "in 1 min" while 1.5 remained.
    const now = new Date(new Date(PDT_FAJR).getTime() - 90_000);
    expect(minutesUntilInstant(PDT_FAJR, now)).toBe(2);
  });

  it('handles a standard-time instant as readily as a daylight-time one', () => {
    // The offset inside the string is the one that applied on that date, so DST needs no branch here.
    const now = new Date('2026-01-15T13:12:00Z'); // 05:12 PST
    expect(minutesUntilInstant(PST_FAJR, now)).toBe(60);
  });

  it('survives a DST transition between now and the prayer', () => {
    /**
     * 2026-03-08 is the US spring transition: 02:00 PST becomes 03:00 PDT, so that local day is 23
     * hours long. A countdown computed by subtracting wall clocks would be an hour out across it; one
     * computed from instants cannot be.
     */
    const fajrAfterTransition = '2026-03-08T06:00:00-07:00'; // PDT, after the jump
    const nowBeforeTransition = new Date('2026-03-08T09:00:00Z'); // 01:00 PST, before it
    expect(minutesUntilInstant(fajrAfterTransition, nowBeforeTransition)).toBe(240);
  });

  it('returns zero rather than NaN for an unparseable instant', () => {
    expect(minutesUntilInstant('not a timestamp')).toBe(0);
    expect(minutesUntilInstant('')).toBe(0);
  });
});

describe('the countdown label', () => {
  it.each([
    [0, 'now'],
    [1, 'in 1 min'],
    [14, 'in 14 min'],
    [59, 'in 59 min'],
    [60, 'in 1 hr'],
    [61, 'in 1 hr 1 min'],
    [134, 'in 2 hr 14 min'],
    [254, 'in 4 hr 14 min'],
    [1_440, 'in 24 hr'],
  ])('formats %i minutes as "%s"', (minutes, expected) => {
    expect(formatTimeUntil(minutes)).toBe(expected);
  });

  it('never renders a negative duration', () => {
    for (const minutes of [-1, -60, -1_000]) {
      expect(formatTimeUntil(minutes)).toBe('now');
    }
  });

  it('composes with the measurement in one call', () => {
    const now = new Date(new Date(PDT_FAJR).getTime() - 254 * 60_000);
    expect(formatCountdownTo(PDT_FAJR, now)).toBe('in 4 hr 14 min');
  });
});

describe('the same-day and next-day cases the screens distinguish', () => {
  it('counts to a later prayer on the same day', () => {
    const isha = '2026-08-10T21:35:00-07:00';
    const now = new Date('2026-08-11T02:35:00Z'); // 19:35 PDT the same day
    expect(formatCountdownTo(isha, now)).toBe('in 2 hr');
  });

  it('counts to tomorrow’s Fajr after Isha, over a period longer than a day’s prayers', () => {
    /*
      The rollover case. `now` is a minute after Isha on the 10th; the target is Fajr on the 11th. The
      figure has to be the real gap — about seven hours — rather than a negative number, which is what
      reusing *today's* Fajr would have produced.
    */
    const tomorrowFajr = '2026-08-11T04:45:00-07:00';
    const justAfterIsha = new Date('2026-08-11T04:36:00Z'); // 21:36 PDT on the 10th
    expect(minutesUntilInstant(tomorrowFajr, justAfterIsha)).toBe(429);
    expect(formatCountdownTo(tomorrowFajr, justAfterIsha)).toBe('in 7 hr 9 min');
  });

  it('gives the same answer for a cached instant as for a fresh one', () => {
    /*
      A cached `DailyPrayerTimes` is JSON, so its `at` is the same string on reopen. The countdown is
      derived from that string, so a result read from storage counts down correctly with no second zone
      lookup — the offset that applied on the day is inside it.
    */
    const revived = JSON.parse(JSON.stringify({ at: PST_FAJR })) as { at: string };
    const now = new Date('2026-01-15T13:12:00Z');
    expect(minutesUntilInstant(revived.at, now)).toBe(minutesUntilInstant(PST_FAJR, now));
  });
});

describe('one implementation, not two', () => {
  it('is re-exported from the Faith home hook rather than reimplemented there', () => {
    /*
      `use-faith-home` used to own `formatTimeUntil`. It re-exports it now, so the call sites that found
      it there keep working and there is still exactly one function. Asserted by identity: a second copy
      would be a different function object, however identical its output.
    */
    expect(reExported).toBe(formatTimeUntil);
  });
});
