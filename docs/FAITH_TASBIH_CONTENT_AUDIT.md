# Tasbih — built-in content audit and removal record

**Date:** 2026-08-14
**Branch:** `feature/subscriptions-family-six`
**Outcome:** all five built-in entries removed from production. Tasbih ships as a neutral private
counter with optional user-created labels.

---

## 1. What was audited

`src/features/faith/data/mock/mock-tasbih.repository.ts` (now deleted) shipped **five built-in
entries**, each carrying Arabic, a transliteration, an English translation and a target.

NoorLife requires four things of any religious content it presents. Each entry was checked against
all four.

| Requirement | Found |
|---|---|
| Verified Arabic — a named source the script can be checked against | **Absent** |
| Verified translation — a named translator or edition | **Absent** |
| Recorded provenance — a reference, citation or decision record | **Absent** |
| Compatible redistribution licence | **Absent** |

Searched: the file itself, every file under `src/features/faith/`, all of `docs/`, and the test
suite. The word "provenance" did not appear in connection with any of them. There was no source
comment, no reference field, no licence note and no decision record.

**All five failed all four checks.** None was retained.

## 2. Why the text is not reproduced here

This document deliberately does **not** restate the removed Arabic, transliterations or
translations. A compliance record that quotes the content it removed is a place that content
survives, and the point of the removal is that NoorLife holds no copy it cannot stand behind.

The five **identifiers** are retained in `local-tasbih.repository.ts` because the migration must
recognise a stored session pointing at one. Identifiers are not content.

## 3. What NoorLife does and does not claim

- NoorLife **does not** present these phrases as authenticated, verified, recommended or sourced.
- NoorLife **does not** claim they are inaccurate, unsound or objectionable. The finding is about
  **NoorLife's records**, not about the phrases. They are widely known; that is precisely why an
  app must not present them on the strength of being widely known.
- The removal is a statement about what this repository can evidence, and nothing else.

## 4. What ships instead

A neutral private counter:

- One default counter named **"My counter"** — not "dhikr", not "Sunnah", not "recommended".
- A default round length of 33, described only as a round length. It is not presented as
  religiously prescribed.
- Optional **user-created labels**: the user's own words, stored on this device, sent nowhere.

`CounterLabel` carries `id`, `name` and `target` and nothing else. It has no `arabic`, no
`translation`, no `reference` and no `verified` field, so "NoorLife stands behind this text" is not
a state the type can express — which is stronger than a rule saying it must not.

## 5. Migration

A user upgrading keeps their count. See the migration table in `local-tasbih.repository.ts` and the
cases in `__tests__/faith-tasbih-migration.test.ts`.

| Stored (v1) | Becomes (v2) |
|---|---|
| A removed built-in id | The neutral counter. **Count, target and rounds kept** |
| A user-created id | That id kept. Count, target and rounds kept |
| A field non-finite or out of range | That field falls back to a safe value |
| Anything uninterpretable | Left alone in storage; a fresh counter is used |

The label is dropped because NoorLife could not vouch for it. The number is kept because it is the
user's, and discarding it would be the upgrade deciding their count did not happen.

## 6. How the removal is kept permanent

`faith-tasbih-migration.test.ts` scans `src/features/faith/` and `src/features/modules/faith/` for
the removed transliterations and translations and fails on any of them. It also fails if any Arabic
codepoint appears in `data/tasbih/`, and if the deleted mock file returns.

**Verified by reintroduction:** adding one removed string back to the repository turns the scan red;
removing it turns it green again.

## 7. When built-in phrases could return

Only when, **per entry**, all four elements in §1 are documented: a named Arabic source, a named
translation source, a recorded reference, and a licence permitting NoorLife's use. That is the same
bar the Qur'an integration meets through Quran Foundation, and the bar Hadith and Duas remain locked
behind.
