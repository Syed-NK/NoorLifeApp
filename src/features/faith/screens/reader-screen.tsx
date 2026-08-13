import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, View } from 'react-native';

import { PressableScale } from '@ds/components';
import { ModuleStatusBanner, ModuleText } from '@features/modules/components';
import {
  moduleLayout,
  moduleNeutrals,
  readerPageBackground,
} from '@features/modules/module-tokens';
import { useModuleTheme } from '@features/modules/module-context';
import { useModuleMetrics } from '@features/modules/use-module-metrics';

import { FaithResourceView, FaithScreen, FaithSuccessBanner } from '../components/faith-screen';
import { AyahActionSheet } from '../components/reader/ayah-action-sheet';
import { AyahBlock, type AyahBlockState } from '../components/reader/ayah-block';
import { createAyahFocusRegistry, type AyahFocusRegistry } from '../components/reader/ayah-focus';
import { shareVerse } from '../components/reader/verse-share';
import { ReaderHeader, SurahOpening, SurahPicker } from '../components/reader/reader-header';
import { ReaderPlayer } from '../components/reader/reader-player';
import { UnverifiedSourceNotice } from '../components/faith-states';
import type { SurahDownloadState } from '../data/audio';
import { hasData, type FaithResult } from '../data/faith-result';
import type {
  AyahRecitation,
  AyahText,
  AyahTranslation,
  SurahSummary,
} from '../data/quran-content.repository';
import { surahNumber } from '../data/quran-content.repository';
import { useFaithRepositories } from '../di/faith-repository-context';
import { useRecitationAudio } from '../di/recitation-audio-context';
import { faithAiHref, faithNavKeys, faithRoutes, readerHref } from '../faith-routes';
import { useNoteIndex } from '../hooks/use-ayah-note';
import { useBookmarkIndex } from '../hooks/use-bookmark';
import { toggleBookmark } from '../storage/faith-bookmarks';
import { verseKey } from '../storage/faith-notes';
import { useContinueReading } from '../hooks/use-continue-reading';
import { useFaithPreferences } from '../hooks/use-faith-preferences';
import { useTranslationPreference } from '../hooks/use-translation-preference';
import { useFaithResource } from '../hooks/use-faith-resource';
import { useReadingLog } from '../hooks/use-reading-log';
import { useSurahCatalogue } from '../hooks/use-surah-catalogue';
import { useRecitationPlayer, type RecitationTransport } from '../hooks/use-recitation-player';

/**
 * One verse as the reader renders it: the scripture, and its translation if one loaded.
 *
 * `translation` is nullable rather than defaulted to an empty string, so a missing translation
 * renders nothing instead of an empty paragraph the user might read as the verse having no meaning.
 */
type ReaderVerse = {
  readonly text: AyahText;
  readonly translation: AyahTranslation | null;
};

/**
 * One page of the reader, with the surah it belongs to and the cursor that continues it.
 *
 * The surah summary travels with the page because the reader has to be able to *cite* what it
 * displays — a verse without its surah is not a citation — and because `ayahCount` is what turns a
 * stored reading position into a fraction.
 */
type ReaderPage = {
  readonly surah: SurahSummary;
  readonly verses: readonly ReaderVerse[];
  readonly nextCursor: string | null;
  /** Why the chosen translation is missing, or `null` when it is not. */
  readonly translationFailure: TranslationFailure | null;
  /**
   * Recitation audio for the verses on this page, where any arrived.
   *
   * Empty is the ordinary case rather than a failure: a reciter may have none for a surah, and a URL
   * that failed the server's allow-list check is simply absent. The player exists only when this
   * list has an entry for the selected verse, which is correct in every one of those cases.
   */
  readonly recitations: readonly AyahRecitation[];
  readonly total?: number;
};

/**
 * Why the chosen translation did not arrive, in the two senses the user can act on differently.
 *
 * `edition-unavailable` means the stored edition id is not one the source offers — the user has to
 * pick another, and no amount of retrying will help. Everything else is a transient failure where
 * retrying is exactly the right advice.
 */
type TranslationFailure = 'edition-unavailable' | 'unavailable';

function translationStateOf(result: FaithResult<unknown>): TranslationFailure {
  return result.kind === 'error' && result.code === 'not-found'
    ? 'edition-unavailable'
    : 'unavailable';
}

/** The surah's name, for the docked player, which renders outside the resource view. */
function surahNameOf(resource: {
  readonly status: string;
  readonly result?: FaithResult<ReaderPage>;
}): string {
  const result = resource.result;
  return result !== undefined && hasData(result) ? result.data.surah.name : 'Recitation';
}

function ayahCountOf(resource: {
  readonly status: string;
  readonly result?: FaithResult<ReaderPage>;
}): number {
  const result = resource.result;
  return result !== undefined && hasData(result) ? result.data.surah.ayahCount : 0;
}

