import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { AppProviders } from '@application/providers/app-providers';
import { installMockLatencyTimers } from '@/test-support/mock-latency-timers';
import type {
  AuthCallbackOutcome,
  AuthCallbackPort,
} from '@services/auth/auth-callback.contract';
import { AUTH_CALLBACK_URL } from '@services/auth/auth-callback.config';

import { mockLinking, mockRouter } from '../../../../jest.setup';
import { authCallbackCopy } from '../auth-callback-copy';
import { AuthCallbackScreen } from '../screens/auth-callback-screen';

installMockLatencyTimers(() => renderCallback());

/**
 * `/auth/callback` — the states it draws, where each one goes, and what never reaches the screen.
 *
 * ── Why the port is injected and the link is delivered through the OS double ──
 * Two different seams, for two different reasons. Every outcome here — expired, already used, offline, a
 * recovery grant, an email change with one side outstanding — is unreachable without a real emailed link
 * against a real account, and the phase brief forbids altering a genuine test account to produce one. So
 * the *outcome* is injected.
 *
 * The *link* is not: it comes through `mockLinking`, the same `getInitialURL`/`url`-event surface the
 * OS uses, so the cold-start and warm-start paths under test are the real ones. Faking the provider
 * instead would test a fake.
 */

const CODE = '34e770dd-9ff9-416c-87fa-43b31d7ef225';
const copy = authCallbackCopy.callback;

type Fake = AuthCallbackPort & { readonly process: jest.Mock };

function fakePort(outcome: AuthCallbackOutcome | (() => Promise<AuthCallbackOutcome>)): Fake {
  const process = jest.fn(async () => {
    // Resolving on a later tick is what lets the "exchanged once" test observe a genuinely open request.
    await Promise.resolve();
    return typeof outcome === 'function' ? outcome() : outcome;
  });
  return { process };
}

const SIGNED_IN: AuthCallbackOutcome = {
  status: 'signed-in',
  flow: 'signup',
  email: 'ahmed@example.com',
  pendingEmail: null,
};

/** Renders with a cold-start launch URL already set, which is how a real link arrives. */
async function renderCallback(
  options: {
    readonly url?: string | null;
    readonly port?: AuthCallbackPort;
  } = {},
) {
  if (options.url !== null) {
    mockLinking.getInitialURL.mockResolvedValue(options.url ?? `${AUTH_CALLBACK_URL}?code=${CODE}`);
  }
  const view = await render(
    <AppProviders>
      <AuthCallbackScreen port={options.port ?? fakePort(SIGNED_IN)} />
    </AppProviders>,
  );
  await act(async () => {
    await Promise.resolve();
  });
  return view;
}

describe('processing', () => {
  it('announces the wait rather than only drawing a spinner', async () => {
    // A screen reader that saw only an ActivityIndicator would be told nothing at all, and this screen
    // is entirely a wait.
    const port = fakePort(() => new Promise(() => undefined));
    await renderCallback({ port });

    await waitFor(() => expect(screen.getByTestId('auth-callback-processing')).toBeTruthy());
    expect(screen.getByTestId('auth-callback-processing-spinner')).toBeTruthy();
    const label = screen.getByTestId('auth-callback-processing-label');
    expect(label).toHaveTextContent(copy.processing);
    expect(label.props.accessibilityLiveRegion).toBe('polite');
  });

  it('offers no action while it is still working', async () => {
    const port = fakePort(() => new Promise(() => undefined));
    await renderCallback({ port });

    await waitFor(() => expect(screen.getByTestId('auth-callback-processing')).toBeTruthy());
    expect(screen.queryByTestId('auth-callback-continue')).toBeNull();
    expect(screen.queryByTestId('auth-callback-retry')).toBeNull();
    expect(screen.queryByTestId('auth-callback-request-link')).toBeNull();
  });
});

