import { useEffect, useState } from 'react';
import { AccessibilityInfo, type AccessibilityRole } from 'react-native';

import { useMotionPreferenceContext } from '@shared/accessibility/motion-preference';
import { touchTarget } from '@ds/tokens';

/**
 * Accessibility helpers (spec §8).
 *
 * The rules these support:
 *   • 44 × 44 minimum touch target
 *   • a screen-reader label on every icon button
 *   • status is never communicated with colour alone
 *   • reduced-motion is respected (§7)
 */

/**
 * Hit-slop that expands a visually smaller control to the 44 × 44 minimum.
 *
 * Prefer sizing the control itself; use this only when the design fixes a
 * smaller visual size (e.g. a 20 px inline chevron).
 */
export function minimumHitSlop(visualSize: number) {
  const deficit = Math.max(0, touchTarget.minimum - visualSize);
  const inset = Math.ceil(deficit / 2);
  return { top: inset, bottom: inset, left: inset, right: inset };
}

/**
 * Props every icon-only control must spread.
 *
 * `accessibilityLabel` is a required argument rather than an optional prop, so an
 * unlabelled icon button cannot compile.
 */
export function iconButtonA11y(
  label: string,
  options?: { readonly hint?: string; readonly disabled?: boolean; readonly selected?: boolean },
) {
  return {
    accessible: true,
    accessibilityRole: 'button' as AccessibilityRole,
    accessibilityLabel: label,
    ...(options?.hint === undefined ? {} : { accessibilityHint: options.hint }),
    accessibilityState: {
      disabled: options?.disabled ?? false,
      selected: options?.selected ?? false,
    },
  };
}

/**
 * Composes a status label that reads correctly without colour.
 *
 * e.g. `statusLabel('Fajr Prayer', 'Completed')` → "Fajr Prayer, Completed".
 * Every coloured status indicator in NoorLife must also carry text or an icon;
 * this builds the screen-reader half of that pair.
 */
export function statusLabel(subject: string, status: string): string {
  return `${subject}, ${status}`;
}

/**
 * Whether motion should be reduced — the single value every animation in NoorLife reads.
 *
 * ── Two inputs, one answer ──────────────────────────────────────────────────
 * The operating system's setting (§7: "Respect reduced-motion system settings") and, since Phase
 * 6C-2B, the user's own NoorLife preference from `/profile/preferences`.
 *
 * The system setting takes precedence: when it is on, this is true no matter what the in-app
 * preference says, because a user who reduced motion for their whole phone has already answered
 * this question and an application switch does not get to overrule them. The in-app preference can
 * only add. Writing that rule here rather than at each animation is what stops one transition
 * getting the precedence backwards.
 *
 * A change to either input re-renders every consumer, so a preference switched on
 * `/profile/preferences` takes effect immediately — no restart, and no screen has to reload.
 */
export function useReducedMotion(): boolean {
  const preference = useMotionPreferenceContext();
  return useSystemReducedMotion() || (preference?.preferReduceMotion ?? false);
}

/**
 * The operating system's setting alone.
 *
 * The subscription is an external-system subscription, so the initial value is
 * fetched in the same effect that subscribes — there is no synchronous setState
 * in a render path.
 */
export function useSystemReducedMotion(): boolean {
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let active = true;

    AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (active) {
          setReduceMotion(enabled);
        }
      })
      .catch(() => {
        // Unsupported platform: keep motion enabled rather than failing.
      });

    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', (enabled) => {
      setReduceMotion(enabled);
    });

    return () => {
      active = false;
      subscription.remove();
    };
  }, []);

  return reduceMotion;
}
