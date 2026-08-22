import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';

import type {
  ExactAlarmCapability,
  NotificationPermission,
} from '../data/notifications/notification.port';
import {
  prayerAlertChannel,
  reconcilePrayerAlerts,
  requestPrayerAlertPermission,
  type PrayerAlertStatus,
} from '../data/notifications/prayer-notifications.service';
import {
  alertSettingsFingerprint,
  enableSettings,
  NOTIFIABLE_TIMES,
  normaliseRepeatDays,
  settingsFor,
  type AlertSoundChoice,
  type PrayerAlertSettings,
  type PreReminderMinutes,
} from '../data/notifications/prayer-alert-preferences';
import { type PrayerKey } from '../data/prayer-times.repository';
import { useFaithRepositories } from '../di/faith-repository-context';
import type { FaithPreferences } from '../storage/faith-preferences';
import { getFaithPreferencesSnapshot } from '../state/faith-preferences-store';
import { useFaithPreferences } from './use-faith-preferences';

/**
 * The reminder screen's state, and the only place a notification permission is requested.
 *
 * ── Why reconciliation lives in a hook rather than at app startup ───────────
 * Because the brief forbids asking for permission on startup, and a reconciliation that runs before
 * anybody has enabled anything would have nothing to reconcile. This runs when the reminder screen
 * mounts and whenever the app returns to the foreground, which are the two moments the platform's
 * pending list can have diverged from what NoorLife believes: a reboot that dropped the alarms, a
 * permission revoked in system settings, or a horizon that has simply aged past its first day.
 *
 * ── Nothing here decides anything ───────────────────────────────────────────
 * Every decision — what to schedule, what to cancel, in which order, and what the resulting state is
 * called — belongs to `prayer-notifications.service.ts`, which is pure with respect to React and
 * therefore testable without one. This hook holds the result and knows when to ask again.
 */

export type UsePrayerNotifications = {
  readonly status: PrayerAlertStatus | null;
  /**
   * Whether the OS will deliver, and how precisely — without building a schedule.
   *
   * ── Why this exists separately from `status` ──────────────────────────────
   * `status` is the product of a full reconciliation, which costs one prayer-time calculation per
   * day of the horizon. The Prayer screen must not pay that on mount, so it takes the hook with
   * `reconcileOnMount` false — and then `status` is `null`, and a sheet reading permission from it
   * would tell a user who has already granted permission that NoorLife has never asked.
   *
   * Two port reads answer that question and nothing else. Cheap enough to run when a sheet opens.
   */
  readonly delivery: {
    readonly permission: NotificationPermission;
    readonly exactAlarms: ExactAlarmCapability;
  } | null;
  /** Reads the delivery state above. No scheduling, no prayer-time calculation, never a prompt. */
  readonly refreshDelivery: () => Promise<void>;
  /** True while a reconciliation is in flight. The screen keeps rendering the previous status. */
  readonly busy: boolean;
  /** Turns the master switch on or off, requesting permission the first time it goes on. */
  readonly setMasterEnabled: (enabled: boolean) => Promise<void>;
  /**
   * Turns one time's notifications on or off, requesting permission the first time one goes on.
   *
   * Switching on also fills in all seven repeat days when none have been chosen — see
   * `enableSettings`, which is where that rule lives so the sheet and this hook cannot disagree.
   */
  readonly setNotify: (time: PrayerKey, notify: boolean) => Promise<void>;
  /** Replaces the repeat days for one time. Sunday is `0`. */
  readonly setRepeatDays: (time: PrayerKey, days: readonly number[]) => Promise<void>;
  /** Sets the pre-reminder for one time. `0` is None. */
  readonly setPreReminder: (time: PrayerKey, minutes: PreReminderMinutes) => Promise<void>;
  /** Sets the sound for one time. */
  readonly setSound: (time: PrayerKey, sound: AlertSoundChoice) => Promise<void>;
  /** One time's current settings, always defined. */
  readonly settingsForTime: (time: PrayerKey) => PrayerAlertSettings;
  /** Rebuilds the schedule from current inputs. */
  readonly refreshSchedule: () => Promise<void>;
  /** Shows a clearly-labelled test notification through the prayer-alert channel. */
  readonly sendTestNotification: () => Promise<boolean>;
  readonly openSystemSettings: () => Promise<void>;
};

