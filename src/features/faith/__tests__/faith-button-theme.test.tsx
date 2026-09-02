import fs from 'node:fs';
import path from 'node:path';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { render, screen, fireEvent } from '@testing-library/react-native';
import React from 'react';

import { elementSize, neutralColors, semanticColors, textScale, touchTarget } from '@ds/tokens';
import { variantFontScaleClamp } from '@ds/typography/text-styles';
import { ModuleButton, type ModuleButtonProps } from '@features/modules/components';
import { AA_TEXT, contrastRatio } from '@features/modules/contrast';
import { ModuleProvider } from '@features/modules/module-context';
import { moduleColorThemes, moduleNeutrals } from '@features/modules/module-tokens';
import {
  seedPrayerLocation,
  TEST_LOCATION_COORDINATE,
} from '@/test-support/faith-location-fixtures';
import { warmUpFirstMount } from '@/test-support/mock-latency-timers';

import { createMockFaithRepositories } from '../data/mock';
import { resetActiveLocationRevisionForTest } from '../data/location/active-location';
import { FaithRepositoryProvider } from '../di/faith-repository-context';
import { PrayerLocationScreen } from '../screens/prayer-location-screen';
import { readStoredLocation, resetPrayerLocationSnapshotForTest } from '../storage/faith-location';

/**
 * Faith controls wear Faith's palette, and the royal-blue default cannot come back.
 *
 * ── The defect ──────────────────────────────────────────────────────────────
 * `PrimaryButton` and `SecondaryButton` default their colour to `semanticColors.primary` —
 * `#3157C8`, the global royal blue. That default is right for the entry and auth flows, which sit
 * outside any module, and wrong inside one. It is also *silent*: the button renders, works and meets
 * contrast; it simply belongs to another app. Prayer Location shipped three of them on an emerald
 * screen because nobody passed `color`.
 *
 * `ModuleButton` binds the active module's palette, so forgetting is no longer possible. The scan at
 * the end of this file is what stops a future screen reaching past it.
 */

const FAITH = moduleColorThemes.faith;

warmUpFirstMount(() => renderScreen());

async function renderScreen() {
  await render(
    <FaithRepositoryProvider repositories={createMockFaithRepositories()}>
      <PrayerLocationScreen />
    </FaithRepositoryProvider>,
  );
  return screen;
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * The element type every query in this file returns.
 *
 * Derived from the query rather than imported, because the rendered-tree element type is not part
 * of `@testing-library/react-native`'s public surface — reaching for it means naming the transitive
 * `test-renderer` package. `ReturnType` gets the same type with nothing extra to keep in step, and
 * it carries `parent`, `props` and `children`, which is the whole of what the traversal needs.
 */
type TestElement = ReturnType<typeof screen.getByTestId>;

/**
 * Every style object attached to one node, in the order React Native would apply them.
 *
 * A `style` prop is a value, an array, or a nest of arrays, and the entries are kept **separate**
 * rather than merged here on purpose: `coloursIn` has to see a colour that a later entry overrides,
 * because a royal blue that something else paints over is still a royal blue in the source.
 */
function styleEntries(style: unknown): readonly Record<string, unknown>[] {
  const flat: readonly unknown[] = Array.isArray(style) ? (style as unknown[]).flat(4) : [style];
  return flat.filter(
    (entry): entry is Record<string, unknown> => entry !== null && typeof entry === 'object',
  );
}

/** One node's own resolved style, flattened. Never its children's, never its ancestors'. */
function ownStyle(node: TestElement): Record<string, unknown> {
  const merged: Record<string, unknown> = {};
  for (const entry of styleEntries(node.props.style)) {
    Object.assign(merged, entry);
  }
  return merged;
}

/**
 * The resolved style of the named control's own root.
 *
 * ── Why the query result is not the node that carries the appearance ─────────
 * `PressableScale` puts the caller's style on an outer animated view and renders the `Pressable` as
 * an absolutely-positioned hit overlay inside it. The `testID` travels with the accessibility props
 * onto that overlay, so the queried node's only style is its inset — the fill, the outline, the
 * radius and the height all live one level *above* it.
 *
 * ── Why the walk stops at the first `borderRadius` ──────────────────────────
 * That is the control's own root: every button root in the design system carries `radius.control`.
 * Continuing past it reached the card behind the button, which has a radius and a white background
 * of its own — and merging that far reported the card's `#FFFFFF` as Save's fill and the card's
 * border as Cancel's outline.
 *
 * ── Why a miss throws rather than returning `{}` ────────────────────────────
 * An empty object makes a negative assertion pass for the wrong reason. `expect(borderWidth ?? 0)`
 * `.toBe(0)` is satisfied by a style that was never found, so a traversal broken by a change inside
 * `PressableScale` would report Cancel as correct instead of reporting itself as broken.
 */
function controlStyle(testID: string): Record<string, unknown> {
  const [node] = screen.getAllByTestId(testID, { includeHiddenElements: true });
  let current: TestElement | null = node ?? null;
  for (let depth = 0; depth <= CONTROL_ROOT_MAX_DEPTH && current !== null; depth += 1) {
    const style = ownStyle(current);
    if (style.borderRadius !== undefined) {
      return style;
    }
    current = current.parent;
  }
  throw new Error(
    `No control root found within ${CONTROL_ROOT_MAX_DEPTH} ancestors of "${testID}". ` +
      'A design-system button root always carries a borderRadius, so either the testID is not on a ' +
      'button or PressableScale no longer nests the way controlStyle assumes.',
  );
}

/**
 * How far above the queried node the control's root may sit.
 *
 * The overlay's parent is the root, so one hop is the real distance. The allowance is larger to
 * absorb a wrapper element without a test change, and bounded so a runaway walk cannot reach the
 * screen and report the page background as a button fill.
 */
const CONTROL_ROOT_MAX_DEPTH = 6;

/** Every colour-ish value anywhere in a subtree, for the "no blue survives" assertion. */
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
        walk(child);
      }
    }
  };
  walk(root);
  return found;
}

