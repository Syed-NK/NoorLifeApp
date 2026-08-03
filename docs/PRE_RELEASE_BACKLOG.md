# NoorLife — Pre-Release Backlog

Everything that must be finished, configured or reviewed before NoorLife can be
released publicly. Each item says what the current state actually is, what has to
happen, and what it depends on.

Most of this list is not a defect in the current code: they are deliberately deferred
items, most of them blocked on an external account, a DNS record, a paid service or a
review that is not mine to sign off. The exceptions are marked **(defect)** in their
heading — currently 2.3a. **Check the current state before acting on any of them** —
several are one dashboard toggle away from being done, and a few would break the working
flow if enabled in the wrong order.

Status key: **Blocked** (needs something external) · **Ready** (can be done now) ·
**Needs review** (needs a human decision or approval).

---

## 1. Email delivery

### 1.1 Custom SMTP via Resend — **Blocked**

**Production custom SMTP remains unconfigured, and is still required before release.**
What is *not* true — and what this item said before 2026-08-03 — is that email delivery
is blocked outright. On 2026-08-03 **Supabase's built-in development SMTP successfully
delivered a password-recovery email to the authorized test account**, and the link was
received and used on a device (see 1.4).

So the distinction this item now turns on is suitability, not delivery. The built-in
sender is a development facility: it is rate-limited to a handful of messages per hour
and **is not suitable for production use**. We exhausted that quota during Phase 2
testing, which is what forced item 1.3. Custom SMTP is what makes delivery
rate-appropriate, domain-aligned and ours; until it is configured, no release claim about
email may rest on the built-in sender.

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

### 1.4 Password-recovery email — **Verified on the emulator** (2026-08-03)

A real reset link has now been received and used. On a **release** build installed fresh
(`pm clear`, genuine first run) on the Pixel 8 emulator, a recovery email requested from
Forgot Password was delivered by Supabase's built-in development SMTP to the authorized
test account, and tapping the link took the app automatically to Set New Password. The
password was then set by the account owner, and the resulting state was checked: the
update succeeded, the recovery grant was consumed, a replay of the same link was refused,
and the session survived a cold restart. Full evidence in
`design-reference/phase-6c-3c-auth-callbacks/README.md`.

Two things this does **not** settle:

- **Production delivery.** This used the development sender, which is not suitable for
  production — 1.1 is still required before release.
- **The physical phone.** The Honor device was unreachable over wireless adb throughout
  the session, so this is verified on **one** target. See 4.x below; do not describe
  password recovery as both-target verified.

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

### 2.1a Supabase redirect allow-list for the application callback — **Done, confirmed live** (2026-08-03)

Phase 6C-3C introduced `noorlifeapp://auth/callback` as the single destination for the
signup confirmation, password recovery and email-change links. **Authentication → URL
Configuration → Redirect URLs** must contain both of:

```
noorlifeapp://auth/callback
noorlifeapp://auth/callback?**
```

The second is not redundant: every NoorLife redirect carries `nl_rid`, and `supabase-js` appends
`sb_flow_id=<id>` on top of it (only when `experimental.appendPkceFlowIdToRedirects` is enabled — it
is **not** a default, contrary to what this file said before 2026-08-03) to the redirect it
sends for a PKCE password recovery, Supabase matches redirect URLs by glob, and a bare
entry does not match a URL carrying a query string.

Until both exist, GoTrue substitutes the project's Site URL and an emailed link never
reaches the application. This is a dashboard action; no code can perform it. The exact
strings are exported as `REQUIRED_SUPABASE_REDIRECT_URLS` from
`src/services/auth/auth-callback.config.ts`, and
`docs/PHASE_6C_3C_AUTH_CALLBACK_CONTRACT.md` §7 records why each is needed.

**Both entries are confirmed present, by evidence rather than by report.** The recovery
link received on 2026-08-03 (1.4) carried `sb_flow_id`, because
`experimental.appendPkceFlowIdToRedirects` was enabled in the build under test. With a
query string present, a bare allow-list entry would have stopped matching, GoTrue would
have substituted the Site URL, and the link could not have reached the application at all
— but it did. So the wildcard entry is live, not merely configured-in-principle.

