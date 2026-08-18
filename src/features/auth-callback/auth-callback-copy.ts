import type { AuthCallbackErrorCode } from '@services/auth/auth-callback.contract';
import { productConfig, supportConfig } from '@shared/config/app-config';

/**
 * Every string the callback and Set New Password screens render.
 *
 * ── The rule each one follows ───────────────────────────────────────────────
 * It says what happened, and nothing about what happened that the application has not confirmed. A
 * link that failed is described by *why it failed and what to do next*, never by echoing the server —
 * `error_description` is a server-authored sentence that has historically carried addresses and
 * identifiers, and it is discarded at the parser rather than being reworded here.
 *
 * ── No string below contains a code, a token or a URL ───────────────────────
 * Not the authorization code, not the flow id, not a token, not the callback URL, not even a
 * truncated form of one. `auth-callback-source-scan.test.ts` reads this file to keep it that way. A
 * "for support, quote this reference" affordance was considered and rejected: the only reference
 * available is the code itself, and putting it on screen is putting it in a screenshot.
 *
 * ── Why the copy for a failed link never blames the user ────────────────────
 * Every failure here has the same remedy — request a new link — and most of them are not the user's
 * doing. An expired link usually means an email took a while to be opened; an already-used one usually
 * means a mail client prefetched it. Wording that implies a mistake makes a normal event feel like one.
 */

