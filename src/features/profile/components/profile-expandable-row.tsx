import { Pressable, StyleSheet, View } from 'react-native';

import { AppIcon } from '@ds/components';
import { EntryAuthText } from '@features/entry-auth/components/entry-auth-text';
import { useEntryAuthMetrics } from '@features/entry-auth/use-entry-auth-metrics';
import { subscriptionColors } from '@features/subscription/subscription-tokens';

import { PROFILE_LAYOUT } from '../profile-metrics';

export type ProfileExpandableRowProps = {
  readonly question: string;
  readonly answer: string;
  readonly expanded: boolean;
  readonly onToggle: () => void;
  readonly expandHint: string;
  readonly collapseHint: string;
  readonly testID: string;
};

/**
 * One frequently asked question, as an accessible disclosure.
 *
 * ── Why a disclosure rather than a list of six answers ──────────────────────
 * Six questions with their answers open is roughly two and a half viewports of prose before the
 * user reaches Contact Support, which is what most people opened this screen for. Collapsed, the
 * six questions are a scannable index and the answer the user wants is one press away.
 *
 * ── What makes it accessible rather than merely collapsible ─────────────────
 * The header is a `button` carrying `accessibilityState.expanded`, so TalkBack and VoiceOver
 * announce "collapsed"/"expanded" rather than leaving the state to a chevron nobody can hear. The
 * hint changes with the state, so the spoken affordance matches what a press will actually do. And
 * the answer is genuinely removed from the tree when closed rather than hidden with opacity, so a
 * screen reader cannot read text the user cannot see.
 *
 * ── No animation ────────────────────────────────────────────────────────────
 * The row opens instantly. A height animation would have to be gated on Reduce Motion, and there
 * is nothing here worth animating — the content simply appears, which is also the behaviour a
 * Reduce Motion user would get anyway.
 */
export function ProfileExpandableRow({
  question,
  answer,
  expanded,
  onToggle,
  expandHint,
  collapseHint,
  testID,
}: ProfileExpandableRowProps) {
  const { dp } = useEntryAuthMetrics();

  return (
    <View style={{ rowGap: dp(6) }} testID={testID}>
      <Pressable
        onPress={onToggle}
        accessible
        accessibilityRole="button"
        accessibilityLabel={question}
        accessibilityHint={expanded ? collapseHint : expandHint}
        accessibilityState={{ expanded }}
        style={[styles.header, { minHeight: dp(PROFILE_LAYOUT.minTouchTarget), columnGap: dp(10) }]}
        testID={`${testID}-toggle`}
      >
        <EntryAuthText
          token="body"
          color={subscriptionColors.textPrimary}
          style={styles.question}
          testID={`${testID}-question`}
        >
          {question}
        </EntryAuthText>

        {/* The semantic icon set has no up/down chevron, so the forward one is turned a quarter
            turn to point down when the answer is open. Rotating the approved glyph keeps the
            registry as the single source of icons rather than adding a name for one use. */}
        <View style={expanded ? styles.chevronOpen : undefined} pointerEvents="none">
          <AppIcon
            name="chevron-forward"
            size={dp(PROFILE_LAYOUT.menu.chevron)}
            color={subscriptionColors.textSecondary}
          />
        </View>
      </Pressable>

      {expanded ? (
        <EntryAuthText
          token="caption"
          color={subscriptionColors.textSecondary}
          testID={`${testID}-answer`}
        >
          {answer}
        </EntryAuthText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  question: {
    flex: 1,
  },
  chevronOpen: {
    transform: [{ rotate: '90deg' }],
  },
});
