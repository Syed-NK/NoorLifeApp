import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { StrictMode, useEffect } from 'react';
import { Text } from 'react-native';

import { RESUMABLE_ROUTE_PREFIXES } from '@application/navigation/pending-destination';
import { ProtectedRouteBoundary } from '@application/navigation/protected-route-boundary';
import { AppProviders } from '@application/providers/app-providers';
import { useAuthCallback } from '@application/providers/auth-callback-provider';
import { useAuth, useAuthActions } from '@application/providers/auth-provider';
import { LoginScreen } from '@features/entry-auth/screens/login-screen';
import * as authService from '@services/auth/auth.service';

import { mockRouter, setPathname } from '../../../../jest.setup';

/**
 * **Authentication returns the visitor to the route they were refused** — issue #62.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── The three claims, tested apart because they fail apart ─────────────────
 *   • the boundary **records** the refused route, and records it only when it actually refuses;
 *   • only an allow-listed *internal* route is ever recorded — the open-redirect question;
 *   • the sign-in landing **replays it once**, and a session ending throws it away.
 *
 * `pending-destination.test.ts` already exhausts the sanitiser against schemes, hosts,
 * protocol-relative paths and encoded traversal, and that is not repeated. What is asserted here is
 * that the boundary *routes its value through* the sanitiser — the property that would silently
 * disappear if somebody stored `usePathname()` directly, and which no sanitiser test can see.
 *
 * ── How a signed-out visitor is produced ───────────────────────────────────
 * The Supabase double always returns a session, so `AppProviders` resolves signed-in by default —
 * which is the right default for almost every other suite and exactly wrong for this one. The
 * session lookup is stubbed per test instead of the whole provider being replaced, so the real
 * boundary, the real actor and the real provider composition are all still under test.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const DEMO_EMAIL = 'ahmed@example.com';
const DEMO_PASSWORD = 'NoorLife2026';

/**
 * Resolves the launch to "nobody is signed in", which is what makes the boundary refuse.
 *
 * `resolveSession` rather than `getSession`: the launch verdict comes from the former, and stubbing
 * the latter changes nothing about which branch the boundary takes.
 */
function signedOut(): void {
  jest.spyOn(authService, 'resolveSession').mockResolvedValue({ kind: 'no-session' });
}

/** Leaves the launch verdict outstanding forever, so the boundary stays on its `wait` branch. */
function neverResolves(): void {
  jest.spyOn(authService, 'resolveSession').mockReturnValue(new Promise(() => undefined));
}

function Protected() {
  return <Text testID="protected-child">protected</Text>;
}

/** Reports the remembered destination without consuming it. */
function ShowPending() {
  const { pendingDestination } = useAuthCallback();
  return <Text testID="pending">{pendingDestination ?? 'none'}</Text>;
}

function ShowStatus() {
  const { status } = useAuth();
  return <Text testID="status">{status}</Text>;
}

/**
 * Establishes a session without the sign-in *screen* consuming the record.
 *
 * The sign-up path does exactly this: a session begins, and the resume is deliberately left for the
 * plan chooser to outrank rather than being taken. It is the state in which an unconsumed
 * destination can survive into a later session, which is the thing the actor exists to prevent.
 */
function SignInOnce() {
  const { signIn } = useAuthActions();
  useEffect(() => {
    void signIn(DEMO_EMAIL, DEMO_PASSWORD).catch(() => undefined);
  }, [signIn]);
  return null;
}

