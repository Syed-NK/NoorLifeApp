# Quran Foundation — offline recitation permission (compliance record)

**Status:** active, no fixed expiry, subject to continued compliance
**Recorded:** 2026-08-12
**Scope of this document:** the compliance facts only. No correspondence is reproduced here.

---

## 1. The grant

| Field | Value |
|---|---|
| Granted by | Quran Foundation |
| Named grantor | Basit Minhas |
| Instrument | Written permission under **Developer Terms § 3.1(3)(a)** |
| Date received | **⚠ TO BE CONFIRMED** — on or before 2026-08-12 |
| Grantee | NoorLife |
| Reciter | Abdur-Rahman as-Sudais |
| **Resource ID** | **3** |
| Platforms | Android and iOS |
| Permitted use | Quran listening **inside NoorLife only** |
| Retention | Longer than one week |
| Expiry | No fixed expiry, subject to continued compliance |

### What this repository may record, and what it may never hold

Fixed rule, so the boundary is not re-decided each time this file is edited.

| May be recorded here | May **never** enter version control |
|---|---|
| The date the permission was received | The original email or any message body |
| The sender / named grantor | Personal correspondence of any kind |
| The granted scope (reciter, resource id, platforms, permitted use, retention) | Email headers, routing metadata or addresses |
| A pointer to the private retention location | Attachments, screenshots or exports of the above |

The pointer must name a **private** location — never a public repository, shared drive link, issue
tracker or anything reachable without authorisation.

### Where the original evidence is retained

**⚠ TO BE CONFIRMED.** The original written permission is held outside this repository. Two fields
in this record remain outstanding and are the last items blocking it:

1. **Date received** — §1 currently reads "on or before 2026-08-12", which is a bound rather than
   the fact.
2. **Private retention location** — the pointer described above.

Both were requested on 2026-08-14 and the supplied values were placeholders, so neither has been
filled in. They are deliberately left as `⚠ TO BE CONFIRMED` rather than estimated: a date or a
location inferred rather than known would be a fabricated entry in a compliance record, which is
worse than a visible gap. The implementation itself complies; this is an evidentiary gap only.

---

## 2. Permitted offline uses

1. Bundle the complete recitation with the application.
2. Download the complete recitation after installation.
3. Download selected surahs.
4. Retain permitted downloads offline **beyond one week**.

**NoorLife's chosen approach: post-install download.** Quran Foundation recommends downloading
after installation rather than bundling, and NoorLife adopts that recommendation. Nothing is
downloaded without an explicit user choice.

---

## 3. Mandatory conditions

| # | Condition |
|---|---|
| C1 | Audio must remain in **private application storage**. Never Downloads, Music, or any shared media store. |
| C2 | Use for **in-app listening only**. |
| C3 | Do not sell, sublicense, export, share, expose through an API, or make available as standalone files. |
| C4 | Preserve recitation integrity — no re-encoding, editing, or truncation of the recitation itself. |
| C5 | Users must be able to **delete** downloaded audio. |
| C6 | Display the required attribution (§4) wherever this recitation is presented. |
| C7 | Check Content Sync changes **at least every seven connected days**. |
| C8 | Apply corrections, updates or removals **promptly**. |
| C9 | If offline beyond seven days, **keep permitted audio available** and synchronise at the next opportunity. |
| C10 | Continue complying with Quran Foundation's Developer Terms and other applicable requirements. |

### C7 and C9 are not a deletion rule

This distinction governs the implementation and is recorded because it is easy to get wrong.

- **C7 is a *check* obligation** — every seven connected days, ask whether the content changed.
- **C9 is an explicit *availability* guarantee** — audio stays playable while the device is offline
  past that window.

Neither condition requires deleting audio after seven days. A hard seven-day expiry would in fact
**violate C9**, because it would remove audio from a user who has simply been offline.

> **Known divergence, as of 2026-08-12.** NoorLife's audio layer currently enforces a hard
> seven-day ceiling (`MAX_CACHE_AGE_MS`, `src/features/faith/data/quran-foundation/quran-foundation.contract.ts`)
> inherited from the general content-caching licence. For resource ID 3 that ceiling is now
> stricter than the grant requires and conflicts with C9. See §8 for the agreed policy and the
> order of work.

