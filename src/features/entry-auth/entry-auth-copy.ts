import type { AuthErrorCode } from '@services/auth/auth-service.contract';

/**
 * Locked copy for the entry & authentication flow.
 *
 * Every string the twelve screens display, verbatim from the phase prompt's screen
 * requirements. Copy lives here rather than inline so a wording change is one edit and so the
 * exact strings — including the typographic apostrophes the prompt uses — are reviewable in one
 * place rather than scattered across JSX.
 */

/**
 * Onboarding panels 02–04.
 *
 * Headings carry an explicit newline at the reference's break point. The wording is exactly the
 * prompt's; only where the line turns is added. Leaving the break to the layout engine would
 * make it depend on font metrics to the dp — "with clear boundaries." measures 249.1 dp against
 * a 262 dp measure, so a small metric difference on another device would silently produce a
 * third line and change the locked hierarchy. Subtitles wrap naturally inside
 * `subtitleMaxWidth`, which is tuned to reproduce the reference's breaks.
 */
export const onboardingCopy = [
  {
    title: 'Your family,\nbeautifully in sync.',
    subtitle: 'Bring your loved ones together and stay connected in meaningful ways.',
    primaryLabel: 'Next',
  },
  {
    title: 'Every part of life,\ntogether.',
    subtitle: 'From faith and health to goals and finances—manage it all in one place.',
    primaryLabel: 'Next',
  },
  {
    title: 'Helpful AI,\nwith clear boundaries.',
    subtitle:
      'NoorLife’s AI is module-specific and privacy-first—built to support, never overstep.',
    primaryLabel: 'Get Started',
  },
] as const;

export const illustrationLabels = {
  familyRobot: 'A family standing together with the Noor AI assistant.',
  noorAi: 'The Noor AI assistant.',
  privacyShield: 'A shield with a padlock, representing privacy protection.',
  emailEnvelope: 'An envelope, representing an email message.',
} as const;

/** Screen 05 — Authentication Options. */
export const welcomeCopy = {
  title: 'Welcome to NoorLife',
  continueWithEmail: 'Continue with Email',
  continueWithGoogle: 'Continue with Google',
  continueWithApple: 'Continue with Apple',
  signUpPrompt: 'Don’t have an account? ',
  signUpAction: 'Sign Up',
  legalPrefix: 'By continuing, you agree to our ',
  terms: 'Terms of Service',
  legalJoin: ' and ',
  privacy: 'Privacy Policy',
} as const;

/** Screen 06 — Login. */
export const loginCopy = {
  title: 'Welcome back',
  subtitle: 'Sign in to continue to NoorLife.',
  email: 'Email',
  emailPlaceholder: 'you@example.com',
  password: 'Password',
  rememberMe: 'Remember me',
  forgotPassword: 'Forgot password?',
  submit: 'Sign In',
  divider: 'or',
  signUpPrompt: 'Don’t have an account? ',
  signUpAction: 'Sign Up',
} as const;

/** Screen 07 — Create Account. */
export const signUpCopy = {
  title: 'Create your account',
  subtitle: 'Join NoorLife and get started.',
  fullName: 'Full Name',
  fullNamePlaceholder: 'Your full name',
  email: 'Email',
  emailPlaceholder: 'you@example.com',
  password: 'Password',
  confirmPassword: 'Confirm Password',
  termsPrefix: 'I agree to the ',
  terms: 'Terms of Service',
  termsJoin: ' and ',
  privacy: 'Privacy Policy',
  submit: 'Create Account',
  signInPrompt: 'Already have an account? ',
  signInAction: 'Sign In',
} as const;

/** Screen 08 — Verify Email. */
export const verifyEmailCopy = {
  title: 'Check your email',
  subtitleFor: (email: string) => `We sent a 6-digit code to ${email}`,
  submit: 'Verify Email',
  resend: 'Resend code',
  changeEmail: 'Change email',
} as const;

/** Screen 09 — Forgot Password. */
export const forgotPasswordCopy = {
  title: 'Reset your password',
  subtitle: 'Enter your email and we’ll send you a link to reset your password.',
  email: 'Email',
  emailPlaceholder: 'you@example.com',
  submit: 'Send Reset Link',
  backToSignIn: 'Back to Sign In',
  /**
   * Deliberately does not confirm whether the address is registered.
   *
   * The requirement is privacy-safe success messaging; "we've sent you a link" would let anyone
   * enumerate which addresses have accounts.
   */
  sent: 'If that address has an account, a reset link is on its way.',
} as const;

/** Screen 10 — Reset Link Sent. */
export const resetLinkSentCopy = {
  title: 'Check your inbox',
  subtitleFor: (email: string) => `We’ve sent a password reset link to ${email}.`,
  openEmail: 'Open Email App',
  resend: 'Resend Email',
  backToSignIn: 'Back to Sign In',
  noMailApp: 'No email app is available on this device. Open your mail in a browser instead.',
} as const;

/** Screen 11 — New Password. */
export const newPasswordCopy = {
  title: 'Create a new password',
  subtitle: 'Make it strong and secure.',
  newPassword: 'New Password',
  confirmPassword: 'Confirm New Password',
  submit: 'Reset Password',
  done: 'Your password has been reset. Sign in with your new password.',
  /**
   * Shown when the screen is opened without a reset code in the link.
   *
   * Supabase's reset works by establishing a session from the emailed code, so without one the
   * update cannot succeed. Saying so up front beats letting the user type a password and fail.
   */
  noLink: 'Open the link in your reset email to set a new password.',
} as const;

/** Screen 12 — Account Ready. */
export const accountReadyCopy = {
  title: 'You’re all set!',
  subtitle: 'Your account is ready. Let’s make every day meaningful together.',
  submit: 'Continue to NoorLife',
} as const;

/**
 * User-facing text for every service error code.
 *
 * Mapped from a closed union rather than rendering whatever a server returned: it keeps the wording
 * reviewable, keeps it consistent between screens, and means a backend message can never leak into
 * the UI. `invalid-credentials` deliberately does not say which of the address or the password was
 * wrong — distinguishing them tells an attacker which addresses are registered.
 */
export const authErrorCopy = {
  'invalid-email': 'Enter a valid email address.',
  'invalid-credentials': 'That email or password is incorrect.',
  'email-already-registered': 'An account already exists for this email.',
  'weak-password': 'Choose a longer password with a mix of characters.',
  'passwords-do-not-match': 'Both passwords must match.',
  'terms-not-accepted': 'Please accept the Terms of Service and Privacy Policy.',
  'incorrect-otp': 'That code is not correct. Check it and try again.',
  'expired-otp': 'That code has expired. Request a new one.',
  'resend-cooldown': 'Please wait before requesting another code.',
  'expired-reset-link': 'This reset link has expired. Request a new one.',
  'provider-cancelled': 'Sign-in was cancelled.',
  'provider-failed': 'That provider could not sign you in. Try again.',
  'provider-not-configured': 'This sign-in method is not available yet. Continue with email.',
  offline: 'You appear to be offline. Check your connection and try again.',
  'email-not-confirmed': 'Confirm your email address first — check your inbox for the code.',
  'rate-limited': 'Too many attempts. Wait a moment and try again.',
  'email-rate-limited':
    'We can’t send any more verification emails right now. Please try again later.',
  'session-expired': 'Your session has expired. Sign in again to continue.',
  'not-configured':
    'Sign-in is not available in this build yet — the Supabase connection has not been configured.',
  'server-error': 'Something went wrong on our side. Please try again.',
} as const satisfies Record<AuthErrorCode, string>;
