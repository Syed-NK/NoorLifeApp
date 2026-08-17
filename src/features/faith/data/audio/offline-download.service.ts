import {
  ACTIVE_DOWNLOAD_STATES,
  bindGeneration,
  COMPLETE_AYAH_COUNT,
  EMPTY_MANIFEST,
  isPlayable,
  offlineFileName,
  PERMITTED_RESOURCE_ID,
  permanentDownloadPermitted,
  removeRows,
  removeSurahRows,
  setDownloadState,
  setScope,
  setWifiOnly,
  SURAH_COUNT,
  totalsOf,
  upsertRows,
  type OfflineDownloadState,
  type OfflineFileRow,
  type OfflineManifest,
  type OfflineScope,
} from '../../storage/faith-offline-recitation';
import type { ConnectivityPort, ConnectivityState } from '../connectivity/connectivity.port';
import { canDownload } from '../connectivity/connectivity.port';
import type { AudioStore } from './audio-store.port';
import {
  estimateSize,
  storageDecisionFor,
  withMeasuredSizes,
  STORAGE_SAFETY_MARGIN_BYTES,
  type SizeEstimate,
} from './offline-estimate';
import type { OfflineManifestStore } from './offline-manifest.store';
import {
  ayatBySurah,
  pendingWork,
  planReconciliation,
  queuedRowFor,
  type PublishedRow,
} from './offline-reconcile';

/**
 * The one authority on downloading, verifying, keeping and removing offline recitation.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── What this replaces, and why both could not stay ────────────────────────
 * NoorLife previously had two: a per-surah index whose files expired seven days after **download**,
 * and a per-ayah manifest nothing at runtime read. The first is not merely redundant, it is contrary
 * to the permission — it deletes permitted recitation from a user who has been offline, which is
 * exactly the user licence condition C9 protects. Both are gone. This is the only thing that writes
 * recitation bytes or decides whether they may be played.
 *
 * ── The permission, and where it is enforced rather than described ─────────
 * Indefinite retention is granted for **resource 3 alone**. That is enforced by
 * `permanentDownloadPermitted`, checked at the one entry point that starts a transfer, and by the
 * manifest itself refusing to hold any other resource id. There is no parameter, flag or preference
 * on this service through which another reciter could acquire the same treatment.
 *
 * The conditions attached to it are held as follows:
 *
 *   • **C1 private storage** — every byte goes through `AudioStore` constructed over
 *     `Paths.document`. No `MediaStore`, no shared storage, no share sheet, no export.
 *   • **C7 check every seven connected days** — `reconcile` is the check, `faith-recitation-check.ts`
 *     is the clock, and passing the window sets `update-required`/`sync-due` for display. It never
 *     deletes: an offline device accrues an owed check and keeps its audio.
 *   • **C4 recitation integrity** — an ayah is never skipped, never substituted, and never promoted
 *     without a signature check and, where the publisher stated one, an exact byte match.
 *   • **C5 users can remove** — `removeAll` and `removeSurah`, both reaching the filesystem rather
 *     than only the index.
 *
 * ── Nothing here starts by itself ──────────────────────────────────────────
 * There is no effect, no timer and no sign-in hook that calls `start`. A complete recitation is a
 * decision about somebody's storage and somebody's data allowance, and it happens because they
 * pressed a control that said so. `resume` is the only method that continues work without a fresh
 * press, and it only ever continues a scope the user already chose.
 *
 * ── Nothing here logs ──────────────────────────────────────────────────────
 * This module holds resolved vendor URLs in memory for the duration of one surah. It has no logger
 * and no `console` call, and failures are carried as members of a closed `OfflineFailure` set that
 * has no member capable of holding a URL, a host or a transport message.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/**
 * Why a run stopped, as a closed set.
 *
 * A set rather than a message, and the same rule the endpoint contract follows: there is no member
 * here that could carry a URL, a host, a path or a transport error string, so nothing from the CDN
 * can reach a screen even if a future edit tried to pass it along.
 */
export type OfflineFailure =
  /** The device could not reach the network, or lost it mid-run. Progress is kept. */
  | 'offline'
  /** The user's Wi-Fi-only preference is on and the link is not confirmed Wi-Fi. */
  | 'wifi-required'
  /** Not enough free space, before or during. Everything already verified is kept. */
  | 'insufficient-storage'
  /** The publisher did not return usable rows for a surah in scope. */
  | 'content-unavailable'
  /** Bytes arrived and were not the recitation they claimed to be. Retrying is correct. */
  | 'invalid-audio'
  /** The manifest could not be written durably. The run stops rather than diverging from the disk. */
  | 'write-failed'
  /** No validated Content Sync generation is available to bind to. */
  | 'no-generation';