/** Signs out once when told to, the way an account switch begins. */
function SignOutWhen({ when }: { readonly when: boolean }) {
  const { signOut } = useAuthActions();
  useEffect(() => {
    if (when) {
      void signOut().catch(() => undefined);
    }
  }, [when, signOut]);
  return null;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe('the boundary records what it refused', () => {
  it('remembers an allow-listed protected route when it turns a visitor away', async () => {
    signedOut();
    setPathname('/profile/privacy-security');

    await render(
      <AppProviders>
        <ShowPending />
        <ProtectedRouteBoundary>
          <Protected />
        </ProtectedRouteBoundary>
      </AppProviders>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('pending').props.children).toBe('/profile/privacy-security');
    });
    /* Refused as before — recording changed the memory, not the verdict. */
    expect(screen.queryByTestId('protected-child')).toBeNull();
  });

  it('records nothing while authority is still unresolved', async () => {
    /*
      The `wait` branch must not record. A session that has not answered may yet turn out to be
      valid, and recording there would capture a route that was never refused — so a visitor who was
      signed in all along would be "resumed" to a screen they had already reached.
    */
    neverResolves();
    setPathname('/profile');

    await render(
      <AppProviders>
        <ShowPending />
        <ProtectedRouteBoundary>
          <Protected />
        </ProtectedRouteBoundary>
      </AppProviders>,
    );

    await waitFor(() => expect(screen.getByTestId('pending')).toBeTruthy());
    expect(screen.getByTestId('pending').props.children).toBe('none');
    expect(screen.queryByTestId('protected-child')).toBeNull();
  });

  it('records nothing when the visitor is admitted', async () => {
    /* The default signed-in launch: nothing was refused, so there is nothing to return to. */
    setPathname('/profile');

    await render(
      <AppProviders>
        <ShowPending />
        <ProtectedRouteBoundary>
          <Protected />
        </ProtectedRouteBoundary>
      </AppProviders>,
    );

    await waitFor(() => expect(screen.getByTestId('protected-child')).toBeTruthy());
    expect(screen.getByTestId('pending').props.children).toBe('none');
  });

  it('refuses a protected route that is not on the resume allow-list', async () => {
    /*
      `/finance` is protected but deliberately absent from `RESUMABLE_ROUTE_PREFIXES`: resuming into
      a premium module would land a free account on a locked screen straight after signing in. The
      boundary still redirects; it simply remembers nothing, and the user gets the ordinary landing.
    */
    expect(RESUMABLE_ROUTE_PREFIXES).not.toContain('/finance');
    signedOut();
    setPathname('/finance/receipts');

    await render(
      <AppProviders>
        <ShowPending />
        <ProtectedRouteBoundary>
          <Protected />
        </ProtectedRouteBoundary>
      </AppProviders>,
    );

    await waitFor(() => expect(screen.getByTestId('pending')).toBeTruthy());
    expect(screen.getByTestId('pending').props.children).toBe('none');
  });

  it.each([
    ['a scheme', 'https://elsewhere.example/home'],
    ['an app scheme', 'noorlifeapp://profile'],
    ['a protocol-relative host', '//elsewhere.example/home'],
    ['encoded traversal', '/profile/%2e%2e/%2e%2e/etc'],
    ['plain traversal', '/profile/../../secrets'],
    ['a recovery route', '/auth/set-new-password'],
    ['a public route', '/welcome'],
    ['a look-alike prefix', '/profiles-public'],
  ])('never records %s', async (_label, path) => {
    /*
      The open-redirect question, asked at the boundary rather than only at the sanitiser. A value
      stored directly instead of through `sanitizeDestination` would pass every sanitiser test and
      fail every one of these.
    */
    signedOut();
    setPathname(path);

    await render(
      <AppProviders>
        <ShowPending />
        <ProtectedRouteBoundary>
          <Protected />
        </ProtectedRouteBoundary>
      </AppProviders>,
    );

    await waitFor(() => expect(screen.getByTestId('pending')).toBeTruthy());
    expect(screen.getByTestId('pending').props.children).toBe('none');
  });

  it('keeps the newest refusal when the visitor reaches for a second route', async () => {
    signedOut();
    setPathname('/profile');

    const view = await render(
      <AppProviders>
        <ShowPending />
        <ProtectedRouteBoundary>
          <Protected />
        </ProtectedRouteBoundary>
      </AppProviders>,
    );

    await waitFor(() => expect(screen.getByTestId('pending').props.children).toBe('/profile'));

    /* A newer explicit navigation wins: the user is returned to the last thing they asked for. */
    setPathname('/settings/notifications');
    await view.rerender(
      <AppProviders>
        <ShowPending />
        <ProtectedRouteBoundary>
          <Protected />
        </ProtectedRouteBoundary>
      </AppProviders>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('pending').props.children).toBe('/settings/notifications');
    });
  });

  it('records once under Strict Mode’s deliberate double render', async () => {
    signedOut();
    setPathname('/insights');

    await render(
      <StrictMode>
        <AppProviders>
          <ShowPending />
          <ProtectedRouteBoundary>
            <Protected />
          </ProtectedRouteBoundary>
        </AppProviders>
      </StrictMode>,
    );

    /* Recording is idempotent by construction — the same path written twice is the same path. */
    await waitFor(() => expect(screen.getByTestId('pending').props.children).toBe('/insights'));
  });
});

