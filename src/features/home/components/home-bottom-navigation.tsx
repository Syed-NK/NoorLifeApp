import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppIcon, PressableScale } from '@ds/components';
import { moduleThemes } from '@ds/modules/module-themes';
import { navigationColors, neutralColors, semanticColors } from '@ds/tokens';
import { useUpgradeSheetActions } from '@features/subscription/services/upgrade-sheet-context';
import { useModuleLock } from '@features/subscription/use-module-lock';
import { iconButtonA11y } from '@shared/utils/a11y';
import { AI_NAV_INDEX, type ModuleTheme, type NavItem } from '@shared/models/module-theme';

import { PREMIUM_NAV_MODULES, UPGRADE_SOURCES } from '../home-premium-surfaces';
import { LOCKED } from '../main-home-metrics';
import { useMetrics } from '../main-home-metrics-context';
import { LOCK_GLYPH } from '../module-lock-theme';
import { HomeLockBadge } from './home-lock-badge';
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
 *
 * ── Phase 6B: Insights is the one paid destination in the bar ───────────────
 * Home, Modules and Profile are on every plan, and so is the centre Noor AI control — Noor AI is
 * scope-limited on the free plan, not locked, so it keeps its approved PNG, its 58 dp ring, its
 * 15 dp raise and no badge of any kind. Modules stays open deliberately: a user has to be able to
 * see what NoorLife includes, both what they hold and what they do not.
 *
 * Insights is Goals-powered, so a free user's tap raises the shared upgrade explanation and stays on
 * Main Home rather than entering a screen it cannot fill. Which destinations are paid is not decided
 * here — `PREMIUM_NAV_MODULES` names the module and `useModuleLock` answers for it, so this file
 * holds no knowledge of any plan.
 *
 * The bar's geometry is untouched in both states: the same 68 dp height, the same five `flex: 1`
 * slots, the same 24 dp icons and 9.5/12 labels. The padlock is absolutely positioned against the
 * icon, so it takes no part in the layout and cannot change the bar's height.
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
      /*
        The raise is reserved on the root — issue 115. The root began at the bar's top edge, so
        the centre control, which rises above that edge, was clipped to it and measured 40.000 dp
        at 360 dp and 36.148 dp at 320 dp. The root paints nothing, so reserving the space moves
        nothing on screen.
      */
      style={[styles.root, { paddingTop: dp(LOCKED.bottomNav.aiRaise) }]}
      accessibilityRole="tablist"
      testID={testID}
      pointerEvents="box-none"
    >
      <View
        style={[styles.bar, { height: barHeight + insets.bottom, paddingBottom: insets.bottom }]}
        pointerEvents="box-none"
        testID={`${testID ?? 'home-nav'}-bar`}
      >
        <View style={[styles.row, { height: barHeight }]}>
          {theme.navigation.map((item, index) => {
            const isActive = item.key === activeKey;

            if (index === AI_NAV_INDEX) {
              return (
                <View key={item.key} style={[styles.slot, styles.aiSlot]}>
                  {/* Top-aligned with a negative margin, so the control's top edge lands
                    exactly `aiRaise` above the bar. Centring it and then translating gave
                    only half the intended lift, because the centring offset (≈7 dp) ate
                    into the transform. There is no label competing for space in this slot,
                    so flex-start is free to use. */}
                  <View
                    style={{ marginTop: -dp(LOCKED.bottomNav.aiRaise) }}
                    pointerEvents="box-none"
                  >
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
              <NavSlot
                key={item.key}
                item={item}
                isActive={isActive}
                onNavigate={onNavigate}
                testID={`${testID ?? 'home-nav'}-${item.key}`}
              />
            );
          })}
        </View>
      </View>
    </View>
  );
}

type NavSlotProps = {
  readonly item: NavItem;
  readonly isActive: boolean;
  readonly onNavigate: (item: NavItem) => void;
  readonly testID: string;
};

