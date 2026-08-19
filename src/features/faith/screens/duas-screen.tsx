import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Modal, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { AppIcon, PressableScale } from '@ds/components';
import { modulePalettes } from '@ds/tokens';
import { ModuleText } from '@features/modules/components';
import { ModuleCard } from '@features/modules/components/module-card';
import {
  moduleLayout,
  moduleNeutrals,
  readerPageBackground,
} from '@features/modules/module-tokens';
import { useModuleMetrics } from '@features/modules/use-module-metrics';
import { minimumHitSlop } from '@shared/utils/a11y';

import { SelectionItem } from '../components/dua-library-items';
import { FaithPictogram } from '../components/faith-locked-library';
import { FaithScreen } from '../components/faith-screen';
import { SelectionOriginBadge } from '../components/quran-selection-view';
import { reviewedQuranDuas } from '../data/dhikr/reviewed-dua-manifest';
import { categoryCountLabel, DUA_CATEGORIES, type DuaCategory } from '../data/duas/dua-categories';
import {
  DUA_LIBRARY_FILTERS,
  reviewedForCategory,
  searchDuaLibrary,
  selectionsForCategory,
  type DuaLibraryFilter,
  type DuaSearchResult,
} from '../data/duas/dua-library';
import { duaCategoryIcon, duaCategoryIconSlot } from '../faith-dua-category-assets';
import { duaCategoryHref, faithNavKeys, faithRoutes, readerHref } from '../faith-routes';
import { useCachedSurahNames } from '../hooks/use-cached-surah-names';
import { useQuranSelections } from '../hooks/use-quran-selections';
import { useTasbih } from '../hooks/use-tasbih';
import { recentSelections } from '../storage/faith-quran-selections';

