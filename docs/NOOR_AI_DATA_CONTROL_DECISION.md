# Noor AI data-control decision — §F.10

**Decision date:** 2026-08-06
**Branch:** `feature/subscriptions-family-six`, recorded against `a789087`
**Satisfies:** `NOOR_AI_BACKEND_CONTRACT.md` §F.10 — "the data-control decision that must be reviewed
before live traffic"
**Status:** **Approved for development-only AI-3 synthetic smoke testing.** Nothing else.

This document is the written decision §F.10 demands, and it is deliberately narrow. It authorises a
bounded synthetic test and it authorises nothing beyond that. It does not complete AI-3, it does not
provision a key, it does not approve deployment, and it does not make NoorLife release-ready.

---

## 1. The decision as approved

> AI-3 will use default OpenAI API data controls solely for a bounded synthetic development smoke
> test. API data sharing and training opt-in will remain disabled. Requests will set `store:false`;
> no real user, module, religious-journal, health, family or account data will be transmitted.
> OpenAI may retain abuse-monitoring content for up to 30 days under default controls. NoorLife will
> seek Zero Data Retention eligibility before public beta and will review the privacy policy and
> store declarations before enabling user traffic.

That text is the decision. Everything below either states the facts it rests on, bounds what it
permits, or records what remains open. Where this document and the quoted decision could be read
differently, the decision text governs and the difference is recorded in §8 rather than smoothed
over.

### 1.1 The decision in tabular form

| Question §F.10 requires answering                          | Answer                                                                                                                      |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Which control applies — default / Modified Abuse Monitoring / ZDR? | **Default API data controls.**                                                                                       |
| Has an application been made for MAM or ZDR?               | **No.** Not applied for, not approved, not pending, as of this decision date.                                                 |
| Is API data-sharing / training opt-in enabled?             | **No**, and it remains disabled under this decision.                                                                          |
| What is retained, and for how long?                        | Provider abuse-monitoring logs may include prompts and responses, retained **up to 30 days**, subject to the exceptions in §3.2. |
| Is `store: false` required?                                | **Yes**, and it is already machine-enforced — see §4.                                                                         |
| What traffic is authorised?                                | **Synthetic NoorLife help/navigation prompts only**, written by a developer for the test — see §5.                            |
| Is real-user traffic authorised?                           | **No.** Prohibited by this decision at every level: development, public beta, and production.                                 |

---

## 2. What this decision authorises, and what it forbids

### 2.1 Authorised

- A **bounded synthetic smoke test** during AI-3 — §J row 18 — using default OpenAI API data
  controls.
- Transmission of **developer-authored synthetic prompts only**, of the kind §G permits Noor AI to
  answer: "where do I change my prayer reminder sound", "what does the Faith module do".

### 2.2 Forbidden by this decision

- **Real-user prompt traffic**, in any environment.
- **Public beta** and **production** user traffic.
- Enabling API data sharing or any training opt-in.
- Any claim, in shipped copy or a store declaration, that Zero Data Retention is active.
- Treating this document as satisfying any AI-3 gate other than the written data-control decision.

### 2.3 Not authorised because it is out of scope here

This decision is silent on — and therefore does not permit — key provisioning, model selection,
timeout and limit pinning, the §12.7 rate-limit store, deployment, and the §12.6 `safety_identifier`
choice. Each remains an open AI-3 item in its own right.

---

## 3. The facts this rests on

All sources are official primary documentation, consulted on the decision date. No blog, forum
answer, vendor summary or recollection was treated as authority. OpenAI's developer documentation
now lives at `developers.openai.com/api/docs/*`; the former `platform.openai.com/docs/*` paths issue
a 301 to it.

| Source                                                                | Consulted for                                                       |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| <https://developers.openai.com/api/docs/guides/your-data>              | Training default, abuse monitoring, retention, ZDR and MAM eligibility |
| <https://developers.openai.com/api/docs/guides/conversation-state>     | `store` default and what `store: false` disables                      |
| <https://support.google.com/googleplay/android-developer/answer/10787469> | Play Data Safety: collected vs shared, data types, purposes, ephemeral processing |
| <https://developer.apple.com/app-store/app-privacy-details/>           | Apple App Privacy: data types, purposes, Tracking, linkage            |

