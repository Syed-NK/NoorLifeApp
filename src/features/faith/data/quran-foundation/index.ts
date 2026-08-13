import { isSupabaseConfigured } from '@/lib/supabase';

import { createQuranContentEndpoint } from './quran-content.endpoint';
import { createQuranFoundationRepository } from './quran-foundation.repository';
import {
  defaultQuranCachePolicy,
  type QuranFoundationClientConfig,
  type SurahCatalogueStore,
} from './quran-foundation.contract';
import type { QuranContentRepository } from '../quran-content.repository';
import { readCachedCatalogue, writeCachedCatalogue } from '../../storage/faith-quran-catalogue';

/**
 * The catalogue store, bound to AsyncStorage.
 *
 * Assembled here rather than inside the repository so the repository keeps naming no storage
 * backend, and so a test can hand it a plain object. Both methods are total: `read` answers `null`
 * for a missing, expired or malformed entry, and `write` reports rather than throws.
 */
const catalogueStore: SurahCatalogueStore = {
  // The licence ceiling has already been applied inside `readCachedCatalogue`, so anything returned
  // here is servable; `storedAt` lets the repository decide separately whether it is worth
  // re-checking. See `StoredCatalogueEntry` for why the two windows are not the same question.
  read: async () => await readCachedCatalogue(),
  write: async (chapters) => {
    await writeCachedCatalogue(chapters);
  },
};

/**
 * The approved Quran Foundation adapter, assembled — or `null` when this build has no backend.
 *
 * ── Why the configuration question is answered here ─────────────────────────
 * `faith-repository-context.tsx` decides *which* repository a screen gets; this decides whether
 * there is one to give. Keeping the environment check in the data layer means the DI file reasons
 * about repositories rather than about environment variables, and it keeps the Supabase client
 * import inside the layer that is supposed to hold it — `privacy-security-source-scan.test.ts`
 * enforces that boundary over every screen, component and hook.
 *
 * `null` rather than a repository that always fails, because the two are different statements. A
 * build with no `EXPO_PUBLIC_SUPABASE_URL` has no edge function to call at all, and the honest thing
 * for it to show is the labelled fixtures — not an error implying something is broken.
 *
 * A test supplies its own `QuranFoundationClientConfig` with a fake endpoint instead, which is why
 * the config takes the endpoint as a value rather than reaching for the client itself.
 */
export function createProductionQuranRepository(): QuranContentRepository | null {
  if (!isSupabaseConfigured) {
    return null;
  }
  const config: QuranFoundationClientConfig = {
    cachePolicy: defaultQuranCachePolicy,
    /**
     * Scripture is worth showing while offline. The result is rendered through the `stale` case, so
     * the screen carries a banner saying when it was saved — showing a week-old ayah beats showing
     * nothing, but only when the user is told which it is.
     */
    serveStaleWhenOffline: true,
    endpoint: createQuranContentEndpoint(),
    /**
     * Why the catalogue — and only the catalogue — survives a restart.
     *
     * It is the Qur'an's table of contents, it is what every cold open of the Qur'an tab was
     * refetching unchanged, and it is bounded by the same one-week licence ceiling as everything
     * else. Scripture, translations and recitation URLs stay in the in-memory cache that dies with
     * the process. See `storage/faith-quran-catalogue.ts`.
     */
    catalogueStore,
  };
  return createQuranFoundationRepository(config);
}

export { createQuranContentEndpoint } from './quran-content.endpoint';
export { createQuranFoundationRepository } from './quran-foundation.repository';
export { createQuranCache } from './quran-cache';
export { DAILY_AYAH_ROTATION, dailyAyahFor } from './daily-ayah-rotation';
export * from './quran-foundation.contract';
