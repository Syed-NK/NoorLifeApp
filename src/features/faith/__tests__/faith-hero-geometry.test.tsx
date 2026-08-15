import { render, screen } from '@testing-library/react-native';
import React, { type ReactElement } from 'react';
import { StyleSheet, type ViewStyle } from 'react-native';

import { faithHeroGeometry } from '@features/modules/module-tokens';
import { ModuleHomeScreen } from '@features/modules/screens/module-home-screen';
import { installMockLatencyTimers } from '@/test-support/mock-latency-timers';

import { FaithRepositoryProvider } from '../di/faith-repository-context';
import { CalendarScreen } from '../screens/calendar-screens';
import { DuasScreen } from '../screens/duas-screen';
import { FaithAiScreen } from '../screens/faith-ai-screen';
import { HadithScreen } from '../screens/hadith-screen';
import { MosquesScreen } from '../screens/mosques-screen';
import { PrayerTimesScreen } from '../screens/prayer-times-screen';
import { QuranScreen } from '../screens/quran-screen';

/**
 * The nine Faith heroes are one rectangle, and this is what makes that checkable.
 *
 * ── Why a test and not a shared component alone ─────────────────────────────
 * `FaithSectionHero` already guarantees the eight sections match each other, because they are
 * literally the same component. What it cannot guarantee on its own is that it still matches
 * **Faith Home's** hero, which is a different component (`FaithHero` — it carries the locked
 * artwork and the next-prayer copy, so it could not simply be replaced).
 *
 * Two components required to render the same rectangle is exactly the situation the brief warns
 * about: "create or reuse one shared component/token so these measurements cannot drift". They
 * now read one token, and this asserts that what actually reaches the style sheet matches it on
 * both sides. A future tuning of either hero fails here rather than shipping as a difference
 * nobody measures.
 *
 * ── Why the assertions are on rendered style, not on the token ──────────────
 * Asserting `faithHeroGeometry.height === 144` would prove only that a constant equals itself.
 * These read the style the component actually produced, so a hero that imported the token and
 * then overrode it locally still fails.
 */

installMockLatencyTimers(() => renderIn(<ModuleHomeScreen moduleId="faith" />));

async function renderIn(element: ReactElement) {
  await render(<FaithRepositoryProvider>{element}</FaithRepositoryProvider>);
  return screen;
}

function flatStyle(node: { props: { style?: unknown } }): ViewStyle {
  return StyleSheet.flatten(node.props.style as ViewStyle) ?? {};
}

/**
 * Every Faith surface that opens with a hero, and the testID of that hero.
 *
 * Faith Home is first and is the reference the other nine are measured against — it is the screen
 * the brief names as the standard.
 */
const HEROES: readonly (readonly [string, ReactElement, string])[] = [
  ['Faith Home', <ModuleHomeScreen key="home" moduleId="faith" />, 'faith-hero'],
  ['Quran', <QuranScreen key="q" />, 'faith-hero-quran'],
  ['Hadith', <HadithScreen key="h" />, 'faith-hero-hadith'],
  ['Duas', <DuasScreen key="d" />, 'faith-hero-duas'],
  ['Prayer', <PrayerTimesScreen key="p" />, 'faith-hero-prayer'],
  /*
    Qibla is deliberately absent from this table, for the same reason as Tasbih.

    The approved Qibla A+D design has **no hero**: the dial is the dominant element and starts
    directly under the header, because a 144 dp artwork above it pushed the compass — the entire
    point of the screen — below the fold, and pushed the guidance card off it entirely. The
    nine-screen 'same rectangle' rule still binds every screen that draws a hero; Qibla no longer
    draws one, so asserting its geometry would be asserting a card that is not there.
  */
  /*
    Tasbih is deliberately absent from this table.

    The approved Tasbih B design has **no hero**: the counting circle sits directly under the header on
    an ivory ground, because a 144 dp artwork above it pushed the one element a user touches below the
    fold. The nine-screen 'same rectangle' rule still binds every screen that draws a hero; Tasbih no
    longer draws one, so asserting its geometry would be asserting a card that is not there.
  */
  ['Mosques', <MosquesScreen key="m" />, 'faith-hero-mosques'],
  ['Calendar', <CalendarScreen key="c" />, 'faith-hero-calendar'],
  ['Faith AI', <FaithAiScreen key="ai" />, 'faith-hero-ai'],
];

/**
 * The two heroes that still render native copy, and why the list is split.
 *
 * The eight section heroes now draw an approved card whose eyebrow, heading and subtitle are baked into
 * the pixels — so they have no `-copy` column, no `-artwork` pictogram, and no native text to measure.
 * Faith Home (`FaithHero`) and Faith AI still compose their copy natively and are still the reason the
 * shared padding, bounded column and stretch behaviour exist.
 *
 * The *outer* rectangle — height, radius, margin — is asserted for all ten, because that is the property
 * the brief calls authoritative and it must hold whichever way a hero fills itself.
 */
const COMPOSED_HEROES = HEROES.filter(
  ([name]) => name === 'Faith Home' || name === 'Faith AI',
) as readonly (readonly [string, ReactElement, string])[];

