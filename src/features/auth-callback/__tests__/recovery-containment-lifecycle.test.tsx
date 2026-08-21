import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { useEffect } from 'react';
import { BackHandler } from 'react-native';

import * as authService from '@services/auth/auth.service';

import { AppProviders } from '@application/providers/app-providers';
import { installMockLatencyTimers } from '@/test-support/mock-latency-timers';
import { useAuthCallbackActions } from '@application/providers/auth-callback-provider';
import { type AccountSecurityPort } from '@services/account/account-security.contract';
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
/**
 * The provider's sign-out, watched at the service boundary.
 *
 * Spied rather than asserted through the session, because whether the session *ends* is the same
 * observable for "signed out" and "was never signed in" — and the distinction between those two is
 * exactly what the conditional below is about.
 */
let signOutSpy: jest.SpyInstance;

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
  signOutSpy = jest.spyOn(authService, 'signOut').mockResolvedValue(undefined);
});

afterEach(() => {
  // Only this spy. `jest.restoreAllMocks()` would also tear down the doubles `jest.setup.ts`
  // installs, which is what made these cases pass alone and fail in sequence.
  backSpy?.mockRestore();
  backSpy = null;
  signOutSpy.mockRestore();
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
async function renderPasswordScreen(
  options: { readonly grant?: boolean; readonly port?: AccountSecurityPort } = {},
) {
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

  it('does not sign out when there was no recovery to abandon', async () => {
    /**
     * The route is reachable by deep link. Arriving with an ordinary session and no recovery in
     * progress is not an abandonment — it is somebody who navigated somewhere they cannot use, and
     * ending their session would be a harsher answer than the situation calls for. The containment
     * rule is about a *recovery-created* session.
     *
     * No marker is written and no grant is minted, so there is nothing to abandon.
     */
    await renderPasswordScreen({ grant: false });
    await waitFor(() => expect(screen.getByTestId('set-new-password-no-grant')).toBeTruthy());

    await fireEvent.press(screen.getByTestId('set-new-password-header-back'));

    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/sign-in'));
    expect(signOutSpy).not.toHaveBeenCalled();
  });

  it('reconstructs the grant from a surviving marker, so there is nothing to abandon', async () => {
    /**
     * The cold-launch shape: the process died after the exchange, so storage still holds the marker
     * while the in-memory grant has not been reconstructed.
     *
     * **This case changed with issue #30, and the change is the point.** It used to assert that
     * backing out here signs the session out, because with a marker and no grant the screen could not
     * tell whether the recovery was resumable — and it could not, because containment was armed only
     * by the entry route. A launch that did not go through the entry gate never read the marker, so
     * "valid marker, matching session, no grant" was a state the application really produced.
     *
     * It is not producible any more. The one containment actor now runs inside `AppProviders`, on
     * every launch path, so a valid marker matching the live session is resolved to `resume` and the
     * grant is reconstructed before this screen renders. The user is therefore *in* their recovery
     * rather than stranded beside it, which is the outcome the marker existed to produce.
     *
     * The screen's grantless refusal is not lost with this scenario — it is still asserted, where it
     * is still reachable, in `new-password-recovery-gate.test.tsx`: no marker at all, an expired or
     * mismatched one (both of which the actor ends in a sign-out), and a code in the route, which is
     * an untrusted claim.
     */
    await writeRecoveryPending(SESSION_USER_ID);

    await renderPasswordScreen({ grant: false });

    /*
      Reconstructed by the actor, not by the test: nothing here minted a grant. The banner's absence
      is the evidence — the screen renders it precisely when it has no grant to act on. The submit
      control is deliberately not asserted, because it also tracks form validity and nothing has been
      typed; `new-password-recovery-gate.test.tsx` owns that pairing.
    */
    await waitFor(() => expect(screen.queryByTestId('set-new-password-no-grant')).toBeNull());

    // And the session survives: a resumable recovery is not an abandonment.
    expect(signOutSpy).not.toHaveBeenCalled();
    expect(await readRecoveryPending()).toEqual({
      status: 'valid',
      marker: expect.objectContaining({ userId: SESSION_USER_ID }),
    });
  });

  it('clears the marker when the user backs out of a reconstructed recovery', async () => {
    /*
      Same reframing as the case above. With containment armed on every launch the grant is
      reconstructed, so the no-grant "request a new link" affordance is not the exit a contained user
      is offered — the header Back is. What matters is unchanged and still asserted: leaving the
      recovery clears the marker, so a later launch is not contained by a recovery nobody intends to
      finish.
    */
    await writeRecoveryPending(SESSION_USER_ID);

    await renderPasswordScreen({ grant: false });
    await waitFor(() => expect(screen.queryByTestId('set-new-password-no-grant')).toBeNull());

    await fireEvent.press(screen.getByTestId('set-new-password-header-back'));

    await waitFor(async () => expect(await readRecoveryPending()).toEqual({ status: 'none' }));
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
