# Prayer alert audio — what an approved Azan would have to satisfy

**Status: no approved Azan asset exists. Prayer alerts ship with the platform's default notification
sound, and the UI calls it "Default notification sound".**

This document exists so that adding one later is a checklist rather than a judgement call, and so
that the reasons it has not been added are on the record.

---

## 1. Why the default sound ships today

Three things were ruled out at the start of this work, and none of them is a matter of preference:

- **Downloading an Azan at runtime.** The app would be distributing audio it has not verified, from a
  host it does not control, under a licence nobody has read.
- **Reusing the Qur'an provider's recitation audio.** A recitation is not an adhān. The licence
  NoorLife holds covers Qur'anic recitation for in-app listening; it says nothing about using a
  reciter's voice as an alarm tone, and the two are different uses of the same person's performance.
- **Bundling an unverified recording.** An adhān is an act of worship. Shipping one whose muezzin,
  provenance and licence are unknown is not a smaller version of shipping a licensed one.

So the sound is the platform's, the label says exactly that, and a test asserts the label never
contains the words "azan" or "adhan".

---

## 2. Requirements for an approved asset

| Requirement | Detail |
|---|---|
| **Provenance** | A named muezzin and a named recording. "From the internet" is not provenance. |
| **Licence** | Written permission covering *redistribution inside a mobile application as a notification tone*, worldwide, for the app's commercial distribution. Retained in `docs/THIRD_PARTY_LICENCES.md`. |
| **Format — Android** | `.wav` (PCM) or `.mp3`, placed in `android/app/src/main/res/raw/`. The config plugin does this; do not copy it by hand. |
| **Format — iOS** | `.wav`, `.aiff` or `.caf`, bundled in the app target. Linear PCM or IMA4. |
| **Duration — iOS** | **30 seconds maximum.** iOS silently falls back to the default sound for anything longer — it does not warn, and it does not truncate. A full adhān is 2–4 minutes, so a shipped asset is necessarily an excerpt or an opening phrase, and that is a content decision as much as a technical one. |
| **Duration — Android** | No hard cap, but the sound stops when the notification is dismissed. |
| **Filename** | Stable, lowercase, no spaces, e.g. `azan-makkah-30s.wav`. It becomes part of the Android channel id — see below. |
| **Loudness** | Normalised so it is not materially louder than the system default. A notification tone that is 10 dB hotter than everything else on the device gets the app muted. |

---

## 3. Registration

Add the file to the `expo-notifications` config plugin in `app.json`:

```json
["expo-notifications", {
  "enableBackgroundRemoteNotifications": false,
  "sounds": ["./assets/audio/azan-makkah-30s.wav"]
}]
```

Then **`npx expo prebuild --clean`** and a fresh native build. The plugin copies the file into both
native projects; nothing else should.

---

## 4. The Android channel must be re-versioned, and this is the part that gets missed

**An Android notification channel's sound is fixed when the channel is created and is immutable
afterwards.** Calling `setNotificationChannelAsync` again with a different sound succeeds, does
nothing, and reports no error — so a new Azan appears to work in development (where the app was
freshly installed) and silently does not work for every existing user.

The only way to change it is a new channel id, which the OS presents as a new category.

`prayer-alert-sound.ts` already encodes this: `prayerAlertChannelId()` derives the id from the sound,
so an approved asset yields `prayer-alerts-v2-<file>` instead of `prayer-alerts-v1-default`. Adding
the sound therefore requires:

1. Constructing the `bundled-azan` variant in `currentPrayerAlertSound()`.
2. Deleting the old channel after the new one is created, so users do not see two categories.
3. A full reschedule — existing pending alerts point at the old channel id.

A test asserts the two ids differ, so the versioning cannot be removed without a failure.

---

## 5. Verification required before an Azan may ship

Not one of these is satisfied by the code compiling:

- [ ] Licence on file and recorded in `docs/THIRD_PARTY_LICENCES.md`.
- [ ] Plays on a **physical** Android device, on the prayer-alert channel, from a cold start.
- [ ] Plays on a **physical** iOS device — the 30-second limit is silent, so this must be observed.
- [ ] Respects silent mode and Focus on both platforms.
- [ ] Old channel removed; users upgrading see one "Prayer alerts" category, not two.
- [ ] The reminder screen's sound label shows the recording's own name, not the word "Azan" alone.

**Stop and report before enabling a full Azan sound.** Until every box above is ticked, the platform
default is what ships.

---

## 6. Fajr is a separate content decision, not a special case of the same file

The adhān for Fajr differs from the other four: it carries the *tathwīb* — `aṣ-ṣalātu khayrun min
an-nawm` — which does not belong in the adhān for Dhuhr, Asr, Maghrib or Isha. So `sounds` is not one
asset repeated five times.

Three consequences, all of which have to be settled before a full adhān can ship:

- **Two licensed recordings, not one.** A Fajr adhān and a general adhān, ideally from the same
  muezzin, or the app will sound like two apps.
- **Two Android channels, not one.** A channel's sound is immutable, so a per-prayer sound means a
  per-sound channel — `prayer-alerts-v2-<general>` and `prayer-alerts-v2-<fajr>`.
  `prayerAlertChannelId()` already derives the id from the sound, so this is a new value rather than
  new logic; what it is not is invisible, because the user will see two more categories in their
  system notification settings. That is a product decision, not an implementation detail.
- **An excerpt cannot be assumed safe.** iOS caps a notification sound at **30 seconds** and silently
  falls back to the default beyond it. Whether a 30-second excerpt of a Fajr adhān contains the
  tathwīb depends on where it is cut — so the excerpt is a religious content decision, not an
  audio-engineering one.

**Nothing in this build plays any adhān.** `fullAdhanAvailability()` reports it unavailable, the
per-prayer sheet shows the row disabled with that reason, and **no preference for it is stored** — a
stored "play the adhān" that nothing could honour would be the same defect as the pre-reminder which
sat unread in storage for three releases.

Sunrise is excluded permanently rather than pending an asset. `canEverPlayFullAdhan()` returns false
for it, and its row says sunrise is a time marker rather than saying "not yet", because that will
still be true after a recording is licensed.

### What "Silent" already proved about per-notification sound

Recorded here because a future adhān will meet the same trap. `sound: false` in a notification's
content silences it on iOS and does **nothing** on Android 8 or later: `NotificationCompat.Builder
.setSound()` has been ignored since API 26, and the channel decides.

So the silent option is a second channel — `prayer-alerts-v1-silent`, created with an explicit
`sound: null`. Verified against `AndroidXNotificationsChannelManager.createSoundUriFromArguments` in
the installed package rather than assumed: an **absent** `sound` key yields
`Settings.System.DEFAULT_NOTIFICATION_URI`, and an explicit **null** yields `null`, which is silence.
One keystroke apart, and the wrong one makes every prayer alert silent.

## 7. Related follow-up not covered by this task

- **A direct route to Android's exact-alarm setting** needs `expo-intent-launcher`
  (`Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM`). Today `openSystemSettings()` opens the app's own
  settings page, from which the user can reach both notifications and alarms.
- **Reading the exact-alarm grant** needs `AlarmManager.canScheduleExactAlarms()`, which
  `expo-notifications` does not expose in SDK 57. The capability is reported as `unknown` and the UI
  says "cannot be confirmed on this device" rather than guessing.
