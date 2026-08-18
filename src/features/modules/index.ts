/**
 * The NoorLife core module framework.
 *
 * Everything a module needs, in one place:
 *
 *   • `module-tokens`     — the seven themes, contrast-derived, plus layout and type
 *   • `module-definition` — the typed contract a module satisfies
 *   • `module-registry`   — the seven definitions
 *   • `module-ai-policy`  — module-scoped AI, its capabilities and its limits
 *   • `components/`       — the eighteen shared components
 *   • `services/`         — the data contract and today's mock implementation
 *   • `screens/`          — generic home, sub-screen and AI screens for any module
 *
 * A new module is a registry entry plus route files. It is not new screens.
 */

export * from './components';
export {
  ModuleProvider,
  useModule,
  useModuleTheme,
  type ModuleProviderProps,
} from './module-context';
export type {
  ModuleCapability,
  ModuleDefinition,
  ModuleHeroContent,
  ModulePermission,
  ModuleQuickActionSpec,
  ModuleStateCopy,
} from './module-definition';
export {
  allModuleDefinitions,
  getModuleDefinition,
  moduleRegistry,
} from './module-registry';
export {
  moduleAIBoundaryResponse,
  moduleAIPolicies,
  moduleAIRequestContext,
  type ModuleAICapability,
  type ModuleAIPolicy,
  type ModuleAISafetyRule,
} from './module-ai-policy';
export {
  FRAMEWORK_MODULE_IDS,
  moduleColorThemes,
  moduleLayout,
  moduleNeutrals,
  moduleScale,
  moduleType,
  type FrameworkModuleId,
  type ModuleColorTheme,
  type ModuleTypeToken,
} from './module-tokens';
export { useModuleMetrics, type ModuleMetrics } from './use-module-metrics';
export { useModuleOverview, type UseModuleOverview } from './use-module-overview';
export type {
  ModuleDataResult,
  ModuleOverview,
  ModuleRepository,
  ModuleRepositoryProvider,
} from './services/module-data.contract';
export {
  createMockModuleRepository,
  mockModuleRepositoryProvider,
  type MockScenario,
} from './services/mock-module-repository';
export { ModuleHomeScreen } from './screens/module-home-screen';
export { ModuleSectionScreen } from './screens/module-section-screen';
export { ModuleAIScreen } from './screens/module-ai-screen';
export { ModuleGalleryScreen, ModuleHeroAuditScreen } from './screens/module-gallery-screen';
export { AA_LARGE_TEXT, AA_TEXT, AA_UI, contrastRatio, formatRatio, luminance, meets } from './contrast';
