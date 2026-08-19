import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import { AppIcon, PressableScale } from '@ds/components';
import { modulePalettes } from '@ds/tokens';
import { ModuleText } from '@features/modules/components';
import { ModuleCard } from '@features/modules/components/module-card';
import {
  moduleLayout,
  moduleNeutrals,
  readerDockColors,
  readerPageBackground,
} from '@features/modules/module-tokens';
import { useModuleMetrics } from '@features/modules/use-module-metrics';
import { minimumHitSlop } from '@shared/utils/a11y';

import { ArabicText } from '../components/faith-list';
import { FaithScreen } from '../components/faith-screen';
import { QuranSelectionView, SelectionOriginBadge } from '../components/quran-selection-view';
import { QURAN_CONTENT_ATTRIBUTION } from '../data/dhikr/quran-content-attribution';
import { referenceLabel } from '../data/dhikr/quran-dhikr-catalogue';
import type { ResolvedDhikr } from '../data/dhikr/quran-dhikr.repository';
import {
  dhikrCatalogue,
  DHIKR_CATEGORIES,
  lockMessage,
  matchesQuery,
  type DhikrCategoryId,
  type DhikrSection,
  type DhikrSectionState,
} from '../data/tasbih/dhikr-catalogue';
import {
  selectionReferenceLabel,
  type QuranSelection,
  type QuranSelectionRef,
} from '../data/quran-selection/quran-selection';
import type { SelectionResolution } from '../data/quran-selection/retained-selection.resolver';
import { DEFAULT_COUNTER, MAX_LABEL_LENGTH } from '../data/tasbih/local-tasbih.repository';
import { faithNavKeys, faithRoutes, readerHref } from '../faith-routes';
import { useQuranDhikr } from '../hooks/use-quran-dhikr';
import { useQuranSelections } from '../hooks/use-quran-selections';
import { useTasbih } from '../hooks/use-tasbih';

/**
 * **The Dhikr selector — reached from `Change` on the Tasbih screen.**
 *
 * ── What this screen is for, in this release ────────────────────────────────
 * Two things at once, and it has to be honest about both. It is the working home of **personal
 * counters** — private labels the user writes, chooses, renames and removes — and it is the
 * placeholder-free front for **verified dhikr that NoorLife cannot yet ship**.
 *
 * ── Why the shut sections are shown rather than hidden ──────────────────────
 * Hiding them would be the easier build and a worse screen. Five source-less dhikr presets once
 * shipped here and were removed; a selector that simply never mentions verified content implies
 * NoorLife has no intention of offering it, and the day permission lands the whole navigation
 * changes shape underneath people who had learned it. A section that is present and plainly shut
 * says what is actually true: the text exists, the request is outstanding, and nothing has been
 * copied in the meantime.
 *
 * ── The line this screen must never cross ───────────────────────────────────
 * A personal label is the user's own note to themselves. It carries no Arabic, no transliteration,
 * no translation and no reference, and it is marked **Personal** wherever it appears — because the
 * failure mode here is not a missing feature, it is a private string being read as scripture
 * NoorLife vouched for.
 */
const GOLD = modulePalettes.faith.supporting;
const EMERALD = modulePalettes.faith.primary;
const EMERALD_DEEP = modulePalettes.faith.dark;

export function DhikrSelectorScreen() {
  return (
    <FaithScreen
      title="Choose Dhikr"
      activeKey={faithNavKeys.more}
      background={readerPageBackground}
      testID="faith-dhikr-selector"
    >
      <SelectorBody />
    </FaithScreen>
  );
}

