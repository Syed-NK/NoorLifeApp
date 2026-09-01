import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { createRef } from 'react';

import { render } from '@testing-library/react-native';
import { StyleSheet, type TextStyle } from 'react-native';

import { fontFamilies } from '@ds/tokens';

import { latinFontsToLoad } from '../fonts';
import { AppTextInput, type AppTextInputHandle } from '../app-text-input';

/**
 * **Text the user types is Poppins too** — issue #140.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * Spec §2.4 makes Poppins the only Latin UI typeface, and every string the app *displays* obeyed it:
 * `AppText`, `ModuleText`, `EntryAuthText` and `HomeText` each resolve `fontFamily` from a type
 * token. `TextInput` is a different component that none of them wrap, so the family had to be
 * remembered by hand at each call site — and 26 of 31 inputs did not, leaving the value the user
 * typed in Roboto on Android and SF on iOS while the label directly above it was Poppins. On the
 * emulator, Faith › Prayer location › Choose a city drew the typed word "Amsterdam" in Roboto and
 * the matching result row 90 px below it in Poppins.
 *
 * `dua-search-controls.tsx` already carries a comment about the *size* half of this same defect
 * ("A `TextInput` does not inherit `ModuleText`'s token"). The family half was missed there.
 *
 * The fix is a primitive, so the assertions below are about the two things that make a primitive
 * worth having: that it always supplies a face, and that supplying one costs a call site nothing it
 * had before.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/** Flattens whatever RN nested the style prop into, so assertions read one object. */
function flattened(style: unknown): TextStyle {
  return (StyleSheet.flatten(style as TextStyle) ?? {}) as TextStyle;
}

async function styleOf(ui: Parameters<typeof render>[0]): Promise<TextStyle> {
  const { getByTestId } = await render(ui);
  return flattened(getByTestId('subject').props.style);
}

describe('AppTextInput always supplies a Poppins face', () => {
  it('defaults to the registered Regular face', async () => {
    expect((await styleOf(<AppTextInput testID="subject" />)).fontFamily).toBe(
      fontFamilies.regular,
    );
  });

  it.each([
    ['regular', fontFamilies.regular],
    ['medium', fontFamilies.medium],
    ['semiBold', fontFamilies.semiBold],
    ['bold', fontFamilies.bold],
  ] as const)('renders the %s token as its own registered face', async (weight, family) => {
    expect((await styleOf(<AppTextInput testID="subject" weight={weight} />)).fontFamily).toBe(
      family,
    );
  });

  /**
   * The names are the contract with expo-font, not decoration.
   *
   * A family string that nothing registers does not throw — React Native silently falls back to the
   * system face, which is the exact defect this component exists to prevent, and it would look like
   * a pass everywhere else. So each face is checked against the keys actually handed to `useFonts`.
   */
  it.each(['regular', 'medium', 'semiBold', 'bold'] as const)(
    'names a face that %s is actually registered under',
    async (weight) => {
      expect(Object.keys(latinFontsToLoad)).toContain(
        (await styleOf(<AppTextInput testID="subject" weight={weight} />)).fontFamily,
      );
    },
  );
});

describe('adopting it costs a call site nothing', () => {
  /**
   * The face sits *beneath* the caller's style, and this is the assertion that pins it there.
   *
   * Inputs carry sizes measured against their own geometry — several use 14 dp where their module
   * ramp's `body` is 12.5 dp, which is the spec's own minimum body size. If the face were merged on
   * top it would still pass every test above while quietly overriding call sites, so the ordering is
   * tested by the one property that can tell the two arrangements apart.
   */
  it('lets a caller override the face', async () => {
    const style = await styleOf(
      <AppTextInput testID="subject" style={{ fontFamily: 'Something_Else' }} />,
    );
    expect(style.fontFamily).toBe('Something_Else');
  });

  it('keeps the size, colour and geometry the call site set', async () => {
    const style = await styleOf(
      <AppTextInput
        testID="subject"
        style={{ fontSize: 14, color: '#123456', minHeight: 48, paddingHorizontal: 12 }}
      />,
    );
    expect(style).toMatchObject({
      fontFamily: fontFamilies.regular,
      fontSize: 14,
      color: '#123456',
      minHeight: 48,
      paddingHorizontal: 12,
    });
  });

  it('forwards a ref to the underlying input, so focus() still works', async () => {
    const ref = createRef<AppTextInputHandle>();
    await render(<AppTextInput testID="subject" ref={ref} />);
    expect(typeof ref.current?.focus).toBe('function');
  });

  /**
   * Scaling stays on.
   *
   * §8 requires dynamic text scaling, and an input is where a large-text user most needs it. The
   * component must not quietly opt out on everyone's behalf; a call site whose geometry cannot
   * absorb growth caps the multiplier instead.
   */
  it('does not disable font scaling', async () => {
    const { getByTestId } = await render(<AppTextInput testID="subject" />);
    expect(getByTestId('subject').props.allowFontScaling).not.toBe(false);
  });
});

