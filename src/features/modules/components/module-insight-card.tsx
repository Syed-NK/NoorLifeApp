import { Image, StyleSheet, View } from 'react-native';

import { PressableScale } from '@ds/components';
import { noorLifeAssets } from '@shared/assets/noorlife-assets';

import { useModule } from '../module-context';
import { moduleLayout, moduleNeutrals } from '../module-tokens';
import { useModuleMetrics } from '../use-module-metrics';
import { ModuleText } from './module-text';

export type ModuleInsightCardProps = {
  /** The insight itself, in one or two sentences. */
  readonly message: string;
  /** Action label, e.g. "Ask Faith AI". Defaults to opening the module's AI. */
  readonly actionLabel?: string;
  readonly onPress?: () => void;
  /**
   * A caveat shown beneath the message.
   *
   * Defaults to the module's standing disclaimer, so a Health or Finance insight
   * always carries its qualifier. Pass `null` only where the module has no such
   * requirement.
   */
  readonly disclaimer?: string | null;
  readonly testID?: string;
};

/**
 * The module's AI insight card.
 *
 * ── Why the disclaimer defaults rather than opting in ───────────────────────
 * Health and Finance have a standing disclaimer in their AI policy. An insight is
 * exactly where a caveat gets forgotten — it is generated text presented as a
 * finding. Defaulting to the policy's disclaimer means a Finance insight cannot ship
 * without "educational, not regulated advice" unless someone deliberately passes
 * `null`, which is a visible decision in a review rather than an omission.
 *
 * The card is always attributed: the robot mark plus the assistant's own name, so an
 * AI-generated statement is never mistaken for a recorded fact.
 */
export function ModuleInsightCard({
  message,
  actionLabel,
  onPress,
  disclaimer,
  testID,
}: ModuleInsightCardProps) {
  const module = useModule();
  const { dp } = useModuleMetrics();

  const resolvedDisclaimer =
    disclaimer === null ? undefined : (disclaimer ?? module.ai.standingDisclaimer);
  const label = actionLabel ?? `Ask ${module.ai.label}`;

  return (
    <View
      style={[
        styles.card,
        {
          borderRadius: dp(moduleLayout.cardRadius),
          padding: dp(moduleLayout.cardPadding),
          backgroundColor: module.theme.wellSurface,
          borderColor: module.theme.border,
          rowGap: dp(8),
        },
      ]}
      testID={testID}
    >
      <View style={[styles.headRow, { columnGap: dp(8) }]}>
        <Image
          source={noorLifeAssets.entryAuth.noorAiRobot}
          style={{ width: dp(30), height: dp(30) }}
          resizeMode="contain"
          accessible={false}
        />
        <View style={styles.headText}>
          <ModuleText token="cardTitle" color={module.theme.ink} numberOfLines={1}>
            {module.ai.label}
          </ModuleText>
          <ModuleText token="body" numberOfLines={4}>
            {message}
          </ModuleText>
        </View>
      </View>

      {resolvedDisclaimer === undefined ? null : (
        <ModuleText token="caption" numberOfLines={3}>
          {resolvedDisclaimer}
        </ModuleText>
      )}

      <PressableScale
        onPress={onPress ?? (() => undefined)}
        accessibilityRole="button"
        accessibilityLabel={label}
        style={[
          styles.action,
          {
            minHeight: dp(moduleLayout.minTouchTarget),
            borderRadius: dp(moduleLayout.radiusSmall),
            backgroundColor: module.theme.fill,
            paddingHorizontal: dp(12),
          },
        ]}
        testID={`${testID ?? 'module-insight'}-action`}
      >
        <ModuleText token="button" color={module.theme.onFill} numberOfLines={1}>
          {label}
        </ModuleText>
      </PressableScale>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
  },
  headRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  headText: {
    flex: 1,
    minWidth: 0,
  },
  action: {
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'stretch',
    backgroundColor: moduleNeutrals.surface,
  },
});
