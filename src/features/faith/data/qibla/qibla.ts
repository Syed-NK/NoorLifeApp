import type { Coordinate } from '../prayer-times.repository';

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
