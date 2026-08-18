# Hadith provider — decision report

**Status: no provider selected. Nothing integrated. Awaiting an explicit approval decision.**

**Prepared:** 2026-08-12
**Scope:** research only. No API was called from application code, no credential was requested or
stored, no dependency was installed, and the Hadith screen remains the provider-locked state.

---

## 0. What this report is, and the one thing it does not do

It sets out the candidates that exist, what each one verifiably offers, and — more importantly —
what could **not** be verified about each. It does not recommend one. Choosing a Hadith source is a
decision about religious authority and about legal exposure, and neither is a call this document is
entitled to make.

**Every factual claim below is marked with how it was established:**

- **[verified]** — read directly from the provider's own documentation, licence file or API
  specification, at the URL cited.
- **[unverified]** — the provider does not state it publicly, or the page could not be retrieved.
  Treated as unknown, never inferred.

The most consequential finding in this report is a pattern of `[unverified]` in one specific column,
and it is set out in §5 before the candidate tables, because it applies to all of them.

---

## 1. Why this gate exists at all

The Hadith screen previously shipped a collection list (Sahih al-Bukhari, Sahih Muslim, the Forty of
an-Nawawi) with real narration counts, over narration cards carrying translation, narrator,
reference and an **authentication grade** — all from a fixture, all labelled sample content by a
notice above the list.

That label was honest and insufficient. The failure is not that a user misses a badge; it is that a
grade — *Sahih*, *Hasan*, *Da'if* — is a scholarly judgement with a chain of transmission behind it,
and NoorLife had no authority to state one. Accurate collection names and correct counts made it
worse rather than better: they are exactly the details that make everything around them look
checked.

A provider decision therefore has to answer three questions, and the third is the one that is
usually skipped:

1. **Can we get the text?** (Every candidate below can supply text.)
2. **Are we licensed to redistribute it in a commercial app?** (This is where the candidates
   separate — see §5.)
3. **Whose scholarship is the grade?** A grading is attributed to a person or a body. If the API
   returns `grade: "Sahih"` with no `graded_by`, NoorLife would be republishing an anonymous
   scholarly judgement under its own name.

---

## 2. Candidate A — Sunnah.com API

The reference implementation behind sunnah.com, the site most widely cited for hadith in English.

| Field | Finding |
|---|---|
| **Operator** | sunnah.com, via the `sunnah-com` GitHub organisation |
| **API documentation** | `https://sunnah.stoplight.io/docs/api/`; OpenAPI spec at `github.com/sunnah-com/api` → `spec.v1.yml` **[verified]** |
| **Base URL** | `https://api.sunnah.com/v1/` **[verified]** |
| **Authentication** | API key in an `X-API-Key` request header **[verified]** |
| **How the key is obtained** | By opening an issue on the `sunnah-com/api` GitHub repository describing who you are and your intended use. There is no self-service portal. **[verified]** |
| **Approval criteria** | Not published. Applications are reviewed by hand. **[unverified]** |
| **Available collections** | `GET /collections` enumerates them; the spec does not fix the list. sunnah.com itself carries Bukhari, Muslim, Nasa'i, Abu Dawud, Tirmidhi, Ibn Majah, Malik's Muwatta, Riyad as-Salihin, Mishkat, the Forty of an-Nawawi, Shamail and Bulugh al-Maram. **[verified: endpoint exists; unverified: exact list served to a new key]** |
| **Arabic + translation** | Yes. Each hadith carries a `hadith[]` array keyed by `lang`, each entry with `body`, `chapterTitle` and `urn`. **[verified]** |
| **Grading metadata** | Yes, and correctly modelled: `grades[]` with **both** `grade` and `graded_by`. This is the only candidate that attributes its gradings in the schema. **[verified]** |
| **Reference metadata** | `collection`, `bookNumber`, `chapterId`, `hadithNumber`, and a stable `urn`. **[verified]** |
| **Endpoints of interest** | `/collections`, `/collections/{name}/books`, `/collections/{name}/books/{n}/hadiths`, `/hadiths/{urn}`, `/hadiths/refs`, `/hadiths/random` **[verified]** |
| **Rate limits** | Not stated in the specification or on the developer page. **[unverified]** |
| **Cost** | No pricing is published. Presumed free at the point of use; not confirmed for commercial use. **[unverified]** |
| **Licence / terms of use** | **No licence file and no terms-of-use document could be located** — not in the API repository, not on the developer page, not in the specification. The developer page states a commitment to "an open platform for hadith", which is a statement of intent, not a grant of rights. **[unverified — and this is the blocking finding]** |
| **Attribution requirements** | Not stated. **[unverified]** |
| **Caching / offline** | Not stated. An offline data dump is described on the developer page as something users may request, "not yet available" at the time of writing. **[unverified]** |
| **Direct from mobile?** | Technically yes — a plain header key over HTTPS. See §6 for why that is nonetheless the wrong integration. |
| **Privacy** | Requests disclose the device IP and the hadith being read to the provider. No account identifier is required by the API. |

