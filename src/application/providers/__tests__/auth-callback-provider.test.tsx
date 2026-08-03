import { act, render, screen, waitFor } from '@testing-library/react-native';
import { useEffect } from 'react';
import { Text } from 'react-native';

import { AUTH_CALLBACK_URL } from '@services/auth/auth-callback.config';

import { mockLinking } from '../../../../jest.setup';
import {
  AuthCallbackProvider,
  useAuthCallback,
  useAuthCallbackActions,
  type AuthCallbackActions,
  type AuthCallbackState,
} from '../auth-callback-provider';

/**
 * Cold start, warm start, single consumption, the recovery grant and the pending destination.
 *
 * ── Why a probe component rather than a rendered screen ─────────────────────
 * The provider's contract is about *what it holds and hands out*, and every one of those properties is
 * a race: two consumers in one commit, the same link delivered twice, a grant that must not survive.
 * Asserting them through a screen would mean asserting them through whatever that screen happens to
 * render. A probe exposes the state and the actions directly, so each test says exactly what it means.
 *
 * `mockLinking` from `jest.setup.ts` stands in for the OS: `getInitialURL` is the cold-start launch URL,
 * and `emit` delivers the `url` event that Android's `singleTask` re-entry produces. Neither can be
 * produced on this machine any other way.
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

let captured: { state: AuthCallbackState; actions: AuthCallbackActions } | null = null;

function Probe() {
  const state = useAuthCallback();
  const actions = useAuthCallbackActions();
  /**
   * Published in an effect rather than during render.
   *
   * Writing a module variable from a render body is a side effect in render, which React's rules — and
   * the compiler this project enables — correctly reject. An effect runs after each commit, so `captured`
   * is current by the time an awaited `render` or `act` returns, which is when every test reads it.
   */
  useEffect(() => {
    captured = { state, actions };
  }, [actions, state]);
  return (
    <Text testID="probe">
      {state.pending === null ? 'none' : `${state.pending.origin}:${state.pending.parsed.kind}`}
    </Text>
  );
}

async function renderProvider() {
  /**
   * `await render(...)` for the same reason every other suite in this project does it.
   *
   * React 19's renderer schedules the first commit, and RNTL's `render` resolves once it has flushed.
   * Calling it synchronously happened to work for the first test in the file — where a following
   * `waitFor` gave the commit a chance — and left `captured` null for every test after it, which is a
   * confusing way to discover the same thing twice.
   */
  const view = await render(
    <AuthCallbackProvider>
      <Probe />
    </AuthCallbackProvider>,
  );
  // The cold-start read is a promise, so one flush is needed before the launch URL can be observed.
  await act(async () => {
    await Promise.resolve();
  });
  return view;
}

function state(): AuthCallbackState {
  if (captured === null) {
    throw new Error('The probe did not render.');
  }
  return captured.state;
}

function actions(): AuthCallbackActions {
  if (captured === null) {
    throw new Error('The probe did not render.');
  }
  return captured.actions;
}

beforeEach(() => {
  captured = null;
});

describe('cold start', () => {
  it('captures the URL the app was launched with', async () => {
    mockLinking.getInitialURL.mockResolvedValue(`${AUTH_CALLBACK_URL}?code=${CODE}&nl_rid=${RID}`);

    await renderProvider();

    await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent('cold:callback'));
    expect(state().pending?.parsed).toMatchObject({ kind: 'callback', code: CODE });
  });

  it('holds nothing when the app was not launched by a link', async () => {
    await renderProvider();
    expect(state().pending).toBeNull();
  });

  it('captures a rejected callback too, so the screen can refuse it visibly', async () => {
    mockLinking.getInitialURL.mockResolvedValue(`exp+noorlifeapp://auth/callback?code=${CODE}&nl_rid=${RID}`);

    await renderProvider();

    await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent('cold:rejected'));
  });

  it('ignores a URL that is not addressed to the callback', async () => {
    mockLinking.getInitialURL.mockResolvedValue('noorlifeapp://faith/quran');

    await renderProvider();

    /**
     * Somebody navigating, not a hostile callback. Raising an authentication state over it would put an
     * error screen on top of whatever the user was doing.
     */
    expect(state().pending).toBeNull();
  });

  it('survives a rejected getInitialURL, which means "not launched by a link"', async () => {
    mockLinking.getInitialURL.mockRejectedValue(new Error('no linking support'));

    await renderProvider();

    expect(state().pending).toBeNull();
  });
});

