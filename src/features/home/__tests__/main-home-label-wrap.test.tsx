import { cleanup, render, screen, within } from '@testing-library/react-native';
import { Dimensions, StyleSheet, type ViewStyle } from 'react-native';

import { AppProviders } from '@application/providers/app-providers';
import { TodayAgendaProvider } from '@application/providers/today-agenda-provider';
import { installMockLatencyTimers } from '@/test-support/mock-latency-timers';

import { LOCKED } from '../main-home-metrics';
import { MainHomeScreen } from '../screens/main-home-screen';

/**
 * **Three Main Home labels that clipped once the screen started scaling** — issue #148.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * #141 restored dynamic text scaling. §8 asks for scaling *without* clipping, and the second half was
 * not met: measured on a Samsung SM-G556B at 384 dp, three labels rendered in full at font scale 1.0
 * and ellipsized at 1.5 —
 *
 *   `Nothing planned for today`  →  `Nothing planned for tod…`
 *   `Family Check-in`            →  `Family Check…`
 *   `Unlock family connection`   →  `Unlock family conne…`
 *
 * They could not clip before, because `HomeText` was `allowFontScaling={false}` and drew them at
 * their 1.0 size whatever the OS setting. So this is the remainder of #141's requirement, not a
 * reason to undo it — and the fix must not touch scaling, the cap, or the locked ramp.
 *
 * ── Why two lines, and why the containers already allow it ─────────────────
 * The same role already wraps on the card beside it: `progressSupport` renders `Included with
 * Premium` on two lines and always has. `home-summary-row.tsx` also records that "§10 forbids
 * truncating, not resizing", so an ellipsis on a locked label is against the lock. The summary card
 * carries `minHeight` (since #141) and the Today card carries `minHeight` too, so a second line has
 * somewhere to go, and #141 made the column's measured height drive the scroll decision — growth
 * reaches the fallback instead of being cropped.
 *
 * ── What Jest can and cannot show here ────────────────────────────────────
 * Not the ellipsis: no font is registered under Jest, so no glyph has a width and nothing truncates.
 * What is pinned instead is the property that made truncation possible — a label pinned to one line
 * inside a box that could not grow — asserted as the line allowance, the absence of a clipping
 * height, and scaling still being on. The ellipsis itself is a device measurement, recorded in the PR.
 * ═══════════════════════════════════════════════════════════════════════════
 */

installMockLatencyTimers(() => renderHome());

const BASELINE = { width: 393, height: 1400, scale: 3 } as const;

function pinWindow(fontScale: number): void {
  const window = { ...BASELINE, fontScale };
  (Dimensions as unknown as { set: (d: unknown) => void }).set({ window, screen: window });
}

/**
 * Renders and waits for the dashboard to resolve.
 *
 * The body is a skeleton until the mock dashboard settles, so a query fired straight after `render`
 * finds the navigation and nothing else. Every case here is about the resolved content, so the wait
 * belongs in the helper rather than being repeated — and forgotten once.
 */
/**
 * A plan that was read successfully and is empty.
 *
 * Without it the timeline renders `Your plan is unavailable — open Planner`, which is a different
 * sentence for a different situation. The label under test is the *empty* one, so the port has to say
 * `ready` with nothing in it.
 */
const EMPTY_PLAN = {
  status: 'ready',
  items: [],
  today: '2026-09-01',
  reload: async () => {},
} as const;

async function renderHome(fontScale = 1) {
  pinWindow(fontScale);
  const view = await render(
    <AppProviders>
      <TodayAgendaProvider state={EMPTY_PLAN}>
        <MainHomeScreen simulateFailure={false} />
      </TodayAgendaProvider>
    </AppProviders>,
  );
  await screen.findByTestId('main-home-timeline');
  return view;
}

/* Unmount before touching `Dimensions` again — a mounted tree would take that update outside `act`. */
afterEach(async () => {
  await cleanup();
  pinWindow(1);
});

function flatten(style: unknown): ViewStyle {
  return (StyleSheet.flatten(style as ViewStyle) ?? {}) as ViewStyle;
}

