import { useEffect, useState } from 'react';
import { AccessibilityInfo, PixelRatio, type AccessibilityRole } from 'react-native';

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
 * The 44 dp minimum, raised so it cannot round *below* 44 on a fractional-density screen.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── The defect this exists to remove, measured ─────────────────────────────
 * Asking for `minHeight: 44` is not the same as getting 44 dp. React Native lays out in dp and
 * paints in physical pixels, and Yoga snaps every edge to the pixel grid. On a 2.625-density screen
 * — the Pixel-class AVD this project verifies on — 44 dp is 115.5 px, which snaps to **115 px**, and
 * 115 ÷ 2.625 is **43.81 dp**. The control asked for the accessibility minimum and rendered under it,
 * on every such device, silently.
 *
 * That was measured on `emulator-5554`, not reasoned about: `uiautomator` reported the Finance
 * selector chips at 43.8 dp while their style said 44.
 *
 * ── Why rounding up is the whole fix ───────────────────────────────────────
 * Ask for the next whole pixel instead: `ceil(44 × 2.625) = 116 px`, which is 44.19 dp. The request
 * is now a value the pixel grid can represent exactly, so snapping cannot move it, and it can only
 * ever be *at or above* the minimum. On an integer density — 1, 2, 3 — there is no fraction to lose
 * and this returns 44 unchanged.
 *
 * The alternatives were both worse and both are refused. `hitSlop` leaves the **accessibility node**
 * undersized, so a screen reader and an accessibility scanner still see a 43.8 dp control — it
 * widens where a finger lands, not what the control *is*. Hard-coding 45 or 46 would be a magic
 * number that is wrong at some other density and drifts from the one shared contract.
 *
 * ── It is a bound, never a dimension ───────────────────────────────────────
 * The result is **not** passed through a layout scale. `dp()` shrinks a baseline on narrow screens,
 * which is right for spacing and wrong for this: a minimum that got smaller on a small phone is not
 * a minimum. It also does not grow with the OS font scale — the *content* grows, and this only ever
 * says how small the box may be.
 * ═══════════════════════════════════════════════════════════════════════════
 */
export function pixelSafeTouchTarget(density: number): number {
  if (!Number.isFinite(density) || density <= 0) {
    /* An unusable density cannot be rounded against; the unrounded contract is the safe answer. */
    return touchTarget.minimum;
  }
  return Math.ceil(touchTarget.minimum * density) / density;
}

/**
 * The pixel-safe 44 dp minimum for the screen this is running on.
 *
 * Reads the density at call time rather than caching it: `PixelRatio.get()` is stable for a display,
 * but a value captured at module load would be the wrong one on a device that can move a window
 * between displays.
 */
export function minimumTouchTargetSize(): number {
  return pixelSafeTouchTarget(PixelRatio.get());
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
