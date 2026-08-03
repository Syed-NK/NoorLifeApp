# NoorLife — Pre-Release Backlog

Everything that must be finished, configured or reviewed before NoorLife can be
released publicly. Each item says what the current state actually is, what has to
happen, and what it depends on.

Nothing in this list is a defect in the current code. They are deliberately deferred
items, most of them blocked on an external account, a DNS record, a paid service or a
review that is not mine to sign off. **Check the current state before acting on any of
them** — several are one dashboard toggle away from being done, and a few would break
the working flow if enabled in the wrong order.

Status key: **Blocked** (needs something external) · **Ready** (can be done now) ·
**Needs review** (needs a human decision or approval).

---

## 1. Email delivery

### 1.1 Custom SMTP via Resend — **Blocked**

Supabase's built-in email sender is rate-limited to a handful of messages per hour and
is not for production use. We exhausted that quota during Phase 2 testing, which is
what forced item 1.3.

- Create a Resend account and verify the sending domain.
- Add the SMTP credentials to the Supabase project (Authentication → SMTP Settings).
- Set a sender identity of `NoorLife <no-reply@auth.nktrendz.com>`.
- **Do not** put SMTP credentials in the app or in the repository. They belong in the
  Supabase dashboard only.

*Depends on:* 1.2 (the domain must resolve and authenticate first).
*Blocked by:* Resend is a paid service beyond its free tier; this is a purchasing
decision, not a code change.

### 1.2 DNS for `auth.nktrendz.com` — **Blocked**

The auth domain does not exist yet. Records needed:

| Record | Purpose |
| --- | --- |
| `auth.nktrendz.com` → Supabase | Custom auth domain, so links in emails are ours |
| SPF (`TXT`) | Authorises Resend to send as the domain |
| DKIM (`CNAME` ×3) | Signs outgoing mail; Resend supplies the exact values |
| DMARC (`TXT`) | Start at `p=none` with reporting, tighten to `p=quarantine` |

Without SPF, DKIM and DMARC aligned, verification emails land in spam — which looks
identical to "the app did not send anything" from the user's side.

*Depends on:* access to the `nktrendz.com` DNS zone.

### 1.3 Re-enable email confirmation — **Blocked**

Currently **off** on the hosted project (set 2026-07-29 to clear the exhausted email
quota). Consequence: signup auto-confirms, Supabase returns a live session, no email is
sent, and **Verify Email — screen 08 — is unreachable by design**.

The flow already handles both modes and branches on whether a code was actually sent, so
re-enabling is configuration only:

1. Finish 1.1 so mail can actually be delivered.
2. Set `enable_confirmations = true` in `supabase/config.toml`.
3. `npx supabase config push`.
4. Re-test signup end to end and confirm screen 08 is reached.

*Order matters:* enabling this before SMTP works would break signup for real users.

### 1.4 Password-recovery email — **Blocked**

Forgot Password and Reset Link Sent are built, and the service calls Supabase
correctly. The email itself cannot be verified until 1.1 is done. Do not claim password
recovery works until a real reset link has been received and used.

### 1.5 OTP length — **Resolved and pinned** (2026-07-30)

The production design is **six digits**, and that is now the contract in all three places
it has to hold:

- `OTP_LENGTH = 6` in `src/features/entry-auth/components/otp-input.tsx` (unchanged — the
  UI was always six boxes, with paste, autofill and backspace handled by a single hidden
  input).
- `otp_length = 6` is now declared in `supabase/config.toml`. It previously was not, which
  is why the value could drift unnoticed: `config push` had nothing to compare against.
- The remote project reports **no drift** against that declaration, so the hosted value is
  6.

Verification caveat, stated plainly: the Supabase CLI offers no `config pull` or read
command for auth settings, and I did not extract the CLI's access token to query the
Management API directly. The evidence that the remote value is 6 is therefore that
`supabase config push` reports "Remote Auth config is up to date" *with `otp_length = 6`
declared locally*. An earlier session recorded the project as 8; that is no longer
reproducible, so it was either already corrected by a prior push or misread at the time.

Two tests now guard it — `src/features/entry-auth/__tests__/otp-length.test.ts` asserts
`OTP_LENGTH === 6`, reads `config.toml` to assert the pinned value, and rejects anything
that is not exactly six ASCII digits (including an eight-digit code, and full-width digits
that some keyboards paste).

Email confirmation remains deliberately deferred (1.3) during module building, so this
path is not yet exercised end to end by a real email.

---

## 2. Authentication hardening

### 2.1 PKCE code challenge is falling back to plain — **Done (Phase 6C-3C)**

