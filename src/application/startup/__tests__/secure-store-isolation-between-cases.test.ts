import * as SecureStore from 'expo-secure-store';

import {
  OFFLINE_RECEIPT_KEY_FOR_TESTS,
  OFFLINE_RECEIPT_VERSION,
  readOfflineReceipt,
} from '@services/auth/offline-receipt';

/**
 * No case inherits another's authority receipt — issue #166.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * The Keystore double outlives module resets on purpose: real secure storage survives a process, and
 * a suite simulating a restart needs a double that does too. What it must not do is let one case
 * *add* to it and change the launch every later case gets.
 *
 * `AuthProvider` writes an offline authority receipt whenever a session resolves, and a device
 * holding a valid one is granted authority immediately — correctly; that is the offline-auth feature.
 * So a case that means to watch authority being awaited only sees the wait while no receipt exists,
 * and the first case to resolve a session silently takes that away from every case after it. Under
 * seed 8675309 that turned `deep-link-progress-resolution`'s live-session case into
 * `protected-child` already rendered, with its own session promise still pending.
 *
 * ── Why two mirrored cases ─────────────────────────────────────────────────
 * A single "the store starts clean" case is not a regression test: shuffled ahead of whatever writes,
 * it passes on a clean store for the wrong reason. Each case here writes a receipt *and* asserts the
 * store arrived at its seed, so whichever runs second is the one that catches the leak. Removing the
 * reset from `jest.setup.ts` fails this file in **either** order.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const SEEDED_TOKEN_KEY = 'noorlife.auth.accessToken';

async function expectSeededBaseline(label: string): Promise<void> {
  /* Read through the production boundary, not the double's backing map. */
  expect(`${label}: receipt`).toBe(
    `${label}: ${(await readOfflineReceipt()) === null ? 'receipt' : 'inherited'}`,
  );
  /* The documented seed is still there: a token present is the realistic launch precondition. */
  expect(await SecureStore.getItemAsync(SEEDED_TOKEN_KEY)).toBe('jest-seeded-token');
}

async function writeAReceipt(userId: string): Promise<void> {
  await SecureStore.setItemAsync(
    OFFLINE_RECEIPT_KEY_FOR_TESTS,
    JSON.stringify({
      version: OFFLINE_RECEIPT_VERSION,
      userId,
      displayName: 'Signup Name',
      avatarUrl: null,
      hasCompletedOnboarding: false,
      validatedAt: 0,
      updatedAt: 0,
    }),
  );
}

it('starts at the seeded baseline, and leaves a receipt behind', async () => {
  await expectSeededBaseline('first case');
  await writeAReceipt('test-user-id');
  expect(await readOfflineReceipt()).not.toBeNull();
});

it('still starts at the seeded baseline after the case that wrote one', async () => {
  await expectSeededBaseline('second case');
  await writeAReceipt('someone-else');
  expect(await readOfflineReceipt()).not.toBeNull();
});

it('does not carry a key no case seeded', async () => {
  expect(await SecureStore.getItemAsync('noorlife.test.unseeded-key')).toBeNull();
  await SecureStore.setItemAsync('noorlife.test.unseeded-key', 'written here');
});

it('still does not carry it afterwards', async () => {
  expect(await SecureStore.getItemAsync('noorlife.test.unseeded-key')).toBeNull();
});
