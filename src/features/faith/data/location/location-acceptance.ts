import type { Coordinate } from '../prayer-times.repository';

/**
 * When a new position may replace the one prayer times are currently calculated from.
 *
 * ── Why this is a policy module and not an `if` at the call site ────────────
 * Replacing a location silently changes every number on the Prayer screen: six prayer times, the
 * Hijri date, the countdown, the next prayer and — now — five scheduled notifications a day. A rule
 * that decides that has to be written down, and it has to be testable without a device.
 *
 * The rules below are deliberately conservative in one direction. A *worse* fix never replaces a
 * good recent one, because the failure mode is invisible: the screen looks identical whether the
 * coordinate behind it is 20 m or 20 km out. A *materially different* fix always wins, because the
 * user has moved and the old schedule is now wrong.
 *
 * ── What is deliberately absent ─────────────────────────────────────────────
 * There is no rule here that derives a coordinate from anything other than a coordinate. Nothing
 * consults the device timezone, the locale, an IP address or a stored city name — a place name is a
 * label *for* a fix, never a substitute for one. See `location.port.ts`.
 */

/**
 * How old a cached fix may be and still be shown as a provisional position.
 *
 * Ten minutes. `getLastKnownPositionAsync` returns whatever the platform last recorded, which on a
 * phone that has been in a pocket since yesterday can be a different city. Ten minutes is long
 * enough to cover the walk from the previous screen and short enough that the provisional display
 * is somewhere the user still is.
 */
export const PROVISIONAL_MAX_AGE_MS = 10 * 60 * 1000;

/**
 * How imprecise a cached fix may be and still be shown provisionally.
 *
 * 5 km. A provisional position is only ever used to render *immediately* while an authoritative one
 * is requested, and prayer times move by well under a minute across that distance. Beyond it the
 * honest thing is to render the stored location and wait.
 */
export const PROVISIONAL_MAX_ACCURACY_M = 5000;

/**
 * How imprecise an authoritative fix may be and still be accepted at all.
 *
 * 10 km. Above this the platform is telling us it does not really know — a cell-tower triangulation
 * with no GPS lock — and accepting it would overwrite a good fix with a guess.
 */
export const ACCEPTABLE_MAX_ACCURACY_M = 10_000;

/**
 * How much better a new fix's accuracy must be before it may replace a *recent* one that is
 * materially closer.
 *
 * Only consulted when the coordinate has **not** materially changed. Without it, a stationary phone
 * alternating between a 30 m GPS fix and a 900 m network fix would rewrite storage, re-geocode and
 * reschedule five notifications every time the screen opened.
 */
export const ACCURACY_REGRESSION_TOLERANCE_M = 250;

/** How recent an existing fix must be for the accuracy-regression rule to protect it. */
export const RECENT_FIX_MS = 15 * 60 * 1000;

/**
 * How far the coordinate must move before the day's prayer schedule is considered invalid.
 *
 * 5 km. Below this, prayer times differ by seconds and the Qibla by hundredths of a degree — not
 * enough to be worth re-geocoding, rewriting storage and rescheduling notifications for. At or above
 * it, the user has genuinely moved and everything derived from the old coordinate is stale.
 *
 * This is also the threshold that decides whether the reverse geocoder is called, which is what
 * keeps that call rare rather than once per screen entry.
 */
export const MATERIAL_CHANGE_METRES = 5000;

/** Mean Earth radius, metres. */
const EARTH_RADIUS_M = 6_371_008.8;

/**
 * Great-circle distance between two coordinates, in metres.
 *
 * Haversine. At the distances this module cares about — hundreds of metres to a few kilometres — the
 * difference between this and a full ellipsoidal solution is well under a metre, and it has no
 * failure mode near the poles or the antimeridian the way a naive planar approximation does.
 */
