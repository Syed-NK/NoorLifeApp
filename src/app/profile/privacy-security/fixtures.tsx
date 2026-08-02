import { Redirect } from 'expo-router';

import { globalRoutes } from '@application/navigation/routes';
import { PrivacySecurityFixturesScreen } from '@features/profile/screens/privacy-security-fixtures-screen';

/**
 * The Privacy & Security fixture harness — development only.
 *
 * Guarded exactly like `module-gallery` and `hero-audit`: in a release build this redirects to
 * Main Home rather than rendering, because it is scaffolding for reviewing states a real account
 * cannot safely be put into, and a deep link must not put a user in front of it.
 *
 * The guard makes the harness *unreachable*, not absent — the import above is unconditional, so
 * the module is still in the release bundle, as `module-gallery` is. What keeps that safe is the
 * harness itself: every fixture port it constructs resolves locally, so even reached it could not
 * read or change an account.
 */
export default function Screen() {
  if (!__DEV__) {
    return <Redirect href={globalRoutes.home} />;
  }
  return <PrivacySecurityFixturesScreen />;
}
