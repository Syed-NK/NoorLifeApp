# Quran Foundation Content API — integration status

**Status: APPROVED AND IMPLEMENTED.** Quran Foundation granted **production Content
API access on 2026-08-10**. Search, the OAuth user APIs, bookmarks, notes and every
other user-feature endpoint remain **unapproved** and are not implemented.

## Architecture

The credential never reaches the device.

```
Expo app  ──►  supabase/functions/quran-content  ──►  Quran Foundation Content API
               · holds the client id and secret
               · performs the OAuth2 client-credentials exchange
               · caches the access token, renews it early
               · enforces the operation allow-list
               · validates every upstream field
               · normalises errors to a closed set
               · strips vendor detail from responses
```

| Layer         | File                             | Holds                                                                   |
| ------------- | -------------------------------- | ----------------------------------------------------------------------- |
| Wire contract | `quran-foundation.contract.ts`   | Types, cache policy, approval record. No network code.                  |
| Transport     | `quran-content.endpoint.ts`      | One authenticated `supabase.functions.invoke`, and response validation. |
| Cache         | `quran-cache.ts`                 | Bounded, in-memory, one-week hard ceiling.                              |
| Repository    | `quran-foundation.repository.ts` | `QuranContentRepository`, mapping and staleness.                        |
| Daily verse   | `daily-ayah-rotation.ts`         | Surah and ayah **numbers** only. No scripture.                          |
| Wiring        | `index.ts`                       | Builds the production repository, or `null` with no backend.            |

The mobile bundle contains **no** Quran Foundation hostname, client id, client secret,
access token or direct vendor request. `quran-foundation-contract.test.ts` scans the whole
Faith feature for each of those, and `supabase/functions/quran-content/tests/source-scan_test.ts`
scans `src/` from the other side of the boundary.

## Approved scope

`quranFoundationApproval` in the contract file is the machine-checkable version of this
section, and a test asserts it.

| Capability                                                                     | Status                      | Where it is enforced                                            |
| ------------------------------------------------------------------------------ | --------------------------- | --------------------------------------------------------------- |
| Content API — chapters, verses, translations, recitations, resource catalogues | **Approved**                | Eight fixed routes in `quran-foundation-client.ts`              |
| Search APIs                                                                    | Not approved                | No operation exists; `searchTranslations` returns `unsupported` |
| OAuth user APIs, bookmarks, notes, reading sessions                            | Not approved                | No route, no scope requested                                    |
| Content Sync                                                                   | Approved mechanism, not yet built | Documented at /api/v4/resources/sync; required for retention beyond seven days                   |

The token exchange requests `scope=content` and nothing else.

## Why `searchTranslations` is unsupported rather than removed or faked

Qur'an search needs the Search APIs. Three options existed and two were wrong:

- **Search the cache.** The cache holds at most the handful of pages this user opened in
  the last week. It would answer "no results" for verses that plainly exist, which looks
  like an answer and is worse than an error.
- **Delete the method.** That removes the evidence a capability is missing and makes the
  mock and the real repository describe different products.
- **Return an honest `unsupported` result.** What it does. The search screen states it, and
  Hadith and dua search — NoorLife's own data — are unaffected.

`FaithErrorCode` gained `unsupported` for exactly this, and `not-configured` for a build
with no backend at all. Neither is a weakening of the domain contract: both name a state
the existing set could only have described dishonestly.

## Content integrity rules

These are asserted by `__tests__/quran-foundation-contract.test.ts`,
`__tests__/quran-foundation-adapter.test.ts` and the function's own Deno suite. They
survived the move from "contract only" to a shipped implementation unchanged.

