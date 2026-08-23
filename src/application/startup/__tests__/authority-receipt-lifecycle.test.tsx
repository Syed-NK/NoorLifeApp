import { act, render } from '@testing-library/react-native';
import { StrictMode, useEffect } from 'react';
import { Text } from 'react-native';

import { AuthProvider, useAuth } from '@application/providers/auth-provider';
import { OFFLINE_RECEIPT_KEY_FOR_TESTS } from '@services/auth/offline-receipt';
import { createFakeConnectivity, WIFI_ONLINE } from '@/test-support/fake-connectivity-port';

/**
 * The receipt's lifecycle when profile enrichment is slow, failing, or never arrives.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── The invariant these cases exist for ────────────────────────────────────
 * Once Supabase has validated a live session and online authority is published, a token-free receipt
 * must be persisted **promptly**, on the strength of the validated session alone. It must not wait on
 * `getProfile()`, because a device that loses the process during a slow profile read would otherwise
 * come back with no permitted-offline authority at all — the user's downloaded Qur'an locked behind a
 * sign-in screen because a display name was slow.
 *
 * That splits the receipt into two distinct writes with different purposes, and the whole point of
 * this suite is to keep them apart:
 *
 *   • **the authority receipt** — written once online authority exists. Not optional, not deferrable,
 *     and not cancellable merely because enrichment is pending;
 *   • **the enrichment receipt** — an optional, deduplicated update when the durable row turns out to
 *     hold different values. Cancellable when a newer projection supersedes it.
 *
 * One writer still performs both. The distinction is in what may stop each of them.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const USER = {
  id: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa',
  email: 'a@example.com',
  fullName: 'Signup Name',
  avatarUrl: null,
  emailConfirmed: true,
};

/** An account whose session carries no name at all — only an address. */
const NAMELESS_USER = {
  id: 'cccccccc-3333-4333-8333-cccccccccccc',
  email: 'nameless@example.com',
  fullName: null,
  avatarUrl: null,
  emailConfirmed: true,
};

const OTHER_USER = {
  id: 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb',
  email: 'b@example.com',
  fullName: 'Second Person',
  avatarUrl: null,
  emailConfirmed: true,
};

const mockResolveSession = jest.fn();
const mockGetProfile = jest.fn();
const mockSubscribe = jest.fn();
let emitAuthEvent: ((change: { event: string; user: typeof USER | null }) => void) | null = null;

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
const mockSecureDelete = jest.fn();
jest.mock('expo-secure-store', () => ({
  getItemAsync: (...args: unknown[]) => mockSecureGet(...args),
  setItemAsync: (...args: unknown[]) => mockSecureSet(...args),
  deleteItemAsync: (...args: unknown[]) => mockSecureDelete(...args),
}));

type Written = {
  readonly userId: string;
  readonly displayName: string;
  readonly hasCompletedOnboarding: boolean;
};

/** Every write aimed at the receipt key, in order, so a sequence can be asserted rather than a count. */
function writes(): Written[] {
  return mockSecureSet.mock.calls
    .filter(([key]) => key === OFFLINE_RECEIPT_KEY_FOR_TESTS)
    .map(([, value]) => JSON.parse(String(value)) as Written);
}

/** What the store would hand back after the writes so far — the receipt as it now stands. */
function currentStored(): string | null {
  const last = mockSecureSet.mock.calls
    .filter(([key]) => key === OFFLINE_RECEIPT_KEY_FOR_TESTS)
    .at(-1);
  return last === undefined ? null : String(last[1]);
}

