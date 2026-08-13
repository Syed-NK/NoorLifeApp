import * as Location from 'expo-location';

import type { Coordinate } from '../prayer-times.repository';
import type {
  HeadingReading,
  LocationFailure,
  LocationFix,
  LocationPermission,
  LocationPort,
  ProvisionalFix,
} from './location.port';

/** The first non-empty string in a list, or `null`. */
function firstNonEmpty(values: readonly (string | null | undefined)[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }
  return null;
}

function equalsIgnoringCase(a: string, b: string | null): boolean {
  return b !== null && a.toLocaleLowerCase() === b.toLocaleLowerCase();
}

/**
 * The `expo-location` implementation of `LocationPort`.
 *
 * ── This is the only file in the app that imports `expo-location` ───────────
 * Everything else takes the port. A source scan asserts it, for the same reason the Supabase client
 * is confined to one module: a permission-raising API reachable from anywhere is a permission
 * prompt nobody can account for.
 *
 * ── What it deliberately does not do ────────────────────────────────────────
 * It never prompts on its own. `getPermission` reads state and `requestPermission` prompts, and the
 * two are separate methods precisely so a screen that only wants to know cannot accidentally ask.
 *
 * It never substitutes a coordinate. There is no last-known fallback to a stored city, no country
 * centroid, and no default. `getCurrentPosition` either returns where the device says it is, or says
 * why it cannot.
 */

/** How long to wait for a fix before giving up. */
const FIX_TIMEOUT_MS = 12_000;

function toPermission(
  status: Location.PermissionStatus,
  canAskAgain: boolean,
  servicesEnabled: boolean,
): LocationPermission {
  if (!servicesEnabled) {
    // Distinct from a refusal: granting the app everything would still produce no fix, and the
    // advice is to turn location services on rather than to revisit app permissions.
    return 'services-disabled';
  }
  if (status === Location.PermissionStatus.GRANTED) {
    return 'granted';
  }
  return canAskAgain && status === Location.PermissionStatus.UNDETERMINED
    ? 'undetermined'
    : 'denied';
}

/**
 * Races a promise against a deadline.
 *
 * `getCurrentPositionAsync` can sit indefinitely indoors on a cold GPS, and a Faith home that never
 * stops showing a skeleton is worse than one that says it could not find you.
 */
async function withTimeout<T>(work: Promise<T>, ms: number): Promise<T | 'timed-out'> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<'timed-out'>((resolve) => {
        timer = setTimeout(() => resolve('timed-out'), ms);
      }),
    ]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

