import { useRouter, type Href } from 'expo-router';
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
   * Where the visible back arrow goes, one level up the hierarchy.
   *
   * Supplied by `ModuleScaffold` from `resolveBackDestination`, so a screen never
   * decides the rule for itself: a module home goes up to Main Home, a module child
   * goes up to its module home.
   */
  readonly backHref: Href;
  /** Human-readable destination for the accessibility label, e.g. "Faith". */
  readonly backLabel: string;
  /** Escape hatch for a screen with a genuinely different back meaning. */
  readonly onBack?: () => void;
  readonly testID?: string;
};

/**
 * The header every module screen shares.
 *
 * Order, fixed by the correction brief and applied to all eight modules:
 *
 *     [Back]        [centred title]        [Help] [Profile]
 *
 * ── Why the title is absolutely positioned ──────────────────────────────────
 * "Visually centered relative to the complete screen, not merely the remaining flex area."
 * Those differ: Back is one control on the left and Help+Profile are two on the right, so a
 * flex-centred title sits left of the screen's true centre by half that difference. The title
 * therefore spans the full header width with `textAlign: 'center'`, and the controls sit above
 * it. `pointerEvents: 'none'` on the title keeps it from swallowing taps meant for a control.
 *
 * ── Why Profile is last ─────────────────────────────────────────────────────
 * It used to sit beside Back, which the brief rules out. Both right-hand controls carry the
 * full 44 dp touch target while the avatar itself stays 34–36 dp, so the visible portrait is
 * the reference's size without the tappable area being under-sized. The portrait is the
 * approved `profileAvatar` PNG — never an initial or a letter placeholder.
 *
 * ── Where Back goes ─────────────────────────────────────────────────────────
 * One level up the hierarchy, resolved by `resolveBackDestination` and passed in. A module
 * home goes to Main Home; a module child goes to its module home and never straight to Main
 * Home. See `application/navigation/module-navigation.ts` for why that is a property of the
 * route rather than of the history.
 */
export function ModuleHeader({ title, backHref, backLabel, onBack, testID }: ModuleHeaderProps) {
  const router = useRouter();
  const module = useModule();
  const { dp, pagePadding } = useModuleMetrics();

  const iconSize = dp(moduleLayout.headerIcon);
  const avatarSize = dp(moduleLayout.headerAvatar);
  const target = dp(moduleLayout.minTouchTarget);
  const prefix = testID ?? 'module-header';

  return (
    <View
      style={[
        styles.root,
        { height: dp(moduleLayout.headerHeight), paddingHorizontal: pagePadding },
      ]}
      testID={testID}
    >
      {/* Centred on the whole header, independent of how wide the control clusters are. */}
      <View style={styles.titleLayer} pointerEvents="none">
        <ModuleText
          token="headerTitle"
          align="center"
          numberOfLines={1}
          // Caps growth so a large OS text size cannot push the title under the controls.
          maxFontSizeMultiplier={1.3}
          accessibilityRole="header"
          testID={`${prefix}-title`}
        >
          {title ?? module.name}
        </ModuleText>
      </View>

      <PressableScale
        /*
          `dismissTo`, not `replace` or `back`.

          `back()` pops history, which exits the app on a cold deep link and skips the
          module home when the user arrived from Main Home's timeline. `replace()` would
          leave a duplicate entry when the destination is already below us in the stack.
          `dismissTo` pops *to* the destination when it is present and replaces when it
          is not — the same visible outcome from any entry point, with no duplicate push.
        */
        onPress={onBack ?? (() => router.dismissTo(backHref))}
        style={[
          styles.control,
          styles.disc,
          { width: target, height: target, borderRadius: target / 2 },
        ]}
        {...iconButtonA11y(`Back to ${backLabel}`)}
        testID={`${prefix}-back`}
      >
        <AppIcon name="back" size={iconSize} color={moduleNeutrals.textPrimary} />
      </PressableScale>

      <View style={[styles.rightCluster, { columnGap: dp(moduleLayout.headerControlGap) }]}>
        <PressableScale
          onPress={() => router.push(module.routes.help)}
          style={[
            styles.control,
            styles.disc,
            { width: target, height: target, borderRadius: target / 2 },
          ]}
          {...iconButtonA11y(`Help with ${module.name}`)}
          testID={`${prefix}-help`}
        >
          <AppIcon name="help" size={iconSize} color={module.theme.ink} />
        </PressableScale>

        <PressableScale
          onPress={() => router.push(globalRoutes.profile)}
          // The target is 44 dp while the portrait stays 34–36 dp, so the visible avatar
          // matches the reference without an under-sized tap area.
          style={[styles.control, { width: target, height: target }]}
          {...iconButtonA11y('Your profile')}
          testID={`${prefix}-profile`}
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
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'transparent',
  },
  /** Spans the header so the title centres on the screen, not on the leftover space. */
  titleLayer: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rightCluster: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  control: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  /**
   * The bordered white disc both approved references draw around Back and Help.
   *
   * The disc *is* the 44 dp touch target, so the visible chrome and the tappable area are the
   * same rectangle — no hit-slop to keep in step with a smaller visual.
   */
  disc: {
    backgroundColor: moduleNeutrals.surface,
    borderWidth: 1,
    borderColor: moduleNeutrals.border,
  },
});
