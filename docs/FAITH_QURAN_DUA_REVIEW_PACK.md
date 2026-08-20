# Qur'an Dua candidate pack — for scholarly review

> ## STATUS: 24 candidates proposed — awaiting scholarly decisions
>
> The 24 references, their proposed categories and their proposed working titles were supplied by the
> product owner. **They are proposals, not decisions.** Nothing in this pack has been reviewed, and every
> record carries status `candidate`.
>
> Every scholarly decision field is deliberately blank. Fill them in using
> [`DUA_SCHOLARLY_REVIEW_TEMPLATE.md`](./DUA_SCHOLARLY_REVIEW_TEMPLATE.md) or the per-candidate block in
> [§9](#9-reviewer-decision--one-block-per-candidate).

Nothing here is approved, verified, authentic, popular or recommended, and nothing here can appear in the
app. See [§7](#7-this-document-cannot-publish-anything).

Companion documents: [`DUA_SCHOLARLY_REVIEW_TEMPLATE.md`](./DUA_SCHOLARLY_REVIEW_TEMPLATE.md) — the
per-candidate decision form; [`REVIEWED_QURAN_DUA_MANIFEST.md`](./REVIEWED_QURAN_DUA_MANIFEST.md) — the
production contract an approval eventually crosses into.

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

## 2. Where these 24 came from, and what that means

The references, categories and working titles were chosen by the **product owner**, not by engineering.
That matters for how the reviewer should read them: they are one person's proposal about what might be
appropriate, offered for judgement, and carry no weight beyond that.

Engineering did not select, add to, or narrow the list. The reason is recorded rather than assumed:
choosing which passages to place in front of a scholar is itself an editorial religious act, and a
reviewer ruling on a developer's recollection while believing they were ruling on the product owner's
proposal would produce approvals nobody had actually intended. Five source-less dhikr presets once
shipped in this app and had to be removed for exactly that reason.

What engineering did do: assign the stable IDs, instantiate the Quran.com links, count the ranges,
validate them against the data model's limits, and check the arithmetic in §4.

## 3. Fixed properties — identical for all 24

Settled, and needing no reviewer decision:

| Property | Value |
| --- | --- |
| Source kind | Qur'an |
| Arabic source | Quran Foundation, `text_uthmani` |
| Proposed translation preview resource | `85` |
| Provider | `quran-foundation` |
| Status | `candidate` |
| Proposed repetition guidance | **none for any candidate** — no count has been invented |
| Proposed Popular rank | **none for any candidate** — only a reviewer may set one |
| Arabic in this repository | none — resolved at render time, never copied |
| Translation text in this repository | none — same |

### The candidate ID scheme

`quran.dua.candidate.001` through `quran.dua.candidate.024`, assigned by row position and stable
thereafter. Two properties matter:

- **No ID begins `q.`** That prefix is the user's own personal-selection namespace, and the manifest
  parser rejects a reviewed id that collides with it — the two id spaces must stay disjoint because one
  detail route serves both.
- **An ID survives a re-ordering of this document**, because the review record the scholar signs is keyed
  on it.

### Range validity

All 24 references were checked against the data model: every surah is within 1–114, every range is
contiguous with its end at or after its start, and the **longest span is 5 ayat** against a limit of 10.
No candidate needs a non-contiguous selection, which is fortunate — the model has nowhere to express
one.

## 4. Category coverage

Counts are **derived from the rows in [§8](#8-the-24-candidate-rows)**, not stated independently, so they
can be checked against the table.

| Presentation category | Qur'an candidates proposed |
| --- | --- |
| Essential Duas | 5 |
| Joy & Distress | 7 |
| Home & Family | 4 |
| Daily Remembrances | 3 |
| Morning & Evening | 3 |
| Adhkar | 3 |
| Travel | 1 |
| **Food & Drink** | **0** — see below |
| My Quran Selections | not applicable — holds the user's own saved references only |
| Favorites | not applicable — same |

### 24 candidates, 26 category memberships

The two totals differ and both are correct. **Candidate 008** is proposed under *Daily Remembrances*
**and** *Joy & Distress*; **candidate 010** under *Morning & Evening* **and** *Adhkar*. Each contributes
two memberships, so 22 single-category candidates plus 2 dual-category candidates give
`22 + (2 × 2) = 26` memberships across 24 records.

The eight per-category counts above sum to 26, which is the arithmetic check.

### Duplicate category proposals are preserved, not resolved

Candidates 008 and 010 keep **both** proposals on the row, marked for the reviewer to decide. Engineering
did not narrow them: a passage can legitimately belong to several categories, and silently dropping one
would be filing a decision on the reviewer's behalf. The reviewer may approve one, both, or neither.

### Food & Drink has no Qur'an candidate in this pack

Stated so the reviewer does not look for one and does not infer an omission. The category exists on the
grid, it is discoverable, and it currently shows the honest empty state saying reviewed content is not
available for it. Filling it would need either a Qur'an passage a reviewer judges appropriate for eating
and drinking, or Hadith-derived content — which is blocked; see §5.

### One overlap the reviewer may want to rule on

**Candidate 023 (`3:191`) lies inside candidate 009 (`3:190-194`).** Both were proposed, under different
categories — *Adhkar* and *Morning & Evening* respectively. This is noted as a fact, not resolved: the
reviewer may approve both as distinct entries, approve one, or ask for the shorter to be folded into the
longer. Engineering has no basis for choosing.

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

These apply to every row and are the open questions this pack cannot answer:

1. **Appropriateness.** Is this passage appropriate to present as a Dua or remembrance on a screen that
   implies NoorLife vouches for it?
2. **Category.** Is the proposed category correct, and for candidates 008 and 010, do both apply?
3. **Endpoints.** Is the proposed range correct, and does the meaning survive being cut there?
4. **Displayed context.** What words should appear beneath the passage? Please write the text to be
   shown, not a description of it.
5. **Repetition.** Should any count be displayed, and on what stated basis? None is proposed; the safe
   default is that none is shown.
6. **Popular designation.** Should this be surfaced first on its category page, and at what rank? On a
   NoorLife category page "Popular" means *a reviewer thought this should be surfaced* — not a
   measurement of use, because the app collects none.
7. **Translation edition.** Is resource `85` acceptable for the preview, or should a specific edition be
   approved instead?
8. **Working title.** The titles below are the product owner's neutral placeholders. Is each acceptable
   as displayed text, and if not, what should it say?
9. **Cautions.** Anything a user should be told, or a future reviewer should know.

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

## 8. The 24 candidate rows

Every reference, category and title below is **proposed**. The `Ayat` column is the span length, checked
against the model's limit of 10.

<!-- prettier-ignore-start -->

| # | Candidate ID | Reference (proposed) | Ayat | Proposed category(ies) | Proposed working title | Quran.com |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `quran.dua.candidate.001` | `1:5-7` | 3 | Essential Duas | Guidance on the straight path | [1:5-7](https://quran.com/1/5-7) |
| 2 | `quran.dua.candidate.002` | `2:201` | 1 | Essential Duas | Good in this life and the Hereafter | [2:201](https://quran.com/2/201) |
| 3 | `quran.dua.candidate.003` | `2:285-286` | 2 | Essential Duas | Forgiveness, mercy and relief | [2:285-286](https://quran.com/2/285-286) |
| 4 | `quran.dua.candidate.004` | `3:8` | 1 | Essential Duas | Steadfast hearts and mercy | [3:8](https://quran.com/3/8) |
| 5 | `quran.dua.candidate.005` | `23:118` | 1 | Essential Duas | Forgiveness and mercy | [23:118](https://quran.com/23/118) |
| 6 | `quran.dua.candidate.006` | `20:114` | 1 | Daily Remembrances | Increase in knowledge | [20:114](https://quran.com/20/114) |
| 7 | `quran.dua.candidate.007` | `27:19` | 1 | Daily Remembrances | Gratitude and righteous action | [27:19](https://quran.com/27/19) |
| 8 | `quran.dua.candidate.008` | `28:24` | 1 | **Daily Remembrances** + **Joy & Distress** _(two proposed — reviewer decides)_ | Need, provision and dependence upon Allah | [28:24](https://quran.com/28/24) |
| 9 | `quran.dua.candidate.009` | `3:190-194` | 5 | Morning & Evening | Reflection, faith and acceptance | [3:190-194](https://quran.com/3/190-194) |
| 10 | `quran.dua.candidate.010` | `7:205` | 1 | **Morning & Evening** + **Adhkar** _(two proposed — reviewer decides)_ | Remembering Allah morning and evening | [7:205](https://quran.com/7/205) |
| 11 | `quran.dua.candidate.011` | `40:55` | 1 | Morning & Evening | Patience, praise and forgiveness | [40:55](https://quran.com/40/55) |
| 12 | `quran.dua.candidate.012` | `2:127-129` | 3 | Home & Family | Acceptance and righteous descendants | [2:127-129](https://quran.com/2/127-129) |
| 13 | `quran.dua.candidate.013` | `14:40-41` | 2 | Home & Family | Prayer, parents and believers | [14:40-41](https://quran.com/14/40-41) |
| 14 | `quran.dua.candidate.014` | `17:24` | 1 | Home & Family | Mercy for parents | [17:24](https://quran.com/17/24) |
| 15 | `quran.dua.candidate.015` | `25:74` | 1 | Home & Family | Family comfort and righteous example | [25:74](https://quran.com/25/74) |
| 16 | `quran.dua.candidate.016` | `18:10` | 1 | Joy & Distress | Mercy and right guidance in difficulty | [18:10](https://quran.com/18/10) |
| 17 | `quran.dua.candidate.017` | `21:83` | 1 | Joy & Distress | Hardship and mercy | [21:83](https://quran.com/21/83) |
| 18 | `quran.dua.candidate.018` | `21:87` | 1 | Joy & Distress | Distress, repentance and deliverance | [21:87](https://quran.com/21/87) |
| 19 | `quran.dua.candidate.019` | `23:97-98` | 2 | Joy & Distress | Protection from evil prompting | [23:97-98](https://quran.com/23/97-98) |
| 20 | `quran.dua.candidate.020` | `28:21` | 1 | Joy & Distress | Safety from wrongdoing people | [28:21](https://quran.com/28/21) |
| 21 | `quran.dua.candidate.021` | `7:23` | 1 | Joy & Distress | Repentance and mercy | [7:23](https://quran.com/7/23) |
| 22 | `quran.dua.candidate.022` | `43:13-14` | 2 | Travel | Remembrance when travelling | [43:13-14](https://quran.com/43/13-14) |
| 23 | `quran.dua.candidate.023` | `3:191` | 1 | Adhkar | Remembrance and reflection | [3:191](https://quran.com/3/191) |
| 24 | `quran.dua.candidate.024` | `33:41-42` | 2 | Adhkar | Frequent remembrance of Allah | [33:41-42](https://quran.com/33/41-42) |

<!-- prettier-ignore-end -->

Link format: `https://quran.com/<surah>/<ayah>` for a single verse,
`https://quran.com/<surah>/<start>-<end>` for a contiguous range. A link is a pointer, not content — no
Arabic or translation is reproduced by including one.

## 9. Reviewer decision — one block per candidate

Reproduce this block for each of the 24, or use
[`DUA_SCHOLARLY_REVIEW_TEMPLATE.md`](./DUA_SCHOLARLY_REVIEW_TEMPLATE.md), which asks the same questions
in fuller form. Every field starts blank.

| Field | Value |
| --- | --- |
| Candidate ID | |
| Appropriate to present as a Dua? | |
| Approved category(ies) | |
| Approved context to display | |
| Approved display title | |
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

## 10. Transfer checklist — how an approval reaches the app

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

## 11. What is still owed, and by whom

| Owed by | Item | Blocks |
| --- | --- | --- |
| Reviewer | The nine decisions per candidate, dated and named | Steps 1–5 of the checklist |
| Reviewer | A ruling on the 009 / 023 overlap | Whether both entries exist |
| Reviewer | Whether both categories apply for candidates 008 and 010 | Their filing |
| Product owner | A decision on translation resource `85` versus a specific approved edition | Step 2 |
| Product owner | A Hadith provider licence | Any narration-derived candidate, ever |

Until the first row is approved and transferred, **production built-in Duas remain zero** — the current,
honest state of the product, asserted by two test suites.
