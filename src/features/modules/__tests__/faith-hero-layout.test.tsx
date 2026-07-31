import { render, screen } from '@testing-library/react-native';
import React from 'react';
import { StyleSheet, type ImageStyle, type TextStyle, type ViewStyle } from 'react-native';

import { noorLifeAssets } from '@shared/assets/noorlife-assets';

import { ModuleProvider } from '../module-context';
import { moduleRegistry } from '../module-registry';
import { moduleLayout, moduleType } from '../module-tokens';
import { FaithHero } from '../faith/faith-hero';
import { faithHomeFixture } from '../faith/faith-view-model';

/**
 * The Faith hero's layout, against the correction brief.
 *
 * The visual result is confirmed by the device screenshots; what these assert is the
 * geometry those screenshots depend on — left alignment, the copy column's share, and
 * that the prayer line can hold one line at the reference width.
 */

const REFERENCE_WIDTH = 393;
const CONTENT_WIDTH = REFERENCE_WIDTH - moduleLayout.pagePadding * 2; // 361 dp

async function renderHero() {
  await render(
    <ModuleProvider moduleId="faith">
      <FaithHero onViewPrayerTimes={() => undefined} testID="faith-hero" />
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
  it('is left-aligned, not centred', async () => {
    const view = await renderHero();
    const copy = flat(await view.findByTestId('faith-hero-copy'));
    expect(copy.alignItems).toBe('flex-start');
  });

  it('occupies 52–58% of the card width, leaving the artwork visible on the right', async () => {
    const view = await renderHero();
    const width = flat(await view.findByTestId('faith-hero-copy')).width as number;
    const ratio = width / CONTENT_WIDTH;

    expect(ratio).toBeGreaterThanOrEqual(0.52);
    expect(ratio).toBeLessThanOrEqual(0.58);
  });

  it('renders each approved line', async () => {
    const view = await renderHero();
    // The registry is what the hero renders; the fixture must agree with it, which the
    // last case below asserts separately.
    const hero = moduleRegistry.faith.hero;

    expect(await view.findByText(hero.eyebrow)).toBeTruthy();
    expect(await view.findByText(hero.headline)).toBeTruthy();
    expect(await view.findByText(hero.support!)).toBeTruthy();
    expect(await view.findByText(hero.supportSecondary!)).toBeTruthy();
    expect(await view.findByText(hero.actionLabel)).toBeTruthy();
  });

  it('keeps the view-model fixture in step with the registry it mirrors', () => {
    const hero = moduleRegistry.faith.hero;
    const fixture = faithHomeFixture.nextPrayer;

    expect(hero.eyebrow).toBe(fixture.eyebrow);
    expect(hero.headline).toBe(`${fixture.name} ${fixture.time}`);
    expect(hero.support).toBe(fixture.gregorianDate);
    expect(hero.supportSecondary).toBe(fixture.hijriDate);
    expect(hero.actionLabel).toBe(fixture.actionLabel);
  });

  it('left-aligns the prayer line itself, not just its container', async () => {
    const view = await renderHero();
    expect(flat(await view.findByTestId('faith-hero-prayer')).textAlign).toBe('left');
  });
});

describe('the prayer line stays on one line', () => {
  it('is capped at one line', async () => {
    const view = await renderHero();
    expect((await view.findByTestId('faith-hero-prayer')).props.numberOfLines).toBe(1);
  });

  it('fits the copy column at the reference width', () => {
    const [fontSize] = moduleType.faithPrayer;
    const text = `${faithHomeFixture.nextPrayer.name} ${faithHomeFixture.nextPrayer.time}`;
    // Poppins SemiBold averages ~0.55em per character across this mix of digits,
    // letters and spaces. A conservative 0.58 keeps the estimate pessimistic.
    const estimatedWidth = text.length * fontSize * 0.58;
    const column = CONTENT_WIDTH * 0.55 - moduleLayout.heroPadding;

    expect(estimatedWidth).toBeLessThan(column);
  });

  it('keeps the display size above the accessible floor', () => {
    // Reduced from 24 to fit the narrower column — but not below what a display line
    // may be on a phone.
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
    expect(flat(action.parent as never).alignSelf).toBe('flex-start');
  });
});