describe('a confirmed signup', () => {
  it('exchanges the callback exactly once', async () => {
    const port = fakePort(SIGNED_IN);
    await renderCallback({ port });

    await waitFor(() => expect(screen.getByTestId('auth-callback-signed-in')).toBeTruthy());
    expect(port.process).toHaveBeenCalledTimes(1);
    expect(port.process).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'callback', code: CODE }),
    );
  });

  it('routes through the entry gate, never straight to Main Home', async () => {
    await renderCallback({ port: fakePort(SIGNED_IN) });
    await waitFor(() => expect(screen.getByTestId('auth-callback-continue')).toBeTruthy());

    await fireEvent.press(screen.getByTestId('auth-callback-continue'));

    /**
     * `'/'` is the entry gate, which runs the one authoritative decision in `startup-machine.ts` —
     * including the rule that a signed-in account with no recorded plan choice goes to the plan chooser.
     * A second decision on this screen is exactly how a confirmed signup would come to bypass it.
     */
    expect(mockRouter.replace).toHaveBeenCalledWith('/');
    expect(mockRouter.replace).not.toHaveBeenCalledWith('/home');
    expect(mockRouter.push).not.toHaveBeenCalled();
  });

  it('cannot navigate to the plan chooser or Main Home on its own authority', async () => {
    await renderCallback({ port: fakePort(SIGNED_IN) });
    await waitFor(() => expect(screen.getByTestId('auth-callback-continue')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('auth-callback-continue'));

    for (const call of mockRouter.replace.mock.calls.flat()) {
      expect(call).not.toBe('/home');
      expect(call).not.toBe('/subscription');
    }
  });
});

describe('a password recovery', () => {
  const RECOVERY: AuthCallbackOutcome = { status: 'recovery-ready', userId: 'user-1' };

  it('says a new password is next, and does not claim anything changed', async () => {
    await renderCallback({ port: fakePort(RECOVERY) });

    await waitFor(() => expect(screen.getByTestId('auth-callback-recovery')).toBeTruthy());
    expect(screen.getByTestId('auth-callback-recovery-banner')).toHaveTextContent(
      copy.recoveryTitle,
    );
    // Nothing has changed yet, so nothing on screen may say it has.
    const page = JSON.stringify(screen.toJSON());
    expect(page).not.toContain('Password set');
    expect(page).not.toContain('password has been reset');
  });

  it('replaces rather than pushes, so Back cannot return to a consumed callback', async () => {
    await renderCallback({ port: fakePort(RECOVERY) });
    await waitFor(() =>
      expect(screen.getByTestId('auth-callback-recovery-continue')).toBeTruthy(),
    );

    await fireEvent.press(screen.getByTestId('auth-callback-recovery-continue'));

    expect(mockRouter.replace).toHaveBeenCalledWith('/auth/set-new-password');
  });
});

describe('an email change', () => {
  it('shows the confirmed address from the refreshed account', async () => {
    await renderCallback({
      port: fakePort({
        status: 'signed-in',
        flow: 'email-change',
        email: 'new@example.com',
        pendingEmail: null,
      }),
    });

    await waitFor(() => expect(screen.getByTestId('auth-callback-signed-in')).toBeTruthy());
    expect(screen.getByTestId('auth-callback-signed-in-banner')).toHaveTextContent(
      copy.emailChangedTitle,
    );
    expect(screen.getByTestId('auth-callback-signed-in-detail')).toHaveTextContent(
      copy.emailChangedFor('new@example.com'),
    );
  });

  it('shows an honest pending state while Secure Email Change has one side outstanding', async () => {
    await renderCallback({
      port: fakePort({
        status: 'signed-in',
        flow: 'email-change',
        email: 'ahmed@example.com',
        pendingEmail: 'new@example.com',
      }),
    });

    await waitFor(() => expect(screen.getByTestId('auth-callback-signed-in')).toBeTruthy());
    // It must not say "updated": the user would then fail to sign in with the new address.
    expect(screen.getByTestId('auth-callback-signed-in-banner')).toHaveTextContent(
      copy.emailPendingTitle,
    );
    expect(screen.getByTestId('auth-callback-signed-in-detail')).toHaveTextContent(
      copy.emailPendingFor('new@example.com'),
    );
    expect(screen.getByTestId('auth-callback-signed-in-current')).toHaveTextContent(
      copy.emailPendingCurrent('ahmed@example.com'),
    );
  });

  it('never displays an address taken from the callback URL', async () => {
    await renderCallback({
      url: `${AUTH_CALLBACK_URL}?code=${CODE}&type=email_change&email=attacker@example.org`,
      port: fakePort({
        status: 'signed-in',
        flow: 'email-change',
        email: 'authoritative@example.com',
        pendingEmail: null,
      }),
    });

    await waitFor(() => expect(screen.getByTestId('auth-callback-signed-in')).toBeTruthy());
    /**
     * The one mistake the email-change flow cannot make. An address on a callback URL is an untrusted
     * claim; showing it as the account's address would report a change that had not happened.
     */
    const page = JSON.stringify(screen.toJSON());
    expect(page).toContain('authoritative@example.com');
    expect(page).not.toContain('attacker@example.org');
  });

  it('says what it does not know when the refresh could not complete', async () => {
    await renderCallback({
      port: fakePort({
        status: 'signed-in',
        flow: 'email-change',
        email: null,
        pendingEmail: null,
      }),
    });

    await waitFor(() => expect(screen.getByTestId('auth-callback-signed-in')).toBeTruthy());
    // Falls back to the signup wording rather than inventing an address.
    expect(screen.getByTestId('auth-callback-signed-in-detail')).toHaveTextContent(
      copy.signupSupporting,
    );
  });
});

