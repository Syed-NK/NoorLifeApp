import { useRouter } from 'expo-router';
import { View } from 'react-native';

import { PressableScale } from '@ds/components';
import { AI_NAV_INDEX } from '@shared/models/module-theme';

import { ModuleCard } from '../components/module-card';
import { ModuleScaffold } from '../components/module-scaffold';
import { ModuleStatusBanner } from '../components/module-status-banner';
import { ModuleText } from '../components/module-text';
import { useModuleTheme } from '../module-context';
import { getModuleDefinition } from '../module-registry';
import { moduleLayout } from '../module-tokens';
import { useModuleMetrics } from '../use-module-metrics';
import { noorAIChatCopy } from './noor-ai-chat-copy';
import { NOOR_AI_HOME_ROUTE } from './noor-ai-chat-routes';
import { minimumTouchTargetSize } from '@shared/utils/a11y';

/**
 * `/ai/feedback` — the route `NOORLIFE_PRODUCTION_WORKFLOW.md` §6 requires, and nothing more.
 *
 * ── Why this screen does nothing, deliberately ──────────────────────────────
 * §6 lists "Report or rate response" among Noor AI's required screens, and §K's AI-5 row requires
 * the route to exist. What does **not** exist is any of the four things a report needs before one
 * can be accepted:
 *
 *   • **Somewhere to put it.** There is no feedback table, no schema, no RLS policy and no Edge
 *     Function that accepts one. `noor-ai` is the only approved function in this repository and
 *     `privacy-security-source-scan.test.ts` pins that list.
 *   • **A privacy classification.** A report is user-authored text about an AI answer.
 *     `NOOR_AI_DATA_CONTROL_DECISION.md` §6 records that even the *prompt's* Play and Apple
 *     classifications are provisional and unfiled; a second content type with its own retention
 *     would be a third undeclared disclosure, added by the phase that was told not to add one.
 *   • **A retention period.** §H.4 leaves retention partly open and §H.5 defers storage entirely.
 *   • **Something to report about.** §H.5 says a report should carry §I.7's `request_id`. The AI-4
 *     adapter deliberately does not expose it — §K.3.3 records that divergence and says re-opening
 *     it "is an AI-5 decision with its own review". This phase does not re-open it: withholding an
 *     identifier is strictly narrower than showing one, and a review is not something a screen can
 *     grant itself. So a report submitted here could not name the answer it was about.
 *
 * Given all four, the honest options were to omit the route or to make it inert. It is inert,
 * because §6 and §K name it and a missing route would read as an oversight rather than a decision.
 *
 * ── What "inert" means here, precisely ──────────────────────────────────────
 * There is no text input, no rating control and no submit button — so there is nothing a user can
 * type that could be dropped, and no control that implies a report was received. Nothing is sent,
 * nothing is stored, no analytics event is emitted, and this file imports no service, no port, no
 * client and no storage API of any kind. The only interaction is a link back to Noor AI.
 *
 * ── Not linked from anywhere ────────────────────────────────────────────────
 * No screen offers a "Report this answer" control, because offering one would be offering an
 * action that does nothing. The route exists; the entry point arrives with the decision.
 */
export function NoorAIFeedbackScreen() {
  const definition = getModuleDefinition('noor-ai');

  return (
    <ModuleScaffold
      moduleId="noor-ai"
      activeKey={definition.navigation[AI_NAV_INDEX].key}
      title={noorAIChatCopy.feedback.title}
      banner={
        <ModuleStatusBanner
          tone="info"
          message={noorAIChatCopy.feedback.heading}
          testID="noor-ai-feedback-banner"
        />
      }
      testID="noor-ai-feedback"
    >
      <NoorAIFeedbackBody />
    </ModuleScaffold>
  );
}

/** Split out so it renders inside the scaffold's `ModuleProvider`. */
function NoorAIFeedbackBody() {
  const router = useRouter();
  const theme = useModuleTheme();
  const { dp } = useModuleMetrics();

  return (
    <View style={{ rowGap: dp(moduleLayout.sectionGap) }}>
      <ModuleCard testID="noor-ai-feedback-card">
        <View style={{ rowGap: dp(7) }}>
          <ModuleText token="cardHeading" numberOfLines={2}>
            {noorAIChatCopy.feedback.heading}
          </ModuleText>
          <ModuleText token="body" testID="noor-ai-feedback-body">
            {noorAIChatCopy.feedback.body}
          </ModuleText>
          <ModuleText token="caption" testID="noor-ai-feedback-detail">
            {noorAIChatCopy.feedback.detail}
          </ModuleText>
        </View>
      </ModuleCard>

      <PressableScale
        onPress={() => router.navigate(NOOR_AI_HOME_ROUTE)}
        accessibilityRole="button"
        accessibilityLabel={noorAIChatCopy.feedback.back}
        style={{
          alignSelf: 'flex-start',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: minimumTouchTargetSize(),
          borderRadius: dp(moduleLayout.radiusSmall),
          paddingHorizontal: dp(18),
          backgroundColor: theme.fill,
        }}
        testID="noor-ai-feedback-back"
      >
        <ModuleText token="button" color={theme.onFill} numberOfLines={1}>
          {noorAIChatCopy.feedback.back}
        </ModuleText>
      </PressableScale>
    </View>
  );
}