**Strengths.** It is the canonical source, the schema is the right shape for what NoorLife needs to
display honestly, and it is the only candidate that names the grader alongside the grade.

**What stops it today.** No written licence. A hand-reviewed key issued on a GitHub thread is not
the same as permission to redistribute the text commercially, and NoorLife would be relying on an
absence of objection rather than on a grant.

---

## 3. Candidate B — `fawazahmed0/hadith-api`

A static JSON dataset served from the jsDelivr CDN.

| Field | Finding |
|---|---|
| **Operator** | An individual maintainer, via GitHub + jsDelivr |
| **API documentation** | `github.com/fawazahmed0/hadith-api` **[verified]** |
| **Base URL** | `https://cdn.jsdelivr.net/gh/fawazahmed0/hadith-api@{version}/{endpoint}` **[verified]** |
| **Authentication** | None. Public CDN. **[verified]** |
| **Available collections** | Multiple editions, named `{lang}-{collection}` (e.g. `eng-abudawud`). Exact list is in the repository's editions index. **[verified: naming scheme; unverified: full list]** |
| **Arabic + translation** | Multiple languages, per the repository's own description. **[verified]** |
| **Grading metadata** | An `/info` endpoint exposes "hadith grades, books reference". Whether gradings carry an attributed grader was **not** established. **[unverified — see §1, question 3]** |
| **Reference metadata** | Book and reference numbers, via `/info`. **[verified]** |
| **Rate limits** | "No Rate limits" — it is a CDN. **[verified]** |
| **Cost** | Free. **[verified]** |
| **Licence** | **The Unlicense** — public-domain dedication, explicitly permitting use "for any purpose, commercial or non-commercial". **[verified: read from the LICENSE file directly]** |
| **Attribution requirements** | None required by the licence. The maintainer requests contribution but does not condition use on it. **[verified]** |
| **Caching / offline** | Unrestricted by the licence. Bundling the dataset into the app is permitted by its terms. **[verified]** |
| **Direct from mobile?** | Yes, and it is a CDN designed for it. |
| **Privacy** | Requests go to jsDelivr, disclosing IP and requested path. Bundling the data offline would eliminate this entirely. |

**The trap, stated plainly.** The Unlicense is clean and it covers **the repository**. It does not
and cannot convey rights the maintainer never held. English hadith translations are, in many cases,
recent works under copyright held by their translators or publishers. A third party dedicating a
compilation of them to the public domain does not make the underlying translations public domain.

So the licence that looks like the strongest is the one whose strength depends entirely on a
question the licence itself does not answer: **where did each translation come from, and was it free
to be dedicated?** The repository's own quality process is described as crowdsourced — "whenever you
find any issue, please let me know" **[verified]** — which is a reasonable model for a community
dataset and not one NoorLife can point to as a verification chain.

---

## 4. Candidate C — `hadithapi.com`

| Field | Finding |
|---|---|
| **API documentation** | `https://hadithapi.com/` **[verified]** |
| **Authentication** | API key, generated automatically on registration and shown in the account profile **[verified]** |
| **Cost** | "This API service is free for everyone" **[verified]** |
| **Languages** | Arabic, Urdu and English **[verified]** |
| **Structure** | Books → chapters → hadiths **[verified]** |
| **Grading metadata** | Not documented on the landing page. **[unverified]** |
| **Rate limits** | Not documented. **[unverified]** |
| **Licence / terms** | Not published. **[unverified]** |
| **Attribution** | Not stated. **[unverified]** |
| **Caching / offline** | Not stated. **[unverified]** |
| **Commercial use** | Not addressed. **[unverified]** |
| **Operator identity** | Not stated on the site beyond a support email address. **[unverified]** |

**Assessment.** A self-service key makes it the easiest to integrate and the hardest to justify.
Six of the twelve columns that matter for a production decision are unpublished, including every
legal one, and the operator is not identified. Ease of integration is not a property this decision
should weight.

---

## 5. The finding that applies to all three

**Not one candidate publishes a licence for the hadith *translations* it serves.**

- Sunnah.com publishes no licence at all.
- `fawazahmed0` publishes a licence that covers its own compilation, not the provenance of the
  translations inside it.
- `hadithapi.com` publishes nothing.

The Arabic text of the canonical collections is centuries old and raises no copyright question. The
**English translation** is a modern work of authorship, and it is the part NoorLife would actually
display to most of its users. A licence that is silent on the translation is silent on the only part
that carries risk.

This is the question to put to any provider before approval, and it should be answered in writing:

> Which specific translation edition does each collection use, who holds its copyright, and under
> what grant are you licensed to redistribute it — and to sublicense it to us for use in a
> commercially distributed mobile application?

