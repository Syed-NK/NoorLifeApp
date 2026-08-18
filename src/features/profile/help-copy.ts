import { legalConfig, productConfig, supportConfig } from '@shared/config/app-config';

/**
 * Every string on Help & Support — `/profile/help`.
 *
 * ── Where the addresses come from ───────────────────────────────────────────
 * Not from here. The support address, both policy URLs and the company website are imported from
 * `@shared/config/app-config`, which is the single source of truth, and
 * `__tests__/help-support-config.test.ts` asserts that no source file outside that config contains
 * any of those literals — including this one, and including its comments. A support screen is
 * exactly where a second copy would appear, so this is the file the rule most needs to hold in.
 *
 * ── The production/development line ─────────────────────────────────────────
 * Purchases run through a development mock adapter. That is a true and useful thing for a tester
 * to know and a confusing, alarming thing for a user to read, so it is not in this file at all —
 * the development-only wording lives in `help-faq.ts` behind an explicit `__DEV__` flag, and a
 * test proves the production answer set contains no mention of it.
 */
export const helpCopy = {
  title: 'Help & Support',

  /** The header's own Help control is omitted on this screen — see `help-support-screen.tsx`. */
  faq: {
    heading: 'Help Center',
    /** Spoken on a collapsed row, replaced when it opens. */
    expandHint: 'Shows the answer.',
    collapseHint: 'Hides the answer.',
  },

  contact: {
    heading: 'Contact Support',
    emailLabel: 'Email',
    /** The address, from configuration. Displayed as well as used, so it can be read or copied. */
    emailAddress: supportConfig.email,
    emailSupport: 'Email Support',
    emailSupportHint: 'Opens your mail app with a message to NoorLife support.',
    reportProblem: 'Report a Problem',
    reportProblemHint: 'Opens your mail app with your app version already filled in.',
    /**
     * What a support draft actually carries, stated before it is sent.
     *
     * The user is about to hand a mail draft to their own mail application, and they are entitled
     * to know what is in it before it opens rather than after.
     */
    diagnosticsNote:
      'Your app version, build, platform and OS version are added to the message. Nothing from your account or your modules is included.',
    /** Subjects. Distinct so an inbox can be triaged without opening the message. */
    emailSubject: `${productConfig.name} support`,
    reportSubject: `${productConfig.name} problem report`,
    /** The lead line of a problem report, above the diagnostics block. */
    reportIntro: 'Please describe what happened, and what you expected instead.',
    /** No mail application on the device — the address is shown so it can be used elsewhere. */
    noMailApp: 'No mail app is set up on this device. You can write to us at',
    copyEmail: 'Copy Email Address',
    copied: 'Copied',
    failed: 'Your mail app could not be opened. You can write to us at',
    /** Said plainly, because a support screen implies a support desk and there is not one yet. */
    backendNote: 'Messages go to our mailbox by email. There is no in-app ticket system.',
  },

  legal: {
    heading: 'Legal',
    privacy: 'Privacy Policy',
    terms: 'Terms of Service',
    privacyUrl: legalConfig.privacyPolicy,
    termsUrl: legalConfig.termsOfService,
    openHint: 'Opens in a browser inside NoorLife.',
    /** One message for both failure shapes: nothing to open it with, or the attempt failed. */
    linkFailed: 'This page could not be opened. Check your connection and try again.',
    retry: 'Retry',
    copyLink: 'Copy Link',
    copied: 'Link copied',
  },

  about: {
    heading: `About ${productConfig.name}`,
    versionLabel: 'App version',
    buildLabel: 'Build',
    platformLabel: 'Platform',
    osLabel: 'OS version',
    copyDiagnostics: 'Copy Diagnostic Information',
    copyDiagnosticsHint: 'Copies your app version, build, platform and OS version.',
    copied: 'Diagnostic information copied',
    copyFailed: 'Your clipboard is unavailable on this device.',
    website: `Visit ${supportConfig.company}`,
    websiteUrl: supportConfig.website,
    /** The year is read from the clock rather than typed, so it cannot go stale in a release. */
    copyright: (year: number) => `© ${year} ${supportConfig.company}`,
  },
} as const;
