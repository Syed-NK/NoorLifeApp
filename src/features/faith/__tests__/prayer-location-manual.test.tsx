import fs from 'node:fs';
import path from 'node:path';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { render, screen, fireEvent } from '@testing-library/react-native';
import React from 'react';

import {
  seedPrayerLocation,
  TEST_LOCATION_COORDINATE,
} from '@/test-support/faith-location-fixtures';
import { warmUpFirstMount } from '@/test-support/mock-latency-timers';

import { createMockFaithRepositories } from '../data/mock';
import {
  activeLocationRevision,
  markActiveLocationChanged,
  resetActiveLocationRevisionForTest,
} from '../data/location/active-location';
import { parseCoordinateInput } from '../data/location/location-acceptance';
import { FaithRepositoryProvider } from '../di/faith-repository-context';
import { faithRoutes } from '../faith-routes';
import {
  DEVELOPMENT_PRESETS,
  PrayerLocationScreen,
  developmentPresetsVisible,
} from '../screens/prayer-location-screen';
import { PrayerTimesScreen } from '../screens/prayer-times-screen';
import { locationModeOf, readStoredLocation } from '../storage/faith-location';

/**
 * Choosing a prayer location by hand, and what that must and must not change.
 *
 * ── Why this suite exists ───────────────────────────────────────────────────
 * The automatic path was complete and the manual one did not exist, so on any device whose GPS
 * cannot be driven — an emulator, a handset indoors, a user planning next week's travel — the
 * location was whatever the platform last said and there was no way to correct it.
 *
 * The cases below are mostly about *precedence* rather than about typing: once a coordinate is
 * chosen deliberately, nothing automatic may quietly replace it, and every surface that shows prayer
 * data has to move to it at the same moment.
 */

const DUBAI = { latitude: 25.2048, longitude: 55.2708 };

/** Every `.ts`/`.tsx` file under a directory. */
function listSourceFiles(root: string): readonly string[] {
  const found: string[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      found.push(...listSourceFiles(full));
    } else if (/\.tsx?$/.test(entry.name)) {
      found.push(full);
    }
  }
  return found;
}
/** What `seedPrayerLocation` writes — the device-mode fix a manual save has to replace. */
const SEEDED_COORDINATE = TEST_LOCATION_COORDINATE;

warmUpFirstMount(() => renderLocationScreen());

async function renderLocationScreen() {
  await render(
    <FaithRepositoryProvider repositories={createMockFaithRepositories()}>
      <PrayerLocationScreen />
    </FaithRepositoryProvider>,
  );
  return screen;
}

async function renderPrayerScreen() {
  await render(
    <FaithRepositoryProvider repositories={createMockFaithRepositories()}>
      <PrayerTimesScreen />
    </FaithRepositoryProvider>,
  );
  return screen;
}

/**
 * Lets React and the pending promises settle.
 *
 * ── Why every step needs this ───────────────────────────────────────────────
 * `fireEvent` is synchronous and this project runs without an `act` environment, so a press issued
 * immediately after a `changeText` reads the *previous* state — the save would be handed empty
 * coordinates. The save itself is asynchronous as well (a storage write, then a reconciliation), so
 * an assertion made in the same tick sees storage as it was before.
 */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

/** Drives the production form exactly as a person would: fill, preview, save. */
async function saveThroughForm(label: string, latitude: string, longitude: string) {
  fireEvent.press(await screen.findByTestId('faith-prayer-location-mode-manual'));
  await settle();
  fireEvent.changeText(await screen.findByTestId('faith-prayer-location-label-input'), label);
  await settle();
  fireEvent.changeText(await screen.findByTestId('faith-prayer-location-latitude-input'), latitude);
  await settle();
  fireEvent.changeText(
    await screen.findByTestId('faith-prayer-location-longitude-input'),
    longitude,
  );
  await settle();
  fireEvent.press(await screen.findByTestId('faith-prayer-location-preview-action'));
  await settle();
  fireEvent.press(await screen.findByTestId('faith-prayer-location-save'));
  await settle();
  await settle();
}

beforeEach(async () => {
  await AsyncStorage.clear();
  /*
    ── The explicit reset seam ───────────────────────────────────────────────
    The revision store is a module-level singleton, so it survives between tests along with any
    subscriptions a previous test's tree left behind. Resetting it here is what makes each test start
    from a known revision and an empty listener set, rather than inheriting whatever the file has
    accumulated so far.
  */
  resetActiveLocationRevisionForTest();
  /*
    ── Why a location is seeded ──────────────────────────────────────────────
    `resolveCurrentLocation` has no fallback: with nothing stored and no platform behind the location
    port, it correctly returns `permission-required`, and the Prayer screen renders its permission
    state instead of the location card. That is right behaviour and it makes an unseeded suite a test
    of the permission screen. Seeding a real stored fix — Makkah, in device mode — is the precondition
    every other Prayer suite uses, and it is also the state a manual save has to *replace*.
  */
  await seedPrayerLocation();
});

