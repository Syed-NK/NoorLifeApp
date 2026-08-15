import { useCallback, useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import { AppIcon, PressableScale } from '@ds/components';
import { ModuleStatusBanner, ModuleText } from '@features/modules/components';
import { fontFamilies } from '@ds/tokens';
import { useModuleTheme } from '@features/modules/module-context';
import { moduleLayout, moduleNeutrals } from '@features/modules/module-tokens';
import { useModuleMetrics } from '@features/modules/use-module-metrics';

import { FaithRow, FaithRowGroup } from '../components/faith-list';
import { FaithResourceView, FaithScreen } from '../components/faith-screen';
import { FaithNoResultsState } from '../components/faith-states';
import type { FaithResult } from '../data/faith-result';
import { useFaithRepositories } from '../di/faith-repository-context';
import { faithNavKeys } from '../faith-routes';
import { useTranslationPreference } from '../hooks/use-translation-preference';
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
 * What one search produced, and whether part of it could not run.
 *
 * The flag travels with the results rather than being derived at render time, because "can this build
 * search the Qur'an?" is a property of the repository that is wired in, and asking it is what running
 * the search does.
 */
type SearchOutcome = {
  readonly hits: SearchHits;
  readonly total: number;
  /**
   * Which strands actually ran, asked of the repositories rather than assumed.
   *
   * ── The claim this replaced ─────────────────────────────────────────────────
   * The screen used to say "these results cover narrations and duas only" whenever Qur'an search was
   * unsupported. That sentence was false in this build: Hadith and Dua have **no configured
   * provider** — `unconfigured-content.repository.ts` answers `not-configured` for both — so search
   * covered nothing at all, while telling the user it covered two things.
   *
   * The flags are derived from each repository's own answer, so the copy can only ever name a strand
   * that was genuinely searched. When a provider is wired in, the sentence starts including it
   * without anybody editing a string.
   */
  readonly searched: SearchedStrands;
};

type SearchedStrands = {
  readonly quran: boolean;
  readonly hadith: boolean;
  readonly duas: boolean;
};

/** Whether a repository answered as a working provider rather than as an absent one. */
function strandRan(result: { readonly kind: string; readonly code?: string }): boolean {
  /*
    `not-configured` and `unsupported` both mean "this source cannot answer". A transient failure is
    deliberately counted as *ran*: the strand exists and was consulted, and reporting it as absent
    would turn a bad connection into a permanent statement about the product.
  */
  return !(
    result.kind === 'error' &&
    (result.code === 'not-configured' || result.code === 'unsupported')
  );
}

/** The one sentence describing coverage, composed from what actually ran. */
export function searchCoverageMessage(searched: SearchedStrands): string | null {
  const covered = [
    searched.quran ? 'Qur’an translations' : null,
    searched.hadith ? 'narrations' : null,
    searched.duas ? 'duas' : null,
  ].filter((item): item is string => item !== null);

  if (covered.length === 3) {
    /* Everything is wired. There is nothing to warn about, so nothing is said. */
    return null;
  }
  if (covered.length === 0) {
    return 'Search is not available yet. No content source in this build can be searched.';
  }
  const list =
    covered.length === 1
      ? covered[0]
      : `${covered.slice(0, -1).join(', ')} and ${covered[covered.length - 1]}`;
  return `Search covers ${list} only. The other sources are not available in this build yet.`;
}

/**
 * Search across Qur'an translations, Hadith and duas.
 *
 * ── Why the query is committed rather than live ─────────────────────────────
 * The input holds a draft and a submit commits it. Searching on every keystroke would
 * fire a request per character, and — more importantly here — would flicker the
 * no-results state on the way to a valid query, which reads as "nothing found" for a term
 * that was only half typed.
 *
 * ── The screen names only the sources it actually searched ──────────────────
 * Quran Foundation's approval covers the **Content** APIs; their Search APIs are a separate scope
 * NoorLife does not have, so the approved repository reports search as unsupported. Hadith and Dua
 * have no configured provider at all and answer `not-configured`.
 *
 * The banner used to be a fixed sentence — "these results cover narrations and duas only" — written
 * when those two were fixtures that really did return rows. They are not fixtures any more, and the
 * sentence had quietly become false in the worst direction: it told a user two sources had been
 * searched when nothing had been. `searchCoverageMessage` composes the sentence from each
 * repository's own answer, so it can only ever name a strand that ran, and it says nothing at all
 * once every strand does.
 *
 * Arabic is not searched even where search works: a search that silently only covered translations
 * while appearing to cover scripture would be misleading. The caption says what is searched.
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
  const { translation } = useTranslationPreference();

  const [draft, setDraft] = useState('');
  const [query, setQuery] = useState('');

  const results = useFaithResource(
    `faith.search.${query}`,
    useCallback(async (): Promise<FaithResult<SearchOutcome>> => {
      const trimmed = query.trim();
      if (trimmed.length < 2) {
        return { kind: 'no-results' as const, query: trimmed };
      }

      const [ayat, narrations, supplications] = await Promise.all([
        /*
          Searching translations needs an edition to search in. With none resolved the Qur'an strand
          is skipped and the other two still run, so search degrades rather than failing.
        */
        translation === null
          ? Promise.resolve({ kind: 'no-results' as const, query: trimmed })
          : quran.searchTranslations(trimmed, translation.id),
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
      /**
       * An empty result is returned as `ok` rather than as `no-results` so the notice above it
       * survives. The no-results *presentation* is still rendered — by the screen, from the same
       * component the framework would have used — because "nothing matched" and "we could not search
       * part of this" are two facts a user needs at once, and the result union carries one at a time.
       */
      const searched: SearchedStrands = {
        /* A skipped Qur'an strand — no edition resolved — has not been searched either. */
        quran: translation !== null && strandRan(ayat),
        hadith: strandRan(narrations),
        duas: strandRan(supplications),
      };

      return { kind: 'ok' as const, data: { hits, total, searched } };
    }, [query, quran, hadith, dua, translation]),
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
        {({ hits, total, searched }) => (
          <View style={{ rowGap: dp(moduleLayout.cardGap) }}>
            {/*
              One banner, naming only what was actually searched. It replaces a fixed sentence that
              claimed coverage of narrations and duas while both providers were unconfigured — see
              `SearchOutcome.searched`. `null` when everything ran, so a fully wired build carries no
              notice at all.
            */}
            {searchCoverageMessage(searched) === null ? null : (
              <ModuleStatusBanner
                tone="info"
                message={searchCoverageMessage(searched) ?? ''}
                testID="faith-search-quran-unsupported"
              />
            )}
            {total === 0 ? (
              <FaithNoResultsState query={query} testID="faith-search-results" />
            ) : null}
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
