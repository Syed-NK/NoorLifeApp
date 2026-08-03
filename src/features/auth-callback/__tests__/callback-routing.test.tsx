import { act, render, screen, waitFor } from '@testing-library/react-native';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { AppProviders } from '@application/providers/app-providers';
import { useCallbackNavigation } from '@application/startup/use-callback-navigation';
import { AUTH_CALLBACK_URL } from '@services/auth/auth-callback.config';

/** The entry gate itself, so the redirect under test is the one the application ships. */
import Index from '../../../app/index';
import { mockLinking, mockRouter } from '../../../../jest.setup';
import { AUTH_CALLBACK_ROUTE_PATHS } from '../auth-callback-routes';

/**
 * Fake timers **including `Date`**, which is the one place in this project that wants them.
 *
 * `installMockLatencyTimers` deliberately leaves `Date` real, because most suites measure nothing and
 * faking the clock would make any elapsed-time assertion report the advanced value rather than the
 * truth. This suite is the exception: the entry gate will not name a destination until the branded
 * splash has had its minimum — 1800 ms on a first launch — and that minimum is computed from
 * `Date.now()`. With a real clock these tests would each sit for nearly two seconds waiting for a delay
 * that exists for a human's benefit.
 *
 * Microtasks stay real, because promise resolution runs on them and faking them deadlocks anything
 * awaiting the Supabase double.
 */
beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ['queueMicrotask', 'nextTick'] });
});

afterEach(() => {
  jest.useRealTimers();
});

/** Past `FIRST_LAUNCH_SPLASH_MS` and the startup ceiling, so the gate has certainly decided. */
const PAST_SPLASH_MINIMUM_MS = 2500;

/**
 * Cold start, warm start, and the two routes.
 *
 * ── Why the gate and the navigator are tested through the real components ────
 * The rule this phase has to guarantee — *nothing lands on Home before the callback is processed* — is a
 * property of how the entry gate and the warm navigator divide the work. Testing either in isolation
 * would prove that each does its own half and say nothing about the seam, which is where a double
 * navigation would live. So both are mounted, and `mockLinking` supplies the launch URL and the `url`
 * event exactly as the OS does.
 */

const CODE = '34e770dd-9ff9-416c-87fa-43b31d7ef225';

/** The warm navigator, mounted the way the root layout mounts it. */
function WarmNavigator() {
  useCallbackNavigation();
  return null;
}

async function renderGate(options: { readonly url?: string; readonly settle?: boolean } = {}) {
  if (options.url !== undefined) {
    mockLinking.getInitialURL.mockResolvedValue(options.url);
  }
  const view = await render(
    <AppProviders>
      <WarmNavigator />
      <Index />
    </AppProviders>,
  );
  // Two flushes: one for the cold-start read, one for the session and onboarding reads behind it.
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  if (options.settle !== false) {
    // Past the branded splash's minimum, so the gate has named a destination.
    await act(async () => {
      jest.advanceTimersByTime(PAST_SPLASH_MINIMUM_MS);
      await Promise.resolve();
    });
  }
  return view;
}

describe('the two routes exist', () => {
  it.each(AUTH_CALLBACK_ROUTE_PATHS)('%s has a file', (route) => {
    /**
     * The route contract, checked against the filesystem rather than against a constant.
     *
     * `AUTH_CALLBACK_ROUTE` is what the entry gate redirects to *and* what the Supabase Dashboard is
     * configured to allow, so a path that resolves to no file is a link that lands on Not Found — and it
     * would do so only on a device, only for a real emailed link.
     */
    const file = join(__dirname, '..', '..', '..', 'app', `${route}.tsx`);
    expect(existsSync(file)).toBe(true);
  });

  it('does not collide with the flat (auth) group', () => {
    // `(auth)` is a group and contributes no URL segment, so `/welcome` and `/auth/callback` coexist.
    // A file at `app/(auth)/callback.tsx` would resolve to `/callback` and would not be this route.
    expect(existsSync(join(__dirname, '..', '..', '..', 'app', '(auth)', 'callback.tsx'))).toBe(
      false,
    );
  });

  it('declares the callback route the service configuration points at', () => {
    expect(AUTH_CALLBACK_URL.endsWith(AUTH_CALLBACK_ROUTE_PATHS[0])).toBe(true);
  });
});

