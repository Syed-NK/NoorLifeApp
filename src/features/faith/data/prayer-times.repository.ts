import type { FaithResult } from './faith-result';

/**
 * Prayer times, and the preferences that determine them.
 *
 * ── Why location is a parameter rather than a dependency ────────────────────
 * A prayer time is a function of a coordinate, a date and a calculation method. Making
 * the coordinate an argument keeps this repository pure with respect to device
 * permissions: the *screen* decides whether to ask for location, fall back to a
 * manually chosen city, or render the `permission-required` state. A repository that
 * reached for the GPS itself would make that decision untestable and would put a
 * permission prompt behind a data call.
 *
 * `PrayerTimesRepository` therefore never returns `permission-required` from
 * `getDailyTimes` — the caller has already resolved a coordinate by then. It *is* a
 * legitimate result from `resolveCurrentLocation`.
 */

export type PrayerKey = 'fajr' | 'sunrise' | 'dhuhr' | 'asr' | 'maghrib' | 'isha';

/** The five obligatory prayers. Sunrise is a time marker, not a prayer. */
export const OBLIGATORY_PRAYERS: readonly PrayerKey[] = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];

export type Coordinate = {
  readonly latitude: number;
  readonly longitude: number;
};

/**
 * Where the active location's authority comes from.
 *
 * Defined here, in the domain, rather than in the storage module that persists it — because it is
 * what every screen branches on, and a screen reaching into `storage/` to name a mode would put the
 * persistence layer in the import graph of the presentation layer. `prayer-location-store.ts` imports
 * it from here, which is the direction that already holds for `Coordinate`.
 *
 * ── Why `coordinates` is a mode and not a flavour of `city` ─────────────────
 * A city carries GeoNames identity — an id, a country, a region — and can be re-validated against the
 * catalogue it came from. A typed coordinate carries none of that and must never be rendered as
 * though it did. They share only the property below.
 */
export type PrayerLocationMode = 'device' | 'city' | 'coordinates';

/**
 * Whether the location was **chosen by the user**, and must therefore survive a device refresh.
 *
 * ── One predicate, so the answer cannot differ by call site ─────────────────
 * This replaced `mode === 'manual'` written out at a dozen places. Spelling the question as a literal
 * comparison made each site responsible for knowing the full set of modes that count — so splitting
 * `manual` into `city` and `coordinates` would have meant finding all of them and remembering that
 * both are user authority. The edit that gets eleven of twelve right silently lets a GPS fix
 * overwrite somebody's saved city on the twelfth, and nothing on screen would say so.
 *
 * Deliberately a function of `mode` rather than a stored boolean beside it: a second field would be
 * the same fact expressed twice, which is the contradiction the schema was rewritten to remove.
 */
export function isUserSelectedLocation(location: { readonly mode: PrayerLocationMode }): boolean {
  return location.mode === 'city' || location.mode === 'coordinates';
}

export type PrayerLocation = {
  readonly coordinate: Coordinate;
  /** Human-readable place, e.g. "Manchester, United Kingdom". */
  readonly label: string;
  /** IANA zone, e.g. "Europe/London". Times are meaningless without it. */
  readonly timeZone: string;
  /**
   * Which of the three authorities produced this location.
   *
   * Replaced a `manual: boolean`. The boolean could not distinguish a catalogue city from a typed
   * coordinate, so every consumer that wanted to say where a place came from — the provenance sheet,
   * the Qibla screen's caption, the Hijri day's evidence — had to describe both as "chosen by the
   * user" and stop there. Carrying the discriminant through means a surface can be as specific as the
   * record actually justifies, and `isUserSelectedLocation` still answers the authority question in
   * one place.
   */
  readonly mode: PrayerLocationMode;
  /**
   * When this location was resolved, ISO-8601, or `null` for one that has never been stored.
   *
   * ── Why provenance travels with the location ────────────────────────────────
   * Anything derived from a location inherits that location's age, and a consumer that cannot see
   * the age has to either trust it blindly or go back to storage for it. The Hijri date is the case
   * that made this necessary: it is a claim about *now*, so how old the place behind it is decides
   * whether it may be stated at all — see `data/calendar-day.ts`.
   *
   * `null` for a search result the user has not selected: it describes a place, not a fix, and has
   * no resolution moment until it is stored.
   */
  readonly resolvedAt: string | null;
};

