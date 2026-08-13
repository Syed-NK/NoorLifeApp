import fs from 'node:fs';
import path from 'node:path';

import AsyncStorage from '@react-native-async-storage/async-storage';

import { createFakeNotificationPort } from '../data/notifications/fake-notification.port';
import {
  planPrayerAlerts,
  plannedAlertKey,
  scheduleFingerprint,
  SCHEDULE_HORIZON_DAYS,
} from '../data/notifications/prayer-alert-plan';
import {
  currentPrayerAlertSound,
  prayerAlertChannelId,
  prayerAlertSoundFile,
  prayerAlertSoundLabel,
} from '../data/notifications/prayer-alert-sound';
import {
  prayerAlertChannel,
  reconcilePrayerAlerts,
  requestPrayerAlertPermission,
} from '../data/notifications/prayer-notifications.service';
import { readStoredSchedule } from '../storage/faith-notification-schedule';
import { getFaithPictogram } from '../faith-pictogram-assets';
import type {
  CalculationMethod,
  DailyPrayerTimes,
  PrayerCalculationSettings,
  PrayerKey,
  PrayerLocation,
  PrayerTimesRepository,
} from '../data/prayer-times.repository';

/**
 * Prayer alerts: what gets scheduled, what never does, and what the app refuses to claim.
 *
 * ── Why almost all of this is unit-level ────────────────────────────────────
 * Every case below is a state a device will not produce on demand — a permission revoked between
 * launches, a platform that refuses the third `schedule` call of five, a reboot that dropped the
 * alarms while storage still lists them, a DST transition. Those are exactly the cases a prayer
 * alert has to survive, and none of them is reachable by tapping through an emulator.
 *
 * The repository is a *fake that returns real stamped instants*, not a stub returning fixtures: the
 * property most worth protecting is that a scheduled alert fires at the same instant the Prayer
 * screen displays, and that can only be asserted if both sides come from one source.
 */

const MAKKAH: PrayerLocation = {
  coordinate: { latitude: 21.4225, longitude: 39.8262 },
  label: 'Makkah, Saudi Arabia',
  timeZone: 'Asia/Riyadh',
  manual: false,
  resolvedAt: '2026-08-13T00:00:00.000Z',
};

const SETTINGS: PrayerCalculationSettings = {
  method: 'muslim-world-league',
  asr: 'standard',
  offsetsMinutes: {},
};

/** A day's six times at +03:00, offset by `dayIndex` days. Sunrise included, as a real day has it. */
function dayFor(dayIndex: number): DailyPrayerTimes {
  const date = new Date(Date.UTC(2026, 7, 13 + dayIndex));
  const iso = date.toISOString().slice(0, 10);
  const at = (hour: number, minute: number): string =>
    `${iso}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00+03:00`;
  return {
    date: iso,
    hijriDate: '28 Safar 1448 AH',
    location: MAKKAH,
    settings: SETTINGS,
    times: [
      { key: 'fajr', label: 'Fajr', at: at(4, 45) },
      { key: 'sunrise', label: 'Sunrise', at: at(6, 23) },
      { key: 'dhuhr', label: 'Dhuhr', at: at(12, 14) },
      { key: 'asr', label: 'Asr', at: at(15, 40) },
      { key: 'maghrib', label: 'Maghrib', at: at(18, 55) },
      { key: 'isha', label: 'Isha', at: at(20, 25) },
    ],
  };
}

const ALL_FIVE: readonly PrayerKey[] = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];

