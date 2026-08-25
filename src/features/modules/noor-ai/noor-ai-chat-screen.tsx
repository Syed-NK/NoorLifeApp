import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';

import { authRoutes } from '@application/navigation/routes';
import { useLocalization } from '@application/providers/localization-provider';
import type { ModuleId } from '@ds/tokens';
import { isNoorAILimited, noorAIRequestContext } from '@features/subscription/domain/noor-ai-scope';
import { useEntitlement } from '@features/subscription/services/entitlement-context';
import type { NoorAIPort, NoorAIResult } from '@services/ai/noor-ai.contract';
import { noorAIService } from '@services/ai/noor-ai.service';
import { AI_NAV_INDEX } from '@shared/models/module-theme';

import { ModuleCard } from '../components/module-card';
import { ModuleScaffold } from '../components/module-scaffold';
import { ModuleText } from '../components/module-text';
import { getModuleDefinition } from '../module-registry';
import { moduleLayout } from '../module-tokens';
import { useModuleMetrics } from '../use-module-metrics';
import { noorAIChatCopy, noorAIModulePrivacyLine } from './noor-ai-chat-copy';
import { NOOR_AI_CHAT_PATH } from './noor-ai-chat-routes';
import { NoorAIComposer } from './noor-ai-composer';
import { evaluateNoorAIDraft, type NoorAIDraftProblem } from './noor-ai-message-draft';
import { NoorAIOutcomeView } from './noor-ai-outcome-view';
import { NoorAIScopeNote } from './noor-ai-scope-note';

/**
 * Noor AI's conversation surface — `/ai/chat/:conversationId`.
 *
 * ── What this screen is allowed to reach ────────────────────────────────────
 * One thing: `NoorAIPort.ask`. It constructs no request body, holds no client, builds no URL,
 * names no function and knows no header. Everything about how a question becomes an invocation
 * belongs to `noor-ai.service.ts`, and everything a response could carry is reduced to
 * `NoorAIResult` before it arrives — three outcomes, and a failure outcome whose only field is a
 * state word. There is therefore no value on this screen that could hold a status code, a request
 * id, a provider detail, a token count or a price, which is what makes §I.6 a property of the
 * shape rather than something this file has to remember.
 *
 * It reads no module data, writes nothing anywhere, and logs nothing at all.
 *
 * ── Why the port is a prop ──────────────────────────────────────────────────
 * Several of the states below cannot be reached without a live service: a quota refusal, a
 * provider outage, an expired session, a malformed response. The alternative to injecting them is
 * shipping a screen nobody has seen in those states. Production passes nothing and gets
 * `noorAIService`; the tests pass a fake from the repository's test-only fixture module, which
 * lives outside `src/app` and `src/features` so Expo Router cannot route to it and no application
 * file may import it — a rule `privacy-security-source-scan.test.ts` already enforces across the
 * whole application, and `noor-ai-ui-source-scan.test.ts` re-asserts for this feature. There is no
 * environment variable, no route parameter, no remote flag and no debug menu that can substitute a
 * fake in a production build, because the only way in is a prop and the only caller that passes
 * one is Jest.
 *
 * ── One invocation per press, and never a second by itself ──────────────────
 * `inFlight` is a ref, not the `pending` flag, because two presses inside one frame both run
 * before React re-renders — so both would read `pending === false`, and the button's own
 * `disabled` would not have been applied yet either. A ref is written synchronously, so the second
 * press sees the first one's mark. Nothing in this file loops, schedules a timer, or calls `ask`
 * from anywhere but the one handler: §I.1 mints a fresh quota request id per handler execution, so
 * an automatic retry would be a second reservation, a second provider attempt and a second charge
 * for a question the user asked once.
 *
 * ── Single turn, and nothing kept ───────────────────────────────────────────
 * One question, one outcome, and the next question replaces it. §H.5 defers conversation
 * persistence to AI-8 behind a reviewed schema, an RLS policy, a retention period and an export and
 * deletion path; until those exist there is nothing to store into, so the draft and the outcome are
 * React state and die with the screen. §C.7 makes the endpoint single-turn on the server side too —
 * no history is sent, and the provider holds no conversation state (§F.6).
 */
