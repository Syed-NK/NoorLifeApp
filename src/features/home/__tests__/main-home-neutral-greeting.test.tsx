import { render, screen } from '@testing-library/react-native';
import fs from 'node:fs';
import path from 'node:path';

import { AppProviders } from '@application/providers/app-providers';
import type { AuthState } from '@application/providers/auth-provider';
import { installMockLatencyTimers } from '@/test-support/mock-latency-timers';

import { MainHomeScreen } from '../screens/main-home-screen';

/**
 * What Main Home greets a nameless account by — issue #48.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── The defect, at the surface where it was visible ────────────────────────
 * `toProfile` used to fall back from name metadata to the sign-in address, so `givenName` *was* the
 * address for an account that never supplied a name. Main Home's own neutral fallback —
 * `user?.givenName ?? 'there'` — could never fire, because `givenName` was not absent. The most
 * prominent text on the app's first screen therefore read as the user's own email address, sitting
 * under "Assalamu Alaikum," where a name belongs.
 *
 * ── Why this file changes nothing in Main Home ─────────────────────────────
 * `main-home-screen.tsx` is byte-locked and its `?? 'there'` was already correct. The fix is upstream:
 * absence now reaches it. So these cases assert the *screen's* behaviour against a controlled identity
 * and prove the locked file did not need touching — which is the whole argument for fixing the
 * semantic boundary rather than the call site.
 *
 * `useAuth` is overridden and the rest of the provider module kept, so the real screen renders inside
 * the real providers exactly as `main-home-screen.test.tsx` does.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const NAMELESS_EMAIL = 'nameless@example.com';

/** Signed in, online, with whichever name fields the case supplies — and always an address. */
function signedIn(over: { fullName?: string; givenName?: string } = {}): AuthState {
  return {
    status: 'signed-in',
    authority: 'online',
    user: {
      id: 'cccccccc-3333-4333-8333-cccccccccccc',
      ...(over.fullName === undefined ? {} : { fullName: over.fullName }),
      ...(over.givenName === undefined ? {} : { givenName: over.givenName }),
      email: NAMELESS_EMAIL,
      subscriptionTier: 'free',
      greeting: 'Assalamu Alaikum,',
    },
    hasCompletedOnboarding: true,
    pendingVerificationEmail: null,
    isBackendConfigured: true,
  } as AuthState;
}

/*
  `mock`-prefixed so the factory below may reference it: Jest forbids a module factory reaching an
  out-of-scope variable unless the name says it is a mock, because an uninitialised one would be a
  silent hazard.

  Initialised here rather than only in `beforeEach`, because `installMockLatencyTimers` renders once in
  `beforeAll` to warm the first mount — and that render consumes the identity too. A null there fails
  every case in the file for a reason that has nothing to do with any of them.
*/
const mockIdentity = { current: signedIn() as AuthState };

jest.mock('@application/providers/auth-provider', () => ({
  ...jest.requireActual('@application/providers/auth-provider'),
  useAuth: () => mockIdentity.current,
}));

installMockLatencyTimers(() => renderHome());

async function renderHome() {
  return render(
    <AppProviders>
      <MainHomeScreen simulateFailure={false} />
    </AppProviders>,
  );
}

beforeEach(() => {
  mockIdentity.current = signedIn();
});

describe('a nameless account', () => {
  it('is greeted by the neutral copy, never by its address', async () => {
    mockIdentity.current = signedIn();
    await renderHome();

    /*
      Main Home's own approved neutral, reached because `givenName` is genuinely absent. Before the fix
      this read `nameless@example.com`.
    */
    expect(await screen.findByText('there')).toBeTruthy();
    expect(screen.queryByText(NAMELESS_EMAIL)).toBeNull();
  });

  it('renders no address anywhere on the screen, nor in the accessibility tree', async () => {
    mockIdentity.current = signedIn();
    const view = await renderHome();
    await screen.findByText('there');

    /*
      The rendered tree, not only the visible text. A greeting that no longer *displays* the address
      while still announcing it to a screen reader would be the same leak through a different surface,
      so every accessibility label, hint and value is searched too.
    */
    const serialised = JSON.stringify(view.toJSON());
    expect(serialised).not.toContain(NAMELESS_EMAIL);
    expect(serialised).not.toContain('nameless');
    expect(serialised).not.toContain('@example.com');
  });
});

describe('an account that gave a name', () => {
  it('is greeted by its given name', async () => {
    mockIdentity.current = signedIn({ fullName: 'Ahmed Al-Rashid', givenName: 'Ahmed' });
    await renderHome();

    /* The ordinary case, unchanged — and the reason absence had to be expressible rather than guessed. */
    expect(await screen.findByText('Ahmed')).toBeTruthy();
    expect(screen.queryByText('there')).toBeNull();
    expect(screen.queryByText(NAMELESS_EMAIL)).toBeNull();
  });
});

describe('the locked screen', () => {
  it('still consumes the greeting exactly as the branch point does', () => {
    /*
      `main-home-screen.tsx` is in `PROTECTED_PATHS`, so `protected-files.test.ts` already asserts it is
      byte-identical to the branch point — that is the guarantee, and this does not duplicate it. What
      this pins is the *reason* the lock could be honoured: the call site was already correct, and the
      fix went upstream of it. If a future change moved the neutral value into this file, the byte lock
      would fail and this would explain why it was never necessary.
    */
    const source = fs.readFileSync(
      path.join(process.cwd(), 'src/features/home/screens/main-home-screen.tsx'),
      'utf8',
    );
    expect(source).toContain("name={user?.givenName ?? 'there'}");
  });
});