### 3.1 Training

The documentation states that "data sent to the OpenAI API is not used to train or improve OpenAI
models (unless you explicitly opt in to share data with us)."

This is a statement about the **default**, conditioned on an explicit opt-in that the customer
controls. It is recorded here in that form on purpose. NoorLife has not opted in and will not opt in
under this decision, so the default holds for NoorLife today — but "not used for training by
default, and NoorLife has not opted in" is the accurate claim, and "never used for training" is not.
See §7.

### 3.2 Abuse monitoring and its retention

Abuse-monitoring logs are "[l]ogs generated from your use of the platform, necessary for OpenAI to
enforce our Usage Policies and agreements and mitigate harmful uses of AI", and may include "certain
customer content, such as prompts and responses, as well as metadata derived from that customer
content, such as classifier outputs."

The retention sentence, in full:

> By default, abuse monitoring logs are generated for all API feature usage and retained for up to
> 30 days, unless longer retention is required by law, or is reasonably necessary to protect our
> services or any third party from harm.

Two things follow, and both are load-bearing:

1. **"All API feature usage."** Abuse monitoring is not scoped by the `store` parameter. It is the
   default posture for the platform.
2. **"Up to 30 days" is a ceiling with named exceptions, not a deletion guarantee.** The
   documentation itself carves out longer retention where required by law or reasonably necessary to
   protect the service or a third party from harm. NoorLife must not restate this as "deleted after
   30 days".

### 3.3 Zero Data Retention and Modified Abuse Monitoring

Both are approval-based programmes, not settings:

- "Eligible customers may have their customer content excluded from these abuse monitoring logs …
  by getting approved for the Zero Data Retention … controls", and these controls are "subject to
  prior approval by OpenAI and acceptance of additional requirements."
- Modified Abuse Monitoring "excludes customer content (other than image and file inputs in rare
  cases) … from abuse monitoring logs across all API endpoints", on the same prior-approval basis.
- Under ZDR, "the `store` parameter for `/v1/responses` and `v1/chat/completions` will always be
  treated as `false`, even if the request attempts to set the value to `true`." Not all endpoints
  are eligible for these controls.
- Even with enhanced controls, the documentation records a **Safety Retention** provision under
  which OpenAI "may retain and human review customer content when using these models that our
  classifiers detect as potentially violating our Usage Policies", and an **Eyes Off** provision
  excluding content from human review "unless required by applicable law".

**Neither programme is applied for or approved for this organization.** ZDR is therefore not active,
not guaranteed, and not automatically available. The exact model scope of the Safety Retention
provision is an unresolved fact — see §6.1 — and must be confirmed at application time rather than
assumed away.

### 3.4 `store` in the Responses API

Response objects "are saved for 30 days by default", and "[y]ou can disable this behavior by setting
`store` to `false` when creating a Response." The retention table records the Responses API as
having "a 30 day Application State retention period by default, or when the `store` parameter is set
to `true`."

---

## 4. `store: false` — required, already enforced, and not ZDR

### 4.1 It is required, and it is machine-enforced

`store: false` is not a convention someone must remember at the call site. It was made
unrepresentable-otherwise in AI-2 and carries into AI-3 unchanged:

