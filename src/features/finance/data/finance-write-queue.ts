/**
 * **One write at a time, per ledger, across every repository instance** — issue #92.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── The defect this exists to prevent ──────────────────────────────────────
 * A repository writes by reading the whole ledger, changing one record and writing it back. Two of
 * those interleaving is a lost update: both read the same bytes, both write, and the second erases
 * the first. Planner hit exactly this (issue #72) and the fix is the same shape here — but the
 * queue has to be **module-scoped**, not per instance, or two instances each hold their own lane and
 * serialize against nobody.
 *
 * ── Why lanes are keyed by storage address ─────────────────────────────────
 * The thing that must not interleave is *writes to one key*. Keying by the address means two
 * accounts never wait on each other — an unrelated ledger's slow write cannot block yours — while
 * every writer of the same key is in the same line regardless of which object it came from.
 *
 * A single global lane would be correct and needlessly serial; a per-instance lane would be fast and
 * wrong. This is the only keying that is both.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const lanes = new Map<string, Promise<void>>();

/**
 * Runs `operation` after everything already queued for `lane`.
 *
 * `then(operation, operation)` rather than `then(operation)`: a rejected predecessor must still let
 * the next operation run. Chaining only the fulfilled path would leave every later write on that
 * key waiting on a promise that will never settle — a deadlock produced by one failed write.
 */
export function serializeFinanceWrite<T>(lane: string, operation: () => Promise<T>): Promise<T> {
  const previous = lanes.get(lane) ?? Promise.resolve();
  const result = previous.then(operation, operation);

  const tail = result.then(
    () => undefined,
    () => undefined,
  );
  lanes.set(lane, tail);

  /*
    Drop the lane once this operation is the last one on it. The identity check is what keeps a
    later arrival's tail in place: if something queued behind this one, `lanes.get` is that newer
    tail and this cleanup must leave it alone.
  */
  void tail.then(() => {
    if (lanes.get(lane) === tail) {
      lanes.delete(lane);
    }
  });

  return result;
}

/** How many ledgers currently have work in flight. For tests that assert the lane actually drains. */
export function financeWriteLaneCount(): number {
  return lanes.size;
}
