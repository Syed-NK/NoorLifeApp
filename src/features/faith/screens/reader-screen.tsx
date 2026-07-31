import { useCallback, useState } from 'react';
import { View } from 'react-native';

import { AppIcon, PressableScale } from '@ds/components';
import { ModuleText } from '@features/modules/components';
import { ModuleCard } from '@features/modules/components/module-card';
import { moduleLayout, moduleNeutrals } from '@features/modules/module-tokens';
import { useModuleTheme } from '@features/modules/module-context';
import { useModuleMetrics } from '@features/modules/use-module-metrics';
import { minimumHitSlop } from '@shared/utils/a11y';

import { ArabicText } from '../components/faith-list';
import { FaithResourceView, FaithScreen, FaithSuccessBanner } from '../components/faith-screen';
import { SourceBadge } from '../components/faith-states';
import { hasData, type FaithResult } from '../data/faith-result';
import type { AyahText, AyahTranslation } from '../data/quran-content.repository';
import { useFaithRepositories } from '../di/faith-repository-context';
import { faithNavKeys } from '../faith-routes';
import { useBookmark } from '../hooks/use-bookmark';
import { useContinueReading } from '../hooks/use-continue-reading';
import { useFaithPreferences } from '../hooks/use-faith-preferences';
import { useFaithResource } from '../hooks/use-faith-resource';

/**
 * One verse as the reader renders it: the scripture, and its translation if one loaded.
 *
 * `translation` is nullable rather than defaulted to an empty string, so a missing
 * translation renders nothing instead of an empty paragraph the user might read as the
 * verse having no meaning.
 */
type ReaderVerse = {
  readonly text: AyahText;
  readonly translation: AyahTranslation | null;
};

/**
 * The reader — "Continue Quran" opens here.
 *
 * Shows the stored surah's ayat with the chosen translation, lets each verse be
 * bookmarked, and writes the reading position back as the user moves. Arabic and its
 * translation are visually and structurally separate, so a translation can never be
 * mistaken for the verse.
 */
export function ReaderScreen() {
  const { dp } = useModuleMetrics();
  const { quran } = useFaithRepositories();
  const { preferences } = useFaithPreferences();
  const { position, save } = useContinueReading();
  const [saved, setSaved] = useState(false);

  const surah = position?.surah ?? null;
  const translationId = preferences.translationId;

  const ayat = useFaithResource(
    `quran.reader.${surah ?? 'none'}.${translationId}`,
    useCallback(async (): Promise<FaithResult<readonly ReaderVerse[]>> => {
      if (surah === null) {
        return { kind: 'empty' };
      }
      const [text, translated] = await Promise.all([
        quran.listAyahs(surah),
        quran.listTranslations(surah, translationId),
      ]);
      if (!hasData(text)) {
        return text;
      }
      const translations =
        translated.kind === 'ok' ? translated.data.items : ([] as readonly AyahTranslation[]);
      return {
        kind: 'ok' as const,
        data: text.data.items.map((item) => ({
          text: item,
          translation: translations.find((entry) => entry.ayah === item.ayah) ?? null,
        })),
      };
    }, [quran, surah, translationId]),
  );

  return (
    <FaithScreen title="Reader" activeKey={faithNavKeys.quran} testID="faith-reader">
      <View style={{ rowGap: dp(moduleLayout.sectionGap) }}>
        {saved ? (
          <FaithSuccessBanner
            message="Your place has been saved."
            onDismiss={() => setSaved(false)}
            testID="faith-reader"
          />
        ) : null}

        <FaithResourceView
          resource={ayat}
          empty={{
            title: 'No text for this surah yet',
            body:
              'Sample content covers only a few surahs. The full text arrives with approved ' +
              'Quran Foundation access.',
            actionLabel: 'Back to surahs',
          }}
          loadingRows={4}
          testID="faith-reader-body"
        >
          {(items) => (
            <View style={{ rowGap: dp(moduleLayout.cardGap) }}>
              <SourceBadge
                source={items[0]?.text.source ?? { name: 'Unknown', verified: false }}
                testID="faith-reader"
              />
              {items.map((item) => (
                <AyahCard
                  key={`${item.text.surah}:${item.text.ayah}`}
                  text={item.text}
                  translation={item.translation}
                  onRead={() => {
                    void save(item.text.surah, item.text.ayah, 0.55);
                    setSaved(true);
                  }}
                />
              ))}
            </View>
          )}
        </FaithResourceView>
      </View>
    </FaithScreen>
  );
}

function AyahCard({
  text,
  translation,
  onRead,
}: {
  readonly text: AyahText;
  readonly translation: AyahTranslation | null;
  readonly onRead: () => void;
}) {
  const theme = useModuleTheme();
  const { dp } = useModuleMetrics();
  const id = `${text.surah}:${text.ayah}`;
  const { bookmarked, toggle } = useBookmark({
    kind: 'ayah',
    id,
    label: `Surah ${text.surah}, verse ${text.ayah}`,
    subtitle: translation?.text ?? '',
  });

  // The position is written on a deliberate tap rather than on render: an effect here
  // would fire for every card on screen and the last one mounted would win.
  return (
    <ModuleCard testID={`faith-reader-ayah-${text.surah}-${text.ayah}`}>
      <View style={{ rowGap: dp(8) }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <ModuleText token="caption" numberOfLines={1} style={{ flex: 1 }}>
            {`Verse ${text.ayah}`}
          </ModuleText>
          <PressableScale
            onPress={() => void toggle()}
            accessibilityRole="button"
            accessibilityLabel={
              bookmarked ? `Remove bookmark on verse ${text.ayah}` : `Bookmark verse ${text.ayah}`
            }
            accessibilityState={{ selected: bookmarked }}
            hitSlop={minimumHitSlop(dp(20))}
            testID={`faith-reader-bookmark-${text.surah}-${text.ayah}`}
          >
            <AppIcon
              name="bookmark"
              size={dp(18)}
              color={bookmarked ? theme.ink : moduleNeutrals.textSecondary}
            />
          </PressableScale>
        </View>

        <ArabicText size="display" testID={`faith-reader-arabic-${text.surah}-${text.ayah}`}>
          {text.arabic}
        </ArabicText>

        {translation === null ? null : (
          <ModuleText token="body" numberOfLines={6}>
            {translation.text}
          </ModuleText>
        )}

        <PressableScale
          onPress={onRead}
          accessibilityRole="button"
          accessibilityLabel={`Save my place at verse ${text.ayah}`}
          style={{
            alignSelf: 'flex-start',
            minHeight: dp(moduleLayout.minTouchTarget),
            justifyContent: 'center',
          }}
          testID={`faith-reader-save-${text.surah}-${text.ayah}`}
        >
          <ModuleText token="cardAction" color={theme.ink} numberOfLines={1}>
            Save my place here
          </ModuleText>
        </PressableScale>
      </View>
    </ModuleCard>
  );
}
