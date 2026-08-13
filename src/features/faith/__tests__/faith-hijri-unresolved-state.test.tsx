import fs from 'node:fs';
import path from 'node:path';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { render, screen } from '@testing-library/react-native';
import React, { type ReactElement } from 'react';

import { installMockLatencyTimers } from '@/test-support/mock-latency-timers';
import { seedPrayerLocation } from '@/test-support/faith-location-fixtures';
import { ModuleHomeScreen } from '@features/modules/screens/module-home-screen';

import type { FaithRepositories } from '../data';
import { createMockFaithRepositories } from '../data/mock';
import { FaithRepositoryProvider } from '../di/faith-repository-context';
import { CalendarScreen } from '../screens/calendar-screens';

/**
 * An unresolved prayer location produces an honest state on screen, never a plausible date.
 *
 * ── The defect these cases lock out ─────────────────────────────────────────
 * `createLocationDayResolver` served the **device's** calendar day while the asynchronous location
 * lookup was in flight, then corrected on a later render. Nothing on screen said the date was
 * provisional, and around midnight the provisional value and the real one were different days — so
 * Faith Home could briefly show one location's prayer countdown beside another location's Hijri
 * date, and a screenshot taken in that window looked entirely normal.
 *
 * The resolver is deleted. Every location-scoped date now derives from a `PrayerLocation` the
 * caller has already resolved, and the states in which no date can be derived are members of the
 * result type rather than substituted values.
 *
 * ── What these cases assert that the data-layer suite cannot ────────────────
 * `faith-location-calendar-day.test.ts` proves the derivation is correct and total. These prove the
 * *rendering*: that a screen with no location prints words rather than a date, and that the two
 * surfaces which must agree are reading one resource rather than two.
 */

installMockLatencyTimers(() => renderWith(<ModuleHomeScreen moduleId="faith" />));

async function renderWith(element: ReactElement, repositories?: Partial<FaithRepositories>) {
  await render(
    <FaithRepositoryProvider repositories={{ ...createMockFaithRepositories(), ...repositories }}>
      {element}
    </FaithRepositoryProvider>,
  );
  return screen;
}

/** Anything that reads as a Hijri or Gregorian date. Nothing may print one without a location. */
const LOOKS_LIKE_A_DATE =
  /\d{1,2}\s+(Muharram|Safar|Rabi|Jumada|Rajab|Shaban|Ramadan|Shawwal|Dhul)[\w'’-]*\s+\d{3,4}\s*AH|\d{4}-\d{2}-\d{2}/;

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe('Faith Home states no date until it knows where the user is', () => {
  /**
   * The default fixtures deny location, which is the first-run state and the one that used to be
   * papered over with the device's day.
   */
  it('renders a location-required state on the Hijri card, carrying no date', async () => {
    const view = await renderWith(<ModuleHomeScreen moduleId="faith" />);
    const card = await view.findByTestId('faith-calendar');
    const spoken = String(card.props.accessibilityLabel);

    expect(spoken).toMatch(/Location needed/);
    expect(spoken).not.toMatch(LOOKS_LIKE_A_DATE);
  });

  it('names what it is waiting for rather than showing a generic title', async () => {
    const view = await renderWith(<ModuleHomeScreen moduleId="faith" />);
    const spoken = String((await view.findByTestId('faith-calendar')).props.accessibilityLabel);

    // The old copy was "Hijri date / Hijri dates alongside Gregorian" for every unresolved state,
    // which read as a heading rather than as an absence.
    expect(spoken).toMatch(/depends on where you are/);
  });

  it('shows the date once a location is stored', async () => {
    await seedPrayerLocation();
    const view = await renderWith(<ModuleHomeScreen moduleId="faith" />);
    const card = await view.findByTestId('faith-calendar');

    await view.findByTestId('faith-calendar');
    const spoken = String(card.props.accessibilityLabel);
    expect(spoken).toMatch(/AH|\d{4}-\d{2}-\d{2}/);
  });
});

/**
 * The Hijri card and the hero read one resource, so they cannot disagree.
 *
 * Asserted structurally rather than by racing two renders: a timing test would pass whenever the
 * race happened not to occur. What makes disagreement impossible is that there is only one request,
 * and that is what this checks — `HijriTodayCard` takes the hero's resource as a prop and issues no
 * lookup of its own.
 */
describe('Faith Home and the hero cannot disagree about today', () => {
  it('the Hijri card issues no repository call of its own', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'src/features/modules/faith/faith-home-content.tsx'),
      'utf8',
    );
    /*
      Sliced to the next top-level declaration rather than matched with a lazy `\n}`: the component's
      destructured parameter list closes with a brace in column zero, so the obvious pattern stops
      three lines in and would pass no matter what the body did.
    */
    const start = source.indexOf('function HijriTodayCard(');
    const next = source.indexOf('\nfunction ', start + 1);
    const card = source.slice(start, next === -1 ? undefined : next);

    expect(start).toBeGreaterThan(-1);
    expect(card).toMatch(/CompactDateCard/);
    // No repository handle, no resource, no fetch — it renders what it is handed.
    expect(card).not.toMatch(/useFaithRepositories|useFaithResource|calendar\./);
    expect(card).toMatch(/today: UseFaithResource<NextPrayerView>/);
  });

  it('resolves the location once for both values', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'src/features/faith/hooks/use-faith-home.ts'),
      'utf8',
    );
    const resource = /const nextPrayer = useFaithResource\([\s\S]*?\n  \);/.exec(source)?.[0] ?? '';

    expect(resource).not.toBe('');
    // One resolution, then both derivations from `location.data` in a single `Promise.all`.
    expect(resource.match(/resolveCurrentLocation\(\)/g) ?? []).toHaveLength(1);
    expect(resource).toMatch(/getNextPrayer\(location\.data/);
    expect(resource).toMatch(/getLocationToday\(location\.data\)/);
  });
});