*(That flag is part of the `nl_rid`/`sb_flow_id` hardening, which lands separately from the
callback-navigation commit that carries this note.)*

*Depends on:* nothing in the code. *Blocks:* any end-to-end test of 1.3 and 2.3.

### 2.1b Callback flows not yet exercised by a real email — **Partly resolved** (2026-08-03)

**Recovery is done.** The recovery-ready state and the Set New Password form were reached
on a device with a real emailed link, on a release build, and the whole outcome set was
checked — see 1.4. The claim in earlier revisions of this item and of the phase README,
that this state was unreachable because no link could arrive, no longer holds.

**Email-change-pending and email-change-confirmed are still not device-verified.** They
need a real confirmation link, and Secure Email Change would email the live test account,
which the phase brief forbids. They remain covered by the injected-port suites
(`auth-callback-screen.test.tsx`, `set-new-password-screen.test.tsx`,
`auth-callback-service.test.ts`) and are **not** claimed as device-verified. No fixture
route was added to reach them on a device — 6C-3B removed the last one, for the reason
recorded there.

*Depends on:* a decision on how to exercise email change without touching the live test
account. No longer depends on 1.1 for delivery, though production delivery still does.

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

### 2.3a "Open Email App" cannot see an installed mail app — **Ready (defect)**

Found on the emulator during the 1.4 recovery pass, and **not fixed there**: it is a native
manifest issue with nothing to do with the callback, so it was deliberately left out of that
commit.

On Check Your Inbox, **Open Email App** renders the error *"No email app is available on
this device. Open your mail in a browser instead."* — on a device where Gmail is installed
and working. The same intent resolves fine from outside the app:

```bash
adb shell am start -a android.intent.action.MAIN -c android.intent.category.APP_EMAIL
# Starting: Intent { act=android.intent.action.MAIN cat=[android.intent.category.APP_EMAIL] }
```

**Likely cause: Android 11 package visibility.** Since API 30, an app cannot see which
other packages can handle an intent unless it declares them. `Linking.canOpenURL('mailto:')`
and any `queryIntentActivities` probe therefore return nothing, and the honest-failure
branch fires even though the mail app is there. The fix is a `<queries>` element in the
manifest declaring the email intent, which under Expo means a config plugin or an
`android.manifest` merge rather than hand-editing `AndroidManifest.xml`:

```xml
<queries>
  <intent>
    <action android:name="android.intent.action.SENDTO" />
    <data android:scheme="mailto" />
  </intent>
</queries>
```

Worth confirming the real probe in the Reset Link Sent screen before changing anything —
the cause above is inferred from the symptom, not yet read off the code.

*Note:* the user is not stranded. The message is accurate about the remedy, and the link in
the email works when opened from the mail app directly. This is a papercut, not a blocker.

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

### 5.4 Physical-phone verification of the recovery callback — **Outstanding**

The 2026-08-03 recovery pass (1.4) is verified on the **Pixel 8 emulator only**. The Honor
ALT-LX2 was **not reachable** for the whole session: `adb devices` listed the emulator
alone, `adb mdns services` discovered nothing, and `adb connect 192.168.0.238:5555` timed
out. The standing rule is that a visible change is verified on both targets, so this one is
verified on one, and **must not be described as both-target verified**.

The APK built for that pass already carries both ABIs
(`-PreactNativeArchitectures=arm64-v8a,x86_64`), so nothing needs rebuilding — the phone
pass needs wireless debugging re-enabled and the device re-paired, then
`node scripts/deploy-both.js --no-build --clear` and a repeat of the 1.4 sequence. The
phone is 720×1600 at a lower density than the emulator's 1080×2400, so the Set New Password
layout and the callback status copy are both worth looking at rather than assuming.

*Depends on:* physical access to the device and its current wireless-debugging port.

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
   *(2.1a confirmed live 2026-08-03, so this ordering constraint is satisfied.)*
3. **4.1 schema review** before any module table exists.
4. **3.1 / 3.2 published** before the store listings are submitted.
