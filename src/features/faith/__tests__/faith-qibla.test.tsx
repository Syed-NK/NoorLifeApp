import AsyncStorage from '@react-native-async-storage/async-storage';
import { cleanup, render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';

import { warmUpFirstMount } from '@/test-support/mock-latency-timers';

import type { FaithRepositories } from '../data';
import { createMockFaithRepositories } from '../data/mock';
import { createAdhanPrayerTimesRepository } from '../data/prayer/adhan-prayer-times.repository';
import type { HeadingReading, LocationPort } from '../data/location/location.port';
import type { Coordinate } from '../data/prayer-times.repository';
import {
  ALIGNED_WITHIN_DEGREES,
  CLOSE_WITHIN_DEGREES,
  calibrationAdvice,
  compassAccuracy,
  greatCircleBearing,
  greatCircleDistanceKm,
  guidanceLabel,
  KAABA,
  qiblaBearing,
  qiblaGuidance,
  relativeBearing,
} from '../data/qibla/qibla';
import { FaithRepositoryProvider } from '../di/faith-repository-context';
import { QiblaScreen } from '../screens/qibla-screen';

/**
 * The Qibla: the calculation, the guidance, and every state the compass can be in.
 *
 * ── Why the maths is tested against published bearings ──────────────────────
 * A great-circle bearing is easy to write and easy to write *nearly* right — a swapped argument or a
 * missing `cos` produces a number that looks plausible from London and is badly wrong from Sydney.
 * The anchors below are widely published Qibla bearings for cities on four continents, including two
 * chosen because they break the naive intuition that you always face roughly south-east.
 */
warmUpFirstMount(async () => render(<QiblaScreen />));

beforeEach(async () => {
  // The resolved coordinate persists by design, so one case's location must not seed the next.
  await AsyncStorage.clear();
});

const MANCHESTER: Coordinate = { latitude: 53.4808, longitude: -2.2426 };

describe('the bearing', () => {
  /**
   * Published Qibla bearings, to the nearest degree, with a two-degree tolerance.
   *
   * The tolerance is for the sources rather than the maths: published figures differ slightly by the
   * exact coordinate taken for a city and for the Kaaba. Two degrees is well inside that and far
   * outside anything a wrong formula would produce.
   */
  const ANCHORS: readonly (readonly [string, Coordinate, number])[] = [
    ['Manchester', MANCHESTER, 119],
    ['London', { latitude: 51.5072, longitude: -0.1276 }, 119],
    ['New York', { latitude: 40.7128, longitude: -74.006 }, 58],
    // South-east Asia faces *west*, which a sign error would get backwards.
    ['Jakarta', { latitude: -6.2088, longitude: 106.8456 }, 295],
    // And Sydney faces west-north-west, not north-west of north.
    ['Sydney', { latitude: -33.8688, longitude: 151.2093 }, 277],
    ['Cape Town', { latitude: -33.9249, longitude: 18.4241 }, 23],
  ];

  it.each(ANCHORS)(
    'points from %s within two degrees of the published bearing',
    (_name, from, expected) => {
      expect(Math.abs(qiblaBearing(from) - expected)).toBeLessThanOrEqual(2);
    },
  );

  it('is zero-length and undefined-free at the Kaaba itself', () => {
    expect(Number.isFinite(qiblaBearing(KAABA))).toBe(true);
    expect(greatCircleDistanceKm(KAABA, KAABA)).toBeCloseTo(0);
  });

  it('is always inside 0–360', () => {
    for (let lat = -80; lat <= 80; lat += 20) {
      for (let lon = -180; lon <= 180; lon += 30) {
        const bearing = qiblaBearing({ latitude: lat, longitude: lon });
        expect(bearing).toBeGreaterThanOrEqual(0);
        expect(bearing).toBeLessThan(360);
      }
    }
  });

  it('measures a distance that matches a known separation', () => {
    // London to Makkah is about 4,760 km by great circle.
    const km = greatCircleDistanceKm({ latitude: 51.5072, longitude: -0.1276 }, KAABA);
    expect(km).toBeGreaterThan(4600);
    expect(km).toBeLessThan(4900);
  });

  it('is the initial bearing, so it is not symmetric', () => {
    // A great-circle bearing changes along the path, so there-and-back is not 180° apart. A rhumb
    // line would be, and would be the wrong calculation.
    const there = greatCircleBearing(MANCHESTER, KAABA);
    const back = greatCircleBearing(KAABA, MANCHESTER);
    expect(Math.abs(((there + 180) % 360) - back)).toBeGreaterThan(1);
  });
});

describe('the turn', () => {
  it('is signed: positive clockwise, negative anticlockwise', () => {
    expect(relativeBearing(120, 100)).toBe(20);
    expect(relativeBearing(100, 120)).toBe(-20);
  });

  it('takes the short way round the compass', () => {
    // Facing 350°, the Qibla at 10° is twenty degrees to the right, not 340 to the left.
    expect(relativeBearing(10, 350)).toBe(20);
    expect(relativeBearing(350, 10)).toBe(-20);
  });

  it('never exceeds a half turn', () => {
    for (let qibla = 0; qibla < 360; qibla += 7) {
      for (let heading = 0; heading < 360; heading += 11) {
        const delta = relativeBearing(qibla, heading);
        expect(delta).toBeGreaterThanOrEqual(-180);
        expect(delta).toBeLessThanOrEqual(180);
      }
    }
  });

  it('reports a half turn as a single stable value', () => {
    // −180 and 180 are the same turn. Returning both would flip the instruction between "left" and
    // "right" while somebody stood still.
    expect(relativeBearing(180, 0)).toBe(180);
    expect(relativeBearing(0, 180)).toBe(180);
  });
});

describe('the guidance', () => {
  it('says facing the Qibla inside the alignment window', () => {
    for (const offset of [0, 1, -1, ALIGNED_WITHIN_DEGREES, -ALIGNED_WITHIN_DEGREES]) {
      expect(qiblaGuidance(120, 120 - offset).kind).toBe('aligned');
    }
  });

  it('says turn just outside it', () => {
    const guidance = qiblaGuidance(120, 120 - (ALIGNED_WITHIN_DEGREES + 1));
    expect(guidance).toMatchObject({ kind: 'turn', direction: 'right' });
  });

  it('names the direction a person would actually turn', () => {
    // The Qibla is clockwise of where the phone points, so the user turns right.
    expect(qiblaGuidance(120, 90)).toMatchObject({ direction: 'right', degrees: 30 });
    expect(qiblaGuidance(90, 120)).toMatchObject({ direction: 'left', degrees: 30 });
  });

  it('softens the wording near the end', () => {
    const close = qiblaGuidance(120, 120 - CLOSE_WITHIN_DEGREES);
    expect(close).toMatchObject({ close: true });
    expect(guidanceLabel(close)).toMatch(/Almost/);

    const far = qiblaGuidance(120, 0);
    expect(far).toMatchObject({ close: false });
    expect(guidanceLabel(far)).toMatch(/^Turn/);
  });

  it('produces guidance for every pair of angles', () => {
    // Total by construction: there is no "unknown" member, because a caller with no heading must not
    // call this at all.
    for (let qibla = 0; qibla < 360; qibla += 13) {
      for (let heading = 0; heading < 360; heading += 17) {
        const label = guidanceLabel(qiblaGuidance(qibla, heading));
        expect(typeof label).toBe('string');
        expect(label.length).toBeGreaterThan(0);
      }
    }
  });
});

describe('compass accuracy', () => {
  it('maps the platform’s 0–3 to something a person can act on', () => {
    expect(compassAccuracy(3)).toBe('good');
    expect(compassAccuracy(2)).toBe('low');
    expect(compassAccuracy(1)).toBe('unusable');
    expect(compassAccuracy(0)).toBe('unusable');
  });

  it('advises only when there is something to do', () => {
    expect(calibrationAdvice('good')).toBeNull();
    expect(calibrationAdvice('low')).toMatch(/figure of eight/i);
    expect(calibrationAdvice('unusable')).toMatch(/separate compass/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The screen
// ─────────────────────────────────────────────────────────────────────────────

function fakeLocationPort(overrides: Partial<LocationPort> = {}): LocationPort {
  return {
    getPermission: async () => 'granted',
    requestPermission: async () => 'granted',
    // Nothing cached: these suites exercise the authoritative path only.
    getLastKnownPosition: async () => null,
    getCurrentPosition: async () => ({ coordinate: MANCHESTER, accuracyMetres: 20 }),
    describe: async () => 'Manchester, United Kingdom',
    search: async () => [],
    hasCompass: async () => true,
    watchHeading: async () => () => undefined,
    ...overrides,
  };
}

/**
 * Renders the Qibla screen against a location port under the test's control.
 *
 * The **prayer repository is rebuilt on the same port**, which is the part worth stating: the mock
 * set constructs its own, so injecting only `location` would leave the thing that actually resolves
 * the coordinate talking to the real module — and every case below would exercise a denied
 * permission regardless of what it set up.
 */
async function renderQibla(port: LocationPort): Promise<typeof screen> {
  const mocks: FaithRepositories = createMockFaithRepositories();
  await render(
    <FaithRepositoryProvider
      repositories={{
        ...mocks,
        location: port,
        prayerTimes: createAdhanPrayerTimesRepository({
          location: port,
          hijriFor: () => '25 Safar 1448 AH',
        }),
      }}
    >
      <QiblaScreen />
    </FaithRepositoryProvider>,
  );
  return screen;
}

/** A port that pushes one heading reading as soon as anything subscribes. */
function portReporting(
  reading: HeadingReading,
  overrides: Partial<LocationPort> = {},
): LocationPort {
  return fakeLocationPort({
    watchHeading: async (onReading) => {
      onReading(reading);
      return () => undefined;
    },
    ...overrides,
  });
}

describe('the Qibla screen', () => {
  it('asks for location rather than showing a bearing for nowhere', async () => {
    const view = await renderQibla(
      fakeLocationPort({
        getPermission: async () => 'undetermined',
        // Nothing cached: these suites exercise the authoritative path only.
        getLastKnownPosition: async () => null,
        getCurrentPosition: async () => ({ failure: 'permission-denied' }),
      }),
    );

    expect(await view.findByTestId('faith-qibla-body-permission')).toBeTruthy();
    // No dial, and above all no bearing computed from a city nobody chose.
    expect(view.queryByTestId('faith-qibla-dial')).toBeNull();
  });

  it('turns a live heading into an instruction', async () => {
    // Manchester's Qibla is ~119°. Facing due north, the user turns right by about that much.
    const view = await renderQibla(
      portReporting({ trueHeading: 0, magneticHeading: 0, accuracy: 3 }),
    );

    await view.findByTestId('faith-qibla-guidance');
    await waitFor(() => expect(view.queryByText(/Turn right 1\d\d°/)).not.toBeNull());
  });

  it('says so when the phone is facing the Qibla', async () => {
    const bearing = qiblaBearing(MANCHESTER);
    const view = await renderQibla(
      portReporting({ trueHeading: bearing, magneticHeading: bearing, accuracy: 3 }),
    );

    expect(await view.findByText('Facing the Qibla')).toBeTruthy();
  });

  it('never substitutes magnetic north when true north is unavailable', async () => {
    /*
      The two differ by up to ~20° in populated parts of the world, and the Qibla bearing is measured
      from true north. Rotating the marker by a magnetic heading would point it confidently into the
      wrong quarter of the sky, so a null true heading is treated as no heading at all.
    */
    const view = await renderQibla(
      portReporting({ trueHeading: null, magneticHeading: 42, accuracy: 3 }),
    );

    expect(await view.findByText('Heading unavailable')).toBeTruthy();
    expect(view.queryByText(/Turn (left|right)/)).toBeNull();
    // The bearing itself is still shown — it is correct and usable with a separate compass.
    expect((await view.findAllByText(/from true north/)).length).toBeGreaterThan(0);
  });

  it('says the device has no compass rather than drawing a needle that never moves', async () => {
    const view = await renderQibla(fakeLocationPort({ hasCompass: async () => false }));

    expect(await view.findByTestId('faith-qibla-no-compass')).toBeTruthy();
    // `findAllBy`: the caption and the dial's own spoken label both name true north, and that
    // repetition is correct — the dial has to describe itself to a screen reader.
    expect((await view.findAllByText(/from true north/)).length).toBeGreaterThan(0);
  });

  it('tells the user how to calibrate a compass reporting low accuracy', async () => {
    const view = await renderQibla(
      portReporting({ trueHeading: 100, magneticHeading: 100, accuracy: 2 }),
    );

    const banner = await view.findByTestId('faith-qibla-calibration');
    expect(String(banner.props.accessibilityLabel)).toMatch(/figure of eight/i);
  });

  it('shows no calibration advice when the compass is confident', async () => {
    const view = await renderQibla(
      portReporting({ trueHeading: 100, magneticHeading: 100, accuracy: 3 }),
    );
    await view.findByTestId('faith-qibla-dial');

    expect(view.queryByTestId('faith-qibla-calibration')).toBeNull();
  });

  it('stops listening to the compass when the screen goes away', async () => {
    const remove = jest.fn();
    const view = await renderQibla(
      fakeLocationPort({
        watchHeading: async (onReading) => {
          onReading({ trueHeading: 90, magneticHeading: 90, accuracy: 3 });
          return remove;
        },
      }),
    );
    await view.findByTestId('faith-qibla-dial');

    // `cleanup` unmounts and runs effect teardown, which is the path navigating away takes.
    await cleanup();

    // A magnetometer left running is a battery drain from a screen nobody is looking at.
    expect(remove).toHaveBeenCalled();
  });

  it('names the place the bearing was calculated for', async () => {
    const view = await renderQibla(
      portReporting({ trueHeading: 90, magneticHeading: 90, accuracy: 3 }),
    );

    expect(await view.findByText(/Manchester, United Kingdom/)).toBeTruthy();
  });
});
