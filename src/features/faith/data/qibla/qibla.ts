import type { Coordinate, PrayerLocationMode } from '../prayer-times.repository';

/**
 * The direction of prayer, and the guidance that turns a bearing into an instruction.
 *
 * ── Why the maths lives here and not in the mosque repository ───────────────
 * It was in `data/mock/mock-mosque.repository.ts`, which was correct in every respect except its
 * address: the calculation is real, is not a fixture, and had no business sitting in the directory
 * whose whole purpose is holding things that are. A source scan that treated `data/mock/` as
 * suspect would have been right about the file and wrong about this function.
 *
 * ── What this module knows and what it deliberately does not ────────────────
 * It knows spherical trigonometry. It does not know where the device is pointing, whether the
 * compass is calibrated, or whether the user has granted anything — those are the port's business
 * and the screen's. Everything here is a pure function of numbers, which is what lets the guidance
 * rules be tested exhaustively rather than sampled on a device.
 */

/** The Kaaba, Masjid al-Haram. */
export const KAABA: Coordinate = { latitude: 21.4224779, longitude: 39.8251832 };

const EARTH_RADIUS_KM = 6371;

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;
const toDegrees = (radians: number): number => (radians * 180) / Math.PI;

/**
 * Initial great-circle bearing from `from` to `to`, normalised to 0–360°.
 *
 * ── Initial, not constant ───────────────────────────────────────────────────
 * A great-circle path changes compass bearing as it goes; the Qibla is the direction you set off
 * in, which is the initial bearing. A rhumb-line bearing — constant heading — is a different and
 * longer path, and is not what "facing the Kaaba" means.
 */
export function greatCircleBearing(from: Coordinate, to: Coordinate): number {
  const lat1 = toRadians(from.latitude);
  const lat2 = toRadians(to.latitude);
  const deltaLon = toRadians(to.longitude - from.longitude);

  const y = Math.sin(deltaLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLon);

  return (toDegrees(Math.atan2(y, x)) + 360) % 360;
}

/** Haversine distance in kilometres. */
export function greatCircleDistanceKm(from: Coordinate, to: Coordinate): number {
  const dLat = toRadians(to.latitude - from.latitude);
  const dLon = toRadians(to.longitude - from.longitude);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(from.latitude)) * Math.cos(toRadians(to.latitude)) * Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** The Qibla bearing from a coordinate, in degrees from **true** north. */
export function qiblaBearing(from: Coordinate): number {
  return greatCircleBearing(from, KAABA);
}

/**
 * The signed turn from the device's heading to the Qibla, in −180…180.
 *
 * Positive is clockwise (turn right), negative anticlockwise (turn left). Signed rather than a
 * bearing plus a separate direction flag, because the sign *is* the direction and two fields that
 * must agree is one field that can disagree.
 */
export function relativeBearing(qibla: number, heading: number): number {
  const delta = ((qibla - heading + 540) % 360) - 180;
  // `-180` and `180` are the same turn; normalising to the positive end keeps the output stable
  // rather than flipping between "turn left 180" and "turn right 180" on a trembling compass.
  return delta === -180 ? 180 : delta;
}

/**
 * How close to the Qibla counts as facing it.
 *
 * ── Why five degrees and not one ────────────────────────────────────────────
 * A phone magnetometer is accurate to a few degrees at best, and a person holding a phone is not
 * steadier than that. A one-degree window would flicker between "aligned" and "turn right" while
 * somebody stood still, which reads as the app being broken rather than as precision.
 *
 * Five degrees at the distance of the Kaaba is a very large physical area, so this is not a
 * meaningful loss of accuracy — and prayer direction has never required more than facing it.
 */
export const ALIGNED_WITHIN_DEGREES = 5;

/**
 * The window inside which the guidance says "almost", to stop the last few degrees feeling blind.
 */
export const CLOSE_WITHIN_DEGREES = 20;