describe('failures', () => {
  it.each([
    'link-expired',
    'link-already-used',
    'invalid-link',
    'malformed-code',
    'missing-code',
    'conflicting-flow',
    'unsupported-flow',
    'untrusted-scheme',
    'untrusted-host',
    'unsupported-path',
    'session-unavailable',
    'not-configured',
  ] as const)('renders the mapped state for %s and offers a new link', async (code) => {
    await renderCallback({
      port: fakePort({ status: 'failed', code }),
    });

    await waitFor(() => expect(screen.getByTestId('auth-callback-error')).toBeTruthy());
    expect(screen.getByTestId('auth-callback-error-banner')).toHaveTextContent(
      copy.errorTitles[code],
    );
    expect(screen.getByTestId('auth-callback-error-detail')).toHaveTextContent(copy.errors[code]);
    // The link is spent or invalid, so a Try Again could only fail again.
    expect(screen.getByTestId('auth-callback-request-link')).toBeTruthy();
    expect(screen.queryByTestId('auth-callback-retry')).toBeNull();
  });

  it.each(['offline', 'server-error'] as const)(
    'offers a retry for %s, where the link is still unused at the server',
    async (code) => {
      const port = fakePort({ status: 'failed', code });
      await renderCallback({ port });

      await waitFor(() => expect(screen.getByTestId('auth-callback-retry')).toBeTruthy());
      expect(screen.queryByTestId('auth-callback-request-link')).toBeNull();

      await fireEvent.press(screen.getByTestId('auth-callback-retry'));
      // The *same* callback, not a re-claim: the provider's copy was already consumed.
      await waitFor(() => expect(port.process).toHaveBeenCalledTimes(2));
    },
  );

  it('does not enter a protected screen after a refusal', async () => {
    await renderCallback({ port: fakePort({ status: 'failed', code: 'link-expired' }) });
    await waitFor(() => expect(screen.getByTestId('auth-callback-error')).toBeTruthy());

    for (const call of mockRouter.replace.mock.calls.flat()) {
      expect(call).not.toBe('/');
      expect(call).not.toBe('/home');
    }
    expect(mockRouter.push).not.toHaveBeenCalled();
  });

  it('sends Request a New Link to the reset request, not to the recovery screen', async () => {
    await renderCallback({ port: fakePort({ status: 'failed', code: 'link-expired' }) });
    await waitFor(() => expect(screen.getByTestId('auth-callback-request-link')).toBeTruthy());

    await fireEvent.press(screen.getByTestId('auth-callback-request-link'));

    expect(mockRouter.replace).toHaveBeenCalledWith('/forgot-password');
    expect(mockRouter.replace).not.toHaveBeenCalledWith('/auth/set-new-password');
  });
});

describe('a callback the parser refused', () => {
  it('makes no service call at all', async () => {
    const port = fakePort(SIGNED_IN);
    await renderCallback({ url: `exp+noorlifeapp://auth/callback?code=${CODE}`, port });

    await waitFor(() => expect(screen.getByTestId('auth-callback-error')).toBeTruthy());
    // Refused before anything was sent, so nothing was consumed at the server either.
    expect(port.process).not.toHaveBeenCalled();
    expect(screen.getByTestId('auth-callback-error-banner')).toHaveTextContent(
      copy.errorTitles['untrusted-scheme'],
    );
  });

  it('reports a server-side expiry without asking the server again', async () => {
    const port = fakePort(SIGNED_IN);
    await renderCallback({
      url: `${AUTH_CALLBACK_URL}?error=access_denied&error_code=otp_expired`,
      port,
    });

    await waitFor(() => expect(screen.getByTestId('auth-callback-error')).toBeTruthy());
    expect(port.process).not.toHaveBeenCalled();
    expect(screen.getByTestId('auth-callback-error-banner')).toHaveTextContent(
      copy.errorTitles['link-expired'],
    );
  });
});

