import { isAuthCallbackUrl, parseAuthCallback } from '../auth-callback-url';
import {
  AUTH_CALLBACK_URL,
  REQUIRED_SUPABASE_REDIRECT_URLS,
} from '../auth-callback.config';

/**
 * The trust boundary, against hostile input.
 *
 * ── Why this suite is large and pure ────────────────────────────────────────
 * `parseAuthCallback` is the first thing an attacker-controllable string touches, and the thing on the
 * other side of it establishes a session. Every case below is a URL somebody could send to the device
 * with `adb shell am start` or a crafted link, and the parser has no I/O — so a hundred of them run in
 * milliseconds and none of them needs a screen mounted.
 *
 * A behavioural test can only prove the paths it thought to exercise. That is why the negative cases
 * outnumber the positive ones here.
 */

/** A code of the shape GoTrue issues for PKCE: a UUID. */
const CODE = '34e770dd-9ff9-416c-87fa-43b31d7ef225';
const FLOW_ID = 'abc12345_XY-9';

describe('a trusted callback', () => {
  it('accepts the canonical URL with a code', () => {
    const parsed = parseAuthCallback(`${AUTH_CALLBACK_URL}?code=${CODE}`);
    expect(parsed).toEqual({
      kind: 'callback',
      code: CODE,
      flowId: null,
      declaredFlow: null,
    });
  });

  it('accepts the URL the phase documents for the Supabase allow-list', () => {
    // The literal in the dashboard and the literal the parser trusts are the same value, from the same
    // constant. A test that spelled it out again would pass while they diverged.
    expect(REQUIRED_SUPABASE_REDIRECT_URLS[0]).toBe(AUTH_CALLBACK_URL);
    expect(parseAuthCallback(`${AUTH_CALLBACK_URL}?code=${CODE}`).kind).toBe('callback');
  });

  it.each([
    ['two slashes', `noorlifeapp://auth/callback?code=${CODE}`],
    ['three slashes, as createURL can produce', `noorlifeapp:///auth/callback?code=${CODE}`],
    ['a trailing slash', `noorlifeapp://auth/callback/?code=${CODE}`],
    ['an upper-case scheme', `NOORLIFEAPP://auth/callback?code=${CODE}`],
    ['an upper-case path', `noorlifeapp://AUTH/CALLBACK?code=${CODE}`],
    ['surrounding whitespace', `  noorlifeapp://auth/callback?code=${CODE}  `],
  ])('resolves %s to the same destination', (_label, url) => {
    // A device delivers these interchangeably. Treating them differently would be a bug nobody could
    // reproduce, because it would depend on how many slashes were typed.
    expect(parseAuthCallback(url).kind).toBe('callback');
  });

  it('reads the Supabase flow id when the redirect carries one', () => {
    const parsed = parseAuthCallback(
      `${AUTH_CALLBACK_URL}?code=${CODE}&sb_flow_id=${FLOW_ID}`,
    );
    expect(parsed).toMatchObject({ kind: 'callback', flowId: FLOW_ID });
  });

  it.each([
    ['signup', 'signup'],
    ['magiclink', 'signup'],
    ['invite', 'signup'],
    ['recovery', 'recovery'],
    ['email_change', 'email-change'],
    ['RECOVERY', 'recovery'],
  ])('maps a declared type of %s onto %s', (declared, flow) => {
    expect(parseAuthCallback(`${AUTH_CALLBACK_URL}?code=${CODE}&type=${declared}`)).toMatchObject({
      kind: 'callback',
      declaredFlow: flow,
    });
  });

  it('treats a link with no declared type as the ordinary PKCE case', () => {
    // A PKCE signup confirmation carries no `type` at all. Refusing it would refuse the common case.
    expect(parseAuthCallback(`${AUTH_CALLBACK_URL}?code=${CODE}`)).toMatchObject({
      declaredFlow: null,
    });
  });

  it('decodes a percent-encoded code', () => {
    expect(parseAuthCallback(`${AUTH_CALLBACK_URL}?code=${CODE}%2Dx`)).toMatchObject({
      code: `${CODE}-x`,
    });
  });
});

