import { StatusBar } from 'expo-status-bar';
import {
  ScrollView,
  StyleSheet,
  View,
  type RefreshControlProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { elementSize, layout, neutralColors } from '@ds/tokens';

export type AppScreenProps = {
  /** Fixed chrome rendered above the scroll area, e.g. a top bar. */
  readonly header?: React.ReactNode;
  /** Fixed chrome pinned to the bottom, e.g. ModuleBottomNavigation. */
  readonly bottomNavigation?: React.ReactNode;
  readonly children?: React.ReactNode;
  /** `false` renders children in a plain flex view instead of a ScrollView. */
  readonly scrollable?: boolean;
  /** Screen background. Defaults to the neutral canvas — override sparingly. */
  readonly backgroundColor?: string;
  /** Applies the standard 20 px horizontal screen padding. Default `true`. */
  readonly padded?: boolean;
  /**
   * Vertical gap between top-level children.
   *
   * Defaults to the 24 px §2.5 section gap. §3.0 sanctions 12–24 px, and dense
   * dashboards such as Main Home use the lower end so every section fits the
   * viewport without the gaps themselves becoming the tallest thing on screen.
   */
  readonly sectionGap?: number;
  readonly refreshControl?: React.ReactElement<RefreshControlProps>;
  readonly contentContainerStyle?: StyleProp<ViewStyle>;
  readonly testID?: string;
};

/**
 * The screen scaffold every NoorLife screen is built on.
 *
 * Responsibilities, so no screen re-implements them:
 *   • neutral canvas background (§1.1 — the canvas is never module-tinted)
 *   • safe-area insets, top and bottom
 *   • 20 px horizontal screen padding (§2.5)
 *   • scroll content that clears fixed bottom navigation, so the last card is
 *     always reachable on small devices
 *   • trailing content inset capped at the §3.0 24 px limit, so scrolling to the
 *     end never reveals an unexplained blank region
 */
export function AppScreen({
  header,
  bottomNavigation,
  children,
  scrollable = true,
  backgroundColor = neutralColors.canvas,
  padded = true,
  sectionGap = layout.sectionGap,
  refreshControl,
  contentContainerStyle,
  testID,
}: AppScreenProps) {
  const insets = useSafeAreaInsets();

  // Bottom navigation is fixed, so scroll content must clear its full height
  // (bar + safe-area inset). The extra breathing room is one card gap, not one
  // section gap: at maximum scroll this padding is visible, and a 24 px addition on
  // top of the bar height reads as an unexplained blank strip under the last card
  // (§3.0). 12 px stays inside that limit while still separating the two.
  const bottomClearance =
    bottomNavigation === undefined
      ? insets.bottom + layout.maxUnexplainedGap
      : elementSize.bottomNavHeight + insets.bottom + layout.cardGap;

  const contentStyle: StyleProp<ViewStyle> = [
    padded ? styles.padded : null,
    { gap: sectionGap, paddingBottom: bottomClearance },
    contentContainerStyle,
  ];

  return (
    <View style={[styles.root, { backgroundColor, paddingTop: insets.top }]} testID={testID}>
      <StatusBar style="dark" />
      {header}
      {scrollable ? (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={contentStyle}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          refreshControl={refreshControl}
        >
          {children}
        </ScrollView>
      ) : (
        <View style={[styles.scroll, contentStyle]}>{children}</View>
      )}
      {bottomNavigation}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  scroll: {
    flex: 1,
  },
  padded: {
    paddingHorizontal: layout.screenPaddingHorizontal,
  },
});
