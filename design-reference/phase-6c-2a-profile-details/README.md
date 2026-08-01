# Phase 6C-2A — Personal Information and Family & Membership

Device verification for the two Profile detail screens built in this phase.

## Target

| | |
|---|---|
| Build | `android/app/build/outputs/apk/release/app-release.apk`, **release**, `assembleRelease` |
| Architectures | `arm64-v8a,x86_64` (one APK for emulator and phone) |
| Device | Android emulator, `sdk_gphone64_x86_64`, Android 17, serial `emulator-5554` |
| Viewport | 1080 × 2400 px |
| Density | 420 dpi → scale factor 2.625 → **411.4 × 914.3 dp** |
| Font scale | `1.0` for shots 01–11 and 15–17, **`1.5`** for shots 12–14 |
| Account | The authenticated **Free** test account — `test@gmail.com`, display name `test` |

The physical Honor phone was **not attached** during this pass (`adb devices` listed the
emulator only), so every capture below is the emulator. The phone still needs its own run
before this counts as fully verified on both targets.

## Commands

```bash
# build
cd android && ./gradlew.bat app:assembleRelease -PreactNativeArchitectures=arm64-v8a,x86_64

# install
adb -s emulator-5554 install -r android/app/build/outputs/apk/release/app-release.apk

# metrics
adb -s emulator-5554 shell wm size
adb -s emulator-5554 shell wm density
adb -s emulator-5554 shell settings get system font_scale

# large font
adb -s emulator-5554 shell settings put system font_scale 1.5
adb -s emulator-5554 shell am force-stop com.anonymous.NoorLifeApp   # fontScale is not in
                                                                    # configChanges, so the
                                                                    # activity is recreated
# capture — binary-safe redirection; a PowerShell `>` corrupts the PNG with a BOM
adb -s emulator-5554 exec-out screencap -p > <file>.png
```

## Captures

| File | What it shows |
|---|---|
| `01-personal-information-initial.png` | Real name, real email read-only, real provider, Save disabled, honest photo note |
| `02-edited-valid-name.png` | Valid edit, Save enabled, **fully visible above the open keyboard** |
| `03-validation-error-keyboard-open.png` | Empty name refused; error inside the field's reserved box, rows below unmoved |
| `04-unsaved-changes-dialog-android-back.png` | Discard confirmation, raised by the **Android hardware Back button** |
| `05-keep-editing-retains-edit.png` | Keep Editing returns to the form with the edit intact |
| `06-profile-home-before-edit.png` | Profile Home before the save — `test` |
| `07-save-success.png` | "Name updated" announced; Save disabled again |
| `08-profile-home-updated-name.png` | Profile Home showing `Yusuf Rahman` **without an app restart** |
| `09-main-home-updated-greeting.png` | Main Home greeting showing `Yusuf` **without an app restart** |
| `10-family-membership-free.png` | Free: plan, "Faith is always free.", both plan summaries, verbatim six-account sentence |
| `11-restore-purchases-result.png` | Restore ran the real service: "No previous purchases found" — plan unchanged |
| `12-personal-information-large-font.png` | Font scale 1.5 — everything expands, nothing clipped |
| `13-family-membership-large-font.png` | Font scale 1.5 — everything expands, nothing clipped |
| `14-profile-home-large-font.png` | Font scale 1.5 — compact Profile Home still fits |
| `15-family-membership-premium-single-fixture.png` | **Fixture** — Premium Single: real period and renewal date, Family upgrade card |
| `16-family-membership-premium-family-fixture.png` | **Fixture** — Premium Family: real organizer, real `1 of 6 accounts in use`, missing-backend sentence |
| `17-manage-family-coming-later.png` | Manage Family explains itself instead of opening a development fixture |

### The two paid captures are fixtures

No store products exist, so a paid entitlement cannot be acquired — it can only be
supplied. Shots 15–17 were produced by running the **development mock purchase adapter**
through the existing in-app purchase flow, which grants an in-memory entitlement and
takes no money. Nothing was written to `profiles`, and force-stopping the app returns the
account to its real Free state, which is how it was left.

The `Development mock — purchases are simulated` banner visible on the *subscription*
screens during that flow is the existing `SubscriptionScreenScaffold` badge and is not
`__DEV__`-gated — pre-existing behaviour, untouched by this phase. The badge on the new
Family & Membership screen **is** gated, which is why shots 10 and 15–17 do not show it.

## Two defects this pass found and fixed

1. **Save behind the keyboard.** Pinned in a footer beside the keyboard-avoiding view, then
   still overlapping the keys after the footer's padding was corrected: under edge-to-edge the
   avoiding view does not shrink by quite the full keyboard height. The action moved into the
   scrolling content, which is how the approved Sign In screen already works.
2. **Header title under the Back control.** At font scale 1.5, "Family & Membership" ran
   beneath the Back arrow. The title layer now stops at each control disc, and its cap moved
   from 1.3 to 1.2 so the longest title still renders on one line rather than being abbreviated.

Both are covered by tests, so neither can come back silently.
