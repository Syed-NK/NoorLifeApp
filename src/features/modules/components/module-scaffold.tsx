import { StatusBar } from 'expo-status-bar';
import type { ReactNode, RefObject } from 'react';
import { Platform, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { NavItem } from '@shared/models/module-theme';

import { resolveBackDestination } from '@application/navigation/module-navigation';

import { ModuleProvider, useModule } from '../module-context';
import { moduleSurfaces } from '../module-surfaces';
import {
  moduleDockClearance,
  moduleLayout,
  moduleNavigationHeight,
  moduleNeutrals,
  type FrameworkModuleId,
} from '../module-tokens';
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
  /**
   * With `scrollable={false}`, gives the content column the whole viewport instead of centring it.
   *
   * ── Why this exists rather than a screen working around it ──────────────────
   * `scrollable={false}` was built for a *centred* full-bleed state — an empty state, a permission
   * prompt — so the static body centres its child and the child sizes to its content. A virtualized
   * list cannot live in that: `FlatList` needs a bounded height to know what to render, and a parent
   * that sizes to its children gives it none, so it measures zero and draws nothing.
   *
   * The alternatives were worse. A hard-coded height would be wrong on every device the moment the
   * header or the nav bar changed; wrapping the list in a `ScrollView` would defeat the point of
   * virtualizing it. This makes the column claim the space instead, and leaves the centred behaviour
   * exactly as it was for everything that does not ask.
   *
   * The bottom inset is unchanged either way, so the last row still clears the navigation bar.
   */
  readonly fills?: boolean;
  /** Rendered above the scroll region and below the header — e.g. a status banner. */
  readonly banner?: ReactNode;
  /**
   * A panel pinned between the scroll region and the bottom navigation.
   *
   * ── Why this belongs to the scaffold rather than to the screen ──────────────
   * Because only the scaffold knows where the bottom navigation is and how tall the safe-area inset
   * underneath it happens to be. The Qur'an reader's audio transport was rendered *inside* the
   * scrolling content, after the verse list, which had two consequences: it scrolled out of view
   * while audio was still playing, and it had no relationship to the navigation bar at all.
   *
   * ── The bar occupies no layout space, and that is the whole problem ─────────
   * `ModuleBottomNavigation` is `position: absolute` with `bottom: 0`, mirroring locked Main Home.
   * It therefore takes **no** room in this flex column: it draws *over* whatever the column placed
   * at the bottom of the screen. This slot's first implementation put the panel last in the column
   * and called it "a sibling of both, so it can cover neither", which was wrong in exactly one
   * direction — the panel landed underneath the bar, and on a device only its top edge showed.
   *
   * The fix is structural rather than a stacking trick: the panel's container carries a bottom
   * margin of `moduleDockClearance`, so the space the absolute bar draws into is genuinely reserved
   * in the column and the panel's own box ends above it. `zIndex` would have raised the panel over
   * the bar instead, which is a different and worse screen — a player floating on top of the tabs.
   */
  readonly docked?: ReactNode;
  /**
   * A handle on the scroll region, for a screen that must move it programmatically.
   *
   * Exposed rather than re-implemented: the Qur'an reader has to bring the verse currently being
   * recited into view, and the scroll region it needs to move is the scaffold's. The alternative was
   * for the reader to own its own `ScrollView`, which would mean re-deriving the safe-area inset,
   * the bottom-navigation clearance and the docked-panel padding that this component already gets
   * right for every other screen.
   *
   * Only `scrollable` screens have one. It stays `null` otherwise, which callers must handle.
   */
  readonly scrollRef?: RefObject<ScrollView | null>;
  readonly children: ReactNode;
  /**
   * Overrides the breathing room reserved under the last card, in baseline dp.
   *
   * ── What it may and may not change ──────────────────────────────────────────
   * Only `moduleLayout.scrollBottomInset` — the *comfort* term. The navigation bar's own height and
   * the gesture inset underneath it are never affected, so a screen cannot use this to push content
   * beneath the bar; the worst it can do is remove the air below content that already clears it.
   *
   * ── Why any screen would want to ────────────────────────────────────────────
   * A dashboard that fits its viewport has nothing to scroll, and the breathing room then does the
   * one thing it was never meant to: it makes the content *taller than the box* by fourteen dp, so a
   * screen with everything visible still scrolls by fourteen. Prayer Times passes 0 once it has
   * measured itself as compact, which is what takes its scroll range to zero. In overflow mode it
   * passes nothing and the shared value applies, because there the padding is doing its real job —
   * letting the last card scroll clear of the bar.
   */
  readonly scrollBottomInset?: number;
  /**
   * Replaces the shared page background for this screen.
   *
   * ── Deliberately narrow ─────────────────────────────────────────────────────
   * Exactly one screen uses it: the Qur'an reader, whose ground is specified as `#FDFAF5` rather
   * than the cool `moduleNeutrals.pageBackground` every other module screen sits on. It is a prop
   * rather than a reader-only scaffold because the reader needs everything else this component
   * does — header, navigation, docked panel, safe area, scroll insets — and forking it to change
   * one colour is how two scaffolds start drifting apart.
   *
   * A screen passing an arbitrary colour here is introducing a second background to the design
   * system, which the module rules forbid. The only approved value is `readerPageBackground`.
   */
  readonly background?: string;
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
 *   • the navigation bar, fixed *outside* the ScrollView, with the bottom of the
 *     screen kept clear of it so the last card is never covered
 *
 * That last point is the one worth stating: the bar is absolutely positioned, so it
 * occupies no space in this column and draws over whatever is beneath it. Two
 * different mechanisms keep content out of its way, and which one applies depends on
 * whether there is a docked panel — see `bottomInset` below. Both compute the bar's
 * height from `moduleNavigationHeight`, which is the only place the safe-area bottom
 * is added.
 */
export function ModuleScaffold({
  moduleId,
  activeKey,
  title,
  isModuleHome = false,
  onBack,
  onNavigate,
  scrollable = true,
  fills = false,
  banner,
  docked,
  scrollRef,
  scrollBottomInset,
  background,
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
        fills={fills}
        docked={docked}
        scrollRef={scrollRef}
        scrollBottomInset={scrollBottomInset}
        banner={banner}
        background={background}
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
  fills = false,
  banner,
  docked,
  scrollRef,
  scrollBottomInset,
  background,
  children,
  testID,
}: Omit<ModuleScaffoldProps, 'moduleId'>) {
  const insets = useSafeAreaInsets();
  const module = useModule();
  const surfaces = moduleSurfaces(module.id);
  // `contentWidth` is the capped column minus both page paddings, so centring a view of
  // that width reproduces the page margins without applying padding a second time.
  const { dp, contentWidth } = useModuleMetrics();

  const hasDock = docked !== undefined;

  /**
   * How far the scroll region's *content* has to stay clear of the bottom of the screen.
   *
   * ── Two different answers, because there are two different layouts ──────────
   * With **no** docked panel the scroll region's box runs to the bottom of the root, and the
   * absolute navigation bar draws over its last few centimetres — so the content has to be padded
   * by the whole bar plus breathing room, or the last card is unreachable.
   *
   * With a docked panel the box already **ends above** the panel, which in turn ends above the bar:
   * the panel is a flex sibling and its clearance margin reserves the bar's space. Neither is
   * overlapping the scroll region any more, so padding for either would be padding for a collision
   * that cannot happen — an inch of dead space under the last verse of every surah. What is left is
   * the breathing room, which is the only term that was ever about the content itself.
   *
   * This is also where "the safe-area inset is applied exactly once" is decided: `insets.bottom`
   * reaches this screen through `moduleNavigationHeight` and through nothing else.
   */
  /*
    The comfort term, which a screen may override — see the prop's note. Only this term: the
    navigation height below is unconditional, so no override can put a card under the bar.
  */
  const comfort = dp(scrollBottomInset ?? moduleLayout.scrollBottomInset);
  const bottomInset = hasDock ? comfort : moduleNavigationHeight(dp, insets.bottom) + comfort;
  const column = { width: contentWidth, alignSelf: 'center' as const };

  const content = (
    <View
      style={[
        column,
        { paddingBottom: scrollable === false ? bottomInset : 0 },
        // `fills` is what lets a virtualized list measure itself. See the prop's note.
        fills ? styles.fill : null,
      ]}
    >
      {children}
    </View>
  );

  return (
    <View
      style={[
        styles.root,
        /*
          The module's own ground — issue #91. `moduleSurfaces` returns today's neutral for the
          seven modules that have not opted in, so only Finance changes colour here.
        */
        { backgroundColor: surfaces.page, paddingTop: insets.top },
        background === undefined ? null : { backgroundColor: background },
      ]}
      testID={testID}
    >
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
        <View style={fills ? styles.fillingBody : styles.staticBody}>{content}</View>
      ) : (
        <ScrollView
          ref={scrollRef}
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

      {/*
        Docked: last in the flex column, with the navigation's space reserved beneath it.

        The scroll region above is `flex: 1`, so it gives up exactly the height this container takes
        and no more — which is what makes the panel *fixed* while the content scrolls, and what lets
        the last verse of a surah scroll fully clear of it without any padding being guessed.

        `marginBottom` is the whole fix. The navigation bar is absolute and would otherwise draw
        straight over this panel; the margin reserves its height plus the raised centre control's
        overhang, so the panel's bottom edge ends where the robot button begins and the bar's top
        edge is below both. Every term comes from `moduleDockClearance`.
      */}
      {docked === undefined ? null : (
        <View
          style={[column, styles.docked, { marginBottom: moduleDockClearance(dp, insets.bottom) }]}
          testID={`${testID ?? 'module'}-docked`}
        >
          {docked}
        </View>
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
  docked: {
    // No flex: the panel is exactly as tall as its content, and the scroll region above keeps the
    // remaining space. A flexed docked bar would steal height from the content on a short viewport.
    //
    // No padding either. The gap below the panel is `moduleDockClearance`'s and is occupied by the
    // raised centre control; padding here would add a second, empty one on top of it.
  },
  staticBody: {
    flex: 1,
    justifyContent: 'center',
  },
  /** The same body without the centring, so the column below can claim the height. */
  fillingBody: {
    flex: 1,
  },
  fill: {
    flex: 1,
  },
});
