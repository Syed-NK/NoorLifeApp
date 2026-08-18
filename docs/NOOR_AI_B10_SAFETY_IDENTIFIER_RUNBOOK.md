# B10 — the Noor AI safety-identifier HMAC key: construction, lifecycle and runbook

**Written:** 2026-08-09
**Branch:** `feature/subscriptions-family-six`
**Implements:** `NOOR_AI_BACKEND_CONTRACT.md` §12.6 (decided), §H.1, §H.2, §B.2
**Status:** **Implemented and locally verified. Not provisioned, not deployed, not exercised.**

> **No key has been generated.** No secret has been provisioned into any environment, no secret has
> been read, nothing has been deployed, and no request has ever been sent to OpenAI. This document
> records **names and procedures only**. It contains no key value, no derived identifier, and no
> command whose output or arguments would expose one.

---

## 1. What this closes, and what it does not

B10 as recorded in `NOOR_AI3_QUOTA_STORE_SECURITY_REVIEW.md` §11.5 covers key lifecycle for more than
one key. This document closes exactly one part of it: **the provider safety-identifier key** — its
construction, its validation, its storage, its access path, its rotation and its emergency response.

| B10 element                                                   | State after this phase                            |
| ------------------------------------------------------------- | -------------------------------------------------- |
| Safety-identifier construction chosen and implemented         | **Done** — §2, §3                                  |
| Safety-identifier key generation procedure written            | **Done** — §5. The key itself is **not generated** |
| Safety-identifier key provisioned                             | **Not done, and not authorised in this phase**     |
| Safety-identifier rotation procedure written                  | **Done** — §7                                      |
| Safety-identifier emergency response written                  | **Done** — §8                                      |
| Quota-store key provisioning and rotation                     | **Open** — unchanged by this phase                 |
| Local / CI provisioning path for any key                      | **Open** — unchanged by this phase                 |
| Hosted verification of any of the above                       | **Not run**                                        |

---

## 2. Official authority

`https://developers.openai.com/api/docs/guides/safety-best-practices`, retrieved **2026-08-09**.

Three statements, quoted rather than paraphrased:

- "Safety identifiers are recommended for products where individual users interact with a model, but
  they are not required."
- "A safety identifier should be a string that uniquely identifies each user."
- "Hash the username or email address in order to avoid sending us any identifying information."

That is the whole of the official authority. **OpenAI does not require HMAC, does not require a uuid
input, does not specify a prefix, and has no view on NoorLife's rotation design.** The parameter is
recommended, not required; NoorLife chooses to send one. Everything in §3 onward is a NoorLife
security decision and must never be restated as a provider requirement.

### 2.1 Why NoorLife goes further than the suggested unkeyed hash

The source's wording and NoorLife's privacy classification are separated below on purpose. Collapsing
them is how a hash ends up described as anonymisation, and §2.1 exists to stop that happening in a
later summary.

**What the guidance says.** Hash the username or email address "in order to avoid sending us any
identifying information". As a recommendation, that means: do not send the raw identifier.

**What a plain digest actually achieves.** It removes the directly readable username, email address or
uuid from the outbound value. It does **not** anonymise the person. The digest is a **stable
pseudonymous identifier** — the same user yields the same value on every request, which is precisely
why the parameter is useful to a provider — and it can be matched back to a person by anyone holding
the candidate set: hash every candidate, compare.

**The reverse must not be inferred.** This is *not* "uuids are weaker inputs than usernames or email
addresses". Usernames and email addresses are frequently predictable and enumerable in their own right,
and an unkeyed digest of one is matched by exactly the same candidate-list attack. The accurate
statement is that **no unkeyed digest of any identifier resists matching once the candidate set is
available**. The difference is not input entropy; it is **who holds the list** — and NoorLife holds its
own user table, so its candidate set is available to anyone who reaches its database.

**What NoorLife does about it.** Key the digest with a secret held outside the database. That prevents
candidate-list matching **by parties that do not possess the HMAC key**: without it, holding the entire
user table yields nothing to compare against. This is a deliberate, recorded NoorLife decision — a
stricter control than the guidance asks for, and not something the documentation required.

**What it does not achieve**, stated here so it is never assumed elsewhere:

- The output remains **pseudonymous, not anonymous**, and is account-linked personal data for privacy
  and store-disclosure purposes (§2 of the classification in `NOOR_AI_BACKEND_CONTRACT.md` §12.6.3).
