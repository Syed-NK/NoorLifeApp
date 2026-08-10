import { useRouter, type Href } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { AppIcon, PressableScale } from '@ds/components';

import { ModuleCard } from '../components/module-card';
import { ModuleText } from '../components/module-text';
import { useModule } from '../module-context';
import { moduleLayout, moduleNeutrals } from '../module-tokens';
import { useModuleMetrics } from '../use-module-metrics';
import { NOOR_AI_CHAT_ROUTE } from './noor-ai-chat-routes';
import { NoorAIHero } from './noor-ai-hero';
import { noorAIHomeCopy } from './noor-ai-view-model';

/**
 * Noor AI's home screen.
 *
 * ── Only what AI-1 can serve is on this screen ──────────────────────────────
 * The screen composed to `02-noor-ai.png` carried five things this build cannot do, and AI-5's API 36
 * emulator pass photographed them. They are gone, and this is the record of what went and why —
 * §12.8's rule is that AI-5 enables **only capabilities AI-1's server can actually serve**.
 *
 *   • **Recent Conversations** — three invented questions with invented timestamps, rendered as the
 *     user's own history while no conversation store exists. Removed outright, not replaced with an
 *     empty state: an empty history still claims a history. Persistence is **AI-8's**.
 *   • **Today's Suggestions** ("Review my day", "Balance my week", "Family activity idea") and its
 *     "View All" — every one describes Noor AI reading a day, a week or a family. It reads none.
 *   • **"Explain my progress"** and **"Help me plan"** — worded as AI analysis of module records.
 *     They navigated to `/insights` and `/planner`, so the wording was the defect rather than the
 *     destination, and both screens remain reachable from their own modules.
 *   • **"Find a feature"** — routed to the "coming soon" screen, while finding a feature is exactly
 *     what the chat below already answers. A second, dead entry point to a live capability.
 *   • **The microphone** — voice input does not exist. It was an enabled button that opened "coming
 *     soon", which is the shape §12.8 forbids: presented as active, backed by nothing. Removed
 *     rather than shown disabled, because the reference does not require a visible disabled control
 *     and a permanently greyed microphone still advertises a feature.
 *
 * **"App settings"** went with the capability grid. It was ordinary navigation and honestly labelled,
 * so it broke no rule — but it duplicated the five-slot bar's own Settings destination, and leaving
 * one card in a four-column grid to say so would have been worse than the bar that already says it.
 *
 * ── What remains ───────────────────────────────────────────────────────────
 * The hero, the ask row, and the scope card. Nothing here claims a module read, a saved answer or a
 * capability that arrives later.
 *
 * ── On the input ────────────────────────────────────────────────────────────
 * The field is a button that opens the conversation surface rather than a live `TextInput` on this
 * screen, and it is labelled as such for a screen reader. The field and the send control both open
 * `/ai/chat/new`, and together they remain **the one approved entry point** to the conversation
 * screen: nothing else in the application opens it, no module screen gained a Noor AI button, the
 * centre navigation control still goes to this home, and no deep link was registered.
 */
export function NoorAIHomeContent() {
  const router = useRouter();
  const module = useModule();
  const { dp } = useModuleMetrics();
  const copy = noorAIHomeCopy;

  const go = (href: Href) => () => router.push(href);

  return (
    <View style={{ rowGap: dp(moduleLayout.sectionGap) }}>
      <NoorAIHero testID="noor-ai-hero" />

      {/* ── Ask input — the one approved entry to the chat ─────────────────── */}
      <View
        style={[
          styles.askRow,
          {
            borderRadius: dp(moduleLayout.radiusPill),
            paddingLeft: dp(14),
            paddingRight: dp(6),
            paddingVertical: dp(6),
            columnGap: dp(8),
          },
        ]}
        testID="noor-ai-ask"
      >
        <PressableScale
          onPress={go(NOOR_AI_CHAT_ROUTE)}
          accessibilityRole="button"
          accessibilityLabel={`${copy.prompt.placeholder}. Opens the conversation screen.`}
          style={styles.askField}
          testID="noor-ai-ask-field"
        >
          <ModuleText token="body" color={moduleNeutrals.textTertiary} numberOfLines={1}>
            {copy.prompt.placeholder}
          </ModuleText>
        </PressableScale>

        <PressableScale
          onPress={go(NOOR_AI_CHAT_ROUTE)}
          accessibilityRole="button"
          accessibilityLabel="Ask Noor AI a question"
          style={[
            styles.send,
            {
              width: dp(34),
              height: dp(34),
              borderRadius: dp(17),
              backgroundColor: module.theme.fill,
            },
          ]}
          testID="noor-ai-ask-send"
        >
          <AppIcon name="send" size={dp(16)} color={module.theme.onFill} />
        </PressableScale>
      </View>

      {/* ── Scope and access ──────────────────────────────────────────────── */}
      <ModuleCard
        tinted
        accentBorder
        onPress={go('/ai/permissions')}
        accessibilityLabel={`${copy.privacy.title}. ${copy.privacy.body}. ${copy.privacy.actionLabel}`}
        testID="noor-ai-privacy"
      >
        <View style={[styles.row, { columnGap: dp(10) }]}>
          <View
            style={[
              styles.privacyMark,
              {
                width: dp(38),
                height: dp(38),
                borderRadius: dp(19),
                backgroundColor: module.theme.fill,
              },
            ]}
          >
            <AppIcon name="shield" size={dp(19)} color={module.theme.onFill} />
          </View>
          <View style={styles.flex}>
            <ModuleText token="cardHeading" numberOfLines={2}>
              {copy.privacy.title}
            </ModuleText>
            <ModuleText token="rowMeta" numberOfLines={2}>
              {copy.privacy.body}
            </ModuleText>
            <ModuleText
              token="cardAction"
              color={module.theme.ink}
              numberOfLines={1}
              style={{ marginTop: dp(3) }}
            >
              {copy.privacy.actionLabel} ›
            </ModuleText>
          </View>
          <AppIcon name="chevron-forward" size={dp(16)} color={moduleNeutrals.textTertiary} />
        </View>
      </ModuleCard>
    </View>
  );
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
  askRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: moduleNeutrals.surface,
    borderWidth: 1,
    borderColor: moduleNeutrals.border,
  },
  askField: {
    flex: 1,
    minWidth: 0,
    justifyContent: 'center',
    // Keeps the tap target tall enough without inflating the pill.
    minHeight: 34,
  },
  send: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  privacyMark: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
