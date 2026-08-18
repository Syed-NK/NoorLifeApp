import fs from 'node:fs';
import path from 'node:path';

import {
  ACCEPTABLE_MAX_ACCURACY_M,
  acceptLocationFix,
  distanceMetres,
  isMaterialChange,
  isUsableProvisional,
  MATERIAL_CHANGE_METRES,
  PROVISIONAL_MAX_AGE_MS,
  type ExistingFix,
} from '../data/location/location-acceptance';

/**
 * When a new position may replace the one prayer times are calculated from.
 *
 * ── Why this is where the rules are proved ──────────────────────────────────
 * Replacing a location silently changes every number on the Prayer screen and five scheduled
 * notifications a day. The decision has to be inspectable without a device, and the failure mode it
 * guards against is invisible on one: a screen calculated from a coordinate 20 km out looks exactly
 * like a correct one.
 */

const MOUNTAIN_VIEW = { latitude: 37.4221, longitude: -122.0841 };
const DUBAI = { latitude: 25.2048, longitude: 55.2708 };

const existing = (overrides: Partial<ExistingFix> = {}): ExistingFix => ({
  coordinate: MOUNTAIN_VIEW,
  accuracyMetres: 20,
  ageMs: 60_000,
  ...overrides,
});

describe('distance', () => {
  it('measures the real great-circle distance between two cities', () => {
    // Mountain View to Dubai is ~13,000 km. A planar approximation would be wildly wrong here.
    const km = distanceMetres(MOUNTAIN_VIEW, DUBAI) / 1000;
    expect(km).toBeGreaterThan(12_500);
    expect(km).toBeLessThan(13_500);
  });

  it('is symmetric and zero for the same point', () => {
    expect(distanceMetres(DUBAI, DUBAI)).toBe(0);
    expect(distanceMetres(MOUNTAIN_VIEW, DUBAI)).toBeCloseTo(
      distanceMetres(DUBAI, MOUNTAIN_VIEW),
      6,
    );
  });

  it('treats a city-scale move as material and a street-scale one as not', () => {
    expect(isMaterialChange(MOUNTAIN_VIEW, DUBAI)).toBe(true);
    // ~200 m north.
    expect(
      isMaterialChange(MOUNTAIN_VIEW, {
        latitude: MOUNTAIN_VIEW.latitude + 0.0018,
        longitude: MOUNTAIN_VIEW.longitude,
      }),
    ).toBe(false);
  });
});

describe('acceptance', () => {
  it('accepts any usable fix when nothing is stored, and treats it as material', () => {
    expect(acceptLocationFix(null, { coordinate: DUBAI, accuracyMetres: 40 })).toEqual({
      kind: 'accepted',
      materialChange: true,
      movedMetres: 0,
    });
  });

  it('accepts a move to another city even when the new fix is less precise', () => {
    /*
      An approximate position in the right city beats an exact one in the wrong country. The accuracy
      ceiling below has already excluded fixes that are not positions at all.
    */
    const decision = acceptLocationFix(existing(), { coordinate: DUBAI, accuracyMetres: 900 });

    expect(decision.kind).toBe('accepted');
    if (decision.kind !== 'accepted') return;
    expect(decision.materialChange).toBe(true);
    expect(decision.movedMetres).toBeGreaterThan(MATERIAL_CHANGE_METRES);
  });

  it('rejects a fix too imprecise to be a position', () => {
    expect(
      acceptLocationFix(existing(), {
        coordinate: DUBAI,
        accuracyMetres: ACCEPTABLE_MAX_ACCURACY_M + 1,
      }),
    ).toEqual({ kind: 'rejected', reason: 'accuracy-unusable' });
  });

  it('rejects a coordinate that is not on Earth', () => {
    expect(
      acceptLocationFix(existing(), {
        coordinate: { latitude: Number.NaN, longitude: 0 },
        accuracyMetres: 10,
      }),
    ).toEqual({ kind: 'rejected', reason: 'invalid-coordinate' });
    expect(
      acceptLocationFix(existing(), {
        coordinate: { latitude: 91, longitude: 0 },
        accuracyMetres: 10,
      }),
    ).toEqual({ kind: 'rejected', reason: 'invalid-coordinate' });
  });

  /**
   * The rule that stops a stationary phone rewriting storage every time a screen opens.
   */
  it('keeps a recent precise fix rather than replacing it with a much coarser one nearby', () => {
    const decision = acceptLocationFix(existing({ accuracyMetres: 20, ageMs: 60_000 }), {
      coordinate: MOUNTAIN_VIEW,
      accuracyMetres: 900,
    });

    expect(decision).toEqual({ kind: 'rejected', reason: 'not-better-than-recent' });
  });

  it('accepts the coarser nearby fix once the stored one is no longer recent', () => {
    const decision = acceptLocationFix(existing({ accuracyMetres: 20, ageMs: 60 * 60_000 }), {
      coordinate: MOUNTAIN_VIEW,
      accuracyMetres: 900,
    });

    expect(decision.kind).toBe('accepted');
    if (decision.kind !== 'accepted') return;
    // Same place, so nothing derived from the coordinate needs recalculating.
    expect(decision.materialChange).toBe(false);
  });

  it('accepts a nearby fix of comparable precision', () => {
    const decision = acceptLocationFix(existing({ accuracyMetres: 20 }), {
      coordinate: MOUNTAIN_VIEW,
      accuracyMetres: 30,
    });
    expect(decision).toMatchObject({ kind: 'accepted', materialChange: false });
  });

  it('treats an unknown accuracy as unknown rather than as perfect', () => {
    // A stored location the user chose has no measured accuracy. The regression rule cannot apply.
    const decision = acceptLocationFix(existing({ accuracyMetres: null }), {
      coordinate: MOUNTAIN_VIEW,
      accuracyMetres: 900,
    });
    expect(decision.kind).toBe('accepted');
  });

  it('never infers a coordinate from anything but a coordinate', () => {
    /*
      The whole module takes two coordinates and two accuracies. There is no parameter here for a
      timezone, a locale, an IP address or a city name — so no rule in it can consult one.
    */
    const source = fs.readFileSync(
      path.join(process.cwd(), 'src/features/faith/data/location/location-acceptance.ts'),
      'utf8',
    );
    /*
      Executable text only. The module's own documentation names every one of these in order to say
      it does not use them, and a scan that failed on the prose would be failing on the explanation
      rather than on the code.
    */
    const executable = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

    expect(executable).not.toMatch(/timeZone|locale|Intl\.|fetch\(|ipapi|geoip/i);
  });
});

describe('provisional fixes', () => {
  it('accepts a fresh, reasonably precise cached position', () => {
    expect(isUsableProvisional(60_000, 100)).toBe(true);
  });

  it('rejects one that is too old, however precise', () => {
    expect(isUsableProvisional(PROVISIONAL_MAX_AGE_MS + 1, 5)).toBe(false);
  });

  it('rejects one that is too coarse, however fresh', () => {
    expect(isUsableProvisional(1_000, 50_000)).toBe(false);
  });

  it('accepts one whose accuracy the platform did not report', () => {
    // Age is the limit that matters for a provisional display; an unreported accuracy is common.
    expect(isUsableProvisional(1_000, null)).toBe(true);
  });
});
