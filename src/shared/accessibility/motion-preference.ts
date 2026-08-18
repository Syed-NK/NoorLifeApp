import { createContext, useContext } from 'react';

/**
 * The seam between "the operating system asked for less motion" and "the user asked NoorLife for
 * less motion".
 *
 * ── Why the context holds only the preference ───────────────────────────────
 * The system setting is already available anywhere through `AccessibilityInfo`, and duplicating it
 * into a provider would create two answers to one question. What is *not* available anywhere is
 * the in-app choice, because it lives in device storage behind a service. So that — and only that
 * — is what travels through this context, and `useReducedMotion` in `@shared/utils/a11y` combines
 * the two into the single value every animation reads.
 *
 * ── Why this file is in `shared` and the provider is not ────────────────────
 * `@shared/utils/a11y` is imported by design-system components, which must not reach up into the
 * application layer. The context object is therefore pure React with no dependencies, and the
 * provider that owns the persistence lives in `@application/providers`, where reaching a service
 * is what that layer is for.
 *
 * ── Precedence ──────────────────────────────────────────────────────────────
 * The system setting wins whenever it is on. A user who has turned Reduce Motion on at the OS
 * level has made a decision about every application on their phone, and an in-app switch is not
 * entitled to overrule it — the in-app preference can only ever *add* to it. That rule is written
 * once, in `useReducedMotion`, so no animation can implement it differently.
 */

export type MotionPreference = {
  /** The user's in-app choice. Independent of the OS setting, which always wins when enabled. */
  readonly preferReduceMotion: boolean;
};

/**
 * Null when no provider is mounted — a design-system component rendered in isolation, or a test
 * that mounts one screen. `useReducedMotion` then falls back to the system setting alone, which is
 * the behaviour that existed before this preference did.
 */
export const MotionPreferenceContext = createContext<MotionPreference | null>(null);

export function useMotionPreferenceContext(): MotionPreference | null {
  return useContext(MotionPreferenceContext);
}
