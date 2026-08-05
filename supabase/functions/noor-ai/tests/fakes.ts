import type {
  AIProvider,
  AuthOutcome,
  ClaimsVerifier,
  Clock,
  HandlerConfig,
  Logger,
  NoorAIDependencies,
  OperationalLogRecord,
  ProviderOutcome,
  ProviderRequest,
  RateLimitDecision,
  RateLimiter,
  RequestIdSource,
  Timer,
  VerifiedClaims,
} from '../ports.ts';

/**
 * Every fake in the AI-2 suite, and the only file allowed to contain one.
 *
 * ── Why the fakes live here and nowhere else ─────────────────────────────────
 * `docs/NOOR_AI_BACKEND_CONTRACT.md` §J's AI-2 tier "runs against an injected fake provider with no
 * network and no key, so all of these are testable before a key exists". The corresponding hazard is a
 * fake that survives into the production module graph, where it becomes a canned AI answer served to a
 * real user. So the rule is structural: fakes are constructed only inside `tests/`, nothing outside
 * `tests/` imports this file, and `source-scan_test.ts` asserts both.
 *
 * ── Determinism, and specifically no sleeping ────────────────────────────────
 * The clock, the timer and the request-id source are all fakes, so nothing in this suite waits on wall
 * clock. `createFakeTimer` fires short delays synchronously and records every delay it was asked for,
 * which is what turns "the retry honoured `Retry-After`" into an assertion about a number rather than an
 * observation about elapsed time.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Clock, timer, request ids
// ─────────────────────────────────────────────────────────────────────────────

export type FakeClock = Clock & {
  readonly advance: (ms: number) => void;
  readonly set: (ms: number) => void;
};

export function createFakeClock(startMs = 1_800_000_000_000): FakeClock {
  let current = startMs;
  return {
    now: () => current,
    advance: (ms) => {
      current += ms;
    },
    set: (ms) => {
      current = ms;
    },
  };
}

export type FakeTimer = Timer & {
  /** Every delay the handler asked for, in order. The retry assertions read this. */
  readonly scheduled: readonly number[];
  /** Fires every callback still pending, oldest first. */
  readonly fireAll: () => void;
  readonly pendingCount: () => number;
};

/**
 * A timer that fires short delays synchronously and leaves long ones pending.
 *
 * The split is what keeps the suite both deterministic and free of hangs. A retry delay — hundreds of
 * milliseconds, or whatever `Retry-After` asked for — is something the handler is *supposed* to wait out,
 * so it resolves immediately and the test asserts the recorded value instead of the elapsed time. An
 * upstream timeout — tens of seconds — is something the handler is supposed to be interrupted by, so it
 * stays pending until a test (or a fake provider mid-call) fires it deliberately.
 *
 * Firing synchronously rather than on a microtask matters: the handler awaits a promise the timer
 * resolves, and a callback deferred to a later turn would make the test's ordering depend on how many
 * `await`s happen to sit between the schedule and the resume.
 */
export function createFakeTimer(fireDelaysUnderMs = 10_000): FakeTimer {
  const scheduled: number[] = [];
  let pending: { readonly onFire: () => void }[] = [];

  return {
    scheduled,
    schedule: (delayMs, onFire) => {
      scheduled.push(delayMs);
      if (delayMs < fireDelaysUnderMs) {
        onFire();
        return () => {};
      }
      const entry = { onFire };
      pending.push(entry);
      return () => {
        pending = pending.filter((candidate) => candidate !== entry);
      };
    },
    fireAll: () => {
      const due = pending;
      pending = [];
      for (const entry of due) {
        entry.onFire();
      }
    },
    pendingCount: () => pending.length,
  };
}

/**
 * Deterministic, uuid-shaped ids.
 *
 * Uuid-shaped rather than `id-1`, because §I.7 fixes the format as `noorai_req_<uuid v4>` and a test that
 * accepted `noorai_req_id-1` would not be checking the format at all. The version and variant nibbles are
 * a real v4's.
 */