describe('opened with nothing to confirm', () => {
  it('says the link is not valid rather than waiting for ever', async () => {
    const port = fakePort(SIGNED_IN);
    await renderCallback({ url: null, port });

    // Either the route was opened directly, or a previous mount already claimed the callback.
    await waitFor(() => expect(screen.getByTestId('auth-callback-error')).toBeTruthy());
    expect(port.process).not.toHaveBeenCalled();
    expect(screen.queryByTestId('auth-callback-processing')).toBeNull();
  });
});

describe('what never reaches the screen', () => {
  /**
   * One test per state rather than one loop over three.
   *
   * A loop would have to unmount between renders, and an unmounted tree leaves `screen` bound to a
   * detached instance — which then breaks the *next* test in the file rather than this one. `it.each`
   * lets RNTL's own cleanup do it, and names the failing state when one fails.
   */
  it.each([
    ['a confirmed session', SIGNED_IN],
    ['a recovery grant', { status: 'recovery-ready', userId: 'user-1' } as const],
    ['a refusal', { status: 'failed', code: 'link-expired' } as const],
  ])('renders no code, token, flow id or callback URL for %s', async (_label, outcome) => {
    await renderCallback({
      url: `${AUTH_CALLBACK_URL}?code=${CODE}&sb_flow_id=abcd1234efgh&type=recovery`,
      port: fakePort(outcome),
    });
    await waitFor(() => expect(screen.getByTestId('auth-callback-actions')).toBeTruthy());

    const page = JSON.stringify(screen.toJSON());
    for (const forbidden of [CODE, 'abcd1234efgh', 'noorlifeapp://', 'auth/callback', 'user-1']) {
      expect(page).not.toContain(forbidden);
    }
  });

  it('logs no code, token or URL during a full run', async () => {
    const spies = (['log', 'warn', 'error', 'info', 'debug'] as const).map((level) =>
      jest.spyOn(console, level).mockImplementation(() => undefined),
    );

    await renderCallback({
      url: `${AUTH_CALLBACK_URL}?code=${CODE}&sb_flow_id=abcd1234efgh`,
      port: fakePort(SIGNED_IN),
    });
    await waitFor(() => expect(screen.getByTestId('auth-callback-signed-in')).toBeTruthy());

    const emitted = spies.flatMap((spy) => spy.mock.calls.flat().map(String)).join(' ');
    for (const forbidden of [CODE, 'abcd1234efgh', 'noorlifeapp://']) {
      expect(emitted).not.toContain(forbidden);
    }
    for (const spy of spies) {
      spy.mockRestore();
    }
  });
});

describe('geometry', () => {
  /**
   * The state slot reserves its height, so the page does not jump as the callback resolves.
   *
   * Asserted per state against the same expected value rather than by rendering two states in one test
   * and comparing them: the second half of such a test needs an unmount, and an unmounted tree leaves
   * `screen` bound to a detached instance. The shared constant is what makes it a comparison.
   */
  const EXPECTED_MIN_HEIGHT = 180;

  function slotMinHeight(): number | undefined {
    const flat = screen.getByTestId('auth-callback-slot').props.style as unknown[];
    const merged = Object.assign(
      {},
      ...flat.filter(
        (entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null,
      ),
    ) as { minHeight?: number };
    return merged.minHeight;
  }

  it('reserves the slot while processing', async () => {
    await renderCallback({ port: fakePort(() => new Promise(() => undefined)) });
    await waitFor(() => expect(screen.getByTestId('auth-callback-processing')).toBeTruthy());
    expect(slotMinHeight()).toBe(EXPECTED_MIN_HEIGHT);
  });

  it('keeps the same slot once it has resolved', async () => {
    await renderCallback({ port: fakePort(SIGNED_IN) });
    await waitFor(() => expect(screen.getByTestId('auth-callback-signed-in')).toBeTruthy());
    // A page that resizes as it resolves reads as two different screens.
    expect(slotMinHeight()).toBe(EXPECTED_MIN_HEIGHT);
  });

  it('keeps the same slot for a refusal', async () => {
    await renderCallback({ port: fakePort({ status: 'failed', code: 'link-expired' }) });
    await waitFor(() => expect(screen.getByTestId('auth-callback-error')).toBeTruthy());
    expect(slotMinHeight()).toBe(EXPECTED_MIN_HEIGHT);
  });
});
