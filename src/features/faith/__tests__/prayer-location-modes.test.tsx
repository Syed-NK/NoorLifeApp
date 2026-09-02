import fs from 'node:fs';
import path from 'node:path';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { render, screen, fireEvent, within } from '@testing-library/react-native';
import React from 'react';

import {
  seedPrayerLocation,
  TEST_LOCATION_COORDINATE,
} from '@/test-support/faith-location-fixtures';
import { warmUpFirstMount } from '@/test-support/mock-latency-timers';

import { createMockFaithRepositories } from '../data/mock';
import {
  activeLocationRevision,
  resetActiveLocationRevisionForTest,
} from '../data/location/active-location';
import { parseCoordinateInput } from '../data/location/location-acceptance';
import type { FaithResult } from '../data/faith-result';
import {
  isUserSelectedLocation,
  type CityChoice,
  type PrayerLocation,
} from '../data/prayer-times.repository';
import { FaithRepositoryProvider } from '../di/faith-repository-context';
import { faithRoutes } from '../faith-routes';
import { PrayerLocationScreen } from '../screens/prayer-location-screen';
import { PrayerTimesScreen } from '../screens/prayer-times-screen';
import { readStoredLocation, resetPrayerLocationSnapshotForTest } from '../storage/faith-location';

/**
 * The three ways a person sets their prayer location, driven through the production screen.
 *
 * ── What changed, and why the old suite could not cover it ──────────────────
 * This file replaces `prayer-location-manual.test.tsx`, which tested two modes because the screen
 * offered two: a device switch and a coordinate form, with a disabled row reading "city search will
 * be available after a location provider is approved". The catalogue ships in the app, so the row is
 * now a real offline search and `manual` has split into `city` and `coordinates`.
 *
 * ── The property most of these cases are really about ───────────────────────
 * Precedence. Once somebody has chosen a place deliberately, nothing automatic may quietly replace
 * it, and nothing that *fails* may quietly discard it. A failed device switch, a failed save and a
 * relaunch all have to leave the chosen location exactly where it was — and each of those is a path
 * where the obvious implementation loses it.
 */

/**
 * Dubai twice, and the difference matters.
 *
 * `DUBAI_TYPED` is the round city-centre pair somebody would type into the coordinate form.
 * `DUBAI_CITY` is what GeoNames actually records for geoname 292223 — the settlement's centroid,
 * four kilometres away. Using one for the other would make a city save appear to store the typed
 * value, which is precisely the confusion the two modes exist to keep apart.
 */
const DUBAI_TYPED = { latitude: 25.2048, longitude: 55.2708 };
const DUBAI_CITY = { latitude: 25.07725, longitude: 55.30927 };
/** Dubai's identity in the shipped catalogue. Asserted rather than assumed — see the search cases. */
const DUBAI_GEONAMES_ID = 292223;
const MOUNTAIN_VIEW_GEONAMES_ID = 5375480;

/** Two real catalogue rows, as domain objects, for the cases that control search resolution. */
const DUBAI_CHOICE: CityChoice = {
  geonamesId: DUBAI_GEONAMES_ID,
  name: 'Dubai',
  region: 'Dubai',
  countryCode: 'AE',
  countryName: 'United Arab Emirates',
  coordinate: DUBAI_CITY,
};
const MOUNTAIN_VIEW_CHOICE: CityChoice = {
  geonamesId: MOUNTAIN_VIEW_GEONAMES_ID,
  name: 'Mountain View',
  region: 'California',
  countryCode: 'US',
  countryName: 'United States',
  coordinate: { latitude: 37.38605, longitude: -122.08385 },
};
/** What `seedPrayerLocation` writes — the device-mode fix a save has to replace. */
const SEEDED_COORDINATE = TEST_LOCATION_COORDINATE;

warmUpFirstMount(() => renderLocationScreen());

async function renderLocationScreen() {
  await render(
    <FaithRepositoryProvider repositories={createMockFaithRepositories()}>
      <PrayerLocationScreen />
    </FaithRepositoryProvider>,
  );
  // The mount effect reads storage, so the card is only correct after the read has landed.
  await drain();
  return screen;
}

async function renderPrayerScreen() {
  await render(
    <FaithRepositoryProvider repositories={createMockFaithRepositories()}>
      <PrayerTimesScreen />
    </FaithRepositoryProvider>,
  );
  await drain();
  return screen;
}

