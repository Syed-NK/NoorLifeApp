import { Image, StyleSheet, View } from 'react-native';

import { AppIcon, PressableScale } from '@ds/components';
import { AI_INSIGHT_GEOMETRY, AI_INSIGHT_LINES } from '@ds/components/ai-insight-geometry';
import { getModulePictogram } from '@features/home/module-pictograms';
import { forwardChevron } from '@shared/utils/rtl';

import { useModule } from '../module-context';
import { useModuleMetrics } from '../use-module-metrics';
import { ModuleText } from './module-text';

/**
 * The AI Insight card, for every module.
 *
 * ── One component, one geometry ─────────────────────────────────────────────
 * Main Home's Noor AI Insight card is the dimensional source of truth. Every module now
 * renders this component, which is built entirely from `AI_INSIGHT_GEOMETRY` — the token
 * set asserted equal to `LOCKED.aiInsight` by test. There is no per-module size prop and
 * no way to pass one.
 *
 * ── What replaced what ──────────────────────────────────────────────────────
 * Faith used `ModuleInsightBanner` with a source pill and a three-line body; Health used
 * the same banner with a tiled robot and a disclaimer line; the other five used
 * `ModuleInsightCard`. All three had different heights, and Faith's was the tallest. They
 * are all this now.
 *
 * ── The height is fixed, and that is the point ──────────────────────────────
 * `height`, not `minHeight`. The title is one line and the body two, both ellipsised. A
 * module with more to say does not get a taller card — it gets a destination screen. For
 * Faith that is where the narration's source now lives, which is a better home for it
 * anyway: a source you can read but not act on belongs beside the full text.
 *
 * ── The robot ───────────────────────────────────────────────────────────────
 * `getModulePictogram('noor-ai')` — the same resolver Main Home's `RobotAsset` uses, so
 * the mark is the same file by construction rather than by inspection. Never tinted.
 */

export type ModuleAIInsightCardProps = {
  /**
   * The insight, in the module's own words.
   *
   * At most two lines will show. Write for that: a sentence that needs three lines is a
   * sentence for the destination screen.
   */
  readonly message: string;
  /** Overrides the title. Defaults to "<AI label> Insight", as Main Home renders it. */
  readonly title?: string;
  readonly onPress: () => void;
  readonly testID?: string;
};

export function ModuleAIInsightCard({ message, title, onPress, testID }: ModuleAIInsightCardProps) {
  const module = useModule();
  const { dp } = useModuleMetrics();

  const target = dp(AI_INSIGHT_GEOMETRY.chevronTarget);
  const resolvedTitle = title ?? `${module.ai.label} Insight`;

  return (
    <PressableScale
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${resolvedTitle}: ${message}`}
      accessibilityHint={`Opens ${module.ai.label}`}
      style={[
        styles.card,
        {
          // Fixed, so long copy ellipsises rather than growing the card.
          height: dp(AI_INSIGHT_GEOMETRY.height),
          borderRadius: dp(AI_INSIGHT_GEOMETRY.radius),
          paddingLeft: dp(AI_INSIGHT_GEOMETRY.paddingHorizontal),
          paddingVertical: dp(AI_INSIGHT_GEOMETRY.paddingVertical),
          borderWidth: AI_INSIGHT_GEOMETRY.borderWidth,
          // The only per-module variation: tint and border.
          backgroundColor: module.theme.lightSurface,
          borderColor: module.theme.border,
        },
      ]}
      testID={testID}
    >
      <Image
        source={getModulePictogram('noor-ai')}
        style={{ width: dp(AI_INSIGHT_GEOMETRY.robot), height: dp(AI_INSIGHT_GEOMETRY.robot) }}
        resizeMode="contain"
        accessible={false}
        testID={`${testID ?? 'module-ai-insight'}-robot`}
      />

      <View style={[styles.textColumn, { marginLeft: dp(AI_INSIGHT_GEOMETRY.paddingHorizontal) }]}>
        <ModuleText
          token="aiInsightTitle"
          color={module.theme.ink}
          numberOfLines={AI_INSIGHT_LINES.title}
          testID={`${testID ?? 'module-ai-insight'}-title`}
        >
          {resolvedTitle}
        </ModuleText>
        <ModuleText
          token="aiInsightBody"
          numberOfLines={AI_INSIGHT_LINES.body}
          testID={`${testID ?? 'module-ai-insight'}-body`}
        >
          {message}
        </ModuleText>
      </View>

      <View style={[styles.chevron, { width: target, height: target }]}>
        <AppIcon
          name={forwardChevron()}
          size={dp(AI_INSIGHT_GEOMETRY.chevronIcon)}
          color={module.theme.ink}
        />
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
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
