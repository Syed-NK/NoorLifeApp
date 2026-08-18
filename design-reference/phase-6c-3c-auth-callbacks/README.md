# Phase 6C-3C — Authentication callbacks and recovery hardening

Device verification for the deep-link authentication callback, the recovery gate, the PKCE S256 fix,
and the Change Password disabled state.

## Target

| | |
|---|---|
| Build | `android/app/build/outputs/apk/release/app-release.apk`, **release**, `app:assembleRelease -PreactNativeArchitectures=x86_64` |
| Device | Android emulator, `sdk_gphone64_x86_64`, Android 17 (API 37), serial `emulator-5554` |
| Viewport | 1080 × 2400 px |
| Density | 420 dpi → scale factor 2.625 → **411.4 × 914.3 dp** |
| Font scale | `1.0` |
| Account | The authenticated **Free** test account already signed in on this emulator |

**Every capture is from the release APK.** There is no fixture harness — 6C-3B removed the one 6C-3A
shipped, and this phase did not add another. Every state below was produced with a **real shaped ADB
deep link against the release build**, not with an injected outcome.

The physical Honor phone was **not attached** during this pass; `adb devices` listed the emulator
only. The phone pass is **blocked, not done**, and is not claimed here. The standing rule is that a
visible change is verified on both targets, and this one has been verified on one.

## Nothing was changed on the test account

- **No password was submitted anywhere.** Change Password was driven to its enabled state and
  Update Password was **never pressed** (`10`). The fields were cleared by navigating away.
- **No email was changed**, and no confirmation was requested.
- The only live writes to Supabase were `resetPasswordForEmail` calls for
  **`noorlife-pkce-probe@example.com`** — an address with no account. Supabase resolves that request
  identically whether or not the address exists, by design, so the form is not an
  account-existence oracle and nothing about the real account was read or changed. Those calls exist
  for one reason: `getCodeChallengeAndMethod` runs inside them, and that is the only way to execute a
  genuine PKCE challenge. See "PKCE / S256".
- Every callback below carried a **hand-shaped code**, never one GoTrue issued, so none of them could
  establish a session.

## Commands

```bash
# toolchain — neither var is on PATH on this machine
export JAVA_HOME="C:\Program Files\Android\Android Studio\jbr"
export ANDROID_HOME="C:\Users\syedk\AppData\Local\Android\Sdk"

# build. The arch flag is required: a full-ABI release fails on an arm64 CMake step.
cd android && ./gradlew app:assembleRelease -PreactNativeArchitectures=x86_64

# install
adb install -r android/app/build/outputs/apk/release/app-release.apk

# release-bundle scan (checks both Hermes string encodings)
node scripts/scan-release-bundle.mjs

# deep links. MSYS_NO_PATHCONV=1 stops Git Bash rewriting the URL into a Windows path — without it
# `am start` receives `D:/auth/callback` and reports its usage instead.
export MSYS_NO_PATHCONV=1
CODE=34e770dd-9ff9-416c-87fa-43b31d7ef225
adb shell am start -a android.intent.action.VIEW -c android.intent.category.BROWSABLE \
  -d "noorlifeapp://auth/callback?code=$CODE"

# cold start: force-stop first, so the link launches the process rather than re-entering it
adb shell am force-stop com.anonymous.NoorLifeApp

# capture — pull, never shell redirection: PowerShell rewrites a redirected binary stream and
# corrupts the PNG with a BOM.
adb shell screencap -p /sdcard/_s.png
adb pull /sdcard/_s.png <file>.png
```

### The exact links used

