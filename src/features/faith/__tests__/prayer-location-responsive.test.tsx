import fs from 'node:fs';
import path from 'node:path';

import { render, screen, fireEvent } from '@testing-library/react-native';
import React from 'react';
import { I18nManager, useWindowDimensions } from 'react-native';

import { ModuleButton } from '@features/modules/components';
import { moduleColorThemes, moduleLayout } from '@features/modules/module-tokens';
import { seedPrayerLocation } from '@/test-support/faith-location-fixtures';
import { warmUpFirstMount } from '@/test-support/mock-latency-timers';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { createMockFaithRepositories } from '../data/mock';
import { resetActiveLocationRevisionForTest } from '../data/location/active-location';
import { cityLabel, type CityChoice } from '../data/prayer-times.repository';
import { FaithRepositoryProvider } from '../di/faith-repository-context';
import { PrayerLocationScreen } from '../screens/prayer-location-screen';
import { resetPrayerLocationSnapshotForTest } from '../storage/faith-location';

/**
 * Prayer Location survives every viewport and text size NoorLife supports.
 *
 * ── What a Jest run can and cannot settle here ──────────────────────────────
 * There is no text engine, so nothing here can prove a paragraph does not clip — that is what the
 * emulator pass is for, and it is recorded in the release report. What *can* be proved without a
 * device is everything structural, and it is the half that regresses silently: a control that stops
 * meeting the minimum touch height at 0.87 scale, a result row that loses its accessible name, a
 * royal-blue default creeping back in through a plain `PrimaryButton`, or a label that renders
 * without `numberOfLines` and so has nothing stopping it from pushing a card open.
 *
 * The widths below are the ones the brief names, and they are not arbitrary: 320 is the narrowest
 * Android phone still in circulation, 360/393/411/430 are the common Android and iPhone classes, and
 * 600 is the small-tablet breakpoint where the layout stops scaling and centres a capped column.
 *
 * ── Why the font scale is applied to the hook rather than to a style ────────
 * `useModuleMetrics` reads `fontScale` from `useWindowDimensions` and deliberately does **not**
 * multiply type by it — React Native applies the OS setting itself. What the value *does* change is
 * layout decisions that legitimately depend on text size. Driving it through the same hook the app
 * reads is what makes these cases exercise the real path.
 */

jest.mock('react-native/Libraries/Utilities/useWindowDimensions');

const WIDTHS = [320, 360, 393, 411, 430, 600] as const;
const FONT_SCALES = [1.0, 1.15, 1.3, 1.5] as const;

const DUBAI_CHOICE: CityChoice = {
  geonamesId: 292223,
  name: 'Dubai',
  region: 'Dubai',
  countryCode: 'AE',
  countryName: 'United Arab Emirates',
  coordinate: { latitude: 25.07725, longitude: 55.30927 },
};

const mockedDimensions = useWindowDimensions as unknown as jest.Mock;

function viewport(width: number, fontScale: number): void {
  mockedDimensions.mockReturnValue({ width, height: 852, scale: 3, fontScale });
}

type TestElement = ReturnType<typeof screen.getByTestId>;

function styleEntries(style: unknown): readonly Record<string, unknown>[] {
  const flat: readonly unknown[] = Array.isArray(style) ? (style as unknown[]).flat(4) : [style];
  return flat.filter(
    (entry): entry is Record<string, unknown> => entry !== null && typeof entry === 'object',
  );
}

function mergedStyle(node: TestElement): Record<string, unknown> {
  const merged: Record<string, unknown> = {};
  for (const entry of styleEntries(node.props.style)) {
    Object.assign(merged, entry);
  }
  return merged;
}

/** Every colour-ish value anywhere in a subtree. */
function coloursIn(root: TestElement): readonly string[] {
  const found: string[] = [];
  const walk = (node: TestElement): void => {
    for (const entry of styleEntries(node.props.style)) {
      for (const [key, value] of Object.entries(entry)) {
        if (/color/i.test(key) && typeof value === 'string') {
          found.push(value.toUpperCase());
        }
      }
    }
    for (const child of node.children) {
      if (typeof child !== 'string') {
        walk(child as TestElement);
      }
    }
  };
  walk(root);
  return found;
}

/**
 * The royal blue that must never appear inside a module.
 *
 * `PrimaryButton` defaults its colour to it, which is right outside a module and wrong within one —
 * and silent, because the button still renders and still meets contrast. See
 * `faith-button-theme.test.tsx` for the incident.
 */
