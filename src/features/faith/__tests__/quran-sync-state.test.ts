import AsyncStorage from '@react-native-async-storage/async-storage';

import { faithStorageKeys } from '../storage/faith-storage';
import {
  backoffDelayMs,
  BASE_BACKOFF_MS,
  clearSyncFailure,
  clearSyncHealth,
  EMPTY_SYNC_HEALTH,
  MAX_BACKOFF_MS,
  mayAttempt,
  MIN_ATTEMPT_INTERVAL_MS,
  readSyncHealth,
  recordSyncAttempt,
  recordSyncFailure,
  SYNC_HEALTH_VERSION,
} from '../storage/faith-sync-checkpoint';

/**
 * Sync health — what is left of the old checkpoint after the token authority was removed.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── What this file used to assert, and why that had to go ──────────────────
 * It tested `commitSync`, the stored `syncToken`, `syncedUntilSequence`, filter ownership and a
 * `lastSyncedAt` that stood for "synchronisation succeeded". All of those moved into the generation
 * manifest, where the token sits beside the content it acknowledges.
 *
 * Leaving them here would have left a **dormant second authority**: nothing read it, so nothing would
 * have caught it drifting, and the drift it invites is precisely the failure generations remove — a
 * token that outlives the rows it was issued for.
 *
 * ── The legacy-upgrade case is the one that matters most ───────────────────
 * A device upgrading from the old shape has a stored token and no generation. That token must never
 * be used and must never reach the wire: the old sequential publication could have died between any
 * two of its four writes, so the rows it acknowledges may be partial or absent. The device bootstraps.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const NOW = 1_700_000_000_000;

beforeEach(async () => {
  await clearSyncHealth();
});

describe('the record holds no successful-publication authority', () => {
  it('has no token, sequence, filter or success timestamp in its shape', async () => {
    await recordSyncFailure('rate-limited', NOW);
    const health = await readSyncHealth();

    expect(Object.keys(health).sort()).toEqual([
      'consecutiveFailures',
      'failedAt',
      'lastAttemptedAt',
      'lastFailure',
      'version',
    ]);
    for (const forbidden of ['syncToken', 'syncedUntilSequence', 'lastSyncedAt', 'resources']) {
      expect(health).not.toHaveProperty(forbidden);
    }
  });

  it('records an attempt without claiming anything was published', async () => {
    await recordSyncAttempt(NOW);
    const health = await readSyncHealth();
    expect(health.lastAttemptedAt).toBe(NOW);
    /* An attempt is not a success. Nothing here can say a generation exists. */
    expect(health.lastFailure).toBeNull();
    expect(health.consecutiveFailures).toBe(0);
  });

  it('clears failure state without recording a success', async () => {
    await recordSyncFailure('unavailable', NOW);
    await clearSyncFailure(NOW + 5);
    const health = await readSyncHealth();
    expect(health.lastFailure).toBeNull();
    expect(health.consecutiveFailures).toBe(0);
    expect(health.lastAttemptedAt).toBe(NOW + 5);
  });
});

describe('legacy checkpoints', () => {
  /** A record in exactly the shape the retired module wrote. */
  const legacy = {
    version: 1,
    resources: 'recitations:3;translations:85',
    syncToken: 'tok_legacy_must_not_be_used',
    lastSyncedAt: NOW - 1000,
    syncedUntilSequence: 4200,
    lastFailure: 'rate-limited',
    failedAt: NOW - 500,
  };

  it('never surfaces a legacy token', async () => {
    await AsyncStorage.setItem(faithStorageKeys.quranSyncCheckpoint, JSON.stringify(legacy));

    const health = await readSyncHealth();

    expect(JSON.stringify(health)).not.toContain('tok_legacy_must_not_be_used');
    expect(health).not.toHaveProperty('syncToken');
    expect(health).not.toHaveProperty('lastSyncedAt');
    expect(health).not.toHaveProperty('syncedUntilSequence');
  });

  it('salvages only the bounded failure information', async () => {
    await AsyncStorage.setItem(faithStorageKeys.quranSyncCheckpoint, JSON.stringify(legacy));

    const health = await readSyncHealth();

    expect(health.version).toBe(SYNC_HEALTH_VERSION);
    expect(health.lastFailure).toBe('rate-limited');
    expect(health.failedAt).toBe(NOW - 500);
    /* A salvaged failure counts as one, so backoff starts from a true position rather than zero. */
    expect(health.consecutiveFailures).toBe(1);
  });

  it('discards a legacy record whose failure fields are not valid', async () => {
    await AsyncStorage.setItem(
      faithStorageKeys.quranSyncCheckpoint,
      JSON.stringify({ ...legacy, lastFailure: 'something-invented', failedAt: 'yesterday' }),
    );
    expect(await readSyncHealth()).toEqual(EMPTY_SYNC_HEALTH);
  });

  it('discards a record from an unrecognised version entirely', async () => {
    await AsyncStorage.setItem(
      faithStorageKeys.quranSyncCheckpoint,
      JSON.stringify({ ...legacy, version: 99 }),
    );
    expect(await readSyncHealth()).toEqual(EMPTY_SYNC_HEALTH);
  });

  it('answers an empty record when nothing is stored', async () => {
    expect(await readSyncHealth()).toEqual(EMPTY_SYNC_HEALTH);
  });
});

describe('backoff', () => {
  it('is zero until something fails', () => {
    expect(backoffDelayMs(EMPTY_SYNC_HEALTH)).toBe(0);
  });

  it('doubles per consecutive failure and stops at the ceiling', async () => {
    await recordSyncFailure('unavailable', NOW);
    expect(backoffDelayMs(await readSyncHealth())).toBe(BASE_BACKOFF_MS);

    await recordSyncFailure('unavailable', NOW + 1);
    expect(backoffDelayMs(await readSyncHealth())).toBe(BASE_BACKOFF_MS * 2);

    for (let index = 0; index < 20; index += 1) {
      await recordSyncFailure('unavailable', NOW + 2 + index);
    }
    expect(backoffDelayMs(await readSyncHealth())).toBe(MAX_BACKOFF_MS);
  });

  it('blocks a retry inside the backoff window and permits one after it', async () => {
    await recordSyncFailure('unavailable', NOW);
    const health = await readSyncHealth();

    expect(mayAttempt(health, NOW + BASE_BACKOFF_MS - 1)).toBe(false);
    expect(mayAttempt(health, NOW + BASE_BACKOFF_MS + MIN_ATTEMPT_INTERVAL_MS)).toBe(true);
  });

  it('refuses closely-spaced attempts even when nothing has failed', async () => {
    /*
      A reconnect storm: foregrounding a phone reconnects it, so two triggers arrive together. The
      orchestrator's single-flight guard covers the simultaneous case; this covers the one a moment
      later, which would otherwise be a fresh transaction.
    */
    await recordSyncAttempt(NOW);
    const health = await readSyncHealth();

    expect(mayAttempt(health, NOW + 1)).toBe(false);
    expect(mayAttempt(health, NOW + MIN_ATTEMPT_INTERVAL_MS - 1)).toBe(false);
    expect(mayAttempt(health, NOW + MIN_ATTEMPT_INTERVAL_MS)).toBe(true);
  });

  it('treats a clock that moved backwards as due rather than as blocked', async () => {
    await recordSyncFailure('unavailable', NOW);
    expect(mayAttempt(await readSyncHealth(), NOW - 10_000)).toBe(true);
  });
});
