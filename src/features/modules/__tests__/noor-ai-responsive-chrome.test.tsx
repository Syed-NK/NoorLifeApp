import { render, screen, waitFor } from '@testing-library/react-native';

import { AppProviders } from '@application/providers/app-providers';
import { answerNoorAIPort } from '@/test-support/noor-ai-fixtures';

import { moduleLayout } from '../module-tokens';
import { noorAIChatCopy } from '../noor-ai/noor-ai-chat-copy';
import { NoorAIChatScreen } from '../noor-ai/noor-ai-chat-screen';

/**
 * The chrome that must survive a large Android font scale without losing words.
 *
 * ── What went wrong on the device ───────────────────────────────────────────
 * At a **1.30 Android font scale** on API 36, two labels were compressed into an ellipsis rather
 * than being given their width:
 *
 *   • the §06 scope badge rendered `NoorLife questions …` instead of `NoorLife questions only`, and
 *   • the composer's Send control rendered `Se…`.
 *
 * Both had the same cause. Each sat in a row beside a sibling carrying `flex: 1`, and as ordinary
 * flex children they kept the default `flexShrink: 1`, so the greedy sibling took the room first and
 * squeezed them below their content width — at which point their single line ellipsized. A truncated
 * scope badge misstates the scope, and a truncated Send button hides the verb.
 *
 * The fix gives each of them `flexShrink: 0` and lets the scope row wrap, so the flexible sibling
 * yields first and the badge drops to its own row when a row genuinely runs out. No font size was
 * reduced: the locked type ramp is untouched and `allowFontScaling` stays on.
 *
 * These assertions read the **rendered style objects**, so they hold regardless of how the styles are
 * written or commented.
 */

function flatten(style: unknown): Record<string, unknown> {
  return Array.isArray(style)
    ? Object.assign({}, ...style.map(flatten).filter(Boolean))
    : ((style ?? {}) as Record<string, unknown>);
}

function flatStyle(testID: string): Record<string, unknown> {
  return flatten(screen.getByTestId(testID).props.style);
}

/**
 * The style of a `PressableScale`, which is not on the node carrying the `testID`.
 *
 * `PressableScale` puts the caller's style on an outer `Animated.View` and spreads the rest — the
 * `testID` and the accessibility props included — onto an inner `Pressable` that fills it as a touch
 * overlay. So the geometry a caller wrote lives on the parent of the queried node.
 */
function flatPressableStyle(testID: string): Record<string, unknown> {
  return flatten(screen.getByTestId(testID).parent?.props.style);
}

async function renderChat() {
  await render(
    <AppProviders>
      <NoorAIChatScreen port={answerNoorAIPort()} />
    </AppProviders>,
  );
  await waitFor(() => expect(screen.getByTestId('noor-ai-chat-composer-input')).toBeTruthy());
}

describe('the scope badge keeps its whole label', () => {
  it('does not let a flexible sibling shrink the badge', async () => {
    await renderChat();
    expect(flatStyle('noor-ai-chat-scope-pill').flexShrink).toBe(0);
  });

  it('renders the approved wording in full', async () => {
    await renderChat();
    // §06's wording. A test that accepted a prefix would accept the truncation.
    expect(screen.getByText(noorAIChatCopy.scope.pill)).toBeTruthy();
    expect(noorAIChatCopy.scope.pill).toBe('NoorLife questions only');
  });

  it('exposes the badge to a screen reader as scope, with the whole label', async () => {
    await renderChat();
    const label = String(screen.getByTestId('noor-ai-chat-scope-pill').props.accessibilityLabel);
    expect(label).toBe(`Scope. ${noorAIChatCopy.scope.pill}`);
  });
});

describe('the Send control keeps its whole label', () => {
  it('does not shrink below its content', async () => {
    await renderChat();
    expect(flatPressableStyle('noor-ai-chat-composer-send').flexShrink).toBe(0);
  });

  it('still meets the touch-target minimum', async () => {
    await renderChat();
    const send = flatPressableStyle('noor-ai-chat-composer-send');
    const scale = (send.minHeight as number) / moduleLayout.minTouchTarget;
    expect(scale).toBeGreaterThan(0);
    expect(send.minHeight).toBeCloseTo(scale * moduleLayout.minTouchTarget, 4);
  });

  it('renders the verb, not an abbreviation', async () => {
    await renderChat();
    expect(screen.getByText('Send')).toBeTruthy();
  });
});

describe('the header keeps its whole title and its targets', () => {
  it('renders the full screen title', async () => {
    await renderChat();
    // Measured complete on API 36 at a 1.30 font scale; asserted here so a layout change cannot
    // silently start clipping it.
    expect(screen.getByText(noorAIChatCopy.title)).toBeTruthy();
    expect(noorAIChatCopy.title).toBe('Ask Noor AI');
  });

  it('keeps Back, Help and Profile at the 44 dp minimum on both axes', async () => {
    await renderChat();

    for (const control of ['back', 'help', 'profile']) {
      const style = flatPressableStyle(`noor-ai-chat-header-${control}`);
      const width = style.width as number;
      const height = style.height as number;
      expect(typeof width).toBe('number');
      // Same dp scale for both axes, so the ratio to the token is the scale itself.
      expect(width / moduleLayout.minTouchTarget).toBeCloseTo(
        height / moduleLayout.minTouchTarget,
        4,
      );
      expect(width).toBeGreaterThanOrEqual(moduleLayout.minTouchTarget);
      expect(height).toBeGreaterThanOrEqual(moduleLayout.minTouchTarget);
    }
  });

  it('caps title growth rather than shrinking the type ramp', async () => {
    await renderChat();
    const title = screen.getByTestId('noor-ai-chat-header-title');
    // Growth is capped so a large OS size cannot push the title under the controls; the base size
    // still comes from the locked ramp, and scaling is never switched off.
    expect(title.props.maxFontSizeMultiplier).toBeGreaterThanOrEqual(1.3);
    expect(title.props.allowFontScaling).not.toBe(false);
  });
});
