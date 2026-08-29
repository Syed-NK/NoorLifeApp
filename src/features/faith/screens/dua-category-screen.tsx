import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { PressableScale } from '@ds/components';
import { modulePalettes } from '@ds/tokens';
import { ModuleText } from '@features/modules/components';
import { ModuleCard } from '@features/modules/components/module-card';
import {
  moduleLayout,
  moduleNeutrals,
  readerPageBackground,
} from '@features/modules/module-tokens';
import { useModuleMetrics } from '@features/modules/use-module-metrics';

import { AddSelection, ReviewedItem, SelectionItem } from '../components/dua-library-items';
import { DuaPopularSection } from '../components/dua-popular-section';
import { DuaFilterSheet, DuaSearchRow } from '../components/dua-search-controls';
import { FaithPictogram } from '../components/faith-locked-library';
import { FaithScreen } from '../components/faith-screen';
import { SelectionOriginBadge } from '../components/quran-selection-view';
import { duaCategoryById, type DuaCategory } from '../data/duas/dua-categories';
import {
  categoryFilterAvailable,
  categoryFilterOptions,
  duaCategoryEmptyCopy,
  duaCategoryResults,
  type DuaCategoryFilter,
  type DuaCategoryRow,
} from '../data/duas/dua-category-results';
import { popularDuas, popularOverflowCount } from '../data/duas/dua-popular';
import { reviewedDuaAsReference, reviewedDuas, type ReviewedDua } from '../data/duas/reviewed-dua';
import { duaCategoryIcon, duaCategoryIconSlot } from '../faith-dua-category-assets';
import {
  duaCategoryHref,
  duaDetailHref,
  faithNavKeys,
  faithRoutes,
  readerHref,
} from '../faith-routes';
import { useCachedSurahNames } from '../hooks/use-cached-surah-names';
import { useQuranSelections } from '../hooks/use-quran-selections';
import { useTasbih } from '../hooks/use-tasbih';
import { minimumTouchTargetSize } from '@shared/utils/a11y';

/**
 * **One category of the Duas library** — its own search, its own filters, and an honest account of
 * what is in it.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── Two shapes, and the reason they are not one screen with a flag ─────────
 * A **personal** category — My Quran Selections, Favorites — is a working list of the user's own
 * references with every action they had before this feature existed. A **reviewed** category is a place
 * a qualified reviewer has not filled yet.
 *
 * They render differently because they are different claims, and the branch is on `category.kind`
 * rather than on whether the list happens to be empty. An empty personal list means "you have not
 * saved anything"; an empty reviewed list means "nobody has reviewed anything", and collapsing the two
 * into "nothing here" would tell the user their own list was missing. `duaCategoryResults` returns
 * which of the five kinds of nothing this is, so the screen never has to work it out from a count.
 *
 * ── The page is complete with zero reviewed entries, deliberately ──────────
 * Search works, the filters work, the personal categories are fully functional, and the reviewed ones
 * explain themselves. What is *absent* rather than empty is the Popular section: no reviewed entry has
 * an editorial rank, so it draws nothing at all — no heading, no placeholder cards, and no "coming
 * soon" repeated down the page. See `DuaPopularSection`.
 *
 * The rest of the page renders normally around it. A screen that showed one honest explanation and then
 * three empty boxes would read as broken, and it is not broken — it is a library whose reviewed shelves
 * are not stocked and whose own shelves are.
 *
 * ── What the empty reviewed state must and must not say ────────────────────
 * It says this *category* has no reviewed content, why, and where to go instead. It does not say the
 * Duas module is unavailable — the grid behind it works, and so do the two personal categories, and
 * describing a working feature as unavailable is its own false statement. The wording lives in
 * `duaCategoryEmptyCopy` so the sentence and the reason for it cannot drift apart.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const EMERALD_DEEP = modulePalettes.faith.dark;

export function DuaCategoryScreen({ categoryId }: { readonly categoryId: string }) {
  const category = duaCategoryById(categoryId);

  return (
    <FaithScreen
      title={category?.label ?? 'Duas'}
      activeKey={faithNavKeys.more}
      background={readerPageBackground}
      testID="faith-dua-category"
    >
      {category === undefined ? <UnknownCategory /> : <CategoryBody category={category} />}
    </FaithScreen>
  );
}

/**
 * A route parameter that names no category.
 *
 * Reachable only by a hand-typed deep link, and answered honestly rather than by silently redirecting
 * to the grid — a screen that quietly shows something else is a screen that makes a broken link look
 * like a working one.
 */