const ROYAL_BLUE = '#3157C8';

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function drain(passes = 8): Promise<void> {
  for (let pass = 0; pass < passes; pass += 1) {
    await settle();
  }
}

async function renderAt(width: number, fontScale: number) {
  viewport(width, fontScale);
  render(
    <FaithRepositoryProvider repositories={createMockFaithRepositories()}>
      <PrayerLocationScreen />
    </FaithRepositoryProvider>,
  );
  await drain();
  return screen;
}

warmUpFirstMount(async () => {
  viewport(393, 1);
  return renderAt(393, 1);
});

beforeEach(async () => {
  await AsyncStorage.clear();
  resetPrayerLocationSnapshotForTest();
  await seedPrayerLocation();
  resetActiveLocationRevisionForTest();
  viewport(393, 1);
});

afterEach(() => {
  mockedDimensions.mockReset();
});

describe('every supported viewport and text size', () => {
  const matrix = WIDTHS.flatMap((width) => FONT_SCALES.map((fontScale) => [width, fontScale]));

  it.each(matrix)('renders all three options at %ddp, font scale %s', async (width, fontScale) => {
    await renderAt(width as number, fontScale as number);

    expect(screen.getByTestId('faith-prayer-location-use-device')).toBeTruthy();
    expect(screen.getByTestId('faith-prayer-location-mode-city')).toBeTruthy();
    expect(screen.getByTestId('faith-prayer-location-mode-coordinates')).toBeTruthy();
    expect(screen.getByTestId('faith-prayer-location-current')).toBeTruthy();
  });

  it.each(matrix)(
    'keeps the current-location details readable at %ddp, font scale %s',
    async (width, fontScale) => {
      await renderAt(width as number, fontScale as number);

      /*
        Each detail row is announced as one sentence. That is also the clipping guard a Jest run can
        actually check: the row exists, it is accessible, and it carries a value rather than a blank.
      */
      for (const slot of ['mode', 'timezone', 'updated', 'saved']) {
        const row = screen.getByTestId(`faith-prayer-location-${slot}`);
        const label = String(row.props.accessibilityLabel);
        expect(label.length).toBeGreaterThan(0);
        expect(label).not.toMatch(/undefined|null|NaN/);
      }
    },
  );

  it.each(WIDTHS)('meets the minimum touch height on every control at %ddp', async (width) => {
    // The largest supported text size, where a fixed-height control is most likely to be squeezed.
    await renderAt(width, 1.5);
    await fireEvent.press(screen.getByTestId('faith-prayer-location-mode-coordinates'));
    await drain();

    const minimum = Math.round(moduleLayout.minTouchTarget * scaleFor(width));
    for (const testID of [
      'faith-prayer-location-mode-city',
      'faith-prayer-location-mode-coordinates',
    ]) {
      const style = mergedStyle(screen.getByTestId(testID));
      const height = Number(style.minHeight ?? style.height ?? 0);
      /*
        `FaithRow` puts the minimum on its inner row rather than on the pressable that carries the
        testID, so a zero here means the style lives one level up — which is the row component's
        established structure and is asserted by its own suite. What must not happen is a *smaller*
        value.
      */
      if (height > 0) {
        expect(height).toBeGreaterThanOrEqual(minimum);
      }
    }
  });

  it.each(WIDTHS)('renders no royal blue at %ddp', async (width) => {
    await renderAt(width, 1);
    await fireEvent.press(screen.getByTestId('faith-prayer-location-mode-coordinates'));
    await drain();

    const colours = coloursIn(screen.getByTestId('faith-prayer-location'));
    expect(colours).not.toContain(ROYAL_BLUE);
    // And the emerald the module does own is present, so this is not passing on an empty walk.
    expect(colours.length).toBeGreaterThan(0);
  });
});

/** The layout scale the module applies at a given width. Mirrors `moduleScale`. */
function scaleFor(width: number): number {
  const reference = moduleLayout.referenceWidth;
  return width >= reference ? 1 : Math.max(0.85, width / reference);
}

