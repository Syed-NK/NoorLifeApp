import { Stack } from 'expo-router';

import { FaithRepositoryProvider } from '@features/faith/di/faith-repository-context';
import { RecitationAudioProvider } from '@features/faith/di/recitation-audio-context';
import { FaithPreferencesProvider } from '@features/faith/state/faith-preferences-provider';

/**
 * The Faith module navigator (workflow §3.2: a module owns its own stack).
 *
 * The repository provider is mounted here rather than per screen so every Faith route
 * shares one set of data sources — which is what makes swapping in the approved Quran
 * Foundation adapter a single-file change, and what lets a test override one repository
 * for the whole module at once.
 */
export default function Layout() {
  return (
    /*
      Outermost of the Faith-scoped providers: the repositories and the audio service both read
      preferences on their own paths, and this is the one place that guarantees the read has been
      started before either of them mounts. It holds no state — the snapshot is a module singleton in
      `faith-preferences-store.ts` — so being a provider is about naming the hydration point, not
      about scoping the value.
    */
    <FaithPreferencesProvider>
      <FaithRepositoryProvider>
        {/*
          The recitation audio service is Faith-scoped and deliberately not mounted at application
          startup: it sweeps a cache directory and reads the download index, which is work no launch
          that never opens the Qur'an should do. Mounting it here means one service for the whole
          module, so the in-flight map that deduplicates transfers survives navigation between the
          reader, the reciter catalogue and the player.
        */}
        <RecitationAudioProvider>
          <Stack screenOptions={{ headerShown: false }} />
        </RecitationAudioProvider>
      </FaithRepositoryProvider>
    </FaithPreferencesProvider>
  );
}
