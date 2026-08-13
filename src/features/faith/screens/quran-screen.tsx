import { useRouter } from 'expo-router';
import { useCallback, useMemo, type ReactElement } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';

import { ModuleText } from '@features/modules/components';
import { ModuleCard } from '@features/modules/components/module-card';
import { ModuleProgressBar } from '@features/modules/components/module-chart';
import { moduleLayout, moduleNeutrals } from '@features/modules/module-tokens';
import { useModuleMetrics } from '@features/modules/use-module-metrics';

import { FaithSectionHero } from '../components/faith-section-hero';
import { FaithResourceView, FaithScreen } from '../components/faith-screen';
import { FaithRow, FaithRowGroup } from '../components/faith-list';
import { UnverifiedSourceNotice } from '../components/faith-states';
import { hasData } from '../data/faith-result';
import type { SurahSummary } from '../data/quran-content.repository';
import { useFaithRepositories } from '../di/faith-repository-context';
import { faithHeroImages } from '../faith-hero-images';
import { faithNavKeys, faithRoutes, readerHref } from '../faith-routes';
import { formatPositionProgress, useContinueReading } from '../hooks/use-continue-reading';
import { useSurahCatalogue } from '../hooks/use-surah-catalogue';

/**
 * The Qur'an screen — the `quran` bottom-navigation slot.
 *
 * Lists every surah, and resumes where the user stopped if they have read anything.
 *
 * ── Why this screen is virtualized and its siblings are not ─────────────────
 * It was a `ScrollView` with 114 mapped rows, and that turned out to be the whole of the remaining
 * "the Qur'an screen is slow" complaint. Measured on a Samsung SM-G556B with `dumpsys gfxinfo
 * framestats`, tapping the Qur'an tab produced **no frame at all for 420 ms** after the tap ripple,
 * against 33 ms for Worship and 118 ms for More — three screens, one navigator, one difference:
 * how many rows mount in the first commit.
 *
 * The catalogue data was already in memory by then. Persisting it removed the network, and the
 * startup snapshot removed the storage await, so by this point there was no skeleton and nothing to
 * wait for — and the screen was still slow, because mounting 114 pressables with their icons, text
 * and layout is simply 420 ms of work on this device however fast the data arrives.
 *
 * `FlatList` mounts a screenful and adds the rest as they approach the viewport. The identity card,
 * the resume card and the action rows travel in `ListHeaderComponent`, which is what lets the whole
 * screen be one virtualized list rather than a list inside a scroll view — the nesting React Native
 * warns about, and which would defeat the virtualization anyway.
 *
 * The unverified-source notice reads `quran.source` rather than naming a source of its own, so it
 * stays true across the repository swap: silent under the approved adapter, and a plain warning when
 * the build is running on fixtures.
 */
export function QuranScreen() {
  return (
    /**
     * `scrollable={false}` with `fills`, so the list owns the viewport.
     *
     * The scaffold's own `ScrollView` is what a virtualized list must not be nested inside: React
     * Native warns about it, and more to the point the outer scroller would give the inner list an
     * unbounded height, so every row would mount anyway and the virtualization would be decorative.
     * This is the same arrangement the two catalogue selectors already use.
     */
    <FaithScreen
      title="Qur’an"
      activeKey={faithNavKeys.quran}
      scrollable={false}
      fills
      testID="faith-quran"
    >
      <QuranBody />
    </FaithScreen>
  );
}