- It is **not** a control against NoorLife. NoorLife holds both the key and the uuid by design and can
  recompute the value at will.
- It does **not** defeat matching by an attacker who obtains **both** the key and the user table. It
  raises the requirement from either one to both, which is a real gain and a bounded one.

---

## 3. The approved construction

| Element             | Value                                                                                    |
| ------------------- | ----------------------------------------------------------------------------------------- |
| Algorithm           | HMAC-SHA-256                                                                             |
| Key                 | One dedicated random 256-bit (32-byte) secret                                            |
| Input identity      | Only the canonical verified JWT `sub` uuid                                               |
| Message             | `noorlife:openai-safety-identifier:v1` ‖ `0x00` ‖ `<canonical lowercase hyphenated uuid>` |
| Output encoding     | Unpadded base64url                                                                       |
| Public value        | `nl_osi_v1_<digest>`                                                                     |
| Digest length       | Exactly 43 base64url characters                                                          |
| Complete identifier | Exactly 53 characters. The provider boundary accepts **only the active version** — see §3.4 |

`nl_osi` is "NoorLife opaque safety identifier". **The prefix and the version are public metadata, not
secrets** — they exist so an operator reading a provider dashboard can tell which construction produced
a value, which is what makes a rotation legible.

### 3.1 Domain separation

The NUL-delimited namespace is why this key cannot be made to collide with any other use of a digest.
Without it, the same key used for a second purpose could be driven to produce a matching value by
choosing the other purpose's input. NUL is the one byte a canonical uuid cannot contain, so the
namespace and the subject can never be confused for one another however either is chosen.

The version appears **inside** the signed message as well as in the prefix, so version 1 and version 2
differ even in the pathological case where one key was wrongly configured for both.

### 3.2 Key separation — an absolute

The HMAC key is completely independent of, and is never derived from or shared with:

- the OpenAI API key;
- the Supabase service-role key;
- the JWT signing keys;
- the quota-store credentials;
- password and account-recovery material;
- any Vault or encryption key;
- any other NoorLife hash or HMAC purpose.

**No key is reused across domains.** A key that serves two purposes has the union of both threat
models and the rotation cadence of neither.

### 3.3 Verified subject binding

Derivation runs on `VerifiedClaims.userId` — the `sub` of a token whose **signature** was verified —
and on nothing else. Before signing:

- the value must be a well-formed uuid, checked with `claims.ts`'s own `isUuid`, so this module cannot
  drift into accepting a shape the verifier rejects;
- it is canonicalised to lowercase standard hyphenated form. The verifier matches the uuid
  case-insensitively, so an uppercase `sub` is a value the existing verified-claims type can
  legitimately produce, and two spellings of one person must not become two subjects;
- braces, surrounding or internal whitespace, a `urn:uuid:` prefix, the 32-character unhyphenated
  form, an email address, a phone number, a session id and any other arbitrary string are refused.

`auth.users` is never queried, and an email address is never an input.

### 3.4 Only the active version may leave NoorLife

The derivation module accepts an **explicit** version so that a rotation can be built and tested before
it is switched on (§7.1 steps 1–5). That means identifiers under an inactive version are constructible
and syntactically perfect: `nl_osi_v2_…` and `nl_osi_v999_…` both satisfy the shape.

A shape check is therefore the wrong gate for the outbound boundary. Sending an inactive-version value
would emit an identifier derived under a key that the active-version constant has not put into
service — changing every affected user's provider-side identity outside the reviewed deployment that
is supposed to decide it, and doing so silently.

So `safety-identifier.ts` exports two distinct checks and the boundary uses the second:

| Check                            | Answers                                              | Used by                          |
| -------------------------------- | ----------------------------------------------------- | --------------------------------- |
| `SAFETY_IDENTIFIER_PATTERN`      | "could this module ever have produced this shape?"   | Tests, and documentation of the format |
| `isActiveSafetyIdentifier(…)`    | "is this the currently active version?"              | **The OpenAI adapter**            |

The adapter **imports** the second and restates no version literal of its own — a second independently
written `v1` would be a second thing a rotation has to remember to change, and the one it forgets is
the one that keeps sending the old version. A source scan asserts the adapter contains no `nl_osi`
prefix and no quoted version literal, and behavioural tests assert that a valid `v2`, `v3`, `v9`, `v10`
or `v999` identifier makes **zero** fetch calls while v1 is active. A malformed active-version constant
matches nothing, failing closed in the same direction as every other configuration fault here.

