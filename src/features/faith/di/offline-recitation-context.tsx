import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { createExpoAudioStore } from '../data/audio/expo-audio-store';
import { createExpoManifestFile } from '../data/audio/expo-manifest-file';
import {
  createGenerationSource,
  createRepositoryUrlResolver,
} from '../data/audio/offline-adapters';
import {
  createOfflineDownloadService,
  type OfflineDownloadService,
  type OfflineSnapshot,
} from '../data/audio/offline-download.service';
import { createOfflineManifestStore } from '../data/audio/offline-manifest.store';
import { adoptPromotedOrphans, migrateLegacyAudio } from '../data/audio/offline-migration';
import { createExpoConnectivity } from '../data/connectivity/expo-connectivity.port';
import { SUDAIS_RESOURCE_ID } from '../data/quran-foundation/recitation-attribution';
import type { QuranContentRepository, ReciterId } from '../data/quran-content.repository';
import { useFaithRepositories } from './faith-repository-context';

/**
 * The offline recitation service for the current tree.
 *
 * ── Why this is its own context and not a `FaithRepositories` member ────────
 * A repository answers questions about *content*. This service writes bytes to the device, holds
 * cancellation handles for transfers in flight, and owns the manifest that decides what may be played.
 * Folding it into the repository set would make every Faith test that supplies one repository
 * construct a filesystem-backed service it does not use, and would blur a boundary worth keeping
 * sharp: the repositories are swappable data sources, this is a stateful device resource.
 *
 * ── The revision, and the defect it closes ──────────────────────────────────
 * `playableAyat` and `localUriFor` are synchronous and answer from the in-memory manifest, which is
 * empty until `hydrate()` resolves. A screen that mounted in that window — the reader always does,
 * because the provider's effect and the reader's first render happen in the same commit — asked "is
 * this surah downloaded?" before anything knew, was told no, and never asked again. So the player
 * offered nothing for a surah that was already on the device.
 *
 * A revision number rather than a boolean, because it also has to change on every *subsequent*
 * mutation: a download finishing, a surah being removed, a reconciliation landing. Consumers put it
 * in a dependency array and do not have to distinguish "not yet" from "changed".
 *
 * ── Nothing here starts a download ──────────────────────────────────────────
 * The mount effect loads the manifest, sweeps partials, repairs the index against the disk and runs
 * the one-time migration. It does not call `start`, `resume` or `prepare`. Locked decision 4 — do not
 * automatically spend storage or mobile data at sign-in — is a property of this effect containing no
 * such call, and `offline-audio-autostart-scan.test.ts` asserts it stays that way.
 */

type OfflineRecitation = {
  readonly service: OfflineDownloadService;
  /** Changes whenever the manifest has. Put it in the dependency array of any synchronous read. */
  readonly revision: number;
  readonly snapshot: OfflineSnapshot;
};

const OfflineRecitationContext = createContext<OfflineRecitation | null>(null);

/**
 * Built lazily, on first use, rather than at import.
 *
 * The constructors themselves touch nothing — they close over paths and ports — but a module-level
 * call would still run during any import of this file, including in a test that supplies its own
 * service and never renders a player. Deferring keeps the filesystem entirely out of trees that do
 * not use it.
 */
let shared: OfflineDownloadService | null = null;

function sharedService(quran: QuranContentRepository): OfflineDownloadService {
  shared ??= createOfflineDownloadService({
    manifest: createOfflineManifestStore({ file: createExpoManifestFile() }),
    store: createExpoAudioStore('downloaded'),
    resolver: createRepositoryUrlResolver(quran, SUDAIS_RESOURCE_ID as ReciterId),
    connectivity: createExpoConnectivity(),
    generations: createGenerationSource(),
  });
  return shared;
}

export function OfflineRecitationProvider({
  service,
  children,
}: {
  /** Overrides the shared service. Supplied by tests and by nothing else. */
  readonly service?: OfflineDownloadService;
  readonly children: ReactNode;
}) {
  const { quran } = useFaithRepositories();
  const value = useMemo(() => service ?? sharedService(quran), [service, quran]);
  const [revision, setRevision] = useState(0);
  const [snapshot, setSnapshot] = useState<OfflineSnapshot>(() => value.snapshot());

  const bump = useCallback(() => {
    setRevision((current) => current + 1);
    setSnapshot(value.snapshot());
  }, [value]);

  /**
   * Reads the manifest, repairs it against the disk, and adopts pre-manifest files.
   *
   * Once per provider mount, not per screen. The migration is idempotent and returns
   * `already-migrated` on every launch after the first, so this costs one manifest read in the
   * ordinary case.
   */
  useEffect(() => {
    let active = true;
    const unsubscribe = value.subscribe((next) => {
      if (active) {
        setRevision((current) => current + 1);
        setSnapshot(next);
      }
    });

    void (async () => {
      await value.hydrate();
      if (!active) {
        return;
      }
      /*
        Migration needs the same two stores the service uses, plus the legacy cache directory that
        nothing writes to any more. Constructed here rather than held by the service, because this is
        a one-time concern and the service should not carry a reference to a store it will never use
        again once the migration has run.
      */
      const downloaded = createExpoAudioStore('downloaded');
      const manifestStore = createOfflineManifestStore({ file: createExpoManifestFile() });
      const generation = await createGenerationSource().active();

      await migrateLegacyAudio({
        downloaded,
        prepared: createExpoAudioStore('prepared'),
        manifest: manifestStore,
        generation,
        now: Date.now,
      });

      /*
        ── Promoted-but-unrecorded files, on every mount ──────────────────────
        A force-stop between a batch of promotions and the manifest's atomic write leaves final
        audio on disk that no manifest row describes. Measured on a real device as 3,490 files
        against 3,483 rows: seven files invisible to every count the app makes, and not playable,
        because playback is sourced from the manifest rather than from a directory listing.

        Unlike the legacy migration above this is **not** gated on a one-time flag: the crash can
        happen on any run, so a once-ever pass would make the next occurrence permanent. After a
        clean shutdown it costs one directory listing that finds nothing.

        Adoption is hostile by default — a filename alone proves nothing, so each candidate must be
        corroborated against the active generation and pass the same content validation a fresh
        download passes. See `offline-orphan-adoption.ts`.
      */
      await adoptPromotedOrphans({
        downloaded,
        manifest: manifestStore,
        generation,
        now: Date.now,
      });
      if (active) {
        bump();
      }
    })();

    return () => {
      active = false;
      unsubscribe();
    };
  }, [value, bump]);

  const context = useMemo(
    () => ({ service: value, revision, snapshot }),
    [value, revision, snapshot],
  );

  return (
    <OfflineRecitationContext.Provider value={context}>
      {children}
    </OfflineRecitationContext.Provider>
  );
}

/**
 * The offline recitation service, its revision and its current snapshot.
 *
 * Throws nothing when there is no provider: a default context is constructed from the shared service
 * so a screen rendered outside the Faith tree degrades to "nothing downloaded" rather than crashing.
 */
export function useOfflineRecitation(): OfflineRecitation {
  const context = useContext(OfflineRecitationContext);
  const { quran } = useFaithRepositories();
  const fallback = useMemo(() => {
    const service = sharedService(quran);
    return { service, revision: 0, snapshot: service.snapshot() };
  }, [quran]);
  return context ?? fallback;
}
