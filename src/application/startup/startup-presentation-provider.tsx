import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { STARTUP_PRESENTATION_CEILING_MS } from './startup-machine';

/**
 * **The one startup clock, mounted for every launch however it started** — issue #58.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── The gap this closes ────────────────────────────────────────────────────
 * #31 gave a slow launch something truthful to look at: past the presentation ceiling the startup
 * machine reports `still_resolving` and the entry gate renders the identity-free notice under the
 * branded splash. That fixed the launcher path and only the launcher path, because the clock it
 * runs on lived inside `useStartupRouting` — and `src/app/index.tsx` is the only file that calls it.
 *
 * Expo Router makes a deep-linked route the *initial* route, so a cold link never mounts the gate.
 * No clock, no ceiling, no notice. The route's authentication boundary correctly renders nothing
 * while authority is unresolved, and with no splash behind it that nothing is what the user sees —
 * measured at nine to eleven seconds on both Android targets.
 *
 * So the elapsed-time clock moves here, where every launch path can read it, and the boundary reads
 * the same value the gate does.
 *
 * ── What this owns, and what it deliberately does not ──────────────────────
 * It owns one number and one timer. It is **not** a second startup machine: it does not know what
 * fonts, onboarding, the account journey or recovery containment have said, it takes no routing
 * decision, and it cannot conclude anything about identity. `useStartupRouting` still owns the
 * machine and still feeds it this number; the authentication boundary still owns the access
 * decision. This layer answers exactly one question — *how long has this launch been going* — and
 * two consumers ask it.
 *
 * That separation is the whole reason it is safe to mount this high. A provider that decided
 * anything about authority at the root would be gating public and callback routes; a provider that
 * only counts cannot.
 *
 * ── Why the root rather than the boundary ──────────────────────────────────
 * The clock has to start when the *launch* starts, not when the first authenticated route mounts.
 * Reading it from a component that mounts late would measure the wrong interval, and giving each
 * mount site its own clock would be nineteen clocks disagreeing about when the launch began. There
 * is one launch, so there is one start time and one timer.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/**
 * How often the clock reports.
 *
 * Moved verbatim from `useStartupRouting`, where it was `TICK_MS`. 100 ms is well under the shortest
 * interval any consumer compares against — the returning-launch brand minimum — so no decision can
 * land a tick late enough to be visible.
 */
export const STARTUP_PRESENTATION_TICK_MS = 100;

export type StartupPresentationState = {
  /** Milliseconds since this launch began. Stops advancing once the ceiling is reached. */
  readonly elapsedMs: number;
  /**
   * Whether the launch has been going long enough that a still-waiting surface must say so.
   *
   * Derived here rather than at each consumer so the comparison exists once. A consumer that
   * re-derived it from `elapsedMs` could drift past the ceiling constant, which is the one number
   * issue #57 owns and this issue must leave alone.
   */
  readonly pastCeiling: boolean;
};

/**
 * What a consumer sees with no provider above it: a launch that has only just begun.
 *
 * Frozen, and the same shape `RecoveryContainmentContext` uses for the same reason — a default that
 * is a real value rather than `null` keeps every consumer a plain read with no null branch.
 *
 * The direction of this default matters. `pastCeiling: false` means *show nothing yet*, so a missing
 * provider degrades to the behaviour that existed before this change rather than to a notice
 * rendered at the wrong moment. It cannot admit anyone anywhere: presentation state is never
 * consulted for access, and `startup-presentation-ownership.test.tsx` asserts the provider is
 * actually mounted in `AppProviders`, so the default is a safety net rather than a supported mode.
 */
const LAUNCH_JUST_BEGAN: StartupPresentationState = Object.freeze({
  elapsedMs: 0,
  pastCeiling: false,
});

const StartupPresentationContext = createContext<StartupPresentationState>(LAUNCH_JUST_BEGAN);

export function StartupPresentationProvider({ children }: { readonly children: React.ReactNode }) {
  /**
   * The moment this launch began.
   *
   * A ref set during the first render rather than in an effect, for the reason it was set that way
   * in `useStartupRouting`: an effect runs after paint, which would start the clock late and make
   * every interval measured from it a frame or two long.
   */
  const startedAt = useRef<number | null>(null);
  startedAt.current ??= Date.now();

  const [elapsedMs, setElapsedMs] = useState(0);

  /*
    The clock. Stops as soon as the ceiling is reached, so a stuck startup does not tick forever.

    Stopping is still correct now that two consumers read it: past the ceiling both of them report
    the same thing whatever the elapsed value is, and when authority finally lands the re-render
    recomputes with the frozen elapsed time — which is already beyond the ceiling and the brand
    minimum, so the real destination is named immediately rather than after another tick.

    One interval, created once. Under Strict Mode the effect is mounted, torn down and mounted again;
    the cleanup clears the first interval before the second is created, so exactly one survives. The
    ref is what keeps that honest — a second interval measuring from its own `Date.now()` would
    report a shorter launch than the first.
  */
  useEffect(() => {
    const started = startedAt.current ?? Date.now();
    const timer = setInterval(() => {
      const next = Date.now() - started;
      setElapsedMs(next);
      if (next >= STARTUP_PRESENTATION_CEILING_MS) {
        clearInterval(timer);
      }
    }, STARTUP_PRESENTATION_TICK_MS);
    return () => {
      clearInterval(timer);
    };
  }, []);

  const value = useMemo<StartupPresentationState>(
    () => ({
      elapsedMs,
      pastCeiling: elapsedMs >= STARTUP_PRESENTATION_CEILING_MS,
    }),
    [elapsedMs],
  );

  return (
    <StartupPresentationContext.Provider value={value}>
      {children}
    </StartupPresentationContext.Provider>
  );
}

/** How long this launch has been going, for the two surfaces that must say so. */
export function useStartupPresentation(): StartupPresentationState {
  return useContext(StartupPresentationContext);
}
