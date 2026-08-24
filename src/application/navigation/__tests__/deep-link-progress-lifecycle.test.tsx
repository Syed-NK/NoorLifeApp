import { STARTUP_PRESENTATION_CEILING_MS } from '@application/startup/startup-machine';

import { advanceLaunch, deferred, launchDeepLink } from '@/test-support/startup-progress-harness';

/**
 * **A cold deep link's progress surface holds no state of its own** — issue #58.
 *
 * Strict Mode and abandonment. The surface reads a clock and renders; the clock is owned by one
 * provider at the root. Neither a deliberate double mount nor a launch the user backs out of may
 * produce two notices, a duplicated actor, or an update after the tree is gone.
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

describe('the progress surface across mounts', () => {
  it('shows one notice inside a Strict Mode tree', async () => {
    mockResolveSession.mockReturnValue(deferred<never>().promise);

    const view = await launchDeepLink(true);
    await advanceLaunch(STARTUP_PRESENTATION_CEILING_MS);

    expect(view.queryAllByTestId('startup-wait-presentation')).toHaveLength(1);
    expect(view.queryByTestId('protected-child')).toBeNull();
  });

  it('leaves nothing behind when the launch is abandoned before it resolves', async () => {
    /*
      Back during an unresolved launch. The tree goes away with the answer still outstanding, which
      must produce no update and no navigation — the surface holds no state, and the clock it reads is
      cleared by its provider's own cleanup.
    */
    mockResolveSession.mockReturnValue(deferred<never>().promise);

    const view = await launchDeepLink();
    await advanceLaunch(STARTUP_PRESENTATION_CEILING_MS);
    expect(view.getByTestId('startup-wait-presentation')).toBeTruthy();

    /*
      Asserted as "nothing was reported", because that is the whole of the guarantee. A surviving
      interval would call `setState` on a tree that is gone, and React reports exactly that — so a
      silent run is the evidence. Querying the tree instead is not available: the renderer throws on
      any access once unmounted, which says nothing about the timer.
    */
    const errors: unknown[] = [];
    const spy = jest.spyOn(console, 'error').mockImplementation((...args) => {
      errors.push(args);
    });
    view.unmount();
    await advanceLaunch(STARTUP_PRESENTATION_CEILING_MS * 2);
    spy.mockRestore();

    const unmountComplaints = errors
      .map((entry) => JSON.stringify(entry))
      .filter((line) => line.includes('unmounted') || line.includes('memory leak'));
    expect(unmountComplaints).toEqual([]);
  });
});
