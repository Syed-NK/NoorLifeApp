import type {
  NoorAIAnswer,
  NoorAIAskOptions,
  NoorAIFailureState,
  NoorAIPort,
  NoorAIRefusalKind,
  NoorAIResult,
} from '@services/ai/noor-ai.contract';
import type { AIRequestContext } from '@shared/permissions/ai-scope';

/**
 * The Noor AI states a real request cannot produce, as data.
 *
 * ── Why these live here and not behind a development route ──────────────────
 * Phase 6C-3A reached its account-security states through a fixture *screen* guarded by
 * `if (!__DEV__)`. The guard stopped it rendering and did not stop Metro compiling it, so the
 * harness shipped in the release bundle — disproved by a grep of the bundle, and recorded in
 * `privacy-security-source-scan.test.ts`. The lesson was applied once and is applied again here:
 * there is **no fixture screen, no fixture route and no debug menu** for Noor AI.
 *
 * `src/test-support/` is outside `src/app`, so Expo Router cannot route to it, and outside
 * `src/features`, so no production module can import it without failing the source scan that
 * already forbids the string `test-support` anywhere under `app` or `features`. Jest imports these
 * directly, which is the only consumer they ever needed — and asserting a state on every run is
 * strictly better than a screen somebody has to remember to open.
 *
 * ── Nothing here reaches anything ───────────────────────────────────────────
 * Every port below resolves in memory. There is no Supabase client, no `fetch`, no Edge Function,
 * no provider, no timer and no credential. The answer text is NoorLife's own placeholder prose
 * about NoorLife, so a fixture cannot be mistaken for a real model response and nothing quotable is
 * attributed to a source.
 *
 * ── Why these are *narrower* than a mock adapter ────────────────────────────
 * They implement `NoorAIPort` and nothing else: one method, returning one of the three outcomes the
 * contract allows. There is no way to express a status code, a request id or a provider payload
 * through this seam, because `NoorAIResult` cannot carry one — so a test that "renders a raw error"
 * is not a test somebody could write carelessly. That is the point of testing against the port
 * rather than against a fake HTTP layer.
 */

/** What a fixture recorded about a call. Assertable, and deliberately not the request body. */
export type NoorAIFixtureCall = {
  readonly prompt: string;
  readonly context: AIRequestContext;
  readonly options: NoorAIAskOptions | undefined;
};

export type NoorAIFixturePort = NoorAIPort & {
  /** Every call in order. `calls.length` is the invocation count a double-submit test asserts. */
  readonly calls: readonly NoorAIFixtureCall[];
};

/** NoorLife-authored placeholder prose. Not a model output, and not attributed to any source. */
export const FIXTURE_ANSWER_TEXT =
  'You can change your language in Settings, under Language. NoorLife applies the change straight away, and you can switch back at any time.';

/**
 * A long answer, for the layout cases: wrapping, growth and keyboard overlap.
 *
 * Built by repetition rather than pasted, so its length is obvious and adjustable and so it cannot
 * accidentally contain something that reads like a citation.
 */
export const FIXTURE_LONG_ANSWER_TEXT = Array.from(
  { length: 12 },
  (_unused, index) =>
    `Paragraph ${String(index + 1)}: NoorLife groups its features into modules, and each module owns its own screens, its own settings and its own reminders. You can reach any of them from the Modules tab.`,
).join('\n\n');

export const FIXTURE_ANSWER: NoorAIAnswer = {
  text: FIXTURE_ANSWER_TEXT,
  finish: 'complete',
  sources: [],
};

/**
 * A port built from one fixed outcome.
 *
 * `Promise.resolve` rather than a timer: a test that needed a clock to observe a loading state
 * would be a flaky test, and `pendingNoorAIPort` below reaches the same state with a promise the
 * test itself resolves.
 */
export function inertNoorAIPort(result: NoorAIResult): NoorAIFixturePort {
  const calls: NoorAIFixtureCall[] = [];
  return {
    calls,
    ask: (prompt, context, options) => {
      calls.push({ prompt, context, options });
      return Promise.resolve(result);
    },
  };
}

/** An ordinary answer. */
export const answerNoorAIPort = (): NoorAIFixturePort =>
  inertNoorAIPort({ outcome: 'answer', answer: FIXTURE_ANSWER });

/** §C.4's `length` finish reason — the model hit the output ceiling. */
export const truncatedAnswerNoorAIPort = (): NoorAIFixturePort =>
  inertNoorAIPort({
    outcome: 'answer',
    answer: { text: FIXTURE_ANSWER_TEXT, finish: 'length', sources: [] },
  });

