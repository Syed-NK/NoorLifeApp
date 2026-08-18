import type { ModuleActivityItem } from '../components/module-activity-card';
import type { ModuleSummaryMetric } from '../components/module-summary-card';
import type { FrameworkModuleId } from '../module-tokens';

/**
 * The data contract every module repository satisfies.
 *
 * ── Why this exists before there is any data ────────────────────────────────
 * The module screens need a shape to render, and the phase brief forbids creating
 * production tables before each module's data model is reviewed. The resolution is
 * this interface: screens depend on it, a mock implements it now, and a Supabase
 * implementation replaces the mock later without a screen changing. Nothing here
 * implies a table — it is the *view* a module home needs, which is not the same thing
 * as its storage schema.
 *
 * Every method returns a `ModuleDataResult` rather than throwing. A module screen has
 * four legitimate outcomes — content, nothing yet, offline, failed — and a thrown
 * error collapses the last three into one. Making them a union means the caller
 * cannot render an error screen for an empty account, which is a mistake that reads to
 * the user as "your data is gone".
 */

/** A module home's rendering payload. */
export type ModuleOverview = {
  readonly moduleId: FrameworkModuleId;
  /** Headline figures for the summary card. Empty when there is nothing to summarise. */
  readonly metrics: readonly ModuleSummaryMetric[];
  /** Recent or upcoming activity. Empty for a new account. */
  readonly activity: readonly ModuleActivityItem[];
  /** One AI observation, or null when there is not enough data to say anything. */
  readonly insight: string | null;
  /** When the data was produced, as an ISO string. Null for never-synced. */
  readonly generatedAt: string | null;
};

/**
 * The outcome of a module data request.
 *
 * `empty` is distinct from `ok` with no rows, because the two render differently: the
 * first shows the module's onboarding copy, the second an unpopulated but working
 * screen.
 */
export type ModuleDataResult<T> =
  | { readonly kind: 'ok'; readonly data: T }
  | { readonly kind: 'empty' }
  | { readonly kind: 'offline' }
  | {
      readonly kind: 'error';
      /** Stable code for the caller to branch on. Never a provider message. */
      readonly code: 'unavailable' | 'unauthorized' | 'timeout' | 'unknown';
      /** Developer-facing detail. Logged in development only, never shown as-is. */
      readonly detail?: string;
    };

/**
 * A module's data source.
 *
 * Deliberately narrow. Each module will grow its own repository with module-specific
 * queries; what belongs *here* is only what the shared framework renders, so the
 * framework never depends on a module's specifics.
 */
export type ModuleRepository = {
  readonly moduleId: FrameworkModuleId;
  /** Everything a module home needs, in one call. */
  getOverview(): Promise<ModuleDataResult<ModuleOverview>>;
};

/** Resolves the repository for a module. Swapped wholesale when Supabase arrives. */
export type ModuleRepositoryProvider = (moduleId: FrameworkModuleId) => ModuleRepository;