async function openForm() {
  await fireEvent.press(await screen.findByTestId('faith-prayer-location-mode-coordinates'));
  await settle();
}

/** Fills valid coordinates and previews them, which is what enables Save. */
async function previewDubai() {
  await fireEvent.changeText(
    await screen.findByTestId('faith-prayer-location-latitude-input'),
    '25.2048',
  );
  await settle();
  await fireEvent.changeText(
    await screen.findByTestId('faith-prayer-location-longitude-input'),
    '55.2708',
  );
  await settle();
  await fireEvent.press(await screen.findByTestId('faith-prayer-location-preview-action'));
  await settle();
}

beforeEach(async () => {
  await AsyncStorage.clear();
  resetActiveLocationRevisionForTest();
  resetPrayerLocationSnapshotForTest();
  await seedPrayerLocation();
});

describe('the Prayer Location action area wears Faith’s palette', () => {
  it('fills Save with the module’s accessible emerald, not the global primary', async () => {
    await renderScreen();
    await openForm();
    // Enabled first: a disabled button correctly renders the neutral disabled fill, not the theme's.
    await previewDubai();

    const save = controlStyle('faith-prayer-location-save');
    expect(save.backgroundColor).toBe(FAITH.fill);
    expect(save.backgroundColor).not.toBe(semanticColors.primary);
  });

  /**
   * Disabled must not look enabled — and must not look like the theme either.
   */
  it('renders the disabled Save in the neutral disabled fill', async () => {
    await renderScreen();
    await openForm();

    const save = controlStyle('faith-prayer-location-save');
    expect(save.backgroundColor).not.toBe(FAITH.fill);
    expect(save.backgroundColor).toBe(neutralColors.disabled);
  });

  it('outlines Preview in the module ink rather than blue', async () => {
    await renderScreen();
    await openForm();

    await screen.findByTestId('faith-prayer-location-preview-action');
    const preview = controlStyle('faith-prayer-location-preview-action');
    expect(preview.borderColor).toBe(FAITH.ink);
    expect(preview.borderColor).not.toBe(semanticColors.primary);
  });

  it('gives Cancel no boxed outline, so it cannot compete with Save', async () => {
    await renderScreen();
    await openForm();

    await screen.findByTestId('faith-prayer-location-cancel');
    const cancel = controlStyle('faith-prayer-location-cancel');
    // `subtle` drops the border entirely; a tertiary action is quiet, not a second box.
    expect(cancel.borderWidth ?? 0).toBe(0);
  });

  /**
   * The whole screen, not only the three controls — a blue anywhere on it is the same defect.
   */
  it('renders no royal blue anywhere on the screen', async () => {
    await renderScreen();
    await openForm();

    const colours = coloursIn(screen.getByTestId('faith-prayer-location'));
    expect(colours).not.toContain(semanticColors.primary.toUpperCase());
    // The other modules' primaries would be just as wrong here.
    for (const foreign of ['#3949AB', '#6556C8', '#5A72C9', '#7657D6']) {
      expect(colours).not.toContain(foreign);
    }
  });

  it('stacks all three controls at full width', async () => {
    await renderScreen();
    await openForm();

    for (const testID of [
      'faith-prayer-location-preview-action',
      'faith-prayer-location-save',
      'faith-prayer-location-cancel',
    ]) {
      await screen.findByTestId(testID);
      expect(controlStyle(testID).alignSelf).toBe('stretch');
    }
  });

  it('meets the minimum touch height on every control', async () => {
    await renderScreen();
    await openForm();

    for (const testID of [
      'faith-prayer-location-preview-action',
      'faith-prayer-location-save',
      'faith-prayer-location-cancel',
    ]) {
      await screen.findByTestId(testID);
      const style = controlStyle(testID);
      const height = (style.height ?? style.minHeight) as number | undefined;
      expect(height).toBeGreaterThanOrEqual(48);
    }
  });
});

