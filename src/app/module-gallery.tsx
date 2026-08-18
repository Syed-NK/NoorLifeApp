import { Redirect } from 'expo-router';

import { globalRoutes } from '@application/navigation/routes';
import { ModuleGalleryScreen } from '@features/modules/screens/module-gallery-screen';

/**
 * The Module Gallery route — development only.
 *
 * In a release build this redirects to Main Home rather than rendering. The gallery is
 * scaffolding for reviewing the shared framework; it has no product purpose, and a
 * deep link should not be able to put a real user in front of it.
 *
 * The guard is a redirect rather than a 404 so that a stale link from a development
 * session lands somewhere sensible instead of on the not-found screen.
 */
export default function Screen() {
  if (!__DEV__) {
    return <Redirect href={globalRoutes.home} />;
  }
  return <ModuleGalleryScreen />;
}