/** Every production source file under src, excluding tests. */
const SRC_ROOT = join(process.cwd(), 'src');

function sourceFiles(dir: string): readonly string[] {
  if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory()) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== '__tests__') out.push(...sourceFiles(full));
    } else if (/\.tsx?$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * The primitive only holds if nothing goes around it.
 *
 * Lint restricts the `TextInput` import, which is the guard that fires while the code is being
 * written. This scan is the one that survives a relaxed lint config, and it asks the blunter
 * question: does any production file still render the raw component?
 */
describe('no production surface renders TextInput directly', () => {
  const PRIMITIVE = join('src', 'design-system', 'typography', 'app-text-input.tsx');

  /**
   * Matches the component, not the type.
   *
   * A bare `includes('<TextInput')` also matches `Omit<TextInputProps, …>`, which two entry-auth
   * files legitimately use to derive their own props. The opening tag is therefore only a match when
   * the name ends there: the next character must not be one that could continue an identifier.
   */
  function rendersRawInput(source: string): boolean {
    return source
      .split('<TextInput')
      .slice(1)
      .some((rest) => rest === '' || !/[A-Za-z0-9_]/.test(rest.charAt(0)));
  }

  const asRepoPath = (file: string): string => relative(process.cwd(), file).split(sep).join('/');

  it('finds the raw component only inside the primitive', () => {
    const offenders = sourceFiles(SRC_ROOT)
      .filter((file) => relative(process.cwd(), file) !== PRIMITIVE)
      .filter((file) => !file.includes(`${sep}test-support${sep}`))
      .filter((file) => rendersRawInput(readFileSync(file, 'utf8')))
      .map(asRepoPath);

    expect(offenders).toEqual([]);
  });

  it('covers a real number of files, so the scan cannot pass by finding nothing', () => {
    const adopters = sourceFiles(SRC_ROOT).filter((file) =>
      readFileSync(file, 'utf8').includes('<AppTextInput'),
    );
    expect(adopters.length).toBeGreaterThanOrEqual(18);
  });
});

/**
 * Every input declares a size — issue #142.
 *
 * The primitive supplies a face and deliberately no size: inputs carry sizes measured against their
 * own geometry, and choosing one for them is not the design system's business. The cost of that
 * choice is that a call site can omit the size and get React Native's platform default, which is not
 * on any ramp — it ignores the type scale and ignores the width scale, so the field grows relative to
 * its neighbours as the OS text size rises and never narrows when the screen does.
 *
 * Six Faith fields did exactly that, and the same defect had already been found and fixed once in
 * `dua-search-controls.tsx` before recurring. So the omission is checked here rather than left to be
 * noticed on a device at 1.5.
 *
 * The check is syntactic: it reads each `AppTextInput` element's own props. Every call site today
 * states its size inline — either a `fontSize` or a `type(…)` token from its surface's ramp — so if a
 * future one legitimately puts the size in a `StyleSheet` key instead, this will report it and the
 * honest fix is to move the size inline rather than to widen the scan.
 */
describe('no input is left to size itself', () => {
  /**
   * Each `<AppTextInput …>` element's own text.
   *
   * The name must *end* at the match, or `<AppTextInputHandle>` — the ref type — is read as an
   * element and reported as sizeless. Braces are tracked so a `>` inside an arrow function or a
   * template literal does not close the element early.
   */
  function inputElements(source: string): readonly string[] {
    const out: string[] = [];
    let from = 0;
    for (;;) {
      const start = source.indexOf('<AppTextInput', from);
      if (start === -1) break;
      if (/[A-Za-z0-9_]/.test(source.charAt(start + '<AppTextInput'.length))) {
        from = start + '<AppTextInput'.length;
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

  it('states a size at every call site', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(SRC_ROOT)) {
      for (const element of inputElements(readFileSync(file, 'utf8'))) {
        if (element.includes('fontSize') || element.includes('type(')) continue;
        const marker = element.indexOf('testID');
        offenders.push(
          `${relative(process.cwd(), file).split(sep).join('/')} — ${
            marker === -1 ? '(no testID)' : element.slice(marker, marker + 48).split('\n')[0]
          }`,
        );
      }
    }
    expect(offenders).toEqual([]);
  });

  it('parses a real number of elements, so the scan cannot pass by finding nothing', () => {
    const counted = sourceFiles(SRC_ROOT).reduce(
      (total, file) => total + inputElements(readFileSync(file, 'utf8')).length,
      0,
    );
    expect(counted).toBeGreaterThanOrEqual(28);
  });
});
