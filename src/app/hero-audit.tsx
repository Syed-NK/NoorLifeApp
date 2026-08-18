import { Redirect } from 'expo-router';

import { globalRoutes } from '@application/navigation/routes';
import { ModuleHeroAuditScreen } from '@features/modules/screens/module-gallery-screen';

/**
 * The hero asset audit route — development only.
 *
 * Shows all seven hero cards with the asset each one actually resolved, so the artwork
 * lock is reviewable from a screenshot. Guarded exactly like the Module Gallery: in a
 * release build it redirects to Main Home rather than rendering, because this is
 * scaffolding and a deep link must not put a user in front of it.
 */
export default function Screen() {
  if (!__DEV__) {
    return <Redirect href={globalRoutes.home} />;
  }
  return <ModuleHeroAuditScreen />;
}
