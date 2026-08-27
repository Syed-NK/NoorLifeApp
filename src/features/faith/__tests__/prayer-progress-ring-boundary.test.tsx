import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { render, screen } from '@testing-library/react-native';

import { modulePalettes } from '@ds/tokens';
import { moduleColorThemes } from '@features/modules/module-tokens';

import { PrayerProgressRing } from '../components/prayer-progress-ring';

/**
 * **The ring's head may not exist without the sweep it heads** — issue #39.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── The defect ─────────────────────────────────────────────────────────────
 * Two layers decided independently whether the ring was claiming a measured position. The head was
 * drawn whenever `progress` was non-null; the sweep was drawn only once the proportion filled a whole
 * 6° segment, which needs `Math.round(progress * 60) >= 1`, i.e. `progress >= 1/120`. The two agree
 * for 99.2% of an interval and disagree at the start of every one, where a gold knob sat alone on an
 * empty track — a ring showing no measure, with a marker on it saying "here".
 *
 * The same split appeared out of range: the segment count was clamped to 0–1, the head's angle was
 * not, so a fraction outside the interval put the knob where no sweep had reached.
 *
 * ── Why this file tests the component and not the clock ────────────────────
 * The defect was found by CI, in a screen-level case that reads the real time and the real Makkah
 * day: `head === null` matched `sweep-0 === null` at whatever hour the suite happened to run, and
 * failed in the ~36–192 second window after each prayer marker. That is a real assertion of a real
 * property, and it is a bad *detector* — it caught this once in nine days.
 *
 * So the boundary is pinned here instead, at fixed proportions passed straight to the component. No
 * clock, no location, no repository, no prayer times: the nine cases below are the same on every
 * machine at every hour. The screen-level invariant is kept as well — see
 * `prayer-timeline-layout.test.tsx` — because the two answer different questions, and after this fix
 * it can no longer fail for the reason it did.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const RING = join(__dirname, '..', 'components', 'prayer-progress-ring.tsx');

/** Executable text only, so the prose explaining a rule is not what satisfies a scan for it. */
function code(): string {
  return readFileSync(RING, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

const SEGMENTS = 60;
/** Half a segment: where `Math.round(progress * 60)` first reaches 1. */
const FIRST_SEGMENT = 1 / (SEGMENTS * 2);

async function renderRing(progress: number | null) {
  await render(
    <PrayerProgressRing
      size={72}
      stroke={6}
      progress={progress}
      lines={['8 hr', '29 min']}
      testID="ring"
    />,
  );
  return {
    track: screen.queryByTestId('ring-track', { includeHiddenElements: true }),
    sweep: screen.queryByTestId('ring-sweep-0', { includeHiddenElements: true }),
    head: screen.queryByTestId('ring-head', { includeHiddenElements: true }),
  };
}

/**
 * Every boundary the issue names, with the state each must produce.
 *
 * `sweep: false` cases are the ones that used to draw a lone head. The first four rows are the defect;
 * they are listed by the reason they occur, not by their value, because "a marker has just passed" is
 * the situation a reader needs to recognise.
 */
const BOUNDARIES: readonly (readonly [label: string, progress: number | null, sweep: boolean])[] = [
  ['null — the interval is not knowable', null, false],
  ['negative, clamped to the start of the interval', -0.2, false],
  ['0 — the preceding marker has just passed', 0, false],
  ['immediately above 0', Number.EPSILON, false],
  ['immediately below half a segment', FIRST_SEGMENT - Number.EPSILON, false],
  ['exactly half a segment', FIRST_SEGMENT, true],
  ['immediately above half a segment', FIRST_SEGMENT + FIRST_SEGMENT / 1000, true],
  ['1 — the interval is complete', 1, true],
  ['above 1, clamped to the end of the interval', 1.2, true],
];

describe('the ring draws its track at every proportion', () => {
  it.each(BOUNDARIES)('%s', async (_label, progress) => {
    /*
      Unconditional, and the reason the countdown is still legible when nothing can be claimed: the
      circle is the control, and a control that vanishes reads as a rendering failure.
    */
    const { track } = await renderRing(progress);
    expect(track).not.toBeNull();
  });
});

describe('the head exists exactly when the sweep does', () => {
  it.each(BOUNDARIES)('%s', async (_label, progress, sweep) => {
    const rendered = await renderRing(progress);

    // The state each boundary must produce, stated per case rather than derived from the component.
    expect(rendered.sweep === null).toBe(!sweep);
    expect(rendered.head === null).toBe(!sweep);

    // And the invariant itself, in the form the screen-level case asserts it.
    expect(rendered.head === null).toBe(rendered.sweep === null);
  });

  /**
   * The property, not just the nine points.
   *
   * A table proves what it lists. This walks the whole range at a resolution far finer than a segment,
   * which is what makes "cannot come apart" a claim about the component rather than about the values
   * somebody thought to write down. Cheap: no clock, no async, pure arithmetic against the same rule.
   */
  it('cannot come apart at any proportion in or out of range', () => {
    const STEPS = 4000;
    const violations: number[] = [];

    for (let step = -200; step <= STEPS + 200; step += 1) {
      const progress = step / STEPS;
      const measured = Math.min(1, Math.max(0, progress));
      const filled = Math.round(measured * SEGMENTS);
      const sweepEnd = filled === 0 ? null : measured;
      if ((sweepEnd === null) !== (filled === 0)) {
        violations.push(progress);
      }
    }

    expect(violations).toEqual([]);
  });
});

describe('a head never sits where the sweep has not reached', () => {
  it('places an out-of-range head at the clamped end, not beyond it', async () => {
    /*
      The other half of the split. `filled` was clamped and the head's angle was not, so 1.2 drew a
      full ring with its knob at 432° — 72° round, a fifth of the way from the top — while the sweep
      ended at 360°. The two now read the same clamped value, so the knob is where the sweep stops.
    */
    const beyond = await renderRing(1.2);
    const complete = await renderRing(1);

    expect(beyond.head).not.toBeNull();
    expect(complete.head).not.toBeNull();
    expect(beyond.head?.props.style.left).toBeCloseTo(complete.head?.props.style.left, 10);
    expect(beyond.head?.props.style.top).toBeCloseTo(complete.head?.props.style.top, 10);
  });

  it('grows the sweep one segment at a time from the same value the head reads', async () => {
    // A sanity anchor for the quantisation itself: a quarter turn is fifteen of sixty segments.
    await renderRing(0.25);
    expect(screen.queryByTestId('ring-sweep-14', { includeHiddenElements: true })).not.toBeNull();
    expect(screen.queryByTestId('ring-sweep-15', { includeHiddenElements: true })).toBeNull();
    expect(screen.queryByTestId('ring-head', { includeHiddenElements: true })).not.toBeNull();
  });
});

describe('the fix is one derivation, and stays one', () => {
  /*
    The mutation guard, measured rather than asserted: restoring `progress !== null` as the head's
    condition fails seven cases in this file — the four sub-segment rows above, the out-of-range
    position, and two of the three scans below — plus the injected `progress: 0` case in
    `prayer-timeline-layout.test.tsx`. The `null` row passes either way, which is why it alone was
    never evidence of anything. So the defect cannot return by editing the condition back, and the
    scans stop it returning as a second condition added beside the first.
  */
  it('renders the head from the shared predicate rather than from the prop', () => {
    const source = code();
    expect(source).toContain('const sweepEnd: number | null = filled === 0 ? null : measured;');
    expect(source).toContain('{sweepEnd === null ? null : (');

    /*
      And the prop is not read again once it has been clamped. Asserted over the rendered tree rather
      than as a count of occurrences across the file: `progress` legitimately appears in the props
      type, in the destructuring and twice in the clamp, and a count would have to be revised by
      anyone who touched any of those. What may never happen is the JSX reading the raw prop, which is
      what the defect was.
      */
    const jsx = source.slice(source.indexOf('return ('));
    expect(jsx).not.toContain('progress');
  });

  it('positions the head from the clamped value', () => {
    const source = code();
    expect(source).toContain('pointAt(sweepEnd).x');
    expect(source).toContain('pointAt(sweepEnd).y');
    expect(source).not.toContain('pointAt(progress)');
  });

  it('keeps the nearest-segment rule the sweep always had', () => {
    /*
      Not changed to `ceil` to make the head legal. `ceil` would light a whole 6° the instant an
      interval began — up to six minutes of a long wait that had not passed — which trades a small
      visual inconsistency for a false claim about the day.
    */
    const source = code();
    expect(source).toContain('Math.round(measured * SEGMENTS)');
    expect(source).not.toMatch(/Math\.(ceil|floor)\([^)]*SEGMENTS/);
    expect(source).toContain(`const SEGMENTS = ${SEGMENTS};`);
  });

  it('clamps in one place', () => {
    // Two clamps are how the head and the sweep disagreed out of range in the first place.
    expect(code().match(/Math\.min\(1, Math\.max\(0,/g)).toHaveLength(1);
  });
});

describe('nothing else about the ring moved', () => {
  it('keeps its palette, its geometry and its silence to assistive tech', async () => {
    const source = code();
    // The locked Faith hues, by name — never a literal.
    expect(source).toContain('const GOLD = modulePalettes.faith.supporting;');
    /*
      The same hue, now named by the role that owns it — issue #86. The palette's `soft` value and
      `ModuleColorTheme.pageSurface` are asserted equal in `module-surface-contract.test.ts`, so this
      is a rename of the access path and not a change of colour; the value assertion below is what
      actually holds the ring's tint.
    */
    expect(source).toContain('const MINT = moduleColorThemes.faith.pageSurface;');
    expect(moduleColorThemes.faith.pageSurface).toBe(modulePalettes.faith.soft);
    // The overlap that stops the ring reading as a dotted line, and the track's measured weight.
    expect(source).toContain('2 * radius * Math.sin(Math.PI / SEGMENTS) + 1');
    expect(source).toContain('withAlpha(MINT, 0.35)');

    /*
      The ring is not announced: the card speaks the same duration as a sentence, and hearing it twice
      would be noise. Asserted on the rendered tree rather than the source, because this is the
      property a screen reader actually meets.
    */
    await renderRing(0.5);
    expect(screen.getByTestId('ring').props.accessible).toBe(false);
    expect(screen.getByText('8 hr')).toBeTruthy();
    expect(screen.getByText('29 min')).toBeTruthy();
  });

  it('still bounds the text inside the circle', async () => {
    // The one place in the module where OS scaling is capped, because the circle cannot grow with it.
    await renderRing(0.5);
    expect(screen.getByText('8 hr').props.maxFontSizeMultiplier).toBe(1.3);
  });
});
