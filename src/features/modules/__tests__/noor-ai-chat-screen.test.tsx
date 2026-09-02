import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';

import { AppProviders } from '@application/providers/app-providers';
import { installMockLatencyTimers } from '@/test-support/mock-latency-timers';
import {
  ALL_NOOR_AI_FAILURE_STATES,
  ALL_NOOR_AI_REFUSAL_KINDS,
  answerNoorAIPort,
  cancellableNoorAIPort,
  failedNoorAIPort,
  FIXTURE_ANSWER_TEXT,
  FIXTURE_LONG_ANSWER_TEXT,
  FIXTURE_REFUSAL_MARKER,
  inertNoorAIPort,
  longAnswerNoorAIPort,
  pendingNoorAIPort,
  refusedNoorAIPort,
  THROWN_FIXTURE_MESSAGE,
  throwingNoorAIPort,
  truncatedAnswerNoorAIPort,
  type NoorAIFixturePort,
} from '@/test-support/noor-ai-fixtures';
import type { NoorAIResult } from '@services/ai/noor-ai.contract';

import { mockRouter } from '../../../../jest.setup';
import { noorAIChatCopy } from '../noor-ai/noor-ai-chat-copy';
import { NOOR_AI_CHAT_PATH } from '../noor-ai/noor-ai-chat-routes';
import { NoorAIChatScreen } from '../noor-ai/noor-ai-chat-screen';
import { NoorAIFeedbackScreen } from '../noor-ai/noor-ai-feedback-screen';
import { ModuleHomeScreen } from '../screens/module-home-screen';

installMockLatencyTimers(() => renderChat(answerNoorAIPort()));

/**
 * The Noor AI conversation surface, driven entirely by injected fixtures.
 *
 * ── What this suite is for ──────────────────────────────────────────────────
 * Every state below is one a real request cannot be made to produce on demand: a quota refusal, a
 * provider outage, an expired session, a malformed response, a policy refusal. The hosted Edge
 * Function is source-disabled and no provider request is authorised, so the alternative to
 * injecting them is shipping a screen nobody has seen in nine of its thirteen states.
 *
 * **Nothing here touches a network, a client, a session or a provider.** Every port resolves in
 * memory, `fetch` is replaced by a spy asserted never to have been called, and the two persistence
 * boundaries this application has are asserted untouched.
 */

const INPUT = 'noor-ai-chat-composer-input';
const SEND = 'noor-ai-chat-composer-send';

/**
 * Invisible input, built from code points rather than typed.
 *
 * A space, a zero-width space, a right-to-left override and a byte-order mark. Written this way so
 * a reviewer can see exactly what the test sends — pasted into the source they would be four
 * characters nobody could tell apart from one.
 */
const INVISIBLE_ONLY = [0x20, 0x200b, 0x202e, 0xfeff, 0x20]
  .map((code) => String.fromCodePoint(code))
  .join('');

/** A question carrying a C0 control that is not tab, newline or carriage return (§C.3.7). */
const WITH_CONTROL = `where is${String.fromCodePoint(0x07)}settings`;

async function renderChat(port: NoorAIFixturePort) {
  const view = await render(
    <AppProviders>
      <NoorAIChatScreen port={port} />
    </AppProviders>,
  );
  await waitFor(() => expect(screen.getByTestId(INPUT)).toBeTruthy());
  return view;
}

async function ask(question = 'Where do I change my language?') {
  await fireEvent.changeText(screen.getByTestId(INPUT), question);
  await fireEvent.press(screen.getByTestId(SEND));
}

/**
 * A "contains this sentence" matcher.
 *
 * The status banner draws a tone glyph from the icon font, and that glyph is part of the node's
 * text content. Asserting a substring rather than the whole string keeps these assertions about
 * the copy rather than about the icon set.
 */
function containing(value: string): RegExp {
  return new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
}

/** The whole of the network surface a React Native screen could reach. */
let fetchSpy: jest.Mock;
const realFetch = globalThis.fetch;

beforeEach(() => {
  fetchSpy = jest.fn(() => Promise.reject(new Error('no network in this suite')));
  (globalThis as { fetch: unknown }).fetch = fetchSpy;
});