---

## 8. Retention policy — current behaviour and the agreed future state

### 8.1 What ships today, and the user impact

> **Reconciled 2026-08-16.** This section described the ceiling on resource ID 3 as though the
> licence required it. It does not, and never did. **The permission in §1 is granted, written and
> unconditional**: resource ID 3 may be retained beyond one week. The seven-day expiry on Sudais audio
> is **NoorLife's own conservative choice**, taken while no synchronisation mechanism existed, and it
> is a self-imposed restriction rather than a licence obligation. Nothing below may be read as "the
> vendor requires this to expire". What follows describes the **current mobile behaviour**, which is
> now the thing that is wrong.

**Current mobile behaviour: the seven-day read-time expiry is still applied to every reciter,
including resource ID 3.**

Concretely, for a user who has downloaded a surah of Sudais recitation:

| Elapsed since download | Behaviour today |
|---|---|
| 0–7 days | Plays from local storage, offline. |
| 7 days onward | The file is **not served**. `stateFor` reports `expired`, the download screen offers "Download again", and playback falls back to streaming — which fails if the device is offline. |

So a user who downloads a surah and goes offline for eight days loses access to audio NoorLife has
written permission to retain. That is the divergence from condition C9, and it is a real
user-visible regression relative to the grant — not a theoretical one.

It is being left in place deliberately. Removing the expiry without a synchronisation mechanism
would satisfy C9 while breaking C7 and C8: audio would be retained indefinitely with no means of
noticing a correction, an update or a removal upstream. Of the two non-compliant states, retaining
too little is the safer one, because it fails toward the vendor's content being re-fetched rather
than toward a stale copy persisting unchecked.

### 8.2 The agreed future state

Resource ID 3 becomes exempt from destructive seven-day read-time expiry **only when connected
synchronisation is implemented** — that is, when all of the following hold:

1. The Content Sync mechanism is confirmed by Quran Foundation (see §9).
2. A connected check runs at least every seven connected days (C7).
3. Corrections, updates and removals are applied promptly when that check reports them (C8).
4. Audio remains available while the device is offline past that window (C9).

Until every one of those holds, the ceiling stays.

**Where each condition stands, 2026-08-16:**

| | Condition | Status |
|---|---|---|
| 1 | Content Sync confirmed | **Met.** Documented, published, implemented server-side and live-verified — §9.4. |
| 2 | Connected check every seven connected days | **Not met — not built.** The server operation and the device's checkpoint store both exist; no code path runs the check. See §8.5. |
| 3 | Corrections applied promptly | **Not met, and partly unresolved.** No recitation mutation has been observed on the feed; the only demonstrated correction path for audio is snapshot comparison. See §8.4. |
| 4 | Available offline past the window | **Not met.** The mobile expiry still deletes access at seven days. |

So the ceiling stays for now — but for a **different and narrower reason** than when this section was
written. The blocker is no longer "there is no mechanism". The mechanism exists and is verified. The
blocker is that the device does not yet use it.

**Every other resource retains its existing applicable policy.** The seven-day ceiling is the
general content-caching rule and is not lifted for any other reciter, any other audio, or any other
content type. The exemption, when it arrives, is keyed on the resource id.

### 8.3 What is implemented now

> **Status of the extended-retention feature: NOT IMPLEMENTED ON THE DEVICE.**
>
> The permission to retain resource ID 3 offline beyond one week has been **granted** and is **not
> built into the app**. The server side is built and verified; the mobile side is not. Nothing in this
> repository may describe the feature as delivered, available, shipped or complete until every
> condition in §8.2 holds. Stated plainly so the distinction cannot be lost:
>
> | | Position |
> |---|---|
> | What Quran Foundation permits | Resource ID 3 may remain available offline **beyond seven days** |
> | What NoorLife ships today | A **hard seven-day read-time expiry** on resource ID 3, the same as every other reciter — NoorLife's own choice, not a licence requirement |
> | What C7 requires of a connected device | Check for corrections, updates or removals **at least every seven connected days** |
> | What C9 requires of an offline device | Keep permitted audio **available** past that window, and synchronise at the next opportunity |
> | Why the ceiling stays | **Corrected 2026-08-16.** No longer "there is no mechanism" — there is one, and it is verified. The device does not yet run it, and one interpretation question is open (§8.4). |
>
> The user-visible consequence is unchanged and is stated in §8.1: a user who downloads a surah and
> goes offline for eight days loses audio NoorLife has written permission to retain. That is a real
> regression against the grant, accepted deliberately, and it is the gap this section exists to keep
> visible.

