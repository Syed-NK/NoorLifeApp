import {
  readStoredSchedule,
  writeStoredSchedule,
  type StoredPrayerSchedule,
} from '../../storage/faith-notification-schedule';
import { hasData } from '../faith-result';
import { addCalendarDays } from '../prayer/location-time-zone';
import type {
  DailyPrayerTimes,
  PrayerCalculationSettings,
  PrayerKey,
  PrayerTimesRepository,
} from '../prayer-times.repository';
import type {
  ExactAlarmCapability,
  NotificationPermission,
  NotificationPort,
} from './notification.port';
import {
  MAX_PENDING_ALERTS,
  planPrayerAlerts,
  prayerAlertContent,
  scheduleFingerprint,
  SCHEDULE_HORIZON_DAYS,
  type PrayerAlertPlan,
} from './prayer-alert-plan';
import {
  NOTIFIABLE_TIMES,
  settingsFor,
  type PrayerAlertSettings,
} from './prayer-alert-preferences';
import {
  currentPrayerAlertSound,
  prayerAlertChannelId,
  prayerAlertSoundFile,
  PRAYER_ALERT_CHANNEL_NAME,
  PRAYER_ALERT_SILENT_CHANNEL_ID,
  PRAYER_ALERT_SILENT_CHANNEL_NAME,
} from './prayer-alert-sound';

/**
 * Keeping the platform's pending prayer alerts equal to what the user asked for.
 *
 * ── The one invariant ───────────────────────────────────────────────────────
 * The app never claims an alert is scheduled unless it holds an identifier the platform gave it and
 * that identifier is still in the platform's own pending list. Everything else in this file exists
 * to keep that true across the things that break it: a changed location, a changed method, a DST
 * transition, a reboot, an upgrade, a revoked permission, and a scheduling call that fails on the
 * third of five prayers.
 *
 * ── Why the rescheduling is atomic in this direction ────────────────────────
 * New alerts are scheduled **first**, and the old identifiers are cancelled only once the whole
 * replacement set exists. The opposite order is the obvious one and is wrong: cancel-then-schedule
 * leaves a user with no prayer alerts at all if the scheduling half fails, and it fails exactly when
 * the platform is under pressure. If any part of the new set cannot be created, what was just
 * created is rolled back and the previous schedule is left untouched — the user keeps yesterday's
 * alerts, which are mostly right, instead of none, which is entirely wrong.
 */

/** What the app knows about prayer alerts right now. Every field is separately observable. */
export type PrayerAlertStatus = {
  /** The user's master switch. Independent of whether the OS will deliver anything. */
  readonly preferenceEnabled: boolean;
  /** Which prayers are switched on. Never contains sunrise. */
  readonly enabledPrayers: readonly PrayerKey[];
  readonly permission: NotificationPermission;
  readonly exactAlarms: ExactAlarmCapability;
  /** Whether the Android channel has been created in this process. */
  readonly channelReady: boolean;
  readonly schedule: ScheduleState;
  /**
   * Always `false`, and it is a field rather than a comment.
   *
   * NoorLife can prove an alert is *pending*. It cannot prove one was *delivered* — the platform
   * offers no receipt, and battery optimisation, Do Not Disturb and per-channel settings can each
   * suppress one silently. Any screen tempted to say "your reminders are working" has to read this
   * first.
   */
  readonly deliveryVerifiable: false;
};

