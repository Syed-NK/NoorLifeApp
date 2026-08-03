import { AuthCallbackScreen } from '@features/auth-callback/screens/auth-callback-screen';

/**
 * `/auth/callback` (Phase 6C-3C).
 *
 * The URL Supabase is configured to redirect an emailed confirmation, recovery or email-change link
 * to. The path is declared once in `@services/auth/auth-callback.config` and must match the Supabase
 * Dashboard allow-list entry exactly.
 */
export default function Screen() {
  return <AuthCallbackScreen />;
}
