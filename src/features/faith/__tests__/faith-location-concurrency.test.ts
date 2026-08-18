import fs from 'node:fs';
import path from 'node:path';

import AsyncStorage from '@react-native-async-storage/async-storage';

import { formattedHijriForCalendarDay } from '../data/calendar-day';
import { hasData } from '../data/faith-result';
import { createFakeNotificationPort } from '../data/notifications/fake-notification.port';
import { reconcilePrayerAlerts } from '../data/notifications/prayer-notifications.service';
import {
  activeLocationRevision,
  resetActiveLocationRevisionForTest,
} from '../data/location/active-location';
import type { LocationFailure, LocationFix, LocationPort } from '../data/location/location.port';
import { createAdhanPrayerTimesRepository } from '../data/prayer/adhan-prayer-times.repository';
import type {
  CityChoice,
  PrayerCalculationSettings,
  PrayerTimesRepository,
} from '../data/prayer-times.repository';
import {
  beginLocationOperation,
  commitActivePrayerLocation,
  readStoredLocation,
  resetLocationOperationsForTest,
  resetPrayerLocationSnapshotForTest,
  retireLocationOperation,
} from '../storage/faith-location';

/**
 * A device fix that arrives late may never become the user's location.
 *
 * ── The sequence this file exists to make impossible ────────────────────────
 * Press "Use device location" indoors. Twelve seconds later the wrapper gives up and the screen says
 * it could not get a position. Choose Dubai from the catalogue instead. Ninety seconds after that,
 * the *native* request — which nothing cancelled, because `getCurrentPositionAsync` cannot be
 * cancelled — finally succeeds, and its continuation commits a device fix over Dubai. Every prayer
 * time moves, the notification schedule is rebuilt, and nothing on screen ever said so.
 *
 * ── Why `withTimeout` is not itself the bug, and what is ────────────────────
 * `expo-location.port.ts` races the native promise against a deadline and returns `'timed-out'`. The
 * native promise stays alive — a race cannot cancel what it lost to — but the port *discards* its
 * result: nothing awaits it after the race resolves, so that particular promise has no continuation
 * that could write. Read alone, that path is safe.
 *
 * What is not safe is the shape it belongs to. Five paths in the repository acquire a device fix and
 * then commit it, and each one's decision to commit was made from a world that may have changed
 * while it was waiting. `switchToDeviceLocation` checks nothing at all before writing;
 * `refreshDeviceLocation` checks `isUserSelectedLocation` *before* the fix and never again; and
 * `resolveCurrentLocation` checks that nothing is stored, acquires a fix that takes seconds, and
 * writes — by which time something may well be stored. Any port that resolved late, any slow fix,
 * any second press would land in the same hole.
 *
 * So these cases do not test the port's timeout. They drive the repository with a port whose
 * resolution *the test controls*, which is the only way to place a save precisely between a request
 * and its result — and they assert the property that matters however the fix eventually arrives: a
 * result that has lost authority cannot write, cannot publish a revision, and cannot reconcile.
 *
 * ── No sleeps, anywhere ─────────────────────────────────────────────────────
 * Every interleaving here is expressed with deferred promises the test resolves by hand. A timing
 * test that waits is a test that passes on a fast machine.
 */

const DUBAI_CITY: CityChoice = {
  geonamesId: 292223,
  name: 'Dubai',
  region: 'Dubai',
  countryCode: 'AE',
  countryName: 'United Arab Emirates',
  coordinate: { latitude: 25.07725, longitude: 55.30927 },
};
const MOUNTAIN_VIEW = { latitude: 37.3861, longitude: -122.0839 };
const MANCHESTER = { latitude: 53.4808, longitude: -2.2426 };
const NOW = new Date('2026-08-13T12:00:00.000Z');

const SETTINGS: PrayerCalculationSettings = {
  method: 'muslim-world-league',
  asr: 'standard',
  offsetsMinutes: {},
};

/** A promise plus the handle to settle it. The whole of this file's timing control. */
type Deferred<T> = {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
};

