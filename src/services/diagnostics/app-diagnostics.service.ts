import * as Application from 'expo-application';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import { Platform } from 'react-native';

/**
 * The four facts NoorLife is willing to attach to a support message.
 *
 * ── Why this is an allow-list and not a redaction pass ──────────────────────
 * A denylist ("strip the token, strip the email") is only ever as complete as the last person to
 * think about it, and the cost of missing one entry is a user's access token pasted into a mail
 * draft. So the shape is inverted: `AppDiagnostics` has exactly four fields, every one of them a
 * property of the *build* rather than of the person, and the report is assembled from that object
 * alone. There is no code path that could add a fifth — adding one means editing this type, which
 * fails `help-support-config.test.ts` until the new field is justified.
 *
 * Never here, and asserted absent by that suite: access or refresh tokens, Supabase keys or
 * project identifiers, passwords, the signed-in email address, health, finance, planner or Quran
 * activity, family data, Noor AI conversations, and any device or advertising identifier. None of
 * it would help diagnose a bug, and all of it would be sitting in a mailbox afterwards.
 *
 * ── Why the version is read rather than written ─────────────────────────────
 * `expo-application` returns what the installed package actually declares — `versionName` and
 * `versionCode` from the Android build, `CFBundleShortVersionString` and `CFBundleVersion` on iOS.
 * A constant in TypeScript would be a *claim* about the build, and the first release where
 * somebody bumps gradle and forgets the constant is the release where every support email carries
 * the wrong version. The Expo config is the fallback and is itself read, not typed out.
 */

export type AppDiagnostics = {
  /** The user-facing version, e.g. "1.0.0". */
  readonly appVersion: string;
  /** The build identifier — Android `versionCode`, iOS `CFBundleVersion`. */
  readonly buildNumber: string;
  /** "Android" or "iOS", never a device model. */
  readonly platform: string;
  /**
   * The operating-system release, e.g. "17".
   *
   * The *release*, not the API level. `Platform.Version` returns 37 on Android 17, which is the
   * right number for a developer and the wrong one to put under a label reading "OS version" on a
   * user-facing card — the device pass caught it showing "Android 37". `Device.osVersion` returns
   * what the user's own Settings screen shows, and `Platform.Version` remains the fallback for a
   * host where it is unavailable.
   *
   * Only `osVersion` is read from `expo-device`. That module also exposes the model, the brand and
   * the manufacturer, none of which are on the allow-list.
   */
  readonly osVersion: string;
};

/** The complete set of fields a diagnostic report may contain. Asserted by test. */
export const DIAGNOSTIC_FIELDS = [
  'appVersion',
  'buildNumber',
  'platform',
  'osVersion',
] as const satisfies readonly (keyof AppDiagnostics)[];

/** Shown where a value genuinely could not be read, rather than guessing at one. */
export const DIAGNOSTIC_UNKNOWN = 'Unknown';

const PLATFORM_NAMES: Readonly<Record<string, string>> = {
  android: 'Android',
  ios: 'iOS',
  web: 'Web',
};

export function readAppDiagnostics(): AppDiagnostics {
  return {
    appVersion:
      // The installed package first; the Expo config only when the native value is unavailable,
      // which is the case under Jest and in a web bundle.
      Application.nativeApplicationVersion ?? Constants.expoConfig?.version ?? DIAGNOSTIC_UNKNOWN,
    buildNumber: Application.nativeBuildVersion ?? DIAGNOSTIC_UNKNOWN,
    platform: PLATFORM_NAMES[Platform.OS] ?? Platform.OS,
    osVersion:
      Device.osVersion ??
      (Platform.Version === undefined ? DIAGNOSTIC_UNKNOWN : String(Platform.Version)),
  };
}

const FIELD_LABELS: Readonly<Record<keyof AppDiagnostics, string>> = {
  appVersion: 'App version',
  buildNumber: 'Build',
  platform: 'Platform',
  osVersion: 'OS version',
};

/**
 * The report, as plain text.
 *
 * Built by walking `DIAGNOSTIC_FIELDS` rather than by writing four lines out, so the string and
 * the allow-list cannot disagree. This is the exact text used both for the clipboard and for the
 * body of a support mail draft — one composer, so the two can never carry different information.
 */
export function formatDiagnostics(diagnostics: AppDiagnostics): string {
  return DIAGNOSTIC_FIELDS.map((field) => `${FIELD_LABELS[field]}: ${diagnostics[field]}`).join(
    '\n',
  );
}
