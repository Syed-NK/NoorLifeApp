import { ModuleHomeScreen } from '@features/modules/screens/module-home-screen';

/**
 * Noor AI home — the approved `02-noor-ai.png` screen.
 *
 * Replaces the Phase 1 placeholder this route used to render. Noor AI is a core module, not a
 * future feature, and is now registered as the eighth.
 */
export default function Screen() {
  return <ModuleHomeScreen moduleId="noor-ai" />;
}
