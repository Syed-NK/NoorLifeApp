/**
 * The shared module component set.
 *
 * Every module screen is composed from these and nothing else. `ModuleStateView` is
 * deliberately absent: it is the internal base the five state components are built
 * on, and exposing it would make it possible to build an "error" that looks like an
 * empty state.
 */

export { ModuleScaffold, type ModuleScaffoldProps } from './module-scaffold';
export { ModuleHeader, type ModuleHeaderProps } from './module-header';
export { ModuleHeroCard, type ModuleHeroCardProps } from './module-hero-card';
export { ModuleSection, ModuleDivider, type ModuleSectionProps } from './module-section';
export { ModuleFeatureGrid, type ModuleFeatureGridProps } from './module-feature-grid';
export {
  ModuleActivityCard,
  type ModuleActivityCardProps,
  type ModuleActivityItem,
  type ModuleActivityStatus,
} from './module-activity-card';
export {
  ModuleSummaryCard,
  type ModuleSummaryCardProps,
  type ModuleSummaryMetric,
  type ModuleTrend,
} from './module-summary-card';
export { ModuleInsightCard, type ModuleInsightCardProps } from './module-insight-card';
export {
  ModuleQuickAction,
  ModuleQuickActionRow,
  type ModuleQuickActionProps,
  type ModuleQuickActionRowProps,
} from './module-quick-action';
export {
  ModuleBottomNavigation,
  type ModuleBottomNavigationProps,
} from './module-bottom-navigation';
export {
  ModuleAICenterButton,
  type ModuleAICenterButtonProps,
} from './module-ai-center-button';
export { ModuleEmptyState, type ModuleEmptyStateProps } from './module-empty-state';
export { ModuleLoadingState, type ModuleLoadingStateProps } from './module-loading-state';
export { ModuleErrorState, type ModuleErrorStateProps } from './module-error-state';
export { ModuleOfflineState, type ModuleOfflineStateProps } from './module-offline-state';
export {
  ModulePermissionState,
  type ModulePermissionStateProps,
} from './module-permission-state';
export {
  ModuleSkeleton,
  ModuleSkeletonGroup,
  type ModuleSkeletonProps,
  type ModuleSkeletonGroupProps,
} from './module-skeleton';
export {
  ModuleStatusBanner,
  type ModuleStatusBannerProps,
  type ModuleStatusTone,
} from './module-status-banner';
export { ModuleText, type ModuleTextProps } from './module-text';