/**
 * Whether the reader has a page to read, which is what decides that the player is mounted.
 *
 * The player is not conditional on audio existing, on a verse having been chosen or on anything
 * having been pressed. It appears when there is a surah on screen, because that is the moment the
 * user can meaningfully ask for it to play — and every state after that, including "this reciter
 * has no recording of this surah", is a state the player itself states.
 */
function hasPage(resource: {
  readonly status: string;
  readonly result?: FaithResult<ReaderPage>;
}): boolean {
  return resource.result !== undefined && hasData(resource.result);
}

/** The verse the player names before anything is selected — the deep link's, or the page's first. */
function openingAyahOf(
  resource: { readonly status: string; readonly result?: FaithResult<ReaderPage> },
  highlightAyah: number | null,
): number {
  const result = resource.result;
  const first =
    result !== undefined && hasData(result) ? (result.data.verses[0]?.text.ayah ?? 1) : 1;
  return highlightAyah ?? first;
}

/** Verses loaded after the first page, tagged with the request they belong to. */
type AppendedPages = {
  readonly key: string;
  readonly verses: readonly ReaderVerse[];
  readonly nextCursor: string | null;
};

/**
 * Pairs a page of scripture with the matching translations.
 *
 * Joined by ayah number, which is the only join available and the right one: it keeps `AyahText` and
 * `AyahTranslation` as separate objects all the way to the render, so a translation can never be
 * mistaken for the verse.
 */
function joinVerses(
  text: readonly AyahText[],
  translations: readonly AyahTranslation[],
): readonly ReaderVerse[] {
  return text.map((item) => ({
    text: item,
    translation: translations.find((entry) => entry.ayah === item.ayah) ?? null,
  }));
}

/**
 * The surah asked for in the route, or `null` when the segment is not one.
 *
 * Expo Router hands back a string or an array of them, and neither is guaranteed to be a number a
 * surah exists at. Parsing here rather than trusting the segment means a hand-typed
 * `/faith/reader/999` renders a not-found state instead of throwing out of `surahNumber`.
 */
export function parseSurahParam(value: string | string[] | undefined): number | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw === undefined) {
    return null;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 114 ? parsed : null;
}

export function parseAyahParam(value: string | string[] | undefined): number | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw === undefined) {
    return null;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : null;
}

/**
 * The reader.
 *
 * ── What changed, and the shape it changed to ───────────────────────────────
 * It used to be a list of cards: every ayah in a white rounded rectangle with its own play button,
 * and a transport bar that scrolled away with the content. That is a records list, not a reading
 * experience, and it put 286 playback controls on a screen that has exactly one player.
 *
 * It is now a continuous column — hairline dividers, no card chrome, scripture at 22sp with the
 * translation directly beneath it — and playback lives in one place: the docked player, which is
 * pinned above bottom navigation and whose measured height is added to the scroll padding so it can
 * never cover the last ayah.
 *
 * ── The player is mounted with the page, not with the playback ──────────────
 * The second correction. The transport used to appear only once a verse had been chosen, which made
 * the reader's own audio controls something you had to discover through a verse's overflow menu.
 * It is now docked as soon as the first ayah has loaded, showing the surah, the opening verse, the
 * reciter and every control, in every playback state — see `QuranAudioPlayer`.
 */