describe('an untrusted scheme', () => {
  it.each([
    ['Expo Go', `exp+noorlifeapp://auth/callback?code=${CODE}`],
    ['https', `https://auth/callback?code=${CODE}`],
    ['a lookalike', `noorlifeapp2://auth/callback?code=${CODE}`],
    ['a prefix match', `noorlife://auth/callback?code=${CODE}`],
    ['javascript', `javascript://auth/callback?code=${CODE}`],
    ['file', `file://auth/callback?code=${CODE}`],
  ])('refuses %s aimed at the callback', (_label, url) => {
    expect(parseAuthCallback(url)).toEqual({ kind: 'rejected', code: 'untrusted-scheme' });
  });

  it('refuses Expo Go even though the prebuild declares its scheme in the manifest', () => {
    /**
     * `expo prebuild` writes `exp+noorlifeapp` into the intent filter, so the OS *will* route such a
     * link here. Trusting it would mean accepting a session-establishing link from a development client
     * that any app on the device can also claim, so the manifest's tolerance is not this contract's.
     */
    expect(parseAuthCallback(`exp+noorlifeapp://auth/callback?code=${CODE}`)).toEqual({
      kind: 'rejected',
      code: 'untrusted-scheme',
    });
  });
});

describe('an untrusted host', () => {
  it.each([
    `noorlifeapp://elsewhere.example.com/auth/callback?code=${CODE}`,
    `noorlifeapp://user@elsewhere.example.com/auth/callback?code=${CODE}`,
    `noorlifeapp://a/b/auth/callback?code=${CODE}`,
  ])('refuses %s', (url) => {
    // The right path with something occupying the authority slot. Named for what is wrong rather than
    // described as a path depth, so a reader of a log knows which check fired.
    expect(parseAuthCallback(url)).toEqual({ kind: 'rejected', code: 'untrusted-host' });
  });
});

describe('an unsupported path', () => {
  it.each([
    `noorlifeapp://auth/callback/extra?code=${CODE}`,
    `noorlifeapp://auth/verify?code=${CODE}`,
    `noorlifeapp://auth?code=${CODE}`,
    `noorlifeapp://auth/?code=${CODE}`,
    `noorlifeapp://auth/callback/callback?code=${CODE}`,
  ])('refuses %s', (url) => {
    expect(parseAuthCallback(url)).toEqual({ kind: 'rejected', code: 'unsupported-path' });
  });
});

describe('a URL that is not addressed to the callback at all', () => {
  it.each([
    ['a module deep link', 'noorlifeapp://faith/quran'],
    ['Main Home', 'noorlifeapp://home'],
    ['a subscription screen', 'noorlifeapp://subscription/compare?period=yearly'],
    ['an https page', 'https://nkdigitalworks.com/privacy'],
    ['a mailto', 'mailto:hello@example.com'],
    ['a bare path', '/home'],
    ['an empty string', ''],
    ['not a string', 42],
    ['null', null],
    ['undefined', undefined],
  ])('reports %s as unrelated rather than as a hostile callback', (_label, url) => {
    /**
     * The distinction is load-bearing. `unrelated` leaves the current screen alone; `rejected` puts an
     * authentication error on top of it. A user tapping a Quran link must not be shown a link-security
     * message.
     */
    expect(parseAuthCallback(url)).toEqual({ kind: 'unrelated' });
  });

  it('does not claim an unrelated URL', () => {
    expect(isAuthCallbackUrl('noorlifeapp://faith/quran')).toBe(false);
    expect(isAuthCallbackUrl(`${AUTH_CALLBACK_URL}?code=${CODE}`)).toBe(true);
    // A hostile callback *is* claimed, so the listener can show a refusal rather than ignoring it.
    expect(isAuthCallbackUrl(`exp+noorlifeapp://auth/callback?code=${CODE}`)).toBe(true);
  });
});

