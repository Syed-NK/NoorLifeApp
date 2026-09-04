import { usePathname } from 'expo-router';
import { useEffect } from 'react';

import { useAuthCallbackActions } from '@application/providers/auth-callback-provider';

/**
 * Records the protected route a signed-out visitor was refused, so sign-in can return them — #62.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── Why this is its own component and not three lines in the gate ──────────
 * `ProtectedRouteBoundary` is mounted at nineteen points and is deliberately, and *assertedly*,
 * free of state, refs, listeners and effects — `recovery-containment-boundary.test.ts` fails the
 * build if any appear in it. That guard is not ceremony: a pure consumer can be mounted anywhere
 * without duplicating a read or a navigation-driving transition, and the moment the gate owns an
 * effect it owns nineteen of them.
 *
 * Putting the write here keeps that true. The gate still only decides; this is rendered **only on
 * the branch that has already decided to refuse**, so it mounts once, for the one route that was
 * actually asked for, and never on an allowed render at all.
 *
 * ── Recording is not granting ──────────────────────────────────────────────
 * `rememberDestination` re-checks the path against `RESUMABLE_ROUTE_PREFIXES` and refuses anything
 * else, so a route that is protected but not resumable — a premium module root — is turned away
 * here and the user lands on the ordinary destination instead. The consumers replay it only after
 * authority is published, so nothing stored here reaches a protected screen any earlier than it
 * otherwise would. A refusal is silent: the value originates in an attacker-writable link, which is
 * why `pending-destination.ts` will not log it either.
 *
 * ── Overwriting rather than accumulating ───────────────────────────────────
 * A later refusal replaces an earlier one, so the newest route the user reached for is the one they
 * are returned to. There is no cleanup on unmount: the record has to outlive the unmount the
 * redirect causes, which is the entire point of it.
 *
 * Only the path is kept. A query string would have to be rebuilt from parsed parameters and
 * re-encoded, and percent-encoding is precisely the shape `sanitizeDestination` refuses; dynamic
 * segments are part of the path and survive untouched. No resumable route depends on a query
 * parameter for correctness — `/subscription/single` defaults its billing period — so the cost is a
 * default where there was a preference, never a wrong screen.
 * ═══════════════════════════════════════════════════════════════════════════
 */
export function RememberIntendedRoute(): null {
  const pathname = usePathname();
  const { rememberDestination } = useAuthCallbackActions();

  useEffect(() => {
    rememberDestination(pathname);
  }, [pathname, rememberDestination]);

  return null;
}