/**
 * The one hero whose 144 dp is a floor rather than a fixed height.
 *
 * ── Why the rectangle is no longer identical for all ten ────────────────────
 * Nine of these heroes draw copy that is baked into the artwork or fixed in the registry, so their
 * height can be exact: nothing inside them can grow. Faith Home's composes *live* copy — a prayer
 * name and time, a countdown joined to a resolved place name, a Hijri date — and at a fixed height
 * the surplus was painted outside the card and cropped, which is what the correction brief forbids.
 *
 * So the shared contract is now stated as two properties rather than one: every hero is **at least**
 * 144 dp, and the nine that can be exact still are. That is a weaker claim than "all ten are the
 * same rectangle" and it is deliberately weaker — the alternative was shortening approved copy or
 * capping the OS text size, both of which the brief rules out.
 */
const GROWABLE_HERO = 'Faith Home';

describe('the standard Faith hero rectangle', () => {
  it.each(HEROES)('%s is at least the shared outer height', async (_name, element, testID) => {
    const view = await renderIn(element);
    const style = flatStyle(await view.findByTestId(testID));
    expect(style.height ?? style.minHeight).toBe(faithHeroGeometry.height);
  });

  it.each(HEROES.filter(([name]) => name !== GROWABLE_HERO))(
    '%s pins the height exactly, because nothing inside it can grow',
    async (_name, element, testID) => {
      const view = await renderIn(element);
      expect(flatStyle(await view.findByTestId(testID)).height).toBe(faithHeroGeometry.height);
    },
  );

  it('Faith Home floors the height instead of pinning it, so live copy can grow', async () => {
    const view = await renderIn(<ModuleHomeScreen moduleId="faith" />);
    const style = flatStyle(await view.findByTestId('faith-hero'));

    expect(style.minHeight).toBe(faithHeroGeometry.height);
    // The absence matters as much as the floor: a `height` alongside it would re-pin the card and
    // reintroduce the cropping, and it is the kind of line a later tidy-up would add back.
    expect(style.height).toBeUndefined();
  });

  it.each(HEROES)('%s renders the shared corner radius', async (_name, element, testID) => {
    const view = await renderIn(element);
    expect(flatStyle(await view.findByTestId(testID)).borderRadius).toBe(faithHeroGeometry.radius);
  });

  /**
   * Zero, and asserted rather than assumed.
   *
   * The hero sits inside the scaffold's content column, which already applies the page padding.
   * A hero that added a margin of its own would sit narrower than every card beneath it — a
   * difference of a few dp that reads, on device, as the screen being subtly misaligned.
   */
  it.each(HEROES)('%s adds no horizontal margin of its own', async (_name, element, testID) => {
    const view = await renderIn(element);
    expect(flatStyle(await view.findByTestId(testID)).marginHorizontal).toBe(
      faithHeroGeometry.marginHorizontal,
    );
  });

  it.each(COMPOSED_HEROES)(
    '%s uses the shared internal padding',
    async (_name, element, testID) => {
      const view = await renderIn(element);
      const copy = flatStyle(await view.findByTestId(`${testID}-copy`));

      expect(copy.paddingTop).toBe(faithHeroGeometry.paddingTop);
      expect(copy.paddingBottom).toBe(faithHeroGeometry.paddingBottom);
      expect(copy.paddingLeft).toBe(faithHeroGeometry.paddingLeft);
    },
  );

  /**
   * The copy column is bounded, never fixed.
   *
   * `maxWidth` and no `width` is the property that keeps a long title from truncating inside an
   * artificially narrow column — the failure that turned "Times for where you are" into "Times
   * for where …" on the home hero before the reserve was inverted.
   */
  it.each(COMPOSED_HEROES)(
    '%s bounds its copy column without fixing it',
    async (_n, element, testID) => {
      const view = await renderIn(element);
      const copy = flatStyle(await view.findByTestId(`${testID}-copy`));

      expect(copy.maxWidth).toBeGreaterThan(0);
      expect(copy.width).toBeUndefined();
    },
  );
});

/**
 * The truncation guard.
 *
 * ── What this is defending against ──────────────────────────────────────────
 * On the API 36 emulator at font scale 1.0, Faith Home's hero rendered "Prayer ti…" and
 * "View Prayer Ti…" — with 148 dp of unused width beside them. The cause was not space: it was
 * `alignItems: 'flex-start'`, which shrink-wraps each line to an intrinsic width that Android's
 * own text layout can want a fraction more than. A capped line then has nowhere to go.
 *
 * Jest cannot measure glyphs, so this asserts the *property that caused it* rather than the
 * symptom. That is the honest limit of this test and worth stating: it proves the copy column
 * still lays its lines out against the full width, not that no string anywhere truncates. The
 * symptom itself was verified on device.
 */
describe('hero copy is laid out against the full column, not shrink-wrapped', () => {
  it.each(COMPOSED_HEROES)('%s stretches its copy lines', async (_name, element, testID) => {
    const view = await renderIn(element);
    expect(flatStyle(await view.findByTestId(`${testID}-copy`)).alignItems).toBe('stretch');
  });
});

describe('the hero geometry token', () => {
  it('reserves a minority of the card for artwork, so copy always has the majority', () => {
    expect(faithHeroGeometry.artworkReserveRatio).toBeGreaterThan(0);
    expect(faithHeroGeometry.artworkReserveRatio).toBeLessThan(0.5);
  });

  it('lets a title shrink without letting it become unreadable', () => {
    expect(faithHeroGeometry.titleMinScale).toBeGreaterThanOrEqual(0.75);
    expect(faithHeroGeometry.titleMinScale).toBeLessThan(1);
  });
});
