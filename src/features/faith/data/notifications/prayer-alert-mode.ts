import { Platform } from 'react-native';

import { canEverPlayFullAdhan } from './prayer-alert-preferences';
import type { PrayerKey } from '../prayer-times.repository';

/**
 * **How much of the call to prayer an alert plays** — issue #178.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── Four modes, and only one of them can happen today ──────────────────────
 * A user should be able to choose how much they hear. What they may *actually* choose is decided by
 * two independent facts, and collapsing them is how a screen ends up lying:
 *
 *   1. **Is there a licensed recording?** Owned by #42. There is not one, so both audio modes are
 *      unavailable, and no amount of code here changes that.
 *   2. **Could this platform honour the mode even if there were?** A separate question with a
 *      different answer per platform, established below from the platform vendors' own rules.
 *
 * Keeping them apart is what lets the sheet say *why* a mode is off. "Requires licensed adhān audio"
 * and "iOS cannot play a full adhān from a notification" are different sentences, and a user who is
 * told the second one learns something true that will still be true after #42 closes.
 *
 * ── What the platforms allow, and why Full is not simply "later" ───────────
 * **A notification sound is not a media player.**
 *
 *   • **iOS** caps a custom notification sound at **under 30 seconds** and silently substitutes the
 *     system default beyond it — no error and no truncation, so an over-long asset fails invisibly.
 *     And no app code runs when a local notification is delivered to a terminated app, so there is
 *     nothing that could start a longer sound. **Full adhān is therefore not supportable on iOS
 *     through a notification at all** — not "not yet". Short adhān is the honest iOS ceiling.
 *
 *   • **Android** fixes a channel's sound at creation: *"After you create a notification channel,
 *     you can't change the notification behaviors"*, and recreating one with new values *"performs
 *     no operation"*. Changing the sound needs a new channel id, which the user sees as a new
 *     category — `prayerAlertChannelId()` already derives the id from the sound for this reason.
 *     A full recording *could* be played by a `mediaPlayback` foreground service started from an
 *     exact alarm, which Android permits — but that costs a persistent notification the user cannot
 *     dismiss, plus `FOREGROUND_SERVICE_MEDIA_PLAYBACK` and the battery and policy consequences.
 *     That is a product decision and **it has not been taken**, so Android reports Full as
 *     requiring a mechanism this build does not have.
 *
 * Nothing here promises full playback from a terminated app, because nothing here implements a
 * mechanism that could deliver it.
 *
 * ── Off is not a member ────────────────────────────────────────────────────
 * "Off" is already `notify: false` in `PrayerAlertSettings`, and has been since prayer alerts
 * shipped. Adding a fourth enum member for it would give the same fact two spellings that could
 * disagree — the exact defect `finance-ledger` records about signed amounts. A mode describes what
 * an *enabled* alert sounds like.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/** The modes an enabled alert can be in. `Off` is `notify: false` and deliberately not here. */
export const PRAYER_ALERT_MODES = ['notification-only', 'short-adhan', 'full-adhan'] as const;

export type PrayerAlertMode = (typeof PRAYER_ALERT_MODES)[number];

/**
 * The mode every alert has until somebody chooses another, and the mode a stored value degrades to.
 *
 * It is exactly today's behaviour, which is what makes the upgrade invisible: a settings record
 * written before modes existed has no `mode` key, reads as this, and behaves as it always did.
 */
export const DEFAULT_PRAYER_ALERT_MODE: PrayerAlertMode = 'notification-only';

export function isPrayerAlertMode(value: unknown): value is PrayerAlertMode {
  return typeof value === 'string' && (PRAYER_ALERT_MODES as readonly string[]).includes(value);
}

/** The platforms this app ships on. Narrower than `Platform.OS`, because only these two are built. */
export type AlertPlatform = 'ios' | 'android';

/**
 * This device's platform, for the capability rules.
 *
 * `Platform.OS` also admits `web`, `windows` and `macos`, none of which this app builds. Anything
 * that is not iOS is treated as Android, which is the fail-closed direction: Android's answer for
 * full adhān is "not supported here", so an unexpected platform inherits a refusal rather than a
 * capability. Read through a function so a test can pass a platform explicitly instead.
 */