/**
 * Calculation conventions.
 *
 * Deliberately an enumerated set rather than free numeric angles: the app must not
 * invent a convention, and every value here corresponds to a body that publishes one.
 */
export type CalculationMethod =
  | 'muslim-world-league'
  | 'umm-al-qura'
  | 'egyptian'
  | 'karachi'
  | 'isna'
  | 'moonsighting-committee';

/** Asr shadow-length convention. */
export type AsrJuristicMethod = 'standard' | 'hanafi';

export type PrayerCalculationSettings = {
  readonly method: CalculationMethod;
  readonly asr: AsrJuristicMethod;
  /** Per-prayer manual offset in minutes, for local mosque alignment. */
  readonly offsetsMinutes: Readonly<Partial<Record<PrayerKey, number>>>;
};

export type PrayerTime = {
  readonly key: PrayerKey;
  readonly label: string;
  /** ISO-8601 with offset, so a rendered time can never lose its zone. */
  readonly at: string;
};

export type DailyPrayerTimes = {
  /** ISO date, `YYYY-MM-DD`. */
  readonly date: string;
  readonly hijriDate: string;
  readonly location: PrayerLocation;
  readonly settings: PrayerCalculationSettings;
  readonly times: readonly PrayerTime[];
};

/**
 * The result of asking for a fresh position.
 *
 * `location` is always the location now in force — the newly accepted one when `accepted` is true,
 * and the unchanged stored one when it is false. A caller can therefore render it without branching,
 * and only has to look at `materialChange` to decide whether anything derived from the old
 * coordinate has to be recalculated.
 */
export type LocationRefresh = {
  readonly location: PrayerLocation;
  /** Whether the new fix replaced what was stored. */
  readonly accepted: boolean;
  /**
   * Whether the coordinate moved far enough to invalidate the derived schedule.
   *
   * Never true when `accepted` is false. This is the flag that triggers recalculating prayer times,
   * the Hijri date, the countdown and the notification schedule together.
   */
  readonly materialChange: boolean;
  /** How far the accepted coordinate moved, in metres. Zero on a first resolution. */
  readonly movedMetres: number;
  /** Why a fix was not accepted, for the screen to state honestly. `null` when it was. */
  readonly rejectedReason:
    'accuracy-unusable' | 'not-better-than-recent' | 'invalid-coordinate' | null;
  /**
   * The mode in force.
   *
   * Anything `isUserSelectedLocation` accepts means no device position was requested — the saved
   * place *is* the answer. A screen reads this to decide whether "could not get a new position" is
   * even a meaningful thing to say, and it is not: nothing was attempted, so nothing failed.
   */
  readonly mode: PrayerLocationMode;
};

/**
 * One city from the bundled GeoNames catalogue, as the domain's shape.
 *
 * ── Why a screen never sees a catalogue row ─────────────────────────────────
 * The catalogue is eight parallel arrays indexed by position, with a country *code* and a possibly
 * empty region string — a representation chosen so 34,084 rows can be scanned per keystroke without
 * allocating. That is the right shape for a search loop and the wrong shape for anything else: a
 * screen holding an index position would break the moment the asset is re-imported and the ordering
 * changes, and a screen holding `''` for "no region" would render an empty line rather than omitting
 * one.
 *
 * So the repository converts. A `CityChoice` is stable, self-describing, and carries the identity a
 * save needs to re-validate itself — see `saveCityLocation`.
 */
export type CityChoice = {
  /** The catalogue's identity for this settlement. What a save re-validates against. */
  readonly geonamesId: number;
  /** The place as GeoNames spells it, accents intact. */
  readonly name: string;
  /** First administrative division, or `null` where the source has none. Never `''`. */
  readonly region: string | null;
  readonly countryCode: string;
  /** The country's name, so a row never renders a bare two-letter code. */
  readonly countryName: string;
  readonly coordinate: Coordinate;
};