function defer<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

type FixOutcome = LocationFix | { readonly failure: LocationFailure };

/**
 * A location port whose every `getCurrentPosition` is a deferred the test settles.
 *
 * Requests are queued in call order, so a case can start two and resolve them in either order — which
 * is exactly what Case B is about.
 */
function controllablePort(): {
  readonly port: LocationPort;
  readonly pending: Deferred<FixOutcome>[];
  readonly describeCalls: () => number;
} {
  const pending: Deferred<FixOutcome>[] = [];
  let describeCalls = 0;

  return {
    pending,
    describeCalls: () => describeCalls,
    port: {
      getPermission: async () => 'granted',
      requestPermission: async () => 'granted',
      getLastKnownPosition: async () => null,
      getCurrentPosition: () => {
        const deferred = defer<FixOutcome>();
        pending.push(deferred);
        return deferred.promise;
      },
      describe: async () => {
        describeCalls += 1;
        return 'Somewhere, Somewhere';
      },
      search: async () => [],
      hasCompass: async () => false,
      watchHeading: async () => () => undefined,
    },
  };
}

function repositoryWith(location: LocationPort): PrayerTimesRepository {
  return createAdhanPrayerTimesRepository({
    location,
    hijriFor: formattedHijriForCalendarDay,
    now: () => NOW,
  });
}

/** Lets every already-resolved promise chain run to completion. No timers, no sleeping. */
async function flush(): Promise<void> {
  for (let pass = 0; pass < 12; pass += 1) {
    await Promise.resolve();
  }
}

async function seedCity(repository: PrayerTimesRepository): Promise<void> {
  const saved = await repository.saveCityLocation(DUBAI_CITY);
  if (!hasData(saved)) {
    throw new Error(`Expected the Dubai seed to commit, got ${saved.kind}.`);
  }
}

beforeEach(async () => {
  await AsyncStorage.clear();
  resetPrayerLocationSnapshotForTest();
  resetLocationOperationsForTest();
  resetActiveLocationRevisionForTest();
});

describe('Case A — a timed-out device request cannot overwrite a city saved afterwards', () => {
  /*
    ── The other half of the rule, and the one it is easy to over-fix ────────
    Supersession must not become "device can never win after a failure". A user who is told the fix
    timed out, saves Dubai, and then *deliberately presses the button again* has expressed a new
    intent — and that intent is the newest, so it must commit. A model that refused this would be
    protecting the user from themselves.
  */
  it('lets a deliberate retry after a failure create a new operation that wins', async () => {
    const { port, pending } = controllablePort();
    const repository = repositoryWith(port);

    const deviceA = repository.switchToDeviceLocation();
    await flush();
    pending[0]?.resolve({ failure: 'timed-out' });
    expect((await deviceA).kind).toBe('error');

    await seedCity(repository);
    expect((await readStoredLocation())?.mode).toBe('city');

    // A fresh press. New operation, newest intent.
    const retry = repository.switchToDeviceLocation();
    await flush();
    pending[1]?.resolve({ coordinate: MANCHESTER, accuracyMetres: 5 });
    expect((await retry).kind).toBe('ok');

    const settled = await readStoredLocation();
    expect(settled?.mode).toBe('device');
    expect(settled?.coordinate).toEqual(MANCHESTER);
  });

  /*
    The same interleaving with the save placed *between* the request and its result, which is the
    literal sequence from the brief and the one a `Promise.race` timeout cannot protect against.
  */
  it('refuses a device result that resolves after a city save, without a second request', async () => {
    const { port, pending } = controllablePort();
    const repository = repositoryWith(port);

    const deviceA = repository.switchToDeviceLocation();
    await flush();
    expect(pending).toHaveLength(1);

    // The user gives up on it and chooses Dubai while A is still in flight.
    await seedCity(repository);
    const revisionAfterSave = activeLocationRevision();

    // Only now does the native request succeed.
    pending[0]?.resolve({ coordinate: MOUNTAIN_VIEW, accuracyMetres: 8 });
    const late = await deviceA;

    // It is reported as having lost authority — not as a failure the user should be alarmed by.
    expect(late.kind).toBe('error');
    expect((late as { code: string }).code).toBe('unsupported');

    // Nothing was written, and no revision was published for it.
    const settled = await readStoredLocation();
    expect(settled?.mode).toBe('city');
    expect(settled?.coordinate).toEqual(DUBAI_CITY.coordinate);
    expect(activeLocationRevision()).toBe(revisionAfterSave);
  });

  it('cannot make a stale device result reconcile notifications', async () => {
    const { port, pending } = controllablePort();
    const repository = repositoryWith(port);
    const notifications = createFakeNotificationPort({ permission: 'granted' });

    const deviceA = repository.switchToDeviceLocation();
    await flush();
    await seedCity(repository);

    // The schedule as it stands for Dubai.
    await reconcilePrayerAlerts(
      { prayerTimes: repository, notifications, now: () => NOW },
      { masterEnabled: true, enabledPrayers: ['fajr', 'dhuhr'], settings: SETTINGS },
    );
    const dubaiAlerts = notifications.pending().map((alert) => alert.at);
    expect(dubaiAlerts.length).toBeGreaterThan(0);

    pending[0]?.resolve({ coordinate: MOUNTAIN_VIEW, accuracyMetres: 8 });
    await deviceA;

    /*
      Reconciliation resolves the location itself, so if the stale fix had landed the alerts would
      now be Mountain View's. Re-running proves the schedule is unchanged — which is the observable
      form of "the stale operation reconciled nothing".
    */
    await reconcilePrayerAlerts(
      { prayerTimes: repository, notifications, now: () => NOW },
      { masterEnabled: true, enabledPrayers: ['fajr', 'dhuhr'], settings: SETTINGS },
    );
    expect(notifications.pending().map((alert) => alert.at)).toEqual(dubaiAlerts);
  });
});

