import { screen } from '@testing-library/react-native';

/**
 * Advances the event loop until a screen's loading marker is gone — issue #55.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── Why a helper rather than a `findBy*` query ──────────────────────────────
 * This project has no React act environment, so RNTL's asynchronous queries — which wrap in act — are
 * only safe when nothing else is pending. A screen that mounts and then runs a chain of sequential
 * reads overlaps them: React logs "overlapping act() calls" and its internal queue is corrupted for
 * the **rest of the file**, so every later render yields an empty tree and unrelated tests fail on
 * elements that are rendered unconditionally. That symptom is diagnostic, and the Quran deep-link
 * suite produced it exactly.
 *
 * So the loop is advanced explicitly and every assertion queries synchronously.
 *
 * ── Why it waits on a state signal rather than a fixed count ────────────────
 * The deep-link suite used to spin a fixed twelve turns after `render`, on the reasoning that twelve
 * covers a summary read plus six page reads. It does — but the screen is already settled when RNTL's
 * `render` resolves, so all twelve turns were spent after the fact at roughly 15 ms each. That is
 * ~180 ms per case, on cases whose own render costs about a second and which therefore had only a
 * two-to-four-fold margin against Jest's five-second default. Under full-suite contention that margin
 * is what ran out, intermittently, in two separate work streams.
 *
 * Waiting on the marker returns on the turn the screen is ready and no later, and turns the "still
 * not ready" case into a named failure instead of a missing element three assertions further on.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/**
 * The most turns any screen may take before this is treated as a hang rather than a slow machine.
 *
 * A ceiling, not a target. Measured, the readers this is used with are ready on turn zero; the
 * ceiling exists so a future change that genuinely stops a screen settling fails by name.
 */
export const MAX_SETTLE_TURNS = 24;

/**
 * Waits until `loadingTestId` is absent from the tree, then returns.
 *
 * @param loadingTestId The testID a screen renders **while** loading and removes when it is not —
 *   `FaithResourceView` renders `${testID}-loading`, so pass that.
 * @throws if the marker is still present after {@link MAX_SETTLE_TURNS} turns, naming the marker, so
 *   a hang reads as a hang.
 */
export async function settleUntilLoaded(loadingTestId: string): Promise<number> {
  for (let turn = 0; turn <= MAX_SETTLE_TURNS; turn += 1) {
    if (screen.queryByTestId(loadingTestId) === null) {
      return turn;
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error(
    `"${loadingTestId}" was still in the tree after ${MAX_SETTLE_TURNS} turns — the screen did ` +
      'not settle, which is a hang rather than a slow machine',
  );
}
