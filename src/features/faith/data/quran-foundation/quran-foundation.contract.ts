import type { FaithPage, FaithPageRequest, FaithResult } from '../faith-result';
import type {
  AyahText,
  AyahTranslation,
  ReciterEdition,
  ReciterId,
  SurahNumber,
  SurahSummary,
  TranslationEdition,
  TranslationId,
} from '../quran-content.repository';

/**
 * The Quran Foundation Content API adapter — contract only.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * TODO(quran-foundation): No implementation may be written against this
 * contract until official Quran Foundation Content API access is APPROVED.
 * Application status: pending as of 2026-07-31.
 * See `README.md` in this directory for the approval checklist and the
 * licensing terms that must be satisfied first.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── This file contains no network code, and that is the point ───────────────
 * Everything below is types and configuration. There is no `fetch`, no base URL, no
 * client id, no secret, and no fallback to an unofficial Qur'an API — the last of which
 * is worth stating explicitly because it is the tempting shortcut while approval is
 * pending, and it would mean shipping scripture from an unvetted source. The app renders
 * clearly-labelled mock content until the approved source is available. That is the only
 * acceptable interim behaviour.
 *
 * ── Why the adapter is server-bound ─────────────────────────────────────────
 * An Expo bundle is readable by anyone who unzips the APK. `EXPO_PUBLIC_*` values are
 * inlined at bundle time and are equally readable. A Quran Foundation client secret
 * therefore cannot live in this app under any configuration, and neither can a token
 * minted from one.
 *
 * The shape that works:
 *
 *     Expo app ──► NoorLife edge function ──► Quran Foundation Content API
 *                  (holds the credential,      (never contacted by the
 *                   enforces the cache,         device directly)
 *                   normalises errors)
 *
 * `QuranFoundationEndpoint` below describes the *edge function's* interface — the thing
 * the device is allowed to know about. The credential, the vendor base URL and the token
 * exchange are all properties of the server and are deliberately absent from these types:
 * there is nowhere in this contract to put a secret, which is a stronger guarantee than
 * a convention not to.
 */

/**
 * How long a cached response may be served.
 *
 * The one-week ceiling is a policy requirement, not a tuning parameter, so it is a
 * constant rather than a configurable field and `validateCachePolicy` rejects anything
 * above it. Qur'an text does not change, but a cache without an expiry is a cache nobody
 * can correct — if an edition is withdrawn or a translation revised, a week is the
 * longest a stale copy may persist.
 */
export const MAX_CACHE_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export type QuranCachePolicy = {
  /** Arabic scripture. Immutable content, so the full week is appropriate. */
  readonly scriptureMaxAgeMs: number;
  /** Translations. Revisable by their publishers, so a shorter window. */
  readonly translationMaxAgeMs: number;
  /** Edition and reciter lists. Change when the vendor adds one. */
  readonly catalogueMaxAgeMs: number;
};

export const defaultQuranCachePolicy: QuranCachePolicy = {
  scriptureMaxAgeMs: MAX_CACHE_AGE_MS,
  translationMaxAgeMs: 24 * 60 * 60 * 1000,
  catalogueMaxAgeMs: 24 * 60 * 60 * 1000,
};

/** Throws if any window exceeds the one-week ceiling. Asserted by test. */
export function validateCachePolicy(policy: QuranCachePolicy): QuranCachePolicy {
  for (const [name, value] of Object.entries(policy)) {
    if (value > MAX_CACHE_AGE_MS) {
      throw new RangeError(
        `Cache policy "${name}" is ${value}ms, above the ${MAX_CACHE_AGE_MS}ms (one week) maximum.`,
      );
    }
    if (value <= 0) {
      throw new RangeError(`Cache policy "${name}" must be positive, received ${value}.`);
    }
  }
  return policy;
}

/**
 * Configuration the device is permitted to hold.
 *
 * Note what is *not* here: no API key, no client id, no client secret, no vendor
 * hostname. `endpointPath` is a path on NoorLife's own backend, which the app already
 * has a session for.
 */
export type QuranFoundationClientConfig = {
  /** Path on the NoorLife edge function, e.g. `/functions/v1/quran-content`. */
  readonly endpointPath: string;
  readonly cachePolicy: QuranCachePolicy;
  /** Editions the product has licensed. Chosen at approval time, not by the device. */
  readonly enabledTranslations: readonly TranslationId[];
  readonly enabledReciters: readonly ReciterId[];
  /**
   * Whether the device may serve expired cache while offline.
   *
   * True is correct for scripture — showing a week-old ayah beats showing nothing — but
   * the UI must render it through the `stale` result so the user is told.
   */
  readonly serveStaleWhenOffline: boolean;
};

/**
 * The operations the edge function exposes.
 *
 * Mirrors `QuranContentRepository` because the adapter's job is to satisfy that
 * interface — but it is a separate type so the transport can carry things the domain
 * does not, such as the cache metadata below.
 */
export type QuranFoundationEndpoint = {
  listSurahs(): Promise<FaithResult<readonly SurahSummary[]>>;
  listAyahs(surah: SurahNumber, page?: FaithPageRequest): Promise<FaithResult<FaithPage<AyahText>>>;
  listTranslations(
    surah: SurahNumber,
    translationId: TranslationId,
    page?: FaithPageRequest,
  ): Promise<FaithResult<FaithPage<AyahTranslation>>>;
  availableTranslations(): Promise<FaithResult<readonly TranslationEdition[]>>;
  availableReciters(): Promise<FaithResult<readonly ReciterEdition[]>>;
};

/**
 * Metadata every cached entry carries.
 *
 * `contentSource` is required so provenance survives the cache. A cached ayah that lost
 * its attribution would be rendered as unsourced scripture, which the Faith AI boundary
 * rules forbid — and the cache is exactly where that information tends to get dropped.
 */
export type QuranCacheEntryMeta = {
  readonly cachedAt: string;
  readonly expiresAt: string;
  readonly sourceName: string;
  readonly sourceEdition: string;
};

/**
 * The rules an implementation must satisfy, as machine-checkable assertions.
 *
 * Written as data so the test suite can assert them rather than trusting a comment. When
 * an implementation is eventually written, these are the invariants its own tests inherit.
 */
export const quranFoundationInvariants = {
  /** Qur'anic Arabic is stored and rendered byte-for-byte as received. */
  scriptureIsImmutable: true,
  /** No machine translation, ever. Translations come from attributed editions only. */
  noAutomaticTranslation: true,
  /** No unofficial or community Qur'an API may be used as a fallback. */
  noUnofficialFallback: true,
  /** The device never holds a vendor credential. */
  credentialsAreServerSide: true,
  /** Every response carries its content source. */
  sourceMetadataRequired: true,
  /** Responses are paginated. */
  paginationRequired: true,
  /** No cached copy outlives one week. */
  maxCacheAgeMs: MAX_CACHE_AGE_MS,
} as const;

/**
 * Placeholder factory.
 *
 * Throws. It exists so that the wiring point is discoverable — a reader looking for
 * "where does the real implementation get constructed?" lands here — and so that any
 * accidental attempt to use the adapter before approval fails immediately and loudly
 * rather than silently falling back to mock scripture.
 */
export function createQuranFoundationRepository(_config: QuranFoundationClientConfig): never {
  throw new Error(
    'The Quran Foundation adapter is not implemented. Official Content API access is ' +
      'pending approval — see src/features/faith/data/quran-foundation/README.md. ' +
      'Do not implement a fallback against an unofficial Qur’an API.',
  );
}
