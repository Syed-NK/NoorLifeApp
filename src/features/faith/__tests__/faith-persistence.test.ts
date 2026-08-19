import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  createLocalTasbihRepository,
  createMockWorshipRepository,
  DEFAULT_COUNTER,
  todayIso,
} from '../data/mock';
import { readBookmarks, toggleBookmark } from '../storage/faith-bookmarks';
import { clearFaithStorage } from '../storage/faith-storage';
import {
  defaultFaithPreferences,
  readFaithPreferences,
  writeFaithPreferences,
} from '../storage/faith-preferences';
import { faithAddress } from '@/test-support/faith-storage-address';

/**
 * The local features that must genuinely persist.
 *
 * These run against the real AsyncStorage mock rather than a stub, so they exercise the
 * serialise/parse/validate path the device takes. A test that stubbed storage would pass
 * against a counter that never wrote anything.
 */

beforeEach(async () => {
  await AsyncStorage.clear();
  await clearFaithStorage();
});

describe('tasbih counter', () => {
  it('starts at zero on the first preset', async () => {
    const repository = createLocalTasbihRepository();
    const started = await repository.startSession(DEFAULT_COUNTER.id);

    expect(started.kind).toBe('ok');
    if (started.kind === 'ok') {
      expect(started.data.count).toBe(0);
      expect(started.data.rounds).toBe(0);
      expect(started.data.target).toBe(DEFAULT_COUNTER.target);
    }
  });

  it('increments and persists across a fresh repository instance', async () => {
    const first = createLocalTasbihRepository();
    await first.startSession('subhanallah');
    await first.increment();
    await first.increment();
    await first.increment();

    // A new instance reads from storage, which is what a relaunch does.
    const second = createLocalTasbihRepository();
    const session = await second.getSession();

    expect(session.kind).toBe('ok');
    if (session.kind === 'ok') {
      expect(session.data.count).toBe(3);
    }
  });

  it('banks a round and rolls the count back at the target', async () => {
    const repository = createLocalTasbihRepository();
    const started = await repository.startSession('subhanallah');
    const target = started.kind === 'ok' ? started.data.target : 33;

    let last = started;
    for (let index = 0; index < target; index += 1) {
      last = await repository.increment();
    }

    expect(last.kind).toBe('ok');
    if (last.kind === 'ok') {
      expect(last.data.count).toBe(0);
      expect(last.data.rounds).toBe(1);
    }
  });

  it('never goes below zero on decrement', async () => {
    const repository = createLocalTasbihRepository();
    await repository.startSession('subhanallah');
    const result = await repository.decrement();

    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.data.count).toBe(0);
    }
  });

  it('resets to zero and archives the count to history', async () => {
    const repository = createLocalTasbihRepository();
    await repository.startSession('subhanallah');
    await repository.increment();
    await repository.increment();

    const reset = await repository.reset();
    expect(reset.kind).toBe('ok');
    if (reset.kind === 'ok') {
      expect(reset.data.count).toBe(0);
    }

    const history = await repository.getHistory();
    expect(history.kind).toBe('ok');
    if (history.kind === 'ok') {
      expect(history.data[0]?.count).toBe(2);
    }
  });

  /*
    ── This assertion used to say the opposite, and the opposite was wrong ────
    It read "archives the previous count when switching counter", and it passed, because switching
    ended the count you were on: it was archived to history and the counter went back to zero.

    That was survivable while every counter was a private label. It stopped being survivable when a
    counter became a saved Quran selection — tapping a different selection to read it would have
    discarded the count on the first. So switching now suspends and resumes, nothing is archived by
    a switch, and `reset` is the only operation that ends a count. See
    `tasbih-selection-isolation.test.ts` for the full behaviour.
  */
  it('suspends the previous count when switching counter, and archives nothing', async () => {
    const repository = createLocalTasbihRepository();
    // Synthetic ids: no test may keep an unverified religious label alive as a fixture.
    const a = await repository.createLabel('Counter A');
    const b = await repository.createLabel('Counter B');
    expect(a.kind).toBe('ok');
    expect(b.kind).toBe('ok');
    if (a.kind !== 'ok' || b.kind !== 'ok') return;

    await repository.startSession(a.data.id);
    await repository.increment();
    await repository.startSession(b.data.id);

    // Nothing was completed, so nothing belongs in history.
    expect((await repository.getHistory()).kind).toBe('empty');

    // And A is exactly where it was left.
    await repository.startSession(a.data.id);
    const resumed = await repository.getSession();
    expect(resumed.kind).toBe('ok');
    if (resumed.kind === 'ok') {
      expect(resumed.data.counterId).toBe(a.data.id);
      expect(resumed.data.count).toBe(1);
    }
  });
});

