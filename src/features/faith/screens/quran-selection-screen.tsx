import { useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';

import { AppIcon, PressableScale } from '@ds/components';
import { modulePalettes } from '@ds/tokens';
import { AppTextInput } from '@ds/typography/app-text-input';
import { ModuleText } from '@features/modules/components';
import { ModuleCard } from '@features/modules/components/module-card';
import {
  moduleLayout,
  moduleNeutrals,
  readerPageBackground,
} from '@features/modules/module-tokens';
import { useModuleMetrics } from '@features/modules/use-module-metrics';
import { minimumHitSlop, minimumTouchTargetSize } from '@shared/utils/a11y';

import { BROWSE_ACTION_LABEL } from '../components/dua-library-items';
import { FaithScreen } from '../components/faith-screen';
import { QuranSelectionView } from '../components/quran-selection-view';
import {
  MAX_SELECTION_AYAT,
  MAX_SELECTION_LABEL_LENGTH,
  orderRange,
  selectionFaultMessage,
  selectionIdFor,
  selectionReferenceLabel,
  type QuranSelectionRef,
} from '../data/quran-selection/quran-selection';
import {
  searchRetainedTranslation,
  type TranslationSearchResult,
} from '../data/quran-selection/translation-search';
import { faithNavKeys, faithRoutes, readerHref } from '../faith-routes';
import { useCachedSurahNames, type BrowsableSurah } from '../hooks/use-cached-surah-names';
import { useQuranSelections } from '../hooks/use-quran-selections';
import { useTasbih } from '../hooks/use-tasbih';

/**
 * **Choosing a Quran selection — the browser, the range, and the honest label on the result.**
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── What this screen lets somebody do, and what it refuses to call it ──────
 * Browse all 114 surahs, search by name or by reference, open one, pick a verse or a contiguous
 * range, see exactly what they picked, and keep it. What they get back is labelled a **Quran
 * selection** — never a dhikr, never a dua, never "recommended". NoorLife has no scholarly review
 * behind these and says so in the words it uses rather than in a disclaimer somewhere else.
 *
 * That distinction is why this screen exists separately from the reviewed catalogue rather than
 * being the on-ramp to it. A user choosing a verse to repeat is doing something entirely legitimate
 * that needs no approval; presenting the result under a heading NoorLife vouches for is a claim, and
 * it is the claim the five removed dhikr presets were removed for making.
 *
 * ── Not one request is issued from this screen ─────────────────────────────
 * The surah list comes from the metadata cache and the retained generation, the Arabic comes from
 * the retained generation, and neither seam can fetch. A cold launch in aeroplane mode browses,
 * previews and saves exactly as well as a connected one — which is the whole point of having
 * retained the mushaf, and is stated here because a future edit that reached for
 * `useSurahCatalogue()` would look entirely reasonable and would silently undo it.
 *
 * ── Why the range is a pair of steppers and not a grid of verse chips ──────
 * Al-Baqarah has 286 verses. A chip grid is 286 touch targets to scroll past to reach verse 255, it
 * cannot be laid out at 320 dp with a 1.5× text scale without either wrapping to something
 * unreadable or shrinking below the minimum target, and it answers a question the user usually
 * already knows the answer to. Two bounded steppers with a live preview answer it in two taps, stay
 * legible at every responsive target, and let the verse list below serve the other case — tapping a
 * verse selects exactly that verse.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const EMERALD = modulePalettes.faith.primary;
const EMERALD_DEEP = modulePalettes.faith.dark;

export function QuranSelectionScreen() {
  const [open, setOpen] = useState<QuranSelectionRef | null>(null);

  return (
    <FaithScreen
      /* Names the task, not the outcome — see `BROWSE_ACTION_LABEL`. */
      title={open === null ? BROWSE_ACTION_LABEL : 'Your selection'}
      activeKey={faithNavKeys.more}
      background={readerPageBackground}
      scrollable={open !== null}
      {...(open === null ? {} : { onBack: () => setOpen(null) })}
      testID="faith-quran-selection"
    >
      {open === null ? (
        <SurahBrowser onOpen={setOpen} />
      ) : (
        <RangePicker initial={open} onBack={() => setOpen(null)} />
      )}
    </FaithScreen>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Browsing
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A typed reference, or `null`.
 *
 * Accepts `2:255`, `2:255-260` and `2 255`, because those are the three ways people actually write
 * one. Deliberately does **not** accept a bare number as a reference — `36` is a search for Ya-Sin,
 * not a request for verse 36 of something unstated, and guessing which would open the wrong surah.
 */
export function parseReferenceQuery(query: string): QuranSelectionRef | null {
  const match = /^\s*(\d{1,3})\s*[:\s.]\s*(\d{1,3})\s*(?:-\s*(\d{1,3}))?\s*$/.exec(query);
  if (match === null) {
    return null;
  }
  const surah = Number(match[1]);
  const start = Number(match[2]);
  const end = match[3] === undefined ? start : Number(match[3]);
  if (surah < 1 || surah > 114 || start < 1 || end < 1) {
    return null;
  }
  const ordered = orderRange(start, end);
  return { surah, startAyah: ordered.start, endAyah: ordered.end };
}

/**
 * Verses found by their words, above the surah list.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── Why the translator is named on the section and not only on the preview ──
 * A snippet **is** translation text on screen, and the licence requires the translator credited
 * wherever a translation appears — not only where the whole verse does. So the credit is drawn by the
 * same block that draws the snippets, from the identity the search carried out of the generation, and
 * there is no arrangement of props that renders one without the other. The full verse, opened from a
 * row, then carries its own per-verse credit through `QuranSelectionView`.
 *
 * ── Four different kinds of nothing, and none of them says "no results" ────
 * A query below the floor has not been searched yet; a device with no generation cannot search at all;
 * a generation with Arabic but no translation is a different absence again; and a real search that
 * matched nothing is the only one of the four where "nothing matched" is true. Collapsing them would
 * tell somebody their words were not in the Qur'an when the truth is that the translation is not on
 * their phone.
 *
 * ── A match is one ayah, and choosing is still the user's ──────────────────
 * Opening a row lands on that verse as a single-ayah selection, which is the default the range picker
 * starts from. Nothing here pre-selects a range: where a passage runs on, only the reader knows where
 * it should end, and guessing would put NoorLife's judgement into somebody's saved reference.
 * ═══════════════════════════════════════════════════════════════════════════
 */
function VerseMatches({
  result,
  onOpen,
}: {
  readonly result: TranslationSearchResult;
  readonly onOpen: (ref: QuranSelectionRef) => void;
}) {
  const { dp } = useModuleMetrics();

  /*
    Silent until the query is worth scanning for. A "type three characters" hint under every empty
    search box is noise on the screen that is otherwise just a surah list.
  */
  if (result.state === 'too-short') {
    return null;
  }

  if (result.state !== 'ok') {
    return (
      <ModuleCard testID="faith-quran-selection-verse-unavailable">
        <View style={{ rowGap: dp(4) }}>
          <ModuleText token="cardTitle" numberOfLines={2}>
            {result.state === 'no-generation'
              ? 'The Qur’an is not on this device yet'
              : 'The meaning is not on this device yet'}
          </ModuleText>
          <ModuleText token="caption" numberOfLines={4}>
            {result.state === 'no-generation'
              ? 'Searching by words reads the copy NoorLife keeps on your phone. Open the Qur’an once with a connection and it is kept for searching offline afterwards.'
              : 'The Arabic is here but the translation is not, so there are no words to search yet. It arrives with the next content update.'}
          </ModuleText>
          <ModuleText token="caption" numberOfLines={3}>
            You can still browse by surah below, or type a reference like 2:255.
          </ModuleText>
        </View>
      </ModuleCard>
    );
  }

  if (result.matches.length === 0) {
    return (
      <ModuleCard testID="faith-quran-selection-verse-empty">
        <View style={{ rowGap: dp(4) }}>
          <ModuleText token="cardTitle" numberOfLines={2}>
            No verse on this device uses those words
          </ModuleText>
          <ModuleText token="caption" numberOfLines={4}>
            {/*
              Says which rendering was searched. Another translation words the same passage
              differently, and a flat "not found" would imply the Qur’an does not say it.
            */}
            {result.translator === null
              ? 'Try fewer words, or a different wording.'
              : `Try fewer words, or a different wording — this searched the rendering by ${result.translator}.`}
          </ModuleText>
        </View>
      </ModuleCard>
    );
  }

  return (
    <View style={{ rowGap: dp(6) }} testID="faith-quran-selection-verse-matches">
      <ModuleText token="cardTitle" numberOfLines={2} accessibilityRole="header">
        {result.matches.length === 1
          ? 'One verse matched'
          : `${result.matches.length} verses matched`}
      </ModuleText>

      {result.matches.map((match) => (
        <PressableScale
          key={match.reference}
          onPress={() => onOpen({ surah: match.surah, startAyah: match.ayah, endAyah: match.ayah })}
          accessibilityRole="button"
          /* The reference, the surah where one is known, and the words that matched. */
          accessibilityLabel={
            match.surahName === null
              ? `Qur’an ${match.reference}. ${match.snippet}`
              : `Qur’an ${match.reference}, ${match.surahName}. ${match.snippet}`
          }
          accessibilityHint="Opens this verse so you can choose it"
          style={[
            styles.action,
            {
              minHeight: minimumTouchTargetSize(),
              borderRadius: dp(moduleLayout.radiusSmall),
              borderColor: moduleNeutrals.border,
              paddingHorizontal: dp(12),
              paddingVertical: dp(8),
              columnGap: dp(10),
            },
          ]}
          testID={`faith-quran-selection-verse-${match.reference}`}
        >
          <View style={[styles.flex, { rowGap: dp(2) }]}>
            <ModuleText token="caption" color={EMERALD_DEEP} numberOfLines={1}>
              {match.surahName === null
                ? `Qur’an ${match.reference}`
                : `Qur’an ${match.reference} · ${match.surahName}`}
            </ModuleText>
            <ModuleText token="body" color={moduleNeutrals.textPrimary} numberOfLines={3}>
              {match.snippet}
            </ModuleText>
          </View>
          <AppIcon name="chevron-forward" size={dp(18)} color={EMERALD_DEEP} />
        </PressableScale>
      ))}

      {/*
        The cap, said rather than hidden. A truncated list that looks complete is the same class of
        untruth as an empty state that names the wrong cause.
      */}
      {result.overflow === 0 ? null : (
        <ModuleText token="caption" numberOfLines={2} testID="faith-quran-selection-verse-overflow">
          {`${result.overflow} more ${
            result.overflow === 1 ? 'verse uses' : 'verses use'
          } those words. Add a word to narrow it.`}
        </ModuleText>
      )}

      {/*
        The translator, drawn by the block that drew the snippets — see this component's note. Never
        optional, never a separate prop.
      */}
      <ModuleText token="caption" numberOfLines={2} testID="faith-quran-selection-verse-translator">
        {result.translationEdition === null
          ? `Searched the translation by ${result.translator ?? 'an unnamed translator'}`
          : `Searched ${result.translationEdition} — translation by ${result.translator ?? 'an unnamed translator'}`}
      </ModuleText>
    </View>
  );
}

function SurahBrowser({ onOpen }: { readonly onOpen: (ref: QuranSelectionRef) => void }) {
  const { dp } = useModuleMetrics();
  const { surahs, loading, source } = useCachedSurahNames();
  const { retained } = useQuranSelections();
  const [query, setQuery] = useState('');

  const reference = useMemo(() => parseReferenceQuery(query), [query]);

  const surahNames = useMemo(() => {
    const names = new Map<number, string>();
    for (const surah of surahs) {
      if (surah.name !== null) {
        names.set(surah.number, surah.name);
      }
    }
    return names;
  }, [surahs]);

  /**
   * Verses whose retained translation contains the words the user typed.
   *
   * ── The capability this screen was missing ─────────────────────────────────
   * It could find a surah by name and a verse by an exact reference, which between them require you to
   * already know where you are going. Somebody who remembers the words and not the coordinates had no
   * way in — the empty state said as much.
   *
   * The scan is over the map `useQuranSelections` is already holding, per keystroke, keeping nothing.
   * See `searchRetainedTranslation` for why that is not the second copy of scripture the library search
   * refuses to build.
   */
  const verseMatches = useMemo(
    () => searchRetainedTranslation({ query, retained, surahNames }),
    [query, retained, surahNames],
  );

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle.length === 0) {
      return surahs;
    }
    return surahs.filter(
      (surah) =>
        String(surah.number) === needle ||
        surah.name?.toLowerCase().includes(needle) === true ||
        surah.meaning?.toLowerCase().includes(needle) === true,
    );
  }, [surahs, query]);

  const header = useMemo(
    () => (
      <View style={{ rowGap: dp(12), paddingBottom: dp(moduleLayout.cardGap) }}>
        <SearchField value={query} onChange={setQuery} placeholder="Surah, reference, or words" />

        {/*
          A typed reference is offered as its own row rather than filtering the list. "2:255" is not a
          search for a surah, it is somebody who already knows what they want, and making them scroll
          to Al-Baqarah afterwards would be answering a different question.
        */}
        {reference === null ? null : (
          <ModuleCard
            onPress={() => onOpen(reference)}
            accessibilityLabel={`Open Qur'an ${selectionReferenceLabel(reference)}`}
            testID="faith-quran-selection-jump"
          >
            <ModuleText token="cardTitle" numberOfLines={1}>
              {`Go to ${selectionReferenceLabel(reference)}`}
            </ModuleText>
            <ModuleText token="caption" numberOfLines={2}>
              Open this reference and choose the exact verses.
            </ModuleText>
          </ModuleCard>
        )}

        <VerseMatches result={verseMatches} onOpen={onOpen} />

        <ModuleText token="cardTitle" numberOfLines={1} accessibilityRole="header">
          All surahs
        </ModuleText>
      </View>
    ),
    [dp, query, reference, verseMatches, onOpen],
  );

  const renderRow = useCallback(
    ({ item }: { readonly item: BrowsableSurah }) => (
      <PressableScale
        onPress={() => onOpen({ surah: item.number, startAyah: 1, endAyah: 1 })}
        accessibilityRole="button"
        accessibilityLabel={
          item.name === null
            ? `Surah ${item.number}`
            : `Surah ${item.number}, ${item.name}${item.ayahCount === null ? '' : `, ${item.ayahCount} ayat`}`
        }
        style={[styles.row, { minHeight: minimumTouchTargetSize(), columnGap: dp(10) }]}
        testID={`faith-quran-selection-surah-${item.number}`}
      >
        <View style={styles.flex}>
          <ModuleText token="body" color={moduleNeutrals.textPrimary} numberOfLines={1}>
            {item.name === null ? `Surah ${item.number}` : `${item.number}. ${item.name}`}
          </ModuleText>
          <ModuleText token="caption" numberOfLines={1}>
            {[item.meaning, item.ayahCount === null ? null : `${item.ayahCount} ayat`]
              .filter((part): part is string => part !== null)
              .join(' • ')}
          </ModuleText>
        </View>
        <AppIcon name="chevron-forward" size={dp(20)} color={EMERALD_DEEP} />
      </PressableScale>
    ),
    [dp, onOpen],
  );

  return (
    <FlatList
      data={matches}
      keyExtractor={(item) => String(item.number)}
      ListHeaderComponent={header}
      renderItem={renderRow}
      ItemSeparatorComponent={Divider}
      ListEmptyComponent={
        loading ? null : (
          <ModuleCard testID="faith-quran-selection-empty">
            <ModuleText token="cardTitle" numberOfLines={2}>
              {source === 'none'
                ? 'The surah list is not on this device yet'
                : 'Nothing matched that'}
            </ModuleText>
            <ModuleText token="caption" numberOfLines={4}>
              {source === 'none'
                ? 'Open the Qur’an once with a connection and the list is kept for browsing offline afterwards.'
                : 'Try a surah name, a number from 1 to 114, a reference like 2:255, or words you remember.'}
            </ModuleText>
          </ModuleCard>
        )
      }
      showsVerticalScrollIndicator={false}
      initialNumToRender={12}
      windowSize={5}
      removeClippedSubviews
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ paddingBottom: dp(moduleLayout.scrollBottomInset) }}
      testID="faith-quran-selection-surahs"
    />
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Picking the range
// ─────────────────────────────────────────────────────────────────────────────