afterEach(() => {
  const calls = fetchSpy.mock.calls.length;
  (globalThis as { fetch: unknown }).fetch = realFetch;
  expect(calls).toBe(0);
});

describe('the approved entry point', () => {
  it('opens the conversation screen from the Noor AI home composer', async () => {
    await render(<ModuleHomeScreen moduleId="noor-ai" />);

    await fireEvent.press(screen.getByTestId('noor-ai-ask-field'));

    expect(mockRouter.push).toHaveBeenCalledWith(NOOR_AI_CHAT_PATH);
  });

  it('opens the same screen from the send control beside it', async () => {
    await render(<ModuleHomeScreen moduleId="noor-ai" />);

    await fireEvent.press(screen.getByTestId('noor-ai-ask-send'));

    expect(mockRouter.push).toHaveBeenCalledWith(NOOR_AI_CHAT_PATH);
  });

  it('carries no user content, no query string and no parameters in the route', async () => {
    await render(<ModuleHomeScreen moduleId="noor-ai" />);
    await fireEvent.press(screen.getByTestId('noor-ai-ask-field'));

    const href: unknown = mockRouter.push.mock.calls[0]?.[0];
    // A string, not an object with params — there is nowhere for content to be attached.
    expect(typeof href).toBe('string');
    expect(href).toBe('/ai/chat/new');
    expect(String(href)).not.toContain('?');
  });
});

describe('the initial state', () => {
  it('renders the title, the scope near the composer, and an empty state', async () => {
    await renderChat(answerNoorAIPort());

    expect(screen.getByText(noorAIChatCopy.title)).toBeTruthy();
    expect(screen.getByTestId('noor-ai-chat-scope')).toBeTruthy();
    expect(screen.getByTestId('noor-ai-chat-scope-pill')).toBeTruthy();
    expect(screen.getByTestId('noor-ai-chat-empty')).toBeTruthy();
    expect(screen.getByTestId(INPUT)).toBeTruthy();
    expect(screen.getByTestId(SEND)).toBeTruthy();
  });

  it('asks nothing on mount', async () => {
    const port = answerNoorAIPort();
    await renderChat(port);

    expect(port.calls).toHaveLength(0);
  });

  it('restores no prompt and no answer, because nothing is stored', async () => {
    await renderChat(answerNoorAIPort());

    expect(screen.getByTestId(INPUT).props.value).toBe('');
    expect(screen.queryByTestId('noor-ai-chat-outcome-answer')).toBeNull();
    expect(screen.queryByTestId('noor-ai-chat-outcome-refusal')).toBeNull();
    expect(screen.queryByTestId('noor-ai-chat-outcome-failure')).toBeNull();
  });

  it('shows no validation message over an untouched composer', async () => {
    await renderChat(answerNoorAIPort());
    expect(screen.queryByTestId('noor-ai-chat-composer-problem')).toBeNull();
  });

  it('says the surface is single-turn and keeps nothing', async () => {
    await renderChat(answerNoorAIPort());
    expect(screen.getByTestId('noor-ai-chat-single-turn')).toHaveTextContent(
      containing(noorAIChatCopy.singleTurn),
    );
  });
});

describe('what cannot be sent', () => {
  it('refuses an empty question, and the control says so before it is pressed', async () => {
    const port = answerNoorAIPort();
    await renderChat(port);

    expect(screen.getByTestId(SEND).props.accessibilityState.disabled).toBe(true);
    await fireEvent.press(screen.getByTestId(SEND));

    expect(port.calls).toHaveLength(0);
  });

  it('refuses a question made only of whitespace and invisible characters', async () => {
    const port = answerNoorAIPort();
    await renderChat(port);

    await fireEvent.changeText(screen.getByTestId(INPUT), INVISIBLE_ONLY);
    await fireEvent.press(screen.getByTestId(SEND));

    expect(port.calls).toHaveLength(0);
    expect(screen.getByTestId('noor-ai-chat-composer-problem')).toHaveTextContent(
      containing(noorAIChatCopy.draft.blank),
    );
  });

  it('refuses a question over the code-point limit', async () => {
    const port = answerNoorAIPort();
    await renderChat(port);

    await fireEvent.changeText(screen.getByTestId(INPUT), 'a'.repeat(1001));
    await fireEvent.press(screen.getByTestId(SEND));

    expect(port.calls).toHaveLength(0);
    expect(screen.getByTestId('noor-ai-chat-composer-problem')).toHaveTextContent(
      containing(noorAIChatCopy.draft.tooLong),
    );
  });

  it('accepts a question of exactly the limit, so the bound is not off by one', async () => {
    const port = answerNoorAIPort();
    await renderChat(port);

    await ask('a'.repeat(1000));

    expect(port.calls).toHaveLength(1);
  });

  it('refuses control characters other than tab, newline and carriage return', async () => {
    const port = answerNoorAIPort();
    await renderChat(port);

    await fireEvent.changeText(screen.getByTestId(INPUT), WITH_CONTROL);
    await fireEvent.press(screen.getByTestId(SEND));

    expect(port.calls).toHaveLength(0);
    expect(screen.getByTestId('noor-ai-chat-composer-problem')).toHaveTextContent(
      containing(noorAIChatCopy.draft.unsupportedCharacters),
    );
  });
});