| Capture | Link |
|---|---|
| `11a`, `11b` | force-stop, then `noorlifeapp://auth/callback?code=<uuid>` |
| `12` | app running, then `noorlifeapp://auth/callback?code=<other-uuid>` |
| `06` | the `12` link delivered **again** |
| `03` | `noorlifeapp://auth/callback?error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired` |
| `02` | `noorlifeapp://auth/callback?code=abc` |
| `04` | `exp+noorlifeapp://auth/callback?code=<uuid>` |
| `05` | `noorlifeapp://auth/callback/extra?code=<uuid>` |
| `05b` | `noorlifeapp://elsewhere.example.com/auth/callback?code=<uuid>` |
| `07a` | `noorlifeapp://auth/callback?code=<uuid>` with Wi-Fi and data off, **no stored verifier** |
| `07` | the same, **after** a reset request had stored a verifier |
| `08` | `noorlifeapp://auth/set-new-password` |
| `09`, `09b`, `10` | `noorlifeapp://profile/privacy-security/change-password` |
| `13` | `noorlifeapp://faith/quran` |

## Captures

| File | What it shows |
|---|---|
| `11a-cold-start-native-handoff.png` | A cold-start callback, 3 s after the link launched the process: the native splash has handed off. **This is the capture that found a bug — see "The bug this pass caught".** |
| `11b-cold-start-callback-resolved.png` | The same launch, resolved. The callback screen processed the link and reports `Link already used`. No code, no token, no URL anywhere on screen. |
| `12-warm-start-handled.png` | A **new** link delivered to the running app. Handled once; the screen is entered by `push`, so an invalid callback leaves the previous screen underneath. |
| `06-duplicate-delivery.png` | The **same** link delivered a second time. Refused, and no second exchange was made — the in-process guard collapses it before the network. |
| `03-expired-link.png` | A GoTrue-reported expiry. "Link expired", with the recovery advice. The `error_description` the link carried is **not** on screen: it is discarded at the parser. |
| `02-invalid-link-malformed-code.png` | `code=abc`. Refused as `Link not valid` **before any network call** — the shape check precedes the exchange. |
| `04-untrusted-scheme.png` | `exp+noorlifeapp://…`. Expo Go's scheme is in the generated manifest and is still refused: "That link did not come from NoorLife." |
| `05-unsupported-path.png` | `auth/callback/extra`. Right prefix, wrong destination. |
| `05b-untrusted-host.png` | `noorlifeapp://elsewhere.example.com/auth/callback`. The right path with something in the authority slot. |
| `07-offline-callback.png` | Offline, **with** a stored verifier so the exchange genuinely reached the network. "You are offline… Your link is still valid" and a **Try Again** — the only failure class where a retry can succeed. |
| `07a-offline-no-verifier-still-refused.png` | Offline **without** a stored verifier. Reported `Link already used`, not offline — see "What `07a` taught us". |
| `08-set-new-password-no-grant.png` | **The security capture.** `/auth/set-new-password` opened by deep link with no recovery grant: no password field, no disabled form, no submit control at all. |
| `09-change-password-empty-disabled.png` | **The defect, fixed.** Update Password is disabled over two empty fields — grey fill, dark readable label, and no inline error over a field the user has not touched. |
| `09b-change-password-confirm-required.png` | A valid password typed, confirmation still empty. Still disabled. |
| `10-change-password-valid-enabled-not-submitted.png` | Both fields matching and strong. Enabled and blue, strength meter "Strong". **Not submitted.** |
| `13-unrelated-deep-link-ignored.png` | `noorlifeapp://faith/quran`. Ordinary deep linking still works and raises **no** callback state — an unrelated link is not treated as a hostile callback. |

### What `09`, `09b` and `10` prove together

The three states in order: refused with nothing typed, refused with the confirmation missing, enabled
only when both fields hold the same password and it meets the policy. The fill changes and the
**geometry does not** — the control is 48 dp in all three.

The disabled label is `#14265F` on the `#C8CED8` disabled fill, which measures **9.0:1**. Before this
phase the control had no `disabled` prop at all: it was drawn at full `#1677FF`, accepted a press, and
answered with a validation message. Both the button and the handler now read one function,
`evaluatePasswordDraft`.

### What `02`–`06` prove together

Five refusals, five different reasons, and none of them shows the user anything the link contained.
`02`, `04`, `05` and `05b` never reached the network at all — the parser refused them — and `06` never
reached it either, because the in-process guard recognised the repeat. The only one that involved a
server was `03`, and that was the server *reporting* the expiry.

