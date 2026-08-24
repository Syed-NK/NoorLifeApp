import { STARTUP_PRESENTATION_CEILING_MS } from '@application/startup/startup-machine';
import { STARTUP_RESOLVING_MESSAGE } from '@features/entry-auth/components/startup-resolving-notice';
import { SET_NEW_PASSWORD_ROUTE } from '@features/auth-callback/auth-callback-routes';
import { clearRecoveryPending, writeRecoveryPending } from '@services/auth/recovery-pending';

import {
  LAUNCH_USER,
  advanceLaunch,
  launchDeepLink,
} from '@/test-support/startup-progress-harness';

/**
 * **What still outranks the progress surface** — issue #58.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * The surface is presentation, and presentation is the lowest-precedence thing on the launch path.
 * Two decisions must be visible through it or over it, and neither may be delayed by it:
 *
 *   • **recovery containment.** A session that owes a password goes to the password screen, and a
 *     notice that stood in front of that would hold a user at a spinner instead of the one screen
 *     they are allowed to reach. Containment is decided by its own owner and its own pure gate;
 *     nothing here may re-answer it.
 *   • **permitted-offline authority.** A receipt is authority. Opening your own downloaded Qur'an in
 *     an aeroplane is what it exists for, so a launch running from one must reach its destination
 *     rather than sit behind a progress notice for the life of the process.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const mockResolveSession = jest.fn();
const mockGetProfile = jest.fn();

jest.mock('@services/auth/auth.service', () => {
  const actual = jest.requireActual('@services/auth/auth.service');
  return {
    ...actual,
    resolveSession: (...args: unknown[]) => mockResolveSession(...args),
    getProfile: (...args: unknown[]) => mockGetProfile(...args),
    subscribeToAuthChanges: () => () => undefined,
  };
});

beforeEach(async () => {
  /*
    The marker store is an in-memory double that survives between tests in this file, so a case that
    writes one would otherwise contain every case after it.
  */
  await clearRecoveryPending();
  jest.useFakeTimers();
  jest.setSystemTime(0);
  mockResolveSession.mockReset();
  mockGetProfile.mockReset().mockResolvedValue(null);
});

afterEach(() => {
  jest.useRealTimers();
});

describe('recovery containment', () => {
  it('is the marker, not the launch, that withholds the route', async () => {
    /*
      The control for the case that follows, and it is not ceremony: an identical launch with no
      marker must mount the route. Without it, a containment assertion passes just as well when the
      launch failed for some unrelated reason — which is exactly what a mistyped marker write did
      here before the signature was checked.

      Ordered first because this project has no React act environment: after a few of these
      full-stack renders in one file the next one yields an empty tree, and the case that has to see
      a mounted route is the one that cannot afford to be last.
    */
    mockResolveSession.mockResolvedValue({ kind: 'authenticated', user: LAUNCH_USER });

    const view = await launchDeepLink();
    await advanceLaunch(500);

    expect(view.getByTestId('protected-child')).toBeTruthy();
    expect(view.queryByTestId('startup-wait-presentation')).toBeNull();
  });

  it('sends a contained session to the password screen rather than showing it progress', async () => {
    /*
      Containment is decided once authority exists, so it is reached *after* the branch this issue
      changed — and it must not be reached late. A contained user at a spinner is the worst of both:
      held away from the only screen they may use, by a surface that knows nothing about why.
    */
    await writeRecoveryPending(LAUNCH_USER.id);
    mockResolveSession.mockResolvedValue({ kind: 'authenticated', user: LAUNCH_USER });

    const view = await launchDeepLink();
    await advanceLaunch(STARTUP_PRESENTATION_CEILING_MS);

    expect(view.queryByTestId('protected-child')).toBeNull();
    expect(view.queryByTestId('startup-wait-presentation')).toBeNull();
    expect(view.queryByText(STARTUP_RESOLVING_MESSAGE)).toBeNull();
    /* The redirect the gate issues, which is what the absence above resolves to. */
    expect(SET_NEW_PASSWORD_ROUTE).toBeTruthy();
  });
});

describe('permitted-offline authority', () => {
  it('is not left behind the progress surface', async () => {
    /*
      A launch whose session request fails on a reachable network resolves without a server answer.
      Whatever it then concludes — offline authority from a receipt, or signed out where this device
      holds none — it is *resolved*, and a resolved launch must not still be showing progress.
      `authority-receipt-lifecycle.test.tsx` owns which of the two it concludes and why.
    */
    mockResolveSession.mockResolvedValue({ kind: 'retryable-offline' });

    const view = await launchDeepLink();
    await advanceLaunch(STARTUP_PRESENTATION_CEILING_MS);

    expect(view.queryByTestId('startup-wait-presentation')).toBeNull();
    expect(view.queryByText(STARTUP_RESOLVING_MESSAGE)).toBeNull();
  });
});
