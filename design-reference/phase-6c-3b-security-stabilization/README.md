# Phase 6C-3B — Security stabilization

Device verification for the five corrections made after the 6C-3A device pass: the Change Email
submit gate, the two absolute privacy claims, the AI-history claim, the global sign-out wording, and
the removal of the fixture harness from the release bundle.

## Target

| | |
|---|---|
| Build | `android/app/build/outputs/apk/release/app-release.apk`, **release**, `app:assembleRelease -PreactNativeArchitectures=x86_64` |
| Device | Android emulator, `sdk_gphone64_x86_64`, Android 17 (API 37), serial `emulator-5554` |
| Viewport | 1080 × 2400 px |
| Density | 420 dpi → scale factor 2.625 → **411.4 × 914.3 dp** |
| Font scale | `1.0` |
| Account | The authenticated **Free** test account — `test@gmail.com`, display name `test` |

**Every capture is from the release APK.** There is no debug-build section this time, because there
is no longer a fixture harness to open — see "Fixtures" below.

The physical Honor phone was **not attached** during this pass; `adb devices` listed the emulator
only. The phone pass is **blocked, not done**, and is not claimed here. The standing rule is that a
visible change is verified on both targets, and this one has been verified on one.

## Nothing was changed on the test account

The brief forbids modifying the test account's email, password or sessions, and none was:

- Change Email was driven to the enabled state with `New.Address@example.com` and **Send
  Confirmation was never pressed** (`04`). The field was then cleared before leaving the screen.
- The global sign-out confirmation was opened for `07` and **cancelled**. `Sign Out Everywhere` was
  never pressed.
- No password was submitted. `08` shows the form at rest.

## Commands

```bash
# build — both toolchain vars are required and neither is on PATH
export JAVA_HOME="C:\Program Files\Android\Android Studio\jbr"
export ANDROID_HOME="C:\Users\syedk\AppData\Local\Android\Sdk"
cd android && ./gradlew app:assembleRelease -PreactNativeArchitectures=x86_64

# install
adb install -r android/app/build/outputs/apk/release/app-release.apk

# release-bundle scan (checks both Hermes string encodings — see below)
node scripts/scan-release-bundle.mjs

# capture — pull, never shell redirection: PowerShell rewrites a redirected binary stream and
# corrupts the PNG with a BOM. Under Git Bash, set MSYS_NO_PATHCONV=1 or `/sdcard/...` is rewritten
# into a Windows path and screencap prints its usage instead of taking a shot.
MSYS_NO_PATHCONV=1 adb shell screencap -p /sdcard/_s.png
MSYS_NO_PATHCONV=1 adb pull /sdcard/_s.png <file>.png
```

## Captures

| File | What it shows |
|---|---|
| `00-launch.png` | Main Home on the release build, unchanged: hero, eight tiles with six locked, Today at a Glance, both summary cards, the Noor AI insight, three locked quick actions, locked Insights |
| `01-change-email-empty-disabled.png` | **The defect, fixed.** Send Confirmation is disabled over an empty field — grey fill, dark label, no inline error over a field the user has not touched |
| `02-change-email-invalid.png` | `not-an-address`, blurred. Red field border, "Enter a valid email address.", control still disabled |
| `03-change-email-same-address.png` | `TEST@Gmail.COM` against a current address of `test@gmail.com`. "That is already your email address." — the comparison is case-insensitive, and the **current address is still rendered as the session reports it**, not rewritten to the typed casing |
| `04-change-email-valid-enabled-not-submitted.png` | `New.Address@example.com`. The control is enabled and blue, no error. **Not submitted** |
| `05-privacy-local-data-wording.png` | All three corrected privacy sentences in one view: the Local application data row, "Held on your account", and "Stored on this device" |
| `06-ai-history-and-session-warning.png` | The revised AI-history claim, and the standing global sign-out warning above Account Management |
| `07-global-sign-out-confirmation.png` | The confirmation dialog carrying the revised body. **Cancelled** |
| `08-change-password-unchanged.png` | Change Password, unaffected by the shared `PrimaryButton` change — Update Password still renders enabled and blue, as it did in 6C-3A |

### What `01`–`04` prove together

The 6C-3A device pass found Send Confirmation enabled over an empty field. The four shots are the
four states in order: refused with nothing typed, refused with nonsense, refused with the address
the account already has, and enabled only when the address is both valid and different. The fill
changes and the geometry does not — the control is 48 dp in every shot.

The disabled label is `#14265F` on the `#C8CED8` disabled fill, which measures **9.0:1**. It was
white before this phase, which measures 1.9:1 — legible in a mockup and not on a phone.

### What `05` and `06` prove

Three sentences were absolute and are now qualified:

| Was | Is |
|---|---|
| "This is the complete list." | "In the current version of NoorLife, the following account information is stored…" |
| "Removing NoorLife removes everything under these." | "Most device-local NoorLife data is removed when the app is uninstalled. Your operating system or backup service may retain or restore some settings." |
| "No saved AI conversation history is currently stored by NoorLife." | "In the current version of NoorLife, no AI conversation history is saved on this device or on your account." |

