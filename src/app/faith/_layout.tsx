import { Stack } from 'expo-router';

import { FaithRepositoryProvider } from '@features/faith/di/faith-repository-context';

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
    <FaithRepositoryProvider>
      <Stack screenOptions={{ headerShown: false }} />
    </FaithRepositoryProvider>
  );
}