export function createFakeRequestIds(): RequestIdSource {
  let counter = 0;
  return {
    nextUuid: () => {
      counter += 1;
      const tail = String(counter).padStart(12, '0');
      return `00000000-0000-4000-8000-${tail}`;
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Logger
// ─────────────────────────────────────────────────────────────────────────────

export type CapturingLogger = Logger & {
  readonly records: readonly OperationalLogRecord[];
  /** Every record serialised, for the §J.15a/15b scans that search the whole log surface. */
  readonly text: () => string;
};

export function createCapturingLogger(): CapturingLogger {
  const records: OperationalLogRecord[] = [];
  return {
    records,
    record: (entry) => {
      records.push(entry);
    },
    text: () => records.map((entry) => JSON.stringify(entry)).join('\n'),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Verifier
// ─────────────────────────────────────────────────────────────────────────────

export const TEST_USER_ID = '11111111-1111-4111-8111-111111111111';
export const TEST_SESSION_ID = '22222222-2222-4222-8222-222222222222';

export const TEST_CLAIMS: VerifiedClaims = {
  userId: TEST_USER_ID,
  sessionId: TEST_SESSION_ID,
  role: 'authenticated',
};

export type RecordingVerifier = ClaimsVerifier & {
  /** The header values the handler passed in, so a test can prove the handler forwarded nothing else. */
  readonly seen: readonly (string | null)[];
};

export function createFakeVerifier(
  outcome: AuthOutcome = { ok: true, claims: TEST_CLAIMS },
): RecordingVerifier {
  const seen: (string | null)[] = [];
  return {
    seen,
    verify: (header) => {
      seen.push(header);
      return Promise.resolve(outcome);
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Rate limiter
// ─────────────────────────────────────────────────────────────────────────────

export type RecordingRateLimiter = RateLimiter & {
  readonly subjects: readonly string[];
};

/**
 * A limiter that answers from a script.
 *
 * §I.1 requires the subject of the limit to be "the **verified** user id from §D, never a client-supplied
 * id, and never IP alone", so the fake records what it was asked about and the test asserts on it.
 *
 * This fake is emphatically **not** an in-memory rate limiter. §12.7 and §I.1 are explicit that an
 * in-memory counter in an ephemeral isolate is not a rate limit, and §J.13b — the test that catches that
 * mistake — is an **AI-3** row needing simulated isolates. What AI-2 owns and this fake exercises is the
 * handler's behaviour *given* a decision: the `429`, the body's `retry_after_seconds`, the `Retry-After`
 * header, and no provider call on a rejected request.
 */
export function createFakeRateLimiter(
  ...decisions: readonly RateLimitDecision[]
): RecordingRateLimiter {
  const subjects: string[] = [];
  const queue = [...decisions];
  return {
    subjects,
    check: (userId) => {
      subjects.push(userId);
      return Promise.resolve(
        queue.length > 1
          ? (queue.shift() ?? { kind: 'allowed' })
          : (queue[0] ?? { kind: 'allowed' }),
      );
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Provider
// ─────────────────────────────────────────────────────────────────────────────

export type RecordingProvider = AIProvider & {
  /** Every request the handler constructed. §J.15d asserts the allow-list against these. */
  readonly calls: readonly ProviderRequest[];
  /** Whether each call's signal was aborted — the §J.12 assertion that the operation really stopped. */
  readonly aborted: readonly boolean[];
};

/**
 * A provider that returns scripted outcomes and records what it was handed.
 *
 * The last scripted outcome repeats, so a single-outcome script covers the common case and a two-outcome
 * script expresses "fails, then succeeds" for the retry rows without the test having to count calls.
 */
export function createFakeProvider(...outcomes: readonly ProviderOutcome[]): RecordingProvider {
  const calls: ProviderRequest[] = [];
  const aborted: boolean[] = [];
  let index = 0;
  return {
    calls,
    aborted,
    generate: (request, signal) => {
      calls.push(request);
      aborted.push(signal.aborted);
      const outcome = outcomes[Math.min(index, outcomes.length - 1)] ?? { kind: 'unavailable' };
      index += 1;
      return Promise.resolve(outcome);
    },
  };
}

/**
 * A provider that is still working when the upstream budget elapses (§J.12).
 *
 * It fires the pending upstream-timeout timer from *inside* the call, which is the only faithful way to
 * simulate "the budget ran out while we were waiting" — and then it resolves with a perfectly good answer.
 * That second detail is the point of the test: §F.7 requires the handler to report `504` rather than a
 * partial or late answer, so a provider whose answer arrives after the abort must not be able to get it
 * past the handler.
 */
export function createTimingOutProvider(timer: FakeTimer): RecordingProvider & {
  readonly abortObserved: () => boolean;
} {
  const calls: ProviderRequest[] = [];
  const aborted: boolean[] = [];
  let observed = false;
  return {
    calls,
    aborted,
    abortObserved: () => observed,
    generate: (request, signal) =>
      new Promise<ProviderOutcome>((resolve) => {
        calls.push(request);
        aborted.push(signal.aborted);
        signal.addEventListener('abort', () => {
          observed = true;
          resolve({
            kind: 'answer',
            answer: {
              text: 'A late answer that must never be returned.',
              finish: 'complete',
              category: null,
              citationRequired: false,
            },
          });
        });
        // The upstream wall clock elapses while the provider is mid-flight.
        timer.fireAll();
      }),
  };
}

/** A provider that throws, standing in for a connection reset (§F.8's retryable transport failure). */
export function createThrowingProvider(): RecordingProvider {
  const calls: ProviderRequest[] = [];
  const aborted: boolean[] = [];
  return {
    calls,
    aborted,
    generate: (request, signal) => {
      calls.push(request);
      aborted.push(signal.aborted);
      return Promise.reject(new Error('socket hang up'));
    },
  };
}

/** The provider that must never be reached. Used wherever §J requires "no provider call made". */
export function createForbiddenProvider(): RecordingProvider {
  const calls: ProviderRequest[] = [];
  const aborted: boolean[] = [];
  return {
    calls,
    aborted,
    generate: (request, signal) => {
      calls.push(request);
      aborted.push(signal.aborted);
      throw new Error('the provider was called on a path that must never reach it');
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Handler assembly
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The test handler configuration.
 *
 * `upstreamTimeoutMs` is far above `createFakeTimer`'s synchronous threshold so the timeout timer stays
 * pending until a test fires it, and `retryBackoffMs` is far below it so a retry delay resolves at once.
 * `handlerBudgetMs` is strictly greater than the upstream budget, as §F.7 requires.
 */
export function testConfig(overrides: Partial<HandlerConfig> = {}): HandlerConfig {
  return {
    enabled: true,
    maxOutputTokens: 256,
    upstreamTimeoutMs: 30_000,
    handlerBudgetMs: 40_000,
    retryBackoffMs: 250,
    ...overrides,
  };
}

export type TestHarness = {
  readonly deps: NoorAIDependencies;
  readonly verifier: RecordingVerifier;
  readonly provider: RecordingProvider;
  readonly rateLimiter: RecordingRateLimiter;
  readonly clock: FakeClock;
  readonly timer: FakeTimer;
  readonly logger: CapturingLogger;
};

export function createHarness(
  options: {
    readonly auth?: AuthOutcome;
    readonly provider?: RecordingProvider;
    readonly limit?: RateLimitDecision;
    readonly config?: Partial<HandlerConfig>;
    readonly timer?: FakeTimer;
  } = {},
): TestHarness {
  const timer = options.timer ?? createFakeTimer();
  const verifier = createFakeVerifier(options.auth);
  const provider = options.provider ?? createFakeProvider(helpAnswer());
  const rateLimiter = createFakeRateLimiter(options.limit ?? { kind: 'allowed' });
  const clock = createFakeClock();
  const logger = createCapturingLogger();

  return {
    verifier,
    provider,
    rateLimiter,
    clock,
    timer,
    logger,
    deps: {
      verifier,
      provider,
      rateLimiter,
      clock,
      timer,
      requestIds: createFakeRequestIds(),
      logger,
      config: testConfig(options.config),
    },
  };
}

/** §J.17's bounded help answer — the one success case the AI-2 tier can produce. */
export function helpAnswer(
  text = 'Open Faith, then Prayer Settings, then Reminders.',
): ProviderOutcome {
  return {
    kind: 'answer',
    answer: { text, finish: 'complete', category: null, citationRequired: false },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Requests
// ─────────────────────────────────────────────────────────────────────────────

export const VALID_BEARER = 'Bearer header.payload.signature';

/** The endpoint as the deployed platform presents it (§C.1). */
export const ENDPOINT = 'https://project.functions.supabase.co/functions/v1/noor-ai';

export function jsonRequest(
  body: unknown,
  options: {
    readonly method?: string;
    readonly authorization?: string | null;
    readonly contentType?: string | null;
    readonly url?: string;
    readonly rawBody?: string;
  } = {},
): Request {
  const headers = new Headers();
  const contentType = options.contentType === undefined ? 'application/json' : options.contentType;
  if (contentType !== null) {
    headers.set('content-type', contentType);
  }
  const authorization = options.authorization === undefined ? VALID_BEARER : options.authorization;
  if (authorization !== null) {
    headers.set('authorization', authorization);
  }
  const method = options.method ?? 'POST';
  const payload = options.rawBody ?? JSON.stringify(body);
  return new Request(options.url ?? ENDPOINT, {
    method,
    headers,
    body: method === 'GET' || method === 'HEAD' || method === 'OPTIONS' ? null : payload,
  });
}

/** The minimal valid body of §C.2. */
export function validBody(
  message = 'Where do I change my prayer reminder sound?',
): Record<string, unknown> {
  return { contract_version: 1, message };
}

// ─────────────────────────────────────────────────────────────────────────────
// Network guard
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Replaces `fetch` with a tripwire for the duration of a test.
 *
 * The suite also runs without Deno's `--allow-net` permission, so an outbound request would fail at the
 * runtime boundary anyway. This is the second layer, and it exists because a permission error is a
 * *crash* while this is an *assertion*: `calls` being empty is a statement the test makes on purpose,
 * which is what §J's "no provider call made" rows require.
 */
export function withNetworkTripwire(): {
  readonly calls: readonly string[];
  readonly restore: () => void;
} {
  const calls: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = ((input: URL | RequestInfo) => {
    calls.push(String(input));
    throw new Error('the network was called');
  }) as typeof fetch;
  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Real key material, generated in-process
// ─────────────────────────────────────────────────────────────────────────────

function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export type SigningFixture = {
  /** A `SUPABASE_JWKS`-shaped key set holding only the public key. */
  readonly jwks: string;
  readonly sign: (
    claims: Record<string, unknown>,
    header?: Record<string, unknown>,
  ) => Promise<string>;
  readonly kid: string;
};

/**
 * Generates a real ES256 key pair and a signer for it.
 *
 * ── Why the verifier is tested against real cryptography ─────────────────────
 * §D.2's whole point is that "Decoding it proves nothing" — an attacker "writes
 * `{"sub": "<any uuid>", "role": "authenticated", "exp": <far future>}`, base64url-encodes it, appends any
 * signature", and a server that decodes rather than verifies has handed over whatever identity was asked
 * for. A test that injected a fake verifier could never catch a handler that did exactly that.
 *
 * So the verifier tests generate a key pair in-process, sign genuine tokens with it, and check that a
 * token signed by a *different* key is refused. No key is provisioned, stored, printed or committed: the
 * pair exists for the lifetime of one test process and the private half never leaves it. This is also why
 * ES256 is used — it is one of the two algorithms Supabase Auth issues that the verifier accepts, and
 * WebCrypto generates a P-256 pair in about a millisecond.
 */
export async function createSigningFixture(kid = 'test-key-1'): Promise<SigningFixture> {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ]);
  const publicJwk = await crypto.subtle.exportKey('jwk', pair.publicKey);

  return {
    kid,
    jwks: JSON.stringify({ keys: [{ ...publicJwk, kid, alg: 'ES256', use: 'sig' }] }),
    sign: async (claims, header = {}) => {
      const encodedHeader = base64Url(
        new TextEncoder().encode(JSON.stringify({ alg: 'ES256', typ: 'JWT', kid, ...header })),
      );
      const encodedPayload = base64Url(new TextEncoder().encode(JSON.stringify(claims)));
      const signature = await crypto.subtle.sign(
        { name: 'ECDSA', hash: 'SHA-256' },
        pair.privateKey,
        new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`),
      );
      return `${encodedHeader}.${encodedPayload}.${base64Url(new Uint8Array(signature))}`;
    },
  };
}

/** A claim set that satisfies every §D.4 row, so a test can break exactly one thing at a time. */
export function validClaimSet(
  nowSeconds: number,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    iss: 'https://project.supabase.co/auth/v1',
    aud: 'authenticated',
    role: 'authenticated',
    sub: TEST_USER_ID,
    session_id: TEST_SESSION_ID,
    iat: nowSeconds - 10,
    exp: nowSeconds + 3600,
    ...overrides,
  };
}
