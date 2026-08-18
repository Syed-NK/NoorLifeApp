import { SetNewPasswordScreen } from '@features/auth-callback/screens/set-new-password-screen';

/**
 * `/auth/set-new-password` (Phase 6C-3C).
 *
 * Reachable only with a live recovery grant, which only a successful recovery exchange mints. Opened
 * without one it shows an expired-link state and offers a fresh request — it never falls back to
 * changing the ambient session's password.
 */
export default function Screen() {
  return <SetNewPasswordScreen />;
}