/**
 * Lets React and the pending promises settle.
 *
 * ── Why every step needs this ───────────────────────────────────────────────
 * `fireEvent` is synchronous and this project runs without an `act` environment, so a press issued
 * immediately after a `changeText` reads the *previous* state — a save would be handed empty
 * coordinates. The save itself is asynchronous as well (a storage write, then a reconciliation), so
 * an assertion made in the same tick sees storage as it was before.
 */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Runs the event loop until everything this screen can have in flight has landed.
 *
 * ── Why draining rather than `findBy*` ──────────────────────────────────────
 * `findBy*` polls inside `act`, and this project has no act environment. When a search promise is
 * already in flight, its resolution opens a second act inside the first — React reports "overlapping
 * act() calls", and once that happens its internal queue is corrupted for the rest of the file: every
 * later `render` produces an empty tree, so eighteen unrelated tests fail with "unable to find" on
 * elements that are rendered unconditionally.
 *
 * Advancing the loop by hand and then querying synchronously never opens an act at all, which is the
 * same discipline the rest of the Faith suites use. The passes are generous because the first search
 * in a worker also parses the 2.19 MB catalogue.
 */
async function drain(passes = 8): Promise<void> {
  for (let pass = 0; pass < passes; pass += 1) {
    await settle();
  }
}

/** Drives the coordinate form exactly as a person would: open, fill, preview, save. */
async function saveThroughCoordinateForm(label: string, latitude: string, longitude: string) {
  await fireEvent.press(screen.getByTestId('faith-prayer-location-mode-coordinates'));
  await drain();
  await fireEvent.changeText(screen.getByTestId('faith-prayer-location-label-input'), label);
  await drain();
  await fireEvent.changeText(screen.getByTestId('faith-prayer-location-latitude-input'), latitude);
  await drain();
  await fireEvent.changeText(
    screen.getByTestId('faith-prayer-location-longitude-input'),
    longitude,
  );
  await drain();
  await fireEvent.press(screen.getByTestId('faith-prayer-location-preview-action'));
  await drain();
  await fireEvent.press(screen.getByTestId('faith-prayer-location-save'));
  await drain();
  await settle();
}

/** Opens the city panel and types a query, draining until the offline search has landed. */
async function searchFor(query: string) {
  await fireEvent.press(screen.getByTestId('faith-prayer-location-mode-city'));
  await drain(2);
  await fireEvent.changeText(screen.getByTestId('faith-prayer-location-city-input'), query);
  await drain();
  return screen.getByTestId('faith-prayer-location-city-results');
}

/** Search, select a result, preview it, and save. The whole city path. */
async function saveCity(query: string, geonamesId: number) {
  await searchFor(query);
  await fireEvent.press(screen.getByTestId(`faith-prayer-location-city-result-${geonamesId}`));
  await drain();
  screen.getByTestId('faith-prayer-location-city-preview');
  await fireEvent.press(screen.getByTestId('faith-prayer-location-city-save'));
  await drain();
}

beforeEach(async () => {
  await AsyncStorage.clear();
  /*
    ── The explicit reset seams ──────────────────────────────────────────────
    Both the revision counter and the store's last-valid snapshot are module-level singletons, so
    they survive between tests along with any subscriptions a previous test's tree left behind.
    Resetting them is what makes each test start from a known revision, an empty listener set, and no
    inherited location.
  */
  resetPrayerLocationSnapshotForTest();
  /*
    ── Why a location is seeded ──────────────────────────────────────────────
    `resolveCurrentLocation` has no fallback: with nothing stored and no platform behind the location
    port, it correctly returns `permission-required` and the Prayer screen renders its permission
    state rather than the location card. Seeding a real stored fix — Makkah, in device mode — is both
    the precondition every other Prayer suite uses and the state a save has to *replace*.
  */
  await seedPrayerLocation();
  /*
    Reset *after* seeding, deliberately. The seed goes through the real mutation boundary, so it
    publishes a revision of its own — and a test asserting "one save, one revision" would otherwise be
    counting the fixture as well as the thing under test. Resetting here makes 0 mean "nothing has
    changed since this test began", which is the property every revision case is actually about.
  */
  resetActiveLocationRevisionForTest();
});