function SelectorBody() {
  const { dp } = useModuleMetrics();
  const router = useRouter();
  const tasbih = useTasbih();
  /*
    The user's own selections, read from storage and resolved against the retained generation.
    Neither can reach the network, so opening this screen in aeroplane mode shows every selection
    with its scripture — see `use-quran-selections.ts`.
  */
  const quranSelections = useQuranSelections();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<DhikrCategoryId | null>(null);
  const [draft, setDraft] = useState('');
  const [renaming, setRenaming] = useState<string | null>(null);

  const personal = useMemo(
    () => tasbih.labels.filter((label) => label.id !== DEFAULT_COUNTER.id),
    [tasbih.labels],
  );

  /**
   * The Quran-derived section's live state — the catalogue's gate, the source, and the cache.
   *
   * With no scholarly-reviewed entry the hook reports `awaiting-review`, which is mapped to the
   * locked state below rather than to an empty list. "Nothing matched" and "nothing has been
   * approved yet" are different sentences and only one of them is true.
   */
  const quran = useQuranDhikr();

  const quranState = useMemo<DhikrSectionState>(() => {
    switch (quran.state.kind) {
      case 'loading':
        return { kind: 'loading' };
      case 'awaiting-review':
        return { kind: 'locked', reason: 'awaiting-scholarly-review' };
      case 'failed':
        /*
          A resolution failure is a *provider* problem, not a permission one. Reported as such so a
          user who is simply offline is not told their content is awaiting review.
        */
        return { kind: 'locked', reason: 'provider-unavailable' };
      case 'ready':
        return { kind: 'ready', entries: [] };
    }
  }, [quran.state]);

  const sections = useMemo(
    () =>
      dhikrCatalogue({
        personal,
        favourites: quran.userState.favouriteEntryIds,
        recent: quran.userState.recentEntryIds,
        quranState,
        selectionCount: quranSelections.selections.length,
      }),
    [personal, quran.userState, quranState, quranSelections.selections.length],
  );

  /**
   * Search over local catalogue metadata and verified loaded content only.
   *
   * Titles, references and the translation text that has **already resolved** — never a query sent
   * to the source, and never a search over text this app has not verified the binding of. A search
   * box that queried upstream would be a second, unaudited retrieval path into scripture.
   */
  const quranMatches = useMemo(() => {
    if (quran.state.kind !== 'ready') {
      return [];
    }
    const needle = query.trim().toLowerCase();
    if (needle.length === 0) {
      return quran.state.entries;
    }
    /*
      The category chips narrow to a whole *section* — see `visible` below — so no per-entry category
      filter is applied here. The only narrowing this list does is the search.
    */
    return quran.state.entries.filter(
      (item) =>
        item.entry.title.toLowerCase().includes(needle) ||
        referenceLabel(item.entry).includes(needle) ||
        /* Loaded translations only. Arabic is not searched: a query is typed in the interface's
           script, and matching it against scripture would be a transliteration guess. */
        item.verses.some((verse) => verse.translation.toLowerCase().includes(needle)),
    );
  }, [quran.state, query]);

  /*
    A category filter narrows to the one section it belongs to. Every category except Quranic and
    Personal maps to `verified`, which is shut — so filtering by "After Prayer" shows the honest
    lock rather than an empty result implying nothing matched.
  */
  const visible = useMemo(() => {
    if (category === null) {
      return sections;
    }
    const target = DHIKR_CATEGORIES.find((item) => item.id === category)?.section;
    return sections.filter((section) => section.id === target);
  }, [category, sections]);

  const matches = useMemo(
    () => personal.filter((label) => matchesQuery(label, query)),
    [personal, query],
  );

  /**
   * Selections matching the search: their reference and the user's own note.
   *
   * Deliberately does **not** search the Arabic. A query is typed in the interface's script, and
   * matching it against scripture would be a transliteration guess — the same rule the reviewed
   * list already follows.
   */
  const selectionMatches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle.length === 0) {
      return quranSelections.selections;
    }
    return quranSelections.selections.filter(
      (selection) =>
        selectionReferenceLabel(selection).includes(needle) ||
        selection.label?.toLowerCase().includes(needle) === true,
    );
  }, [quranSelections.selections, query]);

  if (tasbih.loading) {
    return (
      <View style={{ rowGap: dp(12) }} testID="faith-dhikr-loading">
        <ModuleText token="body">Loading your counters…</ModuleText>
      </View>
    );
  }

  return (
    <View style={{ rowGap: dp(14) }}>
      <SearchField value={query} onChange={setQuery} />
      <CategoryFilters selected={category} onSelect={setCategory} />

      {visible.map((section) => (
        <SectionCard
          key={section.id}
          section={section}
          quranEntries={section.id === 'quran' ? quranMatches : []}
          selections={section.id === 'selections' ? selectionMatches : []}
          resolveSelection={quranSelections.resolve}
          onChooseSelection={(selection) => {
            void quranSelections.markUsed(selection.id);
            void tasbih.chooseCounter(selection.id);
          }}
          onToggleSelectionFavourite={(id) => void quranSelections.toggleFavourite(id)}
          onRemoveSelection={(id) => {
            void quranSelections.remove(id);
            /*
              The counting state goes with it. Nothing could ever select that counter again, and
              `forgetCounter` touches exactly one — removing a selection must not be able to disturb
              the count on another.
            */
            void tasbih.forgetCounter(id);
          }}
          onReadSelection={(selection) =>
            router.push(readerHref(selection.surah, selection.startAyah))
          }
          onAddSelection={() => router.push(faithRoutes.quranSelection)}
          selectedEntryId={quran.userState.selectedEntryId}
          favouriteEntryIds={quran.userState.favouriteEntryIds}
          onChooseQuranEntry={(entryId) => void quran.select(entryId)}
          onToggleFavourite={(entryId) => void quran.favourite(entryId)}
          personal={matches}
          activeCounterId={tasbih.session?.counterId ?? null}
          renaming={renaming}
          draft={draft}
          onDraft={setDraft}
          onBeginRename={(id, current) => {
            setRenaming(id);
            setDraft(current);
          }}
          onCommitRename={async (id) => {
            const ok = await tasbih.renameLabel(id, draft);
            if (ok) {
              setRenaming(null);
              setDraft('');
            }
          }}
          onCancelRename={() => {
            setRenaming(null);
            setDraft('');
          }}
          onChoose={(id) => void tasbih.chooseCounter(id)}
          onRemove={(id) => void tasbih.deleteLabel(id)}
        />
      ))}

      {category === null || category === 'personal' ? (
        <NewCounter
          value={renaming === null ? draft : ''}
          onChange={(text) => {
            if (renaming === null) {
              setDraft(text);
            }
          }}
          onCreate={async () => {
            const ok = await tasbih.createLabel(draft);
            if (ok) {
              setDraft('');
            }
          }}
        />
      ) : null}
    </View>
  );
}