function QuranBody() {
  const router = useRouter();
  const { quran } = useFaithRepositories();

  /**
   * Cached-first, seeded from the startup snapshot, never blanked while it re-checks.
   *
   * This used to be a plain `useFaithResource` over `quran.listSurahs()`, which meant a full network
   * round trip before the first row could be drawn on every cold start. See `use-surah-catalogue.ts`
   * and `quran-catalogue-warmup.ts` for the two layers that removed it.
   */
  const surahs = useSurahCatalogue();

  /**
   * The rows, or none — and the distinction never removes the rest of the screen.
   *
   * ── Why the resource view is inside the list rather than around it ──────────
   * Wrapping the whole screen in `FaithResourceView` was the obvious arrangement and it was wrong in
   * a way worth recording: a catalogue that failed to load took the module identity, the source
   * notice, "Bookmarks", "Reading progress" and "Translation and reciter" down with it. Those four
   * do not depend on the catalogue, and a user whose network dropped would lose access to the
   * bookmarks already on their device.
   *
   * So the list always renders, its header always renders, and the resource's loading, error,
   * offline and empty states are rendered *as the list's empty state* — in the space the rows would
   * have occupied, with everything around them intact.
   */
  const rows: readonly SurahSummary[] =
    surahs.status === 'settled' && hasData(surahs.result) ? surahs.result.data : [];

  return (
    <SurahList
      list={rows}
      onOpen={(surah) => router.push(readerHref(surah))}
      source={quran.source}
      /*
        Rendered only when there are no rows, so a stale-but-complete catalogue is never covered by a
        banner about a background re-check the user did not ask for.
      */
      empty={
        rows.length > 0 ? null : (
          <FaithResourceView
            resource={surahs}
            empty={{
              title: 'No surahs available',
              body: 'The Qur’an catalogue could not be loaded.',
              actionLabel: 'Try again',
            }}
            onEmptyAction={surahs.reload}
            loadingRows={6}
            testID="faith-quran-list"
          >
            {() => null}
          </FaithResourceView>
        )
      }
    />
  );
}

