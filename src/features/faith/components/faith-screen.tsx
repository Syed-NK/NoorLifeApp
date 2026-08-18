import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { View } from 'react-native';

import {
  ModuleEmptyState,
  ModuleErrorState,
  ModuleLoadingState,
  ModuleOfflineState,
  ModulePermissionState,
  ModuleScaffold,
  ModuleStatusBanner,
} from '@features/modules/components';
import { getModuleDefinition } from '@features/modules/module-registry';
import { moduleLayout } from '@features/modules/module-tokens';
import { useModuleMetrics } from '@features/modules/use-module-metrics';

import type { FaithNavKey } from '../faith-routes';
import type { UseFaithResource } from '../hooks/use-faith-resource';
import { FaithNoResultsState, FaithStaleBanner } from './faith-states';

/**
 * The frame every Faith sub-screen is built in.
 *
 * ── Why not `ModuleSectionScreen` ───────────────────────────────────────────
 * That component is the shared framework's *placeholder* — it renders a hero, an "arrives
 * with the full release" banner and an empty state, deliberately inventing no content. It
 * proved the shell held together, which was the previous phase's job.
 *
 * This phase's job is the opposite: real content, real states, real data. So Faith gets
 * its own scaffold, built on the same shared `ModuleScaffold` — identical header,
 * navigation, theming and safe-area handling — with a body driven by a `FaithResult`
 * rather than a fixed placeholder. Nothing about the approved visual language changes;
 * what changes is that the body is now a function of data.
 *
 * ── The eight states, in one place ──────────────────────────────────────────
 * Loading, empty, error, offline, slow-network, no-results, permission-required and
 * success are all handled here rather than in each screen. That is what makes "every
 * Faith data screen supports all eight" checkable: a screen that renders through
 * `FaithScreen` cannot omit one, because it does not write them.
 */

export type FaithScreenProps = {
  readonly title: string;
  readonly activeKey: FaithNavKey;
  /** Optional banner above the scroll region — a source notice, a staleness warning. */
  readonly banner?: ReactNode;
  /** Overrides Back. Defaults to the shared "return to Main Home" behaviour. */
  readonly onBack?: () => void;
  readonly scrollable?: boolean;
  readonly children: ReactNode;
  readonly testID: string;
};

export function FaithScreen({
  title,
  activeKey,
  banner,
  onBack,
  scrollable = true,
  children,
  testID,
}: FaithScreenProps) {
  return (
    <ModuleScaffold
      moduleId="faith"
      activeKey={activeKey}
      title={title}
      onBack={onBack}
      scrollable={scrollable}
      banner={banner}
      testID={testID}
    >
      {children}
    </ModuleScaffold>
  );
}

export type FaithResourceViewProps<T> = {
  readonly resource: UseFaithResource<T>;
  /** Rendered for `ok` and, with a staleness banner above it, for `stale`. */
  readonly children: (data: T) => ReactNode;
  /** Copy for the `empty` case. Every screen supplies its own — generic copy helps nobody. */
  readonly empty: { readonly title: string; readonly body: string; readonly actionLabel?: string };
  readonly onEmptyAction?: () => void;
  /** Skeleton row count while loading. */
  readonly loadingRows?: number;
  readonly testID: string;
};

/**
 * Renders a `FaithResult` as the correct state.
 *
 * Exhaustive over the union by construction: the switch has no `default`, so adding a
 * result kind produces a type error here rather than an unhandled blank screen.
 */
export function FaithResourceView<T>({
  resource,
  children,
  empty,
  onEmptyAction,
  loadingRows = 3,
  testID,
}: FaithResourceViewProps<T>) {
  const router = useRouter();
  const { dp } = useModuleMetrics();
  const definition = getModuleDefinition('faith');

  if (resource.status === 'loading') {
    return <ModuleLoadingState rows={loadingRows} testID={`${testID}-loading`} />;
  }

  const { result } = resource;

  switch (result.kind) {
    case 'ok':
      return <>{children(result.data)}</>;

    case 'stale':
      return (
        <View style={{ rowGap: dp(moduleLayout.sectionGap) }}>
          <FaithStaleBanner
            cachedAt={result.cachedAt}
            onRefresh={resource.reload}
            testID={testID}
          />
          {children(result.data)}
        </View>
      );

    case 'empty':
      return (
        <ModuleEmptyState
          title={empty.title}
          body={empty.body}
          actionLabel={empty.actionLabel ?? `Ask ${definition.ai.label}`}
          onAction={onEmptyAction ?? (() => router.push(definition.routes.ai))}
          testID={`${testID}-empty`}
        />
      );

    case 'no-results':
      return <FaithNoResultsState query={result.query} testID={testID} />;

    case 'offline':
      return <ModuleOfflineState onRetry={resource.reload} testID={`${testID}-offline`} />;

    case 'permission-required':
      return (
        <ModulePermissionState
          permission={{
            key: result.permission === 'location' ? 'location' : 'notifications',
            title: result.permission === 'location' ? 'Location access' : 'Notification permission',
            rationale: result.rationale,
            required: false,
          }}
          onGrant={resource.reload}
          onSkip={() => router.back()}
          testID={`${testID}-permission`}
        />
      );

    case 'error':
      return (
        <ModuleErrorState
          onRetry={resource.reload}
          developerDetail={result.detail ?? result.code}
          testID={`${testID}-error`}
        />
      );
  }
}

/**
 * The "slow network" state.
 *
 * Rendered by a screen that has been loading past a threshold rather than by the result
 * union, because slowness is a property of elapsed time, not of an answer. Screens that
 * fetch over the network use `useSlowNetworkNotice` to decide when to show it.
 */
export function FaithSlowNetworkBanner({ testID }: { readonly testID: string }) {
  return (
    <ModuleStatusBanner
      tone="warning"
      message="This is taking longer than usual. Your connection may be slow."
      testID={`${testID}-slow`}
    />
  );
}

/** Success feedback after a write. Dismissible, never blocking. */
export function FaithSuccessBanner({
  message,
  onDismiss,
  testID,
}: {
  readonly message: string;
  readonly onDismiss: () => void;
  readonly testID: string;
}) {
  return (
    <ModuleStatusBanner
      tone="success"
      message={message}
      onDismiss={onDismiss}
      testID={`${testID}-success`}
    />
  );
}