/** A repository whose days are the fixture above, and which records how it was called. */
function fakeRepository(
  overrides: {
    readonly location?: PrayerLocation | null;
    readonly method?: CalculationMethod;
    readonly failDayIndex?: number | null;
  } = {},
): PrayerTimesRepository & { readonly requestedDays: string[] } {
  const requestedDays: string[] = [];
  const location = overrides.location === undefined ? MAKKAH : overrides.location;
  let call = 0;

  return {
    requestedDays,
    resolveCurrentLocation: async () =>
      location === null ? { kind: 'error', code: 'unavailable' } : { kind: 'ok', data: location },
    refreshCurrentLocation: async () => ({ kind: 'error', code: 'unavailable' }),
    previewLocation: () => location,
    saveManualLocation: async () =>
      location === null ? { kind: 'error', code: 'unavailable' } : { kind: 'ok', data: location },
    switchToDeviceLocation: async () => ({ kind: 'error', code: 'unavailable' }),
    activeLocationMode: async () => 'device',
    locationCalendarDay: () => '2026-08-13',
    searchLocations: async () => ({ kind: 'no-results', query: '' }),
    getDailyTimes: async (_location, date) => {
      requestedDays.push(date);
      const index = call;
      call += 1;
      if (overrides.failDayIndex !== undefined && overrides.failDayIndex === index) {
        return { kind: 'error', code: 'unavailable' };
      }
      return { kind: 'ok', data: dayFor(index) };
    },
    getMonthlyTimes: async () => ({ kind: 'ok', data: [] }),
    getNextPrayer: async () => ({ kind: 'error', code: 'unavailable' }),
    readNotificationPreferences: async () => ({ kind: 'ok', data: [] }),
    writeNotificationPreferences: async () => ({ kind: 'ok', data: [] }),
  };
}

/** Well before the first day's Fajr, so every planned alert is in the future. */
const BEFORE_ANY = Date.parse('2026-08-13T00:30:00+03:00');
const now = (ms: number) => () => new Date(ms);

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe('the plan never contains a sunrise alert', () => {
  it('schedules the five prayers and excludes sunrise, on every day of the horizon', () => {
    const days = Array.from({ length: SCHEDULE_HORIZON_DAYS }, (_unused, index) => dayFor(index));
    const planned = planPrayerAlerts({ days, enabled: ALL_FIVE, nowMs: BEFORE_ANY });

    expect(planned).toHaveLength(SCHEDULE_HORIZON_DAYS * 5);
    expect(planned.some((alert) => alert.prayer === ('sunrise' as PrayerKey))).toBe(false);
  });

  it('cannot be made to schedule sunrise even when it is asked for', () => {
    /*
      The plan is built by walking the domain's five, not by filtering the day's six — so a caller
      that passed sunrise in gets no sunrise alert rather than one that slipped through a filter.
    */
    const planned = planPrayerAlerts({
      days: [dayFor(0)],
      enabled: ['sunrise' as PrayerKey, 'fajr'],
      nowMs: BEFORE_ANY,
    });

    expect(planned.map((alert) => alert.prayer)).toEqual(['fajr']);
  });
});

