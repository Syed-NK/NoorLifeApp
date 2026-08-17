import fs from 'node:fs';
import path from 'node:path';

import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  createLocalTasbihRepository,
  DEFAULT_COUNTER,
  MAX_LABEL_LENGTH,
  parseStoredSession,
  TASBIH_SCHEMA_VERSION,
} from '../data/tasbih/local-tasbih.repository';
import { MAX_TASBIH_TARGET, MIN_TASBIH_TARGET } from '../data/tasbih.repository';
import { faithAddress } from '@/test-support/faith-storage-address';

/**
 * **The counter after the built-in dhikr were removed, and the upgrade that gets a user there.**
 *
 * ── What was removed, and why the strings are not in this file ──────────────
 * Five built-in entries, each carrying Arabic, a transliteration and an English translation. An
 * audit for verified Arabic, verified translation, recorded provenance and a compatible
 * redistribution licence found **none of the four** for any of them.
 *
 * Their *identifiers* appear below, because the migration has to recognise a stored session that
 * points at one. Their **text does not**, in any form — a test fixture is exactly the place
 * unverified religious content survives a deletion, and the source scan at the end of this file
 * fails if any of it reappears in `src/`.
 *
 * ── The property that matters most in the migration ─────────────────────────
 * A user mid-count when they upgrade keeps their count. The label is NoorLife's problem and the
 * number is theirs; discarding eighty-seven repetitions because the app could not vouch for the
 * words beside them would be the upgrade deciding their dhikr did not happen.
 */

/** The ids the removed entries used. Ids only — never their text. */
const LEGACY_IDS = [
  'subhanallah',
  'alhamdulillah',
  'allahuakbar',
  'astaghfirullah',
  'la-ilaha',
] as const;

/** A v1 record exactly as the previous build wrote one: no `version`, identified by `presetId`. */
const legacyRecord = (presetId: string, count: number, target: number, rounds: number) => ({
  presetId,
  count,
  rounds,
  target,
  startedAt: '2026-08-01T10:00:00.000Z',
  updatedAt: '2026-08-01T10:05:00.000Z',
});

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe('the persisted schema', () => {
  it('stamps a version, so a future change can be told from this one', () => {
    expect(TASBIH_SCHEMA_VERSION).toBe(2);
  });

  it('treats a current record as current and rewrites nothing', () => {
    const parsed = parseStoredSession({
      version: TASBIH_SCHEMA_VERSION,
      counterId: 'user-abc',
      count: 12,
      target: 33,
      rounds: 2,
      startedAt: '2026-08-01T10:00:00.000Z',
      updatedAt: '2026-08-01T10:05:00.000Z',
    });
    expect(parsed.kind).toBe('current');
    if (parsed.kind !== 'current') return;
    expect(parsed.session.counterId).toBe('user-abc');
    expect(parsed.session.count).toBe(12);
  });

  it('reports nothing stored as absent rather than as a broken record', () => {
    expect(parseStoredSession(null).kind).toBe('absent');
    expect(parseStoredSession(undefined).kind).toBe('absent');
  });

  it.each([
    ['a string', 'not-a-session'],
    ['a number', 42],
    ['an array', []],
    ['an object with no counter at all', { count: 5 }],
  ])('refuses %s rather than inventing a counter', (_name, value) => {
    expect(parseStoredSession(value).kind).toBe('unreadable');
  });
});

