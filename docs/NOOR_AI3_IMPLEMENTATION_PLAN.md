# Noor AI — AI-3 implementation plan

**Date:** 2026-08-06
**Branch:** `feature/subscriptions-family-six`, written against `2fd8e73`
**Implements the planning half of:** `NOOR_AI_BACKEND_CONTRACT.md` §K's AI-3 row
**Status:** **Planning and critical review only. AI-3 is not complete and is not started as an
implementation.**

No API key was requested, created or referenced by value. No Supabase secret was set. No provider
connectivity was written. Nothing was deployed. No OpenAI API call was made. Real-user traffic
remains prohibited.

This document exists because §F.2, §F.5, §F.7, §I.1, §I.2, §12.6 and §12.7 of the contract each
defer a number or a choice to AI-3, and because `NOOR_AI_DATA_CONTROL_DECISION.md` §9 lists them as
open. It proposes each one, with the reason, the verified price, and an explicit label saying whether
it is approved, recommended, or provisional until measured.

Nothing here is approved by being written down. §11 separates the four categories, and §11.2 is the
list a reviewer must actually agree to.

---

## 1. Sources

### 1.1 Official provider documentation, consulted on the date above

OpenAI's developer documentation is at `developers.openai.com/api/docs/*`; the former
`platform.openai.com/docs/*` paths 301 to it. No blog, forum answer, changelog summary, third-party
table or model recollection was treated as authority, and every number in §2 and §3 was read off one
of these pages.

| Page                                                                | Facts taken from it                                                                                                                            |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| <https://developers.openai.com/api/docs/models>                     | The current model list; that the GPT-5.6 family is `gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna`; that no dated snapshot ids are published for them; **the family-level reasoning-effort set shown for all three models — `none`, `low`, `medium`, `high`, `xhigh`, `max`** |
| <https://developers.openai.com/api/docs/models/gpt-5.6-terra>       | Context window, max output tokens, knowledge cutoff, supported endpoints and features, per-tier rate limits, price, and the >272K-input-token price multiplier. **No dated snapshot; the only snapshot name shown is `gpt-5.6-terra`.** This page does **not** repeat the effort list — see §2.2 |
| <https://developers.openai.com/api/docs/models/gpt-5.6-luna>        | The same fields for Luna, and its stated purpose — "cost-sensitive, high-volume workloads"                                                     |
| <https://developers.openai.com/api/docs/pricing>                    | Per-million input, cached-input, cache-write and output prices for every GPT-5.x model. Re-read on the date above; §3.2's table is these numbers |
| <https://developers.openai.com/api/docs/guides/reasoning>           | `reasoning.effort` values and that "Defaults are also model-dependent rather than universal"; `reasoning.mode`, that "`standard` is the default" and that pro mode increases token usage and cost; that reasoning tokens are billed as output tokens and count against `max_output_tokens`; the incomplete-with-no-visible-output case |
| <https://developers.openai.com/api/docs/guides/prompt-caching>      | Automatic caching, the 1,024-token minimum prefix, ≥30-minute reuse on GPT-5.6+, the 1.25× cache-write rate, `prompt_cache_key`'s stated role, and that caches are not shared between organizations |
| <https://developers.openai.com/api/docs/guides/token-counting>      | That the officially offered exact count is an **API call** — `POST /v1/responses/input_tokens` — and that local tokenizers "work for plain text, but they have limitations". **No tokenizer encoding is named for GPT-5.6 on this page.** See §4.1 |
| <https://developers.openai.com/api/docs/guides/spend-limits>        | That a monthly spend limit is a threshold which by itself does not interrupt traffic; that **"Enforce a hard limit"** must be turned on explicitly; that a project hard limit returns `429` with `project_spend_limit_exceeded`; that "Spend alerts do not enforce a cap"; and that **"Enforcement is not instantaneous, so recorded spend can slightly exceed the configured amount"** |
| <https://developers.openai.com/api/docs/guides/safety-best-practices> | `safety_identifier` guidance verbatim, and the input-length and output-token misuse controls                                                  |
| <https://developers.openai.com/api/docs/guides/rate-limits>         | Already cited by the contract §0.2: limits are organization/project-scoped, never per user                                                      |
| <https://developers.openai.com/api/docs/guides/your-data>           | Already relied on by `NOOR_AI_DATA_CONTROL_DECISION.md` §3; not re-litigated here                                                               |
| <https://supabase.com/docs/guides/functions/limits>                 | Edge Function memory (256MB), CPU-time (2s), wall-clock and 150s idle-timeout limits; 100 secrets / 48 KiB per secret                           |
| <https://supabase.com/docs/guides/functions/connect-to-postgres>    | The officially supported ways to reach Postgres from an Edge Function                                                                           |
| <https://supabase.com/docs/guides/functions/secrets>                | Already cited by the contract §0.2: `supabase secrets set`, `Deno.env.get`, and "never check your `.env` files into Git"                        |
| <https://supabase.com/docs/guides/database/vault>                   | That Vault is an officially documented database-secret mechanism: `vault.create_secret()`, `vault.update_secret()`, the `vault.decrypted_secrets` view, that secrets are usable from "Postgres Functions, Triggers, and Webhooks", and the warning that **"anyone that has access to the view has access to decrypted secrets"**. See §5.6 |
| <https://supabase.com/docs/guides/database/postgres/row-level-security> | That `postgres` and `service_role` bypass RLS; that "A 'security definer' function runs using the same role that created the function"; and the warning that **"Security-definer functions should never be created in a schema in the 'Exposed schemas' inside your API settings"** |
| <https://www.postgresql.org/docs/current/ddl-rowsecurity.html>      | That "Superusers and roles with the `BYPASSRLS` attribute always bypass the row security system", and that **"Table owners normally bypass row security as well, though a table owner can choose to be subject to row security with `ALTER TABLE … FORCE ROW LEVEL SECURITY`"**. This is the fact §5.7 corrects |
| <https://www.postgresql.org/docs/current/sql-createfunction.html>    | "Writing `SECURITY DEFINER` Functions Safely": the `SET search_path` requirement with `pg_temp` last, schema qualification, and that **"By default, execute privilege is granted to `PUBLIC` for newly created functions"** — so the `REVOKE` must be in the same transaction as the `CREATE` |

### 1.2 Repository, read from the working tree at `2fd8e73`

