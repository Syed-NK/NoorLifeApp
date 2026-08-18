# Quran Foundation — Arabic Qur'an text retention permission (compliance record)

**Status:** granted, subject to continued compliance
**Recorded:** 2026-08-18
**Scope of this document:** the compliance facts only. No correspondence is reproduced here.

This record covers **retention of the complete Arabic Qur'an text for offline use**. It is separate
from, and does not alter, [`QURAN_FOUNDATION_AUDIO_PERMISSION.md`](QURAN_FOUNDATION_AUDIO_PERMISSION.md)
(offline recitation of resource ID 3) and
[`QURAN_FOUNDATION_DHIKR_PERMISSION.md`](QURAN_FOUNDATION_DHIKR_PERMISSION.md) (the Quran-derived
Dhikr selector). **No grant extends another.**

---

## 1. The grant

| Field | Value |
|---|---|
| Granted by | Quran Foundation — Developer Relations |
| Instrument | Written permission |
| Date received | **2026-08-18** |
| Time shown by the email client | **9:35 AM** — see the note below |
| Grantee | NoorLife |
| Subject | The **complete, unmodified Arabic Qur'an text** |
| Storage | **Private Android and iOS app storage** |
| Retention | **Beyond one week** |
| Permitted purpose | Offline in-app reading, and synchronised recitation playback |
| Expiry | None stated; subject to continued compliance |

> **On the timestamp.** The client displayed 9:35 AM. **The timezone was not independently
> confirmed**, so the time is recorded as displayed rather than normalised to UTC. The date is the
> load-bearing fact; the time is recorded for completeness and should not be relied on for any
> ordering argument.

### What this repository may record, and what it may never hold

The same fixed rule the other two permission records carry, so the boundary is not re-decided per
file.

| May be recorded here | May **never** enter version control |
|---|---|
| The date the permission was received | The original email or any message body |
| The granting team | Personal correspondence of any kind |
| The granted scope and its conditions | Email headers, routing metadata or addresses |
| A pointer to the private retention location | Attachments, screenshots or exports of the above |

---

## 2. Conditions

Each is a condition of the grant, not a NoorLife preference.

1. **The Arabic must remain complete and unmodified.** No abridgement, no correction, no
   normalisation that changes the text.
2. **No export, resale, sublicensing, API exposure or standalone distribution.** The text may be read
   inside NoorLife and nowhere else — it may not be re-served, re-published, or exposed through any
   interface NoorLife offers to another system.
3. **Update checks at least every seven connected days**, with a prompt synchronisation after
   reconnection. This is the same C7-shaped obligation the audio grant carries, and the mechanism
   that already discharges it is recorded in `QURAN_FOUNDATION_AUDIO_PERMISSION.md` §8.6.
4. **Required attribution remains** exactly as already specified.
5. **User bookmarks, notes and reading positions remain separate** from the licensed text. They are
   the user's own data and are not part of what is licensed here.

---

## 3. What this permission does **not** broaden

Stated explicitly, because a grant for one resource is routinely misread as a grant for its
neighbours.

| Not covered | Where it is covered |
|---|---|
| Translations | unchanged; translation 85 keeps its existing terms |
| Recitation audio | `QURAN_FOUNDATION_AUDIO_PERMISSION.md` — **resource ID 3 alone** |
| Metadata and raw data rights | unchanged |
| Quran-derived Dhikr | `QURAN_FOUNDATION_DHIKR_PERMISSION.md` — separate grant |

Sudais resource 3 and the curated Quran-derived Dhikr selector **remain separate permissions** and
are unaffected by this record.

---

## 4. Implementation status

> **Permission granted; offline Arabic Reader implementation pending.**

Nothing in the application changes because of this document. Arabic reader text is **not retained
today**, and the reader still requires a connection — the accepted limitation the current release
ships with. This record establishes that the limitation is now a NoorLife implementation gap rather
than a licence constraint.

When the offline reader is built it must satisfy every condition in §2, and the seven-connected-day
check in §2.3 is already implemented for the feed by the mechanism in the audio permission record's
§8.6.

---

## 5. Where the original evidence is retained

**⚠ TO BE CONFIRMED.** The original written permission is held outside this repository. The pointer
must name a **private** location — never a public repository, shared drive link, issue tracker or
anything reachable without authorisation.

This field is deliberately left unconfirmed rather than guessed, on the same standard as the
equivalent fields in the other two permission records.
