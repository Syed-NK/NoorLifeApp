import { useCallback, useState } from 'react';
import { View } from 'react-native';

import { AppIcon, PressableScale } from '@ds/components';
import { ModuleText } from '@features/modules/components';
import { ModuleCard } from '@features/modules/components/module-card';
import { useModuleTheme } from '@features/modules/module-context';
import { moduleLayout, moduleNeutrals } from '@features/modules/module-tokens';
import { useModuleMetrics } from '@features/modules/use-module-metrics';
import { minimumHitSlop } from '@shared/utils/a11y';

import { ArabicText, FaithRow, FaithRowGroup } from '../components/faith-list';
import { FaithIdentity } from '../components/faith-identity';
import { FaithResourceView, FaithScreen } from '../components/faith-screen';
import { SourceBadge } from '../components/faith-states';
import type { Dua } from '../data/dua.repository';
import { MOCK_SOURCE } from '../data/mock/mock-support';
import { useFaithRepositories } from '../di/faith-repository-context';
import { faithNavKeys } from '../faith-routes';
import { useBookmark } from '../hooks/use-bookmark';
import { useFaithPreferences } from '../hooks/use-faith-preferences';
import { useFaithResource } from '../hooks/use-faith-resource';

/**
 * Duas — categories, then the supplications within one.
 *
 * Transliteration is shown or hidden by preference, and is always labelled as a reading
 * aid rather than presented alongside the Arabic as an equal rendering.
 */
export function DuasScreen() {
  const { dp } = useModuleMetrics();
  const { dua } = useFaithRepositories();
  const { preferences } = useFaithPreferences();
  const [categoryId, setCategoryId] = useState<string | null>(null);

  const categories = useFaithResource(
    'dua.categories',
    useCallback(() => dua.listCategories(), [dua]),
  );

  const duas = useFaithResource(
    `dua.list.${categoryId ?? 'none'}`,
    useCallback(
      () =>
        categoryId === null
          ? Promise.resolve({ kind: 'empty' as const })
          : dua.listByCategory(categoryId),
      [dua, categoryId],
    ),
  );

  return (
    <FaithScreen title="Duas" activeKey={faithNavKeys.more} testID="faith-duas">
      <View style={{ rowGap: dp(moduleLayout.sectionGap) }}>
        <FaithIdentity submenu="duas" summary="Supplications for the day and for difficulty." />
        <SourceBadge source={MOCK_SOURCE} testID="faith-duas" />

        <FaithResourceView
          resource={categories}
          empty={{ title: 'No categories', body: 'Dua categories could not be loaded.' }}
          loadingRows={3}
          testID="faith-duas-categories"
        >
          {(list) => (
            <FaithRowGroup title="Categories" testID="faith-duas-category-list">
              {list.map((category) => (
                <FaithRow
                  key={category.id}
                  title={category.name}
                  subtitle={category.description}
                  meta={`${category.duaCount}`}
                  icon="worship"
                  onPress={() => setCategoryId(category.id)}
                  accessibilityLabel={`${category.name}, ${category.duaCount} supplications`}
                  testID={`faith-duas-category-${category.id}`}
                />
              ))}
            </FaithRowGroup>
          )}
        </FaithResourceView>

        {categoryId === null ? (
          <ModuleCard testID="faith-duas-prompt">
            <ModuleText token="body" numberOfLines={2}>
              Choose a category above to read its supplications.
            </ModuleText>
          </ModuleCard>
        ) : (
          <FaithResourceView
            resource={duas}
            empty={{ title: 'No duas here yet', body: 'This category has no entries.' }}
            loadingRows={2}
            testID="faith-duas-list"
          >
            {(page) => (
              <View style={{ rowGap: dp(moduleLayout.cardGap) }}>
                {page.items.map((item) => (
                  <DuaCard
                    key={item.id}
                    dua={item}
                    showTransliteration={preferences.showTransliteration}
                  />
                ))}
              </View>
            )}
          </FaithResourceView>
        )}
      </View>
    </FaithScreen>
  );
}

function DuaCard({
  dua,
  showTransliteration,
}: {
  readonly dua: Dua;
  readonly showTransliteration: boolean;
}) {
  const theme = useModuleTheme();
  const { dp } = useModuleMetrics();
  const { bookmarked, toggle } = useBookmark({
    kind: 'dua',
    id: dua.id,
    label: dua.title,
    subtitle: dua.translation,
  });

  return (
    <ModuleCard testID={`faith-dua-${dua.id}`}>
      <View style={{ rowGap: dp(7) }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', columnGap: dp(8) }}>
          <ModuleText token="cardTitle" numberOfLines={2} style={{ flex: 1 }}>
            {dua.title}
          </ModuleText>
          <PressableScale
            onPress={() => void toggle()}
            accessibilityRole="button"
            accessibilityLabel={
              bookmarked ? `Remove bookmark on ${dua.title}` : `Bookmark ${dua.title}`
            }
            accessibilityState={{ selected: bookmarked }}
            hitSlop={minimumHitSlop(dp(20))}
            testID={`faith-dua-bookmark-${dua.id}`}
          >
            <AppIcon
              name="bookmark"
              size={dp(18)}
              color={bookmarked ? theme.ink : moduleNeutrals.textSecondary}
            />
          </PressableScale>
        </View>

        <ArabicText size="display" testID={`faith-dua-arabic-${dua.id}`}>
          {dua.arabic}
        </ArabicText>

        {showTransliteration && dua.transliteration !== undefined ? (
          <View>
            <ModuleText token="caption" numberOfLines={1}>
              Transliteration (a reading aid)
            </ModuleText>
            <ModuleText token="body" numberOfLines={3}>
              {dua.transliteration}
            </ModuleText>
          </View>
        ) : null}

        <ModuleText token="body" numberOfLines={5}>
          {dua.translation}
        </ModuleText>

        <ModuleText token="caption" numberOfLines={2}>
          {dua.reference}
          {dua.repetitions === undefined ? '' : ` • Recited ${dua.repetitions}×`}
        </ModuleText>
      </View>
    </ModuleCard>
  );
}
