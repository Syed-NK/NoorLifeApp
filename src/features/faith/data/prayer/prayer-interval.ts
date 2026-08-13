/**
 * How far through the current interval between two prayer markers the moment is.
 *
 * ── What the progress ring is actually claiming ─────────────────────────────
 * The approved next-prayer card draws a ring around the countdown. A ring is a *proportion*, so it
 * asserts something the countdown alone does not: that this much of the wait has gone. That claim is
 * only true if the interval it is measured against is the real one — the span from the marker that
 * has just passed to the marker being counted down to. A ring drawn from a made-up start (midnight,
 * "six hours ago", the top of the hour) would look identical and mean nothing.
 *
 * ── Why the result is a union rather than a number ──────────────────────────
 * There is one common moment where the interval's start is genuinely not knowable from today's
 * times: between midnight at the location and Fajr, the preceding marker is *yesterday's* Isha,
 * which is not in today's list. A function returning a bare `number` has to invent something there,
 * and every candidate is a plausible-but-wrong value — exactly the failure that removed the device-day
 * fallback from `calendar-day.ts`. So the type can say "unknown", and the card draws the ring's track
 * with no sweep and says so to accessibility, while the countdown itself — which needs no interval —
 * is unaffected.
 *
 * ── Why instants, not wall clocks ───────────────────────────────────────────
 * Every timestamp here carries the prayer location's own offset, so `Date.parse` yields the true
 * instant whatever zone the device is in. Comparing instants is the one comparison that is
 * zone-independent and DST-proof; reading calendar fields off either side would reintroduce the
 * defect the whole prayer path was corrected for.
 */

/**
 * What one marker on the day's timeline is, relative to now.
 *
 * Defined here rather than in the component because it is a fact about the day, not about a
 * drawing: the same three states decide the spoken description, the track weight and the completion
 * badge, and a second definition beside the renderer is how those three drift apart.
 */
export type PrayerMarkerState = 'passed' | 'next' | 'upcoming';

/**
 * A marker's state, from instants alone.
 *
 * ── Why the highlight is matched by instant and never by prayer key ─────────
 * After Isha the next prayer is *tomorrow's* Fajr, and its key is still `fajr`. Matching on the key
 * would highlight today's Fajr — a row whose time passed before dawn — and tell the reader the day
 * has not started. `highlightedAt` is therefore the timestamp the screen resolved by looking the
 * next prayer up in *today's* list; it is `null` when the next prayer is not on this day at all, and
 * in that state no row is highlighted and the card states the boundary in words.
 *
 * ── Why instants and not wall clocks ────────────────────────────────────────
 * Every timestamp here carries the prayer location's own offset, so `Date.parse` yields the true
 * instant whatever zone the device is in — the property the countdown and the interval also rest on,
 * and the one that survives a DST transition. Reading calendar fields off either side would put the
 * device's zone back into a decision about the location's day, which is the defect the whole prayer
 * path was corrected for.
 *
 * `next` wins over `passed` at the boundary: at the exact prayer instant the row is the thing being
 * waited for, not a thing already done.
 */
export function prayerMarkerState(
  at: string,
  highlightedAt: string | null,
  nowMs: number,
): PrayerMarkerState {
  if (highlightedAt !== null && Date.parse(at) === Date.parse(highlightedAt)) {
    return 'next';
  }
  return Date.parse(at) <= nowMs ? 'passed' : 'upcoming';
}

export type PrayerIntervalProgress =
  | {
      readonly kind: 'known';
      /** ISO instant the interval began — the marker that has most recently passed. */
      readonly startAt: string;
      /** ISO instant it ends — the next prayer. */
      readonly endAt: string;
      /** 0 at the start of the interval, 1 at its end. Clamped; never outside [0, 1]. */
      readonly elapsedFraction: number;
    }
  | {
      readonly kind: 'unknown';
      readonly reason: 'no-preceding-marker' | 'not-an-interval';
    };

/**
 * The interval containing `nowMs`, from today's markers and the instant being counted down to.
 *
 * `markers` is the day's full list **including Sunrise**: it is a real point on the day and the wait
 * between Fajr and Dhuhr visibly passes through it, so excluding it would make the ring jump. Sunrise
 * bounds an interval; it is never the thing being waited *for* — `getNextPrayer` skips it — and this
 * function makes no claim either way about whether a marker is a prayer.
 */
export function prayerIntervalProgress(
  markers: readonly { readonly at: string }[],
  nextAt: string,
  nowMs: number,
): PrayerIntervalProgress {
  const end = Date.parse(nextAt);
  if (Number.isNaN(end)) {
    return { kind: 'unknown', reason: 'not-an-interval' };
  }

  /*
    The latest marker at or before now that is also before the target. Both bounds matter: the
    second one is what keeps tomorrow's Fajr measured from *today's* Isha rather than from whichever
    marker happens to be last in the list.
  */
  let start: number | null = null;
  for (const marker of markers) {
    const at = Date.parse(marker.at);
    if (Number.isNaN(at) || at > nowMs || at >= end) {
      continue;
    }
    if (start === null || at > start) {
      start = at;
    }
  }

  if (start === null) {
    return { kind: 'unknown', reason: 'no-preceding-marker' };
  }
  if (end <= start) {
    return { kind: 'unknown', reason: 'not-an-interval' };
  }

  const elapsed = (nowMs - start) / (end - start);
  return {
    kind: 'known',
    startAt: new Date(start).toISOString(),
    endAt: new Date(end).toISOString(),
    elapsedFraction: Math.min(1, Math.max(0, elapsed)),
  };
}