export function ReaderScreen() {
  const router = useRouter();
  const { dp } = useModuleMetrics();
  const { quran } = useFaithRepositories();
  const audio = useRecitationAudio();
  const { preferences, ready: preferencesReady } = useFaithPreferences();
  const {
    translation,
    ready: translationReady,
    status: translationStatus,
  } = useTranslationPreference();
  const { save } = useContinueReading();
  const { log: readingLog, record } = useReadingLog();
  const params = useLocalSearchParams<{ surah?: string; ayah?: string }>();
  const [saved, setSaved] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  /**
   * The verse whose action sheet is open — the **selected** verse, and the whole verse rather than
   * its number.
   *
   * It used to be an ayah number, which was enough while the sheet only offered playback and a
   * save. It is not enough now: Share has to carry the Arabic, the translation and the translator,
   * and re-deriving those from a number would mean searching the loaded pages at the moment of the
   * tap. Holding the verse the user actually pressed is both simpler and impossible to get wrong.
   *
   * Being selected is a state on its own and starts nothing. See `AyahActionSheet` for why.
   */
  const [selected, setSelected] = useState<ReaderVerse | null>(null);

  /** Bookmarks and notes for the whole page, read once each rather than once per verse. */
  const bookmarks = useBookmarkIndex('ayah');
  const notes = useNoteIndex();

  /** Where each verse parks its pill, so focus can return to it when the sheet closes. */
  const focusRegistry = useMemo(() => createAyahFocusRegistry(), []);

  const surah = parseSurahParam(params.surah);
  const highlightAyah = parseAyahParam(params.ayah);
  const translationId = translation?.id ?? null;
  const reciterId = preferences.reciterId;

  /**
   * `null` until every input to the request is known — not merely plausible.
   *
   * Keying on the translation while it was still being decided fetched the surah twice: once against
   * an unresolved edition and again the moment one was chosen. Worse than the wasted request, the
   * second fetch put `FaithResourceView` back into its loading branch, so a reader that had already
   * drawn a page of verses flashed back to a skeleton.
   *
   * A failed *resolution* is still not waited on: it settles, the reader proceeds with no edition,
   * and the Arabic renders with an honest note where the meaning would be — scripture does not
   * depend on a translation being available.
   */
  const readerKey =
    translationStatus === 'resolving' || !preferencesReady || !translationReady
      ? null
      : `quran.reader.${surah ?? 'none'}.${translationId ?? 'unresolved'}.${reciterId}`;

  /**
   * Pages fetched after the first, tagged with the request they belong to.
   *
   * Tagging rather than clearing in an effect: changing the surah or the translation gives a new
   * key, and a mismatched tag is discarded on the very next render.
   */
  const [appended, setAppended] = useState<AppendedPages | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreFailed, setMoreFailed] = useState(false);

  /**
   * The 114 surahs, for the header's picker.
   *
   * The same hook Qur'an home uses, so it is answered from the store the app hydrated at startup.
   * The reader never waits on it: `onOpenPicker` is `null` until it settles, which removes the caret
   * rather than opening an empty sheet.
   */
  const catalogue = useSurahCatalogue();
  const surahList =
    catalogue.status === 'settled' && hasData(catalogue.result) ? catalogue.result.data : null;

  /**
   * The reciter's name, for the player.
   *
   * Its own resource rather than part of the page: a name is a courtesy the player degrades without,
   * and folding it into the page request would mean a catalogue failure costing the verses.
   */
  const reciters = useFaithResource(
    'faith.reader.reciters',
    useCallback(() => quran.availableReciters(), [quran]),
  );
  const reciterName =
    reciters.status === 'settled' && hasData(reciters.result)
      ? (reciters.result.data.find((entry) => entry.id === reciterId)?.name ?? null)
      : null;

  const ayat = useFaithResource(
    readerKey,
    useCallback(async (): Promise<FaithResult<ReaderPage>> => {
      if (surah === null) {
        return { kind: 'error', code: 'not-found' };
      }
      const number = surahNumber(surah);
      /**
       * The summary is requested alongside the verses rather than after them. It is needed to render
       * the header and to compute reading progress, and requesting it afterwards would serialise a
       * cached read behind a network one.
       */
      const [summary, text, translated, recited] = await Promise.all([
        quran.getSurah(number),
        quran.listAyahs(number),
        /*
          With no resolved edition there is nothing to ask for, and asking with a guessed id is what
          produced a reader full of untranslated verses. The page still renders — scripture needs no
          translation — and `translationFailure` below says why the meaning is absent.
        */
        translationId === null
          ? Promise.resolve({ kind: 'empty' as const })
          : quran.listTranslations(number, translationId),
        quran.listRecitations(number, reciterId),
      ]);

      if (!hasData(summary)) {
        return summary;
      }
      if (!hasData(text)) {
        return text;
      }
      const translations = hasData(translated)
        ? translated.data.items
        : ([] as readonly AyahTranslation[]);

      /**
       * A translation that could not be fetched is reported, never silently dropped.
       *
       * The reader used to render the Arabic alone in this case, which reads as "this verse has no
       * translation" — a statement about the *text* rather than about a request that failed.
       *
       * `empty` is excluded deliberately: it means the edition genuinely has no rendering for this
       * surah, which is a fact about the edition and not a failure.
       */
      const translationFailure =
        hasData(translated) || translated.kind === 'empty' ? null : translationStateOf(translated);

      return {
        kind: 'ok' as const,
        data: {
          surah: summary.data,
          verses: joinVerses(text.data.items, translations),
          nextCursor: text.data.nextCursor,
          translationFailure,
          recitations: hasData(recited) ? recited.data.items : [],
          ...(text.data.total === undefined ? {} : { total: text.data.total }),
        },
      };
    }, [quran, surah, translationId, reciterId]),
  );

  const loaded = appended !== null && appended.key === readerKey ? appended : null;

  /**
   * Fetches the next page and appends it.
   *
   * A failure here is deliberately **not** an error screen: the verses already on screen are correct
   * and still worth reading, so a failed continuation shows a retry line beneath them rather than
   * replacing them with a failure state.
   */
  const loadMore = useCallback(
    async (cursor: string) => {
      if (surah === null || readerKey === null) {
        return;
      }
      const number = surahNumber(surah);
      setLoadingMore(true);
      setMoreFailed(false);
      const [text, translated] = await Promise.all([
        quran.listAyahs(number, { cursor }),
        translationId === null
          ? Promise.resolve({ kind: 'empty' as const })
          : quran.listTranslations(number, translationId, { cursor }),
      ]);
      setLoadingMore(false);

      if (!hasData(text)) {
        setMoreFailed(true);
        return;
      }
      const translations =
        translated.kind === 'ok' ? translated.data.items : ([] as readonly AyahTranslation[]);
      setAppended((current) => {
        const existing = current !== null && current.key === readerKey ? current.verses : [];
        return {
          key: readerKey,
          verses: [...existing, ...joinVerses(text.data.items, translations)],
          nextCursor: text.data.nextCursor,
        };
      });
    },
    [quran, surah, translationId, readerKey],
  );

  /**
   * Every recitation currently on screen.
   *
   * The transport's next/previous walk this list, so a page loaded after the first has to be in it —
   * otherwise "next verse" would stop at verse 20 of a 286-verse surah with no explanation.
   */
  const recitations = useMemo(
    () => (ayat.status === 'settled' && hasData(ayat.result) ? ayat.result.data.recitations : []),
    [ayat],
  );

  /**
   * The transport, owned here rather than inside the body.
   *
   * The player is docked, which means it is passed to `FaithScreen` and rendered *above*
   * `FaithResourceView`. A transport created inside the body would be a different instance from the
   * one the docked player was drawing, so the player would show audio nobody was listening to.
   */
  const transport = useRecitationPlayer(recitations);

  /** The download state of this surah for this reciter, re-read as the download progresses. */
  const [downloadTick, setDownloadTick] = useState(0);
  const downloadState: SurahDownloadState = useMemo(
    () => (surah === null ? { kind: 'stream-only' } : audio.stateFor(reciterId, surah)),
    // `downloadTick` is the dependency that makes this re-read: the service's state is mutable and
    // is not React state, so a bump is how a completed transfer reaches the render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [audio, reciterId, surah, downloadTick],
  );

  const downloadSurah = useCallback(() => {
    if (surah === null || recitations.length === 0) {
      return;
    }
    void (async () => {
      await audio.downloadSurah(reciterId, surah, recitations, () =>
        setDownloadTick((tick) => tick + 1),
      );
      setDownloadTick((tick) => tick + 1);
    })();
    setDownloadTick((tick) => tick + 1);
  }, [audio, reciterId, surah, recitations]);

  const cancelDownload = useCallback(() => {
    if (surah !== null) {
      audio.cancelDownload(reciterId, surah);
      setDownloadTick((tick) => tick + 1);
    }
  }, [audio, reciterId, surah]);

  /**
   * Where each verse sits inside the scroll content, and the handle that moves it.
   *
   * A ref rather than state: these offsets are written by every verse's `onLayout` and read only
   * when a scroll is performed, so holding them in state would re-render the whole reader on every
   * layout pass for a value nothing displays.
   */
  const ayahOffsets = useRef(new Map<number, number>());
  const scrollRef = useRef<ScrollView | null>(null);
  const followedAyah = useRef<number | null>(null);

  const rememberAyahOffset = useCallback((ayah: number, y: number) => {
    ayahOffsets.current.set(ayah, y);
  }, []);

  /**
   * Brings the verse the player is pointed at into view.
   *
   * ── What moves the view, and what deliberately does not ─────────────────────
   * This follows `transport.focus`, which changes only when the transport is *told* to move: audio
   * advancing to the next verse, a press on next or previous, or a verse chosen from its own menu.
   * Reading does not move it, a re-render does not move it, and a status tick does not move it.
   *
   * `followedAyah` records which verse has already been scrolled to, so a bookmark toggle, a page
   * append or a buffering update cannot yank the view back to where the player is. Without it the
   * reader would fight anyone who scrolled away while listening, which is a legitimate thing to do.
   *
   * The first focus is recorded without scrolling. The player is pointed at verse one from the
   * moment the reader opens, and honouring that as a movement would scroll a freshly-opened surah
   * past its own title.
   */
  const focusedAyah = transport.focus?.ayah ?? null;
  useEffect(() => {
    if (focusedAyah === null) {
      followedAyah.current = null;
      return;
    }
    if (followedAyah.current === focusedAyah) {
      return;
    }
    if (followedAyah.current === null) {
      // Arrival, not a movement. See the note above.
      followedAyah.current = focusedAyah;
      return;
    }
    const offset = ayahOffsets.current.get(focusedAyah);
    if (offset === undefined) {
      // Not laid out yet — a verse on a page that has not rendered. Leaving the record unset means
      // the scroll is retried on the next commit, once the offset exists.
      return;
    }
    followedAyah.current = focusedAyah;
    scrollRef.current?.scrollTo({ y: Math.max(offset - 12, 0), animated: true });
  }, [focusedAyah]);

  const recitationFor = useCallback(
    (ayah: number): AyahRecitation | null =>
      recitations.find((entry) => entry.ayah === ayah) ?? null,
    [recitations],
  );

  /**
   * A deep link's verse points the player at itself, once.
   *
   * A bookmark opened at 2:255 should find the player already on 2:255 rather than on verse one —
   * the whole point of arriving there is that this is the verse in hand. It starts nothing:
   * `focusOn` moves the label and what Play will play, and nothing else.
   *
   * Guarded by a ref rather than by an effect dependency, because the recitation list is rebuilt
   * whenever the page is re-fetched and a dependency on it would re-point the player — undoing a
   * choice the user made in the meantime — every time a translation changed.
   */
  const deepLinkedAyah = useRef<number | null>(null);
  const focusOn = transport.focusOn;
  useEffect(() => {
    if (highlightAyah === null || deepLinkedAyah.current === highlightAyah) {
      return;
    }
    const recitation = recitations.find((entry) => entry.ayah === highlightAyah);
    if (recitation === undefined) {
      return;
    }
    deepLinkedAyah.current = highlightAyah;
    focusOn(recitation);
  }, [highlightAyah, recitations, focusOn]);

  /**
   * The furthest verse the reading log has recorded in this surah, or 0.
   *
   * Read here rather than inside the sheet so the sheet can be told whether the verse is already
   * read without owning the log — and so "already read" is answered from the same record the write
   * goes to, instead of from a second guess at it.
   */
  const furthestRead = surah === null ? 0 : (readingLog.furthest[String(surah)] ?? 0);

  /**
   * Records that the user read up to a verse — the reader's one and only reading write.
   *
   * ── Reading is a deliberate act, and this is the act ────────────────────────
   * It is reached from exactly one place: pressing **Read** in a verse's action sheet. Rendering a
   * verse does not call it, scrolling past one does not call it, and *opening the sheet* does not
   * call it — the last of those is the whole reason "selected" exists as a state distinct from
   * "read". See `faith-reading-log.ts` for why the furthest-position rule is the one being applied.
   *
   * Pressing it a second time on the same verse writes nothing. `applyReading` returns `added: 0`
   * for a verse at or behind the furthest position, so progress cannot be inflated by repetition —
   * and the confirmation says so instead of claiming a second advance.
   */
  const markRead = useCallback(
    (page: ReaderPage, ayah: number) => {
      const already = (readingLog.furthest[String(page.surah.number)] ?? 0) >= ayah;
      void (async () => {
        await save({
          surah: page.surah.number,
          surahName: page.surah.name,
          ayah,
          ayahCount: page.surah.ayahCount,
        });
        await record(page.surah.number, ayah);
        setSaved(
          already
            ? `${page.surah.name} verse ${ayah} was already recorded as read.`
            : `Marked ${page.surah.name} verse ${ayah} as read.`,
        );
      })();
    },
    [save, record, readingLog],
  );

  /** The page currently loaded, where there is one. The sheet's actions need it by identity. */
  const page = ayat.status === 'settled' && hasData(ayat.result) ? ayat.result.data : null;

  /**
   * Closing the sheet returns the screen reader to the verse it was opened from.
   *
   * Without it TalkBack falls back to the top of the screen, so dismissing the sheet on verse 210
   * puts the user back at the surah header. See `ayah-focus.ts`.
   */
  const closeActions = useCallback(() => {
    const ayah = selected?.text.ayah ?? null;
    setSelected(null);
    if (ayah !== null) {
      focusRegistry.focus(ayah);
    }
  }, [selected, focusRegistry]);

  const toggleSelectedBookmark = useCallback(() => {
    if (selected === null || page === null) {
      return;
    }
    const { text, translation } = selected;
    void toggleBookmark(
      {
        kind: 'ayah',
        id: `${text.surah}:${text.ayah}`,
        /** Carries the surah's name so the Bookmarks screen can cite it without a lookup. */
        label: `${page.surah.name} ${text.surah}:${text.ayah}`,
        subtitle: translation?.text ?? '',
      },
      new Date().toISOString(),
    ).then(() => bookmarks.refresh());
  }, [selected, page, bookmarks]);

  const shareSelected = useCallback(() => {
    if (selected === null || page === null) {
      return;
    }
    void shareVerse({
      surahName: page.surah.name,
      text: selected.text,
      translation: selected.translation,
    }).then((outcome) => {
      if (outcome === 'failed') {
        setSaved('The share sheet could not be opened.');
      }
    });
  }, [selected, page]);

  return (
    <FaithScreen
      title="Reader"
      activeKey={faithNavKeys.quran}
      scrollRef={scrollRef}
      /**
       * The reader's own ivory ground, rather than the cool page background every other module
       * screen sits on. The one screen in the app that is a reading column instead of a column of
       * cards — see `readerPageBackground` for the measured text contrast against it.
       */
      background={readerPageBackground}
      /**
       * The player, docked from the moment there is a page — and `undefined` before that.
       *
       * ── Why it is no longer conditional on playback ─────────────────────────────
       * It used to render only once a verse had been selected, so opening a surah showed no
       * transport at all and the only way to reach one was a verse's overflow menu. The controls of
       * the thing the reader had come to listen to were two taps and a mode change away, and the
       * first of those taps landed on a strip that looked nothing like the player it produced.
       *
       * The one remaining condition is a page: the scaffold measures whatever it is given and
       * reserves that height, so docking a panel over a loading skeleton would reserve space under
       * a screen that has nothing to scroll.
       */
      docked={
        hasPage(ayat) ? (
          <ReaderPlayer
            transport={transport}
            surahName={surahNameOf(ayat)}
            ayah={openingAyahOf(ayat, highlightAyah)}
            reciterName={reciterName}
            totalAyat={ayahCountOf(ayat)}
            download={downloadState}
            onDownloadSurah={downloadSurah}
            onCancelDownload={cancelDownload}
            onOpenReciters={() => router.push(faithRoutes.reciters)}
          />
        ) : undefined
      }
      testID="faith-reader"
    >
      <View style={{ rowGap: dp(moduleLayout.cardGap) }}>
        {saved === null ? null : (
          <FaithSuccessBanner
            message={saved}
            onDismiss={() => setSaved(null)}
            testID="faith-reader"
          />
        )}

        <FaithResourceView
          resource={ayat}
          empty={{
            title: 'No text for this surah yet',
            body: 'There is nothing to show for this surah. Go back and choose another.',
            actionLabel: 'Back to surahs',
          }}
          loadingRows={4}
          testID="faith-reader-body"
        >
          {(loadedPage) => (
            <ReaderBody
              page={loadedPage}
              appended={loaded}
              loadingMore={loadingMore}
              moreFailed={moreFailed}
              highlightAyah={highlightAyah}
              transport={transport}
              selectedAyah={selected?.text.ayah ?? null}
              bookmarkedIds={bookmarks.ids}
              noteKeys={notes.keys}
              furthestRead={furthestRead}
              focusRegistry={focusRegistry}
              hasCatalogue={surahList !== null}
              onOpenPicker={() => setPickerOpen(true)}
              onOpenInfo={() => router.push(faithRoutes.contentInfo)}
              onOpenSettings={() => router.push(faithRoutes.preferences)}
              onAyahLayout={rememberAyahOffset}
              onLoadMore={loadMore}
              /**
               * Pressing a verse selects it and opens its sheet. It starts nothing, marks nothing
               * and moves the player nowhere — see `AyahActionSheet` for why that restraint is the
               * point rather than an omission.
               */
              onSelect={setSelected}
            />
          )}
        </FaithResourceView>
      </View>

      {/*
        The verse's own actions, as a modal sheet over the reading column.

        Deliberately not docked: the dock belongs to the player, which is permanent, and a sheet
        that shared it would move the transport every time a verse's actions opened.
      */}
      {selected === null || page === null ? null : (
        <AyahActionSheet
          surahName={page.surah.name}
          surah={selected.text.surah}
          ayah={selected.text.ayah}
          canPlay={recitationFor(selected.text.ayah) !== null}
          bookmarked={bookmarks.ids.has(`${selected.text.surah}:${selected.text.ayah}`)}
          read={furthestRead >= selected.text.ayah}
          reciterId={reciterId}
          /**
           * Play points the **one** player at this verse and starts it.
           *
           * There is no second player and no second entry point into playback: this calls the same
           * `transport` the docked panel draws, so the label, the active green and the audio are
           * three views of one selection rather than three things that have to be kept in step.
           */
          onPlay={() => {
            const recitation = recitationFor(selected.text.ayah);
            if (recitation !== null) {
              transport.play(recitation);
            }
          }}
          onRead={() => markRead(page, selected.text.ayah)}
          onToggleBookmark={toggleSelectedBookmark}
          onAskNoorAI={() => router.push(faithAiHref(selected.text.surah, selected.text.ayah))}
          onShare={shareSelected}
          onNotesChanged={notes.refresh}
          onDismiss={closeActions}
        />
      )}

      {pickerOpen && surahList !== null && surah !== null ? (
        <SurahPicker
          surahs={surahList}
          currentSurah={surah}
          onSelect={(next) => {
            setPickerOpen(false);
            /*
              `replace`, not `push`. Pushing would stack a reader on a reader, so Back from the
              seventh surah a user browsed would walk them through the previous six.
            */
            router.replace(readerHref(next));
          }}
          onDismiss={() => setPickerOpen(false)}
        />
      ) : null}
    </FaithScreen>
  );
}

