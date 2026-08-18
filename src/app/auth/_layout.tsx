import { Stack } from 'expo-router';

/**
 * The authentication-callback navigator.
 *
 * ── Why swipe-back is off here, unlike `(auth)` ──────────────────────────────
 * Both screens under this navigator are one-way. The callback screen consumes a single-use link and
 * then hands over; the recovery screen consumes a single-use grant. A swipe back into either would
 * return to a state that no longer exists — a claimed callback or a spent grant — and the screen would
 * have to draw an "already used" message over a gesture the user meant as "undo".
 *
 * The screens still offer explicit destinations (Back to Sign In, Request a New Link), so nothing is a
 * dead end. Every forward navigation out of them is a `replace` for the same reason.
 */
export default function Layout() {
  return <Stack screenOptions={{ headerShown: false, gestureEnabled: false }} />;
}