/** Everything a screen needs, computed once per change rather than derived per render. */
export type OfflineSnapshot = {
  readonly state: OfflineDownloadState;
  readonly scope: OfflineScope;
  readonly wifiOnly: boolean;
  /** Ayat on disk, validated, and sourceable by a player. */
  readonly playableAyat: number;
  /** Ayat the bound generation publishes for the current scope. Zero when nothing is bound. */
  readonly totalAyat: number;
  readonly completeSurahs: number;
  readonly partialSurahs: number;
  /** Surahs the bound generation publishes. */
  readonly totalSurahs: number;
  readonly downloadedBytes: number;
  /** `null` until a generation is bound and an estimate has been computed. */
  readonly estimate: SizeEstimate | null;
  readonly failedAyat: number;
  readonly updateRequiredAyat: number;
  readonly generationId: string | null;
  readonly reconciledAt: number | null;
  readonly lastFailure: OfflineFailure | null;
  /**
   * Every surah with anything on the device, in surah order.
   *
   * ── Why this is in the snapshot and not derived in the screen ──────────────
   * It was a `useMemo` over 114 surahs keyed on `playableAyat`, and on a release device it went
   * **stale**: the header read "789 verses, 5 surahs complete" while the list below it showed surah 4
   * with 132 verses and no surah 5 at all. Two counters, one manifest, different answers — which is
   * the class of defect this whole feature is arranged to make impossible, reappearing in the one
   * place a memo stood between the data and the screen.
   *
   * Computing it here means every number on the screen comes from one walk of one manifest at one
   * instant. It is also cheaper: the loop ran on every render and now runs once per publish.
   */
  readonly downloadedSurahs: readonly {
    readonly surah: number;
    readonly playable: number;
    /** What the bound generation publishes for it, or `null` when nothing is bound. */
    readonly total: number | null;
    readonly complete: boolean;
  }[];
};

/**
 * Resolves vendor audio URLs for one surah, and holds them no longer than the transfers need.
 *
 * ── Why the URL is not stored on a manifest row ────────────────────────────
 * A CDN address can be rotated, re-signed or retired. Binding a downloaded file's durable identity to
 * one would make that identity depend on a value the vendor may change without telling anybody, and
 * would put a signed path fragment into a document that survives reboots and app upgrades. The
 * identity is the verse key; the URL is resolved from the currently published generation's publisher
 * at the moment a transfer runs and discarded when the surah finishes.
 */
export type RecitationUrlResolver = {
  resolve(
    surah: number,
    signal: AbortSignal,
  ): Promise<
    | { readonly kind: 'ok'; readonly urls: ReadonlyMap<number, string> }
    | { readonly kind: 'failed'; readonly reason: 'offline' | 'unavailable' }
  >;
};

/** One published generation, reduced to what a downloader needs. Never mixes two publications. */
export type BoundGeneration = {
  readonly generationId: string;
  readonly rows: readonly PublishedRow[];
};

export type GenerationSource = {
  /** The generation the pointer currently names, fully validated, or `null`. */
  active(): Promise<BoundGeneration | null>;
  /** One generation by id, so a run can re-read the one it bound to rather than the newest. */
  open(generationId: string): BoundGeneration | null;
};

export type OfflineDownloadService = {
  /** Reads the manifest and repairs it against the disk. Call once at startup. */
  hydrate(): Promise<void>;
  snapshot(): OfflineSnapshot;
  subscribe(listener: (snapshot: OfflineSnapshot) => void): () => void;

  /** Estimates a scope without fetching audio. Moves through `estimating` to `ready`. */
  prepare(scope: OfflineScope): Promise<SizeEstimate | null>;
  /** Begins or continues a scope. The only method a user press reaches to spend data. */
  start(scope: OfflineScope): Promise<void>;
  /** Continues the recorded scope. Used after a wait clears, never to start something new. */
  resume(): Promise<void>;
  /** Stops and stays stopped until the user says otherwise. Verified files are kept. */
  pause(): Promise<void>;
  /** Stops without deleting verified progress and clears the scope. */
  cancel(): Promise<void>;
  /** Re-queues only rows that failed or are missing. Downloads nothing that is already verified. */
  retryFailed(): Promise<void>;

  removeAll(): Promise<void>;
  removeSurah(surah: number): Promise<void>;

  /** Compares the device with the newest published generation and applies the plan. */
  reconcile(): Promise<void>;

  setWifiOnly(enabled: boolean): Promise<void>;

  /** Every ayah of one surah a player may source, in ayah order. Synchronous. */
  playableAyat(surah: number): readonly number[];
  /** The `file://` URI for one verified ayah, or `null`. Synchronous, for playlist construction. */
  localUriFor(surah: number, ayah: number): string | null;
  /** How many ayat the bound generation publishes for a surah. `null` when nothing is bound. */
  expectedAyat(surah: number): number | null;
};

