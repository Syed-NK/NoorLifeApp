import type {
  AuthOutcome,
  ClaimsVerifier,
  Clock,
  HandlerConfig,
  Logger,
  OperationalLogRecord,
  QuranContentDependencies,
  QuranQuery,
  QuranUpstream,
  RequestIdSource,
  Timer,
  UpstreamResult,
} from '../ports.ts';

/**
 * Deterministic fakes, and the rule about where they may live.
 *
 * **Nothing outside `tests/` may import this file, and no fake may exist outside it.**
 * `source-scan_test.ts` asserts both halves. The reason is sharper here than in an ordinary service:
 * a fake upstream in the production graph would be a source of *scripture* one misconfigured
 * deployment away from a user reading invented text and believing it.
 *
 * Every fake below records what it was asked, because most of this suite's claims are about things
 * that must **not** happen — no second request, no token exchange, no outbound call at all — and the
 * only way to assert an absence is to hold the only reference to the thing that would have done it.
 */

export function fakeClock(start = 1_000_000): Clock & { advance: (ms: number) => void } {
  let now = start;
  return {
    now: () => now,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

/**
 * A timer that never fires on its own.
 *
 * A test that proved the upstream budget by sleeping would be slow and flaky at the same time, so
 * `fire()` is called explicitly. `scheduled` records the delay so a test can assert the handler asked
 * for the budget it claims to enforce.
 */
export function fakeTimer(): Timer & {
  readonly scheduled: number[];
  readonly fire: () => void;
  readonly cancelled: () => number;
} {
  const scheduled: number[] = [];
  const pending: (() => void)[] = [];
  let cancelled = 0;
  return {
    scheduled,
    schedule: (delayMs, onFire) => {
      scheduled.push(delayMs);
      pending.push(onFire);
      return () => {
        cancelled += 1;
      };
    },
    fire: () => {
      for (const onFire of pending.splice(0)) {
        onFire();
      }
    },
    cancelled: () => cancelled,
  };
}

/** Sequential, so a test can assert the id format without matching a random uuid. */
export function fakeRequestIds(): RequestIdSource {
  let index = 0;
  return {
    nextUuid: () => {
      index += 1;
      return `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
    },
  };
}

export function recordingLogger(): Logger & { readonly entries: OperationalLogRecord[] } {
  const entries: OperationalLogRecord[] = [];
  return { entries, record: (entry) => entries.push(entry) };
}

const VALID_CLAIMS = {
  userId: '11111111-1111-4111-8111-111111111111',
  sessionId: '22222222-2222-4222-8222-222222222222',
  role: 'authenticated',
} as const;

/**
 * A verifier that accepts, and records the header it was handed.
 *
 * The header is recorded rather than the token, and the two tests that look at it check that it was
 * *asked for* and that the body was not read first — never what it contained.
 */
export function acceptingVerifier(): ClaimsVerifier & { readonly seen: (string | null)[] } {
  const seen: (string | null)[] = [];
  return {
    seen,
    // deno-lint-ignore require-await
    verify: async (header) => {
      seen.push(header);
      return { ok: true, claims: VALID_CLAIMS } satisfies AuthOutcome;
    },
  };
}

export function refusingVerifier(
  reason: Extract<AuthOutcome, { ok: false }>['reason'],
): ClaimsVerifier {
  return {
    // deno-lint-ignore require-await
    verify: async () => ({ ok: false, reason }),
  };
}

/**
 * An upstream that answers from a script and records every query it was given.
 *
 * `queries` is what proves the allow-list: a test drives a rejected request and asserts the array is
 * empty, which is a statement that no vendor request could have been made rather than a statement
 * that one was made and discarded.
 */
export function scriptedUpstream(
  ...results: readonly UpstreamResult[]
): QuranUpstream & { readonly queries: QuranQuery[]; readonly signals: AbortSignal[] } {
  const queries: QuranQuery[] = [];
  const signals: AbortSignal[] = [];
  let index = 0;
  return {
    queries,
    signals,
    // deno-lint-ignore require-await
    read: async (query, signal) => {
      queries.push(query);
      signals.push(signal);
      const result = results[Math.min(index, results.length - 1)];
      index += 1;
      return result ?? { kind: 'transient', attempts: 1, tokenRenewed: false };
    },
  };
}

/** An upstream that never resolves, for the timeout path. Records the signal so abort is observable. */
export function hangingUpstream(): QuranUpstream & { readonly signals: AbortSignal[] } {
  const signals: AbortSignal[] = [];
  return {
    signals,
    read: (_query, signal) =>
      new Promise((resolve) => {
        signals.push(signal);
        signal.addEventListener('abort', () => {
          // Resolves *after* the abort with a transient outcome, so the test proves the handler
          // reports `timeout` from its own budget rather than from whatever the client said.
          resolve({ kind: 'transient', attempts: 1, tokenRenewed: false });
        });
      }),
  };
}

export const testConfig: HandlerConfig = {
  upstreamTimeoutMs: 5_000,
  handlerBudgetMs: 8_000,
};

export function dependencies(
  overrides: Partial<QuranContentDependencies> = {},
): QuranContentDependencies {
  return {
    verifier: acceptingVerifier(),
    upstream: scriptedUpstream({
      kind: 'ok',
      body: { chapters: [] },
      attempts: 1,
      tokenRenewed: false,
    }),
    clock: fakeClock(),
    timer: fakeTimer(),
    requestIds: fakeRequestIds(),
    logger: recordingLogger(),
    config: testConfig,
    ...overrides,
  };
}

/** Builds a `POST` at the function root with a JSON body, the shape every ordinary call takes. */
export function jsonRequest(body: unknown, init: RequestInit = {}): Request {
  return new Request('https://project.functions.supabase.co/functions/v1/quran-content', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer test.token.value' },
    body: JSON.stringify(body),
    ...init,
  });
}

/**
 * A `fetch` that must never be called.
 *
 * Handed to code that is expected to make no outbound request, so "nothing left the process" is a
 * thrown assertion at the moment of the call rather than a count checked afterwards.
 */
export function forbiddenFetch(): typeof fetch {
  return () => {
    throw new Error('an outbound request was made when none was permitted');
  };
}

export type RecordedCall = {
  readonly url: string;
  readonly method: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string | null;
  readonly redirect: RequestRedirect | undefined;
};

/**
 * A `fetch` that records every call and answers from a handler.
 *
 * Headers are captured as a plain lowercase map so a test can assert what was sent — and, more often,
 * assert what was **not**: no `Authorization` on the content hop, no client secret outside the token
 * exchange, no caller token forwarded anywhere.
 */
export function recordingFetch(
  respond: (call: RecordedCall, index: number) => Response | Promise<Response>,
): typeof fetch & { readonly calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const impl = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(init?.headers ?? {})) {
      headers[key.toLowerCase()] = String(value);
    }
    const call: RecordedCall = {
      url: String(input),
      method: init?.method ?? 'GET',
      headers,
      body: typeof init?.body === 'string' ? init.body : null,
      redirect: init?.redirect,
    };
    calls.push(call);
    return await respond(call, calls.length - 1);
  };
  return Object.assign(impl as unknown as typeof fetch, { calls });
}

/** A `200 application/json` response, the shape both hops answer with when things go well. */
export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/**
 * A synthetic token value.
 *
 * Built arithmetically rather than committed as a literal, for the reason the repository's secret
 * scans exist: a 40-character opaque string in a test file is indistinguishable at a glance from a
 * real credential, and the suite must contain nothing anybody has to check.
 */
export function syntheticToken(marker: string): string {
  return `synthetic-access-token-${marker}-${'x'.repeat(12)}`;
}
