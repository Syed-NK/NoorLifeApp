# Qur'an Dua candidate pack — for scholarly review

> ## ⚠ STATUS: INCOMPLETE — NOT YET SENDABLE TO A REVIEWER
>
> This pack is built for **24 Qur'an candidates**. Every fixed part of it is finished: the field
> definitions, the ID scheme, the category-coverage statement, the transfer checklist, and 24 numbered
> candidate slots.
>
> **The 24 references themselves are absent.** They were not supplied to the engineering side, and
> NoorLife has deliberately not chosen them — see [§2](#2-why-the-references-are-blank). Every
> `Reference`, `Proposed category` and `Working title` cell below is empty and marked `— AWAITING —`.
>
> Do not send this document to a reviewer until those cells are filled by whoever owns the proposal.

**Every record in this pack has status `candidate`.** Nothing here is approved, verified, authentic,
popular or recommended, and nothing here can appear in the app. See
[§7](#7-this-document-cannot-publish-anything).

Companion documents: [`DUA_SCHOLARLY_REVIEW_TEMPLATE.md`](./DUA_SCHOLARLY_REVIEW_TEMPLATE.md) — the
per-candidate decision form the reviewer fills in; [`REVIEWED_QURAN_DUA_MANIFEST.md`](./REVIEWED_QURAN_DUA_MANIFEST.md)
— the production contract an approval eventually crosses into.

---

## 1. What the reviewer is being asked for

For each of the 24 candidates: the nine decisions set out in the review template. In short — is this
passage appropriate to present as a Dua or remembrance; under which category; with what displayed
context; where does the reference begin and end; is the meaning preserved at those endpoints; any
repetition guidance and on what basis; any Popular designation; any cautions; and the dated decision
with a named reviewer, a citable basis and a record id.

Two things the reviewer is **not** asked to do: verify the Arabic, or verify the translation. Both are
fetched from Quran Foundation's Content API at render time and are never copied into this repository, so
their accuracy is the publisher's and this app cannot alter them.

## 2. Why the references are blank

NoorLife has not proposed any Qur'an references and will not do so unprompted. Choosing which passages
to place in front of a scholar is itself an editorial religious act: the reviewer would be ruling on
whoever compiled the list, while believing they were ruling on the product owner's proposal, and their
approvals would then flow through the manifest gate into the app carrying their name.

Five source-less dhikr presets once shipped in this app and had to be removed. A developer choosing
verses from memory is exactly how they got there.

So the 24 references must come from the product owner. The minimum needed per row is the **reference**
(or contiguous range) and the **proposed category or categories**; a working title is welcome but
optional, and everything else in this pack is generated.

## 3. Fixed properties — identical for all 24

These are settled and need no reviewer decision:

| Property | Value |
| --- | --- |
| Source kind | Qur'an |
| Arabic source | Quran Foundation, `text_uthmani` |
| Proposed translation preview resource | `85` |
| Provider | `quran-foundation` |
| Status | `candidate` |
| Arabic in this repository | none — resolved at render time, never copied |
| Translation text in this repository | none — same |

### The candidate ID scheme

`quran.dua.candidate.001` through `quran.dua.candidate.024`, assigned by row position and stable
thereafter. Two properties matter:

- **It never begins `q.`** That prefix is the user's own personal-selection namespace, and the manifest
  parser rejects a reviewed id that begins with it — the two id spaces have to stay disjoint because one
  detail route serves both.
- **It survives a re-ordering of this document.** Once assigned, an ID stays with its reference even if
  the rows move, because the review record the scholar signs is keyed on it.

## 4. Category coverage

Coverage cannot be finalised until the references arrive. What is already known:

| Presentation category | Qur'an candidates in this pack |
| --- | --- |
| Daily Remembrances | — awaiting — |
| Morning & Evening | — awaiting — |
| **Food & Drink** | **none.** See below. |
| Travel | — awaiting — |
| Home & Family | — awaiting — |
| Joy & Distress | — awaiting — |
| Essential Duas | — awaiting — |
| Adhkar | — awaiting — |
| My Quran Selections | **not applicable** — holds the user's own saved references only |
| Favorites | **not applicable** — same |

### Food & Drink has no Qur'an candidate in this pack

Stated so the reviewer does not look for one and does not infer an omission. The category exists on the
grid, it is discoverable, and it currently shows the honest empty state saying reviewed content is not
available for it. Filling it would require either a Qur'an passage a reviewer judges appropriate for
eating and drinking, or Hadith-derived content — which is blocked; see §5.

### Duplicate category proposals are preserved, not resolved

Where a candidate is proposed under more than one category, **both proposals stay on the row** and the
reviewer decides which apply. Engineering does not narrow them: a candidate can legitimately belong to
several categories, and silently dropping one would make a filing decision on the reviewer's behalf.

## 5. Hadith-derived candidates remain blocked

**No Hadith candidate appears in this pack, and none can be published even with scholarly approval.**

NoorLife holds no Hadith provider licence. `PERMITTED_HADITH_PROVIDERS` in
`src/features/faith/data/duas/reviewed-dua.ts` is an empty list, and it is **code rather than manifest
data** — so a `sourceKind: 'hadith'` row is refused by the parser however complete and however well
reviewed it is. Unblocking Hadith needs a provider licence **and** a deliberate code change; a data
update can never be sufficient.

A reviewer may still rule on a narration if one is proposed later. The ruling would simply have nowhere
to go until the licence exists.

## 6. Unresolved review questions

Applies to every row. These are the open questions the pack cannot answer for the reviewer:

1. **Appropriateness.** Is this passage appropriate to present as a Dua or remembrance on a screen that
   implies NoorLife vouches for it?
2. **Category.** Which of the eight reviewed categories, and is more than one correct?
3. **Endpoints.** Is the proposed range correct, and does the meaning survive being cut there? Only
   contiguous ranges can be expressed — up to 10 ayat — because the data model has nowhere to hold a
   hand-assembled set of non-adjacent verses.
4. **Displayed context.** What words should appear beneath the passage? The reviewer writes the text to
   be shown, not a description of it.
5. **Repetition.** Should any count be displayed, and on what stated basis? **No count has been
   proposed for any candidate in this pack** — no repetition figure has been invented, and the safe
   default is that none is shown.
6. **Popular designation.** Should this be surfaced first on its category page, and at what rank? On a
   NoorLife category page "Popular" means *a reviewer thought this should be surfaced* — it is not a
   measurement of use, because the app collects none.
7. **Translation edition.** Is resource `85` acceptable for the preview, or should a specific edition be
   approved instead?
8. **Cautions.** Anything a user should be told, or a future reviewer should know.

## 7. This document cannot publish anything

Structural, not procedural:

- It lives in `docs/`, which **Metro does not bundle**. Nothing here reaches a build.
- **Nothing under `src/` may import from `docs/`.** `faith-dua-candidate-boundary.test.ts` walks the
  whole source tree and fails if any file resolves into `docs/` — by path pattern, so this file is
  covered by that assertion without any change to it.
- `src/features/faith/data/duas/dua-candidate.ts` ships the candidate **contract** — types and a
  promotion gate — and no candidate data. A test asserts no production file carries a proposal literal.
- `candidateIsDisplayable()` returns the *type* `false`. There is no status for which a candidate may be
  shown to a user, `approved` included: an approved record is not displayed *as a candidate*, it is
  promoted into the manifest and displayed from there with the parser's guarantees attached.

A candidate existing is not a reason for anyone to see it.

## 8. Transfer checklist — how an approval reaches the app

Once the reviewer returns a completed, approved form for a candidate:

- [ ] **1. Record the decision** on the candidate row: reviewer identity, record ID, approval date,
      citable basis, cautions, repetition guidance and basis (or none), Popular rank (or none). Set
      status to `approved`.
- [ ] **2. Run `promoteCandidate`.** It refuses anything that is not `approved` with every required
      field present — including a repetition count with no stated basis, and a rank the reviewer did not
      set. Its output is deliberately typed `unknown`: manifest data, **not** a `ReviewedDua`.
- [ ] **3. A person pastes the promoted row** into `REVIEWED_DUA_MANIFEST`. Deliberately, as a reviewed
      change — never generated into place by a script.
- [ ] **4. `parseReviewedDuas` re-checks it independently.** The same parser any manifest goes through.
      A row that fails is not displayed, so a bug in step 2 cannot publish anything.
- [ ] **5. The zero-entry assertions fail.** `faith-reviewed-dua-contract.test.ts` and
      `reviewed-dua-manifest.test.ts` both assert the built-in count is zero. **This failure is
      intentional** — it is the release gate. Update those assertions knowingly, in the same change,
      stating why the entry is real. Do not route around them.
- [ ] **6. Verify on device** that the entry appears under its approved categories, that its review
      record is disclosed on the detail page, and that Popular renders only if a rank was set.
- [ ] **7. Confirm nothing personal moved.** Approved-data updates must not disturb any user's
      favourites, Tasbih counts or saved selections — those live in account-scoped storage the manifest
      never touches.

Steps 1–3 are the only ones a human performs. Steps 4–5 are the two independent gates.

## 9. The 24 candidate rows

Each row is one candidate. `— AWAITING —` marks a cell only the product owner can fill; blank cells
under *Reviewer decision* are for the scholar.

**Fixed for every row** (not repeated per row): source kind Qur'an · Arabic source Quran Foundation
`text_uthmani` · translation preview resource `85` · provider `quran-foundation` · status `candidate` ·
no repetition proposed · no Popular rank proposed.

<!-- prettier-ignore-start -->

| # | Candidate ID | Reference / proposed range | Proposed category(ies) | Proposed working title | Quran.com link |
| --- | --- | --- | --- | --- | --- |
| 1 | `quran.dua.candidate.001` | — AWAITING — | — AWAITING — | — AWAITING — | — awaiting reference — |
| 2 | `quran.dua.candidate.002` | — AWAITING — | — AWAITING — | — AWAITING — | — awaiting reference — |
| 3 | `quran.dua.candidate.003` | — AWAITING — | — AWAITING — | — AWAITING — | — awaiting reference — |
| 4 | `quran.dua.candidate.004` | — AWAITING — | — AWAITING — | — AWAITING — | — awaiting reference — |
| 5 | `quran.dua.candidate.005` | — AWAITING — | — AWAITING — | — AWAITING — | — awaiting reference — |
| 6 | `quran.dua.candidate.006` | — AWAITING — | — AWAITING — | — AWAITING — | — awaiting reference — |
| 7 | `quran.dua.candidate.007` | — AWAITING — | — AWAITING — | — AWAITING — | — awaiting reference — |
| 8 | `quran.dua.candidate.008` | — AWAITING — | — AWAITING — | — AWAITING — | — awaiting reference — |
| 9 | `quran.dua.candidate.009` | — AWAITING — | — AWAITING — | — AWAITING — | — awaiting reference — |
| 10 | `quran.dua.candidate.010` | — AWAITING — | — AWAITING — | — AWAITING — | — awaiting reference — |
| 11 | `quran.dua.candidate.011` | — AWAITING — | — AWAITING — | — AWAITING — | — awaiting reference — |
| 12 | `quran.dua.candidate.012` | — AWAITING — | — AWAITING — | — AWAITING — | — awaiting reference — |
| 13 | `quran.dua.candidate.013` | — AWAITING — | — AWAITING — | — AWAITING — | — awaiting reference — |
| 14 | `quran.dua.candidate.014` | — AWAITING — | — AWAITING — | — AWAITING — | — awaiting reference — |
| 15 | `quran.dua.candidate.015` | — AWAITING — | — AWAITING — | — AWAITING — | — awaiting reference — |
| 16 | `quran.dua.candidate.016` | — AWAITING — | — AWAITING — | — AWAITING — | — awaiting reference — |
| 17 | `quran.dua.candidate.017` | — AWAITING — | — AWAITING — | — AWAITING — | — awaiting reference — |
| 18 | `quran.dua.candidate.018` | — AWAITING — | — AWAITING — | — AWAITING — | — awaiting reference — |
| 19 | `quran.dua.candidate.019` | — AWAITING — | — AWAITING — | — AWAITING — | — awaiting reference — |
| 20 | `quran.dua.candidate.020` | — AWAITING — | — AWAITING — | — AWAITING — | — awaiting reference — |
| 21 | `quran.dua.candidate.021` | — AWAITING — | — AWAITING — | — AWAITING — | — awaiting reference — |
| 22 | `quran.dua.candidate.022` | — AWAITING — | — AWAITING — | — AWAITING — | — awaiting reference — |
| 23 | `quran.dua.candidate.023` | — AWAITING — | — AWAITING — | — AWAITING — | — awaiting reference — |
| 24 | `quran.dua.candidate.024` | — AWAITING — | — AWAITING — | — AWAITING — | — awaiting reference — |

<!-- prettier-ignore-end -->

Link format, once a reference is supplied: `https://quran.com/<surah>/<ayah>` for a single verse, or
`https://quran.com/<surah>/<start>-<end>` for a contiguous range. A link is a pointer, not content — no
Arabic or translation is reproduced here by including one.

### Reviewer decision — one block per candidate

Reproduce this block for each of the 24, or use
[`DUA_SCHOLARLY_REVIEW_TEMPLATE.md`](./DUA_SCHOLARLY_REVIEW_TEMPLATE.md) directly, which asks the same
questions in fuller form.

| Field | Value |
| --- | --- |
| Candidate ID | |
| Appropriate to present as a Dua? | |
| Approved category(ies) | |
| Approved context to display | |
| Reference start | |
| Reference end | |
| Meaning preserved at those endpoints? | |
| Repetition guidance | |
| Basis for that guidance | |
| Popular designation and rank | |
| Cautions | |
| **Decision** (approved / rejected) | |
| Reviewer (named person or body) | |
| Citable basis | |
| Review record ID | |
| Approval date (`YYYY-MM-DD`) | |
| Notes | |

"Reviewed internally" is not a reviewer and "various scholars" is not a basis — the gate refuses both.

## 10. What is still owed, and by whom

| Owed by | Item | Blocks |
| --- | --- | --- |
| Product owner | **The 24 Qur'an references and their proposed categories** | This entire pack |
| Product owner | A decision on translation resource `85` versus a specific approved edition | Step 2 of the checklist |
| Product owner | A Hadith provider licence | Any narration-derived candidate, ever |
| Reviewer | The nine decisions per candidate, dated and named | Steps 1–5 |

Until the first row is filled and approved, **production built-in Duas remain zero** — which is the
current, honest state of the product and is asserted by two test suites.