/**
 * @param reconcileOnMount
 *   True for the reminder screen, whose whole purpose is to report the live schedule state. **False**
 *   for screens that only need `refreshSchedule` after they change something — the Prayer location
 *   screen among them. Reconciling costs one `getDailyTimes` per day of the horizon, so mounting a
 *   screen that merely *might* reschedule would spend seven prayer-time calculations to display a
 *   form. Measured: it dominated the location screen's mount.
 */
/**
 * Every notifiable time's settings, normalised.
 *
 * The preference blob is user-writable storage, so it can be missing a time, hold one twice, or
 * hold a repeat day that is not a day. `normaliseAllAlertSettings` — applied on read by
 * `migratePrayerAlerts` — has already made all of that well-formed; this reads the result.
 *
 * Sunrise is included, and that is the change. It may be switched on as an ordinary reminder. What
 * it may never be is announced as a prayer or given a call to prayer, and neither of those is
 * decided here: the planner chooses its wording from `isObligatory`, and the sheet refuses the
 * full-adhān row for it.
 */
function alertSettings(preferences: FaithPreferences): readonly PrayerAlertSettings[] {
  return preferences.prayerAlerts;
}

export function usePrayerNotifications(reconcileOnMount = true): UsePrayerNotifications {
  const { prayerTimes, notifications } = useFaithRepositories();
  const { preferences, ready, update } = useFaithPreferences();
  const [status, setStatus] = useState<PrayerAlertStatus | null>(null);
  const [delivery, setDelivery] = useState<UsePrayerNotifications['delivery']>(null);
  const [busy, setBusy] = useState(false);

  /**
   * A string identifying everything about the preferences that can change the schedule.
   *
   * A string rather than the objects themselves, because `prayerNotifications` is a fresh array on
   * every store publish and would restart the effect on any unrelated preference write. This changes
   * only when the master switch, the selected prayers, the calculation method or the Asr convention
   * change — which are precisely the four preference inputs `scheduleFingerprint` covers.
   */
  const scheduleInputs = [
    preferences.prayerNotificationsEnabled,
    /*
      Every per-time choice, not merely which times are on. A repeat day removed or a pre-reminder
      changed has to re-reconcile, and it is the same fingerprint the service compares, so a change
      here and a change there cannot drift apart.
    */
    NOTIFIABLE_TIMES.map((time) =>
      alertSettingsFingerprint(settingsFor(alertSettings(preferences), time)),
    ).join(';'),
    preferences.calculationMethod,
    preferences.asrMethod,
  ].join('|');

  /**
   * The reconciliation itself. Touches state only *after* the platform work has completed.
   *
   * ── Where its inputs come from, and why not from a ref ──────────────────────
   * From the preference store, read at the moment of reconciling. This callback used to take them
   * from a ref that an effect assigned on every render — stable, which was the goal, and subtly
   * ordered, which was the bug: the ref held the *first* render's values, and the first render is
   * before storage has answered, so it held the **defaults**. `prayerNotificationsEnabled` defaults
   * to `false`, and `reconcilePrayerAlerts` reads "master off" as an instruction to cancel
   * everything. Opening the reminders screen therefore destroyed the user's schedule, and the effect
   * that would have rebuilt it does not re-run on a preference change by design.
   *
   * Reading the store here removes the ordering question entirely: there is no window in which this
   * function can see a value that is not the current one, whoever calls it and whenever.
   *
   * ── Why the busy flag is not set here ───────────────────────────────────────
   * This is called from an effect body, and setting state synchronously inside one cascades a
   * render. The automatic passes — on mount and on foreground — do not need a spinner anyway: the
   * screen is already rendering the previous status and nothing about it is stale enough to hide.
   * The flag belongs to the *user-initiated* path, where somebody pressed something and is waiting.
   */
  const reconcile = useCallback(async () => {
    const snapshot = getFaithPreferencesSnapshot();
    /*
      Nothing is reconciled against defaults. `ready` is what distinguishes "the user has
      notifications off" from "storage has not answered yet", and only the first may cancel.
    */
    if (!snapshot.ready) {
      return;
    }
    const current = snapshot.preferences;
    const next = await reconcilePrayerAlerts(
      { prayerTimes, notifications, now: () => new Date() },
      {
        masterEnabled: current.prayerNotificationsEnabled,
        alerts: alertSettings(current),
        settings: {
          method: current.calculationMethod,
          asr: current.asrMethod,
          offsetsMinutes: {},
        },
      },
    );
    setStatus(next);
  }, [prayerTimes, notifications]);

  /**
   * The two facts a sheet needs, read directly from the port.
   *
   * `getPermission` never prompts — that is its contract — so this is safe to call from a control
   * that merely opens a settings surface. Nothing here schedules or cancels anything.
   */
  const refreshDelivery = useCallback(async () => {
    const [permission, exactAlarms] = await Promise.all([
      notifications.getPermission(),
      notifications.exactAlarmCapability(),
    ]);
    setDelivery({ permission, exactAlarms });
  }, [notifications]);

  /** The same work, with the busy flag — for the "Refresh schedule" control. */
  const refreshSchedule = useCallback(async () => {
    setBusy(true);
    try {
      await reconcile();
    } finally {
      setBusy(false);
    }
  }, [reconcile]);

  /**
   * On mount, and on every return to the foreground — but never before preferences have loaded.
   *
   * ── The defect the `ready` gate closes, which was destructive ───────────────
   * Preferences hydrate from storage a tick after the first render, so on that first render
   * `masterEnabled` is the **default**, which is `false`. The mount effect used to reconcile
   * immediately against that, and `reconcilePrayerAlerts` treats "master off" as an instruction:
   * it calls `cancelAll` and drops every pending request.
   *
   * So merely *opening the reminders screen* cancelled the user's alerts. Nothing rescheduled them,
   * because the effect's dependencies are stable by design — the whole point of `latest` is that a
   * preference change must not restart it — so the reconciliation that would have put them back
   * never ran. The screen then reported, accurately, that nothing was scheduled. The one screen
   * whose purpose is to show the schedule was the thing destroying it.
   *
   * `ready` is what distinguishes "the user has notifications off" from "storage has not answered
   * yet", and only the first of those may cancel anything.
   */
  useEffect(() => {
    if (!ready) {
      return;
    }
    if (reconcileOnMount) {
      /*
        ── Why the cascading-render rule is suppressed here, precisely ─────
        `react-hooks/set-state-in-effect` fires because this effect now re-runs when
        `scheduleInputs` changes and reaches a `setState`. The rule's concern is a *synchronous*
        setState cascading a second render — and `reconcile` has no such path: every branch that
        calls `setStatus` does so after awaiting platform work (a permission read, a capability
        read, up to seven prayer-time calculations and the scheduling calls themselves), so the
        state change lands many ticks later, from a promise, not from this effect's body.

        Synchronising an external system — the platform's pending-alert list — with React state is
        exactly what the rule's own documentation describes an effect as being for. The alternative,
        deferring through a timer purely to satisfy the analysis, would add a real timer and a real
        delay to buy nothing.
      */
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void reconcile();
    }
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void reconcile();
      }
    });
    return () => subscription.remove();
    /*
      `scheduleInputs` is a dependency, so a preference that can move a prayer time re-reconciles
      rather than waiting for the next foreground. That used to be avoided on the grounds that it
      would cancel and re-create 35 alarms on every change — but it does not: `reconcilePrayerAlerts`
      compares a fingerprint of exactly these inputs against the stored one and, when they match and
      every identifier is still pending, does no platform work at all. The saving was real and the
      cost of not having it was a schedule that could sit wrong for days.
    */
  }, [reconcile, reconcileOnMount, ready, scheduleInputs]);

  const setMasterEnabled = useCallback(
    async (enabled: boolean) => {
      if (enabled) {
        /*
          ── The only permission request in the module ───────────────────────
          Raised here, after an explicit switch, and never on startup. `requestPrayerAlertPermission`
          creates the Android channel first — on Android 13+ the system dialog lists the app's
          channels, so requesting before the channel exists produces a prompt describing nothing.

          A refusal does not undo the preference: the switch stays where the user put it and the
          screen reports that delivery is disabled, which the brief requires.
        */
        await requestPrayerAlertPermission(notifications);
      }
      /*
        The write is the whole of it. Reconciliation is driven by `scheduleInputs`, so publishing
        the new preference *is* the trigger — and calling `reconcile()` here as well would run two
        reconciliations concurrently for one tap. Both would schedule a full replacement set, and the
        second would read the stored identifiers before the first wrote them, so the first set would
        never be cancelled: 34 pending alerts became 56.
      */
      await update({ prayerNotificationsEnabled: enabled });
    },
    [notifications, update],
  );

  /**
   * The one way any per-time setting is written.
   *
   * ── A functional update, not a computed array ─────────────────────────────
   * An earlier version mapped over an array captured from the render that created the callback and
   * wrote the whole thing back. Two controls touched in quick succession therefore both derived
   * from the same pre-change array and the second write erased the first — a user saw one of their
   * two prayers silently switch itself back off. Deriving inside the updater means the store
   * applies it to whatever the previous mutation left behind, and the store serialises mutations so
   * there is a "previous" to speak of.
   *
   * No `reconcile()` call here: the write publishes a new `scheduleInputs`, and that is the
   * trigger. Calling both would run two reconciliations for one tap, and the second would read the
   * stored identifiers before the first had written them — which is how 34 pending alerts once
   * became 56.
   */
  const updateSettings = useCallback(
    async (time: PrayerKey, change: (settings: PrayerAlertSettings) => PrayerAlertSettings) => {
      await update((current) => ({
        prayerAlerts: current.prayerAlerts.map((entry) =>
          entry.time === time ? change(entry) : entry,
        ),
      }));
    },
    [update],
  );

  const setNotify = useCallback(
    async (time: PrayerKey, notify: boolean) => {
      /*
        Switching a time on is the other half of "only after the user explicitly enables their
        first alert": it asks for permission when the master is already on and the OS has not been
        asked yet. Nothing here runs on mount, and nothing runs for switching a time *off*.
      */
      if (
        notify &&
        getFaithPreferencesSnapshot().preferences.prayerNotificationsEnabled &&
        (await notifications.getPermission()) !== 'granted'
      ) {
        await requestPrayerAlertPermission(notifications);
      }

      await updateSettings(time, (settings) =>
        notify ? enableSettings(settings) : { ...settings, notify: false },
      );
    },
    [notifications, updateSettings],
  );

  const setRepeatDays = useCallback(
    async (time: PrayerKey, days: readonly number[]) => {
      // Normalised on the way in as well as on the way out of storage, so a caller cannot store a
      // duplicate or an eighth day.
      await updateSettings(time, (settings) => ({
        ...settings,
        repeatDays: normaliseRepeatDays([...days]),
      }));
    },
    [updateSettings],
  );

  const setPreReminder = useCallback(
    async (time: PrayerKey, minutes: PreReminderMinutes) => {
      await updateSettings(time, (settings) => ({ ...settings, preReminderMinutes: minutes }));
    },
    [updateSettings],
  );

  const setSound = useCallback(
    async (time: PrayerKey, sound: AlertSoundChoice) => {
      await updateSettings(time, (settings) => ({ ...settings, sound }));
    },
    [updateSettings],
  );

  const sendTestNotification = useCallback(async () => {
    const identifier = await notifications.presentNow({
      /*
        Labelled a test in the title itself, not only in the body. A notification is often read from
        a lock screen where only the title is visible, and one that looked like a prayer alert would
        be a call to prayer at the wrong time.
      */
      title: 'NoorLife test notification',
      body: 'This is a test. It confirms notifications can reach you; it is not a prayer alert.',
      channelId: prayerAlertChannel().id,
      data: { kind: 'test' },
      silent: false,
    });
    return identifier !== null;
  }, [notifications]);

  return {
    status,
    /*
      A full reconciliation already answers both, so it wins when it has run. `delivery` is the
      fallback for screens that never reconcile on mount.
    */
    delivery:
      status === null
        ? delivery
        : { permission: status.permission, exactAlarms: status.exactAlarms },
    refreshDelivery,
    busy,
    setMasterEnabled,
    setNotify,
    setRepeatDays,
    setPreReminder,
    setSound,
    settingsForTime: (time: PrayerKey) => settingsFor(alertSettings(preferences), time),
    refreshSchedule,
    sendTestNotification,
    openSystemSettings: useCallback(() => notifications.openSystemSettings(), [notifications]),
  };
}