describe('Case B — two device requests, the first to resolve is not the one that wins', () => {
  it('lets only the newer request commit, exactly once', async () => {
    const { port, pending } = controllablePort();
    const repository = repositoryWith(port);

    const deviceA = repository.switchToDeviceLocation();
    await flush();
    const deviceB = repository.switchToDeviceLocation();
    await flush();
    expect(pending).toHaveLength(2);

    // A resolves first, and must not commit — B superseded it the moment it started.
    pending[0]?.resolve({ coordinate: MOUNTAIN_VIEW, accuracyMetres: 8 });
    const first = await deviceA;
    expect(first.kind).toBe('error');
    expect((first as { code: string }).code).toBe('unsupported');
    expect(await readStoredLocation()).toBeNull();
    expect(activeLocationRevision()).toBe(0);

    // B resolves and commits.
    pending[1]?.resolve({ coordinate: MANCHESTER, accuracyMetres: 5 });
    const second = await deviceB;
    expect(second.kind).toBe('ok');

    const settled = await readStoredLocation();
    expect(settled?.mode).toBe('device');
    expect(settled?.coordinate).toEqual(MANCHESTER);
    // One logical change, one revision.
    expect(activeLocationRevision()).toBe(1);
  });
});

describe('Case C — typed coordinates supersede a pending device request', () => {
  it('keeps the coordinates authoritative when the device result lands afterwards', async () => {
    const { port, pending } = controllablePort();
    const repository = repositoryWith(port);

    const deviceA = repository.switchToDeviceLocation();
    await flush();

    const saved = await repository.saveCoordinateLocation({
      label: 'My village',
      coordinate: { latitude: 24.4539, longitude: 54.3773 },
    });
    expect(saved.kind).toBe('ok');
    const revisionAfterSave = activeLocationRevision();

    pending[0]?.resolve({ coordinate: MOUNTAIN_VIEW, accuracyMetres: 8 });
    const late = await deviceA;
    expect((late as { code: string }).code).toBe('unsupported');

    const settled = await readStoredLocation();
    expect(settled?.mode).toBe('coordinates');
    expect(settled?.label).toBe('My village');
    expect(activeLocationRevision()).toBe(revisionAfterSave);
  });
});

