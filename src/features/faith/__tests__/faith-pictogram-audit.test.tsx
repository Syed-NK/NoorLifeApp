import { render, fireEvent, screen } from '@testing-library/react-native';
import React, { type ReactElement } from 'react';
import { StyleSheet, type ImageStyle } from 'react-native';

import { ModuleHomeScreen } from '@features/modules/screens/module-home-screen';
import { faithHeroGeometry, moduleLayout } from '@features/modules/module-tokens';
import { installMockLatencyTimers } from '@/test-support/mock-latency-timers';

import { mockRouter } from '../../../../jest.setup';

import { FaithRepositoryProvider } from '../di/faith-repository-context';
import { getFaithSubmenuEntry, type FaithSubmenuKey } from '../faith-submenu-assets';
import { CalendarScreen } from '../screens/calendar-screens';
import { DuasScreen } from '../screens/duas-screen';
import { HadithScreen } from '../screens/hadith-screen';
import { MosquesScreen } from '../screens/mosques-screen';
import { QiblaScreen } from '../screens/qibla-screen';
import { PrayerTimesScreen } from '../screens/prayer-times-screen';
import { QuranScreen } from '../screens/quran-screen';
import { TasbihScreen } from '../screens/tasbih-screen';

// Two costs this removes: the simulated latency the mock data sources sleep through on every
// mount, and the one-off compile cost of the first mount, warmed up in `beforeAll` so that no
// individual test is charged for it.
installMockLatencyTimers(() => renderIn(<ModuleHomeScreen moduleId="faith" />));

/**
 * Faith feature identities are approved PNGs; functional controls stay vectors.
 *
 * ── The rule these encode ───────────────────────────────────────────────────
 * A *feature identity* — Quran, Hadith, Duas, Prayer, Qibla, Tasbih, Mosques, Calendar —
 * must be the approved pictogram. A *functional control* — back, help, chevron,
 * play/pause, bookmark, share, search, close, a check state — stays a vector, because it
 * is small, may need to change state, and must stay crisp.
 *
 * Both halves are asserted: the identities resolve to the right PNG, and the controls are
 * still icons rather than having been swapped for generated artwork.
 */

async function renderIn(element: ReactElement) {
  await render(<FaithRepositoryProvider>{element}</FaithRepositoryProvider>);
  return screen;
}

function imageStyle(node: { props: { style?: unknown } }): ImageStyle {
  return StyleSheet.flatten(node.props.style) as ImageStyle;
}

describe('Faith Home identities', () => {
  it('Continue Quran uses the approved Quran PNG, not the icon font', async () => {
    const view = await renderIn(<ModuleHomeScreen moduleId="faith" />);
    const image = await view.findByTestId('faith-continue-image');

    expect(image.props.source).toBe(getFaithSubmenuEntry('quran').source);
    expect(image.props.resizeMode).toBe('contain');
    expect(image.props.tintColor).toBeUndefined();

    const style = imageStyle(image);
    expect(style.tintColor).toBeUndefined();
    expect(style.backgroundColor).toBeUndefined();
    expect(style.borderWidth).toBeUndefined();
    expect(style.width).toBe(moduleLayout.faithContinueImage);
  });

  it('the lower Islamic Calendar card uses the approved Calendar PNG', async () => {
    const view = await renderIn(<ModuleHomeScreen moduleId="faith" />);
    const image = await view.findByTestId('faith-calendar-image');

    expect(image.props.source).toBe(getFaithSubmenuEntry('calendar').source);
    expect(image.props.resizeMode).toBe('contain');
    expect(imageStyle(image).tintColor).toBeUndefined();
    expect(imageStyle(image).width).toBe(moduleLayout.faithCompactImage);
  });

  it('leaves Upcoming/Ramadan on a vector, since no approved PNG exists', async () => {
    const view = await renderIn(<ModuleHomeScreen moduleId="faith" />);
    // No image node — the crescent stays an AppIcon rather than borrowing an unrelated
    // pictogram. The gap is recorded in docs/FAITH_ASSET_GAPS.md.
    expect(view.queryByTestId('faith-upcoming-image')).toBeNull();
    expect(await view.findByTestId('faith-upcoming')).toBeTruthy();
  });

  /**
   * The verse card is the control.
   *
   * It carried a separate share glyph whose only job was "open this in full" — which is what
   * tapping the card already did. Two controls, one destination, and the smaller of the two was a
   * 17 dp icon inside a card that was itself a 44 dp target.
   */
  it('opens the verse from the card rather than from a second glyph', async () => {
    const view = await renderIn(<ModuleHomeScreen moduleId="faith" />);
    const card = await view.findByTestId('faith-ayah');

    expect(String(card.props.accessibilityLabel)).toMatch(/Opens in full/);
    expect(view.queryByTestId('faith-ayah-share')).toBeNull();
    expect(view.queryByTestId('faith-ayah-share-image')).toBeNull();
  });
});

/**
 * There is no recitation control on the Faith home.
 *
 * ── What this block used to assert, and why it is inverted ──────────────────
 * It checked that a play button announced "Play Quran recitation", flipped to "Pause" when pressed,
 * and met the 44 dp minimum as a perfect circle. All of that was true, and all of it was describing
 * a control that played nothing: pressing it toggled a boolean, and its own accessibility hint said
 * audio "arrives with the approved recitation source".
 *
 * A transport control that has never transported anything is not an accessibility success, it is a
 * well-labelled dead end — and it sat on the most prominent card of the module's front page. It is
 * removed until there is audio behind it, and this asserts it has not crept back.
 */