export const authCallbackCopy = {
  /** ── The callback screen ─────────────────────────────────────────────── */
  callback: {
    title: 'Confirming your link',
    backLabel: 'Back to sign in',

    /**
     * The processing state.
     *
     * Announced rather than merely drawn, because the whole screen is a wait: a screen reader that
     * only saw a spinner would be told nothing at all.
     */
    processing: 'Confirming your link',
    processingSupporting: 'This only takes a moment.',

    /** Signup, magic-link and invite confirmations all land here. */
    signupTitle: 'Your email is confirmed',
    signupSupporting: `Your ${productConfig.name} account is ready. Taking you to the next step.`,

    /** Recovery. Deliberately does not say the password has changed — nothing has changed yet. */
    recoveryTitle: 'Set a new password',
    recoverySupporting:
      'Your reset link has been confirmed. Choose a new password on the next screen.',

    /**
     * Email change — confirmed.
     *
     * Shown only when the refreshed account reports no address still awaiting confirmation. The
     * address in the message comes from `auth.users`, never from the link.
     */
    emailChangedTitle: 'Your email is updated',
    emailChangedFor: (address: string) => `You now sign in with ${address}.`,

    /**
     * Email change — one side still outstanding.
     *
     * Secure Email Change emails both addresses and needs both actioned. Saying "updated" here would
     * describe something that has not happened, and the user would then fail to sign in with the new
     * address. So the pending side is named and the current address is stated plainly.
     */
    emailPendingTitle: 'One more confirmation needed',
    emailPendingFor: (pending: string) =>
      `We still need the confirmation sent to ${pending}. Until then you sign in with your current address.`,
    emailPendingCurrent: (current: string) => `You currently sign in with ${current}.`,
    /** When the refresh could not complete. Says what is unknown rather than guessing an address. */
    emailUnknown:
      'Your link was confirmed. NoorLife could not read your account details just now — nothing about your account has changed.',

    continue: 'Continue',
    requestNewLink: 'Request a New Reset Link',
    backToSignIn: 'Back to Sign In',
    retry: 'Try Again',

    /**
     * One message per failure, over the closed union.
     *
     * A `satisfies Record<...>` so a new code cannot be added to the contract without this failing to
     * compile — which is what stops an unmapped state reaching a screen as a blank.
     */
    errors: {
      'untrusted-scheme':
        'That link did not come from NoorLife, so it was not opened. If you were expecting an email from us, open the link in that message instead.',
      'untrusted-host':
        'That link did not come from NoorLife, so it was not opened. If you were expecting an email from us, open the link in that message instead.',
      'unsupported-path':
        'That link is not one NoorLife recognises. Open the link in the email we sent you.',
      'missing-code': 'That link is incomplete. Request a new one and open it from the email.',
      'malformed-code': 'That link is not valid. Request a new one and open it from the email.',
      'unsupported-flow':
        'NoorLife cannot complete that kind of link yet. Please sign in with your email and password.',
      'missing-request-id':
        'That link is missing the reference NoorLife uses to match it to your request, so it was not used. Request a new one and open it from the email.',
      'unknown-request':
        'NoorLife could not match that link to a request from this device. It may already have been used, it may have expired, or it was requested before the app was reinstalled. Request a new one.',
      'conflicting-flow':
        'That link does not match the request it belongs to, so it was not used. Request a new one.',
      'link-expired':
        'That link has expired. Links are only good for a short while — request a new one and it will work.',
      'link-already-used':
        'That link has already been used. If you still need it, request a new one.',
      'invalid-link': 'That link is not valid. Request a new one and open it from the email.',
      offline:
        'You appear to be offline, so the link could not be confirmed. Your link is still valid — reconnect and try again.',
      'server-error':
        'NoorLife could not reach the server to confirm your link. Nothing has changed. Try again shortly.',
      'not-configured': 'This build is not connected to an account service.',
      'session-unavailable':
        'Your link was accepted but no session was created. Please sign in with your email and password.',
    } satisfies Record<AuthCallbackErrorCode, string>,

    /** Titles, so a failure is headed by what went wrong rather than by a generic word. */
    errorTitles: {
      'untrusted-scheme': 'Link not recognised',
      'untrusted-host': 'Link not recognised',
      'unsupported-path': 'Link not recognised',
      'missing-code': 'Link incomplete',
      'malformed-code': 'Link not valid',
      'unsupported-flow': 'Not supported yet',
      'missing-request-id': 'Link incomplete',
      'unknown-request': 'Link no longer valid',
      'conflicting-flow': 'Link does not match',
      'link-expired': 'Link expired',
      'link-already-used': 'Link already used',
      'invalid-link': 'Link not valid',
      offline: 'You are offline',
      'server-error': 'Could not reach NoorLife',
      'not-configured': 'Not connected',
      'session-unavailable': 'Could not sign you in',
    } satisfies Record<AuthCallbackErrorCode, string>,
  },

  /** ── Set New Password ────────────────────────────────────────────────── */
  setNewPassword: {
    title: 'Set a new password',
    backLabel: 'Back to sign in',
    heading: 'New password',
    intro: 'Choose a password you do not use anywhere else.',
    newLabel: 'New password',
    confirmLabel: 'Confirm new password',
    placeholder: '••••••••',
    submit: 'Set Password',
    submitHint: 'Sets the new password on your account.',
    submitDisabledHints: {
      empty: 'Unavailable until you enter a new password and confirm it.',
      'confirm-empty': 'Unavailable until you confirm your new password.',
      weak: 'Unavailable until your new password meets the minimum strength.',
      mismatch: 'Unavailable until both passwords match.',
      submitting: 'Your new password is being set.',
      'session-unavailable': 'Unavailable because your reset link is no longer active.',
      'provider-unsupported':
        'Unavailable because your password is managed by your sign-in provider.',
    },
    errors: {
      weak: 'Use at least 8 characters, mixing letters, numbers or symbols.',
      mismatch: 'The two passwords do not match.',
      empty: 'Enter a new password.',
      confirmEmpty: 'Re-enter your new password to confirm it.',
    },

    success: 'Password set.',
    /**
     * The session is kept, not discarded, so this says where the user already is rather than what
     * to do next time. Phase 6C-3D: the recovery session becomes an ordinary one the moment the
     * password update succeeds, and sending the user back to Sign In would ask a signed-in account
     * to sign in again.
     */
    successSupporting: 'You are signed in with your new password.',
    continueToApp: 'Continue',

    /**
     * No recovery grant.
     *
     * The honest description of arriving here without one. It does **not** offer to change the
     * password of whatever session happens to exist: a screen reachable by navigation that rotates a
     * live credential is the defect this screen was created to avoid.
     */
    noGrantTitle: 'This link is no longer active',
    noGrantSupporting:
      'A password reset has to be started from a link in your email, and each link works once. Request a new one to continue.',
    requestNewLink: 'Request a New Reset Link',

    /**
     * The grant does not match the live session.
     *
     * Reachable if a recovery grant survives into a session belonging to someone else — signing in as
     * another account on a shared device, say. Refusing rather than proceeding is the only safe
     * answer: proceeding would change the wrong account's password.
     */
    mismatchTitle: 'This reset does not match your account',
    mismatchSupporting:
      'The reset link was for a different account than the one signed in now. Nothing has been changed. Sign out and open the link again, or request a new one.',
  },

  /** Shared. Reads the support address from configuration rather than restating it. */
  supportEmail: supportConfig.email,
} as const;
