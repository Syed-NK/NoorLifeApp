# Quran Foundation Content API — integration status

**Status: PENDING APPROVAL** (as of 2026-07-31)

No implementation exists. This directory holds a contract only:
`quran-foundation.contract.ts`. Nothing in the Expo bundle contacts the Quran
Foundation, and nothing may until the items below are complete.

## Why the app currently shows mock content

While approval is pending the Faith module renders locally-authored fixtures,
labelled in the UI as unverified via the `ContentSource.verified` flag. Every
screen that displays scripture shows a source badge, and the badge reads
"Sample content — not a verified source" for mock data.

The alternative — wiring an unofficial or community Qur'an API in the interim —
is **explicitly forbidden**. It would mean shipping scripture from a source
nobody has vetted, and the fact that it is temporary does not make a wrong verse
less wrong. `createQuranFoundationRepository()` throws rather than degrade to
one, and `quranFoundationInvariants.noUnofficialFallback` is asserted by test.

## Approval checklist

- [ ] Content API application submitted to Quran Foundation
- [ ] Application approved and credentials issued
- [ ] Licence terms reviewed against NoorLife's distribution model
- [ ] Attribution requirements confirmed and reflected in `ContentSource`
- [ ] Permitted translation editions confirmed; `enabledTranslations` populated
- [ ] Permitted reciter editions confirmed; `enabledReciters` populated
- [ ] Caching terms confirmed against the one-week ceiling in `MAX_CACHE_AGE_MS`
- [ ] Rate limits confirmed and reflected in the edge function's backoff
- [ ] Offline/redistribution terms confirmed for `serveStaleWhenOffline`

## Architecture, once approved

The credential never reaches the device.

```
Expo app  ──►  Supabase edge function  ──►  Quran Foundation Content API
               · holds the client secret
               · performs the token exchange
               · enforces the cache policy
               · normalises errors to FaithResult
               · strips vendor detail from responses
```

Implementation order:

1. Create the `quran-content` edge function. Store the credential in Supabase
   secrets — never in `.env`, never in `EXPO_PUBLIC_*`, never in `app.json`.
2. Implement `QuranFoundationEndpoint` against that function.
3. Wrap it in an object satisfying `QuranContentRepository`.
4. Register it in `FaithRepositoryProvider` in place of the mock. No screen
   changes — that swap is the whole point of the DI seam.

## Rules that survive implementation

These are asserted in `__tests__/quran-foundation-contract.test.ts` and must
continue to hold:

| Rule | Enforcement |
|---|---|
| Qur'anic Arabic is never modified | `AyahText.arabic` is `readonly`; no write method exists |
| No machine translation | Translations require a `TranslationId` and an attributed `ContentSource` |
| No unofficial fallback | `createQuranFoundationRepository` throws; invariant asserted |
| No credential on device | `QuranFoundationClientConfig` has no field one could occupy |
| Source metadata always present | `ContentSource` is required on `AyahText` and `AyahTranslation` |
| Pagination | `listAyahs` / `listTranslations` take `FaithPageRequest` |
| Cache ≤ one week | `validateCachePolicy` throws above `MAX_CACHE_AGE_MS` |

## Contacts

Quran Foundation Content API: https://api-docs.quran.foundation/

Do not add any other Qur'an data source to this project.
