import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@ds/typography/app-text';
import { AppIcon } from './app-icon';
import { PressableScale } from './pressable-scale';
import { RobotAIButton } from './robot-ai-button';

import {
  elementSize,
  fontFamilies,
  navigationColors,
  neutralColors,
  semanticColors,
} from '@ds/tokens';
import { AI_NAV_INDEX, type ModuleTheme, type NavItem } from '@shared/models/module-theme';
import { minimumTouchTargetSize } from '@shared/utils/a11y';

/** Lock §13: nav labels are 9.5/13. */
const LABEL_SIZE = 9.5;
const LABEL_LINE_HEIGHT = 13;

export type ModuleBottomNavigationProps = {
  readonly theme: ModuleTheme;
  /** `key` of the active navigation item. */
  readonly activeKey: string;
  readonly onNavigate: (item: NavItem) => void;
  /**
   * Active-item colour.
   *
   * Design spec §3.2 says only the active item uses the module colour;
   * Main Home implementation-lock §13 fixes the active colour at `#3157C8`. Main Home
   * passes the locked value; modules pass their own primary.
   */
  readonly activeColor?: string;
  readonly testID?: string;
};

/**
 * The five-item module bottom navigation.
 *
 * Locked by design spec §3.2 and Main Home implementation-lock §13 /
 * 07-bottom-navigation-reference.png:
 *   • fixed outside the ScrollView, 72 dp tall plus safe-area inset, above content
 *   • white surface with a 1 dp `#E2E6EC` top border
 *   • five equal slots; the third (`AI_NAV_INDEX`) is always module AI
 *   • 22 dp glyphs, 9.5/13 labels, active `#3157C8`, inactive `#667085` (raised from `#7A8496`
 *     by issue #171, which corrected the §3.2 literal to one that clears AA on this white bar)
 *   • centre AI is a 54 dp white circle with a 3 dp ring, raised 17 dp, holding a
 *     38 dp robot head
 *
 * Every module renders this same component and supplies a ModuleTheme, so the bar is
 * never duplicated per module.
 *
 * Two details are load-bearing for the "labels must never overlap" requirement:
 * each slot is `flex: 1` with `minWidth: 0` so a long label cannot push its slot
 * open and shunt its neighbours, and every label stretches to its own slot and
 * centres inside it so it ellipsises within its fifth rather than bleeding into the
 * next. The centre control's 17 dp raise is small enough that it clears the bar edge
 * without covering the adjacent labels.
 *
 * Why this is a component and not an Expo Router `Tabs`: each module owns its own
 * navigator and the centre AI control has to break the bar's bounds. Driving the bar
 * from `theme.navigation` keeps that presentational and keeps route files thin.
 */
export function ModuleBottomNavigation({
  theme,
  activeKey,
  onNavigate,
  activeColor = semanticColors.primary,
  testID,
}: ModuleBottomNavigationProps) {
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[styles.root, { paddingBottom: insets.bottom }]}
      accessibilityRole="tablist"
      testID={testID}
    >
      <View style={styles.row}>
        {theme.navigation.map((item, index) => {
          const isActive = item.key === activeKey;
          const tint = isActive ? activeColor : navigationColors.inactive;

          if (index === AI_NAV_INDEX) {
            return (
              <View key={item.key} style={[styles.slot, { minHeight: minimumTouchTargetSize() }]}>
                <RobotAIButton
                  onPress={() => onNavigate(item)}
                  ringColor={activeColor}
                  active={isActive}
                  accessibilityLabel={item.accessibilityLabel ?? `Open ${item.label}`}
                  style={styles.aiButton}
                  testID={`${testID ?? 'module-nav'}-ai`}
                />
                <AppText
                  variant="caption"
                  color={tint}
                  numberOfLines={1}
                  style={[styles.label, styles.aiLabel]}
                >
                  {item.label}
                </AppText>
              </View>
            );
          }

          return (
            <PressableScale
              key={item.key}
              onPress={() => onNavigate(item)}
              accessibilityRole="tab"
              accessibilityLabel={item.accessibilityLabel ?? item.label}
              accessibilityState={{ selected: isActive }}
              style={[styles.slot, { minHeight: minimumTouchTargetSize() }]}
              testID={`${testID ?? 'module-nav'}-${item.key}`}
            >
              <AppIcon name={item.icon} size={elementSize.bottomNavIcon} color={tint} />
              <AppText variant="caption" color={tint} numberOfLines={1} style={styles.label}>
                {item.label}
              </AppText>
            </PressableScale>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    backgroundColor: neutralColors.surface,
    borderTopWidth: 1,
    borderTopColor: neutralColors.border,
    // Lock §13: the bar sits above scroll content.
    zIndex: 2,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    height: elementSize.bottomNavHeight,
  },
  slot: {
    flex: 1,
    // Stops a label wider than its fifth from pushing the slot open and shunting its
    // neighbours together.
    minWidth: 0,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 2,
    gap: 3,
  },
  aiButton: {
    marginTop: -elementSize.aiNavButtonRaise,
  },
  label: {
    alignSelf: 'stretch',
    textAlign: 'center',
    fontFamily: fontFamilies.medium,
    fontSize: LABEL_SIZE,
    lineHeight: LABEL_LINE_HEIGHT,
  },
  aiLabel: {
    // The raised button consumes vertical space above the label; this pulls the label
    // back onto the same baseline as its four neighbours.
    marginTop: -1,
  },
});
