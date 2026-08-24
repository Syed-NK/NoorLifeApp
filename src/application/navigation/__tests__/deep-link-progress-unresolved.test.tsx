import { STARTUP_PRESENTATION_CEILING_MS } from '@application/startup/startup-machine';
import { STARTUP_RESOLVING_MESSAGE } from '@features/entry-auth/components/startup-resolving-notice';

import {
  LAUNCH_USER,
  advanceLaunch,
  deferred,
  launchDeepLink,
} from '@/test-support/startup-progress-harness';

/**
 * **What a cold deep link shows while authority is unresolved** — issue #58.
 *
 * #31 gave a slow launch the identity-free notice and gave it to the entry gate, which is the only
 * file that ran a launch clock. Expo Router makes a deep-linked route the initial route, so a cold
 * link never mounted the gate: no clock, no ceiling, no notice, and — with no splash behind it — a
 * blank screen for as long as authority took. Measured at nine to eleven seconds on both Android
 * targets.
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

describe('a cold deep link while authority is unresolved', () => {
  it('shows nothing at all below the ceiling, and no protected content', async () => {
    /*
      The approved fast-launch behaviour, preserved. An ordinary launch resolves in well under a
      second, and a spinner thrown up for that long is noise rather than information — so this branch
      renders exactly what it rendered before #58 until the launch has been going long enough to be
      worth mentioning.
    */
    mockResolveSession.mockReturnValue(deferred<never>().promise);

    const view = await launchDeepLink();
    await advanceLaunch(STARTUP_PRESENTATION_CEILING_MS - 1000);

    expect(view.queryByTestId('protected-child')).toBeNull();
    expect(view.queryByTestId('startup-wait-presentation')).toBeNull();
    expect(view.queryByText(STARTUP_RESOLVING_MESSAGE)).toBeNull();
  });

  it('says what it is doing at the ceiling, still without protected content', async () => {
    mockResolveSession.mockReturnValue(deferred<never>().promise);

    const view = await launchDeepLink();
    await advanceLaunch(STARTUP_PRESENTATION_CEILING_MS);

    expect(view.getByTestId('startup-wait-presentation')).toBeTruthy();
    expect(view.getByText(STARTUP_RESOLVING_MESSAGE)).toBeTruthy();
    /*
      The assertion the whole issue rests on. A fix that produced a notice by admitting the route
      underneath it would be strictly worse than the blank it replaced.
    */
    expect(view.queryByTestId('protected-child')).toBeNull();
  });

  it('claims nothing about who is waiting', async () => {
    /*
      Identity-free, asserted on the rendered tree rather than on the component in isolation — which
      the notice's own suite already covers. At the moment this renders the app does not know whose
      launch it is, and a reassuring guess would be the same class of lie as the redirect #31 removed.
    */
    mockResolveSession.mockReturnValue(deferred<never>().promise);

    const view = await launchDeepLink();
    await advanceLaunch(STARTUP_PRESENTATION_CEILING_MS);

    const rendered = JSON.stringify(view.toJSON());
    expect(rendered).toContain(STARTUP_RESOLVING_MESSAGE);
    expect(rendered).not.toContain(LAUNCH_USER.email);
    expect(rendered).not.toContain(LAUNCH_USER.fullName);
    expect(rendered).not.toContain(LAUNCH_USER.id);
    expect(rendered.toLowerCase()).not.toContain('welcome');
    expect(rendered.toLowerCase()).not.toContain('sign in');
  });
});
