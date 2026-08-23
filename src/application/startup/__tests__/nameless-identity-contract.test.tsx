import { act, render } from '@testing-library/react-native';
import { useEffect } from 'react';
import fs from 'node:fs';
import path from 'node:path';
import { Text } from 'react-native';

import { AuthProvider, useAuth } from '@application/providers/auth-provider';
import { OFFLINE_RECEIPT_KEY_FOR_TESTS } from '@services/auth/offline-receipt';
import { createFakeConnectivity, WIFI_ONLINE } from '@/test-support/fake-connectivity-port';

/**
 * What the app knows about somebody who never gave a name — issue #48.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── The defect ─────────────────────────────────────────────────────────────
 * `toProfile`'s fallback chain ended `?? user.email ?? 'Friend'`, and `UserProfile.fullName` was a
 * required string — so something always had to go there, and what went there was the sign-in address.
 * An account that never supplied a name (a provider sign-in carrying none, a signup without metadata)
 * had its address rendered as its *name*, most prominently as Main Home's greeting.
 *
 * ── The boundary that fixes it ─────────────────────────────────────────────
 * A required field cannot express "we do not know", so it invited a guess — and every available guess
 * is wrong: the address is not a name, its local part is not a name, and initials from either are a
 * fabrication. `fullName` and `givenName` are now **absent** when no genuine name exists, and each
 * consumer applies the neutral value it already had. The address is still carried in `email`, where it
 * is labelled as what it is.
 *
 * These cases are the provider's half of that contract. Where Main Home *renders* it is
 * `main-home-neutral-greeting.test.tsx`.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const NAMED = {
  id: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa',
  email: 'named@example.com',
  fullName: 'Ahmed Al-Rashid',
  avatarUrl: null,
  emailConfirmed: true,
};

/** An account whose session carries no name at all — only an address. */
const NAMELESS = {
  id: 'cccccccc-3333-4333-8333-cccccccccccc',
  email: 'nameless@example.com',
  fullName: null,
  avatarUrl: null,
  emailConfirmed: true,
};

const OTHER = {
  id: 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb',
  email: 'other@example.com',
  fullName: 'Second Person',
  avatarUrl: null,
  emailConfirmed: true,
};

const mockResolveSession = jest.fn();
const mockGetProfile = jest.fn();
const mockSubscribe = jest.fn();
let emitAuthEvent: ((change: { event: string; user: typeof NAMED | null }) => void) | null = null;

