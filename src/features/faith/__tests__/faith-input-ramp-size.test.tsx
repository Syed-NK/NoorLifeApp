import { readFileSync } from 'node:fs';
import { join, sep } from 'node:path';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { cleanup, render, screen } from '@testing-library/react-native';
import React from 'react';
import { StyleSheet, type TextStyle } from 'react-native';

import { warmUpFirstMount } from '@/test-support/mock-latency-timers';
import { TEST_FAITH_USER_ID } from '@/test-support/faith-storage-address';

import { createMockFaithRepositories } from '../data/mock';
import { FaithRepositoryProvider } from '../di/faith-repository-context';
import { moduleType } from '@features/modules/module-tokens';
import { DhikrSelectorScreen } from '../screens/dhikr-selector-screen';
import { QuranSelectionScreen } from '../screens/quran-selection-screen';
import { setActiveFaithScope } from '../storage/faith-user-scope';

/**
 * **Six Faith fields that sized themselves** — issue #142.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * A module screen's text is sized from `moduleType` and scaled by `useModuleMetrics().dp`, which
 * downscales on narrow screens. A `TextInput` inherits neither: it is not a `ModuleText`, so a field
 * that sets no `fontSize` falls back to React Native's platform default and then sits on its own
 * curve — it grows relative to every label around it as the OS text size rises, and it never narrows
 * when the screen does.
 *
 * `dua-search-controls.tsx` already carries the finding from when this was fixed there: at a 1.5 text
 * scale the unsized field was "visibly larger than every label around it, which is why the
 * placeholder clipped while the card titles beside it fitted comfortably". Six fields on these two
 * screens had the same omission and were missed at the time — the three on the dhikr selector and the
 * three on the Qur'an selection screen.
 *
 * ── What is asserted, and why it is the ramp value rather than a number ────
 * Two properties, because neither alone is enough. Every field must resolve a size no larger than the
 * unscaled `body` token — which a field left at the platform default of 14 cannot satisfy — and all of
 * them must resolve the *same* size, which a field sized by hand to some other step would break. An
 * absolute number is deliberately not asserted: `useModuleMetrics` scales by viewport width, so a
 * hard-coded 12.5 would pin the test to one viewport rather than to the ramp.
 *
 * The size is deliberately **not** asserted to be a particular step for its own sake. #140 fixed the
 * *family* half of "a TextInput inherits nothing" and left every size alone; this is the remainder,
 * and it introduces no new step. The documented per-surface ramps stay as they are.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/** Resolves an element's style the way React Native does — the prop is a tree, not a flat array. */
function fontSizeOf(testID: string): number | undefined {
  const style = StyleSheet.flatten(screen.getByTestId(testID).props.style as never) as TextStyle;
  return style?.fontSize;
}

/**
 * What `type('body')` resolves to here.
 *
 * `useModuleMetrics` scales by viewport width, so no absolute number can be written down here. The
 * unscaled token is used as a *ceiling* — the width scale never upscales, so a field that had fallen
 * back to the platform default of 14 would exceed the 12.5 body token and fail — and equality between
 * fields is used to pin them to one another. Together those catch both halves of the defect: a field
 * sized by the platform, and a field sized by hand to something the ramp does not say.
 */
const BODY_UNSCALED = moduleType.body[0];

async function renderDhikr(): Promise<void> {
  await render(
    <FaithRepositoryProvider repositories={createMockFaithRepositories()}>
      <DhikrSelectorScreen />
    </FaithRepositoryProvider>,
  );
}

async function renderQuranSelection(): Promise<void> {
  await render(
    <FaithRepositoryProvider
      repositories={{ ...createMockFaithRepositories(), retainedQuran: { read: async () => null } }}
    >
      <QuranSelectionScreen />
    </FaithRepositoryProvider>,
  );
}

warmUpFirstMount(() => renderDhikr());

beforeEach(async () => {
  await AsyncStorage.clear();
  setActiveFaithScope(TEST_FAITH_USER_ID);
});

afterEach(async () => {
  await cleanup();
});

