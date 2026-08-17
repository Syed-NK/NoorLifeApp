import { useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { View } from 'react-native';

import { ModuleText } from '@features/modules/components';
import { moduleLayout } from '@features/modules/module-tokens';
import { useModuleMetrics } from '@features/modules/use-module-metrics';

import { FaithCatalogueList, type CatalogueRow } from '../components/faith-catalogue-list';
import { FaithRow, FaithRowGroup } from '../components/faith-list';
import { FaithResourceView, FaithScreen } from '../components/faith-screen';
import { formatBytes } from '../components/reader/quran-audio-player';
import type { ReciterEdition } from '../data/quran-content.repository';
import { useFaithRepositories } from '../di/faith-repository-context';
import { useOfflineRecitation } from '../di/offline-recitation-context';
import { faithNavKeys, faithRoutes } from '../faith-routes';
import { useFaithPreferences } from '../hooks/use-faith-preferences';
import { useFaithResource } from '../hooks/use-faith-resource';
import {
  attributionForReciter,
  SUDAIS_RESOURCE_ID,
} from '../data/quran-foundation/recitation-attribution';
import { DEFAULT_RECITER_ID } from '../storage/faith-preferences';

/**
 * "Choose reciter" — the recitation catalogue, and where its offline state is managed.
 *
 * ── Why this is not the translation screen with different data ──────────────
 * They look alike and they are not the same list. A translation is chosen by *language* and credited
 * to a translator; a recitation is chosen by *voice and style* and has no language axis at all —
 * every entry is Arabic. Sharing the frame (`FaithCatalogueList`) keeps them consistent; sharing the
 * screen would have meant one of the two carrying a filter that means nothing for it.
 *
 * **No translation resources appear here**, and none can: the only catalogue this screen reads is
 * `availableReciters`.
 *
 * ── Why the download controls left this screen ──────────────────────────────
 * They used to be here, one per row, operating on "the surah in the user's continue-reading
 * position" — a value that is `null` until somebody deliberately presses **Read** on a verse. So the
 * ordinary sequence (open a surah, download it, leave) produced a device holding tens of megabytes
 * with every row saying "Streams" and no control anywhere that removed them.
 *
 * The scope of an offline download is no longer a surah decided by a reading position. It is the
 * complete recitation, or surahs the user picks, and it involves a size estimate, a storage
 * preflight, a Wi-Fi-only preference, a pause and a confirmed removal. None of that fits in a row of
 * a scrolling catalogue, so it has its own destination — see `faithRoutes.offlineAudio`. What is left
 * here is the catalogue, plus one honest summary of what is on the device and the way to manage it.
 *
 * ── Only one reciter can be kept offline, and that is stated rather than implied ──
 * The extended-retention permission covers Abdur-Rahman as-Sudais alone. Every other reciter in this
 * catalogue is available under the ordinary developer terms, which do not permit a permanent local
 * copy — so no row but Sudais's offers offline storage, and the summary says which reciter it is
 * about instead of leaving the reader to infer it.
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
 * The offline note on a reciter's row.
 *
 * ── Why every other reciter says the same short thing ───────────────────────
 * Because the same thing is true of all of them, and dressing it up per reciter would suggest the
 * difference is about the voice rather than about the licence. Sudais's row states what is actually
 * on the device; every other row states that offline listening is not offered for it, which is the
 * honest description of a catalogue entry NoorLife may stream but may not keep.
 */
export function describeReciterOffline(input: {
  readonly reciterId: string;
  readonly playableAyat: number;
  readonly totalAyat: number;
}): string {
  if (input.reciterId !== SUDAIS_RESOURCE_ID) {
    return 'Offline download not available for this reciter';
  }
  if (input.playableAyat === 0) {
    return 'No verses downloaded';
  }
  if (input.totalAyat > 0 && input.playableAyat >= input.totalAyat) {
    return 'Complete Qur’an downloaded';
  }
  return `${input.playableAyat.toLocaleString()} verses downloaded`;
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
  const { preferences, update } = useFaithPreferences();
  const { snapshot } = useOfflineRecitation();
  const [query, setQuery] = useState('');
  const [styleId, setStyleId] = useState<string>(ALL_STYLES);

  const reciters = useFaithResource(
    'faith.reciters.catalogue',
    useCallback(() => quran.availableReciters(), [quran]),
  );

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
          playableAyat={snapshot.playableAyat}
          totalAyat={snapshot.totalAyat}
          downloadedBytes={snapshot.downloadedBytes}
          onManageOffline={() => router.push(faithRoutes.offlineAudio)}
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

/** Split out so `useMemo` is not called conditionally inside the resource branch. */
function ReciterCatalogueBody({
  list,
  query,
  onQueryChange,
  styleId,
  onStyleChange,
  selectedId,
  playableAyat,
  totalAyat,
  downloadedBytes,
  onManageOffline,
  onChoose,
}: {
  readonly list: readonly ReciterEdition[];
  readonly query: string;
  readonly onQueryChange: (value: string) => void;
  readonly styleId: string;
  readonly onStyleChange: (id: string) => void;
  readonly selectedId: string;
  readonly playableAyat: number;
  readonly totalAyat: number;
  readonly downloadedBytes: number;
  readonly onManageOffline: () => void;
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
        /**
         * The credit Quran Foundation requires for resource 3, shown where that reciter is chosen.
         *
         * This is the screen on which a user selects Sudais, so it is where the mandated wording
         * belongs. It replaces the style line for that one row: the sentence already names the
         * reciter, and stacking a credit under a duplicate name would push the offline note off the
         * row on a narrow device.
         *
         * `attributionForReciter` answers `null` for every other id, so this cannot spread to a
         * reciter the permission does not cover — the mistake would otherwise be one careless
         * `detail:` edit away.
         */
        const requiredCredit = attributionForReciter(reciter.id);
        const offlineNote = describeReciterOffline({
          reciterId: reciter.id,
          playableAyat,
          totalAyat,
        });

        return {
          id: reciter.id,
          title: reciter.name,
          /*
            Every recitation in this catalogue is Arabic, so the detail line says the style rather
            than a language. "Recitation" is the honest fallback when the vendor sent no style —
            inventing one would be this screen describing a recording it has not heard.
          */
          detail: requiredCredit ?? reciter.style ?? 'Recitation',
          trailingNote: offlineNote,
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
          }. ${offlineNote}`,
        };
      }),
    [visible, selectedId, playableAyat, totalAyat],
  );

  const byId = useMemo(() => new Map(list.map((reciter) => [reciter.id, reciter])), [list]);

  return (
    <View style={{ flex: 1 }}>
      {/*
        What is on the device, stated as a total rather than implied by the rows.

        A user deciding whether to keep offline recitation is asking "how much of my phone is this
        using", and the answer is not derivable by adding up rows of a catalogue. Expiry is
        deliberately **not** mentioned: these files are held under the extended-retention permission
        and they do not expire, and the previous copy here — "Downloads are kept for up to one week,
        then removed" — described a ceiling that no longer applies to this reciter.
      */}
      <View style={{ paddingBottom: dp(10) }}>
        <FaithRowGroup title="Offline listening" testID="faith-reciters-offline">
          {[
            <FaithRow
              key="manage"
              title="Manage offline audio"
              subtitle={
                playableAyat === 0
                  ? 'Nothing downloaded • Abdur-Rahman as-Sudais'
                  : `${playableAyat.toLocaleString()} of ${totalAyat.toLocaleString()} verses • ${formatBytes(downloadedBytes)}`
              }
              icon="download"
              onPress={onManageOffline}
              accessibilityLabel={`Manage offline audio. ${
                playableAyat === 0
                  ? 'Nothing is downloaded'
                  : `${playableAyat} of ${totalAyat} verses downloaded, using ${formatBytes(downloadedBytes)}`
              }. Opens the offline audio screen`}
              testID="faith-reciters-manage-offline"
            />,
          ]}
        </FaithRowGroup>
        <ModuleText token="caption" numberOfLines={3} style={{ paddingTop: dp(6) }}>
          Offline downloads are available for Abdur-Rahman as-Sudais only. Other reciters stream and
          are not kept on this device.
        </ModuleText>
      </View>

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
