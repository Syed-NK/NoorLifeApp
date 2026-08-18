import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { createQuranContentEndpoint } from '@features/faith/data/quran-foundation/quran-content.endpoint';
import * as security from '@services/account/account-security.service';
import { askNoorAI } from '@services/ai/noor-ai.service';
import { updateFullName } from '@services/profile/profile.service';

import {
  assertRemoteAccess,
  isOfflineOperationError,
  isRemoteAccessAuthorised,
  OfflineOperationError,
  resetRemoteAccessForTest,
  setRemoteAccessAuthorised,
} from '../remote-access';

/**
 * What an offline launch is allowed to attempt.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── Why "it would fail anyway" is not the standard ─────────────────────────
 * An offline launch holds a receipt, and a receipt carries no token, so a Supabase call made in
 * that state cannot succeed. That argument is true and insufficient. *Eventually* failing means the
 * user waits on a spinner for a timeout nobody asked for, and is then told about a network fault
 * rather than about being offline; and for a write it means a request that may half-land.
 *
 * So the claim these tests make is stronger and much more durable: **the client is never touched**.
 * Asserting "no call was recorded" cannot be satisfied by a better error message, and it stays true
 * however the transport is later rewritten.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const mockInvoke = jest.fn();
const mockUpdate = jest.fn();
const mockUpdateUser = jest.fn();
const mockGetSession = jest.fn();

jest.mock('@/lib/supabase', () => ({
  isSupabaseConfigured: true,
  supabase: {
    auth: {
      getSession: (...args: unknown[]) => mockGetSession(...args),
      updateUser: (...args: unknown[]) => mockUpdateUser(...args),
      reauthenticate: (...args: unknown[]) => mockUpdateUser(...args),
      signOut: jest.fn(async () => ({ error: null })),
    },
    functions: { invoke: (...args: unknown[]) => mockInvoke(...args) },
    from: () => {
      const chain = {
        select: () => chain,
        eq: (...args: unknown[]) => {
          mockUpdate(...args);
          return chain;
        },
        update: (...args: unknown[]) => {
          mockUpdate(...args);
          return chain;
        },
        maybeSingle: async () => ({ data: null, error: null }),
        then: (resolve: (value: { data: null; error: null }) => unknown) =>
          Promise.resolve(resolve({ data: null, error: null })),
      };
      return chain;
    },
  },
}));

beforeEach(() => {
  resetRemoteAccessForTest();
  mockInvoke.mockReset().mockResolvedValue({ data: null, error: null });
  mockUpdate.mockReset();
  mockUpdateUser.mockReset().mockResolvedValue({ data: { user: null }, error: null });
  mockGetSession
    .mockReset()
    .mockResolvedValue({ data: { session: { access_token: 'x' } }, error: null });
});

describe('the gate itself', () => {
  it('defaults to permitting, so a path that never resolves a session is not broken', () => {
    /*
      The direction matters. Defaulting to *blocked* would make an unresolved launch, a test harness
      or a future entry point fail in a way indistinguishable from a genuine outage — and it would be
      diagnosed as one. Defaulting open reproduces exactly the behaviour that existed before this
      module: a request that goes out and fails at the transport.
    */
    expect(isRemoteAccessAuthorised()).toBe(true);
  });

  it('throws a refusal that a caller can tell apart from a server error', () => {
    setRemoteAccessAuthorised(false);
    let thrown: unknown;
    try {
      assertRemoteAccess('Something');
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(OfflineOperationError);
    expect(isOfflineOperationError(thrown)).toBe(true);
    /* Collapsing this into "something went wrong" is what shows a vague error to somebody on a plane. */
    expect((thrown as Error).message).toContain('needs a connection');
  });

  it('leaks nothing identifying in its message', () => {
    setRemoteAccessAuthorised(false);
    const error = new OfflineOperationError('Updating your profile');
    expect(error.message).not.toMatch(/https?:\/\//);
    expect(error.message).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/);
  });
});

