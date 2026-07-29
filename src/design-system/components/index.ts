/**
 * NoorLife design-system primitives.
 *
 * Everything a feature screen needs is exported here. Features must import from
 * `@ds/components` rather than reaching into individual files, so the public
 * surface of the design system stays visible in one place.
 *
 * The set covers the §5 "components to build once" list required for Phase 1.
 * Deferred to later phases (not needed by the foundation or the Main Home proof
 * screen): TextField, SegmentedControl, PlanCard, PermissionSheet,
 * ConfirmationDialog.
 */

export { ActionTile, type ActionTileProps } from './action-tile';
export { AppIcon, type AppIconProps } from './app-icon';
export { AppScreen, type AppScreenProps } from './app-screen';
export { GlobalTopBar, type GlobalTopBarProps } from './global-top-bar';
export { HeroCard, type HeroCardProps, type HeroMicroMetric } from './hero-card';
export { ListRow, type ListRowProps } from './list-row';
export { MetricCard, type MetricCardProps } from './metric-card';
export {
  ModuleBottomNavigation,
  type ModuleBottomNavigationProps,
} from './module-bottom-navigation';
export { ModuleTopBar, type ModuleTopBarProps } from './module-top-bar';
export { Pill, type PillProps } from './pill';
export { PressableScale, type PressableScaleProps } from './pressable-scale';
export { PrimaryButton, type PrimaryButtonProps } from './primary-button';
export { ProgressBar, type ProgressBarProps } from './progress-bar';
export { ProgressRing, type ProgressRingProps } from './progress-ring';
export { RobotAIButton, type RobotAIButtonProps } from './robot-ai-button';
export { SecondaryButton, type SecondaryButtonProps } from './secondary-button';
export { SectionHeader, type SectionHeaderProps } from './section-header';
export { SkeletonCard, type SkeletonCardProps } from './skeleton-card';
export { StateView, type StateViewProps } from './state-view';
export { SurfaceCard, type SurfaceCardProps } from './surface-card';
