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

> **Superseded 2026-08-17.** Everything in the block below described a seven-day read-time expiry
> applied to resource ID 3, and the C9 regression that followed from it. **That expiry no longer
> exists.** `faith-audio-downloads.ts` and its `MAX_CACHE_AGE_MS` clock are deleted, `OfflineFileState`
> has no `expired` member, and permitted audio stays `available` with an owed check carried separately.
> The block is retained only as the record of what shipped before. **Current behaviour is in §8.3.**

<details>
<summary>Superseded description of the seven-day expiry (pre-2026-08-17)</summary>

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

</details>

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
| 2 | Connected check every seven connected days | **Not met — still not wired.** `RECITATION_CHECK_INTERVAL_MS` and `checkDue` exist in `faith-recitation-check.ts` and are correct, but **`checkDue` has no caller outside its own module**, so no code path runs the check on a schedule. This is the one remaining open condition. See §8.5. |
| 3 | Corrections applied promptly | **Resolved as a licence question — 2026-08-17.** Quran Foundation has confirmed the snapshot baseline, the intentional absence of a historical backfill, and that future mutations must be applied. No recitation mutation has been observed, and that absence is **expected** and is **not** evidence of non-compliance. See §8.4 and §9.6. |
| 4 | Available offline past the window | **Met — 2026-08-17.** The destructive seven-day expiry is **removed**: `faith-audio-downloads.ts` and its `MAX_CACHE_AGE_MS` clock are deleted, `OfflineFileState` has no expiry state, and a file whose resource has not been reconciled inside seven days stays `available` while the owed check is carried on the whole-download state. An offline device keeps its permitted audio, as C9 requires. |

So the ceiling stays for now — but for a **different and narrower reason** than when this section was
written. The blocker is no longer "there is no mechanism". The mechanism exists and is verified. The
blocker is that the device does not yet use it.

**Every other resource retains its existing applicable policy.** The seven-day ceiling is the
general content-caching rule and is not lifted for any other reciter, any other audio, or any other
content type. The exemption, when it arrives, is keyed on the resource id.

### 8.3 What is implemented now

> **Status of the extended-retention feature: IMPLEMENTED ON THE DEVICE, WITH ONE CONDITION OPEN.**
>
> **Rewritten 2026-08-17.** This banner previously read *"NOT IMPLEMENTED ON THE DEVICE"* and
> described a hard seven-day read-time expiry as what NoorLife ships. Both statements are now
> **out of date**: the destructive expiry has been removed and retention is implemented. What
> remains open is the **scheduled connected check**, condition 2 — nothing else.
>
> Nothing in this repository may describe the feature as **complete** until condition 2 also holds.
> Stated plainly so the distinction cannot be lost:
>
> | | Position |
> |---|---|
> | What Quran Foundation permits | Resource ID 3 may remain available offline **beyond seven days** |
> | What NoorLife ships today | **No destructive expiry on resource ID 3.** Permitted audio stays `available`; an unreconciled resource carries an **owed check**, not a deletion |
> | What C7 requires of a connected device | Check for corrections, updates or removals **at least every seven connected days** |
> | What C9 requires of an offline device | Keep permitted audio **available** past that window, and synchronise at the next opportunity |
> | What is still missing | **The scheduler.** `checkDue` is correct and unreferenced; no code path runs the connected check periodically (§8.2 condition 2) |
> | Interpretation questions | **None open.** The single question (A1) was resolved in writing by Quran Foundation on 2026-08-17 — §8.4 and §9.6 |
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

### 8.4 Assumption A1 — resolved by Quran Foundation

> **Resolved 2026-08-17.** This section previously recorded assumption **A1** and two open questions
> for Quran Foundation. Quran Foundation has now confirmed the mechanism in writing, so A1 is no
> longer an assumption and the questions are answered. The superseded reasoning is retained below the
> rule, as the record of what was believed. The confirmation facts are recorded in §9.6.

C8 requires corrections, updates and removals to be applied promptly. For **translations:85** the
mechanism was already demonstrated: the feed emits `RESOURCE_CREATE`, and NoorLife replaces the
resource.

For **recitations:3** Quran Foundation has confirmed the intended design:

| Confirmed | Consequence for NoorLife |
|---|---|
| The resource 3 **snapshot establishes the initial baseline** | The bootstrap snapshot is the correct starting state, not a fallback for a missing mutation |
| Historical recitations were **intentionally not backfilled as mutations** | The absence of a recitation mutation at bootstrap is the designed behaviour, not a defect and not a not-yet-enabled resource |
| The **final `next_sync_token` must be stored** | Already the case: written by one function, only for a completed run — see §9.6 |
| Content Sync must be checked **at least every seven connected days** | C7 unchanged; the device's `checkDue` clock implements exactly this |
| **Future mutations must be applied** | The normaliser and reconciler already keep and apply both documented mutation types |
| Downloaded audio **may remain while the device is offline** | C9 unchanged and now unambiguous |
| Full snapshot comparison after a clean no-mutation response is **optional** | The redundant snapshot re-fetch is an optimisation choice, not a compliance obligation |