describe('reaching the screen', () => {
  it('routes to a real destination', () => {
    expect(faithRoutes.location).toBe('/faith/location');
    expect(fs.existsSync(path.join(process.cwd(), 'src/app/faith/location.tsx'))).toBe(true);
  });

  it('offers all three ways to set a location', async () => {
    await renderLocationScreen();
    expect(screen.getByTestId('faith-prayer-location-use-device')).toBeTruthy();
    expect(screen.getByTestId('faith-prayer-location-mode-city')).toBeTruthy();
    expect(screen.getByTestId('faith-prayer-location-mode-coordinates')).toBeTruthy();
  });

  it('presents the device option as the recommendation', async () => {
    await renderLocationScreen();
    const badge = screen.getByTestId('faith-prayer-location-device-recommended');
    // Seeded in device mode, so it reads "Active"; the badge is the same slot either way.
    expect(['Active', 'Recommended']).toContain(String(badge.props.children));

    const rationale = screen.getByTestId('faith-prayer-location-device-rationale');
    expect(String(rationale.props.children)).toMatch(
      /prayer times and the direction of the Qibla/i,
    );
    expect(String(rationale.props.children)).toMatch(/stays on this device/i);
  });

  /*
    The presets were a development-only shortcut for filling three text fields. They are gone rather
    than hidden: a release build cannot reach a control that does not exist, and the production form
    is the deterministic seam a release-build verification drives instead.
  */
  it('ships no development presets in any build', async () => {
    await renderLocationScreen();
    expect(
      screen.queryByTestId('faith-prayer-location-presets', { includeHiddenElements: true }),
    ).toBeNull();
    const source = fs.readFileSync(
      path.join(process.cwd(), 'src/features/faith/screens/prayer-location-screen.tsx'),
      'utf8',
    );
    expect(source).not.toMatch(/DEVELOPMENT_PRESETS/);
  });
});