export function currentAlertPlatform(): AlertPlatform {
  return Platform.OS === 'ios' ? 'ios' : 'android';
}

/**
 * Why a mode cannot be offered, or `null` when it can.
 *
 * A closed set rather than a free string, because each member is a *different kind* of no and the
 * sheet renders them differently. `unlicensed` clears when #42 closes; `unsupported-platform` never
 * clears; `never-for-this-time` is sunrise and is a statement about the day, not about audio.
 */
export type ModeUnavailability =
  /** No licensed recording exists for this purpose. Clears when one is approved — issue #42. */
  | 'unlicensed'
  /** This platform cannot honour the mode through a notification. Does not clear with a licence. */
  | 'unsupported-platform'
  /** Sunrise. A clock reading is not a prayer, so it may never be announced with a call to one. */
  | 'never-for-this-time';

export type ModeAvailability = {
  readonly mode: PrayerAlertMode;
  readonly available: boolean;
  /** `null` exactly when `available` is true. */
  readonly unavailableBecause: ModeUnavailability | null;
  /** One short sentence for the sheet. Never promises a date. */
  readonly reason: string;
};

/**
 * Whether a platform could ever honour a mode, licence aside.
 *
 * Pure platform capability and nothing else — no asset, no preference, no time of day. Separated so
 * a licence arriving cannot accidentally make iOS claim a full adhān, which is the mistake a single
 * combined predicate would eventually make.
 */
export function platformSupportsMode(platform: AlertPlatform, mode: PrayerAlertMode): boolean {
  if (mode === 'notification-only' || mode === 'short-adhan') {
    return true;
  }
  /*
    Full adhān.

    iOS: never, through a notification. The sound is capped under 30 seconds and no code runs for a
    delivered notification while the app is terminated.

    Android: possible in principle via an exact alarm starting a `mediaPlayback` foreground service,
    and **not implemented** — so it is reported unsupported rather than offered. This returns false
    for both today; the branch is kept distinct because the two falses have different futures, and
    `fullAdhanPlatformNote` is what tells them apart.
  */
  return false;
}

/** What to tell a user about full adhān on their platform. Distinct sentences, distinct reasons. */
export function fullAdhanPlatformNote(platform: AlertPlatform): string {
  return platform === 'ios'
    ? 'iOS cannot play a full adhān from a notification. A notification sound is limited to under 30 seconds.'
    : 'NoorLife does not play a full adhān in the background on Android yet.';
}

/**
 * Whether a licensed recording exists for a mode.
 *
 * Injected rather than imported so the availability rules can be tested against a stated answer, and
 * so the one place that decides "is there an approved asset" stays
 * `prayer-alert-audio-manifest.ts`. Today every call returns false.
 */
export type LicensedAudioLookup = (mode: PrayerAlertMode, time: PrayerKey) => boolean;

/** The production lookup while no recording is licensed: nothing is, for any mode, at any time. */
export const NO_LICENSED_AUDIO: LicensedAudioLookup = () => false;

/**
 * Whether one mode can be offered for one time on one platform, and what to say when it cannot.
 *
 * The order of the checks is the order the reasons matter. Sunrise is refused first because it is
 * permanent and has nothing to do with audio; the platform is asked next because that answer also
 * outlives a licence; the licence is asked last, because it is the only one that will change.
 */
