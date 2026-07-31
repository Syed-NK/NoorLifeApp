import { useRouter } from 'expo-router';
import { View } from 'react-native';

import {
  ModuleActivityCard,
  ModuleAIInsightCard,
  ModuleEmptyState,
  ModuleErrorState,
  ModuleFeatureGrid,
  ModuleHeroCard,
  ModuleLoadingState,
  ModuleOfflineState,
  ModuleQuickActionRow,
  ModuleScaffold,
  ModuleSection,
  ModuleSummaryCard,
} from '../components';
import { ModuleHomeComposition, hasApprovedComposition } from '../module-compositions';
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
 * ── Shared shell, module-specific composition ───────────────────────────────
 * The shell is the same for all seven: scaffold, header, five-slot navigation, theme,
 * type. What goes *between* them is not. A module with an approved
 * individual-core-screen reference supplies its own composition through
 * `getModuleHomeContent`, and this screen renders it verbatim.
 *
 * The generic layout below is the fallback for the five modules whose references have not
 * been implemented yet. It was previously the layout for all seven, which is what made
 * every module look like the same screen in a different colour — the thing Phase 4A
 * corrects. It is kept, not deleted, because those five routes must keep working.
 *
 * The fallback's body is a `switch` over the load state, so content and skeletons cannot
 * render together and the offline case cannot be forgotten.
 */
export function ModuleHomeScreen({ moduleId, provider, testID }: ModuleHomeScreenProps) {
  const router = useRouter();
  const { dp } = useModuleMetrics();
  const definition = getModuleDefinition(moduleId);
  const state = useModuleOverview(moduleId, provider);
  const composed = hasApprovedComposition(moduleId);

  /*
   * The slot whose destination *is* this screen.
   *
   * For seven modules that is the first slot. Noor AI is the exception: its home and its AI
   * destination are both `/ai`, so slot one points at Main Home and the AI slot is the one to
   * highlight. Matching on the href rather than hard-coding an index gets both cases right.
   */
  const activeKey =
    definition.navigation.find((item) => item.href === definition.routes.home)?.key ??
    definition.navigation[0].key;
  const gap = dp(moduleLayout.sectionGap);

  if (composed) {
    return (
      <ModuleScaffold
        moduleId={moduleId}
        activeKey={activeKey}
        isModuleHome
        testID={testID ?? `${moduleId}-home`}
      >
        <ModuleHomeComposition moduleId={moduleId} />
      </ModuleScaffold>
    );
  }

  return (
    <ModuleScaffold
      moduleId={moduleId}
      activeKey={activeKey}
      isModuleHome
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
              <ModuleAIInsightCard
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
