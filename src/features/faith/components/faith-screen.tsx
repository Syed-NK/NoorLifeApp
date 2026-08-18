import { useRouter } from 'expo-router';
import type { ReactNode, RefObject } from 'react';
import { ScrollView, View } from 'react-native';

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
import {
  FaithNoResultsState,
  FaithProviderLockedState,
  FaithRefreshingNotice,
  FaithStaleBanner,
} from './faith-states';

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
  /**
   * With `scrollable={false}`, lets the body claim the viewport instead of being centred in it.
   *
   * Used by the two catalogue selectors, which own a `FlatList` and therefore need a bounded height
   * to virtualize against. See `ModuleScaffold`'s own note for why a centred static body cannot
   * provide one.
   */
  readonly fills?: boolean;
  /**
   * A panel pinned above the bottom navigation — the Qur'an reader's audio transport.
   *
   * Passed straight through to `ModuleScaffold`, which docks it and reserves scroll padding equal to
   * its measured height so it can never cover the last verse. See that prop's note.
   */
  readonly docked?: ReactNode;
  /**
   * A handle on the scaffold's scroll region.
   *
   * The reader uses it to bring the verse being recited into view. Passed through rather than
   * re-created here, because the scroll region belongs to `ModuleScaffold` — see that prop's note.
   */
  readonly scrollRef?: RefObject<ScrollView | null>;
  /**
   * Overrides the breathing room under the last card. Passed straight through — see that prop's note.
   *
   * Only Prayer Times supplies it, and only once it has measured itself as fitting its viewport.
   */
  readonly scrollBottomInset?: number;
  /**
   * Replaces the page background. Passed straight to `ModuleScaffold` — see that prop's note.
   *
   * Only the Qur'an reader supplies it, and only with `readerPageBackground`.
   */
  readonly background?: string;
  readonly children: ReactNode;
  readonly testID: string;
};

export function FaithScreen({
  title,
  activeKey,
  banner,
  onBack,
  scrollable = true,
  fills = false,
  docked,
  scrollRef,
  scrollBottomInset,
  background,
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
      fills={fills}
      banner={banner}
      docked={docked}
      scrollRef={scrollRef}
      scrollBottomInset={scrollBottomInset}
      background={background}
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
  /**
   * What the permission state's Grant control does.
   *
   * ── Why this had to become a prop ───────────────────────────────────────────
   * It defaulted to `resource.reload`, which re-ran a request that would fail for exactly the same
   * reason it failed the first time. The user pressed "Grant", nothing prompted, and the same screen
   * came back — a control that looks like it asks the OS for something and does not.
   *
   * A screen that can genuinely raise a prompt passes one here. The reload default is kept for the
   * screens whose blocked permission is not one this app can request.
   */
  readonly onGrantPermission?: () => void;
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
  onGrantPermission,
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
      /**
       * Content, with a thin line above it while it is being refreshed.
       *
       * Not a skeleton and not a modal: the data below is real, current enough to read, and the user
       * did not ask to stop reading it. The refresh indication is the whole visible difference
       * between "refreshing" and "loading", and it is deliberately the smallest one that is still
       * honest — a screen that refreshed with no indication at all would change its content under
       * the reader with no explanation.
       */
      return resource.refreshing ? (
        <View style={{ rowGap: dp(moduleLayout.sectionGap) }}>
          <FaithRefreshingNotice testID={testID} />
          {children(result.data)}
        </View>
      ) : (
        <>{children(result.data)}</>
      );

    case 'stale':
      return (
        <View style={{ rowGap: dp(moduleLayout.sectionGap) }}>
          {resource.refreshing ? (
            <FaithRefreshingNotice testID={testID} />
          ) : (
            <FaithStaleBanner
              cachedAt={result.cachedAt}
              onRefresh={resource.reload}
              testID={testID}
            />
          )}
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
          onGrant={onGrantPermission ?? resource.reload}
          onSkip={() => router.back()}
          testID={`${testID}-permission`}
        />
      );

    /**
     * ── One `error` kind, four different truths ───────────────────────────────
     * Every code used to land on the module's default error copy: *"Couldn't load your Faith data.
     * The connection dropped on our side."* — under a **Try again** button. For a timeout that is
     * accurate. For the three codes below it is not, and the inaccuracy is the app asserting a cause
     * it has not established.
     *
     * Seen on the emulator: a signed-out install opened the Qur'an list and was told the connection
     * had dropped on NoorLife's side. Nothing had dropped. There was no session, so the adapter
     * answered `unauthorized`, and the screen reported a server fault instead — inventing an outage
     * and blaming it on the one party the user cannot check.
     *
     * `not-configured` is worse still, because `FaithErrorCode`'s own definition already says why:
     * "a screen that said 'try again' would be advising a user to retry something that cannot
     * succeed until somebody sets an environment variable". The rule was written down and the
     * rendering did the opposite — the retry button was there, and it could never work.
     *
     * So the two terminal codes get the terminal state this module already has, with no action,
     * matching the locked Hadith, Dua and Mosque screens; `unauthorized` names the real cause and
     * keeps a retry, which genuinely succeeds once the user signs in. Everything else — a timeout, a
     * rate limit, an outage, an unknown — keeps the retryable copy, which for those is true.
     */
    case 'error':
      switch (result.code) {
        case 'not-configured':
          return (
            <FaithProviderLockedState
              icon="lock"
              title="Not connected to a source"
              body="This build has no content provider configured, so there is nothing to load. This is not a fault on your device or your connection, and retrying cannot change it — it needs setting up on NoorLife's side."
              testID={testID}
            />
          );

        case 'unsupported':
          return (
            <FaithProviderLockedState
              icon="info"
              title="Not available from this source"
              body="NoorLife's approved source does not offer this, so there is nothing to show. It is not missing because of an error, and it will appear only if the source is extended to cover it."
              testID={testID}
            />
          );

        case 'unauthorized':
          return (
            <ModuleErrorState
              title="Sign in to load this"
              body="This content is fetched with your account, and this device has no signed-in session. Sign in, then try again — nothing is wrong with your connection."
              onRetry={resource.reload}
              developerDetail={result.detail ?? result.code}
              testID={`${testID}-error`}
            />
          );

        default:
          return (
            <ModuleErrorState
              onRetry={resource.reload}
              developerDetail={result.detail ?? result.code}
              testID={`${testID}-error`}
            />
          );
      }
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
