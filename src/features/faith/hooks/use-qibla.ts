import { useCallback, useEffect, useState } from 'react';

import { hasData, type FaithResult } from '../data/faith-result';
import type { Coordinate, PrayerLocation } from '../data/prayer-times.repository';
import {
  compassAccuracy,
  greatCircleDistanceKm,
  KAABA,
  qiblaBearing,
  type CompassAccuracy,
} from '../data/qibla/qibla';
import { useActiveLocationRevision } from '../data/location/active-location';
import { useFaithRepositories } from '../di/faith-repository-context';
import { useFaithResource, type UseFaithResource } from './use-faith-resource';

/**
 * The Qibla: where it is, and where the device is pointing.
 *
 * ── Two facts with two lifetimes, kept apart ────────────────────────────────
 * The **bearing** is a property of the user's location. It is computed once per place and does not
 * change while they stand still, so it goes through `useFaithResource` and gets all its states —
 * permission, offline, error.
 *
 * The **heading** is a stream, arriving many times a second while the screen is open. It is not a
 * resource, has no failure state of its own, and its absence is not an error — some devices simply
 * have no magnetometer. Folding it into the resource would mean re-rendering the permission machinery
 * at sensor rate.
 *
 * ── Nothing here invents a heading ──────────────────────────────────────────
 * `heading` is `null` until a reading arrives and stays `null` on a device with no compass. There is
 * no default of north, no last-known value, and no interpolation — a compass needle that points
 * confidently at nothing is worse than a screen that says it cannot tell.
 */

export type QiblaTarget = {
  readonly location: PrayerLocation;
  /** Degrees from **true** north. */
  readonly bearing: number;
  readonly distanceKm: number;
};

export type UseQibla = {
  readonly target: UseFaithResource<QiblaTarget>;
  /** Degrees from true north, or `null` when no usable reading has arrived. */
  readonly heading: number | null;
  readonly accuracy: CompassAccuracy;
  /** False when the device reported no compass at all. */
  readonly hasCompass: boolean;
  /** True until the first reading or the capability probe settles. */
  readonly probing: boolean;
};

export function useQibla(): UseQibla {
  const { prayerTimes, location } = useFaithRepositories();

  /*
    ── The bearing is a property of the location, so its key must name the location ──
    The key was the constant `'faith.qibla.target'`, which never changed — so saving a new location
    on the Prayer location screen left this resource settled under the same key and the screen kept
    the *previous* place's bearing until something unrelated remounted it. A Qibla arrow that is
    confidently wrong is the worst failure this module has: nothing on screen says it is stale, and
    the user has no way to tell degrees for Dubai from degrees for Mountain View.

    The revision is the same one Faith Home and Prayer Times key on, bumped once by the mutation
    boundary after the write lands, so all three recompute from one commit.
  */
  const locationRevision = useActiveLocationRevision();

  const target = useFaithResource(
    `faith.qibla.target.${locationRevision}`,
    useCallback(async (): Promise<FaithResult<QiblaTarget>> => {
      const resolved = await prayerTimes.resolveCurrentLocation();
      if (!hasData(resolved)) {
        // Passed straight through, including `permission-required` — the Qibla needs a location for
        // exactly the reason prayer times do, and the screen offers the same prompt.
        return resolved;
      }
      const coordinate: Coordinate = resolved.data.coordinate;
      return {
        kind: 'ok',
        data: {
          location: resolved.data,
          bearing: qiblaBearing(coordinate),
          distanceKm: greatCircleDistanceKm(coordinate, KAABA),
        },
      };
    }, [prayerTimes]),
  );

  const [heading, setHeading] = useState<number | null>(null);
  const [reportedAccuracy, setReportedAccuracy] = useState(0);
  const [hasCompass, setHasCompass] = useState(true);
  const [probing, setProbing] = useState(true);

  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | null = null;

    void (async () => {
      const available = await location.hasCompass();
      if (!active) {
        return;
      }
      setHasCompass(available);
      if (!available) {
        /*
          An emulator with no virtual magnetometer, or a handset without one. The screen says so and
          shows the bearing as a number — which is still correct and still useful with a separate
          compass — rather than drawing a needle that will never move.
        */
        setProbing(false);
        return;
      }

      unsubscribe = await location.watchHeading((reading) => {
        if (!active) {
          return;
        }
        setProbing(false);
        setReportedAccuracy(reading.accuracy);
        /**
         * True north only.
         *
         * `trueHeading` is `null` when the platform could not resolve declination, and magnetic
         * north is **not** an acceptable substitute: the two differ by up to ~20° in populated parts
         * of the world, and the Qibla bearing is measured from true north. Rotating a dial by a
         * magnetic heading would point the arrow confidently into the wrong quarter of the sky.
         */
        setHeading(reading.trueHeading);
      });
    })();

    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [location]);

  return {
    target,
    heading,
    accuracy: compassAccuracy(reportedAccuracy),
    hasCompass,
    probing,
  };
}