describe('cold start', () => {
  it('routes a launch callback to the callback screen instead of the startup destination', async () => {
    await renderGate({ url: `${AUTH_CALLBACK_URL}?code=${CODE}` });

    /**
     * The whole rule, in one assertion. The gate resolves to `/auth/callback` *instead of* Main Home or
     * the plan chooser, so nothing paints an authenticated screen before the link has been processed.
     * `Redirect` is stubbed in `jest.setup`, so the destination is read off the element rather than
     * followed.
     */
    await waitFor(() => expect(screen.getByTestId('router-redirect')).toBeTruthy());
    expect(screen.getByTestId('router-redirect').props.accessibilityLabel).toBe(
      '/auth/callback',
    );
  });

  it('does not push as well as redirect, so the callback is entered once', async () => {
    await renderGate({ url: `${AUTH_CALLBACK_URL}?code=${CODE}` });
    await waitFor(() => expect(screen.getByTestId('router-redirect')).toBeTruthy());

    // The warm navigator must ignore a cold callback. Both acting would enter the screen twice, and the
    // second entry would find the callback already claimed.
    expect(mockRouter.push).not.toHaveBeenCalled();
  });

  it('holds the branded splash for its minimum rather than truncating it for a link', async () => {
    await renderGate({ url: `${AUTH_CALLBACK_URL}?code=${CODE}`, settle: false });

    /**
     * Before the minimum elapses the splash is still up and nothing has been routed anywhere.
     *
     * The redirect is read *after* `destination` in the gate, so the brand keeps its one uninterrupted
     * moment and the callback waits in memory. A deep link is not a reason to shorten it, and the link
     * cannot be lost to the wait because the provider captured it on the first tick.
     */
    expect(screen.getByTestId('startup-branded-splash')).toBeTruthy();
    expect(screen.queryByTestId('router-redirect')).toBeNull();

    await act(async () => {
      jest.advanceTimersByTime(PAST_SPLASH_MINIMUM_MS);
      await Promise.resolve();
    });

    await waitFor(() =>
      expect(screen.getByTestId('router-redirect').props.accessibilityLabel).toBe(
        '/auth/callback',
      ),
    );
  });

  it('leaves ordinary startup alone when the app was not launched by a link', async () => {
    await renderGate();

    // A destination *is* chosen — that is startup working. What matters is that it is not the callback.
    await waitFor(() => expect(screen.getByTestId('router-redirect')).toBeTruthy());
    expect(screen.getByTestId('router-redirect').props.accessibilityLabel).not.toBe(
      '/auth/callback',
    );
    expect(mockRouter.push).not.toHaveBeenCalled();
  });

  it('ignores a launch URL that is not a callback', async () => {
    await renderGate({ url: 'noorlifeapp://faith/quran' });

    // Ordinary deep linking is not this boundary's business, so startup routes as it always would.
    await waitFor(() => expect(screen.getByTestId('router-redirect')).toBeTruthy());
    expect(screen.getByTestId('router-redirect').props.accessibilityLabel).not.toBe(
      '/auth/callback',
    );
    expect(mockRouter.push).not.toHaveBeenCalled();
  });
});

describe('warm start', () => {
  it('navigates to the callback screen when a link arrives while running', async () => {
    await renderGate();
    expect(mockRouter.push).not.toHaveBeenCalled();

    await act(async () => {
      mockLinking.emit(`${AUTH_CALLBACK_URL}?code=${CODE}`);
    });

    await waitFor(() => expect(mockRouter.push).toHaveBeenCalledWith('/auth/callback'));
  });

  it('navigates once for a duplicated delivery', async () => {
    await renderGate();

    await act(async () => {
      mockLinking.emit(`${AUTH_CALLBACK_URL}?code=${CODE}`);
      mockLinking.emit(`${AUTH_CALLBACK_URL}?code=${CODE}`);
      mockLinking.emit(`${AUTH_CALLBACK_URL}?code=${CODE}`);
    });

    // `launchMode="singleTask"` re-delivers an intent to the running task. One navigation, one exchange.
    await waitFor(() => expect(mockRouter.push).toHaveBeenCalledTimes(1));
  });

  it('pushes rather than replaces, so an invalid callback leaves the current screen intact', async () => {
    await renderGate();

    await act(async () => {
      mockLinking.emit(`exp+noorlifeapp://auth/callback?code=${CODE}`);
    });

    await waitFor(() => expect(mockRouter.push).toHaveBeenCalledWith('/auth/callback'));
    // `replace` would consume the screen the user was on for a link that turned out to be refused.
    expect(mockRouter.replace).not.toHaveBeenCalledWith('/auth/callback');
  });

  it('navigates again for a genuinely new link', async () => {
    await renderGate();

    await act(async () => {
      mockLinking.emit(`${AUTH_CALLBACK_URL}?code=${CODE}`);
    });
    await waitFor(() => expect(mockRouter.push).toHaveBeenCalledTimes(1));

    // A user who requests two reset emails and opens the newer one. A one-shot guard would ignore it.
    await act(async () => {
      mockLinking.emit(`${AUTH_CALLBACK_URL}?code=${CODE.replace('34e770dd', '99e770dd')}`);
    });
    await waitFor(() => expect(mockRouter.push).toHaveBeenCalledTimes(2));
  });

  it('does nothing for an unrelated URL', async () => {
    await renderGate();

    await act(async () => {
      mockLinking.emit('noorlifeapp://home');
      mockLinking.emit('https://nkdigitalworks.com/privacy');
    });

    expect(mockRouter.push).not.toHaveBeenCalled();
    expect(mockRouter.replace).not.toHaveBeenCalled();
  });
});
