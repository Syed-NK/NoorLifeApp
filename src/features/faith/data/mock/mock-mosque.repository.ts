import type { FaithResult } from '../faith-result';
import type { Mosque, MosqueRepository, QiblaBearing } from '../mosque.repository';
import type { Coordinate } from '../prayer-times.repository';
import { delay, matches } from './mock-support';

/**
 * Nearby mosques and the Qibla bearing.
 *
 * ── The Qibla calculation is real ───────────────────────────────────────────
 * Unlike the prayer times, this one is not a fixture. The initial great-circle bearing
 * from a coordinate to the Kaaba is a closed-form formula with no calibration constants
 * and no editorial judgement, so computing it honestly is both possible and better than
 * a canned number — a Qibla arrow that pointed the same way everywhere would be visibly
 * wrong the moment anyone travelled.
 *
 * The mosque *list* is fixtures, clearly attributed as sample data.
 */

/** The Kaaba, Masjid al-Haram. */
const KAABA: Coordinate = { latitude: 21.4224779, longitude: 39.8251832 };

const EARTH_RADIUS_KM = 6371;

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;
const toDegrees = (radians: number): number => (radians * 180) / Math.PI;

/** Initial great-circle bearing from `from` to `to`, normalised to 0–360°. */
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

const MOSQUES: readonly Mosque[] = [
  {
    id: 'sample-1',
    name: 'Central Jamia Masjid',
    address: '12 Mosque Road',
    coordinate: { latitude: 53.4795, longitude: -2.2402 },
    distanceMetres: 320,
    facilities: ['Women’s prayer hall', 'Wudu facilities', 'Parking'],
    attribution: 'NoorLife sample data',
  },
  {
    id: 'sample-2',
    name: 'Masjid al-Noor',
    address: '48 Victoria Street',
    coordinate: { latitude: 53.4831, longitude: -2.2478 },
    distanceMetres: 810,
    facilities: ['Wudu facilities', 'Wheelchair access'],
    attribution: 'NoorLife sample data',
  },
  {
    id: 'sample-3',
    name: 'Islamic Community Centre',
    address: '3 Park Lane',
    coordinate: { latitude: 53.4762, longitude: -2.2351 },
    distanceMetres: 1240,
    facilities: ['Weekend school', 'Parking'],
    attribution: 'NoorLife sample data',
  },
];

export function createMockMosqueRepository(): MosqueRepository {
  return {
    async findNearby(
      coordinate: Coordinate,
      radiusMetres = 5000,
    ): Promise<FaithResult<readonly Mosque[]>> {
      void coordinate;
      const within = MOSQUES.filter((mosque) => mosque.distanceMetres <= radiusMetres);
      if (within.length === 0) {
        return delay({ kind: 'empty' as const });
      }
      return delay({ kind: 'ok' as const, data: within });
    },

    async search(query: string, near?: Coordinate): Promise<FaithResult<readonly Mosque[]>> {
      void near;
      const trimmed = query.trim();
      if (trimmed.length < 2) {
        return delay({ kind: 'no-results' as const, query: trimmed }, 60);
      }
      const hits = MOSQUES.filter(
        (mosque) => matches(mosque.name, trimmed) || matches(mosque.address, trimmed),
      );
      if (hits.length === 0) {
        return delay({ kind: 'no-results' as const, query: trimmed });
      }
      return delay({ kind: 'ok' as const, data: hits });
    },

    async getMosque(id: string): Promise<FaithResult<Mosque>> {
      const found = MOSQUES.find((mosque) => mosque.id === id);
      return delay(
        found === undefined
          ? { kind: 'error' as const, code: 'not-found' as const }
          : { kind: 'ok' as const, data: found },
      );
    },

    async getQiblaBearing(coordinate: Coordinate): Promise<FaithResult<QiblaBearing>> {
      return delay(
        {
          kind: 'ok' as const,
          data: {
            from: coordinate,
            bearingDegrees: greatCircleBearing(coordinate, KAABA),
            distanceKm: greatCircleDistanceKm(coordinate, KAABA),
          },
        },
        120,
      );
    },
  };
}

export const kaabaForTest = KAABA;
export const mockMosquesForTest = MOSQUES;
