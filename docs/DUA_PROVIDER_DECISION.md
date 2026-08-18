# Dua provider — decision report

**Status: no source selected. Nothing integrated. Awaiting an explicit approval decision.**

**Prepared:** 2026-08-12
**Scope:** research only. No API was called from application code, no credential was requested or
stored, no dependency was installed, and the Duas screen remains the provider-locked state.

Companion to `HADITH_PROVIDER_DECISION.md`. The evidence convention is the same: **[verified]** means
read directly from the source cited; **[unverified]** means the source does not state it publicly and
it is being treated as unknown rather than inferred.

---

## 0. Why this is the stricter of the two decisions

Duas are the higher-risk surface, not the lower one, and the instinct to treat them as the easier
half is the thing to resist.

The previous implementation rendered three categories over supplication cards carrying Arabic,
transliteration, translation, a hadith reference and a repetition count — from a fixture. The Arabic
was set at display size as the dominant element of each card.

**A user may recite it.** That is the whole difference. An unverified narration is read; an
unverified supplication is *performed*, aloud, as worship, and possibly taught to a child. A
mis-transcribed Arabic word, a missing diacritic that changes a root, a repetition count nobody
checked, or a supplication attributed to the Sunnah that is not from it — each of those is an error
the app caused a person to commit in their own worship.

The three additional questions a Dua source must answer, over and above the hadith ones:

1. **Is the Arabic vocalised and correct?** Duas are recited from the text on screen. A hadith
   translation that is slightly loose is a flaw; an Arabic supplication with a wrong harakah is a
   different word.
2. **Where is each supplication *from*?** A dua collection is an editorial selection from Qur'an and
   Sunnah. The selection has an author, and each entry has a source that must travel with it.
3. **What authorises the repetition count and the occasion?** "Say this three times after Fajr" is a
   normative instruction. It is not metadata.

---

## 1. The structural problem: there is no canonical Dua API

Hadith has a canonical corpus with a canonical digital home. Duas do not. What exists instead is:

- **Books.** *Hisn al-Muslim* ("Fortress of the Muslim") by Sa'id ibn Wahf al-Qahtani is the
  dominant one, at roughly 326 supplications **[verified via its principal publisher-app's
  description]**. It is a **modern authored work** — compiled, selected and annotated by a named
  living-memory author, published with a named publisher, and translated by named translators.
- **Apps** built on those books, most notably Greentech Apps Foundation's *Dua & Zikr (Hisnul
  Muslim)* **[verified]**.
- **Aggregator APIs** that serve dua content without stating where they got it.

**The consequence, stated up front:** the leading Dua corpus is a copyrighted modern book. Its
compilation, its Arabic vocalisation choices, its translations and its annotations are all works of
authorship. Using it is a **licensing conversation with a publisher**, not an API integration.

Every aggregator below that serves "Hisnul Muslim" content is serving that book. Whether it is
licensed to is the question, and none of them answers it.

---

## 2. Candidate A — UmmahAPI

| Field | Finding |
|---|---|
| **Documentation** | `https://ummahapi.com/` **[verified]** |
| **Dua content** | "126 authentic duas from Quran and Sunnah across 27 categories" **[verified: the claim; unverified: the basis for "authentic"]** |
| **Also serves** | Qur'an, 36,000+ hadith across 10 collections, prayer times, Qibla, Hijri calendar, tafsir, Zakat calculator **[verified]** |
| **Authentication** | None for basic access; a free key at `/register` lifts limits **[verified]** |
| **Rate limits** | Anonymous: 5,000 requests / 15 min, 300 calculations / min. With a key: unlimited **[verified]** |
| **Cost** | Free. "Free Forever, Built for the Ummah" **[verified]** |
| **Operator** | Described as a community sadaqah jariyah project. **No legal entity is identified on the site.** **[verified that none is named]** |
| **Licence / terms of service** | **None published** **[verified absent]** |
| **Attribution requirements** | Not stated **[unverified]** |
| **Commercial use** | Not addressed **[unverified]** |
| **Caching / offline** | Not addressed **[unverified]** |
| **Data sources** | **Not cited.** The site names hadith collections but does not state the provenance of the dua corpus, nor who determined the 126 to be authentic. **[verified absent — and this is disqualifying on its own terms]** |
| **Direct from mobile?** | Technically yes; see §5. |
| **Privacy** | Device IP and requested content disclosed to an unidentified operator. |