Hermes has no WebCrypto, logged at runtime as "WebCrypto API is not supported", so the
S256 challenge degraded to `plain`. It worked, but it was weaker than it should be — a
`plain` challenge *is* the verifier, so PKCE protected nothing — and it mattered for more
than 2.3: every email confirmation and password recovery link is a PKCE flow.

`src/services/auth/web-crypto.ts` now installs `crypto.subtle.digest('SHA-256')` and
`crypto.getRandomValues` from **`expo-crypto`** (added as a direct dependency at the
version `expo-auth-session` already pinned), plus a minimal `TextEncoder` and `btoa`,
filling only the globals that are missing. It is imported for its side effect in
`src/lib/supabase.ts` *before* `createClient`, because `getCodeChallengeAndMethod` reads
those globals at call time.

`describePkceChallengeMethod()` reports the method the environment will actually produce.
`web-crypto.test.ts` asserts `plain` for a Hermes-shaped environment before installation
and `s256` after, and the value is captured on device — see
`design-reference/phase-6c-3c-auth-callbacks/README.md`.

### 2.1a Supabase redirect allow-list for the application callback — **Ready**

Phase 6C-3C introduced `noorlifeapp://auth/callback` as the single destination for the
signup confirmation, password recovery and email-change links. **Authentication → URL
Configuration → Redirect URLs** must contain both of:

```
noorlifeapp://auth/callback
noorlifeapp://auth/callback?**
```

The second is not redundant: `supabase-js` appends `sb_flow_id=<id>` to the redirect it
sends for a PKCE password recovery, Supabase matches redirect URLs by glob, and a bare
entry does not match a URL carrying a query string.

Until both exist, GoTrue substitutes the project's Site URL and an emailed link never
reaches the application. This is a dashboard action; no code can perform it. The exact
strings are exported as `REQUIRED_SUPABASE_REDIRECT_URLS` from
`src/services/auth/auth-callback.config.ts`, and
`docs/PHASE_6C_3C_AUTH_CALLBACK_CONTRACT.md` §7 records why each is needed.

*Depends on:* nothing in the code. *Blocks:* any end-to-end test of 1.3 and 2.3.

### 2.1b Callback flows not yet exercised by a real email — **Blocked**

The recovery-ready, email-change-pending and email-change-confirmed states are reachable
only with a PKCE code GoTrue issued against a verifier this device stored, which needs a
delivered email. With 1.1 deferred, they are covered by the injected-port suites
(`auth-callback-screen.test.tsx`, `set-new-password-screen.test.tsx`,
`auth-callback-service.test.ts`) and are **not** claimed as device-verified. No fixture
route was added to reach them on a device — 6C-3B removed the last one, for the reason
recorded there. See the phase README's "What is blocked, and why".

*Depends on:* 1.1 (SMTP) and 2.1a (the allow-list).

### 2.2 Google sign-in — **Blocked**

Code path exists and rejects honestly with `provider-not-configured`. **Untested.**
Needs:

- A Google Cloud OAuth client (Web + Android).
- The provider enabled in the Supabase dashboard with that client id and secret.
- The redirect URI registered.
- **The official Google "G" mark placed at `assets/brand/google/g-logo.png`.** The asset
  registry deliberately holds `null` and the button renders no mark, because Google's
  brand guidelines forbid an approximation. Dropping the file in is the only code-side
  change.
- The client **secret** stays in the Supabase dashboard. It must never be in the app.

Do not claim Google sign-in works until it has been exercised on a device.

### 2.3 Apple Sign in — **Blocked**

`AppleSignInButton` renders only on iOS when `isAvailableAsync()` is true, and the
native `signInWithIdToken` path is written. **Untested.** Needs an Apple Developer
account, a Service ID, a private key (`.p8`) and the provider enabled in Supabase.

- The `.p8` key is never committed. `*.p8` is already in `.gitignore`.
- Apple Sign in is **mandatory** for App Store review if any other social login ships.

### 2.4 Account deletion — **Blocked (needs review)**

Required by both the App Store and Google Play when an account can be created in-app.
Not built. Needs:

- A destructive, confirmable flow in Settings.
- A server-side deletion path — deleting an `auth.users` row needs the service-role key,
  which **must not** be in the app. This means an Edge Function or equivalent.
- A decision on retention: immediate hard delete, or a grace period.

*Needs review:* the retention decision is a policy question, not a technical one.

---

## 3. Legal and store compliance

### 3.1 Privacy Policy — **Blocked (needs review)**

Linked from Create Account, and the link currently has no destination. Must be published
at a stable URL and must accurately describe what NoorLife collects — which, per module,
includes health and family data. Health data in particular attracts extra scrutiny in
both stores.

### 3.2 Terms of Service — **Blocked (needs review)**

Same: linked from Create Account, needs a published URL. Should state plainly that the
module assistants are not professional advice — matching the disclaimers the Health and
Finance AI policies already carry in code.