describe('offline city search', () => {
  it('says nothing until two meaningful characters have been typed', async () => {
    await renderLocationScreen();
    await fireEvent.press(screen.getByTestId('faith-prayer-location-mode-city'));
    await drain();

    expect(screen.getByTestId('faith-prayer-location-city-prompt')).toBeTruthy();

    // Punctuation is not a character to search on: "d-" is one meaningful character.
    await fireEvent.changeText(screen.getByTestId('faith-prayer-location-city-input'), 'd-');
    await drain();
    expect(screen.getByTestId('faith-prayer-location-city-prompt')).toBeTruthy();
    expect(
      screen.queryByTestId('faith-prayer-location-city-results', { includeHiddenElements: true }),
    ).toBeNull();
  });

  it('finds Dubai, and shows its region and country', async () => {
    await renderLocationScreen();
    await searchFor('Dubai');

    const row = screen.getByTestId(`faith-prayer-location-city-result-${DUBAI_GEONAMES_ID}`);
    expect(String(row.props.accessibilityLabel)).toContain('Dubai, United Arab Emirates');
    expect(String(row.props.accessibilityLabel)).toMatch(/Select to preview/i);
  });

  it('labels each result for a screen reader as one sentence', async () => {
    await renderLocationScreen();
    await searchFor('Lahore');

    const results = screen.getByTestId('faith-prayer-location-city-results');
    /*
      Every row must carry its own label, read off the *rendered* nodes rather than the component
      elements — the label is applied by the row component, so inspecting the elements the list was
      given would assert nothing. A list where only some rows are announced is worse than one where
      none are: the user cannot tell whether they have reached the end.
    */
    const rows = within(results).getAllByRole('button');
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(typeof row.props.accessibilityLabel).toBe('string');
      expect(String(row.props.accessibilityLabel).length).toBeGreaterThan(0);
    }
  });

  it('distinguishes cities that share a name by their region', async () => {
    await renderLocationScreen();
    await searchFor('Springfield');

    // Eight Springfields exist in the catalogue; the two largest are in Missouri and Massachusetts.
    const missouri = screen.getByTestId('faith-prayer-location-city-result-4409896');
    const massachusetts = screen.getByTestId('faith-prayer-location-city-result-4951788');

    expect(String(missouri.props.accessibilityLabel)).toContain('Missouri');
    expect(String(massachusetts.props.accessibilityLabel)).toContain('Massachusetts');
    expect(missouri.props.accessibilityLabel).not.toBe(massachusetts.props.accessibilityLabel);
  });

  it('returns at most twenty results', async () => {
    const repositories = createMockFaithRepositories();
    // A query matching far more than twenty rows.
    const result = await repositories.prayerTimes.searchCities('san');
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.data.length).toBe(20);
  });

  it('reports no matches rather than an empty list of nothing', async () => {
    await renderLocationScreen();
    await fireEvent.press(screen.getByTestId('faith-prayer-location-mode-city'));
    await drain();
    await fireEvent.changeText(
      screen.getByTestId('faith-prayer-location-city-input'),
      'zzzznowherezzzz',
    );
    await drain();

    expect(screen.getByTestId('faith-prayer-location-city-empty')).toBeTruthy();
  });

  /*
    ── Stale-result protection ───────────────────────────────────────────────
    Searches are asynchronous, so "dub" can resolve *after* "dubai" and repaint the list with results
    for a query the user has already finished typing. Typing straight through and asserting the list
    matches the *final* query is the observable form of that guarantee.
  */
  /*
    ── Why the resolution order is controlled rather than raced ──────────────
    The defect is that an *older* search resolving last repaints the list for a query the user has
    already finished typing. Typing quickly and hoping the searches finish out of order tests the
    machine's scheduling, not the screen: with a warm catalogue they almost always finish in order, so
    the case that matters would pass whether or not the guard existed.

    Holding both promises open and resolving the newer one *first* makes the out-of-order case the
    only case, deterministically.
  */
  it('applies only the newest search, even when an older one resolves last', async () => {
    const pending: {
      readonly query: string;
      readonly resolve: (value: FaithResult<readonly CityChoice[]>) => void;
    }[] = [];
    const base = createMockFaithRepositories();
    const repositories = {
      ...base,
      prayerTimes: {
        ...base.prayerTimes,
        searchCities: (query: string) =>
          new Promise<FaithResult<readonly CityChoice[]>>((resolve) => {
            pending.push({ query, resolve });
          }),
      },
    };

    await render(
      <FaithRepositoryProvider repositories={repositories}>
        <PrayerLocationScreen />
      </FaithRepositoryProvider>,
    );
    await drain();
    await fireEvent.press(screen.getByTestId('faith-prayer-location-mode-city'));
    await drain();

    const input = screen.getByTestId('faith-prayer-location-city-input');
    await fireEvent.changeText(input, 'mo');
    await drain();
    await fireEvent.changeText(input, 'dubai');
    await drain();

    expect(pending.map((entry) => entry.query)).toEqual(['mo', 'dubai']);

    // The newer query lands first…
    pending[1]?.resolve({ kind: 'ok', data: [DUBAI_CHOICE] });
    await drain();
    // …and the older one lands afterwards, which is the case that used to repaint the list.
    pending[0]?.resolve({ kind: 'ok', data: [MOUNTAIN_VIEW_CHOICE] });
    await drain();

    expect(
      screen.getByTestId(`faith-prayer-location-city-result-${DUBAI_GEONAMES_ID}`),
    ).toBeTruthy();
    expect(
      screen.queryByTestId('faith-prayer-location-city-result-5375480', {
        includeHiddenElements: true,
      }),
    ).toBeNull();
  });

  it('discards results for a query that has been cleared', async () => {
    await renderLocationScreen();
    await fireEvent.press(screen.getByTestId('faith-prayer-location-mode-city'));
    await drain();

    const input = screen.getByTestId('faith-prayer-location-city-input');
    await fireEvent.changeText(input, 'Dubai');
    await drain();
    await fireEvent.changeText(input, '');
    await drain();
    await settle();

    expect(screen.getByTestId('faith-prayer-location-city-prompt')).toBeTruthy();
    expect(
      screen.queryByTestId('faith-prayer-location-city-results', { includeHiddenElements: true }),
    ).toBeNull();
  });
});

