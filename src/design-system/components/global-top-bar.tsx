import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@ds/typography/app-text';
import { AppIcon } from './app-icon';
import { PressableScale } from './pressable-scale';

import {
  elementSize,
  iconSize,
  layout,
  neutralColors,
  radius,
  semanticColors,
  spacing,
  touchTarget,
} from '@ds/tokens';
import { iconButtonA11y } from '@shared/utils/a11y';

export type GlobalTopBarProps = {
  /** Greeting eyebrow, e.g. "Assalamu Alaikum,". */
  readonly greeting: string;
  /** The user's display name, rendered on the second line. */
  readonly name: string;
  /** Remote or local avatar URI. Falls back to an initial when absent. */
  readonly avatarUri?: string;
  readonly onPressAvatar: () => void;
  readonly onPressNotifications: () => void;
  /** Unread count. 0 hides the badge; values above 9 render as "9+". */
  readonly notificationCount?: number;
  readonly testID?: string;
};

/**
 * Main Home top bar (§3.1): profile image, greeting, notification button.
 *
 * Both controls are 44 × 44 and carry screen-reader labels (§8). The notification
 * count is announced in the label as well as shown in the badge, so the unread
 * state is never communicated by the badge colour alone.
 */
export function GlobalTopBar({
  greeting,
  name,
  avatarUri,
  onPressAvatar,
  onPressNotifications,
  notificationCount = 0,
  testID,
}: GlobalTopBarProps) {
  const hasBadge = notificationCount > 0;
  const badgeText = notificationCount > 9 ? '9+' : String(notificationCount);

  return (
    <View style={styles.root} testID={testID}>
      <PressableScale
        onPress={onPressAvatar}
        style={styles.identity}
        {...iconButtonA11y(`Open profile for ${name}`)}
      >
        <View style={styles.avatar}>
          {avatarUri === undefined ? (
            <AppText variant="cardTitle" color={semanticColors.primary}>
              {name.trim().charAt(0).toUpperCase()}
            </AppText>
          ) : (
            <Image
              source={{ uri: avatarUri }}
              style={styles.avatarImage}
              contentFit="cover"
              accessible={false}
            />
          )}
        </View>
        <View style={styles.greetingColumn}>
          <AppText variant="caption" color={neutralColors.textSecondary} numberOfLines={1}>
            {greeting}
          </AppText>
          <AppText variant="cardTitle" numberOfLines={1}>
            {name}
          </AppText>
        </View>
      </PressableScale>

      <PressableScale
        onPress={onPressNotifications}
        style={styles.notificationButton}
        {...iconButtonA11y(
          hasBadge ? `Notifications, ${notificationCount} unread` : 'Notifications, none unread',
        )}
      >
        <AppIcon name="notification" size={iconSize.md} color={neutralColors.textPrimary} />
        {hasBadge ? (
          <View style={styles.badge}>
            <AppText variant="caption" color={neutralColors.surface} maxFontSizeMultiplier={1}>
              {badgeText}
            </AppText>
          </View>
        ) : null}
      </PressableScale>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: layout.screenPaddingHorizontal,
    paddingVertical: spacing.md,
    gap: spacing.md,
  },
  identity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    flexShrink: 1,
    minHeight: touchTarget.minimum,
  },
  avatar: {
    width: elementSize.globalTopBarAvatar,
    height: elementSize.globalTopBarAvatar,
    borderRadius: radius.pill,
    backgroundColor: neutralColors.surfaceSoft,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarImage: {
    width: '100%',
    height: '100%',
  },
  greetingColumn: {
    flexShrink: 1,
  },
  notificationButton: {
    width: touchTarget.minimum,
    height: touchTarget.minimum,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    top: 4,
    right: 4,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: radius.pill,
    backgroundColor: semanticColors.error,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: neutralColors.canvas,
  },
});
