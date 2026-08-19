import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  createLocalTasbihRepository,
  DEFAULT_COUNTER,
  TASBIH_SCHEMA_VERSION,
  TASBIH_STORE_VERSION,
} from '../data/tasbih/local-tasbih.repository';
import { clearFaithStorage } from '../storage/faith-storage';
import { setActiveFaithScope } from '../storage/faith-user-scope';
import { faithAddress, TEST_FAITH_USER_ID } from '@/test-support/faith-storage-address';

/**
 * **Every counter keeps its own count, and switching between them ends none of them.**
 *
 * ── The behaviour this replaced, and why it had to change ──────────────────
 * There was one session. Switching counters archived it and started the new counter at zero, so
 * looking at a different counter *ended* the one you were on. That was survivable while every
 * counter was a private label somebody had written for themselves, and it stops being survivable the
 * moment a counter is a saved Quran selection: choosing one selection to read it would silently
 * discard the count on another.
 *
 * So counting state is per counter, switching is suspend-and-resume, and `reset` is the only
 * operation that ends a count — one count, the active one.
 *
 * ── What did not change ────────────────────────────────────────────────────
 * The count is still the user's. A migrating upgrade keeps it, a reset archives it to history rather
 * than deleting it, and a label being removed does not reach into anybody else's numbers.
 */

const SELECTION_A = 'q.2.255.255';
const SELECTION_B = 'q.112.1.4';

/** A v1 record exactly as an old build wrote one: no `version`, identified by `presetId`. */
const legacyRecord = {
  presetId: 'user-m9x2',
  count: 87,
  rounds: 4,
  target: 100,
  startedAt: '2026-08-01T10:00:00.000Z',
  updatedAt: '2026-08-01T10:05:00.000Z',
};

beforeEach(async () => {
  await AsyncStorage.clear();
  await clearFaithStorage();
  setActiveFaithScope(TEST_FAITH_USER_ID);
});

describe('one counter at a time, all of them remembered', () => {
  it('resumes a counter where it was left rather than restarting it', async () => {
    const repository = createLocalTasbihRepository();

    await repository.startSession(SELECTION_A, { target: 33 });
    await repository.increment();
    await repository.increment();
    await repository.increment();

    await repository.startSession(SELECTION_B, { target: 10 });
    const onB = await repository.getSession();
    expect(onB.kind).toBe('ok');
    if (onB.kind !== 'ok') return;
    expect(onB.data.counterId).toBe(SELECTION_B);
    expect(onB.data.count).toBe(0);

    // …and A is exactly where it was.
    await repository.startSession(SELECTION_A);
    const backOnA = await repository.getSession();
    if (backOnA.kind !== 'ok') return;
    expect(backOnA.data.counterId).toBe(SELECTION_A);
    expect(backOnA.data.count).toBe(3);
  });

  it('does not archive anything when the selection changes', async () => {
    const repository = createLocalTasbihRepository();
    await repository.startSession(SELECTION_A, { target: 33 });
    await repository.increment();
    await repository.startSession(SELECTION_B, { target: 33 });

    /*
      Nothing was completed, so nothing belongs in history. A switch that wrote one would report a
      finished session the user never finished — and would do it every time they looked at another
      selection.
    */
    expect((await repository.getHistory()).kind).toBe('empty');
  });

  it('counts on one selection without touching another', async () => {
    const repository = createLocalTasbihRepository();
    await repository.startSession(SELECTION_A, { target: 33 });
    await repository.increment();
    await repository.increment();

    await repository.startSession(SELECTION_B, { target: 33 });
    for (let index = 0; index < 5; index += 1) {
      await repository.increment();
    }

    await repository.startSession(SELECTION_A);
    const a = await repository.getSession();
    if (a.kind !== 'ok') return;
    expect(a.data.count).toBe(2);

    await repository.startSession(SELECTION_B);
    const b = await repository.getSession();
    if (b.kind !== 'ok') return;
    expect(b.data.count).toBe(5);
  });

  it('keeps every counter’s state across a relaunch', async () => {
    const first = createLocalTasbihRepository();
    await first.startSession(SELECTION_A, { target: 33 });
    await first.increment();
    await first.increment();
    await first.startSession(DEFAULT_COUNTER.id);
    await first.increment();

    // A second instance is what a force-stop and relaunch produces.
    const second = createLocalTasbihRepository();
    const active = await second.getSession();
    if (active.kind !== 'ok') return;
    expect(active.data.counterId).toBe(DEFAULT_COUNTER.id);
    expect(active.data.count).toBe(1);

    await second.startSession(SELECTION_A);
    const resumed = await second.getSession();
    if (resumed.kind !== 'ok') return;
    expect(resumed.data.count).toBe(2);
  });

  it('keeps each counter’s own target, and re-selecting does not overwrite it', async () => {
    const repository = createLocalTasbihRepository();
    await repository.startSession(SELECTION_A, { target: 33 });
    await repository.adjustTarget(67);
    expect((await repository.getSession()).kind).toBe('ok');

    await repository.startSession(SELECTION_B, { target: 7 });
    const b = await repository.getSession();
    if (b.kind !== 'ok') return;
    expect(b.data.target).toBe(7);

    /*
      Re-selecting A supplies a starting target again. It must be ignored: the target is the user's
      stated intention and a caller re-sending a default would quietly undo it.
    */
    await repository.startSession(SELECTION_A, { target: 33 });
    const a = await repository.getSession();
    if (a.kind !== 'ok') return;
    expect(a.data.target).toBe(100);
    expect(a.data.counterId).toBe(SELECTION_A);
  });

  it('clamps a starting target from the caller rather than trusting it', async () => {
    const repository = createLocalTasbihRepository();
    await repository.startSession(SELECTION_A, { target: 100_000 });
    const session = await repository.getSession();
    if (session.kind !== 'ok') return;
    expect(session.data.target).toBe(1000);
  });
});

