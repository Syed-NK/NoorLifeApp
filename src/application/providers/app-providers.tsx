import { SafeAreaProvider } from 'react-native-safe-area-context';

import { QuranCatalogueWarmup } from '@features/faith/di/quran-warmup';
import { EntitlementProvider } from '@features/subscription/services/entitlement-context';

import { AccessibilityProvider } from './accessibility-provider';
import { AuthCallbackProvider } from './auth-callback-provider';
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
 *
 * Entitlement sits *inside* Auth, because what a user is entitled to depends on who they are: a
 * sign-out must be able to drop the entitlement, not the other way round. It wraps the children
 * rather than replacing Auth's position, so nothing above it changes.
 *
 * Accessibility sits *outside* everything that draws, and outside Auth in particular: whether
 * motion is reduced is a property of the device and its owner, not of a session, so it must not be
 * dropped or reloaded when somebody signs out. It is above Design System for the same reason a
 * future dark theme would be — a preference that changes how things render has to be readable by
 * the layer that renders them.
 *
 * AuthCallback sits **outside** Auth, and that placement is the whole point of it. A cold-start deep
 * link has to be captured on the first tick, before fonts, session and onboarding have resolved and
 * before the entry gate freezes its destination — so the boundary that reads it must not be waiting on
 * the boundary that resolves the session. It holds a parsed link and nothing else: no network call, no
 * session, nothing persisted. See `auth-callback-provider.tsx`.
 */
export function AppProviders({ children }: { readonly children: React.ReactNode }) {
  return (
    <SafeAreaProvider>
      <AccessibilityProvider>
        <DesignSystemProvider>
          <LocalizationProvider>
            <FontProvider>
              <AuthCallbackProvider>
                <AuthProvider>
                  <EntitlementProvider>
                    {/*
                      Renders nothing. It loads the Qur'an's 114-surah catalogue once a session
                      exists, so the Qur'an tab reads it synchronously instead of awaiting storage
                      on the frame it is opened — see `quran-catalogue-warmup.ts` for why a
                      three-millisecond await still costs a visible skeleton.

                      Inside Auth because the approved adapter needs an authenticated invocation,
                      and warming before sign-in would spend a call that can only be refused.
                    */}
                    <QuranCatalogueWarmup />
                    {children}
                  </EntitlementProvider>
                </AuthProvider>
              </AuthCallbackProvider>
            </FontProvider>
          </LocalizationProvider>
        </DesignSystemProvider>
      </AccessibilityProvider>
    </SafeAreaProvider>
  );
}
