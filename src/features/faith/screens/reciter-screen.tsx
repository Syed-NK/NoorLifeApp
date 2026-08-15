import { useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Modal, View } from 'react-native';

import { AppIcon, PressableScale } from '@ds/components';
import { neutralColors } from '@ds/tokens';
import { ModuleText } from '@features/modules/components';
import { moduleLayout, moduleNeutrals } from '@features/modules/module-tokens';
import { useModuleMetrics } from '@features/modules/use-module-metrics';
import { minimumHitSlop } from '@shared/utils/a11y';

import { FaithCatalogueList, type CatalogueRow } from '../components/faith-catalogue-list';
import { FaithRow, FaithRowGroup } from '../components/faith-list';
import { FaithResourceView, FaithScreen } from '../components/faith-screen';
import { formatBytes, formatDate } from '../components/reader/quran-audio-player';
import type { SurahDownloadState } from '../data/audio';
import { hasData } from '../data/faith-result';
import type { AyahRecitation, ReciterEdition } from '../data/quran-content.repository';
import { surahNumber } from '../data/quran-content.repository';
import { useFaithRepositories } from '../di/faith-repository-context';
import { useRecitationAudio, useRecitationAudioRevision } from '../di/recitation-audio-context';
import { faithNavKeys } from '../faith-routes';
import { useContinueReading } from '../hooks/use-continue-reading';
import { useFaithPreferences } from '../hooks/use-faith-preferences';
import { useFaithResource } from '../hooks/use-faith-resource';
import { useSurahDownloads } from '../hooks/use-surah-downloads';
import { attributionForReciter } from '../data/quran-foundation/recitation-attribution';
import { DEFAULT_RECITER_ID } from '../storage/faith-preferences';
import {
  isDownloadExpired,
  type SurahDownload,
  type SurahDownloadIndex,
} from '../storage/faith-audio-downloads';

/**
 * "Choose reciter" — the recitation catalogue and its offline state.
 *
 * ── Why this is not the translation screen with different data ──────────────
 * They look alike and they are not the same list. A translation is chosen by *language* and credited
 * to a translator; a recitation is chosen by *voice and style* and has no language axis at all —
 * every entry is Arabic. Sharing the frame (`FaithCatalogueList`) keeps them consistent; sharing the
 * screen would have meant one of the two carrying a filter that means nothing for it. And only one
 * of them has an offline dimension: a translation is a few kilobytes of text, a recitation is tens
 * of megabytes per surah, which is why this screen carries download state and that one does not.
 *
 * **No translation resources appear here**, and none can: the only catalogue this screen reads is
 * `availableReciters`.
 *
 * ── The scope of a download is a surah, so the row describes one surah ──────
 * There is no "download this reciter". A complete recitation of the Qur'an is several gigabytes, the
 * Quran Foundation developer terms do not permit a permanent local copy of it, and offering a
 * control that would fetch one would be offering to do something the licence forbids. Every download
 * here is one surah — the one the user is currently reading — and each is explicitly initiated.
 */

/** The filter chip shown when no meaningful style values exist in the catalogue. */
const ALL_STYLES = 'all';