function storedReceipt(displayName: string, userId = USER.id) {
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

function profileRow(fullName: string | null, id = USER.id) {
  return { id, full_name: fullName, avatar_url: null, onboarding_completed: true };
}

function deferred<T>() {
  let settle: (value: T) => void = () => undefined;
  let reject: (reason: unknown) => void = () => undefined;
  const promise = new Promise<T>((resolveIt, rejectIt) => {
    settle = resolveIt;
    reject = rejectIt;
  });
  return { promise, settle, reject };
}

const seen: string[] = [];

function Probe() {
  const state = useAuth();
  const key = `${state.status}:${state.authority ?? 'none'}:${state.user?.fullName ?? 'none'}`;
  useEffect(() => {
    if (seen.at(-1) !== key) {
      seen.push(key);
    }
  }, [key]);
  return <Text testID="probe">{key}</Text>;
}

function tree(strict = false) {
  const inner = (
    <AuthProvider connectivity={createFakeConnectivity(WIFI_ONLINE)}>
      <Probe />
    </AuthProvider>
  );
  return strict ? <StrictMode>{inner}</StrictMode> : inner;
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

/**
 * A store that answers with whatever was last written, rather than a fixed value.
 *
 * The deduplication being tested compares against what is *stored*, so a mock that always answers
 * "nothing" would make a second write look correct when it is redundant. This makes the store behave
 * like a store.
 */
function liveStore(initial: string | null = null) {
  mockSecureGet.mockImplementation(async (key: string) => {
    if (key !== OFFLINE_RECEIPT_KEY_FOR_TESTS) {
      return null;
    }
    return currentStored() ?? initial;
  });
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(0);
  seen.length = 0;
  mockResolveSession.mockReset().mockResolvedValue({ kind: 'authenticated', user: USER });
  mockGetProfile.mockReset().mockResolvedValue(null);
  emitAuthEvent = null;
  mockSubscribe.mockReset().mockImplementation((listener: typeof emitAuthEvent) => {
    emitAuthEvent = listener;
    return () => undefined;
  });
  mockSecureGet.mockReset().mockResolvedValue(null);
  mockSecureSet.mockReset().mockResolvedValue(undefined);
  mockSecureDelete.mockReset().mockResolvedValue(undefined);
  liveStore(null);
});

afterEach(() => {
  jest.useRealTimers();
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. A profile that takes a minute
// ─────────────────────────────────────────────────────────────────────────────

describe('a profile that takes a minute', () => {
  it('persists the authority receipt long before the profile answers', async () => {
    const profile = deferred<ReturnType<typeof profileRow>>();
    mockGetProfile.mockReturnValue(profile.promise);

    await render(tree());
    await settle();

    /*
      The invariant, at the point it matters. Authority exists, the profile has not answered, and the
      device already holds a receipt — so losing the process now costs the user nothing.
    */
    expect(seen.at(-1)).toBe('signed-in:online:Signup Name');
    expect(writes()).toHaveLength(1);
    expect(writes()[0]?.userId).toBe(USER.id);

    await settle(60_000);
    expect(writes()).toHaveLength(1);

    profile.settle(profileRow('Durable Name'));
    await settle();

    /* And the durable values arrive as exactly one further write. */
    expect(writes()).toHaveLength(2);
    expect(writes()[1]?.displayName).toBe('Durable Name');
  });

  it('leaks no identity that is not this account’s own', async () => {
    mockGetProfile.mockReturnValue(deferred<ReturnType<typeof profileRow>>().promise);

    await render(tree());
    await settle(60_000);

    for (const entry of seen.filter((s) => s.startsWith('signed-in'))) {
      expect(entry).not.toContain(':none');
      expect(entry).not.toContain('Friend');
      expect(entry).not.toContain('Second Person');
    }
    for (const written of writes()) {
      expect(written.userId).toBe(USER.id);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2–4. A profile that never arrives, or fails
// ─────────────────────────────────────────────────────────────────────────────

describe('a profile that never settles or fails outright', () => {
  it('leaves the authority receipt in place when the profile never resolves', async () => {
    mockGetProfile.mockReturnValue(new Promise(() => undefined));

    await render(tree());
    await settle(600_000);

    expect(writes()).toHaveLength(1);
    expect(writes()[0]?.userId).toBe(USER.id);
    expect(seen.at(-1)).toBe('signed-in:online:Signup Name');
  });

  it('leaves the authority receipt in place when the profile read rejects', async () => {
    mockGetProfile.mockRejectedValue(new Error('select profiles'));

    await render(tree());
    await settle();

    expect(writes()).toHaveLength(1);
    expect(writes()[0]?.userId).toBe(USER.id);
    expect(seen.at(-1)).toBe('signed-in:online:Signup Name');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5–6. How many writes, and in what order
// ─────────────────────────────────────────────────────────────────────────────

describe('the second write happens only when the durable values differ', () => {
  it('writes once when the durable row says what the session already said', async () => {
    mockGetProfile.mockResolvedValue(profileRow('Signup Name'));

    await render(tree());
    await settle();

    /* Nothing changed, so there is nothing to record twice. */
    expect(writes()).toHaveLength(1);
    expect(writes()[0]?.displayName).toBe('Signup Name');
  });

  it('writes nothing when a matching receipt is already stored', async () => {
    liveStore(storedReceipt('Durable Name'));
    mockGetProfile.mockResolvedValue(profileRow('Durable Name'));

    await render(tree());
    await settle();

    expect(writes()).toHaveLength(0);
  });

  it('writes twice, in order, when the durable row differs', async () => {
    const profile = deferred<ReturnType<typeof profileRow>>();
    mockGetProfile.mockReturnValue(profile.promise);

    await render(tree());
    await settle();
    profile.settle(profileRow('Durable Name'));
    await settle();

    const sequence = writes().map((w) => w.displayName);
    expect(sequence).toEqual(['Signup Name', 'Durable Name']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. The address must not become the display name
// ─────────────────────────────────────────────────────────────────────────────

describe('the receipt never carries an address', () => {
  it('writes no email when the session identity has only an address', async () => {
    mockResolveSession.mockResolvedValue({ kind: 'authenticated', user: NAMELESS_USER });
    mockGetProfile.mockResolvedValue(null);

    await render(tree());
    await settle();

    /*
      `offline-receipt.ts` **rejects** a stored record carrying an `email` field, deliberately, so the
      address does not sit in the Keystore. Reaching the same outcome by writing it under
      `displayName` would defeat that check by renaming the field, which is worse than not having the
      check — so no write may contain the address in any field.
    */
    expect(writes()).toHaveLength(1);
    const serialised = JSON.stringify(writes());
    expect(serialised).not.toContain(NAMELESS_USER.email);
    expect(serialised).not.toContain('@');
    expect(writes()[0]?.displayName.length).toBeGreaterThan(0);
  });

  it('replaces a stored record that already holds an address', async () => {
    /*
      A device upgraded from a build that wrote the address keeps that record until something replaces
      it. Nothing migrates it, and nothing needs to: the projection no longer produces that value, so
      the stored-value comparison fails and the next online launch overwrites it. The repair reaches
      existing devices without a migration, which is why none was written.
    */
    liveStore(storedReceipt('nameless@example.com', NAMELESS_USER.id));
    mockResolveSession.mockResolvedValue({ kind: 'authenticated', user: NAMELESS_USER });
    mockGetProfile.mockResolvedValue(null);

    await render(tree());
    await settle();

    expect(writes()).toHaveLength(1);
    expect(writes()[0]?.displayName).not.toContain('@');
    expect(JSON.stringify(writes())).not.toContain('nameless@example.com');
  });

  it('writes no email when the durable row is empty and only an address remains', async () => {
    mockResolveSession.mockResolvedValue({ kind: 'authenticated', user: NAMELESS_USER });
    mockGetProfile.mockResolvedValue(profileRow(null, NAMELESS_USER.id));

    await render(tree());
    await settle();

    expect(JSON.stringify(writes())).not.toContain('@');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. A replacement between the two writes
// ─────────────────────────────────────────────────────────────────────────────

describe('an account replacement between the two writes', () => {
  it('never lets account A’s durable row reach account B’s receipt', async () => {
    const profileA = deferred<ReturnType<typeof profileRow>>();
    mockGetProfile.mockReturnValueOnce(profileA.promise).mockResolvedValue(null);

    await render(tree());
    await settle();
    expect(writes()).toHaveLength(1);
    expect(writes()[0]?.userId).toBe(USER.id);

    await act(async () => {
      emitAuthEvent?.({ event: 'SIGNED_IN', user: OTHER_USER });
      await Promise.resolve();
    });
    await settle();

    profileA.settle(profileRow('Account A Name'));
    await settle();

    /* B's receipt is the last word, and A's late row never becomes part of it. */
    const all = writes();
    expect(all.at(-1)?.userId).toBe(OTHER_USER.id);
    expect(all.map((w) => w.displayName)).not.toContain('Account A Name');
    const afterReplacement = all.slice(1);
    for (const written of afterReplacement) {
      expect(written.userId).toBe(OTHER_USER.id);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. Repeated effects
// ─────────────────────────────────────────────────────────────────────────────

describe('repeated effects write nothing twice', () => {
  it('produces no equivalent duplicate inside a Strict Mode tree', async () => {
    mockGetProfile.mockResolvedValue(profileRow('Durable Name'));

    await render(tree(true));
    await settle();

    /*
      Whatever React chooses to re-run, no two writes may record the same durable values: the store is
      consulted before each one, so a repeat is caught even if an effect body runs twice.
    */
    const fingerprints = writes().map(
      (w) => `${w.userId}|${w.displayName}|${w.hasCompletedOnboarding}`,
    );
    expect(new Set(fingerprints).size).toBe(fingerprints.length);
  });

  it('offline authority refreshes nothing at all', async () => {
    liveStore(storedReceipt('Durable Name'));
    mockResolveSession.mockResolvedValue({ kind: 'retryable-offline' });

    await render(tree());
    await settle();

    /*
      An offline launch was read *from* the receipt, so re-writing it would refresh a validation
      timestamp on the strength of the record it came from — a claim about nothing.
    */
    expect(seen.at(-1)).toBe('signed-in:offline:Durable Name');
    expect(writes()).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Unmount between validation and enrichment — last, for the harness
// ─────────────────────────────────────────────────────────────────────────────

/*
  ── Last on purpose ─────────────────────────────────────────────────────────
  This case tears its tree down and then advances the clock, which leaves the act environment unable
  to resolve renders queued after it — every later test in the file would then find no state, which
  reads as a defect here and is only ever the harness.
*/
describe('a tree unmounted after validation but before enrichment', () => {
  it('has already persisted the authority receipt, and adds nothing after', async () => {
    const profile = deferred<ReturnType<typeof profileRow>>();
    mockGetProfile.mockReturnValue(profile.promise);

    const view = await render(tree());
    await settle();

    /*
      The receipt that preserves newly validated authority is not cancellable by the tree going away.
      There is no newer run to write it instead, so cancelling it would lose permitted-offline access
      outright — for a device that had a perfectly good session a moment ago.
    */
    expect(writes()).toHaveLength(1);
    expect(writes()[0]?.userId).toBe(USER.id);

    view.unmount();
    profile.settle(profileRow('Durable Name'));
    await settle(60_000);

    /* And no enrichment write follows a tree that no longer exists. */
    expect(writes()).toHaveLength(1);
    expect(writes().map((w) => w.displayName)).not.toContain('Durable Name');
  });
});
