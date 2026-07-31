import { StatusBar } from 'expo-status-bar';
import type { ReactNode } from 'react';
import { Platform, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { NavItem } from '@shared/models/module-theme';

import { resolveBackDestination } from '@application/navigation/module-navigation';

import { ModuleProvider, useModule } from '../module-context';
import { moduleLayout, moduleNeutrals, type FrameworkModuleId } from '../module-tokens';
import { useModuleMetrics } from '../use-module-metrics';
import { ModuleBottomNavigation } from './module-bottom-navigation';
import { ModuleHeader } from './module-header';

export type ModuleScaffoldProps = {
  readonly moduleId: FrameworkModuleId;
  /** `key` of the active bottom-navigation item. */
  readonly activeKey: string;
  /** Sub-screen title. Omit on a module home to use the module name. */
  readonly title?: string;
  /**
   * True only for a module's own home screen.
   *
   * Decides where the visible back arrow goes: a home goes up to Main Home, everything
   * else goes up to its module home. Defaulting to `false` is deliberate — a new screen
   * added without thinking about it is a child, which is the safe answer. Getting it
   * wrong the other way would strand a user on Main Home from three levels deep.
   */
  readonly isModuleHome?: boolean;
  /** Overrides Back entirely, for a screen with a genuinely different meaning. */
  readonly onBack?: () => void;
  /** Overrides navigation, for the gallery and for tests. */
  readonly onNavigate?: (item: NavItem) => void;
  /**
   * Set false for a screen that manages its own scrolling — a chat transcript, or a
   * full-bleed state that should be centred in the viewport rather than at the top
   * of a scroll region.
   */
  readonly scrollable?: boolean;
  /** Rendered above the scroll region and below the header — e.g. a status banner. */
  readonly banner?: ReactNode;
  readonly children: ReactNode;
  readonly testID?: string;
};

/**
 * The frame every module screen is built in.
 *
 * It owns the four things that must be identical across all seven modules, so no
 * screen can get them subtly wrong:
 *
 *   • the `ModuleProvider`, which is what lets every child read its own colour
 *   • the header, with Back, profile, title and module Help
 *   • a content column capped at 393 dp and centred, so a wide handset gets margins
 *     rather than stretched cards
 *   • the navigation bar, fixed *outside* the ScrollView, with the scroll region
 *     inset by exactly the bar's height so the last card is never covered
 *
 * That last point is the one worth stating: the bar is absolutely positioned, so
 * without the matching `contentContainerStyle` padding it would sit on top of
 * content that the user can scroll to but never reach. The inset is computed from
 * the same tokens the bar measures itself with, plus the safe-area bottom.
 */
export function ModuleScaffold({
  moduleId,
  activeKey,
  title,
  isModuleHome = false,
  onBack,
  onNavigate,
  scrollable = true,
  banner,
  children,
  testID,
}: ModuleScaffoldProps) {
  return (
    <ModuleProvider moduleId={moduleId}>
      <ModuleScaffoldBody
        activeKey={activeKey}
        title={title}
        isModuleHome={isModuleHome}
        onBack={onBack}
        onNavigate={onNavigate}
        scrollable={scrollable}
        banner={banner}
        testID={testID}
      >
        {children}
      </ModuleScaffoldBody>
    </ModuleProvider>
  );
}

/**
 * The scaffold's body, split out so it renders *inside* the provider.
 *
 * `useModuleMetrics` does not need the module, but the children do, and a single
 * component cannot both provide a context and consume it.
 */
function ModuleScaffoldBody({
  activeKey,
  title,
  isModuleHome = false,
  onBack,
  onNavigate,
  scrollable,
  banner,
  children,
  testID,
}: Omit<ModuleScaffoldProps, 'moduleId'>) {
  const insets = useSafeAreaInsets();
  const module = useModule();
  // `contentWidth` is the capped column minus both page paddings, so centring a view of
  // that width reproduces the page margins without applying padding a second time.
  const { dp, contentWidth } = useModuleMetrics();

  const bottomInset =
    dp(moduleLayout.navHeight) + insets.bottom + dp(moduleLayout.scrollBottomInset);
  const column = { width: contentWidth, alignSelf: 'center' as const };

  const content = (
    <View style={[column, { paddingBottom: scrollable === false ? bottomInset : 0 }]}>
      {children}
    </View>
  );

  return (
    <View style={[styles.root, { paddingTop: insets.top }]} testID={testID}>
      {/* Module pages are light surfaces throughout, so the status bar is always dark-on-light. */}
      <StatusBar style="dark" />

      <ModuleHeader
        title={title}
        backHref={resolveBackDestination(module.id, isModuleHome)}
        backLabel={isModuleHome ? 'Main Home' : module.name}
        onBack={onBack}
        testID={`${testID ?? 'module'}-header`}
      />

      {banner === undefined ? null : (
        <View style={[column, { paddingBottom: dp(10) }]}>{banner}</View>
      )}

      {scrollable === false ? (
        <View style={styles.staticBody}>{content}</View>
      ) : (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={{ paddingBottom: bottomInset }}
          showsVerticalScrollIndicator={false}
          // Lets a tap dismiss the keyboard on screens that hold an input.
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
          testID={`${testID ?? 'module'}-scroll`}
        >
          {content}
        </ScrollView>
      )}

      <ModuleBottomNavigation
        activeKey={activeKey}
        onNavigate={onNavigate}
        testID={`${testID ?? 'module'}-nav`}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: moduleNeutrals.pageBackground,
  },
  scroll: {
    flex: 1,
  },
  staticBody: {
    flex: 1,
    justifyContent: 'center',
  },
});
