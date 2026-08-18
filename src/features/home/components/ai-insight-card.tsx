import { StyleSheet, View } from 'react-native';

import { AppIcon, PressableScale } from '@ds/components';
import { modulePalettes, neutralColors } from '@ds/tokens';
import { useNoorAIScope } from '@features/subscription/use-noor-ai-scope';
import type { AIInsight } from '@shared/models/dashboard';
import type { ModuleTheme } from '@shared/models/module-theme';
import { forwardChevron } from '@shared/utils/rtl';

import { INSIGHT_BACKGROUND, INSIGHT_BORDER } from '../ai-insight-theme';
import { LOCKED } from '../main-home-metrics';
import { useMetrics } from '../main-home-metrics-context';
import { HomeText } from './home-text';
import { RobotAsset } from './robot-asset';

export type AIInsightCardProps = {
  readonly insight: AIInsight;
  /** The AI theme — `noor-ai` on Main Home. */
  readonly theme: ModuleTheme;
  readonly onPress: () => void;
  readonly testID?: string;
};

/**
 * The Noor AI insight card, locked by implementation-lock §11 and
 * 06-ai-quick-actions-reference.png.
 *
 * Locked geometry: 68 dp tall, 14 dp radius, the approved violet fill and 1 dp hairline
 * from `ai-insight-theme.ts`, a 50 dp robot asset, title 11/15 w600 in the Noor AI dark,
 * body 10.5/14 over at most two lines, and a 44 dp chevron touch target.
 *
 * (The measurements are named here rather than the colours: this file is on the reopened
 * list, which is held to sourcing every colour from a token rather than spelling one out,
 * and the scan is textual — so quoting a value in a comment would fail it too.)
 *
 * Locked body text on a paid plan: `You have a free 30-minute window at 4 PM.`
 *
 * The robot comes from the asset slot, never from primitives (§2).
 *
 * `AIInsight.scopeLabel` is a required field, so an insight cannot reach this card
 * without a scope. The reference shows no scope chip here and §11 does not list one,
 * so the scope is announced in the accessibility label rather than drawn — design
 * spec §06's visible-scope rule governs the AI composer, not this summary.
 *
 * The card only ever *reads*. Any AI action that would change data must show a
 * preview and require confirmation, which is a later phase.
 *
 * ── Phase 6B: Noor AI is scope-limited on the free plan, never locked ───────
 * Noor AI is included on every plan, so this card carries no lock badge, no scrim and no upgrade
 * prompt — tapping it opens Noor AI for a free user exactly as it does for a subscriber. The card is
 * pixel-identical in both states: same 68 dp height, same radius, fill, border, robot, chevron and
 * type ramp. Only two strings differ.
 *
 * What differs is the *subject*. The paid insight — "You have a free 30-minute window at 4 PM" — is
 * a statement about a Planner schedule, and a free user has no Planner. So the free card describes
 * what Noor AI can actually do for them instead, and announces the narrower scope it is working in.
 *
 * That copy is a consequence of the scope, not the mechanism: `useNoorAIScope` derives the mode from
 * the authoritative entitlement and produces the `permittedModules` every Noor AI request is checked
 * against, so the boundary holds whether or not anyone reads the card.
 */
export function AIInsightCard({ insight, theme, onPress, testID }: AIInsightCardProps) {
  const { dp } = useMetrics();
  const { limitedInsightBody, scopeLabel } = useNoorAIScope();
  const chevronTarget = dp(LOCKED.aiInsight.chevronTarget);

  // Both null on a paid plan, so the personalized insight is what renders.
  const message = limitedInsightBody ?? insight.message;
  const scope = scopeLabel ?? insight.scopeLabel;

  return (
    <PressableScale
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${theme.aiLabel} insight: ${message}. Scope: ${scope}.`}
      accessibilityHint={`Opens ${theme.aiLabel}`}
      style={[
        styles.card,
        {
          height: dp(LOCKED.aiInsight.height),
          borderRadius: dp(LOCKED.aiInsight.radius),
          paddingLeft: dp(LOCKED.aiInsight.paddingHorizontal),
          paddingVertical: dp(LOCKED.aiInsight.paddingVertical),
        },
      ]}
      testID={testID}
    >
      <RobotAsset size={dp(LOCKED.aiInsight.robot)} testID={`${testID ?? 'ai-insight'}-robot`} />

      <View style={[styles.textColumn, { marginLeft: dp(LOCKED.aiInsight.paddingHorizontal) }]}>
        <HomeText token="aiTitle" color={modulePalettes['noor-ai'].dark} numberOfLines={1}>
          {theme.aiLabel} Insight
        </HomeText>
        <HomeText token="aiBody" color={neutralColors.textPrimary} numberOfLines={2}>
          {message}
        </HomeText>
      </View>

      <View style={[styles.chevron, { width: chevronTarget, height: chevronTarget }]}>
        <AppIcon name={forwardChevron()} size={dp(18)} color={modulePalettes['noor-ai'].primary} />
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: INSIGHT_BACKGROUND,
    borderWidth: 1,
    borderColor: INSIGHT_BORDER,
    overflow: 'hidden',
  },
  textColumn: {
    flex: 1,
    minWidth: 0,
  },
  chevron: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