function SearchField({
  value,
  onChange,
}: {
  readonly value: string;
  readonly onChange: (text: string) => void;
}) {
  const { dp } = useModuleMetrics();

  return (
    <View
      style={[
        styles.search,
        {
          borderRadius: dp(moduleLayout.radiusSmall),
          minHeight: dp(moduleLayout.minTouchTarget),
          paddingHorizontal: dp(12),
          columnGap: dp(10),
        },
      ]}
    >
      <AppIcon name="search" size={dp(18)} color={moduleNeutrals.textSecondary} />
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder="Search your counters"
        placeholderTextColor={moduleNeutrals.textTertiary}
        accessibilityLabel="Search your counters"
        style={[styles.flex, { color: moduleNeutrals.textPrimary, paddingVertical: dp(10) }]}
        testID="faith-dhikr-search"
      />
    </View>
  );
}

function CategoryFilters({
  selected,
  onSelect,
}: {
  readonly selected: DhikrCategoryId | null;
  readonly onSelect: (id: DhikrCategoryId | null) => void;
}) {
  const { dp } = useModuleMetrics();

  return (
    <View
      style={[styles.filters, { columnGap: dp(8), rowGap: dp(8) }]}
      testID="faith-dhikr-filters"
    >
      <Chip label="All" active={selected === null} onPress={() => onSelect(null)} testID="all" />
      {DHIKR_CATEGORIES.map((item) => (
        <Chip
          key={item.id}
          label={item.label}
          active={selected === item.id}
          onPress={() => onSelect(item.id)}
          testID={item.id}
        />
      ))}
    </View>
  );
}

function Chip({
  label,
  active,
  onPress,
  testID,
}: {
  readonly label: string;
  readonly active: boolean;
  readonly onPress: () => void;
  readonly testID: string;
}) {
  const { dp } = useModuleMetrics();

  return (
    <PressableScale
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={label}
      hitSlop={minimumHitSlop(dp(30))}
      style={{
        paddingHorizontal: dp(12),
        paddingVertical: dp(7),
        borderRadius: dp(999),
        borderWidth: 1,
        borderColor: active ? EMERALD : moduleNeutrals.border,
        backgroundColor: active ? EMERALD_DEEP : moduleNeutrals.surface,
      }}
      testID={`faith-dhikr-filter-${testID}`}
    >
      <ModuleText
        token="caption"
        color={active ? moduleNeutrals.surface : moduleNeutrals.textSecondary}
        numberOfLines={1}
      >
        {label}
      </ModuleText>
    </PressableScale>
  );
}