describe('a missing or malformed code', () => {
  it('refuses a callback with no code and no error', () => {
    expect(parseAuthCallback(AUTH_CALLBACK_URL)).toEqual({
      kind: 'rejected',
      code: 'missing-code',
    });
    expect(parseAuthCallback(`${AUTH_CALLBACK_URL}?code=`)).toEqual({
      kind: 'rejected',
      code: 'missing-code',
    });
  });

  it.each([
    ['too short', 'abc'],
    ['a path separator', `${CODE}/../../x`],
    ['a percent escape', `${CODE}%00`],
    ['a space', `${CODE} x`],
    ['an angle bracket', `${CODE}<script>`],
    ['a plus', `${CODE}+x`],
    ['an equals', `${CODE}=`],
    ['a quote', `${CODE}'`],
    ['far too long', 'a'.repeat(513)],
  ])('refuses a code containing %s', (_label, code) => {
    expect(parseAuthCallback(`${AUTH_CALLBACK_URL}?code=${code}`)).toEqual({
      kind: 'rejected',
      code: 'malformed-code',
    });
  });

  it('refuses two different codes rather than picking one', () => {
    /**
     * Parameter pollution. The attack relies on two readers disagreeing about which value wins, so this
     * reader does not choose — it refuses.
     */
    expect(parseAuthCallback(`${AUTH_CALLBACK_URL}?code=${CODE}&code=${CODE.replace('3', '4')}`)).toEqual(
      { kind: 'rejected', code: 'malformed-code' },
    );
  });

  it('accepts the same code repeated identically, which is not a conflict', () => {
    expect(parseAuthCallback(`${AUTH_CALLBACK_URL}?code=${CODE}&code=${CODE}`)).toMatchObject({
      kind: 'callback',
      code: CODE,
    });
  });

  it('drops a malformed flow id rather than refusing an otherwise valid link', () => {
    // The flow id is an optimisation, not a credential: without it the SDK reads the legacy fixed key.
    // Refusing a legitimate recovery because Supabase appended something unparseable would be worse.
    expect(parseAuthCallback(`${AUTH_CALLBACK_URL}?code=${CODE}&sb_flow_id=$$$`)).toMatchObject({
      kind: 'callback',
      code: CODE,
      flowId: null,
    });
  });
});

describe('an unsupported flow', () => {
  it.each(['oauth', 'phone_change', 'sms', 'reauthentication', 'anything'])(
    'refuses a declared type of %s',
    (type) => {
      // A `type` we do not recognise is a link we did not send. Never mapped to a default.
      expect(parseAuthCallback(`${AUTH_CALLBACK_URL}?code=${CODE}&type=${type}`)).toEqual({
        kind: 'rejected',
        code: 'unsupported-flow',
      });
    },
  );

  it('refuses the reserved oauth flow while it is disabled', () => {
    // Declared in the configuration so a later phase has one switch; refused until it is thrown.
    expect(parseAuthCallback(`${AUTH_CALLBACK_URL}?code=${CODE}&type=oauth`)).toEqual({
      kind: 'rejected',
      code: 'unsupported-flow',
    });
  });
});

describe('fragment tokens', () => {
  it.each([
    'access_token=aaaaaaaaaaaaaaaaaaaaaaaa&refresh_token=bbbb&type=recovery',
    'refresh_token=bbbb',
    'provider_token=cccc',
    'expires_in=3600&access_token=aaaa',
  ])('refuses an implicit-flow callback carrying %s', (fragment) => {
    /**
     * The single highest-value thing a deep link could smuggle. `flowType: 'pkce'` means the app never
     * requests an implicit link, so one can only come from a customised template or a hand-built URL —
     * and there is no `setSession` path in the callback service to consume it.
     */
    expect(parseAuthCallback(`${AUTH_CALLBACK_URL}#${fragment}`)).toEqual({
      kind: 'rejected',
      code: 'invalid-link',
    });
  });

  it('refuses them even when a valid-looking code is also present', () => {
    expect(parseAuthCallback(`${AUTH_CALLBACK_URL}?code=${CODE}#access_token=aaaa`)).toEqual({
      kind: 'rejected',
      code: 'invalid-link',
    });
  });
});