---

## 4. The environment secret

**Reserved name, active version:**

```
NOOR_AI_SAFETY_HMAC_KEY_V1
```

**Name only. No value has been created and none exists in any environment.**

### 4.1 Accepted stored representation

- unpadded base64url;
- decodes to **exactly** 32 bytes;
- re-encodes to the identical string.

### 4.2 Rejected, each on its own

| Rejected                                        | Why it is refused rather than repaired                                       |
| ----------------------------------------------- | ----------------------------------------------------------------------------- |
| Missing or empty                                | There is no key. Fail closed.                                                 |
| Leading or trailing whitespace                  | Trimming would silently accept a value pasted with a newline and make the stored form ambiguous |
| Padded base64 (`=`)                             | Not the accepted encoding                                                     |
| Standard Base64 `+` or `/`                      | Not the accepted alphabet                                                     |
| Any other invalid character                     | Not the accepted alphabet                                                     |
| Malformed encoding                              | Undecodable                                                                   |
| Decoding to anything other than 32 bytes        | 31 and 33 bytes are the near-misses a truncated copy produces                  |
| All-zero 32 bytes                               | What a cleared buffer or a placeholder produces, and the first key an attacker guesses |
| A non-canonical spelling of valid 32 bytes      | A secret must have exactly one form, or a later "is this the configured key" check can disagree with itself |
| A passphrase, a uuid, a hex string, any other length | Not a reviewed key. Strength would be unknown                            |

Configuration failure is never distinguished for the caller: every case yields the same
`503 service_unavailable`, because describing the server's key configuration to whoever asked is the
same mistake as telling a prober how far their token got.

---

## 5. Generation — for the future provisioning phase

**Not performed in this phase. Nothing below has been run.**

1. Generate **32 cryptographically secure random bytes**. Not a passphrase, not a uuid, not a hex
   string, not a derived value, not anything typed by a person.
2. Generate inside **one dedicated trusted process**, on a machine authorised to hold production
   secrets.
3. Encode as **unpadded base64url**.
4. The value must never be copied into: this or any chat, source code, the clipboard, an issue
   tracker, a commit, a command-line argument, a shell history, a log, or any ordinary file.
5. Provision **only** through a separately approved secret channel (§6).
6. Verify **only booleans and lengths** — "a value is set", "it decodes to 32 bytes", "the deriver
   answers `derived` rather than `unavailable`". Never print, echo, diff or compare the value itself.

A command-line argument is specifically called out because it is the most common accidental leak:
arguments are visible in process listings and are recorded in shell history by default.

---

## 6. Storage and access

### 6.1 Storage

| Location                       | Permitted?                                                                 |
| ------------------------------ | --------------------------------------------------------------------------- |
| Supabase Edge Function secret  | **Yes.** This is the only approved location                                 |
| A database table               | **No**                                                                      |
| Supabase Vault                 | **No**, unless a later architecture explicitly changes the access path and is reviewed |
| `.env` in this repository      | **No**                                                                      |
| Mobile secure storage          | **No**                                                                      |
| GitHub Actions secrets         | **No**, unless CI deployment is separately reviewed                         |
| Exposed through any RPC        | **No.** Never                                                               |

### 6.2 Access

- **The Edge Function process only.**
- Imported into Web Crypto **non-extractably**, with `sign` as its only usage, so the runtime refuses
  to export it and refuses to verify, encrypt or derive with it.
- No application access. No mobile access.
- No reuse of the service-role credential to reach it, and no reuse of it for anything else.
- Never logged, never included in diagnostics, never returned in a response.
- **The secret name may appear in server-only source and in tests. The value never may.**

### 6.3 What enforces the above

| Control                                                            | Where                                                                 |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| Exactly one production module names the secret                     | `tests/source-scan_test.ts`, exact equality on `safety-identifier.ts`  |
| That module reads exactly one environment variable, once           | `tests/source-scan_test.ts`                                            |
| The v2 name is read by nothing                                     | `tests/source-scan_test.ts`                                            |
| The adapter accepts only the active version, and restates none     | `tests/source-scan_test.ts`, plus zero-fetch assertions in `tests/openai-provider_test.ts` |
| No `extractable: true`, no `exportKey`                             | `tests/source-scan_test.ts` and `supabase-security.test.ts`            |
| The module logs nothing and throws nothing                         | `tests/source-scan_test.ts`, plus a runtime console capture in `tests/safety-identifier_test.ts` |
| No key-shaped literal is committed anywhere                        | `tests/source-scan_test.ts` and `supabase-security.test.ts`            |
| The mobile app names no secret, no identifier and no derivation    | `supabase-security.test.ts`                                            |
| The identifier reaches no log line and no response body            | `tests/handler-safety-identifier_test.ts`                              |
| No uuid-to-identifier mapping is stored anywhere                   | `tests/source-scan_test.ts` and `tests/safety-identifier_test.ts`      |

