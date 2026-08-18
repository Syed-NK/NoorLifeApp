import { act, render, waitFor } from '@testing-library/react-native';

import { AppProviders } from '@application/providers/app-providers';
import { AUTH_CALLBACK_URL } from '@services/auth/auth-callback.config';
import type { AuthCallbackOutcome, AuthCallbackPort } from '@services/auth/auth-callback.contract';
import { clearRecoveryPending, readRecoveryPending } from '@services/auth/recovery-pending';

import { mockLinking, mockRouter } from '../../../../jest.setup';
import { AuthCallbackScreen } from '../screens/auth-callback-screen';

/**
 * The containment marker is written before anything navigates.
 *
 * ── Why this is a file of its own ───────────────────────────────────────────
 * The exchange side and the release side of the recovery journey are separate subjects, and keeping
 * them apart is also what keeps them honest: the callback screen performs asynchronous work that can
 * outlive the test that started it, and sharing a module registry with the password-screen cases
 * made those fail in sequence while passing alone. Jest gives each file its own registry, so the
 * boundary is real rather than a convention.
 */

const SESSION_USER_ID = 'test-user-id';
/** A shaped code and request id. Neither was ever issued by GoTrue; the port is injected. */
const CODE = '34e770dd-9ff9-416c-87fa-43b31d7ef225';
const RID = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';

beforeEach(async () => {
  await clearRecoveryPending();
});

/** Puts a cold-start launch URL in place, which is how a real recovery link arrives. */
function deliverLink() {
  mockLinking.getInitialURL.mockResolvedValue(`${AUTH_CALLBACK_URL}?code=${CODE}&nl_rid=${RID}`);
}

/** A callback port that reports whatever outcome a case needs, with no network anywhere. */
function fakeCallbackPort(outcome: AuthCallbackOutcome): AuthCallbackPort {
  return { process: jest.fn(async () => outcome) };
}

async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('the exchange writes the marker before it navigates', () => {
  it('has the marker on disk by the time Set New Password is opened', async () => {
    deliverLink();
    const port = fakeCallbackPort({ status: 'recovery-ready', userId: SESSION_USER_ID });

    await render(
      <AppProviders>
        <AuthCallbackScreen port={port} />
      </AppProviders>,
    );
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/auth/set-new-password'));

    /**
     * The ordering claim, asserted at the only moment it is observable.
     *
     * If the marker were written after the navigation — or not awaited — process death in that gap
     * would leave a signed-in session with nothing containing it, which is the whole defect. By the
     * time the router has been asked to move, storage already knows.
     */
    const read = await readRecoveryPending();
    expect(read.status).toBe('valid');
    expect(read.status === 'valid' && read.marker.userId).toBe(SESSION_USER_ID);
  });

  it('writes exactly one marker for a duplicated callback', async () => {
    deliverLink();
    const port = fakeCallbackPort({ status: 'recovery-ready', userId: SESSION_USER_ID });

    const view = await render(
      <AppProviders>
        <AuthCallbackScreen port={port} />
      </AppProviders>,
    );
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/auth/set-new-password'));
    view.rerender(
      <AppProviders>
        <AuthCallbackScreen port={port} />
      </AppProviders>,
    );
    await settle();

    // One navigation, and one marker describing one account. A second write would be harmless here
    // but would mean the single-shot guard had not held.
    expect(mockRouter.replace).toHaveBeenCalledTimes(1);
    const read = await readRecoveryPending();
    expect(read.status === 'valid' && read.marker.userId).toBe(SESSION_USER_ID);
  });

  it('writes no marker for a signup confirmation', async () => {
    deliverLink();
    const port = fakeCallbackPort({
      status: 'signed-in',
      flow: 'signup',
      email: 'ahmed@example.com',
      pendingEmail: null,
    });

    await render(
      <AppProviders>
        <AuthCallbackScreen port={port} />
      </AppProviders>,
    );
    await settle();

    // Signup confirmation produces an ordinary session and must be left completely alone.
    expect(await readRecoveryPending()).toEqual({ status: 'none' });
  });

  it('writes no marker for a failed callback', async () => {
    deliverLink();
    const port = fakeCallbackPort({ status: 'failed', code: 'link-already-used' });

    await render(
      <AppProviders>
        <AuthCallbackScreen port={port} />
      </AppProviders>,
    );
    await settle();

    expect(await readRecoveryPending()).toEqual({ status: 'none' });
    expect(mockRouter.replace).not.toHaveBeenCalledWith('/auth/set-new-password');
  });
});