**Assessment.** Generous limits and zero friction, and it fails the one question this screen exists
to ask. A source that asserts 126 duas are "authentic" without saying who judged them, from what
compilation, is asking NoorLife to relay a scholarly claim on its behalf — which is precisely the
fixture problem with a network call in front of it.

An unidentified operator also means there is no counterparty: nobody to license from, nobody to
warrant accuracy, and nobody to notify when a supplication is wrong.

---

## 3. Candidate B — a licensed corpus from a publisher (e.g. Hisn al-Muslim via its rights holder)

Not an API. A licence.

| Field | Finding |
|---|---|
| **What it is** | Direct permission from the copyright holder of a named dua compilation to reproduce its Arabic, transliteration, translation and annotations in NoorLife |
| **Documentation** | N/A — a negotiated agreement, not a technical spec |
| **Authentication** | N/A. The content would be bundled or served from NoorLife's own infrastructure |
| **Collections** | Exactly the compilation licensed, with its own structure and categories |
| **Arabic + translation** | As published — vocalised by the publisher's own editorial process, translated by a named translator |
| **Reference metadata** | As published: each entry's Qur'anic or hadith source, and its grading where the compiler gave one |
| **Attribution** | Whatever the agreement requires. Expect a mandatory credit line, and expect it to be non-negotiable |
| **Licence / commercial use** | Explicit, in writing, negotiated — which is the entire point |
| **Caching / offline** | Governed by the agreement; a bundled corpus is normal for this shape |
| **Rate limits** | None. There is no API |
| **Cost** | Unknown until asked. May be zero for a charitable publisher; may be a fee or a revenue condition given NoorLife's paid tiers **[unverified]** |
| **Mobile-direct?** | Not applicable — no third-party call is made |
| **Privacy** | The strongest available. No request leaves the device; nobody learns what a user prays |

**Assessment.** The only shape in which every question in §0 has an answerable answer, because there
is a counterparty who can answer it. It is also the slowest, and the one that cannot be started by a
developer alone.

**Candidate rights holders worth approaching** — named as parties to contact, not as selections:
Greentech Apps Foundation (UK charity, publisher of *Dua & Zikr (Hisnul Muslim)*, 326 duas)
**[verified]**; and the original publisher of *Hisn al-Muslim*. Quran Foundation is worth asking in
the existing channel, though their Content API is Quran-only with no dua category **[verified]**.

---

## 4. Candidate C — open dua datasets on GitHub

Numerous repositories publish dua JSON, several derived from *Hisnul Muslim*.

| Field | Finding |
|---|---|
| **Authentication** | None; static files |
| **Cost / rate limits** | Free / none |
| **Repository licence** | Varies — MIT and Unlicense are common **[verified as a pattern]** |
| **Content licence** | **The same defect as the hadith case, and worse.** A permissive licence on a repository cannot convey rights to a copyrighted compilation the maintainer transcribed. With hadith the underlying Arabic is public domain and only the translation is at issue; with a dua compilation the **selection, ordering, categorisation and annotation are themselves the copyrighted work** — so even a repository containing only public-domain Arabic can infringe by reproducing the compiler's arrangement |
| **Arabic accuracy** | Unverifiable at scale. Transcription errors in community datasets are common and, for vocalised Arabic, consequential |
| **Verification chain** | None |

**Assessment.** Not viable as a production source. Usable as a *research aid* for understanding what
a corpus contains before approaching its rights holder — and for nothing that reaches a screen.

---

## 5. Integration shape

The ranking here differs from the hadith report's, and deliberately.

1. **Bundled, licensed corpus — strongly preferred.** A dua collection is small, essentially static,
   and needed exactly when a user is least likely to have connectivity: travelling, at a graveside,
   before sleep. It should not require a network. Bundling also means the text is fixed at release
   and reviewable before it ships, which is the only point at which Arabic vocalisation can actually
   be checked.