describe('migrating a build that shipped built-in dhikr', () => {
  it.each(LEGACY_IDS)('converts the %s session to the neutral counter', (legacyId) => {
    const parsed = parseStoredSession(legacyRecord(legacyId, 17, 33, 3));
    expect(parsed.kind).toBe('migrated');
    if (parsed.kind !== 'migrated') return;

    // The label NoorLife could not vouch for is gone…
    expect(parsed.session.counterId).toBe(DEFAULT_COUNTER.id);
    expect(parsed.session.counterId).not.toBe(legacyId);
    // …and every number the user earned is kept.
    expect(parsed.session.count).toBe(17);
    expect(parsed.session.target).toBe(33);
    expect(parsed.session.rounds).toBe(3);
  });

  it('keeps a genuinely user-created counter id', () => {
    const parsed = parseStoredSession(legacyRecord('user-m9x2', 4, 100, 1));
    expect(parsed.kind).toBe('migrated');
    if (parsed.kind !== 'migrated') return;
    expect(parsed.session.counterId).toBe('user-m9x2');
    expect(parsed.session.count).toBe(4);
  });

  it.each([
    ['a non-finite count', { count: Number.NaN }, 'count', 0],
    ['an infinite count', { count: Number.POSITIVE_INFINITY }, 'count', 0],
    ['a negative count', { count: -5 }, 'count', 0],
    ['a target below the floor', { target: 0 }, 'target', DEFAULT_COUNTER.target],
    [
      'a target above the ceiling',
      { target: MAX_TASBIH_TARGET + 1 },
      'target',
      DEFAULT_COUNTER.target,
    ],
    ['a non-finite target', { target: Number.NaN }, 'target', DEFAULT_COUNTER.target],
    ['negative rounds', { rounds: -2 }, 'rounds', 0],
  ] as const)('replaces %s with a safe value', (_name, override, field, expected) => {
    const parsed = parseStoredSession({ ...legacyRecord('user-a', 5, 33, 1), ...override });
    expect(parsed.kind).toBe('migrated');
    if (parsed.kind !== 'migrated') return;
    expect(parsed.session[field]).toBe(expected);
  });

  it('is idempotent — migrating its own output changes nothing', () => {
    const first = parseStoredSession(legacyRecord('subhanallah', 9, 33, 1));
    expect(first.kind).toBe('migrated');
    if (first.kind !== 'migrated') return;

    const second = parseStoredSession({ version: TASBIH_SCHEMA_VERSION, ...first.session });
    expect(second.kind).toBe('current');
    if (second.kind !== 'current') return;
    expect(second.session.counterId).toBe(first.session.counterId);
    expect(second.session.count).toBe(first.session.count);
    expect(second.session.rounds).toBe(first.session.rounds);
  });

  it('carries the count through a real upgrade, end to end', async () => {
    await AsyncStorage.setItem(
      faithAddress('tasbihSession'),
      JSON.stringify(legacyRecord('astaghfirullah', 87, 100, 4)),
    );

    const repository = createLocalTasbihRepository();
    const session = await repository.getSession();

    expect(session.kind).toBe('ok');
    if (session.kind !== 'ok') return;
    expect(session.data.count).toBe(87);
    expect(session.data.rounds).toBe(4);
    expect(session.data.counterId).toBe(DEFAULT_COUNTER.id);

    // And the rewrite landed, stamped, so the next launch takes the `current` branch.
    const stored = JSON.parse((await AsyncStorage.getItem(faithAddress('tasbihSession'))) ?? '{}');
    expect(stored.version).toBe(TASBIH_SCHEMA_VERSION);
    expect(stored.presetId).toBeUndefined();
  });

  it('leaves an unreadable record alone rather than overwriting it', async () => {
    await AsyncStorage.setItem(faithAddress('tasbihSession'), JSON.stringify({ junk: true }));
    const repository = createLocalTasbihRepository();

    expect((await repository.getSession()).kind).toBe('empty');
    // Storage is untouched: nothing was destroyed to make a screen render.
    const raw = await AsyncStorage.getItem(faithAddress('tasbihSession'));
    expect(JSON.parse(raw ?? '{}').junk).toBe(true);
  });
});

describe('the counter itself', () => {
  it('offers the neutral default on a fresh install, and calls it nothing devotional', async () => {
    const repository = createLocalTasbihRepository();
    const labels = await repository.listLabels();

    expect(labels.kind).toBe('ok');
    if (labels.kind !== 'ok') return;
    expect(labels.data).toHaveLength(1);
    expect(labels.data[0]?.id).toBe(DEFAULT_COUNTER.id);
    expect(labels.data[0]?.name).toBe('My counter');
    expect(labels.data[0]?.name).not.toMatch(/dhikr|sunnah|recommended|verified/i);
  });

  it('has no field in which a label could claim to be verified', () => {
    // The type carries id, name and target and nothing else — asserted on a real value.
    expect(Object.keys(DEFAULT_COUNTER).sort()).toEqual(['id', 'name', 'target']);
  });

  it('counts every tap when they arrive faster than the writes land', async () => {
    const repository = createLocalTasbihRepository();
    await repository.startSession(DEFAULT_COUNTER.id);
    await repository.adjustTarget(MAX_TASBIH_TARGET - DEFAULT_COUNTER.target);

    // Fired without awaiting: the serial queue is what stops two taps reading the same stored count.
    const taps = Array.from({ length: 40 }, () => repository.increment());
    const results = await Promise.all(taps);

    expect(results.every((result) => result.kind === 'ok')).toBe(true);
    const session = await repository.getSession();
    if (session.kind !== 'ok') return;
    expect(session.data.count).toBe(40);
  });

  it('banks exactly one round when the target is crossed', async () => {
    const repository = createLocalTasbihRepository();
    await repository.startSession(DEFAULT_COUNTER.id);
    await repository.adjustTarget(MIN_TASBIH_TARGET - DEFAULT_COUNTER.target + 2);

    await repository.increment();
    await repository.increment();

    const session = await repository.getSession();
    if (session.kind !== 'ok') return;
    expect(session.data.target).toBe(3);
    expect(session.data.rounds).toBe(0);

    const third = await repository.increment();
    if (third.kind !== 'ok') return;
    expect(third.data.rounds).toBe(1);
    expect(third.data.count).toBe(0);
  });

  it('never undoes below zero', async () => {
    const repository = createLocalTasbihRepository();
    await repository.startSession(DEFAULT_COUNTER.id);
    for (let i = 0; i < 5; i += 1) {
      await repository.decrement();
    }
    const session = await repository.getSession();
    if (session.kind !== 'ok') return;
    expect(session.data.count).toBe(0);
  });

  it('survives a relaunch, because the repository holds nothing in memory', async () => {
    const first = createLocalTasbihRepository();
    await first.startSession(DEFAULT_COUNTER.id);
    await first.increment();
    await first.increment();

    // A second instance is what a force-stop and relaunch produces.
    const second = createLocalTasbihRepository();
    const session = await second.getSession();
    if (session.kind !== 'ok') return;
    expect(session.data.count).toBe(2);
  });
});

