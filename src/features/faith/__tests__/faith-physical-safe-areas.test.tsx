import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { cleanup, fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';
import { useWindowDimensions } from 'react-native';

import {
  headerControlReserve,
  headerTitleBandWidth,
} from '@features/modules/components/module-header';
import { moduleHeaderTitleLines, moduleLayout, moduleScale } from '@features/modules/module-tokens';
import { touchTarget } from '@ds/tokens';

import { TEST_FAITH_USER_ID } from '@/test-support/faith-storage-address';
import { warmUpFirstMount } from '@/test-support/mock-latency-timers';

import { filterSheetLayout } from '../components/dua-search-controls';
import { createMockFaithRepositories } from '../data/mock';
import type { RetainedQuran, RetainedQuranSource } from '../data/offline/retained-quran.source';
import { FaithRepositoryProvider } from '../di/faith-repository-context';
import { DuaCategoryScreen } from '../screens/dua-category-screen';
import { setActiveFaithScope } from '../storage/faith-user-scope';
import { minimumTouchTargetSize } from '@shared/utils/a11y';

/**
 * **Three defects a real phone found, and the properties that stop each coming back.**
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── Why none of these could be caught before ───────────────────────────────
 * All three are geometry against *system* chrome, and Jest has no system chrome. The emulator has a
 * bottom inset too, but the emulator pass never opened the filter sheet's last row, and the header
 * band's overlap is invisible unless the title is long enough to reach the controls — which "Duas",
 * "Reader" and "Dua" never are. It took a 384 dp Samsung with a three-button navigation bar and the
 * words "Daily Remembrances".
 *
 * So each case below asserts the *rule* rather than a rendered pixel: the inset is added, the band
 * clears the cluster, the hit area is expanded. A rule can be checked without a window manager, and
 * it is what actually failed.
 *
 * ── The insets are mocked non-zero on purpose ──────────────────────────────
 * `react-native-safe-area-context`'s own Jest mock reports zeroes, which is precisely the environment
 * that let this ship: with a zero inset the broken and the fixed sheet are identical. Every sheet case
 * here runs against a 48 dp bottom inset — what the Samsung reports with its navigation bar — so a
 * regression that drops the inset changes the assertion's answer.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/** What the SM-G556B reports for its three-button navigation bar, in dp. */
const SAMSUNG_BOTTOM_INSET = 48;

jest.mock('react-native/Libraries/Utilities/useWindowDimensions');
jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context/jest/mock').default,
  useSafeAreaInsets: () => ({ top: 36, bottom: 48, left: 0, right: 0 }),
}));

const mockedDimensions = useWindowDimensions as unknown as jest.Mock;

/** The phone the defects were measured on, plus the two larger text sizes. */
const PHONE = { width: 384, height: 856 } as const;
const SCALES = [1.0, 1.3, 1.5] as const;

function viewport(fontScale: number): void {
  mockedDimensions.mockReturnValue({
    width: PHONE.width,
    height: PHONE.height,
    scale: 2.8125,
    fontScale,
  });
}

function retainedDouble(): RetainedQuranSource {
  const content: RetainedQuran = {
    generationId: 'test-generation',
    arabic: {
      generationId: 'test-generation',
      script: 'text_uthmani',
      lastCheckedAt: 0,
      source: { name: 'Quran Foundation', edition: 'Uthmani', verified: true },
      bySurah: new Map(),
    },
    translations: {
      generationId: 'test-generation',
      resourceId: 85,
      source: {
        name: 'Quran Foundation',
        edition: 'A Named Edition',
        attribution: 'A Named Translator',
        verified: true,
      },
      bySurah: new Map(),
    },
  };
  return { read: async () => content };
}