describe('Save is gated on a current preview', () => {
  it('is disabled before anything has been previewed', async () => {
    await renderScreen();
    await openForm();

    const save = await screen.findByTestId('faith-prayer-location-save');
    expect(save.props.accessibilityState?.disabled).toBe(true);
    expect(String(save.props.accessibilityHint)).toMatch(/Preview the location first/i);
  });

  it('is enabled once a preview resolves', async () => {
    await renderScreen();
    await openForm();
    await fireEvent.changeText(
      await screen.findByTestId('faith-prayer-location-latitude-input'),
      '25.2048',
    );
    await settle();
    await fireEvent.changeText(
      await screen.findByTestId('faith-prayer-location-longitude-input'),
      '55.2708',
    );
    await settle();
    await fireEvent.press(await screen.findByTestId('faith-prayer-location-preview-action'));
    await settle();

    expect(
      (await screen.findByTestId('faith-prayer-location-save')).props.accessibilityState?.disabled,
    ).toBe(false);
  });

  /**
   * The rule that stops somebody confirming one timezone and saving another coordinate.
   */
  it('invalidates the preview when a coordinate is edited, and disables Save again', async () => {
    await renderScreen();
    await openForm();
    await fireEvent.changeText(
      await screen.findByTestId('faith-prayer-location-latitude-input'),
      '25.2048',
    );
    await settle();
    await fireEvent.changeText(
      await screen.findByTestId('faith-prayer-location-longitude-input'),
      '55.2708',
    );
    await settle();
    await fireEvent.press(await screen.findByTestId('faith-prayer-location-preview-action'));
    await settle();
    expect(screen.queryByTestId('faith-prayer-location-preview')).toBeTruthy();

    // One digit changes, and the resolved timezone on screen is no longer about these numbers.
    await fireEvent.changeText(
      await screen.findByTestId('faith-prayer-location-latitude-input'),
      '25.3',
    );
    await settle();

    expect(screen.queryByTestId('faith-prayer-location-preview')).toBeNull();
    expect(
      (await screen.findByTestId('faith-prayer-location-save')).props.accessibilityState?.disabled,
    ).toBe(true);
  });

  it('leaves the saved location untouched when Cancel is pressed', async () => {
    await renderScreen();
    await openForm();
    await fireEvent.changeText(
      await screen.findByTestId('faith-prayer-location-latitude-input'),
      '25.2048',
    );
    await settle();
    await fireEvent.press(await screen.findByTestId('faith-prayer-location-cancel'));
    await settle();

    expect((await readStoredLocation())?.coordinate).toEqual(TEST_LOCATION_COORDINATE);
  });
});

/**
 * Every state `ModuleButton` can be in, rendered directly rather than through a screen.
 *
 * ── Why this is separate from the Prayer Location assertions above ───────────
 * Prayer Location is the component's only consumer today, and it uses three of the four variants and
 * two of the states. Asserting the palette only through it would leave `destructive`, `loading` and
 * the contrast of the disabled treatment covered by nothing — so the next screen to adopt the
 * wrapper would be the one that discovered them. These render the component itself, so the
 * guarantees hold for a consumer that does not exist yet.
 */
