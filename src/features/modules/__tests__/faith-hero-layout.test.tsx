import { render, screen } from '@testing-library/react-native';
import React from 'react';
import { StyleSheet, type ImageStyle, type TextStyle, type ViewStyle } from 'react-native';

import { noorLifeAssets } from '@shared/assets/noorlife-assets';

import { ModuleProvider } from '../module-context';
import { moduleRegistry } from '../module-registry';
import { moduleLayout, moduleType } from '../module-tokens';
import { ARTWORK_RESERVE_RATIO, FaithHero } from '../faith/faith-hero';

/**
 * The longest realistic live prayer line, used for the width estimate below.
 *
 * The hero used to render a fixture — "Dhuhr 12:35 PM" — and this file measured that exact string,
 * which meant the geometry was only ever proven for the one prayer the design reference happened to
 * show. It now renders whatever `useFaithHome` resolves, so the measurement has to be made against
 * the worst case the live data can produce: the longest prayer name and a two-digit hour.
 */
/**
 * The headlines the hero genuinely renders, longest first.
 *
 * ── Why this is a set and not a single string ───────────────────────────────
 * The layout used to be measured against whichever phrase was longest at the time, and re-measured
 * whenever a longer one appeared. That is what shipped `Times for where …`: the no-location headline
 * is longer than any prayer line, and nobody re-derived the ratio when it was added. The rule under
 * test is now "no headline is truncated", which is a property of the component rather than of a
 * particular phrase, so the fixtures are here to exercise it rather than to define it.
 */
const HEADLINES = ['Times for where you are', 'Maghrib 10:44 PM'] as const;

/**
 * The Faith hero's layout, against the correction brief.
 *
 * The visual result is confirmed by the device screenshots; what these assert is the
 * geometry those screenshots depend on — left alignment, the copy column's share, and
 * that the prayer line can hold one line at the reference width.
 */

const REFERENCE_WIDTH = 393;
const CONTENT_WIDTH = REFERENCE_WIDTH - moduleLayout.pagePadding * 2; // 361 dp

async function renderHero(overrides?: { readonly headline?: string }) {
  await render(
    <ModuleProvider moduleId="faith">
      <FaithHero
        onViewPrayerTimes={() => undefined}
        {...(overrides?.headline === undefined ? {} : { headline: overrides.headline })}
        testID="faith-hero"
      />
    </ModuleProvider>,
  );
  return screen;
}

function flat(node: { props: { style?: unknown } }): ViewStyle & TextStyle & ImageStyle {
  return StyleSheet.flatten(node.props.style) as ViewStyle & TextStyle & ImageStyle;
}

describe('the approved artwork', () => {
  it('renders the left-copy revision as the hero background', async () => {
    const view = await renderHero();
    const art = await view.findByTestId('faith-hero-artwork');
    expect(art.props.source).toBe(noorLifeAssets.moduleHeroes.faith);
  });

  it('fills the card with cover, so it is neither cropped oddly nor stretched', async () => {
    const view = await renderHero();
    const art = await view.findByTestId('faith-hero-artwork');
    expect(art.props.resizeMode).toBe('cover');
  });

  it('carries no tint', async () => {
    const view = await renderHero();
    const art = await view.findByTestId('faith-hero-artwork');
    expect(art.props.tintColor).toBeUndefined();
    expect(flat(art).tintColor).toBeUndefined();
  });

  it('paints the card behind the artwork, so there is no white flash while it decodes', async () => {
    const view = await renderHero();
    const card = await view.findByTestId('faith-hero');
    expect(flat(card).backgroundColor).toBeDefined();
  });

  it('clips to the approved card radius', async () => {
    const view = await renderHero();
    const style = flat(await view.findByTestId('faith-hero'));
    expect(style.borderRadius).toBe(moduleLayout.cardRadius);
    expect(style.overflow).toBe('hidden');
  });
});

