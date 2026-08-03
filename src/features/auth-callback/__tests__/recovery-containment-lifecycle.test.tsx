import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { useEffect } from 'react';
import { BackHandler } from 'react-native';

import { AppProviders } from '@application/providers/app-providers';
import { installMockLatencyTimers } from '@/test-support/mock-latency-timers';
import { useAuthCallbackActions } from '@application/providers/auth-callback-provider';
import {
  type AccountSecurityPort,
} from '@services/account/account-security.contract';
import {
  clearRecoveryPending,
  readRecoveryPending,
  writeRecoveryPending,
} from '@services/auth/recovery-pending';

import { mockRouter } from '../../../../jest.setup';
import { SetNewPasswordScreen } from '../screens/set-new-password-screen';

/**
 * The recovery-pending marker across the whole journey, at the level the user experiences it.
 *
 * ── The condition being contained ───────────────────────────────────────────
 * A successful recovery exchange creates a real authenticated session *before* the password is set.
 * Between those two moments the account is signed in with the reset unfinished, and the only thing
 * holding the user out of the application used to be a grant in memory — which Android is free to
 * destroy at any time.
 *
 * `recovery-pending.test.ts` covers what survives storage, `recovery-containment.test.ts` covers what
 * each state means, and `recovery-marker-write.test.tsx` covers the marker being written before the
 * exchange navigates. This file covers the other end: every path that legitimately ends a recovery
 * releases it.
 */

const SESSION_USER_ID = 'test-user-id';
const STRONG = 'NoorLife2026!';

/** Registered `hardwareBackPress` handlers, captured through a spy on the real module. */
let backHandlers: (() => boolean)[] = [];
let backSpy: jest.SpyInstance | null = null;

beforeEach(async () => {
  await clearRecoveryPending();
  backHandlers = [];
  const capture = (event: string, handler: () => boolean) => {
    if (event === 'hardwareBackPress') {
      backHandlers.push(handler);
    }
    return { remove: () => undefined };
  };
  backSpy = jest
    .spyOn(BackHandler, 'addEventListener')
    .mockImplementation(capture as unknown as typeof BackHandler.addEventListener);
});

afterEach(() => {
  // Only this spy. `jest.restoreAllMocks()` would also tear down the doubles `jest.setup.ts`
  // installs, which is what made these cases pass alone and fail in sequence.
  backSpy?.mockRestore();
  backSpy = null;
});

function fakeSecurityPort(options: { readonly onUpdate?: () => void } = {}): AccountSecurityPort {
  return {
    readSummary: () =>
      Promise.resolve({
        provider: 'email' as const,
        email: 'ahmed@example.com',
        emailVerification: 'verified' as const,
        lastSignInAt: null,
        canManagePassword: true,
        pendingEmail: null,
      }),
    sendReauthenticationCode: () => Promise.resolve(),
    updatePassword: async () => {
      await Promise.resolve();
      options.onUpdate?.();
    },
    requestEmailChange: () =>
      Promise.resolve({ status: 'pending' as const, requestedEmail: 'x@example.com' }),
    signOutThisDevice: () => Promise.resolve(),
    signOutEverywhere: () => Promise.resolve({ status: 'signed-out-everywhere' as const }),
  };
}

/**
 * Renders the password screen with a grant already minted and the session resolved.
 *
 * The wait matters: the mock auth service sleeps, and until it answers `auth.user` is null — which
 * the screen correctly treats as "not ready" and refuses to submit. A test that pressed before then
 * would be asserting against a disabled form.
 */
async function renderPasswordScreen(options: { readonly grant?: boolean; readonly port?: AccountSecurityPort } = {}) {
  const view = await render(
    <AppProviders>
      {options.grant === false ? null : <GrantRecovery userId={SESSION_USER_ID} />}
      <SetNewPasswordScreen port={options.port ?? fakeSecurityPort()} />
    </AppProviders>,
  );
  await settle();
  return view;
}

/** Fills both fields with the same strong value. Never a real credential. */
async function fill(value: string) {
  await fireEvent.changeText(screen.getByTestId('set-new-password-new'), value);
  await fireEvent.changeText(screen.getByTestId('set-new-password-confirm'), value);
}

/** Mints the grant a successful exchange would have left, the way the real provider does. */
function GrantRecovery({ userId }: { readonly userId: string }) {
  const { grantRecovery } = useAuthCallbackActions();
  useEffect(() => {
    grantRecovery({ userId });
  }, [grantRecovery, userId]);
  return null;
}

async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

installMockLatencyTimers(() => renderPasswordScreen());

