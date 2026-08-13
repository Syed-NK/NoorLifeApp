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

### Where the original evidence is retained

**⚠ TO BE CONFIRMED.** The original written permission is held outside this repository. The
storage location must be recorded here before this document is committed. It must not be a
public location, and the correspondence itself must never enter version control.

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

Only what is safe without the synchronisation mechanism:

- The exact attribution (§4) is displayed wherever resource ID 3 is selected or credited, from a
  single constant in `src/features/faith/data/quran-foundation/recitation-attribution.ts`.
- `attributionForReciter` returns `null` for every id but `3`, so the grant cannot generalise to
  another reciter through a call site.
- `src/features/faith/__tests__/recitation-attribution.test.ts` pins the wording byte for byte,
  asserts the scope from both sides, and fails if the sentence is duplicated as a literal anywhere
  in `src/`.
- No change to retention, no new download behaviour, no Edge Function operation, no deployment.

---

## 9. Content Sync — open question

Quran Foundation has been asked to clarify the mechanism. Recorded because the public
documentation does not answer it:

- There is **no "Content Sync" API** in Quran Foundation's published documentation. The Content API
  lists sixteen categories; none is named sync, and the word does not appear in the quickstart.
- The endpoint that actually serves Sudais ayah audio is `GET /recitations/3/by_chapter/{n}`, which
  is **already in NoorLife's approved allow-list** as the `list_verse_recitations` operation. So
  downloading needs no new scope, no new operation and no redeploy.
- What is unresolved is which mechanism satisfies C7. Re-reading `list_verse_recitations` and
  comparing URLs and durations is a plausible reading, and it is **not** being adopted as an
  interpretation — the brief is explicit that it must not be reinterpreted as Content Sync.

No guessed endpoint has been added. No production request has been made for this purpose.

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
