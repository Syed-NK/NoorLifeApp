import type { FrameworkModuleId } from '@features/modules/module-tokens';

/**
 * Which Main Home surfaces are paid, and which module answers for each.
 *
 * ── Why this is not written into the components ─────────────────────────────
 * A timeline row and a quick action both carry their own `sourceModule` in the dashboard model, so
 * they need nothing here. The bottom navigation does not: `NavItem` is a key, a label, an icon and
 * an `Href`, and adding an entitlement field to it would put subscription policy into the shared
 * module-theme contract that all eight modules read.
 *
 * So the mapping lives here instead, and the navigation component asks it. That keeps
 * `home-bottom-navigation.tsx` — a reopened design-locked file — free of any knowledge about which
 * plan includes what, and keeps the answer in one greppable place.
 */

/**
 * The navigation destinations that need a subscription, and the module whose entitlement decides.
 *
 * Insights is Goals-powered: it is the cross-module progress surface, and Goals is the module that
 * owns progress reporting. Naming Goals rather than inventing an "insights" entitlement means the
 * tab and the Goals module can never disagree, and the upgrade sheet has a real module — with a real
 * pictogram and a real value statement — to describe.
 *
 * Home, Modules and Profile are absent deliberately. Modules in particular stays open on every plan:
 * a user has to be able to see what NoorLife includes, both what they have and what they do not.
 * Noor AI is absent because it is not premium at all — it is scope-limited on the free plan, which
 * `useNoorAIScope` answers, not this table.
 */
export const PREMIUM_NAV_MODULES: Readonly<Partial<Record<string, FrameworkModuleId>>> = {
  insights: 'goals',
} as const;

/**
 * Where an upgrade request came from.
 *
 * `UpgradeRequest.source` is diagnostic and never shown to the user, so the values matter only in
 * being stable and distinct — which is exactly why they are declared once rather than typed at each
 * call site, where a typo would be invisible.
 */
export const UPGRADE_SOURCES = {
  /** A locked tile in the eight-module grid. */
  moduleGrid: 'module_grid',
  /** A locked row inside Today at a Glance. */
  todayTimeline: 'today_timeline',
  /** Today at a Glance's own "View All". */
  todayTimelineViewAll: 'today_timeline_view_all',
  /** Either summary card. */
  homeSummary: 'home_summary',
  /** Any of the three quick actions. */
  quickAction: 'quick_action',
  /** The Insights tab. */
  bottomNavigation: 'bottom_navigation',
} as const;