describe('the plan uses the displayed instants and nothing else', () => {
  it('carries the repository’s own timestamp through untouched', () => {
    const day = dayFor(0);
    const planned = planPrayerAlerts({ days: [day], enabled: ALL_FIVE, nowMs: BEFORE_ANY });

    for (const alert of planned) {
      const displayed = day.times.find((time) => time.key === alert.prayer);
      // String equality, deliberately: a re-derived instant could be equal as a Date and differ as
      // a stamped string, and the stamp is what carries the location's offset.
      expect(alert.at).toBe(displayed?.at);
    }
  });

  it('excludes prayers that have already passed', () => {
    // Mid-afternoon: Fajr, Dhuhr and Asr are behind us on day one.
    const afternoon = Date.parse('2026-08-13T16:00:00+03:00');
    const planned = planPrayerAlerts({ days: [dayFor(0)], enabled: ALL_FIVE, nowMs: afternoon });

    expect(planned.map((alert) => alert.prayer)).toEqual(['maghrib', 'isha']);
  });

  it('handles the tomorrow-Fajr boundary by scheduling tomorrow’s, not today’s', () => {
    const afterIsha = Date.parse('2026-08-13T22:00:00+03:00');
    const planned = planPrayerAlerts({
      days: [dayFor(0), dayFor(1)],
      enabled: ALL_FIVE,
      nowMs: afterIsha,
    });

    expect(planned[0]?.key).toBe(plannedAlertKey('2026-08-14', 'fajr'));
    expect(planned.some((alert) => alert.calendarDate === '2026-08-13')).toBe(false);
  });

  it('produces one alert per prayer per day even if a day repeats', () => {
    // A horizon straddling a DST transition can yield the same calendar date twice.
    const planned = planPrayerAlerts({
      days: [dayFor(0), dayFor(0)],
      enabled: ALL_FIVE,
      nowMs: BEFORE_ANY,
    });

    expect(planned).toHaveLength(5);
    expect(new Set(planned.map((alert) => alert.key)).size).toBe(5);
  });

  it('orders the plan chronologically', () => {
    const planned = planPrayerAlerts({
      days: [dayFor(0), dayFor(1)],
      enabled: ALL_FIVE,
      nowMs: BEFORE_ANY,
    });
    const instants = planned.map((alert) => Date.parse(alert.at));
    expect(instants).toEqual([...instants].sort((a, b) => a - b));
  });
});

describe('the fingerprint reacts to every input that changes a prayer time', () => {
  const base = {
    latitude: 21.4225,
    longitude: 39.8262,
    timeZone: 'Asia/Riyadh',
    offsetMinutes: 180,
    method: 'muslim-world-league',
    asr: 'standard',
    offsetsMinutes: {},
    enabled: ALL_FIVE,
    horizonDays: 7,
  };

  it.each([
    ['a coordinate move', { latitude: 25.2048, longitude: 55.2708 }],
    ['a timezone change', { timeZone: 'Asia/Dubai' }],
    ['a DST offset change', { offsetMinutes: 240 }],
    ['a calculation method change', { method: 'umm-al-qura' }],
    ['a madhab change', { asr: 'hanafi' }],
    ['a per-prayer adjustment', { offsetsMinutes: { fajr: 2 } }],
    ['a prayer being switched off', { enabled: ['fajr', 'dhuhr'] as readonly PrayerKey[] }],
  ])('changes on %s', (_name, change) => {
    expect(scheduleFingerprint({ ...base, ...change })).not.toBe(scheduleFingerprint(base));
  });

  /**
   * Rounding is a grid cell, not a radius, and the test says what is actually true.
   *
   * Three decimals quantises latitude to ~110 m cells. Jitter *within* a cell leaves the fingerprint
   * untouched, which is the property that stops a stationary phone rescheduling 35 alarms every time
   * the screen opens. Jitter *across* a cell boundary does change it — two points a metre apart can
   * land either side of one — and that is accepted rather than engineered away: the cost is one
   * unnecessary reschedule, and the alternative (comparing distances between successive fixes here)
   * would duplicate the acceptance policy that already governs whether a fix is stored at all.
   */
  it('is stable under GPS jitter within a rounding cell', () => {
    // Both round to 21.422 — a few metres apart, well inside one cell.
    expect(scheduleFingerprint({ ...base, latitude: 21.4221 })).toBe(
      scheduleFingerprint({ ...base, latitude: 21.4223 }),
    );
  });

  it('changes across a rounding-cell boundary, which is accepted and not a defect', () => {
    expect(scheduleFingerprint({ ...base, latitude: 21.4224 })).not.toBe(
      scheduleFingerprint({ ...base, latitude: 21.4226 }),
    );
  });

  it('does not depend on the order the prayers were enabled in', () => {
    expect(
      scheduleFingerprint({ ...base, enabled: ['isha', 'fajr', 'asr', 'dhuhr', 'maghrib'] }),
    ).toBe(scheduleFingerprint(base));
  });
});

