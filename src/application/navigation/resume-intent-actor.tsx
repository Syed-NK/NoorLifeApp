import { useEffect, useRef } from 'react';

import { useAuthCallbackActions } from '@application/providers/auth-callback-provider';
import { useAuth } from '@application/providers/auth-provider';

/**
 * Ends a remembered destination when the session that could have consumed it ends — issue #62.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── What it is for ─────────────────────────────────────────────────────────
 * `ProtectedRouteBoundary` records where a signed-out visitor was heading, and the authentication
 * landings take it — `login-screen.tsx` for a password sign-in, `auth-callback-screen.tsx` for the
 * link flows. Taking clears, so an ordinary refuse-then-sign-in resumes exactly once.
 *
 * The path that does *not* consume is sign-up: a new account goes to Account Ready and then the plan
 * chooser, and the resume is deliberately dropped rather than allowed to skip that. Without this
 * component the dropped value would simply sit in memory for the life of the process — so a visitor
 * refused at `/profile`, who signs up, works, signs out and hands the phone to somebody else, would
 * have *that* account resumed into the first one's destination on its first sign-in. The intent has
 * to be scoped to a session, not to a process.
 *
 * ── Why an actor rather than a line inside `signOut` ───────────────────────
 * Because `AuthProvider` must not depend on `AuthCallbackProvider`. Calling the callback actions
 * from inside `signOut` compiles and works in the composed app, and it makes the session boundary
 * unmountable on its own — ninety-seven existing tests render `AuthProvider` standalone, and every
 * one of them began throwing "useAuthCallbackActions was called outside AuthCallbackProvider". A
 * boundary that cannot be mounted alone is a worse thing to own than a small component that watches
 * from outside, and this codebase already has the pattern: `RecoveryContainmentProvider` is exactly
 * this shape for exactly this reason.
 *
 * It also catches every way a session can end, not only the explicit control: an expiry, a
 * revocation, a recovery clean-up and a sign-out on another device all arrive as the same
 * transition, and none of them routes through the `signOut` action.
 *
 * ── It decides nothing and navigates nowhere ───────────────────────────────
 * One transition, one clear. It never records, never reads the value it discards, and never routes,
 * so mounting it cannot change where anybody lands — only whether a value that is already unusable
 * is still lying around. Nothing is logged: the destination came from an untrusted link, which is
 * the whole reason `pending-destination.ts` refuses to log it either.
 * ═══════════════════════════════════════════════════════════════════════════
 */
export function ResumeIntentActor(): null {
  const { status } = useAuth();
  const { takeDestination } = useAuthCallbackActions();
  /*
    The previous status, so this fires on the *edge* and not on the level.

    Clearing whenever the session is merely signed-out would delete the record the boundary has just
    written — the boundary only ever records while signed out, so level-triggering would race its own
    input and the resume would never survive to be consumed.
  */
  const wasSignedIn = useRef(false);

  useEffect(() => {
    if (status === 'signed-in') {
      wasSignedIn.current = true;
      return;
    }
    /*
      `unknown` is not an ending. It is the launch still resolving, and treating it as a sign-out
      would clear a destination recorded by a deep-linked launch before authority had answered —
      which is the one launch shape this feature exists to serve.
    */
    if (status === 'signed-out' && wasSignedIn.current) {
      wasSignedIn.current = false;
      takeDestination();
    }
  }, [status, takeDestination]);

  return null;
}
