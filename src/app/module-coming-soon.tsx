import { Redirect, useLocalSearchParams } from 'expo-router';

import { ProtectedRouteBoundary } from '@application/navigation/protected-route-boundary';
import { globalRoutes } from '@application/navigation/routes';
import { ModuleComingSoonScreen } from '@features/modules/screens/module-coming-soon-screen';
import { FRAMEWORK_MODULE_IDS, type FrameworkModuleId } from '@features/modules/module-tokens';

/**
 * The themed "not built yet" destination, reached from any control without a screen.
 *
 * Both parameters are validated rather than trusted: a deep link could carry any string,
 * and `getModuleDefinition` throws on an unknown module id. An unrecognised module
 * redirects to Main Home instead of crashing, and a missing feature name falls back to
 * wording that still reads as a sentence.
 *
 * The authentication boundary is outermost, so the parameter check happens *inside* it. Reading a
 * link's parameters is already work done on somebody's behalf, and a signed-out link deserves the
 * authentication answer rather than a bounce to Main Home — which would send an unauthenticated
 * visitor to another protected route (issue #28).
 */
export default function Screen() {
  const params = useLocalSearchParams<{ moduleId?: string; feature?: string }>();
  const moduleId = params.moduleId;
  const known =
    moduleId !== undefined && FRAMEWORK_MODULE_IDS.includes(moduleId as FrameworkModuleId);

  return (
    <ProtectedRouteBoundary>
      {known ? (
        <ModuleComingSoonScreen
          moduleId={moduleId as FrameworkModuleId}
          feature={params.feature ?? 'This feature'}
        />
      ) : (
        <Redirect href={globalRoutes.home} />
      )}
    </ProtectedRouteBoundary>
  );
}
