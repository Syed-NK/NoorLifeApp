import { StyleSheet, View } from 'react-native';

import { MODULE_LOCK_INK } from '../module-lock-theme';

export type HomeLockBadgeProps = {
  /** Overall badge height in already-scaled px. Every part is a ratio of it. */
  readonly size: number;
  readonly testID: string;
};

/**
 * The small padlock that marks a locked Main Home row or summary card.
 *
 * ── Why it is drawn rather than imported ────────────────────────────────────
 * Main Home's locked visual contract forbids swapping an approved glyph for a lock, and a padlock
 * is a rectangle and an arc — a drawn one costs nothing and cannot collide with the icon registry.
 * `module-grid.tsx` draws its own because it needs a near-white disc behind it to survive a
 * coloured tile; the timeline rows and summary cards sit on the white card surface, so this one is
 * the bare glyph. Same shape, same ink, same meaning.
 *
 * ── It never replaces the row's own icon ────────────────────────────────────
 * It is an *additional* element. The timeline keeps its trailing activity icon and the Family card
 * keeps its Family glyph, so the surface stays recognisable at a glance and the lock is read as a
 * state rather than an identity.
 *
 * Decorative: the surrounding control already carries "…, Premium feature" in its accessible name,
 * so announcing this separately would only repeat it.
 */
export function HomeLockBadge({ size, testID }: HomeLockBadgeProps) {
  return (
    <View
      style={[styles.badge, { width: size, height: size }]}
      pointerEvents="none"
      accessible={false}
      testID={testID}
    >
      {/* The shackle: a half-ring above the body. */}
      <View
        style={{
          width: size * 0.38,
          height: size * 0.27,
          borderTopLeftRadius: size * 0.23,
          borderTopRightRadius: size * 0.23,
          borderWidth: size * 0.085,
          borderBottomWidth: 0,
          borderColor: MODULE_LOCK_INK,
        }}
      />
      <View
        style={{
          width: size * 0.54,
          height: size * 0.38,
          borderRadius: size * 0.11,
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
