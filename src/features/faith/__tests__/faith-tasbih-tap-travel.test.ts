import { hasTravelled, TAP_SLOP_DP } from '../components/tap-travel';

/**
 * **The rule that decides whether a touch on the counting circle was a tap.**
 *
 * ── Why this is tested at all ───────────────────────────────────────────────
 * It was found on device, not here: a 400 px drag across the disc added a count, because a
 * `Pressable` fires on release however far the touch moved and there was nothing to scroll, so
 * nothing cancelled the press. The screen was counting a gesture the user aimed elsewhere.
 *
 * Both directions matter and they pull against each other. Too strict and a real tap — from a
 * control used a hundred times in a row, one-handed, often with the eyes shut — is dropped, which
 * loses a repetition the user did perform. Too loose and a swipe invents one they did not. So the
 * cases below pin the boundary from both sides rather than sampling one.
 */

const ORIGIN = { x: 200, y: 200 };

describe('a tap is allowed to wander', () => {
  it.each([
    ['perfectly still', 0, 0],
    ['a single pixel', 1, 0],
    ['a small diagonal wobble', 3, 4],
    ['right up to the limit', TAP_SLOP_DP, 0],
  ] as const)('counts when the finger moves %s', (_name, dx, dy) => {
    expect(hasTravelled(ORIGIN, { x: ORIGIN.x + dx, y: ORIGIN.y + dy })).toBe(false);
  });

  it('treats the limit as inclusive, so a touch exactly at it still counts', () => {
    // A boundary that rejected at exactly the slop would discard the most marginal *real* taps.
    expect(hasTravelled(ORIGIN, { x: ORIGIN.x, y: ORIGIN.y + TAP_SLOP_DP })).toBe(false);
    expect(hasTravelled(ORIGIN, { x: ORIGIN.x, y: ORIGIN.y + TAP_SLOP_DP + 0.01 })).toBe(true);
  });
});

describe('a drag does not', () => {
  it.each([
    ['a short deliberate flick', 0, 40],
    ['the swipe measured on device', 0, 400],
    ['a horizontal drag', 260, 0],
    ['a diagonal drag', 200, 200],
  ] as const)('rejects %s', (_name, dx, dy) => {
    expect(hasTravelled(ORIGIN, { x: ORIGIN.x + dx, y: ORIGIN.y + dy })).toBe(true);
  });

  it.each([
    ['upwards', 0, -1],
    ['leftwards', -1, 0],
    ['up and left', -1, -1],
  ] as const)('measures distance, not direction — %s', (_name, sx, sy) => {
    const far = { x: ORIGIN.x + sx * 300, y: ORIGIN.y + sy * 300 };
    expect(hasTravelled(ORIGIN, far)).toBe(true);
  });
});

describe('distance is measured from where the finger went down', () => {
  /**
   * The property a frame-to-frame comparison would break.
   *
   * A slow arc across the circle covers only a pixel or two between any two samples while still
   * ending far from where it started. Comparing against the previous point would let every one of
   * those samples through and count the swipe.
   */
  it('rejects a slow drag whose every step is tiny', () => {
    let point = { ...ORIGIN };
    let everFlagged = false;

    for (let step = 0; step < 200; step += 1) {
      point = { x: point.x + 1, y: point.y };
      everFlagged = everFlagged || hasTravelled(ORIGIN, point);
    }

    expect(everFlagged).toBe(true);
    // And it is still flagged at the end, not only somewhere in the middle.
    expect(hasTravelled(ORIGIN, point)).toBe(true);
  });
});

describe('the rule is total', () => {
  it.each([
    ['a non-finite coordinate', Number.NaN],
    ['an infinite coordinate', Number.POSITIVE_INFINITY],
  ] as const)('does not reject the tap on %s', (_name, value) => {
    /*
      Unreadable coordinates fall back to the platform's own press handling rather than discarding
      the gesture. Dropping a repetition the user did perform is the same class of error as
      inventing one, and this is the branch with no evidence either way.
    */
    expect(hasTravelled(ORIGIN, { x: value, y: ORIGIN.y })).toBe(false);
    expect(hasTravelled({ x: value, y: ORIGIN.y }, ORIGIN)).toBe(false);
  });

  it('accepts a caller-supplied slop', () => {
    expect(hasTravelled(ORIGIN, { x: ORIGIN.x + 20, y: ORIGIN.y }, 30)).toBe(false);
    expect(hasTravelled(ORIGIN, { x: ORIGIN.x + 20, y: ORIGIN.y }, 10)).toBe(true);
  });
});
