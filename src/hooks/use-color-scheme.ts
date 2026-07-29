import { useColorScheme as useRNColorScheme, type ColorSchemeName } from 'react-native';

/**
 * The active OS colour scheme.
 *
 * ── Why this replaces the generated template's two files ────────────────────
 *
 * The Expo template shipped `use-color-scheme.ts` plus a `use-color-scheme.web.ts`
 * override. The web override existed to return `'light'` until React had hydrated,
 * and it did that by calling `setHasHydrated(true)` inside a `useEffect` — which is
 * exactly what `react-hooks/set-state-in-effect` flags, and which was the
 * project's only lint error.
 *
 * The fix is not to silence the rule. The effect was a workaround for a problem
 * NoorLife does not have: the design specification locks the application to a
 * light theme on a neutral canvas (§10 "It supports light theme"; §2.1 canvas
 * `#F7F8FA`), and nothing in the token layer branches on the OS scheme. So the
 * hydration dance had nothing to protect — there is no dark palette for a
 * statically rendered frame to disagree with.
 *
 * This hook therefore reads the OS value directly, with no effect and no local
 * state, and the platform-specific override is deleted.
 * `react-hooks/set-state-in-effect` remains fully enabled project-wide: no rule
 * was disabled, and nothing was suppressed with an inline comment.
 *
 * When a dark theme is introduced, its home is `DesignSystemProvider` — a token
 * swap rather than per-component scheme reads — and static-web hydration would be
 * handled there with `useSyncExternalStore`, not a setState-in-effect.
 */
export function useColorScheme(): ColorSchemeName {
  return useRNColorScheme();
}
