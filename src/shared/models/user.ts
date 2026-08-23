/**
 * User profile model.
 *
 * Only the fields the foundation and the Main Home proof screen actually need.
 * Extended per feature rather than speculatively — an over-specified user model
 * is the fastest way to accumulate dead fields.
 */
export type SubscriptionTier = 'free' | 'premium-single' | 'premium-family';

/**
 * How a session was established, as the identity provider itself reports it.
 *
 * A closed union rather than a free string, and always nullable at its source: Personal Information
 * shows this only when it is known, because guessing "Email" for a Google account is an invented
 * fact about the user's own credentials. Resolved by `services/profile`, not held on `UserProfile` —
 * exactly one screen displays it, and this model is extended per feature rather than speculatively.
 */
export type AuthProviderId = 'email' | 'google' | 'apple';

export type UserProfile = {
  readonly id: string;
  /**
   * Full name as entered by the user. **Absent when no genuine name is known.**
   *
   * ═══════════════════════════════════════════════════════════════════════════
   * ── Why absent rather than a placeholder ───────────────────────────────────
   * These were required, so something always had to be put here — and what got put here was the
   * sign-in address, because `toProfile`'s fallback chain ended `?? user.email`. An account that never
   * supplied a name (a provider sign-in that carries none, a signup without metadata) therefore had
   * its address rendered as its name, most prominently as Main Home's greeting. Issue #48.
   *
   * A required field cannot express "we do not know", so it invited a guess, and every available guess
   * is wrong: the address is not a name, its local part is not a name, and initials derived from
   * either are a fabrication. Absent is the only honest value, and it is one every consumer already
   * handles — Main Home falls back to its own neutral "there", and the Profile surfaces to their
   * "not available" copy.
   *
   * The address is still carried, in `email`, where it is labelled as what it is.
   * ═══════════════════════════════════════════════════════════════════════════
   */
  readonly fullName?: string;
  /** Short name used in greetings, e.g. "Ahmed". Absent whenever `fullName` is. */
  readonly givenName?: string;
  /**
   * Sign-in address. Absent when the provider does not supply one.
   *
   * Added for the Profile identity card, which must show the real address rather than a
   * placeholder — extended per feature, as this model's contract describes.
   */
  readonly email?: string;
  /** Avatar URI. Absent means the UI falls back to an initial. */
  readonly avatarUri?: string;
  readonly subscriptionTier: SubscriptionTier;
  /** Preferred greeting, e.g. "Assalamu Alaikum,". */
  readonly greeting: string;
};
