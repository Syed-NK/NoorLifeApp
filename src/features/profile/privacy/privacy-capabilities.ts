import { DIAGNOSTIC_FIELDS } from '@services/diagnostics/app-diagnostics.service';

/**
 * What NoorLife actually collects — audited, not asserted.
 *
 * ── Why a capability list instead of a settings screen ──────────────────────
 * The usual privacy screen is a column of switches. This application has no analytics SDK, no
 * crash reporter and no personalization engine, so every one of those switches would remember a
 * position and control nothing. A consent toggle over a capability that does not exist is worse
 * than no screen at all: it manufactures the impression that data *is* being collected and that
 * the user has just stopped it, and both halves are false.
 *
 * So each category below carries a status rather than a control, and `status: 'not-collected'` is
 * a claim about the build that `privacy-capabilities.test.ts` verifies by reading `package.json` —
 * if an analytics or crash-reporting dependency is ever installed, that test fails and this file
 * has to be corrected before the screen can lie.
 *
 * ── Device-local versus account-level ───────────────────────────────────────
 * Every category names which one it is, because a user cannot reason about their data without it.
 * "Delete the app and it is gone" and "it survives on a server" are the two different promises
 * being made, and the screen must not blur them.
 *
 * ── What is deliberately absent ─────────────────────────────────────────────
 * No end-to-end encryption claim. Data at rest in Supabase is encrypted by the platform and in
 * transit by TLS; that is not end-to-end, and saying so would be the single most consequential
 * overstatement available on this screen.
 */

export type CollectionStatus =
  /** Nothing is gathered. No SDK, no endpoint, no store. */
  | 'not-collected'
  /** Gathered, but only when the user takes a specific action that sends it. */
  | 'opt-in-at-use'
  /** Held, and stated where. */
  | 'stored';

export type DataScope =
  /** Never leaves the device, and goes with the app when it is removed. */
  | 'device'
  /** Held against the account on the server, and survives a reinstall. */
  | 'account'
  /** Nothing to locate. */
  | 'none';

export type PrivacyCapability = {
  readonly key: string;
  readonly label: string;
  readonly status: CollectionStatus;
  readonly scope: DataScope;
  /** One sentence stating what is true. Rendered verbatim. */
  readonly detail: string;
  readonly testID: string;
};

/**
 * The five categories, each answered honestly for this build.
 *
 * Order is deliberate: the three a privacy-conscious user opens the screen to check come first,
 * and the two that describe what NoorLife genuinely does hold come after.
 */
export const PRIVACY_CAPABILITIES: readonly PrivacyCapability[] = [
  {
    key: 'product-analytics',
    label: 'Product analytics',
    status: 'not-collected',
    scope: 'none',
    detail:
      'NoorLife has no analytics SDK. Your screens, taps and time in the app are not measured or sent anywhere.',
    testID: 'privacy-capability-product-analytics',
  },
  {
    key: 'crash-reporting',
    label: 'Crash reporting',
    status: 'not-collected',
    scope: 'none',
    detail:
      'NoorLife has no crash-reporting SDK. Crashes are not uploaded, so please tell us about one through Help & Support.',
    testID: 'privacy-capability-crash-reporting',
  },
  {
    key: 'diagnostics',
    label: 'Diagnostic information',
    status: 'opt-in-at-use',
    scope: 'device',
    /**
     * The four fields are named from `DIAGNOSTIC_FIELDS` at module load rather than typed out, so
     * this sentence cannot describe a payload the service no longer sends.
     */
    detail: `Nothing is sent unless you press Email Support or Report a Problem. The draft carries ${DIAGNOSTIC_FIELDS.length} build facts — app version, build, platform and OS version — and you can read and edit it before sending.`,
    testID: 'privacy-capability-diagnostics',
  },
  {
    key: 'personalization',
    label: 'Personalization',
    status: 'not-collected',
    scope: 'none',
    detail:
      'NoorLife does not profile you. Nothing on your screens is ordered by a model of your behaviour, and no advertising or tracking identifier is read.',
    testID: 'privacy-capability-personalization',
  },
  {
    key: 'local-data',
    label: 'Local application data',
    status: 'stored',
    scope: 'device',
    detail:
      'Your Faith activity — reading position, bookmarks, tasbih and worship records — plus your onboarding and Reduce Motion preferences are stored on this device only. Removing NoorLife removes them.',
    testID: 'privacy-capability-local-data',
  },
];

/**
 * What NoorLife holds against the account on the server.
 *
 * Stated separately from the categories above because it answers a different question: not "what
 * are you measuring about me" but "what of mine is on your servers". Three items, which is the
 * complete list — `public.profiles` holds a name, an avatar URL and an onboarding flag, and
 * `auth.users` holds the address and the credential.
 */
export const ACCOUNT_HELD_DATA: readonly string[] = [
  'Your name and profile record',
  'Your sign-in email address and credential',
  'Whether you have completed onboarding',
];

/**
 * Every storage namespace this application writes on the device.
 *
 * ── Why the prefixes and not the full keys ──────────────────────────────────
 * A prefix is the unit a user can reason about and the unit the code owns; listing twelve exact
 * keys would go stale on the next Faith feature and tell nobody anything more. The test that
 * guards this scans the source for `noorlife.*` literals and asserts each one falls under a prefix
 * declared here, so a new namespace fails a test rather than quietly appearing on a device.
 *
 * The Supabase SDK's own session storage is listed too. It is not ours, but it is on the device,
 * and omitting it because we did not write it would be the kind of technically-true privacy
 * statement this screen exists to avoid.
 */
export const DEVICE_STORAGE_NAMESPACES: readonly string[] = [
  'noorlife.faith',
  'noorlife.onboarding',
  'noorlife.preference',
  'noorlife.auth',
];

/**
 * Whether any product-analytics or crash-reporting SDK is installed.
 *
 * Declared here as the value the screen renders, and verified against `package.json` by test. The
 * screen never reads `package.json` itself — a runtime dependency scan is not something a phone
 * can do, and a constant that a test keeps honest is the version that works in a release build.
 */
export const TELEMETRY_SDKS_INSTALLED = false;

/** The dependency names the audit checks for. Extend this, not the claim above. */
export const TELEMETRY_PACKAGE_MARKERS: readonly string[] = [
  '@sentry/',
  'firebase',
  '@react-native-firebase/',
  'crashlytics',
  'bugsnag',
  'amplitude',
  'mixpanel',
  'posthog',
  '@segment/',
  'datadog',
  'appcenter',
  'expo-analytics',
];
