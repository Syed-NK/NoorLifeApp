import { render, screen, waitFor } from '@testing-library/react-native';

import { AppProviders } from '@application/providers/app-providers';
import { answerNoorAIPort } from '@/test-support/noor-ai-fixtures';

import { moduleLayout } from '../module-tokens';
import { NoorAIChatScreen } from '../noor-ai/noor-ai-chat-screen';

/**
 * The composer's geometry, asserted from the rendered styles.
 *
 * ── The defect this exists to prevent ───────────────────────────────────────
 * AI-5's emulator pass on API 36 found that the composer's visible box was ~84 dp tall while the
 * native `EditText` inside it occupied only about 50 px — a single line at the top. A tap on the
 * lower part of a box that looks like a text field did nothing: measured on the device, a tap at
 * y=1294 left the field `focused="false"` while y=1232 focused it. Roughly the lower two thirds of
 * the control were inert.
 *
 * The cause was which element carried the height: the wrapper `View` had `minHeight`, and the
 * `TextInput` kept its natural single-line height inside it. The fix moves the height *and* the text
 * inset onto the input, so the input fills the bordered box and the whole visible field is the touch
 * target.
 *
 * These assertions are deliberately about **rendered style objects**, not about source text or
 * comments: they read what the component actually passes to the input, so re-introducing the bug by
 * moving `minHeight` back onto the wrapper fails here regardless of how it is written or documented.
 *
 * Scale-independence: `dp()` scales with the viewport, so nothing below hard-codes a pixel figure.
 * The scale is recovered from the input's own line height and every expectation is expressed in terms
 * of it, so these assertions hold at any viewport.
 */

const INPUT = 'noor-ai-chat-composer-input';
const FIELD = 'noor-ai-chat-composer-field';

function flatStyle(testID: string): Record<string, unknown> {
  const style: unknown = screen.getByTestId(testID).props.style;
  return Array.isArray(style)
    ? Object.assign({}, ...style.filter(Boolean))
    : ((style ?? {}) as Record<string, unknown>);
}

async function renderComposer() {
  await render(
    <AppProviders>
      <NoorAIChatScreen port={answerNoorAIPort()} />
    </AppProviders>,
  );
  await waitFor(() => expect(screen.getByTestId(INPUT)).toBeTruthy());
}

/**
 * The composer's own line height, in dp, mirrored from `noor-ai-composer.tsx`.
 *
 * The scale is recovered from a value on the *same element* being asserted, so the expectations below
 * hold at any viewport without hard-coding a pixel figure.
 */
const COMPOSER_LINE_HEIGHT_DP = 19;

function dpScale(): number {
  const lineHeight = flatStyle(INPUT).lineHeight;
  expect(typeof lineHeight).toBe('number');
  return (lineHeight as number) / COMPOSER_LINE_HEIGHT_DP;
}

describe('the input fills its visible field', () => {
  it('gives the input a minimum interactive height equal to the visible field', async () => {
    await renderComposer();

    const input = flatStyle(INPUT);
    expect(input.minHeight).toBeCloseTo(dpScale() * moduleLayout.noorAIComposerInputHeight, 4);
  });

  it('leaves the height on the input rather than on the wrapper', async () => {
    await renderComposer();

    // The wrapper draws the border only. A height here is exactly what made the lower field inert.
    const field = flatStyle(FIELD);
    expect(field.minHeight).toBeUndefined();
    expect(field.height).toBeUndefined();
  });

  it('makes the interactive area at least a full touch target tall', async () => {
    await renderComposer();

    const input = flatStyle(INPUT).minHeight as number;
    expect(input).toBeGreaterThanOrEqual(dpScale() * moduleLayout.minTouchTarget);
    // And comfortably more than one line, which is all the old arrangement gave.
    expect(input).toBeGreaterThan(dpScale() * COMPOSER_LINE_HEIGHT_DP * 3);
  });

  it('carries the text inset on the input, so the inset is inside the touch target', async () => {
    await renderComposer();

    // Padding on the wrapper would shrink the input away from the border it appears to fill.
    const input = flatStyle(INPUT);
    expect(input.paddingHorizontal).toBeGreaterThan(0);
    expect(input.paddingVertical).toBeGreaterThan(0);

    const field = flatStyle(FIELD);
    expect(field.paddingHorizontal).toBeUndefined();
    expect(field.paddingVertical).toBeUndefined();
  });
});

describe('growth is preserved', () => {
  it('sets no fixed height anywhere in the field, so a long question cannot be clipped', async () => {
    await renderComposer();

    // `minHeight` is a floor; a `height` or `maxHeight` would turn growth into clipping or an
    // inner scroll, which §C.3.7's 1000-code-point questions must not hit.
    for (const target of [INPUT, FIELD]) {
      const style = flatStyle(target);
      expect(style.height).toBeUndefined();
      expect(style.maxHeight).toBeUndefined();
    }
  });

  it('remains a multiline input', async () => {
    await renderComposer();
    expect(screen.getByTestId(INPUT).props.multiline).toBe(true);
  });
});

describe('the fix changed geometry only', () => {
  it('keeps the input labelled, described and associated with its visible label', async () => {
    await renderComposer();

    const input = screen.getByTestId(INPUT).props;
    expect(input.accessibilityLabel).toBe('Your question for Noor AI');
    expect(input.accessibilityHint).toBe('Noor AI answers questions about NoorLife.');
    expect(input.accessibilityLabelledBy).toBe('noor-ai-chat-composer-label');
    // The visible label a placeholder cannot replace (spec §8).
    expect(screen.getByText('Your question')).toBeTruthy();
  });

  it('keeps the keyboard-affecting input flags untouched', async () => {
    await renderComposer();

    const input = screen.getByTestId(INPUT).props;
    // Off so the platform keyboard builds no dictionary entry from a question.
    expect(input.autoCorrect).toBe(false);
    expect(input.autoComplete).toBe('off');
    expect(input.spellCheck).toBe(false);
    expect(input.textAlignVertical).toBe('top');
  });
});
