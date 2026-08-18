import * as Notifications from 'expo-notifications';
import { Linking, Platform } from 'react-native';

import type {
  ExactAlarmCapability,
  NotificationChannelSpec,
  NotificationPermission,
  NotificationPort,
  ScheduledAlert,
  ScheduleRequest,
} from './notification.port';

/**
 * The `expo-notifications` implementation of `NotificationPort`.
 *
 * ── This is the only file in the app that imports `expo-notifications` ──────
 * A source scan asserts it, for the same reason `expo-location.port.ts` is the only importer of the
 * location module: an API that can raise a permission prompt, reachable from anywhere, is a prompt
 * nobody can account for. Everything else takes the port.
 *
 * ── It never prompts on its own ─────────────────────────────────────────────
 * `getPermission` reads and `requestPermission` asks, and they are separate methods so a screen that
 * only wants to display the current state cannot accidentally trigger a dialog. Nothing in this file
 * runs at import time except the handler registration below, which raises nothing.
 */

/**
 * How a notification behaves when it arrives while NoorLife is open.
 *
 * ── Why it is registered at module scope ────────────────────────────────────
 * The platform calls this the moment a notification is delivered, which can be before any screen has
 * mounted. Registering it inside a component would leave a window where a prayer alert arriving on a
 * cold start is presented with the platform's defaults instead of NoorLife's.
 *
 * A banner and a list entry, and **no sound**. The sound belongs to the channel — Android plays the
 * channel's sound for a delivered notification, and asking for one here as well produces a double
 * chime on some OEM builds. No badge: a prayer time is not an unread item.
 */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

function toPermission(
  response: Notifications.NotificationPermissionsStatus,
): NotificationPermission {
  if (response.granted) {
    return 'granted';
  }
  /*
    `canAskAgain` is what separates "not asked yet" from "refused". On iOS a refusal is permanent
    until the user visits Settings, and reporting it as `undetermined` would put a button on screen
    that raises no dialog — the exact defect the location Grant control had.
  */
  return response.canAskAgain && response.status === Notifications.PermissionStatus.UNDETERMINED
    ? 'undetermined'
    : 'denied';
}