describe('every Faith field takes its size from the module ramp', () => {
  it('sizes the dhikr search field', async () => {
    await renderDhikr();

    const size = fontSizeOf('faith-dhikr-search');
    expect(size).toBeDefined();
    // At or below the unscaled token: the width scale never upscales, so a field that had fallen
    // back to the platform default (14) would exceed the 12.5 body token and fail here.
    expect(size).toBeLessThanOrEqual(BODY_UNSCALED);
    expect(size).toBeGreaterThan(0);
  });

  it('sizes the new-counter field to exactly the same value as the search field', async () => {
    await renderDhikr();

    // Equality is the real assertion: two fields on one screen that disagree are the defect, whatever
    // the absolute number turns out to be at this viewport.
    expect(fontSizeOf('faith-dhikr-new-input')).toBe(fontSizeOf('faith-dhikr-search'));
  });

  it("sizes the Qur'an selection search field", async () => {
    await renderQuranSelection();

    const size = fontSizeOf('faith-quran-selection-search');
    expect(size).toBeDefined();
    expect(size).toBeLessThanOrEqual(BODY_UNSCALED);
    expect(size).toBeGreaterThan(0);
  });

  it('gives both screens the same body size, so one ramp governs them', async () => {
    await renderDhikr();
    const dhikr = fontSizeOf('faith-dhikr-search');
    await cleanup();

    await renderQuranSelection();
    expect(fontSizeOf('faith-quran-selection-search')).toBe(dhikr);
  });
});

/**
 * All six fields, not just the three a render test can reach.
 *
 * The assertions above resolve a real rendered `fontSize`, which is the only way to prove the value
 * actually reaches the element — but they can only reach the three fields that are on screen at
 * first render. The rename field needs a personal counter and a rename mode, and the note field and
 * the ayah stepper live inside the range picker, so covering those by rendering would mean driving
 * three multi-step flows for one number each.
 *
 * This reads the source instead, and it is stronger than the app-wide scan in the primitive's suite
 * on exactly the axis that matters here. That scan asks whether a field states *a* size, so it
 * catches an omission and cannot see a size that is merely wrong — `fontSize: 20` satisfies it. On
 * these two screens the contract is narrower than "some size": every field takes the module ramp's
 * body token, so that is what is asserted, and a hand-picked number fails whether or not it happens
 * to look right.
 */
describe('every field on both screens takes the ramp token', () => {
  const SCREENS = [
    join(process.cwd(), 'src', 'features', 'faith', 'screens', 'dhikr-selector-screen.tsx'),
    join(process.cwd(), 'src', 'features', 'faith', 'screens', 'quran-selection-screen.tsx'),
  ];

  const RAMP_TOKEN = "type('body').fontSize";

  /**
   * Each `<AppTextInput …>` element's own text.
   *
   * The name must *end* at the match, or `<AppTextInputHandle>` — the ref type — is parsed as an
   * element. Braces are tracked so a `>` inside an arrow function or a template literal does not
   * close the element early.
   */
  function inputElements(source: string): readonly string[] {
    const out: string[] = [];
    let from = 0;
    for (;;) {
      const start = source.indexOf('<AppTextInput', from);
      if (start === -1) break;
      const nameEnd = start + '<AppTextInput'.length;
      if (/[A-Za-z0-9_]/.test(source.charAt(nameEnd))) {
        from = nameEnd;
        continue;
      }
      let depth = 0;
      let end = start;
      for (; end < source.length; end++) {
        const c = source.charAt(end);
        if (c === '{') depth++;
        else if (c === '}') depth--;
        else if (c === '>' && depth === 0) break;
      }
      out.push(source.slice(start, end + 1));
      from = end + 1;
    }
    return out;
  }

  const fields = SCREENS.flatMap((file) => {
    const source = readFileSync(file, 'utf8');
    return inputElements(source).map((element) => {
      const marker = element.indexOf('testID');
      return {
        screen: file.split(sep).pop() ?? file,
        id: marker === -1 ? '(no testID)' : element.slice(marker, marker + 46).split('\n')[0],
        element,
      };
    });
  });

  it('finds every field these screens render', () => {
    // Six were found sizeless when #142 was scoped. Fewer than that means the parser stopped seeing
    // them and every assertion below would pass on nothing.
    expect(fields.length).toBeGreaterThanOrEqual(6);
  });

  it.each(fields.map((f) => [f.screen, f.id, f.element] as const))(
    '%s %s takes the body token',
    (_screen, _id, element) => {
      expect(element).toContain(RAMP_TOKEN);
    },
  );
});