function SectionCard({
  section,
  quranEntries,
  selections,
  resolveSelection,
  onChooseSelection,
  onToggleSelectionFavourite,
  onRemoveSelection,
  onReadSelection,
  onAddSelection,
  selectedEntryId,
  favouriteEntryIds,
  onChooseQuranEntry,
  onToggleFavourite,
  personal,
  activeCounterId,
  renaming,
  draft,
  onDraft,
  onBeginRename,
  onCommitRename,
  onCancelRename,
  onChoose,
  onRemove,
}: {
  readonly section: DhikrSection;
  /** Resolved Quran-derived entries, for the `quran` section only. Empty for every other. */
  readonly quranEntries: readonly ResolvedDhikr[];
  /** The user's own selections, for the `selections` section only. Empty for every other. */
  readonly selections: readonly QuranSelection[];
  readonly resolveSelection: (ref: QuranSelectionRef) => SelectionResolution;
  readonly onChooseSelection: (selection: QuranSelection) => void;
  readonly onToggleSelectionFavourite: (id: string) => void;
  readonly onRemoveSelection: (id: string) => void;
  readonly onReadSelection: (selection: QuranSelection) => void;
  readonly onAddSelection: () => void;
  readonly selectedEntryId: string | null;
  readonly favouriteEntryIds: readonly string[];
  readonly onChooseQuranEntry: (entryId: string) => void;
  readonly onToggleFavourite: (entryId: string) => void;
  readonly personal: readonly { readonly id: string; readonly name: string }[];
  readonly activeCounterId: string | null;
  readonly renaming: string | null;
  readonly draft: string;
  readonly onDraft: (text: string) => void;
  readonly onBeginRename: (id: string, current: string) => void;
  readonly onCommitRename: (id: string) => void;
  readonly onCancelRename: () => void;
  readonly onChoose: (id: string) => void;
  readonly onRemove: (id: string) => void;
}) {
  const { dp } = useModuleMetrics();

  return (
    <ModuleCard testID={`faith-dhikr-section-${section.id}`}>
      <View style={{ rowGap: dp(10) }}>
        <View>
          <ModuleText token="cardTitle" numberOfLines={2}>
            {section.title}
          </ModuleText>
          <ModuleText token="caption" numberOfLines={3}>
            {section.summary}
          </ModuleText>
        </View>

        {section.state.kind === 'loading' ? (
          <ModuleText token="body" testID={`faith-dhikr-${section.id}-loading`}>
            Loading…
          </ModuleText>
        ) : null}

        {section.state.kind === 'locked' ? (
          <LockedNotice reason={section.state.reason} sectionId={section.id} />
        ) : null}

        {section.id === 'quran' && section.state.kind === 'ready' ? (
          <QuranDhikrList
            entries={quranEntries}
            selectedEntryId={selectedEntryId}
            favouriteEntryIds={favouriteEntryIds}
            onChoose={onChooseQuranEntry}
            onToggleFavourite={onToggleFavourite}
          />
        ) : null}

        {section.id === 'selections' ? (
          <View style={{ rowGap: dp(10) }}>
            {selections.length === 0 ? (
              <ModuleText token="body" testID="faith-dhikr-selections-empty">
                {section.state.kind === 'empty'
                  ? 'You have not kept any verses yet. Choose one below — it is your own selection, and NoorLife makes no religious claim about it.'
                  : 'No selection matches that search.'}
              </ModuleText>
            ) : (
              <QuranSelectionsList
                selections={selections}
                resolve={resolveSelection}
                activeCounterId={activeCounterId}
                onChoose={onChooseSelection}
                onToggleFavourite={onToggleSelectionFavourite}
                onRemove={onRemoveSelection}
                onRead={onReadSelection}
              />
            )}
            <AddSelectionCard onPress={onAddSelection} />
          </View>
        ) : null}

        {section.id === 'personal' && section.state.kind !== 'locked' ? (
          <PersonalList
            personal={personal}
            activeCounterId={activeCounterId}
            renaming={renaming}
            draft={draft}
            onDraft={onDraft}
            onBeginRename={onBeginRename}
            onCommitRename={onCommitRename}
            onCancelRename={onCancelRename}
            onChoose={onChoose}
            onRemove={onRemove}
          />
        ) : null}

        {section.state.kind === 'empty' &&
        section.id !== 'personal' &&
        section.id !== 'selections' ? (
          <ModuleText token="body" testID={`faith-dhikr-${section.id}-empty`}>
            Nothing here yet.
          </ModuleText>
        ) : null}
      </View>
    </ModuleCard>
  );
}

/**
 * Why a section is shut, said plainly and without an apology that implies a defect.
 *
 * The explicit "no copied text, and no placeholders" is deliberate: a shut section invites the
 * assumption that something was quietly substituted, and this is the screen where that assumption
 * must not be left standing.
 */
function LockedNotice({
  reason,
  sectionId,
}: {
  readonly reason: Parameters<typeof lockMessage>[0];
  readonly sectionId: string;
}) {
  const { dp } = useModuleMetrics();
  const message = lockMessage(reason);

  return (
    <View
      style={[
        styles.locked,
        { borderRadius: dp(moduleLayout.radiusSmall), padding: dp(12), columnGap: dp(10) },
      ]}
      accessible
      accessibilityLabel={`${message.title}. ${message.body}`}
      testID={`faith-dhikr-${sectionId}-locked`}
    >
      <AppIcon name="lock" size={dp(18)} color={GOLD} />
      <View style={styles.flex}>
        <ModuleText token="button" color={moduleNeutrals.textPrimary} numberOfLines={2}>
          {message.title}
        </ModuleText>
        <ModuleText token="caption" numberOfLines={5}>
          {message.body}
        </ModuleText>
      </View>
    </View>
  );
}

