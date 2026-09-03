import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppIcon, PressableScale } from '@ds/components';
import { AI_NAV_INDEX, type NavItem } from '@shared/models/module-theme';

import { useModule } from '../module-context';
import { moduleSurfaces } from '../module-surfaces';
import { moduleLayout, moduleNavigationHeight, moduleNeutrals } from '../module-tokens';
import { useModuleMetrics } from '../use-module-metrics';
import { ModuleAICenterButton } from './module-ai-center-button';
import { ModuleText } from './module-text';
import { minimumTouchTargetSize } from '@shared/utils/a11y';

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
  /*
    The centre control's diameter, floored at the touch minimum — issue #84.

    `dp()` scales the 58 dp button down with the module scale, and on a narrow device that alone
    could take it under 44 dp. The floor is applied outside `dp()` for the same reason the tabs'
    is: the minimum is an accessibility bound, not a dimension to be scaled. On every device
    measured the scaled value already wins, so this changes nothing today and cannot be undercut
    tomorrow.
  */
  const aiSize = Math.max(dp(moduleLayout.navAIButton), moduleLayout.minTouchTarget);
  const prefix = testID ?? `${module.id}-nav`;
  const surfaces = moduleSurfaces(module.id);

  const navigate = (item: NavItem) => {
    if (onNavigate !== undefined) {
      onNavigate(item);
      return;
    }
    // `navigate`, not `push`: the five slots are peers, and pushing would stack a new
    // screen on every tab tap so Android back walked the whole tab history in reverse.
    router.navigate(item.href);
  };

  return (
    <View
      style={[
        styles.root,
        {
          /*
            Taller than the bar it draws, by exactly the centre control's raise — issue #84.

            The AI button carries `marginTop: -navAIRaise`, so it stands 15 dp above the bar's top
            edge. Android delivers no touch to a child rendered outside its parent's bounds, so that
            raised portion was visually present and functionally dead: the button measured 58 dp but
            only ~42 dp of it could be pressed.

            This view is therefore the *carrier* — transparent, `box-none`, and tall enough to
            contain the raised control — while `bar` below draws the background, the border and the
            safe-area padding at the height it always had. Nothing moves on screen: the carrier is
            bottom-anchored, so adding height upward leaves the bar exactly where it was.

            `moduleNavigationHeight` is deliberately *not* changed. It answers "how much vertical
            space must a docked panel clear", which is still the visible bar; the reader dock and the
            prayer dashboard both depend on that meaning.
          */
          height: moduleNavigationHeight(dp, insets.bottom) + dp(moduleLayout.navAIRaise),
          paddingTop: dp(moduleLayout.navAIRaise),
        },
      ]}
      accessibilityRole="tablist"
      pointerEvents="box-none"
      testID={testID}
    >
      <View
        style={[
          styles.bar,
          {
            /*
              Stated, not inferred from `flex`. This is the height `moduleNavigationHeight` has
              always meant — the bar a docked panel must clear — and stating it here keeps that
              answer readable from the rendered style rather than implied by the carrier's padding.
            */
            height: moduleNavigationHeight(dp, insets.bottom),
            paddingBottom: insets.bottom,
          },
        ]}
        testID={`${prefix}-bar`}
      >
        <View style={[styles.row, { height: barHeight }]}>
          {module.navigation.map((item, index) => {
            const isActive = item.key === activeKey;

            if (index === AI_NAV_INDEX) {
              return (
                <View key={item.key} style={[styles.slot, styles.aiSlot]}>
                  <View
                    style={{ marginTop: -dp(moduleLayout.navAIRaise) }}
                    pointerEvents="box-none"
                  >
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
              <View
                key={item.key}
                style={[
                  styles.slot,
                  /*
                  The selected slot takes the module's own ground on an opted-in module — issue #91.
                  For the seven that have not opted in this resolves to `navBackground`, the bar's
                  own white, so nothing moves: the marker and the ink still carry the state there.
                */
                  isActive ? { backgroundColor: surfaces.navSelected } : null,
                ]}
                /*
                  Identified so the ground under a label is measurable — issue #88. Contrast is a
                  property of a pair, and the selected slot is the only thing that paints its own
                  ground; a guard that cannot find this View has to read the token instead and so
                  cannot tell whether the component still uses it.
                */
                testID={`${prefix}-${item.key}-slot`}
              >
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
                    <View
                      style={[styles.activeBar, { backgroundColor: module.theme.ink }]}
                      /* The non-colour half of the selected state, identified for the same reason. */
                      testID={`${prefix}-${item.key}-marker`}
                    />
                  </View>
                ) : null}
                <PressableScale
                  onPress={() => navigate(item)}
                  accessibilityRole="tab"
                  accessibilityLabel={item.accessibilityLabel ?? item.label}
                  accessibilityState={{ selected: isActive }}
                  style={[styles.slotContent, { minHeight: minimumTouchTargetSize() }]}
                  testID={`${prefix}-${item.key}`}
                >
                  <AppIcon
                    name={item.icon}
                    size={dp(moduleLayout.navIcon)}
                    color={tint}
                    /* So the icon's own tint is measurable, not inferred from the label — #88. */
                    testID={`${prefix}-${item.key}-icon`}
                  />
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
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 10,
  },
  /** The bar the user sees. Every colour and edge that used to live on `root` is here. */
  bar: {
    backgroundColor: moduleNeutrals.navBackground,
    borderTopWidth: 1,
    borderTopColor: moduleNeutrals.border,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  /**
   * A fifth of the bar, with nothing held back from it — issue #133.
   *
   * This used to keep `paddingHorizontal: 2`, which cost the label 4 dp of the fifth it was given.
   * That was the whole of the truncation defect: measured with the production advance tables, one
   * label in the whole app — Finance's "Transactions" — needed more than the remainder, by 0.47 dp
   * at 320 dp, 0.21 dp at 384 dp, and exactly nothing at 393 dp. 411 dp was the first width where
   * it cleared, which is why the phone ellipsised it and the emulator never did.
   *
   * Returning those 4 dp turns the worst case from 0.47 dp over to 3.53 dp of headroom, and the
   * closest two labels in any module at any tested width still keep 12.32 dp between them — 0.23 dp
   * less than before, because the widest label is centred against a neighbour with slack. The
   * padding was never what separated them.
   *
   * It also finishes what #84 started. That issue made the pressable `flex: 1` so "the pressable is
   * the slot"; this padding was the last thing keeping it 4 dp narrower than the slot it fills. The
   * target only grows, and the selected background is unaffected — padding sits inside it.
   */
  slot: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  aiSlot: {
    justifyContent: 'flex-start',
  },
  /**
   * Fills its slot rather than shrink-wrapping its contents — issue #84.
   *
   * `alignSelf: 'stretch'` only ever stretched the width. The height came from the icon plus the
   * label, which at font scale 1.0 is 38–40 dp inside a 68 dp bar: a tap in the top third of a tab
   * hit nothing. `flex: 1` makes the pressable the slot, so the whole intended target responds.
   *
   * The `minHeight` floor is deliberately **not** passed through `dp()`. 44 dp is an accessibility
   * minimum, not a design dimension, so it must not shrink with the module scale on a narrow device
   * — which is exactly where a shrunken target would hurt most.
   *
   * Nothing moves visually: the icon and label were centred in the slot before and are centred in
   * the pressable now, and the pressable is the slot.
   */
  slotContent: {
    flex: 1,
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