describe('the Calendar screen is location-scoped, and says so when it cannot resolve one', () => {
  /**
   * The product boundary, asserted.
   *
   * This screen could have been device-local — a calendar is arguably about the user rather than
   * about a place. It is not, because its dates are the same dates Faith Home and the Prayer screen
   * show, and because an observance countdown is decided where the user is. The consequence is that
   * it has a location-required state, and this is it.
   */
  it('prints no date when no location is resolved', async () => {
    const view = await renderWith(<CalendarScreen />);
    const scaffold = await view.findByTestId('faith-calendar');

    expect(scaffold).toBeTruthy();
    expect(view.queryByText(LOOKS_LIKE_A_DATE)).toBeNull();
  });

  it('renders the month grid once a location is stored', async () => {
    await seedPrayerLocation();
    const view = await renderWith(<CalendarScreen />);

    expect(await view.findByTestId('faith-calendar-grid')).toBeTruthy();
  });
});

/**
 * There is no device-local "today" API anywhere in the Faith module.
 *
 * The brief allows a device-local Calendar *provided* it is explicitly separated and never shares an
 * ambiguously named API with the prayer-location dates. NoorLife took the other option — one
 * semantics — so the assertion is that the second semantics does not exist to be confused with the
 * first.
 */
describe('no device-local today API exists to be confused with the location one', () => {
  const read = (file: string): string =>
    fs
      .readFileSync(path.join(process.cwd(), file), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');

  it('the calendar contract exposes exactly one today, and it takes a location', () => {
    const contract = read('src/features/faith/data/faith-calendar.repository.ts');

    expect(contract).toMatch(/getLocationToday\(location: PrayerLocation\)/);
    // The old ambiguous name is gone rather than deprecated beside its replacement.
    expect(contract).not.toMatch(/\bgetToday\b/);
    expect(contract).not.toMatch(/getDeviceToday|getLocalToday/);
  });

  it('the boundary module exports no device-day helper', () => {
    const boundary = read('src/features/faith/data/calendar-day.ts');

    expect(boundary).not.toMatch(
      /deviceCivilDate|civilDateAtZoneOrDevice|createLocationDayResolver/,
    );
    expect(boundary).toMatch(/export function locationDayFor/);
  });
});
