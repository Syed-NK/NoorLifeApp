import { render, screen } from '@testing-library/react-native';
import { readFileSync } from 'node:fs';
import { Text } from 'react-native';

import { ModuleTwoColumn } from '../components/module-card';
import { ModuleProvider } from '../module-context';
import { faithHeroGeometry, moduleLayout } from '../module-tokens';

/**
 * That the pair actually changes axis, and that nothing inside it is fixed-height.
 *
 * ── What this covers that the rule test does not ────────────────────────────
 * `module-two-column-stacking.test.tsx` pins the boundary arithmetic. This file pins the *rendered
 * consequence*: at the accepted baseline the pair is a row, at font scale 1.5 it is a column, and
 * in neither case does any wrapper carry a height that could clip a card that grew.
 *
 * ── What it cannot cover, stated plainly ────────────────────────────────────
 * Not the ellipsis itself. Jest registers no font and measures no glyph, so no assertion here can
 * prove a label fits — that is what the emulator captures in the phase report are for. What is
 * assertable is the geometry that makes fitting possible, which is the part a future edit breaks.
 */

const mockWindow = { width: 411, height: 914, scale: 2.625, fontScale: 1 };

jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => mockWindow,
}));

async function renderPair(): Promise<void> {
  await render(
    <ModuleProvider moduleId="faith">
      <ModuleTwoColumn
        testID="pair"
        left={<Text testID="left">Verse of the day</Text>}
        right={<Text testID="right">Today’s worship</Text>}
      />
    </ModuleProvider>,
  );
}

/** Flattens whatever shape the style prop arrived in, so an array or a nested array both read. */
function styleOf(testID: string): Record<string, unknown> {
  const style = screen.getByTestId(testID).props.style as unknown;
  const flatten = (value: unknown): Record<string, unknown>[] =>
    Array.isArray(value) ? value.flatMap(flatten) : value ? [value as Record<string, unknown>] : [];
  return Object.assign({}, ...flatten(style)) as Record<string, unknown>;
}

afterEach(() => {
  mockWindow.width = 411;
  mockWindow.fontScale = 1;
});

describe('the two-column pair at the accepted baseline', () => {
  it('renders as a row at 411 dp and font scale 1.0', async () => {
    await renderPair();
    expect(styleOf('pair').flexDirection).toBe('row');
  });

  it('keeps the approved gap between the cards', async () => {
    await renderPair();
    expect(styleOf('pair').columnGap).toBe(moduleLayout.twoColumnGap);
  });

  it.each([1.15, 1.3])('is still a row at font scale %s', async (fontScale) => {
    mockWindow.fontScale = fontScale;
    await renderPair();
    expect(styleOf('pair').flexDirection).toBe('row');
  });
});

describe('the two-column pair when it cannot hold its copy', () => {
  it('stacks at 411 dp and font scale 1.5', async () => {
    mockWindow.fontScale = 1.5;
    await renderPair();

    const style = styleOf('pair');
    // A column is the default direction, so the assertion is that `row` is *absent* rather than
    // that `column` is present — setting it explicitly would be a second way to express the default.
    expect(style.flexDirection).toBeUndefined();
    expect(style.rowGap).toBe(moduleLayout.twoColumnGap);
  });

  it.each([1.15, 1.3, 1.5])('stacks at 320 dp and font scale %s', async (fontScale) => {
    mockWindow.width = 320;
    mockWindow.fontScale = fontScale;
    await renderPair();
    expect(styleOf('pair').flexDirection).toBeUndefined();
  });

  it('still renders both cards when stacked', async () => {
    mockWindow.fontScale = 1.5;
    await renderPair();
    // Stacking must never be a way of dropping one of them.
    expect(screen.getByTestId('left')).toBeTruthy();
    expect(screen.getByTestId('right')).toBeTruthy();
  });

  it('gives the stacked wrapper no height, so each card grows to its own content', async () => {
    mockWindow.fontScale = 1.5;
    await renderPair();

    const style = styleOf('pair');
    expect(style.height).toBeUndefined();
    expect(style.maxHeight).toBeUndefined();
    // `flex` on the wrapper would make the two cards share the viewport height instead of taking
    // what their copy needs — the exact failure this stage exists to remove.
    expect(style.flex).toBeUndefined();
  });
});

describe('heights that must stay content-driven', () => {
  it('does not pin the height of a compact date card', () => {
    // `compactCardHeight` is a token nothing may apply as a fixed height: an observance name plus a
    // date cannot be guaranteed to fit a constant, and the card is allowed to grow instead.
    expect(moduleLayout.compactCardHeight).toBeGreaterThan(0);
    const applied = readFileSync(
      require.resolve('../faith/faith-home-content.tsx'),
      'utf8',
    ).includes('compactCardHeight');
    expect(applied).toBe(false);
  });

  it('keeps the shared Faith hero rectangle at 144 dp', () => {
    // Restated here so a change to the stacking work cannot quietly move the heroes with it. The
    // per-hero assertions live in `faith-hero-geometry.test.tsx`.
    expect(faithHeroGeometry.height).toBe(moduleLayout.faithHeroHeight);
    expect(faithHeroGeometry.height).toBe(144);
  });
});