/**
 * The three strings this issue is about, exactly as the product renders them.
 *
 * Queried by their visible text rather than a testID: the defect was about *these words* being cut,
 * so a case that stopped matching the copy should fail rather than quietly assert about some other
 * label.
 */
/**
 * Resolves a label unambiguously.
 *
 * `Family Check-in` names both the summary card and a quick action, so a screen-level query matches
 * two nodes and throws. The summary card is the one this issue is about, so the lookup is scoped to
 * it; the other two strings are unique.
 */
function label(text: string) {
  if (text === 'Family Check-in') {
    return within(screen.getByTestId('family-check-in-card')).getByText(text);
  }
  return screen.getByText(text);
}

const CLIPPED_LABELS = [
  'Nothing planned for today',
  'Family Check-in',
  'Unlock family connection',
] as const;

describe('every label that clipped may now take a second line', () => {
  it.each(CLIPPED_LABELS)('gives "%s" more than one line', async (text) => {
    await renderHome();

    const node = label(text);
    // One line is the defect, and it is the only value that reproduces it.
    expect(node.props.numberOfLines).toBeGreaterThanOrEqual(2);
  });

  it.each(CLIPPED_LABELS)('keeps "%s" scaling with the OS text size', async (text) => {
    await renderHome(1.5);

    const node = label(text);
    /*
      Disabling scaling on these three would "fix" the ellipsis by reintroducing the #141 defect in
      miniature, so it is refused here as well as there.
    */
    expect(node.props.allowFontScaling).not.toBe(false);
    expect(node.props.maxFontSizeMultiplier ?? null).toBeNull();
  });

  it.each(CLIPPED_LABELS)('does not shrink "%s" to fit instead of wrapping', async (text) => {
    await renderHome(1.5);

    const node = label(text);
    // `adjustsFontSizeToFit` would trade the ellipsis for text smaller than the locked ramp.
    expect(node.props.adjustsFontSizeToFit).not.toBe(true);
  });
});

describe('the containers can absorb the second line', () => {
  /**
   * Both parents, and the property that matters is the same for each: a floor, never a fixed height.
   *
   * A `height` here is what turns a wrapped label back into a cropped one — the label grows, the box
   * does not, and nothing reports an error. This is the "text growth without parent-layout growth"
   * case, asserted on the two containers that hold the three labels.
   */
  it.each([
    ['main-home-timeline', LOCKED.today.cardHeight],
    ['family-check-in-card', LOCKED.summary.height],
    ['overall-progress-card', LOCKED.summary.height],
  ] as const)('gives %s a floor rather than a fixed height', async (testID, locked) => {
    await renderHome();

    const style = flatten(screen.getByTestId(testID).props.style);
    expect(style.minHeight).toBe(locked);
    expect(style.height).toBeUndefined();
    expect(style.maxHeight).toBeUndefined();
  });

  /**
   * The timeline row, which is the one container whose height is not its own.
   *
   * Its style still declares the locked 23 dp row height, but `PressableScale` floors `minHeight` to
   * the 44 dp touch target and applies it last, so 44 is the real minimum — measured at 44.1 dp on
   * the device. Two lines of `activity` at a 1.5 scale measure about 39 dp, which fits, and the PR
   * records the device measurement rather than resting on that arithmetic. What is asserted here is
   * that nothing caps it: no `maxHeight`, and the 44 dp floor intact.
   */
  it('leaves the timeline row uncapped and at the touch-target floor', async () => {
    await renderHome();

    const row = flatten(screen.getByTestId('timeline-row-next-prayer').props.style);
    expect(row.maxHeight).toBeUndefined();
    expect(Number(row.minHeight)).toBeGreaterThanOrEqual(44);
  });
});

describe('nothing else about these surfaces moved', () => {
  it('keeps the locked presentation and its accessible names', async () => {
    await renderHome();

    // The lock badges and the locked wording are what #148 must not disturb.
    expect(screen.getByTestId('family-check-in-lock')).toBeTruthy();
    expect(screen.getByTestId('overall-progress-lock')).toBeTruthy();
    expect(
      screen.getAllByLabelText('Family Check-in, Premium feature').length,
    ).toBeGreaterThanOrEqual(1);
  });

  it('leaves the short labels on one line, so the change is scoped to the roles that clipped', async () => {
    await renderHome();

    /*
      `summaryValue` and `time` never clipped and are not part of this. If a future edit relaxed every
      `HomeText` in the file, this is what would notice.
    */
    expect(screen.getByText('Premium').props.numberOfLines).toBe(1);
  });
});