/**
 * One side slot, in its available or locked state.
 *
 * Extracted so a slot can consult the entitlement selector with its own module — hooks cannot run
 * inside the `map` above.
 *
 * ── The locked tab never enters the destination ─────────────────────────────
 * It raises the shared upgrade explanation and stays where it is. Pushing Insights and letting the
 * route gate bounce the user back would flash a screen they are not entitled to and leave it in the
 * back stack, which is both worse to use and a weaker guarantee than never going there.
 *
 * ── Nothing in the slot is dimmed ───────────────────────────────────────────
 * The icon was briefly rendered at half opacity, on the reasoning that an icon carries no text so it
 * mutes freely. Measured, that put it at 1.79:1 against the bar — below the 3:1 a meaningful
 * indicator needs, and the inactive tint only has 3.77:1 to start with. The label was never dimmed,
 * because 9.5 dp is the smallest type on the screen and there was nothing to spare there either.
 *
 * So the locked tab renders in exactly the tint an unlocked one does, and the padlock is the whole
 * signal. It is a shape, not a colour, which is the rule.
 */
function NavSlot({ item, isActive, onNavigate, testID }: NavSlotProps) {
  const { dp } = useMetrics();
  const premiumModule = PREMIUM_NAV_MODULES[item.key];
  const moduleName = premiumModule === undefined ? item.label : moduleThemes[premiumModule].name;
  // `main` is never locked, so an unmapped slot answers "unlocked" without a plan being consulted.
  const { isLocked } = useModuleLock(premiumModule ?? 'main', moduleName);
  const { requestUpgrade } = useUpgradeSheetActions();

  const tint = isActive ? semanticColors.primary : navigationColors.inactive;
  const label = item.accessibilityLabel ?? item.label;

  return (
    <View style={styles.slot}>
      <PressableScale
        onPress={() => {
          if (isLocked && premiumModule !== undefined) {
            requestUpgrade({
              // The tab the user tapped, which is what the sheet has to explain — "Goals" alone
              // would not answer "why can't I open Insights?".
              featureTitle: item.label,
              moduleId: premiumModule,
              moduleName,
              source: UPGRADE_SOURCES.bottomNavigation,
            });
            return;
          }
          onNavigate(item);
        }}
        accessibilityRole="tab"
        // The restriction is part of the accessible name rather than a hint, so a screen reader
        // announces it in the same breath as the destination — a hint is easily skipped.
        accessibilityLabel={isLocked ? `${label}, Premium feature` : label}
        accessibilityState={{ selected: isActive }}
        {...(isLocked ? { accessibilityHint: 'Explains what NoorLife Premium includes' } : {})}
        style={styles.slotContent}
        testID={testID}
      >
        {/* Shrink-wraps the 24 dp icon exactly, so the badge can be positioned against the icon
            rather than against the slot — whose width is a flexed fifth and therefore not a fixed
            offset to measure from. It adds no size of its own, so the bar's height is unchanged. */}
        <View style={styles.iconWrap}>
          <AppIcon name={item.icon} size={dp(LOCKED.bottomNav.icon)} color={tint} />
          {/* Additional to the approved icon, never a replacement for it. */}
          {isLocked ? (
            <View
              style={[styles.lock, { top: -dp(2), right: -dp(6) }]}
              pointerEvents="none"
              testID={`${testID}-lock`}
            >
              <HomeLockBadge size={dp(LOCK_GLYPH)} testID={`${testID}-lock-badge`} />
            </View>
          ) : null}
        </View>
        <HomeText token="navLabel" color={tint} numberOfLines={1} style={styles.label}>
          {item.label}
        </HomeText>
      </PressableScale>
    </View>
  );
}

const styles = StyleSheet.create({
  /*
    The root positions and reserves the raise; the bar paints — issue 115.

    They were one view, so the centre control that rises above the bar was clipped to it and
    measured 40.000 dp at 360 dp. Reserving the raise on a view that draws nothing keeps every
    painted edge exactly where it was: the bar below still carries the height, the surface and the
    top border it always had. The module navigation has been built this way since #84.
  */
  root: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 10,
  },
  /** The bar the user sees. Every colour and edge that used to live on `root` is here. */
  bar: {
    backgroundColor: neutralColors.surface,
    borderTopWidth: 1,
    borderTopColor: neutralColors.border,
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
  /** Sized entirely by the icon inside it; exists only to anchor the padlock. */
  iconWrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  lock: {
    position: 'absolute',
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
