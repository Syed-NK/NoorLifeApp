import { StyleSheet, View } from 'react-native';

import { modulePalettes } from '@ds/tokens';
import { ModuleText } from '@features/modules/components';
import { withAlpha } from '@features/modules/module-tokens';

/**
 * The circular countdown on the approved next-prayer card.
 *
 * ── Why this is drawn rather than imported ──────────────────────────────────
 * This project has no `react-native-svg`, and adding a dependency is out of scope. A ring is
 * therefore either a rotated-half-circle mask or a run of short segments laid around a circumference,
 * and the segments are what the day arc used and what rendered correctly on device: the mask
 * technique depends on Android's border compositing at the seam between the two halves, which is the
 * kind of thing that looks right in one build and shows a hairline in the next.
 *
 * ── The sweep is a proportion, so it must have a real denominator ───────────
 * `progress` is `null` when the interval that would give the sweep its meaning is not knowable — see
 * `data/prayer/prayer-interval.ts`. In that state the track is drawn and the sweep is not, so the ring
 * shows the countdown without claiming a proportion it cannot compute. It never guesses a start.
 *
 * ── One predicate decides whether anything is being claimed ─────────────────
 * The sweep and its head used to be decided separately: the head appeared whenever `progress` was
 * non-null, while the sweep appeared only once the proportion filled a whole segment. Those two
 * thresholds agree for most of an interval and disagree at the start of every one of them, where a
 * gold knob sat alone on an empty track — a measured position asserted by a ring showing no measure
 * (issue #39). They also disagreed out of range: the segment count was clamped to 0–1 and the head
 * position was not, so a fraction outside the interval put the knob at an angle the sweep never
 * reached.
 *
 * So the proportion is clamped once, the segment count is derived from it once, and `sweepEnd` — the
 * turn the sweep reaches, or `null` when it reaches nothing — is the single fact both layers read.
 * `sweepEnd !== null` *is* "a visible sweep exists", by construction rather than by two conditions
 * happening to line up.
 */

/** Segments around the full circle. 60 gives 6° steps, which reads as a curve at these diameters. */
const SEGMENTS = 60;

/** NoorLife's own gold and its palest green, from the locked Faith palette. Never a new hue. */
const GOLD = modulePalettes.faith.supporting;
const MINT = modulePalettes.faith.soft;

export type PrayerProgressRingProps = {
  /** Outer diameter, already scaled. */
  readonly size: number;
  /** Ring thickness, already scaled. */
  readonly stroke: number;
  /** 0–1 elapsed, or `null` when the interval is unknown and only the track may be drawn. */
  readonly progress: number | null;
  /**
   * The countdown, pre-split into at most two lines.
   *
   * Split rather than wrapped: `['8 hr', '29 min']` sets each unit on its own line inside the ring,
   * where a wrapped sentence would break wherever the width happened to run out. The full sentence
   * stays in the card's text column — this is an abbreviation of it, never a replacement for it.
   */
  readonly lines: readonly string[];
  readonly testID: string;
};