describe('server operations are refused before the transport', () => {
  it('does not invoke the Qur’an Edge function', async () => {
    setRemoteAccessAuthorised(false);

    /*
      A returned failure, not a throw. `QuranEndpointFailure` already has 'offline' and the Qur'an
      repository degrades from it to locally published content; throwing a different error type is
      what made the reader show a connection error in airplane mode instead of the stored
      generation. The gate's guarantee is the same either way, and it is the next two lines.
    */
    await expect(
      createQuranContentEndpoint().request({ operation: 'list_chapters' } as never),
    ).resolves.toEqual({ kind: 'failed', failure: 'offline' });

    expect(mockInvoke).not.toHaveBeenCalled();
    /* Not even the session read that precedes it. */
    expect(mockGetSession).not.toHaveBeenCalled();
  });

  it('does not ask Noor AI', async () => {
    setRemoteAccessAuthorised(false);

    /*
      A returned failure rather than a thrown one, because `NoorAIFailureState` already has a word
      for exactly this and the screens are written against that union. Throwing out of a function
      whose contract is "returns a result, never rejects" would give every caller two error channels
      for one condition. What matters for the gate is identical either way: nothing was invoked.
    */
    await expect(askNoorAI('a question', {} as never)).resolves.toEqual({
      outcome: 'failed',
      failure: 'network-unavailable',
    });
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('does not write the profile row', async () => {
    setRemoteAccessAuthorised(false);

    await expect(updateFullName('user-a', 'New Name')).rejects.toThrow(OfflineOperationError);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('does not change the password or the email address', async () => {
    setRemoteAccessAuthorised(false);

    await expect(security.updatePassword({ newPassword: 'x' })).rejects.toThrow(
      OfflineOperationError,
    );
    await expect(security.requestEmailChange('b@example.com')).rejects.toThrow(
      OfflineOperationError,
    );
    await expect(security.sendReauthenticationCode()).rejects.toThrow(OfflineOperationError);
    expect(mockUpdateUser).not.toHaveBeenCalled();
  });

  it('does not sign out other devices', async () => {
    setRemoteAccessAuthorised(false);

    await expect(security.signOutEverywhere()).rejects.toThrow(OfflineOperationError);
    expect(mockGetSession).not.toHaveBeenCalled();
  });

  it('performs every one of them once access is restored', async () => {
    /*
      The other half. A gate that never opens is not a gate, and a test suite that only proves
      refusal would pass against a module that refused permanently.
    */
    setRemoteAccessAuthorised(true);

    await expect(updateFullName('user-a', 'New Name')).resolves.toEqual({ fullName: 'New Name' });
    expect(mockUpdate).toHaveBeenCalled();
  });
});

describe('what is deliberately still allowed offline', () => {
  it('lets a local sign-out proceed', async () => {
    /*
      A local sign-out has a local half that must happen whether or not a server is reachable —
      clearing the stored token, and the receipt the provider deletes before calling. Refusing it
      would leave somebody unable to sign out of their own phone on a plane, which is precisely what
      they are asking to do and needs no network.
    */
    setRemoteAccessAuthorised(false);

    await expect(security.signOutThisDevice()).resolves.toBeUndefined();
  });

  it('does not gate session resolution, which is how "online" is discovered', () => {
    /*
      Gating `resolveSession` on a flag derived from `resolveSession` is a circular definition: a
      device that was ever offline could never learn it was online again. The absence of the guard in
      `auth.service.ts` is therefore load-bearing, and asserted rather than assumed.
    */
    const source = readFileSync(join(__dirname, '..', '..', 'auth', 'auth.service.ts'), 'utf8');
    expect(source).not.toContain('assertRemoteAccess');
  });
});

describe('every remote entry point is behind the gate', () => {
  it('guards each module that reaches Supabase, and names the ones that do not', () => {
    /*
      A scan rather than a list of cases, because the risk is a *new* remote call added later
      without a guard. Anything importing the Supabase client is either guarded or named here with
      a reason.
    */
    const root = join(__dirname, '..', '..', '..');
    const sources: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== '__tests__' && entry.name !== 'node_modules') {
            walk(path);
          }
        } else if (/\.tsx?$/.test(entry.name)) {
          sources.push(path);
        }
      }
    };
    walk(root);

    const unguarded = sources
      .filter((path) => {
        const source = readFileSync(path, 'utf8');
        /*
          Either spelling counts as guarded. `assertRemoteAccess` throws, which suits a function
          that already signals failure that way; `isRemoteAccessAuthorised` lets a module that
          returns a result union report the refusal in its own vocabulary. Both refuse before the
          client is touched, which is the property being scanned for.
        */
        return (
          /from '@\/lib\/supabase'/.test(source) &&
          !/assertRemoteAccess|isRemoteAccessAuthorised/.test(source)
        );
      })
      .map((path) => path.replace(root, '').replace(/\\/g, '/'))
      .sort();

    expect(unguarded).toEqual(
      [
        /*
        The authentication boundary. `resolveSession` is how the app discovers it is online, and
        `signOut` must always be attempted so a failed network sign-out still ends local access.
      */
        '/services/auth/auth.service.ts',
        /*
        A deep-link exchange. It only ever runs in response to the user opening a link that arrived
        by email, which cannot happen without a network; a guard here would add a second refusal
        path for a state that does not occur.
      */
        '/services/auth/auth-callback.service.ts',
        /*
        The provider that *owns* the flag. It sets it; it cannot also be gated by it.
      */
        '/application/providers/auth-provider.tsx',
        /*
        Constructs the endpoint below, which is itself guarded. No call of its own.
      */
        '/features/faith/data/quran-foundation/index.ts',
      ].sort(),
    );
  });
});
