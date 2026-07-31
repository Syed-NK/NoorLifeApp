import { useCallback } from 'react';
import { View } from 'react-native';

import { AppIcon, PressableScale } from '@ds/components';
import { ModuleText } from '@features/modules/components';
import { ModuleCard } from '@features/modules/components/module-card';
import { useModuleTheme } from '@features/modules/module-context';
import { moduleLayout, moduleNeutrals } from '@features/modules/module-tokens';
import { useModuleMetrics } from '@features/modules/use-module-metrics';

import { ArabicText } from '../components/faith-list';
import { FaithResourceView, FaithScreen } from '../components/faith-screen';
import { SourceBadge } from '../components/faith-states';
import { useFaithRepositories } from '../di/faith-repository-context';
import { faithNavKeys } from '../faith-routes';
import { useBookmark } from '../hooks/use-bookmark';
import { useFaithPreferences } from '../hooks/use-faith-preferences';
import { useFaithResource } from '../hooks/use-faith-resource';

/**
 * The Daily Ayah, full-screen.
 *
 * Reached from the home screen's Daily Ayah card. The verse and its translation are
 * separated by a rule and a label, so no reading of the layout could mistake the English
 * for the Arabic — which is the whole reason the two are separate fields upstream.
 */
export function DailyAyahScreen() {
  const { dp } = useModuleMetrics();
  const { quran } = useFaithRepositories();
  const { preferences } = useFaithPreferences();

  const ayah = useFaithResource(
    `faith.daily-ayah.${preferences.translationId}`,
    useCallback(
      () => quran.getAyahOfTheDay(preferences.translationId),
      [quran, preferences.translationId],
    ),
  );

  return (
    <FaithScreen title="Daily Ayah" activeKey={faithNavKeys.quran} testID="faith-daily-ayah">
      <View style={{ rowGap: dp(moduleLayout.sectionGap) }}>
        <FaithResourceView
          resource={ayah}
          empty={{ title: 'No verse today', body: 'The daily verse could not be loaded.' }}
          loadingRows={2}
          testID="faith-daily-ayah-body"
        >
          {(value) => (
            <View style={{ rowGap: dp(moduleLayout.cardGap) }}>
              <AyahDetail
                reference={`Surah ${value.text.surah}:${value.text.ayah}`}
                arabic={value.text.arabic}
                translation={value.translation.text}
              />
              <SourceBadge source={value.text.source} testID="faith-daily-ayah" />
            </View>
          )}
        </FaithResourceView>
      </View>
    </FaithScreen>
  );
}

function AyahDetail({
  reference,
  arabic,
  translation,
}: {
  readonly reference: string;
  readonly arabic: string;
  readonly translation: string;
}) {
  const theme = useModuleTheme();
  const { dp } = useModuleMetrics();
  const { bookmarked, toggle } = useBookmark({
    kind: 'ayah',
    id: reference,
    label: reference,
    subtitle: translation,
  });

  return (
    <ModuleCard testID="faith-daily-ayah-card">
      <View style={{ rowGap: dp(12) }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', columnGap: dp(8) }}>
          <ModuleText token="caption" numberOfLines={1} style={{ flex: 1 }}>
            {reference}
          </ModuleText>
          <PressableScale
            onPress={() => void toggle()}
            accessibilityRole="button"
            accessibilityLabel={bookmarked ? 'Remove bookmark' : 'Bookmark this verse'}
            accessibilityState={{ selected: bookmarked }}
            style={{
              minWidth: dp(moduleLayout.minTouchTarget),
              minHeight: dp(moduleLayout.minTouchTarget),
              alignItems: 'flex-end',
              justifyContent: 'center',
            }}
            testID="faith-daily-ayah-bookmark"
          >
            <AppIcon
              name="bookmark"
              size={dp(20)}
              color={bookmarked ? theme.ink : moduleNeutrals.textSecondary}
            />
          </PressableScale>
        </View>

        <ArabicText size="display" testID="faith-daily-ayah-arabic">
          {arabic}
        </ArabicText>

        <View style={{ height: 1, backgroundColor: moduleNeutrals.divider }} accessible={false} />

        <View>
          <ModuleText token="caption" numberOfLines={1}>
            Translation
          </ModuleText>
          <ModuleText token="body" numberOfLines={6}>
            {translation}
          </ModuleText>
        </View>
      </View>
    </ModuleCard>
  );
}
