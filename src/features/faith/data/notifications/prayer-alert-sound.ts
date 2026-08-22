/**
 * Which sound a prayer alert plays — as a seam, because today the answer is "the platform's".
 *
 * ── Why this file exists at all, given it currently returns `null` ──────────
 * Because the alternative is a `null` literal at three call sites and a comment hoping somebody
 * reads it. An approved Azan recording is a *content* decision with a licence attached, and when one
 * arrives it has to reach the Android channel, the iOS notification content and the reminder
 * screen's label together — or the screen will say "Azan" while the channel still plays a chime.
 *
 * One typed provider means adding it is a change here plus an asset, and the screen's label is
 * derived from the same value rather than written twice.
 *
 * ── What must never happen here ─────────────────────────────────────────────
 * No Azan is downloaded at runtime. No recitation audio from the Qur'an provider is reused as an
 * Azan — a recitation is not an adhān, and the licence NoorLife holds for one does not cover the
 * other. No unverified religious audio is bundled. A sound ships when it is licensed, approved and
 * verified on both platforms, and not before. `docs/PRAYER_ALERT_AUDIO_REQUIREMENTS.md` records
 * exactly what that means.
 */

export type PrayerAlertSound =
  /**
   * The platform's own notification sound.
   *
   * The honest default, and the only shipping value today. The UI calls it "Default notification
   * sound" and must never call it an Azan.
   */
  | { readonly kind: 'platform-default' }
  /**
   * An approved, licensed recording bundled with the app.
   *
   * Unreachable in this build: no such asset exists, and nothing constructs this variant. It is
   * declared so the type — and the screen's label, and the channel id below — already account for
   * it, rather than being retrofitted around an asset that has already been dropped in.
   */
  | {
      readonly kind: 'bundled-azan';
      /** The filename as registered with the native config plugin, e.g. `azan-makkah.wav`. */
      readonly file: string;
      /** Shown in the UI. The recording's own name, never the generic word "Azan" alone. */
      readonly label: string;
    };

/**
 * The sound in force.
 *
 * A function rather than a constant so that a future build can resolve it from a preference without
 * every call site changing shape.
 */
export function currentPrayerAlertSound(): PrayerAlertSound {
  return { kind: 'platform-default' };
}

/**
 * What the UI is allowed to call the current sound.
 *
 * Derived rather than written at the call site: this is the one string that must never drift into
 * calling a system chime an Azan, and a test asserts exactly that.
 */
export function prayerAlertSoundLabel(sound: PrayerAlertSound = currentPrayerAlertSound()): string {
  return sound.kind === 'platform-default' ? 'Default notification sound' : sound.label;
}

/** The filename to hand the platform, or `null` for its own default. */
export function prayerAlertSoundFile(
  sound: PrayerAlertSound = currentPrayerAlertSound(),
): string | null {
  return sound.kind === 'platform-default' ? null : sound.file;
}

/**
 * The Android channel id, **versioned by the sound**.
 *
 * ── Why the id carries a version ────────────────────────────────────────────
 * An Android channel's sound is fixed when the channel is created and is immutable afterwards —
 * calling `setNotificationChannelAsync` again with a different sound silently does nothing for every
 * user who already has the channel. The only way to change it is a new id, which the OS presents to
 * the user as a new category.
 *
 * So the id encodes which sound it was created for. Introducing an approved Azan bumps `v2`, the new
 * channel is created on next launch, and the old one is deleted — which is a deliberate, visible
 * migration rather than a change that appears to work in development and does nothing in the field.
 */
export function prayerAlertChannelId(sound: PrayerAlertSound = currentPrayerAlertSound()): string {
  return sound.kind === 'platform-default'
    ? 'prayer-alerts-v1-default'
    : `prayer-alerts-v2-${sound.file}`;
}

/** The user-facing channel name, as it appears in Android's notification settings. */
export const PRAYER_ALERT_CHANNEL_NAME = 'Prayer alerts';

/**
 * The silent channel's id and name.
 *
 * ── Why "Silent" needs a second channel rather than a flag ───────────────
 * Because on Android a notification's sound is the *channel's* property, not the notification's.
 * `NotificationCompat.Builder.setSound()` — which is what `expo-notifications` calls when a
 * schedule request carries a sound — has been ignored since API 26, and a channel's sound is fixed
 * at creation and immutable afterwards. So there is no way to silence one notification on a channel
 * that has a sound, and no way to silence the channel later either.
 *
 * Two channels is the platform's own answer: alerts the user wants audible go to `prayer-alerts`,
 * alerts they want silent go to `prayer-alerts-silent`, and Android's notification settings show
 * them as two categories — which is honest, because they behave differently.
 *
 * The silent channel is created with `sound: null`, which `expo-notifications` maps to
 * `NotificationChannel.setSound(null, …)`. Verified against the installed native source rather than
 * assumed: an absent `sound` key means the system default, and an explicit `null` means no sound.
 * Its importance is `default` rather than `high`, because a heads-up banner with no sound is a
 * strange thing to ask for and `high` is what makes one appear.
 */
export const PRAYER_ALERT_SILENT_CHANNEL_ID = 'prayer-alerts-v1-silent';
export const PRAYER_ALERT_SILENT_CHANNEL_NAME = 'Prayer alerts (silent)';

/**
 * Whether a full call to prayer can be played at all, and why not.
 *
 * ── Why this is a value and not a boolean ────────────────────────────
 * The sheet shows a full-adhān row, disabled, so that somebody looking for the feature learns what
 * NoorLife intends rather than concluding it was forgotten. A disabled row has to say *why*, and
 * the reason has to come from the same place the capability does — otherwise the row will one day
 * explain an absence that has been filled.
 *
 * `available` becomes true only when `currentPrayerAlertSound()` returns a `bundled-azan`, which
 * needs a licensed asset registered with the config plugin. Every requirement is listed in
 * `docs/PRAYER_ALERT_AUDIO_REQUIREMENTS.md`; nothing here can be made true by editing this file.
 */
export type FullAdhanAvailability = {
  readonly available: boolean;
  /** One short sentence, shown beneath the disabled row. Never a promise of a date. */
  readonly reason: string;
};

export function fullAdhanAvailability(
  sound: PrayerAlertSound = currentPrayerAlertSound(),
): FullAdhanAvailability {
  return sound.kind === 'bundled-azan'
    ? { available: true, reason: sound.label }
    : {
        available: false,
        reason: 'Not available yet. NoorLife has no licensed adhān recording to play.',
      };
}
