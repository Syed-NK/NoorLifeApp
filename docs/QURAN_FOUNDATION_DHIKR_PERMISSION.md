# Quran Foundation — Quran-derived Dhikr permission (compliance record)

**Status:** active, no fixed expiry, subject to continued compliance
**Recorded:** 2026-08-15
**Scope of this document:** the compliance facts only. No correspondence is reproduced here.

This record covers the **Quran-derived Dhikr selector**. It is separate from, and does not alter,
[`QURAN_FOUNDATION_AUDIO_PERMISSION.md`](QURAN_FOUNDATION_AUDIO_PERMISSION.md), which covers offline
recitation of resource ID 3. Neither grant extends the other.

---

## 1. The grant

| Field | Value |
|---|---|
| Granted by | Quran Foundation |
| Named grantor | Basit Minhas |
| Instrument | Written confirmation under NoorLife's **existing Content API access and Developer Terms** |
| Date received | **2026-08 — exact date requires owner confirmation** |
| Grantee | NoorLife |
| Subject | A Quran-derived Dhikr selector |
| Expiry | No fixed expiry, subject to continued compliance |

### No new scope was granted, and that is the point

The confirmation is explicit that **no additional API scope, licence, fee, production approval or
periodic report is required.** The feature is permitted under access NoorLife already holds.

Two consequences follow, and both constrain the build:

1. **No new Edge Function operation may be added for this feature.** The approved allow-list in
   `supabase/functions/quran-content/contract.ts` is a closed union, and "no additional scope" means
   the Dhikr selector is served by operations already in it — the same `list_verses` and
   `list_verse_translations` the reader uses.
2. **No production approval step is outstanding.** Nothing about this feature is waiting on Quran
   Foundation. What it *is* waiting on is NoorLife's own scholarly review — see §6, which is a
   different obligation owed to a different party and is **not** satisfied by this grant.

### What this repository may record, and what it may never hold

The same fixed rule as the audio record, restated so neither file has to be read to apply it.

| May be recorded here | May **never** enter version control |
|---|---|
| The date the permission was received | The original email or any message body |
| The sender / named grantor | Personal correspondence of any kind |
| The granted scope | Email headers, routing metadata or addresses |
| A pointer to the private retention location | Attachments, screenshots or exports of the above |
| | Credentials, account identifiers, keys or tokens of any kind |

### Where the original evidence is retained

**⚠ TO BE CONFIRMED.** The original written confirmation is held outside this repository. Two fields
remain outstanding:

1. **Date received** — §1 records `2026-08 — exact date requires owner confirmation`, which is the
   month and an explicit admission that the day is not known here.
2. **Private retention location** — the pointer described above, which must name a private location,
   never a public repository, shared drive link or issue tracker.

Both are left unfilled rather than estimated. A date inferred rather than known would be a fabricated
entry in a compliance record, which is worse than a visible gap.

---

## 2. Authorised feature scope

Exactly what was confirmed, enumerated so the implementation can be checked against it line by line.

| # | Authorised |
|---|---|
| A1 | Curate and retain a **fixed catalogue of Surah/Ayah references**, or appropriate Ayah ranges. |
| A2 | Obtain **Arabic Quran text** through the Quran Foundation Content API. |
| A3 | Obtain **translations** through the Quran Foundation Content API. |
| A4 | Retain **user favorites, selected references, recents, counts and targets indefinitely**. |
| A5 | Retain selected **Arabic** Quran text beyond one week, subject to the conditions in §3. |
| A6 | Retain **translations** beyond one week **only** through supported Content Sync, subject to §4. |

A1 is a permission to retain **references**, not text. The catalogue NoorLife ships is a list of
surah numbers, ayah numbers and its own metadata; the scripture is fetched. See §7.

---

## 3. Arabic retention rule

Selected Arabic Quran text may be retained **beyond one week** when Content Sync is unavailable for
it, provided **all** of the following hold:

| # | Condition |
|---|---|
| R1 | The text **remains unchanged**. |
| R2 | It stays in **private application storage**. |
| R3 | It is used **only inside NoorLife**. |
| R4 | It is **refreshed through the Content API** so that corrections, updates or removals are applied promptly. |

R4 is a *refresh* obligation, not a deletion rule. Retention past a week is permitted; going stale
without ever re-checking is not. A "safe last-known valid copy" is therefore held only within these
conditions — it is what the feature falls back to while offline, not a permanent private mushaf.

---

## 4. Translation Content Sync rule

Translations may be retained beyond one week **only** through supported Content Sync, with:

| # | Condition |
|---|---|
| T1 | A **next sync at least every seven days**. |
| T2 | **All available changes applied.** |