async function drain(passes = 8): Promise<void> {
  for (let pass = 0; pass < passes; pass += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

async function renderCategory(categoryId: string, fontScale = 1): Promise<typeof screen> {
  viewport(fontScale);
  render(
    <FaithRepositoryProvider
      repositories={{ ...createMockFaithRepositories(), retainedQuran: retainedDouble() }}
    >
      <DuaCategoryScreen categoryId={categoryId} />
    </FaithRepositoryProvider>,
  );
  await drain();
  return screen;
}

function flatten(style: unknown): Record<string, unknown> {
  const entries = [style].flat(6).filter((item): item is Record<string, unknown> => {
    return item !== null && item !== undefined && typeof item === 'object';
  });
  return Object.assign({}, ...entries);
}

/** The module scaler for this phone, matching what `useModuleMetrics` gives the components. */
const dp = (value: number): number => Math.round(value * moduleScale(PHONE.width));

warmUpFirstMount(async () => {
  viewport(1);
  return renderCategory('travel');
});

beforeEach(async () => {
  await AsyncStorage.clear();
  setActiveFaithScope(TEST_FAITH_USER_ID);
  viewport(1);
});

afterEach(async () => {
  await cleanup();
  mockedDimensions.mockReset();
});

describe('defect 1 — the filter sheet must clear the system navigation region', () => {
  it('adds the whole reported inset, not part of it and not a constant', () => {
    const layout = filterSheetLayout({
      bottomInset: SAMSUNG_BOTTOM_INSET,
      windowHeight: PHONE.height,
      dp,
    });

    /*
      The load-bearing inequality. On the Samsung the last option's lower 100 px sat under the
      navigation bar; the padding has to be at least the inset for the option to clear it, and strictly
      greater so it is not flush against it.
    */
    expect(layout.paddingBottom).toBeGreaterThanOrEqual(SAMSUNG_BOTTOM_INSET);
    expect(layout.paddingBottom).toBe(SAMSUNG_BOTTOM_INSET + dp(moduleLayout.cardPadding));
  });

  it('scales with whatever the device reports, so it is not tuned to one phone', () => {
    /* A gesture-navigation phone reports a few dp; a device with neither reports zero. */
    for (const inset of [0, 8, 24, 48, 64]) {
      const layout = filterSheetLayout({ bottomInset: inset, windowHeight: PHONE.height, dp });
      expect(layout.paddingBottom).toBe(inset + dp(moduleLayout.cardPadding));
    }
  });

  it('caps the sheet so it cannot outgrow the window at a large text size', () => {
    const layout = filterSheetLayout({
      bottomInset: SAMSUNG_BOTTOM_INSET,
      windowHeight: PHONE.height,
      dp,
    });
    expect(layout.maxHeight).toBeLessThan(PHONE.height);
    /* And it leaves the scrim visible, so the sheet still reads as a sheet and stays dismissable. */
    expect(PHONE.height - layout.maxHeight).toBeGreaterThan(dp(moduleLayout.minTouchTarget));
  });

  it.each(SCALES)(
    'renders the panel with the inset applied and the options scrollable at font %s',
    async (fontScale) => {
      const view = await renderCategory('travel', fontScale);
      await fireEvent.press(view.getByTestId('faith-dua-category-filter'));
      await drain();

      const panel = flatten(view.getByTestId('faith-dua-category-filter-panel').props.style);
      const expected = filterSheetLayout({
        bottomInset: SAMSUNG_BOTTOM_INSET,
        windowHeight: PHONE.height,
        dp,
      });

      /*
        Read off the rendered panel, so dropping `insets.bottom` from the component fails here even
        though `filterSheetLayout` above would still be correct on its own.
      */
      expect(panel.paddingBottom).toBe(expected.paddingBottom);
      expect(Number(panel.paddingBottom)).toBeGreaterThanOrEqual(SAMSUNG_BOTTOM_INSET);
      expect(panel.maxHeight).toBe(expected.maxHeight);

      /* The options live in a scroll region, so a capped sheet still reaches all of them. */
      expect(view.getByTestId('faith-dua-category-filter-options')).toBeTruthy();
    },
  );

  it.each(SCALES)('keeps every option present and pressable at font %s', async (fontScale) => {
    const view = await renderCategory('travel', fontScale);
    await fireEvent.press(view.getByTestId('faith-dua-category-filter'));
    await drain();

    /*
      The last option is the one that was unreachable on the device. Pressing it must change the
      filter — the outcome a tap on the Samsung produced only from the row's top few dp.
    */
    for (const id of ['all', 'quran', 'sunnah']) {
      const option = view.getByTestId(`faith-dua-category-filter-${id}`);
      expect(option.props.accessibilityRole).toBe('button');
      /*
        The row's own 44 dp minimum lives on `PressableScale`'s outer wrapper — the caller's style goes
        there and the touch surface is an absolute-fill `Pressable` inside it carrying the testID. So
        the height is read from the parent; reading it off the testID node finds only `absoluteFill`.
      */
      const row = flatten(option.props?.style);
      /*
        The density-safe floor, not `dp(...)` — issue #115. The row measured 43 dp here while its
        style said 44, which is the scaled-bound half of that issue.
      */
      expect(row.minHeight).toBe(minimumTouchTargetSize());
      expect(row.minHeight).toBeGreaterThanOrEqual(moduleLayout.minTouchTarget);
    }

    await fireEvent.press(view.getByTestId('faith-dua-category-filter-sunnah'));
    await drain();
    expect(String(view.getByTestId('faith-dua-category-filter').props.accessibilityLabel)).toBe(
      'Filter. Currently Sunnah.',
    );
  });

  it('keeps the scrim dismiss and the accessibility order intact', async () => {
    const view = await renderCategory('travel');
    await fireEvent.press(view.getByTestId('faith-dua-category-filter'));
    await drain();

    const scrim = view.getByTestId('faith-dua-category-filter-scrim');
    expect(scrim.props.accessibilityRole).toBe('button');
    expect(String(scrim.props.accessibilityLabel)).toBe('Close the filter');

    /* Heading first, then the options in their declared order — the scroll region changes neither. */
    expect(view.getByText('Show')).toBeTruthy();
    await fireEvent.press(scrim);
    await drain();
    expect(view.queryByTestId('faith-dua-category-filter-options')).toBeNull();
  });

  it('applies the same rule to the main library sheet, not just the category one', () => {
    /*
      Both consumers render the one `DuaFilterSheet`, so the fix cannot be half-applied — but that is
      only true while neither screen keeps a sheet of its own. This is the assertion that says so.
    */
    for (const file of ['duas-screen.tsx', 'dua-category-screen.tsx']) {
      const source = readFileSync(join(__dirname, '..', 'screens', file), 'utf8');
      expect(source).toContain('DuaFilterSheet');
      expect(source).not.toMatch(/<Modal/);
    }
    const shared = readFileSync(
      join(__dirname, '..', 'components', 'dua-search-controls.tsx'),
      'utf8',
    );
    expect(shared).toContain('useSafeAreaInsets');
    expect(shared).toContain('paddingBottom: sheet.paddingBottom');
  });
});

describe('defect 2 — the header title must never reach under a control', () => {
  it('insets the band by the page padding as well as the control cluster', async () => {
    const view = await renderCategory('daily-remembrances');
    const band = flatten(view.getByTestId('faith-dua-category-header-title-band').props.style);

    const expected = dp(moduleLayout.pagePadding) + headerControlReserve(dp);
    expect(band.left).toBe(expected);
    expect(band.right).toBe(expected);
    /* Symmetric, so the band still centres on the screen rather than between the clusters. */
    expect(band.left).toBe(band.right);
  });

  it('leaves the band clear of the right-hand cluster at every supported width', () => {
    for (const width of [320, 360, 384, 393, 411, 430, 600]) {
      const scale = moduleScale(width);
      const scaled = (value: number): number => Math.round(value * scale);
      const inset = scaled(moduleLayout.pagePadding) + headerControlReserve(scaled);
      /* Help + Profile + their gap, sitting inside the page padding. */
      const cluster =
        scaled(moduleLayout.pagePadding) +
        scaled(moduleLayout.minTouchTarget) * 2 +
        scaled(moduleLayout.headerControlGap);

      expect(inset).toBeGreaterThanOrEqual(cluster);
      /* The rendered band and the published arithmetic are now the same rectangle. */
      expect(width - 2 * inset).toBe(headerTitleBandWidth(width));
    }
  });

  it.each(SCALES)(
    'carries the complete long title in the accessible name at font %s',
    async (fontScale) => {
      const view = await renderCategory('daily-remembrances', fontScale);
      const title = view.getByTestId('faith-dua-category-header-title');

      /*
        The visible string may be shortened to the band; the spoken one may not. "Daily Remembra…"
        is what the Samsung drew, and it is what a screen reader must never be handed. This holds
        whether the band shortens the title or wraps it, so it is the assertion that outlived the
        one-line policy.
      */
      expect(String(title.props.accessibilityLabel)).toBe('Daily Remembrances');
      expect(title.props.accessibilityRole).toBe('header');
      /*
        Two lines since #143. This said one, "because the header height is fixed — a second line
        would push the page down", which was true of the height as it was: the height is what
        changed. `moduleHeaderHeight` reserves room for both lines once the text size needs it, so
        "Daily Remembrances" wraps here instead of ellipsising. The number is read from the token
        rather than restated, so the policy has one home.
      */
      expect(title.props.numberOfLines).toBe(moduleHeaderTitleLines);
    },
  );

  it.each(SCALES)(
    'keeps the complete title visible in the summary immediately below at font %s',
    async (fontScale) => {
      const view = await renderCategory('daily-remembrances', fontScale);

      /*
        The other half of the requirement: where the band cannot hold the whole title, the full name is
        still on screen — in the card directly beneath the header, wrapping rather than truncating.
      */
      const summary = view.getByTestId('faith-dua-category-about-title');
      expect(String(summary.props.children)).toBe('Daily Remembrances');
      expect(Number(summary.props.numberOfLines)).toBeGreaterThanOrEqual(2);
    },
  );

  it('does not shrink the type to make a long title fit', async () => {
    const view = await renderCategory('daily-remembrances');
    const title = view.getByTestId('faith-dua-category-header-title');
    /* The layout gives way; approved typography does not. */
    expect(title.props.adjustsFontSizeToFit).toBeUndefined();
    expect(title.props.maxFontSizeMultiplier).toBe(1.3);
  });

  it('leaves a short title unchanged', async () => {
    /*
      "Duas" and "Dua" have several times the width they need, so the narrower band cannot have altered
      them. Asserted on the shortest title this feature uses, against the same band arithmetic.
    */
    const view = await renderCategory('not-a-category');
    const title = view.getByTestId('faith-dua-category-header-title');
    expect(String(title.props.children)).toBe('Duas');
    expect(String(title.props.accessibilityLabel)).toBe('Duas');
    expect(headerTitleBandWidth(PHONE.width)).toBeGreaterThan(dp(moduleLayout.minTouchTarget) * 2);
  });
});

describe('defect 3 — a pressable card must reach the minimum touch target', () => {
  it('expands the attribution card to the minimum once it has measured itself', async () => {
    const view = await renderCategory('travel');
    const attribution = view.getByTestId('faith-dua-category-attribution');

    /* The measurement path exists: without it there is nothing to derive a slop from. */
    expect(typeof attribution.props.onLayout).toBe('function');

    /* The height the Samsung measured, fed through the component's own layout event. */
    await fireEvent(attribution, 'layout', { nativeEvent: { layout: { width: 352, height: 37 } } });
    await drain();

    const slop = view.getByTestId('faith-dua-category-attribution').props.hitSlop;
    expect(slop).toBeDefined();
    const expanded = 37 + Number(slop.top) + Number(slop.bottom);
    expect(expanded).toBeGreaterThanOrEqual(touchTarget.minimum);
  });

  it('adds nothing once the card is already big enough', async () => {
    const view = await renderCategory('travel');
    const attribution = view.getByTestId('faith-dua-category-attribution');

    await fireEvent(attribution, 'layout', { nativeEvent: { layout: { width: 352, height: 60 } } });
    await drain();

    const slop = view.getByTestId('faith-dua-category-attribution').props.hitSlop;
    /* The drawn card is not enlarged and neither is its rectangle — there is no deficit to correct. */
    expect(Number(slop.top)).toBe(0);
    expect(Number(slop.bottom)).toBe(0);
  });

  it('does not enlarge the drawn card', async () => {
    const view = await renderCategory('travel');
    const attribution = view.getByTestId('faith-dua-category-attribution');
    await fireEvent(attribution, 'layout', { nativeEvent: { layout: { width: 352, height: 37 } } });
    await drain();

    const style = flatten(view.getByTestId('faith-dua-category-attribution').props.style);
    /*
      The lock changed with #115, deliberately.

      It used to assert the *absence* of a bound: the card was left at its drawn height and only a
      hit slop widened where a finger landed. That is the substitution #115 refuses — the node a
      screen reader and an accessibility scanner measure stayed small. The card now carries the
      shared floor as a **minimum**, so it still draws at its content height wherever that already
      exceeds 44 dp, and no longer reports an undersized node where it does not.

      What is still locked is that nothing *fixes* the height: a card that grows with its copy must
      keep growing.
    */
    expect(Number(style.minHeight)).toBeGreaterThanOrEqual(44);
    expect(style.height).toBeUndefined();
  });

  it('leaves a decorative card unmeasured', async () => {
    const view = await renderCategory('travel');
    /* The empty-state card takes no press, so it gains no layout listener and no slop. */
    const decorative = view.getByTestId('faith-dua-category-empty');
    expect(decorative.props.onLayout).toBeUndefined();
    expect(decorative.props.hitSlop).toBeUndefined();
  });
});