describe('ModuleButton binds every state to the module’s palette', () => {
  const BUTTON = 'module-button-under-test';

  const renderButton = async (props: Partial<ModuleButtonProps> = {}) => {
    await render(
      <ModuleProvider moduleId="faith">
        <ModuleButton label="Save location" onPress={() => {}} testID={BUTTON} {...props} />
      </ModuleProvider>,
    );
    return controlStyle(BUTTON);
  };

  it('fills primary with Faith’s accessible emerald and labels it in onFill', async () => {
    const style = await renderButton({ variant: 'primary' });
    expect(style.backgroundColor).toBe(FAITH.fill);
    expect(screen.getByTestId(BUTTON).props.accessibilityState?.disabled).toBe(false);
  });

  it('outlines secondary in the module ink and paints no fill of the module’s hue', async () => {
    const style = await renderButton({ variant: 'secondary' });
    expect(style.borderColor).toBe(FAITH.ink);
    expect(style.borderWidth).toBe(1);
    // An outlined control sits on the neutral surface; a tinted one would compete with primary.
    expect(style.backgroundColor).not.toBe(FAITH.fill);
  });

  it('drops the outline for tertiary so it cannot read as a second boxed control', async () => {
    const style = await renderButton({ variant: 'tertiary' });
    expect(style.borderWidth ?? 0).toBe(0);
  });

  /**
   * Destructive leaves the module's hue deliberately.
   *
   * "Delete" must not be expressible in the same colour as "save", so it takes the shared error
   * token. The label stays `onFill` — asserted for contrast below, because a red fill and a
   * theme-supplied label colour are two independently changeable values.
   */
  it('fills destructive with the shared error token, never the module’s hue', async () => {
    const style = await renderButton({ variant: 'destructive' });
    expect(style.backgroundColor).toBe(moduleNeutrals.error);
    expect(style.backgroundColor).not.toBe(FAITH.fill);
  });

  it('renders disabled in the neutral disabled fill for primary and destructive alike', async () => {
    for (const variant of ['primary', 'destructive'] as const) {
      await renderButton({ variant, disabled: true });
      const style = controlStyle(BUTTON);
      expect(style.backgroundColor).toBe(neutralColors.disabled);
      expect(style.backgroundColor).not.toBe(FAITH.fill);
      expect(screen.getByTestId(BUTTON).props.accessibilityState?.disabled).toBe(true);
    }
  });

  it('greys the disabled secondary outline rather than leaving it emerald', async () => {
    const style = await renderButton({ variant: 'secondary', disabled: true });
    expect(style.borderColor).toBe(neutralColors.disabled);
    expect(style.borderColor).not.toBe(FAITH.ink);
  });

  /**
   * Loading is a disabled, *announced* state — not a colour change alone.
   *
   * A busy button that still accepted a press would submit twice, and one that changed only its fill
   * would signal the change by colour alone. Both are asserted here rather than trusted.
   */
  it('disables and announces busy while loading', async () => {
    await renderButton({ variant: 'primary', loading: true });
    const node = screen.getByTestId(BUTTON);
    expect(node.props.accessibilityState?.busy).toBe(true);
    expect(node.props.accessibilityState?.disabled).toBe(true);
    expect(controlStyle(BUTTON).backgroundColor).toBe(neutralColors.disabled);
  });

  it('carries the button role, the label and any hint into the accessibility tree', async () => {
    await renderButton({ accessibilityHint: 'Saves these coordinates.' });
    const node = screen.getByTestId(BUTTON);
    expect(node.props.accessibilityRole).toBe('button');
    expect(node.props.accessibilityLabel).toBe('Save location');
    expect(node.props.accessibilityHint).toBe('Saves these coordinates.');
  });

  /**
   * Readable contrast, measured rather than asserted by eye.
   *
   * Each pair is the one a user actually sees: the label colour against the fill it sits on. The
   * destructive row is the one that could drift silently — its fill comes from the shared error
   * token and its label from the module theme, so nothing but this keeps the two compatible.
   */
  it('clears AA for every label-on-fill pair the component can produce', () => {
    expect(contrastRatio(FAITH.onFill, FAITH.fill)).toBeGreaterThanOrEqual(AA_TEXT);
    expect(contrastRatio(FAITH.onFill, moduleNeutrals.error)).toBeGreaterThanOrEqual(AA_TEXT);
    // Secondary and tertiary draw their label in `ink` on the neutral surface beneath them.
    expect(contrastRatio(FAITH.ink, neutralColors.surface)).toBeGreaterThanOrEqual(AA_TEXT);
  });

  /**
   * Font scaling, and the headroom that stops the label clipping.
   *
   * ── Why this is arithmetic and not a rendered measurement ────────────────────
   * Jest lays nothing out, so the height a scaled label needs cannot be observed here. What *can* be
   * pinned is the relationship the layout depends on: the button's box is a fixed `buttonHeight`,
   * the label is `bodyMedium` and deliberately unclamped so a user who needs large text gets it, and
   * the box therefore has to be tall enough for that line at the largest scale the platform offers.
   *
   * Android's accessibility maximum is 2.0x. At 2.0x the 21 dp line needs 42 dp inside a 48 dp box,
   * which fits — and this fails the moment either token moves against the other.
   */
  it('leaves the unclamped label room to grow to the platform maximum without clipping', async () => {
    const style = await renderButton();
    expect(style.height).toBe(elementSize.buttonHeight);
    expect(style.minHeight).toBe(touchTarget.minimum);

    expect(variantFontScaleClamp.bodyMedium).toBeUndefined();
    const scaledLine = textScale.bodyMedium.lineHeight * MAX_PLATFORM_FONT_SCALE;
    expect(scaledLine).toBeLessThanOrEqual(elementSize.buttonHeight);
  });

  it('stretches to the container by default, because a module action area is a stack', async () => {
    expect((await renderButton()).alignSelf).toBe('stretch');
    expect((await renderButton({ fullWidth: false })).alignSelf).toBe('flex-start');
  });
});

