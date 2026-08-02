# Phase 6C-3A — Privacy & Security

Device verification for the Privacy & Security screen and its two account-security children.

## Target

| | |
|---|---|
| Build | `android/app/build/outputs/apk/release/app-release.apk`, **release**, `assembleRelease` |
| Device | Android emulator, `sdk_gphone64_x86_64`, Android 17 (API 37), serial `emulator-5554` |
| Viewport | 1080 × 2400 px |
| Density | 420 dpi → scale factor 2.625 → **411.4 × 914.3 dp** |
| Font scale | `1.0` for shots 00–15, **`1.5`** for shots 16–18 |
| Account | The authenticated **Free** test account — `test@gmail.com`, display name `test` |

The physical Honor phone was **not attached** during this pass — `adb devices` listed the emulator
only — so every capture below is the emulator. The phone pass is **blocked, not done**, and is not
claimed here. See the standing rule in `docs/` and the project memory: a visible change is verified
on both targets, and this one has been verified on one.

## Commands

```bash
# build
cd android && ./gradlew assembleRelease        # JAVA_HOME = Android Studio's jbr
                                               # ANDROID_HOME = %LOCALAPPDATA%\Android\Sdk

# install
adb install -r android/app/build/outputs/apk/release/app-release.apk

# metrics
adb shell wm size                              # 1080x2400
adb shell wm density                           # 420
adb shell settings get system font_scale       # 1.0
adb shell getprop ro.build.version.release     # 17
adb shell getprop ro.build.version.sdk         # 37

# large font
adb shell settings put system font_scale 1.5
adb shell am force-stop com.anonymous.NoorLifeApp   # fontScale is not in configChanges, so the
                                                    # activity has to be recreated
# …and back afterwards
adb shell settings put system font_scale 1.0

# the fixture states only — a debug build, because the harness is guarded by __DEV__
npx expo run:android --port 8090               # 8090, not Syed's own 8084

# capture — pull, never shell redirection: PowerShell rewrites a redirected binary stream and
# corrupts the PNG with a BOM
adb shell screencap -p /sdcard/_shot.png && adb pull /sdcard/_shot.png <file>.png
```

## Captures

### Release build, real account, font scale 1.0

| File | What it shows |
|---|---|
| `00-profile-home-privacy-security-active.png` | Profile Home. The Privacy & Security row navigates — no "Coming later" note remains on any of the five rows |
| `01-privacy-security-overview.png` | The screen at rest: Account Security, and the head of Privacy Controls |
| `02-account-security-email-provider.png` | The real email/password session — provider, address, **Verified**, last sign-in, and both change actions |
| `04-change-password-form.png` | The real supported form. Two masked fields, a Show control on each, no "current password" field |
| `05-change-password-validation.png` | Weak password and mismatched confirmation, both rejected **before** any service call |
| `07-change-email-form.png` | Current address read-only, the confirmation explanation, and the email-delivery limitation stated plainly |
| `09-privacy-controls.png` | The audited categories, the account/device split, the encryption wording and the diagnostics exclusion |
| `10-ai-data-permissions-free.png` | Free scope: Noor AI and Faith available, the six paid assistants closed, and Noor AI data access as "Asks first" / "Requires Premium" |
| `12-sessions.png` | This device only, both sign-out actions, the standing global warning, and the Delete Account row |
| `13-global-sign-out-confirmation.png` | The confirmation, carrying the verbatim warning and stating that nothing is deleted |
| `15-delete-account-unavailable.png` | The informational blocking sheet. Close and Contact Support, and nothing destructive |
| `16-large-font-overview.png` | Font scale 1.5 — Account Security and Privacy Controls, nothing clipped, nothing truncated |
| `16b-large-font-overview-scrolled.png` | Font scale 1.5 — the page expands and scrolls rather than truncating |
| `17-large-font-change-password.png` | Font scale 1.5 — the password form |
| `18-large-font-change-email.png` | Font scale 1.5 — the email form |

### Debug build, injected fixtures, font scale 1.0 — **historical, superseded in 6C-3B**

> **These five images are fixtures, not recordings of a real account.** Every value visible in
> them — the address, the provider, the pending confirmation, the failure — was supplied to the
> screen through `AccountSecurityPort` by a test harness. None of it came from a Supabase project,
> and no account was read or changed to produce them. They are kept as historical evidence of what
> the screens rendered on 2 August 2026, and nothing in them should be read as account data.

