import AsyncStorage from '@react-native-async-storage/async-storage';
import { render, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';

import { AuthProvider, useAuth } from '@application/providers/auth-provider';
import { OFFLINE_STATE } from '@features/faith/data/connectivity/connectivity.port';
import { createFakeConnectivity, WIFI_ONLINE } from '@/test-support/fake-connectivity-port';
import { isRemoteAccessAuthorised } from '@services/network/remote-access';

import { FaithScopeProvider } from '../di/faith-scope-provider';
import {
  faithStorageKeys,
  readJson,
  resolveFaithAddress,
  writeJson,
} from '../storage/faith-storage';
import {
  getActiveFaithScope,
  resetFaithScopeForTest,
  setActiveFaithScope,
} from '../storage/faith-user-scope';
import { commitActivePrayerLocation, readStoredLocation } from '../storage/faith-location';
import { TEST_FAITH_USER_ID } from '@/test-support/faith-storage-address';

/**
 * What happens to one person's Faith data when somebody else uses the same phone.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── Why the real provider is rendered rather than the storage layer poked ──
 * `faith-account-isolation.test.ts` already proves the addresses partition. What it cannot prove is
 * that the *app* ever sets the owner correctly — and every interesting failure lives there: a scope
 * set one commit too late, an in-memory cache that outlives the switch, a receipt for the wrong
 * account, a write from user A's in-flight promise landing after user B signed in.
 *
 * So these mount `AuthProvider` + `FaithScopeProvider` against a scripted Supabase and a fake
 * connectivity port, and assert on what the storage boundary resolves to at each step.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const USER_A = { id: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', name: 'A Person' };
const USER_B = { id: 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb', name: 'B Person' };

const mockResolveSession = jest.fn();
const mockGetProfile = jest.fn();
const mockSignOut = jest.fn();
const mockSubscribe = jest.fn();

jest.mock('@services/auth/auth.service', () => ({
  resolveSession: (...args: unknown[]) => mockResolveSession(...args),
  getProfile: (...args: unknown[]) => mockGetProfile(...args),
  signOut: (...args: unknown[]) => mockSignOut(...args),
  subscribeToAuthChanges: (...args: unknown[]) => mockSubscribe(...args),
  getSession: jest.fn(),
  signInWithEmail: jest.fn(),
  signUpWithEmail: jest.fn(),
  verifyOtp: jest.fn(),
  resendVerificationEmail: jest.fn(),
  sendPasswordReset: jest.fn(),
  updatePassword: jest.fn(),
  signInWithGoogle: jest.fn(),
  signInWithApple: jest.fn(),
  setOnboardingCompleted: jest.fn(),
}));

function authenticatedAs(user: { id: string; name: string }) {
  return {
    kind: 'authenticated' as const,
    user: {
      id: user.id,
      email: `${user.name.replace(/\s+/g, '.').toLowerCase()}@example.com`,
      fullName: user.name,
      avatarUrl: null,
      emailConfirmed: true,
    },
  };
}

/** Renders the two providers and reports the resolved status, so a test can wait on it. */
function Probe() {
  const { status, authority } = useAuth();
  return <Text testID="probe">{`${status}:${authority ?? 'none'}`}</Text>;
}

async function mount(connectivity: ReturnType<typeof createFakeConnectivity>) {
  return await render(
    <AuthProvider connectivity={connectivity}>
      <FaithScopeProvider>
        <Probe />
      </FaithScopeProvider>
    </AuthProvider>,
  );
}

beforeEach(async () => {
  await AsyncStorage.clear();
  resetFaithScopeForTest();
  mockResolveSession.mockReset();
  mockGetProfile.mockReset().mockResolvedValue(null);
  mockSignOut.mockReset().mockResolvedValue(undefined);
  mockSubscribe.mockReset().mockReturnValue(() => undefined);
});

afterEach(() => {
  setActiveFaithScope(TEST_FAITH_USER_ID);
});

describe('user A, online', () => {
  it('addresses A’s namespace and authorises server calls', async () => {
    mockResolveSession.mockResolvedValue(authenticatedAs(USER_A));
    const { getByTestId } = await mount(createFakeConnectivity(WIFI_ONLINE));

    await waitFor(() => expect(getByTestId('probe')).toHaveTextContent('signed-in:online'));

    expect(getActiveFaithScope()?.encodedUserId).toBe(USER_A.id);
    expect(resolveFaithAddress(faithStorageKeys.bookmarks)).toContain(USER_A.id);
    expect(isRemoteAccessAuthorised()).toBe(true);
  });
});

describe('user A, offline', () => {
  it('restores A’s own namespace from the receipt and forbids server calls', async () => {
    /* One online launch to mint the receipt. */
    mockResolveSession.mockResolvedValue(authenticatedAs(USER_A));
    const online = await mount(createFakeConnectivity(WIFI_ONLINE));
    await waitFor(() => expect(online.getByTestId('probe')).toHaveTextContent('signed-in:online'));
    await online.unmount();
    resetFaithScopeForTest();

    /* Relaunch in airplane mode. The platform is definite, so no refresh is attempted. */
    mockResolveSession.mockReset();
    const offline = await mount(createFakeConnectivity(OFFLINE_STATE));
    await waitFor(() =>
      expect(offline.getByTestId('probe')).toHaveTextContent('signed-in:offline'),
    );

    expect(mockResolveSession).not.toHaveBeenCalled();
    expect(getActiveFaithScope()?.encodedUserId).toBe(USER_A.id);
    expect(isRemoteAccessAuthorised()).toBe(false);
  });

  it('opens A’s own local data offline', async () => {
    mockResolveSession.mockResolvedValue(authenticatedAs(USER_A));
    const online = await mount(createFakeConnectivity(WIFI_ONLINE));
    await waitFor(() => expect(online.getByTestId('probe')).toHaveTextContent('signed-in:online'));
    await writeJson(faithStorageKeys.bookmarks, [{ surah: 2, ayah: 255 }]);
    await online.unmount();
    resetFaithScopeForTest();

    const offline = await mount(createFakeConnectivity(OFFLINE_STATE));
    await waitFor(() =>
      expect(offline.getByTestId('probe')).toHaveTextContent('signed-in:offline'),
    );

    const bookmarks = await readJson<{ ayah: number }[]>(
      faithStorageKeys.bookmarks,
      [],
      (v): v is { ayah: number }[] => Array.isArray(v),
    );
    expect(bookmarks[0]?.ayah).toBe(255);
  });
});

describe('explicit sign-out', () => {
  it('stops resolving any personal address, without deleting A’s data', async () => {
    /*
      Both halves matter. Nothing personal may be readable while signed out — and A's data must
      still be there when A comes back, or partitioning would just be a slower delete.
    */
    mockResolveSession.mockResolvedValue(authenticatedAs(USER_A));
    const first = await mount(createFakeConnectivity(WIFI_ONLINE));
    await waitFor(() => expect(first.getByTestId('probe')).toHaveTextContent('signed-in:online'));
    await writeJson(faithStorageKeys.quranNotes, ['A note']);
    const aAddress = resolveFaithAddress(faithStorageKeys.quranNotes);
    await first.unmount();

    /* Sign out: the next launch finds no session. */
    resetFaithScopeForTest();
    mockResolveSession.mockResolvedValue({ kind: 'no-session' });
    const out = await mount(createFakeConnectivity(WIFI_ONLINE));
    await waitFor(() => expect(out.getByTestId('probe')).toHaveTextContent('signed-out:none'));

    expect(getActiveFaithScope()).toBeNull();
    expect(resolveFaithAddress(faithStorageKeys.quranNotes)).toBeNull();
    expect(
      await readJson<string[]>(faithStorageKeys.quranNotes, [], (v): v is string[] =>
        Array.isArray(v),
      ),
    ).toEqual([]);
    /* Still on disk, under A's address, untouched. */
    expect(await AsyncStorage.getItem(aAddress!)).toContain('A note');
  });

  it('forbids server calls once signed out', async () => {
    mockResolveSession.mockResolvedValue({ kind: 'no-session' });
    const { getByTestId } = await mount(createFakeConnectivity(WIFI_ONLINE));
    await waitFor(() => expect(getByTestId('probe')).toHaveTextContent('signed-out:none'));

    expect(isRemoteAccessAuthorised()).toBe(false);
  });
});

describe('user B signs in after user A', () => {
  it('gives B an empty, independent namespace', async () => {
    mockResolveSession.mockResolvedValue(authenticatedAs(USER_A));
    const a = await mount(createFakeConnectivity(WIFI_ONLINE));
    await waitFor(() => expect(a.getByTestId('probe')).toHaveTextContent('signed-in:online'));
    await writeJson(faithStorageKeys.bookmarks, [{ surah: 2, ayah: 255 }]);
    await writeJson(faithStorageKeys.preferences, { selectedReciterId: '7' });
    await a.unmount();
    resetFaithScopeForTest();

    mockResolveSession.mockResolvedValue(authenticatedAs(USER_B));
    const b = await mount(createFakeConnectivity(WIFI_ONLINE));
    await waitFor(() => expect(b.getByTestId('probe')).toHaveTextContent('signed-in:online'));

    expect(getActiveFaithScope()?.encodedUserId).toBe(USER_B.id);
    expect(
      await readJson<unknown[]>(faithStorageKeys.bookmarks, [], (v): v is unknown[] =>
        Array.isArray(v),
      ),
    ).toEqual([]);
    /* Not A's reciter, and not A's anything. */
    const preferences = await readJson<Record<string, unknown>>(
      faithStorageKeys.preferences,
      {},
      (v): v is Record<string, unknown> => typeof v === 'object' && v !== null,
    );
    expect(preferences.selectedReciterId).toBeUndefined();
  });

  it('still sees the device-installed audio and the published generation', async () => {
    /*
      The point of the split. B inherits none of A's choices and all of the publisher content that
      is already on the phone — a second account must not trigger a second gigabyte of downloads.
    */
    mockResolveSession.mockResolvedValue(authenticatedAs(USER_A));
    const a = await mount(createFakeConnectivity(WIFI_ONLINE));
    await waitFor(() => expect(a.getByTestId('probe')).toHaveTextContent('signed-in:online'));
    await writeJson(faithStorageKeys.quranGenerationPointer, {
      version: 1,
      generationId: 'gen-shared',
    });
    await a.unmount();
    resetFaithScopeForTest();

    mockResolveSession.mockResolvedValue(authenticatedAs(USER_B));
    const b = await mount(createFakeConnectivity(WIFI_ONLINE));
    await waitFor(() => expect(b.getByTestId('probe')).toHaveTextContent('signed-in:online'));

    const pointer = await readJson<{ generationId?: string }>(
      faithStorageKeys.quranGenerationPointer,
      {},
      (v): v is { generationId?: string } => typeof v === 'object' && v !== null,
    );
    expect(pointer.generationId).toBe('gen-shared');
  });

  it('replaces the receipt rather than leaving A’s beside it', async () => {
    mockResolveSession.mockResolvedValue(authenticatedAs(USER_A));
    const a = await mount(createFakeConnectivity(WIFI_ONLINE));
    await waitFor(() => expect(a.getByTestId('probe')).toHaveTextContent('signed-in:online'));
    await a.unmount();

    mockResolveSession.mockResolvedValue(authenticatedAs(USER_B));
    const b = await mount(createFakeConnectivity(WIFI_ONLINE));
    await waitFor(() => expect(b.getByTestId('probe')).toHaveTextContent('signed-in:online'));
    await b.unmount();
    resetFaithScopeForTest();

    /* An offline relaunch must be B, not A. */
    mockResolveSession.mockReset();
    const offline = await mount(createFakeConnectivity(OFFLINE_STATE));
    await waitFor(() =>
      expect(offline.getByTestId('probe')).toHaveTextContent('signed-in:offline'),
    );
    expect(getActiveFaithScope()?.encodedUserId).toBe(USER_B.id);
  });

  it('denies offline re-entry after a confirmed revocation', async () => {
    mockResolveSession.mockResolvedValue(authenticatedAs(USER_A));
    const a = await mount(createFakeConnectivity(WIFI_ONLINE));
    await waitFor(() => expect(a.getByTestId('probe')).toHaveTextContent('signed-in:online'));
    await a.unmount();
    resetFaithScopeForTest();

    /* The server answers: revoked. A verdict, so the receipt goes. */
    mockResolveSession.mockResolvedValue({ kind: 'invalid-or-revoked' });
    const revoked = await mount(createFakeConnectivity(WIFI_ONLINE));
    await waitFor(() => expect(revoked.getByTestId('probe')).toHaveTextContent('signed-out:none'));
    await revoked.unmount();

    /* And a later airplane-mode launch finds nothing to restore. */
    mockResolveSession.mockReset();
    const offline = await mount(createFakeConnectivity(OFFLINE_STATE));
    await waitFor(() => expect(offline.getByTestId('probe')).toHaveTextContent('signed-out:none'));
    expect(getActiveFaithScope()).toBeNull();
  });
});

describe('scheduled prayer alerts do not outlive their owner', () => {
  /*
    The alarms are held by Android, not by NoorLife, and the record naming them is partitioned. So
    a switch makes user A's identifiers unreadable while the alarms themselves keep firing — at
    times computed from A's city, on B's phone. `cancelEveryPendingPrayerAlert` asks the platform
    instead of the record, which is the only question that still has an answer.
  */
  const scheduled = jest.requireMock('expo-notifications') as {
    getAllScheduledNotificationsAsync: jest.Mock;
    cancelScheduledNotificationAsync: jest.Mock;
  };

  beforeEach(() => {
    scheduled.getAllScheduledNotificationsAsync.mockResolvedValue([
      /*
        Two different channels on purpose. The id encodes the chosen alert sound, so user A's
        alarms sit on whatever channel A's preference produced — which is not the channel B's
        freshly-defaulted preference resolves to. A filter matching the *current* channel would skip
        both of these, which is the bug the prefix match exists to avoid.
      */
      { identifier: 'a-fajr', content: {}, trigger: { channelId: 'prayer-alerts-v2-makkah.wav' } },
      { identifier: 'a-dhuhr', content: {}, trigger: { channelId: 'prayer-alerts-v1-default' } },
      /* Not a prayer alert, and must survive. */
      { identifier: 'other', content: {}, trigger: { channelId: 'some-other-channel' } },
    ]);
    scheduled.cancelScheduledNotificationAsync.mockClear();
  });

  it('cancels nothing on an ordinary launch', async () => {
    /*
      The regression this guards against is far worse than the leak it sits beside: cancelling on
      every launch would drop every pending alert for everybody, and they are only rebuilt when a
      Faith screen mounts.
    */
    mockResolveSession.mockResolvedValue(authenticatedAs(USER_A));
    const { getByTestId } = await mount(createFakeConnectivity(WIFI_ONLINE));
    await waitFor(() => expect(getByTestId('probe')).toHaveTextContent('signed-in:online'));

    expect(scheduled.cancelScheduledNotificationAsync).not.toHaveBeenCalled();
  });

  it('cancels them when a different account signs in', async () => {
    mockResolveSession.mockResolvedValue(authenticatedAs(USER_A));
    const a = await mount(createFakeConnectivity(WIFI_ONLINE));
    await waitFor(() => expect(a.getByTestId('probe')).toHaveTextContent('signed-in:online'));
    expect(scheduled.cancelScheduledNotificationAsync).not.toHaveBeenCalled();

    /* Same mounted tree, new session — which is what a sign-out-and-in inside one process is. */
    mockResolveSession.mockResolvedValue(authenticatedAs(USER_B));
    await a.rerender(
      <AuthProvider connectivity={createFakeConnectivity(WIFI_ONLINE)}>
        <FaithScopeProvider>
          <Probe />
        </FaithScopeProvider>
      </AuthProvider>,
    );
    await waitFor(() => expect(getActiveFaithScope()?.encodedUserId).toBe(USER_B.id));
    await waitFor(() => expect(scheduled.cancelScheduledNotificationAsync).toHaveBeenCalled());

    expect(scheduled.cancelScheduledNotificationAsync).toHaveBeenCalledWith('a-fajr');
    expect(scheduled.cancelScheduledNotificationAsync).toHaveBeenCalledWith('a-dhuhr');
    expect(scheduled.cancelScheduledNotificationAsync).not.toHaveBeenCalledWith('other');
  });
});

describe('in-memory state does not survive an account change', () => {
  it('drops the cached prayer location', async () => {
    /*
      ── The subtlest exposure in this feature ────────────────────────────────
      `readActivePrayerLocation` keeps the last valid record in a module cell, so a corrupt write
      does not blank a working screen mid-session. Right within one account; across two it serves
      **the previous user's home city** from memory, at an address the new user cannot even read.

      `prayer-location-store.ts` subscribes to the scope and clears the cell, which is what this
      asserts — and it asserts it through the public reader rather than the cell, because the cell
      is the implementation and the exposure is what the reader returns.
    */
    setActiveFaithScope(USER_A.id);
    /*
      Written through the production mutation boundary rather than hand-crafted into storage. A
      literal record would be this test's opinion of the V3 schema, and if it drifted the case would
      fail for a reason that has nothing to do with account isolation.
    */
    await commitActivePrayerLocation({
      mode: 'city',
      coordinate: { latitude: 24.7136, longitude: 46.6753 },
      label: 'A Private City',
      geonamesId: 108410,
      countryCode: 'SA',
      admin1: 'Riyadh',
      resolvedAt: '2026-08-13T12:00:00.000Z',
    });
    const mine = await readStoredLocation();
    expect(mine?.label).toBe('A Private City');

    setActiveFaithScope(USER_B.id);
    /* B's address holds nothing, and the cache must not answer on its behalf. */
    expect(await readStoredLocation()).toBeNull();
  });

  it('does not let a write started under A land in B’s namespace', async () => {
    /*
      The address is resolved when the write executes, not when it is queued — so an in-flight
      promise that resolves after a switch writes to whoever is current. That is the wrong account.
      Resolving at the boundary means the value lands under A even though it completed later.
    */
    setActiveFaithScope(USER_A.id);
    const aAddress = resolveFaithAddress(faithStorageKeys.readingPosition)!;
    const pending = writeJson(faithStorageKeys.readingPosition, { surah: 18 });
    await pending;

    setActiveFaithScope(USER_B.id);
    expect(
      await readJson<{ surah?: number }>(
        faithStorageKeys.readingPosition,
        {},
        (v): v is object => typeof v === 'object' && v !== null,
      ),
    ).toEqual({});
    expect(await AsyncStorage.getItem(aAddress)).toContain('18');
  });
});