export function modeAvailability(input: {
  readonly mode: PrayerAlertMode;
  readonly time: PrayerKey;
  readonly platform: AlertPlatform;
  readonly hasLicensedAudio?: LicensedAudioLookup;
}): ModeAvailability {
  const { mode, time, platform } = input;
  const hasLicensedAudio = input.hasLicensedAudio ?? NO_LICENSED_AUDIO;

  if (mode === 'notification-only') {
    return {
      mode,
      available: true,
      unavailableBecause: null,
      reason: 'A notification at the prayer time.',
    };
  }

  if (!canEverPlayFullAdhan(time)) {
    return {
      mode,
      available: false,
      unavailableBecause: 'never-for-this-time',
      reason: 'Sunrise is a time marker, not a prayer, so it never plays an adhān.',
    };
  }

  if (!platformSupportsMode(platform, mode)) {
    return {
      mode,
      available: false,
      unavailableBecause: 'unsupported-platform',
      reason: fullAdhanPlatformNote(platform),
    };
  }

  if (!hasLicensedAudio(mode, time)) {
    return {
      mode,
      available: false,
      unavailableBecause: 'unlicensed',
      reason: 'Not available yet. NoorLife has no licensed adhān recording to play.',
    };
  }

  return {
    mode,
    available: true,
    unavailableBecause: null,
    reason:
      mode === 'short-adhan' ? 'A short adhān at the prayer time.' : 'The full adhān, in full.',
  };
}

/** Whether a mode may be *stored* for a time. The gate every write goes through. */
export function isModeSelectable(input: {
  readonly mode: PrayerAlertMode;
  readonly time: PrayerKey;
  readonly platform: AlertPlatform;
  readonly hasLicensedAudio?: LicensedAudioLookup;
}): boolean {
  return modeAvailability(input).available;
}

/**
 * The mode an alert will actually run in, given what is available.
 *
 * ── Why a stored mode is re-checked on every read rather than trusted ──────
 * Because availability can fall as well as rise. A build that once had a licence, a user restoring a
 * backup onto a platform that cannot honour the mode, or a downgrade, all produce a stored
 * `full-adhan` that nothing can play. Playing the default chime while the screen says "Full adhān"
 * is precisely the disguise this feature must not perform, so the stored value is treated as a
 * *preference* and the effective mode is derived.
 *
 * It degrades rather than switching the alert off: the user asked to be told about this prayer, and
 * the honest response to "the sound is unavailable" is a notification, not silence.
 */
export function effectiveMode(input: {
  readonly stored: PrayerAlertMode;
  readonly time: PrayerKey;
  readonly platform: AlertPlatform;
  readonly hasLicensedAudio?: LicensedAudioLookup;
}): PrayerAlertMode {
  return isModeSelectable({ ...input, mode: input.stored })
    ? input.stored
    : DEFAULT_PRAYER_ALERT_MODE;
}

/** What the sheet calls each mode. One place, so a label cannot drift from what it plays. */
export function prayerAlertModeLabel(mode: PrayerAlertMode): string {
  switch (mode) {
    case 'notification-only':
      return 'Notification only';
    case 'short-adhan':
      return 'Short adhān';
    case 'full-adhan':
      return 'Full adhān';
  }
}

/**
 * The mode to persist, given what the user asked for and what this build can honour.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── Why the write decision is a function rather than an `if` at the call site ──
 * Because an `if` at the call site is deletable without trace. This was found by mutation: removing
 * the guard from `setMode` left the entire Faith suite — 5,708 tests — green, because the sheet
 * renders an unavailable mode as a disabled control and a disabled `Pressable` fires nothing. Every
 * UI test passed whether or not the write path also refused.
 *
 * The disabled pill stops a tap. This stops everything else: a deep link, a future screen, a
 * replayed action, a restored preference. A stored `full-adhan` would put the app one render from a
 * screen that says an adhān is playing while a chime is what plays, which is the one outcome #178
 * exists to prevent.
 *
 * ── Refusing keeps the current value rather than resetting ─────────────────
 * A refused request is not a request to change to the default; it is a request that cannot be
 * honoured. Returning `current` means a user who already had a working preference does not lose it
 * by tapping something unavailable.
 * ═══════════════════════════════════════════════════════════════════════════
 */
export function nextStoredMode(input: {
  readonly current: PrayerAlertMode;
  readonly requested: PrayerAlertMode;
  readonly time: PrayerKey;
  readonly platform: AlertPlatform;
  readonly hasLicensedAudio?: LicensedAudioLookup;
}): PrayerAlertMode {
  return isModeSelectable({
    mode: input.requested,
    time: input.time,
    platform: input.platform,
    hasLicensedAudio: input.hasLicensedAudio,
  })
    ? input.requested
    : input.current;
}
