import { useCallback, useState } from 'react';
import { Switch, View } from 'react-native';

import { AppIcon } from '@ds/components';
import { ModuleStatusBanner } from '@features/modules/components';
import { useModuleTheme } from '@features/modules/module-context';
import { moduleLayout } from '@features/modules/module-tokens';
import { useModuleMetrics } from '@features/modules/use-module-metrics';

import { FaithRow, FaithRowGroup } from '../components/faith-list';
import { FaithResourceView, FaithScreen, FaithSuccessBanner } from '../components/faith-screen';
import { hasData, type FaithResult } from '../data/faith-result';
import type { CalculationMethod } from '../data/prayer-times.repository';
import type { ReciterEdition, TranslationEdition } from '../data/quran-content.repository';

import { useFaithRepositories } from '../di/faith-repository-context';
import { faithNavKeys } from '../faith-routes';
import { useFaithPreferences } from '../hooks/use-faith-preferences';
import { useFaithResource } from '../hooks/use-faith-resource';

/** The two edition lists the preferences screen renders together. */
type EditionSets = {
  readonly translations: readonly TranslationEdition[];
  readonly reciters: readonly ReciterEdition[];
};

const METHODS: readonly { readonly id: CalculationMethod; readonly label: string }[] = [
  { id: 'muslim-world-league', label: 'Muslim World League' },
  { id: 'umm-al-qura', label: 'Umm al-Qura' },
  { id: 'egyptian', label: 'Egyptian General Authority' },
  { id: 'karachi', label: 'University of Karachi' },
  { id: 'isna', label: 'ISNA' },
  { id: 'moonsighting-committee', label: 'Moonsighting Committee' },
];

/**
 * Translation, reciter and calculation preferences.
 *
 * Every choice here persists immediately and is read by the reader, the Daily Ayah, the
 * search screen and the prayer times — so this is where the phase's "selected translation
 * and reciter preferences" requirement is actually satisfied end to end, not just stored.
 */
export function PreferencesScreen() {
  return (
    <FaithScreen title="Faith preferences" activeKey={faithNavKeys.more} testID="faith-preferences">
      <PreferencesBody />
    </FaithScreen>
  );
}

/** Split out so it renders inside the scaffold's `ModuleProvider`. */
function PreferencesBody() {
  const theme = useModuleTheme();
  const { dp } = useModuleMetrics();
  const { quran } = useFaithRepositories();
  const { preferences, update } = useFaithPreferences();
  const [saved, setSaved] = useState<string | null>(null);

  const editions = useFaithResource(
    'faith.editions',
    useCallback(async (): Promise<FaithResult<EditionSets>> => {
      const [translations, reciters] = await Promise.all([
        quran.availableTranslations(),
        quran.availableReciters(),
      ]);
      if (!hasData(translations)) {
        return translations;
      }
      return {
        kind: 'ok' as const,
        data: {
          translations: translations.data,
          reciters: reciters.kind === 'ok' ? reciters.data : [],
        },
      };
    }, [quran]),
  );

  const save = async (patch: Parameters<typeof update>[0], message: string) => {
    await update(patch);
    setSaved(message);
  };

  return (
    <View style={{ rowGap: dp(moduleLayout.sectionGap) }}>
      {saved === null ? null : (
        <FaithSuccessBanner
          message={saved}
          onDismiss={() => setSaved(null)}
          testID="faith-preferences"
        />
      )}

      <ModuleStatusBanner
        tone="info"
        message="Sample editions only. Licensed translations and reciters arrive with approved Quran Foundation access."
        testID="faith-preferences-banner"
      />

      <FaithResourceView
        resource={editions}
        empty={{ title: 'No editions', body: 'Editions could not be loaded.' }}
        loadingRows={3}
        testID="faith-preferences-editions"
      >
        {(value) => (
          <View style={{ rowGap: dp(moduleLayout.cardGap) }}>
            <FaithRowGroup title="Translation" testID="faith-preferences-translations">
              {value.translations.map((edition) => (
                <FaithRow
                  key={edition.id}
                  title={edition.name}
                  subtitle={`${edition.language} • ${edition.translator}`}
                  onPress={() =>
                    void save({ translationId: edition.id }, `Translation set to ${edition.name}.`)
                  }
                  trailing={
                    preferences.translationId === edition.id ? (
                      <AppIcon name="check-circle" size={dp(20)} color={theme.ink} />
                    ) : undefined
                  }
                  accessibilityLabel={`${edition.name} by ${edition.translator}${preferences.translationId === edition.id ? ', selected' : ''}`}
                  testID={`faith-preference-translation-${edition.id}`}
                />
              ))}
            </FaithRowGroup>

            {value.reciters.length === 0 ? null : (
              <FaithRowGroup title="Reciter" testID="faith-preferences-reciters">
                {value.reciters.map((reciter) => (
                  <FaithRow
                    key={reciter.id}
                    title={reciter.name}
                    subtitle={reciter.style}
                    onPress={() =>
                      void save({ reciterId: reciter.id }, `Reciter set to ${reciter.name}.`)
                    }
                    trailing={
                      preferences.reciterId === reciter.id ? (
                        <AppIcon name="check-circle" size={dp(20)} color={theme.ink} />
                      ) : undefined
                    }
                    accessibilityLabel={`${reciter.name}${preferences.reciterId === reciter.id ? ', selected' : ''}`}
                    testID={`faith-preference-reciter-${reciter.id}`}
                  />
                ))}
              </FaithRowGroup>
            )}
          </View>
        )}
      </FaithResourceView>

      <FaithRowGroup title="Prayer calculation" testID="faith-preferences-methods">
        {METHODS.map((method) => (
          <FaithRow
            key={method.id}
            title={method.label}
            onPress={() =>
              void save(
                { calculationMethod: method.id },
                `Calculation method set to ${method.label}.`,
              )
            }
            trailing={
              preferences.calculationMethod === method.id ? (
                <AppIcon name="check-circle" size={dp(20)} color={theme.ink} />
              ) : undefined
            }
            accessibilityLabel={`${method.label}${preferences.calculationMethod === method.id ? ', selected' : ''}`}
            testID={`faith-preference-method-${method.id}`}
          />
        ))}
      </FaithRowGroup>

      <FaithRowGroup title="Reading" testID="faith-preferences-reading">
        {[
          <FaithRow
            key="asr"
            title="Hanafi Asr timing"
            subtitle="Uses the later shadow-length convention"
            trailing={
              <Switch
                value={preferences.asrMethod === 'hanafi'}
                onValueChange={(value) =>
                  void save({ asrMethod: value ? 'hanafi' : 'standard' }, 'Asr convention updated.')
                }
                accessibilityLabel="Hanafi Asr timing"
                testID="faith-preference-asr"
              />
            }
            testID="faith-preference-asr-row"
          />,
          <FaithRow
            key="transliteration"
            title="Show transliteration"
            subtitle="Adds a romanised reading aid beneath duas"
            trailing={
              <Switch
                value={preferences.showTransliteration}
                onValueChange={(value) =>
                  void save({ showTransliteration: value }, 'Transliteration preference saved.')
                }
                accessibilityLabel="Show transliteration"
                testID="faith-preference-transliteration"
              />
            }
            testID="faith-preference-transliteration-row"
          />,
        ]}
      </FaithRowGroup>
    </View>
  );
}