function UnknownCategory() {
  const { dp } = useModuleMetrics();
  const router = useRouter();

  return (
    <View style={{ rowGap: dp(moduleLayout.cardGap) }}>
      <ModuleCard testID="faith-dua-category-unknown">
        <View style={{ rowGap: dp(4) }}>
          <ModuleText token="cardTitle" numberOfLines={2}>
            That category does not exist
          </ModuleText>
          <ModuleText token="caption" numberOfLines={3}>
            The link you followed does not name one of the Duas categories.
          </ModuleText>
        </View>
      </ModuleCard>
      <BackToCategories onPress={() => router.replace(faithRoutes.duas)} />
    </View>
  );
}

function CategoryBody({ category }: { readonly category: DuaCategory }) {
  const { dp } = useModuleMetrics();
  const router = useRouter();
  const selections = useQuranSelections();
  const tasbih = useTasbih();
  const { surahs } = useCachedSurahNames();

  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<DuaCategoryFilter>('all');
  const [filterOpen, setFilterOpen] = useState(false);

  /** Zero until a manifest carries an entry a named reviewer approved on a stated date. */
  const reviewed = useMemo(() => reviewedDuas(), []);

  const surahNames = useMemo(() => {
    const names = new Map<number, string>();
    for (const surah of surahs) {
      if (surah.name !== null) {
        names.set(surah.number, surah.name);
      }
    }
    return names;
  }, [surahs]);

  const filterOptions = useMemo(() => categoryFilterOptions(category), [category]);
  /*
    A filter the card does not offer falls back to All rather than filtering to nothing. Reachable by
    changing category while a filter is held — Favorites is offered on My Quran Selections and not on a
    reviewed card — and the honest answer to "show me favourites here" where the concept does not apply
    is the unfiltered list, not an empty one.
  */
  const effectiveFilter: DuaCategoryFilter = categoryFilterAvailable(category, filter)
    ? filter
    : 'all';

  const results = useMemo(
    () =>
      duaCategoryResults({
        category,
        filter: effectiveFilter,
        query,
        selections: selections.selections,
        reviewed,
        surahNames,
      }),
    [category, effectiveFilter, query, selections.selections, reviewed, surahNames],
  );

  const popular = useMemo(() => popularDuas(category.id, reviewed), [category.id, reviewed]);
  const popularOverflow = useMemo(
    () => popularOverflowCount(category.id, reviewed),
    [category.id, reviewed],
  );

  const read = (surah: number, ayah: number): void => {
    router.push(readerHref(surah, ayah));
  };
  const open = (duaId: string): void => {
    router.push(duaDetailHref(duaId));
  };

  const activeFilterLabel =
    filterOptions.find((option) => option.id === effectiveFilter)?.label ?? 'All';

  return (
    <View style={{ rowGap: dp(moduleLayout.cardGap) }}>
      <CategoryHeader category={category} />

      <DuaSearchRow
        value={query}
        onChange={setQuery}
        onOpenFilter={() => setFilterOpen(true)}
        filterActive={effectiveFilter !== 'all'}
        filterLabel={activeFilterLabel}
        searchHint="Searches this category by title, reference, surah name or your own note"
        testIDPrefix="faith-dua-category"
      />

      {/*
        Absent, not empty, while nothing is ranked. See the module note and `DuaPopularSection` — it
        returns `null` on an empty list, heading included.
      */}
      <DuaPopularSection entries={popular} overflowCount={popularOverflow} onOpen={open} />

      <ModuleText
        token="cardTitle"
        color={moduleNeutrals.textPrimary}
        numberOfLines={2}
        accessibilityRole="header"
        testID="faith-dua-category-results-heading"
      >
        {/*
          "All Duas" over a reviewed shelf; the card's own name over the user's own list, because
          "All Duas" above two saved verses would describe them as duas — which is the claim a personal
          selection deliberately does not make.
        */}
        {category.kind === 'reviewed' ? 'All Duas' : category.label}
      </ModuleText>

      {results.emptyReason === 'not-empty' ? (
        <View style={{ rowGap: dp(moduleLayout.cardGap) }} testID="faith-dua-category-results">
          {results.rows.map((row) => (
            <CategoryRow
              key={row.kind === 'personal' ? row.selection.id : row.dua.id}
              row={row}
              selections={selections}
              tasbih={tasbih}
              onRead={read}
              onOpen={open}
              onOpenTasbih={() => router.push(faithRoutes.tasbih)}
            />
          ))}
        </View>
      ) : (
        <EmptyCategory reason={results.emptyReason} category={category} />
      )}

      {/*
        Offered on My Quran Selections whether or not it is empty: somebody with three selections wants
        a fourth from the same place they found the first three.
      */}
      {category.id === 'my-quran-selections' ? (
        <AddSelection
          onPress={() => router.push(faithRoutes.quranSelection)}
          testID="faith-dua-category-add-selection"
        />
      ) : null}

      {/*
        The cross-link belongs on a reviewed card and only there. On My Quran Selections it would point
        at the page it is already on, and on Favorites it would offer a detour to the list the user is
        one tap from anyway.
      */}
      {category.kind === 'reviewed' ? <OpenSelections /> : null}

      <BackToCategories onPress={() => router.back()} />

      <ModuleCard
        onPress={() => router.push(faithRoutes.contentInfo)}
        accessibilityLabel="Where this content comes from"
        testID="faith-dua-category-attribution"
      >
        <ModuleText token="caption" color={EMERALD_DEEP} numberOfLines={1}>
          Where this content comes from
        </ModuleText>
      </ModuleCard>

      <DuaFilterSheet
        open={filterOpen}
        options={filterOptions}
        selected={effectiveFilter}
        onSelect={(next) => {
          setFilter(next);
          setFilterOpen(false);
        }}
        onClose={() => setFilterOpen(false)}
        testIDPrefix="faith-dua-category"
      />
    </View>
  );
}