/**
 * How a city is named on screen and in the stored record.
 *
 * ── Why the region is dropped when it repeats the city ──────────────────────
 * GeoNames' first administrative division is frequently the city itself — Dubai is in Dubai, Tokyo is
 * in Tokyo, Kuwait City is in Al Asimah but Singapore is in Singapore. Emitting both produces "Dubai,
 * Dubai, United Arab Emirates", which reads as a data error to anybody who does not know the schema.
 * Where the region genuinely differs it is real information and is kept: "Lahore, Punjab, Pakistan".
 *
 * One function, so the label a user confirmed in the preview is byte-for-byte the label that gets
 * stored and the label every later screen renders. Two formatters would eventually disagree, and the
 * disagreement would look like the app having silently changed the user's location.
 */
export function cityLabel(city: CityChoice): string {
  const parts =
    city.region === null || city.region === city.name
      ? [city.name, city.countryName]
      : [city.name, city.region, city.countryName];
  return parts.join(', ');
}

/**
 * A city with everything a user needs to confirm it, resolved but **not** saved.
 *
 * The preview is the point of the two-step flow. A row in a result list is a name, and a name is not
 * enough to commit every prayer time in the app to — two cities share a name far more often than
 * people expect. The coordinate and the resolved zone are what let somebody see that the Dubai they
 * picked is the one at 25.07°N in `Asia/Dubai`, before anything is written.
 */
export type CityPreview = {
  readonly city: CityChoice;
  /** Resolved locally from the coordinate, by the same lookup every prayer time uses. */
  readonly timeZone: string;
  /** The credit CC BY 4.0 requires, read from the asset rather than retyped in a screen. */
  readonly attribution: string;
};

/** Which prayer is next, and how long until it. Derived, but derived in one place. */
export type NextPrayer = {
  readonly prayer: PrayerTime;
  readonly minutesUntil: number;
};

/** Per-prayer reminder preference. A contract only — no notification is scheduled yet. */
export type PrayerNotificationPreference = {
  readonly prayer: PrayerKey;
  readonly enabled: boolean;
  /** Minutes before the prayer time. 0 means at the time itself. */
  readonly minutesBefore: number;
};

