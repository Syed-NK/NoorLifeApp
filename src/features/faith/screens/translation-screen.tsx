import { useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';

import { FaithCatalogueList, type CatalogueRow } from '../components/faith-catalogue-list';
import { FaithResourceView, FaithScreen } from '../components/faith-screen';
import type { TranslationEdition } from '../data/quran-content.repository';
import { useFaithRepositories } from '../di/faith-repository-context';
import { faithNavKeys } from '../faith-routes';
import { useFaithResource } from '../hooks/use-faith-resource';
import { useTranslationPreference } from '../hooks/use-translation-preference';

/**
 * "Choose translation" — one catalogue, filtered, searchable, and English-first.
 *
 * ── What this replaces ──────────────────────────────────────────────────────
 * A single preferences screen that rendered every translation edition **and** every reciter in two
 * unfiltered runs. The vendor's translation catalogue spans every language it publishes, so the list
 * was hundreds of rows deep with no way to narrow it — and the practical result was a user whose
 * selected edition was Bosnian with no idea how it got there or how to change it.
 *
 * Three things fix that, and all three are requirements rather than polish: the catalogue is split
 * from the reciters, it opens filtered to English, and it is searchable by the three fields somebody
 * would actually search by.
 */

/**
 * The language chips, in the order the brief specifies.
 *
 * ── Why the list is fixed rather than generated from the catalogue ──────────
 * Generating it "where practical" was considered and rejected for the chip row specifically: the
 * vendor publishes editions in more than forty languages, and a chip row with forty entries is the
 * same unnavigable wall the screen is being rebuilt to remove. These six cover the languages
 * NoorLife's users read in, and **`Other` and `All` are computed against the catalogue** — so an
 * edition in a language with no chip is always still reachable, which is the property that actually
 * matters.
 */
const NAMED_LANGUAGES: readonly string[] = ['english', 'arabic', 'urdu', 'bengali', 'russian'];

const LANGUAGE_FILTERS = [
  { id: 'english', label: 'English' },
  { id: 'arabic', label: 'Arabic' },
  { id: 'urdu', label: 'Urdu' },
  { id: 'bengali', label: 'Bengali' },
  { id: 'russian', label: 'Russian' },
  { id: 'other', label: 'Other' },
  { id: 'all', label: 'All' },
] as const;

/** The initial filter. English first and selected, per the brief. */
export const DEFAULT_LANGUAGE_FILTER = 'english';

function normalise(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Whether an edition belongs under a filter chip.
 *
 * `other` is defined as "not one of the named languages" rather than as a fixed list, so a language
 * the vendor adds tomorrow lands somewhere reachable instead of disappearing.
 */
export function matchesLanguageFilter(edition: TranslationEdition, filterId: string): boolean {
  const language = normalise(edition.language);
  if (filterId === 'all') {
    return true;
  }
  if (filterId === 'other') {
    return !NAMED_LANGUAGES.includes(language);
  }
  return language === filterId;
}

/** Case-insensitive match across the three fields a person would search by. */
export function matchesQuery(edition: TranslationEdition, query: string): boolean {
  const needle = normalise(query);
  if (needle.length === 0) {
    return true;
  }
  return (
    normalise(edition.name).includes(needle) ||
    normalise(edition.translator).includes(needle) ||
    normalise(edition.language).includes(needle)
  );
}

/**
 * Filter, then search, then order: selected first, then by name.
 *
 * The selected edition is pinned to the top so that opening the screen answers "what am I reading?"
 * without scrolling — which the previous screen could not do at all.
 */
export function orderEditions(
  editions: readonly TranslationEdition[],
  filterId: string,
  query: string,
  selectedId: string | null,
): readonly TranslationEdition[] {
  return editions
    .filter((edition) => matchesLanguageFilter(edition, filterId))
    .filter((edition) => matchesQuery(edition, query))
    .sort((a, b) => {
      if (a.id === selectedId) {
        return -1;
      }
      if (b.id === selectedId) {
        return 1;
      }
      return a.name.localeCompare(b.name);
    });
}

export function TranslationScreen() {
  return (
    <FaithScreen
      title="Choose translation"
      activeKey={faithNavKeys.more}
      scrollable={false}
      fills
      testID="faith-translations"
    >
      <TranslationBody />
    </FaithScreen>
  );
}

function TranslationBody() {
  const router = useRouter();
  const { quran } = useFaithRepositories();
  const { translation, choose } = useTranslationPreference();
  const [query, setQuery] = useState('');
  const [filterId, setFilterId] = useState<string>(DEFAULT_LANGUAGE_FILTER);

  const editions = useFaithResource(
    'faith.translations.catalogue',
    useCallback(() => quran.availableTranslations(), [quran]),
  );

  const selectedId = translation?.id ?? null;

  return (
    /*
      No source banner here, deliberately. The technical "Quran Foundation Content API" notice used
      to sit at the top of this screen; attribution belongs beside rendered content and in
      More → About this content, not above a list of editions.
    */
    <FaithResourceView
      resource={editions}
      empty={{
        title: 'No translations available',
        body: 'The translation catalogue could not be loaded. Check your connection and try again.',
        actionLabel: 'Try again',
      }}
      onEmptyAction={editions.reload}
      loadingRows={6}
      testID="faith-translations-body"
    >
      {(list) => (
        <CatalogueBody
          list={list}
          query={query}
          onQueryChange={setQuery}
          filterId={filterId}
          onFilterChange={setFilterId}
          selectedId={selectedId}
          onChoose={(edition) => {
            void (async () => {
              await choose({
                id: edition.id,
                language: edition.language,
                name: edition.name,
                translator: edition.translator,
              });
              /*
                Straight back to the settings screen. A confirmation banner on a screen the user is
                about to leave is a message nobody reads; the row they return to now shows the
                edition they picked, which is the confirmation.
              */
              router.back();
            })();
          }}
        />
      )}
    </FaithResourceView>
  );
}

/** Split out so `useMemo` is not called conditionally inside the resource branch. */
function CatalogueBody({
  list,
  query,
  onQueryChange,
  filterId,
  onFilterChange,
  selectedId,
  onChoose,
}: {
  readonly list: readonly TranslationEdition[];
  readonly query: string;
  readonly onQueryChange: (value: string) => void;
  readonly filterId: string;
  readonly onFilterChange: (id: string) => void;
  readonly selectedId: string | null;
  readonly onChoose: (edition: TranslationEdition) => void;
}) {
  const visible = useMemo(
    () => orderEditions(list, filterId, query, selectedId),
    [list, filterId, query, selectedId],
  );

  const rows: readonly CatalogueRow[] = useMemo(
    () =>
      visible.map((edition) => ({
        id: edition.id,
        title: edition.name,
        detail: `${edition.language} • ${edition.translator}`,
        accessibilityLabel: `${edition.name}, ${edition.language}, translated by ${edition.translator}${
          edition.id === selectedId ? ', selected' : ''
        }`,
      })),
    [visible, selectedId],
  );

  const byId = useMemo(() => new Map(list.map((edition) => [edition.id, edition])), [list]);

  return (
    <FaithCatalogueList
      rows={rows}
      selectedId={selectedId}
      onSelect={(id) => {
        const edition = byId.get(id);
        if (edition !== undefined) {
          onChoose(edition);
        }
      }}
      query={query}
      onQueryChange={onQueryChange}
      searchPlaceholder="Search translations"
      searchLabel="Search translations by name, translator or language"
      filters={LANGUAGE_FILTERS}
      activeFilterId={filterId}
      onFilterChange={onFilterChange}
      filterLabel="Filter translations by language"
      emptyMessage="No translations match that search. Try another word, or choose a different language."
      testID="faith-translations"
    />
  );
}