| Path                                                     | What it fixes for this plan                                                                                                              |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/NOOR_AI_BACKEND_CONTRACT.md`                       | Every constraint this plan must satisfy. Section references throughout are to this file unless stated otherwise                            |
| `docs/NOOR_AI_DATA_CONTROL_DECISION.md`                  | The already-recorded §F.10 decision, its synthetic-only boundary, and its §9 list of still-open AI-3 gates                                 |
| `supabase/functions/noor-ai/ports.ts`                    | `ProviderRequest`'s five fields, `HandlerConfig`'s five knobs, `RateLimiter`, `OperationalLogRecord`'s closed field set                    |
| `supabase/functions/noor-ai/production.ts`               | The three-layer fail-closed graph, and the placeholder config — `maxOutputTokens: 512`, `upstreamTimeoutMs: 20_000`, `handlerBudgetMs: 25_000` |
| `supabase/functions/noor-ai/handler.ts`                  | The order of checks, the single-retry budget rule, the empty-answer → `upstream_unavailable` mapping                                       |
| `supabase/functions/noor-ai/contract.ts`                 | `FinishReason`, the closed `ErrorCode` set, the status map                                                                                 |
| `supabase/functions/noor-ai/tests/source-scan_test.ts`   | The four absence assertions AI-3's implementation will collide with — see §9.2                                                             |
| `supabase/config.toml`                                   | `[functions.noor-ai] enabled = true, verify_jwt = true`; `jwt_expiry = 3600`; `enable_confirmations = false`                               |

---

## 2. §A — verification of the resolver result

Each row was checked against the pages in §1.1, not against expectation.

| Resolver claim                                                                       | Verified?                | What the documentation actually shows                                                                                                                                     |
| ------------------------------------------------------------------------------------ | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Latest family is **GPT-5.6**                                                          | **Confirmed**            | The models page's frontier section lists the GPT-5.6 family, knowledge cutoff Feb 16 2026, above 5.5 and 5.4                                                               |
| Flagship is **`gpt-5.6-sol`**                                                         | **Confirmed**            | "Frontier model for complex professional work", and the flagship framing is "GPT-5.6 Sol for complex reasoning and coding"                                                  |
| Balanced tier is **`gpt-5.6-terra`**                                                  | **Confirmed**            | Described as balancing intelligence and cost; priced between Sol and Luna                                                                                                  |
| Cost-sensitive tier is **`gpt-5.6-luna`**                                             | **Confirmed**            | "GPT-5.6 Luna is designed for cost-sensitive, high-volume workloads"                                                                                                       |
| The **Responses API** is appropriate                                                  | **Confirmed**            | Terra and Luna both list Responses among supported endpoints. This also matches §F.1, which already fixed the Responses API as the only surface NoorLife designs against    |
| **`reasoning.effort: "low"` is a supported setting for the GPT-5.6 family**            | **Confirmed at family level** | The models page shows the same effort set for all three GPT-5.6 models — `none`, `low`, `medium`, `high`, `xhigh`, `max`. `low` is in it. The Terra model page does not repeat the list, and **that silence is not evidence against it**: the reasoning guide's "check the relevant model page" caveat is satisfied by the family-level enumeration on the models page. Note that `minimal` — which the reasoning guide lists generically — is **not** in the GPT-5.6 set, so it must not be sent (§4.3) |
| Individual-user applications should use a stable privacy-preserving `safety_identifier` | **Confirmed, but weaker than "should"** | Verbatim: "Safety identifiers are recommended for products where individual users interact with a model, but they are not required", and "Hash the username or email address in order to avoid sending us any identifying information". **Recommended, not required** — which matters, because §12.6 is a privacy decision and a "required" reading would pre-empt it |

### 2.1 Two facts the resolver did not state, both load-bearing

1. **`max_output_tokens` is not an answer-length budget on these models.** Reasoning tokens are
   billed as output tokens and count against `max_output_tokens`, and the guide is explicit about the
   failure mode: hitting the cap "might occur before any visible output tokens are produced, meaning
   you could incur costs for input and reasoning tokens without receiving a visible response", with
   `status` `"incomplete"` and `incomplete_details.reason` `"max_output_tokens"`. The guide also
   recommends "reserving at least 25,000 tokens for reasoning and outputs when you start
   experimenting with these models". This contradicts the shape §F.5 assumes — see §9.1.
2. **Cache writes are not free on this family.** "For GPT-5.6 models and later model families, cache
   writes cost 1.25× the uncached input token rate", reported in `cache_write_tokens`, and caching
   only engages at "at least 1,024 tokens … a strict minimum". Every worst-case input cost in §4 is
   therefore computed at 1.25× list input price, not at list price.

### 2.2 What could not be verified, stated rather than assumed

| Open question                                                                     | Why it is open                                                                                                                                                                                                          | How the plan handles it                                                                       |
| --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| **The model's default `reasoning.effort`**                                          | The reasoning guide states "Defaults are also model-dependent rather than universal" and names a default only for `gpt-5.5` (`medium`). **No default is documented for any GPT-5.6 model.** An earlier draft of this plan asserted `medium`; that was not verified and is corrected here | This is a reason to send `effort` **explicitly** rather than rely on a default (§4.3). The §4.3 fallback no longer claims to know what the fallback lands on |
| Whether a bare **`gpt-5.6`** model id is callable                                  | The reasoning guide says "For standard workloads, begin with `gpt-5.6`", but neither the models page nor the pricing page lists a bare `gpt-5.6` row — only `-sol`, `-terra`, `-luna`                                     | Irrelevant to the recommendation; recorded so nobody later "simplifies" the slug to `gpt-5.6` |
| Whether `temperature` / `top_p` are accepted by Terra                              | Terra's supported-features list is "streaming, structured_outputs, function_calling, file_search, image_input, web_search, prompt_caching" — sampling parameters are absent, and no page documents them as supported      | **Send neither.** §4.4. This closes §F.2's "verified in AI-3 rather than assumed" item         |
| Latency of any GPT-5.6 model at any effort                                          | Not published anywhere on the pages consulted. Luna is described as offering "the lowest cost and latency" — a relative ordering, not a number                                                                            | Every timeout in §4 is provisional until §J.18 and §7.4 produce measurements                   |
| Whether the response object reports a resolved concrete model id                    | Not confirmed on the pages consulted                                                                                                                                                                                     | §7.3 records it as an observation to make during the smoke test, not as an asserted fact       |

---

## 3. §B — the model baseline, reviewed against AI-1's actual scope

### 3.1 What the endpoint actually has to do

AI-1's permitted subject set is exactly `NOOR_AI_APPLICATION_GUIDANCE_TOPICS` (§A.1): app
navigation, feature discovery, module directory, account help, subscription help. §F.3 gives the
model server-authored instructions and one `user` message; §H.1 forbids sending anything else. The
answer is "a help answer of a few short paragraphs" (§F.5) drawn from what the instructions say
about NoorLife's structure, and the model reads no user data, calls no tool, and does no retrieval.

That is a **short-form instruction-following task over a fixed corpus supplied in the prompt**. It is
not a reasoning task, not a coding task, and not a long-context task. The 1,050,000-token context
window of every GPT-5.6 model is irrelevant to it — §C.3 bounds the input in bytes and code points,
§F.3 forbids anything else travelling, and §4.1 derives a **conservative planning bound of 12,000
input tokens** from those hard limits. That bound is also comfortably below Terra's documented
272,000-input-token threshold, above which the model page states input is billed at 2× and output at
1.5× — so the base rates in §3.2 are the rates that apply, and no long-context multiplier is in play.

The one place quality is genuinely hard is **refusal correctness**: §G requires the model to hold
four boundaries, and §G.4 is explicit that over-refusal is a defect, not extra safety. That is what
an eval must measure (§3.5), and it is the only respect in which model choice is a safety question
rather than a cost question.

### 3.2 The three candidates, on verified numbers

Prices are per 1M tokens, **read off the live pricing page on the date above**, not from a cached
search snippet or from memory. The cache-write column is published as its own figure and is also the
documented 1.25× multiple of the uncached input rate; both readings agree.

| Model            | Input  | Cached input | Cache write (1.25×) | Output  | Context     | Max output | Documented positioning                                        |
| ---------------- | ------ | ------------ | ------------------- | ------- | ----------- | ---------- | ------------------------------------------------------------- |
| `gpt-5.6-sol`    | $5.00  | $0.50        | $6.25               | $30.00  | (frontier)  | —          | "Frontier model for complex professional work"; the model the guide pairs with pro mode for demanding tasks that tolerate higher latency |
| `gpt-5.6-terra`  | $2.00  | $0.20        | $2.50               | $12.00  | 1,050,000   | 128,000    | Balances intelligence and cost                                 |
| `gpt-5.6-luna`   | $0.20  | $0.02        | $0.25               | $1.20   | 1,050,000   | 128,000    | "designed for cost-sensitive, high-volume workloads"; "lowest cost and latency" |

**Cost per bounded request**, on the production request shape of §4 — the §4.1 planning bound of
**12,000** input tokens, 1,200 output tokens, cache-write rate assumed throughout, one billed attempt:

| Model            | Worst-case input | Worst-case output | Per attempt | Per user-visible request (2 attempts, §F.8) |
| ---------------- | ---------------- | ----------------- | ----------- | ------------------------------------------- |
| `gpt-5.6-luna`   | $0.0030          | $0.0014           | **$0.0044** | **$0.0089**                                  |
| `gpt-5.6-terra`  | $0.0300          | $0.0144           | **$0.0444** | **$0.0888**                                  |
| `gpt-5.6-sol`    | $0.0750          | $0.0360           | **$0.1110** | **$0.2220**                                  |

Terra is ~10× Luna and ~0.4× Sol. The multiples are unchanged by §4.1's larger input bound, because
the bound applies identically to all three; what the larger bound changes is the **absolute** figure,
which roughly doubles for Terra. Both multiples are large enough to matter at the ceilings in §4, and
neither is large enough to decide the question on its own for a product whose current authorised
traffic is one synthetic request.

Note which term now dominates. At 12,000 input tokens against 1,200 output tokens, Terra's input side
is $0.0300 against $0.0144 of output — so **input is roughly two-thirds of the worst-case bill**,
where under the discarded 4,000-token figure it was two-fifths. Any future work that shortens the
server instructions is therefore a cost control, not just tidiness.

### 3.3 Suitability, quality risk and latency, per candidate

| Dimension                                    | Luna                                                                                                   | Terra                                                                                                      | Sol                                                                                              |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Fit for short help/navigation answers        | Documented as built for exactly this shape of workload — high volume, cost-sensitive, short             | Comfortable fit; more headroom than the task needs                                                          | Overqualified. Nothing in §A.1 is "complex professional work"                                    |
| Expected quality risk                        | **Unmeasured, and concentrated where it hurts.** The risk is not prose quality but §G boundary handling: correctly refusing a diagnosis request while not over-refusing a Health-module navigation question, and §G.7's crisis path, which currently rests on instruction text alone (§12.5) | Lower on the same axis, still unmeasured                                                                     | Lowest expected risk, still unmeasured. Buying it before an eval exists means paying 2.5× for an unquantified improvement |
| Latency                                      | Documented only as relatively lowest                                                                    | Unknown                                                                                                     | Documented as the choice for tasks that "tolerate higher latency"                                |
| Rate-limit headroom (Tier 1)                 | 500 RPM                                                                                                | 500 RPM, 500K TPM                                                                                           | Not needed at the volumes in §4                                                                  |
| Effect on §4's ceilings                      | Spend ceiling would bind ~10× later                                                                     | The ceilings in §4 are sized on Terra                                                                       | Ceilings bind ~2.5× sooner for the same budget                                                   |

**No latency claim in this plan is a measurement.** The only latency facts available are the
documentation's relative ordering, and §4's timeouts are set generously precisely so that the smoke
test measures latency instead of colliding with a guess (§4.5).

### 3.4 Why not Sol initially

Four reasons, none of which is "Sol is bad":

1. **The task does not ask for frontier capability.** §A.1 is help and navigation over a corpus the
   server supplies. The documented positioning of Sol — complex professional work, complex reasoning
   and coding, pro mode for demanding tasks — describes a different job.
2. **It is the most expensive way to find out whether the cheap tier was enough.** No eval exists
   (AI-10 owns it, §K). Starting at the top means never learning whether Terra or Luna would have
   passed, while paying 2.5× or 25× for the privilege.
3. **It compresses every cost ceiling by 2.5×.** §I.2's spend ceiling is one of only two things
   bounding the bill, and §12.9 records that account creation is currently free because
   `enable_confirmations = false`, so per-user limits are evadable by re-registering. A higher unit
   cost makes the one remaining control fire sooner.
4. **It is the documented higher-latency choice**, and the client is a person waiting on a phone
   (§F.8's own reasoning about retry chains applies equally to model choice).

Sol remains the correct escalation if — and only if — an eval shows Terra failing on refusal
correctness or answer quality (§3.5).

### 3.5 What evidence would justify switching

The switch must be a measurement, not a preference. Both directions need the same instrument: the
AI-10 eval set, built per §G boundary and per §A.1 topic, run against a fixed prompt set with the
same server instructions.

**Down to Luna** — all of:

- Refusal correctness on the eval no worse than Terra's, measured separately for each of §G.2's four
  families, with **no** increase in false negatives (a boundary crossed) and no material increase in
  false positives (§G.4's over-refusal defect).
- §G.7 crisis prompts handled with emergency guidance first, no diagnosis, no invented number, in
  every locale tested.
- No increase in successful prompt injections from §G.9's list.
- Answer usefulness on the §A.1 topics judged acceptable by review, including at least one RTL/Arabic
  set, since §C.3.6 exists because this app is RTL-capable.
- Measured p95 latency and measured token usage from the §H.3 log fields, not estimates.

**Up to Sol** — any of:

- Terra fails the refusal-correctness bar above.
- Terra's answers on §A.1 topics are judged unusable and prompt revision does not fix it.
- A later phase widens scope (AI-6's module reads, AI-7's tools) such that the task is no longer
  short-form instruction following — in which case the model choice is re-reviewed anyway.

Until that eval exists, **any** model choice here is a cost-and-caution decision rather than a
quality decision, and this document does not pretend otherwise.

### 3.6 Verdict on the proposed baseline

| Proposed                                   | Verdict                                                                                                                                                                                                                    |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gpt-5.6-terra`                            | **Recommended** (§11.2). Adequate for the task, materially cheaper than Sol, and a safer starting point than Luna while §G's boundaries have no eval behind them. Luna is the intended destination once §3.5's evidence exists |
| `reasoning.effort: low`                    | **Recommended, and verified as a supported value** for the GPT-5.6 family on the models page (§2). What is *not* documented is the model's default effort (§2.2), which is a reason to set it explicitly rather than inherit. `low` is the right intent for a short help answer; acceptance is still confirmed live in the smoke test (§4.3) |
| Standard mode, not pro mode                 | **Recommended, and it is also the default.** Verbatim: "standard is the default", and pro mode "performs more model work than standard mode, increasing token usage and cost". Send no `reasoning.mode` at all — omitting is stronger than setting the default, because there is then nothing to flip |
| Responses API                              | **Approved already** by §F.1; confirmed supported by Terra                                                                                                                                                                  |
| Text in / text out only                    | **Approved already** by §H.1 and §A.2. Terra accepts image input; NoorLife does not send it                                                                                                                                  |
| `store: false`                             | **Approved and already machine-enforced** — the field's type is the literal `false` (`ports.ts`), the handler sets it, and two tests pin it. AI-3 must not weaken any of that                                                |
| No tools, no web search, no file/image input | **Approved already** by §F.4 and §A.2. Structural in `ProviderRequest`, which has no `tools` field to populate                                                                                                             |
| No `previous_response_id`, no `conversation`, no background mode | **Approved already** by §F.6                                                                                                                                                     |
| No provider-side persistence requested     | **Approved already** by §F.6 and the data-control decision                                                                                                                                                                 |
| "No prompt-cache configuration beyond safe platform defaults" | **Correct as stated, for AI-3** — see §4.6. Caching is automatic and cannot be switched off; what it costs is priced into §4.7 at the pessimistic (cache-write) rate. `prompt_cache_key` is **deferred out of AI-3 entirely** (§4.6.1): one synthetic request has nothing to cache against, and adding the field would widen §H.1's closed allow-list for no measured benefit |

### 3.7 The snapshot question, and the alias decision it forces

**Verified: no dated immutable snapshot of GPT-5.6 Terra is publicly documented.** The models page
shows no `model-YYYY-MM-DD` ids for the GPT-5.6 family, and the Terra model page's only snapshot name
is `gpt-5.6-terra` itself. The same is true of Luna.

So the instruction "do not pin an alias if a dated immutable snapshot exists and is appropriate"
cannot be followed as written: there is nothing else to pin. The slug **must** temporarily be treated
as a **controlled, reviewed alias**, with the controls that implies:

1. **One place.** The slug is a function secret / configuration value read with `Deno.env.get`, never
   a literal in the function source. This is not merely §F.2's rule — `source-scan_test.ts:212`
   asserts that no `gpt-…` string appears in any production file, so a literal would fail the suite.
2. **Versioned.** `model_config_version` (already an §H.3 field, and already listed in `ports.ts` as
   arriving with the provider in AI-3) changes whenever the slug or any generation parameter changes,
   so a log line attributes an answer to a configuration.
3. **Observed, not assumed.** During the smoke test, record whatever concrete model the response
   object reports (§7.3). If it exposes a resolved dated id, that id becomes the thing to pin the
   moment it is documented.
4. **Re-verified before it matters.** Before any traffic beyond §J.18 — and again before public beta
   — re-read the models page for a dated snapshot and pin it if one exists. An alias can change
   behaviour underneath a passing eval, which is precisely the risk §F.2 was written to avoid.
5. **A model change is a configuration change plus a re-run of §J**, as §F.2 already requires. An
   alias silently moving is therefore an untested model change, and is called out here as the
   standing risk of this decision rather than a residual detail.

---

## 4. §C — request ceilings

Two columns throughout: **Dev smoke** is what the §J.18 synthetic test may run with, and it is the
only column authorised by `NOOR_AI_DATA_CONTROL_DECISION.md`. **Production initial** is a proposal
for a future phase, is not approved, and is provisional wherever it depends on a measurement that
does not exist. `HandlerConfig` already injects five of these, so most are configuration, not code.

### 4.1 Input — what is actually enforced, and what is only estimated

This section replaces an earlier draft that claimed a **4,000-token hard ceiling**. That claim was
wrong in kind, not merely in size, and the correction matters more than the number:

- It converted code points to tokens at an assumed **2 tokens per code point**. No page in §1.1
  documents any code-point-to-token ratio for GPT-5.6. A ratio that holds for ordinary prose is not a
  *bound*, and adversarial Unicode — long combining sequences, unusual scripts, byte sequences the
  tokenizer splits finely — is precisely where an assumed ratio fails.
- It described a post-response measurement as enforcement. `input_tokens` arrives **with the
  response**, after the request has been sent and billed. It can confirm or refute a bound; it can
  never impose one, and it cannot retroactively recover the cost of a request that exceeded it.

So the honest structure is three distinct things, and this section keeps them apart.

#### 4.1.1 What is hard, enforced, and pre-request

These are the only pre-request limits that exist. They are byte and code-point limits, they are
already implemented in AI-2, and §J rows 4a and 4b already test them:

| Limit                                | Value                    | Where                                       |
| ------------------------------------ | ------------------------ | ------------------------------------------- |
| Request body, before JSON parsing    | **8,192 bytes**          | §C.3.1 — checked on `Content-Length` and on the body stream, so the cap is not bypassable by a lying header |
| `message`, after trimming            | **1,000 Unicode code points** | §C.3.6 — code points, not UTF-16 units, so an Arabic question is not penalised    |
| `languageHint`, the only envelope field that travels | one of exactly **`en`** or **`ar`** — **≤ 2 bytes** | `allow-lists.ts:62`. Anything else is discarded and replaced by the default, so the outbound value cannot be attacker-chosen |
| `instructions`                       | a **server constant**, built by a zero-argument function | `policy.ts:215` — `buildInstructions()` takes no parameters, so no request data can enter it |

`surface` is deliberately absent from that list: `ProviderRequest` has exactly five fields
(`ports.ts:264`) and the route string is not one of them, so it contributes nothing to the outbound
payload.

#### 4.1.2 The measured maximum UTF-8 byte length of everything that travels

Measured, not assumed. `buildInstructions()` was evaluated at this commit's tree and its output
measured:

| Outbound field   | Measured today                         | Bound to assert in a test              | Basis                                                                                       |
| ---------------- | -------------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------- |
| `instructions`   | **1,748 UTF-8 bytes** (1,742 code points; 3 non-ASCII) | **≤ 7,000 UTF-8 bytes**                | A test asserts the *byte* length of the built text, so the bound cannot drift as §G's derived copy grows. 7,000 is ~4× today's value — deliberate headroom, since `PROHIBITED_TOPICS` is mirrored from `src/` and a fifth topic appears here automatically (`policy.ts:202`) |
| `userInput`      | ≤ 1,000 code points                    | **≤ 4,000 UTF-8 bytes**                | 1,000 code points at UTF-8's 4-byte worst case. §C.3.1's own reasoning already states this: "1000 code points at UTF-8's 4-byte worst case is 4000 bytes" |
| `languageHint`   | 2 bytes                                | **≤ 2 UTF-8 bytes**                    | The two-entry allow-list above                                                               |
| `store`, `maxOutputTokens` | —                            | —                                      | A boolean literal and an integer; no text                                                    |
| **Total**        | —                                      | **≤ 11,002 UTF-8 bytes**               | Sum of the asserted bounds                                                                   |

