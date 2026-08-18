import type { FaithResult } from '../faith-result';
import type { QiblaBearing } from '../mosque.repository';
import type { Coordinate } from '../prayer-times.repository';
import { greatCircleBearing, greatCircleDistanceKm, KAABA } from './qibla';

/**
 * The Qibla bearing, as a repository capability of its own.
 *
 * ── Why this is a separate module ───────────────────────────────────────────
 * It was inside `data/unconfigured-content.repository.ts`, which was wrong in the way that matters
 * most for a file like that one: the module is named for content NoorLife *cannot* serve, and it held
 * the one calculation in the group that works perfectly. Anybody auditing "what is unconfigured"
 * would have found real spherical trigonometry in the answer, and anybody looking for the Qibla maths
 * would not have thought to look there.
 *
 * The reason it ended up there is legible and worth keeping: `getQiblaBearing` is a member of
 * `MosqueRepository`, so the implementation had to live wherever that interface was implemented. That
 * is a fact about the interface, not a reason to file working code under "unconfigured".
 *
 * ── What this deliberately does not do ──────────────────────────────────────
 * It does not change `MosqueRepository`. Splitting `getQiblaBearing` onto an interface of its own
 * would ripple through the DI container, `useFaithRepositories` and the Qibla screen for no gain the
 * user can see. Instead this exports the one method as a composable fragment, and the mosque
 * repository spreads it in — so the interface, the context and every call site are untouched, and the
 * maths has a home named after itself.
 *
 * When a directory provider is approved, its repository composes this the same way. The Qibla is
 * never a property of whether a mosque list exists.
 *
 * ── Why it is synchronous behind an async signature ─────────────────────────
 * The interface is async because a future correction — magnetic declination from a lookup, say —
 * might need to be. The calculation itself needs no network and no storage, so this resolves
 * immediately. The fixture it replaced waited 120 ms to imitate a round trip it never made, which
 * cost the Qibla screen an eighth of a second of loading state for a value it already had.
 */
export type QiblaBearingProvider = {
  getQiblaBearing(coordinate: Coordinate): Promise<FaithResult<QiblaBearing>>;
};

export function createQiblaBearingProvider(): QiblaBearingProvider {
  return {
    getQiblaBearing: (coordinate: Coordinate): Promise<FaithResult<QiblaBearing>> =>
      Promise.resolve({
        kind: 'ok',
        data: {
          from: coordinate,
          bearingDegrees: greatCircleBearing(coordinate, KAABA),
          distanceKm: greatCircleDistanceKm(coordinate, KAABA),
        },
      }),
  };
}
