import { Pressable, StyleSheet, View } from 'react-native';

import { AppIcon } from '@ds/components';
import { EntryAuthText } from '@features/entry-auth/components/entry-auth-text';
import { useEntryAuthMetrics } from '@features/entry-auth/use-entry-auth-metrics';
import { subscriptionColors } from '@features/subscription/subscription-tokens';

import { profileCopy } from '../profile-copy';
import { PROFILE_LAYOUT } from '../profile-metrics';

export type ProfileHeaderProps = {
  readonly onBack: () => void;
  readonly onHelp: () => void;
  readonly testID?: string;
};

/**
 * Back, a centred "Profile", and Help.
 *
 * ── Why this is not `ModuleHeader` ──────────────────────────────────────────
 * The module header is bound to `useModule()` — a module id, a module theme and a module help
 * route — and Profile is not a module. What it borrows instead is the *treatment*, which is the
 * part the user recognises: a 36 dp bordered white disc holding a 19 dp glyph, inside a 44 dp
 * target, with the title absolutely centred on the whole header. Those numbers come from
 * `PROFILE_LAYOUT.header`, which restates the approved module geometry rather than inventing any.
 *
 * ── Why the title is absolutely positioned ──────────────────────────────────
 * Same reason as the module header: Back on the left and Help on the right are equal here, but a
 * flex-centred title still shifts whenever either control's width changes. Spanning the header and
 * centring the text keeps "Profile" on the screen's true centre. `pointerEvents: 'none'` stops it
 * swallowing taps meant for a control.
 *
 * ── No portrait here ────────────────────────────────────────────────────────
 * The module header carries a profile avatar on the right because it is a way *into* this screen.
 * On Profile itself the portrait belongs to the identity card, so the right slot is Help alone.
 */
export function ProfileHeader({ onBack, onHelp, testID = 'profile-header' }: ProfileHeaderProps) {
  const { dp } = useEntryAuthMetrics();

  const target = dp(PROFILE_LAYOUT.minTouchTarget);
  const disc = dp(PROFILE_LAYOUT.header.control);
  const glyph = dp(PROFILE_LAYOUT.header.icon);

  return (
    <View style={[styles.root, { height: dp(PROFILE_LAYOUT.header.height) }]} testID={testID}>
      <View style={styles.titleLayer} pointerEvents="none">
        <EntryAuthText
          token="titleCompact"
          align="center"
          numberOfLines={1}
          // Capped so a large OS text size cannot push the title under the controls beside it.
          maxFontSizeMultiplier={1.3}
          accessibilityRole="header"
          color={subscriptionColors.textPrimary}
          testID={`${testID}-title`}
        >
          {profileCopy.title}
        </EntryAuthText>
      </View>

      <Pressable
        onPress={onBack}
        accessible
        accessibilityRole="button"
        accessibilityLabel={profileCopy.header.back}
        style={[styles.control, { width: target, height: target }]}
        testID={`${testID}-back`}
      >
        <View
          style={[styles.disc, { width: disc, height: disc, borderRadius: disc / 2 }]}
          pointerEvents="none"
        >
          <AppIcon name="back" size={glyph} color={subscriptionColors.textPrimary} />
        </View>
      </Pressable>

      <Pressable
        onPress={onHelp}
        accessible
        accessibilityRole="button"
        accessibilityLabel={profileCopy.header.help}
        accessibilityHint={profileCopy.header.helpHint}
        style={[styles.control, { width: target, height: target }]}
        testID={`${testID}-help`}
      >
        <View
          style={[styles.disc, { width: disc, height: disc, borderRadius: disc / 2 }]}
          pointerEvents="none"
        >
          <AppIcon name="help" size={glyph} color={subscriptionColors.accent} />
        </View>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  titleLayer: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  control: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  disc: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: subscriptionColors.surface,
    borderWidth: 1,
    borderColor: subscriptionColors.border,
  },
});