export function distanceMetres(from: Coordinate, to: Coordinate): number {
  const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;
  const dLat = toRadians(to.latitude - from.latitude);
  const dLon = toRadians(to.longitude - from.longitude);
  const lat1 = toRadians(from.latitude);
  const lat2 = toRadians(to.latitude);

  const a = Math.sin(dLat / 2) ** 2 + Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Whether a coordinate change is big enough to invalidate everything derived from the old one. */
export function isMaterialChange(from: Coordinate, to: Coordinate): boolean {
  return distanceMetres(from, to) >= MATERIAL_CHANGE_METRES;
}

/** What is already stored, for the acceptance decision. `null` when nothing has been resolved. */
export type ExistingFix = {
  readonly coordinate: Coordinate;
  /** Reported accuracy of the stored fix, or `null` when it was never recorded. */
  readonly accuracyMetres: number | null;
  /** Age of the stored fix in milliseconds. */
  readonly ageMs: number;
};

export type CandidateFix = {
  readonly coordinate: Coordinate;
  readonly accuracyMetres: number | null;
};

/**
 * Whether a candidate fix should replace what is stored, and what follows if it does.
 *
 * A union rather than a boolean, because the three outcomes need different work. An accepted fix
 * that moved materially has to be re-geocoded and rescheduled; an accepted fix that did not is a
 * quiet storage refresh; a rejection must leave everything exactly as it was and say why.
 */
export type LocationAcceptance =
  | {
      readonly kind: 'accepted';
      /** True when the coordinate moved far enough to invalidate the derived schedule. */
      readonly materialChange: boolean;
      readonly movedMetres: number;
    }
  | {
      readonly kind: 'rejected';
      readonly reason:
        /** The platform reported an accuracy too poor to be a position at all. */
        | 'accuracy-unusable'
        /** Materially the same place, and measurably less precise than the recent fix we hold. */
        | 'not-better-than-recent'
        /** Not a finite coordinate on Earth. */
        | 'invalid-coordinate';
    };

function isUsableCoordinate({ latitude, longitude }: Coordinate): boolean {
  return (
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    Math.abs(latitude) <= 90 &&
    Math.abs(longitude) <= 180
  );
}

/**
 * The acceptance decision.
 *
 * `existing` is `null` on a first resolution, where any usable fix is accepted and counts as a
 * material change — there is nothing to compare it against, and everything downstream has to be
 * calculated for the first time anyway.
 */
export function acceptLocationFix(
  existing: ExistingFix | null,
  candidate: CandidateFix,
): LocationAcceptance {
  if (!isUsableCoordinate(candidate.coordinate)) {
    return { kind: 'rejected', reason: 'invalid-coordinate' };
  }
  if (candidate.accuracyMetres !== null && candidate.accuracyMetres > ACCEPTABLE_MAX_ACCURACY_M) {
    return { kind: 'rejected', reason: 'accuracy-unusable' };
  }
  if (existing === null) {
    return { kind: 'accepted', materialChange: true, movedMetres: 0 };
  }

  const movedMetres = distanceMetres(existing.coordinate, candidate.coordinate);
  if (movedMetres >= MATERIAL_CHANGE_METRES) {
    /*
      The user has moved. A materially different place is accepted even if the new fix is less
      precise: an approximate position in the right city beats an exact one in the wrong country,
      and the accuracy ceiling above has already excluded fixes that are not positions at all.
    */
    return { kind: 'accepted', materialChange: true, movedMetres };
  }

  /*
    Same place. Only replace a recent fix when the new one is not materially worse — otherwise a
    stationary device would rewrite storage, re-geocode and reschedule on every screen entry.
  */
  const existingIsRecent = existing.ageMs <= RECENT_FIX_MS;
  const bothHaveAccuracy = existing.accuracyMetres !== null && candidate.accuracyMetres !== null;
  if (
    existingIsRecent &&
    bothHaveAccuracy &&
    (candidate.accuracyMetres as number) >
      (existing.accuracyMetres as number) + ACCURACY_REGRESSION_TOLERANCE_M
  ) {
    return { kind: 'rejected', reason: 'not-better-than-recent' };
  }

  return { kind: 'accepted', materialChange: false, movedMetres };
}

/** Whether a cached position is fresh and precise enough to show while a real one is fetched. */
export function isUsableProvisional(ageMs: number, accuracyMetres: number | null): boolean {
  if (ageMs > PROVISIONAL_MAX_AGE_MS) {
    return false;
  }
  return accuracyMetres === null ? true : accuracyMetres <= PROVISIONAL_MAX_ACCURACY_M;
}

/**
 * A coordinate typed by a person, validated.
 *
 * ── Why parsing is separate from the acceptance policy above ────────────────
 * The rules above judge a *device fix* against one already held: is it precise enough, is it a real
 * move, is it worse than what we have. None of that applies to a coordinate somebody entered — there
 * is no accuracy to compare and no jitter to smooth. What a typed coordinate needs is the opposite
 * check: that the characters are a number at all, and that the number is a point on Earth.
 *
 * Returned as a union rather than throwing, because every failure here is something a form has to
 * render next to a field.
 */
export type CoordinateInputError = 'empty' | 'not-a-number' | 'out-of-range';

export type CoordinateInputResult =
  | { readonly kind: 'ok'; readonly value: number }
  | { readonly kind: 'invalid'; readonly reason: CoordinateInputError };

/**
 * Parses one typed latitude or longitude.
 *
 * `Number()` rather than `parseFloat`, deliberately: `parseFloat('25abc')` is `25`, which would
 * accept a typo as a coordinate. `Number('25abc')` is `NaN`, which is the answer a validator wants.
 * Infinity is excluded explicitly — `Number('Infinity')` is finite-looking to a range check that
 * only compares magnitudes.
 */
export function parseCoordinateInput(
  raw: string,
  axis: 'latitude' | 'longitude',
): CoordinateInputResult {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { kind: 'invalid', reason: 'empty' };
  }
  const value = Number(trimmed);
  if (!Number.isFinite(value)) {
    return { kind: 'invalid', reason: 'not-a-number' };
  }
  const limit = axis === 'latitude' ? 90 : 180;
  if (Math.abs(value) > limit) {
    return { kind: 'invalid', reason: 'out-of-range' };
  }
  return { kind: 'ok', value };
}

/** The message a form shows for a rejected field. One sentence, naming the bound it broke. */
export function coordinateErrorMessage(
  reason: CoordinateInputError,
  axis: 'latitude' | 'longitude',
): string {
  const limit = axis === 'latitude' ? '−90 and 90' : '−180 and 180';
  switch (reason) {
    case 'empty':
      return `Enter a ${axis}.`;
    case 'not-a-number':
      return `${axis === 'latitude' ? 'Latitude' : 'Longitude'} must be a number.`;
    default:
      return `${axis === 'latitude' ? 'Latitude' : 'Longitude'} must be between ${limit}.`;
  }
}