export type ScheduleState =
  /** Nothing is scheduled, and nothing should be. */
  | { readonly kind: 'none' }
  /** Pending alerts exist and match the current inputs. */
  | {
      readonly kind: 'scheduled';
      readonly count: number;
      /** The soonest pending alert, or `null` if the horizon is somehow empty. */
      readonly nextAt: string | null;
      readonly nextLabel: string | null;
      readonly preparedAt: string;
      /**
       * The last calendar date the pending alerts actually reach.
       *
       * Reported because it is no longer always the end of the horizon. With six times and
       * pre-reminders switched on, the pending ceiling can bite before seven days are covered, and a
       * screen that said “the next 7 days” would then be wrong.
       */
      readonly coversThrough: string | null;
      /** Whether the pending ceiling cut the plan short of the horizon. */
      readonly truncated: boolean;
    }
  /**
   * Alerts are pending but were built from inputs that have since changed.
   *
   * Reachable when reconciliation could not run — no permission, or a location that stopped
   * resolving. The pending alerts are still real; they are simply for the wrong place or method, and
   * the screen says so rather than showing them as correct.
   */
  | { readonly kind: 'stale'; readonly count: number; readonly preparedAt: string }
  /** The last attempt to build a schedule failed. The previous one, if any, is still pending. */
  | {
      readonly kind: 'failed';
      readonly reason: 'permission' | 'location' | 'calculation' | 'platform-refused';
      /** How many of the previous schedule's alerts are still pending. */
      readonly retainedCount: number;
    };

export type PrayerNotificationDependencies = {
  readonly prayerTimes: PrayerTimesRepository;
  readonly notifications: NotificationPort;
  readonly now: () => Date;
};

export type PrayerNotificationPreferences = {
  readonly masterEnabled: boolean;
  /**
   * Every notifiable time's own choices, already normalised.
   *
   * This replaced a bare list of switched-on prayers. The list could say *which* times were on and
   * nothing about when or how, so repeat days, pre-reminders and the sound choice had nowhere to
   * arrive — and `minutesBefore` sat in storage for three releases being read by nothing.
   */
  readonly alerts: readonly PrayerAlertSettings[];
  readonly settings: PrayerCalculationSettings;
};

/** The times switched on, for the status. Derived, so it cannot disagree with `alerts`. */
function enabledTimes(alerts: readonly PrayerAlertSettings[]): readonly PrayerKey[] {
  return NOTIFIABLE_TIMES.filter((time) => settingsFor(alerts, time).notify);
}

/** Whether any switched-on time has asked for silence — i.e. whether the silent channel is needed. */
function needsSilentChannel(alerts: readonly PrayerAlertSettings[]): boolean {
  return NOTIFIABLE_TIMES.some((time) => {
    const settings = settingsFor(alerts, time);
    return settings.notify && settings.sound === 'silent';
  });
}

/** The channel NoorLife's prayer alerts use. Derived from the sound — see `prayer-alert-sound.ts`. */
export function prayerAlertChannel() {
  const sound = currentPrayerAlertSound();
  return {
    id: prayerAlertChannelId(sound),
    name: PRAYER_ALERT_CHANNEL_NAME,
    description:
      'Alerts at the calculated time of each prayer, for the location and method you selected.',
    importance: 'high' as const,
    soundFile: prayerAlertSoundFile(sound),
    silent: false,
  };
}

/**
 * The channel for alerts the user asked to be silent.
 *
 * A second channel rather than a flag, because on Android a notification's sound belongs to its
 * channel and a channel's sound is immutable after creation — see `prayer-alert-sound.ts`. Created
 * only when some switched-on time actually asks for silence, so a user who never chooses it never
 * sees a second category in their system settings.
 *
 * `default` importance rather than `high`: a heads-up banner that makes no sound is a strange thing
 * to ask for, and `high` is what produces one.
 */
export function prayerAlertSilentChannel() {
  return {
    id: PRAYER_ALERT_SILENT_CHANNEL_ID,
    name: PRAYER_ALERT_SILENT_CHANNEL_NAME,
    description: 'The same prayer alerts, delivered without a sound.',
    importance: 'default' as const,
    soundFile: null,
    silent: true,
  };
}

/** Which channel an alert belongs on. The only place that mapping is made. */
export function channelIdFor(silent: boolean): string {
  return silent ? prayerAlertSilentChannel().id : prayerAlertChannel().id;
}

