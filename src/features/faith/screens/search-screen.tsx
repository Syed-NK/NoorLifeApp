import { useCallback, useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import { AppIcon, PressableScale } from '@ds/components';
import { ModuleText } from '@features/modules/components';
import { fontFamilies } from '@ds/tokens';
import { useModuleTheme } from '@features/modules/module-context';
import { moduleLayout, moduleNeutrals } from '@features/modules/module-tokens';
import { useModuleMetrics } from '@features/modules/use-module-metrics';

import { FaithRow, FaithRowGroup } from '../components/faith-list';
import { FaithResourceView, FaithScreen } from '../components/faith-screen';
import { useFaithRepositories } from '../di/faith-repository-context';
import { faithNavKeys } from '../faith-routes';
import { useFaithPreferences } from '../hooks/use-faith-preferences';
import { useFaithResource } from '../hooks/use-faith-resource';

type SearchHits = {
  readonly ayat: readonly { readonly id: string; readonly title: string; readonly body: string }[];
  readonly hadith: readonly {
    readonly id: string;
    readonly title: string;
    readonly body: string;
  }[];
  readonly duas: readonly { readonly id: string; readonly title: string; readonly body: string }[];
};

/**
 * Search across Qur'an translations, Hadith and duas.
 *
 * ── Why the query is committed rather than live ─────────────────────────────
 * The input holds a draft and a submit commits it. Searching on every keystroke would
 * fire a request per character, and — more importantly here — would flicker the
 * no-results state on the way to a valid query, which reads as "nothing found" for a term
 * that was only half typed.
 *
 * Arabic is not searched: the fixtures carry too little of it for the results to mean
 * anything, and a search that silently only covered translations while appearing to
 * cover scripture would be misleading. The caption says what is searched.
 */
export function SearchScreen() {
  return (
    <FaithScreen title="Search" activeKey={faithNavKeys.quran} testID="faith-search">
      <SearchBody />
    </FaithScreen>
  );
}

/**
 * Split out so it renders *inside* the scaffold's `ModuleProvider`.
 *
 * `useModuleTheme` is only available below the provider, and a single component cannot
 * both mount a context and consume it — the same split `ModuleAIScreen` makes.
 */
function SearchBody() {
  const theme = useModuleTheme();
  const { dp } = useModuleMetrics();
  const { quran, hadith, dua } = useFaithRepositories();
  const { preferences } = useFaithPreferences();

  const [draft, setDraft] = useState('');
  const [query, setQuery] = useState('');

  const results = useFaithResource(
    `faith.search.${query}`,
    useCallback(async () => {
      const trimmed = query.trim();
      if (trimmed.length < 2) {
        return { kind: 'no-results' as const, query: trimmed };
      }

      const [ayat, narrations, supplications] = await Promise.all([
        quran.searchTranslations(trimmed, preferences.translationId),
        hadith.search(trimmed),
        dua.search(trimmed),
      ]);

      const hits: SearchHits = {
        ayat:
          ayat.kind === 'ok'
            ? ayat.data.items.map((item) => ({
                id: `${item.surah}:${item.ayah}`,
                title: `Surah ${item.surah}, verse ${item.ayah}`,
                body: item.text,
              }))
            : [],
        hadith:
          narrations.kind === 'ok'
            ? narrations.data.items.map((item) => ({
                id: item.id,
                title: item.reference,
                body: item.translation,
              }))
            : [],
        duas:
          supplications.kind === 'ok'
            ? supplications.data.items.map((item) => ({
                id: item.id,
                title: item.title,
                body: item.translation,
              }))
            : [],
      };

      const total = hits.ayat.length + hits.hadith.length + hits.duas.length;
      if (total === 0) {
        return { kind: 'no-results' as const, query: trimmed };
      }
      return { kind: 'ok' as const, data: hits };
    }, [query, quran, hadith, dua, preferences.translationId]),
  );

  return (
    <View style={{ rowGap: dp(moduleLayout.sectionGap) }}>
      <View
        style={[
          styles.field,
          {
            borderRadius: dp(moduleLayout.radiusSmall),
            borderColor: theme.border,
            paddingHorizontal: dp(12),
            columnGap: dp(8),
            minHeight: dp(moduleLayout.minTouchTarget),
          },
        ]}
      >
        <AppIcon name="search" size={dp(18)} color={theme.ink} />
        <TextInput
          value={draft}
          onChangeText={setDraft}
          onSubmitEditing={() => setQuery(draft)}
          placeholder="Search translations, narrations and duas"
          placeholderTextColor={moduleNeutrals.textSecondary}
          returnKeyType="search"
          accessibilityLabel="Search Faith content"
          accessibilityHint="Enter at least two characters, then search."
          style={[styles.input, { fontSize: dp(13), color: moduleNeutrals.textPrimary }]}
          testID="faith-search-input"
        />
        {/*
          A visible submit control, not only the keyboard's return key.

          The return key is undiscoverable — nothing on screen says the field needs
          submitting — and it is unreachable entirely for anyone driving the app with a
          switch or a screen reader that does not surface it.
        */}
        <PressableScale
          onPress={() => setQuery(draft)}
          accessibilityRole="button"
          accessibilityLabel="Search"
          style={[
            styles.submit,
            {
              minWidth: dp(moduleLayout.minTouchTarget),
              minHeight: dp(moduleLayout.minTouchTarget),
            },
          ]}
          testID="faith-search-submit"
        >
          <ModuleText token="cardAction" color={theme.ink} numberOfLines={1}>
            Search
          </ModuleText>
        </PressableScale>
      </View>

      <ModuleText token="caption" numberOfLines={2}>
        Searches English translations, not Arabic text.
      </ModuleText>

      <FaithResourceView
        resource={results}
        empty={{ title: 'Nothing to search', body: 'Enter a term above.' }}
        loadingRows={3}
        testID="faith-search-results"
      >
        {(hits) => (
          <View style={{ rowGap: dp(moduleLayout.cardGap) }}>
            {hits.ayat.length === 0 ? null : (
              <FaithRowGroup title="Qur’an" testID="faith-search-ayat">
                {hits.ayat.map((item) => (
                  <FaithRow
                    key={item.id}
                    title={item.title}
                    subtitle={item.body}
                    icon="quran"
                    testID={`faith-search-ayah-${item.id}`}
                  />
                ))}
              </FaithRowGroup>
            )}
            {hits.hadith.length === 0 ? null : (
              <FaithRowGroup title="Hadith" testID="faith-search-hadith">
                {hits.hadith.map((item) => (
                  <FaithRow
                    key={item.id}
                    title={item.title}
                    subtitle={item.body}
                    icon="hadith"
                    testID={`faith-search-hadith-${item.id}`}
                  />
                ))}
              </FaithRowGroup>
            )}
            {hits.duas.length === 0 ? null : (
              <FaithRowGroup title="Duas" testID="faith-search-duas">
                {hits.duas.map((item) => (
                  <FaithRow
                    key={item.id}
                    title={item.title}
                    subtitle={item.body}
                    icon="worship"
                    testID={`faith-search-dua-${item.id}`}
                  />
                ))}
              </FaithRowGroup>
            )}
          </View>
        )}
      </FaithResourceView>
    </View>
  );
}

const styles = StyleSheet.create({
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    backgroundColor: moduleNeutrals.surface,
  },
  input: {
    flex: 1,
    minWidth: 0,
    fontFamily: fontFamilies.regular,
    paddingVertical: 8,
  },
  submit: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