2. **Server proxy** — if a licence requires served rather than bundled delivery, the proxy applies
   for the same four reasons as the hadith report: credentials, privacy, integrity enforcement, and
   the ability to change provider without an app-store release.
3. **Direct from mobile — rejected.** It leaks a key if there is one, discloses to a third party
   which supplications a user reads, and puts the network between a person and their worship. There
   is no argument for it here that survives the offline requirement.

---

## 6. Privacy implications

Sharper than the hadith case. Dua categories are, by construction, a description of a person's
circumstances — illness, travel, distress, grief, debt, childbirth, seeking a spouse. A request log
against those categories is a log of what is happening in someone's life.

| Shape | What a third party learns |
|---|---|
| Direct from mobile | Device IP, and the category and specific supplication requested, timestamped |
| Server proxy | Nothing about the individual; NoorLife holds the pairing and must decline to log it |
| Bundled corpus | Nothing. No request is made |

This alone is a sufficient argument for bundling, independent of licensing.

---

## 7. Unresolved questions — to be answered before any approval

1. **Which compilation?** The corpus has to be a named, attributable work. "126 authentic duas" from
   an unnamed selection is not a source.
2. **Who holds its copyright, and will they license it for a commercially distributed app,** in
   writing, covering Arabic, transliteration, translation and annotations separately — they may be
   held by different parties.
3. **Is the Arabic vocalised, and reviewed by whom?** Naming the reviewer is part of the answer.
4. **What is the source of each individual supplication** (Qur'anic reference or hadith citation),
   and does it travel with the entry in the data?
5. **What authorises repetition counts and prescribed occasions,** and are they attributable to the
   compiler rather than to NoorLife?
6. **Transliteration scheme**, and whether NoorLife is licensed to display it. The existing
   `showTransliteration` preference implies one and has no corpus behind it.
7. **Audio.** If recited audio is ever wanted, that is a separate rights grant and a separate reciter
   permission. Not in scope, and flagged so it is not assumed.
8. **Corrections.** How does a corrected supplication reach a device that has the old one bundled?
   For duas this needs a real answer, because a bundled error persists until the next release.
9. **Attribution placement.** Where the mandated credit appears — per entry, per screen, or in the
   content-information screen alongside the Qur'an translation credit. Likely dictated by the
   agreement rather than chosen.
10. **Categories.** The locked screen shows "Morning & evening" and "Everyday moments". Those name
    *intentions*, not inventory, and the licensed compilation's own categories may not match them.
    **The design's category labels are not evidence that content exists, and they must not become a
    specification the corpus is bent to fit** — if the compilation organises its supplications
    differently, the screen changes, not the corpus.

---

## 8. Recommendation

**None, deliberately** — and for Duas the reason is stronger than for Hadith.

There is no candidate that is merely missing a licence document. Candidate A cannot say where its
content came from; Candidate C cannot hold the rights it grants; Candidate B is not a provider that
can be integrated but a conversation that has to be had. The absence of a canonical Dua API is not a
gap in this research — it is the finding.

The next step is correspondence, not code: approach a rights holder from §3 with questions 1–5 from
§7. Nothing here should proceed on an aggregator.

Until a source, a licence and an integration approach are approved in writing, the Duas screen stays
exactly as it is: the locked state, the approved copy, disabled rows, and `No unverified
supplications are shown.`

---

## Sources

- [UmmahAPI](https://ummahapi.com/)
- [Greentech Apps Foundation — Dua & Zikr (Hisnul Muslim)](https://gtaf.org/apps/hisnul/)
- [Dua & Zikr (Hisnul Muslim) on Google Play](https://play.google.com/store/apps/details?id=com.greentech.hisnulmuslim)
- [Quran Foundation — Content APIs](https://api-docs.quran.foundation/docs/category/content-apis/)
- Companion report: [`HADITH_PROVIDER_DECISION.md`](./HADITH_PROVIDER_DECISION.md)