describe('user labels stay the user’s', () => {
  it('creates one from their own text, trimmed and bounded', async () => {
    const repository = createLocalTasbihRepository();
    const created = await repository.createLabel(`   ${'x'.repeat(MAX_LABEL_LENGTH + 20)}   `);

    expect(created.kind).toBe('ok');
    if (created.kind !== 'ok') return;
    expect(created.data.name).toHaveLength(MAX_LABEL_LENGTH);
    expect(created.data.id.startsWith('user-')).toBe(true);
  });

  it('refuses an empty label rather than storing a blank row', async () => {
    const repository = createLocalTasbihRepository();
    expect((await repository.createLabel('   ')).kind).toBe('error');
  });

  it('does not put the user’s words into the identifier', async () => {
    const repository = createLocalTasbihRepository();
    const created = await repository.createLabel('Morning count');
    if (created.kind !== 'ok') return;
    expect(created.data.id.toLowerCase()).not.toContain('morning');
  });

  it('keeps the default undeletable, so a counter always exists', async () => {
    const repository = createLocalTasbihRepository();
    expect((await repository.deleteLabel(DEFAULT_COUNTER.id)).kind).toBe('error');
    const labels = await repository.listLabels();
    if (labels.kind !== 'ok') return;
    expect(labels.data.some((label) => label.id === DEFAULT_COUNTER.id)).toBe(true);
  });

  it('falls back to the default when the active counter is deleted', async () => {
    const repository = createLocalTasbihRepository();
    const created = await repository.createLabel('Counter A');
    if (created.kind !== 'ok') return;
    await repository.startSession(created.data.id);

    await repository.deleteLabel(created.data.id);

    const session = await repository.getSession();
    if (session.kind !== 'ok') return;
    expect(session.data.counterId).toBe(DEFAULT_COUNTER.id);
  });

  it('stores labels under a private key and sends nothing anywhere', async () => {
    const repository = createLocalTasbihRepository();
    await repository.createLabel('Counter A');

    const raw = (await AsyncStorage.getItem(faithAddress('tasbihLabels'))) ?? '';
    expect(raw).toContain('Counter A');
    /*
      ── This assertion used to say the opposite, and it was wrong ─────────────
      It read `.not.toMatch(/user|account|uid/i)` — "the key is namespaced to this device's Faith
      storage, not a user- or account-scoped one" — and it passed because that was true. It was
      also the release blocker: a device-scoped label key is one the next account to sign in reads.

      A counter somebody named is theirs. The address now carries the owner, and the label text
      still appears nowhere but the value.
    */
    expect(faithAddress('tasbihLabels')).toMatch(/^noorlife\.faith\.user\.v1\./);
    expect(faithAddress('tasbihLabels')).not.toContain('Counter A');
  });
});

