import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '@application/providers/auth-provider';
import { useModuleTheme } from '@application/providers/design-system-provider';
import { StateView } from '@ds/components';
import { moduleThemes } from '@ds/modules/module-themes';
import { neutralColors } from '@ds/tokens';
import { UpgradeSheetHost } from '@features/subscription/components/upgrade-sheet-host';
import { UpgradeSheetProvider } from '@features/subscription/services/upgrade-sheet-context';
import type { QuickAction, TimelineEntry } from '@shared/models/dashboard';
import type { ModuleTheme, NavItem } from '@shared/models/module-theme';

import { AIInsightCard } from '../components/ai-insight-card';
import { HomeBottomNavigation } from '../components/home-bottom-navigation';
import { HomeHeader } from '../components/home-header';
import { HomeHero } from '../components/home-hero';
import { HomeSummaryRow } from '../components/home-summary-row';
import { MainHomeSkeleton } from '../components/main-home-skeleton';
import { ModuleGrid } from '../components/module-grid';
import { QuickActionsRow } from '../components/quick-actions-row';
import { TodayTimeline } from '../components/today-timeline';
import { useMainHomeDashboard } from '../hooks/use-main-home-dashboard';
import {
  CONTENT_HEIGHT,
  LOCKED_HEIGHTS,
  REFERENCE_WIDTH,
  SCROLL_FALLBACK_USABLE_HEIGHT,
} from '../main-home-metrics';
import { MainHomeMetricsProvider, useMetrics } from '../main-home-metrics-context';

export type MainHomeScreenProps = {
  /**
   * Forces the dashboard into its error branch.
   *
   * Exists so the error state is reachable and testable without a network to fail. Not
   * wired to any user-facing control.
   */
  readonly simulateFailure?: boolean;
};

/**
 * Main Home.
 *
 * Visual authority: implementation-pack/main-home/00-main-home-exact-reference.png
 * Dimensional contract: PNG_PICTOGRAM_IMPLEMENTATION_LOCK.md plus the compact-layout
 * correction.
 *
 * ── Layer model ─────────────────────────────────────────────────────────────
 * The dashboard sits in a content container; the bottom navigation lives **outside** it,
 * absolutely positioned. On a tall device the container is a plain `View` and the screen
 * does not scroll at all; on a short one it becomes a `ScrollView` so nothing is clipped.
 *
 * Locked section order — no reordering, no omissions:
 *   1. Header               48 dp
 *   2. Hero                158 dp   (approved artwork + live text)
 *   3. Module grid          150 dp   (4 × 2, cleaned transparent PNGs)
 *   4. Today at a Glance   126 dp
 *   5. Summary cards        90 dp
 *   6. Noor AI insight      58 dp
 *   7. Quick actions        42 dp
 *   8. Bottom navigation    68 dp + safe area, fixed
 *
 * Content totals 716 dp; with the 68 dp bar and a 24 dp gesture inset that is 808 dp,
 * inside a Pixel 8's 864 dp below its 50 dp status inset. All three quick actions are
 * therefore fully visible with nothing hidden behind the navigation.
 *
 * Width behaviour: the column is capped at the 393 dp baseline and centred. Nothing is
 * enlarged to fill a wider screen, screen height is never an input to any dimension, and
 * no section uses `flexGrow` to absorb vertical slack.
 *
 * Aggregation rule (workflow §5): every tap leaves for the module that owns the record.
 * This screen holds no editing logic and no hero metrics.
 *
 * ── Phase 6B: one upgrade controller for the whole screen ───────────────────
 * Five surfaces on this screen either raise a contextual upgrade explanation or will do:
 * the timeline rows, the two summary cards, the Noor AI insight, the quick actions and the
 * bottom navigation. This is their nearest common ancestor, so it is the narrowest level at
 * which one controller can serve all of them and one sheet can be drawn — mounting it at
 * `AppProviders` would hold Main Home's state for routes that never ask, and mounting it any
 * lower would give each row and card a modal of its own.
 *
 * It is layout-neutral by construction. `UpgradeSheetProvider` renders context alone, and
 * `UpgradeSheetHost` renders nothing at all until something asks for it, and a `Modal` after
 * that — which does not take part in the flex layout of the column below. No padding, no
 * wrapper view, no visible element joins the locked composition, and the section order,
 * heights and gaps are exactly as they were.
 */
export function MainHomeScreen(props: MainHomeScreenProps) {
  return (
    <MainHomeMetricsProvider>
      <UpgradeSheetProvider>
        <MainHomeContent {...props} />
        {/* The single sheet outlet. `LockedModuleSheet` remains the only presentation, and the
            controller's refusal to raise anything for Faith or Noor AI is unchanged. */}
        <UpgradeSheetHost testID="main-home-upgrade-sheet" />
      </UpgradeSheetProvider>
    </MainHomeMetricsProvider>
  );
}

/**
 * The screen body.
 *
 * Split from `MainHomeScreen` so the metrics provider sits above every consumer —
 * including this component, which needs `dp` itself.
 */
