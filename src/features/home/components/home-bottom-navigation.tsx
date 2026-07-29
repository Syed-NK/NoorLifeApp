import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppIcon, PressableScale } from '@ds/components';
import { navigationColors, neutralColors, semanticColors } from '@ds/tokens';
import { iconButtonA11y } from '@shared/utils/a11y';
import { AI_NAV_INDEX, type ModuleTheme, type NavItem } from '@shared/models/module-theme';

import { LOCKED } from '../main-home-metrics';
import { useMetrics } from '../main-home-metrics-context';
import { HomeText } from './home-text';
import { RobotAsset } from './robot-asset';

export type HomeBottomNavigationProps = {
  readonly theme: ModuleTheme;
  /** `key` of the active navigation item. */
  readonly activeKey: string;
  readonly onNavigate: (item: NavItem) => void;
  readonly testID?: string;
};

/**
 * Main Home's fixed bottom navigation.
 *
 * Locked by 07-bottom-navigation-reference.png and the compact-layout correction:
 *
 *   • outside the content container, `position: absolute`, left/right/bottom 0
 *   • height `68 + insets.bottom`
 *   • exactly five slots, every one `flex: 1` — no manual left offsets
 *   • side icons 24 × 24 dp, side labels 9.5/12 with a 2 dp top margin, centred in slot
 *   • centre control: a 58 × 58 dp selection circle holding a 50 × 50 dp robot PNG,
 *     raised 15 dp, centred in slot three
 *   • **no label beneath the centre control** — the "Noor AI" caption is removed
 *
 * Three details carry the "must not overlap / must not concatenate" requirement: every slot
 * is `flex: 1` with `minWidth: 0`, so a long label cannot push its slot open and shunt its
 * neighbours; every label is `alignSelf: 'stretch'` and centred, so it ellipsises inside
 * its own fifth rather than bleeding into the next; and the centre control's container is
 * the slot itself, so "centred in slot three" is structural, not a measured offset.
 *
 * ── Why every slot is a plain View ──────────────────────────────────────────
 * The `flex: 1` lives on a plain `View` per slot and the pressable fills it, rather than
 * the pressable carrying the flex itself. Historically `PressableScale` applied its `style`
 * to the inner `Pressable`, leaving its wrapper shrink-wrapped, so the four side items
 * sized to their labels and the centre slot absorbed the surplus — which is how the labels
 * ended up clustered toward the screen edges. `PressableScale` now styles its outer view,
 * so this structure is belt-and-braces rather than a workaround, and it keeps the slot
 * geometry independent of that component's internals.
 *
 * The centre control keeps its accessible name via `accessibilityLabel`, so removing the
 * visible caption costs nothing for screen-reader users.
 */
export function HomeBottomNavigation({
  theme,
  activeKey,
  onNavigate,
  testID,
}: HomeBottomNavigationProps) {
  const insets = useSafeAreaInsets();
  const { dp } = useMetrics();

  const barHeight = dp(LOCKED.bottomNav.height);
  const aiSize = dp(LOCKED.bottomNav.aiButton);

  return (
    <View
      style={[styles.root, { height: barHeight + insets.bottom, paddingBottom: insets.bottom }]}
      accessibilityRole="tablist"
      testID={testID}
    >
      <View style={[styles.row, { height: barHeight }]}>
        {theme.navigation.map((item, index) => {
          const isActive = item.key === activeKey;
          const tint = isActive ? semanticColors.primary : navigationColors.inactive;

          if (index === AI_NAV_INDEX) {
            return (
              <View key={item.key} style={[styles.slot, styles.aiSlot]}>
                {/* Top-aligned with a negative margin, so the control's top edge lands
                    exactly `aiRaise` above the bar. Centring it and then translating gave
                    only half the intended lift, because the centring offset (≈7 dp) ate
                    into the transform. There is no label competing for space in this slot,
                    so flex-start is free to use. */}
                <View style={{ marginTop: -dp(LOCKED.bottomNav.aiRaise) }} pointerEvents="box-none">
                  <PressableScale
                    onPress={() => onNavigate(item)}
                    style={[
                      styles.aiButton,
                      {
                        width: aiSize,
                        height: aiSize,
                        borderRadius: aiSize / 2,
                        borderWidth: LOCKED.bottomNav.aiBorder,
                      },
                    ]}
                    {...iconButtonA11y(item.accessibilityLabel ?? `Open ${item.label}`, {
                      selected: isActive,
                    })}
                    testID={`${testID ?? 'home-nav'}-ai`}
                  >
                    <RobotAsset size={dp(LOCKED.bottomNav.aiImage)} />
                  </PressableScale>
                </View>
                {/* No caption here by design — see the component note. */}
              </View>
            );
          }

          return (
            <View key={item.key} style={styles.slot}>
              <PressableScale
                onPress={() => onNavigate(item)}
                accessibilityRole="tab"
                accessibilityLabel={item.accessibilityLabel ?? item.label}
                accessibilityState={{ selected: isActive }}
                style={styles.slotContent}
                testID={`${testID ?? 'home-nav'}-${item.key}`}
              >
                <AppIcon name={item.icon} size={dp(LOCKED.bottomNav.icon)} color={tint} />
                <HomeText token="navLabel" color={tint} numberOfLines={1} style={styles.label}>
                  {item.label}
                </HomeText>
              </PressableScale>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: neutralColors.surface,
    borderTopWidth: 1,
    borderTopColor: neutralColors.border,
    zIndex: 10,
  },
  row: {
    flexDirection: 'row',
    // `stretch`, not `center`: the slots must fill the bar's full height, otherwise each
    // one shrink-wraps its content and the centre control's negative margin has no bar
    // height to offset against — it measured a 0 dp raise.
    alignItems: 'stretch',
  },
  slot: {
    flex: 1,
    // Prevents a label wider than its fifth from expanding the slot and pushing its
    // neighbours together — the cause of "InsightsProfile" running into one another.
    minWidth: 0,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 2,
  },
  /** The centre slot top-aligns so its negative margin produces the exact locked raise. */
  aiSlot: {
    justifyContent: 'flex-start',
  },
  /** Fills its slot, so the touch target is the whole fifth. */
  slotContent: {
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
  },
  aiButton: {
    backgroundColor: neutralColors.surface,
    borderColor: semanticColors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  label: {
    alignSelf: 'stretch',
    textAlign: 'center',
    marginTop: LOCKED.bottomNav.labelMarginTop,
  },
});
