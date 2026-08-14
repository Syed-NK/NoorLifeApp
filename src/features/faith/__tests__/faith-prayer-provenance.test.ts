import fs from 'node:fs';
import path from 'node:path';

import {
  assertNoHardCodedPrayerValues,
  describePrayerProvenance,
  PRAYER_ORIGIN_LABELS,
  type PrayerValueOrigin,
} from '../data/prayer/prayer-provenance';
import type { DailyPrayerTimes, NextPrayer } from '../data/prayer-times.repository';

/**
 * Every value the Prayer screen displays is derived, and the diagnostic that says so leaks nothing.
 *
 * ── The two halves, and why both are needed ─────────────────────────────────
 * The source scan below proves a *literal* is absent from production code. It cannot prove the
 * value on screen was calculated — a fixture read from storage would pass it. The provenance report
 * covers the other half: for a given rendering it names the mechanism behind each slot, and the
 * repository's own suites prove those mechanisms are real.
 *
 * Neither is sufficient alone. The module has already shipped a fixture that passed every test it
 * had, because the tests asserted the shape of the data rather than its origin.
 */

const REPO_ROOT = process.cwd();

/**
 * The values visible in the approved capture.
 *
 * Each is a plausible, correct-looking value — which is the point. A wrong prayer time announces
 * itself; a *right-looking* one that is the same for every user does not, and that is the defect
 * this module has already shipped once.
 *
 * They may legitimately appear in tests and in captured screenshots. What they may not be is a
 * literal in a file that a production render can reach.
 */