describe('ending a count, and only the right one', () => {
  it('resets the active counter, archives it, and leaves the others alone', async () => {
    const repository = createLocalTasbihRepository();
    await repository.startSession(SELECTION_A, { target: 33 });
    await repository.increment();
    await repository.increment();

    await repository.startSession(SELECTION_B, { target: 33 });
    await repository.increment();
    await repository.reset();

    const b = await repository.getSession();
    if (b.kind !== 'ok') return;
    expect(b.data.count).toBe(0);

    const history = await repository.getHistory();
    if (history.kind !== 'ok') return;
    expect(history.data[0]?.counterId).toBe(SELECTION_B);
    expect(history.data[0]?.count).toBe(1);

    await repository.startSession(SELECTION_A);
    const a = await repository.getSession();
    if (a.kind !== 'ok') return;
    expect(a.data.count).toBe(2);
  });

  it('keeps the target through a reset, because the intention was not what was reset', async () => {
    const repository = createLocalTasbihRepository();
    await repository.startSession(SELECTION_A, { target: 33 });
    await repository.adjustTarget(67);
    await repository.increment();
    const reset = await repository.reset();
    if (reset.kind !== 'ok') return;
    expect(reset.data.count).toBe(0);
    expect(reset.data.target).toBe(100);
  });

  it('forgets one counter’s state and disturbs no other', async () => {
    const repository = createLocalTasbihRepository();
    await repository.startSession(SELECTION_A, { target: 33 });
    await repository.increment();
    await repository.increment();
    await repository.increment();

    await repository.startSession(SELECTION_B, { target: 33 });
    await repository.increment();

    await repository.forgetCounter(SELECTION_B);

    // The active counter falls back to the neutral default rather than to somebody else's count.
    const active = await repository.getSession();
    if (active.kind !== 'ok') return;
    expect(active.data.counterId).toBe(DEFAULT_COUNTER.id);
    expect(active.data.count).toBe(0);

    await repository.startSession(SELECTION_A);
    const a = await repository.getSession();
    if (a.kind !== 'ok') return;
    expect(a.data.count).toBe(3);
  });

  it('forgetting a counter that has no state is a no-op, not a reset', async () => {
    const repository = createLocalTasbihRepository();
    await repository.startSession(SELECTION_A, { target: 33 });
    await repository.increment();

    await repository.forgetCounter('q.36.1.1');

    const session = await repository.getSession();
    if (session.kind !== 'ok') return;
    expect(session.data.counterId).toBe(SELECTION_A);
    expect(session.data.count).toBe(1);
  });
});

describe('the upgrade from a single-session build', () => {
  it('carries the count over and leaves no second copy behind', async () => {
    await AsyncStorage.setItem(faithAddress('tasbihSession'), JSON.stringify(legacyRecord));

    const repository = createLocalTasbihRepository();
    const session = await repository.getSession();
    expect(session.kind).toBe('ok');
    if (session.kind !== 'ok') return;
    expect(session.data.counterId).toBe('user-m9x2');
    expect(session.data.count).toBe(87);
    expect(session.data.rounds).toBe(4);
    expect(session.data.target).toBe(100);

    /*
      The old key is removed once the new store is on disk. Leaving it would leave a second copy of a
      count that is never updated again — and a stale count is the one kind of wrong number this
      feature must not produce.
    */
    expect(await AsyncStorage.getItem(faithAddress('tasbihSession'))).toBeNull();

    const stored = JSON.parse((await AsyncStorage.getItem(faithAddress('tasbihSessions'))) ?? '{}');
    expect(stored.version).toBe(TASBIH_STORE_VERSION);
    expect(stored.activeCounterId).toBe('user-m9x2');
  });

  it('leaves an unreadable record exactly where it is', async () => {
    await AsyncStorage.setItem(faithAddress('tasbihSession'), JSON.stringify({ junk: true }));
    const repository = createLocalTasbihRepository();

    expect((await repository.getSession()).kind).toBe('empty');
    const raw = await AsyncStorage.getItem(faithAddress('tasbihSession'));
    expect(JSON.parse(raw ?? '{}').junk).toBe(true);
    expect(await AsyncStorage.getItem(faithAddress('tasbihSessions'))).toBeNull();
  });

  it('drops a stored session whose key and counterId disagree rather than guessing', async () => {
    await AsyncStorage.setItem(
      faithAddress('tasbihSessions'),
      JSON.stringify({
        version: TASBIH_STORE_VERSION,
        activeCounterId: SELECTION_A,
        sessions: {
          [SELECTION_A]: {
            counterId: SELECTION_B,
            count: 9,
            rounds: 0,
            target: 33,
            startedAt: '',
            updatedAt: '',
          },
        },
      }),
    );
    const repository = createLocalTasbihRepository();
    expect((await repository.getSession()).kind).toBe('empty');
  });

  it('keeps the two version numbers distinct, because the two shapes change apart', () => {
    expect(TASBIH_SCHEMA_VERSION).toBe(2);
    expect(TASBIH_STORE_VERSION).toBe(3);
  });
});