export function createExpoLocationPort(): LocationPort {
  const readPermission = async (
    read: () => Promise<Location.LocationPermissionResponse>,
  ): Promise<LocationPermission> => {
    try {
      const servicesEnabled = await Location.hasServicesEnabledAsync();
      const response = await read();
      return toPermission(response.status, response.canAskAgain, servicesEnabled);
    } catch {
      // A platform that cannot answer is treated as unavailable rather than as granted. Failing
      // closed here means the worst case is a screen asking for a permission it already has.
      return 'denied';
    }
  };

  return {
    async getPermission(): Promise<LocationPermission> {
      return readPermission(() => Location.getForegroundPermissionsAsync());
    },

    async requestPermission(): Promise<LocationPermission> {
      return readPermission(() => Location.requestForegroundPermissionsAsync());
    },

    async getCurrentPosition(): Promise<LocationFix | { readonly failure: LocationFailure }> {
      const permission = await this.getPermission();
      if (permission === 'services-disabled') {
        return { failure: 'services-disabled' };
      }
      if (permission !== 'granted') {
        return { failure: 'permission-denied' };
      }

      try {
        const result = await withTimeout(
          Location.getCurrentPositionAsync({
            /**
             * `Balanced` — roughly one hundred metres.
             *
             * Prayer times shift by well under a minute over that distance and the Qibla bearing by
             * a fraction of a degree, so a more precise fix would cost battery and time to buy
             * accuracy nothing on this screen can use.
             */
            accuracy: Location.LocationAccuracy.Balanced,
          }),
          FIX_TIMEOUT_MS,
        );

        if (result === 'timed-out') {
          return { failure: 'timed-out' };
        }

        const { latitude, longitude, accuracy } = result.coords;
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
          return { failure: 'unavailable' };
        }

        return {
          coordinate: { latitude, longitude },
          accuracyMetres:
            typeof accuracy === 'number' && Number.isFinite(accuracy) ? accuracy : null,
        };
      } catch {
        return { failure: 'unavailable' };
      }
    },

    async getLastKnownPosition(limits: {
      readonly maxAgeMs: number;
      readonly maxAccuracyMetres: number;
    }): Promise<ProvisionalFix | null> {
      if ((await this.getPermission()) !== 'granted') {
        return null;
      }
      try {
        /*
          The platform applies the age limit itself, which is the point of passing it: asking for a
          fix "no older than N" and getting `null` is cheaper and more honest than being handed a
          day-old position and discarding it here. The accuracy limit has no platform equivalent, so
          it is applied below.
        */
        const last = await Location.getLastKnownPositionAsync({
          maxAge: limits.maxAgeMs,
          requiredAccuracy: limits.maxAccuracyMetres,
        });
        if (last === null) {
          return null;
        }

        const { latitude, longitude, accuracy } = last.coords;
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
          return null;
        }
        const accuracyMetres =
          typeof accuracy === 'number' && Number.isFinite(accuracy) ? accuracy : null;
        if (accuracyMetres !== null && accuracyMetres > limits.maxAccuracyMetres) {
          return null;
        }

        return {
          coordinate: { latitude, longitude },
          accuracyMetres,
          // `timestamp` is epoch milliseconds. Clamped at zero: a device clock that moved backwards
          // must not produce a negative age that would pass every freshness check ever written.
          ageMs: Math.max(0, Date.now() - last.timestamp),
        };
      } catch {
        return null;
      }
    },

    async describe(coordinate: Coordinate): Promise<string | null> {
      try {
        const [place] = await Location.reverseGeocodeAsync(coordinate);
        if (place === undefined) {
          return null;
        }
        /*
          ── Locality, region, country ─────────────────────────────────────────
          The three the brief asks for, in that order, each skipped when the geocoder did not supply
          it. `city ?? subregion` because Android frequently returns a district in `subregion` and
          leaves `city` empty outside major metros.

          The region is dropped when it merely repeats the locality — "Dubai, Dubai, United Arab
          Emirates" is what an unfiltered join produces there, and a label that stutters reads like a
          bug. Deduplicated case-insensitively, which is what catches "Dubai" against "DUBAI".
        */
        const locality = firstNonEmpty([place.city, place.subregion]);
        const region = firstNonEmpty([place.region]);
        const country = firstNonEmpty([place.country]);

        const parts = [
          locality,
          region !== null && !equalsIgnoringCase(region, locality) ? region : null,
          country,
        ].filter((part): part is string => part !== null);

        return parts.length === 0 ? null : parts.join(', ');
      } catch {
        return null;
      }
    },

    async search(
      query: string,
    ): Promise<readonly { readonly label: string; readonly coordinate: Coordinate }[]> {
      const trimmed = query.trim();
      if (trimmed.length < 2) {
        return [];
      }
      try {
        const results = await Location.geocodeAsync(trimmed);
        return results
          .filter((result) => Number.isFinite(result.latitude) && Number.isFinite(result.longitude))
          .slice(0, 8)
          .map((result) => ({
            // The OS geocoder returns coordinates without echoing a name, so the query stands as the
            // label. Inventing a place name for a coordinate is exactly what `describe` is for, and
            // calling it per result would be eight more round trips.
            label: trimmed,
            coordinate: { latitude: result.latitude, longitude: result.longitude },
          }));
      } catch {
        return [];
      }
    },

    async hasCompass(): Promise<boolean> {
      try {
        // A single reading is the only honest probe: the platform exposes no capability flag, and an
        // emulator without a virtual magnetometer rejects here rather than reporting anything.
        const heading = await Location.getHeadingAsync();
        return typeof heading.magHeading === 'number' && Number.isFinite(heading.magHeading);
      } catch {
        return false;
      }
    },

    async watchHeading(onReading: (reading: HeadingReading) => void): Promise<() => void> {
      try {
        const subscription = await Location.watchHeadingAsync((heading) => {
          onReading({
            // `-1` is the platform's "could not determine true north". Passed on as `null`, because
            // -1 is a number a caller could rotate a compass dial by.
            trueHeading: heading.trueHeading >= 0 ? heading.trueHeading : null,
            magneticHeading: heading.magHeading,
            accuracy: heading.accuracy,
          });
        });
        return () => subscription.remove();
      } catch {
        // A device with no compass never calls back, and unsubscribing is a no-op.
        return () => undefined;
      }
    },
  };
}