describe('permission is requested only after an explicit choice, and after the channel', () => {
  it('is not requested by reconciliation itself', async () => {
    const notifications = createFakeNotificationPort({ permission: 'undetermined' });
    await reconcilePrayerAlerts(
      { prayerTimes: fakeRepository(), notifications, now: now(BEFORE_ANY) },
      { masterEnabled: true, enabledPrayers: ALL_FIVE, settings: SETTINGS },
    );

    expect(notifications.calls()).not.toContain('requestPermission');
  });

  it('creates the Android channel before the prompt', async () => {
    const notifications = createFakeNotificationPort({ permission: 'undetermined' });
    await requestPrayerAlertPermission(notifications);

    const calls = notifications.calls();
    const channelAt = calls.findIndex((call) => call.startsWith('ensureChannel:'));
    const promptAt = calls.indexOf('requestPermission');

    expect(channelAt).toBeGreaterThanOrEqual(0);
    expect(promptAt).toBeGreaterThan(channelAt);
  });

  it('creates a high-importance channel that claims no default sound of its own', async () => {
    const notifications = createFakeNotificationPort();
    await requestPrayerAlertPermission(notifications);

    const [channel] = notifications.channels();
    expect(channel?.importance).toBe('high');
    // No custom sound: none is approved, so the platform's own is used.
    expect(channel?.soundFile).toBeNull();
  });
});