function PersonalList({
  personal,
  activeCounterId,
  renaming,
  draft,
  onDraft,
  onBeginRename,
  onCommitRename,
  onCancelRename,
  onChoose,
  onRemove,
}: {
  readonly personal: readonly { readonly id: string; readonly name: string }[];
  readonly activeCounterId: string | null;
  readonly renaming: string | null;
  readonly draft: string;
  readonly onDraft: (text: string) => void;
  readonly onBeginRename: (id: string, current: string) => void;
  readonly onCommitRename: (id: string) => void;
  readonly onCancelRename: () => void;
  readonly onChoose: (id: string) => void;
  readonly onRemove: (id: string) => void;
}) {
  const { dp } = useModuleMetrics();

  if (personal.length === 0) {
    return (
      <ModuleText token="body" testID="faith-dhikr-personal-empty">
        You have no personal counters yet. Create one below — it stays on this device and NoorLife
        makes no religious claim about it.
      </ModuleText>
    );
  }

  return (
    <View style={{ rowGap: dp(8) }}>
      {personal.map((label) =>
        renaming === label.id ? (
          <View key={label.id} style={[styles.row, { columnGap: dp(8) }]}>
            <TextInput
              value={draft}
              onChangeText={onDraft}
              maxLength={MAX_LABEL_LENGTH}
              autoFocus
              accessibilityLabel={`Rename ${label.name}`}
              style={[
                styles.flex,
                styles.input,
                {
                  borderRadius: dp(moduleLayout.radiusSmall),
                  minHeight: dp(moduleLayout.minTouchTarget),
                  paddingHorizontal: dp(10),
                  color: moduleNeutrals.textPrimary,
                },
              ]}
              testID={`faith-dhikr-rename-input-${label.id}`}
            />
            <RowButton
              icon="check"
              label="Save name"
              onPress={() => onCommitRename(label.id)}
              testID={`faith-dhikr-rename-save-${label.id}`}
            />
            <RowButton
              icon="close"
              label="Cancel rename"
              onPress={onCancelRename}
              testID={`faith-dhikr-rename-cancel-${label.id}`}
            />
          </View>
        ) : (
          <View key={label.id} style={[styles.row, { columnGap: dp(8) }]}>
            <PressableScale
              onPress={() => onChoose(label.id)}
              accessibilityRole="button"
              accessibilityState={{ selected: activeCounterId === label.id }}
              accessibilityLabel={`${label.name}. Personal counter.${
                activeCounterId === label.id ? ' Currently selected.' : ''
              }`}
              style={[
                styles.flex,
                styles.counter,
                {
                  borderRadius: dp(moduleLayout.radiusSmall),
                  minHeight: dp(moduleLayout.minTouchTarget),
                  paddingHorizontal: dp(12),
                  paddingVertical: dp(8),
                  borderColor: activeCounterId === label.id ? EMERALD : moduleNeutrals.border,
                },
              ]}
              testID={`faith-dhikr-counter-${label.id}`}
            >
              <ModuleText token="body" color={moduleNeutrals.textPrimary} numberOfLines={2}>
                {label.name}
              </ModuleText>
              {/*
                The word "Personal" travels with every one of these, in the visible row and in the
                spoken label. A private string sitting in a list of dhikr is exactly what must not be
                mistaken for content NoorLife verified.
              */}
              <PersonalTag />
            </PressableScale>
            <RowButton
              icon="edit"
              label={`Rename ${label.name}`}
              onPress={() => onBeginRename(label.id, label.name)}
              testID={`faith-dhikr-rename-${label.id}`}
            />
            <RowButton
              icon="close"
              label={`Remove ${label.name}`}
              onPress={() => onRemove(label.id)}
              testID={`faith-dhikr-remove-${label.id}`}
            />
          </View>
        ),
      )}
    </View>
  );
}

/**
 * The Quran-derived entries, each with its reference, its Arabic, its translation and its translator.
 *
 * ── Every row carries its own attribution, and cannot not carry it ──────────
 * The translator is rendered from `verse.translator`, which `resolveDhikrReference` refuses to
 * produce without one — an unattributed translation never reaches this component, so there is no
 * branch here that could omit the credit under a layout squeeze. The source attribution is stated
 * once for the section, from the single constant the permission pins.
 *
 * ── Arabic is rendered through `ArabicText`, unmodified ─────────────────────
 * The same component the reader uses, which passes its children through untouched — no trim, no
 * normalise, no `numberOfLines` that could ellipsize a verse. This is the last place the scripture
 * passes before it is drawn.
 */