describe('worship checklist', () => {
  it('persists a mark across instances', async () => {
    const date = todayIso();
    const first = createMockWorshipRepository();
    await first.setEntryStatus(date, 'asr', 'completed');

    const second = createMockWorshipRepository();
    const day = await second.getDay(date);

    expect(day.kind).toBe('ok');
    if (day.kind === 'ok') {
      const asr = day.data.entries.find((entry) => entry.key === 'asr');
      expect(asr?.status).toBe('completed');
      expect(asr?.completedAt).not.toBeNull();
    }
  });

  it('returns the whole updated day so the count cannot drift from the rows', async () => {
    const date = todayIso();
    const repository = createMockWorshipRepository();
    const updated = await repository.setEntryStatus(date, 'fajr', 'completed');

    expect(updated.kind).toBe('ok');
    if (updated.kind === 'ok') {
      const completedRows = updated.data.entries.filter(
        (entry) => entry.status === 'completed',
      ).length;
      expect(updated.data.completed).toBe(completedRows);
    }
  });

  it('clears completedAt when a mark is undone', async () => {
    const date = todayIso();
    const repository = createMockWorshipRepository();
    await repository.setEntryStatus(date, 'fajr', 'completed');
    const undone = await repository.setEntryStatus(date, 'fajr', 'upcoming');

    expect(undone.kind).toBe('ok');
    if (undone.kind === 'ok') {
      const fajr = undone.data.entries.find((entry) => entry.key === 'fajr');
      expect(fajr?.completedAt).toBeNull();
    }
  });

  it('adds and removes a custom entry', async () => {
    const date = todayIso();
    const repository = createMockWorshipRepository();

    const added = await repository.addCustomEntry(date, 'Extra Nafl');
    expect(added.kind).toBe('ok');
    if (added.kind === 'ok') {
      expect(added.data.entries.some((entry) => entry.label === 'Extra Nafl')).toBe(true);
    }

    const removed = await repository.removeCustomEntry(date, 'custom:Extra Nafl');
    expect(removed.kind).toBe('ok');
    if (removed.kind === 'ok') {
      expect(removed.data.entries.some((entry) => entry.label === 'Extra Nafl')).toBe(false);
    }
  });

  it('rejects an empty custom label rather than creating a blank row', async () => {
    const repository = createMockWorshipRepository();
    const result = await repository.addCustomEntry(todayIso(), '   ');
    expect(result.kind).toBe('error');
  });
});

describe('bookmarks', () => {
  const entry = {
    kind: 'ayah' as const,
    id: '94:6',
    label: 'Surah Ash-Sharh 94:6',
    subtitle: 'Indeed, with hardship comes ease.',
  };

  it('toggles on, then off', async () => {
    const on = await toggleBookmark(entry, '2026-07-31T00:00:00.000Z');
    expect(on.bookmarked).toBe(true);
    expect(on.all).toHaveLength(1);

    const off = await toggleBookmark(entry, '2026-07-31T00:01:00.000Z');
    expect(off.bookmarked).toBe(false);
    expect(off.all).toHaveLength(0);
  });

  it('persists across a fresh read', async () => {
    await toggleBookmark(entry, '2026-07-31T00:00:00.000Z');
    const all = await readBookmarks();
    expect(all).toHaveLength(1);
    expect(all[0]?.id).toBe('94:6');
  });

  it('keeps kinds separate so the same id in two kinds does not collide', async () => {
    await toggleBookmark(entry, '2026-07-31T00:00:00.000Z');
    await toggleBookmark(
      { kind: 'dua', id: '94:6', label: 'A dua', subtitle: '' },
      '2026-07-31T00:00:01.000Z',
    );
    const all = await readBookmarks();
    expect(all).toHaveLength(2);
  });
});

describe('preferences', () => {
  it('returns the documented defaults when nothing is stored', async () => {
    const prefs = await readFaithPreferences();
    expect(prefs).toEqual(defaultFaithPreferences);
  });

  it('defaults every prayer notification to off', async () => {
    const prefs = await readFaithPreferences();
    expect(prefs.prayerNotifications).toHaveLength(5);
    expect(prefs.prayerNotifications.every((entry) => !entry.enabled)).toBe(true);
  });

  it('persists a partial update without dropping the other fields', async () => {
    await writeFaithPreferences({
      translation: {
        id: '20',
        language: 'english',
        name: 'Saheeh International',
        translator: 'Saheeh International',
      },
      translationChosenByUser: true,
    });
    const prefs = await readFaithPreferences();

    expect(prefs.translation?.id).toBe('20');
    expect(prefs.reciterId).toBe(defaultFaithPreferences.reciterId);
    expect(prefs.calculationMethod).toBe(defaultFaithPreferences.calculationMethod);
  });

  it('corrects a fixture-era reciter id, once, without touching a real choice', async () => {
    /**
     * Preferences persist. A device that ran the fixture-only build has `mock.ar.reciter` in
     * storage, and that string is not a recitation the approved Quran Foundation source has ever
     * heard of — sending it would earn a `404`, so playback would fail for a user who chose nothing
     * wrong.
     */
    await writeFaithPreferences({ reciterId: 'mock.ar.reciter' });
    expect((await readFaithPreferences()).reciterId).toBe(defaultFaithPreferences.reciterId);

    // And a reciter the user actually picked is left exactly as they picked it.
    await writeFaithPreferences({ reciterId: '7' });
    expect((await readFaithPreferences()).reciterId).toBe('7');
  });

  it('merges a stored blob over the defaults so a newly added field is never undefined', async () => {
    // Simulates a value written by an older build that predates a field.
    await AsyncStorage.setItem(
      faithAddress('preferences'),
      JSON.stringify({
        translationId: 'mock.en.plain',
        reciterId: 'mock.ar.reciter',
        calculationMethod: 'isna',
        asrMethod: 'standard',
        prayerNotifications: [],
        showTransliteration: false,
      }),
    );

    const prefs = await readFaithPreferences();
    expect(prefs.locationLabel).toBeDefined();
    expect(prefs.calculationMethod).toBe('isna');
  });

  it('falls back to the defaults on a corrupt blob rather than throwing', async () => {
    await AsyncStorage.setItem(faithAddress('preferences'), '{not json');
    const prefs = await readFaithPreferences();
    expect(prefs).toEqual(defaultFaithPreferences);
  });
});