describe('a server-reported failure', () => {
  it.each([
    ['otp_expired', 'link-expired'],
    ['token_expired', 'link-expired'],
    ['flow_state_expired', 'link-expired'],
    ['flow_state_not_found', 'link-already-used'],
    ['bad_code_verifier', 'link-already-used'],
    ['signup_disabled', 'unsupported-flow'],
    ['over_email_send_rate_limit', 'server-error'],
  ])('maps error_code %s to %s', (errorCode, expected) => {
    expect(
      parseAuthCallback(`${AUTH_CALLBACK_URL}?error=access_denied&error_code=${errorCode}`),
    ).toMatchObject({ kind: 'error', code: expected });
  });

  it('falls back to the coarse error when there is no code', () => {
    expect(parseAuthCallback(`${AUTH_CALLBACK_URL}?error=access_denied`)).toMatchObject({
      kind: 'error',
      code: 'link-expired',
    });
    expect(parseAuthCallback(`${AUTH_CALLBACK_URL}?error=server_error`)).toMatchObject({
      kind: 'error',
      code: 'server-error',
    });
  });

  it('reports the failure rather than describing our own missing-code check', () => {
    // An expired recovery link arrives with an error and no code. Calling that `missing-code` would
    // describe the parser instead of what happened.
    const parsed = parseAuthCallback(
      `${AUTH_CALLBACK_URL}?error=access_denied&error_code=otp_expired`,
    );
    expect(parsed.kind).toBe('error');
  });

  it('records that a description was present and keeps none of its text', () => {
    const description = 'Email+link+is+invalid+or+has+expired+for+ahmed@example.com';
    const parsed = parseAuthCallback(
      `${AUTH_CALLBACK_URL}?error=access_denied&error_code=otp_expired&error_description=${description}`,
    );

    expect(parsed).toMatchObject({ kind: 'error', hadDescription: true });
    /**
     * The whole point of the boolean. `error_description` is a server-authored sentence that has
     * carried addresses and identifiers; the parser notes that one existed and drops the string, so it
     * cannot be rendered, logged or pattern-matched later.
     */
    expect(JSON.stringify(parsed)).not.toContain('ahmed@example.com');
    expect(JSON.stringify(parsed)).not.toContain('invalid or has expired');
  });

  it('reports no description when none was sent', () => {
    expect(parseAuthCallback(`${AUTH_CALLBACK_URL}?error=access_denied`)).toMatchObject({
      hadDescription: false,
    });
  });
});

describe('what the parser never returns', () => {
  const hostile = [
    `${AUTH_CALLBACK_URL}?code=${CODE}`,
    `${AUTH_CALLBACK_URL}?code=${CODE}&sb_flow_id=${FLOW_ID}`,
    `${AUTH_CALLBACK_URL}?error=access_denied&error_description=secret+sentence`,
    `${AUTH_CALLBACK_URL}#access_token=super-secret-token`,
    `exp+noorlifeapp://auth/callback?code=${CODE}`,
    `noorlifeapp://elsewhere.example.com/auth/callback?code=${CODE}`,
  ];

  it('never carries the URL it was given', () => {
    for (const url of hostile) {
      const serialized = JSON.stringify(parseAuthCallback(url));
      expect(serialized).not.toContain('noorlifeapp://');
      expect(serialized).not.toContain('auth/callback');
    }
  });

  it('never carries a token or a description', () => {
    for (const url of hostile) {
      const serialized = JSON.stringify(parseAuthCallback(url));
      expect(serialized).not.toContain('super-secret-token');
      expect(serialized).not.toContain('secret sentence');
      expect(serialized).not.toContain('access_token');
    }
  });

  it('exposes the code only on the answer the service consumes', () => {
    // A `callback` answer holds the code because the exchange needs it. Nothing else does, and no
    // outcome type carries it onward.
    expect(JSON.stringify(parseAuthCallback(`${AUTH_CALLBACK_URL}?code=${CODE}`))).toContain(CODE);
    for (const url of hostile.slice(2)) {
      expect(JSON.stringify(parseAuthCallback(url))).not.toContain(CODE);
    }
  });

  it('logs nothing, for any input', () => {
    const spies = (['log', 'warn', 'error', 'info', 'debug'] as const).map((level) =>
      jest.spyOn(console, level).mockImplementation(() => undefined),
    );

    for (const url of [...hostile, 'noorlifeapp://faith/quran', '', null, 'a'.repeat(9000)]) {
      parseAuthCallback(url);
    }

    for (const spy of spies) {
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    }
  });
});

describe('bounds', () => {
  it('refuses an absurdly long URL before parsing it', () => {
    expect(parseAuthCallback(`${AUTH_CALLBACK_URL}?code=${'a'.repeat(5000)}`)).toEqual({
      kind: 'rejected',
      code: 'invalid-link',
    });
  });

  it('survives a malformed percent escape without throwing', () => {
    // `decodeURIComponent` throws on this. An exception out of a URL parser tends to be caught
    // somewhere that then logs the URL.
    expect(() => parseAuthCallback(`${AUTH_CALLBACK_URL}?code=%E0%A4%A`)).not.toThrow();
    expect(parseAuthCallback(`${AUTH_CALLBACK_URL}?code=%E0%A4%A`).kind).toBe('rejected');
  });
});
