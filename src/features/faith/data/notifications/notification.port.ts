/**
 * Local notifications, as a port.
 *
 * ── Why a port, for the third time in this module ───────────────────────────
 * The same three reasons as `location.port.ts`, and one more that only applies here.
 *
 * **Every state that matters is unreachable from Jest through the real module.** Permission denied,
 * a channel that could not be created, a schedule call that failed halfway through five prayers, an
 * identifier that has vanished from the platform's pending list since it was written down — those
 * are the cases a prayer alert has to survive, and none of them can be produced by importing
 * `expo-notifications` in a test environment.
 *
 * **It keeps the permission prompt in one place.** There is exactly one `requestPermission`, it is
 * called from exactly one control, and a source scan asserts nothing else imports the module.
 *
 * **It bounds what the app can ask for.** There is no push token method here, no remote
 * registration, no background task. NoorLife schedules local alerts from times it calculated
 * itself; it must not grow a server-driven notification channel by accident.
 *
 * **And it makes the honesty testable.** The whole point of this subsystem is that the UI never
 * claims more than it can verify. A fake port lets a test put the app in "permission granted,
 * channel created, scheduling silently failing" and assert that the screen says so.
 */

/** Whether the OS will show notifications from this app. */
export type NotificationPermission =
  | 'granted'
  /** Refused, or revoked in system settings. */
  | 'denied'
  /** Never asked. A prompt is available. */
  | 'undetermined';

/**
 * Whether the platform will deliver a scheduled alert at the exact instant requested.
 *
 * ── Why `unknown` is a real member and not a gap ────────────────────────────
 * On Android 12+ exact scheduling requires `SCHEDULE_EXACT_ALARM`, and whether it is *granted at
 * runtime* is readable only through `AlarmManager.canScheduleExactAlarms()` — a native call
 * `expo-notifications` does not expose in SDK 57. NoorLife declares the permission and cannot, from
 * JavaScript, confirm the grant.
 *
 * The options were to assume it is granted, or to say so. Assuming it would put "your prayer alerts
 * will arrive exactly on time" on a screen that has no way of knowing — which is precisely the class
 * of claim this whole feature was built to avoid. `unknown` is the truthful value, and the reminder
 * screen renders it as "cannot be confirmed on this device" rather than as either good or bad news.
 */
export type ExactAlarmCapability =
  /** iOS, or an Android version with no exact-alarm gate. Timing is the platform's normal accuracy. */
  | 'not-required'
  /** Confirmed available. Only reachable where a platform actually reports it. */
  | 'available'
  /** Confirmed denied or unavailable — delivery may be batched or delayed by the system. */
  | 'unavailable'
  /** Declared in the manifest; the runtime grant is not readable from JavaScript. See above. */
  | 'unknown';

/** An Android notification channel. Created before any permission is requested. */
export type NotificationChannelSpec = {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  /**
   * How prominently the OS may present it.
   *
   * `high` means heads-up, which is right for a prayer time. It is **not** a bypass of Do Not
   * Disturb, and NoorLife does not request one: the user's focus settings are theirs.
   */
  readonly importance: 'default' | 'high';
  /**
   * The sound to use, or `null` for the platform default.
   *
   * Always `null` today — no approved Azan asset exists. See `prayer-alert-sound.ts` for the seam
   * and `docs/PRAYER_ALERT_AUDIO_REQUIREMENTS.md` for what an approved one would have to satisfy.
   *
   * Changing this on an existing channel does nothing on Android: a channel's sound is fixed at
   * creation, so a new sound needs a new channel id. That is why the id is versioned.
   */
  readonly soundFile: string | null;
  /**
   * Whether this channel is deliberately silent.
   *
   * Distinct from `soundFile === null`, and the distinction is the whole reason it exists: a null
   * file means "whatever the platform's default notification sound is", and silent means "no sound".
   * `expo-notifications` maps an **absent** channel sound to the system default and an **explicit
   * null** to silence, so the port has to be able to say which of the two it means.
   *
   * Android only in effect. On iOS silence is a property of each notification, not of a channel, so
   * `ScheduleRequest.silent` carries it there.
   */
  readonly silent: boolean;
};

export type ScheduleRequest = {
  readonly title: string;
  readonly body: string;
  readonly channelId: string;
  /** The exact instant to fire. Never a relative interval — see `prayer-alert-plan.ts`. */
  readonly at: Date;
  /** Opaque payload, echoed back by the platform. Carries no personal data. */
  readonly data: Readonly<Record<string, string>>;
  /**
   * Whether this alert should make no sound.
   *
   * Both halves are needed and neither is redundant. On Android the answer is already decided by
   * `channelId` — a silent alert is routed to the silent channel — and this flag changes nothing,
   * because a per-notification sound has been ignored since API 26. On iOS there are no channels and
   * this flag is the only thing that silences it.
   */
  readonly silent: boolean;
};

/** One entry in the platform's pending list. */
export type ScheduledAlert = {
  readonly identifier: string;
  /** The instant the platform says it will fire, where it reports one. */
  readonly at: string | null;
  readonly channelId: string | null;
  readonly data: Readonly<Record<string, unknown>>;
};

export type NotificationPort = {
  /** The current permission state. Never prompts. */
  getPermission(): Promise<NotificationPermission>;

  /**
   * Prompts, if the platform will.
   *
   * Called only after the user has explicitly enabled their first alert. The Android channel must
   * already exist when this runs — see `ensureChannel`.
   */
  requestPermission(): Promise<NotificationPermission>;

  /**
   * Creates or updates the Android channel. A no-op on other platforms.
   *
   * ── Why this must happen before `requestPermission` ─────────────────────────
   * On Android 13+ the system permission dialog shows the app's channels. Requesting first produces
   * a prompt describing nothing, and the channel that appears afterwards inherits whatever default
   * the OS chose rather than the importance NoorLife asked for.
   */
  ensureChannel(channel: NotificationChannelSpec): Promise<void>;

  /** Whether exact-time delivery is available. See `ExactAlarmCapability`. */
  exactAlarmCapability(): Promise<ExactAlarmCapability>;

  /**
   * Schedules one alert. Returns its identifier, or `null` when the platform refused.
   *
   * `null` rather than a throw, because a partial failure across five prayers is a state the caller
   * has to handle rather than an exception to escape through — see the rollback in
   * `prayer-notifications.service.ts`.
   */
  schedule(request: ScheduleRequest): Promise<string | null>;

  /** Cancels one identifier. Silent when it has already fired or never existed. */
  cancel(identifier: string): Promise<void>;

  /** Everything currently pending, as the platform sees it. The source of truth for reconciliation. */
  listScheduled(): Promise<readonly ScheduledAlert[]>;

  /** Shows one notification immediately. Used only by the clearly-labelled test action. */
  presentNow(request: Omit<ScheduleRequest, 'at'>): Promise<string | null>;

  /** Opens this application's system settings page, where notifications can be re-enabled. */
  openSystemSettings(): Promise<void>;
};