describe('the city preview', () => {
  it('shows the city, its coordinates, its zone and the GeoNames credit', async () => {
    await renderLocationScreen();
    await searchFor('Dubai');
    await fireEvent.press(
      screen.getByTestId(`faith-prayer-location-city-result-${DUBAI_GEONAMES_ID}`),
    );
    await drain();

    const preview = screen.getByTestId('faith-prayer-location-city-preview');
    const label = String(preview.props.accessibilityLabel);
    expect(label).toContain('Dubai, United Arab Emirates');
    // The catalogue's own centroid, to four decimals — not the round pair a person would type.
    expect(label).toContain('25.0772');
    expect(label).toContain('Asia/Dubai');

    const city = screen.getByTestId('faith-prayer-location-preview-city');
    expect(String(city.props.children)).toBe('Dubai, United Arab Emirates');

    const credit = screen.getByTestId('faith-prayer-location-preview-credit');
    expect(String(credit.props.children)).toMatch(/GeoNames/);
    expect(String(credit.props.children)).toMatch(/CC BY 4\.0/);
  });

  it('requires an explicit save — selecting a result writes nothing', async () => {
    await renderLocationScreen();
    await searchFor('Dubai');
    await fireEvent.press(
      screen.getByTestId(`faith-prayer-location-city-result-${DUBAI_GEONAMES_ID}`),
    );
    await drain();
    screen.getByTestId('faith-prayer-location-city-preview');
    await settle();

    // Still the seeded device fix. A preview is a question, not a commitment.
    const stored = await readStoredLocation();
    expect(stored?.coordinate).toEqual(SEEDED_COORDINATE);
    expect(stored?.mode).toBe('device');
    expect(activeLocationRevision()).toBe(0);
  });

  it('is invalidated by another keystroke, so Save cannot commit an unseen city', async () => {
    await renderLocationScreen();
    await searchFor('Dubai');
    await fireEvent.press(
      screen.getByTestId(`faith-prayer-location-city-result-${DUBAI_GEONAMES_ID}`),
    );
    await drain();
    screen.getByTestId('faith-prayer-location-city-preview');

    await fireEvent.changeText(screen.getByTestId('faith-prayer-location-city-input'), 'Lahore');
    await drain();

    expect(
      screen.queryByTestId('faith-prayer-location-city-preview', { includeHiddenElements: true }),
    ).toBeNull();
    expect(
      screen.getByTestId('faith-prayer-location-city-save').props.accessibilityState?.disabled,
    ).toBe(true);
  });
});

describe('saving a city', () => {
  it('stores city mode with the GeoNames identity attached', async () => {
    await renderLocationScreen();
    await saveCity('Dubai', DUBAI_GEONAMES_ID);

    const stored = await readStoredLocation();
    expect(stored?.mode).toBe('city');
    expect(stored?.coordinate).toEqual(DUBAI_CITY);
    expect(stored?.timezone).toBe('Asia/Dubai');
    expect(stored?.label).toBe('Dubai, United Arab Emirates');
    if (stored?.mode !== 'city') return;
    expect(stored.geonamesId).toBe(DUBAI_GEONAMES_ID);
    expect(stored.countryCode).toBe('AE');
    expect(stored.labelProvenance).toBe('geonames');
  });

  it('bumps the shared revision exactly once, after the write', async () => {
    await renderLocationScreen();
    await saveCity('Dubai', DUBAI_GEONAMES_ID);
    expect(activeLocationRevision()).toBe(1);
  });

  it('shows the GeoNames credit on the current-location card while city mode is active', async () => {
    await renderLocationScreen();
    await saveCity('Dubai', DUBAI_GEONAMES_ID);

    await renderLocationScreen();
    const credit = screen.getByTestId('faith-prayer-location-attribution');
    expect(String(credit.props.children)).toMatch(/GeoNames/);
  });

  it('shows no GeoNames credit for a device fix, which GeoNames did not supply', async () => {
    await renderLocationScreen();
    expect(
      screen.queryByTestId('faith-prayer-location-attribution', { includeHiddenElements: true }),
    ).toBeNull();
  });

  it('re-validates the catalogue record and refuses one that is not in it', async () => {
    const repositories = createMockFaithRepositories();
    const result = await repositories.prayerTimes.saveCityLocation({
      geonamesId: 999_999_999,
      name: 'Nowhere',
      region: null,
      countryCode: 'AE',
      countryName: 'United Arab Emirates',
      coordinate: DUBAI_CITY,
    });

    expect(result.kind).toBe('error');
    // Nothing was written: the seeded device fix is still what prayer times use.
    expect((await readStoredLocation())?.coordinate).toEqual(SEEDED_COORDINATE);
  });

  it('refuses a city whose coordinate has been tampered with since it was offered', async () => {
    const repositories = createMockFaithRepositories();
    const result = await repositories.prayerTimes.saveCityLocation({
      geonamesId: DUBAI_GEONAMES_ID,
      name: 'Dubai',
      region: 'Dubai',
      countryCode: 'AE',
      countryName: 'United Arab Emirates',
      // Not the catalogue's coordinate for 292223.
      coordinate: { latitude: 0, longitude: 0 },
    });

    expect(result.kind).toBe('error');
    expect((await readStoredLocation())?.coordinate).toEqual(SEEDED_COORDINATE);
  });

  it('leaves the previous record in place when a save cannot be committed', async () => {
    await renderLocationScreen();
    await saveCity('Dubai', DUBAI_GEONAMES_ID);
    const before = await readStoredLocation();

    const repositories = createMockFaithRepositories();
    await repositories.prayerTimes.saveCityLocation({
      geonamesId: 999_999_999,
      name: 'Nowhere',
      region: null,
      countryCode: 'XX',
      countryName: 'Nowhere',
      coordinate: DUBAI_CITY,
    });

    expect(await readStoredLocation()).toEqual(before);
    expect(activeLocationRevision()).toBe(1);
  });
});