/**
 * The largest text scale Android's accessibility settings offer.
 *
 * Named rather than inlined because it is a platform fact the geometry above depends on, not a
 * number chosen for the test.
 */
const MAX_PLATFORM_FONT_SCALE = 2;

/**
 * The scan that keeps this fixed.
 *
 * A Faith screen importing the raw design-system buttons inherits the royal-blue default again. The
 * module-bound wrapper is the only route, and this fails the moment one is not used.
 */
describe('no Faith screen reaches past the module-bound button', () => {
  const faithSources = (): readonly string[] => {
    const walk = (dir: string): string[] => {
      const out: string[] = [];
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== '__tests__') out.push(...walk(full));
        } else if (/\.tsx$/.test(entry.name)) {
          out.push(full);
        }
      }
      return out;
    };
    return walk(path.join(process.cwd(), 'src/features/faith'));
  };

  it('imports neither PrimaryButton nor SecondaryButton directly', () => {
    const offenders = faithSources()
      .filter((file) => /\b(PrimaryButton|SecondaryButton)\b/.test(fs.readFileSync(file, 'utf8')))
      .map((file) => path.relative(process.cwd(), file).split(path.sep).join('/'));

    expect(offenders).toEqual([]);
  });

  it('hard-codes no blue or purple hex anywhere in the module', () => {
    const offenders = faithSources()
      .filter((file) =>
        /#(3157C8|3949AB|6556C8|5A72C9|7657D6)/i.test(
          fs
            .readFileSync(file, 'utf8')
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/^\s*\/\/.*$/gm, ''),
        ),
      )
      .map((file) => path.relative(process.cwd(), file).split(path.sep).join('/'));

    expect(offenders).toEqual([]);
  });

  /**
   * The entry and auth flows keep the global primary, and must not be swept up by this change.
   *
   * They sit outside any module, so `semanticColors.primary` is the correct default there — the fix
   * was to stop *modules* inheriting it, not to change what it is.
   */
  it('leaves the global primary token untouched for the flows that legitimately use it', () => {
    expect(semanticColors.primary).toBe('#3157C8');

    const authButtons = fs
      .readFileSync(
        path.join(process.cwd(), 'src/design-system/components/primary-button.tsx'),
        'utf8',
      )
      .includes('color = semanticColors.primary');
    expect(authButtons).toBe(true);
  });
});