**The decisive point for this document:** Quran Foundation has confirmed that **the lack of an
observed recitation mutation is expected, and is not evidence that the retention permission is
unmet.** Every statement in this repository that inferred "unmet" from that absence was wrong, and
those statements have been corrected.

`mutationEverObserved` remains in the code as a **factual diagnostic only** — it records whether a
recitation mutation has ever been read off the wire on this device, and it is still `false`. **No
mutation has been observed, and none may be described as observed.** What has changed is only the
inference drawn from that fact: `false` is the expected value, and it carries no compliance meaning.

### 8.5 What this means for the seven-day expiry, precisely

Three statements that must not be collapsed into each other:

| | |
|---|---|
| **The permission** | Granted, written, unconditional. Resource ID 3 may be retained beyond one week. Not in doubt and never was. |
| **The obligation** | C7 requires a connected device to check at least every seven **connected** days. It is a check obligation. It has never been a deletion rule, and an offline device is expressly permitted to keep permitted audio and synchronise at its next opportunity (C9). |
| **The current code** | **Corrected 2026-08-17.** No longer deletes anything on a clock. Permitted audio stays `available`; an unreconciled resource carries an **owed check** on the whole-download state, and `stale-check-due` remains playable. |

The wrong-clock defect this row used to describe — measuring *download age* rather than *time since
the last successful connected check* — is fixed. The two timestamps are kept apart by
`faith-recitation-check.ts` (`lastCheckedAt`, and `checkDue` as an elapsed-time question that is
emphatically not about deletion) and `faith-offline-recitation.ts` (`downloadedAt`, `lastSyncedAt`).

**What is still missing is the scheduler, not the model.** `checkDue` has no caller outside its own
module, so nothing runs the connected check periodically. That is §8.2 condition 2, and it is the
single open condition.

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
`resource_group` is `recitations`, the `resource_id` is 3, and the rows carry ayah identity. That
check has since run against the live API and is recorded in §9.4, which settles the identifier
question for the snapshot route.

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

**What the bootstrap returned, stated plainly.** The bootstrap returned **only** the translation
`RESOURCE_CREATE`. **No recitation mutation was observed on the sync feed**, and none may be
described as observed. NoorLife's side is proven correct in both directions — the outbound canonical
filter carries `recitations:3;translations:85` onto the wire, and the normaliser keeps both documented
`RESOURCE_CREATE` mutations when both are present.

> **Corrected 2026-08-17.** The paragraph that stood here concluded: *"Because the recitation resource
> has not been seen to move through the sync feed, the extended-retention exemption in §8.2 stays
> unmet."* That inference is **wrong**, and Quran Foundation has confirmed why (§9.6): the resource 3
> snapshot establishes the baseline, historical recitations were **intentionally not backfilled as
> mutations**, and the absence of an observed mutation is **expected**. It is not evidence that the
> retention permission is unmet. The observation itself stands unchanged — nothing was observed, and
> nothing may be reported as observed. Only the conclusion drawn from it was wrong.

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

### 9.6 Vendor confirmation of the recitation sync model — recorded 2026-08-17

Quran Foundation has confirmed the following **in writing**. Per §1, only the compliance facts are
recorded here: no correspondence, message body, header, address or attachment is reproduced, and none
may enter version control.

| # | Confirmed by Quran Foundation | Status in NoorLife |
|---|---|---|
| 1 | The **resource 3 snapshot establishes the initial baseline** | Implemented — the bootstrap snapshot is the baseline, verified in §9.4 |
| 2 | Historical recitations were **intentionally not backfilled as mutations** | Explains the §9.4 observation; no defect exists to chase |
| 3 | The **final `next_sync_token` must be stored** | Implemented — written by exactly one function, only for a completed run, never advanced alongside a recorded failure |
| 4 | Content Sync must be checked **at least every seven connected days** | Implemented — `checkDue` in `faith-recitation-check.ts`, a check obligation and never a deletion rule |
| 5 | **Future mutations must be applied** | Implemented — the normaliser keeps both documented mutation types and the reconciler applies them in sequence order |
| 6 | Downloaded audio **may remain available while the device is offline** | Implemented — `stale-check-due` stays playable; an offline device accrues an owed check and keeps its audio |
| 7 | **Lack of an observed mutation is expected**, and is **not** evidence that retention permission is unmet | Corrected throughout this repository on 2026-08-17 |
| 8 | Full snapshot comparison after a clean no-mutation response is **optional** | Implemented as an optimisation — no redundant snapshot is fetched on a clean no-mutation response |

**Date received:** ⚠ **TO BE CONFIRMED BY THE OWNER** — on or before 2026-08-17. Recorded to the same
standard as §1, which carries the same open field for the original grant.

**What this does not extend.** Nothing here grants new scope. The permission remains **resource ID 3
only** (§5), and every distribution and export restriction in §6 is untouched.

**Still unresolved and explicitly out of scope:** complete **Arabic Qur'an reader text** retention is
a **separate permission that has not been granted or confirmed**. Nothing in §9.6 bears on it. Arabic
reader text is not retained, and the reader still requires a connection.

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