A **fourth** was found by this device pass rather than by the code audit. The Local application data
row in `privacy-capabilities.ts` still read "Removing NoorLife removes them." — the same promise, two
paragraphs above the corrected one, in a file the copy audit had not scanned. `05` is the recapture
after that fix, and `privacy-capabilities.test.ts` now scans every capability `detail` as well as
the copy object, so a third home for the claim cannot hide.

The uninstall wording is qualified because the platforms demonstrably do not guarantee deletion:
`AndroidManifest.xml` declares `android:allowBackup="true"`, and the rules `expo-secure-store`
supplies include the whole `sharedpref` domain in both cloud backup and device transfer; on iOS the
same library defaults to `kSecAttrAccessibleWhenUnlocked`, which is not a `ThisDeviceOnly` class.

What is **not** softened is the diagnostics exclusion. "A support message never includes your Faith
activity, Quran reading, health, finance, family or goal records, AI conversations, password or
sign-in tokens" is a claim about this application's own code, which it can keep, and a test asserts
it still reads "never includes".

### What `06` and `07` prove

The global sign-out warning was "This will sign you out on this and other devices." That describes
an instant effect the protocol does not provide. Audited against `@supabase/auth-js` 2.111.0:
`signOut({ scope: 'global' })` revokes **refresh** tokens; access tokens already issued are
self-contained JWTs and stay valid until they expire, which the SDK states in its own doc comment.

The button keeps its label. The warning now reads:

> This signs out this device and prevents other devices from renewing their sessions. Another device
> may remain active briefly.

## Fixtures

**There is no fixture harness in this phase, and that is the point.**

6C-3A shipped one as an Expo Router route guarded by `if (!__DEV__) return <Redirect …>`, and
reported that the guard kept it out of the release bundle. It did not. The guard prevents
*rendering*; the route file's `import` is unconditional, so Metro compiled the screen, its five
state names and its fixture address into `index.android.bundle`.

6C-3B deleted the route and the screen. The states moved to
`src/test-support/account-security-fixtures.ts` — outside `src/app` and `src/features`, where Expo
Router does not scan and production code may not import — and are now asserted by
`account-security-fixture-states.test.tsx` rather than looked at through a harness.

The five 6C-3A fixture screenshots are kept as historical evidence and are labelled as fixtures in
that phase's README. Nothing in them is account data.

`module-gallery` and `hero-audit` are `__DEV__`-guarded routes from earlier phases with the same
inclusion problem. They were out of scope for this session and are recorded in
`docs/DEV_ROUTE_BACKLOG.md`.

### Release-bundle scan

`index.android.bundle` is **Hermes bytecode**, and Hermes stores pure-ASCII strings one byte per
character and anything containing a non-ASCII character — an em dash, a curly apostrophe — as
UTF-16. A plain `grep -F` therefore returns nothing for a sentence that is demonstrably on screen,
and a single-encoding scan reports a clean bundle it never examined. `scripts/scan-release-bundle.mjs`
checks both. Output against the build these captures came from:

```
android/app/build/generated/assets/react/release/index.android.bundle — 4168376 bytes (Hermes bytecode)

── must be absent: fixture harness identifiers
   absent    privacy-security-fixture
   absent    PrivacySecurityFixtures
   absent    Privacy & Security fixtures
   absent    /profile/privacy-security/fixtures
   absent    inertAccountSecurityPort
   absent    test-support

── must be absent: fixture account values
   absent    fixture.user@example.com
   absent    pending.address@example.com
   absent    Development only. Every fixture is local

── must be absent: credentials and secrets
   absent    service_role
   absent    SERVICE_ROLE
   absent    SUPABASE_SECRET
   absent    serviceRoleKey

── must be absent: absolute claims corrected in 6C-3B
   absent    This is the complete list
   absent    Removing NoorLife removes them
   absent    Removing NoorLife removes everything under these
   absent    This will sign you out on this and other devices.
   absent    No saved AI conversation history is currently stored by NoorLife.

── must be present: corrected copy
   present (utf8 2, utf16 0)    In the current version of NoorLife
   present (utf8 1, utf16 0)    Most device-local NoorLife data is removed when the app is uninstalled.
   present (utf8 0, utf16 1)    Uninstalling removes most of it; your operating system or backup service…
   present (utf8 1, utf16 0)    This signs out this device and prevents other devices from renewing…
   present (utf8 1, utf16 0)    Unavailable until you enter a valid email address that is different…

── reported only: development routes still bundled (docs/DEV_ROUTE_BACKLOG.md)
     1 occurrence(s)    Module Gallery
     3 occurrence(s)    hero-audit
     4 occurrence(s)    module-gallery

PASSED — no fixture identifier, credential or withdrawn claim in the release bundle.
```

The three `module-gallery` / `hero-audit` hits are load-bearing evidence, not noise: they show the
scan can find this class of string, so the zeros above are an absence rather than a broken grep.

## Not verified here

- **The physical Honor phone.** Not attached. Blocked, not done.
- **Authentication deep links** and **account deletion** — both explicitly out of scope for this
  session, and neither is implemented. `docs/ACCOUNT_DELETION_ARCHITECTURE.md` still records what
  deletion would require.
- **Email delivery.** Production SMTP is not configured, so no confirmation was requested and none
  could have arrived. The screen says so.