This total **is** hard, in the sense that every term in it is either a compile-time constant with a
test on it or a runtime limit already enforced before the provider is reached.

#### 4.1.3 From bytes to a billing bound — and why it is still an estimate

The planning bound used throughout this document is **12,000 input tokens**.

It is derived as follows. Byte-level BPE tokenizers emit tokens that each consume at least one byte of
the input, so token count cannot exceed UTF-8 byte count; 11,002 bytes then implies at most 11,002
tokens, and 12,000 rounds that up with ~9% of headroom for the request framing the provider adds
around the fields (message role labels, JSON structure) which this document cannot measure.

**And that derivation is a billing estimate, not a model-token guarantee.** Stated plainly because it
is the honest limit of what can be established from §1.1's pages:

1. **The tokenizer for GPT-5.6 is not documented.** The token-counting guide names no encoding for it,
   and the tiktoken encodings that *are* documented (`o200k_base`, `cl100k_base`, `p50k_base`) are
   listed against earlier model families. The "one token ≥ one byte" property is a property of
   byte-level BPE, which is a reasonable belief about this tokenizer and **not** a statement any
   official page makes about it.
2. **Billable input is not only the text NoorLife sends.** Whatever the API adds as request framing is
   billed too, and its size is not published. The 998 tokens of headroom between 11,002 and 12,000 is
   an allowance for it, not a measurement of it.

So: 12,000 is a **conservative pre-request cost bound** that does not depend on any undocumented
code-point-to-token ratio, and it is labelled an estimate everywhere it is used. In practice real BPE
compresses ordinary prose to roughly 4 bytes per token, so the true count for the smoke request should
land nearer 500 tokens than 12,000 — which is the direction an estimate should err in.

#### 4.1.4 Verifying the fixed prompt offline — preferred, and currently blocked

The right way to tighten this is a **build-time, offline** token count of the fixed server
instructions: a test that tokenizes `buildInstructions()`'s output with an official tokenizer for the
selected model and asserts the count, adding no runtime dependency and making no network call.

**That is not available today.** The token-counting guide's exact-count mechanism is
`POST /v1/responses/input_tokens` — an API call, which is excluded twice over: this phase makes no
provider call at all, and even later a per-request preflight would be a second round trip on the
request path. And the offline route needs an official encoding name for GPT-5.6, which no consulted
page provides.

Therefore:

- **AI-3 adds no tokenizer, no tokenizer dependency, and no preflight call.** The handler's pre-request
  control stays the byte and code-point limits of §4.1.1, which is what it can actually enforce.
- **Open item, not a design gap:** if an official tokenizer encoding for GPT-5.6 is published, add the
  build-time assertion at that point and replace the byte-derived estimate with a measured constant for
  the fixed prompt. Recorded in §11.3.

#### 4.1.5 Post-call verification, and the abort threshold

`input_tokens` is already an §H.3 log field. It is **verification**, never enforcement:

| Reported `input_tokens` | Meaning                                                        | Action                                                                                                                                  |
| ----------------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| ≤ 2,000                 | Expected. The bound is doing its job as a pessimistic ceiling   | Record it (§7.3 check 6). Do not narrow the bound on one data point                                                                      |
| 2,001 – 8,000           | Higher than expected but inside the bound                       | Record it and **re-derive §4.1.3 before any traffic beyond §J.18.** The framing allowance is evidently larger than assumed                |
| 8,001 – 12,000          | Inside the bound but with little margin left                    | **Review trigger.** The bound is only marginally conservative; §4.7's cost model must be recomputed at the observed value before production |
| **> 12,000**            | The planning bound is **wrong**                                 | **Abort.** Run §7.2 step 10 — stop, flip the kill switch, do not retry, and re-derive §4.1 before anything else is concluded. Every cost figure in §4.7 and §4.8 is invalid until it is re-derived |

The last row is the one that changes behaviour: it is why §7.3 records `input_tokens` and why §4.7's
figures are labelled provisional rather than final. A bound that nothing checks is a guess with a
table around it.

### 4.2 Maximum output tokens

This is the number §2.1 changes. A cap sized for "a few short paragraphs" is **not** safe on a
reasoning model, because reasoning tokens are billed as output tokens and consume the same budget,
and exhausting it can return `status: "incomplete"` with no visible text while still billing input
and reasoning. The current placeholder of `512` (`production.ts:164`) is squarely in that danger
zone, and the guide's "reserve at least 25,000 tokens" advice is at the other extreme — sound for
experimentation, unusable as a cost bound for a help endpoint.

| Value                         | Dev smoke   | Production initial | Reason                                                                                                                                                                                       |
| ----------------------------- | ----------- | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `max_output_tokens`           | **2,000**   | **1,200** — provisional | Dev is generous on purpose: §J.18's job is to produce a real answer and to *measure* how many reasoning tokens `low` effort actually spends. A starved, billed, empty response would fail the test for the wrong reason. Production drops to 1,200 only once logs show the true reasoning cost |
| Answer length the user sees   | ~2–4 short paragraphs | ~2–4 short paragraphs | Unchanged by the cap; the cap is dominated by reasoning headroom, not by prose                                                                                                     |

**Provisional until §J.18 measurement.** The production value is a guess about reasoning-token usage
until `output_tokens` and the reasoning breakdown are in the logs. §4.7 defines what "measured" means.

### 4.3 Reasoning effort

| Value              | Dev smoke                        | Production initial                | Reason                                                                                                                                     |
| ------------------ | -------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `reasoning.effort` | **`low`** — a documented value for this family (§2) | `low`, or `none` if eval-clean | Lower effort favours speed and cost, which is the right trade for a short help answer. Sent explicitly because the family's default effort is **not** documented (§2.2) |
| `reasoning.mode`   | **Omitted**                      | Omitted                           | Verbatim: "GPT-5.6 models support `standard` and `pro` reasoning modes in the Responses API. `standard` is the default." Omitting means there is no field to flip to `pro`, which "performs more model work than standard mode, increasing token usage and cost" |

**`minimal` must not be sent.** The reasoning guide lists it among effort values generally, but it is
**not** in the set the models page shows for the GPT-5.6 family (`none`, `low`, `medium`, `high`,
`xhigh`, `max`). An earlier draft offered it as a production alternative; that is removed.

**`none` is a real option for later, not now.** It is documented for "Latency-critical tasks that do
not benefit from any reasoning", which arguably describes this workload — but it changes behaviour on
exactly the axis §G cares about, so it is eval-gated (§3.5) rather than chosen on latency grounds.

**Fallback, decided in advance so nobody improvises during the smoke test:** `low` is documented as
supported, so a rejection would itself be the finding. If the request *is* rejected for an unsupported
`effort` value, remove the `reasoning` object entirely, re-run once, and **record what effort the
response reports** — do not assume the fallback lands on `medium`, because no default is documented for
this family (§2.2). Do not try `minimal`, `none`, or a different model in the same session. One
variable at a time.

### 4.4 Sampling parameters

**Send none.** Not `temperature`, not `top_p`. Terra's documented feature list does not include them,
and §F.2 requires this to be "verified in AI-3 against that model's documented parameter support
rather than assumed" — the verification result is "not documented as supported", so the honest action
is omission. This also keeps §C.6's rejection of client-supplied `temperature` meaningful: the server
does not send one either.

### 4.5 Timeouts