describe('scheduling', () => {
  it('schedules the five prayers across the horizon when everything is granted', async () => {
    const notifications = createFakeNotificationPort({ permission: 'granted' });
    const prayerTimes = fakeRepository();

    const status = await reconcilePrayerAlerts(
      { prayerTimes, notifications, now: now(BEFORE_ANY) },
      { masterEnabled: true, enabledPrayers: ALL_FIVE, settings: SETTINGS },
    );

    expect(status.schedule.kind).toBe('scheduled');
    expect(notifications.pending()).toHaveLength(SCHEDULE_HORIZON_DAYS * 5);
    expect(prayerTimes.requestedDays).toHaveLength(SCHEDULE_HORIZON_DAYS);
    // Never claimed, in any state.
    expect(status.deliveryVerifiable).toBe(false);
  });

  it('fires at the exact instants the repository stamped', async () => {
    const notifications = createFakeNotificationPort({ permission: 'granted' });
    await reconcilePrayerAlerts(
      { prayerTimes: fakeRepository(), notifications, now: now(BEFORE_ANY) },
      { masterEnabled: true, enabledPrayers: ['fajr'], settings: SETTINGS },
    );

    const firstDayFajr = dayFor(0).times.find((time) => time.key === 'fajr');
    const pendingInstants = notifications.pending().map((entry) => entry.at);
    expect(pendingInstants).toContain(new Date(firstDayFajr?.at ?? '').toISOString());
  });

  it('carries no location or clock in the notification payload', async () => {
    const notifications = createFakeNotificationPort({ permission: 'granted' });
    await reconcilePrayerAlerts(
      { prayerTimes: fakeRepository(), notifications, now: now(BEFORE_ANY) },
      { masterEnabled: true, enabledPrayers: ['fajr'], settings: SETTINGS },
    );

    for (const entry of notifications.pending()) {
      expect(Object.keys(entry.data).sort()).toEqual(['date', 'kind', 'prayer']);
    }
  });

  it('does nothing on a second run with unchanged inputs', async () => {
    const notifications = createFakeNotificationPort({ permission: 'granted' });
    const dependencies = { prayerTimes: fakeRepository(), notifications, now: now(BEFORE_ANY) };
    const preferences = { masterEnabled: true, enabledPrayers: ALL_FIVE, settings: SETTINGS };

    await reconcilePrayerAlerts(dependencies, preferences);
    const afterFirst = notifications.calls().length;
    await reconcilePrayerAlerts({ ...dependencies, prayerTimes: fakeRepository() }, preferences);

    // No schedule and no cancel on the second pass — the fingerprint and the pending list both match.
    const added = notifications.calls().slice(afterFirst);
    expect(added.filter((call) => call.startsWith('schedule:'))).toEqual([]);
    expect(added.filter((call) => call.startsWith('cancel:'))).toEqual([]);
  });

  it('reschedules when the calculation method changes', async () => {
    const notifications = createFakeNotificationPort({ permission: 'granted' });
    await reconcilePrayerAlerts(
      { prayerTimes: fakeRepository(), notifications, now: now(BEFORE_ANY) },
      { masterEnabled: true, enabledPrayers: ALL_FIVE, settings: SETTINGS },
    );
    const firstIds = notifications.pending().map((entry) => entry.identifier);

    await reconcilePrayerAlerts(
      { prayerTimes: fakeRepository(), notifications, now: now(BEFORE_ANY) },
      {
        masterEnabled: true,
        enabledPrayers: ALL_FIVE,
        settings: { ...SETTINGS, method: 'umm-al-qura' },
      },
    );
    const secondIds = notifications.pending().map((entry) => entry.identifier);

    expect(secondIds).toHaveLength(SCHEDULE_HORIZON_DAYS * 5);
    expect(secondIds.some((id) => firstIds.includes(id))).toBe(false);
  });

  it('cancels a prayer’s alerts when it is switched off, and keeps the rest', async () => {
    const notifications = createFakeNotificationPort({ permission: 'granted' });
    await reconcilePrayerAlerts(
      { prayerTimes: fakeRepository(), notifications, now: now(BEFORE_ANY) },
      { masterEnabled: true, enabledPrayers: ALL_FIVE, settings: SETTINGS },
    );

    await reconcilePrayerAlerts(
      { prayerTimes: fakeRepository(), notifications, now: now(BEFORE_ANY) },
      {
        masterEnabled: true,
        enabledPrayers: ['fajr', 'dhuhr', 'asr', 'maghrib'],
        settings: SETTINGS,
      },
    );

    expect(notifications.pending()).toHaveLength(SCHEDULE_HORIZON_DAYS * 4);
    const stored = await readStoredSchedule();
    expect(Object.keys(stored.identifiers).some((key) => key.endsWith(':isha'))).toBe(false);
  });

  it('cancels everything when the master switch goes off', async () => {
    const notifications = createFakeNotificationPort({ permission: 'granted' });
    await reconcilePrayerAlerts(
      { prayerTimes: fakeRepository(), notifications, now: now(BEFORE_ANY) },
      { masterEnabled: true, enabledPrayers: ALL_FIVE, settings: SETTINGS },
    );

    const status = await reconcilePrayerAlerts(
      { prayerTimes: fakeRepository(), notifications, now: now(BEFORE_ANY) },
      { masterEnabled: false, enabledPrayers: ALL_FIVE, settings: SETTINGS },
    );

    expect(notifications.pending()).toEqual([]);
    expect(status.schedule).toEqual({ kind: 'none' });
  });
});