/** A long answer, for wrapping and layout. */
export const longAnswerNoorAIPort = (): NoorAIFixturePort =>
  inertNoorAIPort({
    outcome: 'answer',
    answer: { text: FIXTURE_LONG_ANSWER_TEXT, finish: 'complete', sources: [] },
  });

/**
 * A policy refusal.
 *
 * `explanation` carries a deliberately recognisable marker. The screen keys its copy off `kind`
 * alone and renders no server-supplied string, and this is what lets a test prove that by looking
 * for text that would only appear if the rule were broken.
 */
export const FIXTURE_REFUSAL_MARKER = 'FIXTURE-SERVER-EXPLANATION-SHOULD-NOT-RENDER';

export const refusedNoorAIPort = (kind: NoorAIRefusalKind): NoorAIFixturePort =>
  inertNoorAIPort({
    outcome: 'refused',
    refusal: { kind, explanation: FIXTURE_REFUSAL_MARKER },
  });

/** Any of the ten failure states, including the disabled-function `temporarily-unavailable`. */
export const failedNoorAIPort = (failure: NoorAIFailureState): NoorAIFixturePort =>
  inertNoorAIPort({ outcome: 'failed', failure });

export type PendingNoorAIPort = NoorAIFixturePort & {
  /** Resolves the outstanding call with a chosen outcome. */
  readonly settle: (result: NoorAIResult) => void;
};

/**
 * A port that stays in flight until the test resolves it.
 *
 * This is how the loading state, the double-submit guard and the unmount case are exercised without
 * a timer anywhere: the promise is held open by the test, not by a clock, so nothing depends on
 * ordering, elapsed time or `jest.advanceTimersByTime`.
 */
export function pendingNoorAIPort(): PendingNoorAIPort {
  const calls: NoorAIFixtureCall[] = [];
  let resolve: ((result: NoorAIResult) => void) | null = null;

  return {
    calls,
    ask: (prompt, context, options) => {
      calls.push({ prompt, context, options });
      return new Promise<NoorAIResult>((settle) => {
        resolve = settle;
      });
    },
    settle: (result) => {
      resolve?.(result);
    },
  };
}

/**
 * A port that honours the caller's `AbortSignal`, the way the real adapter does.
 *
 * The adapter answers `cancelled` when the caller's own signal is the one that fired, and
 * `timed-out` when it was the client deadline instead — see `classifyThrown`. This reproduces the
 * first half, which is the half a screen can trigger, and it resolves rather than rejecting so the
 * fixture cannot teach the screen to expect an exception the real port never throws.
 */
export function cancellableNoorAIPort(
  settled: NoorAIResult = { outcome: 'answer', answer: FIXTURE_ANSWER },
): NoorAIFixturePort {
  const calls: NoorAIFixtureCall[] = [];
  return {
    calls,
    ask: (prompt, context, options) => {
      calls.push({ prompt, context, options });
      return new Promise<NoorAIResult>((resolve) => {
        const signal = options?.signal;
        if (signal === undefined) {
          resolve(settled);
          return;
        }
        if (signal.aborted) {
          resolve({ outcome: 'failed', failure: 'cancelled' });
          return;
        }
        signal.addEventListener('abort', () =>
          resolve({ outcome: 'failed', failure: 'cancelled' }),
        );
      });
    },
  };
}

/**
 * A port that rejects.
 *
 * The production adapter never throws — `noor-ai-adapter-guards.test.ts` asserts the source
 * contains no `throw` — so this exists only to prove the screen cannot be left pending forever by a
 * badly behaved implementation of the interface, and that the thrown value never reaches the
 * screen.
 */
export const THROWN_FIXTURE_MESSAGE = 'FIXTURE-THROWN-DETAIL-SHOULD-NOT-RENDER';

export function throwingNoorAIPort(): NoorAIFixturePort {
  const calls: NoorAIFixtureCall[] = [];
  return {
    calls,
    ask: (prompt, context, options) => {
      calls.push({ prompt, context, options });
      return Promise.reject(new Error(THROWN_FIXTURE_MESSAGE));
    },
  };
}

/** Every failure state, so a test can drive the whole union rather than a chosen subset. */
export const ALL_NOOR_AI_FAILURE_STATES: readonly NoorAIFailureState[] = [
  'authentication-required',
  'invalid-request',
  'temporarily-limited',
  'temporarily-unavailable',
  'network-unavailable',
  'timed-out',
  'cancelled',
  'invalid-server-response',
  'not-configured',
  'unknown',
];

/** Every refusal kind, for the same reason. */
export const ALL_NOOR_AI_REFUSAL_KINDS: readonly NoorAIRefusalKind[] = [
  'out-of-scope',
  'safety-boundary',
  'permission-required',
];
