/**
 * Every string on Preferences — `/profile/preferences`.
 *
 * ── The rule this file is written under ─────────────────────────────────────
 * A preferences screen is the easiest place in an application to lie. Four switches that remember
 * their positions look finished, review well and control nothing, and nobody discovers it until a
 * user turns notifications on and waits for a reminder that no code exists to send.
 *
 * So each of the four areas below says exactly what NoorLife can do today. Where a capability is
 * missing the copy names the *condition* for it arriving — "when NoorLife reminders are connected"
 * — rather than "coming soon", because a condition is information and a promise is not. Three of
 * the four sentences here are asserted character-for-character by
 * `__tests__/preferences-screen.test.tsx`, so the honest wording cannot be softened later without
 * a test failing.
 */
export const preferencesCopy = {
  title: 'Preferences',

  /**
   * ── Notifications ─────────────────────────────────────────────────────────
   * The audit behind this section: no notification library, no push-token registration, no
   * scheduling, no backend, and no `POST_NOTIFICATIONS` declaration in the Android manifest. The
   * status is therefore reported as unavailable rather than invented, and there are no category
   * switches at all — see `notification-permission.service.ts` for why reading the Android runtime
   * permission anyway would have produced a fabricated denial rather than a real one.
   */
  notifications: {
    heading: 'Notifications',
    statusLabel: 'Device permission',
    status: {
      allowed: 'Allowed',
      notAllowed: 'Not allowed',
      notRequested: 'Not requested',
      unavailable: 'Unavailable',
      checking: 'Checking…',
    },
    /** Spoken with the value, so the status is never carried by position alone. */
    statusAccessibilityLabel: (status: string) => `Notification permission, ${status}`,
    allow: 'Allow Notifications',
    allowHint: 'Asks your device for permission to show NoorLife notifications.',
    requesting: 'Requesting permission',
    openSettings: 'Open Settings',
    openSettingsHint: 'Opens NoorLife’s permissions in your device settings.',
    /**
     * The honest note. Verbatim — asserted by a test.
     *
     * It is shown whenever NoorLife cannot actually deliver a notification, which is every build
     * so far, including one where the operating system had granted permission.
     */
    unavailableNote:
      'Notification preferences will become available when NoorLife reminders are connected.',
    /** Shown when the settings app could not be opened, rather than leaving a dead press. */
    settingsUnavailable: 'Your device did not open its settings app.',
    deniedNote: 'Notifications are turned off for NoorLife in your device settings.',
  },

  /**
   * ── Language ──────────────────────────────────────────────────────────────
   * The audit: `LocalizationProvider` is a boundary, not an implementation. It knows a locale's
   * direction and script, and there is no message catalogue behind it — every string in the
   * application, including this one, is written in English in the source. So English is the
   * current language because it is the only one, and Arabic is deferred rather than offered.
   *
   * The Quran sentence exists because the confusion is real and specific: NoorLife already renders
   * Arabic scripture, which makes "the app has Arabic" look true. It does not follow that the
   * interface is translated, and a user who selects Arabic expecting the app to change language
   * would be misled by a control that only ever changed a setting.
   */
  language: {
    heading: 'Language',
    currentLabel: 'App language',
    english: 'English',
    arabic: 'Arabic',
    comingLater: 'Coming later',
    /** Verbatim — asserted by a test. */
    interfaceNote:
      'NoorLife’s interface is available in English. Arabic interface translation is coming later.',
    /** Verbatim — asserted by a test. */
    quranNote:
      'Quran and du‘a content is already shown in Arabic. That is the scripture itself, not the app’s interface language.',
    /** Spoken for the deferred row so its state is not carried by the marker alone. */
    arabicAccessibilityLabel: 'Arabic, coming later',
  },

  /**
   * ── Appearance ────────────────────────────────────────────────────────────
   * The audit: the design lock specifies a light theme on a neutral canvas, `useColorScheme` reads
   * the OS scheme but nothing branches on it, and no token in `@ds/tokens` has a dark counterpart.
   * A switch here would therefore darken this screen and leave Main Home, Faith, the subscription
   * flow and every module light — which is not a dark theme, it is a bug with a control attached.
   */
  appearance: {
    heading: 'Appearance',
    currentLabel: 'Theme',
    light: 'Light',
    system: 'System',
    dark: 'Dark',
    comingLater: 'Coming later',
    active: 'Active',
    /** Verbatim — asserted by a test. */
    note: 'NoorLife currently uses one light theme across every screen. System and Dark arrive when the full dark theme is ready.',
    systemAccessibilityLabel: 'System theme, coming later',
    darkAccessibilityLabel: 'Dark theme, coming later',
    lightAccessibilityLabel: 'Light theme, active',
  },

  /**
   * ── Accessibility ─────────────────────────────────────────────────────────
   * The one section with a control that genuinely does something. Reduce Motion is persisted
   * through the shared preference service and consumed through `useReducedMotion`, which every
   * animation in the application already reads — so switching it on removes the dialog fades on
   * Profile immediately, with no restart.
   *
   * The claim is bounded on purpose. "Reduces animation across NoorLife" is what the switch does
   * to the animations that exist; nothing here says the application has been audited for
   * accessibility compliance, because it has not been.
   */
  accessibility: {
    heading: 'Accessibility',

    reduceMotion: {
      label: 'Reduce Motion',
      supporting: 'Removes the fades and transitions NoorLife uses.',
      /** Shown instead of the switch while the stored value is still being read. */
      loading: 'Loading your settings',
      /** Storage failed — the switch is not drawn, because its position would be a guess. */
      unavailable: 'Your saved settings could not be read.',
      retry: 'Retry',
      saveFailed: 'This change could not be saved and will not survive a restart.',
      /** Shown when the OS setting is on: the switch is redundant and says so rather than lying. */
      systemOverride: 'Reduce Motion is on in your device settings, so it applies to NoorLife too.',
      accessibilityHint: 'Reduces animation inside NoorLife.',
    },

    textSize: {
      label: 'Text size',
      /** Verbatim — asserted by a test. There is deliberately no in-app slider. */
      supporting:
        'NoorLife follows the text size in your device settings, so changing it there changes it here.',
      openSettings: 'Open Device Settings',
      openSettingsHint: 'Opens your device settings, where text size is changed.',
      unavailable: 'Your device did not open its settings app.',
    },

    screenReader: {
      label: 'Screen readers',
      /** States support, never certification. */
      supporting:
        'NoorLife works with TalkBack and VoiceOver. Controls are labelled and headings are announced.',
    },
  },

  /** Shown while the screen's own state is still resolving, at the resolved geometry. */
  loadingAccessibilityLabel: 'Loading your preferences',
} as const;