/**
 * Ensures the Android channel exists, then asks for permission.
 *
 * ── The order is the point of the function ──────────────────────────────────
 * On Android 13+ the system permission dialog lists the app's channels. Requesting first shows a
 * prompt describing nothing, and the channel created afterwards takes whatever importance the OS
 * defaulted to rather than the one asked for here. Exposed as one call so no screen can get the
 * order wrong.
 */
export async function requestPrayerAlertPermission(
  notifications: NotificationPort,
): Promise<NotificationPermission> {
  await notifications.ensureChannel(prayerAlertChannel());
  return notifications.requestPermission();
}

/**
 * Brings the platform's pending alerts into line with the preferences, and reports the result.
 *
 * Called on launch, on foreground, and after any input changes. Safe to call repeatedly: when the
 * fingerprint matches and every identifier is still pending, it does no platform work at all.
 */
export async function reconcilePrayerAlerts(
  dependencies: PrayerNotificationDependencies,
  preferences: PrayerNotificationPreferences,
): Promise<PrayerAlertStatus> {
  const { prayerTimes, notifications, now } = dependencies;
  const { masterEnabled, alerts, settings } = preferences;
  const enabledPrayers = enabledTimes(alerts);

  const permission = await notifications.getPermission();
  const exactAlarms = await notifications.exactAlarmCapability();
  const stored = await readStoredSchedule();

  const base = {
    preferenceEnabled: masterEnabled,
    enabledPrayers,
    permission,
    exactAlarms,
    deliveryVerifiable: false as const,
  };

  /*
    Switched off, or every prayer switched off. Everything pending is cancelled — leaving alerts
    behind after the user turned them off is the one failure that would wake somebody at 4 a.m.
  */
  if (!masterEnabled || enabledPrayers.length === 0) {
    await cancelAll(notifications, stored);
    return { ...base, channelReady: false, schedule: { kind: 'none' } };
  }

  if (permission !== 'granted') {
    /*
      The preference is preserved, deliberately — the brief requires it. What is *not* preserved is
      the claim: anything still pending from before the permission was revoked is reported as stale
      rather than as scheduled, because the OS will not deliver it.
    */
    const count = Object.keys(stored.identifiers).length;
    return {
      ...base,
      channelReady: false,
      schedule:
        count === 0
          ? { kind: 'failed', reason: 'permission', retainedCount: 0 }
          : { kind: 'stale', count, preparedAt: stored.preparedAt },
    };
  }

  await notifications.ensureChannel(prayerAlertChannel());
  /*
    Only when something actually asks for it. Creating the silent channel unconditionally would put
    a second “Prayer alerts (silent)” category in every user’s system settings, including the ones
    who never chose silence — and an Android channel cannot be removed once the user has seen it
    without the removal itself being visible.
  */
  if (needsSilentChannel(alerts)) {
    await notifications.ensureChannel(prayerAlertSilentChannel());
  }
  const withChannel = { ...base, channelReady: true };

  const location = await prayerTimes.resolveCurrentLocation();
  if (!hasData(location)) {
    return {
      ...withChannel,
      schedule: {
        kind: 'failed',
        reason: 'location',
        retainedCount: Object.keys(stored.identifiers).length,
      },
    };
  }

  const startDay = prayerTimes.locationCalendarDay(location.data);
  if (startDay === null) {
    return {
      ...withChannel,
      schedule: {
        kind: 'failed',
        reason: 'location',
        retainedCount: Object.keys(stored.identifiers).length,
      },
    };
  }

  /*
    ── The days come from the repository, always ─────────────────────────────
    One `getDailyTimes` per day of the horizon. This is the only way the alert instants can be
    guaranteed identical to the ones the Prayer screen renders, which is the property the tests
    assert by string equality. Nothing in this file constructs a prayer time.
  */
  const days: DailyPrayerTimes[] = [];
  for (let offset = 0; offset < SCHEDULE_HORIZON_DAYS; offset += 1) {
    const day = addCalendarDays(startDay, offset);
    if (day === null) {
      // The start day stopped parsing mid-horizon, which means it was never a calendar day.
      return {
        ...withChannel,
        schedule: {
          kind: 'failed',
          reason: 'calculation',
          retainedCount: Object.keys(stored.identifiers).length,
        },
      };
    }
    const times = await prayerTimes.getDailyTimes(location.data, day, settings);
    if (!hasData(times)) {
      return {
        ...withChannel,
        schedule: {
          kind: 'failed',
          reason: 'calculation',
          retainedCount: Object.keys(stored.identifiers).length,
        },
      };
    }
    days.push(times.data);
  }

  const nowMs = now().getTime();
  const plan = planPrayerAlerts({ days, alerts, nowMs });
  const planned = plan.alerts;

  const fingerprint = scheduleFingerprint({
    latitude: location.data.coordinate.latitude,
    longitude: location.data.coordinate.longitude,
    timeZone: location.data.timeZone,
    offsetMinutes: offsetMinutesFor(days[0]),
    method: settings.method,
    asr: settings.asr,
    offsetsMinutes: settings.offsetsMinutes,
    alerts,
    horizonDays: SCHEDULE_HORIZON_DAYS,
    maxPending: MAX_PENDING_ALERTS,
  });

  /*
    ── The cheap path, and why it checks the platform rather than trusting storage ──
    Same inputs *and* every identifier still pending. The second half is what catches a reboot that
    dropped the alarms, an OS that pruned them, and a user who cleared the app's notifications from
    system settings — all of which leave storage looking perfectly healthy.
  */
  const pending = await notifications.listScheduled();
  const pendingIds = new Set(pending.map((entry) => entry.identifier));
  const wantedKeys = planned.map((alert) => alert.key);
  const storedIsComplete =
    stored.fingerprint === fingerprint &&
    wantedKeys.every((key) => {
      const identifier = stored.identifiers[key];
      return identifier !== undefined && pendingIds.has(identifier);
    });

  if (storedIsComplete) {
    return { ...withChannel, schedule: describeScheduled(stored, plan) };
  }

  // ── Schedule the replacement set first. Nothing is cancelled until it all exists. ──
  const created: Record<string, string> = {};
  let refused = false;

  for (const alert of planned) {
    const { title, body } = prayerAlertContent(alert);
    const identifier = await notifications.schedule({
      title,
      body,
      channelId: channelIdFor(alert.silent),
      at: new Date(alert.at),
      /*
        The prayer, its calendar date and which kind of alert it is — and nothing else. No
        coordinate, no place name, no clock and no account: a notification payload is readable by
        anything that can read notifications.
      */
      data: {
        prayer: alert.prayer,
        date: alert.calendarDate,
        kind: alert.type === 'pre' ? 'prayer-pre-alert' : 'prayer-alert',
      },
      silent: alert.silent,
    });
    if (identifier === null) {
      refused = true;
      break;
    }
    created[alert.key] = identifier;
  }

  if (refused) {
    // Roll back only what this attempt created. The previous schedule is left exactly as it was.
    for (const identifier of Object.values(created)) {
      await notifications.cancel(identifier);
    }
    return {
      ...withChannel,
      schedule: {
        kind: 'failed',
        reason: 'platform-refused',
        retainedCount: Object.keys(stored.identifiers).length,
      },
    };
  }

  // The replacement set exists. Now, and only now, the old one goes.
  for (const [key, identifier] of Object.entries(stored.identifiers)) {
    if (created[key] !== identifier) {
      await notifications.cancel(identifier);
    }
  }

  const next: StoredPrayerSchedule = {
    fingerprint,
    preparedAt: now().toISOString(),
    identifiers: created,
  };
  await writeStoredSchedule(next);

  return { ...withChannel, schedule: describeScheduled(next, plan) };
}

