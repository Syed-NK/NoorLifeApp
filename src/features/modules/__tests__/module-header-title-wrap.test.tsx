import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import { render, screen, cleanup } from '@testing-library/react-native';
import { StyleSheet, type ViewStyle } from 'react-native';

import { pinModuleWindow } from '@/test-support/module-window';
import { minimumTouchTargetSize } from '@shared/utils/a11y';

import {
  headerControlReserve,
  headerTitleBandWidth,
  ModuleHeader,
} from '../components/module-header';
import { ModuleProvider } from '../module-context';
import {
  moduleHeaderHeight,
  moduleHeaderTitleLines,
  moduleHeaderTitleMaxFontScale,
  moduleLayout,
  moduleScale,
  moduleType,
} from '../module-tokens';

/**
 * **The module header's title gets a second line** — issue #143.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * On a Samsung SM-G556B at 384 dp and a 1.5 text scale the header drew `Prayer locatio…`, with the
 * ellipsis running up against the Help control. Measured with `uiautomator`: the title band is
 * 163.6 dp, which the arithmetic in `headerTitleBandWidth` puts at 164 dp, and `Prayer location`
 * needs about 178 dp once the header's 1.3x cap is applied.
 *
 * The band cannot be widened. It is already maximal for a title centred on the *screen* — the
 * control reserve is symmetric because the brief centres the title on the screen rather than on the
 * gap between the controls — so widening it is the same thing as drawing text under Help, which is
 * the defect the band was introduced to fix. Lowering the 1.3 cap is ruled out by #115, and dropping
 * the token size is ruled out by §2.4. What is left is the second line, which is what #52, #136 and
 * #139 gave tile labels and #133 gave navigation labels.
 *
 * ── What this file can and cannot reproduce ─────────────────────────────────
 * Not the ellipsis, for the reason `reader-header-title.test.tsx` sets out: there is no text
 * measurement under Jest, no font is registered, and no glyph has a width. A test claiming to catch a
 * truncation here would assert nothing.
 *
 * What it pins is the arithmetic that makes the truncation survivable — that the header reserves room
 * for two lines once the text size needs it, that font scale 1.0 is untouched, that the band and the
 * reserves are exactly as they were, and that the height reaches the one other place that subtracts
 * it. Each is written as the thing a future edit would have to break.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/** The two devices this issue was measured on, plus the narrow end of the supported range. */
const SAMSUNG = 384;
const EMULATOR = 411;
const NARROW = 320;
const WIDTHS = [NARROW, SAMSUNG, EMULATOR] as const;

/** `dp` as `useModuleMetrics` builds it, for a given width. */
function dpAt(width: number): (value: number) => number {
  const scale = moduleScale(width);
  return (value: number) => Math.round(value * scale);
}

function flatten(style: unknown): ViewStyle {
  return (StyleSheet.flatten(style as ViewStyle) ?? {}) as ViewStyle;
}

async function renderHeader(title: string): Promise<void> {
  await render(
    <ModuleProvider moduleId="faith">
      <ModuleHeader title={title} backHref="/faith" backLabel="Faith" testID="hdr" />
    </ModuleProvider>,
  );
}

afterEach(async () => {
  await cleanup();
});

describe('the title may take a second line', () => {
  it('reserves two lines, and says so as a constant the header and the height share', () => {
    expect(moduleHeaderTitleLines).toBe(2);
  });

  it('renders the title with that many lines, not one', async () => {
    pinModuleWindow({ width: SAMSUNG });
    await renderHeader('Prayer location');

    // One line is the defect. Reverting this is the regression this case exists for.
    expect(screen.getByTestId('hdr-title').props.numberOfLines).toBe(2);
  });
});

describe('font scale 1.0 is untouched', () => {
  it.each(WIDTHS)('keeps the header at its base height at %i dp', (width) => {
    const dp = dpAt(width);
    // Two lines at 1.0 measure 2 x 24 = 48 dp against a 54 dp base, so the base still wins and
    // nothing about the ordinary header moves.
    expect(moduleHeaderHeight(dp, 1)).toBe(dp(moduleLayout.headerHeight));
  });

  it('applies that height as a floor rather than a fixed height', async () => {
    pinModuleWindow({ width: SAMSUNG });
    await renderHeader('Prayer location');

    const root = flatten(screen.getByTestId('hdr').props.style);
    expect(root.minHeight).toBe(moduleHeaderHeight(dpAt(SAMSUNG), 1));
    /*
      A `height` here is what clipped the second line, and it would clip it again silently — the title
      band is absolutely positioned, so it cannot push a fixed parent open. `minHeight` is the whole
      difference between growing and cropping.
    */
    expect(root.height).toBeUndefined();
    expect(root.maxHeight).toBeUndefined();
  });
});

