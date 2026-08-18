import { useEffect } from 'react';

import { isOnlineAuthenticated, useAuth } from '@application/providers/auth-provider';

import { warmSurahCatalogue } from '../data/quran-catalogue-warmup';
import { useFaithRepositories } from './faith-repository-context';

/**
 * Loads the surah catalogue at application startup, so the Qur'an tab never has to.
 *
 * ── Why this is mounted at the top of the app and not inside the Faith module ─
 * Because "hydrate once at startup rather than when the Qur'an button is pressed" is a statement
 * about *when*, and the Faith module's own layout does not mount until somebody navigates into
 * Faith. Mounting it there would move the read from "when Quran is pressed" to "when Faith is
 * opened", which is one screen earlier and still on the user's path.
 *
 * Here it runs while the user is on Main Home, or reading a notification, or doing nothing at all —
 * so by the time they reach the catalogue it is already a synchronous read. See
 * `quran-catalogue-warmup.ts` for why an asynchronous three-millisecond read still costs a visible
 * frame, which is the thing being removed.
 *
 * ── It renders nothing, and it is deliberately not a provider ───────────────
 * The value it produces is a module-level snapshot, not context, because it has to be readable by a
 * `useState` initialiser on a component's first render — which is before any provider above that
 * component has run an effect. A provider here would reintroduce exactly the ordering it exists to
 * avoid.
 *
 * ── Gated on a session, and that is a cost decision, not a correctness one ──
 * The approved adapter needs an authenticated Supabase invocation, so warming before sign-in would
 * spend a function call that can only answer `unauthorized` — one wasted invocation on every cold
 * launch of every signed-out install, against a vendor rate limit NoorLife shares across all users.
 * Waiting costs nothing: `useSurahCatalogue` warms on its own if the snapshot is still empty, so a
 * user who signs in and goes straight to the Qur'an gets the ordinary first-install path rather than
 * a broken one.
 */
export function QuranCatalogueWarmup() {
  const { quran } = useFaithRepositories();
  const auth = useAuth();

  useEffect(() => {
    /*
      Online only. The warmup is a network read of the surah catalogue; under offline authority it
      could only fail, and the catalogue it would have fetched is already on the device from the last
      online launch — `faith-quran-catalogue.ts` persists it for exactly this reason.
    */
    if (!isOnlineAuthenticated(auth)) {
      return;
    }
    // Deduplicated inside: startup, the Qur'an screen and the reader's picker all call this, and
    // between them they produce exactly one storage read and at most one request.
    void warmSurahCatalogue(quran);
  }, [quran, auth]);

  return null;
}
