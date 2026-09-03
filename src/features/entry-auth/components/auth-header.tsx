import { Pressable, StyleSheet, View } from 'react-native';

import { entryAuthColors, entryAuthLayout } from '../entry-auth-tokens';
import type { EntryAuthTypeToken } from '../entry-auth-tokens';
import { useEntryAuthMetrics } from '../use-entry-auth-metrics';
import { EntryAuthText } from './entry-auth-text';
import { minimumTouchTargetSize } from '@shared/utils/a11y';

export type AuthHeaderProps = {
  /** Omitted on screens the workflow gives no back destination. */
  readonly onBack?: () => void;
  readonly title: string;
  readonly subtitle?: string;
  /**
   * Type token for the heading. Defaults to `title`, so every existing screen is unchanged.
   *
   * Added in Phase 5B for the subscription screens, which carry longer headings than an auth form
   * and looked oversized at 22 dp — "Choose how NoorLife supports you" wrapped to two lines and
   * dominated the plan cards beneath it.
   */
  readonly titleToken?: Extract<EntryAuthTypeToken, 'title' | 'titleCompact'>;
  readonly testID?: string;
};

/**
 * Back control, heading and optional subheading.
 *
 * The chevron is two rotated borders rather than an icon-font glyph, for the same reason the
 * provider marks are primitives: the icon families available here are the ones the phase prompt
 * forbids on these screens.
 *
 * The back control's touch target is 44 dp square — the accessibility minimum — while the chevron
 * itself is 10 dp, so the target is generous without the mark being oversized. It sits in a row of
 * its own so the heading below stays optically centred on the page rather than being pushed by it.
 */
export function AuthHeader({
  onBack,
  title,
  subtitle,
  titleToken = 'title',
  testID,
}: AuthHeaderProps) {
  const { dp } = useEntryAuthMetrics();
  const target = minimumTouchTargetSize();
  const chevron = dp(10);
  /**
   * Where the chevron sits inside the target, so its position is unchanged by #123's fix.
   *
   * Centred, the glyph would sit `(target - chevron) / 2` from the target edge. The old
   * `marginLeft: -10` then moved the whole target 10 dp left, putting the glyph 10 dp closer to
   * the page gutter. With the target no longer moving, the same 10 dp comes off this inset
   * instead — identical rendering, and nothing outside the parent.
   *
   * `target` is pixel-safe rather than scaled and never drops below 44, while `chevron` only
   * ever downscales, so this cannot go negative and reintroduce the defect by another route.
   */
  const glyphInset = Math.max((target - chevron) / 2 - 10, 0);

  return (
    <View style={{ gap: dp(6) }} testID={testID}>
      {/*
        Identified so the reserve is measurable — issue #123. The row is given the target's own
        height, so the control is never asked to fit a parent shorter than itself; the heading stays
        in its own row below, which is what keeps it centred on the page rather than pushed by the
        control. A guard can only hold that if it can find the row.
      */}
      <View
        style={[styles.backRow, { height: target }]}
        testID={`${testID ?? 'auth-header'}-back-row`}
      >
        {onBack === undefined ? null : (
          <Pressable
            onPress={onBack}
            accessibilityRole="button"
            accessibilityLabel="Go back"
            hitSlop={8}
            style={[
              styles.backTarget,
              { width: target, height: target },
              {
                minWidth: minimumTouchTargetSize(),
                minHeight: minimumTouchTargetSize(),
                /*
                  The glyph is inset rather than the target being pulled out — issue #123.

                  The optical intent has not changed: the chevron sits where it always did, its
                  visual edge on the page gutter rather than its target box centred there. What
                  changed is which box moves. `paddingLeft` shifts the glyph *within* a target that
                  now starts at the gutter, so the whole 44 dp square is inside the scroll
                  container and reachable. Before, `marginLeft: -10` moved the target itself, and
                  the container clipped the 10 dp that ended up outside it — leaving an
                  accessibility node 34.133 dp wide against a 44 dp floor.

                  Left-aligned rather than centred, because centring would re-centre the glyph in
                  the box and undo the inset. Vertical centring is unaffected.
                */
                alignItems: 'flex-start',
                justifyContent: 'center',
                paddingLeft: glyphInset,
              },
            ]}
            testID={`${testID ?? 'auth-header'}-back`}
          >
            <View
              style={{
                width: chevron,
                height: chevron,
                borderLeftWidth: 2,
                borderBottomWidth: 2,
                borderColor: entryAuthColors.textPrimary,
                transform: [{ rotate: '45deg' }],
              }}
            />
          </Pressable>
        )}
      </View>

      <EntryAuthText token={titleToken} align="center" accessibilityRole="header">
        {title}
      </EntryAuthText>
      {subtitle === undefined ? null : (
        <EntryAuthText token="subtitle" align="center">
          {subtitle}
        </EntryAuthText>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  backRow: {
    justifyContent: 'center',
  },
  backTarget: {
    /*
      Deliberately carries no margin — issue #123.

      This held `marginLeft: -10` to line the glyph's edge up with the page gutter. The parent is
      the scroll container whose own left edge *is* that gutter, so the negative margin did not
      move the target into the margin; it moved 10 dp of the target out of the parent, which
      clipped it. `hitSlop` could not rescue it either, being clipped by the same edge.

      The offset now lives on the glyph inside the target. See `glyphInset`.
    */
  },
});
