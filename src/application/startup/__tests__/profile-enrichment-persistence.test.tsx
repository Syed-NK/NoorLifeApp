import { act, render } from '@testing-library/react-native';
import { StrictMode, useEffect } from 'react';
import { Text } from 'react-native';

import { AuthProvider, useAuth } from '@application/providers/auth-provider';
import { OFFLINE_RECEIPT_KEY_FOR_TESTS } from '@services/auth/offline-receipt';
import { createFakeConnectivity, WIFI_ONLINE } from '@/test-support/fake-connectivity-port';

/**
 * Profile enrichment, and the receipt it implies — without an impure updater.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── What this replaced ─────────────────────────────────────────────────────
 * Enrichment used to set an outer boolean from inside a `setState` updater and then decide whether to
 * write the receipt from it. React is entitled to evaluate an updater more than once and does so in
 * development, so that made an updater impure *and* put a side effect behind it — two writers for one
 * account-scoped record, needing a flag passed between them to agree when the values were final.
 *
 * The receipt is now a **projection of published online authority**, persisted by one effect keyed on
 * the durable values themselves. Nothing signals anything: the state is the record, and there is
 * nothing left to gate.
 *
 * ── Why the stale-account check is still sound in both places ──────────────
 * It is only made once. The updater checks that the row belongs to whoever is signed in *now*; a row
 * that fails it changes nothing, so it contributes nothing to project. Persistence then reads the
 * published state, so it inherits that check rather than repeating it — and what it inherits is
 * stronger than the original question, because the projection is re-derived on every publication
 * rather than captured when some read began.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const USER = {
  id: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa',
  email: 'a@example.com',
  fullName: 'Signup Name',
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

/** Every write aimed at the receipt key, so a write to anything else cannot be miscounted. */
function receiptWrites(): { userId: string; displayName: string }[] {
  return mockSecureSet.mock.calls
    .filter(([key]) => key === OFFLINE_RECEIPT_KEY_FOR_TESTS)
    .map(([, value]) => JSON.parse(String(value)) as { userId: string; displayName: string });
}

function storedReceipt(displayName: string, userId = USER.id, onboarded = true) {
  return JSON.stringify({
    version: 1,
    userId,
    displayName,
    avatarUrl: null,
    hasCompletedOnboarding: onboarded,
    validatedAt: 0,
    updatedAt: 0,
  });
}