**The harness they were captured from no longer exists.** 6C-3B deleted the route
(`src/app/profile/privacy-security/fixtures.tsx`) and the screen
(`src/features/profile/screens/privacy-security-fixtures-screen.tsx`).

The reason is the paragraph this section used to carry, which was correct about the problem and
wrong about the remedy. The route guarded on `__DEV__`, so the harness could not *render* in a
release build — but the route's `import` was unconditional, so Metro compiled it in regardless, and
the harness, its five state names and its fixture address were all present in
`index.android.bundle`. A guard against rendering is not a guard against inclusion, and calling it
one put a fake account in a shipped artifact.

What replaced it:

- the five states now live as data in `src/test-support/account-security-fixtures.ts`, outside
  `src/app` and `src/features`, where Expo Router cannot route to them;
- `privacy-security-source-scan.test.ts` asserts that no file under `src/app` or `src/features`
  imports that directory, so the fix cannot be silently undone;
- `account-security-fixture-states.test.tsx` renders each state and asserts it, which is strictly
  more than the harness gave — a harness let somebody look, a test checks on every run;
- the fixture address is an `example.com` one, which RFC 2606 reserves and which cannot receive
  mail;
- `module-gallery` and `hero-audit` have the same inclusion problem and were out of scope for
  6C-3B. They are recorded in `docs/DEV_ROUTE_BACKLOG.md`.

The 6C-3B bundle scan, run against the freshly built release bundle:

```bash
grep -c "privacy-security-fixture"    index.android.bundle   # 0
grep -c "fixture.user@example.com"    index.android.bundle   # 0
grep -c "PrivacySecurityFixtures"     index.android.bundle   # 0
grep -c "service_role"                index.android.bundle   # 0
grep -c "Module Gallery"              index.android.bundle   # 1+  (open, see the backlog)
```

| File | What it shows | Fixture |
|---|---|---|
| `03-social-provider-fixture.png` | A Google identity: the provider-managed explanation, and **no** password or email form | yes |
| `06-reauthentication-required-fixture.png` | Supabase answering `reauthentication_needed`; the emailed-code step appears only then | yes |
| `08-email-pending-confirmation-fixture.png` | An outstanding confirmation. The signed-in address is unchanged | yes |
| `11-ai-data-permissions-paid-fixture.png` | Premium Single with no grants: every module still reads "Asks first" — paying is not permission | yes |
| `14-global-sign-out-failure-fixture.png` | The remote half failed. The screen claims this device only and does not say the others ended | yes |

Two things visible in these five and in none of the others, both artefacts of the debug build:
the grey **dev-menu FAB** in the top-right corner, and the **← Fixtures** bar pinned at the bottom,
which belongs to the harness and not to the screen. Neither exists in the release APK.

Restoring the emulator afterwards required `adb uninstall` — a debug and a release APK are signed
with different keys, so `install -r` cannot replace one with the other. That wipes app storage, so
**the emulator's test account is signed out and onboarding is unset** after this pass. Signing in
again restores it; nothing on the server changed.

## What was not done to obtain these

- **No password was changed.** Shot 05 is validation, which rejects before any call; shot 04 is an
  empty form; shot 06 is a rejected first attempt from the fixture port.
- **No email was changed.** Shot 07 is an empty form; shot 08 is a fixture reporting a pending
  state that no request created.
- **No account was deleted, and no deletion API was called.** Shot 15 opens a sheet and stops.
- **No session was ended.** Shot 13 is the confirmation, cancelled; shot 14 is a fixture outcome.
- **No credential, token, user id or project reference appears in any image.** The rendered summary
  has six fields and none of them is any of those — asserted by
  `privacy-security-screen.test.tsx`.

## Two defects the device pass found, and their corrections

1. **"Verified  Verified".** The verification row rendered the status word *and* a pill repeating
   it. Colour was never carrying the meaning, so the pill was removed and the word stayed. The
   Sessions status row had the same duplication and took the same correction.
2. **"On this de…" clipped.** The device-scope pill overflowed the Diagnostic information row — a
   two-line label, a four-word status and a three-word pill do not fit one 361 dp line, and a
   truncated privacy statement is worse than a plain one. Scope now leads the supporting sentence
   instead.

Both were fixed and the release APK rebuilt before the captures above were taken.
