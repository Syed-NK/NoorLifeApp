# Dua scholarly review — what a reviewer is asked to decide

This is the form a qualified reviewer fills in for each proposed Dua. One form per candidate.

**Nothing in this repository displays a Dua to a user until a completed, approved form exists for it
and its record has been promoted into the production manifest.** Filling this in is the only route.

> **This document contains no candidate Duas.** The example below uses placeholder text and a
> deliberately invalid reference so it cannot be mistaken for a proposal. NoorLife will not add real
> candidate references here until Syed supplies or approves a candidate list — see *What NoorLife still
> owes you*.

---

## Before you start: what NoorLife has and has not done

**What NoorLife has done.** Built the display, the categories, the search, the detail page and the gate
that refuses unreviewed content. All of it is finished and all of it currently shows **zero** built-in
Duas, because zero have been reviewed.

**What NoorLife has deliberately not done.** Chosen which passages are appropriate, written a context,
proposed a repetition count from memory, or ranked anything as popular. Those are the judgements this
form exists to record you making. A developer choosing verses from recollection is exactly how five
unsourced dhikr presets once shipped in this app and had to be removed.

**What you are not being asked to do.** Verify the Arabic or the translation. Those come from Quran
Foundation's Content API at render time and are never copied into the app, so their accuracy is the
publisher's and the app cannot alter them.

---

## The form

### 1. Identification

| Field | Value |
| --- | --- |
| Candidate id | `example.placeholder.001` |
| Version | `1` |
| Source kind | Qur'an / Hadith |
| Exact reference | *e.g.* surah and ayah range, or collection and narration number |
| Provider | `quran-foundation` for Qur'an; a licensed Hadith provider otherwise |
| Translation identity | Provider resource id of the translation, if you are approving a specific one |

**Hadith note.** NoorLife currently has **no** Hadith provider licence. A Hadith candidate cannot be
published even with your approval until that licence exists, and the code refuses it structurally
(`PERMITTED_HADITH_PROVIDERS` is empty). You may still review one; it simply cannot ship yet.

### 2. Is this appropriate to present as a Dua or remembrance?

The central question. NoorLife presents built-in entries under headings that imply it vouches for them.

- [ ] Yes — appropriate to present as a supplication or remembrance
- [ ] No
- [ ] Yes, but only with the qualifications in §8

### 3. Category and context

Which of the presentation categories does it belong under? (Daily Remembrances · Morning & Evening ·
Food & Drink · Travel · Home & Family · Joy & Distress · Essential Duas · Adhkar. More than one is
allowed. *My Quran Selections* and *Favorites* hold the user's own data and can never receive a
built-in entry.)

| Field | Value |
| --- | --- |
| Approved categories | |
| Approved context to display | |

The context is shown to the user beneath the passage. Its purpose is the permission's *preserve
original context and meaning* requirement: a verse lifted out of its passage and presented as a
repetition prompt has lost context unless something restores it. Please write the words you want
displayed, not a description of them.

### 4. Beginning and end of the reference

| Field | Value |
| --- | --- |
| First ayah / narration start | |
| Last ayah / narration end | |

Only **contiguous** ranges can be expressed — the data model has nowhere to hold a hand-assembled set
of non-adjacent verses, by design. If a proposal needs one, reject it and say so.

### 5. Is the meaning preserved at those endpoints?

Does the passage, cut where §4 cuts it, still say what it says in full?

- [ ] Yes
- [ ] No — endpoints should be: ______

### 6. Repetition guidance

- [ ] No repetition count should be shown *(the default, and the safe answer)*
- [ ] A count of ______ should be shown, on this basis: ______

A count is only ever displayed with the basis you state here. NoorLife will not show a number with
nothing behind it, and the code refuses one.

### 7. Popular designation

- [ ] Not designated
- [ ] Designate with rank ______

"Popular" on a NoorLife category page means *a reviewer thought this should be surfaced first*. It is
not a measurement of use — the app collects no such measurement. Only you can set it.

### 8. Cautions

Anything a user should be told, or anything a future reviewer should know. Recorded even on a rejection,
where it is the most useful field in the file.

### 9. Decision

| Field | Value |
| --- | --- |
| Reviewer (named person or body) | |
| Citable basis | |
| Decision | approved / rejected |
| Date (ISO, `YYYY-MM-DD`) | |
| Review record id | |
| Notes | |

"Reviewed internally" is not a reviewer and "various scholars" is not a basis; the gate refuses both.

---

## What happens to a completed form

1. Its fields become a candidate record with status `approved`.
2. `promoteCandidate` converts it to manifest data, refusing it if any required field above is
   missing — including a repetition count without a basis, or a rank you did not set.
3. The promoted row is added to the production manifest by a person, deliberately.
4. `parseReviewedDuas` independently re-checks it. A row that fails is not displayed.
5. A test asserting the built-in count is zero now fails. Whoever added the entry updates that
   assertion and states why the entry is real. **That failure is intentional** — it is what stops
   content arriving unnoticed.

A rejected, superseded or incomplete record stops at step 2 and is never visible to a user.

---

## What NoorLife still owes you

- **A candidate list.** NoorLife has not proposed any references, and will not author one unprompted:
  choosing which passages to put in front of you is already an editorial act. Syed supplies or approves
  that list.
- **A Hadith provider licence**, before any narration-derived candidate can ship regardless of review.
- **A translation resource decision**, if you want a specific edition approved rather than whichever the
  device has retained.
