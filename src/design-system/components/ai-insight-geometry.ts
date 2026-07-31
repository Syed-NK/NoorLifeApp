/**
 * The one geometry every AI Insight card in the app is built to.
 *
 * ── Where these numbers come from ───────────────────────────────────────────
 * They are Main Home's, copied from `LOCKED.aiInsight` in `main-home-metrics.ts` — the
 * design-locked source of truth for `06-ai-quick-actions-reference.png`. They are
 * *restated* here rather than imported for one reason: the module layer must not depend
 * on a locked Main Home file, the same separation `moduleLayout` already keeps.
 *
 * Restating invites drift, so the drift is made impossible instead of discouraged:
 * `__tests__/ai-insight-geometry.test.ts` asserts every field below equals its
 * `LOCKED.aiInsight` counterpart, field by field. Changing one without the other fails
 * the build. That is the "protected shared token set" the brief asks for — protection by
 * assertion, not by convention.
 *
 * ── What a module may vary ──────────────────────────────────────────────────
 * Tint, border colour, title, body copy and destination. Nothing else. In particular a
 * module may not vary the height: `height` is a fixed number, not a minimum, so longer
 * copy ellipsises instead of growing the card. That was the actual defect — Faith's card
 * carried a source pill and stood taller than every other module's.
 */
export const AI_INSIGHT_GEOMETRY = {
  /** Fixed. Never a minimum — long copy must ellipsise, not grow the card. */
  height: 68,
  radius: 13,
  paddingHorizontal: 12,
  paddingVertical: 8,
  /** The robot PNG's display box. */
  robot: 44,
  /** Chevron touch target, meeting the 44 dp minimum on both axes. */
  chevronTarget: 44,
  /** Chevron glyph inside that target. */
  chevronIcon: 18,
  borderWidth: 1,
} as const;

/**
 * Type ramp, also Main Home's.
 *
 * `[fontSize, lineHeight]`. Title is one line, body at most two — which is what makes
 * the fixed height achievable: 14 + 13 + 13 = 40 dp of text inside 68 − 16 = 52 dp of
 * content box.
 */
export const AI_INSIGHT_TYPE = {
  title: [10.5, 14],
  body: [10, 13],
} as const;

/** Maximum lines. Enforced at the call site so overflow ellipsises rather than grows. */
export const AI_INSIGHT_LINES = {
  title: 1,
  body: 2,
} as const;
