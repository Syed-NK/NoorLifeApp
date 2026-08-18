import { Stack } from 'expo-router';

import { LegacyDataPrompt } from '@features/faith/components/legacy-data-prompt';
import { FaithRepositoryProvider } from '@features/faith/di/faith-repository-context';
import { OfflineRecitationProvider } from '@features/faith/di/offline-recitation-context';
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
          The offline recitation service is Faith-scoped and deliberately not mounted at application
          startup: it reads a manifest, sweeps partials and repairs an index against the filesystem,
          which is work no launch that never opens the Qur'an should do. Mounting it here means one
          service for the whole module, so a download in progress survives navigation between the
          reader, the offline audio screen and the reciter catalogue.

          It starts no download. See `OfflineRecitationProvider` — the mount effect hydrates and
          migrates, and there is no call to `start`, `resume` or `prepare` anywhere in it.
        */}
        <OfflineRecitationProvider>
          <Stack screenOptions={{ headerShown: false }} />
          {/*
            The one-time question about unowned Faith data found on this device.

            Mounted over the whole Faith stack rather than placed on one screen, because it has to be
            *shown* rather than discovered: it is a privacy decision about data the app is currently
            refusing to open, and a row somewhere in settings would leave it quarantined forever for
            everybody who never went looking. It renders `null` whenever there is nothing to ask —
            which, after the first launch of an install that had no legacy data, is always.

            Inside the Faith layout because the data is Faith's. It deliberately does not appear over
            Main Home or Profile: the choice is about bookmarks, notes and prayer settings, and it
            belongs where the user can see what it is about.
          */}
          <LegacyDataPrompt />
        </OfflineRecitationProvider>
      </FaithRepositoryProvider>
    </FaithPreferencesProvider>
  );
}
