import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppIcon, PressableScale } from '@ds/components';
import { AI_NAV_INDEX, type NavItem } from '@shared/models/module-theme';

import { useModule } from '../module-context';
import { moduleLayout, moduleNeutrals } from '../module-tokens';
import { useModuleMetrics } from '../use-module-metrics';
import { ModuleAICenterButton } from './module-ai-center-button';
import { ModuleText } from './module-text';

export type ModuleBottomNavigationProps = {
  /** `key` of the active navigation item. */
  readonly activeKey: string;
  /** Overrides navigation, for the gallery and for tests. Defaults to routing. */
  readonly onNavigate?: (item: NavItem) => void;
  readonly testID?: string;
};

/**
 * The five-slot navigation every module screen shares.
 *
 * Structure follows Main Home's locked bar, because a module must not feel like a
 * different app: absolutely positioned outside the ScrollView, `68 + insets.bottom`
 * tall, five equal slots, and a raised centre control with no caption. What differs
 * is only that the active tint and the centre ring are the module's colour.
 *
 * The items come from the module definition, which reuses the Phase 1 `ModuleTheme`
 * navigation — already validated to be exactly five entries with AI third. This
 * component therefore trusts the shape and indexes `AI_NAV_INDEX` directly.
 *
 * Three details are load-bearing and were learned the hard way on Main Home:
 * every slot is a plain `View` with `flex: 1` and `minWidth: 0` so a long label
 * cannot expand its slot and shunt its neighbours; labels are `alignSelf: 'stretch'`
 * and centred so they ellipsise inside their own fifth; and the row is
 * `alignItems: 'stretch'` so the centre control's negative margin has a full bar
 * height to offset against.
 */
export function ModuleBottomNavigation({
  activeKey,
  onNavigate,
  testID,
}: ModuleBottomNavigationProps) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const module = useModule();
  const { dp } = useModuleMetrics();

  const barHeight = dp(moduleLayout.navHeight);
  const aiSize = dp(moduleLayout.navAIButton);
  const prefix = testID ?? `${module.id}-nav`;

  const navigate = (item: NavItem) => {
    if (onNavigate !== undefined) {
      onNavigate(item);
      return;
    }
    router.push(item.href);
  };

  return (
    <View
      style={[styles.root, { height: barHeight + insets.bottom, paddingBottom: insets.bottom }]}
      accessibilityRole="tablist"
      testID={testID}
    >
      <View style={[styles.row, { height: barHeight }]}>
        {module.navigation.map((item, index) => {
          const isActive = item.key === activeKey;

          if (index === AI_NAV_INDEX) {
            return (
              <View key={item.key} style={[styles.slot, styles.aiSlot]}>
                <View style={{ marginTop: -dp(moduleLayout.navAIRaise) }} pointerEvents="box-none">
                  <ModuleAICenterButton
                    size={aiSize}
                    imageSize={dp(moduleLayout.navAIImage)}
                    onPress={() => navigate(item)}
                    accessibilityLabel={item.accessibilityLabel ?? `Open ${item.label}`}
                    selected={isActive}
                    testID={`${prefix}-ai`}
                  />
                </View>
                {/*
                  Whether a caption appears is per module, read from the definition.

                  The approved Faith reference labels the centre control "Faith AI"; the
                  approved Health reference labels nothing. Locked Main Home also shows
                  none, which is why the framework originally hard-coded its absence — but
                  "no caption anywhere" turned out to be an assumption, not a rule.
                */}
                {module.showAICaption ? (
                  <ModuleText
                    token="navLabel"
                    color={module.theme.ink}
                    numberOfLines={1}
                    maxFontSizeMultiplier={1.2}
                    style={styles.aiCaption}
                  >
                    {item.label}
                  </ModuleText>
                ) : null}
              </View>
            );
          }

          const tint = isActive ? module.theme.ink : moduleNeutrals.navInactive;

          return (
            <View key={item.key} style={styles.slot}>
              {/*
                Active state is carried by a marker as well as by colour, so it is never
                communicated by colour alone.

                The marker is a sibling of the pressable, pinned to the top of the 68 dp
                slot. Inside the pressable it would be positioned against a box that
                shrink-wraps the icon and label — which is exactly what put a 2 dp line
                straight through the word "Today" on the first build.
              */}
              {isActive ? (
                <View style={styles.activeBarRow} pointerEvents="none" accessible={false}>
                  <View style={[styles.activeBar, { backgroundColor: module.theme.ink }]} />
                </View>
              ) : null}
              <PressableScale
                onPress={() => navigate(item)}
                accessibilityRole="tab"
                accessibilityLabel={item.accessibilityLabel ?? item.label}
                accessibilityState={{ selected: isActive }}
                style={styles.slotContent}
                testID={`${prefix}-${item.key}`}
              >
                <AppIcon name={item.icon} size={dp(moduleLayout.navIcon)} color={tint} />
                <ModuleText
                  token="navLabel"
                  color={tint}
                  numberOfLines={1}
                  // The bar is a fixed 68 dp, so labels cannot grow without clipping.
                  maxFontSizeMultiplier={1.2}
                  style={styles.label}
                >
                  {item.label}
                </ModuleText>
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
    backgroundColor: moduleNeutrals.navBackground,
    borderTopWidth: 1,
    borderTopColor: moduleNeutrals.border,
    zIndex: 10,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  slot: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 2,
  },
  aiSlot: {
    justifyContent: 'flex-start',
  },
  slotContent: {
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    alignSelf: 'stretch',
    textAlign: 'center',
    marginTop: 2,
  },
  /**
   * The centre caption sits below the raised control, so it needs its own spacing rather
   * than the side items' 2 dp — the control's negative margin has already lifted it.
   */
  aiCaption: {
    alignSelf: 'stretch',
    textAlign: 'center',
    marginTop: 3,
  },
  /** Spans the slot so its child centres horizontally without a magic offset. */
  activeBarRow: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  activeBar: {
    width: 16,
    height: 2.5,
    borderBottomLeftRadius: 2,
    borderBottomRightRadius: 2,
  },
});
