# Noor AI — AI-3 quota-store schema and security review

Branch `feature/subscriptions-family-six`, from `5940352`.

**Conclusion: BLOCKED.** See §14.

**Updated 2026-08-07 — §17 records a completed hosted, read-only verification.** It closes **B3** for
direct access by `anon`, `authenticated` and `PUBLIC`, closes **B4**'s hosted drift check, and adds
**five new blockers (B11–B15)**. It changes nothing about **B1** or **B2**, and the verdict is
unchanged: **BLOCKED**.

This document is the review that `NOOR_AI3_IMPLEMENTATION_PLAN.md` §5.4 demands and that §5.6.E,
§5.7 and §11.2.1 defer to. It exists to resolve or narrow **R8** — the shared server-side quota,
spend and concurrency store — and it does one of those two things for every question put to it.

**It does not implement the store.** No migration was written, no SQL file was added under
`supabase/migrations/`, no function was created, no schema was altered, no key or salt was
generated, no secret was read, no dependency was added, no hosted project was contacted, no local
stack was started, and no application or Edge Function source changed. The only artefacts are this
document and two narrow cross-references in the two documents it reviews (§15).

Being blocked is the result, not a failure to reach one. The review closes four questions the plan
left open, dissolves one of its three recorded blockers conditionally, and finds **two new critical
defects** that the plan's own analysis missed. The first of those is why the verdict cannot be
approval: the plan's headline safety claim about direct RPC access — "the effect is self-denial" —
is **false as scoped**, and the design it protects would ship a denial-of-service primitive that any
signed-up account could fire at every other user.

## Corrections applied after first review

Four claims in earlier revisions were wrong or overstated, and are corrected in place rather than
quietly dropped. Each correction is marked where it applies:

| # | What was wrong | Where corrected |
| - | -------------- | --------------- |
| 1 | **Network reachability was treated as part of the security boundary.** The first revision argued a mobile client "has no route to the database port". Withdrawn — a Supabase direct or pooler endpoint may be reachable from any Internet client, and reachability is not authentication. The control is the credential and the narrow privilege set | §7.3.1 (new), §7.3, §7.7, T-22 to T-27 |
| 2 | **"Salt" was used for what is an HMAC key.** HMAC takes a secret *key*; a salt is a non-secret diversifier and the two are not interchangeable | §0.4 (new), and §8, §10.2, §11, §12.7, §14 throughout |
| 3 | **Three separately stored keys were presented as the only valid separation design.** No source supports that. Two patterns are admissible; one is recommended, with reasons | §11.4.3, §11.4.4 |
| 4 | **The dashboard's "2 of 3 functions exposed" count was mapped onto the two repository functions lacking an explicit `REVOKE`, and the missing `REVOKE` was named as the mechanism producing the count.** Withdrawn — the dashboard evidence was a bare count that did not identify the functions, and the meaning of its "exposed" label was never established from official documentation. The repository fact and the dashboard fact are now recorded as **two independent observations**, each an independent reason for an exact per-signature audit. **B13 is renamed accordingly and stays open** | §17.8, §17.3 (third reading caution), §14.1's B13 row, §14.3 item 6 |

**None of these changes the verdict.** Correction 3 in fact *strengthens* B9: the requirement that the
three identifiers not be comparable turns out to be violated by the current specification outright, not
merely unspecified (§11.4.2). Correction 4 retracts an **inference**, not a finding — B13's two
underlying observations are unchanged, it remains **open**, and what it now requires is a stricter,
per-signature audit rather than a weaker one.

---

## 0. Sources

### 0.1 Official documentation, retrieved 2026-08-07

Every platform claim in this document is anchored to one of these. Anything not anchored to one is
marked as a **decision** or an **inference** where it appears.

| # | Page | Facts taken from it |
| - | ---- | ------------------- |
| S1 | `supabase.com/docs/guides/api/using-custom-schemas` | "By default, your database has a `public` schema which is automatically exposed on data APIs"; the four-step procedure to expose a custom schema (API settings → Exposed schemas, then `GRANT USAGE ON SCHEMA`, `GRANT ALL ON ALL TABLES`, `GRANT ALL ON ALL ROUTINES` to `anon, authenticated, service_role`); `db: { schema: 'myschema' }` and the per-query `supabase.schema('myschema')` form; `Accept-Profile` for GET/HEAD and `Content-Profile` for POST/PATCH/PUT/DELETE |
| S2 | `supabase.com/docs/guides/database/hardening-data-api` | "A dedicated schema adds another boundary around your Data API"; that tables created in `public` receive `SELECT`, `INSERT`, `UPDATE` and `DELETE` privileges for the API roles; **"RLS doesn't apply to functions, so grant `EXECUTE` only to the roles that need to call them"**; "Review every `SECURITY DEFINER` function carefully"; "Tables and views exposed through the Data API without RLS can be accessed by any role with matching grants" |
| S3 | `supabase.com/docs/guides/database/postgres/row-level-security` | "A 'security definer' function runs using the same role that *created* the function", and that it can "bypass RLS"; and the verbatim warning **"Security-definer functions should never be created in a schema in the 'Exposed schemas' inside your API settings."** |
| S4 | `supabase.com/docs/guides/database/functions` | "It is best practice to use `security invoker` (which is also the default). If you ever use `security definer`, you *must* set the `search_path`"; "If you use an empty search path (`search_path = ''`), you must explicitly state the schema for every relation in the function body"; `.rpc()` is the invocation method |
| S5 | `supabase.com/docs/guides/database/vault` | Vault is "A Postgres extension and accompanying Supabase UI that makes it safe and easy to store encrypted secrets"; `vault.create_secret()`, `vault.update_secret()`; the auto-created `vault.decrypted_secrets` view "will decrypt secret data on the fly"; **"You should ensure that you protect access to this view with the appropriate SQL privilege settings at all times, as anyone that has access to the view has access to decrypted secrets"**; "The encryption key is never stored in the database alongside the encrypted data" |
| S6 | `supabase.com/docs/guides/database/postgres/roles` | `postgres` — "The default Postgres role. This has admin privileges"; `anon` — the role PostgREST uses "when a user *is not* logged in"; `authenticated` — the role PostgREST uses "when a user *is* logged in"; `authenticator` — "a special role for the API (PostgREST) … used to validate a JWT and then 'change into' another role determined by the JWT verification"; `service_role` — "For elevated access. This role is used by the API (PostgREST) to bypass Row Level Security"; `supabase_admin` — internal |
| S7 | `supabase.com/docs/guides/functions/connect-to-postgres` | **"Because Edge Functions are a server-side technology, it's safe to connect directly to your database using any popular Postgres client."** `supabase-js` is "the recommended approach for most applications", and its wrapper hands the function "a `supabase-js` client (`ctx.supabase`) already scoped to the caller's Row Level Security policies, so you don't manage keys or authorization headers yourself"; **"Deployed edge functions are pre-configured to use SSL for connections to the Supabase database"** — the page states that the deployed path is encrypted but does **not** name the certificate **verification mode** (§17.9, B14) |
| S8 | `postgrest.org/en/v12/references/api/schemas.html` | The configured schema "is added to the `search_path` of every request"; **"You can only switch to a schema included in `db-schemas`. Using another schema will result in an error"**; `Accept-Profile` / `Content-Profile` switching; "If you don't specify a Profile header, the first schema in the list is selected as the default schema" |
| S9 | `postgrest.org/en/v12/references/transactions.html` | `SELECT current_setting('request.headers', true)::json` returns the request headers, lower-cased; `current_setting('request.jwt.claims', true)::json` returns the JWT claims; `current_role` / `current_user` give the impersonated role; the `db-pre-request` hook "can run after the Transaction-Scoped Settings are set and before the Main query" |
| S10 | `postgresql.org/docs/15/sql-createfunction.html` | `SECURITY INVOKER` "is the default"; `SECURITY DEFINER` executes "with the privileges of the user that owns it"; "For security, `search_path` should be set to exclude any schemas writable by untrusted users"; "Particularly important in this regard is the temporary-table schema, which is searched first by default, and is normally writable by anyone"; **"by default, execute privilege is granted to `PUBLIC` for newly created functions"**; "To avoid having a window where the new function is accessible to all, create it and set the privileges within a single transaction", with the `BEGIN; CREATE FUNCTION …; REVOKE ALL … FROM PUBLIC; GRANT EXECUTE … TO admins; COMMIT;` pattern |
| S11 | `postgresql.org/docs/15/ddl-rowsecurity.html` | "Superusers and roles with the `BYPASSRLS` attribute always bypass the row security system when accessing a table"; "Table owners normally bypass row security as well, though a table owner can choose to be subject to row security with `ALTER TABLE … FORCE ROW LEVEL SECURITY`"; "If no policy exists for the table, a default-deny policy is used, meaning that no rows are visible or can be modified" |
| S12 | `postgresql.org/docs/15/explicit-locking.html` | Advisory locks "are automatically cleaned up by the server at the end of the session"; session-level locks "do not honor transaction semantics: a lock acquired during a transaction that is later rolled back will still be held following the rollback"; transaction-level requests "are automatically released at the end of the transaction, and there is no explicit unlock operation"; `FOR UPDATE` "causes the rows retrieved by the `SELECT` statement to be locked as though for update" |
| S13 | `postgresql.org/docs/17/catalog-pg-default-acl.html` | The catalog "stores initial privileges to be assigned to newly created objects" — that is, the **default privileges applied at object-creation time**; that an object whose own ACL is null therefore carries the **hard-wired built-in default**, rather than a value re-read from `pg_default_acl` after creation; and that, consequently, the catalog's existence or its **row count alone establishes nothing** about whether the configured defaults are more permissive or more restrictive than the built-in ones |
| S14 | `postgresql.org/docs/15/sql-set-transaction.html` | In a transaction set `READ ONLY`, `INSERT`, `UPDATE`, `DELETE`, `MERGE` and `COPY FROM` are disallowed where the target is not a temporary table; all `CREATE`, `ALTER` and `DROP` commands are disallowed; and `COMMENT`, `GRANT`, `REVOKE` and `TRUNCATE` are disallowed |

The Postgres pages behind **S10–S12** are the **version 15** pages deliberately: `supabase/config.toml`
declares `major_version = 15`, so version-general documentation would be the wrong authority for this
project. **S14** is also a version 15 page, cited as such by §17.1. **S13 is a version 17 page**: it is
cited only by the hosted-verification addition (§17.8), for a finding about the **hosted** project, which
reports PostgreSQL 17. That split between the version 15 and version 17 citations is the **B11** version
mismatch (§17.6) surfacing in the bibliography itself, and it is left visible on purpose.

> **Correction of authority, added 2026-08-07.** §17.2 records that the **hosted project reports
> PostgreSQL 17**, not 15. The version-15 pages were therefore the right authority for the *declared*
> project and the wrong one for the *running* one. Every S10–S12 statement quoted above was re-checked
> against this and **none of the specific quotations changes between 15 and 17** — the `SECURITY
> DEFINER` semantics, the `PUBLIC` default-execute grant, the `FORCE ROW LEVEL SECURITY` rule, the
> default-deny rule and the advisory-lock semantics are identical in both. **No finding in this
> document rests on a version difference.** What the mismatch does break is migration and test parity,
> which is **B11** (§17.6), and it means any *future* platform claim must be anchored to the version 17
> pages until the mismatch is deliberately resolved.

### 0.2 Repository, read from the working tree at `5940352`

| Path | What it fixes for this review |
| ---- | ------------------------------ |
| `supabase/config.toml` | `[api] schemas = ["public", "graphql_public"]` — **the exposed-schema list, declared in version control**; `extra_search_path = ["public", "extensions"]`; `major_version = 15`; `jwt_expiry = 3600`; `enable_confirmations = false`; `[functions.noor-ai] verify_jwt = true` |
| `supabase/migrations/20260729140000_fix_profile_trigger_rls.sql` | **The FORCE ROW LEVEL SECURITY incident, already suffered by this repository.** Also the established conventions: `security definer` + `set search_path = ''` + full qualification, and `revoke all on function … from public, anon, authenticated` |
| `supabase/migrations/20260729120000_create_profiles.sql` | The origin of that incident — the migration that ended with `force row level security` |
| `supabase/migrations/20260801120000_account_journey.sql` | A second definer function in the repo, using `set search_path = public`; and the precedent that a client-forbidden write is enforced by a **trigger**, not by RLS, because "There is no column-level restriction in Postgres RLS" |
| `supabase/functions/noor-ai/ports.ts` | `RateLimitDecision` (`allowed` / `limited` / `unavailable`) and `RateLimiter = { check: (userId, nowMs) => Promise<RateLimitDecision> }` — **a single-call port with no reserve, no finalize and no lease** |
| `supabase/functions/noor-ai/production.ts` | `unavailableRateLimiter`, the fail-closed production wiring |
| `supabase/functions/noor-ai/tests/source-scan_test.ts` | The assertions an implementation collides with: no `@supabase/supabase-js`, no `createClient(`, no query builder, no SQL, no `auth.sessions|auth.users`, no `service_role` in production text |
| `docs/NOOR_AI_BACKEND_CONTRACT.md` | §B.2 (the secret table), §B.3 (three boundaries), §D.5 (authenticated ≠ verified), §I.1, §I.2, §I.5, §H.2, §H.3, §12.7, §12.10 |
| `docs/NOOR_AI3_IMPLEMENTATION_PLAN.md` | §4.8 (the ceilings), §5.1–§5.7 (the store design under review), §9.2, §11.2.1 |
| `docs/PRE_RELEASE_BACKLOG.md` §4.1 | The gate itself: "**No production tables exist for any module, deliberately**", and the four things required "before any table is created", including "Never weaken the pattern established on `public.profiles`" |

### 0.3 What this review could not do, and why that matters

Three of the questions below can only be finished by reading a **live project**. This phase forbids
hosted-project contact beyond public documentation, and correctly so — but the consequence must be
stated rather than worked around: **a review that cannot read the grants it depends on cannot approve
a design that depends on them.** That is not a limitation of this document. It is the reason §5.4
made the gate a gate.

> **Status, 2026-08-07.** That live read has since been performed — read-only, by the repository owner,
> under a prepared and sanitised procedure — and **§17 records it**. Every statement in §§1–16 below is
> preserved as written at `5940352`, because a review that silently rewrites its own premises is not
> auditable. Where §17 supersedes a status, the row or paragraph carries a forward pointer to it.
> **The gate did its job**: two of the questions it held open are now answered from evidence, and the
> answer to one of them was favourable.

### 0.4 Terminology: HMAC keys are not salts

This review uses **HMAC key** for the secret input to an HMAC, and reserves **salt** for a
non-secret, per-input diversifier. The two are not interchangeable, and conflating them is not
pedantry — it drives the wrong controls. A salt may be stored beside the data it diversifies and is
routinely public; an HMAC key must be secret, must have an owner, an access boundary, and a rotation
procedure. Calling a secret key a "salt" invites exactly the treatment a salt gets.

**The two documents under review both use "salt" for what is an HMAC key**, and the construction
settles it. `NOOR_AI3_IMPLEMENTATION_PLAN.md` §6.3 specifies `HMAC-SHA256(salt, user_uuid)` — the
value named "salt" is the keying input to an HMAC, so it is an HMAC key. §5.6's rate-limit value is
the same construction. Contract §B.2's row `safety_identifier salt` and §H.3's "salted hash" are the
same object under the same misnomer.

| Term as used in the plan / contract | What it actually is | This review calls it |
| ----------------------------------- | ------------------- | -------------------- |
| "rate-limit salt", "a dedicated salt" (plan §5.6, §5.6.A) | The secret key of an HMAC computed inside the database | **rate-limit HMAC key** |
| "`safety_identifier` salt" (contract §B.2; plan §6.3) | The secret key of an HMAC computed in the handler | **`safety_identifier` HMAC key** |
| "salted hash", "salted HMAC" (contract §H.1, §H.3, §12.6) | HMAC output | **HMAC output / keyed digest** |
| "unsalted `sha256(auth.uid())`" (plan §5.6.C) | A plain, **unkeyed** digest — there is no salt in it either | **unkeyed digest** |

That last row is worth its own sentence, because the plan's phrasing hides a third construction:
"unsalted sha256" is not a hash with the salt omitted, it is a **keyless** hash. The meaningful axis
is *keyed versus unkeyed*, not *salted versus unsalted*, and §11 is written on that axis.

**No salt construction is proposed anywhere in this design.** Nothing here needs a per-input
diversifier: the inputs are already unique user identifiers, and the property wanted is
unforgeability by someone who lacks a secret, which is what an HMAC key provides and what a salt does
not. If a future design does introduce a genuine salt, it must define the construction separately and
state explicitly whether that salt is secret or public.

The correction is confined to this document. The plan and the contract are **not** rewritten here —
that is outside this review's scope — but their terminology is recorded as a defect the
implementation phase must not propagate into migrations, secret names or tests, where "salt" in an
object name would mislead every future reader about how the value must be protected.

---

## 1. Which schemas are exposed through PostgREST — **RESOLVED**

### 1.1 The answer