### 6.4 Memory handling, stated honestly

After `crypto.subtle.importKey` copies the bytes, the module overwrites its own `Uint8Array` with
zeroes. That is **best effort on the one buffer that can be overwritten** and nothing more:

- the environment handed the value over as a **JavaScript string**, and strings are immutable;
- decoding produced a second string;
- both live until the garbage collector reclaims them, which may be never within the isolate's
  lifetime, and which may leave copies behind when it does.

**Nothing here is cryptographic erasure, and nothing in this repository may describe it as such.** The
real containment is the process boundary: the value exists only inside the Edge Function isolate, and
nothing in that isolate can log it, return it or export it.

---

## 7. Rotation

Version 1 is the initial active version. The active version is a **source constant**
(`SAFETY_IDENTIFIER_ACTIVE_VERSION` in `safety-identifier.ts`), deliberately not an environment value:
switching it changes every user's identifier at once, and that must be a reviewed one-line diff
attached to a deployment rather than something whoever sets an environment variable can do silently.

**Future version-2 secret name (reserved, not created):**

```
NOOR_AI_SAFETY_HMAC_KEY_V2
```

**Do not create it now.** No production module reads it, and a source scan asserts that no file in the
function does.

### 7.1 Procedure

1. **Add and review code support for V2 before provisioning it.** Code first, key second — the reverse
   order means a provisioned secret sitting in an environment with nothing reviewed to use it.
2. **Provision V2 through an approved secret channel** (§5, §6.1).
3. **Deploy code capable of validating both configuration versions but emitting only the explicitly
   selected active version.** Validating both is what makes step 4 meaningful; emitting one is what
   keeps §7.3 true.
4. **Run mocked and local verification.**
5. **Perform a separately approved controlled hosted verification.**
6. **Switch the source-controlled active-version constant from V1 to V2 in a reviewed deployment.**
7. **Retain V1 only for a bounded rollback window**, agreed before step 6 rather than after.
8. **Remove V1** after the rollback window closes and verification is complete.
9. **Record the rotation event** — date, versions, who approved, what was verified. **No key values.**

### 7.2 Rotation is a discontinuity, and this is the honest record of it

OpenAI accepts **one** safety identifier per request. Changing the key or the version therefore changes
every user's identifier at once. Recorded plainly:

- **OpenAI-side continuity for the old identifier ends at rotation.** Abuse history accumulated against
  the previous value does not follow the user forward.
- **NoorLife does not maintain a uuid-to-old-identifier mapping**, and will not create one.
- **No dual identifier is sent.** There is one field and one value per request.
- **No historical identifier table is created.**
- **Emergency compromise rotation prioritises secrecy over continuity**, without exception.

### 7.3 What must stay true through any rotation

- One derivation per handler request, and exactly one identifier emitted.
- The active version is a source constant, never an unrestricted environment value.
- **The outbound boundary follows that constant** and restates no version of its own, so step 6 is the
  single edit that switches what is sent (§3.4).
- An unknown or malformed version label fails closed rather than emitting a value nobody can attribute.
- No backward mapping is stored, in a table or in memory.

---

## 8. Emergency response — suspected key compromise

1. **Disable Noor AI first**, using the existing source-controlled kill switch (`productionConfig.enabled`,
   §I.2). It is the outermost lock and it runs before authentication-derived work of any kind.
2. **Revoke and replace the compromised HMAC secret** through an approved channel (§5, §6.1).
3. **Review whether the OpenAI API key or any Supabase secret was also exposed.** A compromise that
   reached one function secret plausibly reached the others; the key separation in §3.2 bounds the
   blast radius, it does not prove containment.
4. **Introduce a new version** (§7). Do not re-provision the same version number with new bytes —
   that produces two different keys with one label, which is unauditable.
5. **Do not restore traffic** until the deployment and the identity-continuity implications in §7.2
   have been reviewed.