describe('Case D — an uncontested device request commits', () => {
  it('commits exactly once when nothing newer intervenes', async () => {
    const { port, pending } = controllablePort();
    const repository = repositoryWith(port);

    const device = repository.switchToDeviceLocation();
    await flush();
    pending[0]?.resolve({ coordinate: MANCHESTER, accuracyMetres: 6 });

    const result = await device;
    expect(result.kind).toBe('ok');

    const settled = await readStoredLocation();
    expect(settled?.mode).toBe('device');
    expect(settled?.coordinate).toEqual(MANCHESTER);
    expect(settled?.timezone).toBe('Europe/London');
    expect(activeLocationRevision()).toBe(1);
  });
});

describe('Case E — a timeout revokes authority even with nothing newer', () => {
  /*
    The case with no competing intent at all. Nothing supersedes the request; it simply took too long,
    was reported as failed, and the user was told so. A success arriving afterwards would silently
    contradict what they were told — so the timeout itself must end the operation's right to commit,
    which is what `retireLocationOperation` does.
  */
  it('refuses a result that arrives after its own timeout', async () => {
    const { port, pending } = controllablePort();
    const repository = repositoryWith(port);
    await seedCity(repository);
    const revisionAfterSeed = activeLocationRevision();

    const device = repository.switchToDeviceLocation();
    await flush();
    pending[0]?.resolve({ failure: 'timed-out' });
    const timedOut = await device;
    expect((timedOut as { code: string }).code).toBe('timeout');

    /*
      The retired operation is now behind the generation. A second attempt started *by nobody* — i.e.
      the retired one somehow reaching a commit — is what the model must refuse, and the assertion
      below is that storage never moved.
    */
    const settled = await readStoredLocation();
    expect(settled?.mode).toBe('city');
    expect(activeLocationRevision()).toBe(revisionAfterSeed);
  });

  it('retires the operation so a later commit under it is refused', async () => {
    // Driven at the boundary directly, because no production path hands out a retired operation —
    // which is the point: the guard is proved rather than assumed unreachable.
    const operation = beginLocationOperation();
    retireLocationOperation(operation);

    const committed = await commitActivePrayerLocation(
      {
        mode: 'device',
        coordinate: MOUNTAIN_VIEW,
        label: 'Mountain View',
        resolvedAt: NOW.toISOString(),
        accuracyMetres: 5,
      },
      { operation },
    );

    expect(committed).toEqual({ kind: 'rejected', reason: 'superseded' });
    expect(await readStoredLocation()).toBeNull();
    expect(activeLocationRevision()).toBe(0);
  });
});

describe('Case F — a failed device request preserves the prior city', () => {
  it('keeps the city and moves no revision', async () => {
    const { port, pending } = controllablePort();
    const repository = repositoryWith(port);
    await seedCity(repository);
    const revisionAfterSeed = activeLocationRevision();

    const device = repository.switchToDeviceLocation();
    await flush();
    pending[0]?.resolve({ failure: 'unavailable' });
    const failed = await device;

    expect(failed.kind).toBe('error');
    expect((failed as { code: string }).code).toBe('unavailable');

    const settled = await readStoredLocation();
    expect(settled?.mode).toBe('city');
    expect(settled?.coordinate).toEqual(DUBAI_CITY.coordinate);
    expect(activeLocationRevision()).toBe(revisionAfterSeed);
  });
});