/** Split out so `useMemo` and `useCallback` are not called inside a conditional branch. */
function SurahList({
  list,
  onOpen,
  source,
  empty,
}: {
  readonly list: readonly SurahSummary[];
  readonly onOpen: (surah: number) => void;
  readonly source: { readonly name: string; readonly verified: boolean };
  /** `ReactElement` rather than `ReactNode`, because that is what `ListEmptyComponent` accepts. */
  readonly empty: ReactElement | null;
}) {
  const router = useRouter();
  const { dp } = useModuleMetrics();
  const { position, ready, resumeLabel } = useContinueReading();

  /**
   * Everything above the surahs, memoised.
   *
   * `ListHeaderComponent` is re-created on every render otherwise, which remounts the cards inside
   * it — cheap here, and the same discipline `FaithCatalogueList` records for its search field,
   * where the same mistake drops the keyboard on every keystroke.
   */
  const header = useMemo(
    () => (
      <View
        style={{ rowGap: dp(moduleLayout.sectionGap), paddingBottom: dp(moduleLayout.cardGap) }}
      >
        {/*
          ── The hero action was built, measured on device, and removed ─────────────
          A "Start Reading"/"Continue Reading" pill in the cleared lower-left region is permitted, and it
          worked. It also **covered the second line of the baked subtitle**: at the hero's 2.507 crop the
          baked copy sits lower in the card than it does in the 2.09 source, so the cleared band is partly
          below the crop and the pill landed on "where you stopped."

          Rule 15 requires the button stay inside the cleared region without covering existing text, and
          it could not. The action is optional, and nothing is lost by dropping it: the "Continue reading"
          card immediately below carries the same navigation with the surah name and real progress, and
          the surah list is the affordance for starting fresh.
        */}
        <FaithSectionHero
          submenu="quran"
          heroImage={faithHeroImages.quran}
          summary="Read, search and resume where you stopped."
        />
        <UnverifiedSourceNotice source={source} testID="faith-quran" />

        {/*
          Rendered only once storage has answered *and* the user has actually read something.

          An earlier build seeded a position of Al-Kahf verse 32 at 55%, so this card appeared on a
          first launch showing progress through a surah nobody had opened. There is no seed now,
          which means the honest first-run state for this card is not to exist — the surah list below
          is the affordance, and it is right there.
        */}
        {!ready || position === null ? null : (
          <ModuleCard
            onPress={() => router.push(readerHref(position.surah, position.ayah))}
            accessibilityLabel={`Continue reading, ${resumeLabel}. ${formatPositionProgress(position) ?? ''}`}
            testID="faith-quran-continue"
          >
            <ModuleText token="cardTitle" numberOfLines={1}>
              Continue reading
            </ModuleText>
            <ModuleText token="caption" numberOfLines={1}>
              {resumeLabel}
            </ModuleText>
            <View style={{ marginTop: dp(8) }}>
              <ModuleProgressBar
                value={position.progress}
                accessibilityLabel={`${resumeLabel}, reading progress`}
                testID="faith-quran-continue-progress"
              />
            </View>
            {/* The fraction the bar is drawn from, in words. A bar alone is not a measurement. */}
            <ModuleText token="caption" numberOfLines={1} style={{ marginTop: dp(4) }}>
              {formatPositionProgress(position) ?? ''}
            </ModuleText>
          </ModuleCard>
        )}

        {/*
          ── There is no search row here, deliberately ──────────────────────────────
          One used to sit at the top of this group. Quran Foundation's approval covers the Content
          APIs; their Search APIs are a separate scope NoorLife does not have, so the control could
          never do the thing its label promised. Two options were available and one was worse:
          keeping it with a permanent "unavailable" notice makes the first row of the Qur'an screen
          an apology, and teaches the user that NoorLife's controls do not work.

          Search still exists, still works on narrations and duas, and is offered from More with a
          label that states its scope. When the Search scope is approved, a row comes back here.
        */}
        <FaithRowGroup testID="faith-quran-actions">
          {[
            <FaithRow
              key="progress"
              title="Reading progress"
              subtitle="Your daily goal and how far you have read"
              icon="target"
              onPress={() => router.push(faithRoutes.progress)}
              testID="faith-quran-progress"
            />,
            <FaithRow
              key="bookmarks"
              title="Bookmarks"
              subtitle="Verses, narrations and duas you saved"
              icon="bookmark"
              onPress={() => router.push(faithRoutes.bookmarks)}
              testID="faith-quran-bookmarks"
            />,
            <FaithRow
              key="preferences"
              title="Translation and reciter"
              subtitle="Choose what you read and listen to"
              icon="settings"
              onPress={() => router.push(faithRoutes.preferences)}
              testID="faith-quran-preferences"
            />,
          ]}
        </FaithRowGroup>

        <ModuleText token="cardTitle" numberOfLines={1} accessibilityRole="header">
          All surahs
        </ModuleText>
      </View>
    ),
    [dp, source, ready, position, resumeLabel, router],
  );

  const renderRow = useCallback(
    ({ item }: { readonly item: SurahSummary }) => (
      <FaithRow
        title={`${item.number}. ${item.name}`}
        subtitle={`${item.meaning} • ${item.ayahCount} ayat • ${item.revelation === 'meccan' ? 'Meccan' : 'Medinan'}`}
        arabic={item.arabicName}
        /*
          Opens *this* surah. Every one of these rows used to push the same parameterless reader
          route, so tapping Al-Baqarah opened whatever was last in storage.
        */
        onPress={() => onOpen(item.number)}
        accessibilityLabel={`Surah ${item.number}, ${item.name}, ${item.meaning}, ${item.ayahCount} ayat`}
        testID={`faith-quran-surah-${item.number}`}
      />
    ),
    [onOpen],
  );

  return (
    <FlatList
      data={list}
      keyExtractor={(item) => String(item.number)}
      ListHeaderComponent={header}
      renderItem={renderRow}
      ItemSeparatorComponent={Divider}
      ListEmptyComponent={empty}
      showsVerticalScrollIndicator={false}
      /**
       * Tuned down from the defaults, and the reason is measured.
       *
       * `initialNumToRender` defaults to 10, which is already about a screenful here; the cost being
       * removed is the other 104. `windowSize` of 5 keeps two screens of rows either side of the
       * viewport realised, which is enough that a fast flick does not reach blank space on this
       * device without paying to mount the whole catalogue.
       */
      initialNumToRender={12}
      windowSize={5}
      removeClippedSubviews
      contentContainerStyle={{ paddingBottom: dp(moduleLayout.scrollBottomInset) }}
      testID="faith-quran-surahs"
    />
  );
}

function Divider() {
  return <View style={styles.divider} accessible={false} />;
}

const styles = StyleSheet.create({
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: moduleNeutrals.divider,
  },
});
