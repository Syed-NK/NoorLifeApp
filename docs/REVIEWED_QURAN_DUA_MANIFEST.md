# Reviewed Quranic Dua manifest — the contract, and what is still missing

**Status as of 2026-08-19: zero approved entries ship.** This document exists so that publishing the
first one is a filling-in exercise rather than a design exercise, and so that nobody has to guess
what "reviewed" means when they are looking at a spreadsheet from a scholar.

The schema and its parser are `src/features/faith/data/dhikr/reviewed-dua-manifest.ts`. The gate that
decides whether a parsed entry may be displayed is `approvedForProduction` in
`quran-dhikr-catalogue.ts`. Both run on every entry, always.

---

## 1. What the product does without this

Nothing here blocks the Duas screen or the Tasbih selector. Users can already browse all 114 surahs,
keep any ayah or contiguous range as a **Quran selection**, favourite it, count it, and read it in
the Reader — offline, from the Arabic this device retained under the 2026-08-18 permission.

What they cannot do is see a verse presented as an *approved dua*. That is the only thing this
manifest unlocks, and the reason the Duas screen says "scholarly-reviewed duas are not ready yet"
rather than describing itself as unavailable.

---

## 2. Why a manifest and not a TypeScript array

`CuratedDhikrReference` is a type, and a type is checked by the compiler. That protects entries
written in TypeScript, in this repository, by somebody running the compiler.

A reviewed catalogue does not arrive that way. It arrives as data — from a reviewer, in a document,
transcribed by a person. At that point `"aproved"` is a plausible string, a missing review date is an
absent property rather than a build failure, and an entry that picked up an `arabic` column on its
way through a spreadsheet is just an object with an extra key. So the manifest is parsed from
`unknown`, and every rejection is named and returned rather than swallowed.

---

## 3. The required fields, per entry

| Field | Type | Rule |
|---|---|---|
| `id` | string | Stable and never reused. Persisted in user state, so renumbering orphans a count. |
| `surah` | integer 1–114 | |
| `startAyah` | integer ≥ 1 | |
| `endAyah` | integer ≥ `startAyah` | Inclusive. Equal to `startAyah` for a single verse. |
| `title` | non-empty string | **Supplied by the reviewed source.** NoorLife does not compose these. |
| `category` | one of the six closed values | `quranic-remembrance`, `morning-evening`, `after-prayer`, `protection`, `forgiveness`, `praise`. |
| `reviewStatus` | `approved` | `pending`, `rejected` and `withdrawn` are well-formed and unshippable. |
| `review.reviewer` | non-empty string | A **named** person or body. "Reviewed internally" is not a reviewer. |
| `review.source` | non-empty string | The citable basis — a work, a ruling, a published collection. |
| `review.reviewedOn` | `YYYY-MM-DD` | Must be a date that exists. `2026-02-30` is refused. |
| `contextNote` | non-empty string | The context in which the reference is offered. Required for approval. |
| `recommendedTarget` | `number \| null` | **`null` is the normal case.** A count only where the review states one. |
| `enabled` | boolean, default true | Set `false` to withdraw an entry without deleting its record. |
| `version` | integer ≥ 1 | Bump when the reviewed content of the entry changes. |

### Fields that are forbidden outright

No key naming Arabic, a translation, a transliteration or verse text — matched broadly, and matched
inside the `review` record too. An entry carrying one is **rejected, not stripped**: a manifest that
arrived with scripture in it is a manifest whose provenance is now in question.

Scripture is resolved at render time from the retained generation. A copy in the manifest would be a
second copy — outside the refresh obligations, unable to pick up a correction, and shipped in the
bundle.

---

## 4. How it fails, and what each failure means

`parseReviewedDuaManifest` returns `{ approved, rejected }`. A rejection carries the entry's index,
its id where it had one, and a reason:

`not-an-object` · `missing-id` · `invalid-range` · `missing-title` · `invalid-category` ·
`invalid-review-status` · `not-approved` · `missing-review-record` · `missing-provenance` ·
`invalid-target` · `embedded-content`

Nine good entries beside one malformed one yield nine approved entries and one named rejection. What
never happens is a partial entry: there is no "approved except for the reviewer's name".

A duplicate id rejects **both** halves rather than letting iteration order decide which one wins.

---

## 5. The remaining blocker, stated plainly

**A qualified reviewer has not been engaged, and no reference list exists.**

That is the whole of it. Everything else is built and tested: the schema, the parser, both gates, the
offline resolver, the reviewed section on Duas, the reviewed branch of the Tasbih control card, and
the badge that keeps a reviewed entry distinguishable from a user's own selection. Populating the
manifest is a data change and requires no code.

What it requires instead is the thing this repository cannot supply: somebody qualified stating, on
the record, that a specific reference is appropriate for the category it is filed under, citing the
basis, on a date. Five source-less dhikr presets once shipped in this app; a developer choosing
verses from memory is exactly how they got there, and confidence in the choice is what that felt like
from the inside.

Do not seed this manifest with "obvious" entries. There is no such thing — which ayat constitute a
dua, in what context, at what repetition, is precisely the judgement this file exists to record
somebody qualified having made.

---

## 6. Related records

- `docs/QURAN_FOUNDATION_DHIKR_PERMISSION.md` — what the vendor granted, and what it did not.
- `docs/QURAN_FOUNDATION_ARABIC_TEXT_PERMISSION.md` — the retained Arabic the resolver reads.
- `docs/FAITH_TASBIH_CONTENT_AUDIT.md` — the five removed presets and the standard that removed them.
