import type { UserProfile } from '@shared/models/user';

/**
 * Local mock session for Phase 1.
 *
 * No backend is connected during Phase 1, so the signed-in user is a typed
 * literal. The name matches the reference design
 * (design-reference/full-core-screens/01-main-noor-ai-faith.png), which shows
 * "Assalamu Alaikum, Ahmed".
 *
 * `avatarUri` is deliberately omitted: no avatar asset exists in the project, and
 * the top bars fall back to an initial rather than to a broken image.
 */
export const mockSignedInUser: UserProfile = {
  id: 'mock-user-1',
  fullName: 'Ahmed Alaikum',
  givenName: 'Ahmed',
  subscriptionTier: 'premium-family',
  greeting: 'Assalamu Alaikum,',
};