/**
 * How many ayah files are transferred at once.
 *
 * Three, and the number is conservative on purpose. One is needlessly slow over a high-latency link
 * where most of each transfer is the round trip. Ten saturates a connection the user may also be
 * reading over, multiplies the damage of a cancellation, and on a mid-range Android device puts
 * enough concurrent writes through the filesystem that the manifest flush starts contending with the
 * transfers it is recording. Three keeps the pipe busy without the download becoming the only thing
 * the device is doing, and Phase 10 measures rather than assumes it.
 */
export const DOWNLOAD_CONCURRENCY = 3;

/** How many promoted files pass before free space is re-read. */
const STORAGE_RECHECK_EVERY = 50;

/**
 * How many promoted files pass before the screen is told.
 *
 * Ten, because `buildSnapshot` walks every manifest row: publishing per promotion is quadratic over a
 * 6,236-file run, and per-file work at that scale is what makes a multi-gigabyte download
 * unfinishable. Ten files is a second or two of wall-clock at the measured rate — frequent enough
 * that the counters visibly move, cheap enough to be free.
 */
const PROGRESS_PUBLISH_EVERY = 10;

type RunControl = {
  cancelled: boolean;
  /** The state a stop should land in. Set by whatever stopped the run. */
  stopState: OfflineDownloadState | null;
  failure: OfflineFailure | null;
  readonly controller: AbortController;
};