describe('completing the recovery releases the marker', () => {
  it('clears it when the password update succeeds', async () => {
    await writeRecoveryPending(SESSION_USER_ID);

    await renderPasswordScreen();
    await waitFor(() => expect(screen.getByTestId('set-new-password-submit')).toBeTruthy());
    await fill(STRONG);

    await fireEvent.press(screen.getByTestId('set-new-password-submit'));

    await waitFor(() => expect(screen.getByTestId('set-new-password-success')).toBeTruthy());
    // The session is now an ordinary one, so nothing should still be containing it.
    expect(await readRecoveryPending()).toEqual({ status: 'none' });
  });

  it('does not clear it before the update resolves', async () => {
    await writeRecoveryPending(SESSION_USER_ID);
    let markerDuringUpdate: string | undefined;

    await renderPasswordScreen({
      port: fakeSecurityPort({
        onUpdate: () => {
          // Sampled synchronously inside the request. A marker already gone at this point would
          // mean a failed update had left the session uncontained.
          markerDuringUpdate = 'sampled';
        },
      }),
    });
    await waitFor(() => expect(screen.getByTestId('set-new-password-submit')).toBeTruthy());
    await fill(STRONG);

    await fireEvent.press(screen.getByTestId('set-new-password-submit'));
    await waitFor(() => expect(screen.getByTestId('set-new-password-success')).toBeTruthy());

    expect(markerDuringUpdate).toBe('sampled');
  });

  it('sends a completed recovery to the entry gate, not to Sign In', async () => {
    await writeRecoveryPending(SESSION_USER_ID);

    await renderPasswordScreen();
    await waitFor(() => expect(screen.getByTestId('set-new-password-submit')).toBeTruthy());
    await fill(STRONG);
    await fireEvent.press(screen.getByTestId('set-new-password-submit'));
    await waitFor(() => expect(screen.getByTestId('set-new-password-success')).toBeTruthy());

    await fireEvent.press(screen.getByTestId('set-new-password-success-sign-in'));

    /**
     * The gate, so the startup machine names the destination this account should actually have.
     * Hard-coding Home would skip a plan choice the account may still owe; hard-coding Sign In
     * would ask a signed-in user to sign in again.
     */
    expect(mockRouter.replace).toHaveBeenCalledWith('/');
  });
});

describe('abandoning the recovery is safe', () => {
  it('clears the marker and returns to Sign In when the user backs out', async () => {
    await writeRecoveryPending(SESSION_USER_ID);

    await renderPasswordScreen();
    await waitFor(() => expect(screen.getByTestId('set-new-password-header-back')).toBeTruthy());

    await fireEvent.press(screen.getByTestId('set-new-password-header-back'));

    await waitFor(async () => expect(await readRecoveryPending()).toEqual({ status: 'none' }));
    expect(mockRouter.replace).toHaveBeenCalledWith('/sign-in');
  });

  it('treats Android hardware Back as the same abandonment', async () => {
    await writeRecoveryPending(SESSION_USER_ID);

    await renderPasswordScreen();
    await waitFor(() => expect(screen.getByTestId('set-new-password-header-back')).toBeTruthy());

    /**
     * Without this handler the system default applies. On a cold-start recovery the gate reached
     * this screen by `Redirect`, so there is no history behind it and Back would drop the user out
     * of the app with the recovery session still live.
     */
    const handled = pressHardwareBack();
    expect(handled).toBe(true);

    await waitFor(async () => expect(await readRecoveryPending()).toEqual({ status: 'none' }));
    expect(mockRouter.replace).toHaveBeenCalledWith('/sign-in');
  });

  it('clears the marker when the user asks for a new link instead', async () => {
    await writeRecoveryPending(SESSION_USER_ID);

    await renderPasswordScreen({ grant: false });
    await waitFor(() => expect(screen.getByTestId('set-new-password-no-grant')).toBeTruthy());

    await fireEvent.press(screen.getByTestId('set-new-password-no-grant-request'));

    // Restarting is also abandoning: this recovery is not going to be finished.
    await waitFor(async () => expect(await readRecoveryPending()).toEqual({ status: 'none' }));
    expect(mockRouter.replace).toHaveBeenCalledWith('/forgot-password');
  });
});

/**
 * Fires the registered `hardwareBackPress` handler.
 *
 * Nothing in the test environment delivers a real Android back press, so the registration itself is
 * what has to be exercised — the spy in `beforeEach` captures it.
 */
function pressHardwareBack(): boolean {
  expect(backHandlers.length).toBeGreaterThan(0);
  const handler = backHandlers[backHandlers.length - 1];
  return handler === undefined ? false : handler();
}
