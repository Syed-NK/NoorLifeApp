# Phase 6C-2B — Preferences and Help & Support

Device verification for the two Profile detail screens built in this phase.

## Target

| | |
|---|---|
| Build | `android/app/build/outputs/apk/release/app-release.apk`, **release**, `assembleRelease` |
| Device | Android emulator, `sdk_gphone64_x86_64`, Android 17 (API 37), serial `emulator-5554` |
| Viewport | 1080 × 2400 px |
| Density | 420 dpi → scale factor 2.625 → **411.4 × 914.3 dp** |
| Font scale | `1.0` for shots 01–12, **`1.5`** for shots 13–14 |
| Account | The authenticated **Free** test account — `test@gmail.com`, display name `test` |

The physical Honor phone was **not attached** during this pass (`adb devices` listed the emulator
only), so every capture below is the emulator. The phone still needs its own run before this counts
as verified on both targets. It is not claimed here.

## Commands

```bash
# build
cd android && ./gradlew assembleRelease        # JAVA_HOME = Android Studio's jbr
                                               # ANDROID_HOME = %LOCALAPPDATA%\Android\Sdk

# install
adb install -r android/app/build/outputs/apk/release/app-release.apk

# metrics
adb shell wm size
adb shell wm density
adb shell settings get system font_scale
adb shell getprop ro.build.version.release     # 17 — the release, which the About card shows
adb shell getprop ro.build.version.sdk         # 37 — the API level, which Platform.Version returns

# large font
adb shell settings put system font_scale 1.5
adb shell am force-stop com.anonymous.NoorLifeApp   # fontScale is not in configChanges, so the
                                                    # activity has to be recreated

# system Reduce Motion — Android's "Remove animations", which RN reports as reduceMotionEnabled
adb shell settings put global transition_animation_scale 0.0
adb shell settings put global window_animation_scale 0.0
adb shell settings put global animator_duration_scale 0.0

# capture — pull, never shell redirection: PowerShell rewrites a redirected binary stream and
# corrupts the PNG with a BOM
adb shell screencap -p /sdcard/_shot.png && adb pull /sdcard/_shot.png <file>.png
```

## Captures

| File | What it shows |
|---|---|
| `01-preferences-overview.png` | All four areas: Notifications, Language, Appearance, Accessibility |
| `02-preferences-accessibility.png` | Scrolled — Reduce Motion, Text size, Screen readers, nothing clipped |
| `03-reduce-motion-on.png` | The one real preference, switched on and persisted |
| `04-reduce-motion-system-override.png` | System "Remove animations" on: the switch is **on and locked**, and the reason is stated. Applied **live**, with no restart |
| `05-open-device-settings.png` | "Open Device Settings" reaching Android's real App info screen |
| `06-back-to-profile.png` | Back returns to compact Profile Home, geometry unchanged |
| `07-help-support-overview.png` | Help Center, Contact Support with the configured address, no Help control in the header |
| `08-help-faq-expanded.png` | "What is included in the Free plan?" open — Faith is always free |
| `09-help-email-support.png` | **The no-mail-app fallback**, showing the address instead of a dead button |
| `10-help-legal-and-about.png` | Copy Email Address, both legal links, real version/build/platform, copyright |
| `11-help-diagnostics-copied.png` | "Diagnostic information copied" |
| `12-help-privacy-policy-link.png` | The **real published** Privacy Policy in the in-app browser |
| `13-preferences-large-font.png` | Font scale 1.5 — everything expands and wraps, nothing clipped |
| `14-help-large-font.png` | Font scale 1.5 — everything expands and wraps, nothing clipped |

## Which states are fixtures, and which are real

Everything above is the real release build against the real account. Nothing on these screens is
mocked at runtime.

Three notification states in the brief's capture list are **not reachable in this build**, and are
not faked here:

| State | Why it cannot be captured |
|---|---|
| Not requested | This build has no notification stack, so there is no permission to be in that state |
| Denied | Same — and reading the undeclared Android runtime permission would report a *fabricated* denial rather than a real one, which is why the service does not read it |
| Open Settings (notifications) | Only offered for a genuine denial, so it does not appear |

The screen therefore reports **Unavailable**, which is the true state (`01`, `02`). The behaviour
those three states would have — never prompting on mount, prompting exactly once per press,
offering settings after a refusal, and re-reading on return to the foreground — is driven by an
injected fake port in `src/features/profile/__tests__/preferences-screen.test.tsx`. When reminders
are connected, a real adapter replaces the fake and those expectations do not change.

`05` is the closest real equivalent: the Accessibility section's "Open Device Settings" uses the
same `Linking.openSettings` call the notification path would, and it genuinely opens Android's App
info screen for NoorLife.

## Release-bundle checks

Run against `assets/index.android.bundle` extracted from the release APK:

| String | Expected | Result |
|---|---|---|
| `Is this a development build` | absent | absent |
| `development mock adapter` | absent | absent |
| `no payment is taken` | absent | absent |
| `hello@nkdigitalworks.com` | present | present |
| `nkdigitalworks.com/privacy` | present | present |
| `nkdigitalworks.com/terms` | present | present |
| `when NoorLife reminders are connected` | present | present |

The development-only FAQ answer is guarded by `__DEV__` inside `helpFaq`, which Metro inlines to
`false` and drops — so the wording is not merely unrendered in production, it is not compiled in.

## Two defects the device pass caught

1. **Text size showed its own button label as its value** — the row read "Text size · Open Device
   Settings" above a button reading "Open Device Settings". `ProfileStatusRow.value` is now
   optional and the row carries its sentence alone.
2. **About showed "Android 37"** — `Platform.Version` returns the API level, which is the wrong
   number under a label reading OS version. Now read from `Device.osVersion` (`expo-device`, which
   was already a dependency), giving "Android 17". Only `osVersion` is read from that module; the
   model, brand and manufacturer are not on the diagnostics allow-list.

## No secrets in these captures

No token, key, password or Supabase identifier appears in any shot. The visible account details are
the test account's own name and address, which the signed-in user sees on their own device. No mail
draft was composed on screen — the emulator has no mail application, which is what shot `09`
records.
