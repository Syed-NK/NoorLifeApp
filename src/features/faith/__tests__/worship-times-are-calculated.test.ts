import { createMockWorshipRepository } from '../data/mock/mock-worship.repository';
import type { PrayerKey } from '../data/prayer-times.repository';
import { hasData } from '../data/faith-result';
import { todayIso } from '../data/mock/mock-support';

/**
 * The worship checklist states no prayer time it did not calculate.
 *
 * ── The defect this locks out ───────────────────────────────────────────────
 * The seed carried `5:02 AM`, `12:35 PM`, `4:15 PM`, `8:44 PM`, `10:10 PM` — the five constants the
 * deleted prayer-times fixture returned for every location on every date. They outlived that
 * fixture, so Faith Home rendered a calculated next prayer in its hero and those five directly
 * beneath it. One screen, two different claims about the same day, and the wrong one was the one
 * the user could tick.
 *
 * `defaultStatus` carried the same constants as `[5, 12, 16, 20, 22]`, which meant an untouched day
 * marked prayers `missed` on the clock of a place the user was not in.
 *
 * ── Why the assertions are on behaviour, not on the seed ────────────────────
 * A test that grepped the seed for `5:02 AM` would pass the moment somebody wrote `05:02`. These
 * drive the repository with a known time source and with none, and check what comes out.
 */

const TODAY = todayIso();

/** An ISO timestamp today at a given hour, with an explicit offset so parsing cannot drift. */
function at(hour: number, minute = 0): string {
  const hh = String(hour).padStart(2, '0');
  const mm = String(minute).padStart(2, '0');
  return `${TODAY}T${hh}:${mm}:00+00:00`;
}

function times(entries: readonly (readonly [PrayerKey, string])[]): ReadonlyMap<PrayerKey, string> {
  return new Map(entries);
}

describe('with no location, and therefore no calculation', () => {
  it('states no time for any prayer', async () => {
    const repository = createMockWorshipRepository();
    const day = await repository.getDay(TODAY);

    expect(hasData(day)).toBe(true);
    if (!hasData(day)) return;

    const prayers = day.data.entries.filter((entry) => entry.kind === 'prayer');
    expect(prayers.length).toBeGreaterThan(0);
    for (const prayer of prayers) {
      expect(prayer.detail).toBeUndefined();
    }
  });

  it('still lists the prayers, so the checklist remains usable', async () => {
    const repository = createMockWorshipRepository();
    const day = await repository.getDay(TODAY);
    if (!hasData(day)) throw new Error('expected a day');

    expect(day.data.entries.map((entry) => entry.key)).toEqual(
      expect.arrayContaining(['fajr', 'dhuhr', 'asr', 'maghrib', 'isha']),
    );
  });

  it('accuses nobody of missing a prayer it cannot time', async () => {
    const repository = createMockWorshipRepository();
    const day = await repository.getDay(TODAY);
    if (!hasData(day)) throw new Error('expected a day');

    expect(day.data.entries.some((entry) => entry.status === 'missed')).toBe(false);
  });
});

describe('with calculated times', () => {
  const source = async () =>
    times([
      ['fajr', at(5, 2)],
      ['dhuhr', at(12, 35)],
      ['asr', at(16, 15)],
      ['maghrib', at(20, 44)],
      ['isha', at(22, 10)],
    ]);

  it('renders each prayer at the time it was given', async () => {
    const repository = createMockWorshipRepository(source);
    const day = await repository.getDay(TODAY);
    if (!hasData(day)) throw new Error('expected a day');

    const byKey = new Map(day.data.entries.map((entry) => [entry.key, entry.detail]));
    // Formatted through the same clock formatter the hero uses, in the calculation's own offset.
    expect(byKey.get('fajr')).toBe('5:02 AM');
    expect(byKey.get('dhuhr')).toBe('12:35 PM');
    expect(byKey.get('isha')).toBe('10:10 PM');
  });

  it('leaves non-prayer acts alone', async () => {
    const repository = createMockWorshipRepository(source);
    const day = await repository.getDay(TODAY);
    if (!hasData(day)) throw new Error('expected a day');

    const byKey = new Map(day.data.entries.map((entry) => [entry.key, entry.detail]));
    expect(byKey.get('quran')).toBe('Daily portion');
    /**
     * Morning Adhkar carries no detail at all. It used to read `'Completed'` — a status word in a
     * field rendered as a subtitle, so an unmarked entry described itself as done.
     */
    expect(byKey.get('adhkar')).toBeUndefined();
  });

  it('survives a time source that rejects, without failing the whole day', async () => {
    const repository = createMockWorshipRepository(async () => {
      throw new Error('location unavailable');
    });
    const day = await repository.getDay(TODAY);

    // The user's marks are on this device; a failed calculation is not a failed checklist.
    expect(hasData(day)).toBe(true);
    if (!hasData(day)) return;
    expect(day.data.entries.length).toBeGreaterThan(0);
  });
});