export function createOfflineDownloadService(config: {
  readonly manifest: OfflineManifestStore;
  readonly store: AudioStore;
  readonly resolver: RecitationUrlResolver;
  readonly connectivity: ConnectivityPort;
  readonly generations: GenerationSource;
  readonly now?: () => number;
  readonly concurrency?: number;
}): OfflineDownloadService {
  const { manifest, store, resolver, connectivity, generations } = config;
  const now = config.now ?? Date.now;
  const concurrency = config.concurrency ?? DOWNLOAD_CONCURRENCY;

  const listeners = new Set<(snapshot: OfflineSnapshot) => void>();

  /** The generation the current or last run is bound to. Never read from the pointer mid-run. */
  let bound: BoundGeneration | null = null;
  let estimate: SizeEstimate | null = null;
  let lastFailure: OfflineFailure | null = null;
  let run: RunControl | null = null;

  // ───────────────────────────────────────────────────────────────────────────
  // Reporting
  // ───────────────────────────────────────────────────────────────────────────

  function scopeSurahs(scope: OfflineScope): readonly number[] {
    return scope.kind === 'selected' ? scope.surahs : [];
  }

  function rowsInScope(generation: BoundGeneration, scope: OfflineScope): readonly PublishedRow[] {
    if (scope.kind === 'selected') {
      const wanted = new Set(scope.surahs);
      return generation.rows.filter((row) => wanted.has(row.surah));
    }
    return generation.rows;
  }

  function buildSnapshot(): OfflineSnapshot {
    const current = manifest.current();
    const counts = bound === null ? new Map<number, number>() : ayatBySurah(bound.rows);
    const totals = totalsOf(current, counts);
    const scoped = bound === null ? [] : rowsInScope(bound, current.scope);

    /* One walk of the rows, rather than 114 lookups per render. */
    const playableBySurah = new Map<number, number>();
    for (const row of current.rows) {
      if (isPlayable(row)) {
        playableBySurah.set(row.surah, (playableBySurah.get(row.surah) ?? 0) + 1);
      }
    }
    const downloadedSurahs = [...playableBySurah.entries()]
      .sort((left, right) => left[0] - right[0])
      .map(([surah, playable]) => {
        const total = counts.get(surah) ?? null;
        return { surah, playable, total, complete: total !== null && playable >= total };
      });

    return {
      state: current.download,
      scope: current.scope,
      wifiOnly: current.wifiOnly,
      playableAyat: totals.playableAyat,
      totalAyat: scoped.length,
      completeSurahs: totals.completeSurahs,
      partialSurahs: totals.partialSurahs,
      totalSurahs: counts.size,
      downloadedBytes: totals.playableBytes,
      estimate,
      failedAyat: totals.failedAyat,
      updateRequiredAyat: totals.updateRequiredAyat,
      generationId: current.generationId,
      reconciledAt: current.reconciledAt,
      lastFailure,
      downloadedSurahs,
    };
  }

  function publish(): void {
    const snapshot = buildSnapshot();
    for (const listener of listeners) {
      listener(snapshot);
    }
  }

  async function setState(state: OfflineDownloadState): Promise<boolean> {
    const stored = await manifest.mutate((value) => setDownloadState(value, state));
    publish();
    return stored;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Binding
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Binds this service to one published generation for the whole of a run.
   *
   * ── Why the id is re-opened rather than the pointer re-read ────────────────
   * A publication can land while a download is running. Re-reading the pointer would silently move
   * the run onto rows from a generation the files already promoted were never compared against, which
   * is exactly the mixing `faith-sync-generation.ts` was built to make impossible. So a run that has
   * already bound re-opens **its own** id, and a newer generation is applied by `reconcile` between
   * runs and never during one.
   */
  async function bindForRun(): Promise<BoundGeneration | null> {
    const current = manifest.current();
    if (current.generationId !== null && ACTIVE_DOWNLOAD_STATES.includes(current.download)) {
      const reopened = generations.open(current.generationId);
      if (reopened !== null) {
        bound = reopened;
        return reopened;
      }
    }
    const active = await generations.active();
    if (active === null) {
      return null;
    }
    const outcome = bindGeneration(manifest.current(), active.generationId);
    if (outcome.kind === 'refused') {
      /* A run is live under a different generation. Its own binding stands. */
      return bound;
    }
    await manifest.mutate(() => outcome.manifest);
    bound = active;
    return active;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Gates — storage and connectivity, checked before and during
  // ───────────────────────────────────────────────────────────────────────────

  function verifiedBytesFor(scope: OfflineScope): number {
    const current = manifest.current();
    const wanted = scope.kind === 'selected' ? new Set(scope.surahs) : null;
    let bytes = 0;
    for (const row of current.rows) {
      if (wanted !== null && !wanted.has(row.surah)) {
        continue;
      }
      if (row.state === 'available' && row.validation === 'signature-ok') {
        bytes += row.bytes;
      }
    }
    return bytes;
  }

  /**
   * The estimate for a set of published rows, with this device's own measurements folded in.
   *
   * ── Why the manifest is consulted rather than just the publication ─────────
   * Because the publication carries no sizes. Every one of the 6,236 live resource-3 rows has
   * `bytes: null` — Quran Foundation publishes a duration per ayah and no file size — so an estimate
   * built from the generation alone can never say anything about bytes, however far the download
   * gets.
   *
   * What the device *does* have, once files start landing, is measurements: real files, this reciter,
   * at the bitrate the CDN actually served. Folding them in is what turns "the total is not known"
   * into a projection that gets better as it goes, and `withMeasuredSizes` marks them so the screen
   * says they came from the download rather than from the publisher.
   */
  function estimateFor(scoped: readonly PublishedRow[]): SizeEstimate {
    const measured = new Map<string, number>();
    for (const row of manifest.current().rows) {
      if (isPlayable(row) && row.bytes > 0) {
        measured.set(row.verseKey, row.bytes);
      }
    }
    return estimateSize(
      withMeasuredSizes(
        scoped.map((row) => ({
          surah: row.surah,
          ayah: row.ayah,
          bytes: row.bytes,
          durationSeconds: row.durationSeconds,
        })),
        measured,
      ),
    );
  }

  function storageGate(scope: OfflineScope): OfflineFailure | null {
    if (estimate === null) {
      return null;
    }
    const decision = storageDecisionFor({
      estimate,
      availableBytes: store.availableBytes(),
      alreadyDownloadedBytes: verifiedBytesFor(scope),
    });
    return decision.kind === 'insufficient' ? 'insufficient-storage' : null;
  }

  /** Whether free space has fallen below the safety margin while a run is going. */
  function storageStillSafe(): boolean {
    const free = store.availableBytes();
    return free === null || free >= STORAGE_SAFETY_MARGIN_BYTES;
  }

  function connectivityGate(
    state: ConnectivityState,
    wifiOnly: boolean,
  ): OfflineDownloadState | null {
    if (canDownload(state, wifiOnly)) {
      return null;
    }
    /*
      The two waits are kept apart because their remedies are. `waiting-for-wifi` is the user's own
      preference holding the download and clears when they reach Wi-Fi or allow cellular;
      `waiting-for-connection` is the device having nothing usable at all. Collapsing them would make
      the screen tell a user on a good cellular link that they have no connection.
    */
    if (wifiOnly && state.reachability !== 'offline') {
      return 'waiting-for-wifi';
    }
    return 'waiting-for-connection';
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Transfers
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Classifies a rejection from the store without reading a message the transport wrote.
   *
   * The store throws exactly two errors of its own — `invalid` for a body that was not the recitation
   * it claimed to be, and `cancelled` for an abort observed after the bytes landed. Everything else
   * came from the platform's networking stack and its `message` is a string this app has no screen
   * for and must not surface, so all of it collapses to `offline`, which is honest: the transfer began
   * and did not produce a usable file, and the connectivity check that follows decides whether to wait
   * or to fail.
   */
  function classify(error: unknown): 'invalid' | 'cancelled' | 'transport' {
    const name = error instanceof Error ? error.name : '';
    const message = error instanceof Error ? error.message : '';
    if (name === 'AbortError' || message === 'cancelled') {
      return 'cancelled';
    }
    /*
      Written as a branch rather than a ternary so the transport's own string never appears to the
      right of a `return`. It is compared here and goes no further — `offline-audio-source-scan`
      asserts exactly that, and a ternary makes the two indistinguishable to a scan.
    */
    if (message === 'invalid') {
      return 'invalid';
    }
    return 'transport';
  }

  /**
   * Downloads one surah's ayat with bounded concurrency, recording each promotion.
   *
   * Returns the number promoted. Stops at the first genuine failure rather than pressing on: a run
   * that quietly omitted the ayat it could not fetch would present a surah as downloaded and then play
   * it with holes in it, which is the worst outcome this feature has available.
   */
  async function downloadSurah(
    control: RunControl,
    generation: BoundGeneration,
    surah: number,
    work: readonly PublishedRow[],
  ): Promise<number> {
    const resolved = await resolver.resolve(surah, control.controller.signal);
    if (control.cancelled) {
      return 0;
    }
    if (resolved.kind === 'failed') {
      control.failure = resolved.reason === 'offline' ? 'offline' : 'content-unavailable';
      control.stopState = resolved.reason === 'offline' ? 'waiting-for-connection' : 'failed';
      return 0;
    }

    const ordered = [...work].sort((left, right) => left.ayah - right.ayah);
    let cursor = 0;
    let promoted = 0;
    let sinceStorageCheck = 0;

    const worker = async (): Promise<void> => {
      for (;;) {
        if (control.cancelled || control.failure !== null) {
          return;
        }
        const index = cursor;
        cursor += 1;
        const published = ordered[index];
        if (published === undefined) {
          return;
        }

        const url = resolved.urls.get(published.ayah);
        if (url === undefined) {
          /*
            The publisher listed the verse in the generation and did not serve a URL for it. That is a
            content gap, not a transport fault, and pressing on would leave a hole in the surah.
          */
          control.failure = 'content-unavailable';
          control.stopState = 'failed';
          return;
        }

        const fileName = offlineFileName(PERMITTED_RESOURCE_ID, surah, published.ayah);
        try {
          const file = await store.download({
            url,
            name: fileName,
            signal: control.controller.signal,
            expectedBytes: published.bytes,
          });
          promoted += 1;
          const row: OfflineFileRow = {
            resourceId: PERMITTED_RESOURCE_ID,
            surah,
            ayah: published.ayah,
            verseKey: published.verseKey,
            fileName,
            state: 'available',
            bytes: file.bytes,
            expectedBytes: published.bytes,
            validation: 'signature-ok',
            generationId: generation.generationId,
            sequence: published.sequence,
            completedAt: now(),
            verifiedAt: now(),
          };
          /*
            Recorded, not written. The bytes are already durable under an atomic rename; the index
            entry is batched. A crash here costs a re-verification of this file on the next launch,
            never a re-download and never a playable file that nothing knows about.
          */
          await manifest.record((value) => upsertRows(value, [row]));

          /**
           * Tell the screen, on a bounded cadence.
           *
           * ── The defect this closes, seen on a release device ──────────────────
           * Progress was only published on a *state* change, and a run has none between `downloading`
           * and its terminal state. So the Offline audio screen sat at "0 of 6,236 verses • 0 bytes"
           * while 288 files landed on the device — a download that looks broken while working
           * perfectly, over a multi-gigabyte transfer somebody is waiting on.
           *
           * Every tenth file rather than every file, because `buildSnapshot` walks the manifest rows:
           * publishing per promotion is quadratic over a 6,236-file run, and the whole reason the
           * index is batched is that per-file work at this scale is what makes a download unfinishable.
           */
          if (promoted % PROGRESS_PUBLISH_EVERY === 0) {
            publish();
          }
        } catch (error) {
          const kind = classify(error);
          if (kind === 'cancelled') {
            return;
          }
          if (kind === 'invalid') {
            control.failure = 'invalid-audio';
            control.stopState = 'failed';
            /*
              ── A failed *replacement* must not cost the user the recitation they have ──
              Marking the row `failed` unconditionally looks like the honest thing and is not. When
              this transfer was fetching a replacement for a verse the device already holds, the
              existing bytes are untouched on disk and still valid — the atomic promotion never
              happened, which is the whole point of promoting last. Demoting the row would make a
              verse the user can play disappear from the surah because a *newer* recording failed to
              download, which is a hole in the Qur'an caused by an update.

              So a playable row keeps its state and stays owed a replacement; only a verse with
              nothing valid behind it becomes `failed`.
            */
            const previous =
              manifest
                .current()
                .rows.find((entry) => entry.surah === surah && entry.ayah === published.ayah) ??
              null;
            if (previous !== null && isPlayable(previous)) {
              return;
            }
            await manifest.record((value) =>
              upsertRows(value, [
                {
                  ...queuedRowFor({
                    resourceId: PERMITTED_RESOURCE_ID,
                    published,
                    generationId: generation.generationId,
                    previous,
                  }),
                  state: 'failed',
                  validation: 'rejected',
                },
              ]),
            );
            return;
          }
          /*
            A transport fault. Whether this is a network loss or a one-off is decided by asking the
            device rather than by reading the error — see the note on `classify`.
          */
          const state = await connectivity.current();
          control.failure = 'offline';
          control.stopState =
            state.reachability === 'offline' ? 'waiting-for-connection' : 'partially-downloaded';
          return;
        }

        sinceStorageCheck += 1;
        if (sinceStorageCheck >= STORAGE_RECHECK_EVERY) {
          sinceStorageCheck = 0;
          if (!storageStillSafe()) {
            /*
              Stopped, and everything already verified is kept. Deleting downloaded ayat to make room
              for the rest of the same download would be spending the user's connection twice to end
              up with less.
            */
            control.failure = 'insufficient-storage';
            control.stopState = 'insufficient-storage';
            return;
          }
        }
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(concurrency, ordered.length) }, () => worker()),
    );
    return promoted;
  }

  /**
   * One run, from binding to a terminal state.
   *
   * Surah by surah in ascending order, so an interrupted run leaves whole surahs playable rather than
   * a scatter across all 114 of which none can be played end to end. URLs are resolved for one surah
   * at a time and discarded with it.
   */
  async function execute(scope: OfflineScope): Promise<void> {
    if (run !== null) {
      /* Already running. A second press is not a second download. */
      return;
    }

    const control: RunControl = {
      cancelled: false,
      stopState: null,
      failure: null,
      controller: new AbortController(),
    };
    run = control;
    lastFailure = null;

    try {
      const generation = await bindForRun();
      if (generation === null) {
        lastFailure = 'no-generation';
        await setState('failed');
        return;
      }

      await setState('estimating');
      const scoped = rowsInScope(generation, scope);
      estimate = estimateFor(scoped);

      const storage = storageGate(scope);
      if (storage !== null) {
        lastFailure = storage;
        await setState('insufficient-storage');
        return;
      }

      const wifiOnly = manifest.current().wifiOnly;
      const network = await connectivity.current();
      const waiting = connectivityGate(network, wifiOnly);
      if (waiting !== null) {
        lastFailure = waiting === 'waiting-for-wifi' ? 'wifi-required' : 'offline';
        await setState(waiting);
        return;
      }

      await setState('downloading');

      const work = pendingWork({
        manifest: manifest.current(),
        published: scoped,
        surahs: scopeSurahs(scope),
      });

      const bySurah = new Map<number, PublishedRow[]>();
      for (const row of work) {
        const list = bySurah.get(row.surah);
        if (list === undefined) {
          bySurah.set(row.surah, [row]);
        } else {
          list.push(row);
        }
      }

      for (const surah of [...bySurah.keys()].sort((a, b) => a - b)) {
        if (control.cancelled || control.failure !== null) {
          break;
        }
        /*
          Re-checked per surah rather than once at the top. A run over the complete Qur'an takes long
          enough that the user can leave Wi-Fi, and continuing on cellular against their stated
          preference is the one thing a Wi-Fi-only setting exists to prevent.
        */
        const state = await connectivity.current();
        const wait = connectivityGate(state, manifest.current().wifiOnly);
        if (wait !== null) {
          control.stopState = wait;
          control.failure = wait === 'waiting-for-wifi' ? 'wifi-required' : 'offline';
          break;
        }
        await downloadSurah(control, generation, surah, bySurah.get(surah) ?? []);
      }

      await manifest.flush();

      if (control.cancelled && control.stopState === null) {
        return;
      }

      lastFailure = control.failure;
      const counts = ayatBySurah(scoped);
      const totals = totalsOf(manifest.current(), counts);
      const finished = totals.playableAyat >= scoped.length && scoped.length > 0;

      await setState(control.stopState ?? (finished ? 'complete' : 'partially-downloaded'));
    } finally {
      run = null;
      await manifest.flush();
      publish();
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Disk reconciliation — the manifest is repaired from the bytes, never the reverse
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Brings the manifest into agreement with the filesystem.
   *
   * ── Why the disk wins about existence and the manifest wins about meaning ──
   * A row cannot prove a file exists: the OS reclaims storage, a user can clear app data, and a crash
   * between a promotion and the next flush leaves valid bytes with no row. A file cannot prove its own
   * meaning: a name is a guess about identity, and the whole reason this manifest exists is that
   * presence is not identity.
   *
   * So a row whose file has vanished loses its playable state and becomes work to redo; a file with no
   * row is **not** adopted here as playable — it is left for `migrateLegacyFiles`, which proves its
   * identity against a published generation before anything may source it.
   */
  async function reconcileAgainstDisk(): Promise<void> {
    const current = manifest.current();
    if (current.rows.length === 0) {
      return;
    }
    const onDisk = new Map(store.list().map((file) => [file.name, file.bytes]));
    const repaired: OfflineFileRow[] = [];
    for (const row of current.rows) {
      const bytes = onDisk.get(row.fileName);
      if (bytes === undefined) {
        if (row.state === 'available' || row.state === 'update-required') {
          /*
            Recorded as playable, and the bytes are gone. Demoted to `queued` with a zero byte count
            rather than removed, so the surah still counts as wanted and the retry path finds it.
          */
          repaired.push({
            ...row,
            state: 'queued',
            bytes: 0,
            validation: 'unverified',
            completedAt: null,
          });
        }
        continue;
      }
      if (row.state === 'available' && bytes !== row.bytes) {
        /* Present but a different size than recorded — truncated by the OS, or never fully written. */
        repaired.push({ ...row, state: 'queued', bytes: 0, validation: 'unverified' });
      }
    }
    if (repaired.length > 0) {
      await manifest.mutate((value) => upsertRows(value, repaired));
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // The service
  // ───────────────────────────────────────────────────────────────────────────

  return {
    async hydrate(): Promise<void> {
      await manifest.load();
      /*
        Partials from a process that was killed mid-transfer. No `catch` in that process ever ran, so
        this is the only thing that can remove them, and they are otherwise invisible — `list()` skips
        them by name.
      */
      store.sweepIncomplete();
      await reconcileAgainstDisk();
      bound = await generations.active();

      /**
       * The estimate, computed at hydrate so the screen has something true to say immediately.
       *
       * ── The gap this closes, found on a device and not in a test ───────────────
       * `estimate` used to stay `null` until `prepare` or `start` ran, so a user opening Offline audio
       * for the first time read **"Size will be worked out when you start a download"** — which tells
       * them nothing they can act on, and hides the one published figure that *is* actionable. The
       * feed carries `durationSeconds` on all 6,236 rows; withholding that until somebody commits to a
       * download is being uninformative rather than being careful.
       *
       * It costs nothing and commits to nothing: the generation is already on disk, the computation is
       * arithmetic over rows already read, and it neither changes the download state nor sets a scope.
       * Spending storage or data still requires the user to press something.
       */
      if (bound !== null) {
        estimate = estimateFor(rowsInScope(bound, { kind: 'complete' }));
      }

      /*
        A run that was live when the process died is not resumed automatically. It is reported as
        stopped so the user decides — restarting a several-hundred-megabyte transfer without being
        asked is the behaviour locked decision 4 forbids.
      */
      const current = manifest.current();
      if (ACTIVE_DOWNLOAD_STATES.includes(current.download)) {
        await setState(current.rows.length === 0 ? 'not-downloaded' : 'partially-downloaded');
      }
      publish();
    },

    snapshot: buildSnapshot,

    subscribe(listener): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    async prepare(scope): Promise<SizeEstimate | null> {
      if (!permanentDownloadPermitted(PERMITTED_RESOURCE_ID)) {
        return null;
      }
      await setState('estimating');
      const generation = await bindForRun();
      if (generation === null) {
        lastFailure = 'no-generation';
        await setState('failed');
        return null;
      }
      const scoped = rowsInScope(generation, scope);
      estimate = estimateFor(scoped);
      await manifest.mutate((value) => setScope(value, scope));
      const storage = storageGate(scope);
      if (storage !== null) {
        lastFailure = storage;
        await setState('insufficient-storage');
        return estimate;
      }
      lastFailure = null;
      await setState('ready');
      return estimate;
    },

    async start(scope): Promise<void> {
      await manifest.mutate((value) => setScope(value, scope));
      await execute(scope);
    },

    async resume(): Promise<void> {
      const scope = manifest.current().scope;
      if (scope.kind === 'none') {
        return;
      }
      await execute(scope);
    },

    async pause(): Promise<void> {
      const control = run;
      if (control !== null) {
        control.cancelled = true;
        control.stopState = 'paused';
        control.controller.abort();
      }
      await manifest.flush();
      await setState('paused');
    },

    async cancel(): Promise<void> {
      const control = run;
      if (control !== null) {
        control.cancelled = true;
        control.stopState = null;
        control.controller.abort();
      }
      await manifest.flush();
      /*
        Verified files are kept and the scope is cleared. Cancelling is "stop asking me to finish
        this", not "throw away what I already have" — removal is a separate, confirmed action.
      */
      await manifest.mutate((value) => {
        const cleared = setScope(value, { kind: 'none' });
        return setDownloadState(
          cleared,
          cleared.rows.some((row) => row.state === 'available')
            ? 'partially-downloaded'
            : 'not-downloaded',
        );
      });
      publish();
    },

    async retryFailed(): Promise<void> {
      const current = manifest.current();
      const retryable = current.rows.filter(
        (row) => row.state === 'failed' || row.state === 'queued',
      );
      if (retryable.length === 0) {
        return;
      }
      /*
        Only the failed rows are reset. Everything verified stays exactly as it is, so a retry after a
        run that got 6,000 of 6,236 files fetches 236 and not 6,236.
      */
      await manifest.mutate((value) =>
        upsertRows(
          value,
          retryable.map((row) => ({
            ...row,
            state: 'queued' as const,
            validation: 'unverified' as const,
            bytes: 0,
          })),
        ),
      );
      await this.resume();
    },

    async removeAll(): Promise<void> {
      const control = run;
      if (control !== null) {
        /*
          Cancellation before deletion, and the order is load-bearing. A transfer in flight holds a
          promotion that has not happened yet; deleting first would let it promote a file after the
          directory was swept, leaving bytes with no row describing them.
        */
        control.cancelled = true;
        control.stopState = null;
        control.controller.abort();
      }
      await setState('removing');
      for (const file of store.list()) {
        store.remove(file.name);
      }
      store.sweepIncomplete();
      await manifest.mutate(() => ({ ...EMPTY_MANIFEST, wifiOnly: manifest.current().wifiOnly }));
      estimate = null;
      lastFailure = null;
      publish();
    },

    async removeSurah(surah): Promise<void> {
      const control = run;
      if (control !== null) {
        control.cancelled = true;
        control.stopState = 'partially-downloaded';
        control.controller.abort();
      }
      await setState('removing');
      for (const row of manifest.current().rows.filter((entry) => entry.surah === surah)) {
        store.remove(row.fileName);
      }
      await manifest.mutate((value) => {
        const dropped = removeSurahRows(value, surah);
        return setDownloadState(
          dropped,
          dropped.rows.some((row) => row.state === 'available')
            ? 'partially-downloaded'
            : 'not-downloaded',
        );
      });
      publish();
    },

    async reconcile(): Promise<void> {
      if (run !== null) {
        /*
          A run is live and is bound to a generation. Applying a newer one now would mix publications
          inside one mutation, which is the single thing the generation model exists to forbid.
        */
        return;
      }
      const active = await generations.active();
      if (active === null) {
        lastFailure = 'no-generation';
        publish();
        return;
      }

      const plan = planReconciliation({
        manifest: manifest.current(),
        generationId: active.generationId,
        published: active.rows,
        at: now(),
      });

      /*
        Withdrawn files are removed from the disk; updated ones are not touched, because they are
        still the recitation the user has and they stay playable until a validated replacement is
        promoted over them by the next run.
      */
      for (const row of plan.withdrawn) {
        store.remove(row.fileName);
      }

      await manifest.mutate((value) => {
        const withoutWithdrawn = removeRows(
          value,
          plan.withdrawn.map((row) => ({ surah: row.surah, ayah: row.ayah })),
        );
        const applied = upsertRows(withoutWithdrawn, [...plan.updated, ...plan.unchanged]);
        return {
          ...applied,
          generationId: active.generationId,
          reconciledAt: now(),
          download:
            plan.updated.length > 0
              ? ('update-required' as const)
              : applied.rows.some((row) => row.state === 'available')
                ? applied.download === 'complete'
                  ? ('complete' as const)
                  : applied.download
                : applied.download,
        };
      });

      bound = active;
      publish();
    },

    async setWifiOnly(enabled): Promise<void> {
      await manifest.mutate((value) => setWifiOnly(value, enabled));
      publish();
    },

    playableAyat(surah): readonly number[] {
      /*
        `isPlayable` rather than a state comparison written out here. It is the one place the rule
        lives, and it includes `update-required` deliberately — a superseded recitation is still a
        recitation, and withholding it would put a hole in the surah for the whole update window.
      */
      return manifest
        .current()
        .rows.filter((row) => row.surah === surah && isPlayable(row))
        .map((row) => row.ayah)
        .sort((left, right) => left - right);
    },

    localUriFor(surah, ayah): string | null {
      const current = manifest.current();
      const row = current.rows.find((entry) => entry.surah === surah && entry.ayah === ayah);
      if (row === undefined || !isPlayable(row)) {
        return null;
      }
      /*
        The filesystem is asked, not trusted from the row. A row says the bytes were validated; only
        the store can say they are still there, and handing a player a URI for a file the OS has
        reclaimed produces a playback error attributed to the verse rather than to the reclamation.
      */
      return store.read(row.fileName)?.uri ?? null;
    },

    expectedAyat(surah): number | null {
      if (bound === null) {
        return null;
      }
      return ayatBySurah(bound.rows).get(surah) ?? null;
    },
  };
}

/** Re-exported so a caller naming this module does not also have to import the schema. */
export { COMPLETE_AYAH_COUNT, SURAH_COUNT, PERMITTED_RESOURCE_ID };
export type { OfflineManifest, OfflineScope, OfflineFileRow };