function QuranDhikrList({
  entries,
  selectedEntryId,
  favouriteEntryIds,
  onChoose,
  onToggleFavourite,
}: {
  readonly entries: readonly ResolvedDhikr[];
  readonly selectedEntryId: string | null;
  readonly favouriteEntryIds: readonly string[];
  readonly onChoose: (entryId: string) => void;
  readonly onToggleFavourite: (entryId: string) => void;
}) {
  const { dp } = useModuleMetrics();

  if (entries.length === 0) {
    /*
      Reachable only by a search that matched nothing — the no-approved-entries case is the locked
      state above, not this one. Worded so the two cannot be confused.
    */
    return (
      <ModuleText token="body" testID="faith-dhikr-quran-no-matches">
        No approved selection matches that search.
      </ModuleText>
    );
  }

  return (
    <View style={{ rowGap: dp(10) }} testID="faith-dhikr-quran-list">
      {entries.map((item) => {
        const selected = selectedEntryId === item.entry.id;
        const favourited = favouriteEntryIds.includes(item.entry.id);
        const reference = referenceLabel(item.entry);

        return (
          <View key={item.entry.id} style={[styles.row, { columnGap: dp(8) }]}>
            <PressableScale
              onPress={() => onChoose(item.entry.id)}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              /*
                The spoken label names the reference and the translator. An attribution present
                visually and absent from the accessible name is not an attribution that has been
                displayed — the same rule the reciter screen applies to the Sudais credit.
              */
              accessibilityLabel={`${item.entry.title}. Quran ${reference}. Translated by ${item.translator}.${
                selected ? ' Currently selected.' : ''
              }`}
              style={[
                styles.flex,
                styles.quranEntry,
                {
                  borderRadius: dp(moduleLayout.radiusSmall),
                  padding: dp(12),
                  rowGap: dp(6),
                  borderColor: selected ? EMERALD : moduleNeutrals.border,
                },
              ]}
              testID={`faith-dhikr-quran-entry-${item.entry.id}`}
            >
              <View style={[styles.row, { columnGap: dp(8) }]}>
                <ModuleText
                  token="body"
                  color={moduleNeutrals.textPrimary}
                  numberOfLines={2}
                  style={styles.flex}
                >
                  {item.entry.title}
                </ModuleText>
                <ModuleText token="caption" numberOfLines={1}>
                  {`Quran ${reference}`}
                </ModuleText>
              </View>

              {item.verses.map((verse) => (
                <View key={verse.verseKey} style={{ rowGap: dp(4) }}>
                  <ArabicText testID={`faith-dhikr-arabic-${verse.verseKey}`}>
                    {verse.arabic}
                  </ArabicText>
                  {/*
                    Empty when the one-week translation ceiling has dropped it while the Arabic
                    legitimately remains. The line below says so rather than leaving a gap that
                    reads as "this verse has no meaning".
                  */}
                  {verse.translation === '' ? (
                    <ModuleText
                      token="caption"
                      numberOfLines={2}
                      testID={`faith-dhikr-translation-refreshing-${verse.verseKey}`}
                    >
                      The translation is being refreshed.
                    </ModuleText>
                  ) : (
                    <ModuleText token="caption" numberOfLines={6}>
                      {verse.translation}
                    </ModuleText>
                  )}
                </View>
              ))}

              {item.entry.contextNote === null ? null : (
                <ModuleText token="caption" numberOfLines={4}>
                  {item.entry.contextNote}
                </ModuleText>
              )}

              {item.translator === '' ? null : (
                <ModuleText
                  token="caption"
                  numberOfLines={2}
                  testID={`faith-dhikr-translator-${item.entry.id}`}
                >
                  {`Translated by ${item.translator}`}
                </ModuleText>
              )}
            </PressableScale>

            <RowButton
              icon={favourited ? 'check' : 'edit'}
              label={
                favourited
                  ? `Remove ${item.entry.title} from favourites`
                  : `Add ${item.entry.title} to favourites`
              }
              onPress={() => onToggleFavourite(item.entry.id)}
              testID={`faith-dhikr-favourite-${item.entry.id}`}
            />
          </View>
        );
      })}

      {/*
        The exact string the permission requires, from its single constant, stated once for the
        section it governs. See `quran-content-attribution.ts` for why it is never retyped.
      */}
      <ModuleText token="caption" numberOfLines={3} testID="faith-dhikr-quran-attribution">
        {QURAN_CONTENT_ATTRIBUTION}
      </ModuleText>
    </View>
  );
}

