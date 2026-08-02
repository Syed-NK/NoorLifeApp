import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import {
  notificationPermissionService,
  type NotificationCapability,
  type NotificationPermissionPort,
  type NotificationPermissionStatus,
} from '@services/notifications/notification-permission.service';

/**
 * The rules around notification permission, separated from whether the permission exists.
 *
 * ── Why these live in a hook and are tested today ───────────────────────────
 * The shipped port reports `unavailable`, because this build has no notification stack (see
 * `notification-permission.service.ts` for that audit). What it does *not* have is an excuse to
 * leave the behaviour unwritten, because the behaviour is the part that is easy to get wrong:
 *
 *   1. **Never prompt on mount.** A permission dialog that appears because the user opened
 *      Preferences is a dialog they did not ask for, and on Android a refusal there is permanent
 *      — the system will not show the prompt a third time. Opening a settings screen must not be
 *      able to spend the user's one remaining answer.
 *   2. **Exactly one prompt per press.** `requesting` is held in a ref, not only in state: two
 *      quick presses would otherwise both pass a state check that had not re-rendered yet, and
 *      the second `request()` would resolve against a dialog that is already open.
 *   3. **A refusal offers the settings app**, because once refused the prompt is gone and the
 *      settings screen is the only route left.
 *   4. **Returning to the app re-reads.** The user may have changed the permission in settings, in
 *      which case the status on screen is now a stale claim about their device.
 *
 * Every one of those is driven by a fake port in `__tests__/notification-permission.test.tsx`.
 * When reminders are connected, a real port is written and none of this changes.
 */

export type NotificationPermissionState = {
  /** `'checking'` only before the first read resolves. */
  readonly status: NotificationPermissionStatus | 'checking';
  readonly capability: NotificationCapability;
  /** A permission request is in flight. */
  readonly isRequesting: boolean;
  /** The last attempt to open the settings app failed. */
  readonly settingsUnavailable: boolean;
};

export type NotificationPermissionControls = NotificationPermissionState & {
  /** Only ever called from an explicit press. Requests once, or does nothing. */
  requestPermission(): Promise<void>;
  openSettings(): Promise<void>;
  refresh(): Promise<void>;
};

export function useNotificationPermission(
  port: NotificationPermissionPort = notificationPermissionService,
): NotificationPermissionControls {
  const [status, setStatus] = useState<NotificationPermissionStatus | 'checking'>('checking');
  const [isRequesting, setIsRequesting] = useState(false);
  const [settingsUnavailable, setSettingsUnavailable] = useState(false);

  // Guards rule 2 without waiting for a render, and survives the unmount check below.
  const requestInFlight = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    // A read, never a request. This is the only thing that happens on mount.
    const next = await port.read().catch<NotificationPermissionStatus>(() => 'unavailable');
    if (mounted.current) {
      setStatus(next);
    }
  }, [port]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /**
   * Rule 4 — re-read when the application comes back to the foreground.
   *
   * Not conditional on having opened the settings app ourselves: the user may have changed the
   * permission from the notification shade, from a system prompt in another app, or from settings
   * they reached without us. Any return to the foreground is a moment the displayed status could
   * have become false.
   */
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') {
        void refresh();
      }
    });
    return () => subscription.remove();
  }, [refresh]);

  const requestPermission = useCallback(async () => {
    if (!port.capability.canRequest || requestInFlight.current) {
      return;
    }
    requestInFlight.current = true;
    setIsRequesting(true);
    try {
      const next = await port.request().catch<NotificationPermissionStatus>(() => 'unavailable');
      if (mounted.current) {
        setStatus(next);
      }
    } finally {
      requestInFlight.current = false;
      if (mounted.current) {
        setIsRequesting(false);
      }
    }
  }, [port]);

  const openSettings = useCallback(async () => {
    setSettingsUnavailable(false);
    const opened = await port.openSettings().catch(() => false);
    if (mounted.current && !opened) {
      // Reported rather than swallowed: a press that does nothing looks like a broken button.
      setSettingsUnavailable(true);
    }
  }, [port]);

  return {
    status,
    capability: port.capability,
    isRequesting,
    settingsUnavailable,
    requestPermission,
    openSettings,
    refresh,
  };
}
