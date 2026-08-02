import { StyleSheet, View } from 'react-native';

import { EntryAuthText } from '@features/entry-auth/components/entry-auth-text';
import { useEntryAuthMetrics } from '@features/entry-auth/use-entry-auth-metrics';
import { PlanBadge, type PlanBadgeTone } from '@features/subscription/components/plan-badge';
import { subscriptionColors } from '@features/subscription/subscription-tokens';

export type ProfileStatusRowProps = {
  readonly label: string;
  /**
   * The state, as a word: "Allowed", "English", "Light". Never carried by colour alone.
   *
   * Omitted where the row's state *is* its marker ("Arabic — Coming later") or where the row is
   * purely informational and its sentence is the content. Rendering an empty value in those cases
   * would put a blank element in the accessibility tree for no reason.
   */
  readonly value?: string;
  /** A pill beside the value — "Active", "Coming later". Also spoken, never decorative. */
  readonly marker?: string;
  readonly markerTone?: PlanBadgeTone;
  /** Explanatory line beneath. */
  readonly supporting?: string;
  /**
   * Overrides what a screen reader says for the label/value pair.
   *
   * Used where the visible pair is terse — "Theme, Light" is complete, but "Arabic, Coming later"
   * needs to be one announcement rather than a value and an unrelated pill.
   */
  readonly accessibilityLabel?: string;
  readonly testID: string;
};

/**
 * A labelled state, with an optional pill and an optional explanation.
 *
 * ── Why this is not `ProfileDetailRow` ──────────────────────────────────────
 * `ProfileDetailRow` presents a *value the user owns* — their name, their email — as a label above
 * a value. This presents a *state the app is in*, which needs three things that row does not have:
 * the label and value on one line so a four-section screen stays compact, a marker slot for
 * "Coming later", and a value whose meaning is carried by the word rather than by its position.
 *
 * The two are kept separate rather than one component with five flags, because a row that can be
 * either shape ends up being neither well.
 *
 * ── Accessibility ───────────────────────────────────────────────────────────
 * The label, value and marker are one accessible element with one label, so a screen reader says
 * "Device permission, Unavailable" instead of three fragments the user has to reassemble. The
 * supporting line stays separate: it is a sentence, and appending it would make the announcement
 * too long to skim.
 */
export function ProfileStatusRow({
  label,
  value,
  marker,
  markerTone = 'neutral',
  supporting,
  accessibilityLabel,
  testID,
}: ProfileStatusRowProps) {
  const { dp } = useEntryAuthMetrics();

  return (
    <View style={{ rowGap: dp(4) }} testID={testID}>
      <View
        style={[styles.line, { columnGap: dp(8) }]}
        accessible
        accessibilityLabel={
          accessibilityLabel ??
          [label, value, marker].filter((part) => part !== undefined).join(', ')
        }
      >
        <EntryAuthText token="label" style={styles.label} testID={`${testID}-label`}>
          {label}
        </EntryAuthText>

        {value === undefined && marker === undefined ? null : (
          <View style={[styles.trailing, { columnGap: dp(6) }]}>
            {value === undefined ? null : (
              <EntryAuthText
                token="body"
                color={subscriptionColors.textPrimary}
                testID={`${testID}-value`}
              >
                {value}
              </EntryAuthText>
            )}

            {marker === undefined ? null : (
              <PlanBadge label={marker} tone={markerTone} testID={`${testID}-marker`} />
            )}
          </View>
        )}
      </View>

      {supporting === undefined ? null : (
        <EntryAuthText
          token="caption"
          color={subscriptionColors.textSecondary}
          testID={`${testID}-supporting`}
        >
          {supporting}
        </EntryAuthText>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  line: {
    flexDirection: 'row',
    // Top rather than centre: at a large OS text size the label wraps to two lines and a centred
    // value would float away from the first one, which is the line it belongs to.
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  label: {
    flexShrink: 1,
  },
  trailing: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 1,
  },
});
