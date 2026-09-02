import AsyncStorage from '@react-native-async-storage/async-storage';
import { render, screen, fireEvent } from '@testing-library/react-native';
import React from 'react';

import {
  createRecordingLocationPort,
  repositoriesWithLocationPort,
  NATIVE_POSITION_CALLS,
} from '@/test-support/fake-location-port';
import { warmUpFirstMount } from '@/test-support/mock-latency-timers';

import {
  activeLocationRevision,
  resetActiveLocationRevisionForTest,
} from '../data/location/active-location';
import { createFakeNotificationPort } from '../data/notifications/fake-notification.port';
import { FaithRepositoryProvider } from '../di/faith-repository-context';
import { PrayerTimesScreen } from '../screens/prayer-times-screen';
import {
  beginLocationOperation,
  commitActivePrayerLocation,
  readStoredLocation,
  resetLocationOperationsForTest,
  resetPrayerLocationSnapshotForTest,
  type PrayerLocationCandidate,
} from '../storage/faith-location';

/**
 * **Which authority may reach the platform for a position, and which may never.**
 *
 * ── The defect this suite was written from ──────────────────────────────────
 * Reported from the device, with Dubai selected through offline city search. Prayer Times showed a
 * circular GPS refresh control on a location the user had chosen deliberately, and underneath the
 * city it read "Could not get a new position just now. Showing the last one." — a sentence about a
 * device fix that city mode is not supposed to ask for.
 *
 * Both halves of that are covered below, and they had *different* causes. The control was a screen
 * that rendered one refresh button regardless of authority. The message was a device acquisition
 * that had begun before the city was saved and wrote its verdict after — a warning that outlived the
 * location it was about.
 *
 * ── Why the port throws rather than counts ──────────────────────────────────
 * `forbid` makes the fake `LocationPort` fail at the call site, so a violation names the hook or the
 * repository that asked rather than the assertion that noticed several awaits later. The counting
 * variant is used where the requirement is "exactly once" rather than "never".
 *
 * ── Why the fixes are deferred rather than delayed ──────────────────────────
 * Every concurrency case here lives inside the seconds a device acquisition takes. `pendingPositions`
 * hands the test the resolver, so the window is opened and closed on purpose — no sleep is used
 * anywhere in this file to make a race likely.
 */

const DUBAI_CITY = { latitude: 25.07725, longitude: 55.30927 };
const DUBAI_TYPED = { latitude: 25.2048, longitude: 55.2708 };
const MAKKAH = { latitude: 21.4225, longitude: 39.8262 };
const MOUNTAIN_VIEW = { latitude: 37.38605, longitude: -122.08385 };

const CITY: PrayerLocationCandidate = {
  mode: 'city',
  coordinate: DUBAI_CITY,
  label: 'Dubai, United Arab Emirates',
  geonamesId: 292223,
  countryCode: 'AE',
  admin1: 'Dubai',
  resolvedAt: '',
};
const COORDINATES: PrayerLocationCandidate = {
  mode: 'coordinates',
  coordinate: DUBAI_TYPED,
  label: 'Dubai, UAE',
  resolvedAt: '',
};
const DEVICE: PrayerLocationCandidate = {
  mode: 'device',
  coordinate: MAKKAH,
  label: 'Makkah, Saudi Arabia',
  resolvedAt: '',
  accuracyMetres: 20,
};

/**
 * Writes a candidate through the real mutation boundary, stamped now.
 *
 * ── The operation is claimed, and that is not decoration ────────────────────
 * Every production write path — the city save, the coordinate save, the device switch, the automatic
 * refresh — calls `beginLocationOperation` *before* it commits, and that claim is what supersedes
 * anything already in flight. A fixture that skipped it wrote a record that superseded nothing, so a
 * device acquisition started earlier still held the newest generation and was allowed to commit over
 * it minutes later. That is a property of the fixture rather than of the app, and it was found by
 * this file: without the claim, the "late fix cannot relabel a saved city" case failed with Mountain
 * View's coordinate in storage.
 *
 * The two cases that actually turn on the race use `saveCityLocation` instead — the production path,
 * so the guarantee is proved where it lives rather than against a helper that mimics it.
 */
