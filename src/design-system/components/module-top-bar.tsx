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
} from '@ds/tokens';
import { iconButtonA11y } from '@shared/utils/a11y';
import { backChevron } from '@shared/utils/rtl';
import type { ModuleTheme } from '@shared/models/module-theme';

export type ModuleTopBarProps = {
  readonly theme: ModuleTheme;
  /** Overrides the theme's display name when a sub-screen needs its own title. */
  readonly title?: string;
  readonly avatarUri?: string;
  readonly onPressBack: () => void;
  readonly onPressHelp: () => void;
  readonly onPressAvatar?: () => void;
  readonly testID?: string;
};

/**
 * Module top bar (§3.2), identical across every module.
 *
 * Structure is fixed by the spec: 44 × 44 back button far left, 36 × 36 profile
 * photo, module title, 44 × 44 help button far right.
 *
 * The back glyph is direction-aware: in RTL it points the other way, since a
 * mirrored layout does not mirror a glyph's meaning on its own.
 */
export function ModuleTopBar({
  theme,
  title,
  avatarUri,
  onPressBack,
  onPressHelp,
  onPressAvatar,
  testID,
}: ModuleTopBarProps) {
  const displayTitle = title ?? theme.name;

  return (
    <View style={styles.root} testID={testID}>
      <PressableScale
        onPress={onPressBack}
        style={styles.edgeButton}
        {...iconButtonA11y('Go back')}
      >
        <AppIcon name={backChevron()} size={iconSize.md} color={neutralColors.textPrimary} />
      </PressableScale>

      <View style={styles.centre}>
        <PressableScale
          onPress={onPressAvatar ?? (() => undefined)}
          disabled={onPressAvatar === undefined}
          style={styles.avatar}
          {...iconButtonA11y('Open profile', { disabled: onPressAvatar === undefined })}
        >
          {avatarUri === undefined ? (
            <AppIcon name="profile" size={iconSize.sm} color={semanticColors.primary} />
          ) : (
            <Image
              source={{ uri: avatarUri }}
              style={styles.avatarImage}
              contentFit="cover"
              accessible={false}
            />
          )}
        </PressableScale>
        <AppText variant="screenTitle" numberOfLines={1} style={styles.title}>
          {displayTitle}
        </AppText>
      </View>

      <PressableScale
        onPress={onPressHelp}
        style={styles.edgeButton}
        {...iconButtonA11y(`Help with ${displayTitle}`)}
      >
        <AppIcon name="help" size={iconSize.md} color={neutralColors.textSecondary} />
      </PressableScale>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: layout.screenPaddingHorizontal - spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  edgeButton: {
    width: elementSize.moduleTopBarButton,
    height: elementSize.moduleTopBarButton,
    alignItems: 'center',
    justifyContent: 'center',
  },
  centre: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  avatar: {
    width: elementSize.moduleTopBarAvatar,
    height: elementSize.moduleTopBarAvatar,
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
  title: {
    flexShrink: 1,
  },
});