### 3.3 Google Play Data Safety declaration — **Blocked**

Must match reality. Based on the current code and the module registry, the declaration
covers at minimum: email address, name, profile photo, and — once modules store data —
health and fitness, financial info, calendar, photos, and contacts. Every permission in
the module registry carries its rationale, which is the raw material for this form.

### 3.4 App Store privacy labels — **Blocked**

The iOS equivalent of 3.3, plus a `NSUserTrackingUsageDescription` decision if any
analytics ever ship (none do today).

---

## 4. Module data layer

### 4.1 Per-module schema review — **Needs review**

The module framework runs on mock repositories behind `ModuleRepository`. **No production
tables exist for any module, deliberately** — the phase brief requires each module's data
model to be reviewed and approved first.

For each of the seven modules, before any table is created:

- The data model, reviewed and approved.
- RLS policies written per table. Never weaken the pattern established on
  `public.profiles`.
- A decision on whether the data is shared (Family is the hard case: shared rows with
  per-member visibility).
- Health and Finance need a retention and export answer before they store anything.

Replacing `mockModuleRepositoryProvider` with a Supabase-backed provider is the whole of
the integration work on the app side; no screen imports a repository directly.

### 4.2 Module AI orchestration — **Blocked**

No AI provider SDK is installed and **no API key exists in the app** — by design, and it
must stay that way. `moduleAIPolicies` is the policy the future orchestrator has to
satisfy: per-module scope, the refusal and qualification rules, and the confirm-before-
mutating requirement. The orchestrator itself must be server-side, so the key never
reaches a device.

### 4.3 Migrate the onboarding medallions to the canonical pictograms — **Ready**

There are two variants of the same eight approved pictograms in the project:

| Set | Path | Occupancy | Margin | Used by |
| --- | --- | --- | --- | --- |
| Normalized | `assets/images/pictograms/normalized/` | 71.1% | 37 px | Main Home tiles, module heroes, module states |
| Originals | `assets/images/pictograms/` | 85.9% | 18 px | Entry/Auth onboarding medallions |

Same artwork, different transparent padding. Both sets are internally uniform — all eight
assets in each measure at identical occupancy — so this is not per-asset drift, just two
canvases.

The module framework was locked onto the normalized set because that is what locked Main
Home renders, which makes "the hero shows the same pictogram as the tile" true by
construction. The medallions were left alone because changing them would alter an approved
Entry/Auth layout, which the artwork-lock pass was explicitly scoped out of.

To finish it: point `noorLifeAssets.modules` at `normalized/`, re-check the medallion's
optical size (the artwork will render ~17% smaller inside the same 56 dp medallion, so
`medallionSpec.pictogramRatio` likely needs raising), re-validate onboarding screens 03 and
04 on the Pixel 8, and delete the test in
`src/features/modules/__tests__/module-hero-assets.test.ts` that currently *records* the
difference.

---

## 5. Release engineering

### 5.1 Remove the Module Gallery from the release surface — **Done, verify**

`src/app/module-gallery.tsx` guards on `__DEV__` and redirects to Main Home otherwise.
Worth re-verifying in the release build before shipping, since a broken guard would put
scaffolding one deep link from a user.

### 5.2 Signing keys — **Blocked**

Release builds are currently signed with the debug keystore. A real upload key is needed,
stored outside the repository, with Play App Signing enrolled.

### 5.3 Crash and error reporting — **Needs review**

Nothing is installed. Worth deciding before release, and worth deciding carefully: a
reporter that captures screen contents would capture health and family data.

---

## Domain and URL set

| Purpose | URL |
| --- | --- |
| Marketing site | `https://nktrendz.com` |
| Auth / email links | `https://auth.nktrendz.com` |
| Privacy Policy | `https://nktrendz.com/privacy` |
| Terms of Service | `https://nktrendz.com/terms` |
| Support | `https://nktrendz.com/support` |
| Account deletion request | `https://nktrendz.com/delete-account` |

The last one is separately required by Google Play: a deletion route must be reachable
from the web, not only from inside the app.

---

## Ordering

Several items will break the working app if done out of order:

1. **1.2 DNS** → **1.1 SMTP** → **1.5 OTP length** → **1.3 confirmation on**.
   Enabling confirmation before mail is deliverable breaks signup for real users.
2. **2.1 PKCE S256** before **2.2 Google**. *(2.1 done in Phase 6C-3C.)*
2a. **2.1a redirect allow-list** before **1.3 confirmation on**. With confirmation enabled
   and no allow-listed callback, every new account is sent to a web page it cannot use.
3. **4.1 schema review** before any module table exists.
4. **3.1 / 3.2 published** before the store listings are submitted.