| Schema | Exposed? | Evidence |
| ------ | -------- | -------- |
| `public` | **Yes** | `supabase/config.toml:13`, and S1: "By default, your database has a `public` schema which is automatically exposed on data APIs" |
| `graphql_public` | **Yes** | `supabase/config.toml:13`. The file's own comment records why: "`graphql_public` is included because `config push` sends this list to the linked project, and the hosted default exposes it. Omitting it here would silently remove it there" |
| `auth`, `storage`, `extensions`, `vault`, `pg_catalog`, `information_schema` | **No** | Absent from the declared list. S8: "You can only switch to a schema included in `db-schemas`. Using another schema will result in an error" |
| A future `noor_ai` | **No**, unless a migration or a dashboard change adds it | Same |

`extra_search_path = ["public", "extensions"]` is a different setting and must not be confused with
exposure: it adds schemas to the request `search_path` so unqualified function calls resolve, and it
does **not** make those schemas addressable over REST.

### 1.2 The one thing still to confirm, and its real weight

`config.toml` is the **declared** state. It becomes the hosted state when `supabase config push` runs
against the linked project. Nothing in the repository proves that has happened, and this review may
not check.

> **CONFIRMED, 2026-08-07 (§17.3).** The hosted Data API exposes exactly `public` and `graphql_public`.
> The declared list and the hosted list agree, so there is **no drift**, and `vault` is confirmed absent
> from the hosted list as well as the declared one. **B4 is closed** (§17.5). The paragraph below is
> preserved as the pre-verification reasoning.

So the honest status is: **declared in version control, one read away from confirmed.** That is a
material improvement on the plan's §5.6.A fact (2), which recorded the exposed-schema list as
entirely unknown and said "The review must read the exposed-schema setting rather than trust that a
system schema is excluded." The setting is now read — from the repository, which is the more
durable of the two places it lives. What remains is a drift check, not an unknown.

**Consequence for Vault (§8):** `vault` is not in the declared list, so `vault.decrypted_secrets` is
not addressable over REST as declared, *regardless of the grants on it*. That closes the more
alarming half of §5.6.A's fact (2). It does not close the grants question, because grants matter for
in-database reachability too.

---

## 2. Can a function in a private schema be called through `.rpc()` — **RESOLVED: no**

**No.** This is not a matter of degree.

- S8, verbatim: "You can only switch to a schema included in `db-schemas`. Using another schema will
  result in an error." An unlisted schema is not reachable over PostgREST at all — not by `anon`, not
  by `authenticated`, not by `service_role`, not with any header, not with any grant.
- S1 gives the client-side mechanics: `supabase-js` resolves `.rpc()` against the schema configured
  in `db: { schema: … }` (default `public`) or the one named by `supabase.schema(…)`, and transmits
  it as `Accept-Profile` / `Content-Profile`. Those headers **select among exposed schemas**; they do
  not grant reach into unexposed ones.
- S1's own procedure for exposing a schema confirms the direction of the rule: step 1 is "add your
  custom schema to 'Exposed schemas'", and the grants in steps 2–4 are only meaningful afterwards.

### 2.1 The three consequences, and one that the plan did not draw

1. A `noor_ai.reserve(...)` function is **unreachable via `.rpc()`** while `noor_ai` is not exposed.
2. Exposing `noor_ai` makes it reachable — and lands directly on S3's warning
   ("Security-definer functions should never be created in a schema in the 'Exposed schemas'"), which
   is the plan's §5.7 point 5 tension.
3. A thin **wrapper in `public`** calling a private implementation is reachable. But note precisely
   what that buys and what it does not: it protects the **table** and the **secret** from direct
   addressing, and it protects nothing about **who may call the wrapper**. §3 is that question.

**The consequence the plan did not draw:** all three of these are statements about **PostgREST**.
A direct Postgres connection (S7) does not go through PostgREST at all, so the exposed-schema list is
simply irrelevant to it. **§5.7 point 5's tension is not inherent to the design — it is a property of
choosing PostgREST as the transport.** Change the transport and the tension disappears rather than
being mitigated. This is developed in §7.7 and is the single most useful structural finding here.

---

## 3. The exposed wrapper: who can execute it, and can a client call it directly

### 3.1 Who can execute it

| Stage | Who holds `EXECUTE` | Source |
| ----- | ------------------- | ------ |
| Immediately after `CREATE FUNCTION`, with nothing else done | **`PUBLIC`** — therefore `anon`, `authenticated`, `service_role`, and every other role | S10: "by default, execute privilege is granted to `PUBLIC` for newly created functions" |
| After the S10 pattern (`REVOKE ALL … FROM PUBLIC` then `GRANT EXECUTE … TO authenticated`, in the same transaction) | `authenticated` only | S10 |
| If the schema was exposed using S1's boilerplate `GRANT ALL ON ALL ROUTINES IN SCHEMA … TO anon, authenticated, service_role` | **`anon` as well** — the documented exposure procedure re-grants what the hardening step revoked | S1 |

That third row is a live trap, not a hypothetical. S1's exposure procedure and S10's hardening
pattern **pull in opposite directions**, and a migration that follows the exposure guide after
following the hardening guide silently re-opens the function to `anon`. Any future implementation
must therefore assert the *final* grant state, not the sequence of statements that produced it.

RLS provides nothing here. S2, verbatim: **"RLS doesn't apply to functions, so grant `EXECUTE` only
to the roles that need to call them."**

### 3.2 Can an authenticated client call it directly, without the Edge Function? **Yes**

Unambiguously yes, and with no special tooling.

The NoorLife app already holds both credentials the call needs — the publishable key on `apikey` and
a live user access token on `Authorization` — because `src/lib/supabase.ts` establishes exactly that
session for ordinary use. Reaching `POST /rest/v1/rpc/<name>` requires no new secret, no reverse
engineering and no proxy. Contract §B.1 already states the operating assumption for this: the device
is "hostile territory. Assume the APK is unzipped and the traffic is proxied."

There is no mechanism in the path that could prevent it. PostgREST authenticates the JWT and switches
to `authenticated` (S6); the function is granted to `authenticated`; the call proceeds. **Nothing
about a direct call is anomalous from the database's point of view** — see §6.

### 3.3 What abuse becomes possible

This is §5, because the answer is larger than the plan expects and it is the reason for the verdict.

---

## 4. Evaluating the candidate structure

The plan's candidate, assessed component by component rather than as a package. The verdict is that
it is **necessary and insufficient**: every component is correct and worth keeping, and the set of
them does not close the decisive hole.

| # | Component | Verdict | Assessment |
| - | --------- | ------- | ---------- |
| 1 | Exposed, narrowly callable wrapper function | **Sound, with a caveat** | Correct shape for PostgREST reach. Reduces the exposed surface to one callable with a narrow signature and a narrow return type. Does not, and cannot, restrict *who* calls it beyond the grant — §3.2 |
| 2 | Private quota tables | **Sound and load-bearing** | The strongest single control in the set. A table in an unexposed schema is not addressable over REST at all (S8), independently of grants. Combined with #6 it is defence in depth done properly |
| 3 | Private `SECURITY DEFINER` implementation function | **Sound** | Executes as its owner (S3, S10), so it reaches the private table and the Vault view that the caller cannot. `EXECUTE` on it need not be granted to any API role at all if only the wrapper calls it — the wrapper, running as definer, calls it as the owner |
| 4 | Pinned empty or restricted `search_path` | **Sound, and already this repository's convention** | S10's stated purpose is exactly this; S4 makes it mandatory for definer functions. `handle_new_user()` already uses `set search_path = ''`. **One hazard the plan does not state:** the pin lives in the function's `proconfig`, and a later `CREATE OR REPLACE` that omits the `SET` clause **silently drops it**. §9.4 |
| 5 | Fully schema-qualified objects | **Sound and mandatory** | Not a nicety but the direct consequence of #4 — S4: "If you use an empty search path … you must explicitly state the schema for every relation in the function body" |
| 6 | Explicit `REVOKE` from `PUBLIC`, `anon`, `authenticated` where appropriate | **Sound, and must be same-transaction** | S10 is explicit about both the default and the window. The repository already does this (`revoke all on function public.handle_new_user() from public, anon, authenticated`). §3.1's third row is the failure mode to test against |
| 7 | Minimal explicit `GRANT` | **Sound as a principle, and it is precisely where the design fails** | "Minimal" for a PostgREST-reachable function means `authenticated`, because that is the *least* privilege that still permits the intended caller. And `authenticated` is a set that includes every attacker who can complete a signup form. The minimum available on this transport is not small enough — §5 |
| 8 | No dynamic SQL | **Sound and complete** | With typed scalar parameters, an enumerated window kind, no `EXECUTE`, no `format()`, no identifier concatenation, there is no injection surface. This one is genuinely closed |

### 4.1 What the eight components actually close

They close: table addressability; secret addressability; `search_path` hijack; SQL injection; the
`PUBLIC` default-grant window; and — through #1's narrow return type — information disclosure through
the function's own output.

### 4.2 What they do not close

They do not close, and structurally cannot close, **who may invoke the wrapper**. Every control in
the list operates *after* the call is admitted. None of them is an authentication control, because
the only authentication available on this transport is the user's JWT, and the user's JWT is held by
the user.