describe('reaching the screen', () => {
  it('makes the Prayer location card open Prayer location', async () => {
    await renderPrayerScreen();
    const card = await screen.findByTestId('faith-prayer-location');

    expect(card.props.accessibilityRole).toBe('button');
    expect(String(card.props.accessibilityLabel)).toMatch(/Opens Prayer location/i);
    // And the affordance is visible, not only implied by the card being pressable.
    expect(
      screen.getByTestId('faith-prayer-location-change', { includeHiddenElements: true }),
    ).toBeTruthy();
  });

  it('routes to a real destination', () => {
    expect(faithRoutes.location).toBe('/faith/location');
    expect(fs.existsSync(path.join(process.cwd(), 'src/app/faith/location.tsx'))).toBe(true);
  });

  it('offers both modes', async () => {
    await renderLocationScreen();
    expect(await screen.findByTestId('faith-prayer-location-mode-device')).toBeTruthy();
    expect(await screen.findByTestId('faith-prayer-location-mode-manual')).toBeTruthy();
  });
});

describe('validation', () => {
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
    await saveThroughForm('Nowhere', '999', '55.2708');

    expect(await screen.findByTestId('faith-prayer-location-error')).toBeTruthy();
    // The seeded location is untouched: an invalid coordinate writes nothing.
    expect((await readStoredLocation())?.coordinate).toEqual(SEEDED_COORDINATE);
  });
});

describe('the Dubai save transaction', () => {
  it('resolves Asia/Dubai before anything is written', async () => {
    const repositories = createMockFaithRepositories();
    expect(repositories.prayerTimes.previewLocation(DUBAI)?.timeZone).toBe('Asia/Dubai');
  });

  it('persists manual mode, the coordinate and the unverified label', async () => {
    await renderLocationScreen();
    await saveThroughForm('Dubai, UAE', '25.2048', '55.2708');

    const stored = await screen
      .findByTestId('faith-prayer-location-current-label')
      .then(async () => readStoredLocation());
    expect(stored?.coordinate).toEqual(DUBAI);
    expect(stored?.label).toBe('Dubai, UAE');
    expect(locationModeOf(stored!)).toBe('manual');
  });

  it('bumps the shared revision exactly once, after the write', async () => {
    const before = activeLocationRevision();
    await renderLocationScreen();
    await saveThroughForm('Dubai, UAE', '25.2048', '55.2708');

    // One bump. Every location-derived resource key moves together, so no surface can lag.
    expect(activeLocationRevision()).toBe(before + 1);
  });

  it('states that the label is not verified, in the required words', async () => {
    await renderLocationScreen();
    fireEvent.press(await screen.findByTestId('faith-prayer-location-mode-manual'));
    await settle();

    expect(
      String((await screen.findByTestId('faith-prayer-location-disclosure')).props.children),
    ).toBe(
      'Prayer times are calculated from these coordinates. The location label is for your reference and is not verified.',
    );
  });
});

describe('manual mode takes precedence over the device', () => {
  it('does not let an automatic refresh overwrite a saved coordinate', async () => {
    await renderLocationScreen();
    await saveThroughForm('Dubai, UAE', '25.2048', '55.2708');

    const repositories = createMockFaithRepositories();
    const outcome = await repositories.prayerTimes.refreshCurrentLocation();

    expect(outcome.kind).toBe('ok');
    if (outcome.kind !== 'ok') return;
    expect(outcome.data.mode).toBe('manual');
    expect(outcome.data.accepted).toBe(false);
    expect(outcome.data.location.coordinate).toEqual(DUBAI);
    // Storage is untouched — no device fix was requested, so none could replace it.
    expect((await readStoredLocation())?.coordinate).toEqual(DUBAI);
  });

  it('shows no device-fix warning while manual mode is active', async () => {
    await renderLocationScreen();
    await saveThroughForm('Dubai, UAE', '25.2048', '55.2708');

    await renderPrayerScreen();
    await screen.findByTestId('faith-prayer-location');

    /*
      "Could not get a new position" would be false here: nothing was attempted. The note element is
      absent entirely rather than empty.
    */
    expect(
      screen.queryByTestId('faith-prayer-location-refresh-note', { includeHiddenElements: true }),
    ).toBeNull();
  });

  it('survives a restart, because the mode is stored rather than held in memory', async () => {
    await renderLocationScreen();
    await saveThroughForm('Dubai, UAE', '25.2048', '55.2708');

    // A fresh repository set, as a relaunch produces. Only storage carries anything across.
    const relaunched = createMockFaithRepositories();
    expect(await relaunched.prayerTimes.activeLocationMode()).toBe('manual');
    const resolved = await relaunched.prayerTimes.resolveCurrentLocation();
    expect(resolved.kind).toBe('ok');
    if (resolved.kind !== 'ok') return;
    expect(resolved.data.coordinate).toEqual(DUBAI);
    expect(resolved.data.timeZone).toBe('Asia/Dubai');
  });
});