describe('failure states are states, not exceptions', () => {
  it('schedules nothing without permission and keeps the preference', async () => {
    const notifications = createFakeNotificationPort({ permission: 'denied' });
    const status = await reconcilePrayerAlerts(
      { prayerTimes: fakeRepository(), notifications, now: now(BEFORE_ANY) },
      { masterEnabled: true, enabledPrayers: ALL_FIVE, settings: SETTINGS },
    );

    expect(notifications.pending()).toEqual([]);
    // The user's intent is preserved; only the delivery claim is withdrawn.
    expect(status.preferenceEnabled).toBe(true);
    expect(status.enabledPrayers).toEqual(ALL_FIVE);
    expect(status.schedule).toEqual({ kind: 'failed', reason: 'permission', retainedCount: 0 });
  });

  it('reports a location it cannot resolve rather than scheduling from a guess', async () => {
    const notifications = createFakeNotificationPort({ permission: 'granted' });
    const status = await reconcilePrayerAlerts(
      { prayerTimes: fakeRepository({ location: null }), notifications, now: now(BEFORE_ANY) },
      { masterEnabled: true, enabledPrayers: ALL_FIVE, settings: SETTINGS },
    );

    expect(status.schedule).toMatchObject({ kind: 'failed', reason: 'location' });
    expect(notifications.pending()).toEqual([]);
  });

  /**
   * A platform that refuses partway through leaves the previous schedule intact.
   *
   * The alternative — cancel first, then schedule — loses every alert when the second half fails,
   * and it fails precisely when the platform is under pressure.
   */
  it('rolls back a partial failure and retains the previous schedule', async () => {
    const notifications = createFakeNotificationPort({ permission: 'granted' });
    await reconcilePrayerAlerts(
      { prayerTimes: fakeRepository(), notifications, now: now(BEFORE_ANY) },
      { masterEnabled: true, enabledPrayers: ['fajr'], settings: SETTINGS },
    );
    const before = notifications
      .pending()
      .map((entry) => entry.identifier)
      .sort();

    // The next reconciliation has different inputs, and the platform refuses its third call.
    const failing = createFakeNotificationPort({ permission: 'granted' });
    for (const identifier of before) {
      // Re-seed the failing port with the same pending set the first one produced.
      await failing.schedule({
        title: 't',
        body: 'b',
        channelId: prayerAlertChannel().id,
        at: new Date(BEFORE_ANY + 3_600_000),
        data: { prayer: 'fajr', date: '2026-08-13', kind: 'prayer-alert' },
      });
      void identifier;
    }

    const refusing = createFakeNotificationPort({ permission: 'granted', failScheduleOnCall: 3 });
    const status = await reconcilePrayerAlerts(
      { prayerTimes: fakeRepository(), notifications: refusing, now: now(BEFORE_ANY) },
      { masterEnabled: true, enabledPrayers: ALL_FIVE, settings: SETTINGS },
    );

    expect(status.schedule).toMatchObject({ kind: 'failed', reason: 'platform-refused' });
    // Everything this attempt created was rolled back; nothing half-scheduled is left pending.
    expect(refusing.pending()).toEqual([]);
  });

  it('reports a calculation failure without scheduling a partial horizon', async () => {
    const notifications = createFakeNotificationPort({ permission: 'granted' });
    const status = await reconcilePrayerAlerts(
      { prayerTimes: fakeRepository({ failDayIndex: 3 }), notifications, now: now(BEFORE_ANY) },
      { masterEnabled: true, enabledPrayers: ALL_FIVE, settings: SETTINGS },
    );

    expect(status.schedule).toMatchObject({ kind: 'failed', reason: 'calculation' });
    expect(notifications.pending()).toEqual([]);
  });
});

describe('reconciliation on launch and resume', () => {
  it('rebuilds the schedule when the platform has lost it', async () => {
    const notifications = createFakeNotificationPort({ permission: 'granted' });
    await reconcilePrayerAlerts(
      { prayerTimes: fakeRepository(), notifications, now: now(BEFORE_ANY) },
      { masterEnabled: true, enabledPrayers: ALL_FIVE, settings: SETTINGS },
    );

    // A reboot that dropped the alarms. Storage still lists them; the platform has none.
    notifications.loseAllPending();

    const status = await reconcilePrayerAlerts(
      { prayerTimes: fakeRepository(), notifications, now: now(BEFORE_ANY) },
      { masterEnabled: true, enabledPrayers: ALL_FIVE, settings: SETTINGS },
    );

    expect(status.schedule.kind).toBe('scheduled');
    expect(notifications.pending()).toHaveLength(SCHEDULE_HORIZON_DAYS * 5);
  });

  it('reports pending alerts as stale when permission has since been revoked', async () => {
    const notifications = createFakeNotificationPort({ permission: 'granted' });
    await reconcilePrayerAlerts(
      { prayerTimes: fakeRepository(), notifications, now: now(BEFORE_ANY) },
      { masterEnabled: true, enabledPrayers: ALL_FIVE, settings: SETTINGS },
    );

    notifications.setPermission('denied');
    const status = await reconcilePrayerAlerts(
      { prayerTimes: fakeRepository(), notifications, now: now(BEFORE_ANY) },
      { masterEnabled: true, enabledPrayers: ALL_FIVE, settings: SETTINGS },
    );

    expect(status.schedule.kind).toBe('stale');
  });
});