describe('one invocation per question', () => {
  it('asks exactly once for a valid question, with the trimmed text', async () => {
    const port = answerNoorAIPort();
    await renderChat(port);

    await ask('  Where do I change my language?  ');

    expect(port.calls).toHaveLength(1);
    expect(port.calls[0]?.prompt).toBe('Where do I change my language?');
  });

  it('asks once for three presses in a row', async () => {
    /**
     * Three presses, none of them awaited between.
     *
     * This is the case a user produces by tapping repeatedly, and it is refused twice over: by the
     * synchronous in-flight ref, which is written before the first `await` and is therefore already
     * set when a handler runs again inside the same frame, and by the control's own `disabled`
     * state once React has redrawn it. `noor-ai-ui-source-scan.test.ts` asserts the ref is read
     * before the port is reached, which is the half a rendered test cannot separate.
     */
    const port = pendingNoorAIPort();
    await renderChat(port);
    await fireEvent.changeText(screen.getByTestId(INPUT), 'Where is Settings?');

    await fireEvent.press(screen.getByTestId(SEND));
    await fireEvent.press(screen.getByTestId(SEND));
    await fireEvent.press(screen.getByTestId(SEND));

    expect(port.calls).toHaveLength(1);

    await act(async () => {
      port.settle({ outcome: 'answer', answer: { text: 'ok', finish: 'complete', sources: [] } });
    });
  });

  it('blocks the control while a request is pending, and says why', async () => {
    const port = pendingNoorAIPort();
    await renderChat(port);
    await ask();

    expect(screen.getByTestId('noor-ai-chat-composer-pending')).toBeTruthy();
    expect(screen.getByTestId(SEND).props.accessibilityState.disabled).toBe(true);
    expect(screen.getByTestId(SEND).props.accessibilityHint).toBe(
      noorAIChatCopy.composer.submitHintPending,
    );
    expect(screen.getByTestId(INPUT).props.editable).toBe(false);

    await act(async () => {
      port.settle({ outcome: 'failed', failure: 'unknown' });
    });
  });

  it('never retries by itself after a failure', async () => {
    const port = failedNoorAIPort('temporarily-unavailable');
    await renderChat(port);
    await ask();

    expect(port.calls).toHaveLength(1);

    // Anything a retry could hide behind — a timer, a microtask chain — has run by now.
    await act(async () => {
      jest.advanceTimersByTime(60_000);
      await Promise.resolve();
    });

    expect(port.calls).toHaveLength(1);
    expect(screen.getByTestId('noor-ai-chat-outcome-failure')).toBeTruthy();
  });

  it('creates exactly one more call when the user deliberately asks again', async () => {
    const port = failedNoorAIPort('timed-out');
    await renderChat(port);
    await ask();
    expect(port.calls).toHaveLength(1);

    // The composer keeps the question, so asking again is one press — and the hint says it is a
    // new request rather than a replay of the first.
    expect(screen.getByTestId(SEND).props.accessibilityHint).toBe(
      noorAIChatCopy.composer.submitHintAfterFailure,
    );
    await fireEvent.press(screen.getByTestId(SEND));

    expect(port.calls).toHaveLength(2);
  });

  it('does not update state after the screen is gone', async () => {
    const port = pendingNoorAIPort();
    const errors = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    let messages: string[] = [];

    try {
      const view = await renderChat(port);
      await ask();

      await act(async () => {
        await view.unmount();
      });
      await act(async () => {
        port.settle({
          outcome: 'answer',
          answer: { text: 'late', finish: 'complete', sources: [] },
        });
      });

      messages = errors.mock.calls.map((call) => String(call[0]));
    } finally {
      errors.mockRestore();
    }

    // React no longer warns about this by itself, so the assertion names the two things that
    // would show the guard had gone: a state update on a gone tree, or an unhandled rejection.
    expect(
      messages.filter((message) => /unmounted|not wrapped in act|update/i.test(message)),
    ).toEqual([]);
  });
});

