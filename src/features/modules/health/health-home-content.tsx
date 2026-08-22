import { View } from 'react-native';

import {
  ModuleErrorState,
  ModuleFeatureGrid,
  ModuleLoadingState,
  ModuleOfflineState,
  ModuleStatusBanner,
} from '../components';
import { moduleLayout } from '../module-tokens';
import type { UseModuleOverview } from '../use-module-overview';
import { useModuleMetrics } from '../use-module-metrics';
import { HealthHero } from './health-hero';

/**
 * **Health's home, claiming nothing about anybody's health and promising nothing it cannot do.**
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── What this screen used to say (issue #27) ───────────────────────────────
 * Every value on it came from `healthHomeFixture`, whose own docblock read "Nothing here is live":
 * a wellness score of 86 over a progress ring; 7,542 steps, 7h 15m sleep, 6 cups of water, mood
 * "Good"; a "Medication Reminder" reading *Vitamin D · 8:00 AM · Taken*; a "Weekly Trend" chart
 * asserting activity was trending up; three timestamped "Recent Activity" rows; two "Today's Focus"
 * suggestions; and an AI insight praising the user's activity.
 *
 * There is no health data layer in this codebase — no repository, no provider, no storage namespace.
 * The medication row was the serious one: it told a user the application had recorded a dose of a
 * named supplement at a time.
 *
 * ── The second correction: a route is not a feature ────────────────────────
 * The first pass replaced all of that with the framework's empty state — *"No entries yet — Log one
 * thing today"* — and a hero reading *"Start with one entry / Nothing is tracked until you log it. /
 * Log your first entry"*. Truthful about data and **untruthful about capability**: `/health/log`
 * exists, but it renders the framework's section screen, which says the destination arrives with the
 * module's full release. Nothing can be logged. So the screen had stopped inventing readings and
 * started inventing a feature.
 *
 * "No entries yet" is only honest when an entry is *possible*. With no way to create one it reads as
 * the user's own omission — which is worse than a wrong number, because it assigns blame for it.
 *
 * So the state here is **not configured**, not empty:
 *
 *   • the hero states plainly that tracking is not available yet, and offers no action;
 *   • one status banner says the same in the body, before anything invites a tap;
 *   • Track, Trends and Records are marked unavailable in the capability grid, which greys them,
 *     disables them and announces "not available yet" with the reason as a hint — *before* the tap
 *     rather than after it;
 *   • the quick-action row is gone. It has no unavailable affordance, so a "Log entry" tile there
 *     would be an unqualified invitation to a placeholder.
 *
 * Health AI stays reachable through the bottom navigation, which is a real destination under its own
 * policy. It is deliberately **not** promoted here: offering it beside "tracking is not available"
 * would present a chat as the substitute for recording, which it is not.
 *
 * ── Why the states are still distinct ──────────────────────────────────────
 * `loading`, `offline` and `failed` keep the framework's own components. `empty` is not rendered at
 * all while there is no provider — that is what `HAS_HEALTH_PROVIDER` records — so "you have logged
 * nothing" cannot stand in for "there is nothing to log with", and neither can stand in for "we
 * could not read what you logged". A permission state exists in the framework and is unused, because
 * nothing here requests a permission.
 *
 * ── One state, one read ────────────────────────────────────────────────────
 * The overview state is passed in from `ModuleHomeScreen`, which already computes it — it used to be
 * computed there and discarded while this screen read a fixture. This file constructs no repository,
 * parses no storage, builds no account key and writes nothing.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/**
 * Whether any authoritative Health source exists.
 *
 * A constant rather than a check, because there is nothing to check: no repository, no provider, no
 * storage namespace. It is written down so the branch below states its reason, and so the day a real
 * provider arrives there is one line to flip and a failing test to notice if the copy does not follow.
 */
const HAS_HEALTH_PROVIDER = false;

/** Said once, in the body, in the module's own voice. */
const UNAVAILABLE_MESSAGE =
  'Health tracking is not available yet. Nothing is being recorded, and nothing here is measured.';

export function HealthHomeContent({ state }: { readonly state: UseModuleOverview }) {
  const { dp } = useModuleMetrics();
  const gap = dp(moduleLayout.sectionGap);

  return (
    <View style={{ rowGap: gap }}>
      {/*
        No action passed, because the registry gives this hero no action label — every destination
        that could be named here is a placeholder today. See `health-hero.tsx`.
      */}
      <HealthHero testID="health-hero" />

      {HAS_HEALTH_PROVIDER ? null : (
        <ModuleStatusBanner tone="info" message={UNAVAILABLE_MESSAGE} testID="health-unavailable" />
      )}

      {state.status === 'loading' ? <ModuleLoadingState /> : null}

      {state.status === 'offline' ? <ModuleOfflineState onRetry={state.reload} /> : null}

      {state.status === 'failed' ? (
        <ModuleErrorState onRetry={state.reload} developerDetail={state.detail} />
      ) : null}

      {/*
        Deliberately no `empty` branch while there is no provider. "No entries yet" invites an entry,
        and there is no way to make one — see the docblock above for why that is the worse untruth.
      */}

      <ModuleFeatureGrid testID="health-features" />
    </View>
  );
}
