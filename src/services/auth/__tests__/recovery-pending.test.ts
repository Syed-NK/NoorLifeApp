import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  clearRecoveryPending,
  readRecoveryPending,
  RECOVERY_JOURNEY_VERSION,
  RECOVERY_PENDING_TTL_MS,
  writeRecoveryPending,
} from '../recovery-pending';

/**
 * The marker that keeps an unfinished password recovery from looking like an ordinary sign-in.
 *
 * These are storage-level tests: `jest.setup.ts` provides in-memory doubles for `expo-secure-store`
 * and AsyncStorage, so every read below is a real read. The routing decisions built on top of this
 * are `recovery-containment.test.ts`, and the two are kept apart deliberately — this file is about
 * what survives, that one is about what it means.
 */

const KEY = 'noorlife.auth.recoveryPending';
const USER = 'user-abc-123';

beforeEach(async () => {
  await clearRecoveryPending();
});

describe('writing a marker', () => {
  it('reports that it was stored', async () => {
    expect(await writeRecoveryPending(USER)).toBe(true);
  });

  it('stores nothing but the user id, two timestamps and the version', async () => {
    await writeRecoveryPending(USER, 1_000);

    const raw = (await SecureStore.getItemAsync(KEY)) ?? '{}';
    const record = JSON.parse(raw) as Record<string, unknown>;

    // An exact key set, not a "does not contain a token" check: a new field is how a secret would
    // arrive here, and an allow-list is what fails when one does.
    expect(Object.keys(record).sort()).toEqual(['createdAt', 'expiresAt', 'userId', 'version']);
    expect(record).toEqual({
      userId: USER,
      createdAt: 1_000,
      expiresAt: 1_000 + RECOVERY_PENDING_TTL_MS,
      version: RECOVERY_JOURNEY_VERSION,
    });
  });
});

describe('reading a marker', () => {
  it('reports none when nothing was written', async () => {
    expect(await readRecoveryPending()).toEqual({ status: 'none' });
  });

  it('returns the marker inside its lifetime', async () => {
    await writeRecoveryPending(USER, 1_000);

    const read = await readRecoveryPending(1_000 + RECOVERY_PENDING_TTL_MS - 1);

    expect(read.status).toBe('valid');
    expect(read.status === 'valid' && read.marker.userId).toBe(USER);
  });

  it('reports expired at the moment the window closes', async () => {
    await writeRecoveryPending(USER, 1_000);

    // Exactly at `expiresAt`, not past it: the boundary is the case a TTL gets wrong.
    expect(await readRecoveryPending(1_000 + RECOVERY_PENDING_TTL_MS)).toEqual({
      status: 'expired',
    });
  });

  it('survives a process restart', async () => {
    await writeRecoveryPending(USER, 1_000);

    // The whole point of persisting it. `resetModules` throws away every module-level binding while
    // leaving the storage doubles intact, which is the shape of a cold launch after process death.
    jest.resetModules();
    // A static import is hoisted and would bind the pre-reset module, which is the exact thing this
    // case needs to discard.
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- see above.
    const reloaded = require('../recovery-pending') as typeof import('../recovery-pending');

    const read = await reloaded.readRecoveryPending(2_000);
    expect(read.status).toBe('valid');
  });
});

describe('failing closed', () => {
  it('treats unparseable storage as corrupt, never as absent', async () => {
    await SecureStore.setItemAsync(KEY, 'not json at all');

    // `none` would let startup proceed to Home. Corrupt is the only safe reading of a value we
    // cannot understand, because it might be describing a recovery in progress.
    expect(await readRecoveryPending()).toEqual({ status: 'corrupt' });
  });

  it.each([
    ['a missing user id', { createdAt: 1, expiresAt: 1e15, version: RECOVERY_JOURNEY_VERSION }],
    [
      'an empty user id',
      { userId: '', createdAt: 1, expiresAt: 1e15, version: RECOVERY_JOURNEY_VERSION },
    ],
    [
      'a non-numeric timestamp',
      { userId: USER, createdAt: 'x', expiresAt: 1e15, version: RECOVERY_JOURNEY_VERSION },
    ],
    ['an unknown version', { userId: USER, createdAt: 1, expiresAt: 1e15, version: 99 }],
    ['no version at all', { userId: USER, createdAt: 1, expiresAt: 1e15 }],
    ['an array', []],
    ['a bare string', 'recovery'],
  ])('treats %s as corrupt', async (_label, value) => {
    await SecureStore.setItemAsync(KEY, JSON.stringify(value));

    expect(await readRecoveryPending()).toEqual({ status: 'corrupt' });
  });
});

describe('clearing', () => {
  it('removes the marker', async () => {
    await writeRecoveryPending(USER);

    await clearRecoveryPending();

    expect(await readRecoveryPending()).toEqual({ status: 'none' });
  });

  it('is safe when there is nothing to clear', async () => {
    await expect(clearRecoveryPending()).resolves.toBeUndefined();
  });

  it('does not leave a copy behind in the shadowed store', async () => {
    await writeRecoveryPending(USER);
    await clearRecoveryPending();

    /**
     * `readRaw` prefers SecureStore, so a stale AsyncStorage copy would normally be invisible — and
     * would resurface the moment a device's keystore became unavailable, containing a user for a
     * recovery that finished long ago. Both stores are written and both are cleared.
     */
    expect(await AsyncStorage.getItem(KEY)).toBeNull();
    expect(await SecureStore.getItemAsync(KEY)).toBeNull();
  });
});

/**
 * The source scan this module's header promises.
 *
 * The assertions above prove today's code writes four keys. They cannot prove tomorrow's does not
 * reach for something it should never hold — a field added behind an untaken branch would pass all
 * of them. So the file is read as text too.
 */
describe('the module never reaches for a secret', () => {
  const source = readFileSync(join(__dirname, '..', 'recovery-pending.ts'), 'utf8');

  // Comments are stripped first: the header names every forbidden term in order to forbid it, and
  // scanning the raw file would make the documentation the thing that fails.
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it.each([
    'access_token',
    'accessToken',
    'refresh_token',
    'refreshToken',
    'code_verifier',
    'codeVerifier',
    'sb_flow_id',
    'nl_rid',
    'password',
    'error_description',
  ])('does not mention %s outside its own documentation', (term) => {
    expect(code).not.toContain(term);
  });

  it('does not parse or hold a URL', () => {
    expect(code).not.toContain('parseAuthCallback');
    expect(code).not.toMatch(/noorlifeapp:\/\//);
  });
});
