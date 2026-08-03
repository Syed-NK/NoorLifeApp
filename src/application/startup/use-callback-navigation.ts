import { useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';

import { useAuthCallback } from '@application/providers/auth-callback-provider';
import { AUTH_CALLBACK_ROUTE } from '@features/auth-callback/auth-callback-routes';

/**
 * Routes a **warm-start** callback to the callback screen, once.
 *
 * ── Why warm and cold are handled in two different places ───────────────────
 * They arrive at different moments in the app's life and the right response differs.
 *
 * A **cold** link launched the process. Nothing is mounted, the startup machine has not resolved, and
 * the correct behaviour is for the entry gate to resolve to `/auth/callback` *instead of* its usual
 * destination — see `index.tsx`. Pushing from here would race the gate's own `Redirect` and could land
 * the user on Main Home first, which is exactly the "no redirect to Home before the callback is
 * processed" rule.
 *
 * A **warm** link arrives while the app is running and showing something. There is no gate to reroute;
 * something has to navigate. `MainActivity` is `launchMode="singleTask"`, so this is the only path a
 * second link can take, and it is not an edge case — a user who requests two reset emails and opens the
 * newer one takes it every time.
 *
 * So the provider tags each captured callback with its origin and this hook handles exactly one of
 * them. Neither can act on the other's, which is what stops a double navigation.
 *
 * ── Why the guard is a key and not a boolean ────────────────────────────────
 * A boolean would make this a one-shot for the life of the process, so a user who completed one
 * recovery and then opened a second link would get no navigation at all. Remembering *which* callback
 * was routed lets a genuinely new one through while a re-render of the same one is ignored.
 */
export function useCallbackNavigation(): void {
  const router = useRouter();
  const { pending } = useAuthCallback();
  const routedKey = useRef<string | null>(null);

  useEffect(() => {
    // A cold callback is the entry gate's, not this hook's. See the note above.
    if (pending === null || pending.origin === 'cold') {
      return;
    }
    if (routedKey.current === pending.key) {
      return;
    }
    routedKey.current = pending.key;
    /**
     * `push`, not `replace`.
     *
     * A warm callback interrupts a screen the user was using, and an invalid one must leave that screen
     * intact underneath — `replace` would consume it. The callback screen's own onward navigations are
     * all `replace`, so a *completed* callback still leaves no history entry behind it.
     */
    router.push(AUTH_CALLBACK_ROUTE);
  }, [pending, router]);
}