/**
 * **Duas — the approved category library.**
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── What this replaced, and what it kept ───────────────────────────────────
 * A list-first screen with four stacked sections. Everything it did still works — My Quran
 * Selections, Favorites, recently used, Reader navigation, Tasbih, offline resolution, the
 * account-scoped reference-only store, the review gate and the Quran Foundation attribution — and
 * the navigation around it is now the locked two-column grid.
 *
 * The change is presentation. Not one rule about what may be shown moved.
 *
 * ── Why the grid is the default view and the list is a result ──────────────
 * A library of ten places is a thing you navigate; a list of two selections is a thing you scroll.
 * The screen shows the grid until the user says otherwise — a query, or a filter other than All —
 * and then shows results. One function answers both, so "what is in Favorites?" cannot have two
 * answers depending on which control you reached it from.
 *
 * ── The mint card is a state, not a card ───────────────────────────────────
 * The approved mock draws Morning & Evening on mint with an emerald border. That is the **pressed**
 * state, shown on one card so the design records what it looks like — not a permanent highlight.
 * Nothing here is highlighted while nothing is pressed, and the state is carried by border weight as
 * well as colour so it does not depend on colour alone.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const EMERALD = modulePalettes.faith.primary;
const EMERALD_DEEP = modulePalettes.faith.dark;
const MINT = modulePalettes.faith.soft;

export function DuasScreen() {
  const { dp, twoColumnWidth, stackTwoColumns } = useModuleMetrics();
  const router = useRouter();
  const selections = useQuranSelections();
  const tasbih = useTasbih();
  const { surahs } = useCachedSurahNames();

  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<DuaLibraryFilter>('all');
  const [filterOpen, setFilterOpen] = useState(false);

  /** Zero until a manifest carries an entry a named reviewer approved on a stated date. */
  const reviewed = useMemo(() => reviewedQuranDuas(), []);

  const surahNames = useMemo(() => {
    const names = new Map<number, string>();
    for (const surah of surahs) {
      if (surah.name !== null) {
        names.set(surah.number, surah.name);
      }
    }
    return names;
  }, [surahs]);

  /* Results replace the grid only when the user asked for them. */
  const searching = query.trim().length > 0 || filter !== 'all';
  const results = useMemo(
    () =>
      searching
        ? searchDuaLibrary({
            query,
            filter,
            selections: selections.selections,
            reviewed,
            surahNames,
          })
        : [],
    [searching, query, filter, selections.selections, reviewed, surahNames],
  );

  /**
   * The most recently used selection, or `null`.
   *
   * `recentSelections` returns only entries the user actually used — sending one to Tasbih or
   * opening it stamps it, and rendering a list never does. So the Continue card cannot appear for
   * something merely scrolled past, which is the whole reason it is trustworthy.
   */
  const continueSelection = useMemo(
    () => recentSelections(selections.selections, 1)[0] ?? null,
    [selections.selections],
  );

  return (
    <FaithScreen
      title="Duas"
      activeKey={faithNavKeys.more}
      background={readerPageBackground}
      testID="faith-duas"
    >
      <View style={{ rowGap: dp(moduleLayout.cardGap) }}>
        <SearchRow
          value={query}
          onChange={setQuery}
          onOpenFilter={() => setFilterOpen(true)}
          filter={filter}
        />

        {searching ? (
          <SearchResults
            results={results}
            filter={filter}
            selections={selections}
            tasbih={tasbih}
            onRead={(surah, ayah) => router.push(readerHref(surah, ayah))}
          />
        ) : (
          <>
            <View
              style={[
                styles.grid,
                { columnGap: dp(moduleLayout.cardGap), rowGap: dp(moduleLayout.cardGap) },
              ]}
              testID="faith-duas-grid"
            >
              {DUA_CATEGORIES.map((category) => (
                <CategoryCard
                  key={category.id}
                  category={category}
                  halfWidth={stackTwoColumns ? null : twoColumnWidth}
                  personalCount={selectionsForCategory(category.id, selections.selections).length}
                  reviewedCount={reviewedForCategory(category.reviewedCategories, reviewed).length}
                  onPress={() => router.push(duaCategoryHref(category.id))}
                />
              ))}
            </View>

            {continueSelection === null ? null : (
              <ContinueCard
                label={continueSelection.label}
                reference={`${continueSelection.surah}:${continueSelection.startAyah}${
                  continueSelection.endAyah === continueSelection.startAyah
                    ? ''
                    : `-${continueSelection.endAyah}`
                }`}
                /*
                  Opens the Reader, not Tasbih. The card shows a Qur'an reference, and "Continue"
                  beside one reads as "keep reading"; sending it to Tasbih would also *switch the
                  active counter*, which is a side effect a card the user tapped to resume should not
                  cause. Counting is offered on the item itself, deliberately.
                */
                onPress={() =>
                  router.push(readerHref(continueSelection.surah, continueSelection.startAyah))
                }
              />
            )}
          </>
        )}

        <ModuleCard
          onPress={() => router.push(faithRoutes.contentInfo)}
          accessibilityLabel="Where this content comes from"
          testID="faith-duas-attribution"
        >
          <ModuleText token="caption" color={EMERALD_DEEP} numberOfLines={1}>
            Where this content comes from
          </ModuleText>
        </ModuleCard>
      </View>

      <FilterSheet
        open={filterOpen}
        selected={filter}
        onSelect={(next) => {
          setFilter(next);
          setFilterOpen(false);
        }}
        onClose={() => setFilterOpen(false)}
      />
    </FaithScreen>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Search and filter
// ─────────────────────────────────────────────────────────────────────────────

function SearchRow({
  value,
  onChange,
  onOpenFilter,
  filter,
}: {
  readonly value: string;
  readonly onChange: (text: string) => void;
  readonly onOpenFilter: () => void;
  readonly filter: DuaLibraryFilter;
}) {
  const { dp } = useModuleMetrics();
  const active = DUA_LIBRARY_FILTERS.find((item) => item.id === filter);

  return (
    <View style={[styles.searchRow, { columnGap: dp(moduleLayout.cardGap) }]}>
      <View
        style={[
          styles.search,
          {
            borderRadius: dp(moduleLayout.radiusSmall),
            minHeight: dp(moduleLayout.minTouchTarget),
            paddingHorizontal: dp(12),
            columnGap: dp(10),
          },
        ]}
      >
        <AppIcon name="search" size={dp(18)} color={moduleNeutrals.textSecondary} />
        <TextInput
          value={value}
          onChangeText={onChange}
          placeholder="Find a remembrance"
          placeholderTextColor={moduleNeutrals.textTertiary}
          accessibilityLabel="Find a remembrance"
          style={[styles.flex, { color: moduleNeutrals.textPrimary, paddingVertical: dp(10) }]}
          testID="faith-duas-search"
        />
        {/*
          Offered only when there is something to clear. A permanent clear button on an empty field
          is a control that does nothing, and a screen reader announces it just as loudly.
        */}
        {value.length === 0 ? null : (
          <PressableScale
            onPress={() => onChange('')}
            accessibilityRole="button"
            accessibilityLabel="Clear the search"
            hitSlop={minimumHitSlop(dp(moduleLayout.minTouchTarget))}
            testID="faith-duas-search-clear"
          >
            <AppIcon name="close" size={dp(18)} color={moduleNeutrals.textSecondary} />
          </PressableScale>
        )}
      </View>

      <PressableScale
        onPress={onOpenFilter}
        accessibilityRole="button"
        accessibilityLabel={`Filter. Currently ${active?.label ?? 'All'}.`}
        style={[
          styles.filterButton,
          {
            width: dp(moduleLayout.minTouchTarget),
            height: dp(moduleLayout.minTouchTarget),
            borderRadius: dp(moduleLayout.radiusSmall),
            /* The active filter is carried by the border weight as well as the fill, never by colour alone. */
            borderColor: filter === 'all' ? moduleNeutrals.border : EMERALD,
            borderWidth: filter === 'all' ? 1 : 2,
            backgroundColor: filter === 'all' ? moduleNeutrals.surface : MINT,
          },
        ]}
        testID="faith-duas-filter"
      >
        <AppIcon name="settings" size={dp(18)} color={EMERALD_DEEP} />
      </PressableScale>
    </View>
  );
}

/**
 * The filter sheet.
 *
 * A `Modal` rather than an inline row, because the approved design puts the control behind a button
 * and an inline row of four chips would push the first grid row below the fold at every text size.
 */
function FilterSheet({
  open,
  selected,
  onSelect,
  onClose,
}: {
  readonly open: boolean;
  readonly selected: DuaLibraryFilter;
  readonly onSelect: (filter: DuaLibraryFilter) => void;
  readonly onClose: () => void;
}) {
  const { dp } = useModuleMetrics();

  return (
    <Modal
      visible={open}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      testID="faith-duas-filter-sheet"
    >
      {/* The scrim dismisses, and is labelled, so it is not a silent trap for a screen reader. */}
      <Pressable
        style={styles.scrim}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="Close the filter"
        testID="faith-duas-filter-scrim"
      >
        <View
          style={[
            styles.sheet,
            {
              borderTopLeftRadius: dp(moduleLayout.cardRadius),
              borderTopRightRadius: dp(moduleLayout.cardRadius),
              padding: dp(moduleLayout.cardPadding),
              rowGap: dp(6),
            },
          ]}
        >
          <ModuleText token="cardTitle" numberOfLines={1} accessibilityRole="header">
            Show
          </ModuleText>
          {DUA_LIBRARY_FILTERS.map((item) => {
            const active = item.id === selected;
            return (
              <PressableScale
                key={item.id}
                onPress={() => onSelect(item.id)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                accessibilityLabel={item.label}
                style={[
                  styles.filterRow,
                  {
                    minHeight: dp(moduleLayout.minTouchTarget),
                    borderRadius: dp(moduleLayout.radiusSmall),
                    paddingHorizontal: dp(12),
                    columnGap: dp(8),
                    backgroundColor: active ? MINT : moduleNeutrals.surface,
                    borderColor: active ? EMERALD : moduleNeutrals.border,
                    borderWidth: active ? 2 : 1,
                  },
                ]}
                testID={`faith-duas-filter-${item.id}`}
              >
                <ModuleText
                  token="body"
                  color={moduleNeutrals.textPrimary}
                  numberOfLines={2}
                  style={styles.flex}
                >
                  {item.label}
                </ModuleText>
                {/* A tick as well as the fill: the selected row must not depend on colour alone. */}
                {active ? <AppIcon name="check" size={dp(18)} color={EMERALD_DEEP} /> : null}
              </PressableScale>
            );
          })}
        </View>
      </Pressable>
    </Modal>
  );
}

function SearchResults({
  results,
  filter,
  selections,
  tasbih,
  onRead,
}: {
  readonly results: readonly DuaSearchResult[];
  readonly filter: DuaLibraryFilter;
  readonly selections: ReturnType<typeof useQuranSelections>;
  readonly tasbih: ReturnType<typeof useTasbih>;
  readonly onRead: (surah: number, ayah: number) => void;
}) {
  const { dp } = useModuleMetrics();

  if (results.length === 0) {
    return (
      <ModuleCard testID="faith-duas-search-empty">
        <View style={{ rowGap: dp(4) }}>
          <ModuleText token="cardTitle" numberOfLines={2}>
            {filter === 'reviewed' ? 'No reviewed duas yet' : 'Nothing matched that'}
          </ModuleText>
          <ModuleText token="caption" numberOfLines={4}>
            {filter === 'reviewed'
              ? 'NoorLife does not publish supplications that a qualified reviewer has not approved. Your own Qur’an selections are unaffected.'
              : 'Try a surah name, a reference like 2:255, or a word from a note you wrote.'}
          </ModuleText>
        </View>
      </ModuleCard>
    );
  }

  return (
    <View style={{ rowGap: dp(moduleLayout.cardGap) }} testID="faith-duas-search-results">
      {results.map((result) =>
        result.kind === 'personal' ? (
          <SelectionItem
            key={result.selection.id}
            selection={result.selection}
            resolution={selections.resolve(result.selection)}
            activeCounterId={tasbih.session?.counterId ?? null}
            /* Sequenced for the same reason the category list sequences it: the counter must be
               switched before anything reads it back. This path does not navigate, so the race is
               invisible rather than absent — which is a worse kind of wrong, not a lesser one. */
            onUse={() => {
              void (async () => {
                await selections.markUsed(result.selection.id);
                await tasbih.chooseCounter(result.selection.id);
              })();
            }}
            onRead={() => onRead(result.selection.surah, result.selection.startAyah)}
            onToggleFavourite={() => void selections.toggleFavourite(result.selection.id)}
            onRemove={() => {
              void selections.remove(result.selection.id);
              void tasbih.forgetCounter(result.selection.id);
            }}
            testIDPrefix="faith-duas-result"
          />
        ) : (
          <ModuleCard
            key={result.entry.id}
            testID={`faith-duas-result-reviewed-${result.entry.id}`}
          >
            <View style={{ rowGap: dp(4) }}>
              <SelectionOriginBadge origin="reviewed" />
              <ModuleText token="body" color={moduleNeutrals.textPrimary} numberOfLines={2}>
                {result.entry.title}
              </ModuleText>
              <ModuleText token="caption" color={EMERALD_DEEP} numberOfLines={1}>
                {`Qur’an ${result.reference}`}
              </ModuleText>
            </View>
          </ModuleCard>
        ),
      )}
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// The grid
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One category card.
 *
 * ── Where the width comes from ─────────────────────────────────────────────
 * `useModuleMetrics` already measures the half-column and already decides when a pair must stack —
 * `shouldStackTwoColumn`, whose threshold was measured on device across six widths and four text
 * sizes. Reusing it means this grid collapses at exactly the same point every other two-column pair
 * in the app collapses, rather than at a number chosen here.
 *
 * ── Why it is a flex basis and not a fixed width ───────────────────────────
 * A fixed `width` of exactly half the column is a layout that fits with nothing to spare, and on
 * device it did not fit: two 174 dp cards plus the 10 dp gap came to within a few pixels of the
 * container, and rounding pushed the second card onto its own line — ten stacked cards where the
 * design has five rows of two. Measured on the emulator at 411 dp, which is the reference width, so
 * every device would have shown it.
 *
 * A basis one dp under the half-column can never exceed half, and `flexGrow` lets the pair take back
 * the rounding slack so the two cards still meet the gap exactly.
 */
function CategoryCard({
  category,
  halfWidth,
  personalCount,
  reviewedCount,
  onPress,
}: {
  readonly category: DuaCategory;
  /** The measured half-column, or `null` when the pair must stack and each card takes the row. */
  readonly halfWidth: number | null;
  readonly personalCount: number;
  readonly reviewedCount: number;
  readonly onPress: () => void;
}) {
  const { dp } = useModuleMetrics();
  const [pressed, setPressed] = useState(false);
  const count = categoryCountLabel(category, personalCount, reviewedCount);
  const icon = duaCategoryIcon(category.id);

  return (
    <PressableScale
      onPress={onPress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      accessibilityRole="button"
      /*
        The label says what the card is and what opening it would show. The count is spoken in words
        rather than as a dash, which is a typographic mark a screen reader would read as "en dash" or
        skip entirely.
      */
      accessibilityLabel={`${category.label}. ${category.description}. ${
        category.kind === 'personal'
          ? `${personalCount} ${personalCount === 1 ? 'selection' : 'selections'}.`
          : reviewedCount === 0
            ? 'No reviewed content available yet.'
            : `${reviewedCount} reviewed.`
      }`}
      style={[
        styles.card,
        halfWidth === null
          ? styles.fullRow
          : { flexBasis: halfWidth - 1, flexGrow: 1, flexShrink: 1 },
        {
          borderRadius: dp(moduleLayout.cardRadius),
          padding: dp(moduleLayout.cardPadding),
          /* 8, not 10: the label needs the difference to keep its longest word whole. */
          columnGap: dp(8),
          minHeight: dp(88),
          /* Pressed, not selected: nothing on this screen is permanently highlighted. */
          backgroundColor: pressed ? MINT : moduleNeutrals.surface,
          borderColor: pressed ? EMERALD : moduleNeutrals.border,
          borderWidth: pressed ? 2 : 1,
        },
      ]}
      testID={`faith-duas-category-${category.id}`}
    >
      {/*
        Decorative. `FaithPictogram` marks it inaccessible, so the icon is never announced beside a
        label that already says what the card is.
      */}
      <FaithPictogram
        slot={duaCategoryIconSlot(category.id)}
        size={dp(icon.renderedAtDp)}
        testID={`faith-duas-category-${category.id}-icon`}
      />

      <View style={[styles.flex, { rowGap: dp(4) }]}>
        <ModuleText
          token="body"
          color={moduleNeutrals.textPrimary}
          /* Two lines, so "Daily Remembrances" wraps rather than truncating at any text size. */
          numberOfLines={2}
        >
          {category.label}
        </ModuleText>
        <View style={[styles.row, { columnGap: dp(6) }]}>
          <ModuleText
            token="caption"
            color={moduleNeutrals.textSecondary}
            numberOfLines={1}
            style={styles.flex}
            testID={`faith-duas-category-${category.id}-count`}
          >
            {count}
          </ModuleText>
          <AppIcon name="chevron-forward" size={dp(18)} color={EMERALD_DEEP} />
        </View>
      </View>
    </PressableScale>
  );
}

function ContinueCard({
  label,
  reference,
  onPress,
}: {
  readonly label: string | null;
  readonly reference: string;
  readonly onPress: () => void;
}) {
  const { dp } = useModuleMetrics();
  const title = label ?? 'Your Quran selection';

  return (
    <PressableScale
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Continue. ${title}. Qur’an ${reference}. Opens in the reader.`}
      style={[
        styles.card,
        {
          borderRadius: dp(moduleLayout.cardRadius),
          padding: dp(moduleLayout.cardPadding),
          columnGap: dp(10),
          minHeight: dp(moduleLayout.minTouchTarget),
          backgroundColor: moduleNeutrals.surface,
          borderColor: moduleNeutrals.border,
          borderWidth: 1,
        },
      ]}
      testID="faith-duas-continue"
    >
      <FaithPictogram
        slot={duaCategoryIconSlot('continue')}
        size={dp(duaCategoryIcon('continue').renderedAtDp)}
        testID="faith-duas-continue-icon"
      />
      <View style={[styles.flex, { rowGap: dp(2) }]}>
        <ModuleText token="caption" color={EMERALD_DEEP} numberOfLines={1}>
          Continue
        </ModuleText>
        <ModuleText token="body" color={moduleNeutrals.textPrimary} numberOfLines={2}>
          {title}
        </ModuleText>
        <ModuleText token="caption" color={EMERALD_DEEP} numberOfLines={1}>
          {`Qur’an ${reference}`}
        </ModuleText>
      </View>
      <AppIcon name="chevron-forward" size={dp(20)} color={EMERALD_DEEP} />
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  row: { alignItems: 'center', flexDirection: 'row' },
  searchRow: { alignItems: 'center', flexDirection: 'row' },
  search: {
    alignItems: 'center',
    backgroundColor: moduleNeutrals.surface,
    borderColor: moduleNeutrals.border,
    borderWidth: 1,
    flex: 1,
    flexDirection: 'row',
  },
  filterButton: { alignItems: 'center', justifyContent: 'center' },
  /*
    Wrapping rather than two fixed columns. A card given the full width because the pair had to stack
    simply fills the row, so one rule covers both shapes.
  */
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  card: { alignItems: 'center', flexDirection: 'row' },
  /* Stacked: one card per line, filling it, so the wrap rule needs no second branch. */
  fullRow: { flexBasis: '100%' },
  scrim: { backgroundColor: '#14265F55', flex: 1, justifyContent: 'flex-end' },
  sheet: { backgroundColor: moduleNeutrals.surface },
  filterRow: { alignItems: 'center', flexDirection: 'row' },
});