describe('cancellation', () => {
  it('passes the caller signal the adapter already accepts, and shows a neutral state', async () => {
    const port = cancellableNoorAIPort();
    await renderChat(port);
    await ask();

    const signal = port.calls[0]?.options?.signal;
    expect(typeof signal?.addEventListener).toBe('function');
    expect(signal?.aborted).toBe(false);

    await fireEvent.press(screen.getByTestId('noor-ai-chat-composer-cancel'));
    await waitFor(() => expect(screen.getByTestId('noor-ai-chat-outcome-failure')).toBeTruthy());

    const banner = screen.getByTestId('noor-ai-chat-outcome-failure-banner');
    expect(banner).toHaveTextContent(containing(noorAIChatCopy.failure.states.cancelled.title));
    // Neutral, not an error: the request did exactly what the user asked it to.
    expect(String(banner.props.accessibilityLabel)).toContain('Information.');
    // And the question is still editable rather than lost.
    expect(screen.getByTestId(INPUT).props.editable).toBe(true);
  });

  it('abandons the request when the screen unmounts', async () => {
    const port = cancellableNoorAIPort();
    const view = await renderChat(port);
    await ask();

    await act(async () => {
      await view.unmount();
    });

    expect(port.calls[0]?.options?.signal?.aborted).toBe(true);
  });
});