/**
 * Which of the three verse states one ayah is in — the single place the distinction is decided.
 *
 * ── The three are not the same fact, and merging them is the defect ─────────
 *   **active**   the verse being recited *right now*: the transport has it loaded **and** the
 *                platform reports it playing. Pausing therefore drops out of `active` immediately,
 *                which is the point — a paused player that kept the recitation's own green would be
 *                telling the user audio is coming out of the phone when none is.
 *   **selected** the verse whose action sheet is open. It means *the user pressed this*, and it
 *                deliberately means nothing else: no playback, no reading, no move of the player.
 *   **focused**  the verse the player is pointed at while idle, paused, or stepped to — including
 *                the verse a deep link opened at, which is pointed at on arrival. This is the
 *                paused state as well as the idle one, so a pause leaves the verse clearly marked
 *                rather than unmarked.
 *
 * `highlightAyah` is folded into `focused` rather than drawing a fourth thing. A deep link points
 * the player at its verse the moment the page loads, so "where the route opened" and "what the
 * player is aimed at" are already the same verse; the marginal rule that used to be drawn for it
 * separately was the second vertical mark in the column the correction removes.
 */
export function verseState({
  ayah,
  transport,
  selectedAyah,
  highlightAyah,
}: {
  readonly ayah: number;
  readonly transport: RecitationTransport;
  readonly selectedAyah: number | null;
  readonly highlightAyah: number | null;
}): AyahBlockState {
  if (transport.playing && transport.current?.ayah === ayah) {
    return 'active';
  }
  if (selectedAyah === ayah) {
    return 'selected';
  }
  if (transport.focus?.ayah === ayah || highlightAyah === ayah) {
    return 'focused';
  }
  return 'idle';
}