/**
 * **The hero headline, which lost its last word** — issue #151.
 *
 * `HERO_HEADLINE` is authored as three hard-wrapped lines, and the headline was capped at
 * `numberOfLines={3}` to match. That was right while the authored line count and the *rendered* line
 * count were the same number — true only while Main Home did not scale. Once #141 restored scaling
 * the third authored line stopped fitting the fixed 182 dp copy column at a 1.5 text scale, wrapped
 * onto a fourth rendered line, and the cap discarded it: both devices drew `beautifully in`, and the
 * sentence the hero exists to say never finished.
 *
 * The cap is gone rather than raised. Four would fail the same way one text size later, and every
 * other lever is worse than a taller card — shrinking the type leaves the locked ramp, widening the
 * column runs the copy under the artwork, and a fixed height is the clipping being removed. The card
 * already grows from its *measured* copy column, so the extra line has somewhere to go at any scale.
 */
describe('the hero headline can finish its sentence', () => {
  const HEADLINE = 'Your family,\nyour day,\nbeautifully in sync.';

  it('keeps the authored copy and its line breaks exactly', async () => {
    await renderHome();

    // Lock §6 fixes the words and the breaks; #151 changed neither.
    expect(screen.getByTestId('main-home-hero-title').props.children).toBe(HEADLINE);
  });

  it.each([1, 1.5])(
    'caps the headline at no number of lines at font scale %s',
    async (fontScale) => {
      await renderHome(fontScale);

      const title = screen.getByTestId('main-home-hero-title');
      /*
      Any cap reintroduces the defect — three drops the fourth line at 1.5, and four drops the fifth
      at the text size above it. This is the assertion a "just bump it to 4" edit has to get past.
    */
      expect(title.props.numberOfLines).toBeUndefined();
      expect(title.props.ellipsizeMode).toBeUndefined();
    },
  );

  it.each([1, 1.5])(
    'does not buy the room by shrinking the type at font scale %s',
    async (fontScale) => {
      await renderHome(fontScale);

      const title = screen.getByTestId('main-home-hero-title');
      expect(title.props.adjustsFontSizeToFit).not.toBe(true);
      expect(title.props.allowFontScaling).not.toBe(false);
      expect(title.props.maxFontSizeMultiplier ?? null).toBeNull();
    },
  );

  it('grows the hero from the measured copy column rather than a fixed height', async () => {
    await renderHome();

    /*
      The growth mechanism the fix depends on. A `height` here would crop the extra line straight back
      off, and the card would report no error while doing it.
    */
    const hero = flatten(screen.getByTestId('main-home-hero').props.style);
    expect(hero.height).toBeUndefined();
    expect(hero.maxHeight).toBeUndefined();
    expect(Number(hero.minHeight)).toBeGreaterThanOrEqual(LOCKED.hero.height);
  });

  it('leaves the eyebrow and the call to action as they were', async () => {
    await renderHome();

    // Scoped to the headline: the one-line eyebrow above it is not part of #151.
    expect(screen.getByText('Today with NoorLife').props.numberOfLines).toBe(1);
    expect(screen.getByText('View My Day')).toBeTruthy();
  });
});

/**
 * **The quick-action label that lost a word at the default text size** — issue #150.
 *
 * On a Samsung SM-G556B at 384 dp and font scale **1.0**, the first quick action painted `Add` for
 * `Add Task`, with no ellipsis — while `Log Wellness` and `Family Check-in` rendered whole in tiles
 * of the same width. Measured: the cut label's node was 46.2 dp, the intact one beside it 77.9 dp. So
 * it was never a width problem, and the node kept reporting the full string, which is why nothing
 * upstream could see it.
 *
 * The cause was `adjustsFontSizeToFit` with `numberOfLines={1}`. It is an iOS-first prop that React
 * Native maps to Android autosizing, and its interaction with a shrink-wrapped row and `ellipsize`
 * drops text silently. It also made the outcome non-monotonic: at 1.5 the same tile rendered
 * `Add Task` in full, so *more* text was visible at a *larger* size.
 *
 * There is no adaptive-label mechanism behind this and never was — `QuickAction` carries one
 * `label: string`, and no measurement, cache or width rule chooses between variants. Removing the
 * shrink makes it ordinary text layout, which is monotonic by construction: more room, or smaller
 * type, can only ever show more.
 */
