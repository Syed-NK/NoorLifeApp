import { useRouter } from 'expo-router';
import { useCallback } from 'react';
import { View } from 'react-native';

import { ModuleText } from '@features/modules/components';
import { ModuleCard } from '@features/modules/components/module-card';
import { ModuleProgressBar } from '@features/modules/components/module-chart';
import { moduleLayout } from '@features/modules/module-tokens';
import { useModuleMetrics } from '@features/modules/use-module-metrics';

import { FaithIdentity } from '../components/faith-identity';
import { FaithResourceView, FaithScreen } from '../components/faith-screen';
import { FaithRow, FaithRowGroup } from '../components/faith-list';
import { SourceBadge } from '../components/faith-states';
import { MOCK_SOURCE } from '../data/mock/mock-support';
import { useFaithRepositories } from '../di/faith-repository-context';
import { faithNavKeys, faithRoutes } from '../faith-routes';
import { useContinueReading } from '../hooks/use-continue-reading';
import { useFaithResource } from '../hooks/use-faith-resource';

/**
 * The Qur'an screen — the `quran` bottom-navigation slot.
 *
 * Lists every surah, resumes where the user stopped, and offers search and bookmarks.
 * The surah catalogue is complete; verse text exists only for the fixture surahs until
 * Quran Foundation access is approved, which the source badge states on the screen.
 */
export function QuranScreen() {
  const router = useRouter();
  const { dp } = useModuleMetrics();
  const { quran } = useFaithRepositories();
  const { position, resumeLabel } = useContinueReading();

  const surahs = useFaithResource(
    'quran.surahs',
    useCallback(() => quran.listSurahs(), [quran]),
  );

  return (
    <FaithScreen title="Qur’an" activeKey={faithNavKeys.quran} testID="faith-quran">
      <View style={{ rowGap: dp(moduleLayout.sectionGap) }}>
        <FaithIdentity submenu="quran" summary="Read, search and resume where you stopped." />
        <SourceBadge source={MOCK_SOURCE} testID="faith-quran" />

        {position === null ? null : (
          <ModuleCard
            onPress={() => router.push(faithRoutes.reader)}
            accessibilityLabel={`Continue reading, ${resumeLabel}`}
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
          </ModuleCard>
        )}

        <FaithRowGroup testID="faith-quran-actions">
          {[
            <FaithRow
              key="search"
              title="Search the Qur’an"
              subtitle="Find a verse by its translation"
              icon="search"
              onPress={() => router.push(faithRoutes.search)}
              testID="faith-quran-search"
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
          {(list) => (
            <FaithRowGroup title="All surahs" testID="faith-quran-surahs">
              {list.map((surah) => (
                <FaithRow
                  key={surah.number}
                  title={`${surah.number}. ${surah.name}`}
                  subtitle={`${surah.meaning} • ${surah.ayahCount} ayat • ${surah.revelation === 'meccan' ? 'Meccan' : 'Medinan'}`}
                  arabic={surah.arabicName}
                  onPress={() => router.push(faithRoutes.reader)}
                  accessibilityLabel={`Surah ${surah.number}, ${surah.name}, ${surah.meaning}, ${surah.ayahCount} ayat`}
                  testID={`faith-quran-surah-${surah.number}`}
                />
              ))}
            </FaithRowGroup>
          )}
        </FaithResourceView>
      </View>
    </FaithScreen>
  );
}
