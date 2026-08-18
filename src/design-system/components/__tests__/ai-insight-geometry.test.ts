import { LOCKED, LOCKED_TYPE } from '@features/home/main-home-metrics';
import { moduleType } from '@features/modules/module-tokens';

import { AI_INSIGHT_GEOMETRY, AI_INSIGHT_LINES, AI_INSIGHT_TYPE } from '../ai-insight-geometry';

/**
 * The shared AI Insight geometry is Main Home's, field by field.
 *
 * ── Why this test is the whole protection mechanism ─────────────────────────
 * `AI_INSIGHT_GEOMETRY` restates Main Home's locked numbers rather than importing them,
 * so the module layer does not depend on a design-locked file. Restating invites drift.
 * This test is what makes drift impossible: change `LOCKED.aiInsight` without changing
 * the shared set, or the other way round, and the build fails here.
 *
 * If you are reading this because it failed: do not "fix" it by copying the new number
 * across. Work out which side is right first. Main Home is design-locked, so it is almost
 * certainly the module side that is wrong.
 */

describe('shared AI insight geometry matches Main Home exactly', () => {
  it.each([
    ['height', AI_INSIGHT_GEOMETRY.height, LOCKED.aiInsight.height],
    ['radius', AI_INSIGHT_GEOMETRY.radius, LOCKED.aiInsight.radius],
    [
      'paddingHorizontal',
      AI_INSIGHT_GEOMETRY.paddingHorizontal,
      LOCKED.aiInsight.paddingHorizontal,
    ],
    ['paddingVertical', AI_INSIGHT_GEOMETRY.paddingVertical, LOCKED.aiInsight.paddingVertical],
    ['robot', AI_INSIGHT_GEOMETRY.robot, LOCKED.aiInsight.robot],
    ['chevronTarget', AI_INSIGHT_GEOMETRY.chevronTarget, LOCKED.aiInsight.chevronTarget],
  ])('%s', (_field, shared, locked) => {
    expect(shared).toBe(locked);
  });

  it('covers every field Main Home locks, so a new one cannot be missed', () => {
    for (const field of Object.keys(LOCKED.aiInsight)) {
      expect(Object.keys(AI_INSIGHT_GEOMETRY)).toContain(field);
    }
  });

  it('matches Main Home’s type ramp', () => {
    expect(AI_INSIGHT_TYPE.title).toEqual(LOCKED_TYPE.aiTitle);
    expect(AI_INSIGHT_TYPE.body).toEqual(LOCKED_TYPE.aiBody);
  });

  it('is mirrored by the module type tokens the shared card renders with', () => {
    expect(moduleType.aiInsightTitle).toEqual([...AI_INSIGHT_TYPE.title]);
    expect(moduleType.aiInsightBody).toEqual([...AI_INSIGHT_TYPE.body]);
  });
});

describe('the card cannot grow', () => {
  it('fixes a height rather than a minimum', () => {
    // A number, not an object with a `min`. The whole point of the correction.
    expect(typeof AI_INSIGHT_GEOMETRY.height).toBe('number');
  });

  it('caps the title at one line and the body at two', () => {
    expect(AI_INSIGHT_LINES.title).toBe(1);
    expect(AI_INSIGHT_LINES.body).toBe(2);
  });

  it('leaves the text box tall enough for exactly those lines', () => {
    const contentBox = AI_INSIGHT_GEOMETRY.height - AI_INSIGHT_GEOMETRY.paddingVertical * 2;
    const textHeight = AI_INSIGHT_TYPE.title[1] + AI_INSIGHT_TYPE.body[1] * AI_INSIGHT_LINES.body;
    // 52 dp of box for 40 dp of text — fits, with room for the ascender.
    expect(textHeight).toBeLessThanOrEqual(contentBox);
  });

  it('keeps the chevron target at the 44 dp accessibility minimum', () => {
    expect(AI_INSIGHT_GEOMETRY.chevronTarget).toBeGreaterThanOrEqual(44);
  });
});