describe('typed coordinates', () => {
  it.each([
    ['empty', '', 'latitude'],
    ['non-numeric', 'abc', 'latitude'],
    ['a partial number', '25abc', 'latitude'],
    ['infinite', 'Infinity', 'latitude'],
    ['out of range', '91', 'latitude'],
    ['out of range', '-181', 'longitude'],
  ] as const)('rejects %s input', (_name, raw, axis) => {
    expect(parseCoordinateInput(raw, axis).kind).toBe('invalid');
  });

  it('accepts the Dubai coordinates', () => {
    expect(parseCoordinateInput('25.2048', 'latitude')).toEqual({ kind: 'ok', value: 25.2048 });
    expect(parseCoordinateInput('55.2708', 'longitude')).toEqual({ kind: 'ok', value: 55.2708 });
  });

  it('shows an error and saves nothing for an out-of-range latitude', async () => {
    await renderLocationScreen();
    await saveThroughCoordinateForm('Nowhere', '999', '55.2708');

    expect(screen.getByTestId('faith-prayer-location-error')).toBeTruthy();
    expect((await readStoredLocation())?.coordinate).toEqual(SEEDED_COORDINATE);
  });

  it('resolves the zone before anything is written', async () => {
    const repositories = createMockFaithRepositories();
    expect(repositories.prayerTimes.previewLocation(DUBAI_TYPED)?.timeZone).toBe('Asia/Dubai');
  });

  it('persists coordinates mode, the coordinate and the unverified label', async () => {
    await renderLocationScreen();
    await saveThroughCoordinateForm('Dubai, UAE', '25.2048', '55.2708');

    const stored = await readStoredLocation();
    expect(stored?.mode).toBe('coordinates');
    expect(stored?.coordinate).toEqual(DUBAI_TYPED);
    expect(stored?.label).toBe('Dubai, UAE');
    expect(stored?.labelProvenance).toBe('user-supplied');
    // The user's own words never acquire a catalogue identity.
    expect(stored).not.toHaveProperty('geonamesId');
  });

  it('states that the label is not verified, in the required words', async () => {
    await renderLocationScreen();
    await fireEvent.press(screen.getByTestId('faith-prayer-location-mode-coordinates'));
    await drain();

    expect(String(screen.getByTestId('faith-prayer-location-disclosure').props.children)).toBe(
      'Prayer times are calculated from these coordinates. The location label is for your reference and is not verified.',
    );
  });
});