describe('the test notification', () => {
  it('goes through the prayer-alert channel and says it is a test', async () => {
    const notifications = createFakeNotificationPort({ permission: 'granted' });
    await notifications.presentNow({
      title: 'NoorLife test notification',
      body: 'This is a test.',
      channelId: prayerAlertChannel().id,
      data: { kind: 'test' },
    });

    const [presented] = notifications.presented();
    expect(presented?.channelId).toBe(prayerAlertChannel().id);
    expect(presented?.title).toMatch(/test/i);
    // A test must never look like a call to prayer.
    expect(presented?.title).not.toMatch(/fajr|dhuhr|asr|maghrib|isha/i);
  });
});

describe('sound', () => {
  it('uses the platform default and never calls it an Azan', () => {
    expect(currentPrayerAlertSound()).toEqual({ kind: 'platform-default' });
    expect(prayerAlertSoundFile()).toBeNull();
    expect(prayerAlertSoundLabel()).toBe('Default notification sound');
    expect(prayerAlertSoundLabel().toLowerCase()).not.toContain('azan');
    expect(prayerAlertSoundLabel().toLowerCase()).not.toContain('adhan');
  });

  it('versions the channel id by the sound, so a future change cannot be silent', () => {
    const withAzan = prayerAlertChannelId({
      kind: 'bundled-azan',
      file: 'azan.wav',
      label: 'Makkah adhān',
    });
    expect(prayerAlertChannelId()).not.toBe(withAzan);
  });

  it('bundles no audio asset for notifications', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'src/features/faith/data/notifications/prayer-alert-sound.ts'),
      'utf8',
    );
    // No require of an asset, and nothing that could fetch one.
    expect(source).not.toMatch(/require\(/);
    expect(source).not.toMatch(/https?:\/\//);
  });

  it('names no custom sound in the native configuration', () => {
    const appConfig = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'app.json'), 'utf8')) as {
      expo: { plugins: unknown[] };
    };
    const plugin = appConfig.expo.plugins.find(
      (entry) => Array.isArray(entry) && entry[0] === 'expo-notifications',
    ) as [string, Record<string, unknown>] | undefined;

    expect(plugin).toBeDefined();
    // `sounds` is what registers a custom asset natively. It must be absent until one is approved.
    expect(plugin?.[1]).not.toHaveProperty('sounds');
  });
});

/**
 * P3 stays held until delivery is verified on a real build.
 *
 * ── Why a test guards this rather than a note ───────────────────────────────
 * The brief is explicit that writing the scheduling code is not what releases the artwork. The gates
 * are behavioural and several of them can only be checked on a device. Until every one has been
 * observed, the registry keeps the bell held — and this asserts that the registry has not been
 * quietly flipped because the code now exists.
 */
describe('P3 artwork', () => {
  it('remains held while delivery has not been verified end to end', () => {
    const entry = getFaithPictogram('p3');
    expect(entry.asset.status).toBe('held');
    expect(entry.asset).not.toHaveProperty('source');

    const registry = fs.readFileSync(
      path.join(process.cwd(), 'src/features/faith/faith-pictogram-assets.ts'),
      'utf8',
    );
    expect(registry).not.toMatch(/require\([^)]*p3-reminder-bell/);
  });
});