The plan treats this as a bounded, accepted cost (§5.3 point 2, §5.7's mitigating argument). §5 shows
that the bound is drawn in the wrong place.

---

## 5. Does granting `authenticated` access create a global-denial vulnerability — **YES. This is finding B1**

### 5.1 The claim under review

`NOOR_AI3_IMPLEMENTATION_PLAN.md` §5.3 point 2, verbatim:

> Because `EXECUTE` is granted to `authenticated`, a signed-in user can call the RPC directly through
> the REST API and increment their own counter. They cannot decrement it, reset it, or touch anyone
> else's, **so the effect is self-denial.**

And §5.2's row "No client-controlled counter", verbatim: "A user calling the RPC directly can only
spend its own quota faster."

**Both statements are true of a per-user counter and false of the design the plan actually
specifies.** The error is not in the reasoning about per-user counters — that reasoning is correct.
The error is that the plan reaches its conclusion while looking only at the per-user counters, and
then, two paragraphs later in §5.2, puts everything else in the same store:

> The spend counters and the concurrency lease of §4.8 live in the same store, for the same reasons.
> Splitting them across two mechanisms would mean two failure modes and two things to review.

### 5.2 What §4.8 actually places behind that grant

| Resource | Dev ceiling | Production ceiling (unapproved) | Scope |
| -------- | ----------- | -------------------------------- | ----- |
| Per-user / 60 s | 1 | 5 | One account |
| Per-user / hour | 1 | 25 | One account |
| Per-user / day | 1 | 60 | One account |
| **Global / 60 s** | **1** | **10** | **Every user** |
| **Global / day** | **1** | **150** | **Every user** |
| **Concurrency lease** | **1** | **4** | **Every user** |
| Daily spend ceiling | $0.50 | $15.00 | Every user |
| Monthly spend ceiling | $2.00 | $250.00 | Every user |

The bottom five rows are **shared, global, exhaustible resources**. Under the candidate design they
are consumed by the same RPC, behind the same `GRANT EXECUTE … TO authenticated`, as the per-user
counters.

### 5.3 The abuse conclusion, resource by resource

| Resource | Consumable by a direct authenticated RPC call, with **no provider request**? | Detail |
| -------- | --- | ------ |
| Its own quota | **Yes** | As documented. Self-denial. Acceptable, and correctly analysed by the plan |
| **Global 60-second request quota** | **Yes** | 10 calls (production) or 1 call (dev) exhausts the window. Repeating each minute holds Noor AI at `503` continuously for every user |
| **Global daily request quota** | **Yes** | 150 calls (production) exhausts the day. **One account, one loop, a few seconds of work, and Noor AI is dead for every user until midnight** |
| **Concurrency leases** | **Yes** | 4 calls (production) take every lease. Held until TTL, then retaken. No legitimate request is ever admitted |
| **Global spend allowance** | **Conditionally — and see §12.6 for the worse variant** | Safe *if and only if* the reservation step only **reads** the accrued-spend accumulators and never pre-debits an estimate. If reservation pre-debits, the entire $15.00/day allowance is consumable at zero actual cost. §12.2 makes non-pre-debiting a hard design rule for this reason |

The per-user limits do not bound this. They bound *one account*, and the attack does not need a
second account to reach the global ceilings — 150 direct calls from one account exhausts the global
day while that account's own 60-per-day limit is irrelevant, because the global counter is
incremented by the same call.

### 5.4 Two repository facts that remove the remaining friction

1. **`enable_confirmations = false`** — `supabase/config.toml:50`, whose own comment states "Anyone
   can register any address without proving they control it", and which contract §D.5 already
   records: "'authenticated' currently means 'completed a signup form', which is a weaker abuse
   deterrent than it sounds." So the attacker population is *anyone*, and account creation is neither
   verified nor rate-limited by anything this design touches. §D.5's own warning — "§I.1's per-user
   limits must not be the only defence" — is precisely the warning being violated.
2. **The global controls are the target, not the defence.** Contract §I.2's kill switch and
   error-rate breaker respond to a global ceiling being reached by returning `503`. Under this attack
   the `503` **is the attacker's goal**. The circuit breaker becomes the weapon.

### 5.5 Why this is worse than an ordinary rate-limit bypass

An attacker who bypasses a rate limit costs the operator money. An attacker who **exhausts** a global
rate limit costs the operator nothing and costs every user the feature. This design is vulnerable to
the second, which is cheaper to mount, leaves no billing trace, and looks in the logs exactly like
success — the store did its job, denied everything past the ceiling, and returned `503` as specified.

There is no provider call, so §4.8's spend ceilings never trip, the provider dashboard shows nothing,
and §I.2's breaker sees no upstream failures. **The attack is invisible to every control the contract
defines**, and would be diagnosed as "Noor AI is unexpectedly popular."

### 5.6 Verdict on question 5

**Granting `authenticated` execute access to an RPC that consumes global resources is a
global-denial vulnerability.** Not a caveat, not an accepted trade, not "recorded so the trade is
reviewed rather than discovered" — a defect that would make the endpoint trivially deniable by any
account on day one.

Note carefully what is *not* being said: `EXECUTE` to `authenticated` on an RPC touching **only
per-user counters** remains sound, and the plan's analysis of that case is correct and survives. The
defect is the coupling of global resources to a client-reachable grant. That distinction is the
basis of the two remediation directions in §5.7.

### 5.7 The two directions, neither approved here

| | Direction | Closes B1? | Cost |
| - | --------- | ---------- | ---- |
| **D1** | **Split the grant.** A per-user RPC callable by `authenticated`; a separate global/lease RPC requiring server-origin proof | **Yes** | **Loses atomicity across the two.** A reservation would no longer be one transaction, so a request could pass the per-user check and fail the global one with the per-user counter already consumed — or worse, the reverse. Compensating logic on the hot path, and a new partial-failure state |
| **D2** | **Require server-origin proof for the whole RPC**, so no client can call any of it | **Yes** | Requires a credential the client does not have (§6, §7). Adds one row to contract §B.2. Keeps the reservation atomic in one call, and **also** dissolves §2.1's exposed-schema tension if the transport changes with it |

**D2 is the better direction**, and §7 evaluates the mechanisms that could implement it. D1 is
recorded because it is the only option that preserves the current transport, and because if D2 proves
impossible D1 is what remains.

---

## 6. Can the database distinguish a genuine Edge Function call from a direct client call — **RESOLVED: no**

Under a user-JWT-only design, **no**, and the reason is structural rather than a missing feature.

### 6.1 Everything the database can see, and what each is worth

| What SQL can inspect | Source | Differs between an Edge Function call and a direct client call? |
| -------------------- | ------ | --- |
| `auth.uid()` / `current_setting('request.jwt.claims')` | S9 | **No.** The Edge Function forwards the *caller's own* JWT — that is the entire premise of §5.2 ("the call carries the caller's JWT", "No service-role credential introduced"). The claims are byte-identical because they are the same token |
| `current_role` / `current_user` | S9 | **No.** PostgREST switches into `authenticated` from the JWT's `role` claim in both cases (S6) |
| `current_setting('request.headers')` | S9 | **Values differ; trust does not.** Headers on a direct REST call are entirely attacker-chosen. A header proves server-origin only if it carries a value the client cannot obtain — i.e. a secret. See §7.4 |
| `inet_client_addr()` | Postgres | **No useful signal.** Both requests reach Postgres from the same PostgREST instance. The client address is PostgREST's, not the original caller's |
| Anything set by a `db-pre-request` hook | S9 | **No.** The hook runs inside the same request with the same inputs; it cannot know what the inputs do not carry. It is also a project-wide setting affecting every Data API request, which is far too blunt an instrument for one function |

### 6.2 The result, stated generally

> **A trust boundary that carries only a credential the client also holds cannot distinguish the
> client from the server.**

The user JWT proves *who is asking*. It cannot prove *what path the request took*, because it is
issued to the user, held by the user, and presented unchanged by both parties. The instruction not to
assume the user JWT proves the call passed through the Edge Function is not merely prudent — the
assumption is **provably false**, and any design resting on it is resting on nothing.

### 6.3 Therefore

**Server-origin can be established only by possession of a credential or secret that the mobile
client does not hold.** There is no third option. Every candidate in §7 is an instance of that
statement or a failure to satisfy it.

This also means the plan's §5.6.D observation — that with a dedicated role "the binding is
authoritative at the Edge boundary, and the RPC stops being reachable by end users at all" — is not
one advantage among several. It is the **only** evaluated property that answers question 6 at all.

---

## 7. The authentication designs, evaluated individually

Each is assessed on the seven axes required, and given one of three dispositions. **No design is
approved.** Where a design is rejected, the reason is stated in terms of what it fails to do, not in
terms of what would be convenient.

### 7.1 User-JWT-only RPC

| Axis | Assessment |
| ---- | ---------- |
| Supported in this architecture | **Yes.** S4/S7 — the documented `.rpc()` path, and the wrapper "already scoped to the caller's Row Level Security policies" |
| Required privileges | `EXECUTE` on the wrapper to `authenticated`; `USAGE` on the exposed schema; nothing on the tables |
| Secret exposure / logging | **None new.** Its principal virtue: contract §B.2's table gains no row |
| Replay risk | Not applicable — no token to replay. The RPC is simply openly invocable |
| Mobile client can imitate it | **Yes, trivially — this is its defining property, not an edge case** (§3.2) |
| Effect on the service-role prohibition | **Fully respects it.** Introduces no privileged credential |
| Disposition | **REJECTED for global counters, spend accumulators, leases and finalization. ACCEPTABLE for per-user counters alone**, where §5.3's self-denial analysis holds and is correct |

### 7.2 Service-role invocation

| Axis | Assessment |
| ---- | ---------- |
| Supported | **Yes.** S6: `service_role` is "For elevated access. This role is used by the API (PostgREST) to bypass Row Level Security" |
| Required privileges | Effectively total. RLS bypass across the **entire database**, including `public.profiles` and every future module table |
| Secret exposure / logging | A long-lived bearer credential in the function environment. Leak = full database read/write. Contract §B.2 marks it **Never** for device and repository and "Only if a later phase proves it necessary" for the runtime |
| Replay risk | A leaked key is reusable indefinitely until rotated. There is no per-request binding |
| Mobile client can imitate it | No — the client never holds it |
| Effect on the prohibition | **Directly contrary.** Contract §12.10 warns against wiring one in "for later"; §D.3 point 4 says such a mechanism "must not be introduced casually" |
| Disposition | **REJECTED** |

The rejection does not rest on the prohibition alone — a prohibition can be revisited. It rests on
**proportionality**: this is a database-wide RLS bypass, adopted to increment a counter. The blast
radius of a leak is every row in the project, to protect one table that holds no user content. §7.3
achieves the identical server-origin property with a credential whose blast radius is one function.
Choosing the larger one would be a least-privilege failure with no compensating benefit.

Stated plainly, per the instruction: **no service-role design has been invented here to unblock the
phase.** This option was evaluated and refused.

### 7.3 Dedicated database role

A purpose-made Postgres role holding `EXECUTE` on exactly one function, `USAGE` on exactly one
schema, and nothing else. Reached over a direct connection (§7.7 is its transport).

| Axis | Assessment |
| ---- | ---------- |
| Supported | **Yes.** Postgres roles are ordinary objects; S7 states the transport is safe: "Because Edge Functions are a server-side technology, it's safe to connect directly to your database using any popular Postgres client" |
| Required privileges | `USAGE` on `noor_ai`; `EXECUTE` on the reserve/attempt/finalize functions; **no** table privileges at all (the definer function supplies those); no RLS bypass anywhere else; not a superuser; no `BYPASSRLS` |
| Secret exposure / logging | A connection string as a function secret — one new row in contract §B.2. Genuine, but **bounded**: possession grants exactly the three function calls and nothing else. It must never be logged, and it must not appear in any error surfaced to a client (contract §I.6 already forbids raw upstream errors reaching the user) |
| Replay risk | A leaked password is reusable until rotated, like any credential. Rotation is a secret update plus a redeploy, not a SQL statement — a real operational cost |
| Mobile client can imitate it | **No — because it lacks the credential, not because it cannot reach the endpoint.** See §7.3.1: reachability is not the control |
| Effect on the prohibition | **Does not violate it.** Contract §B.2 forbids the *bypass-everything* key. A least-privilege role is the opposite kind of object, and §5.6.D already frames it as such. It does, however, widen §B.2 by a row, which is a change a reviewer must approve rather than infer |
| Disposition | **ACCEPTABLE IN PRINCIPLE — UNRESOLVED IN DETAIL. Now the leading candidate** |

**Why it is promoted above the plan's ranking.** The plan lists this as the *second* fallback
(§5.6.D), behind Vault-plus-user-JWT. This review promotes it, because it is the only evaluated
mechanism that closes **B1 and B2 structurally** rather than mitigating them, and because §2.1 shows
it simultaneously dissolves the exposed-schema tension that is the plan's third recorded blocker.
Three problems, one change of transport.

**What remains unresolved, and why none of it can be closed here:**

1. **Pooling mode.** Ephemeral isolates open a new connection per cold start (§5.6.D's own premise,
   and contract §I.1's). Direct connections at any concurrency must go through the pooler in
   transaction mode or `max_connections` becomes a **project-wide** availability limit — a risk taken
   on behalf of one counter. S7 does not document the pooler configuration; it must be read from the
   pooler documentation and the live project settings.
2. **A consequence of transaction-mode pooling that the plan does not state, and that constrains the
   lease design:** session-level advisory locks do not survive it. S12 — session-level locks are held
   "until explicitly released or the session ends" and "do not honor transaction semantics" — which
   makes them unusable when the session is a pooled connection recycled between transactions.
   **Therefore the concurrency lease must be a row with an expiry, not `pg_advisory_lock`.** §12.5
   is written to that constraint.
3. **The credential's lifecycle** — provisioning, storage, rotation cadence, and its §B.2 row — is
   unspecified.
4. **Role creation in a migration** is itself a reviewable act: `CREATE ROLE` with `LOGIN` and a
   password cannot appear in a version-controlled migration (§8.4's exclusion applies equally), so
   the role's provisioning is out-of-band exactly as the HMAC key's is, with the same
   local-development consequence (§8.5).
5. **Network reachability of the endpoint** — §7.3.1, which corrects a claim this review made in an
   earlier revision.

#### 7.3.1 Network reachability is not the security boundary

An earlier revision of this section justified "a mobile client cannot imitate the Edge Function" partly
on the grounds that the client "has no route to the database port". **That reasoning is withdrawn.**
It is not supported by anything in §0.1, and it is the wrong kind of argument.

**What must not be claimed:**

- That a mobile client, or any Internet client, cannot reach the database.
- That the Edge Function is distinguishable from other callers because only it can open a connection.
- That transport reachability alone prevents the privileged operation.

**What is actually true, and is the claim this review makes:**

1. **A Supabase direct-connection or pooler endpoint may be network-reachable from an arbitrary
   Internet client**, depending on hosted-project configuration. It is a hostname and a port on the
   public Internet unless something has been configured to make it otherwise. This review has not
   read the project, so it must assume reachable.
2. **Network reachability is not authentication and must never be treated as one.** An endpoint that
   answers a TCP connection has authenticated nobody. This is the same error as §6's — mistaking a
   property of the path for a property of the caller — and it deserves the same treatment.
3. **The mobile client cannot perform the privileged operation because it does not possess the
   dedicated role's credential**, and because that role holds only narrowly reviewed privileges
   (§7.3's privilege row: `USAGE` on one schema, `EXECUTE` on three functions, no table privileges,
   no RLS bypass). Those two facts are the control. Both are properties of authorisation, and both
   are testable.
4. **A leaked credential is fully sufficient to imitate the Edge Function**, from anywhere, until it
   is rotated. There is no second factor, no origin binding and no network check standing behind it.
   This is the honest statement of the residual risk, and it is why the credential's rotation
   procedure (§7.3 point 3) is a blocker rather than a detail.
5. **Network restrictions are defence in depth, if they exist at all for the chosen connection.**
   Whether Supabase supports and this project configures IP allow-listing or an equivalent control on
   the direct or pooler endpoint is **unverified** — S7 says nothing about it, and this phase may not
   read the project. If such a control exists it is welcome as a second layer; it may not be assumed,
   and it may not be counted as the first.

**Why this matters beyond correctness of wording.** The bad version of the argument would have made
the design look *stronger* than §7.1's, on a basis that could evaporate with a configuration change
nobody reviewed. The good version keeps the comparison honest: §7.3 beats §7.1 because a credential
the client does not hold beats a credential the client does hold — a difference in **authorisation**,
which is durable, not a difference in **reachability**, which is not. The promotion of §7.3 to
leading candidate rests entirely on the durable half, and survives this correction unchanged.

Six items this adds to the future implementation's verification burden — T-22 to T-27 in §13.2.

### 7.4 Edge-only shared secret

The Edge Function sends a secret header; the definer function compares it against a Vault-held value
using `current_setting('request.headers', true)::json` (S9).

| Axis | Assessment |
| ---- | ---------- |
| Supported | **Mechanically yes.** S9 confirms headers are readable in SQL, lower-cased |
| Required privileges | Unchanged — `EXECUTE` to `authenticated` is still needed for PostgREST to route the call, plus the definer's Vault read |
| Secret exposure / logging | **The principal objection.** A static bearer value travelling in an HTTP header on **every** request, through the Supabase gateway, PostgREST, and whatever logs either keeps. The plan already worries about a *digest* leaking through a log export (§5.6.B); this puts the **secret itself** on the same path |
| Replay risk | **Total.** Nothing binds the header to the request, the caller or the time. Once observed, it is replayable by anyone until rotated |
| Mobile client can imitate it | Not before a leak; trivially after one — and it fails silently, since a valid secret from a hostile caller is indistinguishable from a valid secret from the function |
| Effect on the prohibition | No service-role, but adds a §B.2 row for a secret with a worse exposure profile than §7.3's |
| Disposition | **REJECTED as a standalone control** |

Two further points. The comparison is a plaintext `=` on text, which is not constant-time; over HTTPS
through PostgREST the practical timing signal is very likely unexploitable, and it is recorded as a
weakness rather than claimed as an attack. More decisively: **the function remains `EXECUTE`-able by
`authenticated`, so unauthorised callers still enter the function body** and are rejected inside it.
The attack surface is unchanged; only the outcome moves. §7.3 removes the surface itself.

### 7.5 HMAC-signed short-lived reservation

The Edge Function computes an HMAC over `(uid, timestamp, operation)` with a shared key; the RPC
recomputes it with a Vault-held key and checks freshness.

| Axis | Assessment |
| ---- | ---------- |
| Supported | Yes — `extensions.hmac` (pgcrypto) is available on Supabase, and S5 covers key storage |
| Required privileges | As §7.4, plus the Vault read |
| Secret exposure / logging | **Worse than §7.4 in one specific way: the key must exist in two places** — the function environment *and* Vault — so there are two copies to protect and two rotation points to keep synchronised. A rotation that updates one and not the other is a total outage of the endpoint |
| Replay risk | **Bounded but open.** Within the freshness window the same signed value is replayable. Narrowing the window trades replay risk for clock-skew fragility between the Edge runtime and Postgres |
| Mobile client can imitate it | No, without the key |
| Effect on the prohibition | Adds a §B.2 row, and the row covers a secret held in duplicate |
| Disposition | **REJECTED as specified** |

It is strictly more machinery than §7.3 — a second copy of a secret, a cryptographic construction, a
clock-skew budget — to achieve a property §7.3 obtains from the transport. And it does not remove the
`authenticated` grant, so §7.4's surface objection applies unchanged.

### 7.6 Nonce / replay-protected signed reservation

§7.5 plus a nonce table with a uniqueness constraint, consumed on use.

| Axis | Assessment |
| ---- | ---------- |
| Supported | Yes |
| Required privileges | As §7.5, plus insert on a nonce table (via the definer, so no new grant to `authenticated`) |
| Secret exposure / logging | As §7.5 — still two copies of the key |
| Replay risk | **Closed**, at the cost of a write on the hot path, a second table, and its own retention and cleanup story |
| Mobile client can imitate it | No |
| Effect on the prohibition | As §7.5 |
| Disposition | **REJECTED on cost/benefit; retained as the design of last resort** |

It is §7.5 plus a table to repair §7.5's flaw, and still leaves the two-copy key problem and the
`authenticated` grant intact. **It is the correct answer only if a direct connection turns out to be
impossible**, and it is recorded here so that outcome has a documented destination rather than an
improvisation.

### 7.7 Direct database connection from the function

This is §7.3's transport, evaluated on its own because its consequences exceed the credential.

| Axis | Assessment |
| ---- | ---------- |
| Supported | **Yes, explicitly.** S7: "Because Edge Functions are a server-side technology, it's safe to connect directly to your database using any popular Postgres client" |
| Required privileges | Whatever the connecting role holds — §7.3 specifies the minimum |
| Secret exposure / logging | The connection string, as §7.3 |
| Replay risk | As §7.3 |
| Mobile client can imitate it | **No — because it lacks the dedicated role's credential.** Not because the endpoint is unreachable: a Supabase direct or pooler endpoint may well be reachable from any Internet client (§7.3.1) |
| Effect on the prohibition | As §7.3 |
| Disposition | **The recommended direction to complete — NOT APPROVED** |

**Its decisive structural property:** it does not use PostgREST. Therefore —

- The exposed-schema list is irrelevant to it. The function may live in `noor_ai`, unexposed, and
  still be callable. **S3's warning is satisfied rather than deviated from**, which is a materially
  better outcome than the plan's §5.7 point 5, where a reviewer is asked to sign off an explicit
  deviation from Supabase's stated guidance.
- No grant to `authenticated` or `anon` is required anywhere. §5's entire attack surface ceases to
  exist rather than being bounded.
- `auth.uid()` is unavailable in the session, so the user id becomes a **parameter** — which resembles
  the rejected §5.6.B but is not it, for the reason §5.6.D gives correctly: the caller is the Edge
  Function, which has already verified the JWT under `verify_jwt = true` plus its own in-handler
  re-verification (contract §D.2 mechanism 2). The binding is authoritative **at the Edge boundary**.
  This holds **only** while the function is **not callable** by end users — a statement about grants
  and credentials, **not** about network reachability (§7.3.1) — so it is conditional on the grant
  discipline above, and that condition must be a test (§13, T-11).

**And one thing it explicitly does not buy.** Removing PostgREST removes the *PostgREST* attack
surface. It does not make the database endpoint private: the direct or pooler host may still accept
connections from anywhere (§7.3.1). What protects it is that a caller must present the dedicated
role's credential and that the role can do almost nothing. Anyone reading this section as "the
database is now internal" has read it wrong, and T-22 to T-27 exist to stop that reading becoming an
assumption in the implementation.

### 7.8 Other documented Supabase mechanisms, considered and dismissed

| Mechanism | Why it does not answer question 6 |
| --------- | --------------------------------- |
| PostgREST `db-pre-request` hook (S9) | Runs inside the same request with the same inputs; it cannot manufacture information the request does not carry. Also a project-wide setting affecting every Data API request |
| Custom claims / auth hooks on the user's JWT | Whatever is minted lands in the JWT **the mobile app receives**. The app then holds it too. It proves nothing about origin |
| A JWT minted by the Edge Function itself | Requires the project's JWT signing secret inside the function — forbidden by contract §D.6 point 2, which states AI-2 "does not add, read or depend on that secret", and by §B.2 |
| RLS policies on the counter table | S2: "RLS doesn't apply to functions." And §9.1: the definer function bypasses RLS by design. RLS cannot gate a function call |
| Provider-side rate limits | Contract §I.1's opening: limits are "defined at the organization and project level, **not** user level" |

---

## 8. Supabase Vault — **appropriate in principle, UNRESOLVED in practice**

### 8.1 What the documentation establishes

All from S5, quoted in §0.1: Vault is a Postgres extension; secrets are created with
`vault.create_secret()` and rotated with `vault.update_secret()`; `vault.decrypted_secrets`
"will decrypt secret data on the fly"; **"anyone that has access to the view has access to decrypted
secrets"**; and "The encryption key is never stored in the database alongside the encrypted data."

That last property is real and load-bearing: a database dump does not yield the plaintext key. It is
the reason Vault is the right *kind* of home for this value, and it is why this review does not reject
Vault.

### 8.2 The five questions, answered

> **Two rows in this table are superseded by §17.4.** The **actual default grants** are now read, and
> the answer is favourable: `anon`, `authenticated` and `PUBLIC` hold **no** `USAGE` on schema `vault`,
> **no** `SELECT` on `vault.secrets` or `vault.decrypted_secrets`, and **no** `EXECUTE` on any Vault
> routine. The table below is preserved as the documentation-only analysis; §17.4 states precisely how
> narrow the closure is.

| Question | Answer | Status |
| -------- | ------ | ------ |
| **Actual default grants** | **Not documented.** S5 states access "should be protected with the appropriate SQL privilege settings at all times" and that "which roles should have access to the `vault.secrets` table should be carefully considered" — it does not publish the defaults | **UNRESOLVED. Not resolvable from documentation.** Requires a live privilege read |
| **Can `anon` or `authenticated` access Vault objects** | Cannot be determined from documentation. It follows entirely from the grants above | **UNRESOLVED** |
| **Is `vault` an exposed schema** | **No, as declared.** `supabase/config.toml:13` lists `public` and `graphql_public` only, and S8 makes unlisted schemas unreachable over REST regardless of grants | **RESOLVED from repository evidence**, pending one live drift check (§1.2) |
| **Can a definer function's owner read it** | **Yes, if the owner holds `SELECT` on the view.** S3 — the function "runs using the same role that created the function"; S6 — `postgres` "has admin privileges". Highly likely, and still an assumption about a grant nobody has read. It also depends on **who actually owns the function** — §9.5 | **UNRESOLVED**, and doubly so: the grant is unread and the ownership is unasserted |
| **Appropriate for an HMAC key or Edge-only shared secret** | **For the HMAC key, yes** — it is the documented use, and the key-not-in-the-dump property is exactly what an HMAC key needs. **For an Edge-only shared secret, the question is moot**, because §7.4 rejects that mechanism on other grounds | Conditional |

### 8.3 The grant question is the one that matters, and it is unchanged

The plan recorded this as unverified fact (1) in §5.6.A. **This review confirms it cannot be closed
from documentation** — S5 simply does not publish the defaults, and this phase may not read the
project.

Note the asymmetry that makes it decisive: §1 removed the *REST* reachability concern, but Vault's
security also depends on **in-database** reachability. If `authenticated` held `SELECT` on
`vault.decrypted_secrets`, then any signed-in user calling **any** exposed function that happens to
select from it — or, in a future migration, any incautiously written definer function — could reach
the HMAC key. The unexposed schema does not protect against a call that originates inside the database.

**Recommending Vault now would mean recommending a secret whose reachability nobody has checked.**
§5.6.E already said exactly that. This review confirms it rather than clearing it.

> **Reachability has now been checked (§17.4), and the specific hazard named in the paragraph above did
> not materialise.** `authenticated` does **not** hold `SELECT` on `vault.decrypted_secrets`, so the
> "any signed-in user calling any exposed function that happens to select from it" path requires the
> *function's owner* to hold the privilege, not the caller — which is the intended definer-function
> design rather than a leak. **The residual risk is unchanged in kind and now correctly located**: an
> incautiously written `SECURITY DEFINER` routine, owned by a role that *can* read Vault, remains able
> to disclose decrypted content to any caller permitted to execute it. §17.4 states that this review has
> **not** enumerated existing definer routines for that behaviour, and §17.8 records why the project's
> current function-grant discipline makes that a live rather than theoretical concern.

### 8.4 Key provisioning, rotation and local-development complications

The plan covers rotation well. Three complications it does not cover:

1. **The migration cannot create the secret.** §5.6.A's exclusions are correct — the value may not
   appear in a migration file. So the HMAC key is provisioned by a one-time out-of-band statement,
   and **the migration references a secret that may not exist**. Consequence: `supabase db push`
   succeeds whether or not the key is present, and the failure appears at the **first call**, in production,
   as a `503`. A successful migration proves nothing about a working store. A deliberate
   provisioning-verification step is required (§12.7, T-19).
2. **`supabase db reset` yields a non-functional store.** Every local and CI environment needs its own
   HMAC key provisioning, and that step is by construction not in version control. This is a permanent
   operational cost on every developer and every CI run, not a one-time setup — and it interacts
   badly with the repository's existing posture, where migrations are written to be re-runnable and
   self-describing (`20260729140000`'s header: "so this migration alone describes the intended end
   state and is safe to re-run"). This design breaks that property for the first time.
3. **Whether the Vault extension is enabled by default on a fresh local stack is unverified.** It is
   not stated in S5, and this phase may not start a local stack to find out.

### 8.5 Vault conclusion

**Appropriate in principle; unresolved in practice; not the blocking issue it was thought to be.**

> **Revised 2026-08-07:** *appropriate in principle, and now* **evidenced in practice for the question
> B3 asked** (§17.4). Vault is installed as `supabase_vault`, the schema and both objects exist, and no
> API role can reach them directly. What remains unresolved about Vault is no longer *who can read it*
> but B10's lifecycle — provisioning into local and CI environments, and rotation — plus the indirect
> definer-routine exposure §8.3 now names. `pgsodium` is **disabled** on the hosted project (§17.2),
> which is a fact the implementation phase must not assume away if it reaches for a pgsodium primitive.

Vault remains the correct home for an **HMAC key**. Its unresolved grant question (B3) is real and
must be closed by a live read. But §5 and §6 have displaced it: the decisive question for R8 is no
longer *where the key lives* — it is *whether the RPC can be reached by clients at all*.
Under §7.7's direction, Vault is still wanted for the identity digest (§11), and its grant question
still needs answering, but it is no longer the question on which the architecture turns.

---

## 9. `SECURITY DEFINER` semantics

### 9.1 Owner privileges and RLS bypass

S10: `SECURITY DEFINER` "specifies that the function is to be executed with the privileges of the
user that owns it"; `SECURITY INVOKER` "is the default". S3: "A 'security definer' function runs
using the same role that *created* the function", and can "bypass RLS". S11: "Table owners normally
bypass row security as well"; "Superusers and roles with the `BYPASSRLS` attribute always bypass the
row security system when accessing a table."

**The plan's §5.7 point 1 is correct**: the bypass is the mechanism that makes the design work, not a
loophole. A deny-all policy set would otherwise deny the function too.

### 9.2 `FORCE ROW LEVEL SECURITY` — the repository has already paid for this lesson

S11: "a table owner can choose to be subject to row security with `ALTER TABLE … FORCE ROW LEVEL
SECURITY`." S11 also gives the default-deny rule: "If no policy exists for the table, a default-deny
policy is used, meaning that no rows are visible or can be modified."

The plan's §5.7 corollary — FORCE must **not** be set — is correct, and this repository does not need
to reason about it hypothetically. `20260729120000_create_profiles.sql` set it;
`20260729140000_fix_profile_trigger_rls.sql` removed it, and its header records the exact failure
mode, verbatim:

> `public.handle_new_user()` is SECURITY DEFINER, so it executes as its owner — the same role that
> owns `public.profiles` — and every policy on the table is scoped `to authenticated`. With the
> owner's exemption withdrawn and no policy matching the owner, the trigger's insert is evaluated
> against a policy set it can never satisfy and is refused.

That is precisely the failure a FORCE'd counter table would produce, with one difference that makes
it worse: the profiles failure was **loud** — it broke signup and surfaced as a 500. A FORCE'd counter
table with an empty policy set would fail **silently**, because `INSERT … ON CONFLICT DO UPDATE`
finding and writing nothing is not an error. Every increment would succeed, return zero, and the
limiter would report `allowed` forever. **A FORCE mistake here is an unmetered endpoint that spends
money, and nothing would report it.**

This must be an asserted test, not a review note (§13, T-16).

### 9.3 `search_path` attacks

S10: "search_path should be set to exclude any schemas writable by untrusted users. This prevents
malicious users from creating objects (e.g., tables, functions, and operators) that mask objects
intended to be used by the function. Particularly important in this regard is the temporary-table
schema, which is searched first by default, and is normally writable by anyone."

Two safe forms, both documented: `SET search_path = ''` with full qualification (S4's guidance and
this repository's convention in `handle_new_user()`), or `SET search_path = admin, pg_temp` with
`pg_temp` **last** (S10's example). The empty form is preferred here because it is the established
repository pattern and because it makes an unqualified reference a hard error rather than a silent
resolution.

Every object reference must then be qualified: `vault.decrypted_secrets`, `auth.uid()`,
`extensions.hmac(…)`, `noor_ai.*`, `pg_catalog.*`. The plan's §5.6.A row states this correctly.

### 9.4 Function replacement and overload hazards — **two, and the second is not in the plan**

1. **`CREATE OR REPLACE` silently drops a `SET` clause that is omitted.** The `search_path` pin lives
   in the function's `proconfig`. A later migration that replaces the function without repeating
   `SET search_path = ''` removes the pin, and nothing errors. The function keeps working, keeps its
   owner, keeps its grants — and becomes hijackable per §9.3. **Test: assert `proconfig` is non-null
   and contains the pin** (§13, T-17).
2. **An added overload is a new function, and gets the `PUBLIC` default again.** `CREATE OR REPLACE`
   preserves an existing function's grants, but a function with a *different signature* is a
   different object. A migration that adds a parameter — a plausible, innocent change — creates a
   **world-executable** overload beside the hardened one, because S10's default applies to it as a new
   function. `REVOKE` and `GRANT` name the full signature, so the existing hardening does not extend
   to it. **Test: enumerate all overloads of the function name and assert the grant set on each**
   (§13, T-12).

### 9.5 Ownership and the migration role — **finding B6**

S3's guarantee is conditional on identity: the function runs as "the same role that *created* the
function". §5.7 point 1's entire argument requires that this role also owns the counter table, so
that S11's "Table owners normally bypass row security" applies.

**The repository does not establish who that role is.** `supabase db push` conventionally applies
migrations as `postgres`, but nothing in `config.toml`, the migrations, or any test asserts it, and
this phase cannot read the live project to confirm. If the function and the table were ever to end up
with different owners — through a manual dashboard action, a differently-privileged CI credential, or
a restore — the design fails, and it fails in the silent direction described in §9.2.

The existing migrations do not need this guarantee as sharply, because `public.profiles` is
policy-governed for its real users. The counter table has **no policies at all**, so owner identity is
the only thing standing between the function and a default-deny.

**This is a new blocker.** Ownership must be asserted by the migration (`ALTER FUNCTION … OWNER TO`,
`ALTER TABLE … OWNER TO`, both explicit) and verified by test (§13, T-18) rather than inherited from
whoever ran `db push`.

### 9.6 Row locking and transaction atomicity

- PostgREST runs each request in its own transaction (S9's "Transaction-Scoped Settings"), so an
  `.rpc()` call is atomic per call. Under §7.7's direct connection the function must be called in an
  explicit transaction, which is equivalent but must be done deliberately.
- `INSERT … ON CONFLICT DO UPDATE … RETURNING` is atomic for a single counter row and takes the row
  lock implicitly. This is the right primitive and the plan names it correctly.
- **A multi-counter reservation touches at least six rows**, and that changes the analysis in a way
  the plan does not address. Two constraints follow:
  1. **Deterministic ordering.** Concurrent reservations that touch the same global rows in different
     orders can deadlock. The function must update in a fixed order — for example subject kind, then
     window kind, then window start — so two concurrent callers always contend in the same sequence.
  2. **All-or-nothing.** A reservation that increments four counters and then finds the fifth over
     limit must consume none of them. §12.2 specifies the mechanism.
- **Advisory locks are not available for the lease** under §7.7's pooling requirement — S12's
  session-level semantics do not survive transaction-mode pooling (§7.3 point 2). The lease is a row
  with an expiry. This is a constraint, not a preference.

---

## 10. The minimum data model

Design level only. No DDL, no types pinned, no migration.

### 10.1 Three tables, in a private schema `noor_ai`

**`noor_ai.window_counter`** — every counted window in one relation.

| Column | Purpose |
| ------ | ------- |
| `subject_kind` | `user` or `global`. Enumerated type, not free text |
| `subject_key` | The keyed digest for `user`; a fixed sentinel for `global`. **Never nullable** — a nullable key breaks the primary key and would collapse all global rows |
| `metric` | `requests` or `spend_micros`. Folding spend into the same relation avoids a fourth table; see the trade-off below |
| `window_kind` | `minute`, `hour`, `day`, `month`. Enumerated |
| `window_start` | Truncated window boundary, UTC |
| `value` | The accumulated count or micro-currency amount |
| `updated_at` | For opportunistic cleanup only |

Primary key `(subject_kind, subject_key, metric, window_kind, window_start)`. This single table serves
**all five** required counters — per-user 60 s / hour / day and global 60 s / day — plus the daily and
monthly spend accumulators.

*Trade-off to record:* folding spend into the same relation concentrates contention on the global
rows, since every request touches both `requests` and (at finalize) `spend_micros` for the same
global window. Splitting spend into its own table would reduce that at the cost of a fourth relation.
The choice belongs to the implementation phase; the contention must be measured, not assumed away.

**`noor_ai.reservation`** — the lifecycle anchor, **and the concurrency lease**.

| Column | Purpose |
| ------ | ------- |
| `reservation_id` | CSPRNG-generated. **Must be unguessable** — §12.6 |
| `subject_key` | The same digest, so a finalize can be bound to its reserver |
| `state` | `reserved`, `finalized`, `released`, `expired` |
| `created_at`, `expires_at` | `expires_at` is the lease TTL horizon — §12.5 |
| `finalized_at` | Null until finalized. The idempotency witness |
| `attempt_count` | Reconciles against §H.3's `upstream_attempts` |

**A reservation *is* a lease.** Live concurrency is `count(*) where state = 'reserved' and expires_at
> now()`. This collapses what would otherwise be two tables into one and makes expired-lease recovery
and double-finalization prevention the same mechanism — a state transition guarded on `state`.

**`noor_ai.provider_attempt`** — per-attempt cost accounting.

| Column | Purpose |
| ------ | ------- |
| `attempt_id`, `reservation_id` | Attempt-grained, joined to its request |
| `occurred_at` | |
| `input_tokens`, `output_tokens`, `reasoning_tokens` | Contract §I.3 and plan §9.1 — reasoning tokens are billed and must be counted separately |
| `estimated_micros` | Computed **in the database** from the price table, never supplied — §12.6 |
| `price_table_version` | Plan §4.8.2: "a stale price table silently under-counts spend". A version column makes staleness auditable rather than invisible |
| `outcome_class` | Coarse: `success`, `transient`, `terminal`. **Never** a provider message or body |

This relation is what keeps contract §4.8's two views reconcilable: the **quota counter increments
once per handler request**, while **every provider attempt including the permitted retry is
cost-accounted separately**.

### 10.2 What the model must not contain, and how it is enforced

Enforced by construction rather than by convention, because a deny-list in a comment is not a control:

| Forbidden | Control |
| --------- | ------- |
| Prompts, responses, any message text | **No text column of unbounded length exists in any of the three tables.** There is nowhere to put it |
| Email addresses | No column of that shape; no join to `auth.users` anywhere in any function body |
| Access or refresh tokens | Same |
| Raw user UUIDs | `subject_key` is typed as a fixed-length digest (`bytea`, or `text` with a `CHECK` on exact length) so **a uuid literally does not fit**. Plan §5.2: "The table holds no column that can carry a uuid" — this makes that a constraint rather than a habit |
| Provider request or response bodies | No column exists. `outcome_class` is a three-value enumeration |
| Secrets | The HMAC key lives in Vault (§8); no function returns it; no table stores it |
| IP addresses, device identifiers, user agent | No column exists. Contract §I.1: the subject is the verified user id, "never IP alone" |

### 10.3 Retention — **finding B7**

| Data | Retention | Rationale |
| ---- | --------- | --------- |
| `window_counter`, `minute`/`hour`/`day` rows | **48 hours** | The plan's figure, and correct: long enough that a day window is never truncated mid-window, short enough to hold no history worth analysing |
| `reservation` | **48 hours** after terminal state | Same window; long enough for reconciliation |
| `provider_attempt` | **48 hours** | Per-attempt records are behavioural. They exist for reconciliation, not history |
| `window_counter`, `month` rows | **Must outlive 48 hours — and the plan has no design for this** | §4.8 sets a **monthly** spend ceiling of $2.00 (dev) / $250.00 (production). A counter enforcing a 30-day window cannot be deleted after 48 hours |

**The gap.** §5.2 states a flat 48-hour retention. §4.8 requires a monthly ceiling. The two are
incompatible as written, and the plan does not notice because §5 was drafted against request counters
and §4.8's monthly figure lives in a different section.

**The resolution, which is not a compromise:** keep per-request and per-attempt rows at 48 hours, and
keep **only a single aggregated monthly accumulator row** long-term. One row per month holding one
running total is not behavioural history about anybody — it is an accounting figure, and it contains
no per-user, per-request or per-time-of-day structure. The 48-hour principle is preserved exactly
where it matters and the monthly ceiling becomes enforceable.

This must be recorded in the data inventory as a deliberate exception with its justification, not
left as an inconsistency for the implementation phase to resolve by whichever section it reads first.

---

## 11. The identity key

Terminology throughout this section follows §0.4: the secret input to an HMAC is an **HMAC key**, not
a salt. Where the plan says "salt" for these values, it means an HMAC key.

### 11.1 The options

| Option | Verdict |
| ------ | ------- |
| Raw `auth.uid()` | **Rejected.** Contract §H.2 deny-lists the raw user id, and §10.2's typed-digest control exists to make it unstorable |
| **Unkeyed** `sha256(auth.uid())` — the plan's "unsalted" option | **Viable fallback, and it must not be called pseudonymous.** Plan §5.6.C's analysis is correct and this review adopts it unchanged. Note there is no salt in this option either: it is keyless, not salt-less (§0.4) |
| **Keyed HMAC under a dedicated, Vault-held HMAC key** | **Recommended, conditional on §8's grant question** |
| A genuine salted construction | **Not proposed, and not needed.** A salt diversifies identical inputs; user ids are already unique, and the property wanted is unforgeability without the secret, which a salt does not provide |

### 11.2 Equality leakage — a property no option removes

Any deterministic key produces the same value for the same user, so **all rows belonging to one user
are linkable to each other whether the construction is keyed or not**. That is not a defect; it is
the function the identifier performs — a counter that could not recognise a returning user would not
be a rate limit.

What keying changes is a different and narrower thing: whether a digest can be linked **back to a
known user** by someone who does not hold the key. That distinction determines what the HMAC key is
worth, and the plan's §5.6.C gets it right where a looser analysis would not.

### 11.3 What the HMAC key is actually worth, against which adversary

| Adversary | Unkeyed digest | Keyed digest (HMAC) |
| --------- | -------------- | ------------------- |
| Holds only digests, no user list | Cannot reverse — a v4 uuid has a 2^122 keyspace | Cannot reverse |
| **Holds the database** (counter table *and* `auth.users`) | **Re-links every row** by computing one hash per user. A full-table join, not an attack | **Also re-links every row**, because the HMAC key is in the same database |
| **Holds an exported digest** — a log line, a support dump, a backup | **Links it to a user** if they also have the user list | **Cannot link it**, without the key |

**So the HMAC key buys nothing against the database-compromise adversary and everything against the
export adversary.** The plan states this and it is correct.

The question is then whether the export adversary is real for this value. **It is**, and one repository
fact settles it: contract §H.3's operational log carries a `user_hash`. Digest-shaped identity values
**already leave this database by design**. A design whose privacy rests on a digest never being
exported is a design that breaks the first time a log is shared with support — which §5.6.B already
worried about in a different context.

### 11.4 The three identifiers must not be comparable — **finding B9**

#### 11.4.1 The requirement

Three derived identifiers exist, with three different destinations:

| Value | Where it goes | Exposure |
| ----- | ------------- | -------- |
| Rate-limit `subject_key` | Never leaves the database | In-database only |
| §H.3 `user_hash` | Operational logs | Exportable to whoever investigates an incident |
| §6.3 `safety_identifier` | **Sent to OpenAI** | Leaves NoorLife entirely |

> **Requirement, which is not negotiable and is independent of construction:** for the same user, the
> three outputs **must not be linkable merely by comparing their values**. No two of them may be
> equal, and none may be derivable from another without the relevant secret.

The reason is concrete rather than principled. If `user_hash` equals `safety_identifier`, then anyone
holding an exported NoorLife log line and the provider-side data can join the two datasets by string
equality — no key, no cryptanalysis, no inference. A support export becomes a linkage key into a
third party's records.

#### 11.4.2 This is not a hypothetical gap — the current design specifies two of them as equal

An earlier revision of this review recorded B9 as "`user_hash` has no assigned key". **That was too
generous.** The documents do assign it, and they assign it to be *identical*:

- Contract §H.3, verbatim: "`user_hash` is the same salted hash as `safety_identifier`".
- Plan §6.3, verbatim: "note that §H.3's log includes `user_hash` as the *same* value, so adopting
  the HMAC settles the log question at the same time and both must be reviewed together."

So the current specification makes an operational-log value **byte-identical** to a value transmitted
to OpenAI. That is precisely the direct-comparison linkage the requirement above forbids, it is
written down rather than overlooked, and the plan's own disclosure note in §6.3 already recognises the
coupling without following it to this conclusion.

**Computing one `HMAC(uid)` and sending it to all three destinations is therefore not an available
option**, and B9 is a live defect in the specification rather than an unfilled blank.

#### 11.4.3 Two candidate patterns, both admissible

The requirement constrains the outputs. It does **not** by itself dictate how many stored secrets
there are, and this review will not claim that three separately stored keys are the only valid
construction — no source in §0.1 establishes that, and asserting it would be exactly the kind of
unevidenced absolute this review exists to avoid.

**Pattern A — three independent HMAC keys.**

| | |
| --- | --- |
| Construction | One independently generated HMAC key per purpose |
| Separation strength | **Strongest operational separation.** The three keys share nothing |
| Compromise blast radius | Compromise of one key need not expose derivation of the other two identifiers |
| Cost | **Three storage and rotation lifecycles**, in two different homes — the rate-limit key in Vault (computed in-database), the `safety_identifier` key in the function environment (computed in the handler, per plan §6.3), and a third for `user_hash` |
| Review burden | Three provisioning procedures, three rotation procedures, three places to get wrong |

**Pattern B — one protected master key with explicit cryptographic domain separation.**

| | |
| --- | --- |
| Construction | A single protected master key, plus **distinct fixed context labels** per purpose — either deriving purpose-specific subkeys, or domain-separating the HMAC input with an unambiguous encoding of the label |
| Additional requirement | **Output encodings must remain purpose-specific**, so the three values are not interchangeable even if a derivation were ever duplicated |
| Separation strength | Cryptographic rather than operational. Sound in principle; entirely dependent on the construction being correct |
| Compromise blast radius | **Compromise of the master key affects all three purposes at once.** This is the material downside and must not be softened |
| Cost | **Simpler secret inventory** — one secret to provision, protect and rotate |
| Review burden | **The exact construction requires cryptographic review before implementation.** Domain separation done casually — concatenating a label without an unambiguous encoding, for instance — can fail to separate anything |

A further practical constraint on Pattern B in *this* architecture, recorded because it is easy to
miss: the three digests are computed in **two different places** — one inside Postgres, two inside the
Edge handler. A single master key would therefore have to exist in both, which reintroduces the
two-copies-of-one-secret problem that §7.5 was rejected for. Pattern B is materially more attractive
for the two handler-side values than it is across all three.

#### 11.4.4 Which is recommended

**Pattern A is currently recommended**, for two reasons and not for a third:

1. **The blast radius is the deciding factor.** One of these three values crosses to a third party.
   A master-key compromise that simultaneously exposes the derivation of an outbound provider
   identifier, an operational-log identifier and an internal quota key is a worse day than losing any
   one of them, and this project has no key-management practice in place to argue that risk down.
2. **Pattern B's cost advantage is smallest exactly where the risk is highest.** The architectural
   split in §11.4.3 means Pattern B cannot collapse the inventory to one secret across all three
   purposes without putting the master key in two places.

The reason it is *not* recommended is worth stating too: not because Pattern B is unsound. It is a
standard, respectable construction, and a hybrid — one master key domain-separated across the two
handler-side values, plus an independent in-database key for the rate limiter — may well be the right
answer. **That hybrid is not evaluated here** and would need the cryptographic review Pattern B
requires.

**Pattern B must not be selected merely because one secret is easier to manage than three.**
Convenience is not a security argument, and it is the argument most likely to be made when the
implementation phase meets three provisioning procedures.

**Either pattern leaves R8 blocked** while key management and rotation are unresolved (§11.5, B10).
The choice of pattern does not unblock anything; it only determines what must be specified.

### 11.5 Rotation and lookup

- **Rotation** invalidates every live counter, since the digests change. Self-healing within the
  48-hour window; the plan states this correctly and it is acceptable **for the rate-limit key**.
- **Rotation is not uniform across the three**, and the difference is a design constraint rather than
  a detail. Plan §6.3 states that rotating the `safety_identifier` key "resets the provider's abuse
  correlation, which is the thing the identifier exists to provide", so it is rotated only on
  suspected exposure and with a version-tag bump. The rate-limit key can be rotated freely; the
  outbound one cannot. **Under Pattern B a single rotation would hit all three at once**, forcing the
  most constrained purpose to govern the cadence of the least constrained — a further argument for
  Pattern A, and one that must be resolved before either is adopted.
- **Rotation procedure is unresolved for every one of the three.** No document specifies who rotates,
  on what trigger, with what verification, or how a rotation is proved to have taken effect. This is
  part of B10.
- **Lookup** is write-only in one direction: the function computes the digest from `auth.uid()` (or,
  under §7.7, from the parameter) on every call and never needs to reverse it. **No reverse map may
  exist, and no index on any plaintext identifier may exist.** This should be an explicit
  non-requirement in the migration's comments, because the natural instinct when debugging is to add
  exactly such a map.

### 11.6 Recommendation

**Keyed HMAC under a dedicated, Vault-held HMAC key for the rate-limit `subject_key`, separated from
the other two identifiers under Pattern A (§11.4.4) — conditional on B3 and B10.** The unkeyed digest
remains the documented fallback if and only if §8's grant question resolves against Vault, adopted
explicitly with the linkability recorded in the data inventory, exactly as §5.6.C requires and never
silently as "it's hashed anyway."

This review does **not** overturn the plan's §5.6 conclusion on the identity key. It confirms it,
corrects its terminology (§0.4), sharpens the adversary analysis (§11.3), and replaces the earlier
"third salt is unassigned" reading of B9 with the stronger and better-evidenced finding that two of
the three identifiers are currently specified to be **equal** (§11.4.2).

---

## 12. The request lifecycle

### 12.1 The sequence

| # | Step | Trust | Atomicity |
| - | ---- | ----- | --------- |
| 1 | **Reserve** — before any provider call | Requires server-origin proof (§6) | One transaction, one call |
| 2 | **Deny without provider call** when over limit | — | Guaranteed by ordering |
| 3 | **Register attempt** — once per provider attempt, including the §F.8 retry | Server-origin | One row insert |
| 4 | **Finalize** — actual or estimated token cost | Server-origin | One transaction, idempotent |
| 5 | **Release the lease** | Server-origin | Same transaction as step 4 |
| 6 | **Recover** after crash or timeout | — | Lazy expiry at the next reserve |

### 12.2 Reserve, and the correction to the plan's increment

The plan specifies `INSERT … ON CONFLICT (key, window_start) DO UPDATE SET count = counter.count + 1
RETURNING count` — increment unconditionally, then compare. **That charges a denied request against
the user's quota**, so a user already at the limit is pushed further past it by every attempt, and the
`retry_after` they are given is wrong.

**Use a conditional increment instead:**

> increment only where the current value is below the configured ceiling, returning the new value; no
> returned row means the ceiling was already reached.

This is a single statement, atomic against concurrent callers, and it does not consume quota on
denial.

**Across six counters**, the constraint is all-or-nothing (§9.6). The workable pattern:

1. Open a sub-block (a plpgsql exception block, which establishes a savepoint).
2. Conditionally increment all six counters **in the deterministic order** of §9.6.
3. If any returns no row, `RAISE` — the savepoint rolls back every increment made in the block.
4. Catch it in the enclosing block and `RETURN` a denial normally, so the caller receives a decision
   rather than an error.

Two properties of this to record honestly: a plpgsql exception block establishes a **subtransaction**,
which is not free and must be measured on the hot path; and the decision must be returned as data,
never as a raised exception, or the Edge Function receives an error it cannot distinguish from a
store failure — which contract behaviour maps to `503` rather than `429`.

**Hard rule from §5.3:** the reservation step **reads** the spend accumulators and compares them; it
**never pre-debits an estimate**. Pre-debiting would make the global spend allowance consumable
without a provider call, converting §5's availability attack into a second, cheaper one. Contract
§I.2 requires only that accrued spend be checked before calling — "On breach: stop calling the
provider" — which a read satisfies.

### 12.3 Deny without a provider call

Guaranteed by ordering, and already the shape of the existing handler: `RateLimitDecision` of
`limited` maps to `429` and `unavailable` maps to `503`, with no provider call on either path
(`production.ts`, `ports.ts:140`). Nothing needs to change conceptually — but see §12.9, because the
existing **port** cannot express the rest of this lifecycle.

### 12.4 Register every attempt; finalize once

- **Attempt registration** is per provider attempt, so the §F.8 retry is recorded separately. This is
  what makes `upstream_attempts` reconcilable with the quota counter, and what makes contract §4.8's
  deliberate disagreement between the two counters auditable rather than confusing.
- **Finalization** is idempotent by state guard: the update proceeds only where the reservation is
  still `reserved`. Zero rows affected means it was already finalized — return the prior outcome and
  **do not accumulate spend a second time**. This is the whole of double-finalization prevention, and
  it needs no nonce table.
- Replay of a **reserve** call is not preventable and does not need to be: each reserve legitimately
  creates a new reservation and consumes quota, which is the metering working as intended.

### 12.5 Lease TTL — **finding B8**

The lease is a row with `expires_at`, not an advisory lock (§7.3 point 2, §9.6).

**The rule the plan does not state:**

> `lease_ttl` **must exceed** the handler's total budget (contract §F.7) plus a clock-skew allowance
> between the Edge runtime and Postgres.

If it does not, a slow-but-alive request loses its lease while still running, a second request is
admitted in its place, and **actual concurrency exceeds the configured ceiling** — which is the one
thing the lease exists to prevent. The failure is silent and load-dependent: it appears only under the
concurrency the limit was built for.

Conversely the TTL must not be so long that a crashed isolate holds a slot for minutes. Bounded from
both sides, it is a narrow range, and it must be derived from §F.7's budget rather than picked.

**Expiry is evaluated lazily** at the next reserve call, over a bounded row count — no scheduler
dependency, matching the plan's opportunistic-cleanup posture.

### 12.6 Two abuse vectors in the lifecycle itself — **finding B2**

These exist only if the RPCs are client-reachable, and they are the reason §5's remediation must be
D2 rather than D1.

1. **Spend poisoning through `finalize`.** The finalize call carries token counts. If it is reachable
   by `authenticated`, any signed-in user can finalize with fabricated counts and drive the global
   daily spend accumulator to its ceiling. Contract §I.2's response to a breached spend ceiling is to
   **stop calling the provider and return `503` until the window rolls**. So this is a *second*
   global-denial primitive, and it is **worse than §5's**: it needs a handful of calls rather than
   150, and it reaches a control specifically designed to shut the service down.

   Partial mitigation, insufficient on its own: the function computes `estimated_micros` **in the
   database** from the price table, accepting only raw token counts. That bounds the arithmetic and
   does not bound the input. A caller can still claim implausible token counts.

2. **Cross-user finalization.** If `reservation_id` were guessable, a caller could finalize another
   user's reservation — releasing their lease early or corrupting their accounting. **Two controls,
   both required:** `reservation_id` must be CSPRNG-generated and unguessable, and finalize must
   verify the reservation belongs to the calling subject.

Under §7.7's direction both vectors cease to exist, because neither function is reachable by a client
at all. Under any user-JWT-reachable design, vector 1 has **no complete mitigation** — the token
counts are inherently caller-supplied, and there is nothing in the database that can check them
against a provider call it did not observe.

### 12.7 Recovery, and one failure the plan does not surface

- **Crash or timeout after reserve, before finalize:** the reservation expires at `expires_at` and
  stops occupying a lease. Quota already consumed is **not** refunded — correct, because a request
  that reached the provider may have cost money, and the store cannot know whether it did.
- **Crash between the provider call and finalize:** spend is **under-counted**. Unavoidable without a
  two-phase commit across an HTTP boundary, and it fails in the direction of under-billing rather than
  over-denying. It must be recorded as a known accounting limitation, not discovered during a spend
  investigation.
- **The HMAC key is absent** (§8.4): the function raises on every call, the limiter returns `unavailable`,
  and the handler returns `503` for every request. Fail-closed, which is right — but indistinguishable
  from a database outage. A distinct startup or health check is needed so this is diagnosed in minutes
  rather than hours.

### 12.8 `auth.uid()` is NULL

Plan §5.6.A's row is correct and must survive into any design where `auth.uid()` is the source:
**raise and deny; never compute a digest over NULL**, or every unauthenticated caller shares one
bucket. Under §7.7's direction the equivalent check is that the user-id parameter is a well-formed
uuid and non-null, applied with the same severity.

### 12.9 The existing port cannot express this lifecycle

`ports.ts:145` defines `RateLimiter = { check: (userId, nowMs) => Promise<RateLimitDecision> }` — a
single call returning `allowed` / `limited` / `unavailable`.

The lifecycle above needs **reserve → attempt → finalize/release**, carrying a `reservation_id`
between them. The current port has no reservation identity, no finalize, no release, and no way to
report spend. **It cannot be implemented against; it must be redesigned.**

This is not a defect in AI-2 — the port was correctly written to what AI-1's §I.1 specified, which was
a rate limiter. It becomes insufficient because §4.8 later added spend accounting and a concurrency
lease to the same store. It is recorded here so the implementation phase treats the port change as a
**reviewed contract change** rather than an incidental refactor, and so `handler.ts`'s `503` mapping
for `unavailable` is deliberately preserved through it.

---

## 13. Trust boundaries, and the test matrix

### 13.1 The boundaries, and what each establishes

```text
mobile app ──①──► Supabase gateway ──②──► NoorAI Edge Function ──③──► quota RPC / store ──④──► OpenAI
```

| # | Boundary | Authenticates identity? | Proves server-origin? |
| - | -------- | ----------------------- | --------------------- |
| ① | app → gateway | **Yes.** `verify_jwt = true` validates the JWT before the handler runs (contract §D.2, §D.4 row 1) | No — and it is not asked to |
| ② | gateway → Edge Function | Inherited from ① | Internal to the platform; not a NoorLife control |
| ③ | **Edge Function → quota store** | **Yes, redundantly** — the same JWT, re-presented | **NO, under the candidate design.** §6 |
| ④ | Edge Function → OpenAI | Proves *NoorLife's* identity to the provider, via the provider key | Not applicable in that direction |

**Boundary ③ is the one this review is about, and it currently proves nothing that boundary ① has not
already proved.** It re-presents a credential the client also holds, so it re-authenticates identity
and establishes no origin. Contract §B.3 enumerates three boundaries and does not name this fourth
one — which is why §15 makes one narrow addition there.

### 13.2 The required test matrix

For the future implementation. **None of these were run**; several cannot be run without a database,
which this phase forbids.

| # | Test | Must prove | Runnable without a live/local database? |
| - | ---- | ---------- | --- |
| T-1 | **Unauthenticated denial** | `anon` and a request with no JWT are refused at every entry point: the RPC, the wrapper, the tables | No |
| T-2 | **Direct authenticated RPC abuse — per-user** | A direct call consumes only the caller's own quota. Confirms §5.3's *correct* half | No |
| T-3 | **Direct authenticated RPC abuse — global. The B1 regression test** | A direct authenticated caller **cannot** consume the global counters, the leases, or the spend accumulators. **This test must fail against the design as currently specified** — that is its purpose | No |
| T-4 | **Direct finalize abuse — the B2 regression test** | A direct authenticated caller cannot finalize, cannot inject token counts, and cannot finalize another subject's reservation | No |
| T-5 | **Cross-user isolation** | User A's calls never alter user B's counters; no digest collision path exists | No |
| T-6 | **Simultaneous requests** | N concurrent reservations at a ceiling of M admit exactly M. No lost updates, no double-admission | No |
| T-7 | **Cold starts / multiple isolates** | Counters are shared across isolates. **This is §J.13b's job** — it exists to fail an in-memory implementation | No |
| T-8 | **Global-limit exhaustion** | The global ceiling denies with `503`, and denial consumes no further quota (§12.2) | No |
| T-9 | **Lease expiry** | An abandoned reservation stops occupying a slot after TTL, and **not before** — the §12.5 constraint, tested against a handler that runs to its full §F.7 budget | No |
| T-10 | **Duplicate reservation / finalization** | A second finalize is a no-op: no double spend accrual, no second lease release | No |
| T-11 | **Retry accounting** | One handler request with one permitted retry yields **quota counter 1, attempts 2** — contract §4.8's deliberate disagreement, asserted | No |
| T-12 | **Transaction rollback** | A reservation that breaches its sixth counter consumes **none** of the first five (§12.2). Plus: **every overload** of the function name has the intended grant set (§9.4) | No |
| T-13 | **RLS / grant verification, three roles** | For `anon`, `authenticated` and a privileged role: enumerate the actual privileges on `noor_ai.*` and on every function overload. Assert the **final state**, not the migration statements — §3.1's third row | No |
| T-14 | **No prompt or content storage** | Static: no unbounded text column in any table; no function parameter accepts message text. Plus a live check that every column is within its declared type | **Partly** — the static half |
| T-15 | **No provider call after quota denial** | A denied reservation is followed by zero outbound provider requests. Extends the existing handler test tier | **Yes** — with fakes |
| T-16 | **`FORCE ROW LEVEL SECURITY` is not set** — §9.2 | The repository has already suffered this once, and here it would fail **silently**. Assert `relforcerowsecurity` is false | No |
| T-17 | **`search_path` pin survives replacement** — §9.4 | `proconfig` is non-null and contains the pin, after every migration | No |
| T-18 | **Ownership** — §9.5 | The function and the table have the **same, expected** owner | No |
| T-19 | **HMAC key provisioning is verified, not assumed** — §8.4 | A migration that succeeds against a project with no key must not read as a working store | No |
| T-20 | **Vault reachability** — B3 | `anon` and `authenticated` hold **no** privilege on `vault.secrets` or `vault.decrypted_secrets`; `vault` is not in the exposed-schema list | No |
| T-21 | **Deliberate revision of the AI-2 source-scan assertions** | `source-scan_test.ts` currently asserts no `@supabase/supabase-js`, no `createClient(`, no query builder, no SQL. An implementation collides with all four (plan §9.2). They must be **narrowed deliberately** — to the quota store's specific call sites — not deleted | **Yes** |
| T-22 | **Is the chosen direct/pooler endpoint publicly reachable?** — §7.3.1 | Establish, by attempting a connection from an unrelated network, whether the endpoint accepts connections from arbitrary Internet clients. **The expected answer is "yes", and the test exists to record it rather than to fail** — a design that assumed "no" would be the defect | No |
| T-23 | **TLS is required and the certificate is validated** — §7.3.1 | The connection refuses to proceed without TLS, and the client verifies the server certificate rather than accepting any. A credential sent over an unvalidated channel is a credential in transit to whoever is in the middle | No |
| T-24 | **Connection / pooler mode is what was reviewed** | The function connects in the reviewed mode (transaction-mode pooler, per §7.3 point 1), and session-dependent constructs are absent — which is what §7.3 point 2 and §12.5 require | No |
| T-25 | **Credential rejection using an unauthorised client** | A client presenting no credential, a wrong password, or a different role is refused. Confirms authentication is doing the work that §7.3.1 says reachability is not | No |
| T-26 | **The publishable key plus a valid user JWT grants nothing at the database** | Holding exactly what the mobile app holds yields **no** PostgreSQL connection and **no** ability to execute the quota functions. This is the direct test of §7.3.1's central claim, and the one that would catch a regression back to a client-reachable design | No |
| T-27 | **The dedicated credential grants only the intended privileges** | With the dedicated role: `EXECUTE` on exactly the intended functions, `USAGE` on exactly the intended schema, and **nothing else** — no table access, no other schema, no RLS bypass, no role membership. Enumerate the actual privilege set rather than asserting the grant statements | No |

**Twenty-five of twenty-seven require a database.** That is itself a finding: the implementation phase
cannot be verified without a local Postgres, and this phase's prohibition on Docker and local stacks —
correct for a design review — means the implementation phase must budget for one before it starts.

#### 13.2.1 What the 2026-08-07 hosted read changed in this matrix

**Nothing became a passing test.** A one-off configuration read is evidence, not a test, and none of the
twenty-seven is now automated. Three moved from *no evidence* to *partial evidence*:

| # | Movement |
| - | -------- |
| **T-20** | **Its `anon`/`authenticated` half is satisfied by evidence** (§17.4), and its exposed-schema half is confirmed (§17.5). It is **not closed as a test**: it must still be asserted automatically, because a grant that is correct today is not a grant that stays correct. §17.4 also narrows what T-20 must assert — direct privilege only; the indirect definer path needs its own assertion |
| **T-13** | Unchanged for `noor_ai.*`, which does not exist (§17.2). But §17.8 gives it a **second, concrete target**: the *existing* `public` functions, where the evidence shows the hardening convention was applied to one of three |
| **T-22** | **Partially evidenced, and not by a probe.** Network restrictions are disabled (§17.3, §17.10), so the endpoints are not IP-restricted by configuration. That is consistent with T-22's expected answer of "yes, reachable" and is the *configuration-level* half of it. **No connection was attempted from any network**, so the measured half remains unrun |

T-23 is **not** satisfied and has in fact hardened into **B14** (§17.9). T-24 to T-27 are untouched.

---

## 14. Conclusion

> ## **BLOCKED**

> **Re-affirmed 2026-08-07 after the hosted read-only verification of §17.** The verification closed
> **B3** narrowly and **B4** outright, and found **five new blockers**. The verdict does not move,
> because the verdict never rested on B3 or B4: it rests on **B1** and **B2**, which are design defects
> that no verification can close. A favourable privilege read is a good result and not an approval.

Not for want of analysis, and not because the remaining questions are unanswerable. R8 is
substantially **narrowed** — four questions the plan left open are now closed, one of its three
recorded blockers dissolves conditionally, and the recommended direction has changed on the evidence.
But two new critical defects were found, one of which invalidates the plan's central safety claim,
and neither can be closed by documentation.

### 14.1 The blockers

| # | Blocker | Status | Closable how |
| - | ------- | ------ | ------------ |
| **B1** | **Global-denial via direct RPC.** Global counters, concurrency leases and (if pre-debited) the spend allowance are consumable by any authenticated caller with no provider request. Plan §5.3's "the effect is self-denial" is **false as scoped** | **NEW — CRITICAL** | A design change: §5.7's D1 or D2. Not by verification |
| **B2** | **Spend poisoning via direct finalize.** Token counts are caller-supplied on a client-reachable RPC; a handful of calls trips the global spend ceiling and its `503` | **NEW — CRITICAL** | Same. Has **no complete mitigation** under any user-JWT-reachable design |
| **B3** | **Vault privilege verification.** The default grants on `vault.secrets` / `vault.decrypted_secrets` are unverified — S5 does not publish them, so whether `anon` or `authenticated` can reach the HMAC key is unknown. Scope: **who can read the key store**, not where the key lives or how it rotates | **CLOSED 2026-08-07 for direct access only** (§17.4). `anon`, `authenticated` and `PUBLIC` hold no `USAGE` on `vault`, no `SELECT` on either object and no `EXECUTE` on any Vault routine. **Not closed for indirect disclosure** through an unrelated `SECURITY DEFINER` routine, which was not enumerated | Direct half: closed by evidence, to be held closed by T-20. Indirect half: a definer-routine audit plus its own assertion |
| **B4** | Exposed-schema list unverified | **CLOSED 2026-08-07** (§17.5). Hosted Data API exposes exactly `public` and `graphql_public`, matching `config.toml:13`. **No drift.** `vault` is confirmed unexposed on the hosted project | Done. Re-checked by T-20's second half whenever the schema list changes |
| **B5** | Exposed-schema tension for definer functions (plan §5.7 point 5) | **CONDITIONALLY DISSOLVED.** It is a property of the PostgREST transport, not of the design. A direct connection removes it — and satisfies S3's warning instead of deviating from it | Adopt §7.7, or sign off the deviation |
| **B6** | **Function/table ownership unverified.** §5.7's entire RLS-bypass argument depends on it, and it is asserted nowhere | **NEW** | Explicit `OWNER TO` in the migration + T-18 |
| **B7** | **Monthly spend ceiling has no retention design.** §5.2's flat 48 hours cannot support §4.8's monthly ceiling | **NEW** | §10.3's aggregated-accumulator resolution, recorded in the data inventory |
| **B8** | **Lease TTL vs handler budget unspecified.** Too short and real concurrency silently exceeds the ceiling | **NEW** | §12.5's rule, derived from §F.7 |
| **B9** | **Identifier separation / domain separation.** Two of the three derived identifiers are currently specified to be **equal** — contract §H.3 makes `user_hash` "the same salted hash as `safety_identifier`" — so an exported log line joins to provider-side data by string comparison. Scope: **how the three outputs are kept non-comparable**, and whether that is done with independent keys or one domain-separated master key | **NEW — upgraded from "unassigned" to "specified as equal"** | §11.4.1's requirement, met by Pattern A (recommended) or a cryptographically reviewed Pattern B (§11.4.3–§11.4.4) |
| **B10** | **HMAC key lifecycle — provisioning and rotation.** No local/CI provisioning path exists, so `supabase db reset` yields a store that migrates cleanly and fails at first call; and no rotation procedure is specified for any of the three keys (who rotates, on what trigger, verified how). Scope: **getting a key into every environment and changing it safely**, distinct from B3's "who can read it" | **NEW** | A provisioning step + a rotation procedure per key + T-19 |
| **B11** | **PostgreSQL major-version mismatch.** `supabase/config.toml` declares `major_version = 15`; the hosted project reports **17**. Migrations, `db reset`, the shadow database and every one of §13.2's twenty-five database tests would run against a different major version than production | **NEW 2026-08-07** (§17.6) | A deliberate decision — align the declaration upward, or record the divergence with its consequences. **Not changed in this phase** |
| **B12** | **The Data API automatically exposes new tables.** "Automatically expose new tables" is **enabled** on the hosted project, so a table created without an explicit privilege posture is published rather than private-by-default. §10.1's three tables would land in `noor_ai`, but the setting is project-wide and the first migration is where it bites | **NEW 2026-08-07** (§17.7) | A pre-migration gate: assert the final privilege state per table, and decide the setting deliberately. **Not toggled in this phase** |
| **B13** | **Function privilege and Data API exposure posture unverified.** Two **independent** observations, not joined: (i) *repository evidence* — of the three existing `public` functions, only `handle_new_user()` carries an explicit `revoke … from public, anon, authenticated`; `set_updated_at()` and `enforce_client_plan_code()` do not, and their effective hosted privileges were never read; (ii) *dashboard evidence* — the dashboard displayed **"2 of 3 functions exposed"**, a bare count whose semantics were not established from official documentation and which did not identify the functions. `pg_default_acl` holds **24 rows** whose contents were not read, so the creation-time default for *new* functions is unproven in either direction | **OPEN — NEW 2026-08-07** (§17.8) | A per-signature audit: effective `EXECUTE` for `PUBLIC`/`anon`/`authenticated`/`service_role`, the exposure state of the *same* exact function, and whether it is invocable through PostgREST. Plus: enumerate the default ACLs, and make the `REVOKE`/`GRANT` pair mandatory and asserted (T-13, T-12) rather than conventional |
| **B14** | **TLS: enforcement disabled, verification mode unresolved.** SSL enforcement is **disabled**, so the endpoints accept non-SSL connections. A CA certificate download exists; **no `verify-full` guidance was shown.** S7 says deployed Edge Functions are "pre-configured to use SSL" but does not state the verification mode — and `require` does not verify the certificate or hostname | **NEW 2026-08-07** (§17.9) | Enforce SSL deliberately, and prove the client's verification mode (T-23). **Nothing enabled in this phase** |
| **B15** | **Supavisor compatibility with a dedicated least-privilege LOGIN role is unverified.** Transaction pooling is the leading transport, but no official source establishes that the shared pooler accepts a non-`postgres` custom role in its tenant-qualified username. If it does not, §7.7's transport cannot carry §7.3's credential and the whole direction fails | **NEW 2026-08-07** (§17.11) | An official documentation answer, or a controlled test. **Blocking for the recommended direction** |

#### 14.1.1 The five key-management concerns, and which blocker owns each

Recorded because these were previously blurred together under the word "salt", and a concern with no
owner is a concern nobody closes.

| Concern | Question it answers | Owner | Status |
| ------- | ------------------- | ----- | ------ |
| **Vault privilege verification** | Who can *read* the key store — can `anon` or `authenticated` reach `vault.decrypted_secrets`? | **B3** | **RESOLVED 2026-08-07 for direct access — no** (§17.4). Neither role, nor `PUBLIC`, holds any privilege on the Vault schema, its relations or its routines. **Still open for indirect disclosure** via an unrelated `SECURITY DEFINER` routine, which was not enumerated. To be held closed by T-20 |
| **HMAC key storage** | *Where* each key lives — Vault for the in-database key, the function environment for the handler-side keys (plan §6.3) | **§8.5 / §11.6** | **RECOMMENDED**, conditional on B3. Vault is the right *kind* of home; the recommendation does not survive B3 resolving badly |
| **Key separation / domain separation** | How the three derived identifiers are kept non-comparable — independent keys, or one master key with explicit domain separation? | **B9** | **UNRESOLVED, and currently defective**: two of the three are specified as equal (§11.4.2). Pattern A recommended (§11.4.4) |
| **Local / CI provisioning** | How a key reaches every environment, given it cannot be in a migration | **B10** | **UNRESOLVED.** No path exists; `supabase db reset` yields a store that fails at first call |
| **Key rotation** | Who rotates, on what trigger, verified how — and how the three differing cadences are reconciled (§11.5) | **B10** | **UNRESOLVED** for all three keys |

Two of these interact in a way that is easy to lose: **B9's choice constrains B10's rotation.** Under
Pattern B a single rotation hits all three purposes at once, which forces the most constrained
purpose — the outbound `safety_identifier`, which plan §6.3 says must not be rotated casually — to
govern the cadence of the least constrained. Choosing the pattern is therefore not separable from
specifying rotation.

### 14.2 What changed in the recommendation

The plan ranked the options: **5.6.A (Vault + user JWT)** recommended, **5.6.C** first fallback,
**5.6.D (dedicated role + direct connection)** second fallback.

**This review inverts the top of that ranking.** §7.7 — a dedicated least-privilege role over a direct
connection — becomes the direction to complete, because it is the only evaluated mechanism that
closes **B1 and B2 structurally** rather than mitigating them, and because it simultaneously
dissolves **B5**. Three problems, one change of transport.

Vault is not displaced; it remains the right home for the rate-limit **HMAC key** (§11.6) and **B3
still stands**. What has changed is that the key's location is no longer the question on which R8
turns. *(2026-08-07: B3's direct half is now closed favourably — §17.4 — which strengthens Vault as the
right home rather than displacing it. The sentence below is unaffected, and §17.11 records that the
promotion of §7.7 now carries **B15** as a condition it did not have when this was written.)* The question R8 turns on is the one the plan did not identify as decisive: **can a client reach
the RPC at all**.

The promotion of §7.7 survives the §7.3.1 correction. It never depended on the database being
network-unreachable — that argument is withdrawn — and it rests entirely on the durable half:
a credential the client does not hold beats a credential the client does hold.

### 14.3 What it would take to reach approval

1. A design decision on §5.7's **D1 or D2** — closing B1 and B2. **This is a decision, not a
   verification**, and it belongs to a reviewer.
2. ~~One live privilege read closing **B3** and confirming **B4**~~ — **done 2026-08-07 (§17)**, with
   B3 closed only for direct access and its indirect half still open (§17.4). This step is the only one
   of the five that the verification advanced.
3. Ownership, TTL, retention and identifier separation specified — **B6–B9**, all closable on paper.
   B9 additionally requires choosing between §11.4.3's Pattern A and Pattern B, and a cryptographic
   review if Pattern B is chosen.
4. A local Postgres for the twenty-five tests that need one, and a provisioning path closing **B10**.
   **§17.6 adds a precondition to this step**: the local Postgres must be the *hosted* major version, or
   the parity it is supposed to provide is fictional.
5. A revised port (§12.9) reviewed as a contract change, and the AI-2 source-scan assertions narrowed
   deliberately (T-21).
6. **Added 2026-08-07:** the five new blockers — **B11** (version parity), **B12** (automatic table
   exposure), **B13** (function privilege and exposure posture unverified), **B14** (TLS enforcement and
   verification mode) and **B15** (Supavisor custom-role compatibility). B15 is the sharpest of the five,
   because it can invalidate the recommended transport outright rather than merely constrain it.

No unsafe design has been selected to make progress. §7.2's service-role option was evaluated on its
merits and refused on proportionality, not adopted for convenience.

---

## 15. Changes made to other documents

Two, both narrow, both identified here as required.

1. **`docs/NOOR_AI3_IMPLEMENTATION_PLAN.md`** — a cross-reference to this review and R8's status, in
   §5.4 and §11.2.1. No analysis in §5 was rewritten; where this review contradicts §5.3 point 2, the
   contradiction is recorded **here** and the plan points to it.
2. **`docs/NOOR_AI_BACKEND_CONTRACT.md`** — one addition to §B.3, naming the **fourth** boundary. §B.3
   enumerates "The three boundaries and what each one is for" while §B.1's diagram already shows the
   Edge Function talking to a rate-limit store. §6 establishes that this boundary authenticates
   identity and proves **nothing** about server origin — an essential trust-boundary clarification,
   and the narrowest edit that records it.

### 15.1 Two further contract issues found, and deliberately not edited

Both are recorded here rather than fixed, because neither is a wording slip that a review may correct
unilaterally — one is a design decision and the other would touch a document-wide vocabulary.

| Issue | Where | Why not edited here |
| ----- | ----- | ------------------- |
| **`user_hash` is specified to equal `safety_identifier`** — contract §H.3: "`user_hash` is the same salted hash as `safety_identifier`" | Contract §H.3, §H.1, §12.6; plan §6.3 | This is **B9**, a design defect (§11.4.2). Changing it changes what NoorLife sends to a third party and what its logs contain — a decision for the reviewer who owns §12.6's linkage question, not a correction |
| **"Salt" is used throughout for what is an HMAC key** | Contract §B.2, §H.1, §H.3, §12.6, §J.15a; plan §5.6, §6.3 | Correcting it means a vocabulary change across two documents and roughly forty occurrences, well outside a schema-and-security review's scope. §0.4 records the mapping so no reader is misled, and flags that the misnomer must not reach migrations, secret names or tests |

Neither issue blocks anything that is not already blocked. Both belong to the phase that revises the
contract, and both are listed so that phase does not have to rediscover them.

---

## 16. What this review did not do

> **Scope note added 2026-08-07.** This section describes the **design review** — the work recorded in
> §§1–15, performed at `5940352` with no hosted contact of any kind. It is preserved exactly, because it
> is the accurate account of that work. It is **no longer a description of the whole document**: §17
> records a later, separate, read-only hosted verification, and **§17.12 is that phase's equivalent
> statement**. Read the two together; neither supersedes the other.

- **It did not implement the quota store.** No migration, no SQL file, no function, no schema, no
  table, no policy, no grant, no role.
- **No key, salt, password, role or other secret was generated, read, displayed or stored.** No
  credential value appears anywhere in this document. The corrections in §0.4 and §11.4 are changes
  of terminology and design analysis only — nothing was provisioned to accompany them.
- **No network probe of any kind was performed.** §7.3.1's reachability analysis is reasoned from
  documentation and stated as an assumption to be tested (T-22), not measured.
- No hosted Supabase project was contacted **during the design review**. No `supabase link`, `db push`,
  `config push`, `functions deploy` or `secrets set`. No local Supabase stack, no Docker. *(The later
  verification of §17 read the hosted project read-only and wrote nothing to it — §17.12.)*
- No OpenAI request. No provider key exists.
- No application, Edge Function, dependency, package or configuration file was changed.
- **AI-3 remains incomplete**, and R8 remains `Blocked` — now with **fifteen** enumerated blockers
  instead of three, which is a more accurate picture rather than a worse one. Ten came from the design
  review; B11–B15 came from the §17 verification.
- **Noor AI remains unavailable to real users.** The production dependency graph still fails closed
  with `503`.
- **NoorLife is not production-ready.**

---

## 17. Hosted read-only verification — completed 2026-08-07

This section records the live read that §0.3 said the review could not perform and that §14.3 point 2
required. It is **evidence, not approval.** It closes B3 narrowly and B4 outright, adds B11–B15, and
leaves the verdict of §14 exactly where it was.

### 17.1 What was done, by whom, and under what constraints

| | |
| --- | --- |
| **Who** | The **repository owner**, manually. No agent, tool or script in this repository connected to the hosted project |
| **Part A** | One SQL block in the hosted SQL Editor, opening `begin; set transaction read only;`, containing a **single `SELECT`** over `pg_catalog` only, and ending `rollback;`. S14's read-only rule (`postgresql.org/docs/15/sql-set-transaction.html`) forbids every `INSERT`, `UPDATE`, `DELETE`, `CREATE`, `ALTER`, `DROP`, `GRANT`, `REVOKE`, `COMMENT` and `TRUNCATE` inside it, and the transaction was discarded regardless |
| **Part B** | Dashboard **label reading only.** No reveal, copy, download, regenerate, reset or rotate control was pressed. No setting was changed |
| **What was reported back** | **Sanitised findings only.** The findings below are the whole of what was transmitted |
| **What was deliberately never requested** | Hostnames, project references, connection strings, usernames, passwords, tokens, JWTs, API keys, IP addresses, CIDRs, certificates, secret names, secret identifiers, secret descriptions and secret values. **None of these appears anywhere in this section, and none was seen by the author of it** |
| **Vault content** | `vault.decrypted_secrets` was **never in a `FROM` clause.** It appears in the procedure only as an argument to `to_regclass()` and to the catalog privilege functions. No secret was decrypted, listed, counted by name, or read |

Two consequences of that design worth stating, because they bound what §17.4 may claim:

1. **The evidence is a point-in-time configuration read, not a test.** §13.2.1 records what that does and
   does not move in the test matrix. A privilege that is correct today is not a privilege that stays
   correct, and nothing automated currently asserts any of it.
2. **The procedure asked about *direct* privilege only.** It did not, and by construction could not,
   establish what an arbitrary existing routine does with the privileges *its owner* holds. §17.4 is
   scoped to exactly what was asked.

### 17.2 SQL catalog evidence

| Finding | Reported | What it settles |
| ------- | -------- | --------------- |
| PostgreSQL server major version | **17** | Contradicts `config.toml`'s declared `major_version = 15` → **B11** (§17.6) |
| `supabase_vault` installed | **true** | Vault is present, under that extension name |
| `pgcrypto` installed | **true** | `extensions.hmac` is available for §7.5 / §11's constructions, if either is ever adopted |
| `pgsodium` installed | **false** | Any design reaching for a pgsodium primitive must not assume it |
| Schema `vault` exists | **true** | |
| `vault.secrets` and `vault.decrypted_secrets` exist | **true** | The objects S5 describes are the objects present |
| Schema `noor_ai` exists | **false** | **The quota store does not exist.** Nothing was pre-created, and there is nothing to un-create |
| `anon`, `authenticated`, `PUBLIC` — `USAGE` on schema `vault` | **none** | ↓ |
| `anon`, `authenticated`, `PUBLIC` — `SELECT` on `vault.secrets` | **none** | ↓ |
| `anon`, `authenticated`, `PUBLIC` — `SELECT` on `vault.decrypted_secrets` | **none** | ↓ |
| `anon`, `authenticated`, `PUBLIC` — readable Vault relations | **zero** | ↓ |
| `anon`, `authenticated`, `PUBLIC` — writable Vault relations | **zero** | ↓ |
| `anon`, `authenticated`, `PUBLIC` — executable Vault routines | **zero** | Together, the five rows above close **B3** for direct access (§17.4) |
| `service_role` and `postgres` can access Vault content directly | **true** | Expected, and the mechanism §7.3 / §9.1 relies on: a definer function owned by such a role can read a Vault-held key that its caller cannot |
| `postgres` attributes | `LOGIN`, `CREATEDB`, `CREATEROLE`, `REPLICATION`, `BYPASSRLS`; **not** `SUPERUSER` | Consistent with S6 and with `roles-superuser`. **`CREATEROLE` is present**, so §7.3's dedicated role is creatable in principle (§17.11) |
| `service_role` attributes | `BYPASSRLS`, **no `LOGIN`** | **A sharpening of §7.2 that the review did not have.** `service_role` cannot open a PostgreSQL session at all — it is a PostgREST-only role. So the rejected service-role option was never even available over a direct connection, and a direct-connection design *necessarily* requires a new `LOGIN` role rather than reuse of an existing one. §7.3 becomes the only candidate rather than the preferred one |
| `pg_default_acl` | **24 rows**, contents not read | A count is not a posture → **B13** (§17.8) |
| PostgREST exposed-schema setting in role configuration | **not returned** | The setting is not carried in role configuration on this project, so the dashboard is the authority for B4 (§17.5). Expected, and recorded so nobody reads the empty result as an empty schema list |

### 17.3 Dashboard evidence

| Finding | Reported |
| ------- | -------- |
| Exposed Data API schemas | exactly **`public`** and **`graphql_public`** |
| Is `vault` exposed? | **No** |
| Automatically expose new tables | **enabled** → **B12** (§17.7) |
| Current tables exposed | **0 of 1** — *see the reading caution below* |
| Current functions exposed | **2 of 3** — *a count only; the two functions were not identified* → **B13** (§17.8) |
| Extra search path | `public`, `extensions` |
| Connection methods offered | direct, transaction pooler, session pooler — **all three** |
| Direct connection addressing | **IPv6 by default**; IPv4 requires an add-on that is **not enabled** |
| Transaction pooler | offered, and described as appropriate for stateless/serverless functions |
| SSL enforcement | **disabled** → **B14** (§17.9) |
| CA certificate download | **available** |
| `verify-full` guidance | **not shown** → **B14** |
| Network restrictions | **disabled** — database and pooler access is not IP-restricted (§17.10) |
| Connection and disconnection logging | **disabled** |
| Compute size | **Nano** |
| Pool size | **15** per user/database |
| Maximum client connections | **200** |
| Database-password reset control | exists; **not pressed** |
| Extensions UI | `pgcrypto` **enabled**; `pgsodium` **disabled**; **no separate `vault` entry shown** |

**Three readings that must not be made from this table.**

1. **"0 of 1 current tables is exposed" must not be read as a privilege fact.** The one table is
   `public.profiles`, and `20260729140000_fix_profile_trigger_rls.sql:94` grants
   `select, insert, update` on it to `authenticated` — which the app depends on. So either the label
   counts something narrower than "reachable by an API role", or it disagrees with the migration. **The
   dashboard label's precise meaning was not established from official documentation, so it is recorded
   as reported and relied on for nothing.** Resolving it belongs to T-13, which asserts actual
   privileges rather than reading a summary.
2. **"No separate `vault` extension entry" must not be read as "Vault is absent."** The SQL catalog is
   the authority and it reports `supabase_vault` installed with both objects present (§17.2). The
   Extensions UI simply does not surface it as its own toggle on this project.
3. **"2 of 3 current functions are exposed" must not be mapped onto any particular functions.** The
   dashboard supplied a **count only**. It did not name the two, the definition of its "exposed" label
   was not established from official documentation, and no per-function privilege or reachability read
   was performed. It is recorded as reported and, like the table count, **relied on for nothing.** In
   particular it must not be read as confirming which functions lack an explicit `REVOKE` — §17.8 keeps
   that repository fact and this dashboard fact **separate and unjoined**.

### 17.4 B3 — CLOSED for direct access, and only for that

> **`anon`, `authenticated` and `PUBLIC` cannot reach Vault content directly.** No `USAGE` on the
> schema, no `SELECT` on `vault.secrets`, no `SELECT` on `vault.decrypted_secrets`, zero readable
> relations, zero writable relations, zero executable routines.

This is the favourable answer, and it is the answer to the question **B3 actually asked** — §8.2's
"actual default grants" row and §14.1.1's "who can *read* the key store". Two things follow:

- **§8.3's specific alarm did not materialise.** The scenario it named — "if `authenticated` held
  `SELECT` on `vault.decrypted_secrets`, then any signed-in user calling any exposed function that
  happens to select from it … could reach the HMAC key" — required a privilege that is absent.
- **Vault is confirmed as the right *kind* of home for the rate-limit HMAC key** (§11.6), and the
  recommendation in §8.5 that was conditional on B3 no longer fails on this ground.

**What this does not prove, stated as plainly as the closure.**

| Not proven | Why |
| ---------- | --- |
| That **no** path exists by which `anon` or `authenticated` obtains decrypted Vault content | Only *direct* privilege was tested. `SECURITY DEFINER` runs with its **owner's** privileges (S3, S10), and §17.2 confirms `postgres` and `service_role` *can* read Vault. **A routine owned by such a role, that selects from `vault.decrypted_secrets` and returns or leaks the value, discloses it to every caller holding `EXECUTE` on that routine** — and B3's closure says nothing about whether such a routine exists |
| That existing definer routines are safe in this respect | **They were not enumerated.** No routine body, definition, owner or privilege set outside the Vault schema was examined. §17.8's finding — that the project's function-grant convention was applied to one of three existing functions — is precisely the reason this is a live concern rather than a formality |
| That the privileges will stay this way | A configuration read is not an assertion. T-20 must automate it (§13.2.1) |
| That Vault's grants survive an extension upgrade | Out of scope of any point-in-time read |

**Therefore B3's status is: direct half CLOSED by evidence; indirect half OPEN, and newly specified.**
The indirect half is not a re-opening of B3 under another name — it is a distinct question that the
original B3 wording ("who can read the key store") did not cover, and it now has somewhere to live.

### 17.5 B4 — CLOSED

The hosted Data API exposes exactly **`public`** and **`graphql_public`**. `supabase/config.toml:13`
declares exactly `["public", "graphql_public"]`. **The declared list and the hosted list agree: there is
no drift.**

Three consequences:

1. **§1.2's remaining drift check is discharged.** §1's `RESOLVED` becomes confirmed on the project as
   well as in version control.
2. **`vault` is confirmed unexposed on the hosted project**, not merely absent from the declaration. So
   S8's rule — an unlisted schema is unreachable over PostgREST regardless of grants — applies to Vault
   as a hosted fact. Combined with §17.4, Vault is now unreachable to API roles by **two** independent
   controls.
3. **The extra search path matches too** — `public`, `extensions`, as declared at `config.toml:14`. This
   is a separate setting from exposure (§1.1's closing paragraph) and its agreement is recorded for the
   same drift reason.

`config.toml`'s comment at line 11 — that `graphql_public` is declared because "the hosted default
exposes it. Omitting it here would silently remove it there" — is now **verified as correct** rather
than merely prudent.

### 17.6 B11 — the PostgreSQL major-version mismatch

| | |
| --- | --- |
| Declared, `supabase/config.toml:20` | `major_version = 15` |
| Hosted, reported by the server | **17** |

**Why this blocks rather than annoys.** `major_version` governs the local stack, the shadow database
used to diff migrations, and therefore every one of §13.2's twenty-five database-dependent tests. A test
suite that passes on 15 makes no statement about 17. §14.3 point 4 asks for "a local Postgres for the
twenty-five tests that need one" — that Postgres has to be the *hosted* major version, or the parity it
exists to provide is fictional and the tests are theatre.

**What is *not* affected, checked rather than assumed.** Every platform statement this review relies on
(S10–S12: `SECURITY DEFINER` semantics, the `PUBLIC` default-execute grant, `FORCE ROW LEVEL SECURITY`,
the default-deny rule, advisory-lock semantics) is identical in 15 and 17. **No finding in §§1–16 rests
on a version difference**, and §0.1 carries that correction. What changes is the *authority* for future
claims, which must be the version 17 pages.

**Not resolved here, deliberately.** `config.toml` was **not changed in this phase.** Raising the
declared version is a decision with consequences for every existing migration and for the local stack,
and it belongs to whoever owns that decision. Two readings are available and this document does not pick
between them: align the declaration upward to match production, or record the divergence with its
consequences accepted. **What is not available is leaving it undecided and calling the tests parity.**

### 17.7 B12 — the Data API automatically exposes new tables

**"Automatically expose new tables" is enabled.** So the default posture for a newly created table is
*published*, not private.

**Why this is a pre-migration gate and not a footnote.** `PRE_RELEASE_BACKLOG.md` §4.1's rule — "No
production tables exist for any module, deliberately" — means the very next table this project creates
will be the first one to meet this setting. §10.1's three tables are specified for the **unexposed**
`noor_ai` schema, which is the correct shape and is *not* what makes them safe here: the setting is
project-wide, and the protection comes from the schema being absent from the exposed list (§17.5), not
from the setting being off. That is a defence that works, resting on a mechanism one dashboard toggle
away from a very different default.

The interaction with §3.1's third row is the real hazard. S1's documented exposure procedure re-grants
`ALL ON ALL TABLES` and `ALL ON ALL ROUTINES` to `anon, authenticated, service_role` and then applies
three `ALTER DEFAULT PRIVILEGES` statements that make those grants **automatic for future objects**. A
project with automatic exposure enabled *and* those default privileges in place has an
open-by-default posture in any schema they cover — which is exactly what §17.8 cannot rule out.

**Requirement, for the implementation phase:** assert the **final** privilege state of every created
table and function, per object, in a test (T-13). Do not infer it from the migration statements, and do
not rely on the setting being off. **The setting was not toggled in this phase.**

### 17.8 B13 — function privilege and Data API exposure posture unverified

**Two independent observations, from two different evidence sources.** They are recorded separately and
**not joined**: neither is offered as the explanation of the other.

**Observation 1 — repository evidence.** The hardening convention is applied to **one of the three**
existing `public` functions. From the migrations:

| Function | Migration | Explicit `REVOKE` in version control? |
| -------- | --------- | ------------------------------------- |
| `public.handle_new_user()` | `20260729120000:73`, re-asserted `20260729140000:57` | **Yes** — `revoke all on function … from public, anon, authenticated` |
| `public.set_updated_at()` | `20260729120000:31` | **No.** No explicit revoke. `security invoker`, `set search_path = ''` |
| `public.enforce_client_plan_code()` | `20260801120000:64` | **No.** No explicit revoke. **`security definer`**, `set search_path = public` |

S10 states that "by default, execute privilege is granted to `PUBLIC` for newly created functions" —
**unless** it is revoked, or unless default privileges change it. So what is established here is a
version-control fact about the *statements*: two of the three functions carry no explicit
`REVOKE … FROM PUBLIC, anon, authenticated`. **Their effective privileges on the hosted project were
not read.** No per-function privilege query was run, and `pg_default_acl`'s **24 rows** (§17.2) were not
enumerated, so a default-privilege rule may have altered the creation-time posture in either direction.

**Observation 2 — dashboard evidence.** The dashboard displayed **"2 of 3 functions exposed."** That
count is the entirety of this evidence. It did **not** identify which functions it counted, and the
meaning of its "exposed" label was **not** established from official documentation. §17.3's first
reading caution applies to this count exactly as it applies to the table count.

**What the available evidence does not prove.** Stated explicitly, because an earlier draft of this
section asserted a correspondence between the two observations that the evidence does not support:

| Not proven | Why |
| ---------- | --- |
| **Which two functions the dashboard counted** | Only a count was supplied. No per-function listing was captured, so the identity of the two is unknown |
| **Whether the dashboard count is based solely on PostgreSQL `EXECUTE` privileges** | The label's definition was not established from official documentation. It may reflect privileges, PostgREST reachability, some metadata rule, or a combination |
| **Whether trigger-returning functions are counted, or are callable through the Data API** | Not established. Two of the three functions `returns trigger`, and how the dashboard and PostgREST each treat such a function was not verified |
| **Whether a dashboard per-function toggle, or another metadata rule, affects the count** | Not established. If such a mechanism exists on this project, the count may reflect it rather than — or in addition to — catalog privileges |
| **That the two functions lacking an explicit `REVOKE` are the two the dashboard counted, or that the missing `REVOKE` is the mechanism producing the count** | This would require every row above to be resolved first. It is an inference, not a finding, and it is **withdrawn** |

The arithmetic coincidence — one of three hardened in the repository, two of three counted by the
dashboard — is therefore **relied on for nothing**. The two observations stand separately, and **each is
independently sufficient reason** for the exact privilege and exposure audit required below.

**What is established, and is not weakened by any of the above.**

- The repository's own hardening convention is applied **by hand, per function**, and two of the three
  existing functions do not carry it — one of them `SECURITY DEFINER`. That is a version-control fact
  and needs no dashboard evidence to support it.
- It demonstrates §9.4 hazard 2 concretely rather than abstractly: a new signature is a new object with
  whatever the creation-time default is, and the revoke does not follow it.
- `pg_default_acl` holds **24 rows whose contents were not read** (§17.2). S13 is explicit that a null
  ACL means the hard-wired default and that `pg_default_acl` "is only consulted during object creation".
  So 24 rows means **some non-default creation-time posture is configured somewhere**, and the count
  alone establishes nothing about its direction: those rows could tighten defaults or, as in S1's
  step 6, grant `ALL ON ROUTINES` to `anon, authenticated, service_role` automatically for every future
  function in a schema. **The count does not prove safe function defaults, and it does not prove unsafe
  ones either.** It proves the question is open.
- §5's whole surface is a **non-trigger** function, so whatever is or is not reachable today, the next
  function created is the one that matters.

**Requirements, both mandatory for any future quota migration:**

1. **Explicitly `REVOKE EXECUTE … FROM PUBLIC, anon, authenticated`** on every function created, in the
   **same transaction** as the `CREATE` (S10's pattern, §4 component 6), and **`GRANT EXECUTE` only on
   reviewed signatures to reviewed roles.** Never rely on a default, in either direction.
2. **Enumerate the 24 default-ACL rows** and assert the result, per schema and per object type, so the
   creation-time posture is a reviewed fact. This extends T-13 and pairs with T-12's
   every-overload assertion.

**Required future verification, before B13 can close.** An exact, per-object audit — not a summary
count — that:

1. **Enumerates every function in `public` on the hosted project by exact signature**, including every
   overload.
2. **Records effective `EXECUTE` for `PUBLIC`, `anon`, `authenticated` and `service_role`** on each of
   those exact signatures.
3. **Records the dashboard / Data API exposure state for that same exact function**, so the two are
   compared per object rather than by count.
4. **Verifies whether the function can actually be invoked through PostgREST**, which is the question
   the exposure label is being read as answering.

**Constraints on that verification, binding while this remains a documentation phase:**

- **No function that changes data may be invoked** — under any transport, for any purpose.
- **Trigger functions must not be experimentally invoked against hosted data.** Determining how they are
  treated is a documentation and privilege-reading exercise, not a live call.

### 17.9 B14 — TLS enforcement is disabled, and certificate validation is unresolved

| Finding | Consequence |
| ------- | ----------- |
| SSL enforcement **disabled** | The database and pooler endpoints **accept connections that do not use SSL**. Nothing at the server refuses a plaintext session |
| CA certificate download **available** | The material for `verify-full` exists |
| **No `verify-full` guidance shown** | The dashboard does not state, and this verification did not establish, what verification mode any client will actually use |

**Why the review's earlier partial comfort does not survive intact.** `connect-to-postgres` states that
"Deployed edge functions are pre-configured to use SSL for connections to the Supabase database" — which
is genuinely reassuring about *encryption*. It does not name the **mode**, and `ssl-enforcement`
distinguishes them sharply: `require` "does not verify the server certificate or hostname", while
`verify-full` "verifies the CA certificate, and confirms the hostname matches the certificate". **A
credential sent over an encrypted-but-unauthenticated channel is a credential offered to whoever is in
the middle**, which is T-23's whole point and §7.3's residual risk in concrete form.

Combined with enforcement being **off**, the honest statement is: encryption on the deployed path is
documented, enforcement is not configured, and **verification is unknown**. That is three different
properties and only one of them is settled.

**Nothing was enabled and nothing was downloaded in this phase.** Enforcing SSL is a project-wide change
affecting every existing client, and it is a decision, not a cleanup.

### 17.10 Network restrictions are disabled — and this is not an authentication finding

**Network restrictions are disabled; database and pooler access is not IP-restricted.**

§7.3.1 said this review "has not read the project, so it must assume reachable." **That assumption is
now supported by configuration** — there is no IP allow-list standing in front of either endpoint.
§7.3.1's discipline applies unchanged and matters more now that the fact is established rather than
assumed:

- **Reachability is not authentication.** An endpoint that answers a TCP connection has authenticated
  nobody. This finding does **not** make the design weaker than §7.3.1 already assumed, and it must
  not be presented as a vulnerability in itself.
- **What protects the endpoint is the credential and the narrowness of the role**, exactly as §7.3.1
  point 3 states. Nothing here changes that.
- **§7.3.1 point 5 is now answered, and unfavourably for the design.** It hoped IP allow-listing might
  serve as defence in depth. `network-restrictions` states that "Network restrictions apply to all
  connection routes, whether pooled or direct" and — decisively — **"With network restrictions applied,
  Edge functions lose direct access to the database."** So the two are **mutually exclusive** for this
  design, not complementary. Adopting the direct/pooler transport forecloses a project-wide security
  control, and that trade must be made deliberately by a reviewer rather than discovered later.

**One further fact belongs here: connection and disconnection logging are disabled.** Combined with an
un-restricted endpoint, a connection made with a leaked credential from an arbitrary host would leave
**no connection record**. §7.3.1 point 4 already stated that a leaked credential is fully sufficient to
imitate the Edge Function until rotated; this adds that it would also be **unobserved**. That is an
argument for the rotation procedure B10 owns, and for enabling logging before any credential exists —
not an argument that reachability is the control.

### 17.11 The transport conclusion, and B15

**Transaction pooling remains the leading transport, and the evidence strengthens the case on three
points and weakens the ranking on none.**

| Evidence | Effect |
| -------- | ------ |
| Transaction pooler is offered and described as appropriate for stateless/serverless functions | Confirms §7.7's transport is available and platform-endorsed for this workload |
| Direct connection is **IPv6 by default**, and the IPv4 add-on is **not enabled** | **This is what settles the choice.** A direct connection depends on IPv6 reachability from the Edge runtime, which is unverified and not under this project's control. The transaction pooler is IPv4-only on every tier, so it sidesteps the question entirely rather than betting on it |
| Compute **Nano**; pool size **15**; max client connections **200** | Nano permits 60 database connections; a pool of 15 is 25% of that, comfortably under `connection-management`'s caution about exceeding 40% while PostgREST is in use. Against a concurrency ceiling of 4 (§4.8) there is headroom. **Recorded as headroom, not as a measurement** — no load was generated |
| `service_role` has **no `LOGIN`** (§17.2) | A direct-connection design cannot reuse any existing API role. §7.3's dedicated role is now the **only** candidate, not the preferred one |
| `postgres` has **`CREATEROLE`** (§17.2) | `CREATE ROLE … WITH LOGIN PASSWORD` is available in principle, per Supabase's own roles documentation |
| `postgres` is **not `SUPERUSER`** | Consistent with `roles-superuser`. Does not obstruct role creation |

**And the blocker that all of this now rests on.**

> **B15. No official source establishes that the shared pooler accepts a non-`postgres` custom role.**
> Pooled connections identify the tenant through the username, and nothing in the Supabase or PostgREST
> documentation consulted for this review states that an arbitrary custom `LOGIN` role is accepted in
> that position.

This is the sharpest of the five new blockers, because it is the only one that can **invalidate the
recommended direction** rather than constrain it. §7.7's transport must carry §7.3's credential; if the
pooler will not accept that credential, the two halves of the leading candidate do not compose, and the
remaining options are a direct IPv6 connection (whose reachability from the Edge runtime is unverified,
and whose IPv4 alternative requires an add-on that is not enabled) or §7.6's nonce design, which §7.6
already labels the design of last resort.

**Session-level advisory locks remain unsuitable, and the reasoning is unchanged and now has a third
leg.** S12: a session-level lock "is held until explicitly released or the session ends" and such
requests "do not honor transaction semantics: a lock acquired during a transaction that is later rolled
back will still be held following the rollback." Under transaction pooling the connection returns to the
pool at commit, so the lock either leaks onto a shared connection or disappears unpredictably; and
§12.2's all-or-nothing savepoint rollback depends on rollback undoing everything the block did, which is
the one thing a session-level advisory lock is documented not to honour. **The third leg, which applies
regardless of transport:** the lease must be held across the provider HTTP call, which happens *between*
`reserve` and `finalize` and therefore outside any transaction — so no lock of any duration, session or
transaction, can represent it. §12.5's row-with-an-expiry stands as a consequence of the lifecycle, not
merely of the pooling mode.

**A dedicated least-privilege LOGIN role is technically feasible in principle** — `CREATEROLE` is
present, the role attributes required (`LOGIN` yes; `SUPERUSER`, `CREATEDB`, `CREATEROLE`,
`REPLICATION`, `BYPASSRLS` all no) are ordinary, and its privilege set is `USAGE` on one schema plus
`EXECUTE` on reviewed signatures with no table privileges at all. It remains **unapproved**, for the
reasons that have not moved: B15 above; the credential cannot be created by a version-controlled
migration, so it inherits B10's provisioning and rotation gap and doubles it; B14's unresolved
verification mode is the channel that credential would travel over; and §17.10's disabled connection
logging means its misuse would be unobserved.

### 17.12 What this verification did not do

- **No hosted object was created, altered or dropped.** No `CREATE`, `ALTER`, `DROP`, `GRANT`, `REVOKE`,
  `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`, `SECURITY LABEL`, `COMMENT`, extension change or
  configuration change. The transaction was read-only and was rolled back.
- **No dashboard setting was changed**, and no reveal, copy, download, regenerate, reset or rotate
  control was pressed. SSL enforcement was not enabled; automatic table exposure was not toggled;
  network restrictions were not enabled; the database password was not reset.
- **No secret or sensitive project identifier was requested, transmitted or recorded.** No hostname,
  project reference, connection string, username, password, token, JWT, API key, IP address, CIDR,
  certificate or secret value. No Vault secret name, identifier, description or value. `.env` was not
  read.
- **`vault.decrypted_secrets` was never selected from.** No secret was decrypted.
- **No application table was read.** `auth.users`, `auth.sessions` and every application relation were
  outside the procedure. No user was enumerated.
- **No network probe was performed.** §17.10's reachability statement is a *configuration* finding.
  T-22's measured half remains unrun.
- **No function was enumerated, privilege-read or invoked.** No per-signature listing of `public`
  functions was captured, no `EXECUTE` privilege was read for any function outside the Vault schema, and
  **no function was called** — not through PostgREST, not through SQL, and not as a trigger. §17.8's
  audit is therefore entirely future work.
- **No local stack, no Docker, no deployment, no CLI command against the project, no provider request.**
- **No code, SQL, migration, configuration or credential was created** in the repository by this phase.
  `supabase/config.toml` was **not** changed, including its `major_version` line.

### 17.13 What did not change

Stated explicitly, because a favourable privilege read is the moment at which a blocked design is most
likely to be quietly treated as approved.

| | |
| --- | --- |
| **Verdict** | **BLOCKED.** §14 stands |
| **B1 — global denial via direct RPC** | **Untouched and still CRITICAL.** It is a design defect. No configuration read can close it, and this one did not attempt to |
| **B2 — spend poisoning via direct finalize** | **Untouched and still CRITICAL.** Same reason |
| **Service-role designs** | **Still rejected** (§7.2), now with an additional independent reason: §17.2 shows `service_role` has no `LOGIN`, so it could not serve a direct-connection design even if the prohibition were revisited. **No service-role design was invented, adopted or prepared** |
| **The quota store** | **Not implemented.** Schema `noor_ai` does not exist on the hosted project (§17.2); no migration, SQL file, function, table, policy, grant or role was written anywhere |
| **The recommended direction** — dedicated least-privilege role over the transaction pooler | **UNAPPROVED.** §17.11's B15 is a new condition on it, not a clearance of it |
| **D1** | **Unapproved.** The transport verification advanced; the decision did not |
| **R8** | **Blocked** |
| **AI-3** | **Incomplete** |
| **Noor AI** | **Unavailable to real users.** The production dependency graph still fails closed with `503` |
| **NoorLife** | **Not production-ready** |