### The bug this pass caught

`11a` is why the device pass exists. The first attempt at a cold-start callback left the app on the
**native** splash indefinitely — not the branded splash, the Android launch screen — over a callback
screen that was working perfectly behind it.

The cause: Expo Router makes a deep-linked route the *initial* route, so `src/app/index.tsx` never
mounts. It was the only caller of `useNativeSplashHandoff`, so neither of that hook's two dismissal
paths was armed — not even its 1500 ms ceiling. Every launch this project had ever measured went
through the entry gate, so nothing had exercised the case.

Fixed by `useNativeSplashBackstop()`, called from `RootNavigator`, which mounts for every route; and
by moving the hook's "already asked to hide" guard from an instance ref to a process-wide flag, so the
gate and the backstop cannot both call `hideAsync`. Five tests in
`native-splash-handoff.test.tsx` lock the case down, and `11a`/`11b` are the recapture.

### What `07a` taught us

The first offline attempt reported **`Link already used`**, not offline. That is correct, and it is
worth recording: `exchangeCodeForSession` resolves the stored PKCE verifier *before* it makes any
request, so a code with no verifier fails locally whatever the network is doing. Connectivity is only
reachable as a cause once a verifier exists — which is what `07` does, and why the two captures are
both kept.

## PKCE / S256

**Result: `s256`. The `plain` fallback is gone.**

The evidence is in three parts, because no single one of them is sufficient:

1. **`expo-crypto` is in the shipped APK.** `classes3.dex` contains `expo/modules/crypto`,
   `CryptoModule`, `ExpoCrypto` and `digestStringAsync`. The native module the shim depends on is
   genuinely packaged, not merely a dependency in `package.json`.
2. **Logcat captures JS output from this release build.** `ReactNativeJS: Running "main"` appears, so
   an absent warning is meaningful rather than an absent channel.
3. **A genuine PKCE challenge was executed, and no warning was emitted.** A real
   `resetPasswordForEmail` for `noorlife-pkce-probe@example.com` runs
   `getCodeChallengeAndMethod` → `generatePKCEChallenge`, which is the exact function that logs
   `WebCrypto API is not supported. Code challenge method will default to use plain instead of
   sha256.` when the globals are missing. `adb logcat -d | grep -iE "WebCrypto|plain instead of
   sha256"` returned **nothing**.

`07-offline-callback.png` corroborates part 3 independently: reaching an *offline* verdict means the
exchange got past the verifier lookup and attempted a network request, so the challenge had been
generated successfully.

Before this phase the same grep would have matched on every launch that touched a PKCE flow. That was
backlog item 2.1, now closed.

## What is blocked, and why

Three states in the phase brief's capture list are **not** captured here, and are not claimed:

| State | Why it is unreachable on a device today |
|---|---|
| ~~Recovery-ready, and the Set New Password form~~ | **No longer blocked — verified on the emulator 2026-08-03.** This row claimed no link could arrive because production SMTP is deferred. That conflated two things: production SMTP is indeed still unconfigured, but Supabase's built-in *development* sender delivers, and a real recovery link was received and used. See `RECOVERY_DEVICE_VERIFICATION.md`. |
| Email-change pending | Requires a real confirmation link, and Secure Email Change would email the live test account, which the brief forbids. |
| Email-change confirmed | Same. |

The two remaining rows are covered by `auth-callback-screen.test.tsx`,
`set-new-password-screen.test.tsx` and `auth-callback-service.test.ts`, which drive the outcomes
through the injected port. **No fixture route was added to reach them on a device** — 6C-3B removed
the last one after finding that a `__DEV__` guard did not keep it out of the release bundle, and
re-adding one would undo that. The recovery row needed no fixture in the end: a real emailed link
reached it.

