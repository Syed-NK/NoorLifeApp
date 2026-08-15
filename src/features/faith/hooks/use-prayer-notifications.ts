import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';

import {
  prayerAlertChannel,
  reconcilePrayerAlerts,
  requestPrayerAlertPermission,
  type PrayerAlertStatus,
} from '../data/notifications/prayer-notifications.service';
import { OBLIGATORY_PRAYERS, type PrayerKey } from '../data/prayer-times.repository';
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
  /** True while a reconciliation is in flight. The screen keeps rendering the previous status. */
  readonly busy: boolean;
  /** Turns the master switch on or off, requesting permission the first time it goes on. */
  readonly setMasterEnabled: (enabled: boolean) => Promise<void>;
  /** Turns one prayer on or off. Never offered for sunrise — it is not in `OBLIGATORY_PRAYERS`. */
  readonly setPrayerEnabled: (prayer: PrayerKey, enabled: boolean) => Promise<void>;
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
 * The switched-on prayers, filtered to the five.
 *
 * The filter is belt and braces rather than defensive clutter: sunrise is not offered as a switch and
 * is not in `DEFAULT_NOTIFICATIONS`, so it cannot reach here through the UI — but the preference blob
 * is user-writable storage, and a `sunrise` entry arriving from a future build or a corrupted read
 * must not become a scheduled alert. Sunrise is a clock reading, not an act of worship.
 */
function obligatoryEnabled(preferences: FaithPreferences): readonly PrayerKey[] {
  return preferences.prayerNotifications
    .filter((entry) => entry.enabled)
    .map((entry) => entry.prayer)
    .filter((prayer) => OBLIGATORY_PRAYERS.includes(prayer));
}

export function usePrayerNotifications(reconcileOnMount = true): UsePrayerNotifications {
  const { prayerTimes, notifications } = useFaithRepositories();
  const { preferences, ready, update } = useFaithPreferences();
  const [status, setStatus] = useState<PrayerAlertStatus | null>(null);
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
    obligatoryEnabled(preferences).join(','),
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
        enabledPrayers: obligatoryEnabled(current),
        settings: {
          method: current.calculationMethod,
          asr: current.asrMethod,
          offsetsMinutes: {},
        },
      },
    );
    setStatus(next);
  }, [prayerTimes, notifications]);

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

  const setPrayerEnabled = useCallback(
    async (prayer: PrayerKey, enabled: boolean) => {
      /*
        Enabling the first prayer is what triggers the permission request when the master switch is
        already on but nothing has ever been scheduled — the other half of "only after the user
        explicitly enables their first prayer alert".
      */
      if (
        enabled &&
        getFaithPreferencesSnapshot().preferences.prayerNotificationsEnabled &&
        (await notifications.getPermission()) !== 'granted'
      ) {
        await requestPrayerAlertPermission(notifications);
      }

      /*
        ── A functional update, not a computed array ─────────────────────────
        This used to map over `preferences.prayerNotifications` captured from the render that created
        the callback, then write the whole array. Two switches tapped in quick succession therefore
        both derived from the same pre-toggle array and the second write erased the first — the user
        saw one of their two prayers silently switch itself back off. Deriving inside the updater
        means the store applies it to whatever the previous mutation left behind, and the store
        serialises mutations so there is a "previous" to speak of.
      */
      await update((current) => ({
        prayerNotifications: current.prayerNotifications.map((entry) =>
          entry.prayer === prayer ? { ...entry, enabled } : entry,
        ),
      }));
      /* No reconcile call here either — see `setMasterEnabled`. The write drives it. */
    },
    [notifications, update],
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
    });
    return identifier !== null;
  }, [notifications]);

  return {
    status,
    busy,
    setMasterEnabled,
    setPrayerEnabled,
    refreshSchedule,
    sendTestNotification,
    openSystemSettings: useCallback(() => notifications.openSystemSettings(), [notifications]),
  };
}
