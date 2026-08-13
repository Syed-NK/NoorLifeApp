import fs from 'node:fs';
import path from 'node:path';

/**
 * No location-scoped date is read from a device-local getter.
 *
 * ── Why a source scan, on top of the behavioural suite ──────────────────────
 * `faith-location-calendar-day.test.ts` proves the current implementation resolves the day at the
 * location. It cannot prove the *next* one will: this is the fourth appearance of the same class of
 * bug in this module — `prayer/location-time-zone.ts` records the first three — and each time it was
 * fixed at the site where it was noticed rather than made unavailable.
 *
 * What the four have in common is a single line reading `getFullYear()`, `getMonth()` or
 * `getDate()` on a value that belongs to a place rather than to the user. So that is what this
 * forbids, on the files where "a place" is the whole subject.
 *
 * ── Why an allow-list of files rather than a rule everywhere ────────────────
 * Because the getters are not wrong in general. A reading log's "today" is genuinely the user's own
 * day and should follow their device; so does a locally-constructed `Date` in a test fixture. The
 * distinction is not the call, it is what the value is *about* — and that is a property of the file,
 * not of the expression. Enumerating the location-scoped files is the honest way to encode it, and
 * an added file that is not on the list is a decision somebody has to make deliberately.
 */

const REPO_ROOT = process.cwd();

/**
 * Files on the location-scoped date path.
 *
 * Every one of these answers a question of the form "what is true at the selected place". None of
 * them may reach for the device's calendar.
 */
const LOCATION_SCOPED_FILES: readonly string[] = [
  'src/features/faith/data/calendar-day.ts',
  'src/features/faith/data/prayer/adhan-prayer-times.repository.ts',
  'src/features/faith/data/prayer/location-time-zone.ts',
  'src/features/faith/data/prayer/prayer-clock.ts',
  'src/features/faith/data/hijri/hijri-calendar.repository.ts',
  'src/features/faith/data/hijri/hijri-observances.ts',
  'src/features/faith/screens/prayer-times-screen.tsx',
  'src/features/faith/data/prayer/prayer-interval.ts',
  'src/features/faith/components/prayer-journey-timeline.tsx',
  'src/features/faith/components/prayer-next-summary.tsx',
  'src/features/faith/hooks/use-faith-home.ts',
  'src/features/home/hooks/use-prayer-timeline-entry.ts',
  'src/features/faith/di/faith-repository-context.tsx',
];

/**
 * There are no exceptions, and that is the strongest form this rule has taken.
 *
 * ── It used to have one ─────────────────────────────────────────────────────
 * `deviceCivilDate` lived in `calendar-day.ts` as the fallback for "no location resolved yet", and
 * this map allowed its three getter calls. That fallback is deleted: an unresolved location is a
 * state in `LocationDayResolution` now, not a substituted value, so nothing on the location-scoped
 * path has any reason to read the device's calendar — and the empty map says so more clearly than
 * any comment could.
 *
 * Kept as an empty map rather than removed, because the next person to need an exception should
 * have to add one deliberately, in a place that already explains what an exception costs.
 */
const DEVICE_GETTER_EXCEPTIONS: Readonly<Record<string, number>> = {};