export type QiblaGuidance =
  | { readonly kind: 'aligned' }
  | {
      readonly kind: 'turn';
      readonly direction: 'left' | 'right';
      /** Degrees to turn, always positive. */
      readonly degrees: number;
      /** True inside `CLOSE_WITHIN_DEGREES` — the screen softens the instruction. */
      readonly close: boolean;
    };

/**
 * What to tell the user, from a Qibla bearing and a device heading.
 *
 * Pure, and total: every pair of angles produces guidance. There is no "unknown" member because a
 * caller with no heading must not call this at all — the screen renders a calibration or
 * no-compass state instead, which is a different thing from an instruction it cannot give.
 */
export function qiblaGuidance(qibla: number, heading: number): QiblaGuidance {
  const delta = relativeBearing(qibla, heading);
  const magnitude = Math.abs(delta);

  if (magnitude <= ALIGNED_WITHIN_DEGREES) {
    return { kind: 'aligned' };
  }
  return {
    kind: 'turn',
    direction: delta > 0 ? 'right' : 'left',
    degrees: Math.round(magnitude),
    close: magnitude <= CLOSE_WITHIN_DEGREES,
  };
}

/** The guidance in words, for the screen and for a screen reader. One wording, one place. */
export function guidanceLabel(guidance: QiblaGuidance): string {
  if (guidance.kind === 'aligned') {
    return 'Facing the Qibla';
  }
  const direction = guidance.direction === 'right' ? 'right' : 'left';
  return guidance.close
    ? `Almost — turn slightly ${direction}`
    : `Turn ${direction} ${guidance.degrees}°`;
}

/**
 * How much the platform's compass can be trusted, as something the screen can act on.
 *
 * `expo-location` reports 3 high, 2 medium, 1 low, 0 none. Mapped to three states rather than passed
 * through as a number, because the *advice* differs at each and a raw integer on screen would mean
 * nothing to the person holding the phone.
 */
export type CompassAccuracy = 'good' | 'low' | 'unusable';

export function compassAccuracy(reported: number): CompassAccuracy {
  if (reported >= 3) {
    return 'good';
  }
  return reported >= 2 ? 'low' : 'unusable';
}

/**
 * Which of the two honest operating states the screen is in.
 *
 * ── Why this is a named decision and not an inline `heading === null` ───────
 * Because the difference is what the user is being asked to believe. In `live` the dial is a compass:
 * the marker points at the Kaaba *in the room*, and turning the phone moves it. In `bearing-only`
 * there is no heading at all, so the dial is a diagram — a north-up rose with the Qibla drawn on it,
 * which is exactly as useful as a printed bearing and no more.
 *
 * Drawing the second as though it were the first is the failure this type exists to prevent: a
 * marker that sits still while the phone turns, with nothing on screen saying why, reads as a broken
 * compass rather than as a correct bearing.
 */
export type QiblaMode =
  /** A trusted heading is arriving. The dial tracks the room. */
  | { readonly kind: 'live' }
  /** No usable heading. The dial is a north-up diagram, and says so. */
  | {
      readonly kind: 'bearing-only';
      readonly reason: 'no-compass' | 'no-heading' | 'unusable-accuracy';
    };

/**
 * Which mode to render, from what the device actually reported.
 *
 * ── `unusable` accuracy is bearing-only, not a warned live dial ─────────────
 * A compass reporting accuracy 0 or 1 is not a compass with a caveat; it is a heading nobody should
 * rotate an arrow by. The previous screen kept the dial live and added a banner, which left the
 * marker swinging confidently on readings the platform had already disowned. Demoting it to the
 * diagram is the honest response, and the bearing underneath is unaffected.
 */
export function qiblaMode(input: {
  readonly hasCompass: boolean;
  readonly heading: number | null;
  readonly accuracy: CompassAccuracy;
}): QiblaMode {
  if (!input.hasCompass) {
    return { kind: 'bearing-only', reason: 'no-compass' };
  }
  if (input.accuracy === 'unusable') {
    return { kind: 'bearing-only', reason: 'unusable-accuracy' };
  }
  return input.heading === null ? { kind: 'bearing-only', reason: 'no-heading' } : { kind: 'live' };
}