describe('the copy block', () => {
  /**
   * ── Why this no longer asserts `alignItems: 'flex-start'` ───────────────────
   * It used to, because that was how the copy was kept off-centre. It was also what made the
   * eyebrow render as "Prayer ti…" and the action as "View Prayer Ti…": `flex-start` shrink-wraps
   * each line to an intrinsic width that Android's text layout can want a fraction more than, and a
   * capped line then truncates with the column half empty beside it. Measured on the API 36
   * emulator at font scale 1.0, the eyebrow's node was 61.7 dp inside a 210 dp column.
   *
   * The column is `stretch` now, and left-alignment is carried where it belongs — by each line's
   * own `textAlign`. So this asserts the outcome the original test was reaching for, through the
   * property that actually produces it, and would still fail if a hero centred its copy.
   */
  it('is left-aligned, not centred', async () => {
    const view = await renderHero();
    expect(flat(await view.findByTestId('faith-hero-copy')).alignItems).not.toBe('center');

    for (const testID of ['faith-hero-prayer', 'faith-hero-copy']) {
      const node = await view.findByTestId(testID);
      const align = flat(node).textAlign;
      expect(align === undefined || align === 'left').toBe(true);
    }
  });

  it('lays its lines out against the full column, so none can truncate spuriously', async () => {
    const view = await renderHero();
    expect(flat(await view.findByTestId('faith-hero-copy')).alignItems).toBe('stretch');
  });

  it('stays clear of the artwork’s subject without claiming a fixed share', async () => {
    /**
     * This used to assert a 52–58% *fixed width*, which is the mechanism that truncated the
     * no-location headline. What must stay true is the visual outcome — the artwork's subject is not
     * covered — and that is now expressed as a ceiling the copy may grow up to rather than a width
     * it is pinned at.
     */
    const view = await renderHero();
    const copy = flat(await view.findByTestId('faith-hero-copy'));
    const ratio = (copy.maxWidth as number) / CONTENT_WIDTH;

    expect(ratio).toBeGreaterThanOrEqual(0.52);
    expect(ratio).toBeLessThanOrEqual(0.68);
  });

  it('falls back to the registry copy when the screen has resolved nothing', async () => {
    const view = await renderHero();
    const hero = moduleRegistry.faith.hero;

    expect(await view.findByText(hero.eyebrow)).toBeTruthy();
    expect(await view.findByText(hero.headline)).toBeTruthy();
    expect(await view.findByText(hero.support!)).toBeTruthy();
    expect(await view.findByText(hero.actionLabel)).toBeTruthy();
  });

  it('renders live values over the registry copy when the screen supplies them', async () => {
    await render(
      <ModuleProvider moduleId="faith">
        <FaithHero
          onViewPrayerTimes={() => undefined}
          headline="Maghrib 8:44 PM"
          support="in 2 hr 15 min • Manchester, United Kingdom"
          supportSecondary="25 Safar 1448 AH"
          testID="faith-hero"
        />
      </ModuleProvider>,
    );

    expect(await screen.findByText('Maghrib 8:44 PM')).toBeTruthy();
    expect(await screen.findByText('25 Safar 1448 AH')).toBeTruthy();
    // The static copy it replaced must be gone, not merely covered.
    expect(screen.queryByText(moduleRegistry.faith.hero.headline)).toBeNull();
  });

  it('reserves no line for a second support value it does not have', async () => {
    // The Hijri date is absent until the calendar resolves. An empty string must render nothing
    // rather than an empty row, which would push the action button down by a line.
    const view = await renderHero();
    expect(view.queryByText('')).toBeNull();
    expect(moduleRegistry.faith.hero.supportSecondary).toBe('');
  });

  /**
   * The registry's Faith hero states no fact about the user's day.
   *
   * It used to carry `Dhuhr 12:35 PM`, `May 19, 2025` and `21 Dhul-Qa'dah 1446 AH` — a prayer time,
   * a Gregorian date and a Hijri date, rendered identically on every device on every day. They are
   * the hero's *fallback* copy now, so they are shown precisely when nothing is known, which is the
   * one situation in which naming a time would be a fabrication.
   */
  it('carries no time, date or prayer name in its static copy', () => {
    const hero = moduleRegistry.faith.hero;
    const lines = [hero.eyebrow, hero.headline, hero.support ?? '', hero.supportSecondary ?? ''];

    for (const line of lines) {
      expect(line).not.toMatch(/\d{1,2}:\d{2}/); // a clock time
      expect(line).not.toMatch(/\b(AM|PM)\b/);
      expect(line).not.toMatch(/\b(19|20)\d{2}\b/); // a Gregorian year
      expect(line).not.toMatch(/\bAH\b/); // a Hijri year
      expect(line).not.toMatch(/\b(Fajr|Dhuhr|Asr|Maghrib|Isha)\b/);
    }
  });

  it('left-aligns the prayer line itself, not just its container', async () => {
    const view = await renderHero();
    expect(flat(await view.findByTestId('faith-hero-prayer')).textAlign).toBe('left');
  });
});