Supabase's own limits frame these: Edge Functions have a **2s CPU-time** limit, a **150s request idle
timeout** ("If an Edge Function doesn't send a response before the timeout, 504 Gateway Timeout will
be returned"), 150s wall clock on Free and 400s on paid plans, and 256MB memory. Awaiting a provider
fetch is not CPU time, but ES256 JWT verification, JSON parsing and instruction assembly are — so the
2s CPU budget is a real constraint on the non-network path, and any future per-request tokenizer or
hashing loop spends from it.

| Budget                | Dev smoke    | Production initial     | Reason                                                                                                                                                                                       |
| --------------------- | ------------ | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `upstreamTimeoutMs`   | **30,000**   | **12,000** — provisional | Dev is deliberately loose so the smoke test *measures* latency instead of aborting at a guessed threshold. Production is a starting point to be replaced by measured p95 (§4.7), not a claim about the model |
| `handlerBudgetMs`     | **70,000**   | **28,000** — provisional | Must exceed the upstream budget plus auth, rate-limit and one permitted retry (§F.7). Dev: 30 + 1 backoff + 30 = 61s of upstream worst case, inside 70s and far inside the 150s idle timeout. Production: 12 + 1 + 12 = 25s, inside 28s |
| `retryBackoffMs`      | **1,000**    | **1,000**              | One retry means one delay; jitter buys nothing without a chain (already reasoned in `ports.ts`)                                                                                                |
| Retry count           | **at most 1** (so at most 2 provider attempts per handler request) | **at most 1** (same) | §F.8 is already decided and this plan does not reopen it. The retry is **automatic and conditional**, never manual: it fires only on an explicitly eligible transient failure (`rate-limited` or `transient-server-error`, `handler.ts:101`) and only if it fits the remaining budget. So one handler request normally makes **one** attempt and makes two only under that condition (§4.8.0). It is repeated here because **a retry doubles the worst-case cost**, and every ceiling is computed on the 2-attempt worst case |

Two honest notes. A 25-second worst-case wait is poor product behaviour, and the right fix is a lower
measured timeout, not a lower budget that turns slow answers into `504`s. And the handler already
skips the retry when it will not fit the remaining budget, so raising `upstreamTimeoutMs` silently
disables retries — a coupling to check when either number changes.

### 4.6 Prompt caching

Caching is automatic and cannot be switched off, so "safe platform defaults" needs unpacking:

- **Whether caching engages at all is not established here.** The minimum is "prefixes containing at
  least 1,024 tokens", and §4.1 deliberately stopped producing token estimates for the instruction
  text. Today's instructions are 1,748 UTF-8 bytes, which at typical BPE compression is a few hundred
  tokens — i.e. plausibly **below** the minimum, not above it. The earlier draft's "~1,500 tokens, so
  caching will engage" was a consequence of the discarded ratio and is withdrawn.
- **The cost model does not depend on the answer.** §4.7 prices *every* input token at the cache-write
  rate ($2.50/1M for Terra), which is the **more expensive** of the two possibilities — if caching does
  not engage, input bills at $2.00/1M instead. Assuming the write rate is therefore conservative in
  both directions, which is why the question can stay open without weakening the ceiling.
- A cache hit is impossible for the smoke test regardless: one request has no earlier prefix to match.
- Caches "are not shared between organizations", which is the relevant privacy fact and is recorded
  rather than relied on for any user-facing claim.

#### 4.6.1 `prompt_cache_key` — deferred out of AI-3

**Decision: AI-3 sends no `prompt_cache_key`, and it is removed from this plan's recommendations and
from the proposed §H.1 additions.** An earlier draft recommended it for production and listed it as an
allow-list addition; that was premature on four counts, each sufficient on its own:

1. **There is nothing to route.** §J.18 authorises exactly one synthetic request (§7.3). Cache routing
   affects which of several requests land on which cached prefix; with one request the field cannot
   change any outcome.
2. **There is no conversation state and no repeated workload.** §F.6 forbids provider-side conversation
   state, and no production traffic of any volume is approved — so the workload the field optimises
   does not exist yet.
3. **No caching benefit has been measured.** No `cache_write_tokens` or cached-input figure has ever
   been observed for this endpoint. Adding a cost optimisation before observing the cost is the same
   error §4.1 was just corrected for.
4. **It widens §H.1's closed allow-list.** §H.1 is closed by design: every field that travels to a third
   party is a reviewed diff (§6.5). Spending that review on a field with no measurable benefit devalues
   the mechanism — the allow-list is only strong while every entry in it has a reason.

**Recorded as a later optimisation candidate**, admissible only after **all** of:

- repeated production traffic is authorised (which it is not — real-user traffic remains prohibited);
- caching behaviour and its cost are **measured** from `cache_write_tokens` and cached-input usage over
  that traffic, showing a benefit worth the change;
- its privacy and data-control behaviour is rechecked against the then-current documentation, including
  what a cache key implies about request grouping;
- the §H.1 allow-list change receives its own separate review, not a mention inside another decision.

If it is ever adopted, the design constraint already established stands: derive it from
`policy_version` and `locale`, **never** from the user. A user-derived key would both defeat caching —
each user getting their own prefix — and create a *second* stable pseudonymous identifier crossing to a
third party, which is exactly what §6 exists to control.

### 4.7 Worst-case cost, and which numbers are provisional

Worst case per attempt = (§4.1's **12,000-token planning bound** × cache-write rate) +
(`max_output_tokens` × output rate). Per user-visible **handler request** = ×2, because §F.8's automatic
retry can produce a second provider attempt on an eligible transient failure and a retried attempt is
billed (§4.8.0). The ×2 is the **worst case**, not the expected case: a request that succeeds on its
first attempt costs the per-attempt figure.

| Shape                             | Input                       | Output                    | Per attempt | Per handler request (×2 worst case) |
| --------------------------------- | --------------------------- | ------------------------- | ----------- | ---------------- |
| **Dev smoke** (Terra, 2,000 out)  | 12,000 × $2.50/1M = $0.0300 | 2,000 × $12/1M = $0.0240 | $0.0540     | **$0.1080**      |
| **Production initial** (Terra, 1,200 out) | 12,000 × $2.50/1M = $0.0300 | 1,200 × $12/1M = $0.0144 | $0.0444     | **$0.0888**      |

Rounded **up** for ceiling arithmetic: **$0.11 per dev handler request**, **$0.09 per production
request**. The dev figure of **~$0.108 → $0.11** is the retry-inclusive conservative Terra worst case for
the one authorised request, and it is the pricing basis every ceiling in §4.8 is derived from. It stands
on §3.2's live-verified rates and §4.1's byte-derived input bound; **this correction does not revisit
either.** Both figures roughly doubled when the discarded 4,000-token ceiling was replaced, which is the
point of recomputing rather than patching.

Steady-state cost will be materially lower — cached input is $0.20/1M against $2.00, a typical answer
will not approach the cap, and §4.1.3 expects the real input count to be a small fraction of 12,000 —
but a ceiling sized on the typical case is not a ceiling.

**Provisional until §J.18 and the first live measurements exist** (§11.3 repeats this list):

| Value                                    | Becomes final when                                                                                      |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `max_output_tokens` production value      | `output_tokens` and the reasoning share are logged over a real prompt set, showing actual headroom needed |
| `upstreamTimeoutMs` production value      | A measured p95 upstream duration exists from `upstream_duration_ms`                                      |
| `handlerBudgetMs` production value        | Derived from the above, keeping §F.7's strict inequality and the retry-fits rule                          |
| The **12,000-token input planning bound** | It does not become final by measurement — it is an estimate by construction (§4.1.3). It becomes *tighter* if an official GPT-5.6 tokenizer encoding is published (§4.1.4), and it is **re-derived or aborted on** per §4.1.5's thresholds |
| The 1.25× cache-write assumption          | `cache_write_tokens` is observed in a real response. Note it is deliberately the pessimistic assumption (§4.6), so it cannot under-count |
| Every per-user and global volume ceiling  | Any real usage data exists at all — today there is none, and §12.9 warns that free account creation makes per-user limits evadable |
| `reasoning.effort: low`                   | It is documented (§2) and accepted live (§4.3), and an eval shows the boundary behaviour holds            |

### 4.8 Rate and spend ceilings

Sized from the spend ceiling backwards, so the two controls are coherent rather than each guessing.
All values are configuration, changeable without a deploy (§I.1's requirement).

#### 4.8.0 What the dev column is sized for — exactly one request

The approved development data decision authorises **exactly one manually initiated synthetic
user-visible handler request** (§J.18, §7.3). Not two. Not "one plus a spare". The dev ceilings below
are sized on that one request and nothing else.

Two earlier drafts of this section were both wrong, in opposite directions, and both are corrected
here: the first allowed 20 requests per day as though a batch of smoke prompts had been authorised; the
second allowed 2 per day — "one authorised plus one spare" — which invented a second request the
approval does not grant. A ceiling of 2 is an authorisation for 2. There is no spare.

**The one handler request may produce at most two provider attempts, and only under a narrow
condition.** This is not a second request and must never be described as one:

| | |
| --- | --- |
| Handler requests authorised | **Exactly 1**, manually initiated by the operator |
| Provider attempts, normal case | **1** |
| Provider attempts, permitted exception | **2**, and only when *both* hold: the first attempt failed with an **explicitly eligible transient failure**, and §F.8's existing automatic retry policy performed **exactly one** retry |
| Eligible transient failures | Only the two `isRetryable` outcomes in `handler.ts:101` — `rate-limited` and `transient-server-error`, i.e. §F.8's "transient rate limiting and transient server errors — provider `429` (other than the billing/quota cases), `500`, `502`, `503`, and connection resets". Everything §F.8 lists as **never retried** produces exactly one attempt |
| Additional condition | §F.8's budget rule still applies: the retry happens only if it fits the remaining handler budget, so even an eligible failure may yield one attempt |
| A second manually initiated handler request | **Not authorised** — see §4.8.0's stop rule below |

**Do not state that exactly one provider attempt must always occur.** An earlier phrasing implied that,
and it is wrong: one permitted transient retry legitimately produces a second attempt. Two attempts with
a retry proven in the logs is a **pass**, not an anomaly (§7.3 check 9).

**Stop rule if the single request does not cleanly succeed.** If it fails, is inconclusive, or cannot be
verified:

1. **Stop testing.**
2. **Do not send another request** — not a retry by hand, not a "quick re-run", not a replacement
   request, not a variation of the prompt.
3. **Obtain fresh explicit approval before any new user-visible request.** The next request is a new
   authorisation decision, not a continuation of this one.

This is the same posture §7.2 step 10 and §7.3's abort criteria already take; it is stated here because
this is the section a reader consults when deciding what the ceilings permit.

Every dev cell counts **user-visible handler requests**, not provider attempts. The production column
is a **future** proposal for a phase that has not been decided (§11.2 R14); nothing in this correction
approves any production or free/paid tier value.

| Ceiling                              | Dev smoke        | Production initial (future, unapproved) | Reason                                                                                                                                       |
| ------------------------------------ | ---------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Per-user / 60 s                      | **1**            | 5                  | Dev: the single authorised request. A second submit inside the minute is refused, which is the desired behaviour — a double tap must not become a second billed request     |
| Per-user / hour                      | **1**            | 25                 | Dev: the single authorised request. Production bounds a determined single user                                                                                              |
| Per-user / day                       | **1**            | 60                 | Dev: the single authorised request. Production bounds cost per account: 60 × $0.09 = **$5.40**/user/day worst case, which is why the global ceilings below must be the real defence |
| Global / 60 s                        | **1**            | **10**             | Dev has one operator sending one request. Production dropped from 20 to 10 **because of §4.1's recalculation**: at 10 user-visible RPM with one retry each, worst case is 20 attempts/min ≈ 4% of Terra's Tier-1 500 RPM, but 20 × 13,200 tokens ≈ **264K TPM against a 500K TPM Tier-1 limit** — 53%. At 20 RPM the same arithmetic gives ~528K TPM, which **exceeds** the provider limit. **TPM, not RPM, is now the binding provider constraint**, and that inversion is a direct consequence of the corrected input bound |
| Global / day                         | **1**            | **150**            | Dev: the single authorised request, worst case $0.11 (§4.7). Production: 150 × $0.09 = **$13.50**, inside the $15.00 daily ceiling below. The count fell from 300 because the per-request cost rose — the money is the anchor, not the count |
| Request quota counter increments      | **exactly once** for the one handler request | once per handler request | The counter is a **handler-request** counter. §F.8's permitted automatic retry does **not** increment it — one user-visible request is one quota unit however many provider attempts it makes. That separation is deliberate: a retry must not consume the user's quota for a failure the user did not cause |
| Provider-attempt and cost accounting  | **every actual attempt recorded separately**, including the permitted retry | same | Distinct from the quota counter above. Spend is real money per attempt, so the retry is counted and billed on its own. `upstream_attempts` (§H.3) is the field that makes the two views reconcilable, and §4.7's ×2 worst case exists precisely because the second attempt is billed |
| Concurrency lease                     | **1 handler request** | 4 — provisional    | Dev permits one handler request to hold the lease; there is no second concurrent request to admit. Note the lease is per **handler request**, so a retried attempt runs inside the lease its request already holds rather than taking a second. Production's 4 needs the same shared store as the rate limiter, with a lease that expires, because a per-isolate counter is not a global concurrency limit any more than it is a rate limit (§I.1) |
| Daily provider-spend ceiling          | **$0.50**        | $15.00             | **A damage-containment ceiling, not an allowance** — see §4.8.1. Breach stops calling the provider and returns `503` until the window rolls (§I.2) |
| Monthly provider-spend ceiling        | **$2.00**        | $250.00            | **A damage-containment ceiling, not an allowance** — see §4.8.1. Production is deliberately **less** than 30 × the daily ceiling, so sustained daily maximum usage trips the monthly control around day 17. That is defence in depth, not an inconsistency |
| Provider-side **project hard spend limit** | **$2.00/month, "Enforce a hard limit" ON, spend alert at $0.50** | Set to match NoorLife's own monthly ceiling, plus an alert well below it | A second **independent** damage-containment ceiling in the provider's own accounting, per the production-best-practices guidance on separate projects with their own rate and spend limits. It is the control that still works when NoorLife's own spend counter is wrong — e.g. against §4.8's stale price table. It is *not* a budget to spend (§4.8.1) and *not* exact (§4.8.2) |
| Error-rate breaker                    | **Not required** for a single request; must exist before any wider traffic | Consecutive-failure threshold + cooldown | §I.2 requires it and `HandlerConfig` has no knob for it yet (§9.3). Sizing it on one synthetic request would be inventing a number |

**Reconciling the two counters, because they deliberately disagree.** For the one authorised dev
request, the expected numbers are:

| Quantity                                   | Expected           |
| ------------------------------------------ | ------------------ |
| Handler requests                           | 1                  |
| Request quota counter                      | 1                  |
| Provider attempts, normal case             | 1                  |
| Provider attempts, with one permitted retry | 2                  |
| Attempts recorded in cost accounting        | 1 or 2 — whatever actually happened |
| `upstream_attempts` in the §H.3 log         | 1 or 2, matching   |

A dev day therefore reaches **at most two provider attempts in total**, and only via the automatic
retry. Anything above two is a failed verification (§7.3 check 9).

#### 4.8.1 The spend ceilings are damage containment, not an allowance

**The $0.50/day and $2.00/month ceilings — NoorLife's own and the provider-side project hard limit — do
not authorise anything.** They exist to bound the damage if something is wrong: a bug, a loop, a
mis-sized estimate, a leaked key. Stated explicitly because a dollar figure in a plan reads as a budget:

- They do **not** authorise extra prompts.
- They do **not** authorise extra handler requests beyond the one in §4.8.0.
- They do **not** authorise retries outside §F.8's policy.
- They do **not** authorise spending up to those amounts. Expected actual spend for the authorised
  activity is **$0.11 or less** (§4.7). The gap between $0.11 and $2.00 is headroom for a mistake, not
  room to work in.

Reaching even the daily ceiling during the smoke test would itself be a finding requiring investigation,
because the one authorised request cannot legitimately cost $0.50.

#### 4.8.2 The provider hard limit is a strong control, not an exact one

Worth its own note because a ceiling that is described as exact will be trusted as exact. From the
spend-limits page, verified live:

- A monthly spend limit **on its own does not stop traffic**. Enforcement requires turning on **"Enforce
  a hard limit"**, at the organization or the project level. Step 3 of §7.2 must therefore verify the
  toggle, not merely that a number was entered.
- **"Spend alerts do not enforce a cap."** They notify and traffic continues. An alert is the early
  warning *for* the hard limit, not a substitute — and the plan uses both, at different values, for that
  reason.
- Reaching a project hard limit returns **`429` with `project_spend_limit_exceeded`**. From NoorLife's
  side that is an upstream failure like any other and maps through the existing paths; it is not a
  distinct client-visible outcome.
- **Enforcement is not instantaneous.** Verbatim: "Enforcement is not instantaneous, so recorded spend
  can slightly exceed the configured amount." So a $2.00 hard limit means *approximately* $2.00, and
  **may overshoot slightly**. It bounds the bill; it does not pin it to the cent.

Nothing here should be read as saying the provider limit is a perfect cap. It is the strongest external
control available and it is deliberately paired with NoorLife's own server-side ceilings precisely
because neither is exact and neither should be the only one.

**Spend accounting is itself an unimplemented dependency.** §I.2's ceilings are "counted server-side
against the daily budget", which means the shared store of §5 must hold a spend counter as well as
request counters, updated from `input_tokens`/`output_tokens` after each call using a server-held
price table. That price table is a copy of the pricing page and will go stale — so it must carry the
date it was read and be re-verified whenever the model or the ceilings change. Recorded here because
a stale price table silently under-counts spend, which is the failure mode a spend ceiling exists to
prevent.

### 4.9 Response-size validation

§C.4's `finish` and §I.5's `malformed_upstream` need explicit rules for a reasoning model:

| Provider response                                                       | Handling                                                                                                                                              |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Body larger than **256 KiB**                                            | Stop reading and treat as `malformed_upstream` → `502`. A bounded output implies a bounded body; an unbounded read is a memory risk against a 256MB limit |
| More than one text output item, or any tool/function call                | `malformed_upstream` → `502`, and **not executed** (§F.4, §J.14c — already implemented)                                                                 |
| Complete, non-empty text ≤ **8,000 code points**                        | `finish: "complete"`                                                                                                                                   |
| Text longer than 8,000 code points                                      | `malformed_upstream` → `502`. A 1,200-token answer cannot reach 8,000 code points, so this is a structural impossibility check, not a truncation policy |
| `status: "incomplete"`, `incomplete_details.reason: "max_output_tokens"`, text non-empty | `finish: "length"` (§C.4, §F.5) — the client must present it as incomplete                                                                |
| `status: "incomplete"` with **empty** text — the reasoning-starvation case | `502 upstream_unavailable` (the handler's existing empty-answer path), **plus a distinct log flag** so it is not silently indistinguishable from a broken provider. See §9.1 — this needs a reviewed addition to `OperationalLogRecord` |
| Valid JSON, no text output at all                                        | `502` (§J.14b — already implemented)                                                                                                                   |

The starvation row is the one that matters operationally: it is a **billed** failure caused by
NoorLife's own cap, its remedy is to raise `max_output_tokens`, and a 502 with no distinguishing
field would send whoever investigates it looking at the provider instead.

---

## 5. §D — the shared rate-limit store

§I.1's hard constraint is already recorded in code and in the contract: an Edge Function runs in
ephemeral, horizontally-scaled isolates, so an in-memory counter resets on cold start and each
isolate counts separately. `production.ts` therefore ships `unavailableRateLimiter`, and the handler
turns `unavailable` into `503` — the endpoint currently fails closed because no store exists.

### 5.1 The five options, evaluated

| # | Option                                     | Shared across isolates | Atomic                                                          | Assessment                                                                                                                                                                                                                                                    |
| - | ------------------------------------------ | ---------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 | **Supabase Postgres table + `SECURITY DEFINER` RPC** | Yes                    | Yes — one `INSERT … ON CONFLICT DO UPDATE … RETURNING` statement | **The right direction, and not yet a complete design — see §5.6.** No new vendor, no new privacy declaration, and no new *function-environment* secret, because the call carries the caller's own JWT. Costs: a new table (schema-review gate, §5.4), a database round trip on the request path, a deliberate revision of two source-scan assertions (§9.2), and **an in-database secret whose storage, grants and rotation must be settled before any migration exists** |
| 2 | Direct Postgres connection from the function | Yes                    | Yes                                                             | Officially supported — "Edge Functions are a server-side technology, it's safe to connect directly to your database using any popular Postgres client". But it needs a connection string as a secret and a dedicated least-privilege role, which is more credential surface than option 1 for the same result. Keep as the fallback if option 1's grant model fails review |
| 3 | Separate Redis-compatible service            | Yes                    | Yes — native atomic counters, TTL expiry                        | Technically the best fit and **rejected for now** on non-technical grounds: a new sub-processor, a new DPA and privacy-policy disclosure while the privacy policy is still unwritten (`PRE_RELEASE_BACKLOG.md` §3.1), a second secret, and a second thing that can be down. See §5.5 |
| 4 | An officially supported Edge-runtime shared store | —                      | —                                                               | **None exists that this plan may rely on.** The Edge Functions limits page documents no shared or persistent store, and does not state that Deno KV, Deno Cron or Deno Queues are supported. Absence of a support statement is not support, so no design may depend on it |
| 5 | In-memory counter                            | **No**                 | Within one isolate only                                         | **Explicitly rejected as the production control**, restating §I.1 and §12.7. It "yields a limit that is neither enforced nor observable", and §J.13b exists to fail exactly this implementation. It is not acceptable for the dev smoke test either — the honest posture for a single request is a real store or a refusal, and the graph already refuses |

### 5.2 The option-1 design, and how far it gets

**Option 1**: one table plus one `SECURITY DEFINER` function, called from the Edge Function with the
**caller's own JWT** through the officially supported `supabase-js` path, `EXECUTE` granted to
`authenticated` only.

**This is a design in progress, not an approved one.** §5.6 works through where the keying secret
lives, and concludes that **R8 is blocked pending the §5.4 schema and security review**. The table
below is what option 1 does settle; read it alongside §5.6 and §5.7, which correct two claims it
previously overstated.

| Requirement                                | How option 1 meets it                                                                                                                                                                                                                                                        |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shared across function instances           | Postgres is the shared store. Every isolate reads and writes the same rows                                                                                                                                                                                                    |
| Atomic operations                          | One statement per window — `INSERT … ON CONFLICT (key, window_start) DO UPDATE SET count = counter.count + 1 RETURNING count` — so increment-and-read is a single atomic step with no read-modify-write race                                                                    |
| Fails closed if unavailable                | Already true: any error or timeout from the limiter yields `unavailable`, and `handler.ts` returns `503`. AI-3 must keep that mapping and give the call its own short timeout inside the handler budget                                                                         |
| No client-controlled counter               | The counter key is derived **inside** the SQL function from `auth.uid()`, so a caller cannot name someone else's key or its own. The function only ever increments and returns a decision — there is no reset, no decrement and no delete exposed. A user calling the RPC directly can only spend its own quota faster |
| No raw user ID stored                      | The stored key is a digest, never `auth.uid()` itself. The table holds no column that can carry a uuid                                                                                                                                                                        |
| Server-derived key                         | HMAC over `auth.uid()` with a dedicated salt, computed **inside** the `SECURITY DEFINER` function so the salt never leaves the database. This is a **different** salt and a **different** value from §6's `safety_identifier` — the rate-limit key never leaves NoorLife, and reusing one secret for an internal key and an outbound identifier would couple a privacy decision to an operational one. **Where that salt lives was unspecified in the earlier draft; §5.6 is the missing design, and it is why R8 is blocked** |
| Retention and cleanup                      | Rows are `(key_digest, window_kind, window_start, count)`. Windows older than **48 hours** are deleted — long enough that a day window is never truncated mid-window, short enough that the table holds no history worth analysing. Deletion runs opportunistically inside the same function (bounded row count per call) so no scheduler dependency is introduced by this plan; a scheduled job may replace it later if that proves insufficient |
| No service-role credential introduced casually | None is introduced. The call uses the caller's JWT. §B.2's service-role row still reads **Never**, and §12.10's warning against wiring one in "for later" is respected                                                                                                     |
| Schema / RLS / security review before migration | Required, and it is a gate (§5.4). **§5.7 corrects how this control actually works** — RLS with no policies is not what makes the table unreachable, because a definer-owned function bypasses RLS by design. Table privileges and schema exposure are the control; RLS is defence in depth |

The spend counters and the concurrency lease of §4.8 live in the same store, for the same reasons.
Splitting them across two mechanisms would mean two failure modes and two things to review.

### 5.3 The costs of the option-1 design, stated plainly

1. **A database round trip on every request**, before the provider call. It consumes handler budget
   and can itself time out — and a limiter that times out fails the request closed, so an unhealthy
   database makes Noor AI unavailable rather than unmetered. That is the correct trade and it is
   still a real availability cost.
2. **A direct-call caveat.** Because `EXECUTE` is granted to `authenticated`, a signed-in user can
   call the RPC directly through the REST API and increment their own counter. They cannot decrement
   it, reset it, or touch anyone else's, so the effect is self-denial. The alternative — a privileged
   role so the function is unreachable by users — costs a new credential, which §B.2 makes the more
   expensive mistake. Recorded so the trade is reviewed rather than discovered.
3. **`auth.uid()` inside the function requires the request to carry the user's JWT.** If a later
   phase ever needs the limiter on an unauthenticated path, this design does not extend to it and a
   different one must be reviewed.

### 5.4 Yes — this triggers the module-schema review gate

`PRE_RELEASE_BACKLOG.md` §4.1 requires schema review before tables exist, and §12.7 states outright
that AI-1 "must not create the table" because "the phase forbids migrations, and
`PRE_RELEASE_BACKLOG.md` §4.1 requires schema review first". A rate-limit counter is not a *module*
table, but it is a new table with an RLS story, a retention policy and a privileged function, so it
goes through the **same** gate. Treating it as exempt because it holds no user content would be
exactly the shortcut the gate exists to stop.

**What the review must settle, beyond the table shape.** §5.6 and §5.7 add items that are not
schema-shaped and would otherwise fall between reviews:

1. The actual grants on `vault.secrets` and `vault.decrypted_secrets` for `anon` and `authenticated`,
   read off the project — and revoked if anything is there (§5.6.A).
2. Whether `vault` appears in the Data API's exposed-schema list (§5.6.A).
3. The exposed-schema tension in §5.7 point 5 — signed off explicitly, or resolved by choosing a
   different shape.
4. That `FORCE ROW LEVEL SECURITY` is **not** set on the counter table (§5.7 corollary).
5. That the `REVOKE … FROM PUBLIC` on the function is in the same transaction as its `CREATE`.
6. The salt provisioning statement and the rotation procedure, including the fact that rotation resets
   all live counters for one window.
7. Which of §5.6.A / 5.6.C / 5.6.D is adopted, recorded with its privacy consequence.

**No migration is created by this step.** No file was added under `supabase/migrations/`, no SQL was
written, no dependency was added, and **no salt was generated** — §5.6.A's provisioning statement is
written down, not run. The migration, its RLS configuration and its function are AI-3 implementation work
that starts *after* the review in §11.2, and R8 is `Blocked` until then.

### 5.5 The vendor and privacy consequence of choosing Redis instead

Recorded so the rejection in §5.1 is reviewable rather than asserted. Adopting a Redis-compatible
service would create, at minimum:

- **A new sub-processor** to name in the unwritten privacy policy (`PRE_RELEASE_BACKLOG.md` §3.1,
  Blocked) and to account for in the Play and Apple disclosures (§3.3, §3.4, both Blocked).
- **A processing-location question.** Even a keyed digest plus a timestamp is behavioural data about
  an identifiable-by-linkage account, held outside both existing trust domains.
- **A new secret** in the function's environment, which widens §B.2's table by a row.
- **A DPA and a data-inventory entry**, neither of which exists yet.

None of that is a reason Redis is wrong; all of it is work that must precede it. Postgres avoids
every item because Supabase is already NoorLife's processor and already in the inventory.

### 5.6 Where the keying secret lives — the design the earlier draft omitted

The earlier draft said the function "computes an HMAC of `auth.uid()` with a dedicated salt that never
leaves the database" and then **never said where that salt is**. That is not a detail; it is the whole
security property. A secret with no stated home gets improvised at migration time, and the improvisation
is usually one of the things this section rules out.

**Hard exclusions, restated so no option can quietly satisfy them.** The salt must not be: embedded in a
migration file; embedded in the function's source text; stored in an ordinary readable table; committed
to the repository; supplied by the client in any form; reused from another secret (not the provider key,
not a JWT signing key or legacy JWT secret, not §6.3's `safety_identifier` salt); or assumed to exist.

#### 5.6.A Supabase Vault — the recommended direction, with two unverified facts

**Official support: confirmed.** Supabase Vault is documented as a Postgres extension for storing
encrypted secrets, with `vault.create_secret()` to insert, `vault.update_secret()` to rotate, and a
`vault.decrypted_secrets` view that "automatically decrypts secrets at query time". The docs state the
secrets are usable "anywhere in your database: Postgres Functions, Triggers, and Webhooks", and — the
load-bearing fact — that "the encryption key is never stored in the database alongside the encrypted
data", so a database dump does not yield plaintext.

| Question the review must answer                | Design                                                                                                                                                                                                                                                             |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Who can read the decrypted secret              | Whoever holds `SELECT` on `vault.decrypted_secrets`. The docs are explicit and unhedged: **"anyone that has access to the view has access to decrypted secrets"**, and "which roles should have access to the `vault.secrets` table should be carefully considered". Intended set: `postgres` only |
| Can `authenticated` callers retrieve it        | **They must not be able to, and this is the first thing to verify rather than assume.** See the two unverified facts below                                                                                                                                            |
| How the definer function accesses it           | The function is owned by `postgres` and declared `SECURITY DEFINER`, so it executes with the owner's privileges and can `select decrypted_secret from vault.decrypted_secrets where name = 'noor_ai_rate_key_salt'`. The caller gains nothing from this: `EXECUTE` on the function does not confer `SELECT` on the view |
| `search_path`                                  | `SET search_path = ''` on the function, per the Postgres guidance to "exclude any schemas writable by untrusted users" and to keep `pg_temp` from shadowing objects. With an empty path, **every** object must be schema-qualified — which is the next row, not a separate nicety |
| Schema qualification                           | `vault.decrypted_secrets`, `auth.uid()`, `extensions.hmac(...)`, `noor_ai.rate_counter`, `pg_catalog.*`. No bare identifiers anywhere in the body                                                                                                                     |
| Revoke `PUBLIC` and `anon`                     | Postgres grants `EXECUTE` to `PUBLIC` on new functions by default, so `REVOKE ALL ON FUNCTION … FROM PUBLIC` must run **in the same transaction as `CREATE FUNCTION`** — the docs give exactly this pattern, to avoid a window in which the function is world-executable |
| Minimum grant                                  | `GRANT EXECUTE … TO authenticated` and nothing else. Not `anon`, not `PUBLIC`, not `service_role`                                                                                                                                                                     |
| SQL injection / dynamic SQL                    | **No dynamic SQL at all.** No `EXECUTE`, no `format()`, no string concatenation of identifiers. The function takes typed scalars only — the window kind as an enumerated type rather than free text — and every statement is a static literal. There is nothing to inject into |
| What the function may return                   | A narrow composite: allowed/denied, the current count, and a retry-after. **Never** the digest, never the salt, never a row from the counter table. The return type is part of the security boundary                                                                    |
| `auth.uid()` being NULL                        | If no JWT is present `auth.uid()` returns NULL. The function must **raise and deny**, never compute a digest over NULL — otherwise every unauthenticated caller shares one bucket. `verify_jwt = true` makes this unreachable through the Edge Function, but the RPC is also reachable directly (§5.3), so the check belongs in the function |
| Provisioning, without the value in a migration or chat | **Generate the salt inside the database so its plaintext never exists outside it.** A one-time statement run by the operator as `postgres`, in the dashboard SQL editor or `psql`: `select vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'noor_ai_rate_key_salt', '…')`. The value is never typed, never displayed, never pasted into a terminal that echoes, never put in a file under `supabase/migrations/`, and never shown in this document or any chat. The migration may reference the secret **by name**; it must not carry the value |
| Rotation                                       | `vault.update_secret()` with a freshly generated random value by the same in-database method. **Rotation invalidates every existing counter**, because the digests change — a bounded, self-healing effect that clears within the 48-hour retention window. It is not a silent side effect: rotate deliberately, on suspected exposure, and expect one window of reset quotas |

**Two facts this plan could not verify from the documentation, and must not assume:**

1. **The default privileges of `anon` and `authenticated` on `vault.secrets` and
   `vault.decrypted_secrets`.** The Vault page states that access must be protected "with the appropriate
   SQL privilege settings at all times" but does not publish what the defaults are on a Supabase project.
   The review must **inspect the actual grants** on the project and revoke anything beyond `postgres`.
2. **Whether `vault` is in the project's exposed-schema list** for the Data API. If it were, the
   decrypted view could be reachable over REST by whichever role holds `SELECT` on it. The review must
   read the exposed-schema setting rather than trust that a system schema is excluded.

Neither is a reason to reject Vault. Both are reasons the design is **not finished**, and finishing them
requires looking at a live project — which is exactly what §5.4's gate is for.

#### 5.6.B Edge-computed HMAC passed into the RPC — rejected

The tempting shortcut: keep the salt as an Edge Function secret (`Deno.env.get`), compute the digest in
TypeScript, pass it to the RPC as a parameter. No database secret at all.

**Rejected, because the RPC cannot bind a client-supplied digest to `auth.uid()`.** `EXECUTE` is granted
to `authenticated`, so the RPC is reachable directly over REST by any signed-in user (§5.3), and if the
digest is a parameter then the caller chooses it:

- **Limit evasion, which is the real attack.** A caller passes a fresh random digest on every call. Each
  one lands on an unused bucket, and the per-user limit becomes unenforceable — the exact failure §I.1
  exists to prevent, reintroduced through the front door.
- **Quota poisoning of another user**, if the attacker ever learns their digest. That is not far-fetched:
  §H.3's log carries a `user_hash`, so digests are values that exist outside the database and can leak
  through a log export. A design whose security depends on a digest staying secret is a design that
  breaks when a log line is shared.
- **The fix defeats the purpose.** The only way the RPC can authoritatively bind the digest to
  `auth.uid()` is to recompute it — which requires the salt in the database, which is option A. The edge
  computation then buys nothing and adds a second copy of the secret.

Not approved, under the criterion set for it: the RPC cannot bind the digest to `auth.uid()`
authoritatively, so this option is out.

#### 5.6.C Unsalted digest, or raw `auth.uid()` — the honest fallback, honestly described

**Raw `auth.uid()`: rejected.** §H.2 deny-lists the raw user id and §B.2's reasoning applies; storing it
would also give the table a column that can carry a uuid, which §5.2 specifically avoids.

**Unsalted `sha256(auth.uid())`: viable, and it must not be called pseudonymous.** Stated without
euphemism:

- **It is linkable, trivially.** It is a deterministic function of a value NoorLife already stores. Anyone
  with read access to both the counter table and the user table re-links every row by computing one hash
  per user — a full-table join, not an attack. Hashing does not make an identifier pseudonymous when the
  input population is known and enumerable *from your own database*.
- **It is not reversible by brute force**, which is a different and much weaker claim. A v4 uuid has a
  2^122 keyspace, so an attacker holding only digests and no user list cannot enumerate them. That is the
  only adversary this option resists.
- So the correct label is **"an in-database linkable digest"**, not "a pseudonym". §B.2 already says
  "without a secret salt, a user-id hash is reversible by anyone who can enumerate uuids" — the more
  precise statement is that it is *linkable* by anyone who can list them, which is a lower bar.

**Its privacy cost, weighed against its operational simplicity.** The salt's real value is protecting the
digest **after it leaves the database** — in a log export, a support dump, a backup handed to someone.
The rate-limit digest is designed never to leave (§5.2), and anyone with read access to the database
already holds the user table, so *inside* that boundary the salt adds little. Against that, the unsalted
option removes an entire secret lifecycle: no Vault dependency, no grant inspection, no rotation
procedure, no unverified facts. What it costs is a documented privacy weakening, a divergence from §B.2's
one-policy-everywhere principle, and a value that becomes a linkage key the moment it appears anywhere
outside the database.

**Disposition:** the acceptable fallback **if and only if** §5.6.A fails the review, adopted explicitly
with the linkability recorded in the data inventory — never adopted silently as "it's hashed anyway".

#### 5.6.D A dedicated least-privilege role and direct connection — the fallback with a credential

Option 2 of §5.1, revisited for the secret question. A dedicated Postgres role with `EXECUTE` on the
function and nothing else, reached over a direct connection.

- **Credential implications.** It needs a connection string — host, port, database, role, password — as a
  function-environment secret. That widens §B.2's table by a row, and §12.10 warns specifically against
  wiring privileged database credentials in "for later". It is a genuine credential, with a rotation
  story of its own, and rotating it is a function redeploy rather than a SQL statement.
- **Connection-pooling implications, which are not incidental.** Edge Function isolates are ephemeral and
  horizontally scaled (§I.1's own premise), so every cold isolate opens a new connection and connections
  are never reused across them. Direct connections at any concurrency must therefore go through
  Supabase's pooler in transaction mode rather than to the database port, or `max_connections` becomes
  the availability limit for the whole project — not just for Noor AI. This is a project-wide risk taken
  on behalf of one counter.
- **One real advantage, stated fairly.** With a dedicated role there is no `auth.uid()` in the session, so
  the user id becomes a parameter — which looks like §5.6.B, but is not, because the *caller* is the Edge
  Function, which has already verified the JWT (`verify_jwt = true`). The binding is authoritative at the
  Edge boundary, and the RPC stops being reachable by end users at all, which removes §5.3's direct-call
  caveat entirely.
- **Disposition:** keep as the second fallback. It trades a privacy-neutral design for a credential and a
  pooling constraint, and §B.2 is clear which of those NoorLife treats as the more expensive mistake.

#### 5.6.E Disposition — R8 is blocked

**Recommended direction: 5.6.A (Vault).** Its caller-binding is complete — the digest is computed inside
a definer function from `auth.uid()`, which is derived from the verified JWT and cannot be supplied or
chosen by the caller. Its secret lifecycle is complete **on paper**: generated in-database by CSPRNG so
the plaintext never exists outside it, referenced by name in the migration, rotated with
`vault.update_secret()`.

**But R8 is marked `Blocked`, not `Recommended`**, because two facts the design depends on are
unverified (§5.6.A's list) and one architectural tension is unresolved (§5.7's exposed-schema conflict).
The criterion set for this section was to recommend a design only if the secret lifecycle **and** the
caller-binding are complete. The caller-binding is; the lifecycle has a verification gap that cannot be
closed from documentation. So the honest state is blocked pending the §5.4 schema and security review,
with 5.6.A as the design to complete, 5.6.C as the documented fallback if its grant model fails, and
5.6.D as the fallback after that.

Calling this "recommended" would mean a reviewer approving a secret whose reachability nobody has
checked. That is the failure mode the gate exists for.

### 5.7 Correcting "a deny-all RLS table reachable only through the function"

That phrase, from the earlier draft, is wrong in a way that matters: **it names RLS as the control when
RLS is not the control.** Precisely, using the official statements in §1.1:

**1. A definer-owned function bypasses RLS, and must.** Supabase: "A 'security definer' function runs
using the same role that created the function." Postgres: "Table owners normally bypass row security as
well, though a table owner can choose to be subject to row security with `ALTER TABLE … FORCE ROW LEVEL
SECURITY`", and "Superusers and roles with the `BYPASSRLS` attribute always bypass the row security
system." The function is owned by `postgres`, which owns the table — so it executes **outside** RLS.
That is not a loophole; it is the mechanism that makes the design work. A deny-all policy set would
otherwise deny the function too.

**Corollary the review must not miss:** `ALTER TABLE … FORCE ROW LEVEL SECURITY` must **not** be set on
this table. If it were, the definer function would be subject to the (empty) policy set and every
increment would silently find and write nothing.

**2. What actually keeps `anon` and `authenticated` out of the table is *table privileges*, plus schema
exposure.** Two independent things, neither of which is RLS:

- `REVOKE ALL ON TABLE noor_ai.rate_counter FROM PUBLIC, anon, authenticated;` and grant nothing back.
  Without a `SELECT`/`INSERT`/`UPDATE` privilege, a role cannot reach the table at all, policies or no
  policies. This matters on Supabase specifically because roles are granted table privileges broadly by
  default in `public` — which is the second point.
- **Put the table in a private schema** — `noor_ai`, not `public` — and keep that schema out of the Data
  API's exposed-schema list. An unexposed schema is not addressable over PostgREST regardless of grants.

**3. RLS still goes on, as defence in depth and nothing more.** `ENABLE ROW LEVEL SECURITY` with no
policies means any role that *is* subject to RLS sees zero rows — so if a future migration accidentally
grants `SELECT` to `authenticated`, or moves the table into an exposed schema, the blast radius is a
denied query rather than a readable counter table. It is the second lock, not the first. Describing it as
the first is how a table ends up with RLS enabled, a stray grant, and a false sense of safety.

**4. Function grants are the only intended reach, and `PUBLIC` is the default trap.** Postgres: "By
default, execute privilege is granted to `PUBLIC` for newly created functions." So `CREATE FUNCTION`
alone publishes it to every role including `anon`. The `REVOKE … FROM PUBLIC` and the single
`GRANT EXECUTE … TO authenticated` must be in the **same transaction** as the create, per the pattern the
Postgres docs give for exactly this reason.

**5. An unresolved tension, recorded rather than smoothed over.** Supabase warns:
"Security-definer functions should never be created in a schema in the 'Exposed schemas' inside your API
settings." But calling the function through `supabase-js`'s `.rpc()` requires it to be **in** an exposed
schema. The two requirements collide, and this plan does not pretend otherwise.

The mitigating argument is specific to this function: it takes no identity parameter, it returns only a
decision and never a row or a secret, it performs only increment-and-read with no reset/decrement/delete,
and its worst-case abuse by a direct caller is self-denial (§5.3). On that basis being callable by
`authenticated` is an **accepted, reviewed consequence** rather than an oversight — but it is an explicit
deviation from Supabase's stated guidance, and a reviewer must sign it off as such. The alternative
shapes (a thin exposed wrapper over a private definer function; or §5.6.D, where the function is not
reachable by users at all) belong in the §5.4 review, not in this document's recommendation. **This is
the third reason R8 is blocked.**

---

## 6. §E — the `safety_identifier` decision

### 6.1 What the documentation actually requires

"Safety identifiers are recommended for products where individual users interact with a model, but
they are not required", and "Hash the username or email address in order to avoid sending us any
identifying information." So it is a **recommendation with an explicit hashing instruction**, which
is consistent with §12.6 treating this as a privacy decision rather than a technical default.

### 6.2 The five options

| Option                                        | Verdict                                                                                                                                                                                                                                                                       |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Send **nothing**                               | **Acceptable, and it is the status quo.** `ProviderRequest` has no such field, and §12.6 is open. Cost: NoorLife forgoes the provider's ability to act on abuse originating from one account — which matters more than usual because §12.9 records that free account creation makes per-user limits evadable |
| **Raw Supabase user UUID**                     | **Rejected.** §H.2 puts the raw user id on the deny-list; it is a join key into NoorLife's own database. The guidance to hash exists precisely to prevent this                                                                                                                 |
| **Unsalted hash**                              | **Rejected.** §B.2: "Without a secret salt, a user-id hash is reversible by anyone who can enumerate uuids." A v4 uuid is not cheaply enumerable, but the rule must not depend on that — one policy, applied everywhere, is the only kind that survives a schema change         |
| **Server-side HMAC of the user UUID with a dedicated salt secret** | **Recommended for production, not approved, and not implemented now.** §6.3                                                                                                                                                              |
| **A fixed synthetic identifier for the development-only smoke test** | **Recommended for §J.18.** §6.4                                                                                                                                                                                                                        |

### 6.3 The recommended production design (recommended, not approved)

| Property        | Design                                                                                                                                                                                                                                     |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Construction    | `HMAC-SHA256(salt, user_uuid)`, hex, truncated to 32 characters, prefixed with a version tag: `v1_<32 hex>`                                                                                                                                  |
| Salt            | A **dedicated** function secret whose only purpose is this identifier. Distinct from the provider key, from any JWT signing key or legacy JWT secret, from the rate-limit key's salt (§5.6), and from every other signing secret. Sharing one salt across two purposes means rotating one breaks the other. Note the two salts live in different places for different reasons: the rate-limit salt belongs in the database because the digest is computed there (§5.6.A), while this one belongs in the function environment because the digest is computed in the handler |
| Versioning      | The `v1_` prefix is part of the value, so a rotation is visible in provider-side data instead of looking like a population of new users                                                                                                      |
| Rotation policy | No scheduled rotation — rotation resets the provider's abuse correlation, which is the thing the identifier exists to provide. Rotate on suspected salt exposure, or when a linkage-policy decision requires it, and bump to `v2_` in the same change |
| Never sent      | Email, display name, raw uuid, session id, device id, IP — §H.2 unchanged. The HMAC output is the only thing that travels                                                                                                                    |
| Salt generation | **Not done in this step**, by instruction. When it happens it is generated with a CSPRNG directly in a trusted local terminal or the provider/platform dashboard, never echoed, never pasted into chat, never committed                       |

**Disclosure, stated rather than buried:** a stable pseudonymous identifier for a NoorLife user
crossing to a third party is exactly what Apple's linkage test is about, and
`NOOR_AI_DATA_CONTROL_DECISION.md` §6.3's linkage analysis already flags §12.6 as the first of the
two facts blocking the "Linked to You" answer, recorded as unresolved fact #3 in its §8.1. If this design is adopted, the provisional **Linked to You** classification
becomes the **settled** answer for the AI feature, and the draft must be updated in the same change —
not deferred, because the identifier is the reason the classification is no longer provisional.
Unresolved fact #4 (whether NoorLife's own logs could re-link a prompt to a user) stays open either
way; note that §H.3's log includes `user_hash` as the *same* value, so adopting the HMAC settles the
log question at the same time and both must be reviewed together.

### 6.4 What §J.18 uses, decided exactly

**A fixed synthetic constant: `noorlife-dev-smoke-v1`. Not derived from any user id, any salt, or any
account.**

Four reasons:

1. **Real-user traffic is prohibited**, and the smoke test sends developer-authored synthetic prompts
   only. There is no real user to identify, so implementing a real-user identifier would be building
   the thing the current authorisation forbids exercising.
2. **It still tests what needs testing** — that the field is accepted and the request shape is right
   — which is §J.18's purpose.
3. **It changes no privacy assessment.** No user-derived value crosses the boundary, so the Apple
   draft in `NOOR_AI_DATA_CONTROL_DECISION.md` §6.3 stands unchanged and unresolved fact #3 stays
   open, correctly, until §6.3 is approved.
4. **It cannot silently become the production identifier.** A constant is obviously wrong for real
   users — it would merge every user into one abuse subject — so it fails loudly in review rather
   than quietly in production. The `v1`/`v2` versioning of §6.3 is deliberately a different shape.

Equally acceptable if review prefers it: send **no** `safety_identifier` at all for §J.18. That tests
less and risks nothing. The choice above is the more informative of the two, not the safer one, and
either is defensible.

### 6.5 The structural consequence AI-3 must not slip past

`ProviderRequest` in `ports.ts` has exactly five fields, and `handler-provider_test.ts:108` asserts
the constructed object's keys equal exactly those five. Adding `safetyIdentifier` is therefore a
**visible, reviewed diff in two places plus the §H.1 allow-list** — which is the design working as
intended (`ports.ts` says so in as many words). Nobody should be able to add an outbound identifier
without a reviewer seeing it, and nobody should route around the test by computing it inside the
provider implementation instead.

---

## 7. §F and §G — the secret and deployment sequence, and the smoke procedure

**Nothing in this section has been executed.** It is the written sequence, in order, to be run later
by a human after §11.2's approvals exist.

### 7.1 Rules that govern the whole sequence

- **The API key is never pasted into Claude, into this chat, into a commit, into a screenshot, or
  into any command whose text is shown here.** Key entry happens directly in a trusted local
  terminal or in the provider dashboard, unechoed. If a step below would display a key, that step is
  wrong and must be stopped rather than adapted.
- The key never enters `.env`, `.env.example`, `app.json`, any `EXPO_PUBLIC_*` variable, Expo config,
  EAS secrets, the mobile bundle, source, tests, or any log (§B.2, §H.3). `EXPO_PUBLIC_*` in
  particular is inlined into the shipped bundle, which is the specific mistake §B.2 exists to
  prevent.
- `supabase secrets set` is the **only** channel. `supabase/functions/.env` is local-only and must
  stay untracked ("never check your `.env` files into Git").
- Every command runs with the operator watching. None of it belongs in CI, a script, or an agent run.

### 7.2 The sequence

| #   | Step                                                                                                                                                     | Verification before moving on                                                                                                       |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Create a **dedicated OpenAI project** for NoorLife development, separate from any other work and from any future production project                        | The project exists and is empty. Separate staging and production projects with their own rate and spend limits is the documented practice |
| 2   | Confirm **API data sharing / training opt-in is disabled** for the organization and the project                                                            | Read the setting, do not assume the default. `NOOR_AI_DATA_CONTROL_DECISION.md` §3.1's claim is "not used by default, and NoorLife has not opted in" — step 2 is what keeps that sentence true |
| 3   | Configure the **project spend limit** — §4.8's **$2.00/month with "Enforce a hard limit" turned ON**, plus a spend alert at **$0.50**. Entering a number is not enough: without the toggle the limit does not stop traffic (§4.8.2). This is damage containment, not a budget for the test (§4.8.1) | The limit **and the enforcement toggle** are both visible in the dashboard and apply to this project, not just the organization. If the platform enforces a higher minimum than $2.00, record the actual minimum rather than raising NoorLife's own ceilings to match it |
| 4   | Create a **restricted project API key** scoped to that project, with the narrowest permissions that permit `POST /v1/responses`                            | The key is created but not yet stored anywhere. It is never displayed to anyone but the operator, and never re-displayed             |
| 5   | Set it **only** through Supabase server-side secret management: `supabase secrets set` in a trusted local terminal, entered so the value is not echoed and does not enter shell history | `supabase secrets list` shows the name only. The value is never printed. The 48 KiB / 100-secret platform limits are not a concern here |
| 6   | Re-verify the exclusions: `git status` clean, no `.env` change, no `EXPO_PUBLIC_*` addition, source scan still passing, nothing in the bundle              | `source-scan_test.ts` passes, `git diff` shows no credential-shaped string, and no command emitted a key                              |
| 6b  | Confirm the **previous HS256 signing key is no longer listed** (§D.6.5) and confirm platform log retention for this project (§H.4)                          | Both are AI-3 gates the contract names and neither is a code change                                                                  |
| 7   | Deploy **only** `noor-ai`, after the final review of the diff that adds provider connectivity                                                              | `supabase functions deploy noor-ai` — one function, named explicitly. No `db push`, no other function, no config change beyond what review approved |
| 8   | Execute **exactly one** manually initiated approved synthetic prompt — §7.3                                                                                | **One handler request.** Not a loop, not a benchmark, not a second prompt. §F.8's automatic retry may make a second *provider attempt* on an eligible transient failure; that is the system's behaviour, not a second request the operator initiates (§4.8.0) |
| 9   | Verify `store: false` was sent, the response limits held, the logs are clean, and the cost is what §4.7 predicted                                          | §7.3's checklist                                                                                                                     |
| 10  | If the single request **fails, is inconclusive, or cannot be verified** — including anything in step 9 failing: disable or remove access immediately — flip the kill switch, and revoke the key if the failure involves the key or a log leak. Then **stop testing, send no further request, and obtain fresh explicit approval before any new user-visible request** | The endpoint returns `503` again and the key is invalid. **A failed smoke test is not iterated on live, and it is not replaced by a second attempt on the operator's own authority.** The next request is a new authorisation decision |

### 7.3 §J.18 — the synthetic live-smoke procedure

**Precondition, checked and not assumed:** §F.10's decision is on record (it is —
`NOOR_AI_DATA_CONTROL_DECISION.md`); the store of §5 exists and answers, so §J.13b passes first;
§11.2's approvals exist; the kill switch is on deliberately for this test and off by default.

**Authorised volume, stated before the procedure so it cannot be read as a starting point:** **exactly
one manually initiated synthetic user-visible handler request** (§4.8.0). That one request may produce a
second **provider attempt** only through §F.8's automatic retry on an explicitly eligible transient
failure. A second manually initiated handler request is **not authorised**, and if this one fails, is
inconclusive, or cannot be verified, testing stops and fresh explicit approval is required before any new
user-visible request.

**Input:** exactly one developer-authored synthetic prompt, of the kind §5.1 of the data-control
decision permits. Use §J.17's own case so the assertions are the ones already written down:

> `Where do I change my prayer reminder sound?`

**Request:** `contract_version: 1`, that message, `surface: "/ai"`, `locale: "en"`, with a real
Supabase user access token for a **developer test account** — not a real user's session.

**Assertions — §J row 17's, plus AI-3's own:**

| # | Check                                                                                                           | Why                                                                    |
| - | --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| 1 | `200`, `outcome: "answer"`, non-empty `text`, `sources: []`, `accessed_modules: []`, `finish: "complete"`, `request_id` present | §J.17 / §J.18                                              |
| 2 | The outbound request carried `store: false`                                                                      | §J.18 states it explicitly                                              |
| 3 | The outbound request's fields are exactly §H.1's allow-list — plus only those additions §11.2 approved. **No `prompt_cache_key` is sent** (§4.6.1) | §J.15d, and the whole point of `ProviderRequest`'s shape                 |
| 4 | The provider key appears in **no** log line, no terminal output, and no error path                                | §J.18, §H.3                                                             |
| 5 | No log line contains the message text, the answer text, a bearer token, or the salt                               | §J.15a–15c                                                              |
| 6 | Record `input_tokens`, `output_tokens`, `cache_write_tokens` if present, `upstream_duration_ms`, `upstream_attempts` | This is the **measurement** §4.7 depends on; without it every provisional number stays provisional |
| 6b | Compare `input_tokens` against §4.1.5's thresholds and act on the row it falls in                                 | The byte-derived bound is an estimate (§4.1.3); this is the only thing that checks it. **Above 12,000 the test aborts** |
| 7 | Record whatever concrete model the response reports, if it reports one, **and the reasoning effort it reports**    | §3.7's alias mitigation; and the family's default effort is undocumented (§2.2), so what it echoes back is worth knowing |
| 8 | Compare actual cost against §4.7's retry-inclusive predicted worst case of **~$0.108 (rounded $0.11)** for the dev shape. A first-attempt success should land near **$0.054** or below | A large divergence means the cost model is wrong, which matters more than the amount |
| 9 | Confirm the **provider dashboard attempt count** matches §7.3.1 exactly, in the dedicated project, against the **$2.00 hard limit** from step 3 | Independent confirmation that the key and project are the ones intended, and the only external check that no unexpected traffic occurred |

#### 7.3.1 Provider dashboard expectations

The dashboard is the independent record, so what it may show is fixed in advance rather than judged
afterwards:

| Provider requests/attempts shown | Verdict                                                                                                                                                                        |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **1**                            | **Normal and expected.** The handler request succeeded on its first provider attempt                                                                                             |
| **2**                            | **Acceptable only when the application logs prove §F.8's permitted automatic retry occurred** — `upstream_attempts: 2` with an eligible transient first outcome (`rate-limited` or `transient-server-error`). Two attempts *without* that log evidence is not explained by the retry policy and is treated as the row below |
| **More than 2**                  | **A failed verification.** Stop, run §7.2 step 10, and investigate before anything else is concluded. More than two attempts means either the retry policy is not behaving as `handler.ts` describes, or a request was made that this test did not authorise. Neither may be reasoned past |

Note the reconciliation with §4.8: the **quota counter** should read **1** in every one of those rows,
because it counts handler requests. A dashboard showing 2 attempts against a quota counter of 1 is the
retry working correctly, not a discrepancy.

**Abort criteria — stop and run step 10 rather than retrying:** any key or content appearing in any
log; a response that is not §J.17's shape; more than two provider attempts in the dashboard, or two
without log evidence of the permitted retry (§7.3.1); a `429` or `503` that indicates the request bypassed
NoorLife's own limits; or an `incomplete`-with-empty-text response, which means §4.2's cap is starving
the reasoning budget and must be re-sized before anything else is concluded.

An earlier revision listed "more than one provider request appearing in the dashboard" as an abort
criterion. That is **removed as incorrect**: §F.8's permitted automatic retry can legitimately produce a
second attempt, so the threshold is two-with-log-evidence, not one (§7.3.1).

**Explicitly not part of the smoke test:** any real user's prompt or token; **any second manually
initiated handler request, including a replacement request after a failure or an inconclusive result**;
any second prompt "to check the refusal path" (§G's refusal rows are AI-2 rows and already pass against
the fake provider); any latency benchmark; any load test; and any prompt not written for this test.
Re-testing after a failure requires fresh explicit approval (§7.2 step 10), not a decision made at the
terminal.

### 7.4 What one request can and cannot establish

One request proves the wiring: a key that works, a request shape that is accepted, a response that
parses, logs that stay clean, and one real cost data point. It does **not** produce a p95 latency, a
reasoning-token distribution, an eval result, or any basis for calling a provisional number final.
§4.7's list stays provisional after §J.18 passes, and the honest next step is a bounded synthetic
measurement run — its own decision, with its own authorisation, not an extension of this one.

---

## 8. What this plan does not change

- **The data-control decision is unchanged.** Default API data controls, synthetic development smoke
  test only, no ZDR or MAM applied for, `store: false` required and already machine-enforced, and no
  real-user traffic in any environment. Nothing in this plan widens that authorisation.
- **`store: false` is not zero retention** and is never described as such (§4.2 of that decision).
- **The privacy policy, Play declaration and Apple labels remain unwritten and unfiled**
  (`PRE_RELEASE_BACKLOG.md` §3.1, §3.3, §3.4 — all Blocked). §6.3's disclosure obligation is
  additional to them, not a substitute.
- **§12.10's session-revocation gap stays open** and is not an AI-3 gate. §4.8's ceilings bound the
  *cost* of the up-to-one-hour window; they do not close it, and no line here should be read as
  claiming they do.
- **§12.5's moderation decision stays open**, so §G.7's crisis path still rests on instruction text
  alone. That is a stated weakness, and it is one of the reasons §3.6 recommends Terra over Luna
  while no eval exists.

---

## 9. Critical review — findings against the contract and the AI-2 code

### 9.1 §F.5 does not anticipate reasoning tokens, and the gap has a billed failure mode

**The most significant finding.** §F.5 and §C.4 model two outcomes of the output cap: the answer
fits (`complete`), or the model "hit `max_output_tokens`" and the answer is truncated (`length`).
On a reasoning model there is a **third** outcome the official documentation describes explicitly:
the cap is exhausted by reasoning tokens before any visible output is produced, returning
`status: "incomplete"` with `incomplete_details.reason: "max_output_tokens"` and no text — while
input and reasoning tokens are billed.

Today `handler.ts` maps an empty answer to `malformed_upstream` → `502`, which is the right response
to the *user* and the wrong signal to the *operator*: it says the provider failed when in fact
NoorLife's own cap was too small. Consequences:

- §4.2 sizes `max_output_tokens` for reasoning headroom rather than for prose, and the current `512`
  placeholder is unsafe as a starting value.
- §4.9 defines the third case explicitly.
- A distinct log field is needed to separate starvation from provider malformation. That is a
  reviewed addition to `OperationalLogRecord`'s closed field set — deliberately closed, per §H.3's
  allow-list rule, so it is a diff a reviewer sees.
- The contract gets a cross-reference at §F.5 rather than a rewrite: the two-outcome model is not
  wrong, it is incomplete, and the incompleteness is provider-behaviour that AI-1 could not have
  known.

### 9.2 AI-3's implementation will collide with four AI-2 absence assertions, by design

`source-scan_test.ts` asserts the absence of exactly the things AI-3 must add. This is the scan
working, not breaking, but it must be a **deliberate, reviewed revision** rather than a test edited
to make a build go green:

| Assertion                                                             | AI-3 needs                                                  | Required handling                                                                                        |
| --------------------------------------------------------------------- | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `no fetch call` — no `fetch(` in any production file                   | The Responses API call                                       | Narrow the scan to "no `fetch` outside the provider implementation", keeping the guarantee for every other module |
| `no model is named anywhere` — no `gpt-…` in production                | The model slug                                               | **No change needed** — §3.7 reads the slug from configuration, so the assertion keeps holding and keeps being useful |
| `no @supabase/supabase-js / @supabase/server / createClient(` in every scanned file | The rate-limit RPC call                            | Narrow to the limiter implementation, and keep the ban everywhere else so no module quietly gains database reach |
| `no service_role reference` in production                              | **Nothing.** §5.2 uses the caller's JWT                      | **Leave untouched.** If a change to this line is ever proposed, that is the §12.10 review opening, not an AI-3 detail |

Any of these edits landing in the same commit as the feature it unblocks is how a scan stops being
evidence. They belong in their own reviewed change, with the reason in the diff.

### 9.3 `HandlerConfig` has no knob for two of §I.2's three global controls

`HandlerConfig` carries `enabled` (the kill switch), the two timeouts, `maxOutputTokens` and
`retryBackoffMs`. §I.2 requires **three** global controls: the kill switch, a **daily token/spend
ceiling**, and an **error-rate breaker**. Neither of the latter two exists in the type or the graph,
and both need the shared store of §5 plus the price table of §4.8. They are AI-3 implementation
work, they are not in the current skeleton, and the endpoint must not carry traffic beyond §J.18
without them.

### 9.4 A stale internal reference in AI-2's code

`ports.ts:245` states that `tests/provider-boundary_test.ts` asserts the outbound object's keys. No
such file exists; the assertion lives in `tests/handler-provider_test.ts:108`. The guarantee is real
and tested — only the pointer is wrong. Recorded rather than fixed, because this step is
documentation-only; the correction belongs to whoever next edits that file.

### 9.5 Two contract statements this plan closes, and one it cannot

| Contract item                                                                       | Status after this plan                                                                                                          |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| §F.2 — "Whether the selected model accepts `temperature` at all is verified in AI-3" | **Closed.** Not documented as supported for Terra; §4.4 sends neither `temperature` nor `top_p`                                  |
| §C.8 — "Upstream input tokens: hard cap, verified in AI-3 against the selected model" | **Not closeable as written, and §4.1 explains why.** A *hard* pre-request token cap needs a tokenizer in the handler or a preflight API call, and AI-3 takes neither (§4.1.4). What exists is a hard **byte and code-point** cap (§4.1.1, already implemented and tested) plus a byte-derived **12,000-token billing estimate** (§4.1.3) and a post-call check with an abort threshold (§4.1.5). The contract's wording assumes a control that is not available; the review should decide whether to reword §C.8 or accept the byte-cap-plus-verification substitute |
| §F.7 — "Concrete values are set in AI-3 against measured latency"                    | **Cannot be closed by a document.** No latency measurement exists, so §4.5's production values are provisional and labelled so   |

---

## 10. Implementation steps (for AI-3's implementation phase, not performed here)

In order. Each step is separately reviewable, and nothing in this list has been started.

1. **Approve or amend §11.2.** No code until the model, the ceilings and the `safety_identifier`
   decision are agreed by a reviewer. **R8 is not on that list** — it is blocked (§11.2.1), so step 2 is
   a prerequisite for it rather than a follow-up.
2. **Review the rate-limit schema and its secret** through the `PRE_RELEASE_BACKLOG.md` §4.1 gate
   (§5.4): table shape and private schema, table privileges and the `REVOKE`s, RLS as defence in depth
   with `FORCE ROW LEVEL SECURITY` **not** set, the `SECURITY DEFINER` function with `search_path` pinned
   and every object schema-qualified, the `PUBLIC` revoke in the create transaction, §5.6's choice among
   Vault / unsalted digest / dedicated role with the two unverified Vault facts checked on the project,
   §5.7's exposed-schema tension signed off or designed around, the retention behaviour, and what happens
   when the store itself fails. **This step unblocks R8 or replaces it.**
3. **Write the migration and the limiter implementation** behind the existing `RateLimiter` port.
   Fail closed on every error path. Keep `unavailableRateLimiter` as the default in any graph where
   the store is not configured.
4. **Revise the two source-scan assertions** of §9.2 in their own commit, with the narrowing reason
   in the diff.
5. **Add the spend counter and the error-rate breaker** (§9.3) to `HandlerConfig`, the store and the
   graph, with the dated price table.
6. **Add the starvation log field** (§9.1) to `OperationalLogRecord` and the allow-list serialiser.
7. **Implement the Responses API provider** behind the `AIProvider` port: the slug from
   configuration, `reasoning.effort` from configuration, `store: false`, no tools, no sampling
   parameters, `max_output_tokens` from `HandlerConfig`, the response validation of §4.9, and the
   abort signal honoured.
8. **Prove §J.13b** — the shared limit holds across simulated isolates and cold starts — before any
   key exists. It needs no provider.
9. **Run §J's AI-2 rows again** against the changed graph. A provider implementation that breaks a
   redaction or allow-list row is not a working provider.
10. **Only then** run §7.2's key and deployment sequence, and §7.3's single smoke test.
11. **Record the measurements** and convert §4.7's provisional values into pinned ones — or record
    that they remain provisional and why.

---

## 11. Decision register

### 11.1 Approved — already settled by the contract or the data-control decision

These are restated, not decided here: the Responses API (§F.1); `store: false`, machine-enforced;
no tools, no web search, no file or image input; no `previous_response_id`, no `conversation`, no
background mode; text in and text out only; no provider-side persistence; the §H.1 allow-list and
§H.2 deny-list as they stand; the §C.3 input bounds; §F.8's one-retry policy; `verify_jwt = true`;
and default API data controls for a synthetic development smoke test only.

### 11.2 Recommended, **not yet approved** — a reviewer must agree to each

| #   | Recommendation                                                                                                            | Where          |
| --- | ------------------------------------------------------------------------------------------------------------------------- | -------------- |
| R1  | Model **`gpt-5.6-terra`**, treated as a **controlled reviewed alias** because no dated snapshot is published. Recommended, **not configured** — no configuration value is set anywhere | §3.6, §3.7     |
| R2  | `reasoning.effort: "low"` — a **documented** value for the GPT-5.6 family — with `reasoning.mode` omitted, `minimal` excluded, and the §4.3 fallback if it is nonetheless rejected | §2, §4.3       |
| R3  | Send no `temperature` and no `top_p`                                                                                        | §4.4           |
| R4  | `max_output_tokens` **2,000** for the dev smoke test, sized for reasoning headroom rather than prose                        | §4.2           |
| R5  | Dev-smoke timeouts **30,000 ms upstream / 70,000 ms handler**, deliberately loose so latency is measured, not guessed        | §4.5           |
| R6  | The dev-smoke ceilings of §4.8, sized on **exactly one manually initiated synthetic user-visible handler request**: **1 per 60 s, 1 per hour and 1 per day per user; 1 per 60 s and 1 per day globally**; a concurrency lease of **1 handler request**; the quota counter incrementing **once** per handler request while **every** provider attempt including the permitted automatic retry is cost-accounted separately; and **$0.50/day** and **$2.00/month** ceilings plus a **$2.00/month provider-side project hard spend limit with enforcement ON and an alert at $0.50** — all four money figures being **damage containment, not an allowance** | §4.8.0, §4.8, §4.8.1, §4.8.2 |
| R7  | The response-size validation rules of §4.9, including the starvation case                                                    | §4.9           |
| R9  | Spend counters and the concurrency lease live in the same store as the rate limiter, whichever store §5.4 eventually approves | §4.8, §5.2     |
| R10 | **`noorlife-dev-smoke-v1`** as §J.18's `safety_identifier` — a fixed synthetic constant, not user-derived, and **not** a salted value. No salt is generated for it now | §6.4           |
| R11 | The production HMAC design of §6.3, with a **dedicated** salt, `v1_` versioning, and the Apple **Linked to You** consequence accepted and documented at adoption time — a **future** recommendation, not part of AI-3 | §6.3 |
| R12 | Adding **`safetyIdentifier` only** to §H.1's allow-list, `ProviderRequest` and the boundary test, as a reviewed diff. **`prompt_cache_key` is not proposed** (§4.6.1) | §6.5           |
| R13 | The §7.2 secret and deployment sequence, and the §7.3 smoke procedure with its abort criteria                                | §7             |
| R14 | The production-initial column throughout §4 as a **starting proposal only**, to be re-decided after measurement             | §4             |
| R15 | The **12,000-token input planning bound** of §4.1 — byte-derived, explicitly an estimate rather than a proven cap — together with the §4.1.5 abort threshold that checks it | §4.1           |

**R8 has been moved out of this table.** It is not recommended; it is blocked. See §11.2.1.

### 11.2.1 Blocked — a reviewer must not be asked to approve this yet

| #      | Item                                                                                                                    | Why it is blocked                                                                                                                                                                            |
| ------ | ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **R8** | **The shared rate-limit store** — Postgres table + `SECURITY DEFINER` RPC, called with the caller's JWT, keyed on an HMAC of `auth.uid()`, 48-hour retention | **Blocked pending the §5.4 schema and security review.** The earlier draft listed this as recommended while leaving the keying secret's location entirely unspecified. §5.6.A (Supabase Vault) is the recommended direction and its caller-binding **is** complete, but three things are not: (a) the default `anon`/`authenticated` grants on `vault.decrypted_secrets` are not documented and must be inspected on the project; (b) whether `vault` is in the Data API's exposed-schema list must be read, not assumed; (c) §5.7 point 5's exposed-schema tension for definer functions is unresolved. §5.6.B (edge-computed digest) is **rejected outright** — the RPC cannot bind a caller-supplied digest to `auth.uid()`. §5.6.C and §5.6.D are documented fallbacks with stated costs. **No store design is approved, and none may be implemented** |

R8 stayed at its original number and moved table rather than being renumbered, so that every existing
reference to it — including §12's status row — still points at the same decision. It was moved rather
than left in §11.2 with a caveat because a "recommended, subject to review" row reads as approved the
moment the review is scheduled, and the store is the endpoint's only rate control (§I.1).

### 11.3 Provisional, or open, until evidence exists

`max_output_tokens` (production), `upstreamTimeoutMs` and `handlerBudgetMs` (production), the
**12,000-token input planning bound** (an estimate by construction — §4.1.3 — not a value that a
measurement makes final), the 1.25× cache-write assumption in every cost figure, whether prompt caching
engages at all (§4.6), **every production per-user and global volume ceiling** — including any future
free/paid tier distinction, which this document does not decide — the max-concurrency value of 4, and the
error-rate breaker's threshold and cooldown. §4.7 states what closes each.

**The dev-smoke ceilings are not on that list.** They are all **1** (§4.8), and they are not provisional
in the same sense: they are not an estimate awaiting data but a direct restatement of what the approved
development data decision authorises — exactly one manually initiated synthetic user-visible handler
request. They change only if that authorisation changes.

Two additional open items that are not measurements:

- **A build-time offline token count for the fixed server prompt** (§4.1.4), available only if an official
  tokenizer encoding for GPT-5.6 is published. Until then the byte-derived estimate stands and no
  tokenizer is added.
- **`prompt_cache_key`** (§4.6.1) — a later optimisation candidate, gated on authorised repeated traffic,
  measured caching benefit, a privacy recheck, and its own separate allow-list review.

### 11.4 Release blockers — unchanged and restated

- ZDR must be applied for and its outcome reviewed before public beta; approval must not be assumed.
- The privacy policy, Play Data Safety declaration and App Store privacy labels must be published or
  filed before user traffic (`PRE_RELEASE_BACKLOG.md` §3.1, §3.3, §3.4 — all Blocked).
- The whole-app data inventory must exist before any store declaration is completed.
- §12.3's shipped privacy copy (AI-10).
- §12.5's moderation decision, required before public access.
- Email confirmation re-enabled and re-tested (§12.9, `PRE_RELEASE_BACKLOG.md` §1.3).
- §12.10's session-revocation decision reviewed and recorded, adopted or explicitly accepted (AI-10).
- The §5.4 schema review, before any rate-limit migration exists.

---

## 12. AI-3 status after this step

**AI-3 is not complete.** This document closes none of §K's AI-3 exit criteria on its own; it
proposes how to close them.

| AI-3 gate                                                | State after this document                                                        |
| -------------------------------------------------------- | -------------------------------------------------------------------------------- |
| §F.10 data-control decision recorded                     | **Satisfied earlier** by `NOOR_AI_DATA_CONTROL_DECISION.md` — development-only    |
| Provider key provisioned via `supabase secrets set`      | **Not done. No key exists anywhere.** Sequence written (§7.2), not executed        |
| Model selected and pinned, with rationale (§F.2)          | **Recommended (R1), not approved and not pinned.** No configuration value is set   |
| Timeouts from measured latency (§F.7)                     | **Proposed and explicitly provisional.** No latency has been measured              |
| Token and spend limits pinned (§I.2, §I.3)                | **Proposed (§4).** Not pinned; two of three global controls are not implemented (§9.3) |
| Rate-limit store chosen (§12.7, §I.1)                     | **Not chosen — R8 is `Blocked`** (§11.2.1) pending the §5.4 schema and security review. Postgres + definer RPC is the direction; the keying secret's storage and reachability are unsettled (§5.6). No migration, no dependency, no salt |
| §12.6 `safety_identifier` decision                        | **Recommended (R10, R11), not approved.** No salt generated, no field implemented  |
| Platform log retention confirmed (§H.4)                   | **Not done** — step 6b                                                            |
| Previous HS256 signing key no longer listed (§D.6.5)      | **Not confirmed** — step 6b                                                       |
| §J row 13b — shared rate limit                            | **Not run.** No store exists                                                      |
| §J row 18 — live smoke test                               | **Not run. No provider call has been made**                                       |
| Deployment                                               | **Not done, and prohibited at this phase**                                        |

**NoorLife is not production-ready**, and this document does not move it closer to being so — the
release blockers in `PRE_RELEASE_BACKLOG.md` are all still open.

### 12.1 What this step did not do

No API key was requested, created, stored, printed, or referenced by value. No Supabase secret was
set. No provider connectivity was implemented — `production.ts` still ships `unavailableProvider` and
`unavailableRateLimiter`, and the endpoint still fails closed with `503`. No migration, table, RLS
policy or SQL was written. No dependency was added. No salt was generated. Nothing was deployed. No
OpenAI API call was made. No `src/` file, no function source, no test and no configuration file was
changed. Real-user traffic remains prohibited.

The diff for this step is this document, and a cross-reference in the contract where §9.1 found the
contract incomplete.