function normalise(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * The style chips, generated from the catalogue rather than hard-coded.
 *
 * `style` is optional in the wire contract and the vendor populates it inconsistently — some
 * recitations carry "Mujawwad" or "Murattal", many carry nothing. A fixed list would show chips that
 * match no rows, so the chips are the distinct values actually present, and the row is **omitted
 * entirely** when fewer than two exist. A filter that cannot narrow anything is furniture.
 */
export function styleFiltersFor(
  reciters: readonly ReciterEdition[],
): readonly { readonly id: string; readonly label: string }[] {
  const styles = new Map<string, string>();
  for (const reciter of reciters) {
    const style = reciter.style?.trim();
    if (style !== undefined && style.length > 0) {
      styles.set(normalise(style), style);
    }
  }
  if (styles.size < 2) {
    return [];
  }
  return [
    { id: ALL_STYLES, label: 'All styles' },
    ...[...styles.entries()]
      .sort((a, b) => a[1].localeCompare(b[1]))
      .map(([id, label]) => ({ id, label })),
  ];
}

/** Case-insensitive match on name and style. There is no language field to search. */
export function matchesReciterQuery(reciter: ReciterEdition, query: string): boolean {
  const needle = normalise(query);
  if (needle.length === 0) {
    return true;
  }
  return (
    normalise(reciter.name).includes(needle) ||
    (reciter.style !== undefined && normalise(reciter.style).includes(needle))
  );
}

export function orderReciters(
  reciters: readonly ReciterEdition[],
  styleId: string,
  query: string,
  selectedId: string | null,
): readonly ReciterEdition[] {
  return reciters
    .filter(
      (reciter) =>
        styleId === ALL_STYLES ||
        (reciter.style !== undefined && normalise(reciter.style) === styleId),
    )
    .filter((reciter) => matchesReciterQuery(reciter, query))
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

/**
 * The row's third line, describing what is on the device for this reciter and surah.
 *
 * Exported because it is the whole of the availability vocabulary and is worth asserting directly:
 * six states, six sentences, and none of them a colour.
 */
export function describeDownload(state: SurahDownloadState, surahName: string): string {
  switch (state.kind) {
    case 'stream-only':
      return `Streams • ${surahName} not downloaded`;
    case 'downloading':
      return `Downloading ${surahName} — ${state.completed} of ${state.total} verses`;
    case 'downloaded':
      return `${surahName} downloaded • ${formatBytes(state.bytes)} • until ${formatDate(state.expiresAt)}`;
    case 'expired':
      return `${surahName} download expired — download again to listen offline`;
    case 'incomplete':
      return `${surahName} partly downloaded — ${state.completed} of ${state.total} verses`;
    case 'failed':
      return `${surahName} download failed — try again`;
  }
}

export function ReciterScreen() {
  return (
    <FaithScreen
      title="Choose reciter"
      activeKey={faithNavKeys.more}
      scrollable={false}
      fills
      testID="faith-reciters"
    >
      <ReciterBody />
    </FaithScreen>
  );
}

function ReciterBody() {
  const router = useRouter();
  const { quran } = useFaithRepositories();
  const audio = useRecitationAudio();
  const { preferences, update } = useFaithPreferences();
  const { position } = useContinueReading();
  const downloads = useSurahDownloads();
  const [query, setQuery] = useState('');
  const [styleId, setStyleId] = useState<string>(ALL_STYLES);
  const [tick, setTick] = useState(0);
  /* See the reader: a synchronous `stateFor` taken before hydration must not be kept. */
  const audioRevision = useRecitationAudioRevision();

  const reciters = useFaithResource(
    'faith.reciters.catalogue',
    useCallback(() => quran.availableReciters(), [quran]),
  );

  /**
   * The surah a download here would be *of*.
   *
   * The reader's own position, because that is the surah the user is demonstrably listening to. With
   * no recorded position there is nothing honest to offer — a screen that defaulted to Al-Fatihah
   * would download a surah nobody asked for — so the download control is absent and the rows say
   * only that the reciter streams.
   */
  const targetSurah = position?.surah ?? null;
  const targetSurahName = position?.surahName ?? null;

  return (
    <FaithResourceView
      resource={reciters}
      empty={{
        title: 'No reciters available',
        body: 'The recitation catalogue could not be loaded. Check your connection and try again.',
        actionLabel: 'Try again',
      }}
      onEmptyAction={reciters.reload}
      loadingRows={6}
      testID="faith-reciters-body"
    >
      {(list) => (
        <ReciterCatalogueBody
          list={list}
          query={query}
          onQueryChange={setQuery}
          styleId={styleId}
          onStyleChange={setStyleId}
          selectedId={preferences.reciterId}
          targetSurah={targetSurah}
          targetSurahName={targetSurahName}
          totalDownloadedBytes={downloads.totalBytes}
          downloadCount={downloads.downloads.length}
          expiredCount={downloads.downloads.filter((entry) => isDownloadExpired(entry)).length}
          stateFor={(reciterId) =>
            targetSurah === null ? { kind: 'stream-only' } : audio.stateFor(reciterId, targetSurah)
          }
          onDownload={(reciterId) => {
            if (targetSurah === null) {
              return;
            }
            void (async () => {
              /**
               * The URLs are fetched here, at the moment the user asks.
               *
               * Not held from an earlier screen: a recitation URL is a CDN address the vendor may
               * rotate or re-sign, and the cache window on `list_verse_recitations` is a day for
               * exactly that reason. Asking now is one request against a URL list that is about to
               * be used, rather than replaying one that may already have expired.
               */
              const recited = await quran.listRecitations(surahNumber(targetSurah), reciterId);
              const items: readonly AyahRecitation[] = hasData(recited) ? recited.data.items : [];
              if (items.length === 0) {
                setTick((value) => value + 1);
                return;
              }
              setTick((value) => value + 1);
              await audio.downloadSurah(reciterId, targetSurah, items, () =>
                setTick((value) => value + 1),
              );
              setTick((value) => value + 1);
              downloads.refresh();
            })();
          }}
          onCancel={(reciterId) => {
            if (targetSurah !== null) {
              audio.cancelDownload(reciterId, targetSurah);
              setTick((value) => value + 1);
            }
          }}
          onRemove={(reciterId) => {
            if (targetSurah !== null) {
              void downloads.remove(reciterId, targetSurah).then(() => {
                setTick((value) => value + 1);
              });
            }
          }}
          /*
            ── The list that made removal reachable ──────────────────────────
            Every download on the device, independent of `targetSurah`. The rows above can only ever
            describe the surah in the user's reading position, and that position is `null` until they
            deliberately mark a verse read — so a user who downloaded a surah from the reader and
            never pressed Read saw every row say "Streams" with no action on it, and there was no
            other surface anywhere that listed what they had downloaded. Removal existed in the
            service and could not be reached from the app.
          */
          downloads={downloads.downloads}
          stateOf={(reciterId, surah) => audio.stateFor(reciterId, surah)}
          onRemoveDownload={(reciterId, surah) => {
            void downloads.remove(reciterId, surah).then(() => setTick((value) => value + 1));
          }}
          onRemoveReciterDownloads={(reciterId) => {
            void downloads.removeForReciter(reciterId).then(() => setTick((value) => value + 1));
          }}
          revision={tick + audioRevision}
          onChoose={(reciter) => {
            void (async () => {
              // Marked as the user's own, so the superseded-default migration never overrides it.
              await update({ reciterId: reciter.id, reciterChosenByUser: true });
              router.back();
            })();
          }}
        />
      )}
    </FaithResourceView>
  );
}

/**
 * Everything on the device, and the only way to take it off again.
 *
 * ── Why this panel had to exist ─────────────────────────────────────────────
 * `RecitationAudio.removeDownload` has always been implemented, and until now nothing could reach it
 * for an arbitrary surah. The reciter rows above describe exactly one surah — `position?.surah`, the
 * user's continue-reading position — and that position stays `null` until somebody deliberately
 * presses **Read** on a verse. So the sequence "open a surah, download it, leave" produced a device
 * holding tens of megabytes with no screen anywhere that listed it and no control anywhere that
 * removed it. The bytes expired a week later; that is a licence ceiling doing the user's housekeeping,
 * not a feature.
 *
 * ── What it deliberately does not offer ─────────────────────────────────────
 * Any way to get a file *out*. No share, no export, no copy-to-Downloads, no path shown. The audio
 * lives in private application storage under the Quran Foundation terms, and a control that moved one
 * anywhere else would be the single most consequential line in this module.
 */
function DownloadedSurahs({
  downloads,
  reciterName,
  stateOf,
  onRemove,
  onRemoveAllForReciter,
  revision,
}: {
  readonly downloads: SurahDownloadIndex;
  readonly reciterName: (reciterId: string) => string;
  readonly stateOf: (reciterId: string, surah: number) => SurahDownloadState;
  readonly onRemove: (reciterId: string, surah: number) => void;
  readonly onRemoveAllForReciter: (reciterId: string) => void;
  /** Bumped when the mutable download service changes, so the states below re-derive. */
  readonly revision: number;
}) {
  const { dp } = useModuleMetrics();
  /** The reciter whose bulk removal is awaiting confirmation, or `null`. */
  const [confirming, setConfirming] = useState<string | null>(null);

  const byReciter = useMemo(() => {
    const groups = new Map<string, SurahDownload[]>();
    for (const entry of downloads) {
      const existing = groups.get(entry.reciterId) ?? [];
      existing.push(entry);
      groups.set(entry.reciterId, existing);
    }
    for (const list of groups.values()) {
      list.sort((left, right) => left.surah - right.surah);
    }
    return [...groups.entries()];
    // `revision` re-derives the group after a removal, which mutates the service rather than state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [downloads, revision]);

  if (byReciter.length === 0) {
    return null;
  }

  return (
    <View style={{ paddingBottom: dp(10), rowGap: dp(8) }} testID="faith-reciters-downloads">
      {byReciter.map(([reciterId, entries]) => (
        <FaithRowGroup
          key={reciterId}
          title={`Downloaded • ${reciterName(reciterId)}`}
          testID={`faith-reciter-downloads-${reciterId}`}
        >
          {[
            ...entries.map((entry) => {
              const state = stateOf(entry.reciterId, entry.surah);
              return (
                <FaithRow
                  key={entry.surah}
                  title={`Surah ${entry.surah}`}
                  subtitle={describeStoredDownload(entry, state)}
                  icon="download"
                  trailing={
                    <PressableScale
                      onPress={() => onRemove(entry.reciterId, entry.surah)}
                      accessibilityRole="button"
                      accessibilityLabel={`Remove downloaded surah ${entry.surah} by ${reciterName(reciterId)}, ${formatBytes(entry.bytes)}`}
                      accessibilityHint="Deletes the audio from this device"
                      hitSlop={minimumHitSlop(dp(24))}
                      testID={`faith-reciter-download-remove-${reciterId}-${entry.surah}`}
                    >
                      <AppIcon name="delete" size={dp(20)} color={moduleNeutrals.warning} />
                    </PressableScale>
                  }
                  /*
                    The row carries its own control, so the container must not merge it — the same
                    rule the prayer switches are governed by. See `FaithRowProps.trailingInteractive`.
                  */
                  trailingInteractive
                  testID={`faith-reciter-download-${reciterId}-${entry.surah}`}
                />
              );
            }),
            /*
              The bulk action, last, and only when there is more than one thing for it to do. A
              "Remove all" beside a single item is a second button for the same deletion, and the
              destructive one is the one you do not want duplicated.
            */
            ...(entries.length > 1
              ? [
                  <FaithRow
                    key="all"
                    title={`Remove all ${entries.length} downloads`}
                    subtitle={`${formatBytes(entries.reduce((sum, entry) => sum + entry.bytes, 0))} for ${reciterName(reciterId)}`}
                    icon="delete"
                    iconColor={moduleNeutrals.warning}
                    onPress={() => setConfirming(reciterId)}
                    testID={`faith-reciter-downloads-remove-all-${reciterId}`}
                  />,
                ]
              : []),
          ]}
        </FaithRowGroup>
      ))}

      {/*
        Confirmation for the bulk removal only. One surah is a small, obvious, re-doable action and a
        dialog in front of it teaches people to dismiss dialogs; "remove all" can discard a journey's
        worth of downloading over a connection the user may not have again soon.
      */}
      {confirming === null ? null : (
        <ConfirmRemoveAll
          reciterName={reciterName(confirming)}
          count={downloads.filter((entry) => entry.reciterId === confirming).length}
          bytes={downloads
            .filter((entry) => entry.reciterId === confirming)
            .reduce((sum, entry) => sum + entry.bytes, 0)}
          onCancel={() => setConfirming(null)}
          onConfirm={() => {
            onRemoveAllForReciter(confirming);
            setConfirming(null);
          }}
        />
      )}
    </View>
  );
}

/**
 * One stored download's second line: how big, how many verses, and whether it can still be played.
 *
 * The live state is consulted rather than the index alone, because the index records what was written
 * and the filesystem decides what survives. A file the OS reclaimed under storage pressure leaves an
 * entry that looks perfectly healthy, and describing it as playable would be the download equivalent
 * of claiming a notification is scheduled.
 */
export function describeStoredDownload(entry: SurahDownload, state: SurahDownloadState): string {
  const size = `${formatBytes(entry.bytes)} • ${entry.files} of ${entry.ayahCount} verses`;
  switch (state.kind) {
    case 'downloaded':
      return `${size} • until ${formatDate(state.expiresAt)}`;
    case 'expired':
      return `${size} • expired, download again to listen offline`;
    case 'downloading':
      return `${size} • downloading ${state.completed} of ${state.total}`;
    case 'incomplete':
      return `${size} • ${state.completed} of ${state.total} verses still on this device`;
    case 'failed':
      return `${size} • the last download failed`;
    case 'stream-only':
      /*
        An index entry with nothing behind it: the files are gone and the record is not. Named
        honestly rather than hidden, because Remove is exactly the right thing to do to it and
        hiding it would leave the row unremovable.
      */
      return `${size} • files are missing from this device`;
  }
}

/** The one confirmation in the download flow. Cancel is the safe default and is listed first. */
function ConfirmRemoveAll({
  reciterName,
  count,
  bytes,
  onCancel,
  onConfirm,
}: {
  readonly reciterName: string;
  readonly count: number;
  readonly bytes: number;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}) {
  const { dp } = useModuleMetrics();

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      onRequestClose={onCancel}
      testID="faith-reciter-downloads-confirm"
    >
      <View
        style={{
          flex: 1,
          justifyContent: 'center',
          padding: dp(moduleLayout.pagePadding),
          /* The locked scrim, the same dim the verse action sheet draws over the reader. */
          backgroundColor: neutralColors.scrim,
        }}
      >
        <View
          style={{
            backgroundColor: moduleNeutrals.surface,
            borderRadius: dp(moduleLayout.cardRadius),
            padding: dp(18),
            rowGap: dp(12),
          }}
          accessibilityViewIsModal
        >
          <ModuleText token="cardHeading">{`Remove ${count} downloads?`}</ModuleText>
          <ModuleText token="rowMeta" numberOfLines={4}>
            {`This deletes ${formatBytes(bytes)} of ${reciterName}'s recitation from this device. You can download it again later.`}
          </ModuleText>
          <View style={{ flexDirection: 'row', justifyContent: 'flex-end', columnGap: dp(16) }}>
            <PressableScale
              onPress={onCancel}
              accessibilityRole="button"
              accessibilityLabel="Keep the downloads"
              style={{ minHeight: dp(moduleLayout.minTouchTarget), justifyContent: 'center' }}
              testID="faith-reciter-downloads-confirm-cancel"
            >
              <ModuleText token="cardAction">Cancel</ModuleText>
            </PressableScale>
            <PressableScale
              onPress={onConfirm}
              accessibilityRole="button"
              accessibilityLabel={`Remove all ${count} downloads for ${reciterName}`}
              style={{ minHeight: dp(moduleLayout.minTouchTarget), justifyContent: 'center' }}
              testID="faith-reciter-downloads-confirm-remove"
            >
              <ModuleText token="cardAction" color={moduleNeutrals.warning}>
                Remove all
              </ModuleText>
            </PressableScale>
          </View>
        </View>
      </View>
    </Modal>
  );
}

/** Split out so `useMemo` is not called conditionally inside the resource branch. */
function ReciterCatalogueBody({
  list,
  query,
  onQueryChange,
  styleId,
  onStyleChange,
  selectedId,
  targetSurah,
  targetSurahName,
  totalDownloadedBytes,
  downloadCount,
  expiredCount,
  stateFor,
  onDownload,
  onCancel,
  onRemove,
  downloads,
  stateOf: downloadStateOf,
  onRemoveDownload,
  onRemoveReciterDownloads,
  revision,
  onChoose,
}: {
  readonly list: readonly ReciterEdition[];
  readonly query: string;
  readonly onQueryChange: (value: string) => void;
  readonly styleId: string;
  readonly onStyleChange: (id: string) => void;
  readonly selectedId: string;
  readonly targetSurah: number | null;
  readonly targetSurahName: string | null;
  readonly totalDownloadedBytes: number;
  readonly downloadCount: number;
  readonly expiredCount: number;
  readonly stateFor: (reciterId: string) => SurahDownloadState;
  readonly onDownload: (reciterId: string) => void;
  readonly onCancel: (reciterId: string) => void;
  readonly onRemove: (reciterId: string) => void;
  /** Every download on the device, for every reciter. The list that makes removal reachable. */
  readonly downloads: SurahDownloadIndex;
  /** The live state of one download — downloaded, expired, or short of the files it claims. */
  readonly stateOf: (reciterId: string, surah: number) => SurahDownloadState;
  readonly onRemoveDownload: (reciterId: string, surah: number) => void;
  readonly onRemoveReciterDownloads: (reciterId: string) => void;
  /** Bumped when the mutable download service changes, so the rows re-derive. */
  readonly revision: number;
  readonly onChoose: (reciter: ReciterEdition) => void;
}) {
  const { dp } = useModuleMetrics();
  const filters = useMemo(() => styleFiltersFor(list), [list]);
  const visible = useMemo(
    () => orderReciters(list, styleId, query, selectedId),
    [list, styleId, query, selectedId],
  );

  const rows: readonly CatalogueRow[] = useMemo(
    () =>
      visible.map((reciter) => {
        const state = targetSurah === null ? null : stateFor(reciter.id);
        const surahName = targetSurahName ?? `surah ${targetSurah ?? ''}`.trim();

        /**
         * The row's control, one per download state.
         *
         * Six states, six different next actions — and the destructive one ("Remove") is drawn with
         * its own glyph rather than sharing the download arrow, so it cannot be tapped by muscle
         * memory built on the additive one.
         */
        const downloadAction = (current: SurahDownloadState): Pick<CatalogueRow, 'action'> => {
          switch (current.kind) {
            case 'downloading':
              return {
                action: {
                  icon: 'downloading',
                  label: `${current.completed}/${current.total}`,
                  accessibilityLabel: `Cancel download of ${surahName} by ${reciter.name}`,
                  onPress: () => onCancel(reciter.id),
                },
              };
            case 'downloaded':
              return {
                action: {
                  icon: 'delete',
                  label: 'Remove',
                  accessibilityLabel: `Remove downloaded ${surahName} by ${reciter.name}, ${formatBytes(current.bytes)}`,
                  onPress: () => onRemove(reciter.id),
                },
              };
            case 'expired':
              return {
                action: {
                  icon: 'retry',
                  label: 'Update',
                  accessibilityLabel: `Download ${surahName} by ${reciter.name} again, the previous download has expired`,
                  onPress: () => onDownload(reciter.id),
                  warning: true,
                },
              };
            case 'failed':
              return {
                action: {
                  icon: 'retry',
                  label: 'Retry',
                  accessibilityLabel: `Retry the failed download of ${surahName} by ${reciter.name}`,
                  onPress: () => onDownload(reciter.id),
                  warning: true,
                },
              };
            case 'incomplete':
              return {
                action: {
                  icon: 'download',
                  label: 'Finish',
                  accessibilityLabel: `Finish downloading ${surahName} by ${reciter.name}`,
                  onPress: () => onDownload(reciter.id),
                },
              };
            case 'stream-only':
              return {
                action: {
                  icon: 'download',
                  label: 'Download',
                  accessibilityLabel: `Download ${surahName} by ${reciter.name} for offline listening`,
                  onPress: () => onDownload(reciter.id),
                },
              };
          }
        };

        /**
         * The credit Quran Foundation requires for resource 3, shown where that reciter is chosen.
         *
         * This is the screen on which a user selects Sudais, so it is where the mandated wording
         * belongs. It replaces the style line for that one row: the sentence already names the
         * reciter, and stacking a credit under a duplicate name would push the download note off the
         * row on a narrow device.
         *
         * `attributionForReciter` answers `null` for every other id, so this cannot spread to a
         * reciter the permission does not cover — the mistake would otherwise be one careless
         * `detail:` edit away.
         */
        const requiredCredit = attributionForReciter(reciter.id);

        return {
          id: reciter.id,
          title: reciter.name,
          /*
            Every recitation in this catalogue is Arabic, so the detail line says the style rather
            than a language. "Recitation" is the honest fallback when the vendor sent no style —
            inventing one would be this screen describing a recording it has not heard.
          */
          detail: requiredCredit ?? reciter.style ?? 'Recitation',
          ...(state === null
            ? { trailingNote: 'Streams • open a surah to download it for offline listening' }
            : { trailingNote: describeDownload(state, surahName) }),
          ...(state === null ? {} : downloadAction(state)),
          /*
            The required credit is spoken too, in place of the style, so the licence condition is met
            for a screen-reader user rather than only for a sighted one. An attribution present
            visually and absent from the accessible name is not an attribution that has been displayed.
          */
          accessibilityLabel: `${reciter.name}${
            requiredCredit === null
              ? reciter.style === undefined
                ? ''
                : `, ${reciter.style}`
              : `. ${requiredCredit}`
          }${reciter.id === selectedId ? ', selected' : ''}${
            reciter.id === DEFAULT_RECITER_ID ? ', NoorLife default' : ''
          }${state === null ? '' : `. ${describeDownload(state, surahName)}`}`,
        };
      }),
    // `revision` is a dependency on purpose: the download service is mutable and outside React, so
    // a completed transfer reaches this list only by the bump the caller performs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      visible,
      selectedId,
      targetSurah,
      targetSurahName,
      stateFor,
      onDownload,
      onCancel,
      onRemove,
      revision,
    ],
  );

  const byId = useMemo(() => new Map(list.map((reciter) => [reciter.id, reciter])), [list]);

  return (
    <View style={{ flex: 1 }}>
      {/*
        Download management, stated as a total rather than implied by the rows.

        A user deciding whether to keep offline recitation is asking "how much of my phone is this
        using", and the answer is not derivable by adding up six list rows. Expiry is named for the
        same reason it is named on each row: these files live under a one-week licence ceiling, and
        somebody who downloaded a surah for a journey is entitled to know it stops working.
      */}
      {downloadCount === 0 ? null : (
        <View
          style={{ paddingBottom: dp(10), rowGap: dp(2) }}
          accessible
          accessibilityLabel={`Offline recitation: ${downloadCount} ${
            downloadCount === 1 ? 'surah' : 'surahs'
          } downloaded, using ${formatBytes(totalDownloadedBytes)}${
            expiredCount === 0 ? '' : `, ${expiredCount} expired`
          }`}
          testID="faith-reciters-storage"
        >
          <ModuleText token="caption" numberOfLines={1}>
            {`Offline recitation • ${downloadCount} ${downloadCount === 1 ? 'surah' : 'surahs'} • ${formatBytes(totalDownloadedBytes)}`}
          </ModuleText>
          <ModuleText token="caption" numberOfLines={2}>
            {expiredCount === 0
              ? 'Downloads are kept for up to one week, then removed.'
              : `${expiredCount} download${expiredCount === 1 ? '' : 's'} expired and must be downloaded again.`}
          </ModuleText>
        </View>
      )}

      <DownloadedSurahs
        downloads={downloads}
        reciterName={(id) => byId.get(id)?.name ?? `Reciter ${id}`}
        stateOf={downloadStateOf}
        onRemove={onRemoveDownload}
        onRemoveAllForReciter={onRemoveReciterDownloads}
        revision={revision}
      />

      <View style={{ flex: 1, minHeight: dp(moduleLayout.minTouchTarget) }}>
        <FaithCatalogueList
          rows={rows}
          selectedId={selectedId}
          onSelect={(id) => {
            const reciter = byId.get(id);
            if (reciter !== undefined) {
              onChoose(reciter);
            }
          }}
          query={query}
          onQueryChange={onQueryChange}
          searchPlaceholder="Search reciters"
          searchLabel="Search reciters by name or style"
          {...(filters.length === 0
            ? {}
            : {
                filters,
                activeFilterId: styleId,
                onFilterChange: onStyleChange,
                filterLabel: 'Filter reciters by style',
              })}
          emptyMessage="No reciters match that search. Try another name."
          testID="faith-reciters"
        />
      </View>
    </View>
  );
}