| Rule                                                  | Enforcement                                                                                                                                         |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Qur'anic Arabic is never modified                     | Copied by assignment on both sides; no `.normalize()`, `.trim()` or `.replace()` on the path, asserted by source scan and by byte-equality fixtures |
| No transliteration is fetched                         | `words=false` sent explicitly; only `fields=text_uthmani` requested                                                                                 |
| No machine translation                                | No translation call exists anywhere; `translate="no"` set where the platform has a DOM (see `ArabicText`)                                           |
| No generated scripture                                | No Arabic literal exists in the function or the adapter; the Daily Ayah stores numbers, not text                                                    |
| No unofficial fallback                                | One upstream host, fixed as a literal; no second source anywhere                                                                                    |
| No fallback to sample scripture                       | The adapter imports nothing from `data/mock`; every failure is a failure state                                                                      |
| Translation attribution is explicit                   | Resolved through the hierarchy below; a rendering nobody can be credited for is refused rather than shown                                           |
| Source metadata identifies the vendor and the edition | Required on every payload carrying content; `verified: true` is set in exactly three files                                                          |
| Pagination is bounded                                 | `per_page` capped at the vendor's documented 50, refused above it server-side                                                                       |
| Cache ≤ one week                                      | Clamped server-side when the age is declared, and again client-side on read                                                                         |

### How a translation is attributed

Quran Foundation's `translation` component requires only `resource_id` and `text`;
`resource_name` is **optional**, and the live API omits it on both routes NoorLife reads.
Requiring it turned every valid translation into `502 upstream_unavailable` behind an
`upstream_outcome: ok` — a correct response rejected by our own normaliser.

The replacement resolves a title and a translator as a **pair from one source**, strongest
first. Mixing a title from one source with a translator from another would produce a credit
no source actually asserts, so each is taken whole or not at all.

1. **The edition catalogue.** `GET /resources/translations`, keyed by the exact id that was
   requested, carrying the vendor's own `name` and `author_name`. Fetched by the function,
   never by the device, and held per isolate for 24 hours — the same window the function
   already declares for catalogue responses. A stale-but-present catalogue is preferred to
   none when a refresh fails.
2. **Response `meta`.** `meta.translation_name` / `meta.author_name` are required by
   `QuranTranslationMeta`, but that component is referenced by exactly one path —
   `/quran/translations/{id}` — and **neither route this function reads declares a `meta`
   block**. It is therefore honoured where it appears and never depended on.