export type NoorAIChatScreenProps = {
  /** Test seam. Production passes nothing. */
  readonly port?: NoorAIPort;
};

export function NoorAIChatScreen({ port = noorAIService }: NoorAIChatScreenProps = {}) {
  const definition = getModuleDefinition('noor-ai');

  return (
    <ModuleScaffold
      moduleId="noor-ai"
      activeKey={definition.navigation[AI_NAV_INDEX].key}
      title={noorAIChatCopy.title}
      testID="noor-ai-chat"
    >
      <NoorAIChatBody port={port} surfacePath={NOOR_AI_CHAT_PATH} />
    </ModuleScaffold>
  );
}

/** No grants exist: there is no grant store, and `AI_GRANT_EDITING_AVAILABLE` is false. */
const NO_GRANTED_MODULES: readonly ModuleId[] = Object.freeze([]);

export type NoorAIChatBodyProps = {
  readonly port: NoorAIPort;
  /**
   * The screen the request reports as its surface.
   *
   * Passed in rather than fixed, so a module entry can report *its own* allow-listed home path and
   * the module a question came from travels as `surface` — the one field §C.5 permits for this
   * purpose, mirrored from the server's own allow-list and drift-tested against it. A value not on
   * that list is omitted from the body entirely and the server applies its default, so an
   * unrecognised path degrades to today's behaviour rather than leaking a route name.
   */
  readonly surfacePath: string;
  /**
   * The module this conversation was opened from, for framing only.
   *
   * A display string. It changes a privacy line and nothing else, and it reaches no request: the
   * module's records, storage and account-scoped state are not read here, and there is no code path
   * on this screen that could reach them.
   */
  readonly originLabel?: string;
};

