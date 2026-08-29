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
