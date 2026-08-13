import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import {
  prayerAlertChannel,
  reconcilePrayerAlerts,
  requestPrayerAlertPermission,
  type PrayerAlertStatus,
} from '../data/notifications/prayer-notifications.service';
import { OBLIGATORY_PRAYERS, type PrayerKey } from '../data/prayer-times.repository';
import { useFaithRepositories } from '../di/faith-repository-context';
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
export function usePrayerNotifications(reconcileOnMount = true): UsePrayerNotifications {
  const { prayerTimes, notifications } = useFaithRepositories();
  const { preferences, update } = useFaithPreferences();
  const [status, setStatus] = useState<PrayerAlertStatus | null>(null);
  const [busy, setBusy] = useState(false);

  const enabledPrayers = preferences.prayerNotifications
    .filter((entry) => entry.enabled)
    .map((entry) => entry.prayer)
    /* Belt and braces: sunrise is not offered as a switch and could not reach here anyway. */
    .filter((prayer) => OBLIGATORY_PRAYERS.includes(prayer));

  const settings = {
    method: preferences.calculationMethod,
    asr: preferences.asrMethod,
    offsetsMinutes: {},
  };

  /*
    Read through refs so the reconcile callback stays stable. Without this, every preference change
    would produce a new callback, restart the mount effect and run a second reconciliation against
    the same inputs — which on a real platform means cancelling and re-creating 35 alarms.
  */
  const latest = useRef({
    masterEnabled: preferences.prayerNotificationsEnabled,
    enabledPrayers,
    settings,
  });
  /*
    Assigned in an effect rather than during render — writing a ref in the render body is a side
    effect in a function React may call more than once per commit. Declared before the effect that
    reconciles, so the values are current by the time that one runs.
  */
  useEffect(() => {
    latest.current = {
      masterEnabled: preferences.prayerNotificationsEnabled,
      enabledPrayers,
      settings,
    };
  });

  /**
   * The reconciliation itself. Touches state only *after* the platform work has completed.
   *
   * ── Why the busy flag is not set here ───────────────────────────────────────
   * This is called from an effect body, and setting state synchronously inside one cascades a
   * render. The automatic passes — on mount and on foreground — do not need a spinner anyway: the
   * screen is already rendering the previous status and nothing about it is stale enough to hide.
   * The flag belongs to the *user-initiated* path, where somebody pressed something and is waiting.
   */
  const reconcile = useCallback(async () => {
    const next = await reconcilePrayerAlerts(
      { prayerTimes, notifications, now: () => new Date() },
      latest.current,
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

  /* On mount, and on every return to the foreground. See the note above for why those two. */
  useEffect(() => {
    if (reconcileOnMount) {
      void reconcile();
    }
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void reconcile();
      }
    });
    return () => subscription.remove();
  }, [reconcile, reconcileOnMount]);

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
      await update({ prayerNotificationsEnabled: enabled });
      latest.current = { ...latest.current, masterEnabled: enabled };
      await reconcile();
    },
    [notifications, update, reconcile],
  );

  const setPrayerEnabled = useCallback(
    async (prayer: PrayerKey, enabled: boolean) => {
      const nextPreferences = preferences.prayerNotifications.map((entry) =>
        entry.prayer === prayer ? { ...entry, enabled } : entry,
      );
      const nextEnabled = nextPreferences
        .filter((entry) => entry.enabled)
        .map((entry) => entry.prayer);

      /*
        Enabling the first prayer is what triggers the permission request when the master switch is
        already on but nothing has ever been scheduled — the other half of "only after the user
        explicitly enables their first prayer alert".
      */
      if (
        enabled &&
        latest.current.masterEnabled &&
        (await notifications.getPermission()) !== 'granted'
      ) {
        await requestPrayerAlertPermission(notifications);
      }

      await update({ prayerNotifications: nextPreferences });
      latest.current = { ...latest.current, enabledPrayers: nextEnabled };
      await reconcile();
    },
    [notifications, preferences.prayerNotifications, update, reconcile],
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
