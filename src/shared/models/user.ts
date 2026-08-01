/**
 * User profile model.
 *
 * Only the fields the foundation and the Main Home proof screen actually need.
 * Extended per feature rather than speculatively — an over-specified user model
 * is the fastest way to accumulate dead fields.
 */
export type SubscriptionTier = 'free' | 'premium-single' | 'premium-family';

export type UserProfile = {
  readonly id: string;
  /** Full name as entered by the user. */
  readonly fullName: string;
  /** Short name used in greetings, e.g. "Ahmed". */
  readonly givenName: string;
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
