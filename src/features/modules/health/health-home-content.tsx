import { useRouter } from 'expo-router';
import { View } from 'react-native';

import {
  ModuleEmptyState,
  ModuleErrorState,
  ModuleFeatureGrid,
  ModuleLoadingState,
  ModuleOfflineState,
  ModuleQuickActionRow,
} from '../components';
import { useModule } from '../module-context';
import { moduleLayout } from '../module-tokens';
import type { UseModuleOverview } from '../use-module-overview';
import { useModuleMetrics } from '../use-module-metrics';
import { HealthHero } from './health-hero';

/**
 * **Health's home, claiming nothing about anybody's health** — issue #27.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── What this screen used to say ───────────────────────────────────────────
 * Every value on it, from a `healthHomeFixture` with no source behind it:
 *
 *   • a **wellness score of 86** over a progress ring, with "You’re building a balanced day.";
 *   • **7,542 steps**, **7h 15m** sleep, **6 cups** of water, mood **"Good"**;
 *   • a **"Medication Reminder"** card reading **Vitamin D · 8:00 AM · Taken**;
 *   • a **"Weekly Trend"** chart with seven plotted points and "Your activity is trending up!";
 *   • **"Recent Activity"** — Morning Walk 7,542 steps 7:45 AM, Water Logged 2 cups 10:20 AM,
 *     Sleep Logged 7h 15m 11:30 PM;
 *   • **"Today's Focus"** — Mindful Breathing, a 20-minute walk;
 *   • a **"Health AI Insight"**: "Great job staying active! A short afternoon walk can improve
 *     energy and focus."
 *
 * There is no health data layer in this codebase — no repository, no provider, no storage namespace,
 * nothing to read. The fixture's own docblock said so plainly: *"Nothing here is live."* It was
 * rendered in the module's real cards, in the real type, on the real screen.
 *
 * **The medication card was the serious one.** The others were false statements about a body; that
 * one was a medical-adherence claim. A user who opened Health was told by the application that they
 * had taken a dose, at a time, of a named supplement. Somebody acting on that skips a dose they had
 * not taken, or takes a second one, or a family member reading the screen believes one was given.
 *
 * ── Why the answer is the framework's own empty state ──────────────────────
 * Because there is nothing else honest available. Not a smaller number, not a rounded one, not a
 * gentler encouragement — every card here existed to present data that does not exist, so the cards
 * go and what remains is the state the module framework already has for exactly this: *no entries
 * yet*, in Health's own reviewed copy from the registry.
 *
 * That copy is better than anything this screen was saying: **"No entries yet — Log one thing today
 * — a walk, a glass of water — and your trend starts here."** It is true, it invites the one action
 * that would make it untrue, and it promises a trend rather than asserting one.
 *
 * ── The five states stay five ──────────────────────────────────────────────
 * `loading`, `offline`, `failed` and `empty` render through the framework's own components, so they
 * cannot collapse into each other — "you have logged nothing" and "we could not read what you logged"
 * are opposite facts, and showing the first for the second is how a fault becomes a false record.
 * A `ready` branch is deliberately absent: with no provider there is no populated shape to render,
 * and adding one would be re-creating the fixture with extra steps.
 *
 * ── One state, one read ────────────────────────────────────────────────────
 * The overview state is passed in from `ModuleHomeScreen`, which already computes it. It used to be
 * computed there and discarded, because this composition ignored it and read a fixture instead.
 * Taking it as a prop rather than calling `useModuleOverview` again is what keeps this screen from
 * becoming a second data path — this file constructs no repository, parses no storage and builds no
 * account key, which its tests assert directly.
 *
 * ── What is preserved ──────────────────────────────────────────────────────
 * The approved palette, the hero artwork, the section gap, the type tokens, the quick-action row and
 * the capability grid — every part of the visual language that can carry a true statement. The
 * capability grid is especially worth keeping: it already marks Sleep and Water **unavailable** with
 * reasons ("Automatic sleep tracking needs health data access, coming in a later release"), which is
 * the honest form of the very features the fabricated cards were pretending to show.
 * ═══════════════════════════════════════════════════════════════════════════
 */
export function HealthHomeContent({ state }: { readonly state: UseModuleOverview }) {
  const router = useRouter();
  const module = useModule();
  const { dp } = useModuleMetrics();
  const gap = dp(moduleLayout.sectionGap);

  return (
    <View style={{ rowGap: gap }}>
      {/*
        `/health/log` is a real route. It renders the framework's section screen, which states its own
        status — "this destination arrives with the module's full release" — and offers Health AI,
        which works. So the CTA leads somewhere that tells the truth about itself rather than to a
        feature that silently is not there.
      */}
      <HealthHero onAction={() => router.push('/health/log')} testID="health-hero" />

      <ModuleQuickActionRow testID="health-quick-actions" />

      {state.status === 'loading' ? <ModuleLoadingState /> : null}

      {state.status === 'offline' ? <ModuleOfflineState onRetry={state.reload} /> : null}

      {state.status === 'failed' ? (
        <ModuleErrorState onRetry={state.reload} developerDetail={state.detail} />
      ) : null}

      {state.status === 'empty' ? (
        /*
          The action goes to Health AI, which is the framework's own choice for this state and the
          one destination in this module that does something today. Routing it at a logging screen
          that cannot yet log would be the CTA problem again, one card down.
        */
        <ModuleEmptyState onAction={() => router.push(module.routes.ai)} />
      ) : null}

      <ModuleFeatureGrid testID="health-features" />
    </View>
  );
}
