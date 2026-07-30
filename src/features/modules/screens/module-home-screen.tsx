import { useRouter } from 'expo-router';
import { View } from 'react-native';

import {
  ModuleActivityCard,
  ModuleEmptyState,
  ModuleErrorState,
  ModuleFeatureGrid,
  ModuleHeroCard,
  ModuleInsightCard,
  ModuleLoadingState,
  ModuleOfflineState,
  ModuleQuickActionRow,
  ModuleScaffold,
  ModuleSection,
  ModuleSummaryCard,
} from '../components';
import { getModuleDefinition } from '../module-registry';
import { moduleLayout, type FrameworkModuleId } from '../module-tokens';
import type { ModuleRepositoryProvider } from '../services/module-data.contract';
import { useModuleMetrics } from '../use-module-metrics';
import { useModuleOverview } from '../use-module-overview';

export type ModuleHomeScreenProps = {
  readonly moduleId: FrameworkModuleId;
  /** Injectable so the Module Gallery can render each data scenario. */
  readonly provider?: ModuleRepositoryProvider;
  readonly testID?: string;
};

/**
 * A module home, for any module.
 *
 * This is the framework's own proof. There is one screen for seven modules, and
 * everything that differs between them — colour, artwork, copy, destinations,
 * capabilities, which AI answers, what the empty state says — comes from the registry.
 * Adding the eighth module means adding a registry entry and a route file, not writing
 * this again.
 *
 * The body is a `switch` over the load state, so content and skeletons cannot render
 * together, and the offline case cannot be forgotten. Each non-content state gets the
 * module's own copy.
 */
export function ModuleHomeScreen({ moduleId, provider, testID }: ModuleHomeScreenProps) {
  const router = useRouter();
  const { dp } = useModuleMetrics();
  const definition = getModuleDefinition(moduleId);
  const state = useModuleOverview(moduleId, provider);

  // The home is always the first navigation slot for every module.
  const activeKey = definition.navigation[0].key;
  const gap = dp(moduleLayout.sectionGap);

  return (
    <ModuleScaffold
      moduleId={moduleId}
      activeKey={activeKey}
      testID={testID ?? `${moduleId}-home`}
    >
      <View style={{ rowGap: gap }}>
        <ModuleHeroCard testID={`${moduleId}-hero`} />

        <ModuleQuickActionRow testID={`${moduleId}-quick-actions`} />

        {state.status === 'loading' ? <ModuleLoadingState /> : null}

        {state.status === 'offline' ? <ModuleOfflineState onRetry={state.reload} /> : null}

        {state.status === 'failed' ? (
          <ModuleErrorState onRetry={state.reload} developerDetail={state.detail} />
        ) : null}

        {state.status === 'empty' ? (
          <ModuleEmptyState onAction={() => router.push(definition.routes.ai)} />
        ) : null}

        {state.status === 'ready' ? (
          <>
            {state.overview.metrics.length === 0 ? null : (
              <ModuleSection title="At a glance" testID={`${moduleId}-glance`}>
                <ModuleSummaryCard
                  metrics={state.overview.metrics}
                  testID={`${moduleId}-summary`}
                />
              </ModuleSection>
            )}

            {state.overview.activity.length === 0 ? null : (
              <ModuleSection
                title="Today"
                actionLabel="See all"
                onAction={() => router.push(definition.navigation[1].href)}
                testID={`${moduleId}-today`}
              >
                <ModuleActivityCard
                  items={state.overview.activity}
                  testID={`${moduleId}-activity`}
                />
              </ModuleSection>
            )}

            {state.overview.insight === null ? null : (
              <ModuleInsightCard
                message={state.overview.insight}
                onPress={() => router.push(definition.routes.ai)}
                testID={`${moduleId}-insight`}
              />
            )}
          </>
        ) : null}

        <ModuleSection
          title={`All of ${definition.name}`}
          subtitle={definition.summary}
          testID={`${moduleId}-capabilities`}
        >
          <ModuleFeatureGrid testID={`${moduleId}-features`} />
        </ModuleSection>
      </View>
    </ModuleScaffold>
  );
}
