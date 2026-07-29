import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AuthProvider } from './auth-provider';
import { DesignSystemProvider } from './design-system-provider';
import { FontProvider } from './font-provider';
import { LocalizationProvider } from './localization-provider';

/**
 * The application's provider boundaries, composed in dependency order.
 *
 * Only the boundaries the foundation needs (deliverable 9). Notably absent:
 *
 *   • no state-management library — every boundary here is either static
 *     (tokens, themes) or a single value (fonts, session, locale), which Context
 *     handles without a store. Adding Redux/Zustand/Jotai now would be weight
 *     without a problem to solve; the first genuinely shared mutable feature
 *     state is the point to revisit it.
 *   • no query/cache layer — no backend is connected in Phase 1.
 *
 * Order matters: SafeArea must wrap anything measuring insets; DesignSystem must
 * wrap anything reading tokens; Auth is last so it can consume localization.
 */
export function AppProviders({ children }: { readonly children: React.ReactNode }) {
  return (
    <SafeAreaProvider>
      <DesignSystemProvider>
        <LocalizationProvider>
          <FontProvider>
            <AuthProvider>{children}</AuthProvider>
          </FontProvider>
        </LocalizationProvider>
      </DesignSystemProvider>
    </SafeAreaProvider>
  );
}