export function createExpoNotificationPort(): NotificationPort {
  return {
    async getPermission(): Promise<NotificationPermission> {
      try {
        return toPermission(await Notifications.getPermissionsAsync());
      } catch {
        // A platform that cannot answer is treated as not granted. Failing closed means the worst
        // case is a screen offering to enable something that is already enabled.
        return 'denied';
      }
    },

    async requestPermission(): Promise<NotificationPermission> {
      try {
        return toPermission(
          await Notifications.requestPermissionsAsync({
            /*
              Alert and sound. **No** critical alerts and no provisional authorisation: a critical
              alert bypasses silent mode and Focus, which is Apple-entitlement territory NoorLife has
              not applied for and would not be honest claiming. The user's focus settings are theirs.
            */
            ios: { allowAlert: true, allowSound: true, allowBadge: false },
          }),
        );
      } catch {
        return 'denied';
      }
    },

    async ensureChannel(channel: NotificationChannelSpec): Promise<void> {
      if (Platform.OS !== 'android') {
        return;
      }
      try {
        await Notifications.setNotificationChannelAsync(channel.id, {
          name: channel.name,
          description: channel.description,
          importance:
            channel.importance === 'high'
              ? Notifications.AndroidImportance.HIGH
              : Notifications.AndroidImportance.DEFAULT,
          /*
            `undefined` means the channel takes the system's default notification sound. It is not
            the same as `null`, which on Android means *silent* — a prayer alert that makes no sound
            is not the default this app wants, and the difference is one keystroke.
          */
          ...(channel.soundFile === null ? {} : { sound: channel.soundFile }),
        });
      } catch {
        // A channel that could not be created is reported through `channelReady` upstream rather
        // than thrown: the rest of the reconciliation is still worth attempting.
      }
    },

    async exactAlarmCapability(): Promise<ExactAlarmCapability> {
      if (Platform.OS !== 'android') {
        // iOS schedules at the requested instant subject to its own delivery policy; there is no
        // separate exact-alarm gate to report on.
        return 'not-required';
      }
      /*
        ── Why this is `unknown` and not a real answer ─────────────────────────
        Android 12 introduced `SCHEDULE_EXACT_ALARM`, and whether it is granted at runtime is
        readable only via `AlarmManager.canScheduleExactAlarms()`. `expo-notifications` does not
        expose that in SDK 57, and this task adds no native module of its own.

        NoorLife declares the permission in the manifest and cannot confirm the grant from
        JavaScript. Returning `available` would put "alerts arrive exactly on time" on a screen with
        no evidence for it. `unknown` is the true answer and the reminder screen renders it as
        "cannot be confirmed on this device" — neither reassurance nor alarm.
      */
      return Platform.Version >= 31 ? 'unknown' : 'not-required';
    },

    async schedule(request: ScheduleRequest): Promise<string | null> {
      try {
        return await Notifications.scheduleNotificationAsync({
          content: {
            title: request.title,
            body: request.body,
            data: request.data,
          },
          trigger: {
            /*
              A `DATE` trigger with an absolute instant — never a `TIME_INTERVAL` computed from now,
              and never a `DAILY` trigger with an hour and minute. Both of those would recompute the
              prayer time from something other than the calculated instant: an interval drifts if the
              app is suspended between planning and scheduling, and a daily trigger repeats the same
              wall clock every day, which prayer times conspicuously do not do.
            */
            type: Notifications.SchedulableTriggerInputTypes.DATE,
            date: request.at,
            channelId: request.channelId,
          },
        });
      } catch {
        return null;
      }
    },

    async cancel(identifier: string): Promise<void> {
      try {
        await Notifications.cancelScheduledNotificationAsync(identifier);
      } catch {
        // Already fired, already cancelled, or never existed. All three are the desired end state.
      }
    },

    async listScheduled(): Promise<readonly ScheduledAlert[]> {
      try {
        const pending = await Notifications.getAllScheduledNotificationsAsync();
        return pending.map((entry) => ({
          identifier: entry.identifier,
          at: triggerInstant(entry.trigger),
          channelId: readChannelId(entry.trigger),
          data: (entry.content.data ?? {}) as Readonly<Record<string, unknown>>,
        }));
      } catch {
        /*
          An empty list rather than a throw, and the consequence is deliberate: reconciliation will
          conclude that nothing it holds is pending and rebuild the schedule. Rebuilding a schedule
          that was actually fine costs five platform calls; trusting storage after the platform
          refused to answer risks reporting alerts as scheduled when they are not.
        */
        return [];
      }
    },

    async presentNow(request: Omit<ScheduleRequest, 'at'>): Promise<string | null> {
      try {
        return await Notifications.scheduleNotificationAsync({
          content: { title: request.title, body: request.body, data: request.data },
          /*
            `null` is expo's "deliver immediately". It still goes through the configured channel, so
            the test genuinely exercises the channel a prayer alert would use rather than a default
            one — which is the only thing that makes it worth having.
          */
          trigger: null,
        });
      } catch {
        return null;
      }
    },

    async openSystemSettings(): Promise<void> {
      try {
        /*
          The application's own settings page, from which notifications and — on Android 12+ — the
          alarms-and-reminders permission are both reachable. A direct intent to the exact-alarm
          screen needs `expo-intent-launcher`, which this task does not install; see
          `docs/PRAYER_ALERT_AUDIO_REQUIREMENTS.md` for the follow-up work that would add it.
        */
        await Linking.openSettings();
      } catch {
        // Nothing further to offer. The screen already states the setting to look for by name.
      }
    },
  };
}

/** The instant a pending trigger will fire, where the platform reports one. */
function triggerInstant(trigger: Notifications.NotificationTrigger | null): string | null {
  if (trigger === null || typeof trigger !== 'object') {
    return null;
  }
  const value = (trigger as { readonly value?: unknown }).value;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(value).toISOString();
  }
  const date = (trigger as { readonly date?: unknown }).date;
  if (typeof date === 'number' && Number.isFinite(date)) {
    return new Date(date).toISOString();
  }
  return null;
}

function readChannelId(trigger: Notifications.NotificationTrigger | null): string | null {
  if (trigger === null || typeof trigger !== 'object') {
    return null;
  }
  const channelId = (trigger as { readonly channelId?: unknown }).channelId;
  return typeof channelId === 'string' ? channelId : null;
}
