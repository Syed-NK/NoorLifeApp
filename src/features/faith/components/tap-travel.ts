/**
 * **Telling a tap from a drag on the counting circle.**
 *
 * ── The defect this exists for ──────────────────────────────────────────────
 * `Pressable` fires on release however far the touch travelled. Inside a scroll view that usually
 * does not matter, because the scroll steals the responder first and the press is cancelled — but
 * the Tasbih screen is deliberately built to *fit*, so at the common size there is nothing to
 * scroll, nothing steals the gesture, and a swipe across the circle arrives as a completed press.
 * Measured on device: one 400 px drag over the disc added a count.
 *
 * A counter that invents a repetition the user never performed is the one error that screen must
 * not make — so a tap is a touch that went down and came up in roughly the same place, and anything
 * else is a gesture aimed somewhere other than the count.
 *
 * ── Why the rule lives here rather than inline in the handler ───────────────
 * The same reason the bead halo's mapping does: the interesting part is the *judgement*, not the
 * plumbing, and a judgement wired directly into a touch handler can only be exercised through
 * synthetic touch events. Those turned out to corrupt this project's `act` queue for a whole test
 * file — so the rule is a pure function that can be tested exhaustively and cheaply, and the
 * handler is left with nothing in it worth testing.
 */

export type TapPoint = {
  readonly x: number;
  readonly y: number;
};

/**
 * How far a touch may wander and still be a tap, in dp.
 *
 * Android's own touch slop is about 8 dp. This sits a little above it, because the tremor in a real
 * tap on this particular control — one used a hundred times in a row, one-handed, often with the
 * eyes shut — is larger than the tremor the platform default is tuned for, and counting a genuine
 * repetition is worth more than rejecting a very short drag.
 */
export const TAP_SLOP_DP = 14;

/**
 * Whether a touch has travelled far enough to stop being a tap.
 *
 * Straight-line distance from where the finger went down, not from the previous sample: a slow arc
 * across the circle covers little ground between any two frames while still ending far from where
 * it began, and measuring frame to frame would let it through.
 *
 * Non-finite coordinates count as *not* travelled. A gesture whose position cannot be established
 * should be judged by the platform's own press handling rather than silently discarded — dropping a
 * repetition the user did perform is the same class of error as inventing one.
 */
export function hasTravelled(
  origin: TapPoint,
  point: TapPoint,
  slop: number = TAP_SLOP_DP,
): boolean {
  const dx = point.x - origin.x;
  const dy = point.y - origin.y;
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) {
    return false;
  }

  return Math.hypot(dx, dy) > slop;
}
