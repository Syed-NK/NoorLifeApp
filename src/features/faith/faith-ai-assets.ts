import type { ImageSourcePropType } from 'react-native';

/**
 * The approved NoorLife AI robot, and the one place it is referenced from.
 *
 * ── Why a module rather than a `require` at each call site ──────────────────
 * The brief requires this mark to appear on the Faith AI hero, the assistant's welcome state and
 * its empty state, and requires that it never be mixed with a different robot style. Three call
 * sites each writing their own `require` is how the second style arrives: somebody adds a fourth
 * touchpoint, reaches for whichever robot file they find first, and the app now has two. One
 * exported constant makes "which robot" un-decidable at the call site.
 *
 * ── What this asset is, and how it was prepared ────────────────────────────
 * Source: `selected-faith-designs/noor-ai-green-robot.png`, 1024x1536, RGB with **no alpha** —
 * the approved artwork ships on a flat cream backdrop. Two things were done to it and nothing
 * else:
 *
 *   1. **Resampled to 512x768** with a box filter. The aspect ratio is identical to six decimal
 *      places (0.666667), so nothing is stretched. 512 px covers the largest use — the welcome
 *      card's ~110 dp box at 3x is 330 px — with headroom, and takes the file from 1,239 KB to
 *      395 KB.
 *   2. **The cream backdrop was lifted to transparency** by flood-filling inward from the canvas
 *      border, so the robot can sit on the emerald hero without a pasted rectangle behind it.
 *      The fill only reaches pixels connected to the border and within tolerance of the corner
 *      colour, so it cannot touch the ivory body: the body is enclosed by the emerald face, the
 *      gold trim and the outline, none of which the fill can cross. The face, hands, gold trim
 *      and chest emblem are the resampled originals, unmodified.
 *
 * Nothing was recoloured and nothing was cropped. The robot's own contact shadow is part of the
 * artwork and is preserved.
 *
 * ── Rendering rules this asset carries ─────────────────────────────────────
 * Always `resizeMode="contain"`, never tinted, never stretched, never cropped, and never with
 * text placed over it. It is decorative wherever a heading already names the assistant, so it is
 * marked `accessible={false}` at those call sites rather than announcing itself twice.
 */
export const noorAIRobot =
  require('@assets/images/modules/faith/noor-ai-robot.png') as ImageSourcePropType;

/**
 * Spoken description, for the one place the robot is *not* accompanied by a heading.
 *
 * Kept beside the asset so a new touchpoint gets the wording rather than inventing one.
 */
export const noorAIRobotAccessibilityLabel = 'Noor AI, your faith companion';