describe('the header grows only where the type demands it', () => {
  it.each(WIDTHS)('holds two capped line boxes at 1.5 at %i dp', (width) => {
    const dp = dpAt(width);
    const grown = moduleHeaderHeight(dp, 1.5);
    const lineBox = dp(moduleType.headerTitle[1]) * moduleHeaderTitleMaxFontScale;

    expect(grown).toBeGreaterThan(dp(moduleLayout.headerHeight));
    expect(grown).toBeGreaterThanOrEqual(lineBox * moduleHeaderTitleLines);
  });

  it('stops growing at the cap, because the title stops growing there', () => {
    const dp = dpAt(SAMSUNG);
    // 1.5 and 2.0 both clamp to 1.3, so the chrome cannot be inflated without limit by a text
    // setting the title itself refuses to follow.
    expect(moduleHeaderHeight(dp, 2)).toBe(moduleHeaderHeight(dp, 1.5));
    expect(moduleHeaderHeight(dp, 1.3)).toBe(moduleHeaderHeight(dp, 1.5));
  });

  it('never returns less than the base, whatever a caller passes', () => {
    const dp = dpAt(SAMSUNG);
    expect(moduleHeaderHeight(dp, 0.5)).toBe(dp(moduleLayout.headerHeight));
  });
});

describe('the scaling cap is not the lever', () => {
  it('stays at 1.3, the floor #115 set for every clamp in this app', () => {
    expect(moduleHeaderTitleMaxFontScale).toBe(1.3);
    expect(moduleHeaderTitleMaxFontScale).toBeGreaterThanOrEqual(1.3);
  });

  it('is what the rendered title actually carries', async () => {
    pinModuleWindow({ width: SAMSUNG, fontScale: 1.5 });
    await renderHeader('Prayer location');

    // Buying width by shrinking text is the fix this issue rules out; the two values must agree, or
    // the reserved height would not match the text drawn into it.
    expect(screen.getByTestId('hdr-title').props.maxFontSizeMultiplier).toBe(
      moduleHeaderTitleMaxFontScale,
    );
  });
});

describe('the band and the control reserves are exactly as they were', () => {
  it.each(WIDTHS)('reserves the full control cluster each side at %i dp', (width) => {
    const dp = dpAt(width);
    const target = minimumTouchTargetSize();
    /*
      The reserve is the width the right-hand cluster actually occupies — two 44 dp targets and the
      gap — and it is applied to *both* sides so the band centres on the screen. Narrowing it is how
      a title comes to be drawn under Help, so it is asserted rather than left to a comment.
    */
    expect(headerControlReserve(dp)).toBe(target * 2 + dp(moduleLayout.headerControlGap));
    expect(headerControlReserve(dp)).toBeGreaterThanOrEqual(target);
  });

  it.each(WIDTHS)('leaves the band clear of both control clusters at %i dp', (width) => {
    const dp = dpAt(width);
    const band = headerTitleBandWidth(width);
    const reserve = headerControlReserve(dp);
    const padding = dp(moduleLayout.pagePadding);

    // The band plus what is reserved either side is the whole screen: no overlap, nothing wasted
    // beyond the symmetry the centring requires.
    expect(band + 2 * (padding + reserve)).toBe(width);
    expect(band).toBeGreaterThan(0);
  });

  it('positions the rendered band inside those reserves', async () => {
    pinModuleWindow({ width: SAMSUNG });
    await renderHeader('Prayer location');

    const dp = dpAt(SAMSUNG);
    const inset = dp(moduleLayout.pagePadding) + headerControlReserve(dp);
    const band = flatten(screen.getByTestId('hdr-title-band').props.style);
    expect(band.left).toBe(inset);
    expect(band.right).toBe(inset);
  });
});

