import { act, render, screen, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { AppProviders } from '@application/providers/app-providers';
import { useAuthCallback } from '@application/providers/auth-callback-provider';
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
/*
  ── The journey read is scripted, because this suite is not about the journey ──
  This file drives the whole gate through `AppProviders`, so without this the *real*
  `readAccountJourney` runs against the global Supabase double and answers `unconfigured` — the
  migration is not applied in the test environment.

  For as long as `unconfigured` routed to the plan chooser, that resolved the launch by accident and
  this suite passed on it. It no longer routes anywhere: a deployment that cannot record a plan choice
  has not given an answer, so the launch holds the splash. The subject here is where a callback URL
  sends the app, which needs the *other* startup inputs answered rather than incidental.
*/
jest.mock('@services/account/account-journey', () => ({
  readAccountJourney: async () => ({ status: 'completed', planCode: 'free' }),
  completeAccountJourney: async () => ({ ok: true }),
  CURRENT_ACCOUNT_JOURNEY_VERSION: 1,
}));

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
/**
 * A well-formed `nl_rid`.
 *
 * Every link this application asks for carries one — see `pending-auth-flow.ts` — so a URL used to
 * stand in for a real callback has to carry one too, or the parser refuses it before any of the
 * behaviour these suites are about can happen.
 */
const RID = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';

/** The warm navigator, mounted the way the root layout mounts it. */
function WarmNavigator() {
  useCallbackNavigation();
  return null;
}

/**
 * A probe that renders what the provider is holding.
 *
 * Needed because the warm path no longer navigates, so `mockRouter` can no longer be used to observe
 * that a link was received. Capture is still a real obligation — the screen Expo Router mounts has to
 * find something to claim — so it is asserted directly rather than inferred from a side effect.
 */
function PendingProbe() {
  const { pending } = useAuthCallback();
  return (
    <>
      <Text testID="pending-callback-key">{pending === null ? 'none' : pending.key}</Text>
      <Text testID="pending-callback-origin">{pending === null ? 'none' : pending.origin}</Text>
    </>
  );
}

async function renderGate(options: { readonly url?: string; readonly settle?: boolean } = {}) {
  if (options.url !== undefined) {
    mockLinking.getInitialURL.mockResolvedValue(options.url);
  }
  const view = await render(
    <AppProviders>
      <WarmNavigator />
      <PendingProbe />
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
    await renderGate({ url: `${AUTH_CALLBACK_URL}?code=${CODE}&nl_rid=${RID}` });

    /**
     * The whole rule, in one assertion. The gate resolves to `/auth/callback` *instead of* Main Home or
     * the plan chooser, so nothing paints an authenticated screen before the link has been processed.
     * `Redirect` is stubbed in `jest.setup`, so the destination is read off the element rather than
     * followed.
     */
    await waitFor(() => expect(screen.getByTestId('router-redirect')).toBeTruthy());
    expect(screen.getByTestId('router-redirect').props.accessibilityLabel).toBe('/auth/callback');
  });

  it('does not push as well as redirect, so the callback is entered once', async () => {
    await renderGate({ url: `${AUTH_CALLBACK_URL}?code=${CODE}&nl_rid=${RID}` });
    await waitFor(() => expect(screen.getByTestId('router-redirect')).toBeTruthy());

    // The warm navigator must ignore a cold callback. Both acting would enter the screen twice, and the
    // second entry would find the callback already claimed.
    expect(mockRouter.push).not.toHaveBeenCalled();
  });

  it('holds the branded splash for its minimum rather than truncating it for a link', async () => {
    await renderGate({ url: `${AUTH_CALLBACK_URL}?code=${CODE}&nl_rid=${RID}`, settle: false });

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
      expect(screen.getByTestId('router-redirect').props.accessibilityLabel).toBe('/auth/callback'),
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
  /**
   * ── The defect these cases replaced ─────────────────────────────────────────
   * This block used to assert that a warm callback produced `router.push('/auth/callback')`. That
   * behaviour was the bug: Expo Router already navigates there on its own, because `app.json`
   * declares `"scheme": "noorlifeapp"` and `src/app/auth/callback.tsx` is a real route. The extra push
   * mounted a *second* callback screen, `claim()` is single-shot so only one of them received the
   * callback, and the other rendered `invalid-link` — "Link not valid" — on top of a recovery that had
   * actually succeeded underneath.
   *
   * So the assertions are inverted on purpose: the contract is now that this layer captures and
   * deduplicates, and navigates nothing.
   */
  it('captures a warm link without navigating, leaving Expo Router the one owner of the route', async () => {
    await renderGate();

    await act(async () => {
      mockLinking.emit(`${AUTH_CALLBACK_URL}?code=${CODE}&nl_rid=${RID}`);
    });

    // Neither, and that is the whole fix. A push here is a second callback screen.
    expect(mockRouter.push).not.toHaveBeenCalledWith('/auth/callback');
    expect(mockRouter.replace).not.toHaveBeenCalledWith('/auth/callback');
  });

  it('still captures the callback, so the screen has something to claim', async () => {
    await renderGate();

    await act(async () => {
      mockLinking.emit(`${AUTH_CALLBACK_URL}?code=${CODE}&nl_rid=${RID}`);
    });

    // Not navigating must not mean not capturing: the screen Expo Router mounts reads this.
    await waitFor(() =>
      expect(screen.getByTestId('pending-callback-key').props.children).toBe(`code:${CODE}`),
    );
  });

  it('collapses a duplicated delivery to one pending callback', async () => {
    await renderGate();

    await act(async () => {
      mockLinking.emit(`${AUTH_CALLBACK_URL}?code=${CODE}&nl_rid=${RID}`);
      mockLinking.emit(`${AUTH_CALLBACK_URL}?code=${CODE}&nl_rid=${RID}`);
      mockLinking.emit(`${AUTH_CALLBACK_URL}?code=${CODE}&nl_rid=${RID}`);
    });

    // `launchMode="singleTask"` re-delivers an intent to the running task. Three deliveries, one item.
    await waitFor(() =>
      expect(screen.getByTestId('pending-callback-key').props.children).toBe(`code:${CODE}`),
    );
    // One pending item, held once — the provider's `seenRef` collapses the re-deliveries.
    expect(screen.getByTestId('pending-callback-origin').props.children).toBe('warm');
    expect(mockRouter.push).not.toHaveBeenCalledWith('/auth/callback');
  });

  it('never navigates for a link on an untrusted scheme either', async () => {
    await renderGate();

    await act(async () => {
      mockLinking.emit(`exp+noorlifeapp://auth/callback?code=${CODE}&nl_rid=${RID}`);
    });

    expect(mockRouter.push).not.toHaveBeenCalledWith('/auth/callback');
    expect(mockRouter.replace).not.toHaveBeenCalledWith('/auth/callback');
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