/** Split out so it renders inside the scaffold's `ModuleProvider`. */
export function NoorAIChatBody({ port, surfacePath, originLabel }: NoorAIChatBodyProps) {
  const router = useRouter();
  const { dp } = useModuleMetrics();
  const { entitlement } = useEntitlement();
  const { locale } = useLocalization();

  const [draft, setDraft] = useState('');
  /**
   * Whether the composer has been interacted with.
   *
   * Validation is silent until it is true, so a screen that has only just opened does not greet
   * the user with "Type a question before sending." above an untouched box. Set on the first
   * keystroke and on a submit attempt, and never cleared.
   */
  const [touched, setTouched] = useState(false);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<NoorAIResult | null>(null);

  /** The synchronous double-press guard. See the note on the component above. */
  const inFlight = useRef(false);
  /** The current request's controller, so Stop and unmount both abandon the same request. */
  const controller = useRef<AbortController | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      /**
       * Leaving the screen abandons the wait.
       *
       * It does not un-send the question — an abort cannot recall a request that is already on the
       * wire, which is why cancelling is still one invocation and why the cancelled copy says the
       * question may already have reached Noor AI. What it does guarantee is that no state update
       * follows the unmount: `mounted` is read before every `setState` in the handler below.
       */
      controller.current?.abort();
      controller.current = null;
    };
  }, []);

  /**
   * The context the request carries, and the same object the scope panel displays.
   *
   * `noorAIRequestContext` is the only constructor for a Noor AI `AIRequestContext`, and it
   * intersects any grants with the entitlement so a stale grant cannot widen anything. Nothing
   * from it is serialised: §12.1's resolution is that `context` is used locally and only an
   * allow-listed `surface` derived from `currentScreen` reaches the body — and `/ai/chat/new` is
   * deliberately not on §C.5's allow-list, so even that field is omitted and the server applies
   * its own default. §C.5 calls that the forgiving behaviour, and it means this route's name never
   * travels.
   */
  const context = useMemo(
    () => noorAIRequestContext(entitlement, surfacePath, NO_GRANTED_MODULES),
    [entitlement, surfacePath],
  );
  const limited = isNoorAILimited(entitlement);

  const evaluation = evaluateNoorAIDraft(draft);
  const problem: NoorAIDraftProblem | null =
    touched && !evaluation.canSubmit ? evaluation.problem : null;

  const submit = useCallback(async () => {
    // A submit attempt counts as interaction, so a refusal is explained rather than silent.
    setTouched(true);
    if (inFlight.current) {
      return;
    }

    /**
     * Re-evaluated here rather than read from the render that drew the button.
     *
     * A queued press, a stale closure and a programmatic call all arrive at this line, and the
     * port must be unreachable from every one of them while the draft is anything but sendable.
     */
    const check = evaluateNoorAIDraft(draft);
    if (!check.canSubmit) {
      return;
    }

    inFlight.current = true;
    const request = new AbortController();
    controller.current = request;
    setPending(true);
    setResult(null);

    try {
      const outcome = await port.ask(check.message, context, {
        signal: request.signal,
        locale,
      });
      if (mounted.current) {
        setResult(outcome);
      }
    } catch {
      /**
       * The adapter never throws — a source guard asserts it — so this is unreachable through the
       * production port. It exists because the port is an interface: an implementation that
       * rejected would otherwise leave the screen pending forever, and the caught value is
       * deliberately not read, not stored and not rendered, because a thrown value is made of the
       * error it describes.
       */
      if (mounted.current) {
        setResult({ outcome: 'failed', failure: 'unknown' });
      }
    } finally {
      inFlight.current = false;
      controller.current = null;
      if (mounted.current) {
        setPending(false);
      }
    }
  }, [context, draft, locale, port]);

  const cancel = useCallback(() => {
    controller.current?.abort();
  }, []);

  const signIn = useCallback(() => {
    // The application's existing route out of an expired session, as Change Email uses it.
    if (router.canDismiss()) {
      router.dismissAll();
    }
    router.replace(authRoutes.welcome);
  }, [router]);

  return (
    <View style={{ rowGap: dp(moduleLayout.sectionGap) }}>
      <NoorAIScopeNote context={context} limited={limited} testID="noor-ai-chat-scope" />

      {originLabel === undefined ? null : (
        /*
          Said plainly, and only where it is needed.

          A conversation opened from a module is the one place a user could reasonably assume the
          assistant has already looked at that module's data. It has not, and there is no path here
          that could: this screen reaches `NoorAIPort.ask` and nothing else, and the request body is
          four fields of which one is the text the user typed.

          Deliberately not phrased as a permission or a setting. There is no grant store and no
          revocation, so wording implying either would be the same class of false claim this entry
          exists to remove.
        */
        <ModuleText token="caption" testID="noor-ai-chat-module-privacy">
          {noorAIModulePrivacyLine(originLabel)}
        </ModuleText>
      )}

      <NoorAIComposer
        value={draft}
        onChangeText={(next) => {
          setDraft(next);
          setTouched(true);
        }}
        onSubmit={() => void submit()}
        onCancel={cancel}
        pending={pending}
        canSubmit={evaluation.canSubmit}
        problem={problem}
        afterFailure={result !== null && result.outcome === 'failed'}
        testID="noor-ai-chat-composer"
      />

      {pending || result === null ? null : (
        <NoorAIOutcomeView result={result} onSignIn={signIn} testID="noor-ai-chat-outcome" />
      )}

      {pending || result !== null ? null : (
        <ModuleCard testID="noor-ai-chat-empty">
          <View style={{ rowGap: dp(4) }}>
            <ModuleText token="cardTitle" numberOfLines={2}>
              {noorAIChatCopy.empty.title}
            </ModuleText>
            <ModuleText token="body">{noorAIChatCopy.empty.body}</ModuleText>
          </View>
        </ModuleCard>
      )}

      <ModuleText token="caption" testID="noor-ai-chat-single-turn">
        {noorAIChatCopy.singleTurn}
      </ModuleText>
    </View>
  );
}