| Enforcement                             | Where                                                                                  |
| ----------------------------------------- | ---------------------------------------------------------------------------------------- |
| The field's **type** is the literal `false`, not `boolean` | [ports.ts:272](../supabase/functions/noor-ai/ports.ts#L272)                |
| The handler sets it on every provider request | [handler.ts:368](../supabase/functions/noor-ai/handler.ts#L368)                       |
| A test asserts it was sent               | [handler-provider_test.ts:112](../supabase/functions/noor-ai/tests/handler-provider_test.ts#L112) |
| A client that tries to supply `store` is rejected | [handler-validation_test.ts:270](../supabase/functions/noor-ai/tests/handler-validation_test.ts#L270) |

§J row 18 additionally requires the live smoke test to confirm `store: false` was sent. AI-3 must not
weaken any of the above.

### 4.2 It is not Zero Data Retention, and must never be described as such

`store: false` declines the provider's **30-day Application State retention** of response objects
(§3.4). Abuse monitoring is a **separate** retention path that the documentation describes as
applying to "all API feature usage" (§3.2), and the only mechanisms the documentation offers for
excluding customer content from it are the approval-based ZDR and MAM programmes (§3.3).

> **`store: false` does not by itself eliminate default abuse-monitoring retention.** It is a
> reduction in what the provider keeps, not zero retention, and it is not a substitute for ZDR.

This restates §12.3 and §H.4 of the contract rather than replacing them.

---

## 5. Data boundary for AI-3 synthetic testing

### 5.1 Permitted upstream

Developer-authored **synthetic NoorLife help and navigation prompts only** — text invented for the
test, describing the app rather than any person.

### 5.2 Prohibited upstream

No item in this list may be transmitted to the provider during AI-3:

- Real user-generated prompt traffic of any kind.
- User profile data, email address, name, or display name.
- Raw user IDs, or any unhashed Supabase identifier.
- Module data of any module.
- Quran notes, religious-journal entries, or any faith-practice record.
- Health or wellbeing data.
- Family data, including any child's data.
- Subscription, billing, or account-state data.
- Tokens, keys, credentials, or session material.

### 5.3 Additional standing constraints

- **No conversation persistence.** `AI_CONVERSATION_STORAGE_EXISTS` stays `false`; AI-3 creates no
  conversation table and no client-side history. Persistence is AI-8's, with its own review.
- **No provider request IDs exposed to users.** Per §F.9, users see NoorLife's own
  `noorai_req_…` identifier only; the provider's `resp_…` and `x-request-id` stay server-side.
- **Logging is metadata-only.** §H.3 already forbids logging content, and that applies to the smoke
  test's terminal output as much as to production logs.

---

## 6. Draft disclosures — **drafts, not published declarations**

Everything in this section is **proposed wording held for future use**. None of it is published,
filed, submitted, or live.

- The privacy policy is **unwritten and unpublished** — `PRE_RELEASE_BACKLOG.md` §3.1 is still
  Blocked.
- The Play Data Safety declaration is **not filed** — §3.3 is still Blocked.
- The App Store privacy labels are **not filed** — §3.4 is still Blocked.

These drafts cover **the AI feature only**. The whole app still requires its own data inventory
before any declaration can be completed, and nothing here should be mistaken for that inventory.

### 6.1 Draft A — privacy-policy wording (DRAFT, NOT PUBLISHED)

> **Noor AI and your messages**
>
> When you send a message to Noor AI, the text of that message is sent to OpenAI, our AI service
> provider, so that a response can be generated. Without this, the feature cannot work.
>
> OpenAI states that data sent through its API is not used to train or improve its models by default,
> unless the developer explicitly opts in to share data. NoorLife has not opted in, and does not opt
> in.
>
> OpenAI may retain message content for up to 30 days for abuse monitoring — to enforce its usage
> policies and detect misuse — and may retain it for longer where required by law or reasonably
> necessary to protect its services or a third party from harm.
>
> NoorLife asks OpenAI not to store the response, and NoorLife does not keep a history of your AI
> conversations. Your messages are not saved to your NoorLife account.
>
> Please do not enter sensitive personal information — such as health details, financial details, or
> information about other people — into Noor AI messages.

Deliberately absent, and to stay absent: any claim that Zero Data Retention is in place, and any
claim that message content is never retained or is guaranteed to be deleted.

### 6.2 Draft B — Google Play Data Safety (DRAFT, NOT FILED)

Analysed against Google's current definitions, quoted in §3.

| Element                    | Draft position                                                                                                                              |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Data type                  | **App activity → Other user-generated content** — "[a]ny other user-generated content not listed here … For example, user bios, notes, or open-ended responses." An AI prompt is an open-ended response. |
| Collected?                 | **Yes.** Google defines collection as "[t]ransmitting data from your app off a user's device", which is exactly what an AI request does.        |
| Shared?                    | **Provisionally yes** — declare as shared. See the unresolved fact below.                                                                    |
| Purpose                    | **App functionality** — data used "for features that are available in the app".                                                              |
| Required or optional?      | Optional to the user: sending an AI message is a user-initiated action, not a condition of using the app.                                    |
| Ephemeral-processing exception | **Does not apply.** The exception requires data "retained for no longer than necessary to service the specific request in real-time". Up to 30 days of abuse-monitoring retention is not that. Disclosure is required. |

**Unresolved fact (shared vs not shared).** Google excludes transfers to a "service provider" —
"an entity that processes user data on behalf of the developer and based on the developer's
instructions" — from the definition of sharing. OpenAI processes the prompt to answer NoorLife's
request, which fits. But under default controls it also retains prompt content for **its own** Usage
Policy enforcement, which is not processing on NoorLife's instructions. Whether that secondary use
takes the transfer outside the service-provider exclusion is not resolvable from Google's published
definitions alone.

**Conservative provisional classification: declare as shared**, until either legal review determines
the service-provider exclusion applies, or MAM/ZDR approval removes the secondary retention. Naming
the provider and purpose in the declaration is accurate under either reading; claiming "not shared"
is only accurate under one.

**Second unresolved fact (data type).** Once AI-5 ships `/ai/chat/:conversationId` as a chat surface,
**Messages → Other in-app messages** — "[a]ny other types of messages. For example, instant messages
or chat content" — becomes arguable for the same text. The presentation of the shipped UI decides
it. Until then, "Other user-generated content" is the conservative single choice; if the chat framing
lands, the declaration should be re-examined rather than inherited.

### 6.3 Draft C — Apple App Privacy (DRAFT, NOT FILED)

An **AI-specific input into the eventual whole-app privacy label**, not a label and not a filing.

| Element             | Draft position                                                                                                                                     |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Data type           | **User Content → Other User Content** — "[a]ny other user-generated content". The prompt is not an email or text message between people, not gameplay content, and not a customer-support artefact. |
| Purpose             | **App Functionality** — "such as to authenticate the user, enable features …".                                                                       |
| Tracking?           | **No.** Apple defines tracking as linking data "with Third-Party Data for targeted advertising or advertising measurement purposes, or sharing data … with a data broker." Neither happens: the transfer exists to answer the question, OpenAI is not a data broker, and no advertising or measurement use exists. |
| Linked to the user? | **Provisionally Linked to You.** See the analysis below.                                                                                            |
| Optional-disclosure exception | **Does not apply.** It requires collection "only in infrequent cases not part of primary functionality". Noor AI is a primary feature.      |

**Linkage analysis, rather than an assumption.** Apple's rule is that "[d]ata collected from an app
is often linked to the user's identity … unless specific privacy protections are put in place before
collection to de-identify or anonymize it", such as "[s]tripping data of any direct identifiers, such
as user ID or name, before collection." NoorLife's outbound provider request carries no NoorLife
identifier today (§5.2), which points toward Not Linked. Two facts prevent settling on that:

1. **§12.6 is open.** The contract records an undecided question of whether to send a
   `safety_identifier`. A salted hash of the user id is a pseudonymous identifier crossing to a third
   party; if adopted, the linkage answer changes.
2. **Correlation is a linkage question too.** Apple's test covers linkage "by you and/or your
   third-party partners". Whether NoorLife's own request-scoped logs could re-link a prompt to an
   authenticated user has not been analysed against Apple's wording, only against §H.3's
   content-redaction rule.

**Conservative provisional classification: Linked to You**, until §12.6 is decided and the
correlation question is analysed. Over-declaring linkage is a disclosure error that harms nobody;
under-declaring it is a false label.

---

## 7. Critical review of the wording

§F.10's value is destroyed by six specific paraphrases. Each was checked against this document.

| Trap                                                        | Status in this document                                                                                                          |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| "Not used for training **by default**" flattened to "never used" | Held. §3.1 and Draft A both keep the default-plus-opt-in structure, and §3.1 states the wrong form explicitly so it is recognisable. |
| `store: false` presented as ZDR                             | Held. §4.2 is a dedicated section saying it is not, and §1.1 records ZDR as not applied for.                                       |
| "Up to 30 days" hardened into a deletion guarantee          | Held. §3.2 quotes the legal and harm-protection exceptions in full; Draft A carries them into user-facing copy.                    |
| ZDR described as active, guaranteed, or automatic            | Held. Recorded as approval-based and not applied for in §1.1, §3.3 and §8; the Safety Retention caveat is recorded rather than omitted. |
| Synthetic smoke traffic described as production traffic      | Held. §2 authorises a bounded synthetic test and forbids public beta and production; §5.1 bounds the prompts.                      |
| Draft disclosures described as filed                        | Held. §6 opens by stating none are published or filed and that `PRE_RELEASE_BACKLOG.md` §3.1–3.4 remain Blocked.                   |

One further check, not on the list: this document must not be read as completing AI-3. §9 states the
remaining gates explicitly for that reason.

---

## 8. Unresolved facts and release blockers

### 8.1 Unresolved facts

| #   | Fact                                                                                       | Blocks                                            |
| --- | -------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| 1   | Whether OpenAI qualifies as a Play "service provider" given default abuse-monitoring retention for its own policy enforcement | The final Play "shared" answer (§6.2)  |
| 2   | Whether the AI surface reads as chat once AI-5 ships, moving the Play data type             | The final Play data type (§6.2)                   |
| 3   | The §12.6 `safety_identifier` decision                                                      | The Apple linkage answer (§6.3)                   |
| 4   | Whether NoorLife's own logs could re-link a prompt to a user under Apple's wording          | The Apple linkage answer (§6.3)                   |
| 5   | The exact model scope of OpenAI's Safety Retention provision under MAM/ZDR                  | Any future claim about what ZDR would remove (§3.3) |
| 6   | Whether NoorLife is eligible for ZDR at all                                                 | The pre-beta path in §8.2                         |

### 8.2 Release blockers

- **ZDR must be applied for and the outcome reviewed before public beta.** Applying is required;
  **approval must not be assumed**, and the application being submitted is not the same event as
  the application being granted.
- **If ZDR is unavailable, denied, or granted on terms NoorLife does not accept, a fresh
  release/privacy decision is required before any real-user traffic.** This decision does not
  pre-authorise that outcome, and no fallback is approved here.
- The privacy policy, Play declaration and Apple labels must be reviewed and published or filed
  before user traffic — `PRE_RELEASE_BACKLOG.md` §3.1, §3.3 and §3.4, all Blocked.
- The whole-app data inventory must exist before any store declaration is completed
  (`PRE_RELEASE_BACKLOG.md` §3.3).
- §12.3's shipped privacy copy remains a release blocker owned by AI-10.

---

## 9. What this decision does not do

AI-3 is **not** complete, and this document closes exactly one of its gates.

| AI-3 gate                                            | State after this decision                                    |
| ------------------------------------------------------ | -------------------------------------------------------------- |
| §F.10's data-control decision recorded in writing    | **Satisfied by this document** — for development-only synthetic smoke testing |
| Provider key provisioned via `supabase secrets set`  | **Not done.** No key exists anywhere                          |
| Model selected and pinned, with rationale (§F.2)     | **Not done**                                                  |
| Timeouts set from measured latency (§F.7); token and spend limits pinned (§I.2, §I.3) | **Not done**         |
| Rate-limit store chosen (§12.7, §I.1)                | **Not done**                                                  |
| Deployment                                           | **Not done, and prohibited at this phase**                    |
| §J row 13b — shared rate limit                       | **Not run**                                                   |
| §J row 18 — live smoke test                          | **Not run.** No provider call has been made                   |
| §12.6 `safety_identifier` decision                   | **Open**                                                      |
| Platform log retention confirmed (§H.4)              | **Not done**                                                  |

No API key was added, no provider connectivity was created, nothing was deployed, and no OpenAI API
call was made in producing this record. Real-user traffic remains prohibited.
