import type { FaithPage, FaithResult } from './faith-result';
import type { Dua, DuaCategory, DuaRepository } from './dua.repository';
import type { Hadith, HadithCollection, HadithRepository } from './hadith.repository';
import type { Mosque, MosqueRepository } from './mosque.repository';
import { createQiblaBearingProvider } from './qibla/qibla-bearing.repository';

/**
 * Hadith, Duas and the mosque directory, as they stand with no approved provider.
 *
 * ── Why these are implementations rather than absences ──────────────────────
 * `FaithRepositories` requires all three, and every screen, search tab and home card that consumes
 * them still exists. Removing the keys would mean threading `undefined` through a dozen call sites
 * and giving each one its own idea of what a missing provider means. One implementation that answers
 * the same way everywhere is both smaller and harder to get wrong.
 *
 * ── Why `not-configured` and not `empty` ────────────────────────────────────
 * They say different things and the screens render them differently. `empty` means the provider was
 * asked and holds nothing — "no mosques near you", which for a directory that does not exist is a
 * false statement about the world. `not-configured` means NoorLife has not been wired to a source,
 * which is the truth, and it is an error code the module already had.
 *
 * ── What replaced the fixtures these supersede ──────────────────────────────
 * `mock-hadith.repository.ts`, `mock-dua.repository.ts` and `mock-mosque.repository.ts` are deleted
 * rather than left behind a flag. Each held convincing content — graded narrations with real
 * references, Arabic supplications at display size, mosques with street addresses and distances in
 * metres — and a fixture that still exists is a fixture something can be wired back to. That is the
 * same reasoning that deleted the prayer-times fixture, and it applies with more force here, because
 * unverified religious text is content a user may recite and a fabricated address is one they may
 * walk to.
 *
 * ── The one thing that is not stubbed, and no longer lives here ─────────────
 * `getQiblaBearing`. It is spherical trigonometry against a fixed coordinate, it needs no directory
 * and no provider, and the Qibla screen depends on it — so stubbing it would break a working feature
 * to make a point about a different one.
 *
 * It was implemented in this file, which put real working maths inside a module named for content
 * NoorLife cannot serve. It is `data/qibla/qibla-bearing.repository.ts` now and is composed in below,
 * so `MosqueRepository` is satisfied in full without this file claiming the calculation as its own.
 */

/** The reason, stated once. Screens render their own copy; this is for logs and detail fields. */
const NOT_CONFIGURED = 'No approved provider is configured for this content.';

function unconfigured<T>(): Promise<FaithResult<T>> {
  return Promise.resolve({ kind: 'error', code: 'not-configured', detail: NOT_CONFIGURED });
}

/**
 * A page-shaped refusal.
 *
 * Search tabs take `FaithPage<T>` and a bare `error` is the honest answer, so this exists only to
 * keep the generic parameter readable at the call sites below.
 */
function unconfiguredPage<T>(): Promise<FaithResult<FaithPage<T>>> {
  return unconfigured<FaithPage<T>>();
}

export function createUnconfiguredHadithRepository(): HadithRepository {
  return {
    listCollections: () => unconfigured<readonly HadithCollection[]>(),
    listByCollection: () => unconfiguredPage<Hadith>(),
    getHadith: () => unconfigured<Hadith>(),
    search: () => unconfiguredPage<Hadith>(),
    getDailyHadith: () => unconfigured<Hadith>(),
  };
}

export function createUnconfiguredDuaRepository(): DuaRepository {
  return {
    listCategories: () => unconfigured<readonly DuaCategory[]>(),
    listByCategory: () => unconfiguredPage<Dua>(),
    getDua: () => unconfigured<Dua>(),
    search: () => unconfiguredPage<Dua>(),
  };
}

export function createUnconfiguredMosqueRepository(): MosqueRepository {
  return {
    findNearby: () => unconfigured<readonly Mosque[]>(),
    search: () => unconfigured<readonly Mosque[]>(),
    getMosque: () => unconfigured<Mosque>(),
    /*
      Composed, not implemented here. The directory is unconfigured; the Qibla is not, and it is owned
      by `data/qibla/qibla-bearing.repository.ts`. Spreading it keeps `MosqueRepository` whole without
      this module holding a calculation it has no business owning.
    */
    ...createQiblaBearingProvider(),
  };
}
