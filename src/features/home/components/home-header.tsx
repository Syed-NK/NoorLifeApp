import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';

import { AppIcon, PressableScale } from '@ds/components';
import { neutralColors, radius, semanticColors } from '@ds/tokens';
import { iconButtonA11y } from '@shared/utils/a11y';

import { LOCKED } from '../main-home-metrics';
import { profileAvatar } from '../module-pictograms';
import { useMetrics } from '../main-home-metrics-context';
import { HomeText } from './home-text';

/**
 * Avatar ring colour, fixed by the pack.
 *
 * Not in the §2.1 neutral tokens — it is a touch cooler than `border` (`#E2E6EC`) — so it
 * is recorded here rather than added to the global palette for one ring.
 */
const AVATAR_BORDER = '#DCE2EA';

export type HomeHeaderProps = {
  /** Greeting eyebrow, e.g. "Assalamu Alaikum,". */
  readonly greeting: string;
  /** The user's display name. */
  readonly name: string;
  readonly avatarUri?: string;
  readonly onPressAvatar: () => void;
  readonly onPressNotifications: () => void;
  /** Unread count. 0 hides the badge; values above 9 render as "9+". */
  readonly notificationCount?: number;
  readonly testID?: string;
};

/**
 * Main Home header, locked by 01-header-reference.png and the polish pass.
 *
 * Locked: 48 dp container, a 36 dp circular avatar container holding a 34 dp image with a
 * 1 dp `#DCE2EA` ring, 10 dp avatar-to-text gap, greeting 10.5/14, name 15/20 w600, and a
 * 44 dp notification target with a 22 dp glyph and a 16 dp `#D92D4C` badge.
 *
 * The avatar is a project-local PNG rendered `cover`, with no initials fallback behind or
 * over it. There is no back button on Main Home.
 *
 * The image is 34 dp but the whole greeting block is the touch target, so the 44 dp
 * accessibility minimum is met without inflating the picture.
 *
 * The unread count is announced in the notification button's label as well as shown
 * in the badge, so the unread state never depends on the badge colour alone.
 */
export function HomeHeader({
  greeting,
  name,
  avatarUri,
  onPressAvatar,
  onPressNotifications,
  notificationCount = 0,
  testID,
}: HomeHeaderProps) {
  const { dp, pagePadding } = useMetrics();
  const hasBadge = notificationCount > 0;
  const badgeText = notificationCount > 9 ? '9+' : String(notificationCount);

  const avatarSize = dp(LOCKED.header.avatar);
  const imageSize = dp(LOCKED.header.avatarImage);
  const target = dp(LOCKED.header.notificationTarget);
  const badgeSize = dp(LOCKED.header.badge);

  return (
    <View
      /*
        A minimum, not a fixed height — the 44 dp accessibility floor, issue 115.

        The profile row and the notification button inside carry the shared floor, and a parent
        with a fixed height clipped them: 41.481 dp each on a 320 dp handset. The locked value is
        unchanged and still what the header draws wherever the content fits; it now yields rather
        than cutting a control below the minimum.
      */
      style={[styles.root, { minHeight: dp(LOCKED.header.height), paddingHorizontal: pagePadding }]}
      testID={testID}
    >
      <PressableScale
        onPress={onPressAvatar}
        style={[styles.identity, { gap: dp(LOCKED.header.avatarGap), minHeight: target }]}
        {...iconButtonA11y(`Open profile for ${name}`)}
      >
        <View
          style={[
            styles.avatar,
            {
              width: avatarSize,
              height: avatarSize,
              borderRadius: avatarSize / 2,
              borderWidth: LOCKED.header.avatarBorderWidth,
            },
          ]}
        >
          {/* The bundled avatar always renders — no initials behind or over it. A remote
              `avatarUri` overrides it once real profiles exist. */}
          <Image
            source={avatarUri === undefined ? profileAvatar : { uri: avatarUri }}
            style={{
              width: imageSize,
              height: imageSize,
              borderRadius: imageSize / 2,
            }}
            contentFit="cover"
            accessible={false}
            testID={`${testID ?? 'home-header'}-avatar`}
          />
        </View>

        <View style={styles.greetingColumn}>
          <HomeText token="greeting" color={neutralColors.textSecondary} numberOfLines={1}>
            {greeting}
          </HomeText>
          <HomeText token="name" numberOfLines={1}>
            {name}
          </HomeText>
        </View>
      </PressableScale>

      <PressableScale
        onPress={onPressNotifications}
        style={[styles.notificationButton, { width: target, height: target }]}
        {...iconButtonA11y(
          hasBadge ? `Notifications, ${notificationCount} unread` : 'Notifications, none unread',
        )}
      >
        <AppIcon
          name="notification"
          size={dp(LOCKED.header.notificationIcon)}
          color={neutralColors.textPrimary}
        />
        {hasBadge ? (
          <View
            style={[
              styles.badge,
              {
                minWidth: badgeSize,
                height: badgeSize,
                borderRadius: badgeSize / 2,
                top: dp(4),
                right: dp(4),
              },
            ]}
          >
            <HomeText token="badge" color={neutralColors.surface} maxFontSizeMultiplier={1}>
              {badgeText}
            </HomeText>
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
  },
  identity: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 1,
    minWidth: 0,
  },
  avatar: {
    borderColor: AVATAR_BORDER,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  greetingColumn: {
    flexShrink: 1,
    minWidth: 0,
  },
  notificationButton: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    paddingHorizontal: 3,
    backgroundColor: semanticColors.error,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
  },
});
