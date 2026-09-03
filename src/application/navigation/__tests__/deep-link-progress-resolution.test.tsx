import { STARTUP_PRESENTATION_CEILING_MS } from '@application/startup/startup-machine';
import { readOfflineReceipt } from '@services/auth/offline-receipt';
import { STARTUP_RESOLVING_MESSAGE } from '@features/entry-auth/components/startup-resolving-notice';

import {
  LAUNCH_USER,
  advanceLaunch,
  deferred,
  launchDeepLink,
} from '@/test-support/startup-progress-harness';

/**
 * **Resolution removes the progress surface and reveals only what is permitted** — issue #58.
 *
 * The notice is presentation, not a verdict and not an admission. When authority lands the surface
 * goes and the route appears; when the answer is a real signed-out verdict the boundary redirects
 * instead, which is the distinction #31 exists to protect.
 *
 * One of three files covering a cold deep link's presentation; see `startup-progress-harness.tsx`
 * for why the matrix is split rather than kept in one place.
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

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(0);
  mockResolveSession.mockReset();
  mockGetProfile.mockReset().mockResolvedValue(null);
});

afterEach(() => {
  jest.useRealTimers();
});

describe('when authority finally lands', () => {
  it('reveals the route and removes the notice, for a live session', async () => {
    const session = deferred<{ kind: 'authenticated'; user: typeof LAUNCH_USER }>();
    mockResolveSession.mockReturnValue(session.promise);

    /*
      ── The precondition this case actually needs, stated rather than inherited — issue #166 ──
      A device holding a valid offline receipt is granted authority immediately, which is correct and
      is the whole offline-auth feature. So there is only something to *wait* for while no receipt
      exists, and this case used to depend on that being true because nothing had resolved a session
      before it. Whichever case ran first wrote a receipt and took the wait away from the rest: under
      seed 8675309 this one found `protected-child` already rendered while its own session promise
      was still pending.

      The pending session is controlled by `deferred` above; the absence of prior authority is
      controlled here. Neither is left to the order cases happen to run in.
    */
    expect(await readOfflineReceipt()).toBeNull();

    const view = await launchDeepLink();
    await advanceLaunch(STARTUP_PRESENTATION_CEILING_MS);
    expect(view.getByTestId('startup-wait-presentation')).toBeTruthy();

    session.settle({ kind: 'authenticated', user: LAUNCH_USER });
    await advanceLaunch(200);

    expect(view.getByTestId('protected-child')).toBeTruthy();
    expect(view.queryByTestId('startup-wait-presentation')).toBeNull();
    expect(view.queryByText(STARTUP_RESOLVING_MESSAGE)).toBeNull();
  });

  it('reveals the route without ever showing a notice when it resolves quickly', async () => {
    /*
      The overwhelmingly common launch, and the one that must be unchanged by this issue: authority
      lands long before the ceiling, so the surface never renders at all.
    */
    mockResolveSession.mockResolvedValue({ kind: 'authenticated', user: LAUNCH_USER });

    const view = await launchDeepLink();
    await advanceLaunch(500);

    expect(view.getByTestId('protected-child')).toBeTruthy();
    expect(view.queryByTestId('startup-wait-presentation')).toBeNull();
  });

  it('redirects rather than waiting when the answer is a real signed-out verdict', async () => {
    /*
      A verdict is not a slow launch. The notice must not stand in for one, and the boundary must
      still turn a signed-out visitor away rather than leaving them watching a spinner.
    */
    mockResolveSession.mockResolvedValue({ kind: 'no-session' });

    const view = await launchDeepLink();
    await advanceLaunch(STARTUP_PRESENTATION_CEILING_MS);

    expect(view.queryByTestId('startup-wait-presentation')).toBeNull();
    expect(view.queryByTestId('protected-child')).toBeNull();
    expect(view.queryByText(STARTUP_RESOLVING_MESSAGE)).toBeNull();
  });
});