function profileRow(fullName: string | null, onboarded: boolean | null = true) {
  return {
    id: USER.id,
    full_name: fullName,
    avatar_url: null,
    onboarding_completed: onboarded,
  };
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

const authorities: string[] = [];

function Probe() {
  const state = useAuth();
  const key = `${state.status}:${state.authority ?? 'none'}:${state.user?.fullName ?? 'none'}`;
  useEffect(() => {
    if (authorities.at(-1) !== key) {
      authorities.push(key);
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

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(0);
  authorities.length = 0;
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
});

afterEach(() => {
  jest.useRealTimers();
});

// ─────────────────────────────────────────────────────────────────────────────
// How many times the receipt is written
// ─────────────────────────────────────────────────────────────────────────────

describe('the receipt is written once per distinct set of durable values', () => {
  it('writes exactly once, and never the value it was about to supersede', async () => {
    /* No receipt yet, and the durable name differs from the session copy — one genuine change. */
    mockSecureGet.mockResolvedValue(null);
    mockGetProfile.mockResolvedValue(profileRow('Durable Name'));

    await launchAndSettle();

    /*
      One write **in total**, not merely one carrying the durable name. Publication projects the
      session copy and enrichment projects the durable one, so there are two candidate values and a
      naive persister would store both — writing a name it already knows is about to be replaced.

      The intermediate write is cancelled rather than deduplicated: the key changes while the first
      attempt is still reading the stored value, the cleanup fires, and that attempt returns without
      writing. Asserting the total is what makes the cancellation observable; asserting only the
      durable name would pass with the cancellation removed.
    */
    const writes = receiptWrites();
    expect(writes).toHaveLength(1);
    expect(writes[0]?.displayName).toBe('Durable Name');
    expect(writes.map((r) => r.displayName)).not.toContain('Signup Name');
  });

  it('writes nothing at all under offline authority', async () => {
    /*
      An offline launch was *read from* a receipt, so re-writing it would refresh a validation
      timestamp on the strength of the record it came from — a claim about nothing. The projection is
      null for anything but `online`, which is what keeps that impossible rather than merely unlikely.
    */
    mockSecureGet.mockResolvedValue(storedReceipt('Durable Name'));
    mockResolveSession.mockResolvedValue({ kind: 'retryable-offline' });

    await launchAndSettle();

    expect(authorities.at(-1)).toBe('signed-in:offline:Durable Name');
    expect(receiptWrites()).toHaveLength(0);
    expect(mockGetProfile).not.toHaveBeenCalled();
  });

  it('writes nothing at all when the stored values already match', async () => {
    /*
      The returning-user case, and the one the deduplication exists for. The receipt already holds the
      durable name, so publication seeds from it and enrichment confirms it: the projection never
      changes, so the effect never re-runs, and the stored-value comparison catches the first run.
    */
    mockSecureGet.mockResolvedValue(storedReceipt('Durable Name'));
    mockGetProfile.mockResolvedValue(profileRow('Durable Name'));

    await launchAndSettle();

    expect(receiptWrites()).toHaveLength(0);
  });

  it('writes once when the durable name has changed on the server', async () => {
    mockSecureGet.mockResolvedValue(storedReceipt('Old Name'));
    mockGetProfile.mockResolvedValue(profileRow('Renamed Person'));

    await launchAndSettle();

    const writes = receiptWrites();
    expect(writes).toHaveLength(1);
    expect(writes[0]?.displayName).toBe('Renamed Person');
  });

  it('does not write again once the values have settled', async () => {
    mockSecureGet.mockResolvedValue(null);
    mockGetProfile.mockResolvedValue(profileRow('Durable Name'));

    await launchAndSettle();
    const before = receiptWrites().length;
    expect(before).toBeGreaterThan(0);

    /*
      Nothing is gated on a per-evaluation flag any more, so nothing can repeat a write once the
      durable values stop moving: the effect is keyed on those values, and they have not moved. Driven
      by the clock rather than by a second `update()` call — re-rendering the tree from inside a test
      overlaps act in a project with no act environment, and every later render in the file then fails
      to resolve, which reads as a defect here and is only ever the harness.
    */
    await settle(120_000);

    expect(receiptWrites()).toHaveLength(before);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Repeated evaluation, which React is entitled to do
// ─────────────────────────────────────────────────────────────────────────────

describe('repeated evaluation cannot duplicate anything', () => {
  it('writes once inside a Strict Mode tree', async () => {
    /*
      ── What this does and does not demonstrate ──────────────────────────────
      It demonstrates that a Strict Mode tree reaches the same single write as a plain one.

      It does **not** demonstrate survival of a double-invoked effect, and it would be dishonest to
      claim otherwise: measured in this environment, a Strict Mode tree produces the same two receipt
      reads and one write as a plain tree, so React is not re-running these effects here. The
      guarantee against a duplicate write therefore rests on the three mechanisms that *are*
      observable — the value key, the cleanup that cancels a superseded attempt, and the stored-value
      comparison — each pinned by its own case above.
    */
    mockSecureGet.mockResolvedValue(null);
    mockGetProfile.mockResolvedValue(profileRow('Durable Name'));

    await render(tree(true));
    await settle();

    expect(receiptWrites()).toHaveLength(1);
    expect(receiptWrites()[0]?.displayName).toBe('Durable Name');
  });

  it('keeps authority published throughout', async () => {
    mockSecureGet.mockResolvedValue(null);
    mockGetProfile.mockResolvedValue(profileRow('Durable Name'));

    await launchAndSettle();

    /*
      Authority is published before enrichment and is never withdrawn by it. Every state after the
      first signed-in one is still signed-in and still online — enrichment refines, it does not decide.
    */
    const signedIn = authorities.filter((a) => a.startsWith('signed-in'));
    expect(signedIn.length).toBeGreaterThan(0);
    for (const entry of signedIn) {
      expect(entry).toContain('signed-in:online');
    }
    expect(authorities.at(-1)).toBe('signed-in:online:Durable Name');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// A response that arrives into a different world
// ─────────────────────────────────────────────────────────────────────────────

describe('a profile response that can no longer be applied writes nothing', () => {
  it('is inert when the user signed out between response and application', async () => {
    const profile = deferred<ReturnType<typeof profileRow>>();
    mockSecureGet.mockResolvedValue(null);
    mockGetProfile.mockReturnValue(profile.promise);

    await launchAndSettle();
    const before = receiptWrites().length;

    await act(async () => {
      emitAuthEvent?.({ event: 'SIGNED_OUT', user: null });
      await Promise.resolve();
    });
    await settle();

    profile.settle(profileRow('Durable Name'));
    await settle();

    /*
      The updater finds no signed-in user, so nothing merges; the projection is null for a signed-out
      state, so nothing is persisted. Neither needed a check of its own for this case.
    */
    expect(receiptWrites().filter((r) => r.displayName === 'Durable Name')).toHaveLength(0);
    expect(receiptWrites()).toHaveLength(before);
    expect(authorities.at(-1)).toContain('signed-out');
  });

  it('cannot write account A’s values under account B', async () => {
    const profileA = deferred<ReturnType<typeof profileRow>>();
    mockSecureGet.mockResolvedValue(null);
    mockGetProfile.mockReturnValueOnce(profileA.promise).mockResolvedValue(null);

    await launchAndSettle();

    await act(async () => {
      emitAuthEvent?.({ event: 'SIGNED_IN', user: OTHER_USER });
      await Promise.resolve();
    });
    await settle();

    profileA.settle(profileRow('Account A Name'));
    await settle();

    /* No write carries A's name, and no write carries A's id while B is current. */
    const writes = receiptWrites();
    expect(writes.map((r) => r.displayName)).not.toContain('Account A Name');
    expect(
      writes.filter((r) => r.userId === USER.id && writes.indexOf(r) === writes.length - 1),
    ).toHaveLength(0);
    expect(writes.at(-1)?.userId).toBe(OTHER_USER.id);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// A write that fails
// ─────────────────────────────────────────────────────────────────────────────

describe('a receipt write that fails changes nothing else', () => {
  it('keeps authority, the live profile and the session', async () => {
    mockSecureGet.mockResolvedValue(null);
    mockSecureSet.mockRejectedValue(new Error('keystore unavailable'));
    mockGetProfile.mockResolvedValue(profileRow('Durable Name'));

    await launchAndSettle();

    /*
      The receipt is a convenience for the *next* launch. Failing to refresh it must not revoke this
      launch's authority, alter the name on screen, or sign anybody out — and there is no retry, since
      the next publication projects the same values and the next launch will try again.
    */
    expect(authorities.at(-1)).toBe('signed-in:online:Durable Name');
    expect(mockSecureDelete).not.toHaveBeenCalled();
  });

  it('does not stop the enrichment it was persisting', async () => {
    mockSecureGet.mockResolvedValue(storedReceipt('Old Name'));
    mockSecureSet.mockRejectedValue(new Error('keystore unavailable'));
    mockGetProfile.mockResolvedValue(profileRow('Renamed Person'));

    await launchAndSettle();

    /* The name the user sees comes from state, not from whether the record was persisted. */
    expect(authorities.at(-1)).toBe('signed-in:online:Renamed Person');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Nothing account-shaped is ever wrong on the way there
// ─────────────────────────────────────────────────────────────────────────────

describe('no stale identity is ever published', () => {
  it('publishes only real names for this account, in order', async () => {
    mockSecureGet.mockResolvedValue(null);
    mockGetProfile.mockResolvedValue(profileRow('Durable Name'));

    await launchAndSettle();

    const names = authorities.filter((a) => a.startsWith('signed-in')).map((a) => a.split(':')[2]);
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      expect(name).not.toBe('');
      expect(name).not.toBe('none');
      expect(name).not.toBe('Friend');
      expect(name).not.toBe('Second Person');
      expect(name).not.toBe('Account A Name');
    }
    expect(names.at(-1)).toBe('Durable Name');
  });
});

/** Mounts, drains the launch and returns the view. Declared last; used throughout. */
async function launchAndSettle() {
  const view = await render(tree());
  await settle();
  return view;
}

/*
  ── Last on purpose, and that is a harness constraint ────────────────────────
  This case settles a promise *after* tearing its tree down, which leaves the act environment unable to
  resolve renders queued after it — every later test in the file then finds no state at all, which
  reads as a defect in the provider and is only ever the harness. It runs last so nothing follows it.
*/
describe('a profile response arriving after unmount', () => {
  it('abandons a persistence attempt whose read is still in flight at unmount', async () => {
    /*
      ═══════════════════════════════════════════════════════════════════════
      ── The case the cleanup exists for, and the only one that shows it ────
      Publication and enrichment for one account land in the same React commit, so the persistence
      effect ordinarily runs **once** per launch and its cleanup never fires. Measured: two receipt
      reads per launch — one of them `adopt`'s own seeding read — and one write. Every other case in
      this file therefore passes with the cancellation check deleted, which it was until this one.

      So the effect's read is held open while `adopt`'s is not: the first read resolves at once, the
      second waits on a timer this test controls. The tree is then unmounted while that read is
      pending. The attempt must return without writing — a launch the user abandoned must not leave a
      refreshed receipt behind, and a write into a torn-down tree is not something React undoes.
      ═══════════════════════════════════════════════════════════════════════
    */
    const HELD_MS = 50;
    mockSecureGet.mockResolvedValueOnce(null).mockImplementation(
      () =>
        new Promise((resolveIt) => {
          setTimeout(() => resolveIt(null), HELD_MS);
        }),
    );
    mockGetProfile.mockResolvedValue(null);

    const view = await render(tree());
    await settle();
    expect(authorities.at(-1)).toBe('signed-in:online:Signup Name');
    expect(receiptWrites()).toHaveLength(0);

    await view.unmount();
    await settle(HELD_MS * 4);

    expect(receiptWrites()).toHaveLength(0);
  });

  it('is inert after unmount', async () => {
    const profile = deferred<ReturnType<typeof profileRow>>();
    mockSecureGet.mockResolvedValue(null);
    mockGetProfile.mockReturnValue(profile.promise);

    const view = await launchAndSettle();
    const before = receiptWrites().length;

    await view.unmount();
    profile.settle(profileRow('Durable Name'));
    await settle();

    /* React discards the update, so nothing is projected and the effect that would persist is gone. */
    expect(receiptWrites()).toHaveLength(before);
    expect(receiptWrites().map((r) => r.displayName)).not.toContain('Durable Name');
  });
});