Only what is safe without the synchronisation mechanism:

- The exact attribution (§4) is displayed wherever resource ID 3 is selected or credited, from a
  single constant in `src/features/faith/data/quran-foundation/recitation-attribution.ts`.
- `attributionForReciter` returns `null` for every id but `3`, so the grant cannot generalise to
  another reciter through a call site.
- `src/features/faith/__tests__/recitation-attribution.test.ts` pins the wording byte for byte,
  asserts the scope from both sides, and fails if the sentence is duplicated as a literal anywhere
  in `src/`.
- No change to retention, no new download behaviour, no Edge Function operation, no deployment.

> **Superseded 2026-08-16.** The paragraph that stood here said *"No Content Sync endpoint has been
> invented, and none may be. Quran Foundation's published documentation contains no such API (§9)."*
> That was written against the research failure recorded in §9.1 and is **factually wrong**. Content
> Sync is documented, published, implemented behind the approved allow-list, and live-verified in
> §9.4. It is retained here only as the record of what was believed.

The rule the superseded paragraph was protecting is still in force, restated correctly: **no endpoint
may be guessed.** The allow-list in `supabase/functions/quran-content/contract.ts` is a closed union;
`sync_content_resources` and `get_content_snapshot` were added from the vendor's own versioned
documentation, not inferred, and `list_verse_recitations` must never be reinterpreted as a
synchronisation mechanism.

### 8.4 The one assumption that needs Quran Foundation's confirmation

**Stated here rather than made silently, because it is a licence interpretation and not an
engineering choice.**

C8 requires corrections, updates and removals to be applied promptly. For **translations:85** the
mechanism is demonstrated: the feed emits `RESOURCE_CREATE`, and NoorLife replaces the resource.

For **recitations:3** it is not. Across every verification run the bootstrap has returned **only** the
translation mutation; **no recitation mutation has ever been observed on the sync feed**, and none may
be described as observed. The recitation *snapshot* is live-verified — HTTP 200, resource 3, all 6,236
rows — so the only correction mechanism NoorLife can actually demonstrate for audio is:

> **Assumption A1.** Periodically re-fetching the `recitations:3` snapshot and comparing it against
> the local manifest — row set, record keys and sequences — constitutes the C8 correction-and-removal
> mechanism for audio, in the absence of recitation mutations on the change feed.

If A1 is how Quran Foundation intends recitation corrections to reach clients, NoorLife's connected
check for audio is a snapshot comparison rather than a mutation stream, and C7/C8 are satisfiable
today. If it is not — if recitation mutations are expected on the feed and their absence is a defect
or a not-yet-enabled resource — then NoorLife needs to know that instead, because the connected check
would have to wait for them.

**Two questions for Quran Foundation:**

1. Does Content Sync emit mutations for `recitations` resources, and specifically for resource 3? If
   so, under what circumstances — is a bootstrap expected to announce the resource, or do mutations
   appear only when the recitation changes?
2. Is A1 an acceptable C7/C8 mechanism for audio in the meantime?

Until one of those is answered, **A1 is an assumption on the record and not a position NoorLife has
adopted.** No extended-retention behaviour may ship that depends on it without saying so.

### 8.5 What this means for the seven-day expiry, precisely

Three statements that must not be collapsed into each other:

| | |
|---|---|
| **The permission** | Granted, written, unconditional. Resource ID 3 may be retained beyond one week. Not in doubt and never was. |
| **The obligation** | C7 requires a connected device to check at least every seven **connected** days. It is a check obligation. It has never been a deletion rule, and an offline device is expressly permitted to keep permitted audio and synchronise at its next opportunity (C9). |
| **The current code** | Deletes access to Sudais audio seven days after **download**, regardless of connectivity and regardless of whether a check was possible. |