/** Executable text only, so the prose explaining a prohibition is not what fails the scan. */
function executable(file: string): string {
  return fs
    .readFileSync(path.join(REPO_ROOT, file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

/** `getFullYear`, `getMonth`, `getDate` — the three that turn an instant into a device day. */
const DEVICE_DAY_GETTERS = /\.(getFullYear|getMonth|getDate)\s*\(/g;

describe('no location-scoped file reads the device’s calendar day', () => {
  it('scans files that actually exist', () => {
    for (const file of LOCATION_SCOPED_FILES) {
      expect(fs.existsSync(path.join(REPO_ROOT, file))).toBe(true);
    }
  });

  it.each(LOCATION_SCOPED_FILES)('%s', (file) => {
    const matches = executable(file).match(DEVICE_DAY_GETTERS) ?? [];
    const allowed = DEVICE_GETTER_EXCEPTIONS[file] ?? 0;

    /*
      A count rather than a boolean, so the one sanctioned reader cannot quietly become two. The
      exception is a line, not a licence for the file.
    */
    expect(matches).toHaveLength(allowed);
  });

  /**
   * `civilDateOf` is the old helper the defect ran through, and it is now reachable from one place.
   *
   * It survives because the Hijri repository still needs a device day as its no-location default.
   * What it may not do is reappear on the prayer path, which is where it caused the damage.
   */
  it('keeps civilDateOf off the prayer path entirely', () => {
    for (const file of LOCATION_SCOPED_FILES) {
      if (file.includes('/hijri/hijri-calendar.repository.ts')) {
        // The default-day fallback, for a caller that supplies no resolver.
        continue;
      }
      expect(executable(file)).not.toMatch(/\bcivilDateOf\b/);
    }
  });

  /**
   * The reading log's device-local "today" is not on the prayer path any more.
   *
   * `todayIsoDate()` reads device getters and is correct for what it is for — a user has read
   * *today*, in their own day, wherever they are. It was also what the Prayer screen passed as the
   * day to calculate prayer times for, which is how the times came from the device's calendar while
   * the next prayer came from the location's.
   */
  it('does not let the reading log’s day back onto a prayer screen', () => {
    const screen = executable('src/features/faith/screens/prayer-times-screen.tsx');
    expect(screen).not.toMatch(/todayIsoDate/);
    // And the replacement is present, so this cannot pass by the call simply having been deleted.
    expect(screen).toMatch(/locationCalendarDay/);
  });

  /**
   * The Hijri seam takes a calendar day, not a `Date`.
   *
   * Asserted as a source fact because it is the shape of the correction: a `Date` has to be read
   * through some zone to become a day, and that reading is what went wrong. Every wiring of
   * `hijriFor` must therefore pass the function that takes a string.
   */
  it.each([
    'src/features/faith/di/faith-repository-context.tsx',
    'src/features/faith/data/mock/index.ts',
  ])('%s wires hijriFor to the calendar-day converter', (file) => {
    const source = executable(file);
    expect(source).toMatch(/hijriFor:\s*formattedHijriForCalendarDay/);
    // The exact expression the defect lived in.
    expect(source).not.toMatch(/hijriDateFor\(civilDateOf\(/);
  });
});

/**
 * No location-scoped value has a fallback of any kind.
 *
 * ── Why this is separate from the getter scan above ─────────────────────────
 * The transient fallback that had to be withdrawn did not read a device getter at the point of use.
 * It called `civilDateAtZoneOrDevice`, which read one *elsewhere* — so the file-level getter rule
 * was satisfied while the behaviour it exists to prevent was happening anyway. What actually made it
 * possible was a **total return type**: `() => CivilDate` has no way to say "not yet", so the
 * implementation had to invent a value.
 *
 * These check the shape rather than the call, which is where the defect really lived.
 */
describe('no location-scoped date has a fallback', () => {
  const boundary = executable('src/features/faith/data/calendar-day.ts');

  it('withdraws every helper that could produce a substituted day', () => {
    for (const gone of [
      'createLocationDayResolver',
      'civilDateAtZoneOrDevice',
      'deviceCivilDate',
    ]) {
      expect(boundary).not.toMatch(new RegExp(`\\b${gone}\\b`));
    }
  });

  /**
   * The derivation returns a union with an unresolved member, so it cannot be forced to guess.
   *
   * A future change back to a total return type would have to delete these lines to pass, which is
   * the level of deliberateness this decision deserves.
   */
  it('returns a state union rather than a bare date', () => {
    expect(boundary).toMatch(/export type LocationDayResolution =/);
    expect(boundary).toMatch(/status: 'zone-unresolved'/);
    expect(boundary).toMatch(/status: 'expired'/);
    expect(boundary).toMatch(/locationDayFor\(\s*location: LocationLike,\s*instant: Date,?\s*\)/);
  });

  /** Freshness policy is expressed as named constants, not buried in a comparison. */
  it('states its freshness policy as constants', () => {
    expect(boundary).toMatch(/export const LOCATION_DAY_STALE_AFTER_MS/);
    expect(boundary).toMatch(/export const LOCATION_DAY_MAX_AGE_MS/);
  });

  /**
   * The DI module wires no day resolver at all any more.
   *
   * It used to construct the background-refreshing cell that served the device day. The calendar
   * repository now takes its location per call, so there is nothing to wire and nothing to race.
   */
  it('wires no today-resolver into the calendar repository', () => {
    const di = executable('src/features/faith/di/faith-repository-context.tsx');
    expect(di).toMatch(/createHijriCalendarRepository\(\)/);
    expect(di).not.toMatch(/todayCivilDate|createLocationDayResolver/);
  });

  /**
   * Provenance travels with the location, so a consumer can see how old the evidence is.
   *
   * Without it a caller would have to either trust the location blindly or go back to storage, and
   * "where did this come from" going unasked is what this whole correction is about.
   */
  it('carries provenance on the location itself', () => {
    const contract = executable('src/features/faith/data/prayer-times.repository.ts');
    expect(contract).toMatch(/readonly resolvedAt: string \| null;/);
  });
});

describe('the correction introduces no network dependency and no external calendar', () => {
  const DATE_PATH: readonly string[] = [
    'src/features/faith/data/calendar-day.ts',
    'src/features/faith/data/hijri/hijri-calendar.ts',
    'src/features/faith/data/hijri/hijri-calendar.repository.ts',
    'src/features/faith/data/hijri/hijri-observances.ts',
    'src/features/faith/data/prayer/location-time-zone.ts',
    'src/features/faith/data/prayer/adhan-prayer-times.repository.ts',
  ];

  it.each(DATE_PATH)('%s makes no request and imports no service', (file) => {
    const source = executable(file);
    expect(source).not.toMatch(/\bfetch\s*\(/);
    expect(source).not.toMatch(/XMLHttpRequest|axios|https?:\/\//);
    expect(source).not.toMatch(/supabase|functions\.invoke/i);
  });

  /**
   * The Hijri arithmetic itself is untouched by this correction.
   *
   * The brief is explicit that the algorithm may not change without a separately proven defect. This
   * pins the two constants that define it — the civil epoch and the 30-year leap cycle — so a future
   * edit to "improve accuracy" has to be a deliberate act against a failing test rather than a
   * silent drift.
   */
  it('leaves the tabular calendar’s epoch and leap cycle as they were', () => {
    const source = executable('src/features/faith/data/hijri/hijri-calendar.ts');
    expect(source).toMatch(/HIJRI_EPOCH_JDN\s*=\s*1948440/);
    expect(source).toMatch(/\[2, 5, 7, 10, 13, 16, 18, 21, 24, 26, 29\]/);
  });

  /** Nothing produced by this path claims a sighting. */
  it('produces only calculated dates, never a confirmed sighting', () => {
    for (const file of DATE_PATH) {
      expect(executable(file)).not.toMatch(/'confirmed-sighting'/);
    }
  });
});