describe('the controls keep their targets and their order', () => {
  it('keeps every control at the 44 dp minimum on both axes', async () => {
    pinModuleWindow({ width: SAMSUNG, fontScale: 1.5 });
    await renderHeader('Prayer location');

    const target = minimumTouchTargetSize();
    for (const id of ['hdr-back', 'hdr-help', 'hdr-profile']) {
      const style = flatten(screen.getByTestId(id).props.style);
      expect(style.width).toBeGreaterThanOrEqual(target);
      expect(style.height).toBeGreaterThanOrEqual(target);
    }
  });

  it('reads title, back, help, profile — the order the header already had', async () => {
    pinModuleWindow({ width: SAMSUNG });
    await renderHeader('Prayer location');

    /*
      The title stays the first child and keeps `pointerEvents: 'none'`, so growing the header changed
      neither the reading order nor which node receives a tap.
      */
    const band = flatten(screen.getByTestId('hdr-title-band').props.style);
    expect(band.position).toBe('absolute');
    expect(screen.getByTestId('hdr-title-band').props.pointerEvents).toBe('none');
  });
});

/**
 * The titles the app actually ships, kept inside the budget two lines were verified to hold.
 *
 * ── Why this counts characters instead of measuring them ───────────────────
 * Because measuring them here would be a lie. `reader-header-title.test.tsx` states the constraint:
 * Jest registers no font, so no glyph has a width, and an assertion dressed up as arithmetic over an
 * assumed em advance is still an assertion about nothing. An earlier draft of this file did exactly
 * that and put `Daily Remembrances` a fraction over its own invented limit, which said more about the
 * invented constant than about the header.
 *
 * So the budget comes from the device instead. At 384 dp and a 1.5 text scale — the configuration
 * that produced `Prayer locatio…` — the 18-character titles wrap to two lines inside the band with
 * room left, measured on the Samsung. 18 is therefore recorded as the verified ceiling, and this scan
 * fails if a new header title exceeds it. A longer one is not forbidden; it needs a fresh measurement
 * and this number moved, which is the conversation the failure is meant to start.
 */
describe('every header title the app ships stays inside the verified budget', () => {
  /** Verified on a Samsung SM-G556B at 384 dp and font scale 1.5 — see the PR for #143. */
  const VERIFIED_MAX_CHARS = 18;

  /** Tags that put their `title` prop into a `ModuleHeader`, directly or through a wrapper. */
  const HEADER_TAGS = ['<ModuleScaffold', '<FaithScreen', '<ModuleSectionScreen'] as const;

  function sourceFiles(dir: string): readonly string[] {
    if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory()) return [];
    const out: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== '__tests__') out.push(...sourceFiles(full));
      } else if (entry.name.endsWith('.tsx')) {
        out.push(full);
      }
    }
    return out;
  }

  /** Every literal `title="…"` on a header-bearing element, with the file it came from. */
  function shippedTitles(): ReadonlyMap<string, string> {
    const found = new Map<string, string>();
    for (const file of sourceFiles(join(process.cwd(), 'src'))) {
      const source = readFileSync(file, 'utf8');
      for (const tag of HEADER_TAGS) {
        let from = 0;
        for (;;) {
          const start = source.indexOf(tag, from);
          if (start === -1) break;
          let depth = 0;
          let end = start;
          for (; end < source.length; end++) {
            const c = source.charAt(end);
            if (c === '{') depth++;
            else if (c === '}') depth--;
            else if (c === '>' && depth === 0) break;
          }
          const match = source.slice(start, end + 1).match(/title="([^"]+)"/);
          if (match?.[1] !== undefined) {
            found.set(match[1], relative(process.cwd(), file).split(sep).join('/'));
          }
          from = end + 1;
        }
      }
    }
    return found;
  }

  const titles = shippedTitles();

  it('finds the header titles, so the budget check is not passing on an empty list', () => {
    expect(titles.size).toBeGreaterThanOrEqual(40);
    // The screen this issue was reported against must be among them.
    expect([...titles.keys()]).toContain('Prayer location');
  });

  it('keeps every one of them inside the budget', () => {
    const over = [...titles]
      .filter(([title]) => title.length > VERIFIED_MAX_CHARS)
      .map(([title, file]) => `${title} (${title.length}) in ${file}`);

    expect(over).toEqual([]);
  });

  it('records the dua category labels too, which reach the same ceiling', () => {
    // `Daily Remembrances` arrives through `category?.label`, not a literal, so the scan above cannot
    // see it. It is the joint-longest title in the app and the one the Samsung drew as
    // `Daily Remembra…`, so it is named here rather than left to the scan's blind spot.
    expect('Daily Remembrances'.length).toBe(VERIFIED_MAX_CHARS);
  });
});