/** The marker that keeps a private label from reading as verified content. */
export function PersonalTag({ testID }: { readonly testID?: string }) {
  const { dp } = useModuleMetrics();

  return (
    <View
      style={[
        styles.tag,
        { borderRadius: dp(999), paddingHorizontal: dp(8), paddingVertical: dp(2) },
      ]}
      testID={testID}
    >
      <ModuleText token="caption" color={EMERALD_DEEP} numberOfLines={1}>
        Personal
      </ModuleText>
    </View>
  );
}

function RowButton({
  icon,
  label,
  onPress,
  testID,
}: {
  readonly icon: 'edit' | 'close' | 'check';
  readonly label: string;
  readonly onPress: () => void;
  readonly testID: string;
}) {
  const { dp } = useModuleMetrics();
  const size = dp(moduleLayout.minTouchTarget);

  return (
    <PressableScale
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={minimumHitSlop(size)}
      style={{
        width: size,
        height: size,
        borderRadius: dp(moduleLayout.radiusSmall),
        borderWidth: 1,
        borderColor: moduleNeutrals.border,
        backgroundColor: moduleNeutrals.surface,
        alignItems: 'center',
        justifyContent: 'center',
      }}
      testID={testID}
    >
      <AppIcon name={icon} size={dp(18)} color={EMERALD_DEEP} />
    </PressableScale>
  );
}

function NewCounter({
  value,
  onChange,
  onCreate,
}: {
  readonly value: string;
  readonly onChange: (text: string) => void;
  readonly onCreate: () => void;
}) {
  const { dp } = useModuleMetrics();

  return (
    <ModuleCard testID="faith-dhikr-new-counter">
      <View style={{ rowGap: dp(8) }}>
        <ModuleText token="cardTitle">New personal counter</ModuleText>
        <ModuleText token="caption" numberOfLines={3}>
          A private label, stored on this device. It is not published, and it is never presented as
          verified Quran or Hadith content.
        </ModuleText>
        <View style={[styles.row, { columnGap: dp(8) }]}>
          <TextInput
            value={value}
            onChangeText={onChange}
            maxLength={MAX_LABEL_LENGTH}
            placeholder="What are you counting?"
            placeholderTextColor={moduleNeutrals.textTertiary}
            accessibilityLabel="Name your personal counter"
            style={[
              styles.flex,
              styles.input,
              {
                borderRadius: dp(moduleLayout.radiusSmall),
                minHeight: dp(moduleLayout.minTouchTarget),
                paddingHorizontal: dp(10),
                color: moduleNeutrals.textPrimary,
              },
            ]}
            testID="faith-dhikr-new-input"
          />
          <PressableScale
            onPress={onCreate}
            disabled={value.trim().length === 0}
            accessibilityRole="button"
            accessibilityLabel="Create personal counter"
            accessibilityState={{ disabled: value.trim().length === 0 }}
            style={{
              paddingHorizontal: dp(14),
              minHeight: dp(moduleLayout.minTouchTarget),
              borderRadius: dp(moduleLayout.radiusSmall),
              backgroundColor: EMERALD_DEEP,
              alignItems: 'center',
              justifyContent: 'center',
              opacity: value.trim().length === 0 ? 0.5 : 1,
            }}
            testID="faith-dhikr-create"
          >
            <ModuleText token="button" color={moduleNeutrals.surface}>
              Add
            </ModuleText>
          </PressableScale>
        </View>
      </View>
    </ModuleCard>
  );
}

/**
 * The user's own Quran selections, each with the scripture it names and the badge that says whose
 * choice it was.
 *
 * ── Why these rows look like the reviewed ones and are labelled unlike them ─
 * They render the same publisher text through the same component, because it is the same text. What
 * differs is the claim, and the claim is carried by `SelectionOriginBadge` on every row — never by
 * the section heading alone, because a row is what somebody screenshots, scrolls to, and remembers.
 *
 * ── Resolution is offline and synchronous ──────────────────────────────────
 * `resolve` is a pure function over the generation this screen already read. Twenty selections cost
 * twenty map lookups, not twenty promises, and none of them can reach the network.
 */
