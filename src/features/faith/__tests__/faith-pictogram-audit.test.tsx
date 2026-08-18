import { render, fireEvent, screen } from '@testing-library/react-native';
import React, { type ReactElement } from 'react';
import { StyleSheet, type ImageStyle } from 'react-native';

import { ModuleHomeScreen } from '@features/modules/screens/module-home-screen';
import { moduleLayout } from '@features/modules/module-tokens';

import { mockRouter } from '../../../../jest.setup';

import { FaithRepositoryProvider } from '../di/faith-repository-context';
import { getFaithSubmenuEntry, type FaithSubmenuKey } from '../faith-submenu-assets';
import { CalendarScreen } from '../screens/calendar-screens';
import { DuasScreen } from '../screens/duas-screen';
import { HadithScreen } from '../screens/hadith-screen';
import { MosquesScreen, QiblaScreen } from '../screens/location-screens';
import { PrayerTimesScreen } from '../screens/prayer-times-screen';
import { QuranScreen } from '../screens/quran-screen';
import { TasbihScreen } from '../screens/tasbih-screen';

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

  it('keeps Share a vector control rather than a pictogram', async () => {
    const view = await renderIn(<ModuleHomeScreen moduleId="faith" />);
    expect(await view.findByTestId('faith-ayah-share')).toBeTruthy();
    expect(view.queryByTestId('faith-ayah-share-image')).toBeNull();
  });
});

describe('the Continue Quran recitation control', () => {
  it('announces Play, and Pause once playing', async () => {
    const view = await renderIn(<ModuleHomeScreen moduleId="faith" />);
    const control = await view.findByTestId('faith-continue-play');

    expect(control.props.accessibilityRole).toBe('button');
    expect(control.props.accessibilityLabel).toBe('Play Quran recitation');
    expect(control.props.accessibilityState).toMatchObject({ selected: false });

    fireEvent.press(control);

    const after = await view.findByTestId('faith-continue-play');
    expect(after.props.accessibilityLabel).toBe('Pause Quran recitation');
    expect(after.props.accessibilityState).toMatchObject({ selected: true });
  });

  it('never says record, and carries no microphone', async () => {
    const view = await renderIn(<ModuleHomeScreen moduleId="faith" />);
    const control = await view.findByTestId('faith-continue-play');
    expect(String(control.props.accessibilityLabel)).not.toMatch(/record|microphone/i);
  });

  it('meets the 44 dp touch minimum and is a perfect circle', async () => {
    const view = await renderIn(<ModuleHomeScreen moduleId="faith" />);
    const control = await view.findByTestId('faith-continue-play');
    const style = StyleSheet.flatten(control.parent?.props.style) as ImageStyle;

    expect(style.width).toBeGreaterThanOrEqual(44);
    expect(style.width).toBe(style.height);
    expect(style.borderRadius).toBe((style.width as number) / 2);
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

describe('every Faith child inherits its tile pictogram', () => {
  it.each(CHILDREN)('%s shows the approved PNG', async (_name, element, key) => {
    const view = await renderIn(element);
    const image = await view.findByTestId(`faith-identity-${key}-image`);
    expect(image.props.source).toBe(getFaithSubmenuEntry(key).source);
  });

  it.each(CHILDREN)('%s renders it contain, untinted, unwrapped', async (_n, element, key) => {
    const view = await renderIn(element);
    const image = await view.findByTestId(`faith-identity-${key}-image`);
    const style = imageStyle(image);

    expect(image.props.resizeMode).toBe('contain');
    expect(image.props.tintColor).toBeUndefined();
    expect(style.tintColor).toBeUndefined();
    expect(style.backgroundColor).toBeUndefined();
    expect(style.borderWidth).toBeUndefined();
    expect(style.borderRadius).toBeUndefined();
  });

  it.each(CHILDREN)('%s uses the one shared identity box', async (_n, element, key) => {
    const view = await renderIn(element);
    const style = imageStyle(await view.findByTestId(`faith-identity-${key}-image`));

    expect(style.width).toBe(moduleLayout.faithIdentityImage);
    expect(style.height).toBe(moduleLayout.faithIdentityImage);
  });

  it('sizes the identity box inside the specified 48–64 dp band', () => {
    expect(moduleLayout.faithIdentityImage).toBeGreaterThanOrEqual(48);
    expect(moduleLayout.faithIdentityImage).toBeLessThanOrEqual(64);
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
    const target = StyleSheet.flatten(help.parent?.props.style) as ImageStyle;

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