describe('the removed content cannot come back', () => {
  /**
   * The regression guard, and the reason it scans rather than asserts on a value.
   *
   * A deletion is only permanent if reintroducing it fails something. This walks the production
   * source and fails on any of the removed transliterations or translations reappearing — so pasting
   * one back into a screen, a repository or a fixture breaks the build rather than shipping.
   *
   * Reintroduction was verified to fail this: adding one of the removed strings to
   * `local-tasbih.repository.ts` turns this case red.
   */
  const REMOVED_TEXT = [
    'SubhanAllah',
    'Alhamdulillah',
    'Allahu Akbar',
    'Astaghfirullah',
    'La ilaha illa Allah',
    'Glory be to Allah',
    'All praise is for Allah',
    'Allah is the Greatest',
    'I seek forgiveness from Allah',
    'There is no deity except Allah',
  ];

  function sourceFiles(root: string): readonly string[] {
    const found: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (/\.(ts|tsx)$/.test(entry.name) && !full.includes('__tests__')) {
          found.push(full);
        }
      }
    };
    walk(path.join(process.cwd(), root));
    return found;
  }

  it.each(['src/features/faith', 'src/features/modules/faith'])(
    'finds none of the removed text anywhere in %s',
    (root) => {
      const offenders: string[] = [];
      for (const file of sourceFiles(root)) {
        const contents = fs.readFileSync(file, 'utf8');
        for (const phrase of REMOVED_TEXT) {
          if (contents.includes(phrase)) {
            offenders.push(`${path.relative(process.cwd(), file)} → ${phrase}`);
          }
        }
      }
      expect(offenders).toEqual([]);
    },
  );

  it('no longer ships the mock tasbih repository at all', () => {
    expect(
      fs.existsSync(
        path.join(process.cwd(), 'src/features/faith/data/mock/mock-tasbih.repository.ts'),
      ),
    ).toBe(false);
  });

  it('keeps no Arabic script in the tasbih production path', () => {
    for (const file of sourceFiles('src/features/faith/data/tasbih')) {
      // Any Arabic-block codepoint in this module would be content nobody has verified.
      expect(fs.readFileSync(file, 'utf8')).not.toMatch(/[؀-ۿ]/);
    }
  });
});

describe('production composition', () => {
  it('names the real local repository rather than taking Tasbih from the development set', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'src/features/faith/di/faith-repository-context.tsx'),
      'utf8',
    );
    /*
      The leak this closes: `...mocks` supplied Tasbih for every key nothing below overrode, so a
      development fixture decided what a production screen rendered. The explicit key is what stops
      that, and it must appear *after* the spread to win.
    */
    expect(source).toMatch(/tasbih: createLocalTasbihRepository\(\)/);
    const spreadAt = source.indexOf('...mocks');
    const tasbihAt = source.indexOf('tasbih: createLocalTasbihRepository()');
    expect(spreadAt).toBeGreaterThan(-1);
    expect(tasbihAt).toBeGreaterThan(spreadAt);
  });

  it('reaches for no network and no console anywhere in the tasbih module', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'src/features/faith/data/tasbih/local-tasbih.repository.ts'),
      'utf8',
    );
    expect(source).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|axios|https?:\/\//);
    expect(source).not.toMatch(/console\.|Sentry|analytics|logEvent/);
  });
});

describe('the dhikr selector offers label management without proposing content', () => {
  /*
    The repository has supported labels since this migration; these assert the UI actually exposes
    it, which is the half a user can reach. Label management now lives on the dhikr selector rather
    than on the counting screen — `Change` opens it — so that is what these scan.

    The important negative is the absence of any suggestion: an "Add" flow that offered example
    names would be NoorLife proposing religious content again through a different door.
  */
  it('offers a free-text field and no suggestion list', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'src/features/faith/screens/dhikr-selector-screen.tsx'),
      'utf8',
    );
    expect(source).toMatch(/faith-dhikr-new-input/);
    expect(source).toMatch(/faith-dhikr-create/);
    expect(source).toMatch(/placeholder="What are you counting\?"/);
    /*
      No suggestion machinery — asserted against the *code* rather than the file, because the
      comments on this screen legitimately use those words to explain the prohibition. Stripping
      them first is what keeps the assertion about behaviour instead of about prose.
    */
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/suggest|example|recommended/i);
  });

  it('confirms removal and never offers it on the default counter', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'src/features/faith/screens/dhikr-selector-screen.tsx'),
      'utf8',
    );
    expect(source).toMatch(/faith-dhikr-remove-/);
    /*
      The default counter never reaches the list at all: `personal` filters it out by id before the
      rows are built, so there is no remove control to guard rather than a guard that could be
      dropped. That is the stronger arrangement — the neutral counter cannot be deleted because it
      is not offered, not because a condition remembered to exclude it.
    */
    expect(source).toMatch(/label\.id !== DEFAULT_COUNTER\.id/);
  });

  it('bounds what a user can type to the repository’s own limit', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'src/features/faith/screens/dhikr-selector-screen.tsx'),
      'utf8',
    );
    // The input's cap is the constant, not a second number that could drift from it.
    expect(source).toMatch(/maxLength=\{MAX_LABEL_LENGTH\}/);
  });
});