/** Split out so the branches above stay readable, and so `useMemo` is not called conditionally. */
function ReaderBody({
  page,
  appended,
  highlightAyah,
  loadingMore,
  moreFailed,
  transport,
  selectedAyah,
  bookmarkedIds,
  noteKeys,
  furthestRead,
  focusRegistry,
  hasCatalogue,
  onOpenPicker,
  onOpenInfo,
  onOpenSettings,
  onAyahLayout,
  onLoadMore,
  onSelect,
}: {
  readonly page: ReaderPage;
  readonly appended: AppendedPages | null;
  readonly highlightAyah: number | null;
  readonly loadingMore: boolean;
  readonly moreFailed: boolean;
  readonly transport: RecitationTransport;
  /** The verse whose action sheet is open, if any. */
  readonly selectedAyah: number | null;
  readonly bookmarkedIds: ReadonlySet<string>;
  readonly noteKeys: ReadonlySet<string>;
  /** The furthest verse the reading log has recorded in this surah. Announced, never drawn. */
  readonly furthestRead: number;
  readonly focusRegistry: AyahFocusRegistry;
  readonly hasCatalogue: boolean;
  readonly onOpenPicker: () => void;
  /** Where the source, the edition and the licence are stated. */
  readonly onOpenInfo: () => void;
  readonly onOpenSettings: () => void;
  /** Records where each verse sits, so the reciting one can be scrolled into view. */
  readonly onAyahLayout: (ayah: number, y: number) => void;
  readonly onLoadMore: (cursor: string) => void;
  readonly onSelect: (verse: ReaderVerse) => void;
}) {
  const { dp } = useModuleMetrics();

  const items = useMemo(
    () => [...page.verses, ...(appended?.verses ?? [])],
    [page.verses, appended],
  );

  /**
   * The cursor of the last page actually loaded. `appended` wins when it exists, because it
   * describes where the reader has got to; the first page's cursor is where it started.
   */
  const nextCursor = appended === null ? page.nextCursor : appended.nextCursor;

  /**
   * The translation actually on screen, for the attribution line.
   *
   * Read from the first verse that has one rather than from preferences: preferences say what was
   * *asked for*, and an attribution has to describe what *arrived*.
   */
  const translation = items.find((item) => item.translation !== null)?.translation ?? null;

  return (
    <View>
      <ReaderHeader
        surah={page.surah}
        shown={items.length}
        highlightAyah={highlightAyah}
        onOpenPicker={hasCatalogue ? onOpenPicker : null}
        onOpenInfo={onOpenInfo}
        onOpenSettings={onOpenSettings}
      />

      <UnverifiedSourceNotice
        source={items[0]?.text.source ?? { name: 'Unknown', verified: false }}
        testID="faith-reader"
      />

      {page.translationFailure === null ? null : (
        <TranslationUnavailable failure={page.translationFailure} />
      )}

      {/*
        The translator, once, at the top of the reading column.

        Repeated under 286 ayat it would become furniture and a reader would stop seeing it by verse
        three; omitted entirely it would leave an attributed translation unattributed. Once, where
        the reading starts, is the only placement that is both honest and legible.
      */}
      {translation === null ? null : <TranslationCredit translation={translation} />}

      <SurahOpening surah={page.surah} />

      {items.map((item) => (
        <View
          key={`${item.text.surah}:${item.text.ayah}`}
          /**
           * Each verse records where it sits, so the reciting one can be brought into view.
           * Measuring on layout rather than on demand keeps the scroll synchronous — a
           * `measureLayout` round trip at the moment a verse starts would land a frame or two late,
           * which reads as a lurch rather than a follow.
           */
          onLayout={(event) => onAyahLayout(item.text.ayah, event.nativeEvent.layout.y)}
        >
          <AyahBlock
            surahName={page.surah.name}
            text={item.text}
            translation={item.translation}
            state={verseState({
              ayah: item.text.ayah,
              transport,
              selectedAyah,
              highlightAyah,
            })}
            bookmarked={bookmarkedIds.has(`${item.text.surah}:${item.text.ayah}`)}
            read={furthestRead >= item.text.ayah}
            hasNote={noteKeys.has(verseKey(item.text.surah, item.text.ayah))}
            focusRegistry={focusRegistry}
            onOpenActions={() => onSelect(item)}
          />
        </View>
      ))}

      {/*
        The surah continues, and the screen says so rather than ending silently. A reader that
        stopped at the page boundary with no affordance would be presenting part of a surah as the
        whole of it.
      */}
      {nextCursor === null ? null : (
        <View style={{ marginTop: dp(16) }}>
          <ContinueReading
            shown={items.length}
            total={page.total ?? page.surah.ayahCount}
            loading={loadingMore}
            failed={moreFailed}
            onPress={() => onLoadMore(nextCursor)}
          />
        </View>
      )}
    </View>
  );
}

