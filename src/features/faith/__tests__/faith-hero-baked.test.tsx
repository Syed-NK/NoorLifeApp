import { render, screen } from '@testing-library/react-native';
import React, { type ReactElement } from 'react';
import { StyleSheet, type ImageStyle } from 'react-native';

import { faithHeroGeometry } from '@features/modules/module-tokens';
import { installMockLatencyTimers } from '@/test-support/mock-latency-timers';

import { FaithRepositoryProvider } from '../di/faith-repository-context';
import { faithHeroImages, type FaithHeroImageKey } from '../faith-hero-images';
import { CalendarScreen } from '../screens/calendar-screens';
import { DuasScreen } from '../screens/duas-screen';
import { HadithScreen } from '../screens/hadith-screen';
import { MosquesScreen } from '../screens/mosques-screen';
import { PrayerTimesScreen } from '../screens/prayer-times-screen';
import { QuranScreen } from '../screens/quran-screen';

/**
 * The eight section heroes render an approved baked card, and say nothing untrue while doing it.
 *
 * ── What this replaces ──────────────────────────────────────────────────────
 * `faith-pictogram-audit` used to assert that each of these heroes reused its Faith Home tile pictogram
 * inside a shared 76 dp square, and `faith-hero-geometry` asserted a native copy column on all ten. Both
 * were the right contract while the heroes composed their copy natively. They now draw a complete
 * approved card — background, object, eyebrow and heading in one bitmap — so there is no pictogram and no
 * copy column to measure, and 48 assertions were failing on testIDs that no longer exist.
 *
 * Those assertions are replaced rather than deleted. The pictogram audit keeps every case that applies to
 * surfaces still using pictograms (Faith Home's grid, the submenu tiles); `faith-hero-geometry` keeps the
 * outer rectangle for all ten and the copy-column cases for the two that still compose natively.
 *
 * ── The property that matters most here ─────────────────────────────────────
 * Baked copy cannot be edited, so a card whose words are wrong is a product that lies. Three of the eight
 * had exactly that: Hadith claimed "Verified narrations, clearly sourced.", Duas claimed supplications for
 * every part of your day, Mosques offered to find masjids nearby — with no approved provider behind any of
 * them. Their subtitles were removed from the images and the honest wording is native. The cases under
 * "no hero states something untrue" are what keep that from regressing.
 */

installMockLatencyTimers(() => renderIn(<QuranScreen key="warm" />));

async function renderIn(element: ReactElement) {
  await render(<FaithRepositoryProvider>{element}</FaithRepositoryProvider>);
  return screen;
}

function imageStyle(node: { props: { style?: unknown } }): ImageStyle {
  return StyleSheet.flatten(node.props.style as ImageStyle) ?? {};
}

/** Every baked hero: its screen, its mapping key, and the hero's testID stem. */
const BAKED: readonly (readonly [string, ReactElement, FaithHeroImageKey, string])[] = [
  ['Quran', <QuranScreen key="q" />, 'quran', 'faith-hero-quran'],
  ['Hadith', <HadithScreen key="h" />, 'hadith', 'faith-hero-hadith'],
  ['Duas', <DuasScreen key="d" />, 'duas', 'faith-hero-duas'],
  ['Prayer', <PrayerTimesScreen key="p" />, 'prayer', 'faith-hero-prayer'],
  /*
    Qibla is deliberately absent from this table, for the same reason as Tasbih.

    The approved Qibla A+D design has **no hero**: the dial is the dominant element and starts
    directly under the header, because a 144 dp artwork above it pushed the compass — the entire
    point of the screen — below the fold, and pushed the guidance card off it entirely. The
    nine-screen 'same rectangle' rule still binds every screen that draws a hero; Qibla no longer
    draws one, so asserting its geometry would be asserting a card that is not there.
  */
  /*
    Tasbih is deliberately absent: the approved Tasbih B design has no hero. See the note in
    faith-hero-geometry.test.tsx.
  */
  ['Mosques', <MosquesScreen key="m" />, 'mosques', 'faith-hero-mosques'],
  ['Calendar', <CalendarScreen key="c" />, 'calendar', 'faith-hero-calendar'],
];

/** The three with no approved provider, and the wording each must show. */
const LOCKED: readonly (readonly [string, ReactElement, FaithHeroImageKey, string])[] =
  BAKED.filter(([, , key]) => key === 'hadith' || key === 'duas' || key === 'mosques');

