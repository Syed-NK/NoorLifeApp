import { createContext, useContext, useMemo, type ReactNode } from 'react';

import type { ModuleDefinition } from './module-definition';
import { getModuleDefinition } from './module-registry';
import type { FrameworkModuleId, ModuleColorTheme } from './module-tokens';

/**
 * The module a subtree belongs to.
 *
 * Every shared component reads its colour, copy and destinations from here rather
 * than taking a `theme` prop. That is what makes the components genuinely reusable:
 * `ModuleSection` has no idea which module it is inside, so it cannot be tuned for
 * one of them.
 *
 * There is no default value. A shared component rendered outside a module scaffold
 * is a wiring mistake, and it should say so rather than quietly rendering in some
 * arbitrary module's colour.
 */
const ModuleContext = createContext<ModuleDefinition | null>(null);

/**
 * The module, or `null` outside a provider.
 *
 * `useModule` throws, deliberately — a screen that needs a module and has none is a defect. But a
 * *shared* component may legitimately render in both places, and issue #91 gave
 * `ModuleStatusBanner` a reason to care which module it is in without gaining a reason to crash
 * where it never did.
 */
export function useOptionalModule(): ModuleDefinition | null {
  return useContext(ModuleContext);
}

export type ModuleProviderProps = {
  readonly moduleId: FrameworkModuleId;
  readonly children: ReactNode;
};

export function ModuleProvider({ moduleId, children }: ModuleProviderProps) {
  const definition = useMemo(() => getModuleDefinition(moduleId), [moduleId]);
  return <ModuleContext.Provider value={definition}>{children}</ModuleContext.Provider>;
}

/** The current module's full definition. Throws outside a `ModuleProvider`. */
export function useModule(): ModuleDefinition {
  const definition = useContext(ModuleContext);
  if (definition === null) {
    throw new Error(
      'useModule must be used inside a ModuleProvider. Wrap the screen in ModuleScaffold.',
    );
  }
  return definition;
}

/** Shorthand for the current module's colour theme. */
export function useModuleTheme(): ModuleColorTheme {
  return useModule().theme;
}