/**
 * The chosen translation is missing, and this says which kind of missing.
 *
 * For `edition-unavailable` a retry is advice that cannot work: the edition the user picked is not
 * one the source has. The only action that helps is choosing another, so that is the action offered.
 * The transient case gets the honest "try again" instead. Either way the Arabic below is unaffected.
 */
function TranslationUnavailable({ failure }: { readonly failure: TranslationFailure }) {
  const router = useRouter();

  return failure === 'edition-unavailable' ? (
    <ModuleStatusBanner
      tone="warning"
      message="The translation you chose is no longer available from this source. The Arabic is unaffected — choose another translation to see the meaning again."
      actionLabel="Choose a translation"
      onAction={() => router.push(faithRoutes.translations)}
      testID="faith-reader-translation-unavailable"
    />
  ) : (
    <ModuleStatusBanner
      tone="warning"
      message="The translation could not be loaded. The Arabic below is unaffected."
      testID="faith-reader-translation-unavailable"
    />
  );
}

/**
 * Whose translation this is.
 *
 * This names the person whose reading of the meaning the user is about to trust, which is the
 * attribution the licence is actually about and the only one a reader might act on — by changing it.
 */
function TranslationCredit({ translation }: { readonly translation: AyahTranslation }) {
  const { dp } = useModuleMetrics();
  const { name, attribution, edition } = translation.source;

  /**
   * The wording adapts to what the source actually carries.
   *
   * `attribution` is the translator and is required of the approved adapter; `edition` is the
   * edition's own title where one is given. Neither is invented when absent — the line says less
   * rather than claiming a translator it does not know.
   */
  const detail =
    attribution === undefined
      ? edition === undefined
        ? name
        : `${edition} • ${name}`
      : `Translated by ${attribution}`;

  return (
    <View
      style={{ paddingVertical: dp(6), rowGap: dp(2) }}
      accessible
      accessibilityLabel={`Translation shown: ${edition ?? name}. ${detail}`}
      testID="faith-reader-translation-credit"
    >
      <ModuleText token="caption" numberOfLines={2}>
        {edition === undefined ? 'Translation' : edition}
      </ModuleText>
      <ModuleText token="caption" numberOfLines={2}>
        {detail}
      </ModuleText>
    </View>
  );
}

