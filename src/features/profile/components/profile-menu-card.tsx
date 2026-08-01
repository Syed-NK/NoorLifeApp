import { Fragment } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppIcon } from '@ds/components';
import { EntryAuthText } from '@features/entry-auth/components/entry-auth-text';
import { useEntryAuthMetrics } from '@features/entry-auth/use-entry-auth-metrics';
import { PlanBadge } from '@features/subscription/components/plan-badge';
import { subscriptionColors } from '@features/subscription/subscription-tokens';

import { profileCopy } from '../profile-copy';
import { PROFILE_LAYOUT } from '../profile-metrics';
import { PROFILE_MENU, type ProfileMenuItem } from '../profile-routes';

export type ProfileMenuCardProps = {
  /** Called with the row that was tapped. The screen decides navigate-or-explain. */
  readonly onSelect: (item: ProfileMenuItem) => void;
  readonly testID?: string;
};

/**
 * The five primary destinations, as one card.
 *
 * ── Exactly five, always ────────────────────────────────────────────────────
 * The rows come from `PROFILE_MENU` rather than being written out here, so "exactly five" is a
 * property of one list a test can count rather than of markup somebody has to read. This replaced
 * a screen of twenty-six rows across seven sections; the settings that used to be listed here now
 * belong to the five detail screens, which is the whole point of the summary.
 *
 * ── Rows that lead nowhere yet still lead somewhere ─────────────────────────
 * Three destinations do not exist. None of those rows is hidden, disabled or inert: each is a full
 * 46 dp control that opens the centralized "coming later" note naming itself. The visible marker
 * beside such a row is development-only — in production the row looks like any other and the
 * honest answer arrives on tap, which is the behaviour §6 asks for.
 */
export function ProfileMenuCard({ onSelect, testID = 'profile-menu' }: ProfileMenuCardProps) {
  const { dp } = useEntryAuthMetrics();
  const { menu } = PROFILE_LAYOUT;

  return (
    <View
      style={[styles.card, { borderRadius: dp(PROFILE_LAYOUT.cardRadius) }]}
      accessibilityRole="menu"
      testID={testID}
    >
      {PROFILE_MENU.map((item, index) => {
        const comingLater = item.available === null;

        return (
          <Fragment key={item.key}>
            {index === 0 ? null : (
              <View
                style={{ height: menu.separator, backgroundColor: subscriptionColors.border }}
              />
            )}

            <Pressable
              onPress={() => onSelect(item)}
              accessible
              accessibilityRole="menuitem"
              accessibilityLabel={item.label}
              {...(comingLater
                ? { accessibilityHint: profileCopy.comingLater.accessibilityHint }
                : {})}
              style={[
                styles.row,
                {
                  // 46 dp, already above the 44 dp minimum — the whole row is the target, so no
                  // hit slop is standing in for a control that is really too small.
                  minHeight: dp(menu.rowHeight),
                  paddingHorizontal: dp(menu.paddingHorizontal),
                  columnGap: dp(menu.columnGap),
                },
              ]}
              testID={item.testID}
            >
              <AppIcon
                name={item.icon}
                size={dp(menu.icon)}
                color={subscriptionColors.textSecondary}
              />

              <EntryAuthText
                token="body"
                color={subscriptionColors.textPrimary}
                style={styles.label}
                testID={`${item.testID}-label`}
              >
                {item.label}
              </EntryAuthText>

              {/* Development only. See the note above: production shows the row, not the marker. */}
              {comingLater && __DEV__ ? (
                <PlanBadge
                  label={profileCopy.comingLater.marker}
                  tone="neutral"
                  testID={`${item.testID}-later`}
                />
              ) : null}

              <AppIcon
                name="chevron-forward"
                size={dp(menu.chevron)}
                color={subscriptionColors.textSecondary}
              />
            </Pressable>
          </Fragment>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    width: '100%',
    borderWidth: PROFILE_LAYOUT.cardBorder,
    borderColor: subscriptionColors.border,
    backgroundColor: subscriptionColors.surface,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  label: {
    flex: 1,
  },
});
