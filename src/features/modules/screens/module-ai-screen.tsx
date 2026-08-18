import { Image, StyleSheet, View } from 'react-native';

import { PressableScale } from '@ds/components';
import { noorLifeAssets } from '@shared/assets/noorlife-assets';

import { ModuleScaffold, ModuleSection, ModuleStatusBanner, ModuleText } from '../components';
import { AI_NAV_INDEX } from '@shared/models/module-theme';
import { useModule } from '../module-context';
import { getModuleDefinition } from '../module-registry';
import { moduleLayout, moduleNeutrals, type FrameworkModuleId } from '../module-tokens';
import { useModuleMetrics } from '../use-module-metrics';

export type ModuleAIScreenProps = {
  readonly moduleId: FrameworkModuleId;
  readonly testID?: string;
};

/**
 * A module's AI screen.
 *
 * ── What it does and does not claim ─────────────────────────────────────────
 * No AI provider SDK is installed and no API key exists in this app, so there is
 * nothing to send a question to. Rather than render a text input that would silently
 * fail, the screen shows what the assistant *is*: its name, what it covers, the
 * questions it will answer, and — verbatim from its policy — the limits it holds and
 * the disclaimer it carries.
 *
 * That makes the module-scoped AI model reviewable now, which is the phase's actual
 * requirement. The suggestion chips are the policy's capabilities, the disclaimer is
 * the policy's `standingDisclaimer`, and the scope line is its `outOfScopeMessage`. If
 * a reviewer disagrees with a boundary, they are reading the same string the
 * orchestrator will enforce.
 */
export function ModuleAIScreen({ moduleId, testID }: ModuleAIScreenProps) {
  const definition = getModuleDefinition(moduleId);
  const activeKey = definition.navigation[AI_NAV_INDEX].key;

  return (
    <ModuleScaffold
      moduleId={moduleId}
      activeKey={activeKey}
      title={definition.ai.label}
      banner={
        <ModuleStatusBanner
          tone="info"
          message={`${definition.ai.label} is not connected yet. This screen shows what it will cover and the limits it keeps.`}
          testID={`${moduleId}-ai-banner`}
        />
      }
      testID={testID ?? `${moduleId}-ai`}
    >
      <ModuleAIBody />
    </ModuleScaffold>
  );
}

/** Split out so it renders inside the scaffold's `ModuleProvider`. */
function ModuleAIBody() {
  const module = useModule();
  const { dp } = useModuleMetrics();
  const policy = module.ai;

  return (
    <View style={{ rowGap: dp(moduleLayout.sectionGap) }}>
      <View
        style={[
          styles.identity,
          {
            borderRadius: dp(moduleLayout.cardRadius),
            padding: dp(moduleLayout.cardPadding),
            backgroundColor: module.theme.lightSurface,
            borderColor: module.theme.border,
            rowGap: dp(6),
          },
        ]}
      >
        <Image
          source={noorLifeAssets.entryAuth.noorAiRobot}
          style={{ width: dp(62), height: dp(62) }}
          resizeMode="contain"
          accessible={false}
        />
        <ModuleText token="stateTitle" align="center" color={module.theme.ink}>
          {policy.label}
        </ModuleText>
        <ModuleText token="stateBody" align="center" numberOfLines={3}>
          {policy.tagline}
        </ModuleText>
      </View>

      {policy.standingDisclaimer === undefined ? null : (
        <ModuleStatusBanner
          tone="warning"
          message={policy.standingDisclaimer}
          testID={`${module.id}-ai-disclaimer`}
        />
      )}

      <ModuleSection
        title="What you can ask"
        subtitle={`${policy.label} answers about your ${module.name} module.`}
        testID={`${module.id}-ai-capabilities`}
      >
        <View style={[styles.chips, { columnGap: dp(8), rowGap: dp(8) }]}>
          {policy.capabilities.map((capability) => (
            <PressableScale
              key={capability.key}
              // Nothing to send yet, so the chip is presentational and says so.
              onPress={() => undefined}
              accessibilityRole="button"
              accessibilityLabel={capability.label}
              accessibilityHint={
                capability.mutatesData
                  ? 'This would change your data, so it will always show a preview and ask you to confirm.'
                  : 'Not available until the assistant is connected.'
              }
              accessibilityState={{ disabled: true }}
              style={[
                styles.chip,
                {
                  borderRadius: dp(moduleLayout.radiusPill),
                  paddingHorizontal: dp(11),
                  paddingVertical: dp(7),
                  minHeight: dp(36),
                  borderColor: module.theme.border,
                },
              ]}
              testID={`${module.id}-ai-chip-${capability.key}`}
            >
              <ModuleText token="caption" color={module.theme.ink} numberOfLines={1}>
                {capability.label}
              </ModuleText>
              {capability.mutatesData ? (
                <ModuleText token="caption" numberOfLines={1}>
                  {' · needs confirming'}
                </ModuleText>
              ) : null}
            </PressableScale>
          ))}
        </View>
      </ModuleSection>

      <ModuleSection
        title="Limits it keeps"
        subtitle="These are enforced, not suggestions."
        testID={`${module.id}-ai-limits`}
      >
        <View
          style={[
            styles.limits,
            {
              borderRadius: dp(moduleLayout.cardRadius),
              padding: dp(moduleLayout.cardPadding),
              rowGap: dp(9),
            },
          ]}
        >
          <View style={{ rowGap: dp(2) }}>
            <ModuleText token="cardTitle" numberOfLines={2}>
              Stays inside {module.name}
            </ModuleText>
            <ModuleText token="body" numberOfLines={3}>
              {policy.outOfScopeMessage} {policy.handoffPrompt}
            </ModuleText>
          </View>

          {policy.safetyRules.map((rule) => (
            <View key={rule.subject} style={{ rowGap: dp(2) }}>
              <ModuleText token="cardTitle" numberOfLines={2}>
                {rule.kind === 'refuse' ? 'Will not: ' : 'Always qualifies: '}
                {rule.subject}
              </ModuleText>
              <ModuleText token="body" numberOfLines={4}>
                “{rule.message}”
              </ModuleText>
            </View>
          ))}
        </View>
      </ModuleSection>
    </View>
  );
}

const styles = StyleSheet.create({
  identity: {
    alignItems: 'center',
    borderWidth: 1,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: moduleNeutrals.surface,
    borderWidth: 1,
  },
  limits: {
    backgroundColor: moduleNeutrals.surface,
    borderWidth: 1,
    borderColor: moduleNeutrals.border,
  },
});