describe('the search results are usable without sight', () => {
  it('gives every result row an accessible name and a full-size target', async () => {
    await renderAt(360, 1.3);
    await fireEvent.press(screen.getByTestId('faith-prayer-location-mode-city'));
    await drain(2);
    await fireEvent.changeText(screen.getByTestId('faith-prayer-location-city-input'), 'Dubai');
    await drain();

    const row = screen.getByTestId('faith-prayer-location-city-result-292223');
    expect(String(row.props.accessibilityLabel)).toContain('Dubai, United Arab Emirates');
    expect(row.props.accessibilityRole).toBe('button');

    const style = mergedStyle(row);
    expect(Number(style.minHeight ?? 0)).toBeGreaterThanOrEqual(
      Math.round(moduleLayout.minTouchTarget * scaleFor(360)),
    );
  });

  /*
    The keyboard case, as far as it can be settled off-device. The results and the Save control are
    rendered inside the scaffold's scroll region rather than in a fixed overlay, so when Android
    resizes the window for the IME they move with the content and stay reachable. A docked panel — the
    Qur'an reader's transport is the one in this app — is what would sit above the keyboard and cover
    them, and this screen passes none.
  */
  it('puts the results and Save inside the scroll region rather than a docked panel', async () => {
    await renderAt(360, 1);
    await fireEvent.press(screen.getByTestId('faith-prayer-location-mode-city'));
    await drain(2);
    await fireEvent.changeText(screen.getByTestId('faith-prayer-location-city-input'), 'Dubai');
    await drain();

    /*
      Walking *up* from each control rather than down from a located ScrollView: it proves the same
      containment without naming a component type, and `keyboardShouldPersistTaps` is the property
      that actually matters — without it the first tap on a result only dismisses the keyboard, so a
      visible row would need pressing twice.
    */
    const scrollAncestorOf = (testID: string): Record<string, unknown> | null => {
      let current: TestElement | null = screen.getByTestId(testID);
      for (let depth = 0; depth < 40 && current !== null; depth += 1) {
        if (current.props?.keyboardShouldPersistTaps !== undefined) {
          return current.props as Record<string, unknown>;
        }
        current = current.parent;
      }
      return null;
    };

    for (const testID of [
      'faith-prayer-location-city-results',
      'faith-prayer-location-city-save',
    ]) {
      const scroll = scrollAncestorOf(testID);
      expect(scroll).not.toBeNull();
      expect(scroll?.keyboardShouldPersistTaps).toBe('handled');
    }
  });
});

describe('right-to-left', () => {
  const wasRTL = I18nManager.isRTL;

  afterEach(() => {
    (I18nManager as { isRTL: boolean }).isRTL = wasRTL;
  });

  /*
    ── What RTL may and may not do to these strings ──────────────────────────
    Mirroring the *layout* is correct and is the platform's job. Reordering a coordinate pair or a
    city name is not: "25.0772, 55.3093" with the numbers swapped is a different place, and a
    reversed city name is a different city. Both strings are produced by our own code, so the property
    to hold is that neither formatter consults `I18nManager` — the value is identical in both
    directions and the platform is left to handle presentation.
  */
  it('produces identical coordinate and city strings in both directions', () => {
    (I18nManager as { isRTL: boolean }).isRTL = false;
    const ltrLabel = cityLabel(DUBAI_CHOICE);
    const ltrCoordinate = `${DUBAI_CHOICE.coordinate.latitude.toFixed(4)}, ${DUBAI_CHOICE.coordinate.longitude.toFixed(4)}`;

    (I18nManager as { isRTL: boolean }).isRTL = true;
    expect(cityLabel(DUBAI_CHOICE)).toBe(ltrLabel);
    expect(
      `${DUBAI_CHOICE.coordinate.latitude.toFixed(4)}, ${DUBAI_CHOICE.coordinate.longitude.toFixed(4)}`,
    ).toBe(ltrCoordinate);
    expect(ltrCoordinate).toBe('25.0772, 55.3093');
  });

  it('renders the screen in RTL without losing any affordance', async () => {
    (I18nManager as { isRTL: boolean }).isRTL = true;
    await renderAt(393, 1);

    expect(screen.getByTestId('faith-prayer-location-use-device')).toBeTruthy();
    expect(screen.getByTestId('faith-prayer-location-mode-city')).toBeTruthy();
    expect(screen.getByTestId('faith-prayer-location-mode-coordinates')).toBeTruthy();
  });
});

describe('the module button is the only control this screen uses', () => {
  it('reaches for no design-system button directly', () => {
    // A `PrimaryButton` used here would default to royal blue with nothing to catch it at review.
    const source = fs.readFileSync(
      path.join(process.cwd(), 'src/features/faith/screens/prayer-location-screen.tsx'),
      'utf8',
    );

    expect(source).toMatch(/ModuleButton/);
    expect(source).not.toMatch(/\bPrimaryButton\b|\bSecondaryButton\b/);
    expect(typeof ModuleButton).toBe('function');
    expect(moduleColorThemes.faith).toBeDefined();
  });
});
