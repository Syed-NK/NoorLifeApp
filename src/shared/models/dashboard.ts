import type { IconName } from './icon';
import type { ModuleId } from '@ds/tokens';

/**
 * Main Home dashboard model.
 *
 * Workflow §5 is the governing rule: "Main Home aggregates data; it does not own
 * module records." Every type here is therefore a read-only *summary* projected
 * from a source module, and each carries the `sourceModule` it came from so a tap
 * can navigate to that module's detail screen instead of editing in place.
 *
 * There is deliberately no create/update/delete shape in this file.
 */

/** A single entry in the "Today at a Glance" timeline. */
export type TimelineEntry = {
  readonly id: string;
  /** Display time, pre-formatted for the user's locale by the source module. */
  readonly time: string;
  readonly title: string;
  readonly icon: IconName;
  /** Which module owns this record. Tapping navigates there. */
  readonly sourceModule: ModuleId;
  /**
   * Row accent — the dot, label and trailing icon colour.
   *
   * Carried per entry rather than derived from `sourceModule` because
   * 04-today-timeline-reference.png uses four visually distinct hues (green, blue,
   * purple, amber), and two of the four rows share a source module. Every value must
   * still be a module-palette colour, so no new colour enters the system.
   */
  readonly accent: string;
};

/** Family check-in completion summary, projected from the Family module. */
export type FamilyCheckInSummary = {
  readonly completed: number;
  readonly total: number;
  /** Short status line, e.g. "complete". */
  readonly statusLabel: string;
};

/** Cross-module progress summary, projected from the Goals module. */
export type OverallProgressSummary = {
  /** 0–100. */
  readonly percentage: number;
  readonly statusLabel: string;
};

/**
 * A Noor AI suggestion shown on Main Home.
 *
 * `scopeLabel` is required, not optional: §06 mandates that AI scope is visible
 * wherever AI output appears, so the type makes an unlabelled insight impossible.
 */
export type AIInsight = {
  readonly id: string;
  readonly message: string;
  readonly scopeLabel: string;
  /** Modules this insight drew on, surfaced to the user (§06 safeguards). */
  readonly accessedModules: readonly ModuleId[];
};

/** A Main Home quick action. Navigates to the owning module — never edits inline. */
export type QuickAction = {
  readonly key: string;
  readonly label: string;
  readonly icon: IconName;
  readonly sourceModule: ModuleId;
};

/**
 * Main Home hero content.
 *
 * Deliberately just eyebrow, title and action. §05 lists next-prayer / tasks-due /
 * family-check-in as *optional* hero micro-metrics, and
 * design-reference/individual-core-screens/01-main-home.png shows none of them —
 * nor a supporting line. Those figures already live in the sections below (the next
 * prayer in the timeline, check-in progress in the summary row), so carrying them
 * here too would be duplicate state with no surface to render it.
 */
export type HeroSummary = {
  readonly eyebrow: string;
  readonly title: string;
  readonly actionLabel: string;
};

export type MainHomeDashboard = {
  readonly hero: HeroSummary;
  readonly timeline: readonly TimelineEntry[];
  readonly familyCheckIn: FamilyCheckInSummary;
  readonly overallProgress: OverallProgressSummary;
  readonly aiInsight: AIInsight;
  readonly quickActions: readonly QuickAction[];
};