describe('warm start', () => {
  it('captures a link delivered to the running app', async () => {
    await renderProvider();
    expect(state().pending).toBeNull();

    await act(async () => {
      mockLinking.emit(`${AUTH_CALLBACK_URL}?code=${CODE}&nl_rid=${RID}`);
    });

    await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent('warm:callback'));
  });

  it('collapses a duplicated delivery of the same link to one pending item', async () => {
    await renderProvider();

    await act(async () => {
      mockLinking.emit(`${AUTH_CALLBACK_URL}?code=${CODE}&nl_rid=${RID}`);
      mockLinking.emit(`${AUTH_CALLBACK_URL}?code=${CODE}&nl_rid=${RID}`);
      mockLinking.emit(`${AUTH_CALLBACK_URL}?code=${CODE}&nl_rid=${RID}`);
    });

    // `launchMode="singleTask"` re-delivers an intent to the running task, and a mounted screen can see
    // the same URL again. One pending item, therefore one exchange.
    const first = actions().claim();
    expect(first?.parsed).toMatchObject({ code: CODE });
    expect(actions().claim()).toBeNull();
  });

  it('does not re-queue a link that was already claimed and processed', async () => {
    await renderProvider();

    await act(async () => {
      mockLinking.emit(`${AUTH_CALLBACK_URL}?code=${CODE}&nl_rid=${RID}`);
    });
    expect(actions().claim()).not.toBeNull();

    await act(async () => {
      mockLinking.emit(`${AUTH_CALLBACK_URL}?code=${CODE}&nl_rid=${RID}`);
    });

    expect(state().pending).toBeNull();
  });

  it('lets a genuinely different link through', async () => {
    await renderProvider();

    await act(async () => {
      mockLinking.emit(`${AUTH_CALLBACK_URL}?code=${CODE}&nl_rid=${RID}`);
    });
    actions().claim();

    const other = CODE.replace('34e770dd', '99e770dd');
    await act(async () => {
      mockLinking.emit(`${AUTH_CALLBACK_URL}?code=${other}&nl_rid=${RID}`);
    });

    expect(state().pending?.parsed).toMatchObject({ code: other });
  });

  it('leaves the current state alone for an unrelated URL', async () => {
    await renderProvider();

    await act(async () => {
      mockLinking.emit('noorlifeapp://home');
      mockLinking.emit('https://nkdigitalworks.com/privacy');
    });

    expect(state().pending).toBeNull();
  });
});

describe('claiming', () => {
  it('hands the callback out exactly once', async () => {
    mockLinking.getInitialURL.mockResolvedValue(`${AUTH_CALLBACK_URL}?code=${CODE}&nl_rid=${RID}`);
    await renderProvider();

    const first = actions().claim();
    const second = actions().claim();

    /**
     * The two-consumers-in-one-commit case. `claim` clears a ref before it returns, because React state
     * is not readable synchronously after a set — a state flag would still be unset for the second
     * caller, and both would start an exchange of the same single-use code.
     */
    expect(first).not.toBeNull();
    expect(second).toBeNull();
  });

  it('reports nothing pending after a claim', async () => {
    mockLinking.getInitialURL.mockResolvedValue(`${AUTH_CALLBACK_URL}?code=${CODE}&nl_rid=${RID}`);
    await renderProvider();

    await act(async () => {
      actions().claim();
    });

    expect(state().pending).toBeNull();
  });
});

