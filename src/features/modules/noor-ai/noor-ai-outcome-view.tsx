import { StyleSheet, View } from 'react-native';

import { AppIcon, PressableScale } from '@ds/components';
import type { NoorAIResult } from '@services/ai/noor-ai.contract';

import { ModuleCard } from '../components/module-card';
import { ModuleStatusBanner } from '../components/module-status-banner';
import { ModuleText } from '../components/module-text';
import { useModuleTheme } from '../module-context';
import { moduleLayout, moduleNeutrals } from '../module-tokens';
import { useModuleMetrics } from '../use-module-metrics';
import { noorAIChatCopy } from './noor-ai-chat-copy';
import { minimumTouchTargetSize } from '@shared/utils/a11y';

export type NoorAIOutcomeViewProps = {
  readonly result: NoorAIResult;
  /** Called only from the `authentication-required` state's action. */
  readonly onSignIn: () => void;
  readonly testID?: string;
};

/**
 * What one `ask` produced, drawn.
 *
 * ── Exhaustive by construction, in both directions ──────────────────────────
 * There is no `default` branch anywhere below. The outer `switch` covers `NoorAIResult`'s three
 * outcomes and returns from each, so under `noImplicitReturns` a fourth outcome added to the union
 * fails the build here rather than falling through to a silently generic screen. The two inner
 * mappings are total `Record`s in `noor-ai-chat-copy.ts` — `satisfies Record<NoorAIRefusalKind, …>`
 * and `satisfies Record<NoorAIFailureState, …>` — so an eleventh failure state or a fourth refusal
 * kind is a compile error in the copy table, which is the file where somebody has to write the
 * words anyway.
 *
 * ── A refusal is not an error ───────────────────────────────────────────────
 * §C.4 and §I.5 keep policy and failure apart on the wire, and this keeps them apart on screen: a
 * refusal is an informational card headed "Noor AI did not answer that", a failure is a toned
 * banner headed "Noor AI could not answer". They do not share a component, a tone or a phrase, so
 * "the service is broken" and "that is not something I answer" cannot be confused for one another.
 *
 * ── Nothing server-supplied is rendered ─────────────────────────────────────
 * Two fields from a response reach a screen at all: `answer.text` and `answer.finish`. The
 * refusal's `explanation` is deliberately not drawn — see the note in `noor-ai-chat-copy.ts` — so a
 * refusal is made entirely of copy written before the request. The failure outcome has exactly one
 * field and it is a state word, so there is nothing else to leak: no status, no code, no message,
 * no request id, no provider detail, no token count and no price.
 *
 * ── The answer is text, and only text ───────────────────────────────────────
 * `answer.text` renders inside `ModuleText`, which is a React Native `Text`. RN `Text` has no HTML,
 * no Markdown and no link-autodetection contract — it draws characters. That is the whole of the
 * safety argument, and it is a structural one rather than a sanitiser: there is no parser to
 * exploit, nothing is auto-linked, nothing navigates, and model output cannot become an action.
 * `numberOfLines` is deliberately unset so a long answer wraps and the card grows.
 *
 * ── Sources ─────────────────────────────────────────────────────────────────
 * `NoorAIAnswer.sources` is typed `readonly never[]`: the only value it can hold is `[]`, because
 * AI-1 has no retrieval layer and nothing is read. So there is no citation section, no "Sources"
 * heading and no empty-state for one. §07 requires citations for Faith content and AI-6 owns
 * populating them truthfully; drawing a heading over an empty list today would be the first step to
 * a fabricated one.
 */
export function NoorAIOutcomeView({ result, onSignIn, testID }: NoorAIOutcomeViewProps) {
  const theme = useModuleTheme();
  const { dp } = useModuleMetrics();

  const prefix = testID ?? 'noor-ai-outcome';

  switch (result.outcome) {
    case 'answer': {
      const { answer } = result;
      return (
        <View style={{ rowGap: dp(7) }} testID={`${prefix}-answer`}>
          {answer.finish === 'length' ? (
            <ModuleStatusBanner
              tone="warning"
              message={noorAIChatCopy.answer.incomplete}
              testID={`${prefix}-incomplete`}
            />
          ) : null}

          <ModuleCard testID={`${prefix}-answer-card`}>
            <View style={{ rowGap: dp(6) }}>
              <View style={[styles.row, { columnGap: dp(7) }]}>
                <AppIcon name="robot" size={dp(16)} color={theme.ink} />
                <ModuleText token="cardHeading" color={theme.ink} numberOfLines={1}>
                  {noorAIChatCopy.answer.heading}
                </ModuleText>
              </View>
              {/* No line cap: the card grows with the answer rather than clipping it. */}
              <ModuleText
                token="body"
                color={moduleNeutrals.textPrimary}
                testID={`${prefix}-answer-text`}
              >
                {answer.text}
              </ModuleText>
            </View>
          </ModuleCard>
        </View>
      );
    }

    case 'refused': {
      const copy = noorAIChatCopy.refusal.kinds[result.refusal.kind];
      return (
        <ModuleCard testID={`${prefix}-refusal`}>
          <View style={{ rowGap: dp(6) }}>
            <View style={[styles.row, { columnGap: dp(7) }]}>
              <AppIcon name="info" size={dp(16)} color={moduleNeutrals.info} />
              <ModuleText token="cardHeading" numberOfLines={2} style={styles.flex}>
                {noorAIChatCopy.refusal.heading}
              </ModuleText>
            </View>
            <ModuleText token="body" testID={`${prefix}-refusal-body`}>
              {copy}
            </ModuleText>
          </View>
        </ModuleCard>
      );
    }

    case 'failed': {
      const state = noorAIChatCopy.failure.states[result.failure];
      return (
        <View style={{ rowGap: dp(7) }} testID={`${prefix}-failure`}>
          <ModuleStatusBanner
            tone={state.tone}
            message={`${state.title}. ${state.body}`}
            testID={`${prefix}-failure-banner`}
          />

          {/*
            One action, on one state.

            `authentication-required` is the only failure the application can act on, and the
            action is the app's existing sign-in destination. Every other state's remedy is either
            waiting or editing the question, and a "Try Again" button beside them would suggest the
            same request could be replayed — §I.1 says it cannot, because a second invocation is a
            second reservation and a second charge. Re-sending is therefore the composer's Send
            button, pressed deliberately, with a hint that says it is a new request.
          */}
          {result.failure === 'authentication-required' ? (
            <PressableScale
              onPress={onSignIn}
              accessibilityRole="button"
              accessibilityLabel={noorAIChatCopy.failure.signIn}
              style={[
                styles.action,
                {
                  minHeight: minimumTouchTargetSize(),
                  borderRadius: dp(moduleLayout.radiusSmall),
                  paddingHorizontal: dp(18),
                  backgroundColor: theme.fill,
                },
              ]}
              testID={`${prefix}-sign-in`}
            >
              <ModuleText token="button" color={theme.onFill} numberOfLines={1}>
                {noorAIChatCopy.failure.signIn}
              </ModuleText>
            </PressableScale>
          ) : null}
        </View>
      );
    }
  }
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  flex: {
    flex: 1,
    minWidth: 0,
  },
  action: {
    alignSelf: 'flex-start',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
