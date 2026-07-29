import { createContext, useContext, useMemo } from 'react';

import { getModuleTheme, moduleThemes } from '@ds/modules/module-themes';
import { tokens, type ModuleId, type Tokens } from '@ds/tokens';
import type { ModuleTheme } from '@shared/models/module-theme';

export type DesignSystem = {
  readonly tokens: Tokens;
  readonly themes: typeof moduleThemes;
  readonly getTheme: (id: ModuleId) => ModuleTheme;
};

const value: DesignSystem = {
  tokens,
  themes: moduleThemes,
  getTheme: getModuleTheme,
};

const DesignSystemContext = createContext<DesignSystem>(value);

/**
 * Design-token boundary.
 *
 * Tokens are static, so this provider exists for *access*, not for state: it
 * gives screens a hook-shaped way to reach tokens and module themes, and it is
 * the seam where a future dark theme or user-selected appearance
 * (§14 `/settings/appearance`) would swap the token set without touching a single
 * component.
 *
 * Components may also import tokens directly, which is cheaper and is what the
 * primitives do. This provider is for anything that must react to a *runtime*
 * theme choice later.
 */
export function DesignSystemProvider({ children }: { readonly children: React.ReactNode }) {
  const memoised = useMemo(() => value, []);
  return <DesignSystemContext.Provider value={memoised}>{children}</DesignSystemContext.Provider>;
}

export function useDesignSystem(): DesignSystem {
  return useContext(DesignSystemContext);
}

/** Convenience hook: resolve one module's theme. */
export function useModuleTheme(id: ModuleId): ModuleTheme {
  return useDesignSystem().getTheme(id);
}