jest.mock('@services/auth/auth.service', () => ({
  resolveSession: (...args: unknown[]) => mockResolveSession(...args),
  getProfile: (...args: unknown[]) => mockGetProfile(...args),
  subscribeToAuthChanges: (listener: (change: never) => void) => mockSubscribe(listener),
  signOut: jest.fn().mockResolvedValue(undefined),
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

const mockSecureGet = jest.fn();
const mockSecureSet = jest.fn();
jest.mock('expo-secure-store', () => ({
  getItemAsync: (...args: unknown[]) => mockSecureGet(...args),
  setItemAsync: (...args: unknown[]) => mockSecureSet(...args),
  deleteItemAsync: jest.fn().mockResolvedValue(undefined),
}));

function receiptJson(displayName: string, userId = NAMELESS.id) {
  return JSON.stringify({
    version: 1,
    userId,
    displayName,
    avatarUrl: null,
    hasCompletedOnboarding: true,
    validatedAt: 0,
    updatedAt: 0,
  });
}

function receiptWrites(): { userId: string; displayName: string }[] {
  return mockSecureSet.mock.calls
    .filter(([key]) => key === OFFLINE_RECEIPT_KEY_FOR_TESTS)
    .map(([, value]) => JSON.parse(String(value)) as { userId: string; displayName: string });
}

function deferred<T>() {
  let settle: (value: T) => void = () => undefined;
  const promise = new Promise<T>((resolveIt) => {
    settle = resolveIt;
  });
  return { promise, settle };
}

type Snapshot = {
  readonly status: string;
  readonly authority: string;
  readonly fullName: string | undefined;
  readonly givenName: string | undefined;
  readonly email: string | undefined;
};

const seen: Snapshot[] = [];

function Probe() {
  const state = useAuth();
  const key = `${state.status}:${state.authority ?? 'none'}:${state.user?.fullName ?? '·'}:${state.user?.givenName ?? '·'}:${state.user?.email ?? '·'}`;
  useEffect(() => {
    seen.push({
      status: state.status,
      authority: state.authority ?? 'none',
      fullName: state.user?.fullName,
      givenName: state.user?.givenName,
      email: state.user?.email,
    });
  }, [key, state]);
  return <Text testID="probe">{key}</Text>;
}

async function launch() {
  return await render(
    <AuthProvider connectivity={createFakeConnectivity(WIFI_ONLINE)}>
      <Probe />
    </AuthProvider>,
  );
}

async function settle(ms = 0) {
  await act(async () => {
    if (ms > 0) {
      jest.advanceTimersByTime(ms);
    }
    for (let i = 0; i < 40; i += 1) {
      await Promise.resolve();
    }
  });
}

const current = () => seen.at(-1);

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(0);
  seen.length = 0;
  mockResolveSession.mockReset().mockResolvedValue({ kind: 'authenticated', user: NAMELESS });
  mockGetProfile.mockReset().mockResolvedValue(null);
  emitAuthEvent = null;
  mockSubscribe.mockReset().mockImplementation((listener: typeof emitAuthEvent) => {
    emitAuthEvent = listener;
    return () => undefined;
  });
  mockSecureGet.mockReset().mockResolvedValue(null);
  mockSecureSet.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  jest.useRealTimers();
});

// ─────────────────────────────────────────────────────────────────────────────
// The address is never a name
// ─────────────────────────────────────────────────────────────────────────────

describe('an account that never gave a name', () => {
  it('has no name at all, and still has its address', async () => {
    await launch();
    await settle();

    /*
      The whole fix in one assertion. Absent, not a placeholder and not the address — so every consumer
      reaches its own neutral value, and none of them is handed something to render as a name.
    */
    expect(current()?.status).toBe('signed-in');
    expect(current()?.fullName).toBeUndefined();
    expect(current()?.givenName).toBeUndefined();
    /* And the address is still there, in the field that means "address". */
    expect(current()?.email).toBe(NAMELESS.email);
  });

  it('never carries the address in a name field, at any point in the launch', async () => {
    mockGetProfile.mockReturnValue(deferred<null>().promise);
    await launch();
    await settle(60_000);

    for (const snapshot of seen) {
      expect(snapshot.fullName).not.toBe(NAMELESS.email);
      expect(snapshot.givenName).not.toBe(NAMELESS.email);
      /* Nor any part of it — the local part is a guess, not a name. */
      expect(snapshot.fullName ?? '').not.toContain('@');
      expect(snapshot.fullName ?? '').not.toBe('nameless');
      expect(snapshot.givenName ?? '').not.toBe('nameless');
    }
  });

  it('is not given a name by its own previous nameless launch', async () => {
    /*
      ═══════════════════════════════════════════════════════════════════════
      ── The seeding path had to be narrowed too ────────────────────────────
      `adopt` seeds the pre-enrichment name from the receipt, so a launch after a previous nameless one
      would read `NEUTRAL_DISPLAY_NAME` back out of storage and hand it over as a *name* — turning
      absence into a placeholder, and greeting "Assalamu Alaikum, Friend" where "there" belongs.

      The marker is a wire format, not a name, and it is refused here as such. A mutation that dropped
      this guard passed every other case in this file, which is why the case exists.
      ═══════════════════════════════════════════════════════════════════════
    */
    mockSecureGet.mockResolvedValue(receiptJson('Friend'));
    mockResolveSession.mockResolvedValue({ kind: 'authenticated', user: NAMELESS });
    mockGetProfile.mockResolvedValue(null);

    await launch();
    await settle();

    expect(current()?.authority).toBe('online');
    expect(current()?.fullName).toBeUndefined();
    expect(current()?.givenName).toBeUndefined();
  });

  it('writes no address into the receipt, and no name it does not have', async () => {
    await launch();
    await settle();

    const written = receiptWrites();
    expect(written).toHaveLength(1);
    expect(JSON.stringify(written)).not.toContain('@');
    /* The neutral name is the wire form of "no name known", because the record cannot store absence. */
    expect(written[0]?.displayName).toBe('Friend');
  });
});

describe('an account that did give a name', () => {
  it('keeps it, and derives the given name from it', async () => {
    mockResolveSession.mockResolvedValue({ kind: 'authenticated', user: NAMED });
    await launch();
    await settle();

    expect(current()?.fullName).toBe('Ahmed Al-Rashid');
    expect(current()?.givenName).toBe('Ahmed');
  });

  it('takes the durable row over the session copy when it arrives', async () => {
    const profile = deferred<{
      id: string;
      full_name: string;
      avatar_url: null;
      onboarding_completed: boolean;
    }>();
    mockResolveSession.mockResolvedValue({ kind: 'authenticated', user: NAMED });
    mockGetProfile.mockReturnValue(profile.promise);

    await launch();
    await settle();
    expect(current()?.givenName).toBe('Ahmed');

    profile.settle({
      id: NAMED.id,
      full_name: 'Ahmed Renamed',
      avatar_url: null,
      onboarding_completed: true,
    });
    await settle();

    expect(current()?.fullName).toBe('Ahmed Renamed');
    expect(current()?.givenName).toBe('Ahmed');
  });

  it('gains a name mid-launch when the durable row supplies one it never had', async () => {
    const profile = deferred<{
      id: string;
      full_name: string;
      avatar_url: null;
      onboarding_completed: boolean;
    }>();
    mockGetProfile.mockReturnValue(profile.promise);

    await launch();
    await settle();
    /* Nameless, so nothing to greet by yet. */
    expect(current()?.givenName).toBeUndefined();

    profile.settle({
      id: NAMELESS.id,
      full_name: 'Later Name',
      avatar_url: null,
      onboarding_completed: true,
    });
    await settle();

    /* Enrichment is allowed to supply what the session lacked — for this account. */
    expect(current()?.fullName).toBe('Later Name');
    expect(current()?.givenName).toBe('Later');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Offline, and legacy records
// ─────────────────────────────────────────────────────────────────────────────

describe('an offline launch', () => {
  it('reads the neutral marker back as absence, not as a name', async () => {
    /*
      Otherwise a nameless account would read "Assalamu Alaikum, Friend" offline and "…, there" online:
      two different neutral answers to one question. The marker is a wire format, not a name.
    */
    mockSecureGet.mockResolvedValue(receiptJson('Friend'));
    mockResolveSession.mockResolvedValue({ kind: 'retryable-offline' });

    await launch();
    await settle();

    expect(current()?.authority).toBe('offline');
    expect(current()?.fullName).toBeUndefined();
    expect(current()?.givenName).toBeUndefined();
  });

  it('restores a real name from a receipt that holds one', async () => {
    mockSecureGet.mockResolvedValue(receiptJson('Ahmed Al-Rashid', NAMED.id));
    mockResolveSession.mockResolvedValue({ kind: 'retryable-offline' });

    await launch();
    await settle();

    expect(current()?.authority).toBe('offline');
    expect(current()?.givenName).toBe('Ahmed');
  });

  it('does not greet by a legacy receipt’s address, and heals it online', async () => {
    /*
      A device upgraded from a build that wrote the address keeps that record until something replaces
      it. Offline it is still shown as a name — that record is all this device has, and it is this
      account's own data — but the next validated online launch overwrites it with the neutral marker,
      because the projection no longer produces the address. No migration; the write is the repair.
    */
    mockSecureGet.mockResolvedValue(receiptJson('nameless@example.com'));
    mockResolveSession.mockResolvedValue({ kind: 'authenticated', user: NAMELESS });

    await launch();
    await settle();

    expect(current()?.fullName).toBeUndefined();
    const written = receiptWrites();
    expect(written).toHaveLength(1);
    expect(written[0]?.displayName).toBe('Friend');
    expect(JSON.stringify(written)).not.toContain('@');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Whose name is it
// ─────────────────────────────────────────────────────────────────────────────

describe('a name that arrives too late', () => {
  it('cannot give account B the name read for account A', async () => {
    const profileA = deferred<{
      id: string;
      full_name: string;
      avatar_url: null;
      onboarding_completed: boolean;
    }>();
    mockGetProfile.mockReturnValueOnce(profileA.promise).mockResolvedValue(null);

    await launch();
    await settle();

    await act(async () => {
      emitAuthEvent?.({ event: 'SIGNED_IN', user: OTHER });
      await Promise.resolve();
    });
    await settle();
    expect(current()?.fullName).toBe('Second Person');

    profileA.settle({
      id: NAMELESS.id,
      full_name: 'Account A Name',
      avatar_url: null,
      onboarding_completed: true,
    });
    await settle();

    expect(current()?.fullName).toBe('Second Person');
    expect(seen.map((s) => s.fullName)).not.toContain('Account A Name');
  });

  it('cannot name a signed-out state', async () => {
    const profile = deferred<{
      id: string;
      full_name: string;
      avatar_url: null;
      onboarding_completed: boolean;
    }>();
    mockGetProfile.mockReturnValue(profile.promise);

    await launch();
    await settle();

    await act(async () => {
      emitAuthEvent?.({ event: 'SIGNED_OUT', user: null });
      await Promise.resolve();
    });
    await settle();

    profile.settle({
      id: NAMELESS.id,
      full_name: 'Late Name',
      avatar_url: null,
      onboarding_completed: true,
    });
    await settle();

    expect(current()?.status).toBe('signed-out');
    expect(seen.map((s) => s.fullName)).not.toContain('Late Name');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The source cannot quietly grow the rung back
// ─────────────────────────────────────────────────────────────────────────────

describe('the fallback chain', () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), 'src/application/providers/auth-provider.tsx'),
    'utf8',
  );

  /**
   * `toProfile`'s body with comments removed.
   *
   * Stripping them is not tidiness. The first version of this scan matched `?? user.email` inside the
   * comment that *explains* why that rung was removed — so the guard failed on prose describing the
   * very defect it guards against. That is the failure mode which has made source scans in this
   * project untrustworthy before, and it cuts both ways: a scan that reads documentation as code would
   * also pass if somebody restored the rung and deleted the comment.
   */
  function toProfileCode(): string {
    const start = source.indexOf('function toProfile(');
    expect(start).toBeGreaterThan(-1);
    const end = source.indexOf('\n}', start);
    expect(end).toBeGreaterThan(start);
    return source
      .slice(start, end)
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/\/\/[^\n]*/g, ' ');
  }

  it('does not fall back to the address for a name', () => {
    /*
      A scan, narrowly scoped to the one function, because this is the rung that caused #48 and it is
      cheap to add back by accident — `?? user.email` reads like a harmless default. The assertion is
      on the *name* chain only; `email` is spread into its own field a few lines below and must stay.
    */
    const body = toProfileCode();
    expect(body).toContain('durableFullName ?? user.fullName ?? null');
    expect(body).not.toMatch(/\?\?\s*user\.email/);
  });

  it('still carries the address in the address field', () => {
    /* The other half: nothing here removes the account identity, it only stops it being a name. */
    expect(toProfileCode()).toContain('{ email: user.email }');
  });

  it('derives the given name only from a name it has', () => {
    const body = toProfileCode();
    /* `givenNameOf` is reachable only inside the branch that has a real name. */
    expect(body).toMatch(
      /full === null \? \{\} : \{ fullName: full, givenName: givenNameOf\(full\) \}/,
    );
  });
});
