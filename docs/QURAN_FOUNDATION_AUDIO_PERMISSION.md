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

**Unchanged. The seven-day read-time expiry remains in force for every reciter, including resource
ID 3.**

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

**Every other resource retains its existing applicable policy.** The seven-day ceiling is the
general content-caching rule and is not lifted for any other reciter, any other audio, or any other
content type. The exemption, when it arrives, is keyed on the resource id.

### 8.3 What is implemented now

> **Status of the extended-retention feature: NOT IMPLEMENTED.**
>
> The permission to retain resource ID 3 offline beyond one week has been **granted** and is **not
> built**. Nothing in this repository may describe it as delivered, available, shipped or complete
> until every condition in §8.2 holds. Stated plainly so the distinction cannot be lost:
>
> | | Position |
> |---|---|
> | What Quran Foundation permits | Resource ID 3 may remain available offline **beyond seven days** |
> | What NoorLife ships today | A **hard seven-day read-time expiry** on resource ID 3, the same as every other reciter |
> | What C7 requires of a connected device | Check for corrections, updates or removals **at least every seven connected days** |
> | What C9 requires of an offline device | Keep permitted audio **available** past that window, and synchronise at the next opportunity |
> | Why the ceiling stays | There is no synchronisation mechanism, so lifting it would satisfy C9 by breaking C7 and C8 |
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

**No Content Sync endpoint has been invented, and none may be.** Quran Foundation's published
documentation contains no such API (§9), and NoorLife's approval covers the Content API only. The
approved allow-list in `supabase/functions/quran-content/contract.ts` is a closed union of eight
operations; satisfying C7 must not be attempted by adding a ninth, by guessing a route, or by
reinterpreting `list_verse_recitations` as a synchronisation mechanism. The mechanism has to be
confirmed by the vendor first — see §9, which remains open.

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