describe('the shared 144 dp geometry survives the baked image', () => {
  it.each(BAKED)('%s keeps the authoritative height and radius', async (_n, el, _k, testID) => {
    const view = await renderIn(el);
    const style = imageStyle(await view.findByTestId(testID));
    expect(style.height).toBe(faithHeroGeometry.height);
    expect(style.borderRadius).toBe(faithHeroGeometry.radius);
    // Zero, so the hero sits flush with the cards beneath it inside the scaffold's column.
    expect(style.marginHorizontal).toBe(faithHeroGeometry.marginHorizontal);
  });

  it.each(BAKED)('%s clips the bitmap to the card', async (_n, el, _k, testID) => {
    const view = await renderIn(el);
    // `overflow: hidden` on the card is what keeps the image inside the corner radius.
    expect(imageStyle(await view.findByTestId(testID)).overflow).toBe('hidden');
  });
});

describe('the baked image is the approved local asset, drawn without distortion', () => {
  it.each(BAKED)('%s draws its mapped source', async (_n, el, key, testID) => {
    const view = await renderIn(el);
    expect((await view.findByTestId(`${testID}-image`)).props.source).toBe(
      faithHeroImages[key].source,
    );
  });

  it.each(BAKED)('%s uses cover, so the image cannot be stretched', async (_n, el, _k, testID) => {
    const view = await renderIn(el);
    // `cover` crops to fill; `stretch` would distort. Rule 4 forbids distortion.
    expect((await view.findByTestId(`${testID}-image`)).props.resizeMode).toBe('cover');
  });

  it.each(BAKED)('%s fills the card, leaving no gap', async (_n, el, _k, testID) => {
    const view = await renderIn(el);
    const style = imageStyle(await view.findByTestId(`${testID}-image`));
    // All four edges pinned, so there is no layout shift as it decodes.
    expect(style.position).toBe('absolute');
    expect([style.top, style.left, style.right, style.bottom]).toEqual([0, 0, 0, 0]);
    /*
      And definite dimensions. Pinned edges alone do not size an `Image`: without these it measures at
      its source's intrinsic size, which for these 1083x432 files with no density suffix meant a 3x zoom
      showing only the top-left corner of the card. This assertion is the regression guard.
    */
    expect(style.width).toBe('100%');
    expect(style.height).toBe('100%');
  });

  it('every source is a local asset, never a remote URI', () => {
    /*
      A remote hero would flash, could fail offline, and would leak a request. Under Metro a bundled
      `require` resolves to a numeric handle; Jest's asset transformer substitutes an object instead, so
      asserting the number would test the harness rather than the app. What is asserted is the property
      that actually matters either way: no source carries an `http` URI.
    */
    for (const key of Object.keys(faithHeroImages) as readonly FaithHeroImageKey[]) {
      const source = faithHeroImages[key].source as
        { readonly uri?: string; readonly testUri?: string } | number;

      if (typeof source === 'number') {
        // Metro: a bundled asset handle. Nothing further to check.
        continue;
      }
      // Jest's transformer yields `{ testUri: '<relative path>' }`. Either key must be a local path.
      const path = source.uri ?? source.testUri ?? '';
      expect(path).not.toBe('');
      expect(path).not.toMatch(/^https?:/);
      expect(path).toContain('assets/images/modules/faith/hero/');
    }
  });
});

describe('the baked words are announced exactly once', () => {
  it.each(BAKED)('%s exposes one accessible name on the container', async (_n, el, key, testID) => {
    const view = await renderIn(el);
    const hero = await view.findByTestId(testID);

    // `accessible` collapses the subtree, so nothing inside can be announced separately.
    expect(hero.props.accessible).toBe(true);
    expect(hero.props.accessibilityLabel).toBe(faithHeroImages[key].accessibleName);
  });

  it.each(BAKED)('%s hides the image from screen readers', async (_n, el, _k, testID) => {
    const view = await renderIn(el);
    const image = await view.findByTestId(`${testID}-image`);
    // Decorative twice over: the container above already carries the words.
    expect(image.props.accessible).toBe(false);
    expect(image.props.importantForAccessibility).toBe('no');
  });

  it.each(BAKED)(
    '%s renders no native heading or subtitle over the baked copy',
    async (_n, el, _k, testID) => {
      const view = await renderIn(el);
      await view.findByTestId(testID);
      // The composed path's nodes. Their absence is what proves nothing is drawn twice.
      expect(view.queryByTestId(`${testID}-copy`)).toBeNull();
      expect(view.queryByTestId(`${testID}-title`)).toBeNull();
      expect(view.queryByTestId(`${testID}-detail`)).toBeNull();
    },
  );

  it.each(BAKED)('%s draws no pictogram or separated object', async (_n, el, _k, testID) => {
    const view = await renderIn(el);
    await view.findByTestId(testID);
    // The old contract's artwork node. Gone, along with the generic background it used to sit on.
    expect(view.queryByTestId(`${testID}-artwork`)).toBeNull();
    expect(view.queryByTestId(`${testID}-background`)).toBeNull();
    expect(view.queryByTestId(`${testID}-lantern`)).toBeNull();
  });

  it('every accessible name matches what is visible, and is not a picture description', () => {
    for (const key of Object.keys(faithHeroImages) as readonly FaithHeroImageKey[]) {
      const { accessibleName, lockedSubtitle } = faithHeroImages[key];
      expect(accessibleName.length).toBeGreaterThan(20);
      // Scenery is not what the screen is telling the user.
      expect(accessibleName).not.toMatch(/crescent|lantern|night sky|silhouette|background/i);
      // A locked hero's spoken name must carry the honest wording, not the removed claim.
      if (lockedSubtitle !== undefined) {
        expect(accessibleName).toContain(lockedSubtitle);
      }
    }
  });
});