describe('an answer', () => {
  it('renders the answer text and the allow-listed fields only', async () => {
    await renderChat(answerNoorAIPort());
    await ask();

    await waitFor(() => expect(screen.getByTestId('noor-ai-chat-outcome-answer')).toBeTruthy());
    expect(screen.getByTestId('noor-ai-chat-outcome-answer-text')).toHaveTextContent(
      FIXTURE_ANSWER_TEXT,
    );
  });

  it('renders `finish: complete` with no incompleteness notice', async () => {
    await renderChat(answerNoorAIPort());
    await ask();

    await waitFor(() => expect(screen.getByTestId('noor-ai-chat-outcome-answer')).toBeTruthy());
    expect(screen.queryByTestId('noor-ai-chat-outcome-incomplete')).toBeNull();
  });

  it('says an answer may be incomplete when the model hit its length ceiling', async () => {
    await renderChat(truncatedAnswerNoorAIPort());
    await ask();

    await waitFor(() => expect(screen.getByTestId('noor-ai-chat-outcome-incomplete')).toBeTruthy());
    expect(screen.getByTestId('noor-ai-chat-outcome-incomplete')).toHaveTextContent(
      containing(noorAIChatCopy.answer.incomplete),
    );
  });

  it('fabricates no citation section for an empty sources collection', async () => {
    await renderChat(answerNoorAIPort());
    await ask();

    await waitFor(() => expect(screen.getByTestId('noor-ai-chat-outcome-answer')).toBeTruthy());
    // No heading, no empty list, and nothing that reads as an attribution.
    expect(screen.queryByText(/source/i)).toBeNull();
    expect(screen.queryByText(/citation/i)).toBeNull();
    expect(screen.queryByText(/hadith|bukhari|surah/i)).toBeNull();
  });

  it('cannot render a field the contract does not name', async () => {
    /**
     * A response carrying everything §I.6 forbids on screen, forced past the type system.
     *
     * The adapter rebuilds an answer key by key from validated primitives, so none of these can
     * reach a real caller. This proves the *screen* would not draw them even if one did, which is
     * the half a UI test can actually establish.
     */
    const contaminated = {
      outcome: 'answer',
      answer: {
        text: FIXTURE_ANSWER_TEXT,
        finish: 'complete',
        sources: [],
        request_id: 'reqFIXTURE9f2b',
        response_id: 'respFIXTURE44',
        model: 'fixture-model-name',
        accessed_modules: ['finance'],
        usage: { input_tokens: 555, output_tokens: 64, cost_micro_usd: 2155 },
        debug: { status: 503, upstream: 'api.example.invalid' },
      },
    } as unknown as NoorAIResult;

    await renderChat(inertNoorAIPort(contaminated));
    await ask();

    await waitFor(() => expect(screen.getByTestId('noor-ai-chat-outcome-answer')).toBeTruthy());
    for (const forbidden of [
      'reqFIXTURE9f2b',
      'respFIXTURE44',
      'fixture-model-name',
      '555',
      '2155',
      '503',
      'api.example.invalid',
    ]) {
      expect(screen.queryByText(new RegExp(forbidden, 'i'))).toBeNull();
    }

    /**
     * `accessed_modules` is checked inside the answer card rather than screen-wide.
     *
     * The scope panel legitimately names all seven modules — to say Noor AI is **not** reading
     * them — so a screen-wide search for a module name would fail on the sentence that exists to
     * make the boundary visible. What must not happen is a module name appearing as something the
     * answer accessed.
     */
    expect(
      within(screen.getByTestId('noor-ai-chat-outcome-answer')).queryByText(/finance/i),
    ).toBeNull();
  });

  it('draws the answer as text, never as markup, a link or an action', async () => {
    const hostile =
      '<script>alert(1)</script> [tap here](noorlifeapp://settings) <b>bold</b> https://example.invalid/path';
    await renderChat(
      inertNoorAIPort({
        outcome: 'answer',
        answer: { text: hostile, finish: 'complete', sources: [] },
      }),
    );
    await ask();

    await waitFor(() => expect(screen.getByTestId('noor-ai-chat-outcome-answer')).toBeTruthy());
    const answer = screen.getByTestId('noor-ai-chat-outcome-answer-text');

    // Rendered verbatim, which is what "plain text" means: the markup is characters, not nodes.
    expect(answer).toHaveTextContent(containing('<script>alert(1)</script>'));
    expect(answer).toHaveTextContent(containing('[tap here](noorlifeapp://settings)'));
    // Nothing became pressable and nothing navigated.
    expect(answer.props.onPress).toBeUndefined();
    expect(answer.props.accessibilityRole).not.toBe('link');
    expect(answer.props.dataDetectorType).toBeUndefined();
    expect(mockRouter.push).not.toHaveBeenCalled();
    expect(mockRouter.navigate).not.toHaveBeenCalled();
    expect(mockRouter.replace).not.toHaveBeenCalled();
  });

  it('writes no prompt or answer to storage and logs neither', async () => {
    const logs = (['log', 'warn', 'error', 'info', 'debug'] as const).map((level) =>
      jest.spyOn(console, level).mockImplementation(() => undefined),
    );
    const setItem = AsyncStorage.setItem as jest.Mock;
    setItem.mockClear();

    await renderChat(answerNoorAIPort());
    await ask('Where do I change my language?');
    await waitFor(() => expect(screen.getByTestId('noor-ai-chat-outcome-answer')).toBeTruthy());

    for (const spy of logs) {
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    }
    expect(setItem).not.toHaveBeenCalled();
  });
});

