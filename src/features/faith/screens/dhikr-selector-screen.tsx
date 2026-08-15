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

import { FaithScreen } from '../components/faith-screen';
import {
  dhikrCatalogue,
  DHIKR_CATEGORIES,
  lockMessage,
  matchesQuery,
  type DhikrCategoryId,
  type DhikrSection,
} from '../data/tasbih/dhikr-catalogue';
import { DEFAULT_COUNTER, MAX_LABEL_LENGTH } from '../data/tasbih/local-tasbih.repository';
import { faithNavKeys } from '../faith-routes';
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
  const tasbih = useTasbih();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<DhikrCategoryId | null>(null);
  const [draft, setDraft] = useState('');
  const [renaming, setRenaming] = useState<string | null>(null);

  const personal = useMemo(
    () => tasbih.labels.filter((label) => label.id !== DEFAULT_COUNTER.id),
    [tasbih.labels],
  );

  const sections = useMemo(
    () => dhikrCatalogue({ personal, favourites: [], recent: [] }),
    [personal],
  );

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

        {section.state.kind === 'empty' && section.id !== 'personal' ? (
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
});