async function seed(candidate: PrayerLocationCandidate): Promise<void> {
  const operation = beginLocationOperation();
  const committed = await commitActivePrayerLocation(
    { ...candidate, resolvedAt: new Date().toISOString() } as PrayerLocationCandidate,
    { operation },
  );
  if (committed.kind === 'rejected') {
    throw new Error(`seed rejected: ${committed.reason}`);
  }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * Runs the event loop until everything in flight has landed.
 *
 * Draining rather than `findBy*` for the reason recorded across the Faith suites: this project has
 * no act environment, and a `findBy*` opened while a promise is already resolving corrupts React's
 * act queue for the rest of the file.
 */
async function drain(passes = 10): Promise<void> {
  for (let pass = 0; pass < passes; pass += 1) {
    await settle();
  }
}

async function renderPrayerTimes(repositories: ReturnType<typeof repositoriesWithLocationPort>) {
  await render(
    <FaithRepositoryProvider repositories={repositories}>
      <PrayerTimesScreen />
    </FaithRepositoryProvider>,
  );
}

/** A port that fails the test the moment any position-acquiring method is reached. */
function forbiddenPort() {
  return createRecordingLocationPort({ forbid: NATIVE_POSITION_CALLS });
}

/**
 * Saves Dubai the way the Prayer Location screen does — the production path, catalogue re-validation
 * and operation claim included.
 *
 * Used by the two cases that turn on a device acquisition still being in flight, because the claim
 * `saveCityLocation` makes is half of what supersedes it. Driving those through a storage helper
 * would prove the fixture rather than the app.
 */
async function saveDubaiThroughRepository(
  repositories: ReturnType<typeof repositoriesWithLocationPort>,
): Promise<void> {
  const saved = await repositories.prayerTimes.saveCityLocation({
    geonamesId: 292223,
    name: 'Dubai',
    region: 'Dubai',
    countryCode: 'AE',
    countryName: 'United Arab Emirates',
    coordinate: DUBAI_CITY,
  });
  if (saved.kind !== 'ok') {
    throw new Error(`city save failed: ${saved.kind}`);
  }
}

warmUpFirstMount(async () => {
  await seed(DEVICE);
  await renderPrayerTimes(repositoriesWithLocationPort(createRecordingLocationPort().port));
  await drain();
});

beforeEach(async () => {
  await AsyncStorage.clear();
  resetPrayerLocationSnapshotForTest();
  resetLocationOperationsForTest();
  resetActiveLocationRevisionForTest();
});

describe('a user-selected authority never reaches the platform', () => {
  it.each([
    ['a saved city', CITY],
    ['typed coordinates', COORDINATES],
  ] as const)(
    'mounts Prayer Times on %s without one native location call',
    async (_name, saved) => {
      await seed(saved);
      const fake = forbiddenPort();

      await renderPrayerTimes(repositoriesWithLocationPort(fake.port));
      await drain();

      // The screen rendered: this is a real mount, not a tree that failed before reaching the card.
      expect(screen.getByTestId('faith-prayer-location')).toBeTruthy();
      expect(fake.calls).toEqual([]);
      expect(fake.nativeCallCount()).toBe(0);
    },
  );

  it.each([
    ['a saved city', CITY],
    ['typed coordinates', COORDINATES],
  ] as const)(
    'exercises every control %s offers without one native location call',
    async (_name, saved) => {
      await seed(saved);
      const fake = forbiddenPort();

      await renderPrayerTimes(repositoriesWithLocationPort(fake.port));
      await drain();

      /*
        There is no GPS control to press, which is the point — so the exercise is everything that IS
        offered: the location card itself, and both action cards. A native call from any of them
        would fail inside the port.
      */
      await fireEvent.press(screen.getByTestId('faith-prayer-location'));
      await drain();
      await fireEvent.press(screen.getByTestId('faith-prayer-calculation-settings'));
      await drain();
      await fireEvent.press(screen.getByTestId('faith-prayer-reminders-action'));
      await drain();

      expect(fake.calls).toEqual([]);
    },
  );

  it.each([
    ['a saved city', CITY, DUBAI_CITY, 'city'],
    ['typed coordinates', COORDINATES, DUBAI_TYPED, 'coordinates'],
  ] as const)(
    'refuses a device refresh at the domain boundary for %s, and keeps the authority',
    async (_name, saved, coordinate, mode) => {
      await seed(saved);
      const fake = forbiddenPort();
      const repositories = repositoriesWithLocationPort(fake.port);

      /*
        Called directly rather than through a control, because the screen no longer offers one. The
        guarantee has to hold at the boundary as well: a future surface that reached for this method
        in the wrong mode must be refused by the repository, not only hidden by a render.
      */
      const outcome = await repositories.prayerTimes.refreshDeviceLocation();

      expect(fake.calls).toEqual([]);
      expect(outcome.kind).toBe('ok');
      if (outcome.kind !== 'ok') return;
      expect(outcome.data.mode).toBe(mode);
      expect(outcome.data.accepted).toBe(false);
      expect(outcome.data.location.coordinate).toEqual(coordinate);

      // And storage is exactly as it was: the authority survived the call.
      const stored = await readStoredLocation();
      expect(stored?.mode).toBe(mode);
      expect(stored?.coordinate).toEqual(coordinate);
    },
  );

  it.each([
    ['a saved city', CITY, 'city'],
    ['typed coordinates', COORDINATES, 'coordinates'],
  ] as const)('keeps %s across a reload of the whole screen', async (_name, saved, mode) => {
    await seed(saved);
    const fake = forbiddenPort();

    await renderPrayerTimes(repositoriesWithLocationPort(fake.port));
    await drain();
    // A second mount is what a return through the bottom navigation produces.
    await renderPrayerTimes(repositoriesWithLocationPort(fake.port));
    await drain();

    expect((await readStoredLocation())?.mode).toBe(mode);
    expect(fake.calls).toEqual([]);
  });
});

describe('the controls each authority is offered', () => {
  it.each([
    ['a saved city', CITY],
    ['typed coordinates', COORDINATES],
  ] as const)('offers no GPS refresh on %s', async (_name, saved) => {
    await seed(saved);
    await renderPrayerTimes(repositoriesWithLocationPort(forbiddenPort().port));
    await drain();

    expect(
      screen.queryByTestId('faith-prayer-location-refresh', { includeHiddenElements: true }),
    ).toBeNull();
  });

  it('offers the GPS refresh under device authority', async () => {
    await seed(DEVICE);
    const fake = createRecordingLocationPort();

    await renderPrayerTimes(repositoriesWithLocationPort(fake.port));
    await drain();

    expect(screen.getByTestId('faith-prayer-location-refresh')).toBeTruthy();
    fake.releaseAll();
    await drain();
  });

  it.each([
    ['a saved city', CITY],
    ['typed coordinates', COORDINATES],
    ['a device fix', DEVICE],
  ] as const)('keeps Change reachable on %s', async (_name, saved) => {
    await seed(saved);
    /*
      The counting port rather than the forbidding one: device authority legitimately acquires on
      mount, and this case is about the affordance rather than about who may call the platform.
    */
    const fake = createRecordingLocationPort();

    await renderPrayerTimes(repositoriesWithLocationPort(fake.port));
    await drain();

    expect(screen.getByTestId('faith-prayer-location-change')).toBeTruthy();
    // The whole card is the button, and its label names where pressing it goes.
    expect(String(screen.getByTestId('faith-prayer-location').props.accessibilityLabel)).toMatch(
      /Opens Prayer location/i,
    );

    fake.releaseAll();
    await drain();
  });
});

describe('device authority acquires, exactly once per intent', () => {
  it('asks the platform once when the refresh control is pressed', async () => {
    await seed(DEVICE);
    const fake = createRecordingLocationPort();

    await renderPrayerTimes(repositoriesWithLocationPort(fake.port));
    await drain();

    // The mount acquisition is a separate intent; settle it and start counting from zero.
    fake.releaseAll('timed-out');
    await drain();
    fake.reset();

    await fireEvent.press(screen.getByTestId('faith-prayer-location-refresh'));
    await drain();

    expect(fake.count('getCurrentPosition')).toBe(1);

    fake.releaseAll('timed-out');
    await drain();
  });

  it('starts no second acquisition while one is in flight', async () => {
    await seed(DEVICE);
    const fake = createRecordingLocationPort();

    await renderPrayerTimes(repositoriesWithLocationPort(fake.port));
    await drain();
    fake.releaseAll('timed-out');
    await drain();
    fake.reset();

    await fireEvent.press(screen.getByTestId('faith-prayer-location-refresh'));
    await drain();
    /*
      The second press is separated by a drain rather than fired in the same tick. A same-tick pair
      is what the hook's synchronous in-flight ref exists for and cannot be driven here — the second
      `fireEvent` opens an act while the first press's await is still resolving inside one, and
      React's queue does not survive it. This is the protection a user actually meets: a second tap
      always lands at least a frame later.
    */
    await fireEvent.press(screen.getByTestId('faith-prayer-location-refresh'));
    await drain();
    await fireEvent.press(screen.getByTestId('faith-prayer-location-refresh'));
    await drain();

    expect(fake.count('getCurrentPosition')).toBe(1);
    expect(
      screen.getByTestId('faith-prayer-location-refresh').props.accessibilityState?.disabled,
    ).toBe(true);

    fake.releaseAll('timed-out');
    await drain();
  });

  it('keeps the last valid device snapshot when an acquisition fails', async () => {
    await seed(DEVICE);
    const revisionBeforeRefresh = activeLocationRevision();
    const fake = createRecordingLocationPort();

    await renderPrayerTimes(repositoriesWithLocationPort(fake.port));
    await drain();
    fake.releaseAll('timed-out');
    await drain();

    // Nothing was written, so the fix the screen is calculating from is the one it started with.
    const stored = await readStoredLocation();
    expect(stored?.mode).toBe('device');
    expect(stored?.coordinate).toEqual(MAKKAH);
    // Measured against the seed rather than against zero: the seed is itself a location change.
    expect(activeLocationRevision()).toBe(revisionBeforeRefresh);

    // And the screen says the position is old rather than pretending it is new.
    expect(String(screen.getByTestId('faith-prayer-location-refresh-note').props.children)).toBe(
      'Could not get a new position just now. Showing the last one.',
    );
  });
});

describe('a device warning belongs to the location it was about', () => {
  it('disappears when a city is saved', async () => {
    await seed(DEVICE);
    const fake = createRecordingLocationPort();

    await renderPrayerTimes(repositoriesWithLocationPort(fake.port));
    await drain();
    fake.releaseAll('timed-out');
    await drain();
    // Precondition: the warning is genuinely on screen before the city is saved.
    expect(screen.getByTestId('faith-prayer-location-refresh-note')).toBeTruthy();

    await seed(CITY);
    await drain();

    expect(String(screen.getByTestId('faith-prayer-location-label').props.children)).toBe(
      'Dubai, United Arab Emirates',
    );
    expect(
      screen.queryByTestId('faith-prayer-location-refresh-note', { includeHiddenElements: true }),
    ).toBeNull();
    expect(
      screen.queryByTestId('faith-prayer-location-refresh', { includeHiddenElements: true }),
    ).toBeNull();
  });

  /**
   * The reported defect, reproduced and then closed.
   *
   * The acquisition begins under device authority, the user chooses Dubai while it is still running,
   * and only then does the platform give up. Before the fix that late verdict rendered as "Could not
   * get a new position just now. Showing the last one." underneath Dubai — a warning about a device
   * fix nobody had asked for, on a city that had never been in doubt.
   */
  it('cannot be restored by a device result that lands after a city save', async () => {
    await seed(DEVICE);
    const fake = createRecordingLocationPort();
    const repositories = repositoriesWithLocationPort(fake.port);

    await renderPrayerTimes(repositories);
    await drain();
    // The acquisition is genuinely in flight: it has asked, and it has not been answered.
    expect(fake.count('getCurrentPosition')).toBe(1);
    expect(fake.pendingPositions).toHaveLength(1);

    await saveDubaiThroughRepository(repositories);
    await drain();

    // Only now does the device give up — long after the user has said where they are.
    fake.releaseAll('timed-out');
    await drain();

    expect(String(screen.getByTestId('faith-prayer-location-label').props.children)).toBe(
      'Dubai, United Arab Emirates',
    );
    expect(
      screen.queryByTestId('faith-prayer-location-refresh-note', { includeHiddenElements: true }),
    ).toBeNull();
    // The saved city is still the active location, and still a city.
    const stored = await readStoredLocation();
    expect(stored?.mode).toBe('city');
    expect(stored?.coordinate).toEqual(DUBAI_CITY);
  });

  /**
   * The same guarantee against a *successful* late fix, which is the worse case.
   *
   * A timeout that leaks produces a false sentence. A success that leaks would produce a false
   * location: the repository's operation model refuses the write, and this asserts the screen agrees
   * with storage about who won.
   */
  it('cannot let a successful late fix relabel a saved city', async () => {
    await seed(DEVICE);
    const fake = createRecordingLocationPort({ label: 'Mountain View, United States' });
    const repositories = repositoriesWithLocationPort(fake.port);

    await renderPrayerTimes(repositories);
    await drain();
    expect(fake.pendingPositions).toHaveLength(1);

    await saveDubaiThroughRepository(repositories);
    await drain();

    fake.pendingPositions[0]?.succeed({ coordinate: MOUNTAIN_VIEW, accuracyMetres: 10 });
    await drain();

    expect((await readStoredLocation())?.coordinate).toEqual(DUBAI_CITY);
    expect(String(screen.getByTestId('faith-prayer-location-label').props.children)).toBe(
      'Dubai, United Arab Emirates',
    );
    expect(
      screen.queryByTestId('faith-prayer-location-refresh-note', { includeHiddenElements: true }),
    ).toBeNull();
  });
});

describe('reloading identical city calculations changes nothing downstream', () => {
  it('publishes no location revision', async () => {
    await seed(CITY);
    resetActiveLocationRevisionForTest();
    const fake = forbiddenPort();

    await renderPrayerTimes(repositoriesWithLocationPort(fake.port));
    await drain();
    // A second entry, which is what returning through the bottom navigation produces.
    await renderPrayerTimes(repositoriesWithLocationPort(fake.port));
    await drain();

    /*
      Zero, not "unchanged since some baseline". Every reconciliation in the module is triggered by a
      revision change, so a revision that never moves is the mechanism by which nothing downstream is
      rebuilt — and the record is byte-identical, which is why the mutation boundary had nothing to
      publish in the first place.
    */
    expect(activeLocationRevision()).toBe(0);
  });

  it('leaves the stored record untouched, so nothing is rescheduled', async () => {
    await seed(CITY);
    const before = await readStoredLocation();
    resetActiveLocationRevisionForTest();

    const notifications = createFakeNotificationPort({ permission: 'granted' });
    const fake = forbiddenPort();
    const repositories = { ...repositoriesWithLocationPort(fake.port), notifications };

    await renderPrayerTimes(repositories);
    await drain();
    await renderPrayerTimes(repositories);
    await drain();

    expect(await readStoredLocation()).toEqual(before);
    expect(activeLocationRevision()).toBe(0);
    /*
      Nothing was scheduled or cancelled. Reconciliation is driven by the revision, and the revision
      did not move — so this is the observable end of the same guarantee, asserted at the platform
      rather than at the counter that decides it.
    */
    expect(
      notifications
        .calls()
        .filter((call) => call.startsWith('schedule') || call.startsWith('cancel')),
    ).toEqual([]);
  });
});
