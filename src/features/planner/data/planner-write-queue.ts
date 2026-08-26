/**
 * **The one place a Planner write is serialized** — issue #72.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── The defect this exists to make impossible ──────────────────────────────
 * Every Planner mutation is a read-modify-write of a whole envelope: read the array, change one
 * element, write the array back. Two of those interleaving means the second write is built from a
 * snapshot taken before the first, and the first change is gone — no error, no indication.
 *
 * Both repositories used to hold their own queue variable. The routine repository's sat at module
 * scope with a comment saying it matched the task repository; the task repository's sat *inside its
 * factory*, so every instance serialized only against itself. Two live repositories for one account —
 * which is exactly what a screen-per-provider tree produces — shared no ordering at all.
 *
 * A comment is not an invariant. This module is, because it is the only queue either repository can
 * reach, and neither has a local one left to drift back to.
 *
 * ── Why the lane is the storage address ────────────────────────────────────
 * Serialization only has to hold between writers that can clobber each other, and two writers can
 * only clobber each other when they write the *same key*. So the lane is the key.
 *
 * That makes it account-scoped for free: two accounts never block one another, tasks never wait
 * behind routines, and the completion log never waits behind the routine list. A single module-wide
 * queue would also be correct and would be needlessly coarse — every Planner write in the app would
 * queue behind every other one.
 *
 * ── Why the map is module state and not passed in ──────────────────────────
 * Ownership has to outlive every repository instance, or it is not shared. A queue handed to a
 * factory is a queue that a second caller can decline to hand over, and that is the defect again with
 * an extra parameter. Nothing in the app constructs this map, and nothing can supply a different one.
 *
 * ── What it does not do ────────────────────────────────────────────────────
 * It is not a lock, a transaction or a retry. It orders operations that have already decided to run,
 * and it never swallows a rejection: a failing operation settles its lane and the next one proceeds,
 * so one refused write cannot wedge a key for the rest of the session.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/**
 * The tail of each lane's chain of pending writes.
 *
 * A lane is dropped once its chain drains, so the map holds an entry only while a key has work in
 * flight — a session that touches many accounts does not accumulate a resolved promise per account.
 */
const lanes = new Map<string, Promise<void>>();

/**
 * Runs `operation` after every operation already queued for `lane`, and returns its result.
 *
 * The returned promise settles exactly as the operation does; a rejection is the caller's to handle
 * and never reaches the lane, which advances either way.
 */
export function serializePlannerWrite<T>(lane: string, operation: () => Promise<T>): Promise<T> {
  const previous = lanes.get(lane) ?? Promise.resolve();

  /*
    `then(operation, operation)` rather than `then(operation)`: a rejected predecessor must still let
    the next operation run. Chaining only the fulfilled path would leave every later write on that key
    waiting on a promise that will never fulfil.
  */
  const result = previous.then(operation, operation);

  const tail = result.then(
    () => undefined,
    () => undefined,
  );
  lanes.set(lane, tail);

  /*
    Drop the lane once this operation is the last one on it. Checking identity before deleting is what
    keeps a later arrival's tail in place: if something queued behind this one, `lanes.get` is that
    newer tail and this cleanup must leave it alone.
  */
  void tail.then(() => {
    if (lanes.get(lane) === tail) {
      lanes.delete(lane);
    }
  });

  return result;
}

/** How many keys currently have work in flight. For tests that assert the lane actually drains. */
export function plannerWriteLaneCount(): number {
  return lanes.size;
}