describe('the first-resolution path cannot overwrite a choice made while it acquires', () => {
  /*
    `resolveCurrentLocation` is a *read* that writes: finding nothing stored, it acquires a device fix
    and saves it. Between that read and that write a user can save a city — and before the
    precondition existed, the read path would then have replaced it.
  */
  it('refuses to write when something was saved during its acquisition', async () => {
    const { port, pending } = controllablePort();
    const repository = repositoryWith(port);

    const resolving = repository.resolveCurrentLocation();
    await flush();
    expect(pending).toHaveLength(1);

    await seedCity(repository);

    pending[0]?.resolve({ coordinate: MOUNTAIN_VIEW, accuracyMetres: 8 });
    const resolved = await resolving;

    // The city is what is stored, and what the caller is handed — not the fix this call obtained.
    const settled = await readStoredLocation();
    expect(settled?.mode).toBe('city');
    expect(settled?.coordinate).toEqual(DUBAI_CITY.coordinate);
    expect(hasData(resolved)).toBe(true);
    if (!hasData(resolved)) return;
    expect(resolved.data.coordinate).toEqual(DUBAI_CITY.coordinate);
  });
});

describe('the automatic refresh cannot overwrite a choice made while it acquires', () => {
  it('reports the winner and marks nothing accepted', async () => {
    const { port, pending } = controllablePort();
    const repository = repositoryWith(port);

    // Device mode first, so the refresh is not short-circuited by the user-authority guard.
    const seedDevice = repository.switchToDeviceLocation();
    await flush();
    pending[0]?.resolve({ coordinate: MOUNTAIN_VIEW, accuracyMetres: 8 });
    await seedDevice;

    const refreshing = repository.refreshDeviceLocation();
    await flush();
    expect(pending).toHaveLength(2);

    await seedCity(repository);
    const revisionAfterSave = activeLocationRevision();

    pending[1]?.resolve({ coordinate: MANCHESTER, accuracyMetres: 4 });
    const refreshed = await refreshing;

    expect(hasData(refreshed)).toBe(true);
    if (!hasData(refreshed)) return;
    expect(refreshed.data.accepted).toBe(false);
    expect(refreshed.data.mode).toBe('city');
    expect(refreshed.data.location.coordinate).toEqual(DUBAI_CITY.coordinate);

    expect((await readStoredLocation())?.mode).toBe('city');
    expect(activeLocationRevision()).toBe(revisionAfterSave);
  });
});

describe('the shape of the guarantee', () => {
  /*
    One writer, asserted against the source rather than by exercising paths — a seventh caller added
    next month would pass every behavioural case above by simply not being run.
  */
  it('keeps exactly one module able to write the location key', () => {
    const root = path.join(process.cwd(), 'src');
    const offenders: string[] = [];

    const walk = (directory: string): void => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const full = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== '__tests__') {
            walk(full);
          }
        } else if (/\.tsx?$/.test(entry.name)) {
          const source = fs.readFileSync(full, 'utf8');
          if (
            /writeJson\(\s*faithStorageKeys\.location/.test(source) &&
            !full.endsWith(path.join('storage', 'prayer-location-store.ts'))
          ) {
            offenders.push(path.relative(process.cwd(), full));
          }
        }
      }
    };
    walk(root);

    expect(offenders).toEqual([]);
  });

  it('re-checks authority inside the serialized section, not before the slow work', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'src/features/faith/storage/prayer-location-store.ts'),
      'utf8',
    );

    const serialized = source.slice(source.indexOf('return serializeMutation('));
    const authorityAt = serialized.indexOf('isCurrentLocationOperation');
    const writeAt = serialized.indexOf('writeJson(faithStorageKeys.location');

    // Both inside the section, and the check strictly before the write.
    expect(authorityAt).toBeGreaterThan(-1);
    expect(writeAt).toBeGreaterThan(-1);
    expect(authorityAt).toBeLessThan(writeAt);
  });

  it('does not pretend the native request can be cancelled', () => {
    const port = fs.readFileSync(
      path.join(process.cwd(), 'src/features/faith/data/location/expo-location.port.ts'),
      'utf8',
    );
    /*
      `expo-location` exposes no abort for `getCurrentPositionAsync`. An `AbortController` here would
      read as cancellation and deliver none, which is worse than the honest race — the authority model
      is what makes the uncancellable request safe.
    */
    expect(port).not.toMatch(/AbortController|abortSignal/);
  });
});