describe('the recovery grant', () => {
  it('starts absent, is recorded, and is cleared', async () => {
    await renderProvider();
    expect(state().recovery).toBeNull();

    await act(async () => {
      actions().grantRecovery({ userId: 'user-1' });
    });
    expect(state().recovery).toEqual({ userId: 'user-1' });

    await act(async () => {
      actions().clearRecovery();
    });
    expect(state().recovery).toBeNull();
  });

  it('is not restored by a fresh provider, because it is never persisted', async () => {
    await renderProvider();
    await act(async () => {
      actions().grantRecovery({ userId: 'user-1' });
    });

    // A persisted grant would outlive the recovery it was minted for and become a standing permission
    // to rotate the account's password. Losing it on a restart is the correct behaviour.
    captured = null;
    await renderProvider();
    expect(state().recovery).toBeNull();
  });
});

describe('the pending destination', () => {
  it('accepts an app-internal route on the resumable list', async () => {
    await renderProvider();

    let accepted = false;
    await act(async () => {
      accepted = actions().rememberDestination('/faith/quran');
    });

    expect(accepted).toBe(true);
    expect(state().pendingDestination).toBe('/faith/quran');
  });

  it.each([
    ['an external URL', 'https://elsewhere.example.com/x'],
    ['a scheme-relative URL', '//elsewhere.example.com/x'],
    ['a custom scheme', 'noorlifeapp://home'],
    ['a relative path', 'home'],
    ['traversal', '/faith/../../etc/passwd'],
    ['an off-list route', '/family/members'],
    ['an entry-flow loop', '/sign-in'],
    ['the recovery screen', '/auth/set-new-password'],
    ['a prefix lookalike', '/homework'],
    ['not a string', 42],
  ])('refuses %s', async (_label, value) => {
    await renderProvider();

    let accepted = true;
    await act(async () => {
      accepted = actions().rememberDestination(value);
    });

    expect(accepted).toBe(false);
    expect(state().pendingDestination).toBeNull();
  });

  it('is taken exactly once and cleared', async () => {
    await renderProvider();
    await act(async () => {
      actions().rememberDestination('/profile');
    });

    const first = actions().takeDestination();
    const second = actions().takeDestination();

    expect(first).toBe('/profile');
    expect(second).toBeNull();
  });

  it('is not persisted, so it cannot leak into a later session', async () => {
    await renderProvider();
    await act(async () => {
      actions().rememberDestination('/profile');
    });

    captured = null;
    await renderProvider();
    expect(state().pendingDestination).toBeNull();
  });
});

describe('what the provider never does', () => {
  it('logs nothing, for any delivery', async () => {
    const spies = (['log', 'warn', 'error', 'info', 'debug'] as const).map((level) =>
      jest.spyOn(console, level).mockImplementation(() => undefined),
    );

    mockLinking.getInitialURL.mockResolvedValue(`${AUTH_CALLBACK_URL}?code=${CODE}&nl_rid=${RID}`);
    await renderProvider();
    await act(async () => {
      mockLinking.emit(`exp+noorlifeapp://auth/callback?code=${CODE}&nl_rid=${RID}`);
      mockLinking.emit(`${AUTH_CALLBACK_URL}#access_token=leaked-token`);
      actions().rememberDestination('https://elsewhere.example.com');
    });

    const emitted = spies.flatMap((spy) => spy.mock.calls.flat().map(String)).join(' ');
    for (const forbidden of [CODE, 'leaked-token', 'elsewhere.example.com', 'noorlifeapp://']) {
      expect(emitted).not.toContain(forbidden);
    }
    for (const spy of spies) {
      spy.mockRestore();
    }
  });

  it('throws a clear error when its actions are used outside it', async () => {
    // A silent no-op here would mean a callback that is never claimed and a screen stuck on a spinner.
    const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    // Awaited rather than wrapped in `expect(() => …).toThrow`: React 19 commits asynchronously, so the
    // error surfaces from the returned promise rather than from the call.
    await expect(render(<Probe />)).rejects.toThrow(/outside AuthCallbackProvider/);
    spy.mockRestore();
  });
});