The third is wrong on its own terms. It measures the wrong clock — *download age* rather than *time
since the last successful connected check* — so it penalises exactly the user C9 protects: the one who
is offline. Correcting it means keeping the two timestamps apart, which
`src/features/faith/storage/faith-sync-checkpoint.ts` (`lastSyncedAt`) and
`src/features/faith/storage/faith-audio-manifest.ts` (`downloadedAt`, `lastSyncedAt`, and the
`stale-check-due` state that stays playable) were both built to do — and which the shipping download
path does not yet use.

---

## 9. Content Sync — resolved

**Corrected 2026-08-15. Everything under "9.1 Superseded conclusion" below was wrong.**

Content Sync is a documented, published part of the Quran Foundation Content API. It was not found
because the search that produced §9.1 looked in the Content API endpoint categories and the
quickstart, and Content Sync is documented as its own tutorial and its own pair of versioned
endpoints. That is a research failure, not a vendor gap.

### 9.1 Superseded conclusion — retained as the record of what was believed, not as fact

> There is **no "Content Sync" API** in Quran Foundation's published documentation. The Content API
> lists sixteen categories; none is named sync, and the word does not appear in the quickstart.
>
> What is unresolved is which mechanism satisfies C7. Re-reading `list_verse_recitations` and
> comparing URLs and durations is a plausible reading, and it is **not** being adopted as an
> interpretation.

**Every sentence in that block is superseded.** The one claim that survives is the narrow one, and
it is still true: `GET /recitations/3/by_chapter/{n}` is already allow-listed as
`list_verse_recitations`, so *downloading* audio needs no new scope. Synchronising it does.

### 9.2 The actual mechanism

| | |
|---|---|
| Origin | `https://apis.quran.foundation/content` |
| Sync | `GET /api/v4/resources/sync` |
| Snapshot | `GET /content/api/v4/resources/snapshots/{resource_group}/{resource_id}` |
| Supported groups | `translations`, `tafsirs`, `recitations`, `articles` |
| Auth | `x-auth-token` and `x-client-id`, server-side only |

Sync parameters: `bootstrap`, `sync_token`, `resources` (canonical filter, semicolon-separated,
e.g. `translations:19;tafsirs:151`), `per_page` (max 100), `cursor`.

Response envelope, field names verbatim:

```
sync.sync_until_sequence   sync.has_more   sync.next_page_url   sync.next_sync_token
sync.mutations[] = { sequence, type, resource_group, resource_id, record_type, record_key,
                     changed_at, data, snapshot_url, unavailable_reason }
```

Mutation types: `RESOURCE_CREATE`, `RESOURCE_UPDATE`, `RESOURCE_INVALIDATE`, `RESOURCE_DELETE`,
`ROW_CREATE`, `ROW_UPDATE`, `ROW_DELETE`.

Client rules taken from the vendor's own flow document, not inferred:

- Bootstrap is a call with no token. Paginate with `next_page_url` while `has_more` is true —
  *"Do not build the cursor yourself."*
- `next_sync_token` appears only on the final page, and may be persisted **only after that page has
  been processed**. Each token is bound to its canonical filter.
- A rejected or stale token is recovered by bootstrapping again: *"If token recovery fails,
  bootstrap again."*
- `RESOURCE_CREATE` / `RESOURCE_INVALIDATE` → fetch the snapshot and replace all local rows.
  `RESOURCE_UPDATE` is *"a freshness marker only"*. `RESOURCE_DELETE` removes the resource.
  `ROW_CREATE` inserts or replaces, `ROW_UPDATE` replaces, `ROW_DELETE` deletes.

### 9.3 What remains genuinely unverified

The documentation does **not** state whether a `recitations` resource id in Content Sync is an
**ayah-recitation** id or a **chapter-reciter** id. NoorLife's Sudais grant names resource ID 3 in
the ayah-recitation space — confirmed against `/resources/recitations`, which returns
`id 3 = Abdur-Rahman as-Sudais`, the same id space `/recitations/{id}/by_chapter/{n}` takes.

Whether `recitations:3` in a canonical filter selects that same resource is **not assumed**. It is
resolved by the first bootstrap through NoorLife's own function, by checking that the returned
`resource_group` is `recitations`, the `resource_id` is 3, and the rows carry ayah identity. Until
that check has run against the live API, no claim is made either way, and the extended-retention
exemption in §8.2 stays unmet.