/** Cancels everything pending and forgets it. */
/**
 * Cancels every prayer alert the platform is still holding, without consulting the stored record.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── Why the stored identifiers cannot be used here ─────────────────────────
 * `cancelAll` below cancels by identifier, read from `notificationSchedule` — which is now
 * partitioned by account. That works whenever the owner is unchanged and is useless in the one case
 * this function exists for: an account **change**. The moment the owner moves, the record holding
 * user A's identifiers is at an address user B cannot read, so the alarms A scheduled become
 * unreferencable and would keep firing.
 *
 * That is an exposure rather than an inconvenience. A prayer alert is computed from a specific
 * city, so alarms left behind tell user B roughly where user A was — and they arrive at times
 * nobody on this phone asked for.
 *
 * So this asks the platform what is pending and cancels it, which is the only question that has an
 * answer once the record is out of reach.
 *
 * ── Why the filter is a prefix and emphatically not `prayerAlertChannel().id` ──
 * The channel id encodes the **chosen alert sound** — `prayer-alerts-v1-default` or
 * `prayer-alerts-v2-<file>`. It is therefore a function of a *preference*, and preferences are
 * per-account. Matching the current channel would compare user B's newly-defaulted channel against
 * alarms user A scheduled on theirs, skip every one of them, and leave exactly the alarms this
 * function exists to remove — a filter that looks careful and does the opposite.
 *
 * The prefix is shared by every version and every sound, so it survives that. Alerts reporting no
 * channel at all are cancelled too: this app schedules nothing else, and an unattributable alarm
 * left over from the previous account is the failure being prevented.
 * ═══════════════════════════════════════════════════════════════════════════
 */
