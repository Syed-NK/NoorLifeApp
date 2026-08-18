/**
 * The offline receipt: what it stores, what it refuses, and when it disappears.
 *
 * ── The one property everything else rests on ──────────────────────────────
 * It contains no credential. Not a token that has expired, not a token that is encrypted, not a token
 * at all — so there is nothing an attacker who obtained it could send anywhere. Every other guarantee
 * here (fail-closed reads, deletion on revocation, deletion on sign-out) narrows an exposure that is
 * already bounded by that.
 */

import {
  clearOfflineReceipt,
  OFFLINE_RECEIPT_KEY_FOR_TESTS,
  OFFLINE_RECEIPT_VERSION,
  readOfflineReceipt,
  writeOfflineReceipt,
} from '../offline-receipt';

const store = new Map<string, string>();
const mockSetItem = jest.fn(async (key: string, value: string) => {
  store.set(key, value);
});
const mockGetItem = jest.fn(async (key: string) => store.get(key) ?? null);
const mockDeleteItem = jest.fn(async (key: string) => {
  store.delete(key);
});

jest.mock('expo-secure-store', () => ({
  setItemAsync: (...args: [string, string]) => mockSetItem(...args),
  getItemAsync: (...args: [string]) => mockGetItem(...args),
  deleteItemAsync: (...args: [string]) => mockDeleteItem(...args),
}));

const VALID = {
  userId: 'user-a',
  displayName: 'A Person',
  avatarUrl: null,
  hasCompletedOnboarding: true,
  now: 1_700_000_000_000,
};

beforeEach(() => {
  store.clear();
  mockSetItem.mockClear();
  mockGetItem.mockClear();
  mockDeleteItem.mockClear();
});

describe('what is written', () => {
  it('is stored in the Keystore, not in AsyncStorage', async () => {
    /*
      Locked decision 4. A flag in AsyncStorage is one anybody with the device or a backup can write,
      which would make offline access forgeable — locked decision 3's exact prohibition.
    */
    expect(await writeOfflineReceipt(VALID)).toBe(true);
    expect(mockSetItem).toHaveBeenCalledTimes(1);
    expect(mockSetItem.mock.calls[0]?.[0]).toBe(OFFLINE_RECEIPT_KEY_FOR_TESTS);
  });

  it('contains no token, password or credential of any kind', async () => {
    await writeOfflineReceipt(VALID);
    const written = store.get(OFFLINE_RECEIPT_KEY_FOR_TESTS) ?? '';

    for (const forbidden of [
      'access_token',
      'accessToken',
      'refresh_token',
      'refreshToken',
      'provider_token',
      'providerToken',
      'password',
      'jwt',
      'apikey',
      'session',
      'entitlement',
      'syncToken',
    ]) {
      expect(written.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
    /* And nothing that merely *looks* like a JWT. */
    expect(written).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}/);
    expect(written).not.toMatch(/https?:\/\//);
  });

  it('stores exactly the documented fields and no others', async () => {
    await writeOfflineReceipt(VALID);
    const parsed = JSON.parse(store.get(OFFLINE_RECEIPT_KEY_FOR_TESTS) ?? '{}') as Record<
      string,
      unknown
    >;

    expect(Object.keys(parsed).sort()).toEqual(
      [
        'avatarUrl',
        'displayName',
        'hasCompletedOnboarding',
        'updatedAt',
        'userId',
        'validatedAt',
        'version',
      ].sort(),
    );
    expect(parsed.version).toBe(OFFLINE_RECEIPT_VERSION);
    expect(parsed.validatedAt).toBe(VALID.now);
  });
});

describe('the email address, which used to be stored here', () => {
  /*
    It was carried so Profile's identity row would not show a blank line offline. The row already
    had a designed absent state, so the field bought nothing and cost a second copy of a personal
    identifier living outside Supabase. These cases exist so it cannot drift back in.
  */

  it('is absent from a freshly written record', async () => {
    await writeOfflineReceipt(VALID);
    const written = store.get(OFFLINE_RECEIPT_KEY_FOR_TESTS) ?? '';

    expect(JSON.parse(written)).not.toHaveProperty('email');
    /* And no address-shaped text under any other field name. */
    expect(written).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/);
  });

  it('cannot be smuggled in by spreading an object that carries one', async () => {
    /*
      The realistic regression is not somebody adding `email:` back to the type — TypeScript would
      say so. It is a caller writing `writeOfflineReceipt({ ...user, now })` where `user` happens to
      have an address on it. The type is erased by then, so only a runtime refusal catches it.
    */
    const sessionLike = { ...VALID, email: 'a@example.com' };

    expect(
      await writeOfflineReceipt(
        sessionLike as unknown as Parameters<typeof writeOfflineReceipt>[0],
      ),
    ).toBe(false);
    expect(store.size).toBe(0);
  });

  it('is refused even when the spread also carries a token', async () => {
    const sessionLike = {
      ...VALID,
      email: 'a@example.com',
      access_token: 'eyJhbGciOiJIUzI1NiJ9.x',
    };

    expect(
      await writeOfflineReceipt(
        sessionLike as unknown as Parameters<typeof writeOfflineReceipt>[0],
      ),
    ).toBe(false);
    expect(store.size).toBe(0);
  });

  it('makes a v1 record left over from the previous build unreadable, and deletes it', async () => {
    /*
      Ignoring the field on read would leave the address sitting in the Keystore on every device
      that had already upgraded — the removal not actually happening. Rejecting deletes the record,
      and the next online session writes a clean one.
    */
    store.set(
      OFFLINE_RECEIPT_KEY_FOR_TESTS,
      JSON.stringify({
        version: OFFLINE_RECEIPT_VERSION,
        userId: 'user-a',
        displayName: 'A Person',
        avatarUrl: null,
        email: 'a@example.com',
        hasCompletedOnboarding: true,
        validatedAt: 1,
        updatedAt: 1,
      }),
    );

    expect(await readOfflineReceipt()).toBeNull();
    expect(store.has(OFFLINE_RECEIPT_KEY_FOR_TESTS)).toBe(false);
  });
});