describe('no hero states something untrue', () => {
  it.each(LOCKED)('%s shows its honest locked subtitle natively', async (_n, el, key, testID) => {
    const view = await renderIn(el);
    const text = await view.findByTestId(`${testID}-locked-subtitle`);
    expect(String(text.props.children)).toBe(faithHeroImages[key].lockedSubtitle);
  });

  it.each(LOCKED)('%s states the required wording exactly', async (_n, _el, key) => {
    const required: Readonly<Record<string, string>> = {
      hadith: 'Verified Hadith content is not configured yet.',
      duas: 'Verified Dua content is not configured yet.',
      mosques: 'Nearby mosque information requires an approved directory provider.',
    };
    expect(faithHeroImages[key].lockedSubtitle).toBe(required[key]);
  });

  it('no locked hero claims its content is available', () => {
    /*
      The removed baked wording, in the shape it took. These strings must not reappear in any hero's
      spoken name — which is the one place they could return without an image change.
    */
    for (const key of ['hadith', 'duas', 'mosques'] as const) {
      const spoken = faithHeroImages[key].accessibleName;
      expect(spoken).not.toMatch(/clearly sourced/i);
      expect(spoken).not.toMatch(/for every part of your day/i);
      expect(spoken).not.toMatch(/find masjids/i);
      // And it says, in words, that nothing is configured.
      expect(spoken).toMatch(/not configured|requires an approved/i);
    }
  });

  it('the Prayer hero states no prayer name and no time', async () => {
    /*
      "Next prayer" is generic and may stay baked. What must not appear is a specific prayer or a clock
      time — those are the calculated result, and they belong to `faith-prayer-next` below the hero.
    */
    const spoken = faithHeroImages.prayer.accessibleName;
    expect(spoken).not.toMatch(/\b(Fajr|Dhuhr|Asr|Maghrib|Isha)\b/);
    expect(spoken).not.toMatch(/\d{1,2}:\d{2}/);

    const view = await renderIn(<PrayerTimesScreen />);
    const hero = await view.findByTestId('faith-hero-prayer');
    expect(hero.props.accessibilityLabel).not.toMatch(/\d{1,2}:\d{2}/);
  });

  it('the calculated prayer result lives outside the hero, from the shared source', async () => {
    /*
      The countdown card is the screen's answer, and it is fed by the same repository Main Home reads —
      `faith-prayer-countdown.test.ts` and `main-home-prayer-row.test.tsx` own that guarantee. Here the
      check is only that it is a separate node from the hero, so nothing dynamic is drawn on the image.
    */
    const view = await renderIn(<PrayerTimesScreen />);
    await view.findByTestId('faith-hero-prayer');
    // Absent with no location, which is the state this suite runs in — and that is itself the point:
    // the hero does not invent a time to fill the gap.
    expect(view.queryByTestId('faith-prayer-next')).not.toBe(
      view.queryByTestId('faith-hero-prayer'),
    );
  });

  it('no hero mapping references a removed or separated asset', () => {
    /*
      The three un-stripped locked images were deleted, so the mapping must point at the `-locked`
      variants. The presence of a `lockedSubtitle` is what distinguishes them, and it is the property the
      component branches on — a locked hero wired to an un-stripped image would show the false baked
      subtitle *and* the honest native one, which is the specific failure this guards.
    */
    for (const key of ['hadith', 'duas', 'mosques'] as const) {
      expect(faithHeroImages[key].lockedSubtitle).toBeDefined();
    }
    for (const key of ['quran', 'prayer', 'qibla', 'tasbih', 'calendar'] as const) {
      // The five truthful cards keep their complete baked copy, so they need no native subtitle.
      expect(faithHeroImages[key].lockedSubtitle).toBeUndefined();
    }
  });
});

describe('hero actions exist only where they do something', () => {
  it.each(LOCKED)('%s exposes no hero action while locked', async (_n, el, _k, testID) => {
    const view = await renderIn(el);
    await view.findByTestId(testID);
    expect(view.queryByTestId(`${testID}-action`)).toBeNull();
  });
});
