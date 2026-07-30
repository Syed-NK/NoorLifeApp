import { useRouter } from 'expo-router';
import { Image, StyleSheet, View } from 'react-native';

import { AppIcon, PressableScale } from '@ds/components';
import { globalRoutes } from '@application/navigation/routes';
import { profileAvatar } from '@features/home/module-pictograms';
import { iconButtonA11y } from '@shared/utils/a11y';

import { useModule } from '../module-context';
import { moduleLayout, moduleNeutrals } from '../module-tokens';
import { useModuleMetrics } from '../use-module-metrics';
import { ModuleText } from './module-text';

export type ModuleHeaderProps = {
  /** Overrides the module name — used on sub-screens ("Prayer Times"). */
  readonly title?: string;
  /**
   * Where Back goes. Defaults to Main Home.
   *
   * The brief fixes Back's meaning as "return to Main Home", not "pop one screen".
   * A module is entered from the grid, so popping would strand a user who arrived
   * three screens deep via a notification.
   */
  readonly onBack?: () => void;
  readonly testID?: string;
};

/**
 * The header every module screen shares.
 *
 * Four controls, in the order the brief fixes: Back, the user's profile image,
 * the screen title, and Help. Help is module-scoped — it opens assistance *for this
 * module*, which is why the destination comes from the module definition rather
 * than being a single global help route hard-coded here.
 *
 * The title is centred between the two control clusters and truncates to one line.
 * The clusters are equal fixed widths so the title's centre is the header's centre
 * regardless of how long the module name is.
 */
export function ModuleHeader({ title, onBack, testID }: ModuleHeaderProps) {
  const router = useRouter();
  const module = useModule();
  const { dp, pagePadding } = useModuleMetrics();

  const iconSize = dp(moduleLayout.headerIcon);
  const avatarSize = dp(moduleLayout.headerAvatar);
  const target = dp(moduleLayout.minTouchTarget);
  // Both clusters reserve the same width, so the centred title is truly centred.
  const clusterWidth = target + avatarSize + dp(4);

  return (
    <View
      style={[
        styles.root,
        { height: dp(moduleLayout.headerHeight), paddingHorizontal: pagePadding },
      ]}
      testID={testID}
    >
      <View style={[styles.cluster, { width: clusterWidth }]}>
        <PressableScale
          onPress={onBack ?? (() => router.replace(globalRoutes.home))}
          style={[styles.control, { width: target, height: target }]}
          {...iconButtonA11y('Back to Main Home')}
          testID={`${testID ?? 'module-header'}-back`}
        >
          <AppIcon name="back" size={iconSize} color={moduleNeutrals.textPrimary} />
        </PressableScale>

        <PressableScale
          onPress={() => router.push(globalRoutes.profile)}
          style={[styles.control, { width: avatarSize, height: avatarSize }]}
          hitSlop={Math.max(0, Math.ceil((target - avatarSize) / 2))}
          {...iconButtonA11y('Your profile')}
          testID={`${testID ?? 'module-header'}-profile`}
        >
          <Image
            source={profileAvatar}
            style={{
              width: avatarSize,
              height: avatarSize,
              borderRadius: avatarSize / 2,
              borderWidth: 1,
              borderColor: module.theme.border,
            }}
            resizeMode="cover"
            accessible={false}
          />
        </PressableScale>
      </View>

      <ModuleText
        token="headerTitle"
        align="center"
        numberOfLines={1}
        // Caps growth so a large OS text size cannot push the title into the controls.
        maxFontSizeMultiplier={1.3}
        style={styles.title}
        accessibilityRole="header"
        testID={`${testID ?? 'module-header'}-title`}
      >
        {title ?? module.name}
      </ModuleText>

      <View style={[styles.cluster, styles.clusterEnd, { width: clusterWidth }]}>
        <PressableScale
          onPress={() => router.push(module.routes.help)}
          style={[styles.control, { width: target, height: target }]}
          {...iconButtonA11y(`Help with ${module.name}`)}
          testID={`${testID ?? 'module-header'}-help`}
        >
          <AppIcon name="help" size={iconSize} color={module.theme.ink} />
        </PressableScale>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'transparent',
  },
  cluster: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  clusterEnd: {
    justifyContent: 'flex-end',
  },
  control: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    flex: 1,
    minWidth: 0,
  },
});