export type PrayerTimesRepository = {
  /**
   * Resolves where the user is.
   *
   * The one method that may return `permission-required`, because it is the one that
   * needs the OS.
   */
  resolveCurrentLocation(): Promise<FaithResult<PrayerLocation>>;

  /**
   * Acquires a **new** position and applies the acceptance policy to it.
   *
   * ── Why this is separate from `resolveCurrentLocation` ──────────────────────
   * `resolveCurrentLocation` prefers what is stored, which is right for a render: it is instant, and
   * the coordinate behind it has usually moved by metres. That is exactly wrong for a refresh
   * control — a button that hands back the fix it already had is a button that appears to work and
   * does nothing.
   *
   * So this one always asks the platform for a live fix, and then *decides* whether to keep it. The
   * decision is `acceptLocationFix`, and the outcome says which way it went, because the caller has
   * different work to do: a materially different coordinate invalidates the day's prayer times, the
   * Hijri date and every scheduled notification, while an accepted fix in the same place is a quiet
   * storage refresh nothing downstream needs to react to.
   */
  refreshDeviceLocation(): Promise<FaithResult<LocationRefresh>>;

  /**
   * The coordinate-derived IANA zone for a typed coordinate, without saving anything.
   *
   * Backs the form's "Preview location" action. Offline and synchronous in substance — it is a
   * lookup in a bundled polygon set, not a network call — so a user can confirm that 25.2048,
   * 55.2708 really is `Asia/Dubai` *before* committing it to every prayer time in the app.
   *
   * `null` when the coordinate resolves to no zone, which is the honest answer for mid-ocean.
   */
  previewLocation(coordinate: Coordinate): PrayerLocation | null;

  /**
   * Saves a coordinate the user typed, and switches to `coordinates` mode.
   *
   * ── Why the repository owns this rather than the screen ─────────────────────
   * Because the write has to be ordered against the zone resolution and the revision bump, and a
   * screen that did it in three steps could persist a coordinate whose zone does not resolve — which
   * is a stored location every future launch fails on.
   *
   * The label is stored verbatim and never verified. It is the user's reference, and the screen says
   * so; nothing downstream treats it as evidence of where the coordinate is.
   */
  saveCoordinateLocation(input: {
    readonly label: string;
    readonly coordinate: Coordinate;
  }): Promise<FaithResult<PrayerLocation>>;

  /**
   * Cities matching a typed query, from the bundled catalogue. **Entirely offline.**
   *
   * ── The cost guarantee, expressed as a call graph ───────────────────────────
   * There is no transport anywhere beneath this method. It reaches a bundled JSON asset through
   * `require` and searches it in memory, so no query a user types can leave the device and no
   * keystroke can bill anybody. That is a structural property rather than a policy: the modules it
   * calls have no fetch, no URL and no host to reach — see `data/location/city-catalogue.ts`.
   *
   * `no-results` for a query shorter than two meaningful characters, which is the same answer as
   * "nothing matched" on purpose: the screen decides which prompt to render from the query it already
   * holds, rather than from a sentinel returned here.
   */
  searchCities(query: string): Promise<FaithResult<readonly CityChoice[]>>;

  /**
   * Everything needed to confirm a city, without saving it.
   *
   * Resolves the IANA zone from the city's own coordinate, through the same offline polygon lookup
   * every prayer time in the app already uses — so the zone shown in the preview is, by construction,
   * the zone the times will be calculated in.
   */
  previewCity(city: CityChoice): Promise<FaithResult<CityPreview>>;

  /**
   * Saves a city the user selected, and switches to `city` mode.
   *
   * ── Why the catalogue record is re-read rather than trusted ─────────────────
   * The `CityChoice` handed back here has been through a screen: it sat in React state across
   * renders, a search, a preview and a scroll. Re-reading it from the catalogue by `geonamesId` and
   * confirming the coordinate still matches costs one scan and turns "the screen passed us the right
   * object" from an assumption into a checked fact. A city record that no longer validates is
   * rejected rather than stored — a stored `city` mode carries GeoNames provenance, and provenance
   * that cannot be re-derived is a credit the app has no basis to display.
   */
  saveCityLocation(city: CityChoice): Promise<FaithResult<PrayerLocation>>;

  /**
   * Switches back to device mode — but only if a real fix can be obtained first.
   *
   * ── The order is the whole guarantee ────────────────────────────────────────
   * Permission, then a live fix, then a zone, and only then the mode change and the write. Switching
   * the mode first and fetching afterwards is the obvious shape and is wrong: a failed fetch would
   * leave the app in device mode with a manual coordinate, and the next refresh would replace the
   * user's saved city with whatever stale fix the platform still held.
   *
   * On failure nothing is written. The saved manual location stays active and stays selected.
   */
  switchToDeviceLocation(): Promise<FaithResult<PrayerLocation>>;

  /** The mode in force. `null` when no location has ever been resolved. */
  getActiveLocationMode(): Promise<PrayerLocationMode | null>;

  /**
   * Today's Gregorian calendar day **at the location**, `YYYY-MM-DD`, or `null` if the zone will
   * not resolve.
   *
   * ── Why a repository method rather than a helper the screen imports ────────
   * Because "today" needs the clock, and the clock is injected here. A screen calling `new Date()`
   * would be a second, untestable source of now — and a screen deriving the day itself is exactly
   * how this went wrong: the Prayer screen passed `todayIsoDate()`, which reads device-local
   * getters, so the day's times were computed for the device's calendar day while `getNextPrayer`
   * used the location's. One screen, two different days.
   *
   * Synchronous, and deliberately: it is a zone lookup and integer arithmetic, no I/O. Returning a
   * promise would imply a round trip and invite somebody to cache it.
   */
  locationCalendarDay(location: PrayerLocation): string | null;

  getDailyTimes(
    location: PrayerLocation,
    date: string,
    settings: PrayerCalculationSettings,
  ): Promise<FaithResult<DailyPrayerTimes>>;

  getMonthlyTimes(
    location: PrayerLocation,
    month: string,
    settings: PrayerCalculationSettings,
  ): Promise<FaithResult<readonly DailyPrayerTimes[]>>;

  getNextPrayer(
    location: PrayerLocation,
    settings: PrayerCalculationSettings,
  ): Promise<FaithResult<NextPrayer>>;

  readNotificationPreferences(): Promise<FaithResult<readonly PrayerNotificationPreference[]>>;

  writeNotificationPreferences(
    preferences: readonly PrayerNotificationPreference[],
  ): Promise<FaithResult<readonly PrayerNotificationPreference[]>>;
};
