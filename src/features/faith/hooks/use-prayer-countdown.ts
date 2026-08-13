import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

import { formatTimeUntil, minutesUntilInstant } from '../data/prayer/prayer-clock';

/**
 * A live countdown to a stamped prayer instant.
 *
 * ── Why the repository's `minutesUntil` is not enough on its own ─────────────
 * `getNextPrayer` computes `minutesUntil` once, at the moment it is called. The Faith home hero
 * rendered that number and then kept rendering it: a user who left the screen open watched "in 4 hr
 * 14 min" stay at 4 hr 14 min while the prayer arrived and passed. The number was true when fetched
 * and became a stale claim a minute later.
 *
 * This recomputes from `iso` — the instant itself — so the figure is derived rather than remembered.
 * `minutesUntilInstant` parses the offset the string carries, so the arithmetic is instant-to-instant
 * and correct whatever zone the device is in and across a DST transition.
 *
 * ── Why it ticks every 15 seconds and not every minute ──────────────────────
 * A 60-second interval is the obvious choice and it is visibly wrong: the interval starts whenever the
 * screen mounted, so it is unaligned to the minute boundary and the displayed figure can lag the true
 * one by up to 59 seconds. Aligning by computing the delay to the next boundary is the other approach,
 * and it drifts whenever a timer fires late. Fifteen seconds bounds the lag to a quarter of the
 * smallest unit displayed, costs four cheap recomputations a minute, and needs no alignment logic.
 *
 * `setState` is only called when the *minute* changes, so a tick that produces the same number does
 * not re-render.
 *
 * ── Why `AppState` as well as an interval ───────────────────────────────────
 * Timers do not run reliably while the app is backgrounded, and on resume the interval may not fire
 * for another fifteen seconds. Without the listener a user returning after an hour sees the countdown
 * they left behind — which is the exact defect this hook exists to remove, reappearing at the one
 * moment a user is most likely to be checking. Recomputing on `active` closes it immediately.
 *
 * ── What it does when there is nothing to count down to ─────────────────────
 * `iso` may be `null` — no location, a calculation failure, or a polar day with no Fajr. The hook
 * returns `null` for both fields rather than zero, because zero renders as "now" and "now" is a claim.
 */
export type PrayerCountdown = {
  /** Whole minutes remaining, or `null` when there is no instant to count to. Never negative. */
  readonly minutes: number | null;
  /** "in 2 hr 15 min", "in 14 min", "now", or `null`. */
  readonly label: string | null;
};

/** How often the countdown is recomputed while the screen is in the foreground. */
const TICK_MS = 15_000;

export function usePrayerCountdown(iso: string | null): PrayerCountdown {
  /**
   * The clock is the state; the countdown is derived from it.
   *
   * ── Why not store the minutes ───────────────────────────────────────────────
   * The obvious shape — `setMinutes(measure())` at the top of the effect, so a changed `iso` is
   * re-measured immediately — calls `setState` synchronously inside an effect body. That cascades a
   * render, and `react-hooks/set-state-in-effect` rejects it. Storing the *time* instead makes the
   * countdown a pure function of `(iso, now)`: a new `iso` produces a new figure on the same render
   * that delivered it, with no state write at all.
   *
   * `Date.now()` is read in a lazy initialiser rather than in the render body, so the render stays
   * pure — the same reason `PrayerDay` samples its comparison clock once on mount.
   */
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (iso === null) {
      return undefined;
    }

    /**
     * The clock advances only when doing so would change the displayed minute.
     *
     * Ticking every fifteen seconds and writing `now` each time would re-render four times a minute to
     * show the same number three of those times. Comparing the derived figure inside the updater keeps
     * the write — and so the render — on the minute boundary, while staying out of the effect body.
     */
    const sync = (): void => {
      setNow((previous) => {
        const next = Date.now();
        return minutesUntilInstant(iso, new Date(next)) ===
          minutesUntilInstant(iso, new Date(previous))
          ? previous
          : next;
      });
    };

    const timer = setInterval(sync, TICK_MS);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        sync();
      }
    });

    return () => {
      clearInterval(timer);
      subscription.remove();
    };
  }, [iso]);

  /*
    Derived, so a changed `iso` — the next prayer rolling over to tomorrow's Fajr — takes effect at
    once and the previous target's countdown cannot survive it. `now` may be up to one tick stale at
    that moment, which is the same bound the ticking itself carries.
  */
  const minutes = iso === null ? null : minutesUntilInstant(iso, new Date(now));

  return {
    minutes,
    label: minutes === null ? null : formatTimeUntil(minutes),
  };
}
