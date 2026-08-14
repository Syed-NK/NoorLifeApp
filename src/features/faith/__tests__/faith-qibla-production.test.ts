import {
  greatCircleDistanceKm,
  HEADING_SMOOTHING,
  KAABA,
  locationAuthorityLabel,
  qiblaBearing,
  qiblaGuidance,
  qiblaMode,
  relativeBearing,
  smoothHeading,
} from '../data/qibla/qibla';
import type { Coordinate } from '../data/prayer-times.repository';

/**
 * **The Qibla, as a calculation that has to be right in named places.**
 *
 * ── Why named cities rather than only properties ────────────────────────────
 * `faith-qibla.test.tsx` already asserts the algebra: the bearing stays inside 0–360, the turn takes
 * the short way round, guidance is total. Those hold for a formula with a sign error in it, because
 * a consistently wrong bearing is still inside 0–360 and still takes the short way round.
 *
 * What catches a sign error is a place whose answer is known independently. Each expectation below
 * is the initial great-circle bearing to the Kaaba from a city whose direction of prayer is public
 * knowledge — London prays roughly east-south-east, New York roughly north-east, Dubai roughly west
 * — and the tolerances are wide enough to survive a different Earth radius or a Kaaba coordinate
 * refined by a few metres, and far too tight to survive a transposed latitude or an inverted sign.
 *
 * ── The antipodal case is not a curiosity ───────────────────────────────────
 * At the point diametrically opposite the Kaaba every direction is equally toward it, so the bearing
 * is mathematically undefined and `atan2` will return *something*. What must never happen is `NaN`
 * reaching a screen and rendering a dial rotated by nothing, so the assertion is that the value
 * stays a real number inside the compass — not that it takes any particular one.
 */

const MAKKAH: Coordinate = { latitude: 21.4225, longitude: 39.8262 };
const DUBAI: Coordinate = { latitude: 25.2048, longitude: 55.2708 };
const LONDON: Coordinate = { latitude: 51.5074, longitude: -0.1278 };
const NEW_YORK: Coordinate = { latitude: 40.7128, longitude: -74.006 };
const JAKARTA: Coordinate = { latitude: -6.2088, longitude: 106.8456 };

/** Diametrically opposite the Kaaba: roughly the South Pacific, west of Chile. */
const ANTIPODE: Coordinate = { latitude: -KAABA.latitude, longitude: KAABA.longitude - 180 };

describe('the bearing in places whose direction of prayer is known', () => {
  it.each([
    ['Dubai', DUBAI, 258, 6],
    ['London', LONDON, 119, 6],
    ['New York', NEW_YORK, 58, 6],
    ['Jakarta', JAKARTA, 295, 6],
  ] as const)('points %s the right way', (_name, from, expected, tolerance) => {
    const bearing = qiblaBearing(from);
    expect(Number.isFinite(bearing)).toBe(true);
    expect(Math.abs(relativeBearing(bearing, expected))).toBeLessThanOrEqual(tolerance);
  });

  it('measures the distances those cities actually are from Makkah', () => {
    // Independently known great-circle distances, to within one percent.
    const cases: readonly (readonly [Coordinate, number])[] = [
      [DUBAI, 1631],
      [LONDON, 4794],
      [NEW_YORK, 10306],
      [JAKARTA, 7920],
    ];
    for (const [from, km] of cases) {
      expect(greatCircleDistanceKm(from, KAABA)).toBeGreaterThan(km * 0.99);
      expect(greatCircleDistanceKm(from, KAABA)).toBeLessThan(km * 1.01);
    }
  });

  it('is defined and finite at Makkah itself, where the distance collapses to nothing', () => {
    expect(greatCircleDistanceKm(MAKKAH, KAABA)).toBeLessThan(1);
    const bearing = qiblaBearing(MAKKAH);
    expect(Number.isNaN(bearing)).toBe(false);
    expect(bearing).toBeGreaterThanOrEqual(0);
    expect(bearing).toBeLessThan(360);
  });

  it('stays a real compass bearing at and near the antipode, where direction is undefined', () => {
    for (const from of [
      ANTIPODE,
      { latitude: ANTIPODE.latitude + 0.01, longitude: ANTIPODE.longitude },
      { latitude: ANTIPODE.latitude, longitude: ANTIPODE.longitude + 0.01 },
    ]) {
      const bearing = qiblaBearing(from);
      expect(Number.isNaN(bearing)).toBe(false);
      expect(Number.isFinite(bearing)).toBe(true);
      expect(bearing).toBeGreaterThanOrEqual(0);
      expect(bearing).toBeLessThan(360);
      // Half the Earth away, and the distance must still be a number rather than a rounding artefact.
      expect(greatCircleDistanceKm(from, KAABA)).toBeGreaterThan(19_000);
    }
  });
});

describe('the turn across the 0°/360° seam', () => {
  it.each([
    [359, 1, 2],
    [1, 359, -2],
    [350, 10, 20],
    [10, 350, -20],
    [0, 359, -1],
    [359, 0, 1],
  ])('turns from heading %s toward qibla %s by %s degrees', (heading, qibla, expected) => {
    expect(relativeBearing(qibla, heading)).toBeCloseTo(expected, 6);
  });

  it('never advises a turn longer than a half circle, at any pair on the seam', () => {
    for (let qibla = 0; qibla < 360; qibla += 7) {
      for (let heading = 0; heading < 360; heading += 7) {
        const delta = relativeBearing(qibla, heading);
        expect(Math.abs(delta)).toBeLessThanOrEqual(180);
        expect(Number.isNaN(delta)).toBe(false);
      }
    }
  });

  it('reports alignment either side of north without a discontinuity', () => {
    // Qibla at 359, heading at 2: three degrees apart across the seam, and inside the window.
    expect(qiblaGuidance(359, 2).kind).toBe('aligned');
    expect(qiblaGuidance(2, 359).kind).toBe('aligned');
    // Ten degrees apart across the seam is a turn, and it is the short one.
    const turn = qiblaGuidance(355, 5);
    expect(turn.kind).toBe('turn');
    if (turn.kind !== 'turn') return;
    expect(turn.direction).toBe('left');
    expect(turn.degrees).toBe(10);
  });
});

