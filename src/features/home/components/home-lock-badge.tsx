import { StyleSheet, View } from 'react-native';

import { MODULE_LOCK_INK } from '../module-lock-theme';

export type HomeLockBadgeProps = {
  /**
   * The padlock's **visible height** in already-scaled px — shackle plus body, not a box it is
   * drawn inside.
   *
   * That distinction is the point. `size` used to mean the container, with the glyph occupying about
   * 65% of it, so `size={11}` drew 7 dp of ink and `size={9}` drew under 6. Every caller was asking
   * for a lock a third larger than it got, which is how the device pass found them "too small to
   * recognize comfortably". The ratios below now sum to 1, so a caller passing 12 gets 12 dp of
   * padlock.
   */
  readonly size: number;
  readonly testID: string;
};

/** Body-to-shackle split. Sums to 1, so the drawn glyph is exactly `size` tall. */
const SHACKLE_HEIGHT = 0.4;
const BODY_HEIGHT = 0.6;
/** A padlock is taller than it is wide; the body sets the glyph's width. */
const BODY_WIDTH = 0.82;
const SHACKLE_WIDTH = 0.58;

/**
 * The padlock that marks a locked Main Home row, tile, tab, card or action.
 *
 * ── Why it is drawn rather than imported ────────────────────────────────────
 * Main Home's locked visual contract forbids swapping an approved glyph for a lock, and a padlock is
 * a rectangle and an arc — a drawn one costs nothing and cannot collide with the icon registry.
 *
 * ── It never replaces the surface's own icon ─────────────────────────────────
 * It is an *additional* element everywhere except the "View All" chevron, where the chevron it
 * replaces means "forward navigation" — precisely what a locked control does not do. Elsewhere the
 * timeline keeps its activity icon, the tile keeps its approved PNG, the quick action keeps its
 * module icon and the tab keeps its destination icon, so each surface stays recognisable at a glance
 * and the lock reads as a state rather than an identity.
 *
 * ── It is the only signal that a surface is locked ──────────────────────────
 * Nothing else about a locked surface is dimmed any more — see `LOCK_GLYPH` for the measurements
 * that forced that. So this glyph and the "…, Premium feature" in the surrounding control's
 * accessible name carry the state between them, and neither is a colour.
 *
 * Decorative: the surrounding control already carries "…, Premium feature" in its accessible name,
 * so announcing this separately would only repeat it.
 */
export function HomeLockBadge({ size, testID }: HomeLockBadgeProps) {
  return (
    <View
      style={[styles.badge, { width: size * BODY_WIDTH, height: size }]}
      pointerEvents="none"
      accessible={false}
      testID={testID}
    >
      {/* The shackle: a half-ring above the body. */}
      <View
        style={{
          width: size * SHACKLE_WIDTH,
          height: size * SHACKLE_HEIGHT,
          borderTopLeftRadius: size * 0.3,
          borderTopRightRadius: size * 0.3,
          borderWidth: size * 0.13,
          borderBottomWidth: 0,
          borderColor: MODULE_LOCK_INK,
        }}
      />
      <View
        style={{
          width: size * BODY_WIDTH,
          height: size * BODY_HEIGHT,
          borderRadius: size * 0.16,
          backgroundColor: MODULE_LOCK_INK,
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
});