function MainHomeContent({ simulateFailure = false }: MainHomeScreenProps) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const mainTheme = useModuleTheme('main');
  const noorAITheme = useModuleTheme('noor-ai');
  const { dp, pagePadding, screenWidth, screenHeight } = useMetrics();
  const { state, reload } = useMainHomeDashboard({ simulateFailure });

  const navigate = useCallback((item: NavItem) => router.push(item.href), [router]);
  const openModule = useCallback((theme: ModuleTheme) => router.push(theme.homeHref), [router]);

  const openSourceModule = useCallback(
    (entry: TimelineEntry) => router.push(moduleThemes[entry.sourceModule].homeHref),
    [router],
  );

  const openQuickAction = useCallback(
    (action: QuickAction) => router.push(moduleThemes[action.sourceModule].homeHref),
    [router],
  );

  const navHeight = dp(LOCKED_HEIGHTS.bottomNavigation) + insets.bottom;

  // Space between the status inset and the top of the navigation bar.
  const usableHeight = screenHeight - insets.top - navHeight;
  /**
   * The column's real laid-out height, once it has been laid out — issue #141.
   *
   * `dp(CONTENT_HEIGHT)` is the sum of the locked section heights, and while Main Home suppressed
   * font scaling it was exact: nothing on the screen could be taller than its locked box. Now that the
   * screen honours the OS text size, a scaled string makes its section taller than the locked figure,
   * and a decision made from the constant alone would keep the plain `View` and clip the overflow.
   *
   * It is measured rather than predicted. A `fontScale` term would only be a proxy for this — it cannot
   * know how many lines a particular string took at a particular width, which is the thing that
   * actually decides whether the column outgrew the viewport. `main-home-metrics.ts` is design-locked
   * in any case, so the constant it publishes could not be taught about text size even if that were the
   * right answer.
   *
   * Zero until the first layout, so the constant still decides the first frame and the screen does not
   * flash from one branch to the other.
   */
  const [measuredContentHeight, setMeasuredContentHeight] = useState(0);

  /**
   * A plain View when everything fits; a ScrollView only when it would otherwise clip.
   *
   * The measurement is taken from the column, which is content-sized in **both** branches — nothing
   * above it sets a height or clips — so the number does not change when the branch does. That is what
   * keeps the decision from oscillating: measuring 800 dp in the static branch switches to scrolling,
   * and the scrolling branch measures 800 dp too.
   */
  const contentHeight = measuredContentHeight > 0 ? measuredContentHeight : dp(CONTENT_HEIGHT);
  const needsScroll = usableHeight < SCROLL_FALLBACK_USABLE_HEIGHT || usableHeight < contentHeight;

  const gap = (value: number) => <View style={{ height: dp(value) }} />;

  function renderBody() {
    if (state.status === 'loading') {
      return <MainHomeSkeleton testID="main-home-skeleton" />;
    }

    if (state.status === 'error') {
      return (
        <StateView
          kind={state.kind}
          theme={mainTheme}
          message="We couldn't load your day just now. Your data is safe."
          onPrimaryAction={reload}
          {...(state.reference === undefined ? {} : { reference: `Reference ${state.reference}` })}
          variant="full"
          testID="main-home-error-state"
        />
      );
    }

    const { hero, timeline, familyCheckIn, overallProgress, aiInsight, quickActions } = state.data;

    return (
      <>
        <HomeHero
          eyebrow={hero.eyebrow}
          actionLabel={hero.actionLabel}
          onPressAction={() => router.push('/planner')}
          testID="main-home-hero"
        />
        {gap(LOCKED_HEIGHTS.gapAfterHero)}

        <ModuleGrid onSelectModule={openModule} testID="main-home-module-grid" />
        {gap(LOCKED_HEIGHTS.gapAfterGrid)}

        <TodayTimeline
          entries={timeline}
          theme={mainTheme}
          onViewAll={() => router.push('/planner')}
          onSelectEntry={openSourceModule}
          testID="main-home-timeline"
        />
        {gap(LOCKED_HEIGHTS.gapAfterToday)}

        <HomeSummaryRow
          familyCheckIn={familyCheckIn}
          overallProgress={overallProgress}
          onViewFamily={() => router.push('/family')}
          onViewProgress={() => router.push('/goals')}
          testID="main-home-summary-row"
        />
        {gap(LOCKED_HEIGHTS.gapAfterSummary)}

        <AIInsightCard
          insight={aiInsight}
          theme={noorAITheme}
          onPress={() => router.push('/ai')}
          testID="main-home-ai-insight"
        />
        {gap(LOCKED_HEIGHTS.gapAfterInsight)}

        <QuickActionsRow
          actions={quickActions}
          onSelectAction={openQuickAction}
          testID="main-home-quick-actions"
        />
      </>
    );
  }

  const column = (
    <View
      style={[styles.column, { width: Math.min(screenWidth, REFERENCE_WIDTH) }]}
      onLayout={(event) => setMeasuredContentHeight(event.nativeEvent.layout.height)}
      testID="main-home-column"
    >
      <HomeHeader
        greeting={user?.greeting ?? 'Assalamu Alaikum,'}
        name={user?.givenName ?? 'there'}
        {...(user?.avatarUri === undefined ? {} : { avatarUri: user.avatarUri })}
        notificationCount={3}
        onPressAvatar={() => router.push('/profile')}
        onPressNotifications={() => router.push('/notifications')}
        testID="main-home-header"
      />
      {gap(LOCKED_HEIGHTS.gapAfterHeader)}
      <View style={{ paddingHorizontal: pagePadding }}>{renderBody()}</View>
    </View>
  );

  return (
    <View style={[styles.root, { paddingTop: insets.top }]} testID="main-home-screen">
      {needsScroll ? (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={[styles.centred, { paddingBottom: navHeight + dp(16) }]}
          showsVerticalScrollIndicator={false}
          testID="main-home-scroll"
        >
          {column}
        </ScrollView>
      ) : (
        <View style={[styles.centred, { paddingBottom: navHeight }]} testID="main-home-static">
          {column}
        </View>
      )}

      <HomeBottomNavigation
        theme={mainTheme}
        activeKey="home"
        onNavigate={navigate}
        testID="main-home-nav"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: neutralColors.canvas,
  },
  scroll: {
    flex: 1,
  },
  centred: {
    alignItems: 'center',
  },
  column: {
    alignSelf: 'center',
    maxWidth: REFERENCE_WIDTH,
  },
});
