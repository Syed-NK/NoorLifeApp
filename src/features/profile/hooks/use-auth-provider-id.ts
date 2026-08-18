import { useEffect, useState } from 'react';

import * as profileService from '@services/profile/profile.service';
import type { AuthProviderId } from '@shared/models/user';

/**
 * The sign-in method for the current session, or null when it is not reliably known.
 *
 * ── Why null is a first-class result ────────────────────────────────────────
 * "Not yet resolved" and "not one of the three we can name" both arrive here as null, and Personal
 * Information renders both the same way — by omitting the row. That collapse is deliberate: the
 * screen has nothing different to say in the two cases, and the alternative is a row that appears
 * a moment after the rest of the card, moving everything beneath it.
 *
 * The read is session-local rather than a network call, so there is no loading state worth drawing
 * and no failure worth reporting.
 */
export function useAuthProviderId(): AuthProviderId | null {
  const [provider, setProvider] = useState<AuthProviderId | null>(null);

  useEffect(() => {
    let cancelled = false;

    void profileService
      .getAuthProviderId()
      .then((resolved) => {
        if (!cancelled) {
          setProvider(resolved);
        }
      })
      .catch(() => {
        // Unknown stays unknown. The screen omits the row rather than guessing a provider.
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return provider;
}