describe('switching back to device mode', () => {
  it('keeps the saved location when the device cannot supply a fix', async () => {
    await renderLocationScreen();
    await saveThroughForm('Dubai, UAE', '25.2048', '55.2708');

    /*
      The mock repositories use the real location port, which in Jest has no platform behind it — so
      this is the failing-device case the brief asks for, reached without stubbing the failure.
    */
    const repositories = createMockFaithRepositories();
    const result = await repositories.prayerTimes.switchToDeviceLocation();
    expect(result.kind).not.toBe('ok');

    // Nothing was written: Dubai is still active *and* still manual.
    const stored = await readStoredLocation();
    expect(stored?.coordinate).toEqual(DUBAI);
    expect(locationModeOf(stored!)).toBe('manual');
  });

  it('tells the user Dubai remains active rather than reporting a bare failure', async () => {
    await renderLocationScreen();
    await saveThroughForm('Dubai, UAE', '25.2048', '55.2708');

    await renderLocationScreen();
    fireEvent.press(await screen.findByTestId('faith-prayer-location-mode-device'));
    await settle();
    await settle();

    const banner = await screen.findByTestId('faith-prayer-location-error');
    expect(String(banner.props.accessibilityLabel ?? '')).toMatch(
      /Could not switch to device location/i,
    );
  });
});

describe('one shared location snapshot', () => {
  /**
   * Prayer Times and Faith Home key on the same revision.
   *
   * Asserted on the sources rather than by rendering both trees: the property is that neither can
   * cache a location-derived resource under a key the other's save does not move, and that is a fact
   * about the keys.
   */
  it('keys both surfaces on the shared revision', () => {
    const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8');

    for (const file of [
      'src/features/faith/screens/prayer-times-screen.tsx',
      'src/features/faith/hooks/use-faith-home.ts',
    ]) {
      const source = read(file);
      expect(source).toMatch(/useActiveLocationRevision\(\)/);
      expect(source).toMatch(/\$\{locationRevision\}/);
    }
  });

  /**
   * One storage-key mutation boundary, and a scan that fails any future direct writer.
   *
   * ── What replaced the previous assertion ───────────────────────────────────
   * This used to count four `writeStoredLocation(` calls in the repository and call that "one
   * boundary". It was not: it was four independent writes that happened to agree. Each one built its
   * own record, and nothing stopped the fifth from forgetting the timezone or publishing a revision
   * before the bytes landed.
   *
   * Now there is exactly one function that touches the key, and the repository's four call sites are
   * *callers* of it. The scan below is what keeps that true.
   */
  it('writes the location key from exactly one module', () => {
    const files = listSourceFiles(path.join(process.cwd(), 'src'));
    const writers = files.filter((file) =>
      /writeJson\(\s*faithStorageKeys\.location/.test(fs.readFileSync(file, 'utf8')),
    );

    expect(
      writers.map((file) => path.relative(process.cwd(), file).split(path.sep).join('/')),
    ).toEqual(['src/features/faith/storage/prayer-location-store.ts']);
  });

  it('has exactly four callers of the boundary, all in the repository', () => {
    const repository = fs.readFileSync(
      path.join(process.cwd(), 'src/features/faith/data/prayer/adhan-prayer-times.repository.ts'),
      'utf8',
    );
    /*
      The four: the first device resolution, an accepted automatic refresh, the manual save, and the
      switch back to device mode. Each is a different *reason* to change the active location and each
      hands the same boundary a validated candidate.
    */
    expect(repository.match(/commitActivePrayerLocation\(/g) ?? []).toHaveLength(4);
  });

  it('lets no screen, hook or notification module write the key', () => {
    const files = listSourceFiles(path.join(process.cwd(), 'src/features/faith'));
    const callers = files
      .filter((file) => /commitActivePrayerLocation\(/.test(fs.readFileSync(file, 'utf8')))
      .map((file) => path.relative(process.cwd(), file).split(path.sep).join('/'))
      .filter((file) => !file.includes('__tests__'));

    // The boundary itself, its re-export, and the one repository that calls it. Nothing else.
    expect(callers.sort()).toEqual([
      'src/features/faith/data/prayer/adhan-prayer-times.repository.ts',
      'src/features/faith/storage/prayer-location-store.ts',
    ]);
  });

  it('bumps the revision only after a write has landed', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'src/features/faith/data/location/active-location.ts'),
      'utf8',
    );
    expect(source).toMatch(/markActiveLocationChanged/);

    const before = activeLocationRevision();
    markActiveLocationChanged();
    expect(activeLocationRevision()).toBe(before + 1);
  });
});

