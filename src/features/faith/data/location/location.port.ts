import type { Coordinate } from '../prayer-times.repository';

/**
 * The device's location and heading, as a port.
 *
 * ── Why a port rather than importing `expo-location` where it is needed ─────
 * Three reasons, in order of how much they matter.
 *
 * **It is the only way to test the states that matter.** Denied permission, a device with no
 * compass, a location that never resolves, a heading whose accuracy is too low to trust — every one
 * of those is a screen NoorLife has to render correctly and none of them is reachable from a Jest
 * environment through the real module. A fake implementing this interface reaches all of them.
 *
 * **It keeps the permission decision in one place.** A prompt raised from wherever a coordinate
 * happened to be needed is a prompt nobody can audit. There is exactly one implementation of
 * `requestPermission`, and the screens call it in response to a control the user pressed.
 *
 * **It bounds what the app can ask for.** There is no method here for background location, no
 * geofencing and no motion activity — capabilities the installed module has and NoorLife must not
 * grow into by accident.
 *
 * ── There is no fallback coordinate in this file, and there must never be ───
 * A location that could not be resolved is reported as such. It is not substituted with a city, a
 * country centroid, or the last place anybody was — a prayer time computed from a coordinate the
 * user is not at is wrong in a way they cannot see, and the Qibla arrow derived from it points
 * confidently into the wrong quarter of the sky.
 */

/** Whether the app may read the device's location. */
export type LocationPermission =
  /** Granted, and readable now. */
  | 'granted'
  /** Not yet asked. A prompt is available. */
  | 'undetermined'
  /** Refused. On Android this may still be re-requestable; on iOS it means Settings. */
  | 'denied'
  /** Location services are switched off device-wide. Granting the app nothing would change that. */
  | 'services-disabled';

/** Why a fix could not be produced. Never a message — a closed set the screens render. */
export type LocationFailure =
  | 'permission-denied'
  | 'services-disabled'
  | 'timed-out'
  /** The platform answered, with something unusable. */
  | 'unavailable';

export type LocationFix = {
  readonly coordinate: Coordinate;
  /** Reported horizontal accuracy in metres, where the platform gives one. */
  readonly accuracyMetres: number | null;
};

/**
 * A cached fix, with the one extra fact that makes it safe to use: how old it is.
 *
 * A `LocationFix` carries no age because an authoritative one was just acquired. A cached one is
 * only usable against an explicit age limit, so the age is part of the type rather than something a
 * caller has to remember to ask for.
 */
export type ProvisionalFix = LocationFix & {
  readonly ageMs: number;
};

/**
 * The device's compass heading.
 *
 * ── `trueHeading` is the one that matters, and it can be absent ─────────────
 * A Qibla bearing is measured from **true** north. A magnetometer measures **magnetic** north, and
 * the difference between them — declination — is up to ~20° in populated parts of the world and
 * changes with location. `expo-location` supplies `trueHeading` by combining the magnetometer with
 * the resolved position, and reports `-1` when it cannot. That case is surfaced here as `null`
 * rather than passed on as a number, because `-1` is a heading a caller could plausibly use.
 */
export type HeadingReading = {
  /** Degrees from true north, or `null` when the platform could not resolve it. */
  readonly trueHeading: number | null;
  /** Degrees from magnetic north. Always present when a reading arrives at all. */
  readonly magneticHeading: number;
  /**
   * The platform's calibration confidence: 3 high, 2 medium, 1 low, 0 none.
   *
   * Carried through rather than collapsed to a boolean, because the guidance the Qibla screen shows
   * differs at each level — and a compass reporting 0 is a compass the user must be told not to
   * trust rather than one whose needle is quietly hidden.
   */
  readonly accuracy: number;
};

export type LocationPort = {
  /** The current permission state. Never prompts. */
  getPermission(): Promise<LocationPermission>;

  /**
   * Prompts, if the platform will.
   *
   * Called only in response to something the user pressed. Returns the resulting state rather than a
   * boolean, so a caller can tell "refused" from "location services are off", which need different
   * advice.
   */
  requestPermission(): Promise<LocationPermission>;

  /**
   * One **authoritative** fix, acquired now. Fails rather than waiting indefinitely.
   *
   * This is the only method that asks the platform for a *new* position, and it is what the refresh
   * control calls. It must never be satisfied from a cache: a refresh that hands back the same old
   * fix is a button that appears to work and does nothing, which is the defect
   * `getLastKnownPosition` exists to keep separate.
   */
  getCurrentPosition(): Promise<LocationFix | { readonly failure: LocationFailure }>;

  /**
   * The platform's last recorded position, for an immediate provisional display only.
   *
   * ── Why this is a separate method with its own limits ───────────────────────
   * `getLastKnownPositionAsync` is free and instant, and it is also whatever the OS happened to
   * record last — which on a phone that has been in a pocket since yesterday is a different city. It
   * is therefore only ever used to render something while `getCurrentPosition` is in flight, and it
   * carries its own age and accuracy limits rather than sharing the authoritative ones.
   *
   * Returns `null` when there is nothing cached, or when what is cached is older or coarser than the
   * caller asked for. Never falls through to a live request.
   */
  getLastKnownPosition(limits: {
    readonly maxAgeMs: number;
    readonly maxAccuracyMetres: number;
  }): Promise<ProvisionalFix | null>;

  /**
   * A human-readable place name for a coordinate, or `null`.
   *
   * Nullable and never invented: a label is a courtesy, and a coordinate with no name attached is
   * a perfectly usable location. Screens render the coordinate when this is absent.
   */
  describe(coordinate: Coordinate): Promise<string | null>;

  /** Places matching a query. Empty when nothing matched — never a guess. */
  search(
    query: string,
  ): Promise<readonly { readonly label: string; readonly coordinate: Coordinate }[]>;

  /**
   * Whether this device can report a heading at all.
   *
   * An emulator without a virtual magnetometer, and some low-cost handsets, genuinely cannot. The
   * Qibla screen says so rather than rendering a needle that never moves.
   */
  hasCompass(): Promise<boolean>;

  /**
   * Subscribes to heading updates. Returns the unsubscribe.
   *
   * Never rejects: a device that cannot supply headings simply never calls back, and `hasCompass`
   * is how a caller finds that out before subscribing.
   */
  watchHeading(onReading: (reading: HeadingReading) => void): Promise<() => void>;
};