describe('the Continue reading card offers no audio it cannot play', () => {
  it('renders no play control', async () => {
    const view = await renderIn(<ModuleHomeScreen moduleId="faith" />);
    await view.findByTestId('faith-continue');
    expect(view.queryByTestId('faith-continue-play')).toBeNull();
  });

  it('promises no playback in any label on the card', async () => {
    const view = await renderIn(<ModuleHomeScreen moduleId="faith" />);
    const card = await view.findByTestId('faith-continue');
    const spoken = String(card.props.accessibilityLabel);

    expect(spoken).not.toMatch(/play|pause|listen|recitation|audio/i);
  });
});

/** Each child screen, the pictogram it must inherit, and its scaffold testID prefix. */
const CHILDREN: readonly (readonly [string, ReactElement, FaithSubmenuKey, string])[] = [
  ['Quran', <QuranScreen key="q" />, 'quran', 'faith-quran'],
  ['Hadith', <HadithScreen key="h" />, 'hadith', 'faith-hadith'],
  ['Duas', <DuasScreen key="d" />, 'duas', 'faith-duas'],
  ['Prayer', <PrayerTimesScreen key="p" />, 'prayer', 'faith-prayer-times'],
  ['Qibla', <QiblaScreen key="qb" />, 'qibla', 'faith-qibla'],
  ['Tasbih', <TasbihScreen key="t" />, 'tasbih', 'faith-tasbih'],
  ['Mosques', <MosquesScreen key="m" />, 'mosques', 'faith-mosques'],
  ['Calendar', <CalendarScreen key="c" />, 'calendar', 'faith-calendar'],
];

/**
 * ── The eight section *heroes* no longer carry pictograms, and that is intentional ─
 * This block asserted that each child hero rendered its Faith Home tile PNG inside the shared 76 dp
 * square. That was the right contract while the heroes composed themselves natively. They now draw a
 * complete approved card — background, object, eyebrow and heading in one bitmap — so there is no
 * pictogram in a hero to audit, and the three cases here were failing on a `-artwork` testID that no
 * longer exists.
 *
 * They are replaced, not deleted. `faith-hero-baked.test.tsx` asserts the new contract in full: the
 * mapped source, `cover` with no distortion, local-only assets, decorative marking, one accessible name,
 * no duplicate native copy, and no pictogram or separated-object node left behind.
 *
 * **Everything else in this file stands.** The pictograms themselves are unchanged and still shipped —
 * Faith Home's tile grid and the submenu rows draw them, and every case outside this block still audits
 * them. What went away is the requirement that a *hero* reuse one.
 *
 * The case below keeps the tile → screen thread checkable from the other end: each child screen still
 * has an approved pictogram associated with it, whether or not its hero happens to draw it.
 */
describe('every Faith child still has an approved tile pictogram behind it', () => {
  it.each(CHILDREN)('%s resolves an approved PNG for its tile', async (_name, _element, key) => {
    const entry = getFaithSubmenuEntry(key);
    expect(entry.source).toBeDefined();
    expect(entry.label.length).toBeGreaterThan(0);
  });

  /**
   * The pictogram grew from 56 to 76 when the identity card became a full hero rectangle.
   *
   * The old 48–64 dp band described a mark sitting beside two lines of text in a content-height
   * card. The box it sits in is now `faithHeroGeometry.height`, and a 56 dp mark inside a 144 dp
   * card reads as an afterthought rather than as the screen's artwork. The band that matters now
   * is the ratio to the card, which is what this asserts: large enough to be artwork, small enough
   * to leave the reserved column clear.
   */
  it('sizes the hero pictogram as artwork within the hero, not as an icon', () => {
    const ratio = moduleLayout.faithHeroPictogram / faithHeroGeometry.height;
    expect(ratio).toBeGreaterThanOrEqual(0.4);
    expect(ratio).toBeLessThanOrEqual(0.65);
  });
});

describe('the Help control', () => {
  it.each(CHILDREN)(
    '%s exposes a module-specific label and hint',
    async (_n, element, _k, prefix) => {
      const view = await renderIn(element);
      const help = await view.findByTestId(`${prefix}-header-help`);

      expect(help.props.accessibilityLabel).toBe('Faith help');
      expect(String(help.props.accessibilityHint)).toMatch(/Faith/);
    },
  );

  it('has a 44 dp target around a 36 dp visible disc', async () => {
    const view = await renderIn(<ModuleHomeScreen moduleId="faith" />);
    const help = await view.findByTestId('faith-home-header-help');
    const target = StyleSheet.flatten(help.props.style) as ImageStyle;

    expect(target.width).toBe(moduleLayout.minTouchTarget);
    expect(target.height).toBe(moduleLayout.minTouchTarget);
    expect(moduleLayout.headerControl).toBe(36);
  });

  it('keeps the glyph in the specified 18–20 dp band', () => {
    expect(moduleLayout.headerIcon).toBeGreaterThanOrEqual(18);
    expect(moduleLayout.headerIcon).toBeLessThanOrEqual(20);
  });

  it('opens the module help destination rather than doing nothing', async () => {
    const view = await renderIn(<ModuleHomeScreen moduleId="faith" />);
    fireEvent.press(await view.findByTestId('faith-home-header-help'));
    expect(mockRouter.push).toHaveBeenCalledWith('/settings/help');
  });
});