describe('quick-action labels are laid out, not shrunk', () => {
  const TILES = [
    ['quick-action-add-task', 'Add Task'],
    ['quick-action-log-wellness', 'Log Wellness'],
    ['quick-action-family-check-in', 'Family Check-in'],
  ] as const;

  /** The label inside one tile — `Family Check-in` also names the summary card above. */
  function tileLabel(testID: string, text: string) {
    return within(screen.getByTestId(testID)).getByText(text);
  }

  it.each(TILES)('renders %s with its whole label', async (testID, text) => {
    await renderHome();

    // The string itself, never a shortened variant: there is no compact label to fall back to.
    expect(tileLabel(testID, text)).toBeTruthy();
  });

  it.each([1, 1.5])('never shrinks a quick-action label at font scale %s', async (fontScale) => {
    await renderHome(fontScale);

    for (const [testID, text] of TILES) {
      const props = tileLabel(testID, text).props;
      /*
        `adjustsFontSizeToFit` is the defect itself, and `minimumFontScale` is inert without it — both
        are refused so a future edit cannot reinstate the silent cut by reaching for either.
      */
      expect(props.adjustsFontSizeToFit).not.toBe(true);
      expect(props.minimumFontScale).toBeUndefined();
      /*
        And still scales. A call site cannot currently switch this off — `HomeText` places
        `allowFontScaling` *after* its prop spread, so the component wins — but that ordering is the
        only thing making it true, and it is one line away from being reversed. Asserted on the
        rendered outcome rather than on the call site, so it holds whichever end the value comes from.
      */
      expect(props.allowFontScaling).not.toBe(false);
      expect(props.maxFontSizeMultiplier ?? null).toBeNull();
    }
  });

  it.each([1, 1.5])('lets every quick-action label wrap at font scale %s', async (fontScale) => {
    await renderHome(fontScale);

    for (const [testID, text] of TILES) {
      // One line is what forced the shrink; two is what `ActionTile` chose for the same problem.
      expect(tileLabel(testID, text).props.numberOfLines).toBe(2);
    }
  });

  /**
   * Monotonicity, stated as the property rather than as two screenshots.
   *
   * The defect showed *more* text at a larger size than at a smaller one. Ordinary layout cannot do
   * that, and what makes it ordinary is that nothing about the label depends on the font scale — the
   * same props at 1.0 and 1.5, so the only thing that changes is how the text flows.
   */
  it('decides nothing from the font scale', async () => {
    await renderHome(1);
    const atOne = TILES.map(([id, text]) => {
      const p = tileLabel(id, text).props;
      return {
        lines: p.numberOfLines,
        shrink: p.adjustsFontSizeToFit,
        scaling: p.allowFontScaling,
      };
    });

    await cleanup();
    await renderHome(1.5);
    const atOneFive = TILES.map(([id, text]) => {
      const p = tileLabel(id, text).props;
      return {
        lines: p.numberOfLines,
        shrink: p.adjustsFontSizeToFit,
        scaling: p.allowFontScaling,
      };
    });

    expect(atOneFive).toEqual(atOne);
  });

  it('keeps the tile a 44 dp target and the accessible name whole', async () => {
    await renderHome();

    for (const [testID, text] of TILES) {
      const node = screen.getByTestId(testID);
      expect(Number(flatten(node.props.style).minHeight)).toBeGreaterThanOrEqual(44);
      /*
        Read off the tile rather than queried across the screen: `Family Check-in, Premium feature`
        also names the summary card, so a screen-level lookup matches two nodes and throws. The
        spoken name always carried the full label; the visible one now matches it.
      */
      expect(node.props.accessibilityLabel).toBe(`${text}, Premium feature`);
    }
  });
});