Until that has a written answer, all three candidates are the same candidate as far as this decision
is concerned.

---

## 6. Integration shape — direct client, or server proxy?

**A server proxy, in every case, and the reason is not primarily technical.**

1. **Credentials.** Candidates A and C use an API key. A key shipped in a mobile binary is a public
   key: it can be extracted from the bundle in minutes. NoorLife's Qur'an integration already
   settled this for exactly this reason — the Quran Foundation credentials live in a Supabase Edge
   Function and the client never sees them. A second content source calling directly would reopen a
   decision that has already been made and paid for.
2. **Privacy.** A direct call tells the provider which device is reading which narration. A proxy
   makes NoorLife the only party that sees the pairing, and NoorLife can choose not to log it.
3. **Attribution and integrity enforcement.** A proxy is a place to *refuse* to pass through a
   narration that arrives without a grade, without a grader, or without a reference. A direct client
   would have to reimplement that rule and would have to be trusted to keep it.
4. **Provider change.** A proxy makes replacing the provider a server deployment. A direct client
   makes it an app-store release, and the old version keeps calling the old provider for months.

Candidate B — a static CDN dataset — is the one case where a proxy is not needed for credential
reasons, and it invites a fourth option: **bundle the dataset into the app**, which removes the
network entirely, works offline and discloses nothing. That option is only available if §5 is
answered satisfactorily, because bundling is redistribution in its most literal form.

---

## 7. Privacy implications, summarised

| Shape | What the provider learns | What NoorLife learns |
|---|---|---|
| Direct from mobile | Device IP, every narration requested, request timing | Nothing beyond what it renders |
| Server proxy | Server IP only, aggregate volume | The pairing, unless it declines to log it — which it should |
| Bundled dataset | Nothing | Nothing; no request is made |

No candidate requires a user account, so none introduces a cross-service identity link. Reading
history stays on the device today and no provider decision changes that.

---

## 8. Unresolved questions — to be answered before any approval

These are ordered by how badly a wrong answer would hurt.

1. **Translation copyright.** §5's question, in writing, from the chosen provider.
2. **Grader attribution.** Does every grading returned carry a `graded_by`? A grade NoorLife cannot
   attribute must not be rendered — the screen would be restating an anonymous scholarly judgement.
   Sunnah.com's schema supports this; the others are unconfirmed.
3. **Which translation edition per collection**, so the reader can credit it. NoorLife already
   does this for the Qur'an and cannot do less for hadith.
4. **Rate limits and quota**, for A and C. Unknown limits make an offline cache mandatory and its
   size unplannable.
5. **Caching and offline permission.** May responses be stored on the device? For how long? A
   provider that forbids caching forbids offline reading, which changes the product.
6. **Commercial-use permission**, explicitly, given NoorLife has paid tiers.
7. **Service continuity.** Candidates B and C have no published operator and no service commitment.
   What is the plan when one stops responding — and does the locked state return, or does a stale
   cache keep serving?
8. **Corrections.** When a provider corrects a narration or a grading, how is a cached copy on a
   user's device invalidated? A wrong hadith that persists offline is worse than one that was never
   shown.
9. **Does NoorLife's existing Quran Foundation access help?** Partially and not enough: the Content
   API exposes a Hadith category, but it is *hadith references by ayah* — cross-references from a
   verse — not a browsable hadith library. **[verified]** It cannot fill this screen. It is worth
   asking Quran Foundation directly whether a hadith corpus is on their roadmap, since an approved
   relationship, a working Edge Function and a settled credential path already exist.

---

## 9. Recommendation

**None, deliberately.** §5 is unresolved for every candidate, and a recommendation made before it is
answered would be a recommendation about convenience.

What can be said is what the *next step* is, and it is not an integration: it is putting §8's
questions 1, 2 and 3 to Sunnah.com in the API-access issue, and to Quran Foundation in the existing
channel. Both are correspondence, not code, and neither commits NoorLife to anything.

Until a provider is approved in writing, the Hadith screen stays exactly as it is: the locked state,
the approved copy, disabled rows, and `No unverified narrations are shown.`

---

## Sources

- [sunnah.com — Developers](https://sunnah.com/developers)
- [sunnah-com/api on GitHub](https://github.com/sunnah-com/api)
- [sunnah-com/api — `spec.v1.yml`](https://github.com/sunnah-com/api/blob/master/spec.v1.yml)
- [fawazahmed0/hadith-api](https://github.com/fawazahmed0/hadith-api)
- [fawazahmed0/hadith-api — LICENSE (the Unlicense)](https://github.com/fawazahmed0/hadith-api/blob/1/LICENSE)
- [hadithapi.com](https://hadithapi.com/)
- [Quran Foundation — Content APIs](https://api-docs.quran.foundation/docs/category/content-apis/)
