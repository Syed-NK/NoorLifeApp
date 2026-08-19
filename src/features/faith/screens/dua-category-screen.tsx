import { useRouter } from 'expo-router';
import { useMemo } from 'react';
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
import { FaithScreen } from '../components/faith-screen';
import { reviewedQuranDuas } from '../data/dhikr/reviewed-dua-manifest';
import { duaCategoryById, type DuaCategory } from '../data/duas/dua-categories';
import { reviewedForCategory, selectionsForCategory } from '../data/duas/dua-library';
import { duaCategoryHref, faithNavKeys, faithRoutes, readerHref } from '../faith-routes';
import { useQuranSelections } from '../hooks/use-quran-selections';
import { useTasbih } from '../hooks/use-tasbih';

/**
 * One category of the Duas library.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── Two shapes, and the reason they are not one screen with a flag ─────────
 * A **personal** category — My Quran Selections, Favorites — is a working list of the user's own
 * references with every action they had before this feature existed. A **reviewed** category is a
 * place a qualified reviewer has not filled yet.
 *
 * They render differently because they are different claims, and the branch is on `category.kind`
 * rather than on whether the list happens to be empty. An empty personal list means "you have not
 * saved anything"; an empty reviewed list means "nobody has reviewed anything", and collapsing the
 * two into "nothing here" would tell the user their own list was missing.
 *
 * ── What the empty reviewed state must and must not say ────────────────────
 * It says this *category* has no reviewed content, why, and where to go instead. It does not say the
 * Duas module is unavailable — the grid behind it works, and so do the two personal categories, and
 * describing a working feature as unavailable is its own false statement.
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

  const reviewed = useMemo(
    () => reviewedForCategory(category.reviewedCategories, reviewedQuranDuas()),
    [category.reviewedCategories],
  );
  const personal = useMemo(
    () => selectionsForCategory(category.id, selections.selections),
    [category.id, selections.selections],
  );

  const read = (surah: number, ayah: number): void => {
    router.push(readerHref(surah, ayah));
  };

  if (category.kind === 'reviewed') {
    return (
      <View style={{ rowGap: dp(moduleLayout.cardGap) }}>
        {reviewed.length === 0 ? (
          <EmptyReviewedCategory category={category} />
        ) : (
          reviewed.map((entry) => (
            <ReviewedItem
              key={entry.id}
              entry={entry}
              resolution={selections.resolve({
                surah: entry.surah,
                startAyah: entry.startAyah,
                endAyah: entry.endAyah,
              })}
              onUse={() =>
                void tasbih.chooseCounter(entry.id, entry.recommendedTarget ?? undefined)
              }
              onRead={() => read(entry.surah, entry.startAyah)}
            />
          ))
        )}
        <BackToCategories onPress={() => router.back()} />
      </View>
    );
  }

  return (
    <View style={{ rowGap: dp(moduleLayout.cardGap) }}>
      {personal.length === 0 ? (
        <ModuleCard testID="faith-dua-category-personal-empty">
          <View style={{ rowGap: dp(4) }}>
            <ModuleText token="cardTitle" numberOfLines={2}>
              {category.id === 'favourites' ? 'Nothing starred yet' : 'No selections yet'}
            </ModuleText>
            <ModuleText token="caption" numberOfLines={4}>
              {category.id === 'favourites'
                ? 'Star a selection and it appears here.'
                : 'Choose a verse from the Qur’an and it appears here, with its Arabic and its translation.'}
            </ModuleText>
          </View>
        </ModuleCard>
      ) : (
        personal.map((selection) => (
          <SelectionItem
            key={selection.id}
            selection={selection}
            resolution={selections.resolve(selection)}
            activeCounterId={tasbih.session?.counterId ?? null}
            onUse={() => {
              void selections.markUsed(selection.id);
              void tasbih.chooseCounter(selection.id);
              router.push(faithRoutes.tasbih);
            }}
            onRead={() => read(selection.surah, selection.startAyah)}
            onToggleFavourite={() => void selections.toggleFavourite(selection.id)}
            onRemove={() => {
              void selections.remove(selection.id);
              /*
                The counting state goes with it, and only it. `forgetCounter` takes one id and affects
                one counter — removing a selection must never disturb the count on another.
              */
              void tasbih.forgetCounter(selection.id);
            }}
            testIDPrefix="faith-dua-category-selection"
          />
        ))
      )}

      {category.id === 'my-quran-selections' ? (
        <AddSelection
          onPress={() => router.push(faithRoutes.quranSelection)}
          testID="faith-dua-category-add-selection"
        />
      ) : null}
      <BackToCategories onPress={() => router.back()} />
    </View>
  );
}

/**
 * What an unfilled reviewed category says.
 *
 * ── Every sentence here is load-bearing ────────────────────────────────────
 * The first states the fact about *this category*. The second says why, in terms of what NoorLife
 * does rather than what it lacks — "does not publish unverified supplications" is a policy somebody
 * chose, and reads very differently from "content is missing", which sounds like a fault. The third
 * points at the thing that does work, so the user leaves with somewhere to go.
 */
function EmptyReviewedCategory({ category }: { readonly category: DuaCategory }) {
  const { dp } = useModuleMetrics();
  const router = useRouter();

  return (
    <View style={{ rowGap: dp(moduleLayout.cardGap) }}>
      <ModuleCard testID="faith-dua-category-empty">
        <View style={{ rowGap: dp(6) }}>
          <ModuleText token="cardTitle" numberOfLines={3} accessibilityRole="header">
            Reviewed content for this category is not available yet.
          </ModuleText>
          <ModuleText token="caption" numberOfLines={6}>
            NoorLife does not publish supplications that a qualified reviewer has not approved.
            Nothing appears in {category.label} until each reference has been reviewed and the
            review recorded.
          </ModuleText>
          <ModuleText token="caption" numberOfLines={3}>
            Your own Qur’an selections are unaffected.
          </ModuleText>
        </View>
      </ModuleCard>

      <PressableScale
        onPress={() => router.replace(duaCategoryHref('my-quran-selections'))}
        accessibilityRole="button"
        accessibilityLabel="Open My Quran Selections"
        style={[
          styles.link,
          {
            minHeight: dp(moduleLayout.minTouchTarget),
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
    </View>
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
          minHeight: dp(moduleLayout.minTouchTarget),
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
  link: {
    alignItems: 'center',
    backgroundColor: moduleNeutrals.surface,
    borderColor: moduleNeutrals.border,
    borderWidth: 1,
    justifyContent: 'center',
  },
});
