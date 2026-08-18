import type { FaithResult } from './faith-result';
import type { Coordinate } from './prayer-times.repository';

/**
 * Nearby mosques, and the Qibla bearing.
 *
 * ── Both features share this repository because both are geospatial ─────────
 * Qibla is a bearing from a coordinate to the Kaaba; a mosque list is a query around a
 * coordinate. They take the same input and hit the same permission wall, so splitting
 * them would duplicate the location handling without buying anything.
 *
 * As with prayer times, the coordinate is an argument. This repository never prompts
 * for a permission — it reports `permission-required` and lets the screen decide.
 */

export type Mosque = {
  readonly id: string;
  readonly name: string;
  readonly address: string;
  readonly coordinate: Coordinate;
  /** Metres from the query point. */
  readonly distanceMetres: number;
  /** Facilities, where the source reports them. Never invented. */
  readonly facilities: readonly string[];
  /** Where the listing came from, so a stale or crowd-sourced entry is visible. */
  readonly attribution: string;
};

/**
 * The direction of prayer from a given point.
 *
 * `bearingDegrees` is true north-referenced. The screen is responsible for combining it
 * with the device's magnetic heading — the repository does not read the compass.
 */
export type QiblaBearing = {
  readonly from: Coordinate;
  readonly bearingDegrees: number;
  /** Great-circle distance to the Kaaba, in kilometres. */
  readonly distanceKm: number;
};

export type MosqueRepository = {
  findNearby(
    coordinate: Coordinate,
    radiusMetres?: number,
  ): Promise<FaithResult<readonly Mosque[]>>;

  search(query: string, near?: Coordinate): Promise<FaithResult<readonly Mosque[]>>;

  getMosque(id: string): Promise<FaithResult<Mosque>>;

  /**
   * The Qibla bearing.
   *
   * A pure spherical calculation — no network required — but it stays behind the
   * repository so the screen has one dependency rather than two, and so a future
   * correction (magnetic declination, for instance) lands in one place.
   */
  getQiblaBearing(coordinate: Coordinate): Promise<FaithResult<QiblaBearing>>;
};