const SCREENSHOT_VALUES: readonly (readonly [string, RegExp])[] = [
  ['Mountain View, United States', /Mountain\s+View/],
  ['27 Safar 1448 AH', /\b\d{1,2}\s+Safar\s+1448\s*AH/],
  ['a displayed clock time', /['"`][^'"`]*\b\d{1,2}:\d{2}\s*(AM|PM)\b/i],
  ['1:14 PM specifically', /\b1:14\s*PM/i],
  ['a baked countdown', /['"`]\s*in\s+\d+\s*(hr|hour|min)/i],
];

/**
 * Production files a Prayer value could reach the screen through.
 *
 * Enumerated rather than globbed, so adding a file to the Prayer path is a deliberate act that
 * shows up in this list rather than something the scan silently starts or stops covering.
 */
const PRAYER_PRODUCTION_FILES: readonly string[] = [
  'src/features/faith/screens/prayer-times-screen.tsx',
  'src/features/faith/components/prayer-journey-timeline.tsx',
  'src/features/faith/components/prayer-next-summary.tsx',
  'src/features/faith/components/prayer-action-cards.tsx',
  'src/features/faith/components/prayer-progress-ring.tsx',
  'src/features/faith/components/prayer-provenance-dev-audit.tsx',
  'src/features/faith/data/prayer/prayer-interval.ts',
  'src/features/faith/data/prayer-times.repository.ts',
  'src/features/faith/data/prayer/adhan-prayer-times.repository.ts',
  'src/features/faith/data/prayer/prayer-clock.ts',
  'src/features/faith/data/prayer/location-time-zone.ts',
  'src/features/faith/data/prayer/prayer-provenance.ts',
  'src/features/faith/data/location/expo-location.port.ts',
  'src/features/faith/hooks/use-prayer-countdown.ts',
  'src/features/faith/di/faith-repository-context.tsx',
  'src/features/faith/storage/faith-preferences.ts',
  'src/features/faith/storage/faith-location.ts',
];

/** Executable text only, so the prose above a prohibition is not what fails a scan. */
function executable(file: string): string {
  return fs
    .readFileSync(path.join(REPO_ROOT, file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

describe('no screenshot value is a production literal', () => {
  it('scans files that actually exist', () => {
    for (const file of PRAYER_PRODUCTION_FILES) {
      expect(fs.existsSync(path.join(REPO_ROOT, file))).toBe(true);
    }
  });

  describe.each(PRAYER_PRODUCTION_FILES)('%s', (file) => {
    it.each(SCREENSHOT_VALUES)('holds no %s', (_name, pattern) => {
      expect(executable(file)).not.toMatch(pattern);
    });
  });

  /**
   * `Muslim World League` is the one screenshot value that legitimately appears in production —
   * and it is a *label for a preference*, not a value about the user's day.
   *
   * It is allowed in exactly one file: the preferences picker, where it is the visible name of a
   * `CalculationMethod` the user can select. The Prayer screen itself must derive the string from
   * whichever method is stored, which is what stops the card disagreeing with the times above it.
   */
  it('names a calculation method only where the user picks one', () => {
    const allowed = 'src/features/faith/screens/preferences-screen.tsx';
    expect(executable(allowed)).toMatch(/Muslim World League/);

    for (const file of PRAYER_PRODUCTION_FILES) {
      expect(executable(file)).not.toMatch(/Muslim World League/);
    }
  });

  /**
   * There is no default coordinate, city or region anywhere on the Prayer path.
   *
   * The screenshot's location is the emulator's own fix. What would make it a defect is a fallback
   * that produced a plausible place when the device produced none — so the check is for the shape
   * of one rather than for that particular city.
   */
  it('carries no fallback coordinate or default city', () => {
    for (const file of PRAYER_PRODUCTION_FILES) {
      const source = executable(file);
      // A latitude/longitude pair written as a literal object.
      expect(source).not.toMatch(/latitude:\s*-?\d+\.\d+/);
      expect(source).not.toMatch(/longitude:\s*-?\d+\.\d+/);
      expect(source).not.toMatch(/(DEFAULT|FALLBACK)_(LOCATION|CITY|COORDINATE|TIMEZONE|ZONE)/i);
    }
  });
});

/** A day and a next prayer, shaped like the repository's output. Values are irrelevant here. */
function sampleDay(overrides: Partial<DailyPrayerTimes> = {}): DailyPrayerTimes {
  return {
    date: '2026-08-12',
    hijriDate: '27 Safar 1448 AH',
    location: {
      coordinate: { latitude: 37.386, longitude: -122.084 },
      label: 'A Place, A Country',
      timeZone: 'America/Los_Angeles',
      mode: 'device',
      resolvedAt: '2026-08-12T00:00:00Z',
    },
    settings: { method: 'muslim-world-league', asr: 'standard', offsetsMinutes: {} },
    times: [
      { key: 'fajr', label: 'Fajr', at: '2026-08-12T04:44:00-07:00' },
      { key: 'sunrise', label: 'Sunrise', at: '2026-08-12T06:19:00-07:00' },
      { key: 'dhuhr', label: 'Dhuhr', at: '2026-08-12T13:14:00-07:00' },
    ],
    ...overrides,
  };
}

const sampleNext: NextPrayer = {
  prayer: { key: 'dhuhr', label: 'Dhuhr', at: '2026-08-12T13:14:00-07:00' },
  minutesUntil: 74,
  dayRelation: 'today',
};

describe('the provenance report identifies a source for every visible value', () => {
  const report = describePrayerProvenance({
    day: sampleDay(),
    next: sampleNext,
    countdownLabel: 'a countdown',
  });

  it.each([
    'Location name',
    'Time zone the clocks are formatted in',
    'Hijri date',
    'Calculation method',
    'Asr juristic method',
    'Next prayer selection',
    'Countdown',
    'Day-arc marker positions',
  ])('covers %s', (slot) => {
    expect(report.entries.some((entry) => entry.slot === slot)).toBe(true);
  });

  it('reports one entry per time the day actually resolved, not a fixed six', () => {
    const three = describePrayerProvenance({
      day: sampleDay(),
      next: sampleNext,
      countdownLabel: null,
    });
    expect(three.entries.filter((entry) => entry.origin === 'adhan-calculation')).toHaveLength(
      // Three times, plus the next prayer's own time.
      4,
    );

    // A polar day with nothing resolved still produces a report, with no calculated entries but the
    // next-prayer row still present and marked unresolved.
    const none = describePrayerProvenance({
      day: sampleDay({ times: [] }),
      next: null,
      countdownLabel: null,
    });
    expect(none.entries.some((entry) => entry.slot === 'Next prayer selection')).toBe(true);
    expect(none.entries.find((entry) => entry.slot === 'Next prayer selection')?.resolved).toBe(
      false,
    );
  });

  it('tells a geocoded place name apart from a coordinate stand-in', () => {
    const geocoded = describePrayerProvenance({
      day: sampleDay(),
      next: null,
      countdownLabel: null,
    });
    expect(geocoded.entries[0]?.origin).toBe('device-reverse-geocoder');

    const bare = describePrayerProvenance({
      day: sampleDay({
        location: { ...sampleDay().location, label: '37.386, -122.084' },
      }),
      next: null,
      countdownLabel: null,
    });
    expect(bare.entries[0]?.origin).toBe('coordinate-derived-label');
  });

  it('declares no hard-coded fallback, because there is none', () => {
    expect(assertNoHardCodedPrayerValues(report)).toEqual([]);
  });

  it('gives every origin human wording', () => {
    for (const entry of report.entries) {
      expect(PRAYER_ORIGIN_LABELS[entry.origin as PrayerValueOrigin]).toBeTruthy();
    }
  });
});

describe('the diagnostic exposes no coordinate and no private value', () => {
  const day = sampleDay();
  const report = describePrayerProvenance({
    day,
    next: sampleNext,
    countdownLabel: '1 hr 14 min',
  });
  const serialised = JSON.stringify(report);

  it('prints no coordinate', () => {
    expect(serialised).not.toMatch(/37\.386|-?122\.084/);
    expect(serialised).not.toMatch(/latitude|longitude/i);
  });

  it('prints no place name, zone or clock time', () => {
    expect(serialised).not.toMatch(/A Place|A Country/);
    expect(serialised).not.toMatch(/America\/Los_Angeles/);
    expect(serialised).not.toMatch(/\d{1,2}:\d{2}/);
    expect(serialised).not.toMatch(/Safar|1448/);
    // The countdown's own text is not echoed either.
    expect(serialised).not.toMatch(/1 hr 14 min/);
  });

  it('marks every location-derived slot as withheld rather than silently omitting it', () => {
    const withheld = report.entries.filter((entry) => entry.redacted).map((entry) => entry.slot);
    expect(withheld).toEqual(
      expect.arrayContaining([
        'Location name',
        'Time zone the clocks are formatted in',
        'Fajr time',
        'Next prayer time',
      ]),
    );
  });

  /**
   * The diagnostic is guarded at exactly one place, and it is the render site.
   *
   * Asserted as a source fact because it cannot be asserted behaviourally: Jest runs with `__DEV__`
   * true, so a test can only ever observe the development branch. What is checkable is that the
   * guard exists and that the panel component is the only thing that has one.
   */
  it('is gated on __DEV__ at its single render site', () => {
    const panel = fs.readFileSync(
      path.join(REPO_ROOT, 'src/features/faith/components/faith-dev-audit.tsx'),
      'utf8',
    );
    expect(panel).toMatch(/if\s*\(!__DEV__\)\s*\{\s*return null;/);

    /*
      The pure report has no guard of its own — a `__DEV__` branch inside it would be untestable,
      because Jest only ever runs the development side of one. Comments are stripped first: that
      file's own prose explains why the guard is absent, and naming the thing it does not do is not
      the same as doing it.
    */
    expect(executable('src/features/faith/data/prayer/prayer-provenance.ts')).not.toMatch(
      /__DEV__/,
    );
  });
});