describe('signing in returns the visitor to it, exactly once', () => {
  it('replaces to the refused route rather than to Main Home', async () => {
    signedOut();
    setPathname('/profile/privacy-security');

    await render(
      <AppProviders>
        <ProtectedRouteBoundary>
          <Protected />
        </ProtectedRouteBoundary>
        <LoginScreen />
      </AppProviders>,
    );

    await waitFor(() => expect(screen.getByTestId('login-screen')).toBeTruthy());

    /*
      Each `fireEvent` is awaited. In RNTL 14 they are asynchronous, and an un-awaited pair tears the
      renderer down for the rest of the file rather than failing this case.
    */
    await fireEvent.changeText(screen.getByTestId('login-email'), DEMO_EMAIL);
    await fireEvent.changeText(screen.getByTestId('login-password'), DEMO_PASSWORD);
    await fireEvent.press(screen.getByTestId('login-submit'));

    await waitFor(() => {
      expect(mockRouter.replace).toHaveBeenCalledWith('/profile/privacy-security');
    });
    /* The route it used to go to, and must no longer, when an intent exists. */
    expect(mockRouter.replace).not.toHaveBeenCalledWith('/home');
  });

  it('falls back to Main Home when nothing was refused', async () => {
    /*
      The feature is inert unless a boundary recorded something: somebody who simply opened Sign In
      lands exactly where they did before. This is the mutation guard for the fallback — a resume
      that defaulted to the stored value would send this case somewhere else.
    */
    signedOut();

    await render(
      <AppProviders>
        <LoginScreen />
      </AppProviders>,
    );

    await waitFor(() => expect(screen.getByTestId('login-screen')).toBeTruthy());

    await fireEvent.changeText(screen.getByTestId('login-email'), DEMO_EMAIL);
    await fireEvent.changeText(screen.getByTestId('login-password'), DEMO_PASSWORD);
    await fireEvent.press(screen.getByTestId('login-submit'));

    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/home'));
  });

  it('does not replay the same destination to a second sign-in', async () => {
    signedOut();
    setPathname('/faith/quran');

    await render(
      <AppProviders>
        <ProtectedRouteBoundary>
          <Protected />
        </ProtectedRouteBoundary>
        <LoginScreen />
      </AppProviders>,
    );

    await waitFor(() => expect(screen.getByTestId('login-screen')).toBeTruthy());
    await fireEvent.changeText(screen.getByTestId('login-email'), DEMO_EMAIL);
    await fireEvent.changeText(screen.getByTestId('login-password'), DEMO_PASSWORD);
    await fireEvent.press(screen.getByTestId('login-submit'));

    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/faith/quran'));

    /*
      Taking clears. A second submit in the same process — the boundary long gone — must land on the
      ordinary destination, so a resume can never repeat itself.
    */
    mockRouter.replace.mockClear();
    await fireEvent.press(screen.getByTestId('login-submit'));

    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/home'));
    expect(mockRouter.replace).not.toHaveBeenCalledWith('/faith/quran');
  });

  it('honours nothing before authority is published', async () => {
    /*
      No early honour. While the session is unresolved the boundary is on its `wait` branch, so
      nothing is recorded and nothing is replayed — the protected child never mounts and the router
      is never asked to go anywhere.
    */
    neverResolves();
    setPathname('/profile');

    await render(
      <AppProviders>
        <ProtectedRouteBoundary>
          <Protected />
        </ProtectedRouteBoundary>
      </AppProviders>,
    );

    await waitFor(() => expect(mockRouter.replace).not.toHaveBeenCalled());
    expect(screen.queryByTestId('protected-child')).toBeNull();
  });
});

describe('a destination does not outlive the session that could have used it', () => {
  it('is dropped when the account signs out', async () => {
    /*
      Recorded while signed out, then *not* consumed — the sign-up path does exactly this, since a
      new account goes to the plan chooser instead. Without the actor the value would sit in memory
      for the life of the process and be handed to whoever signed in next.
    */
    signedOut();
    setPathname('/profile');

    const view = await render(
      <AppProviders>
        <ShowStatus />
        <ShowPending />
        <ProtectedRouteBoundary>
          <Protected />
        </ProtectedRouteBoundary>
      </AppProviders>,
    );

    await waitFor(() => expect(screen.getByTestId('pending').props.children).toBe('/profile'));

    /*
      A session then begins, without the sign-in screen taking the record.

      The boundary is unmounted at the same time, because a sign-out while a protected route is
      still mounted is simply refused and recorded again — correct behaviour, and it would hide the
      clear this case is about.
    */
    await view.rerender(
      <AppProviders>
        <ShowStatus />
        <ShowPending />
        <SignInOnce />
      </AppProviders>,
    );
    await waitFor(() => expect(screen.getByTestId('status').props.children).toBe('signed-in'));
    /* Still remembered: a session beginning is not a session consuming it. */
    expect(screen.getByTestId('pending').props.children).toBe('/profile');

    await view.rerender(
      <AppProviders>
        <ShowStatus />
        <ShowPending />
        <SignOutWhen when />
      </AppProviders>,
    );

    await waitFor(() => expect(screen.getByTestId('status').props.children).toBe('signed-out'));
    await waitFor(() => expect(screen.getByTestId('pending').props.children).toBe('none'));
  });
});
