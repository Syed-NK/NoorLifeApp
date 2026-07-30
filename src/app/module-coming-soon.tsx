import { Redirect, useLocalSearchParams } from 'expo-router';

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
 */
export default function Screen() {
  const params = useLocalSearchParams<{ moduleId?: string; feature?: string }>();

  const moduleId = params.moduleId;
  if (moduleId === undefined || !FRAMEWORK_MODULE_IDS.includes(moduleId as FrameworkModuleId)) {
    return <Redirect href={globalRoutes.home} />;
  }

  return (
    <ModuleComingSoonScreen
      moduleId={moduleId as FrameworkModuleId}
      feature={params.feature ?? 'This feature'}
    />
  );
}