export function PrayerProgressRing({
  size,
  stroke,
  progress,
  lines,
  testID,
}: PrayerProgressRingProps) {
  const radius = (size - stroke) / 2;
  const centre = size / 2;
  /**
   * The proportion this ring is allowed to draw, clamped once.
   *
   * `prayerIntervalProgress` already clamps, so production cannot deliver a fraction outside 0–1
   * today. Clamping here anyway is what makes the two layers below provably consistent for every
   * value of the prop rather than for every value the current caller happens to pass.
   */
  const measured = progress === null ? null : Math.min(1, Math.max(0, progress));

  /**
   * Segments to draw, at the ring’s own 6° quantisation.
   *
   * `Math.round` is deliberate and unchanged: it draws the *nearest* whole segment. `Math.ceil`
   * would light a full 6° the instant an interval began, claiming up to six minutes of a long wait
   * that had not passed, and `Math.floor` would withhold the last segment of a wait that had all but
   * ended. Nearest is the honest one, so the fix moves the head to agree with it rather than moving
   * this rule to agree with the head.
   */
  const filled = measured === null ? 0 : Math.round(measured * SEGMENTS);

  /**
   * **The one predicate.** Where the sweep ends, or `null` when there is no sweep.
   *
   * Both the sweep and its head read this, so "a head exists" and "a sweep exists" cannot come
   * apart: it is non-null exactly when `filled` is at least one, which is exactly when a segment is
   * drawn. Below half a segment the ring shows its track and says nothing — which is the same answer
   * it gives when the interval is unknowable, and for the same reason.
   */
  const sweepEnd: number | null = filled === 0 ? null : measured;

  /** A point on the circumference, measured clockwise from the top — where a dial starts. */
  const pointAt = (
    turn: number,
  ): { readonly x: number; readonly y: number; readonly deg: number } => {
    const radians = (turn * 2 - 0.5) * Math.PI;
    return {
      x: centre + radius * Math.cos(radians),
      y: centre + radius * Math.sin(radians),
      deg: turn * 360,
    };
  };

  /*
    One extra dp of length per segment so neighbours overlap. Without it the arithmetic leaves a
    sub-pixel seam at every join, which at 60 joins reads as a dotted ring rather than a stroke.
  */
  const segmentLength = 2 * radius * Math.sin(Math.PI / SEGMENTS) + 1;

  return (
    <View style={{ width: size, height: size }} accessible={false} testID={testID}>
      {/* The track: the whole circle, at the weight the sweep will be drawn over it. */}
      <View
        testID={`${testID}-track`}
        style={[
          StyleSheet.absoluteFill,
          {
            borderRadius: size / 2,
            borderWidth: stroke,
            /*
              0.35, not the 0.28 it was. On the deep-emerald ground the lighter value read as a
              smudge rather than as a ring, so an empty track — the pre-dawn state, where there is
              no sweep at all — barely registered as a control. Measured on the emulator.
            */
            borderColor: withAlpha(MINT, 0.35),
          },
        ]}
      />

      {Array.from({ length: filled }, (_unused, index) => {
        const { x, y, deg } = pointAt((index + 0.5) / SEGMENTS);
        return (
          <View
            key={index}
            testID={`${testID}-sweep-${index}`}
            style={{
              position: 'absolute',
              left: x - segmentLength / 2,
              top: y - stroke / 2,
              width: segmentLength,
              height: stroke,
              backgroundColor: MINT,
              transform: [{ rotate: `${deg}deg` }],
            }}
          />
        );
      })}

      {/*
        The head of the sweep, in gold — the reference's one warm accent on this card. Drawn only
        when there is a sweep to head: a knob on an empty track would imply a measured position.

        `sweepEnd`, never `progress`. Reading the prop here is the defect in issue #39 — it made the
        head appear a segment before the sweep it is the head of, at the start of every interval.
      */}
      {sweepEnd === null ? null : (
        <View
          testID={`${testID}-head`}
          style={{
            position: 'absolute',
            left: pointAt(sweepEnd).x - stroke * 0.8,
            top: pointAt(sweepEnd).y - stroke * 0.8,
            width: stroke * 1.6,
            height: stroke * 1.6,
            borderRadius: stroke * 0.8,
            backgroundColor: GOLD,
          }}
        />
      )}

      <View style={[StyleSheet.absoluteFill, styles.centre]}>
        {lines.map((line, index) => (
          <ModuleText
            key={index}
            token="rowLabel"
            align="center"
            color={MINT}
            numberOfLines={1}
            /*
              Bounded, and only here. The ring is a fixed circle, so unbounded OS scaling would push
              these two lines through its stroke. The same countdown is set unbounded as a sentence
              in the card's text column, which is why abbreviating inside the circle costs nothing:
              nobody has to read it here to know how long is left.
            */
            maxFontSizeMultiplier={1.3}
          >
            {line}
          </ModuleText>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  centre: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