/**
 * The card's icon and what it is.
 *
 * ── Why the description is repeated here ───────────────────────────────────
 * It is already the grid card's spoken description. Drawing it again at the top of the page is not
 * duplication for its own sake: somebody who arrived by link never saw the grid, and on a reviewed card
 * the description is the only thing that says what *would* be here — which is what makes the empty
 * state below it a statement about stocking rather than about breakage.
 *
 * The icon is the same asset the grid drew, at the same size, from the same registry. It is decorative
 * and marked inaccessible, so it is never announced beside a heading that already names the category.
 */
function CategoryHeader({ category }: { readonly category: DuaCategory }) {
  const { dp } = useModuleMetrics();
  const icon = duaCategoryIcon(category.id);

  return (
    /*
      `faith-dua-category-about`, not `-header`: `ModuleScaffold` reserves `${testID}-header` for the
      module chrome — Back, the title, Help and the profile affordance — and reusing it here produced two
      nodes under one id. The chrome is the standard Faith header and this card is the category's own
      summary beneath it; they are different things and now say so.
    */
    <ModuleCard testID="faith-dua-category-about">
      <View style={[styles.header, { columnGap: dp(10) }]}>
        <FaithPictogram
          slot={duaCategoryIconSlot(category.id)}
          size={dp(icon.renderedAtDp)}
          testID="faith-dua-category-icon"
        />
        <View style={[styles.flex, { rowGap: dp(2) }]}>
          <ModuleText
            token="cardTitle"
            color={moduleNeutrals.textPrimary}
            /* Two lines, so the longest label wraps rather than breaking mid-word at any text size. */
            numberOfLines={2}
            accessibilityRole="header"
            testID="faith-dua-category-about-title"
          >
            {category.label}
          </ModuleText>
          <ModuleText
            token="caption"
            color={moduleNeutrals.textSecondary}
            numberOfLines={3}
            testID="faith-dua-category-description"
          >
            {category.description}
          </ModuleText>
        </View>
      </View>
    </ModuleCard>
  );
}

