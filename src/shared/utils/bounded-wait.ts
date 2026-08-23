/**
 * Waiting on a promise for a bounded time, without abandoning it.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── Bounding the wait, not the work ────────────────────────────────────────
 * This does not cancel anything. The promise keeps running and its eventual answer is still the
 * caller's to use — what the bound buys is the ability to *decide without it* while it is
 * outstanding. That distinction is the whole reason this exists rather than an `AbortSignal`:
 * abandoning a request throws away a definitive answer that was merely late, and on the startup path
 * a late definitive answer is exactly what resolves a launch honestly.
 *
 * The handle is kept and cleared. `Promise.race` settles on the first result and does not cancel the
 * loser, so a bare `setTimeout` leaves a live timer behind on every call — harmless once in
 * production, and in Jest it holds the environment open after the run finishes, which is reported as
 * a leak in whichever suite happened to run last.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/**
 * Returned when the bound elapsed first.
 *
 * A symbol rather than a sentinel value, so it cannot collide with anything a caller's own promise
 * might legitimately resolve to — including `null`, `undefined`, or a status union that grows a new
 * member later.
 */
export const WAIT_EXPIRED: unique symbol = Symbol('bounded-wait-expired');

export async function waitAtMost<T>(
  work: Promise<T>,
  ms: number,
): Promise<T | typeof WAIT_EXPIRED> {
  let handle: ReturnType<typeof setTimeout> | undefined;
  const bound = new Promise<typeof WAIT_EXPIRED>((resolve) => {
    handle = setTimeout(() => resolve(WAIT_EXPIRED), ms);
  });
  try {
    return await Promise.race([work, bound]);
  } finally {
    if (handle !== undefined) {
      clearTimeout(handle);
    }
  }
}