describe('heading smoothing', () => {
  it('takes the first reading whole rather than sweeping in from an assumed north', () => {
    expect(smoothHeading(null, 270)).toBeCloseTo(270, 6);
    expect(smoothHeading(null, 0)).toBeCloseTo(0, 6);
  });

  it('crosses north the short way instead of sweeping the long way round', () => {
    /*
      The defect this exists to prevent: `previous + (next - previous) * factor` on 359 → 1 reads the
      two readings as 358 degrees apart and moves the marker anticlockwise across the whole dial.
      Smoothed on the circle the result sits on the short arc, just past 359.
    */
    const smoothed = smoothHeading(359, 1);
    const fromSeam = relativeBearing(smoothed, 359);
    expect(fromSeam).toBeGreaterThan(0);
    expect(fromSeam).toBeLessThan(2);
  });

  it('moves toward the new reading without ever overshooting it', () => {
    for (const [previous, next] of [
      [0, 90],
      [90, 0],
      [350, 20],
      [20, 350],
      [180, 181],
    ] as const) {
      const smoothed = smoothHeading(previous, next);
      const travelled = relativeBearing(smoothed, previous);
      const remaining = relativeBearing(next, smoothed);
      const total = relativeBearing(next, previous);
      // Same direction of travel as the real change, and strictly short of it.
      expect(Math.sign(travelled)).toBe(Math.sign(total));
      expect(Math.abs(travelled)).toBeLessThan(Math.abs(total));
      // Still some way to go: the filter lags the sensor, it never leads it.
      expect(Math.sign(remaining)).toBe(Math.sign(total));
    }
  });

  it('cannot manufacture an alignment the sensor never reported', () => {
    /*
      The property that matters most. A marker that snapped to the Qibla while the phone pointed
      elsewhere would be a false "facing the Qibla" — so the smoothed value must always lie on the arc
      between two real readings, and can therefore only be aligned if one of them was heading there.
    */
    const qibla = 100;
    let heading: number | null = null;
    // The phone is held steady at 200°, forty-five readings, nowhere near the Qibla.
    for (let i = 0; i < 45; i += 1) {
      heading = smoothHeading(heading, 200);
      expect(qiblaGuidance(qibla, heading).kind).toBe('turn');
    }
    expect(heading).toBeCloseTo(200, 6);
  });

  it('converges on a steady reading rather than oscillating around it', () => {
    let heading: number | null = null;
    for (let i = 0; i < 60; i += 1) {
      heading = smoothHeading(heading, 42);
    }
    expect(heading).toBeCloseTo(42, 3);
  });

  it('resolves an exact reversal to the new reading rather than an undefined angle', () => {
    // Opposite unit vectors cancel; the filter takes the new reading instead of an arbitrary one.
    const smoothed = smoothHeading(0, 180, 0.5);
    expect(Number.isNaN(smoothed)).toBe(false);
    expect(smoothed).toBeCloseTo(180, 6);
  });

  it('normalises whatever the platform reports into 0–360', () => {
    for (const value of [
      smoothHeading(null, 720),
      smoothHeading(null, -90),
      smoothHeading(10, 400),
    ]) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(360);
    }
  });

  it('uses a factor that is a genuine average rather than a pass-through', () => {
    expect(HEADING_SMOOTHING).toBeGreaterThan(0);
    expect(HEADING_SMOOTHING).toBeLessThan(1);
  });
});

describe('the two honest operating states', () => {
  it('is live only when a trusted heading is actually arriving', () => {
    expect(qiblaMode({ hasCompass: true, heading: 120, accuracy: 'good' })).toEqual({
      kind: 'live',
    });
    expect(qiblaMode({ hasCompass: true, heading: 120, accuracy: 'low' })).toEqual({
      kind: 'live',
    });
  });

  it.each([
    ['no compass at all', { hasCompass: false, heading: 120, accuracy: 'good' }, 'no-compass'],
    [
      'a compass the platform has disowned',
      { hasCompass: true, heading: 120, accuracy: 'unusable' },
      'unusable-accuracy',
    ],
    ['no reading yet', { hasCompass: true, heading: null, accuracy: 'good' }, 'no-heading'],
  ] as const)('falls back to bearing-only on %s', (_name, input, reason) => {
    expect(qiblaMode(input)).toEqual({ kind: 'bearing-only', reason });
  });

  it('prefers the hardware reason over the reading reason', () => {
    /*
      A device with no compass also has no heading. Reporting `no-heading` would tell the user to wait
      for something that is never coming, so the capability answer wins.
    */
    expect(qiblaMode({ hasCompass: false, heading: null, accuracy: 'unusable' })).toEqual({
      kind: 'bearing-only',
      reason: 'no-compass',
    });
  });
});

describe('the authority behind the bearing', () => {
  it('names each of the three V3 modes distinctly', () => {
    expect(locationAuthorityLabel('device')).toBe('Device location');
    expect(locationAuthorityLabel('city')).toBe('Selected city');
    expect(locationAuthorityLabel('coordinates')).toBe('Coordinates');
    const labels = (['device', 'city', 'coordinates'] as const).map(locationAuthorityLabel);
    expect(new Set(labels).size).toBe(3);
  });
});
