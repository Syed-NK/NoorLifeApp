import fs from 'node:fs';
import path from 'node:path';

import { fireEvent, render, screen } from '@testing-library/react-native';
import { PixelRatio, StyleSheet } from 'react-native';

import { touchTarget } from '@ds/tokens';
import { PressableScale } from '@ds/components/pressable-scale';
import { PrimaryButton } from '@ds/components/primary-button';
import { SecondaryButton } from '@ds/components/secondary-button';
import { minimumTouchTargetSize, pixelSafeTouchTarget } from '@shared/utils/a11y';

/**
 * **One 44 dp floor, on the node that owns the press** — issue #115.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── The two mechanisms this file exists to keep out ────────────────────────
 * **The bound passed through a layout scale.** Most controls were sized
 * `dp(moduleLayout.minTouchTarget)`, and `dp` is the responsive helper:
 * `Math.round(value * Math.min(width / 393, 1))`. That is right for spacing and artwork and wrong
 * for a minimum — a bound that shrinks on a smaller phone is not a bound, and a smaller phone is
 * where a control is hardest to hit. Measured: `dp(44)` renders **40 dp** at 360 dp and **36 dp**
 * at 320 dp, and the shared `ModuleHeader` controls measured exactly 40.000 dp on a 360 dp screen.
 *
 * **A raw 44 that still rounds below 44.** Even unscaled, `minHeight: 44` is a request. React Native
 * lays out in dp and paints in whole pixels, and Yoga snaps every edge to the pixel grid: at density
 * 2.625, `44 × 2.625 = 115.5 px` snaps to **115 px**, which is **43.810 dp**. Measured on
 * `emulator-5554` on the header profile control.
 *
 * `minimumTouchTargetSize()` closes both: `ceil(44 × density) / density` is a value the grid holds
 * exactly, so snapping cannot move it, and it never passes through `dp()`.
 *
 * ── And the third mechanism: `hitSlop` ─────────────────────────────────────
 * `hitSlop` widens where a finger lands. It does not change the node, so a screen reader and an
 * accessibility scanner both still see the small control. `finance-savings-message-dismiss`
 * measured **15.238 × 16.000 dp** while carrying `hitSlop={minimumHitSlop(dp(18))}` — a control a
 * third of the minimum, that an audit would fail and a finger would not notice.
 *
 * It may stay as a convenience *on top of* a compliant node. It may never be the reason a control
 * is tappable.
 *
 * ── Why these guards read code and not text ────────────────────────────────
 * Every source assertion strips comments first. The migrated files explain at length why `dp()` and
 * `hitSlop` are wrong, and a naive substring scan reads those explanations as violations — which
 * would push the next author to delete the reasoning to get a green build. A comment can neither
 * size a control nor scale one.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const SRC = path.join(process.cwd(), 'src');

/** Every production TypeScript source file — tests excluded, since they may quote a defect. */
function productionSources(): string[] {
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === '__tests__' || entry.name === 'test-support') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) found.push(full);
    }
  };
  walk(SRC);
  return found;
}

/**
 * The source with its comments removed.
 *
 * Block comments go wholesale; a line comment is dropped only when it *begins* a line, so a double
 * slash inside a string is never mistaken for the start of one.
 */
function codeOf(source: string): string {
  const OPEN = String.fromCharCode(47, 42);
  const CLOSE = String.fromCharCode(42, 47);
  const LINE = String.fromCharCode(47, 47);
  let out = source;
  for (;;) {
    const start = out.indexOf(OPEN);
    if (start === -1) break;
    const end = out.indexOf(CLOSE, start + OPEN.length);
    if (end === -1) break;
    out = out.slice(0, start) + out.slice(end + CLOSE.length);
  }
  const newline = String.fromCharCode(10);
  return out
    .split(newline)
    .filter((line) => !line.trim().startsWith(LINE))
    .join(newline);
}

const production = productionSources().map((file) => ({
  file: path.relative(process.cwd(), file).split(path.sep).join('/'),
  code: codeOf(fs.readFileSync(file, 'utf8')),
}));

/** The shared interactive primitives this migration owns end to end. */
const SHARED_PRIMITIVES = [
  'src/design-system/components/action-tile.tsx',
  'src/design-system/components/global-top-bar.tsx',
  'src/design-system/components/list-row.tsx',
  'src/design-system/components/module-bottom-navigation.tsx',
  'src/design-system/components/primary-button.tsx',
  'src/design-system/components/robot-ai-button.tsx',
  'src/design-system/components/secondary-button.tsx',
  'src/design-system/components/section-header.tsx',
  'src/features/modules/components/module-header.tsx',
  'src/features/modules/components/module-status-banner.tsx',
  'src/features/modules/components/module-state-view.tsx',
  'src/features/modules/components/module-section.tsx',
  'src/features/modules/components/module-card.tsx',
  'src/features/modules/components/module-bottom-navigation.tsx',
  'src/features/finance/components/finance-choice-row.tsx',
];

const flatten = (style: unknown): Record<string, unknown> =>
  (StyleSheet.flatten(style as never) ?? {}) as Record<string, unknown>;

const offenders = (predicate: (code: string) => boolean) =>
  production.filter(({ code }) => predicate(code)).map(({ file }) => file);

// ─────────────────────────────────────────────────────────────────────────────
// The helper itself
// ─────────────────────────────────────────────────────────────────────────────