/** One row, dispatched on what kind of thing it is — never on which list it came from. */
function CategoryRow({
  row,
  selections,
  tasbih,
  onRead,
  onOpen,
  onOpenTasbih,
}: {
  readonly row: DuaCategoryRow;
  readonly selections: ReturnType<typeof useQuranSelections>;
  readonly tasbih: ReturnType<typeof useTasbih>;
  readonly onRead: (surah: number, ayah: number) => void;
  readonly onOpen: (duaId: string) => void;
  /** Navigates to the counter. Called only after the counter switch has been awaited. */
  readonly onOpenTasbih: () => void;
}) {
  if (row.kind === 'reviewed') {
    return (
      <ReviewedRow
        dua={row.dua}
        selections={selections}
        tasbih={tasbih}
        onRead={onRead}
        onOpen={onOpen}
      />
    );
  }

  const { selection } = row;
  return (
    <SelectionItem
      selection={selection}
      resolution={selections.resolve(selection)}
      activeCounterId={tasbih.session?.counterId ?? null}
      onOpen={() => onOpen(selection.id)}
      /*
        ── Awaited before navigating, and that is the whole point ─────────
        Fired-and-forgotten, these three lines race: `router.push` runs immediately, the Tasbih screen
        mounts, and `useTasbih` reads the store *before* `chooseCounter`'s write lands — so the counter
        opens showing whichever selection was active before. Seen on device: tapping count on 2:255
        opened a counter still captioned 5:1.

        Storage settled correctly either way, so nothing was lost. What was wrong is what the user saw,
        on the one screen whose entire job is to show what they are counting.
      */
      onUse={() => {
        void (async () => {
          await selections.markUsed(selection.id);
          await tasbih.chooseCounter(selection.id);
          onOpenTasbih();
        })();
      }}
      onRead={() => onRead(selection.surah, selection.startAyah)}
      onToggleFavourite={() => void selections.toggleFavourite(selection.id)}
      onRemove={() => {
        void selections.remove(selection.id);
        /*
          The counting state goes with it, and only it. `forgetCounter` takes one id and affects one
          counter — removing a selection must never disturb the count on another.
        */
        void tasbih.forgetCounter(selection.id);
      }}
      testIDPrefix="faith-dua-category-selection"
    />
  );
}

/**
 * A reviewed entry's row.
 *
 * Unreachable while the manifest is empty, and written so populating the manifest is a data change
 * rather than a screen change. A Qur’an-sourced entry reuses `ReviewedItem` through an adapter — that
 * component already settles which controls a reviewed row gets, and a second one would be a second
 * answer. A Hadith-sourced entry has no range to resolve, so it draws its title and reference and
 * nothing it would have to invent.
 */
function ReviewedRow({
  dua,
  selections,
  tasbih,
  onRead,
  onOpen,
}: {
  readonly dua: ReviewedDua;
  readonly selections: ReturnType<typeof useQuranSelections>;
  readonly tasbih: ReturnType<typeof useTasbih>;
  readonly onRead: (surah: number, ayah: number) => void;
  readonly onOpen: (duaId: string) => void;
}) {
  const { dp } = useModuleMetrics();
  const reference = reviewedDuaAsReference(dua);

  if (reference === null) {
    return (
      <ModuleCard testID={`faith-dua-category-reviewed-${dua.id}`}>
        <View style={{ rowGap: dp(6) }}>
          <SelectionOriginBadge origin="reviewed" />
          <PressableScale
            onPress={() => onOpen(dua.id)}
            accessibilityRole="button"
            accessibilityLabel={`Open ${dua.title}`}
            style={{ minHeight: minimumTouchTargetSize(), rowGap: dp(4) }}
            testID={`faith-dua-category-reviewed-open-${dua.id}`}
          >
            <ModuleText token="body" color={moduleNeutrals.textPrimary} numberOfLines={2}>
              {dua.title}
            </ModuleText>
            <ModuleText token="caption" color={EMERALD_DEEP} numberOfLines={2}>
              {`${dua.source.kind === 'hadith' ? dua.source.collection : ''} ${
                dua.source.kind === 'hadith' ? dua.source.reference : ''
              }`.trim()}
            </ModuleText>
          </PressableScale>
        </View>
      </ModuleCard>
    );
  }

  return (
    <ReviewedItem
      entry={reference}
      resolution={selections.resolve({
        surah: reference.surah,
        startAyah: reference.startAyah,
        endAyah: reference.endAyah,
      })}
      onOpen={() => onOpen(dua.id)}
      onUse={() => void tasbih.chooseCounter(dua.id, dua.recommendedTarget ?? undefined)}
      onRead={() => onRead(reference.surah, reference.startAyah)}
    />
  );
}

