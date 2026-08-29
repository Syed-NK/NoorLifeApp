import { Pressable, StyleSheet, View } from 'react-native';

import { AppIcon } from '@ds/components';
import { EntryAuthText } from '@features/entry-auth/components/entry-auth-text';
import { useEntryAuthMetrics } from '@features/entry-auth/use-entry-auth-metrics';
import { subscriptionColors } from '@features/subscription/subscription-tokens';

import { profileCopy } from '../profile-copy';
import { PROFILE_LAYOUT } from '../profile-metrics';
import { minimumTouchTargetSize } from '@shared/utils/a11y';

export type ProfileHeaderProps = {
  readonly onBack: () => void;
  /**
   * Omitted on a detail screen with no useful help destination.
   *
   * The right slot then holds an equally sized empty box rather than collapsing, so the centred
   * title stays on the screen's true centre whether or not Help is offered.
   */
  readonly onHelp?: () => void;
  /** Defaults to "Profile". Detail screens pass their own. */
  readonly title?: string;
  /** Overrides the Back control's spoken label — "Back to Profile" on a detail screen. */
  readonly backLabel?: string;
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
 *
 * ── One header for Profile and its detail screens ───────────────────────────
 * Phase 6C-2A added `title`, `backLabel` and an optional `onHelp` rather than a second header
 * component. Personal Information and Family & Membership therefore carry the same 54 dp bar, the
 * same 36 dp discs and the same absolutely-centred title as Profile Home — because it is literally
 * the same component, not a second one drawn to match.
 */
export function ProfileHeader({
  onBack,
  onHelp,
  title = profileCopy.title,
  backLabel = profileCopy.header.back,
  testID = 'profile-header',
}: ProfileHeaderProps) {
  const { dp } = useEntryAuthMetrics();

  const target = minimumTouchTargetSize();
  const disc = dp(PROFILE_LAYOUT.header.control);
  const glyph = dp(PROFILE_LAYOUT.header.icon);

  /**
   * How far the title layer stops short of each edge.
   *
   * The outer edge of the control disc: the 44 dp target starts at the header edge and the 36 dp
   * disc is centred inside it, so the disc ends 40 dp in. The title still *centres* on the header's
   * true middle — both insets are equal — it simply cannot reach the discs.
   *
   * Without this the layer spanned the full header, and at OS font scale 1.5 a long title such as
   * "Family & Membership" ran straight under the Back arrow. The device pass caught it.
   */
  const titleInset = (target + disc) / 2;

  return (
    <View style={[styles.root, { height: dp(PROFILE_LAYOUT.header.height) }]} testID={testID}>
      <View
        style={[styles.titleLayer, { left: titleInset, right: titleInset }]}
        pointerEvents="none"
        testID={`${testID}-title-layer`}
      >
        <EntryAuthText
          token="titleCompact"
          align="center"
          numberOfLines={1}
          /**
           * Capped so a large OS text size cannot outgrow the space between the two controls.
           *
           * 1.2 rather than 1.3: at 1.3 the longest title this header carries measures ~288 dp
           * against the ~281 dp the insets leave, so it ellipsised. An abbreviated screen title is
           * a worse outcome than one rendered a step smaller, and every other element on these
           * screens still scales without a cap.
           */
          maxFontSizeMultiplier={1.2}
          accessibilityRole="header"
          color={subscriptionColors.textPrimary}
          testID={`${testID}-title`}
        >
          {title}
        </EntryAuthText>
      </View>

      <Pressable
        onPress={onBack}
        accessible
        accessibilityRole="button"
        accessibilityLabel={backLabel}
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

      {onHelp === undefined ? (
        // The slot, without the control. Removing it entirely would slide the centred title left.
        <View style={{ width: target, height: target }} testID={`${testID}-help-spacer`} />
      ) : (
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
      )}
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
    // `left` and `right` are supplied by the component — see `titleInset`.
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