describe('a user-selected location takes precedence over the device', () => {
  it.each([
    ['a saved city', 'city'],
    ['typed coordinates', 'coordinates'],
  ] as const)('does not let an automatic refresh overwrite %s', async (_name, expected) => {
    await renderLocationScreen();
    /*
      The two paths save *different* coordinates on purpose: the catalogue's centroid for the city,
      the typed pair for the form. Asserting each against its own value is what proves the refresh
      returned the record actually stored rather than a coincidentally similar one.
    */
    const saved = expected === 'city' ? DUBAI_CITY : DUBAI_TYPED;
    if (expected === 'city') {
      await saveCity('Dubai', DUBAI_GEONAMES_ID);
    } else {
      await saveThroughCoordinateForm('Dubai, UAE', '25.2048', '55.2708');
    }

    const repositories = createMockFaithRepositories();
    const outcome = await repositories.prayerTimes.refreshDeviceLocation();

    expect(outcome.kind).toBe('ok');
    if (outcome.kind !== 'ok') return;
    expect(outcome.data.mode).toBe(expected);
    expect(outcome.data.accepted).toBe(false);
    expect(outcome.data.location.coordinate).toEqual(saved);
    // Storage is untouched — no device fix was requested, so none could replace it.
    expect((await readStoredLocation())?.coordinate).toEqual(saved);
  });

  it('shows no device-fix warning while a chosen location is active', async () => {
    await renderLocationScreen();
    await saveCity('Dubai', DUBAI_GEONAMES_ID);

    await renderPrayerScreen();
    screen.getByTestId('faith-prayer-location');

    /*
      "Could not get a new position" would be false here: nothing was attempted. The note element is
      absent entirely rather than empty.
    */
    expect(
      screen.queryByTestId('faith-prayer-location-refresh-note', { includeHiddenElements: true }),
    ).toBeNull();
  });

  it('survives a relaunch, because the mode is stored rather than held in memory', async () => {
    await renderLocationScreen();
    await saveCity('Dubai', DUBAI_GEONAMES_ID);

    // A fresh repository set, as a relaunch produces. Only storage carries anything across.
    resetPrayerLocationSnapshotForTest();
    const relaunched = createMockFaithRepositories();
    expect(await relaunched.prayerTimes.getActiveLocationMode()).toBe('city');

    const resolved = await relaunched.prayerTimes.resolveCurrentLocation();
    expect(resolved.kind).toBe('ok');
    if (resolved.kind !== 'ok') return;
    expect(resolved.data.coordinate).toEqual(DUBAI_CITY);
    expect(resolved.data.timeZone).toBe('Asia/Dubai');
    expect(isUserSelectedLocation(resolved.data)).toBe(true);
  });
});

describe('switching back to device mode', () => {
  it('keeps the saved city when the device cannot supply a fix', async () => {
    await renderLocationScreen();
    await saveCity('Dubai', DUBAI_GEONAMES_ID);

    /*
      The mock repositories use the real location port, which in Jest has no platform behind it — so
      this is the failing-device case the brief asks for, reached without stubbing the failure.
    */
    const repositories = createMockFaithRepositories();
    const result = await repositories.prayerTimes.switchToDeviceLocation();
    expect(result.kind).not.toBe('ok');

    // Nothing was written: Dubai is still active *and* still a city.
    const stored = await readStoredLocation();
    expect(stored?.coordinate).toEqual(DUBAI_CITY);
    expect(stored?.mode).toBe('city');
  });

  it('names the location that remains active rather than reporting a bare failure', async () => {
    await renderLocationScreen();
    await saveCity('Dubai', DUBAI_GEONAMES_ID);

    await renderLocationScreen();
    await fireEvent.press(screen.getByTestId('faith-prayer-location-use-device'));
    await drain();
    await settle();

    const banner = screen.getByTestId('faith-prayer-location-error');
    const text = String(banner.props.accessibilityLabel ?? '');
    expect(text).toMatch(/Dubai, United Arab Emirates/);
    expect(text).toMatch(/remains active/i);
  });

  /*
    ── The fresh-install branch of the same message ──────────────────────────
    This was caught on the emulator, not here: with nothing stored, the failure message read "Your
    previous location remains active" — describing a location that does not exist. It is the exact
    class of statement this module is built to refuse, and it is invisible to a suite that seeds a
    location in `beforeEach`, which every other case in this file does.

    So this case clears storage first, and asserts the *absence* of the claim as well as the presence
    of the correction. A message that merely mentions the two options would still be wrong if it also
    told the user something was retained.
  */
  it('claims no previous location when storage is empty', async () => {
    await AsyncStorage.clear();
    resetPrayerLocationSnapshotForTest();

    await renderLocationScreen();
    // Precondition: genuinely nothing stored, so there is nothing that could be retained.
    expect(await readStoredLocation()).toBeNull();
    expect(screen.getByTestId('faith-prayer-location-current-label').props.children).toBe(
      'No location set',
    );

    await fireEvent.press(screen.getByTestId('faith-prayer-location-use-device'));
    await drain();
    await settle();

    const text = String(
      screen.getByTestId('faith-prayer-location-error').props.accessibilityLabel ?? '',
    );
    expect(text).not.toMatch(/previous location/i);
    expect(text).not.toMatch(/remains active/i);
    expect(text).not.toMatch(/saved location/i);
    expect(text).toMatch(/choose a city or enter coordinates/i);

    // And the failure wrote nothing, so the app is still in its honest no-location state.
    expect(await readStoredLocation()).toBeNull();
    expect(activeLocationRevision()).toBe(0);
  });
});

