import { StyleSheet, View } from 'react-native';

import { AppIcon, PressableScale } from '@ds/components';
import { modulePalettes, neutralColors } from '@ds/tokens';
import type { AIInsight } from '@shared/models/dashboard';
import type { ModuleTheme } from '@shared/models/module-theme';
import { forwardChevron } from '@shared/utils/rtl';

import { LOCKED } from '../main-home-metrics';
import { useMetrics } from '../main-home-metrics-context';
import { HomeText } from './home-text';
import { RobotAsset } from './robot-asset';

/**
 * Card fill and border, locked by implementation-lock §11.
 *
 * These two values are not in the design-spec token tables — they are a lighter
 * violet tint and hairline than the Noor AI `soft` (`#F0EDFF`). They are recorded
 * here as locked additions rather than being folded into the global palette, since
 * they belong to this one card.
 */
const INSIGHT_BACKGROUND = '#F7F5FF';
const INSIGHT_BORDER = '#DCD7FF';

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
 * Locked geometry: 68 dp tall, 14 dp radius, `#F7F5FF` fill, 1 dp `#DCD7FF` border,
 * a 50 dp robot asset, title 11/15 w600 `#473A9E`, body 10.5/14 over at most two
 * lines, and a 44 dp chevron touch target.
 *
 * Locked body text: `You have a free 30-minute window at 4 PM.`
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
 */
export function AIInsightCard({ insight, theme, onPress, testID }: AIInsightCardProps) {
  const { dp } = useMetrics();
  const chevronTarget = dp(LOCKED.aiInsight.chevronTarget);

  return (
    <PressableScale
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${theme.aiLabel} insight: ${insight.message}. Scope: ${insight.scopeLabel}.`}
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
          {insight.message}
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