function RangePicker({
  initial,
  onBack,
}: {
  readonly initial: QuranSelectionRef;
  readonly onBack: () => void;
}) {
  const { dp, type } = useModuleMetrics();
  const router = useRouter();
  const selections = useQuranSelections();
  const tasbih = useTasbih();
  const { surahs } = useCachedSurahNames();

  const [start, setStart] = useState(initial.startAyah);
  const [end, setEnd] = useState(initial.endAyah);
  const [note, setNote] = useState('');
  /**
   * The id of the selection the last successful save produced, or `null`.
   *
   * ── Why an id rather than a boolean ────────────────────────────────────────
   * "Saved" has to stop being true the moment the range changes, and a boolean needs an effect to
   * clear it — `setState` inside an effect, which cascades a render and which the lint rule rejects
   * for exactly that reason. Holding *what* was saved makes the question derivable: the confirmation
   * shows when the id of the range on screen is the id that was written.
   */
  const [savedId, setSavedId] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  /*
    The endpoints are re-ordered rather than constrained, so dragging the last verse below the first
    is a range the user can see rather than a control that stops responding.
  */
  const ordered = orderRange(start, end);
  const ref: QuranSelectionRef = {
    surah: initial.surah,
    startAyah: ordered.start,
    endAyah: ordered.end,
  };

  const surah = surahs.find((item) => item.number === initial.surah);
  const ayahCount = selections.surahIndex.get(initial.surah) ?? surah?.ayahCount ?? null;
  const fault = selections.check(ref);
  const resolution = selections.resolve(ref);
  const reference = selectionReferenceLabel(ref);
  const currentId = selectionIdFor(ref);
  /* Either this range is in the store, or this render is the one that just put it there. */
  const saved = selections.isSaved(ref) || savedId === currentId;

  const save = useCallback(async () => {
    const outcome = await selections.save(ref, note);
    if (outcome.kind === 'saved') {
      setSavedId(outcome.selection.id);
      setFailure(null);
      return true;
    }
    setFailure(
      outcome.reason === 'limit-reached'
        ? 'You have reached the number of selections this device keeps. Remove one from Duas to make room.'
        : 'That could not be saved to this device. Sign in and try again.',
    );
    return false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selections, note, ref.surah, ref.startAyah, ref.endAyah]);

  /*
    Not named `use…`: a function starting with `use` is a hook by convention and by lint, and this is
    an event handler that happens to be about the Tasbih screen.
  */
  const sendToTasbih = useCallback(async () => {
    if (!(await save())) {
      return;
    }
    const id = selectionIdFor(ref);
    await selections.markUsed(id);
    /*
      The counter is started with a *starting* target only. If this selection has been counted before
      it resumes exactly where it was left — see `TasbihRepository.startSession` — because coming
      back to something you were part-way through must not zero it.
    */
    await tasbih.chooseCounter(id);
    router.push(faithRoutes.tasbih);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [save, selections, tasbih, router, ref.surah, ref.startAyah, ref.endAyah]);

  return (
    <View style={{ rowGap: dp(12) }}>
      <ModuleCard testID="faith-quran-selection-range">
        <View style={{ rowGap: dp(10) }}>
          <View>
            <ModuleText token="cardTitle" numberOfLines={2}>
              {surah?.name === null || surah === undefined
                ? `Surah ${initial.surah}`
                : `${initial.surah}. ${surah.name}`}
            </ModuleText>
            <ModuleText token="caption" numberOfLines={2}>
              {ayahCount === null
                ? 'Choose one verse, or a run of verses next to each other.'
                : `${ayahCount} verses. Choose one, or up to ${MAX_SELECTION_AYAT} next to each other.`}
            </ModuleText>
          </View>

          <Stepper
            label="First verse"
            value={start}
            max={ayahCount}
            onChange={setStart}
            testID="faith-quran-selection-start"
          />
          <Stepper
            label="Last verse"
            value={end}
            max={ayahCount}
            onChange={setEnd}
            testID="faith-quran-selection-end"
          />

          {fault === null ? null : (
            <ModuleText
              token="caption"
              color={moduleNeutrals.textPrimary}
              numberOfLines={3}
              testID="faith-quran-selection-fault"
            >
              {selectionFaultMessage(fault)}
            </ModuleText>
          )}
        </View>
      </ModuleCard>

      <ModuleCard testID="faith-quran-selection-preview">
        <QuranSelectionView
          resolution={resolution}
          reference={reference}
          showAttribution
          testID="faith-quran-selection-preview-body"
        />
      </ModuleCard>

      <ModuleCard testID="faith-quran-selection-note">
        <View style={{ rowGap: dp(6) }}>
          <ModuleText token="cardTitle" numberOfLines={1}>
            Your own note
          </ModuleText>
          {/*
            Optional, private, and credited to nobody. It is a reminder to the person who wrote it —
            the same thing a personal counter label is — and NoorLife makes no claim about it.
          */}
          <ModuleText token="caption" numberOfLines={2}>
            Only you see this. NoorLife makes no claim about what you write here.
          </ModuleText>
          <AppTextInput
            value={note}
            onChangeText={setNote}
            maxLength={MAX_SELECTION_LABEL_LENGTH}
            placeholder="Optional"
            placeholderTextColor={moduleNeutrals.textTertiary}
            accessibilityLabel="A private note about this selection"
            style={[
              styles.input,
              {
                borderRadius: dp(moduleLayout.radiusSmall),
                minHeight: minimumTouchTargetSize(),
                paddingHorizontal: dp(12),
                color: moduleNeutrals.textPrimary,
                fontSize: type('body').fontSize,
              },
            ]}
            testID="faith-quran-selection-note-input"
          />
        </View>
      </ModuleCard>

      {failure === null ? null : (
        <ModuleText
          token="body"
          color={moduleNeutrals.textPrimary}
          numberOfLines={3}
          testID="faith-quran-selection-save-failed"
        >
          {failure}
        </ModuleText>
      )}

      <View style={{ rowGap: dp(8) }}>
        <ActionButton
          label={saved ? 'Saved to your selections' : 'Save this selection'}
          icon={saved ? 'check' : 'bookmark'}
          filled
          disabled={fault !== null}
          onPress={() => void save()}
          testID="faith-quran-selection-save"
        />
        <ActionButton
          label="Use in Tasbih"
          icon="tasbih"
          disabled={fault !== null}
          onPress={() => void sendToTasbih()}
          testID="faith-quran-selection-use"
        />
        <ActionButton
          label="Read in Quran Reader"
          icon="quran"
          onPress={() => router.push(readerHref(ref.surah, ref.startAyah))}
          testID="faith-quran-selection-read"
        />
        <ActionButton
          label="Choose a different surah"
          icon="chevron-back"
          onPress={onBack}
          testID="faith-quran-selection-change-surah"
        />
      </View>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Controls
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One bounded verse-number control: minus, a typed value, plus.
 *
 * ── Why the text field is not the only input, and not absent either ────────
 * Typing is how somebody reaches verse 255 of Al-Baqarah without pressing a button 254 times, and
 * stepping is how they nudge a range by one without opening a keyboard over the preview they are
 * reading. Both, therefore. The field accepts digits only and is bounded on commit rather than on
 * keystroke, so a partially typed "25" on the way to "255" is not clamped to the surah's length
 * mid-entry.
 */
function Stepper({
  label,
  value,
  max,
  onChange,
  testID,
}: {
  readonly label: string;
  readonly value: number;
  /** The surah's length, when the device knows it. `null` leaves the upper bound to the range check. */
  readonly max: number | null;
  readonly onChange: (next: number) => void;
  readonly testID: string;
}) {
  const { dp, type } = useModuleMetrics();
  const [draft, setDraft] = useState<string | null>(null);

  const commit = (text: string): void => {
    const parsed = Number.parseInt(text.replace(/[^0-9]/g, ''), 10);
    setDraft(null);
    if (!Number.isInteger(parsed) || parsed < 1) {
      return;
    }
    onChange(max === null ? parsed : Math.min(parsed, max));
  };

  return (
    <View style={[styles.stepper, { columnGap: dp(8) }]} testID={testID}>
      <ModuleText
        token="body"
        color={moduleNeutrals.textPrimary}
        numberOfLines={1}
        style={styles.stepperLabel}
      >
        {label}
      </ModuleText>
      <View style={[styles.stepperControls, { columnGap: dp(4) }]}>
        <StepButton
          glyph="minus"
          label={`Decrease ${label.toLowerCase()}`}
          disabled={value <= 1}
          onPress={() => onChange(Math.max(1, value - 1))}
          testID={`${testID}-down`}
        />
        <AppTextInput
          value={draft ?? String(value)}
          onChangeText={setDraft}
          onBlur={() => commit(draft ?? String(value))}
          onSubmitEditing={() => commit(draft ?? String(value))}
          keyboardType="number-pad"
          returnKeyType="done"
          accessibilityLabel={`${label}, currently ${value}`}
          style={[
            styles.input,
            styles.stepperInput,
            {
              borderRadius: dp(moduleLayout.radiusSmall),
              minHeight: minimumTouchTargetSize(),
              minWidth: dp(56),
              color: moduleNeutrals.textPrimary,
              fontSize: type('body').fontSize,
            },
          ]}
          testID={`${testID}-input`}
        />
        <StepButton
          glyph="add"
          label={`Increase ${label.toLowerCase()}`}
          disabled={max !== null && value >= max}
          onPress={() => onChange(max === null ? value + 1 : Math.min(max, value + 1))}
          testID={`${testID}-up`}
        />
      </View>
    </View>
  );
}

function StepButton({
  glyph,
  label,
  disabled,
  onPress,
  testID,
}: {
  readonly glyph: 'minus' | 'add';
  readonly label: string;
  readonly disabled: boolean;
  readonly onPress: () => void;
  readonly testID: string;
}) {
  const { dp } = useModuleMetrics();
  const size = minimumTouchTargetSize();

  return (
    <PressableScale
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      hitSlop={minimumHitSlop(size)}
      style={[
        styles.stepButton,
        {
          width: size,
          height: size,
          borderRadius: dp(moduleLayout.radiusSmall),
          opacity: disabled ? 0.4 : 1,
        },
      ]}
      testID={testID}
    >
      <AppIcon name={glyph} size={dp(18)} color={moduleNeutrals.textPrimary} />
    </PressableScale>
  );
}

function ActionButton({
  label,
  icon,
  filled = false,
  disabled = false,
  onPress,
  testID,
}: {
  readonly label: string;
  readonly icon: 'check' | 'bookmark' | 'tasbih' | 'quran' | 'chevron-back';
  readonly filled?: boolean;
  readonly disabled?: boolean;
  readonly onPress: () => void;
  readonly testID: string;
}) {
  const { dp } = useModuleMetrics();

  return (
    <PressableScale
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      style={[
        styles.action,
        {
          minHeight: minimumTouchTargetSize(),
          borderRadius: dp(moduleLayout.radiusSmall),
          columnGap: dp(8),
          paddingHorizontal: dp(12),
          backgroundColor: filled ? EMERALD_DEEP : moduleNeutrals.surface,
          borderColor: filled ? EMERALD_DEEP : EMERALD,
          opacity: disabled ? 0.4 : 1,
        },
      ]}
      testID={testID}
    >
      <AppIcon name={icon} size={dp(18)} color={filled ? moduleNeutrals.surface : EMERALD_DEEP} />
      <ModuleText
        token="button"
        color={filled ? moduleNeutrals.surface : EMERALD_DEEP}
        numberOfLines={2}
        style={styles.flex}
      >
        {label}
      </ModuleText>
    </PressableScale>
  );
}

function SearchField({
  value,
  onChange,
  placeholder,
}: {
  readonly value: string;
  readonly onChange: (text: string) => void;
  readonly placeholder: string;
}) {
  const { dp, type } = useModuleMetrics();

  return (
    <View
      style={[
        styles.search,
        {
          borderRadius: dp(moduleLayout.radiusSmall),
          minHeight: minimumTouchTargetSize(),
          paddingHorizontal: dp(12),
          columnGap: dp(10),
        },
      ]}
    >
      <AppIcon name="search" size={dp(18)} color={moduleNeutrals.textSecondary} />
      <AppTextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={moduleNeutrals.textTertiary}
        /* Says all three ways in, including the one that used not to exist. */
        accessibilityLabel="Search by surah, reference, or words you remember"
        style={[
          styles.flex,
          {
            color: moduleNeutrals.textPrimary,
            fontSize: type('body').fontSize,
            paddingVertical: dp(10),
          },
        ]}
        testID="faith-quran-selection-search"
      />
    </View>
  );
}

function Divider() {
  return <View style={styles.divider} accessible={false} />;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { alignItems: 'center', flexDirection: 'row' },
  divider: { backgroundColor: moduleNeutrals.divider, height: StyleSheet.hairlineWidth },
  search: {
    alignItems: 'center',
    backgroundColor: moduleNeutrals.surface,
    borderColor: moduleNeutrals.border,
    borderWidth: 1,
    flexDirection: 'row',
  },
  input: {
    backgroundColor: moduleNeutrals.surface,
    borderColor: moduleNeutrals.border,
    borderWidth: 1,
  },
  /*
    Wrapping rather than one fixed row. At 320 dp with a 1.5x text setting the label and the three
    controls do not fit on one line, and wrapping puts the controls under the label instead of
    truncating a label that says which endpoint is being changed.
  */
  stepper: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', rowGap: 8 },
  stepperLabel: { flexGrow: 1, flexShrink: 1 },
  stepperControls: { alignItems: 'center', flexDirection: 'row' },
  stepperInput: { textAlign: 'center' },
  stepButton: {
    alignItems: 'center',
    backgroundColor: moduleNeutrals.surfaceMuted,
    justifyContent: 'center',
  },
  action: { alignItems: 'center', borderWidth: 1, flexDirection: 'row' },
});