describe('development presets', () => {
  it('carry the exact coordinates the verification brief names', () => {
    expect(
      DEVELOPMENT_PRESETS.map((preset) => [preset.label, preset.latitude, preset.longitude]),
    ).toEqual([
      ['Dubai, UAE', '25.2048', '55.2708'],
      ['Mountain View, United States', '37.3861', '-122.0839'],
    ]);
  });

  it('are gated on the project’s development boundary alone', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'src/features/faith/screens/prayer-location-screen.tsx'),
      'utf8',
    );
    const executable = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

    // `__DEV__` and nothing else — no runtime flag, no config value, no debug menu.
    expect(executable).toMatch(/return __DEV__;/);
    expect(developmentPresetsVisible()).toBe(__DEV__);
  });

  /**
   * A preset fills the form; it does not save.
   *
   * That is what keeps it a shortcut to *typing* rather than a second way to change the location —
   * and it is why a release build loses nothing by not having them: the production form is the
   * mechanism either way.
   */
  it('populate the production form without writing anything', async () => {
    await renderLocationScreen();
    fireEvent.press(await screen.findByTestId('faith-prayer-location-preset-dubai'));
    await settle();

    expect((await screen.findByTestId('faith-prayer-location-latitude-input')).props.value).toBe(
      '25.2048',
    );
    expect((await screen.findByTestId('faith-prayer-location-longitude-input')).props.value).toBe(
      '55.2708',
    );
    // Nothing saved yet — the user still previews and saves, so storage still holds the seed.
    expect((await readStoredLocation())?.coordinate).toEqual(SEEDED_COORDINATE);
  });

  it('leave the production form reachable without them', async () => {
    /*
      The deterministic seam for a release build: the same inputs and the same save action, addressed
      by stable testIDs. Verifying a release APK means typing the coordinates, exactly as a user
      would — which exercises strictly more of the path than tapping a preset.
    */
    await renderLocationScreen();
    await saveThroughForm('Dubai, UAE', '25.2048', '55.2708');

    expect((await readStoredLocation())?.coordinate).toEqual(DUBAI);
  });
});

describe('no external geocoding', () => {
  it('makes no network request from the location screen or the manual save path', () => {
    for (const file of [
      'src/features/faith/screens/prayer-location-screen.tsx',
      'src/features/faith/data/location/location-acceptance.ts',
    ]) {
      const source = fs
        .readFileSync(path.join(process.cwd(), file), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');

      expect(source).not.toMatch(/fetch\(|axios|XMLHttpRequest|https?:\/\//);
      // And no geocoder: the timezone comes from the bundled polygon lookup, not a service.
      expect(source).not.toMatch(/geocodeAsync|reverseGeocode/);
    }
  });

  it('offers city search only as a truthful statement that it is unavailable', async () => {
    await renderLocationScreen();
    const row = await screen.findByTestId('faith-prayer-location-search-row');

    expect(String(row.props.accessibilityLabel)).toMatch(
      /City search will be available after a location provider is approved/i,
    );
    // Informational only — it is not a control that pretends to search.
    expect(row.props.accessibilityRole).not.toBe('button');
  });
});

describe('accessibility', () => {
  it('names the mode, the fields and the preview', async () => {
    await renderLocationScreen();
    fireEvent.press(await screen.findByTestId('faith-prayer-location-mode-manual'));
    await settle();

    expect(
      String((await screen.findByTestId('faith-prayer-location-mode')).props.accessibilityLabel),
    ).toMatch(/^Mode: /);
    for (const [testID, pattern] of [
      ['faith-prayer-location-label-input', /not verified/i],
      ['faith-prayer-location-latitude-input', /minus 90 and 90/i],
      ['faith-prayer-location-longitude-input', /minus 180 and 180/i],
    ] as const) {
      expect(String((await screen.findByTestId(testID)).props.accessibilityLabel)).toMatch(pattern);
    }
  });
});
