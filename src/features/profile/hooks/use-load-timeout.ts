import { useEffect, useState } from 'react';

/**
 * Turns "still waiting" into "this is not coming".
 *
 * ── Why Profile needs this ──────────────────────────────────────────────────
 * The entitlement provider has no error state: a failed refresh simply leaves the entitlement at
 * `unknown`, which is indistinguishable from a slow one. §9 requires Profile Home to offer a retry
 * on a failed load, and §5 forbids it from resolving the ambiguity by guessing "Free" — so the one
 * honest signal left is time. After the grace period the card stops showing a skeleton, says it
 * could not load the plan, and offers to try again.
 *
 * The grace period is generous on purpose. A retry offered after two seconds on a slow connection
 * is a worse experience than a skeleton that resolves on its own at four.
 *
 * ── Why the reset lives in the cleanup ──────────────────────────────────────
 * The expiry has to be cleared when waiting ends, or a second wait would begin already expired.
 * Doing that in the effect *body* would be a synchronous state write on every render that toggles
 * `pending`; doing it in the cleanup runs it exactly once, when the wait it belongs to is over.
 * The returned value is also gated on `pending`, so a resolved load reports false immediately
 * rather than in the frame after the reset commits.
 */
export function useLoadTimeout(pending: boolean, milliseconds: number): boolean {
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    if (!pending) {
      return;
    }

    const timer = setTimeout(() => setExpired(true), milliseconds);
    return () => {
      clearTimeout(timer);
      setExpired(false);
    };
  }, [pending, milliseconds]);

  return pending && expired;
}
