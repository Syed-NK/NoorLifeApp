import { useCallback, useState } from 'react';
import { View } from 'react-native';

import { ModuleText } from '@features/modules/components';
import { ModuleCard } from '@features/modules/components/module-card';
import { moduleLayout, moduleNeutrals } from '@features/modules/module-tokens';
import { useModuleMetrics } from '@features/modules/use-module-metrics';

import { FaithRow, FaithRowGroup } from '../components/faith-list';
import { FaithResourceView, FaithScreen } from '../components/faith-screen';
import { SourceBadge } from '../components/faith-states';
import type { Hadith, HadithGrade } from '../data/hadith.repository';
import { MOCK_HADITH_SOURCE } from '../data/mock/mock-support';
import { useFaithRepositories } from '../di/faith-repository-context';
import { faithNavKeys } from '../faith-routes';
import { useFaithResource } from '../hooks/use-faith-resource';

/**
 * Hadith — collections, and the narrations within one.
 *
 * ── The grade is rendered, always ───────────────────────────────────────────
 * Every narration shows its authentication grade as a word, in a tone that distinguishes
 * sound from weak. A hadith card without a visible grade is not shippable, which is why
 * the repository makes the field required and this screen has no branch that omits it.
 */
export function HadithScreen() {
  const { dp } = useModuleMetrics();
  const { hadith } = useFaithRepositories();
  const [collectionId, setCollectionId] = useState<string | null>(null);

  const collections = useFaithResource(
    'hadith.collections',
    useCallback(() => hadith.listCollections(), [hadith]),
  );

  const narrations = useFaithResource(
    `hadith.list.${collectionId ?? 'none'}`,
    useCallback(
      () =>
        collectionId === null
          ? Promise.resolve({ kind: 'empty' as const })
          : hadith.listByCollection(collectionId),
      [hadith, collectionId],
    ),
  );

  return (
    <FaithScreen title="Hadith" activeKey={faithNavKeys.more} testID="faith-hadith">
      <View style={{ rowGap: dp(moduleLayout.sectionGap) }}>
        <SourceBadge source={MOCK_HADITH_SOURCE} testID="faith-hadith" />

        <FaithResourceView
          resource={collections}
          empty={{ title: 'No collections', body: 'Hadith collections could not be loaded.' }}
          loadingRows={3}
          testID="faith-hadith-collections"
        >
          {(list) => (
            <FaithRowGroup title="Collections" testID="faith-hadith-collection-list">
              {list.map((collection) => (
                <FaithRow
                  key={collection.id}
                  title={collection.name}
                  subtitle={`${collection.compiler} • ${collection.narrationCount.toLocaleString()} narrations`}
                  arabic={collection.arabicName}
                  icon="hadith"
                  onPress={() => setCollectionId(collection.id)}
                  accessibilityLabel={`${collection.name}, compiled by ${collection.compiler}`}
                  testID={`faith-hadith-collection-${collection.id}`}
                />
              ))}
            </FaithRowGroup>
          )}
        </FaithResourceView>

        {collectionId === null ? (
          <ModuleCard testID="faith-hadith-prompt">
            <ModuleText token="body" numberOfLines={2}>
              Choose a collection above to read its narrations.
            </ModuleText>
          </ModuleCard>
        ) : (
          <FaithResourceView
            resource={narrations}
            empty={{
              title: 'No narrations yet',
              body: 'Sample content covers a few narrations from each collection.',
            }}
            loadingRows={3}
            testID="faith-hadith-narrations"
          >
            {(page) => (
              <View style={{ rowGap: dp(moduleLayout.cardGap) }}>
                {page.items.map((item) => (
                  <HadithCard key={item.id} hadith={item} />
                ))}
              </View>
            )}
          </FaithResourceView>
        )}
      </View>
    </FaithScreen>
  );
}

const GRADE_LABEL: Readonly<Record<HadithGrade, string>> = {
  sahih: 'Sahih (sound)',
  hasan: 'Hasan (good)',
  daif: 'Da’if (weak)',
  mawdu: 'Mawdu’ (fabricated)',
  unknown: 'Grade not established',
};

/** Weak and fabricated narrations are marked in the warning tone, not the module green. */
function gradeColor(grade: HadithGrade): string {
  switch (grade) {
    case 'sahih':
    case 'hasan':
      return moduleNeutrals.success;
    case 'daif':
      return moduleNeutrals.warning;
    case 'mawdu':
      return moduleNeutrals.error;
    case 'unknown':
      return moduleNeutrals.textSecondary;
  }
}

function HadithCard({ hadith }: { readonly hadith: Hadith }) {
  const { dp } = useModuleMetrics();

  return (
    <ModuleCard testID={`faith-hadith-${hadith.id}`}>
      <View style={{ rowGap: dp(6) }}>
        <ModuleText token="caption" numberOfLines={1}>
          {hadith.reference}
        </ModuleText>
        <ModuleText token="body" numberOfLines={8}>
          {hadith.translation}
        </ModuleText>
        <ModuleText token="caption" numberOfLines={1}>
          {`Narrated by ${hadith.narrator}`}
        </ModuleText>
        <ModuleText
          token="caption"
          color={gradeColor(hadith.grade)}
          numberOfLines={1}
          accessibilityLabel={`Authentication: ${GRADE_LABEL[hadith.grade]}`}
        >
          {GRADE_LABEL[hadith.grade]}
        </ModuleText>
      </View>
    </ModuleCard>
  );
}
