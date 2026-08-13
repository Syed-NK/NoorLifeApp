import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';

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

  /**
   * Reads the download index into the pin registry, and clears expired and partial files.
   *
   * Once per provider mount, not per screen: the registry is what stops the prefetch evicting a
   * deliberate download, so it has to be populated before any preparation runs — and a sweep at
   * startup is the only thing that can remove a partial left behind by a process that was killed
   * mid-transfer, since no `catch` in that process ever ran.
   */
  useEffect(() => {
    void value.hydrate();
  }, [value]);

  return (
    <RecitationAudioContext.Provider value={value}>{children}</RecitationAudioContext.Provider>
  );
}

export function useRecitationAudio(): RecitationAudio {
  return useContext(RecitationAudioContext) ?? sharedRecitationAudio();
}