const PRAYER_ALERT_CHANNEL_PREFIX = 'prayer-alerts-';

export async function cancelEveryPendingPrayerAlert(
  notifications: NotificationPort,
): Promise<number> {
  let cancelled = 0;
  try {
    const pending = await notifications.listScheduled();
    for (const alert of pending) {
      if (alert.channelId !== null && !alert.channelId.startsWith(PRAYER_ALERT_CHANNEL_PREFIX)) {
        continue;
      }
      await notifications.cancel(alert.identifier);
      cancelled += 1;
    }
  } catch {
    /*
      Best effort, deliberately. This runs on a sign-out, and a platform that will not answer must
      not be able to block one — the local session has already ended by the time this is reached.
    */
  }
  return cancelled;
}

async function cancelAll(
  notifications: NotificationPort,
  stored: StoredPrayerSchedule,
): Promise<void> {
  for (const identifier of Object.values(stored.identifiers)) {
    await notifications.cancel(identifier);
  }
  if (Object.keys(stored.identifiers).length > 0) {
    await writeStoredSchedule({ fingerprint: '', preparedAt: '', identifiers: {} });
  }
}

function describeScheduled(stored: StoredPrayerSchedule, plan: PrayerAlertPlan): ScheduleState {
  const count = Object.keys(stored.identifiers).length;
  if (count === 0) {
    return { kind: 'none' };
  }
  const first = plan.alerts[0];
  return {
    kind: 'scheduled',
    count,
    nextAt: first?.at ?? null,
    nextLabel: first?.label ?? null,
    preparedAt: stored.preparedAt,
    coversThrough: plan.coversThrough,
    truncated: plan.truncated,
  };
}

/**
 * The location's UTC offset in minutes, read off a stamped prayer instant.
 *
 * ── Why it is read from the data rather than computed ───────────────────────
 * Every instant the repository produces carries the location's own offset — that is the whole of the
 * timezone correction. Parsing it back out is therefore free and exactly right, including across a
 * DST transition, where recomputing it from the zone would need the very date arithmetic this layer
 * is forbidden to do. Zero when the day has no times at all, which cannot happen on a path that
 * reaches here.
 */
function offsetMinutesFor(day: DailyPrayerTimes | undefined): number {
  const stamp = day?.times[0]?.at;
  if (stamp === undefined) {
    return 0;
  }
  const match = /([+-])(\d{2}):(\d{2})$/.exec(stamp);
  if (match === null) {
    return stamp.endsWith('Z') ? 0 : 0;
  }
  const sign = match[1] === '-' ? -1 : 1;
  return sign * (Number(match[2]) * 60 + Number(match[3]));
}