function QuranSelectionsList({
  selections,
  resolve,
  activeCounterId,
  onChoose,
  onToggleFavourite,
  onRemove,
  onRead,
}: {
  readonly selections: readonly QuranSelection[];
  readonly resolve: (ref: QuranSelectionRef) => SelectionResolution;
  readonly activeCounterId: string | null;
  readonly onChoose: (selection: QuranSelection) => void;
  readonly onToggleFavourite: (id: string) => void;
  readonly onRemove: (id: string) => void;
  readonly onRead: (selection: QuranSelection) => void;
}) {
  const { dp } = useModuleMetrics();

  return (
    <View style={{ rowGap: dp(10) }} testID="faith-dhikr-selection-list">
      {selections.map((selection) => {
        const reference = selectionReferenceLabel(selection);
        const selected = activeCounterId === selection.id;

        return (
          <View key={selection.id} style={{ rowGap: dp(6) }}>
            <PressableScale
              onPress={() => onChoose(selection)}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              /*
                The spoken label names the reference and says whose selection it is. A badge visible
                on screen and absent from the accessible name is a distinction that has not been made
                for anybody using a screen reader.
              */
              accessibilityLabel={`Qur'an ${reference}. Your own selection.${
                selection.label === null ? '' : ` ${selection.label}.`
              }${selected ? ' Currently counting.' : ''}`}
              style={[
                styles.quranEntry,
                {
                  borderRadius: dp(moduleLayout.radiusSmall),
                  padding: dp(12),
                  rowGap: dp(6),
                  borderColor: selected ? EMERALD : moduleNeutrals.border,
                },
              ]}
              testID={`faith-dhikr-selection-${selection.id}`}
            >
              <View style={[styles.row, { columnGap: dp(8) }]}>
                <SelectionOriginBadge origin="personal" />
                <View style={styles.flex} />
                {selection.favourite ? (
                  <ModuleText token="caption" numberOfLines={1}>
                    Favourite
                  </ModuleText>
                ) : null}
              </View>

              {selection.label === null ? null : (
                <ModuleText token="body" color={moduleNeutrals.textPrimary} numberOfLines={2}>
                  {selection.label}
                </ModuleText>
              )}

              <QuranSelectionView
                resolution={resolve(selection)}
                reference={reference}
                arabicLines={3}
                translationLines={4}
                testID={`faith-dhikr-selection-body-${selection.id}`}
              />
            </PressableScale>

            <View style={[styles.row, { columnGap: dp(8) }]}>
              <RowButton
                icon={selection.favourite ? 'check' : 'edit'}
                label={
                  selection.favourite
                    ? `Remove Qur'an ${reference} from favourites`
                    : `Add Qur'an ${reference} to favourites`
                }
                onPress={() => onToggleFavourite(selection.id)}
                testID={`faith-dhikr-selection-favourite-${selection.id}`}
              />
              <RowButton
                icon="check"
                label={`Read Qur'an ${reference} in the reader`}
                onPress={() => onRead(selection)}
                testID={`faith-dhikr-selection-read-${selection.id}`}
              />
              <RowButton
                icon="close"
                label={`Remove Qur'an ${reference} from your selections`}
                onPress={() => onRemove(selection.id)}
                testID={`faith-dhikr-selection-remove-${selection.id}`}
              />
              <View style={styles.flex} />
            </View>
          </View>
        );
      })}
    </View>
  );
}

/** The one way into the browser, offered wherever selections are listed. */
function AddSelectionCard({ onPress }: { readonly onPress: () => void }) {
  const { dp } = useModuleMetrics();

  return (
    <ModuleCard
      onPress={onPress}
      accessibilityLabel="Choose a verse from the Qur'an"
      testID="faith-dhikr-add-selection"
    >
      <View style={{ rowGap: dp(4) }}>
        <ModuleText token="cardTitle" numberOfLines={2}>
          Choose a verse from the Qur’an
        </ModuleText>
        <ModuleText token="caption" numberOfLines={3}>
          Browse all 114 surahs and keep one verse, or a run of verses next to each other. It stays
          on this device as your own selection.
        </ModuleText>
      </View>
    </ModuleCard>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
    minWidth: 0,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: moduleNeutrals.surface,
    borderWidth: 1,
    borderColor: moduleNeutrals.border,
  },
  filters: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  locked: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: readerDockColors.surface,
    borderWidth: 1,
    borderColor: readerDockColors.border,
  },
  counter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    columnGap: 8,
    borderWidth: 1,
    backgroundColor: moduleNeutrals.surface,
  },
  input: {
    borderWidth: 1,
    borderColor: moduleNeutrals.border,
    backgroundColor: moduleNeutrals.surface,
  },
  tag: {
    backgroundColor: `${EMERALD}1A`,
  },
  quranEntry: {
    borderWidth: 1,
    backgroundColor: moduleNeutrals.surface,
  },
});
