import * as Linking from 'expo-linking';

/**
 * What NoorLife can honestly say about notifications today.
 *
 * ── The audit this module encodes ───────────────────────────────────────────
 * There is no notification library in the dependency list, no push-token registration, no
 * scheduling code and no notification backend. `AndroidManifest.xml` does not declare
 * `POST_NOTIFICATIONS`. Nothing in the application has ever asked the operating system for
 * permission to notify, and nothing in it could deliver a notification if permission were granted.
 *
 * Two designs were rejected on the way here:
 *
 *   • **Category toggles.** "Prayer reminders", "Habit nudges", a switch each, persisted to
 *     storage. They would remember their positions perfectly and control nothing. That is the
 *     definition of a fake control, and the brief forbids it.
 *
 *   • **Reading `PermissionsAndroid.check('POST_NOTIFICATIONS')` anyway.** It returns `false` for
 *     a permission the manifest never declared, which is indistinguishable from a user who
 *     refused. Rendering that as "Not allowed" would be a fabricated denial, and offering
 *     "Open Settings" to fix it would send the user to a screen with nothing to change.
 *
 * So the shipped capability is `unavailable`, and the screen says so in a sentence.
 *
 * ── Why the port exists all the same ────────────────────────────────────────
 * The interesting behaviour is not the status; it is the *rules* around it — never request on
 * mount, request exactly once per explicit press, fall back to Open Settings on refusal, re-read
 * on return from the settings app. Those rules are the part that will still be wrong in six months
 * if they are written when reminders land instead of now.
 *
 * They therefore live in the hook that consumes this port, and the tests drive them through a
 * fake adapter. When reminders are connected, a real adapter is written against
 * `NotificationPermissionPort` and `NOTIFICATION_DELIVERY` flips — the screen, the hook and the
 * rules do not change.
 */

export type NotificationPermissionStatus =
  /** The operating system permits NoorLife to post notifications. */
  | 'allowed'
  /** Asked and refused, or turned off later in the settings app. */
  | 'not-allowed'
  /** Never asked. The user has made no decision to respect yet. */
  | 'not-requested'
  /** This build cannot ask, and cannot read an answer that would mean anything. */
  | 'unavailable';

export type NotificationCapability = {
  /** Whether a status read returns a meaningful answer at all. */
  readonly canReadStatus: boolean;
  /** Whether an explicit "Allow Notifications" press can reach a real permission prompt. */
  readonly canRequest: boolean;
  /** Whether the device settings screen can be opened from here. */
  readonly canOpenSettings: boolean;
  /** Whether anything in NoorLife could actually deliver a notification. */
  readonly canDeliver: boolean;
};

export type NotificationPermissionPort = {
  readonly capability: NotificationCapability;
  /** Reads current status. Never prompts. */
  read(): Promise<NotificationPermissionStatus>;
  /** Prompts, exactly once per call. Only ever called from an explicit user action. */
  request(): Promise<NotificationPermissionStatus>;
  /** Opens the operating system's settings page for NoorLife. */
  openSettings(): Promise<boolean>;
};

/**
 * The single fact the rest of the module derives from.
 *
 * `false` for every capability that would require a notification stack this build does not have.
 * Opening device settings is the one thing that genuinely works — `Linking.openSettings` is real
 * — but it is not offered while the status is `unavailable`, because there would be nothing there
 * for the user to change.
 */
export const NOTIFICATION_CAPABILITY: NotificationCapability = {
  canReadStatus: false,
  canRequest: false,
  canOpenSettings: true,
  canDeliver: false,
};

/**
 * The port this build ships.
 *
 * Reports `unavailable` without touching a native module, because there is no native module to
 * touch. `request` returns the same thing rather than throwing: a caller that reaches it has a bug
 * in its capability check, and crashing the Preferences screen is a worse way to surface that than
 * an unchanged status.
 */
export function createNotificationPermissionService(): NotificationPermissionPort {
  return {
    capability: NOTIFICATION_CAPABILITY,
    read: () => Promise.resolve('unavailable'),
    request: () => Promise.resolve('unavailable'),
    openSettings: async () => {
      try {
        await Linking.openSettings();
        return true;
      } catch {
        // Some Android launchers and every emulator without a settings app refuse the intent.
        return false;
      }
    },
  };
}

/** The shared instance. One object, so no screen constructs its own view of the capability. */
export const notificationPermissionService = createNotificationPermissionService();
