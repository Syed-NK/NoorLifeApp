import { useRouter, type Href } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { AppIcon, PressableScale } from '@ds/components';
import { minimumHitSlop } from '@shared/utils/a11y';

import { ModuleCard, ModuleCardHeading } from '../components/module-card';
import { ModuleText } from '../components/module-text';
import { useModule } from '../module-context';
import { comingSoon } from '../module-routes';
import { moduleLayout, moduleNeutrals } from '../module-tokens';
import { useModuleMetrics } from '../use-module-metrics';
import { NOOR_AI_CHAT_ROUTE } from './noor-ai-chat-routes';
import { NoorAIHero } from './noor-ai-hero';
import { noorAIHomeFixture } from './noor-ai-view-model';

/**
 * Noor AI's home screen, composed to `02-noor-ai.png`.
 *
 * ── What this replaces ──────────────────────────────────────────────────────
 * A placeholder reading "Noor AI arrives in Phase 2" / "Phase 1 placeholder". Noor AI is not a
 * future feature — it has an approved reference, its own five-slot navigation and its own hero
 * asset, so it is a core module and is now registered as the eighth.
 *
 * Sections follow the reference top to bottom: hero, ask-input, four capability cards, Today's
 * Suggestions, Recent Conversations, and the privacy card. No placeholder copy survives.
 *
 * ── On the input and the chips ──────────────────────────────────────────────
 * The field is a button that opens the conversation surface rather than a live `TextInput` on this
 * screen. It is labelled as such for a screen reader.
 *
 * As of AI-5 that surface exists: the field and the send control both open `/ai/chat/new`, which is
 * **the one approved entry point** to Noor AI's conversation screen. Nothing else in the
 * application opens it — no module screen gained a Noor AI button, the centre navigation control
 * still goes to this home as it always has, and no deep link was registered.
 *
 * The microphone is unchanged and still opens the "coming soon" screen: voice input needs a
 * capability AI-1's server does not have, and §12.8's rule is that AI-5 enables only what can
 * actually be served.
 */
