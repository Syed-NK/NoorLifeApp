import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { createExpoAudioStore, createRecitationAudio, type RecitationAudio } from '../data/audio';

/**
 * The recitation audio service for the current tree.
 *
 * ── Why this is its own context and not a `FaithRepositories` member ────────
 * A repository answers questions about *content*. This service writes bytes to the device, holds
 * cancellation handles for transfers in flight, and owns a pin registry that decides what may be
 * evicted. Folding it into the repository set would make every Faith test that supplies one
 * repository construct a filesystem-backed service it does not use, and would blur a boundary worth
 * keeping sharp: the repositories are swappable data sources, this is a stateful device resource.
 *
 * ── The default is a real, working service ──────────────────────────────────
 * Constructed once at module scope for the same reason `defaultRepositories` is: a service rebuilt
 * per render would restart every effect that depends on it, and — worse here than there — would lose
 * the in-flight map that makes deduplication work, so two renders during a navigation would produce
 * two transfers of the same ayah.
 */
const RecitationAudioContext = createContext<RecitationAudio | null>(null);

/**
 * Bumped when the service has finished reading the download index.
 *
 * ── The defect this closes ──────────────────────────────────────────────────
 * `stateFor` is synchronous and answers from `records`, which is empty until `hydrate()` resolves.
 * A screen that mounted in that window — the reader always does, because the provider's effect and
 * the reader's first render happen in the same commit — asked "is this surah downloaded?" before
 * anything knew, was told no, and never asked again. So the player offered **Download** for a surah
 * that was already on the device, while the reciter screen, mounted later, correctly offered Remove.
 * Two surfaces, one service, opposite answers.
 *
 * A revision rather than a boolean, so a consumer can put it straight into a dependency array
 * alongside the ticks it already reads and does not have to distinguish "not yet" from "changed".
 */
const RecitationAudioRevisionContext = createContext(0);

/**
 * Built lazily, on first use, rather than at import.
 *
 * `createExpoAudioStore` itself touches nothing on construction — it only closes over the paths —
 * but a module-level call would still run during any import of this file, including in a test that
 * supplies its own service and never renders a player. Deferring keeps the filesystem entirely out
 * of trees that do not use it.
 */
let shared: RecitationAudio | null = null;

function sharedRecitationAudio(): RecitationAudio {
  shared ??= createRecitationAudio({ store: createExpoAudioStore() });
  return shared;
}

export function RecitationAudioProvider({
  audio,
  children,
}: {
  /** Overrides the shared service. Supplied by tests and by nothing else. */
  readonly audio?: RecitationAudio;
  readonly children: ReactNode;
}) {
  const value = useMemo(() => audio ?? sharedRecitationAudio(), [audio]);
  const [revision, setRevision] = useState(0);

  /**
   * Reads the download index into the pin registry, and clears expired and partial files.
   *
   * Once per provider mount, not per screen: the registry is what stops the prefetch evicting a
   * deliberate download, so it has to be populated before any preparation runs — and a sweep at
   * startup is the only thing that can remove a partial left behind by a process that was killed
   * mid-transfer, since no `catch` in that process ever ran.
   *
   * The revision is bumped when it lands, so screens that asked `stateFor` too early ask again. See
   * `RecitationAudioRevisionContext`.
   */
  useEffect(() => {
    let active = true;
    void value.hydrate().then(() => {
      if (active) {
        setRevision((current) => current + 1);
      }
    });
    return () => {
      active = false;
    };
  }, [value]);

  return (
    <RecitationAudioContext.Provider value={value}>
      <RecitationAudioRevisionContext.Provider value={revision}>
        {children}
      </RecitationAudioRevisionContext.Provider>
    </RecitationAudioContext.Provider>
  );
}

export function useRecitationAudio(): RecitationAudio {
  return useContext(RecitationAudioContext) ?? sharedRecitationAudio();
}

/**
 * A number that changes once the download index has been read.
 *
 * Put it in the dependency array of anything that calls `stateFor`. Without it a synchronous read
 * taken during the first commit is kept forever, and the screen reports "not downloaded" about a
 * surah sitting on the device.
 */
export function useRecitationAudioRevision(): number {
  return useContext(RecitationAudioRevisionContext);
}