describe('a policy refusal', () => {
  it.each(ALL_NOOR_AI_REFUSAL_KINDS)('renders NoorLife-authored copy for %s', async (kind) => {
    await renderChat(refusedNoorAIPort(kind));
    await ask();

    await waitFor(() => expect(screen.getByTestId('noor-ai-chat-outcome-refusal')).toBeTruthy());
    expect(screen.getByTestId('noor-ai-chat-outcome-refusal-body')).toHaveTextContent(
      containing(noorAIChatCopy.refusal.kinds[kind]),
    );
  });

  it.each(ALL_NOOR_AI_REFUSAL_KINDS)(
    'renders no server-supplied explanation for %s',
    async (kind) => {
      await renderChat(refusedNoorAIPort(kind));
      await ask();

      await waitFor(() => expect(screen.getByTestId('noor-ai-chat-outcome-refusal')).toBeTruthy());
      expect(screen.queryByText(new RegExp(FIXTURE_REFUSAL_MARKER))).toBeNull();
    },
  );

  it('is not drawn as a transport or system error', async () => {
    await renderChat(refusedNoorAIPort('safety-boundary'));
    await ask();

    await waitFor(() => expect(screen.getByTestId('noor-ai-chat-outcome-refusal')).toBeTruthy());
    expect(screen.queryByTestId('noor-ai-chat-outcome-failure')).toBeNull();
    expect(screen.queryByText(/went wrong/i)).toBeNull();
    expect(screen.queryByText(/try again/i)).toBeNull();
  });

  it('offers no hand-off, because §C.4 pins one to null until AI-9', async () => {
    await renderChat(refusedNoorAIPort('out-of-scope'));
    await ask();

    await waitFor(() => expect(screen.getByTestId('noor-ai-chat-outcome-refusal')).toBeTruthy());
    expect(screen.queryByTestId('noor-ai-chat-outcome-handoff')).toBeNull();
    expect(screen.queryByText(/hand.?off/i)).toBeNull();
  });

  it('does not tell the user they broke a rule', () => {
    for (const kind of ALL_NOOR_AI_REFUSAL_KINDS) {
      expect(noorAIChatCopy.refusal.kinds[kind]).not.toMatch(/violat|breach|not allowed to ask/i);
    }
    expect(noorAIChatCopy.refusal.kinds['safety-boundary']).toMatch(/not a judgement/i);
  });
});