export function NoorAIHomeContent() {
  const router = useRouter();
  const module = useModule();
  const { dp, contentWidth } = useModuleMetrics();
  const model = noorAIHomeFixture;

  const go = (href: Href) => () => router.push(href);
  const soon = (label: string) => () => router.push(comingSoon('noor-ai', label));
  const gap = dp(moduleLayout.featureGap);
  const cardWidth = (contentWidth - gap * 3) / 4;

  /** The four capability cards' real destinations, where one exists. */
  const CAPABILITY_HREF: Partial<Record<string, Href>> = {
    'explain-progress': '/insights',
    'help-plan': '/planner',
    'app-settings': '/settings',
  };

  return (
    <View style={{ rowGap: dp(moduleLayout.sectionGap) }}>
      <NoorAIHero testID="noor-ai-hero" />

      {/* ── Ask input ─────────────────────────────────────────────────────── */}
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
          accessibilityLabel={`${model.prompt.placeholder}. Opens the conversation screen.`}
          style={styles.askField}
          testID="noor-ai-ask-field"
        >
          <ModuleText token="body" color={moduleNeutrals.textTertiary} numberOfLines={1}>
            {model.prompt.placeholder}
          </ModuleText>
        </PressableScale>

        <PressableScale
          onPress={soon('Voice input')}
          accessibilityRole="button"
          accessibilityLabel="Ask by voice"
          hitSlop={minimumHitSlop(dp(24))}
          testID="noor-ai-ask-mic"
        >
          <AppIcon name="microphone" size={dp(20)} color={module.theme.ink} />
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

      {/* ── Four capability cards ─────────────────────────────────────────── */}
      <View style={[styles.grid, { columnGap: gap, rowGap: gap }]} testID="noor-ai-capabilities">
        {model.capabilities.map((capability) => {
          const href = CAPABILITY_HREF[capability.key];
          return (
            <PressableScale
              key={capability.key}
              onPress={href === undefined ? soon(capability.label) : go(href)}
              accessibilityRole="button"
              accessibilityLabel={capability.label}
              style={[
                styles.capability,
                {
                  width: cardWidth,
                  minHeight: dp(moduleLayout.noorAICapabilityHeight),
                  borderRadius: dp(moduleLayout.radiusSmall),
                  rowGap: dp(5),
                  paddingHorizontal: dp(4),
                  paddingVertical: dp(8),
                },
              ]}
              testID={`noor-ai-capability-${capability.key}`}
            >
              <AppIcon name={capability.icon} size={dp(22)} color={module.theme.ink} />
              <ModuleText
                token="tileLabel"
                align="center"
                numberOfLines={2}
                maxFontSizeMultiplier={1.2}
                style={styles.stretch}
              >
                {capability.label}
              </ModuleText>
            </PressableScale>
          );
        })}
      </View>

      {/* ── Today's Suggestions ───────────────────────────────────────────── */}
      <ModuleCard testID="noor-ai-suggestions">
        <ModuleCardHeading
          title={model.suggestions.title}
          actionLabel="View All"
          onAction={soon('All suggestions')}
          testID="noor-ai-suggestions-viewall"
        />
        <View style={{ rowGap: dp(4) }}>
          {model.suggestions.items.map((item) => (
            <PressableScale
              key={item.key}
              onPress={soon(item.title)}
              accessibilityRole="button"
              accessibilityLabel={`${item.title}. ${item.detail}`}
              style={[styles.row, { columnGap: dp(8), minHeight: dp(34) }]}
              testID={`noor-ai-suggestion-${item.key}`}
            >
              <AppIcon name={item.icon} size={dp(18)} color={module.theme.ink} />
              <View style={styles.flex}>
                <ModuleText token="rowLabel" numberOfLines={1}>
                  {item.title}
                </ModuleText>
                <ModuleText token="rowMeta" numberOfLines={1}>
                  {item.detail}
                </ModuleText>
              </View>
              <AppIcon name="chevron-forward" size={dp(14)} color={moduleNeutrals.textTertiary} />
            </PressableScale>
          ))}
        </View>
      </ModuleCard>

      {/* ── Recent Conversations ──────────────────────────────────────────── */}
      <ModuleCard testID="noor-ai-conversations">
        <ModuleCardHeading
          title={model.conversations.title}
          actionLabel="View All"
          onAction={go('/ai/history')}
          testID="noor-ai-conversations-viewall"
        />
        <View style={{ rowGap: dp(4) }}>
          {model.conversations.items.map((item) => (
            <PressableScale
              key={item.key}
              onPress={soon(item.question)}
              accessibilityRole="button"
              accessibilityLabel={`${item.question}, ${item.timestamp}`}
              style={[styles.row, { columnGap: dp(8), minHeight: dp(30) }]}
              testID={`noor-ai-conversation-${item.key}`}
            >
              <AppIcon name="history" size={dp(16)} color={moduleNeutrals.textSecondary} />
              <ModuleText token="rowLabel" numberOfLines={1} style={styles.flex}>
                {item.question}
              </ModuleText>
              <ModuleText token="rowMeta" numberOfLines={1}>
                {item.timestamp}
              </ModuleText>
            </PressableScale>
          ))}
        </View>
      </ModuleCard>

      {/* ── Privacy and access ────────────────────────────────────────────── */}
      <ModuleCard
        tinted
        accentBorder
        onPress={go('/ai/permissions')}
        accessibilityLabel={`${model.privacy.title}. ${model.privacy.body}. ${model.privacy.actionLabel}`}
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
              {model.privacy.title}
            </ModuleText>
            <ModuleText token="rowMeta" numberOfLines={2}>
              {model.privacy.body}
            </ModuleText>
            <ModuleText
              token="cardAction"
              color={module.theme.ink}
              numberOfLines={1}
              style={{ marginTop: dp(3) }}
            >
              {model.privacy.actionLabel} ›
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
  stretch: {
    alignSelf: 'stretch',
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
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  capability: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: moduleNeutrals.surface,
    borderWidth: 1,
    borderColor: moduleNeutrals.border,
  },
  privacyMark: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