/**
 * Whichever kind of empty this is, in its own words.
 *
 * ── The testIDs are two, not one, and that is load-bearing ─────────────────
 * `faith-dua-category-empty` is the reviewed-content statement and `faith-dua-category-personal-empty`
 * is the user's own list being empty. A shared id would let a suite pass while the screen told somebody
 * their saved verses were awaiting scholarly review, which is the exact confusion the two sentences
 * exist to prevent.
 */
function EmptyCategory({
  reason,
  category,
}: {
  readonly reason: Exclude<ReturnType<typeof duaCategoryResults>['emptyReason'], 'not-empty'>;
  readonly category: DuaCategory;
}) {
  const { dp } = useModuleMetrics();
  const copy = duaCategoryEmptyCopy(reason, category);

  const testID =
    reason === 'no-reviewed-content'
      ? 'faith-dua-category-empty'
      : reason === 'no-search-match'
        ? 'faith-dua-category-search-empty'
        : 'faith-dua-category-personal-empty';

  return (
    <ModuleCard testID={testID}>
      <View style={{ rowGap: dp(6) }}>
        <ModuleText token="cardTitle" numberOfLines={3} accessibilityRole="header">
          {copy.title}
        </ModuleText>
        <ModuleText token="caption" numberOfLines={6}>
          {copy.body}
        </ModuleText>
        {copy.note === null ? null : (
          <ModuleText token="caption" numberOfLines={3} testID={`${testID}-note`}>
            {copy.note}
          </ModuleText>
        )}
      </View>
    </ModuleCard>
  );
}

/** The way across to the list that does work. Offered on a reviewed card, where it is a real answer. */
function OpenSelections() {
  const { dp } = useModuleMetrics();
  const router = useRouter();

  return (
    <PressableScale
      onPress={() => router.replace(duaCategoryHref('my-quran-selections'))}
      accessibilityRole="button"
      accessibilityLabel="Open My Quran Selections"
      style={[
        styles.link,
        {
          minHeight: minimumTouchTargetSize(),
          borderRadius: dp(moduleLayout.radiusSmall),
          paddingHorizontal: dp(12),
        },
      ]}
      testID="faith-dua-category-open-selections"
    >
      <ModuleText token="button" color={EMERALD_DEEP} numberOfLines={2}>
        Open My Quran Selections
      </ModuleText>
    </PressableScale>
  );
}

function BackToCategories({ onPress }: { readonly onPress: () => void }) {
  const { dp } = useModuleMetrics();

  return (
    <PressableScale
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="Back to all categories"
      style={[
        styles.link,
        {
          minHeight: minimumTouchTargetSize(),
          borderRadius: dp(moduleLayout.radiusSmall),
          paddingHorizontal: dp(12),
        },
      ]}
      testID="faith-dua-category-back"
    >
      <ModuleText token="button" color={EMERALD_DEEP} numberOfLines={2}>
        All categories
      </ModuleText>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  header: { alignItems: 'center', flexDirection: 'row' },
  link: {
    alignItems: 'center',
    backgroundColor: moduleNeutrals.surface,
    borderColor: moduleNeutrals.border,
    borderWidth: 1,
    justifyContent: 'center',
  },
});