describe('what is read back', () => {
  it('round-trips a valid record', async () => {
    await writeOfflineReceipt(VALID);
    expect(await readOfflineReceipt()).toEqual({
      userId: 'user-a',
      displayName: 'A Person',
      avatarUrl: null,
      hasCompletedOnboarding: true,
      validatedAt: VALID.now,
    });
  });

  it('answers null when nothing was ever written', async () => {
    expect(await readOfflineReceipt()).toBeNull();
  });
});

describe('a record that cannot be trusted is deleted, not tolerated', () => {
  it('rejects and removes malformed JSON', async () => {
    store.set(OFFLINE_RECEIPT_KEY_FOR_TESTS, '{not json');

    expect(await readOfflineReceipt()).toBeNull();
    /*
      Removed rather than left. Leaving it would mean re-reading and re-rejecting the same record on
      every launch, and would leave something shaped like an access grant for a future, laxer reader.
    */
    expect(store.has(OFFLINE_RECEIPT_KEY_FOR_TESTS)).toBe(false);
  });

  it('rejects and removes an unsupported schema version', async () => {
    store.set(
      OFFLINE_RECEIPT_KEY_FOR_TESTS,
      JSON.stringify({
        ...VALID,
        version: OFFLINE_RECEIPT_VERSION + 1,
        validatedAt: 1,
        updatedAt: 1,
      }),
    );

    /*
      A record from a future build is refused, not migrated. This gates access to a user's own data,
      and a partially-understood record is exactly the input that should fail closed.
    */
    expect(await readOfflineReceipt()).toBeNull();
    expect(store.has(OFFLINE_RECEIPT_KEY_FOR_TESTS)).toBe(false);
  });

  it.each([
    ['a missing user id', { userId: undefined }],
    ['an empty user id', { userId: '' }],
    ['a missing display name', { displayName: undefined }],
    ['a non-boolean onboarding flag', { hasCompletedOnboarding: 'yes' }],
    ['a non-numeric validation time', { validatedAt: 'recently' }],
    ['an avatar that is neither null nor a string', { avatarUrl: 42 }],
  ])('rejects and removes a record with %s', async (_label, patch) => {
    store.set(
      OFFLINE_RECEIPT_KEY_FOR_TESTS,
      JSON.stringify({
        version: OFFLINE_RECEIPT_VERSION,
        userId: 'user-a',
        displayName: 'A Person',
        avatarUrl: null,
        hasCompletedOnboarding: true,
        validatedAt: 1,
        updatedAt: 1,
        ...patch,
      }),
    );

    expect(await readOfflineReceipt()).toBeNull();
    expect(store.has(OFFLINE_RECEIPT_KEY_FOR_TESTS)).toBe(false);
  });
});

describe('deletion', () => {
  it('removes the record so a later read grants nothing', async () => {
    await writeOfflineReceipt(VALID);
    await clearOfflineReceipt();

    expect(await readOfflineReceipt()).toBeNull();
    expect(mockDeleteItem).toHaveBeenCalledWith(OFFLINE_RECEIPT_KEY_FOR_TESTS);
  });

  it('replaces rather than merges when a second account signs in', async () => {
    /*
      Account isolation, at the one layer this phase does isolate. One record, replaced whole: user B
      signing in cannot leave user A's identity readable beside their own.
    */
    await writeOfflineReceipt(VALID);
    await writeOfflineReceipt({ ...VALID, userId: 'user-b', displayName: 'B Person' });

    const receipt = await readOfflineReceipt();
    expect(receipt?.userId).toBe('user-b');
    expect(store.size).toBe(1);
  });
});

describe('when the Keystore itself fails', () => {
  it('reports a failed write rather than claiming offline access will work', async () => {
    mockSetItem.mockRejectedValueOnce(new Error('keystore unavailable'));
    /*
      A caller that believed a receipt existed when it did not would promise an offline launch the
      device cannot deliver. Reporting `false` lets the caller stay honest.
    */
    expect(await writeOfflineReceipt(VALID)).toBe(false);
  });

  it('grants nothing when the record cannot be read', async () => {
    mockGetItem.mockRejectedValueOnce(new Error('keystore unavailable'));
    expect(await readOfflineReceipt()).toBeNull();
  });
});