No endpoint has been guessed. The two paths above are quoted from the vendor's versioned
documentation.

### 9.4 Live verification — recorded 2026-08-16

Authenticated runs against the deployed `quran-content` function, project `dxchgpshydsgfvyydyeb`. No
secret, credential, header, URL, cursor, token, verse, translation text or audio address was printed
by any run, and none is recorded here.

| Check | Result |
|---|---|
| Content Sync bootstrap | **HTTP 200**, final sync token present |
| Bootstrap mutations returned | `resource_group=translations`, `mutation_type=RESOURCE_CREATE` — **and nothing for `recitations`** |
| `recitations` snapshot | **HTTP 200**, `resource_group=recitations`, `resource_id=3`, **6,236 rows** |
| `translations` snapshot | **HTTP 200**, `resource_group=translations`, `resource_id=85`, **6,236 rows** |
| Client attempting to override the approved scope | **HTTP 400 `invalid_request`** |
| Request for an unapproved snapshot resource | **HTTP 400 `invalid_request`** |

6,236 is the complete ayah count of the Qur'an, so **both approved snapshots returned all 6,236 ayat**
and each row carried ayah identity through NoorLife's normaliser unchanged.

**What this settles.** The §9.3 identifier question is answered for the *snapshot* route:
`recitations:3` addresses the ayah-recitation resource — the same `id 3 = Abdur-Rahman as-Sudais`
that `/recitations/{id}/by_chapter/{n}` takes — and it returns a complete, ayah-identified body.

**What this does not settle, stated plainly.** The bootstrap returned **only** the translation
`RESOURCE_CREATE`. **No recitation mutation was observed on the sync feed**, and none may be
described as observed. NoorLife's side is proven correct in both directions — the outbound canonical
filter carries `recitations:3;translations:85` onto the wire, and the normaliser keeps both documented
`RESOURCE_CREATE` mutations when both are present — so the absence is vendor-side. It is either a
resource Content Sync does not yet emit, or one that arrives on a later incremental run. **This is an
open question for Quran Foundation.**

Because the recitation resource has not been seen to move through the sync feed, the extended-retention
exemption in §8.2 **stays unmet**. A complete snapshot is not the same fact as a working change feed,
and retention beyond one week depends on the second.

### 9.5 The read bounds this required

Both snapshots exceed the function's original 1 MiB response bound. Measured by a temporary,
since-removed diagnostic and then fixed with a route-specific limit:

| Scope | Bound |
|---|---|
| Every ordinary Content API operation, and `/resources/sync` | **1 MiB** (`MAX_RESPONSE_BYTES`, unchanged) |
| Approved snapshots only (`/resources/snapshots/{group}/{id}`) | **8 MiB** (`MAX_SNAPSHOT_RESPONSE_BYTES`) |

8 MiB is the upper edge of the larger measured band and carries no added margin. The only surviving
diagnostic is `upstream_reason`, a closed enum of branch names in the operational log — it can carry
no byte count, status code, resource id, URL, token or payload fragment. No size-band field, no 32 MiB
measurement path and no exact-size logging remains anywhere in the function.

---

## 4. Required attribution

The following string must be displayed **exactly**, without paraphrase, abbreviation or
re-ordering:

```
Recitation by Abdur-Rahman as-Sudais. Audio provided by Quran Foundation (Quran.com).
```

---

## 5. Scope limit

**This extended-retention permission applies only to resource ID 3.**

It must not be extended to any other reciter, any other resource ID, or any other Quran Foundation
content type. Every other reciter remains under the ordinary Developer Terms, including the
standard caching ceiling.

---

## 6. Distribution and export restrictions

Derived from C1–C3, stated separately because they constrain the build rather than the runtime:

- No Quran audio in any shared, user-visible, or OS-indexed storage location.
- No export, share-sheet, "save to files", or copy-out affordance for downloaded audio.
- No NoorLife API, endpoint, or backend route that serves this audio onward.
- No inclusion of the audio in backups that leave the device's private app container where the
  platform allows that to be controlled.

---

## 7. Review

This record is reviewed whenever:

- the reciter default changes,
- an additional reciter is proposed for offline retention,
- Quran Foundation's Developer Terms are revised, or
- the Content Sync mechanism relied upon for C7 changes.