One further state was **not photographed rather than blocked**: the transient *Processing* view. At
healthy latency the exchange resolves in under 250 ms, inside the router's own push animation, so
`adb shell screencap` cannot land on it. It is not hypothetical — it is the state `07` sat in while the
offline request hung — and it is asserted directly, including its reserved height, by three tests in
`auth-callback-screen.test.tsx`.

## Required Supabase Dashboard configuration

**Not yet configured**, and no code can configure it. **Authentication → URL Configuration → Redirect
URLs** must contain both:

```
noorlifeapp://auth/callback
noorlifeapp://auth/callback?**
```

The second is not redundant: every NoorLife redirect carries `nl_rid`, and `supabase-js` appends
`sb_flow_id=<id>` on top of it (only when `experimental.appendPkceFlowIdToRedirects` is enabled — it
is **not** a default, contrary to what this file said before 2026-08-03) to the redirect it sends for a
PKCE password recovery, Supabase matches redirect URLs by glob, and a bare entry does not match a URL
carrying a query string. Until both exist, GoTrue substitutes the project's Site URL and an emailed
link never reaches the application.

Tracked as backlog item **2.1a**. The exact strings are exported as
`REQUIRED_SUPABASE_REDIRECT_URLS` from `src/services/auth/auth-callback.config.ts`, and
`docs/PHASE_6C_3C_AUTH_CALLBACK_CONTRACT.md` §7 records why each is needed.

**Both entries are now confirmed present** (2026-08-03), by evidence rather than by report: the
recovery link received that day carried `sb_flow_id`, and with a query string present a bare entry
would not have matched, so the link could not have reached the app at all. It did. (The flag that puts
`sb_flow_id` on the redirect belongs to the `nl_rid` hardening, which lands separately — see
`RECOVERY_DEVICE_VERIFICATION.md`, "Which tree was tested".)

**Production custom SMTP remains unconfigured** (backlog 1.1) and is still required before release.
That is a separate matter from whether mail is deliverable at all: Supabase's built-in **development**
sender does deliver, and on 2026-08-03 it delivered a real recovery email to the authorized test
account. The built-in sender is rate-limited and **not suitable for production**, so no release claim
may rest on it. This pass used shaped links rather than live email because it predates that
verification, not because delivery was impossible.

## Release-bundle scan

`node scripts/scan-release-bundle.mjs` — **PASSED**. Extended in this phase with:

- **must be absent** — `[auth-callback] url=`, `[auth-callback] code=$`, `access_token=`,
  `refresh_token=`, `sb_flow_id=`, `error_description=`. A code or token only exists at runtime, so no
  scan can find one in a bundle; what a scan *can* find is the format string that would print it,
  because Hermes keeps the literal halves of a template. All absent.
- **must be absent** — `I have the link — set a new password` and `reset-sent-continue`, the fixture
  shortcut removed from Reset Link Sent.
- **must be present** — eight callback and recovery strings, so the scan is provably looking at a
  bundle that contains this phase's work.

Still reported and still open: `module-gallery` and `hero-audit` remain bundled
(`docs/DEV_ROUTE_BACKLOG.md`), unchanged by this phase.

## Merged manifest and backup rules

Read from the release build's own output:

```
android:allowBackup="true"
android:fullBackupContent="@xml/secure_store_backup_rules"
android:dataExtractionRules="@xml/secure_store_data_extraction_rules"
android:launchMode="singleTask"
<data android:scheme="noorlifeapp"/>
```

`expo-secure-store`'s rules exclude `domain="sharedpref" path="SecureStore"` from
`full-backup-content`, from `cloud-backup` **and** from `device-transfer`, while including the rest of
`sharedpref` in all three. So the guarantee is the narrow, true one — ordinary preferences are backed
up and restored; the SecureStore file is not — and `allowBackup` is deliberately left `true` rather
than switched off to make the claim trivially satisfiable.

`android:launchMode="singleTask"` is what makes warm-start handling mandatory: a second link re-enters
the running task rather than starting a process, which is exactly what `12` and `06` exercise.

Asserted by `src/services/auth/__tests__/secure-store-backup.test.ts` against the generated manifest,
the library resources, and both merged release manifests.
