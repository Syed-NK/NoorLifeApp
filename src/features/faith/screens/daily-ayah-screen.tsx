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
import { UnverifiedSourceNotice } from '../components/faith-states';
import type { ContentSource } from '../data/faith-result';
import { useFaithRepositories } from '../di/faith-repository-context';
import { faithNavKeys } from '../faith-routes';
import { useBookmark } from '../hooks/use-bookmark';
import { useTranslationPreference } from '../hooks/use-translation-preference';
import { useFaithResource } from '../hooks/use-faith-resource';
import { minimumTouchTargetSize } from '@shared/utils/a11y';

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
  const { translation } = useTranslationPreference();

  const ayah = useFaithResource(
    `faith.daily-ayah.${translation?.id ?? 'unresolved'}`,
    useCallback(
      /*
        No translation resolved yet means there is no edition to ask for. Reported as `loading`
        rather than requested with a guessed id — guessing one is what put an edition that returns
        nothing in front of every user.
      */
      async () =>
        translation === null
          ? ({ kind: 'error', code: 'unavailable' } as const)
          : await quran.getAyahOfTheDay(translation.id),
      [quran, translation],
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
                /*
                  The translation's own provenance, not the scripture's. They are separate
                  `ContentSource` objects for exactly this reason: the verse comes from the vendor,
                  and the rendering of its meaning comes from a named translator whose work this is.
                */
                translationSource={value.translation.source}
              />
              <UnverifiedSourceNotice source={value.text.source} testID="faith-daily-ayah" />
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
  translationSource,
}: {
  readonly reference: string;
  readonly arabic: string;
  readonly translation: string;
  readonly translationSource: ContentSource;
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
              minWidth: minimumTouchTargetSize(),
              minHeight: minimumTouchTargetSize(),
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
            {translationSource.edition ?? 'Translation'}
          </ModuleText>
          <ModuleText token="body" numberOfLines={6}>
            {translation}
          </ModuleText>
          {/*
            The translator, named beneath the words that are theirs. Absent rather than invented
            when the source did not carry one — the approved adapter requires it, so this degrades
            only under a fixture.
          */}
          {translationSource.attribution === undefined ? null : (
            <ModuleText
              token="caption"
              numberOfLines={2}
              style={{ marginTop: dp(4) }}
              testID="faith-daily-ayah-translator"
            >
              {`Translated by ${translationSource.attribution}`}
            </ModuleText>
          )}
        </View>
      </View>
    </ModuleCard>
  );
}