describe('the density-safe floor', () => {
  it('is derived from the one shared 44 dp token', () => {
    const helper = fs.readFileSync(path.join(SRC, 'shared/utils/a11y.ts'), 'utf8');
    expect(helper).toContain('touchTarget.minimum');
    expect(touchTarget.minimum).toBe(44);
  });

  it.each([1, 2, 3, 4, 5])('is exactly 44 dp at integer density %p', (density) => {
    expect(pixelSafeTouchTarget(density)).toBe(touchTarget.minimum);
  });

  it('is 116 px / 44.190 dp at density 2.625', () => {
    const size = pixelSafeTouchTarget(2.625);
    expect(size * 2.625).toBe(116);
    expect(Number(size.toFixed(3))).toBe(44.19);
  });

  it('is 132 px / 44.000 dp at density 3.0', () => {
    const size = pixelSafeTouchTarget(3);
    expect(size * 3).toBe(132);
    expect(size).toBe(44);
  });

  it.each([1.1, 1.25, 1.5, 1.75, 2.2, 2.4, 2.625, 2.75, 2.8125, 3.5])(
    'never lands below the minimum at fractional density %p',
    (density) => {
      const size = pixelSafeTouchTarget(density);
      expect(size).toBeGreaterThanOrEqual(touchTarget.minimum);
      /* A whole number of pixels, so the grid has nothing left to round. */
      expect(Math.abs(size * density - Math.round(size * density))).toBeLessThan(1e-9);
    },
  );

  it('rounds up, never to nearest and never down', () => {
    /*
      `ceil` and `round` agree at 2.625 and disagree here, so a rule checked only at 2.625 is not
      checked. `floor` would land under the minimum at every fractional density.
    */
    for (const density of [1.1, 2.2, 2.4, 2.8125]) {
      const raw = touchTarget.minimum * density;
      expect(pixelSafeTouchTarget(density) * density).toBeCloseTo(Math.ceil(raw), 9);
      expect(pixelSafeTouchTarget(density)).toBeGreaterThanOrEqual(touchTarget.minimum);
      expect(Math.floor(raw) / density).toBeLessThan(touchTarget.minimum);
    }
  });

  it('is stable across repeated calls at one density', () => {
    const spy = jest.spyOn(PixelRatio, 'get').mockReturnValue(2.625);
    try {
      const first = minimumTouchTargetSize();
      expect(minimumTouchTargetSize()).toBe(first);
      expect(minimumTouchTargetSize()).toBe(first);
    } finally {
      spy.mockRestore();
    }
  });

  it('reads the live density rather than one cached at module load', () => {
    const spy = jest.spyOn(PixelRatio, 'get').mockReturnValue(2.625);
    try {
      expect(minimumTouchTargetSize()).toBe(pixelSafeTouchTarget(2.625));
      spy.mockReturnValue(3);
      expect(minimumTouchTargetSize()).toBe(44);
    } finally {
      spy.mockRestore();
    }
  });

  it('falls back to the plain contract for an unusable density', () => {
    for (const density of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(pixelSafeTouchTarget(density)).toBe(touchTarget.minimum);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Repository guards
// ─────────────────────────────────────────────────────────────────────────────

describe('no production source can reintroduce a weakened floor', () => {
  it('never passes the minimum through the dp layout scale', () => {
    expect(
      offenders(
        (code) =>
          code.includes('dp(moduleLayout.minTouchTarget)') ||
          code.includes('dp(touchTarget.minimum)') ||
          code.includes('scaled(moduleLayout.minTouchTarget)') ||
          code.includes('scaled(touchTarget.minimum)'),
      ),
    ).toEqual([]);
  });

  it('scales no minimum token, whichever module declares it', () => {
    /*
      Four modules declare a `minTouchTarget` of their own — `moduleLayout`, `entryAuthLayout`,
      `PROFILE_LAYOUT` and `subscriptionLayout` — and the first sweep only knew about the first.
      The subscription restore button measured 43.810 dp and the billing toggle 32.000 dp behind
      the ones it missed, so this matches the *shape* rather than a list of names.
    */
    expect(offenders((code) => /(dp|scaled)([A-Za-z_]+.minTouchTarget)/.test(code))).toEqual([]);
  });

  it('assigns no module-local minimum token as a bound', () => {
    expect(
      offenders((code) => /min(Height|Width)s*:s*[A-Za-z_]+.minTouchTarget/.test(code)),
    ).toEqual([]);
  });

  it('never assigns the raw token as a minimum dimension', () => {
    /*
      The raw token is not wrong as a *number* — it is the contract. It is wrong as a **rendered
      bound**, because 44 dp is not representable on a fractional-density grid and snaps down.
    */
    expect(
      offenders((code) =>
        /min(Height|Width|Size)\s*:\s*(moduleLayout\.minTouchTarget|touchTarget\.minimum)\b/.test(
          code,
        ),
      ),
    ).toEqual([]);
  });

  it('never scales the minimum by a factor below one', () => {
    expect(
      offenders((code) =>
        /(minimumTouchTargetSize\(\)|touchTarget\.minimum|moduleLayout\.minTouchTarget)\s*\*\s*0?\.\d/.test(
          code,
        ),
      ),
    ).toEqual([]);
  });

  it('declares no module-local minimum of its own', () => {
    expect(
      offenders((code) =>
        /(const|let)\s+[A-Za-z_]*(MIN_TOUCH|MINIMUM_TOUCH|minTouchTarget|TOUCH_MINIMUM)[A-Za-z_]*\s*=/.test(
          code,
        ),
      ),
    ).toEqual([]);
  });

  it('invents no 45 or 46 in place of the contract', () => {
    expect(offenders((code) => /min(Height|Width)\s*:\s*4[5-9]\b/.test(code))).toEqual([]);
  });

  it('solves no target by disabling font scaling or shrinking type', () => {
    /*
      Scoped to the primitives this migration owns. Several screens legitimately use
      `adjustsFontSizeToFit` for their own typographic reasons and predate this issue; widening
      this to all of `src` would be #115 quietly taking on the typography backlog.
    */
    for (const file of SHARED_PRIMITIVES) {
      const code = codeOf(fs.readFileSync(path.join(process.cwd(), file), 'utf8'));
      expect(code).not.toContain('allowFontScaling={false}');
      expect(code).not.toContain('adjustsFontSizeToFit');
    }
  });
});

describe('every shared interactive primitive declares the floor', () => {
  const SHARED = SHARED_PRIMITIVES;

  it.each(SHARED)('%s sizes its controls through the shared helper', (file) => {
    const code = codeOf(fs.readFileSync(path.join(process.cwd(), file), 'utf8'));
    expect(code).toContain('minimumTouchTargetSize()');
  });

  it.each(SHARED)('%s uses no scaled or raw minimum', (file) => {
    const code = codeOf(fs.readFileSync(path.join(process.cwd(), file), 'utf8'));
    expect(code).not.toContain('dp(moduleLayout.minTouchTarget)');
    expect(code).not.toContain('dp(touchTarget.minimum)');
    expect(code).not.toMatch(
      /min(Height|Width)\s*:\s*(moduleLayout\.minTouchTarget|touchTarget\.minimum)\b/,
    );
  });
});

describe('the two components #115 measured', () => {
  it('ModuleHeader takes the floor for its controls and for the reserve beside them', () => {
    const code = codeOf(
      fs.readFileSync(path.join(SRC, 'features/modules/components/module-header.tsx'), 'utf8'),
    );
    /* The control, and the width reserved for it, must be the same number. */
    expect(code.split('minimumTouchTargetSize()').length - 1).toBeGreaterThanOrEqual(2);
    expect(code).not.toContain('scaled(moduleLayout.minTouchTarget)');
  });

  it('ModuleStatusBanner sizes its action and dismiss nodes rather than only their hitSlop', () => {
    const code = codeOf(
      fs.readFileSync(
        path.join(SRC, 'features/modules/components/module-status-banner.tsx'),
        'utf8',
      ),
    );
    /* Two controls — the action and the dismiss — each needing both axes. */
    expect(code.split('minWidth: minimumTouchTargetSize()').length - 1).toBe(2);
    expect(code.split('minHeight: minimumTouchTargetSize()').length - 1).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Rendered shared primitives
// ─────────────────────────────────────────────────────────────────────────────

describe('a rendered shared button owns its bound', () => {
  const flat = (style: unknown): Record<string, unknown> =>
    (Array.isArray(style) ? style.flat(6) : [style])
      .filter((e): e is Record<string, unknown> => typeof e === 'object' && e !== null)
      .reduce<Record<string, unknown>>((all, e) => ({ ...all, ...e }), {});

  it.each([2.625, 3])('PrimaryButton clears the floor at density %p', async (density) => {
    const spy = jest.spyOn(PixelRatio, 'get').mockReturnValue(density);
    try {
      await render(<PrimaryButton label="Continue" onPress={() => undefined} testID="pb" />);
      /*
        Read from the testID node itself. `PressableScale` used to keep the style on an outer view
        and put the testID on an absolute-fill overlay inside it; #115 collapsed the two, so the
        node that is announced is the node that is measured.
      */
      const style = flat(screen.getByTestId('pb').props?.style);
      expect(Number(style.minHeight)).toBeGreaterThanOrEqual(touchTarget.minimum);
      expect(Number(style.minHeight) * density).toBe(Math.ceil(touchTarget.minimum * density));
      /* The node that carries the bound is the node that carries the role. */
      expect(screen.getByTestId('pb').props.accessibilityRole).toBe('button');
    } finally {
      spy.mockRestore();
    }
  });

  it('PrimaryButton keeps role, label and disabled state while carrying the floor', async () => {
    await render(
      <PrimaryButton label="Save" onPress={() => undefined} disabled testID="pb-disabled" />,
    );
    const node = screen.getByTestId('pb-disabled');
    /* Raising a floor must not quietly re-enable a control or drop what it announces. */
    expect(node.props.accessibilityRole).toBe('button');
    expect(node.props.accessibilityLabel).toBe('Save');
    expect(node.props.accessibilityState).toMatchObject({ disabled: true });
    expect(Number(flat(node.props?.style).minHeight)).toBeGreaterThanOrEqual(touchTarget.minimum);
  });

  it('does not fire while disabled, however large the target grew', async () => {
    const onPress = jest.fn();
    await render(<PrimaryButton label="Save" onPress={onPress} disabled testID="pb-press" />);
    /*
      The behavioural half of the same contract. Announcing `disabled` and still firing would be a
      control that lies, and a bigger target only makes it easier to hit by accident.
    */
    fireEvent.press(screen.getByTestId('pb-press'));
    expect(onPress).not.toHaveBeenCalled();
  });

  it('SecondaryButton clears the floor and keeps its disabled state', async () => {
    const spy = jest.spyOn(PixelRatio, 'get').mockReturnValue(2.625);
    try {
      await render(
        <SecondaryButton label="Later" onPress={() => undefined} disabled testID="sb" />,
      );
      const node = screen.getByTestId('sb');
      const bound = flat(node.props?.style);
      expect(Number(bound.minHeight)).toBeGreaterThanOrEqual(touchTarget.minimum);
      expect(node.props.accessibilityState).toMatchObject({ disabled: true });
      /* Raising a floor must not turn a disabled control into an enabled one. */
      expect(node.props.accessibilityRole).toBe('button');
    } finally {
      spy.mockRestore();
    }
  });

  it('keeps the label intact rather than truncating it to fit', async () => {
    await render(
      <PrimaryButton
        label="Continue with the whole of this rather long label"
        onPress={() => undefined}
        testID="pb-long"
      />,
    );
    expect(screen.getByText('Continue with the whole of this rather long label')).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Module coverage — every surface is audited, none is assumed
// ─────────────────────────────────────────────────────────────────────────────

describe('module coverage', () => {
  /*
    A directory per production surface. The assertion is not that each has controls, but that none
    still carries a weakened bound — a module added later with `dp(minTouchTarget)` fails here.
  */
  const SURFACES = [
    'src/features/home',
    'src/features/modules',
    'src/features/faith',
    'src/features/finance',
    'src/features/planner',
    'src/features/profile',
    'src/features/subscription',
    'src/features/entry-auth',
    'src/design-system/components',
    'src/application/navigation',
  ];

  it.each(SURFACES)('%s carries no scaled or raw minimum', (dir) => {
    const inDir = production.filter(({ file }) => file.startsWith(dir + '/'));
    expect(inDir.length).toBeGreaterThan(0);
    const bad = inDir
      .filter(
        ({ code }) =>
          code.includes('dp(moduleLayout.minTouchTarget)') ||
          code.includes('dp(touchTarget.minimum)') ||
          /min(Height|Width)\s*:\s*(moduleLayout\.minTouchTarget|touchTarget\.minimum)\b/.test(
            code,
          ),
      )
      .map(({ file }) => file);
    expect(bad).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Regression: what this change must not have moved
// ─────────────────────────────────────────────────────────────────────────────

describe('neighbouring contracts are unchanged', () => {
  it('keeps #84 navigation on the shared floor, in every slot', () => {
    const nav = codeOf(
      fs.readFileSync(
        path.join(SRC, 'design-system/components/module-bottom-navigation.tsx'),
        'utf8',
      ),
    );
    /*
      Both slot consumers, counted — the ordinary tab and the raised centre control. Asserting
      only that the helper appears somewhere would let one of the two regress to a literal while
      the other kept the file looking migrated, which is exactly how #84 came back once already.
    */
    expect(nav.split('minHeight: minimumTouchTargetSize()').length - 1).toBe(2);
    /* And no slot invents a number of its own. */
    expect(nav).not.toMatch(/minHeight:s*d/);
    expect(nav).toContain('slot');
  });

  it('keeps #116 Finance ChoiceRow bounding both axes', () => {
    const code = codeOf(
      fs.readFileSync(path.join(SRC, 'features/finance/components/finance-choice-row.tsx'), 'utf8'),
    );
    expect(code).toContain('minWidth: minimumTouchTargetSize()');
    expect(code).toContain('minHeight: minimumTouchTargetSize()');
  });

  it('changes no colour value, typography token or raster mapping', () => {
    /*
      A touch-target migration has no business editing any of these. Asserted on the files this
      change is allowed to touch, so a future edit that smuggles one in fails here.
    */
    const banner = codeOf(
      fs.readFileSync(
        path.join(SRC, 'features/modules/components/module-status-banner.tsx'),
        'utf8',
      ),
    );
    expect(banner).not.toMatch(/#[0-9a-fA-F]{6}\b/);
    expect(banner).not.toContain('require(');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The primitive that owns the node — issue #115, second pass
// ─────────────────────────────────────────────────────────────────────────────

describe('PressableScale owns the box it is measured by', () => {
  const source = () =>
    codeOf(fs.readFileSync(path.join(SRC, 'design-system/components/pressable-scale.tsx'), 'utf8'));

  it('renders one element, so the announced node and the measured node are the same', () => {
    /*
      The defect: the caller style sat on a wrapper and the accessibility props sat on an
      `absoluteFill` Pressable inside it. `absoluteFill` resolves against the *padding* box, so on a
      bordered control the labelled node was smaller than the box the caller sized — a Main Home
      quick action inside a 116 px wrapper reported 113 px / 43.048 dp.
    */
    expect(source()).not.toContain('StyleSheet.absoluteFill');
    expect(source()).toContain('AnimatedPressable');
  });

  it('raises the caller minimum rather than replacing it in either direction', () => {
    expect(source()).toContain('Math.max(Number(requested.minWidth ?? 0), floor)');
    expect(source()).toContain('Math.max(Number(requested.minHeight ?? 0), floor)');
  });

  it('keeps a bordered 44 dp control at 44 dp on the accessibility node', async () => {
    const spy = jest.spyOn(PixelRatio, 'get').mockReturnValue(2.625);
    try {
      await render(
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel="Bordered"
          onPress={() => undefined}
          style={{ borderWidth: 1, minWidth: 44, minHeight: 44 }}
          testID="bordered"
        />,
      );
      const node = screen.getByTestId('bordered');
      const style = flatten(node.props.style);
      /* The node that carries the label is the node that carries the bound. */
      expect(node.props.accessibilityLabel).toBe('Bordered');
      expect(Number(style.minHeight)).toBeGreaterThanOrEqual(touchTarget.minimum);
      expect(Number(style.minWidth)).toBeGreaterThanOrEqual(touchTarget.minimum);
      expect(Number(style.minHeight) * 2.625).toBe(116);
    } finally {
      spy.mockRestore();
    }
  });

  it('lets content-driven layouts grow past the floor', async () => {
    await render(
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel="Tall"
        onPress={() => undefined}
        style={{ minHeight: 200 }}
        testID="tall"
      />,
    );
    /* A minimum larger than the floor survives: the floor is a lower bound, not a size. */
    expect(Number(flatten(screen.getByTestId('tall').props.style).minHeight)).toBe(200);
  });

  it('does not shrink its bounds while the press animation runs', async () => {
    const onPress = jest.fn();
    await render(
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel="Press"
        onPress={onPress}
        testID="pressed"
      />,
    );
    const node = screen.getByTestId('pressed');
    fireEvent(node, 'pressIn');
    /* The scale is a transform. Layout and accessibility bounds are untouched by it. */
    expect(Number(flatten(node.props.style).minHeight)).toBeGreaterThanOrEqual(touchTarget.minimum);
    fireEvent(node, 'pressOut');
    fireEvent.press(node);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  /*
    Disabled behaviour is covered end to end by `PrimaryButton`, which is a real `PressableScale`
    consumer: "does not fire while disabled, however large the target grew" above presses it and
    asserts the handler never runs. Asserting it again on a bare `PressableScale` is not possible
    through the library anyway — a disabled node is filtered out of every query, by testID and by
    label alike — and a test that cannot find its subject proves nothing about it.
  */
});

describe('the controls design locks used to hold below the floor', () => {
  /*
    Every one of these measured under 44 dp on `emulator-5554` before the approved decision that the
    accessibility minimum overrides an older visual-geometry lock. Each is drawn by a component whose
    container fixed a height that clipped it, so the assertion is on the container.
  */
  const FREED: readonly (readonly [string, string])[] = [
    ['src/features/home/components/home-header.tsx', 'minHeight: dp(LOCKED.header.height)'],
    ['src/features/home/components/home-hero.tsx', 'minHeight: Math.max('],
    ['src/features/home/components/today-timeline.tsx', 'minHeight: dp(LOCKED.today.cardHeight)'],
    [
      'src/features/home/components/today-timeline.tsx',
      'minHeight: dp(LOCKED.today.headingHeight)',
    ],
  ];

  it.each(FREED)('%s no longer fixes the height that clipped a control', (file, needle) => {
    expect(codeOf(fs.readFileSync(path.join(process.cwd(), file), 'utf8'))).toContain(needle);
  });

  /*
    Components that draw an interactive control, as opposed to a sheet or a scroll container. A
    `maxHeight` is legitimate on a sheet capped at a fraction of the window; on a control it is a
    ceiling that can sit below the floor, and the floor would lose.
  */
  const CONTROL_OWNERS = [
    ...SHARED_PRIMITIVES,
    'src/features/home/components/quick-actions-row.tsx',
    'src/features/home/components/today-timeline.tsx',
    'src/features/home/components/home-hero.tsx',
    'src/features/home/components/home-header.tsx',
    'src/features/home/components/home-bottom-navigation.tsx',
  ];

  it.each(CONTROL_OWNERS)('%s caps no control height above the floor', (file) => {
    const code = codeOf(fs.readFileSync(path.join(process.cwd(), file), 'utf8'));
    /*
      Height only. A `maxWidth` is a readable-measure cap on a text block —
      `module-state-view` holds its body to 280 dp — and caps no touch target. A
      `maxHeight` on one of these components is a ceiling the floor would lose to.
    */
    expect(code).not.toContain('maxHeight');
  });

  it('reserves the raise so the Main Home centre control is not clipped to its bar', () => {
    const code = codeOf(
      fs.readFileSync(
        path.join(SRC, 'features/home/components/home-bottom-navigation.tsx'),
        'utf8',
      ),
    );
    /* The root positions and reserves; a separate bar paints, exactly as the module nav does. */
    expect(code).toContain('paddingTop: dp(LOCKED.bottomNav.aiRaise)');
    expect(code).toContain('styles.bar');
  });

  it('leaves no Main Home container fixing a height that a control must fit inside', () => {
    for (const file of [
      'src/features/home/components/home-header.tsx',
      'src/features/home/components/home-hero.tsx',
      'src/features/home/components/today-timeline.tsx',
    ]) {
      const code = codeOf(fs.readFileSync(path.join(process.cwd(), file), 'utf8'));
      expect(code).not.toMatch(/\bheight: dp\(LOCKED\.(header|hero)\.height\)/);
      expect(code).not.toMatch(/\bheight: dp\(LOCKED\.today\.(cardHeight|headingHeight)\)/);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Every interactive element, not the first one in each file — issue #115
// ─────────────────────────────────────────────────────────────────────────────

/** One JSX opening tag for an interactive element, with where it starts. */
type InteractiveTag = {
  readonly file: string;
  readonly line: number;
  readonly element: string;
  readonly tag: string;
  readonly testID: string;
};

/**
 * Every `Pressable` / `Touchable*` opening tag in a file, in order.
 *
 * ── Why this replaced a per-file substring scan ────────────────────────────
 * The scan that ran before PR #118 answered "does this file contain a control that relies on
 * `hitSlop` alone", and the migration script that used the same shape fixed the **first** match per
 * file. `ayah-action-sheet.tsx` has two identical close controls; the first was corrected and the
 * second, `faith-reader-sheet-close`, was never visited — a 20 dp icon left as the whole
 * accessibility node behind a slop.
 *
 * So this enumerates *every* occurrence and associates each `hitSlop` with the element that carries
 * it, rather than with the file. Comments are stripped first, so a component explaining why
 * `hitSlop` is wrong is not mistaken for one using it.
 */
function interactiveTags(file: string): InteractiveTag[] {
  const source = codeOf(fs.readFileSync(path.join(process.cwd(), file), 'utf8'));
  const found: InteractiveTag[] = [];
  const opener =
    /<(Pressable|PressableScale|TouchableOpacity|TouchableHighlight|TouchableWithoutFeedback)\b/g;
  let match: RegExpExecArray | null;
  while ((match = opener.exec(source)) !== null) {
    /*
      Walk to the end of this opening tag rather than regex-matching to the next '>', because a
      style object contains '>' inside arrow functions and would end the tag early.
    */
    let depth = 0;
    let end = match.index;
    for (let i = match.index; i < source.length; i++) {
      const char = source[i];
      if (char === '{') depth += 1;
      else if (char === '}') depth -= 1;
      else if (char === '>' && depth === 0) {
        end = i;
        break;
      }
    }
    const tag = source.slice(match.index, end + 1);
    const id = tag.match(/testID=\{?["`]?([^"`}\n]+)/);
    found.push({
      file,
      line: source.slice(0, match.index).split(String.fromCharCode(10)).length,
      element: match[1] ?? 'Pressable',
      tag,
      testID: id === null ? '(no testID)' : (id[1] ?? '(no testID)'),
    });
  }
  return found;
}

/** Whether an element bounds its own node, as opposed to widening the area around it. */
function ownsItsBounds(tag: InteractiveTag): boolean {
  /*
    `PressableScale` is exempt by construction, not by convention: since #115 the primitive applies
    `Math.max(callerMinimum, minimumTouchTargetSize())` to both axes of the single element that
    carries the role, the label and the testID. A consumer cannot opt out of that, so a `hitSlop` on
    one is additional convenience rather than the reason it is reachable.
  */
  if (tag.element === 'PressableScale') return true;
  if (/minimumTouchTargetSize\(\)/.test(tag.tag)) return true;
  if (/min(Width|Height)\s*:/.test(tag.tag)) return true;
  return /\b(width|height)\s*:/.test(tag.tag);
}

const PRODUCTION_TSX = productionSources()
  .filter((file) => file.endsWith('.tsx'))
  .map((file) => path.relative(process.cwd(), file).split(path.sep).join('/'));

describe('no control anywhere relies on hitSlop for its size', () => {
  it('inspects every interactive element in every production file', () => {
    const all = PRODUCTION_TSX.flatMap(interactiveTags);
    /* A sanity floor: if the walker silently stopped finding elements, this test would pass empty. */
    expect(all.length).toBeGreaterThan(100);

    const offending = all
      .filter((tag) => /hitSlop/.test(tag.tag))
      .filter((tag) => !ownsItsBounds(tag))
      .map((tag) => `${tag.file}:${tag.line} <${tag.element}> ${tag.testID}`);

    expect(offending).toEqual([]);
  });

  it('finds both controls in the file whose second one was missed', () => {
    /*
      The regression this guard exists for. Two identical close controls, and the migration only
      corrected the first. If the walker ever goes back to one match per file, this drops to 1.
    */
    const tags = interactiveTags('src/features/faith/components/reader/ayah-action-sheet.tsx');
    const closes = tags.filter(
      (tag) => /hitSlop/.test(tag.tag) || tag.testID === 'faith-reader-sheet-close',
    );
    expect(closes.length).toBeGreaterThanOrEqual(2);
    for (const tag of closes) {
      expect(ownsItsBounds(tag)).toBe(true);
    }
  });

  it('would catch a second unsafe occurrence added beside a safe one', () => {
    /*
      Synthetic, so the guard is proven against the exact shape it missed rather than against the
      absence of one. Two elements, the first bounded and the second not.
    */
    const synthetic = [
      '<Pressable hitSlop={8} style={{ minHeight: minimumTouchTargetSize() }} testID="safe" />',
      '<Pressable hitSlop={8} testID="unsafe" />',
    ].join(String.fromCharCode(10));
    const file = path.join(process.cwd(), 'src/shared/utils/__tests__/.guard-fixture.tsx');
    fs.writeFileSync(file, synthetic);
    try {
      const tags = interactiveTags('src/shared/utils/__tests__/.guard-fixture.tsx');
      expect(tags.map((tag) => tag.testID)).toEqual(['safe', 'unsafe']);
      expect(tags.filter((tag) => !ownsItsBounds(tag)).map((tag) => tag.testID)).toEqual([
        'unsafe',
      ]);
    } finally {
      fs.unlinkSync(file);
    }
  });

  it('is not fooled by a comment that mentions hitSlop', () => {
    const file = path.join(process.cwd(), 'src/shared/utils/__tests__/.guard-comment.tsx');
    fs.writeFileSync(
      file,
      [
        '/* hitSlop is refused here because it leaves the node undersized. */',
        '<Pressable style={{ minHeight: minimumTouchTargetSize() }} testID="documented" />',
      ].join(String.fromCharCode(10)),
    );
    try {
      const tags = interactiveTags('src/shared/utils/__tests__/.guard-comment.tsx');
      expect(tags).toHaveLength(1);
      const only = tags[0];
      if (only === undefined) throw new Error('fixture tag not found');
      expect(/hitSlop/.test(only.tag)).toBe(false);
      expect(ownsItsBounds(only)).toBe(true);
    } finally {
      fs.unlinkSync(file);
    }
  });

  it('treats PressableScale as bounded by its own primitive, and a plain Pressable as not', () => {
    const scale: InteractiveTag = {
      file: 'x',
      line: 1,
      element: 'PressableScale',
      tag: '<PressableScale hitSlop={8}',
      testID: 'a',
    };
    const plain: InteractiveTag = {
      file: 'x',
      line: 1,
      element: 'Pressable',
      tag: '<Pressable hitSlop={8}',
      testID: 'b',
    };
    expect(ownsItsBounds(scale)).toBe(true);
    expect(ownsItsBounds(plain)).toBe(false);
  });
});

describe('the reader action sheet close control', () => {
  const FILE = 'src/features/faith/components/reader/ayah-action-sheet.tsx';

  const closeTag = () =>
    interactiveTags(FILE).find((tag) => tag.testID === 'faith-reader-sheet-close');

  it('bounds both axes through the shared helper, on the Pressable itself', () => {
    const tag = closeTag();
    if (tag === undefined) throw new Error('faith-reader-sheet-close not found');
    expect(tag.element).toBe('Pressable');
    expect(tag.tag).toContain('minWidth: minimumTouchTargetSize()');
    expect(tag.tag).toContain('minHeight: minimumTouchTargetSize()');
  });

  it('passes neither axis through a layout scale, and invents no constant', () => {
    const tag = closeTag();
    expect(tag?.tag).not.toMatch(/min(Width|Height):\s*dp\(/);
    expect(tag?.tag).not.toMatch(/min(Width|Height):\s*4[4-9]\b/);
  });

  it('no longer needs a hitSlop to be reachable', () => {
    expect(closeTag()?.tag).not.toContain('hitSlop');
  });

  it('keeps its role, its label and its 20 dp icon', () => {
    const source = codeOf(fs.readFileSync(path.join(process.cwd(), FILE), 'utf8'));
    const start = source.indexOf('faith-reader-sheet-close');
    const around = source.slice(start - 900, start + 300);
    expect(around).toContain('accessibilityRole="button"');
    expect(around).toContain('accessibilityLabel="Close"');
    /* The drawn glyph is unchanged; only the box around it grew. */
    expect(around).toContain('size={dp(20)}');
  });

  it.each([2.625, 3, 1, 2.8125])('clears 44 dp at density %p', (density) => {
    const spy = jest.spyOn(PixelRatio, 'get').mockReturnValue(density);
    try {
      expect(minimumTouchTargetSize()).toBeGreaterThanOrEqual(touchTarget.minimum);
      expect(Number.isInteger(Math.round(minimumTouchTargetSize() * density))).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// An absent bound is a bound too — issue #120
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Every `name: { … }` entry of a file's `StyleSheet.create`, as text.
 *
 * The guard added by #119 read only the JSX tag, so a control whose sizing lives in
 * `styles.heading` looked unsized — and a control that really was unsized looked the same. Both
 * Planner checkbox toggles hid a literal `minHeight: 44` this way: a value that paints
 * **115 px / 43.810 dp** at density 2.625 and is evaluated once at module load, which is the wrong
 * density for any display the app was not launched on.
 */
function styleEntries(source: string): Map<string, string> {
  const entries = new Map<string, string>();
  const start = source.indexOf('StyleSheet.create(');
  if (start === -1) return entries;
  const body = source.slice(start);
  const re = /(\w+)\s*:\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    let depth = 1;
    let i = m.index + m[0].length;
    for (; i < body.length && depth > 0; i += 1) {
      if (body[i] === '{') depth += 1;
      else if (body[i] === '}') depth -= 1;
    }
    entries.set(m[1] ?? '', body.slice(m.index, i));
  }
  return entries;
}

/** A tag plus the text of every `styles.NAME` it references. */
function resolvedTag(tag: InteractiveTag, source: string): string {
  const NL = String.fromCharCode(10);
  const styles = styleEntries(source);
  let out = tag.tag;
  for (const ref of tag.tag.matchAll(/styles\.(\w+)/g)) {
    const entry = styles.get(ref[1] ?? '');
    if (entry !== undefined) out += NL + entry;
  }
  return out;
}

/**
 * Whether an element states a size at all — of any kind, correct or not.
 *
 * Deliberately generous. Its job is to separate "this control says nothing about its size" from
 * "this control says something we can then judge", because the first is the shape #120 found and
 * nothing in the source marks it. A full-fill dismiss scrim counts: four insets at zero is a size,
 * and the two that remain in the app are exactly that.
 */
function statesASize(resolved: string): boolean {
  if (/min(Width|Height)\s*:/.test(resolved)) return true;
  if (/\b(width|height)\s*:/.test(resolved)) return true;
  if (/flex\s*:\s*1/.test(resolved)) return true;
  if (/aspectRatio/.test(resolved)) return true;
  if (/absoluteFill/.test(resolved)) return true;
  const insets = ['top', 'left', 'right', 'bottom'].filter((side) =>
    new RegExp('\\b' + side + '\\s*:\\s*0\\b').test(resolved),
  );
  return /position\s*:\s*'absolute'/.test(resolved) && insets.length === 4;
}

/** Whether the size it states is the density-safe floor. */
function statesTheFloor(resolved: string): boolean {
  return /minimumTouchTargetSize\(\)/.test(resolved);
}

/**
 * The controls in a file that state no size at all.
 *
 * One function, called by both the production sweep and the fixture below, so a sweep narrowed
 * back to "only elements carrying a hitSlop" fails the fixture too. With every control in the app
 * now bounded, that narrowing is otherwise invisible: the sweep would report zero and look healthy.
 */
function unsizedControls(file: string): string[] {
  const source = codeOf(fs.readFileSync(path.join(process.cwd(), file), 'utf8'));
  return interactiveTags(file)
    .filter((tag) => tag.element !== 'PressableScale')
    .filter((tag) => !statesASize(resolvedTag(tag, source)))
    .map((tag) => `${file}:${tag.line} <${tag.element}> ${tag.testID}`);
}

describe('no interactive element leaves its size unstated', () => {
  const NL = String.fromCharCode(10);
  const PRODUCTION = productionSources()
    .filter((file) => file.endsWith('.tsx'))
    .map((file) => path.relative(process.cwd(), file).split(path.sep).join('/'));

  it('states a size on every interactive element, or is a full-fill scrim', () => {
    /*
      #115 closed three shapes: the bound through `dp()`, the raw token that rounds below 44, and
      `hitSlop` standing in for the node. #120 is a fourth — a plain `Pressable` carrying *neither*
      a bound nor a `hitSlop`. The reader's aya pill measured 20.978 dp that way, and the #119
      guard could not see it because it only inspected elements that had a `hitSlop` to inspect.
    */
    expect(PRODUCTION.flatMap(unsizedControls)).toEqual([]);
  });

  it('uses the density-safe floor wherever a minimum is stated', () => {
    /* A stated minimum that is a literal is the rounding half of #115, wearing a StyleSheet. */
    const offenders: string[] = [];
    for (const file of PRODUCTION) {
      const source = codeOf(fs.readFileSync(path.join(process.cwd(), file), 'utf8'));
      for (const tag of interactiveTags(file)) {
        if (tag.element === 'PressableScale') continue;
        const resolved = resolvedTag(tag, source);
        /*
          Only a minimum that is *trying* to express the 44 dp contract. `minWidth: 0` is the flex
          idiom that lets a column shrink, and `minHeight: dp(96)` is a design dimension that
          happens to be a minimum — neither is a touch target, and reading them as one would flag
          a dozen correct layouts. What must use the helper is anything spelling the floor itself:
          `44`, `dp(44)`, or one of the four modules' `minTouchTarget` tokens.
        */
        const floorAttempts = resolved
          .split(NL)
          .filter((line) => /min(Width|Height)\s*:/.test(line))
          .filter((line) => /\b44\b|minTouchTarget|touchTarget\.minimum/.test(line));
        if (floorAttempts.length === 0) continue;
        if (floorAttempts.every((line) => /minimumTouchTargetSize\(\)/.test(line))) continue;
        offenders.push(`${file}:${tag.line} <${tag.element}> ${tag.testID}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('resolves a size hidden behind a styles reference', () => {
    /* The blind spot itself: a bound in `styles.X` used to read as no bound. */
    const file = 'src/features/planner/screens/planner-task-list.tsx';
    const source = codeOf(fs.readFileSync(path.join(process.cwd(), file), 'utf8'));
    const toggle = interactiveTags(file).find((t) => t.tag.includes('styles.heading'));
    if (toggle === undefined) throw new Error('planner toggle not found');
    expect(/styles\./.test(toggle.tag)).toBe(true);
    expect(statesASize(resolvedTag(toggle, source))).toBe(true);
  });

  it('inspects an element that carries no hitSlop at all', () => {
    /*
      The regression this describe exists for, and the one shape a clean codebase cannot prove on
      its own: with every control bounded, a sweep narrowed back to "only elements with a hitSlop"
      still reports zero and looks healthy. So the same `unsizedControls` the sweep uses is run
      against a fixture containing exactly what #120 found — a bare `Pressable`, no bound, no slop.
    */
    const file = 'src/shared/utils/__tests__/.unbounded-fixture.tsx';
    fs.writeFileSync(
      path.join(process.cwd(), file),
      [
        '<Pressable onPress={go} accessibilityRole="button" accessibilityLabel="Bare" testID="bare" />',
        '<Pressable onPress={go} hitSlop={8} style={{ minHeight: minimumTouchTargetSize() }} testID="ok" />',
      ].join(String.fromCharCode(10)),
    );
    try {
      const found = unsizedControls(file);
      expect(found).toHaveLength(1);
      expect(found[0]).toContain('bare');
    } finally {
      fs.unlinkSync(path.join(process.cwd(), file));
    }
  });

  it('counts a full-fill scrim as sized, and a bare Pressable as not', () => {
    const NL = String.fromCharCode(10);
    const scrim = [
      '<Pressable style={styles.scrim} onPress={close} />',
      "scrim: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }",
    ].join(NL);
    expect(statesASize(scrim)).toBe(true);
    expect(statesASize('<Pressable onPress={close} accessibilityLabel="x" />')).toBe(false);
  });
});

describe('the controls #120 corrected', () => {
  const reader = () =>
    codeOf(
      fs.readFileSync(path.join(SRC, 'features/faith/components/reader/ayah-block.tsx'), 'utf8'),
    );

  it('gives the aya pill the floor on both axes', () => {
    /*
      `PillTarget` takes its testID as a prop, so inside this file the tag reads `testID={testID}`
      and the call site supplies `faith-reader-ayah-number-…`. The pill is identified by the hint
      only it carries.
    */
    const tags = interactiveTags('src/features/faith/components/reader/ayah-block.tsx');
    const pill = tags.find((t) => t.tag.includes('Opens the actions for this aya'));
    if (pill === undefined) throw new Error('aya pill not found');
    expect(pill.tag).toContain('minWidth: minimumTouchTargetSize()');
    expect(pill.tag).toContain('minHeight: minimumTouchTargetSize()');
    expect(reader()).toContain('faith-reader-ayah-number-');
  });

  it('leaves the pill free to grow with a longer citation', () => {
    /* Width is a *minimum*, so a three-digit aya still sizes to its text and is not truncated. */
    expect(reader()).not.toMatch(/width:\s*minimumTouchTargetSize/);
    expect(reader()).not.toContain('numberOfLines');
  });

  it('no longer nests the pill inside a pressable ancestor', () => {
    /*
      The block used to be one `Pressable` wrapping the pill — an interactive container holding an
      interactive descendant, with near-duplicate labels. They are siblings now: the pill, then the
      verse body which carries the row press.
    */
    const source = reader();
    const blockStart = source.indexOf('paddingVertical: dp(14)');
    const pillAt = source.indexOf('faith-reader-ayah-number');
    const bodyAt = source.indexOf('faith-reader-ayah-${text.surah}-${text.ayah}');
    expect(blockStart).toBeGreaterThan(-1);
    /* The container that owns the block padding is a View, not a Pressable. */
    expect(source.slice(Math.max(0, blockStart - 200), blockStart)).toContain('<View');
    expect(pillAt).toBeGreaterThan(-1);
    expect(bodyAt).toBeGreaterThan(-1);
  });

  it('keeps the row press and the pill press on the same action', () => {
    /*
      The handler is `openActions` rather than the `onOpenActions` prop itself since #55: the prop now
      takes the verse number, and the row wraps it once in a `useCallback` so that memoising the row is
      worth anything. What this guard is for is unchanged, and is now stated exactly — the pill and the
      verse body must press the *same* function, not two that merely agree.
    */
    const source = reader();
    expect(source.split('onPress={openActions}').length - 1).toBe(2);
    expect(source).toContain('onPress={onPress}');
  });

  it('floors both Planner checkbox toggles through the helper', () => {
    for (const file of [
      'src/features/planner/components/planner-routine-list.tsx',
      'src/features/planner/screens/planner-task-list.tsx',
    ]) {
      const source = codeOf(fs.readFileSync(path.join(process.cwd(), file), 'utf8'));
      expect(source).toContain('minHeight: minimumTouchTargetSize()');
      expect(source).not.toMatch(/minHeight:\s*44\b/);
    }
  });

  it('floors the prayer-alert sheet action', () => {
    const source = codeOf(
      fs.readFileSync(path.join(SRC, 'features/faith/components/prayer-alert-sheet.tsx'), 'utf8'),
    );
    expect(source).toContain('minHeight: minimumTouchTargetSize()');
  });
});
