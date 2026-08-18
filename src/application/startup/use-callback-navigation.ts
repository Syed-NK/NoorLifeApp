/**
 * Warm-start callback navigation — deliberately nothing.
 *
 * ── The defect this file used to be ─────────────────────────────────────────
 * It called `router.push(AUTH_CALLBACK_ROUTE)` whenever a warm callback was captured. That produced
 * **two** `/auth/callback` screens for every warm link, because Expo Router had already navigated to
 * the same route on its own: `app.json` declares `"scheme": "noorlifeapp"` and `src/app/auth/callback.tsx`
 * is a real route, so Expo Router's linking maps `noorlifeapp://auth/callback` straight onto it.
 *
 * The consequence was not two identical screens. `AuthCallbackProvider.claim()` is ref-backed and
 * single-shot, so exactly one instance received the callback and ran the exchange; the other received
 * `null`, took the "nothing to claim" branch in `auth-callback-screen.tsx`, and rendered
 * `invalid-link` — "Link not valid". The loser rendered on top, so a password recovery that had in
 * fact succeeded underneath was reported to the user as a broken link.
 *
 * Measured on a Pixel 8 emulator against the real project with a release build: the same
 * `?code=<uuid>` reported "Link already used" (the exchange was reached) when delivered cold, and
 * "Link not valid" when delivered warm — and pressing Back on the warm failure revealed the second
 * callback screen underneath, still showing the real outcome.
 *
 * ── Why the fix is removal rather than a guard ──────────────────────────────
 * A "only push if we are not already there" check reads as safer and is not: Expo Router's own
 * navigation and this effect are scheduled independently, so the pathname this hook could observe is
 * whatever won a race. There is no ordering to test against. Expo Router is the one owner of
 * navigation to `/auth/callback` for **both** cold and warm delivery, and the provider's job is
 * narrowed to capturing and deduplicating the URL — which it still does.
 *
 * The cold path is unchanged and was never affected: the entry gate resolves *to* the callback route
 * instead of its usual destination (`index.tsx`), which replaces rather than stacks, so a cold link
 * has only ever mounted one screen.
 *
 * ── Why the hook still exists ───────────────────────────────────────────────
 * As a named place for this reasoning, and so `_layout.tsx` keeps one obvious anchor for anyone who
 * goes looking for where a warm callback is routed. It is called for its documentation, not its
 * behaviour; `callback-routing.test.tsx` asserts that it performs no navigation.
 */
export function useCallbackNavigation(): void {
  // Intentionally empty. See the note above: Expo Router owns navigation to `/auth/callback`.
}