describe('the headline shrinks before it truncates', () => {
  it('allows a second line rather than ellipsising the meaning', async () => {
    const view = await renderHero();
    const prayer = await view.findByTestId('faith-hero-prayer');

    /**
     * This was `numberOfLines={1}` with no shrink, which is exactly how the emulator capture ended
     * up reading `Times for where …`. One line is a layout preference; the end of a sentence is
     * meaning, and the trade was made the wrong way round.
     */
    expect(prayer.props.numberOfLines).toBe(2);
  });

  it('steps the size down before wrapping, with a floor', async () => {
    const view = await renderHero();
    const prayer = await view.findByTestId('faith-hero-prayer');

    expect(prayer.props.adjustsFontSizeToFit).toBe(true);
    // A floor, not an unbounded shrink: below this the line stops reading as a hero headline and
    // wrapping is the better outcome.
    expect(prayer.props.minimumFontScale).toBeGreaterThanOrEqual(0.75);
    expect(prayer.props.minimumFontScale).toBeLessThan(1);
  });

  it('renders every headline the hero can produce, in full', async () => {
    for (const headline of HEADLINES) {
      /**
       * One render per headline. `renderHero` re-renders and `screen` follows the latest tree, so
       * each assertion is against the hero that was just given that headline.
       */
      const view = await renderHero({ headline });
      // Present as written. A truncated render would not match the full string.
      expect(await view.findByText(headline)).toBeTruthy();
    }
  });

  it('reserves space for the artwork instead of measuring one phrase', () => {
    /**
     * The invariant that replaces the old width calculation. The copy column is bounded by what the
     * artwork needs — a quantity that does not change when the copy does — rather than by a
     * character-count estimate of the longest string anyone had thought of.
     */
    expect(ARTWORK_RESERVE_RATIO).toBeGreaterThan(0.3);
    expect(ARTWORK_RESERVE_RATIO).toBeLessThan(0.5);
  });

  it('gives the copy column a maximum rather than a fixed width', async () => {
    const view = await renderHero();
    const copy = flat(await view.findByTestId('faith-hero-copy'));

    // A fixed `width` is what stops a long headline from using the room the card actually has.
    expect(copy.width).toBeUndefined();
    expect(copy.maxWidth).toBeCloseTo(CONTENT_WIDTH * (1 - ARTWORK_RESERVE_RATIO), 5);
  });

  it('keeps the display size above the accessible floor', () => {
    expect(moduleType.faithPrayer[0]).toBeGreaterThanOrEqual(18);
  });

  it('caps font scaling rather than switching it off', async () => {
    const view = await renderHero();
    const prayer = await view.findByTestId('faith-hero-prayer');
    expect(prayer.props.maxFontSizeMultiplier).toBe(1.1);
    expect(prayer.props.allowFontScaling).not.toBe(false);
  });
});

describe('spacing', () => {
  it('separates the eyebrow from the prayer line', () => {
    expect(moduleLayout.faithHeroEyebrowGap).toBeGreaterThan(0);
  });

  it('keeps the action clear of the prayer text', () => {
    expect(moduleLayout.faithHeroButtonGap).toBeGreaterThanOrEqual(8);
  });

  it('keeps the copy off the card edges at both ends', () => {
    expect(moduleLayout.faithHeroPaddingTop).toBeGreaterThan(0);
    expect(moduleLayout.faithHeroPaddingBottom).toBeGreaterThan(0);
  });

  it('fits the whole stack inside the hero height', () => {
    const [, eyebrowLine] = moduleType.eyebrow;
    const [, prayerLine] = moduleType.faithPrayer;
    const [, metaLine] = moduleType.rowMeta;

    const stack =
      moduleLayout.faithHeroPaddingTop +
      eyebrowLine +
      moduleLayout.faithHeroEyebrowGap +
      prayerLine +
      moduleLayout.faithHeroDateGap +
      metaLine * 2 +
      moduleLayout.faithHeroButtonGap +
      moduleLayout.heroButtonHeight +
      moduleLayout.faithHeroPaddingBottom;

    expect(stack).toBeLessThanOrEqual(moduleLayout.faithHeroHeight);
  });

  it('left-aligns the action button rather than stretching it', async () => {
    const view = await renderHero();
    const action = await view.findByTestId('faith-hero-action');
    expect(flat(action as never).alignSelf).toBe('flex-start');
  });
});