describe('every failure state', () => {
  it.each(ALL_NOOR_AI_FAILURE_STATES)('renders its own copy for %s', async (failure) => {
    await renderChat(failedNoorAIPort(failure));
    await ask();

    await waitFor(() => expect(screen.getByTestId('noor-ai-chat-outcome-failure')).toBeTruthy());
    const state = noorAIChatCopy.failure.states[failure];
    const banner = screen.getByTestId('noor-ai-chat-outcome-failure-banner');
    expect(banner).toHaveTextContent(containing(state.title));
    expect(banner).toHaveTextContent(containing(state.body));
  });

  it.each(ALL_NOOR_AI_FAILURE_STATES)('exposes no internal detail for %s', async (failure) => {
    await renderChat(failedNoorAIPort(failure));
    await ask();

    await waitFor(() => expect(screen.getByTestId('noor-ai-chat-outcome-failure')).toBeTruthy());
    for (const forbidden of [
      /\b[45][0-9][0-9]\b/,
      /request[_ ]?id/i,
      /supabase/i,
      /openai/i,
      /edge function/i,
      /\brpc\b/i,
      /quota/i,
      /\btoken/i,
      /https?:\/\//i,
      /stack trace/i,
      /error code/i,
    ]) {
      expect(screen.queryByText(forbidden)).toBeNull();
    }
  });

  it('offers a sign-in route for an expired session, and only for that one', async () => {
    await renderChat(failedNoorAIPort('authentication-required'));
    await ask();

    await waitFor(() => expect(screen.getByTestId('noor-ai-chat-outcome-sign-in')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('noor-ai-chat-outcome-sign-in'));
    expect(mockRouter.replace).toHaveBeenCalledWith('/welcome');
  });

  it.each(ALL_NOOR_AI_FAILURE_STATES.filter((state) => state !== 'authentication-required'))(
    'offers no action for %s, because a replay is not the same request',
    async (failure) => {
      await renderChat(failedNoorAIPort(failure));
      await ask();

      await waitFor(() => expect(screen.getByTestId('noor-ai-chat-outcome-failure')).toBeTruthy());
      expect(screen.queryByTestId('noor-ai-chat-outcome-sign-in')).toBeNull();
    },
  );

  it('covers the finite union exhaustively and distinctly', () => {
    const states = Object.keys(noorAIChatCopy.failure.states).sort();
    expect(states).toEqual([...ALL_NOOR_AI_FAILURE_STATES].sort());

    // Distinct titles, so no two states are silently collapsed into one message.
    const titles = ALL_NOOR_AI_FAILURE_STATES.map(
      (state) => noorAIChatCopy.failure.states[state].title,
    );
    expect(new Set(titles).size).toBeGreaterThanOrEqual(8);
    for (const state of ALL_NOOR_AI_FAILURE_STATES) {
      expect(noorAIChatCopy.failure.states[state].body.length).toBeGreaterThan(0);
    }
  });

  it('states the disabled-function case as unavailability, not as a defect', async () => {
    await renderChat(failedNoorAIPort('temporarily-unavailable'));
    await ask();

    await waitFor(() => expect(screen.getByTestId('noor-ai-chat-outcome-failure')).toBeTruthy());
    expect(screen.getByTestId('noor-ai-chat-outcome-failure-banner')).toHaveTextContent(
      containing('Noor AI is unavailable'),
    );
    expect(screen.queryByText(/disabled|kill switch|not deployed/i)).toBeNull();
  });

  it('answers a thrown implementation with the generic state and nothing of the exception', async () => {
    await renderChat(throwingNoorAIPort());
    await ask();

    await waitFor(() => expect(screen.getByTestId('noor-ai-chat-outcome-failure')).toBeTruthy());
    expect(screen.getByTestId('noor-ai-chat-outcome-failure-banner')).toHaveTextContent(
      containing(noorAIChatCopy.failure.states.unknown.title),
    );
    expect(screen.queryByText(new RegExp(THROWN_FIXTURE_MESSAGE))).toBeNull();
  });
});

describe('the scope indicator', () => {
  it('shows the §06 pill and the boundary, near the composer', async () => {
    await renderChat(answerNoorAIPort());

    expect(screen.getByTestId('noor-ai-chat-scope-pill').props.accessibilityLabel).toContain(
      noorAIChatCopy.scope.pill,
    );
    expect(screen.getByTestId('noor-ai-chat-scope-not-an-authority')).toHaveTextContent(
      containing(noorAIChatCopy.scope.notAnAuthority),
    );
    expect(screen.getByTestId('noor-ai-chat-scope-authority')).toHaveTextContent(
      containing(noorAIChatCopy.scope.authority),
    );
  });

  it('renders "No module access" as a state, because that is the fact', async () => {
    await renderChat(answerNoorAIPort());

    const access = screen.getByTestId('noor-ai-chat-scope-module-access');
    expect(access).toHaveTextContent(containing(noorAIChatCopy.scope.noModuleAccess));
    expect(String(access.props.accessibilityLabel)).toContain(
      noorAIChatCopy.scope.noModuleAccessDetail,
    );
    expect(screen.queryByTestId('noor-ai-chat-scope-granted-count')).toBeNull();
  });

  it('sends no scope, no grant and no module list — the port receives a local context only', async () => {
    const port = answerNoorAIPort();
    await renderChat(port);
    await ask();

    const context = port.calls[0]?.context;
    expect(context?.scope.kind).toBe('noorlife');
    // The UI adds nothing to it, and grants are empty because no grant store exists.
    expect(context?.grantedModules).toEqual([]);
    expect(Object.keys(context ?? {}).sort()).toEqual(['currentScreen', 'grantedModules', 'scope']);
    // The screen passes the context and the two documented options — nothing else.
    expect(Object.keys(port.calls[0]?.options ?? {}).sort()).toEqual(['locale', 'signal']);
  });

  it('never implies a module was read', async () => {
    await renderChat(answerNoorAIPort());
    await ask();

    await waitFor(() => expect(screen.getByTestId('noor-ai-chat-outcome-answer')).toBeTruthy());
    expect(screen.queryByText(/modules accessed|read your|based on your records/i)).toBeNull();
  });
});

describe('localization and layout', () => {
  it('passes the active locale to the adapter rather than inventing one', async () => {
    const port = answerNoorAIPort();
    await renderChat(port);
    await ask();

    expect(port.calls[0]?.options?.locale).toBe('en');
  });

  it('lets a long answer wrap and grow instead of clipping it', async () => {
    await renderChat(longAnswerNoorAIPort());
    await ask();

    await waitFor(() => expect(screen.getByTestId('noor-ai-chat-outcome-answer')).toBeTruthy());
    const answer = screen.getByTestId('noor-ai-chat-outcome-answer-text');
    expect(answer).toHaveTextContent(containing('Paragraph 12'));
    // No line cap and no fixed height anywhere on the answer.
    expect(answer.props.numberOfLines).toBeUndefined();
    expect(JSON.stringify(answer.props.style ?? {})).not.toContain('height');
    expect(FIXTURE_LONG_ANSWER_TEXT.length).toBeGreaterThan(1500);
  });

  it('grows the composer rather than fixing its height', async () => {
    await renderChat(answerNoorAIPort());
    const input = screen.getByTestId(INPUT);

    expect(input.props.multiline).toBe(true);
    expect(JSON.stringify(input.props.style ?? {})).not.toContain('"height"');
  });
});

describe('accessibility', () => {
  it('gives the composer and its control accessible names', async () => {
    await renderChat(answerNoorAIPort());

    expect(screen.getByTestId(INPUT).props.accessibilityLabel).toBe(
      noorAIChatCopy.composer.accessibilityLabel,
    );
    expect(screen.getByTestId(SEND).props.accessibilityLabel).toBe(
      noorAIChatCopy.composer.submitAccessibilityLabel,
    );
    // And a visible label, because a placeholder is not one.
    expect(screen.getByText(noorAIChatCopy.composer.label)).toBeTruthy();
  });

  it('exposes the disabled control as disabled, and explains what would enable it', async () => {
    await renderChat(answerNoorAIPort());

    const send = screen.getByTestId(SEND);
    expect(send.props.accessibilityState.disabled).toBe(true);
    expect(send.props.accessibilityHint).toBe(noorAIChatCopy.composer.submitHintDisabled);

    await fireEvent.changeText(screen.getByTestId(INPUT), 'Where is Settings?');
    expect(screen.getByTestId(SEND).props.accessibilityState.disabled).toBe(false);
    expect(screen.getByTestId(SEND).props.accessibilityHint).toBe(
      noorAIChatCopy.composer.submitHintReady,
    );
  });

  it('announces the loading state without taking focus', async () => {
    const port = pendingNoorAIPort();
    await renderChat(port);
    await ask();

    const pendingNode = screen.getByTestId('noor-ai-chat-composer-pending');
    expect(pendingNode.props.accessibilityLiveRegion).toBe('polite');
    // Progress is communicated, and no modal or focus trap is introduced.
    expect(pendingNode.props.accessibilityViewIsModal).toBeUndefined();
    expect(screen.getByTestId('noor-ai-chat-composer-cancel')).toBeTruthy();

    await act(async () => {
      port.settle({ outcome: 'failed', failure: 'unknown' });
    });
  });

  it('announces outcomes, and never carries meaning by colour alone', async () => {
    await renderChat(failedNoorAIPort('network-unavailable'));
    await ask();

    await waitFor(() => expect(screen.getByTestId('noor-ai-chat-outcome-failure')).toBeTruthy());
    const banner = screen.getByTestId('noor-ai-chat-outcome-failure-banner');
    expect(banner.props.accessibilityLiveRegion).toBe('polite');
    expect(banner.props.accessibilityRole).toBe('alert');
    // The tone is spoken as a word and drawn as an icon, not only as a hue.
    expect(String(banner.props.accessibilityLabel)).toMatch(/^Warning\./);
  });

  it('announces a validation problem on the composer', async () => {
    await renderChat(answerNoorAIPort());
    await fireEvent.changeText(screen.getByTestId(INPUT), '   ');

    const problem = screen.getByTestId('noor-ai-chat-composer-problem');
    expect(problem.props.accessibilityLiveRegion).toBe('polite');
    expect(String(problem.props.accessibilityLabel)).toMatch(/^Error\./);
  });
});

describe('the feedback route', () => {
  it('says reporting does not exist and accepts nothing', async () => {
    await render(
      <AppProviders>
        <NoorAIFeedbackScreen />
      </AppProviders>,
    );
    await waitFor(() => expect(screen.getByTestId('noor-ai-feedback-card')).toBeTruthy());

    expect(screen.getByTestId('noor-ai-feedback-body')).toHaveTextContent(
      containing(noorAIChatCopy.feedback.body),
    );
    // Nothing to type into, nothing to rate with, and nothing to submit.
    expect(screen.queryByTestId('noor-ai-feedback-input')).toBeNull();
    expect(screen.queryByTestId('noor-ai-feedback-submit')).toBeNull();
    expect(screen.queryByText(/submit|send report|rate this/i)).toBeNull();
  });
});
