import { useLocalSearchParams } from 'expo-router';

import { DuaDetailScreen } from '@features/faith/screens/dua-detail-screen';

/**
 * Faith → Duas → one Dua, in full.
 *
 * The parameter is passed through as-is rather than narrowed here: `resolveDuaDetail` is the one place
 * that decides what a detail id names, and a second opinion in a route file would be a second place to
 * keep in step. See `dua-detail.ts` for why the id alone is enough to tell a reviewed entry from one of
 * the user's own selections.
 */
export default function Screen() {
  const { duaId } = useLocalSearchParams<{ duaId?: string }>();
  return <DuaDetailScreen duaId={duaId ?? ''} />;
}