> **Status: NOT IMPLEMENTED, and the one-week limit therefore stands.**
>
> NoorLife has **not** implemented supported Content Sync for translations, and the open question
> recorded in `QURAN_FOUNDATION_AUDIO_PERMISSION.md` §9 — *which published mechanism is Content
> Sync* — is unchanged by this grant. No endpoint has been invented and none may be.
>
> Consequently the existing **one-week ceiling on cached translations remains in force** for this
> feature, exactly as it does for the reader. Extended translation retention is not built, is not
> claimed anywhere in the product, and must not be described as delivered until T1 and T2 both hold
> against a mechanism Quran Foundation has confirmed.
>
> This is a deliberate under-retention. Of the two non-compliant states available, holding a
> translation too briefly fails toward re-fetching the vendor's current text; holding one too long
> fails toward serving a correction the vendor has already made.

---

## 5. User-state retention rule

A4 permits **indefinite** retention of the user's own state: favorites, selected references, recents,
counts and targets.

The load-bearing consequence, and the rule the implementation must satisfy:

> **Content expiry must never delete a user's counter history or their selected reference.**

These are two different kinds of data with two different rules, and the failure mode is a user whose
dhikr count is silently reset because a *translation cache* expired. The catalogue reference is an
id; the count is the user's own record; neither is Quran Foundation content, and neither is subject
to any retention ceiling. Only the Arabic and the translation are.

---

## 6. Scholarly-review obligation

**Scholarly review of curated Dhikr, remembrance and supplication references remains NoorLife's
responsibility.**

Stated separately because it is the condition most easily lost:

> **Quran Foundation's API permission is not scholarly approval.** This grant says NoorLife *may*
> fetch Quran text for such a feature. It says nothing whatever about whether any particular verse is
> appropriate as a dhikr, what count is recommended for it, or what context should accompany it.
> Those are religious judgements, they are NoorLife's to obtain, and no part of this document
> supplies them.

Accordingly: no Quran-derived entry may reach the production selector without an approved scholarly
review recorded against it. At the time of writing **no scholarly-reviewed catalogue has been
supplied**, so the production catalogue contains **zero** entries and the selector states that
Quran-derived selections are awaiting review. That state is honest and is not a defect.

---

## 7. Mandatory requirements

| # | Requirement |
|---|---|
| M1 | **Arabic Quran text remains unchanged.** No normalisation, trimming, re-pointing or substitution. |
| M2 | Ayat and ranges **preserve their original context and meaning**. |
| M3 | The **translator's name appears with every translation**. |
| M4 | The attribution in §8 is displayed. |

### Why the source bundle contains no Arabic

M1 is enforced structurally rather than by review. The curated catalogue stores **references only** —
surah number, start ayah, end ayah — and never scripture. Text that is not in the bundle cannot be
edited in the bundle, cannot drift from the source across a release, and cannot be corrected by a
well-meant tidy-up in a pull request nobody reads closely. The scripture arrives from the Content API
at runtime and is rendered as received.

The same reasoning applies to M2 at the range level: a range is stored as its endpoints and resolved
against the source, so a "range" cannot become a hand-assembled selection of non-adjacent verses.

---

## 8. Required attribution

The following string must be displayed **exactly**, without paraphrase, abbreviation or re-ordering:

```
Quran text and translations provided by Quran Foundation (Quran.com).
```

M3 is separate and additional: the **translator's name** must appear alongside every translation. The
attribution above credits the source; it does not credit the translator, and one does not substitute
for the other.

---

## 9. Prohibited uses

| # | Prohibited |
|---|---|
| P1 | **Resale** of the text or translations. |
| P2 | **Sublicensing.** |
| P3 | **Standalone-file distribution** — no export, share-sheet, "save to files" or copy-out of the retained text. |
| P4 | **Exposure through another API** — no NoorLife endpoint or backend route that serves this content onward. |

P3 and P4 constrain the build rather than the runtime, exactly as the equivalent audio conditions do.
Sharing a *verse* through the platform share sheet — the reader's existing Share action, which sends
text the user is looking at — is a user action on presented content and is not standalone-file
distribution; shipping or emitting the retained cache as a file is.

---

## 10. Material-change re-review

This record is reviewed, and the permission re-confirmed with Quran Foundation before any change
ships, whenever:

- the feature's scope changes materially — additional content types, a different retrieval path, or
  any use outside the selector described here;
- retention changes — in particular, if extended translation retention is implemented under §4, or
  if the Arabic refresh path in §3 is altered;
- content is exposed outside NoorLife in any form;
- the curated catalogue moves from references to stored text;
- Quran Foundation's Developer Terms are revised; or
- the Content Sync mechanism relied upon for §4 is confirmed or changes.

Adding a scholarly-reviewed entry to the catalogue is **not** a material change under this section —
it is the feature working as authorised. It does require §6 to be satisfied for that entry.

---

## 11. What this permission does not resolve

- **The Sudais audio synchronisation question.** Explicitly out of scope of this confirmation.
  `QURAN_FOUNDATION_AUDIO_PERMISSION.md` §8 and §9 are unchanged, the hard seven-day audio ceiling
  stays, and extended audio retention remains not implemented.
- **Scholarly review.** See §6.
- **Content Sync for translations.** See §4.
