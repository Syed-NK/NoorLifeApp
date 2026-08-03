import type { SecurityErrorCode } from '@services/account/account-security.contract';
import { legalConfig, productConfig, supportConfig } from '@shared/config/app-config';

/**
 * Every string on Privacy & Security and its two detail screens.
 *
 * ── Why account-security wording is centralised even harder than the rest ────
 * The other Profile screens describe features. These describe *what happens to a credential and an
 * address*, and a sentence typed inline is a promise nobody reviewed. "We've sent a confirmation"
 * and "your email has been changed" differ by one clause and by everything that matters.
 *
 * The support address and the Privacy Policy URL are read from `@shared/config/app-config` and
 * never written out here — `help-support-config.test.ts` asserts that the configuration file is
 * the only place in the source that spells either of them, so a second copy fails a test.
 *
 * ── The rule every string below follows ─────────────────────────────────────
 * Nothing claims an outcome the backend has not confirmed. Password success is stated only after
 * the update resolves; an email change is always described as *requested*; a global sign-out is
 * described at the scope actually achieved; and account deletion says plainly that it cannot be
 * done yet rather than offering a control that would do something smaller and call it deletion.
 */

export const privacySecurityCopy = {
  title: 'Privacy & Security',
  backLabel: 'Back to Privacy & Security',

  /** ── 1. Account Security ─────────────────────────────────────────────── */
  account: {
    heading: 'Account Security',
    providerLabel: 'Sign-in method',
    providerNames: {
      email: 'Email and password',
      google: 'Google',
      apple: 'Apple',
    },
    /** Shown when the session reports a provider this app does not implement. Never guessed at. */
    providerUnknown: 'Not reported',
    providerUnknownSupporting:
      'Your identity provider did not report a sign-in method, so NoorLife will not guess one.',

    emailLabel: 'Email',
    emailUnknown: 'No email on file',

    verificationLabel: 'Email verification',
    verification: {
      verified: 'Verified',
      'not-verified': 'Not verified',
      unknown: 'Unknown',
    },
    /** Read as a status word, not as a colour. */
    verificationAccessibility: (state: string) => `Email verification, ${state}`,
    notVerifiedSupporting:
      'Confirm your address from the message we sent when you signed up. Some account changes need a confirmed address.',
    verificationUnknownSupporting:
      'NoorLife could not read your verification state. Nothing about your account has changed.',

    lastSignInLabel: 'Last sign-in',
    /** Rendered only when the provider actually reported a date. */
    lastSignInSupporting: 'As reported by your identity provider.',

    changePassword: 'Change Password',
    changeEmail: 'Change Email',

    /** Social identities: the credential is not ours, and the screen says so instead of a form. */
    providerManagedPassword: (provider: string) => `Your password is managed by ${provider}.`,
    providerManagedSupporting: (provider: string) =>
      `${productConfig.name} never receives or stores it. Change it in your ${provider} account settings, and your ${productConfig.name} sign-in follows automatically.`,
    providerManagedEmailSupporting: (provider: string) =>
      `Your ${productConfig.name} sign-in address comes from ${provider}. Changing it there changes it here.`,

    /** No session at all — the screen has nothing honest to show. */
    signedOut: 'Sign in to see your account security.',
    loading: 'Loading your account security',
  },

  /** ── 2. Privacy Controls ─────────────────────────────────────────────── */
  privacy: {
    heading: 'Privacy Controls',
    intro:
      'What NoorLife collects, and where it is kept. Every line below describes this build, not a plan.',
    statusWords: {
      'not-collected': 'Not collected',
      'opt-in-at-use': 'Only when you send it',
      stored: 'Stored',
    },
    scopeWords: {
      device: 'On this device',
      account: 'On your account',
      none: '',
    },
    accountDataHeading: 'Held on your account',
    /**
     * Deliberately not "this is the complete list".
     *
     * That sentence is a claim about every future build as well as this one, and nothing in the
     * application can keep it true — the next feature that adds a column makes yesterday's screen
     * a false statement, silently. Scoping it to the current version says the same useful thing
     * and stays true when the list grows. It is kept honest by `privacy-capabilities.test.ts`,
     * which checks the declared list against what the code actually stores.
     */
    accountDataSupporting:
      'In the current version of NoorLife, the following account information is stored so you can sign in on another device and keep your name and progress:',
    storageHeading: 'Stored on this device',
    /**
     * Deliberately not "removing NoorLife removes everything under these".
     *
     * Uninstalling is not under this application's control, and on both supported platforms it
     * demonstrably does not guarantee deletion:
     *
     *   • Android — `AndroidManifest.xml` declares `android:allowBackup="true"`, and the rules
     *     `expo-secure-store` supplies (`secure_store_backup_rules.xml`,
     *     `secure_store_data_extraction_rules.xml`) include the whole `sharedpref` domain in both
     *     cloud backup and device transfer, excluding only the `SecureStore` file. So preferences
     *     can be copied off the device by Android Auto Backup and restored onto a reinstall or a
     *     new phone.
     *   • iOS — `expo-secure-store` defaults to `kSecAttrAccessibleWhenUnlocked`, which is *not* a
     *     `ThisDeviceOnly` class, so a Keychain item can be carried into an encrypted device
     *     backup and restored elsewhere. Keychain items are also not guaranteed to be removed when
     *     an app is deleted.
     *
     * Neither is a defect — they are the platform behaviours this app opted into by using the
     * standard secure store. What would be a defect is a privacy screen promising the opposite.
     */
    storageSupporting:
      'Most device-local NoorLife data is removed when the app is uninstalled. Your operating system or backup service may retain or restore some settings.',
    encryptionNote:
      'Your data is encrypted in transit and at rest by our hosting provider. It is not end-to-end encrypted, so we do not claim that it is.',
    diagnosticsExclusion:
      'A support message never includes your Faith activity, Quran reading, health, finance, family or goal records, AI conversations, password or sign-in tokens.',
    privacyPolicy: 'Read the Privacy Policy',
    /** The published URL, from centralized configuration. Never written out in this file. */
    privacyPolicyUrl: legalConfig.privacyPolicy,
    privacyPolicyFailed: 'Could not open the Privacy Policy. Check your connection and try again.',
    retry: 'Try Again',
    copyLink: 'Copy Link',
    copied: 'Copied',
  },

  /** ── 3. AI Data & Permissions ────────────────────────────────────────── */
  ai: {
    heading: 'AI Data & Permissions',
    intro:
      'Noor AI helps you use NoorLife. What it may read is decided twice — by your plan, and by your permission — and it needs both.',
    assistantHeading: 'Module assistants',
    accessHeading: 'What Noor AI may read',
    accessWords: {
      allowed: 'Allowed',
      'permission-required': 'Asks first',
      'requires-premium': 'Requires Premium',
    },
    assistantWords: {
      available: 'Available',
      unavailable: 'Requires Premium',
    },
    /** Spoken as one phrase, so a screen reader does not read a module name and a bare status. */
    accessAccessibility: (module: string, state: string) => `${module}, ${state}`,
    asksFirstNote:
      'Noor AI asks for your permission before it reads a module, every time, until you grant it.',
    freeScopeNote:
      'On the free plan Noor AI answers questions about NoorLife itself — finding features, your account and your subscription — and Faith stays completely free.',
    lapsedNote:
      'If a subscription ends, the modules it covered are closed to Noor AI again even if you granted them earlier.',

    boundariesHeading: 'What AI will not do',
    /** Sourced from the shared policy object rather than restated. */
    boundaryLabels: {
      health: 'Health',
      finance: 'Finance',
      faith: 'Faith',
      family: 'Family',
    },
    crossModule:
      'A module assistant never answers about another module on its own. It says so and offers to hand you to Noor AI, which you have to accept.',

    /**
     * The audited answer, scoped to the build that renders it. Verbatim — asserted by test.
     *
     * "NoorLife does not store AI conversation history" reads as a policy. It is not one; it is a
     * fact about what this version happens to do, and the day a feature saves a transcript the
     * sentence becomes false without anybody editing it. Naming the version is what makes the
     * claim maintainable, and the supporting line says plainly that it would change with the
     * behaviour rather than outliving it.
     */
    noHistory:
      'In the current version of NoorLife, no AI conversation history is saved on this device or on your account.',
    noHistorySupporting:
      'There is nothing to delete today, so this screen does not offer a delete control it could not honour. If a future version starts saving conversations, this line changes with it.',

    /** No grant store exists yet, so editing is deferred rather than faked. */
    editingDeferred: 'Choosing permissions in advance is coming later.',
    editingDeferredSupporting:
      'Until then Noor AI asks at the moment it needs a module, and a refusal is respected for that request.',
  },

  /** ── 4. Sessions ─────────────────────────────────────────────────────── */
  sessions: {
    heading: 'Sessions',
    /** Honest about the limit of what can be known. */
    intro:
      'NoorLife can show you this device only. It does not receive a list of your other signed-in devices, so it will not pretend to display one.',
    deviceLabel: 'This device',
    statusLabel: 'Status',
    signedIn: 'Signed in',

    thisDevice: 'Sign Out This Device',
    thisDeviceHint: 'Asks you to confirm before signing out here.',
    thisDeviceTitle: 'Sign out on this device?',
    thisDeviceBody: 'You will need to sign in again to open your account on this phone.',
    thisDeviceConfirm: 'Sign Out',

    allSessions: 'Sign Out All Sessions',
    allSessionsHint: 'Asks you to confirm before signing out everywhere.',
    allSessionsTitle: 'Sign out everywhere?',
    /**
     * What a global sign-out actually achieves. Verbatim — asserted by test.
     *
     * ── Audited against `@supabase/auth-js` 2.111.0, not against expectation ──
     * `signOut({ scope: 'global' })` posts to `/logout?scope=global` through the admin `signOut`
     * helper in `@supabase/auth-js`, which revokes the **refresh** tokens for every session the
     * account holds. It does not and cannot revoke access tokens that have already been issued:
     * those are self-contained JWTs, and the SDK says so in its own doc comment — "the access
     * token JWT will be valid until it's expired … This does not revoke the JWT."
     *
     * So another device stops being able to *renew*, and remains able to act until the token it is
     * already holding expires. "This will sign you out on this and other devices" describes an
     * instant effect that the protocol does not provide, and on a security screen that is the
     * difference between a user who waits a minute before handing their old phone over and one who
     * does not.
     *
     * The wording avoids "token", "JWT" and "refresh" — those are the mechanism, and the user needs
     * the consequence. "Renewing their sessions" and "may remain active briefly" are the same fact
     * in words that do not require knowing what a bearer token is.
     */
    allSessionsWarning:
      'This signs out this device and prevents other devices from renewing their sessions. Another device may remain active briefly.',
    allSessionsBody:
      'This signs out this device and prevents your other devices from renewing their sessions. A device that is already open may stay active for a short time before it is signed out. Nothing is deleted — your account and your data are untouched.',
    allSessionsConfirm: 'Sign Out Everywhere',
    cancel: 'Cancel',

    /**
     * The third outcome. `supabase-js` clears the local session even when the global request
     * fails — `_signOut` calls `removeCurrentSession()` before returning the error for every scope
     * except `others` — so this is the only honest thing to say in that case.
     */
    localOnlyTitle: 'Signed out here only',
    localOnlyBody:
      'You are signed out on this device, but NoorLife could not confirm that your other devices were stopped from renewing their sessions. Try again from any device once you are back online.',
    localOnlyDismiss: 'OK',
  },

  /** ── 5. Account Management ───────────────────────────────────────────── */
  account_management: {
    heading: 'Account Management',
    deleteLabel: 'Delete Account',
    deleteHint: 'Explains why account deletion is not available yet.',

    /** Verbatim — both asserted by test. Nothing here deletes anything. */
    unavailableTitle: 'Account deletion isn’t available yet',
    unavailableBody:
      'NoorLife requires secure server-side verification before an account and its data can be permanently deleted.',
    close: 'Close',
    contactSupport: 'Contact Support',
    /** The centralized address. Never written out in this file. */
    supportEmail: supportConfig.email,
    supportSubject: 'NoorLife account deletion request',
    supportIntro:
      'I would like to request deletion of my NoorLife account. Please tell me what happens next.',
    /** Shown when the device has no mail application. */
    noMailApp: 'No mail app was found on this device. You can reach us at',
    mailFailed: 'The mail app could not be opened. You can reach us at',
    copyEmail: 'Copy Address',
    copied: 'Copied',
  },

  /** ── Change Password — /profile/privacy-security/change-password ─────── */
  password: {
    title: 'Change Password',
    heading: 'New password',
    intro: 'Choose a password you do not use anywhere else.',
    newLabel: 'New password',
    confirmLabel: 'Confirm new password',
    placeholder: '••••••••',
    submit: 'Update Password',
    submitHint: 'Sends your new password to your account.',
    /**
     * Read out in place of `submitHint` while the control is disabled.
     *
     * A greyed button carrying the enabled hint describes the one thing that will not happen. Each
     * message below names what would enable the control instead, keyed by the evaluator's own state
     * so a screen reader is never pointed at a field that is not the obstacle — a session that has
     * expired is not fixed by typing a better password.
     */
    submitDisabledHints: {
      empty: 'Unavailable until you enter a new password and confirm it.',
      'confirm-empty': 'Unavailable until you confirm your new password.',
      weak: 'Unavailable until your new password meets the minimum strength.',
      mismatch: 'Unavailable until both passwords match.',
      submitting: 'Your password change is being sent.',
      'session-unavailable': 'Unavailable because NoorLife cannot confirm your session.',
      'provider-unsupported': 'Unavailable because your password is managed by your sign-in provider.',
    },
    saving: 'Updating your password',
    success: 'Password updated.',
    successSupporting: 'Use your new password the next time you sign in.',

    errors: {
      weak: 'Use at least 8 characters, mixing letters, numbers or symbols.',
      mismatch: 'The two passwords do not match.',
      empty: 'Enter a new password.',
      /**
       * Separate from `empty`.
       *
       * "Enter a new password" under a confirmation field the user has not reached yet reads as a
       * complaint about the box above it, which they have already filled in.
       */
      confirmEmpty: 'Re-enter your new password to confirm it.',
    },

    /**
     * Reauthentication.
     *
     * Only ever shown after the backend has asked for it. The app does not predict the
     * requirement, so this section does not exist until Supabase says it must.
     */
    reauth: {
      heading: 'Confirm it is you',
      /** States who imposed the requirement, so it does not read as an app quirk. */
      required:
        'For your security, your account requires a fresh confirmation before the password can change.',
      send: 'Email Me a Code',
      sending: 'Sending your code',
      sent: 'We have emailed you a confirmation code. Enter it below, then update your password.',
      codeLabel: 'Confirmation code',
      codePlaceholder: '000000',
      resend: 'Send Another Code',
      missingCode: 'Enter the code we emailed you.',
    },

    /** Social identity — no form at all, and a sentence instead. */
    providerManagedTitle: (provider: string) => `Your password is managed by ${provider}.`,
    providerManagedBody: (provider: string) =>
      `You did not create a ${productConfig.name} password, so there is nothing here to change. Manage your password in your ${provider} account settings.`,
    back: 'Back to Privacy & Security',
  },

  /** ── Change Email — /profile/privacy-security/change-email ───────────── */
  email: {
    title: 'Change Email',
    currentLabel: 'Current email',
    currentSupporting: 'This is the address you sign in with today. It does not change yet.',
    newLabel: 'New email',
    newPlaceholder: 'you@example.com',
    /** The full truth about the flow, before the user starts it. */
    intro:
      'Changing your sign-in address needs to be confirmed. We will email both your current address and the new one, and your sign-in stays on the current address until both are confirmed.',
    submit: 'Send Confirmation',
    submitHint: 'Emails a confirmation to your current and new addresses.',
    /**
     * Read out in place of `submitHint` while the control is disabled.
     *
     * A greyed button with the enabled hint tells a screen-reader user what pressing it would do,
     * which is the one thing that will not happen. This says what would enable it instead.
     */
    submitDisabledHint:
      'Unavailable until you enter a valid email address that is different from your current one.',
    saving: 'Requesting your email change',

    pendingTitle: 'Confirmation sent',
    /** Never says the address changed — it has not. */
    pending: (address: string) =>
      `We have emailed a confirmation to ${address} and to your current address. Your sign-in address stays the same until both are confirmed.`,
    pendingRowLabel: 'Awaiting confirmation',
    pendingSupporting: 'Your sign-in address has not changed yet.',

    /**
     * The delivery limitation, stated once and honestly.
     *
     * Production email delivery is not configured for this project, so a confirmation may not
     * arrive. Saying so is better than a user waiting for a message that is not coming — and it
     * exposes no configuration detail.
     */
    deliveryNote:
      'Email delivery is still being set up for NoorLife. If a confirmation does not arrive, contact support rather than requesting another one.',

    errors: {
      empty: 'Enter your new email address.',
      invalid: 'Enter a valid email address.',
      unchanged: 'That is already your email address.',
    },

    providerManagedTitle: (provider: string) => `Your email is managed by ${provider}.`,
    providerManagedBody: (provider: string) =>
      `You sign in to ${productConfig.name} with ${provider}, so your address comes from there. Change it in your ${provider} account settings.`,
    back: 'Back to Privacy & Security',
  },

  /**
   * One message per mapped failure.
   *
   * A closed record over `SecurityErrorCode`, so a new code cannot be added to the service without
   * this failing to compile — which is what stops an unmapped backend message reaching a screen.
   */
  errors: {
    offline: 'You appear to be offline. Check your connection and try again.',
    'invalid-credentials': 'That did not match our records. Please try again.',
    'weak-password': 'Choose a stronger password — at least 8 characters with a mix of types.',
    'same-password': 'That is already your current password. Choose a different one.',
    'reauthentication-required':
      'For your security, confirm it is you before changing your password.',
    'invalid-reauthentication-code':
      'That code was not accepted. Request a new one and try again.',
    'invalid-email': 'Enter a valid email address.',
    /** Deliberately no wider than what Supabase was willing to disclose. */
    'email-already-used': 'That address cannot be used. Try a different one.',
    'rate-limited': 'Too many attempts. Wait a moment and try again.',
    'session-expired': 'Your session has expired. Sign in again to continue.',
    'provider-unsupported': 'Your sign-in provider does not support this change.',
    'server-unavailable': 'NoorLife could not reach the server. Try again shortly.',
    'not-configured': 'This build is not connected to an account service.',
    unknown: 'Something went wrong. Nothing was changed — please try again.',
  } satisfies Record<SecurityErrorCode, string>,
} as const;