/**
 * Where the active location came from, in the words the Qibla screen shows.
 *
 * One function so the three authorities are named identically wherever they appear, and so adding a
 * fourth mode to `PrayerLocationMode` is a compile error here rather than a silent "Device location"
 * on a place that is nothing of the kind.
 */
export function locationAuthorityLabel(mode: PrayerLocationMode): string {
  switch (mode) {
    case 'device':
      return 'Device location';
    case 'city':
      return 'Selected city';
    case 'coordinates':
      return 'Coordinates';
  }
}

/**
 * How much of a new heading reading to accept, per update.
 *
 * 0.25 is a compromise measured against the two failures either end produces. At 1.0 (no smoothing)
 * the marker trembles several degrees while the phone is held still, which is the magnetometer's own
 * noise rendered faithfully and read by a user as the app being unsure. Below about 0.15 the marker
 * visibly lags a deliberate turn, which is worse: the user turns, the arrow follows late, and they
 * over-correct.
 */
export const HEADING_SMOOTHING = 0.25;

/**
 * One step of circular exponential smoothing, in degrees.
 *
 * ── Why this cannot be done on the numbers directly ─────────────────────────
 * Headings are angles on a circle, and `previous + (next - previous) * factor` is arithmetic on a
 * line. Crossing north, the honest readings 359° and 1° are two degrees apart; that expression reads
 * them as 358 degrees apart and sweeps the marker the long way round the entire dial. Smoothing has
 * to happen in the space the values actually live in, so each angle becomes a unit vector, the
 * vectors are mixed, and `atan2` turns the result back into an angle — where 359 and 1 mix to 0.
 *
 * ── Why smoothing cannot manufacture alignment ──────────────────────────────
 * The output is a weighted mean of two real readings, so it always lies on the shorter arc *between*
 * them. It can never overshoot past `next`, never settle anywhere neither reading supports, and
 * never arrive before the sensor does — so a marker cannot snap to the Qibla while the phone is
 * pointing somewhere else. `qibla-smoothing` cases in the suite assert exactly that.
 *
 * The first reading is taken whole: with no previous value there is nothing to average, and starting
 * from an assumed north would sweep the marker in from a heading the device never reported.
 */
export function smoothHeading(
  previous: number | null,
  next: number,
  factor: number = HEADING_SMOOTHING,
): number {
  if (previous === null) {
    return ((next % 360) + 360) % 360;
  }
  const previousRad = toRadians(previous);
  const nextRad = toRadians(next);
  const x = Math.cos(previousRad) * (1 - factor) + Math.cos(nextRad) * factor;
  const y = Math.sin(previousRad) * (1 - factor) + Math.sin(nextRad) * factor;
  /*
    Two readings opposite each other cancel toward the origin, where the angle is undefined. That is
    a 180° reversal — a genuine change rather than noise — so the new reading is taken whole rather
    than resolved to an arbitrary direction that would be neither.

    ── Why a magnitude threshold and not `x === 0 && y === 0` ────────────────
    Because the cancellation is never exact. `cos(180°)` is exactly −1, but `sin(180°)` is
    1.2246e-16 rather than zero, so an exact-zero guard misses and `atan2` resolves the residue to a
    confident 90° — a marker pointing at right angles to both readings. Found by the reversal case in
    `faith-qibla-production.test.ts`. Comparing the resultant's length against an epsilon catches the
    near-cancellations too, which is the same failure with a fractionally smaller residue.
  */
  if (Math.hypot(x, y) < 1e-9) {
    return ((next % 360) + 360) % 360;
  }
  return (toDegrees(Math.atan2(y, x)) + 360) % 360;
}

/** What to say about a compass that is not reporting confidently. Null when it is. */
export function calibrationAdvice(accuracy: CompassAccuracy): string | null {
  switch (accuracy) {
    case 'good':
      return null;
    case 'low':
      return 'Compass accuracy is low. Move away from metal and electronics, or wave the phone in a figure of eight.';
    case 'unusable':
      return 'This device cannot report a reliable compass heading right now. The bearing below is still correct — align it using a separate compass.';
  }
}