describe('the device control cannot be pressed into two native requests', () => {
  /*
    ── Why this is UI protection over a data-layer guarantee, not instead of one ──
    The generation model in `prayer-location-store.ts` already makes a second request harmless: the
    newer one supersedes the older and only one can commit. What it does not do is stop the app
    *asking the platform twice* — two permission checks, two GPS acquisitions, two radios spun up for
    one intent. That is a battery and latency cost, and the disabled state is what avoids it.

    `setBusy(true)` cannot do it alone: the button is not disabled until React commits the next
    render, and two taps inside that window both pass. The screen holds a ref that is checked and set
    synchronously, and this is what proves it.
  */
  /*
    The in-flight promises are released at the end of each case rather than left hanging. A promise
    that resolves into a torn-down tree is what corrupts React's act queue for the rest of the file —
    the failure recorded in `drain`'s note above — so the fixture hands back the means to settle them.
  */
  function countingRepositories() {
    let requests = 0;
    const release: (() => void)[] = [];
    const base = createMockFaithRepositories();
    return {
      count: () => requests,
      releaseAll: () => {
        for (const settle of release.splice(0)) {
          settle();
        }
      },
      repositories: {
        ...base,
        /*
          Permission has to be granted for the press to reach the repository at all — `onUseDevice`
          prompts first and returns early on a refusal, which is the correct order and would
          otherwise make this a test of the permission gate rather than of the press guard.
        */
        location: {
          ...base.location,
          getPermission: async () => 'granted' as const,
          requestPermission: async () => 'granted' as const,
        },
        prayerTimes: {
          ...base.prayerTimes,
          switchToDeviceLocation: () => {
            requests += 1;
            // Held open so the control stays in its in-flight state for the assertions below.
            return new Promise<FaithResult<PrayerLocation>>((resolve) => {
              release.push(() => resolve({ kind: 'error', code: 'unavailable' }));
            });
          },
        },
      },
    };
  }

  /*
    ── One case, one mount, on purpose ───────────────────────────────────────
    Two cases here meant two mounts, and the first left an in-flight promise that resolved into the
    second's render — the overlapping-act corruption `drain`'s note describes, which empties the tree
    for everything after it. Asserting both properties against a single mount removes the second
    render entirely.

    The two presses are separated by a drain rather than fired in the same tick. A same-tick pair is
    what the component's synchronous `inFlight` ref exists for, and it cannot be driven here: the
    second `fireEvent` opens an act while the first press's `await` is still resolving inside one, and
    React's queue does not survive it. What this proves is the protection a user actually meets — a
    second tap always lands at least a frame later — and the ref remains as the belt-and-braces cover
    for the frame the disabled prop has not been committed for yet.
  */
  it('stays disabled and busy, and starts only one request, while one is in flight', async () => {
    const { count, releaseAll, repositories } = countingRepositories();
    await render(
      <FaithRepositoryProvider repositories={repositories}>
        <PrayerLocationScreen />
      </FaithRepositoryProvider>,
    );
    await drain();

    await fireEvent.press(screen.getByTestId('faith-prayer-location-use-device'));
    await drain();

    // A second tap while the first is still running starts nothing.
    await fireEvent.press(screen.getByTestId('faith-prayer-location-use-device'));
    await drain();
    expect(count()).toBe(1);

    /*
      Both flags, because they mean different things to a screen reader: `disabled` says the control
      will not respond, `busy` says something is happening. A spinner that announced neither would
      leave a non-sighted user pressing a dead button with no feedback at all.
    */
    const state = screen.getByTestId('faith-prayer-location-use-device').props.accessibilityState;
    expect(state?.disabled).toBe(true);
    expect(state?.busy).toBe(true);

    releaseAll();
    await drain();
  });
});