3. **The entry label.** `resource_name` is one combined string ("Dr. Mustafa Khattab, the
   Clear Quran"). Splitting it into a title and a translator would be inventing the
   boundary, so it becomes the edition title only and the credit line says less rather than
   naming a translator nobody asserted.

What still fails closed: an id that is not the one requested, a page mixing two editions,
rows disagreeing about which edition they belong to, an empty or half-present attribution,
and rows to render with none of the three sources available. Rows that merely stay _silent_
about `resource_name` are not disagreeing, and are accepted. An empty page carries nothing
to credit, so it is a legitimate end of list rather than an attribution failure.

Scripture validation is untouched by any of this: the relaxation was to an optional label on
a _translation_.

### Resource ids: strings in the domain, integers on the wire

`TranslationId` and `ReciterId` stay `string`. An edition identifier is a name rather than a
quantity — it is persisted in preferences, compared for equality and used as a cache key.
Quran Foundation's ids are integers, and the edge function requires a bounded integer.

Those two facts meet in exactly one place: `toWireResourceId`, called as the last statement
before a request is built. Non-decimal, unsafe, zero, negative, fractional and out-of-range
values are refused there and the request is **never made** — `not-found`, because the
identifier names no edition the source can serve and the remedy is to choose another one,
which is what the preferences screen offers for that code. The server is not loosened with
implicit coercion to meet the app.

A live deployment found this: `400 invalid_request`, `error_field: recitation_id`,
`upstream_attempts: 0` — the app had sent `"1"` where `1` was required, and nothing reached
Quran Foundation.

### Caching, against the developer terms

The terms forbid caching or storing QF content "longer than 1 week" and forbid
extracting, scraping or indexing it outside the API responses. The cache therefore:

- **drops** anything older than one week, on read as well as on write, with no offline
  exception;
- serves **stale** content only while offline, only when configured to, and only through
  the `stale` result so the screen tells the user when it was saved;
- is **bounded** to 48 entries with least-recently-used eviction, so it cannot grow into a
  mirror however long the app runs;
- is **in memory only** — nothing is written to AsyncStorage, SecureStore or the
  filesystem, so it does not survive the process.

Freshness windows inside that ceiling: a week for scripture, a day for translations and
catalogues.

## Deployment prerequisites

Nothing here has been deployed. Deploying is a separate, explicitly authorised step.

1. Confirm the two secrets exist. They were provisioned for the original connectivity
   check, and secrets are **project-wide rather than per-function** — the documentation is
   explicit that "you don't need to re-deploy after setting your secrets; they're
   available immediately in your functions" — so the function deployed in step 2 picks up
   the existing values with no further action.

   ```
   npx supabase secrets list
   ```

   `list` prints names only, never values. Set them only if a name is missing:

   ```
   npx supabase secrets set QF_CLIENT_ID=... QF_CLIENT_SECRET=...
   ```

   They are named in `supabase/functions/quran-content/index.ts` and appear in **no** file
   in this repository — not in `.env`, not in `.env.example`, not in `app.json`, and never
   in an `EXPO_PUBLIC_*` variable, which is inlined into the shipped bundle.

2. Deploy the function from this repository, naming it explicitly:

   ```
   npx supabase functions deploy quran-content
   ```

   **Name the function.** Omitting it deploys every function in `supabase/functions/`,
   which would redeploy `noor-ai` as a side effect of this work. Do not pass `--prune`
   (it deletes functions that exist remotely but not locally) and never pass
   `--no-verify-jwt`.

   This step is what applies `verify_jwt = true`: the configuration reference states that
   the `[functions.<name>] verify_jwt` setting takes effect "when you deploy your Edge
   Functions or serve them locally". It also supersedes the dashboard-created
   `quran-content` — see below.

3. Verify, in this order:
   - an **anonymous** request returns `401` (the gateway refuses it before the handler
     runs, so the body is Supabase's shape and carries no NoorLife `request_id`);
   - an **authenticated** request returns the chapter catalogue;
   - if the credentials were ever unset, an authenticated request returns `503` with an
     error body and **no** `data` field — never content of any kind.

### `supabase config push` is deliberately **not** part of this sequence

It is not what makes `verify_jwt` effective — step 2 is — and it is not scoped to
functions. `config.toml` also declares this project's `[auth]` state, including
`enable_confirmations = false`, `site_url`, `otp_length` and the redirect allow-list, and
pushing it would apply all of that to the linked project as a side effect of deploying a
Qur'an endpoint. Run it only when an auth-configuration change is the intended change, as
`docs/PRE_RELEASE_BACKLOG.md` §1.3 describes.

## Rollback

Safe, and in this order — each step is independent of the ones after it.

| Goal                                  | Command                                                                                     | Result                                                                                                                                                                                                                                              |
| ------------------------------------- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stop serving live content immediately | `npx supabase secrets unset QF_CLIENT_ID QF_CLIENT_SECRET`                                  | The client is built without a credential, so it makes **zero** outbound requests and reports `unconfigured`; the handler answers `503`. Screens show an honest service-error state. No sample scripture is served. Takes effect without a redeploy. |
| Take the endpoint down entirely       | `npx supabase functions delete quran-content`                                               | The client maps `404` to `unavailable`; same honest state. Removes it from the project only — the code stays in this repository.                                                                                                                    |
| Return the app to fixtures            | Revert this feature's DI wiring and ship, or run a build with no `EXPO_PUBLIC_SUPABASE_URL` | `createProductionQuranRepository()` answers `null`, the mock set is used, and every screen's badge reads "not a verified source" again.                                                                                                             |

The first row is the one to reach for: it is a single command, needs no deployment, and
leaves the endpoint in place for diagnosis.

There is no state to migrate back: the function writes nothing, the cache is in memory,
and the only persisted change is the preference migration, which replaces a
fixture-era edition id with a real one and is harmless on either side.

## Rules that must keep holding

- The device never holds a Quran Foundation credential, in any form.
- The vendor hostnames exist only in `supabase/functions/quran-content/`, in exactly two
  modules, pinned by exact-equality source scans.
- No unapproved API is reachable, and the request type has no field a URL could occupy.
- No response body, log line or error message carries an upstream error body, status line
  or credential fragment.
- No Qur'an content is logged anywhere, on either side.

Do not add any other Qur'an data source to this project.

## Contacts

- API documentation: https://api-docs.quran.foundation/
- Developer terms: https://api-docs.quran.foundation/legal/developer-terms/
- Privacy requirements: https://api-docs.quran.foundation/legal/developer-privacy/