6. **Never log the compromised value, and never compare against it.** A "was it this key?" check is a
   second copy of the secret in a second place.
7. **Do not claim cryptographic erasure from the provider's retention systems.** Rotating NoorLife's
   key changes what NoorLife sends from that moment on. It does not reach, alter or delete anything
   OpenAI already holds.

---

## 9. Deletion and account lifecycle

- **No safety identifier is stored in any NoorLife table.** There is nothing to delete on NoorLife's
  side because nothing was written.
- **Account deletion removes the underlying account data** through the separately reviewed deletion
  architecture (`ACCOUNT_DELETION_ARCHITECTURE.md`). This phase adds no account-deletion RPC and
  changes no deletion path.
- Once the uuid is gone, **NoorLife no longer has an ordinary application path to recompute the value**
  — recomputation would need both the key and the uuid, and the uuid is what deletion removes. This is
  a statement about NoorLife's application paths, not a guarantee about backups, and it is not a
  cryptographic erasure claim.
- **This does not delete data already retained by OpenAI** under its applicable policies. See
  `NOOR_AI_DATA_CONTROL_DECISION.md` §3.2: abuse-monitoring retention is "up to 30 days" with named
  exceptions, and it is not scoped by `store`.
- **Do not create an identifier-reversal or mapping table**, in any phase, for any reason. It would
  reintroduce exactly the linkage the keyed construction exists to prevent.

---

## 10. Verification performed, and verification still owed

### 10.1 Performed — mocked and local only

- Focused derivation tests: key parsing and every rejected representation, determinism, key and
  subject separation, domain separation against an independent reference calculation, exact format,
  canonical-uuid folding, an independent Web Crypto reference vector, non-extractable sign-only
  import, and the absence of any persisted state.
- Focused handler tests: ordering (verification → derivation → reservation → provider), zero quota and
  zero provider calls on a derivation failure, client inability to supply or override the value, two
  users producing two identifiers, one user producing a stable identifier, and the value's absence from
  every log record and response body.
- Focused provider tests: the identifier travelling only in `safety_identifier`, zero fetch calls for a
  missing, malformed or identity-shaped value, **zero fetch calls for a syntactically valid identifier
  under any inactive version**, the accepted prefix following `SAFETY_IDENTIFIER_ACTIVE_VERSION` rather
  than a second hand-written literal, and two sequential users through one adapter sending distinct
  values.
- Production gates: the active version as a source constant, the V1 secret name read in one module, the
  V2 name read nowhere, the kill switch still `false`, and neither key alone enabling traffic.
- Source scans: no unkeyed user digest, no email or phone input, no committed key-shaped literal, no
  `extractable: true`, no key export, no mobile reference, no identifier logging, no persistence.

### 10.2 Performed hosted — 2026-08-09

- **Key generated** — 32 CSPRNG bytes, non-zero, canonical unpadded base64url, round-trip verified,
  entirely inside one dedicated process.
- **Provisioned** as the Edge Function secret `NOOR_AI_SAFETY_HMAC_KEY_V1`, through an in-memory
  Management API body. It never entered argv, an environment file, disk, a log, or the clipboard.
  Reconciled by authoritative secret-name inventory: present exactly once, V2 absent.
- **Exercised once**, in the single authorised synthetic request. A per-user identifier was derived
  from the verified synthetic subject and accepted by the provider boundary under the active version.
  The value was never printed, logged, returned, or stored.
- **Deployment** — the function is deployed and **source-disabled**.

Note on mechanism: the key was provisioned through the Management API rather than
`supabase secrets set NAME=value`, deliberately and in the stricter direction — the CLI form would
place the value in process arguments, which §5 forbids.

### 10.3 Still owed, and separately gated

- **Rotation** — the v2 procedure in §7 has never been executed. It is a future operational exercise,
  not an implementation gap.
- **Emergency response** — §8 has never been exercised, and should not be exercised for practice
  against a live key without its own plan.
- **Account-deletion integration** — §9's erasure path is documented and was performed manually once
  for the synthetic subject, but it is **not wired into the account-deletion flow**. That wiring is a
  release/privacy gate tracked in `PRE_RELEASE_BACKLOG.md` §2.4.
- **Platform log retention confirmation** (§H.4) remains open.

**B10's safety-identifier construction is implemented, provisioned, and proven once in hosted use.
The function remains disabled, and NoorLife is not production-ready.**