/**
 * The end-of-page affordance: how far the reader has got, and how to go on.
 *
 * The count is stated in words rather than implied by a bare button, because "showing 20 of 286" is
 * the fact that makes the page boundary honest.
 */
function ContinueReading({
  shown,
  total,
  loading,
  failed,
  onPress,
}: {
  readonly shown: number;
  readonly total: number;
  readonly loading: boolean;
  readonly failed: boolean;
  readonly onPress: () => void;
}) {
  const theme = useModuleTheme();
  const { dp } = useModuleMetrics();

  return (
    <View style={{ rowGap: dp(6) }} testID="faith-reader-more">
      <ModuleText token="caption" numberOfLines={2}>
        {`Showing ${shown} of ${total} verses.`}
      </ModuleText>

      {failed ? (
        <ModuleText token="caption" numberOfLines={2} color={moduleNeutrals.warning}>
          The next verses could not be loaded. Your place is unchanged — try again.
        </ModuleText>
      ) : null}

      <PressableScale
        onPress={onPress}
        disabled={loading}
        accessibilityRole="button"
        accessibilityState={{ disabled: loading, busy: loading }}
        accessibilityLabel={
          failed ? 'Try loading the next verses again' : 'Load the next verses of this surah'
        }
        style={{
          alignSelf: 'flex-start',
          minHeight: dp(moduleLayout.minTouchTarget),
          justifyContent: 'center',
        }}
        testID="faith-reader-load-more"
      >
        <ModuleText token="cardAction" color={theme.ink} numberOfLines={1}>
          {loading ? 'Loading…' : failed ? 'Try again' : 'Load the next verses'}
        </ModuleText>
      </PressableScale>
    </View>
  );
}
