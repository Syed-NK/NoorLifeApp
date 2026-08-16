import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { StrictMode } from 'react';
import { AppState } from 'react-native';
import { act, render } from '@testing-library/react-native';

import {
  readSyncStatus,
  resetSyncStatus,
  subscribeSyncStatus,
  updateSyncStatus,
} from '@features/faith/data/sync/content-sync.revision';

/**
 * Production wiring — the gate the previous round did not have.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── What slipped through, and why nothing caught it ────────────────────────
 * `createContentSyncOrchestrator` had **zero production call sites**. Ninety-three tests passed
 * against it and not one of them asked whether anything ran it, because every one of them
 * constructed it themselves. A transaction nobody starts synchronises nothing, and a suite that
 * always supplies its own subject can never notice.
 *
 * So the first three cases here are about *call sites*, read off the source tree: exactly one
 * production module constructs the orchestrator, at least one real lifecycle path invokes it, and no
 * Faith screen does either.
 *
 * ── The rest is the lifecycle contract ─────────────────────────────────────
 * Signed out means nothing happens. Auth restoration means one transaction. Foreground and reconnect
 * arriving together — which is what waking a phone actually does — means one transaction, not two.
 * Unconfirmed reachability means none at all.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const SRC = join(__dirname, '..', '..', '..');

/** Every production `.ts`/`.tsx` under `src`, excluding tests and test-only harnesses. */
function productionFiles(directory: string = SRC, found: string[] = []): string[] {
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      if (entry === '__tests__' || entry === 'node_modules' || entry === 'test-support') {
        continue;
      }
      productionFiles(path, found);
      continue;
    }
    if (/\.tsx?$/.test(entry)) {
      found.push(path);
    }
  }
  return found;
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

function relative(path: string): string {
  return path.slice(SRC.length + 1).replace(/\\/g, '/');
}

function offenders(pattern: RegExp): string[] {
  return productionFiles()
    .filter((path) => pattern.test(stripComments(readFileSync(path, 'utf8'))))
    .map(relative)
    .sort();
}

// ─────────────────────────────────────────────────────────────────────────────
// Call sites
// ─────────────────────────────────────────────────────────────────────────────

describe('the orchestrator has exactly one production owner', () => {
  it('is constructed in exactly one production module', () => {
    /*
      Call sites, not the declaration: the orchestrator module necessarily contains
      `export function createContentSyncOrchestrator(`, and that is the thing being wired, not a
      wiring of it.
    */
    expect(offenders(/(?<!function )createContentSyncOrchestrator\s*\(/)).toEqual([
      'features/faith/di/content-sync-coordinator.tsx',
    ]);
  });

  it('is invoked from a real production lifecycle path', () => {
    /*
      Not just constructed — *run*. The defect was a fully-built transaction that nothing started, so
      a test that only proved construction would have passed against it.
    */
    const coordinator = stripComments(
      readFileSync(join(SRC, 'features/faith/di/content-sync-coordinator.tsx'), 'utf8'),
    );
    expect(/useEffect\(/.test(coordinator)).toBe(true);
    expect(/void runContentSync\(\)/.test(coordinator)).toBe(true);
    expect(/AppState\.addEventListener\('change'/.test(coordinator)).toBe(true);
    expect(/\.subscribe\(/.test(coordinator)).toBe(true);

    /* And the coordinator is actually mounted in the application provider tree. */
    const providers = stripComments(
      readFileSync(join(SRC, 'application/providers/app-providers.tsx'), 'utf8'),
    );
    expect(providers).toContain('<ContentSyncCoordinator />');
  });

  it('is constructed by no Faith screen', () => {
    const screens = offenders(/createContentSyncOrchestrator|runContentSync/).filter((path) =>
      path.includes('/screens/'),
    );
    expect(screens).toEqual([]);
  });

  it('starts no audio download from the sync path', () => {
    /* This phase synchronises metadata. Spending a user's storage because they signed in is not it. */
    const coordinator = stripComments(
      readFileSync(join(SRC, 'features/faith/di/content-sync-coordinator.tsx'), 'utf8'),
    );
    for (const forbidden of [
      'downloadSurah',
      'downloadComplete',
      'RecitationAudio',
      'audioStore',
    ]) {
      expect(coordinator).not.toContain(forbidden);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Token authority
// ─────────────────────────────────────────────────────────────────────────────

describe('one token authority', () => {
  it('has no token or successful-publication field in the health record', () => {
    const health = stripComments(
      readFileSync(join(SRC, 'features/faith/storage/faith-sync-checkpoint.ts'), 'utf8'),
    );
    for (const forbidden of [
      'syncToken',
      'syncedUntilSequence',
      'lastSyncedAt',
      'commitSync',
      'syncDue',
    ]) {
      expect(health).not.toContain(forbidden);
    }
  });

  it('persists a sync token in exactly one place', () => {
    /*
      The generation manifest. A second persistence site would be a second authority, which is what
      the dormant checkpoint was — nothing read it, so nothing would have caught it drifting.
    */
    /* One place assigns a token into something durable, and it is the generation draft. */
    expect(offenders(/syncToken:\s*finalToken/)).toEqual([
      'features/faith/data/sync/content-sync.orchestrator.ts',
    ]);
    /* One type declares a stored token field, and it is the generation manifest's `feed`. */
    expect(offenders(/readonly syncToken:\s*string/)).toEqual([
      'features/faith/storage/faith-sync-generation.ts',
    ]);
  });

  it('keeps large synchronized rows out of AsyncStorage', () => {
    const generation = stripComments(
      readFileSync(join(SRC, 'features/faith/storage/faith-sync-generation.ts'), 'utf8'),
    );
    expect([...generation.matchAll(/writeChecked\(/g)]).toHaveLength(1);
    expect(/writeChecked\(faithStorageKeys\.quranGenerationPointer/.test(generation)).toBe(true);
  });

  it('logs nothing from the sync or coordinator path', () => {
    for (const path of SYNC_PATH) {
      const source = stripComments(readFileSync(join(SRC, path), 'utf8'));
      expect(/console\s*\.\s*[a-z]+\s*\(/.test(source)).toBe(false);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Session ownership, read off the source tree
// ─────────────────────────────────────────────────────────────────────────────

/** Every production module on the synchronisation path, including the session boundary. */
const SYNC_PATH = [
  'features/faith/di/content-sync-coordinator.tsx',
  'features/faith/data/sync/content-sync.orchestrator.ts',
  'features/faith/data/sync/content-sync.revision.ts',
  'features/faith/data/sync/content-sync.session.ts',
  'features/faith/storage/faith-sync-generation.ts',
  'features/faith/storage/faith-sync-checkpoint.ts',
  'features/faith/hooks/use-content-sync.ts',
];

describe('the dispose path is production code', () => {
  it('is called by the coordinator component and not only by tests', () => {
    /*
      ── The check that would have caught the defect ─────────────────────────
      `resetContentSyncCoordinator` was documented as "Called on sign-out" and had **zero production
      callers**. Every test that exercised it called it itself, so the suite proved the function
      worked and never asked whether anything ran it — the same shape of gap as an orchestrator
      nothing constructed.

      So the assertion is about a call site inside the component, not about the export existing.
    */
    const source = stripComments(
      readFileSync(join(SRC, 'features/faith/di/content-sync-coordinator.tsx'), 'utf8'),
    );
    const declaration = source.indexOf('export function resetContentSyncCoordinator');
    expect(declaration).toBeGreaterThan(-1);

    const component = source.indexOf('export function ContentSyncCoordinator(');
    expect(component).toBeGreaterThan(-1);
    /* Inside the component's own body, which is the lifecycle path a sign-out actually travels. */
    expect(source.slice(component)).toContain('resetContentSyncCoordinator()');

    /* And the session state the UI shows is cleared on the same path. */
    expect(source.slice(component)).toContain('clearSessionSyncStatus(');
  });

  it('gives every orchestrator a session it cannot forge', () => {
    const orchestrator = stripComments(
      readFileSync(join(SRC, 'features/faith/data/sync/content-sync.orchestrator.ts'), 'utf8'),
    );
    /* Required, not optional: an unowned transaction must not be constructible. */
    expect(orchestrator).toContain('readonly session: SyncSessionGuard');
    expect(orchestrator).not.toContain('session?:');
    /*
      The transaction is handed the question and nothing else. It cannot read the owner key, cannot
      read the epoch, and cannot end anybody's session.
    */
    expect(orchestrator).not.toContain('ownerKey');
    expect(orchestrator).not.toContain('invalidate');

    /* Every status write goes through the session-gated reporter, so an ended owner emits nothing. */
    const body = orchestrator.slice(
      orchestrator.indexOf('export function createContentSyncOrchestrator'),
    );
    expect([...body.matchAll(/updateSyncStatus\(/g)]).toHaveLength(1);
    expect(body).toContain('if (live()) {\n      updateSyncStatus(patch);');
  });

  it('holds no credential, token or address anywhere in the session boundary', () => {
    const session = stripComments(
      readFileSync(join(SRC, 'features/faith/data/sync/content-sync.session.ts'), 'utf8'),
    );
    for (const forbidden of [
      'accessToken',
      'access_token',
      'refreshToken',
      'refresh_token',
      'password',
      'email',
      'Authorization',
      'http',
    ]) {
      expect(session).not.toContain(forbidden);
    }
  });

  it('persists nothing about a session', () => {
    /*
      A session is process-scoped by construction. Writing an owner or an epoch to AsyncStorage would
      make "the session that started this run" survive a relaunch, which is the one thing it must
      never do.
    */
    const session = stripComments(
      readFileSync(join(SRC, 'features/faith/data/sync/content-sync.session.ts'), 'utf8'),
    );
    for (const forbidden of ['AsyncStorage', 'writeChecked', 'readJson', 'expo-file-system']) {
      expect(session).not.toContain(forbidden);
    }
  });

  it('reads the user id from the public auth contract and never transmits it', () => {
    const coordinator = stripComments(
      readFileSync(join(SRC, 'features/faith/di/content-sync-coordinator.tsx'), 'utf8'),
    );
    /* The identity comes from `useAuth`, which already exposes it. No new auth surface was added. */
    expect(coordinator).toContain('useAuth()');
    expect(coordinator).toContain('user?.id');
    /* And no token is read, held or forwarded anywhere on this path. */
    for (const path of SYNC_PATH) {
      const source = stripComments(readFileSync(join(SRC, path), 'utf8'));
      for (const forbidden of ['accessToken', 'access_token', 'refreshToken', 'refresh_token']) {
        expect(source).not.toContain(forbidden);
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The lifecycle, driven
// ─────────────────────────────────────────────────────────────────────────────

const mockRun = jest.fn(async () => ({ kind: 'not-due' }) as const);
/** Counts orchestrator constructions, so "one instance per process" is provable. */
const mockConstructions = jest.fn();
const mockIsRunning = jest.fn(() => false);
const mockSubscribe = jest.fn();
const mockUnsubscribe = jest.fn();
const mockCurrent = jest.fn(async () => ({
  isConnected: false,
  reachability: 'offline' as const,
  kind: 'none' as const,
  isWifi: false,
  isMetered: false,
}));
let connectivityListener: ((state: unknown) => void) | null = null;
let mockAuthStatus: 'unknown' | 'signed-in' | 'signed-out' = 'signed-out';
let mockAuthUserId: string | null = null;
/**
 * The session guard handed to each orchestrator, in construction order.
 *
 * One entry per owner, which is what makes "a sign-out invalidated the owner" and "a remount reused
 * it" assertable rather than inferred from a construction count alone.
 */
const mockSessions: { isValid: () => boolean }[] = [];

jest.mock('@features/faith/data/sync/content-sync.orchestrator', () => ({
  ...jest.requireActual('@features/faith/data/sync/content-sync.orchestrator'),
  createContentSyncOrchestrator: (deps: { session: { isValid: () => boolean } }) => {
    mockConstructions();
    mockSessions.push(deps.session);
    return { run: mockRun, isRunning: mockIsRunning };
  },
}));

jest.mock('@features/faith/data/connectivity/expo-connectivity.port', () => ({
  createExpoConnectivity: () => ({
    current: mockCurrent,
    subscribe: (listener: (state: unknown) => void) => {
      connectivityListener = listener;
      mockSubscribe();
      return () => {
        connectivityListener = null;
        mockUnsubscribe();
      };
    },
  }),
}));

jest.mock('@application/providers/auth-provider', () => ({
  /*
    `user` as well as `status`, because ownership is keyed on *who* is signed in and not merely on
    whether anybody is. The id is the only field the coordinator reads, and it reads it to compare —
    never to send, store or log.
  */
  useAuth: () => ({
    status: mockAuthStatus,
    user: mockAuthUserId === null ? null : { id: mockAuthUserId },
  }),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const coordinatorModule = require('@features/faith/di/content-sync-coordinator') as {
  ContentSyncCoordinator: () => null;
  resetContentSyncCoordinator: () => void;
  runContentSync: (options?: { force?: boolean }) => Promise<void>;
};

const ONLINE = {
  isConnected: true,
  reachability: 'online' as const,
  kind: 'wifi' as const,
  isWifi: true,
  isMetered: false,
};

const CAPTIVE = {
  isConnected: true,
  reachability: 'link-only' as const,
  kind: 'wifi' as const,
  isWifi: false,
  isMetered: false,
};

/** Every `AppState` subscription's `remove`, so "detached exactly once" is countable. */
const appStateRemovals: jest.Mock[] = [];

beforeEach(() => {
  mockRun.mockClear();
  mockConstructions.mockClear();
  mockSubscribe.mockClear();
  mockUnsubscribe.mockClear();
  mockSessions.length = 0;
  appStateRemovals.length = 0;
  connectivityListener = null;
  mockAuthStatus = 'signed-out';
  mockAuthUserId = null;
  coordinatorModule.resetContentSyncCoordinator();
  resetSyncStatus();

  jest.spyOn(AppState, 'addEventListener').mockImplementation(() => {
    const remove = jest.fn();
    appStateRemovals.push(remove);
    return { remove } as unknown as ReturnType<typeof AppState.addEventListener>;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

/** Signs a user in. The id is what the coordinator keys ownership on. */
function signIn(userId = 'user-a'): void {
  mockAuthStatus = 'signed-in';
  mockAuthUserId = userId;
}

function signOut(): void {
  mockAuthStatus = 'signed-out';
  mockAuthUserId = null;
}

/**
 * Flushes mount effects and the promises they start.
 *
 * A macrotask, not just a microtask. The coordinator's effect calls  and
 * settles its result in a , and a microtask-only flush leaves that pending — which reads as
 * "the effect never ran" from the second test in the file onwards, while passing in isolation.
 */
/**
 * Mounts the coordinator inside one act scope and lets its effect settle.
 *
 * ── Why the render is inside `act` rather than followed by it ──────────────
 * `render` opens its own act scope. Following it with a second one nests two scopes over the same
 * work, and from the second render in a file onwards React stops flushing the inner effects — the
 * symptom is a test that passes alone and reports "the effect never ran" in sequence. The same trap
 * this repo hit with overlapping `findBy*` calls.
 *
 * One scope, and a macrotask inside it, because the effect starts a promise (`connectivity.current()`)
 * whose `.then` a microtask flush would leave pending.
 */
/**
 * What `render` resolves to.
 *
 * Named rather than written inline because `ReturnType<typeof render>` is the *promise* in this
 * version of the library, and annotating a helper with it silently turns every `view.rerender` into
 * a call on a `Promise` — which type-checks against `never` and fails at run time.
 */
type Mounted = Awaited<ReturnType<typeof render>>;

async function mountCoordinator(): Promise<Mounted> {
  /* A holder, because TypeScript cannot see an assignment made inside the act callback. */
  const holder: { view: Mounted | null } = { view: null };
  await act(async () => {
    holder.view = await render(<coordinatorModule.ContentSyncCoordinator />);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  if (holder.view === null) {
    throw new Error('the coordinator did not mount');
  }
  return holder.view;
}

/** Re-renders under the current auth state and lets the resulting effect settle. */
async function rerenderCoordinator(view: Mounted): Promise<void> {
  await act(async () => {
    await view.rerender(<coordinatorModule.ContentSyncCoordinator />);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe('the lifecycle coordinator', () => {
  it('runs nothing while signed out', async () => {
    mockAuthStatus = 'signed-out';
    await mountCoordinator();

    expect(mockRun).not.toHaveBeenCalled();
    expect(mockSubscribe).not.toHaveBeenCalled();
  });

  it('runs nothing before auth restoration resolves', async () => {
    /* `'unknown'` is "we are still working out whether there is a session". Not a signed-in state. */
    mockAuthStatus = 'unknown';
    await mountCoordinator();

    expect(mockRun).not.toHaveBeenCalled();
  });

  it('runs exactly one transaction when the session becomes ready', async () => {
    signIn();
    await mountCoordinator();

    expect(mockRun).toHaveBeenCalledTimes(1);
    /* Called with the coordinator default: no force, so the due calculation decides. */
    expect(mockRun).toHaveBeenCalledWith({});
  });

  it('does not duplicate the transaction when several consumers mount', async () => {
    /*
      Two mounted coordinators would be a wiring mistake, and this proves the shared instance holds:
      the orchestrator is a module singleton, so both mounts drive the same `run`.
    */
    signIn();
    await mountCoordinator();
    await mountCoordinator();

    /*
      Two mounts produce two triggers — that is expected and harmless. What must not happen is two
      *orchestrators*: the single-flight guard lives inside the instance, so a second one would be a
      second in-flight promise and the guarantee would be lost. One construction, whatever mounts.
    */
    expect(mockConstructions).toHaveBeenCalledTimes(1);
    expect(mockRun.mock.calls).toEqual([[{}], [{}]]);
  });

  it('runs on a confirmed reconnection, once per transition', async () => {
    signIn();
    await mountCoordinator();
    mockRun.mockClear();

    await act(async () => {
      connectivityListener?.(ONLINE);
      await Promise.resolve();
    });
    expect(mockRun).toHaveBeenCalledTimes(1);

    /* A second reachable event is not a second arrival. */
    await act(async () => {
      connectivityListener?.(ONLINE);
      await Promise.resolve();
    });
    expect(mockRun).toHaveBeenCalledTimes(1);
  });

  it('does not run on unconfirmed reachability', async () => {
    signIn();
    await mountCoordinator();
    mockRun.mockClear();

    await act(async () => {
      connectivityListener?.(CAPTIVE);
      await Promise.resolve();
    });

    expect(mockRun).not.toHaveBeenCalled();
  });

  it('detaches its listeners on sign-out', async () => {
    signIn();
    const view = await mountCoordinator();
    expect(mockSubscribe).toHaveBeenCalledTimes(1);

    signOut();
    await rerenderCoordinator(view);

    expect(mockUnsubscribe).toHaveBeenCalledTimes(1);
    expect(connectivityListener).toBeNull();
  });

  it('detaches its listeners on unmount', async () => {
    signIn();
    const view = await mountCoordinator();

    await act(async () => {
      view.unmount();
      await Promise.resolve();
    });

    expect(mockUnsubscribe).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Session ownership — the lifecycle defect, driven through the component
// ─────────────────────────────────────────────────────────────────────────────

describe('the session that owns the transaction', () => {
  it('gives the orchestrator a live owner while signed in, and ends it on sign-out', async () => {
    signIn();
    const view = await mountCoordinator();

    expect(mockSessions).toHaveLength(1);
    expect(mockSessions[0]?.isValid()).toBe(true);

    signOut();
    await rerenderCoordinator(view);

    /*
      The defect in one assertion. Detaching the listeners left this `true`, so an in-flight run kept
      its authority across the sign-out and into the next session.
    */
    expect(mockSessions[0]?.isValid()).toBe(false);
  });

  it('detaches each listener exactly once, however many signed-out renders follow', async () => {
    signIn();
    const view = await mountCoordinator();
    expect(mockSubscribe).toHaveBeenCalledTimes(1);
    expect(appStateRemovals).toHaveLength(1);

    signOut();
    await rerenderCoordinator(view);
    await rerenderCoordinator(view);
    await rerenderCoordinator(view);

    expect(mockUnsubscribe).toHaveBeenCalledTimes(1);
    expect(appStateRemovals[0]).toHaveBeenCalledTimes(1);
    /* And no listener was re-established by any of those renders. */
    expect(mockSubscribe).toHaveBeenCalledTimes(1);
    expect(appStateRemovals).toHaveLength(1);
  });

  it('creates nothing and resets nothing repeatedly across signed-out renders', async () => {
    const view = await mountCoordinator();
    for (let index = 0; index < 4; index += 1) {
      await rerenderCoordinator(view);
    }

    expect(mockConstructions).not.toHaveBeenCalled();
    expect(mockSubscribe).not.toHaveBeenCalled();
    expect(mockRun).not.toHaveBeenCalled();
    expect(appStateRemovals).toHaveLength(0);
  });

  it('notifies a status subscriber once on sign-out, and not again on later renders', async () => {
    /*
      The reset must clear session state without discarding subscriptions — every Faith screen
      reading `useContentSync` survives a sign-out — and it must not re-notify on every subsequent
      render, which is what an unconditional emit would do.
    */
    signIn();
    const view = await mountCoordinator();
    updateSyncStatus({ status: 'current', lastPublishedAt: 1, isRunning: false });

    const seen: string[] = [];
    const release = subscribeSyncStatus((model) => seen.push(model.status));

    signOut();
    await rerenderCoordinator(view);
    await rerenderCoordinator(view);
    await rerenderCoordinator(view);
    release();

    expect(seen).toEqual(['authentication-required']);
    expect(readSyncStatus().lastPublishedAt).toBeNull();
  });

  it('gives a new sign-in a fresh owner rather than the previous one', async () => {
    signIn('user-a');
    const view = await mountCoordinator();
    const first = mockSessions[0];

    signOut();
    await rerenderCoordinator(view);

    signIn('user-a');
    await rerenderCoordinator(view);

    expect(mockConstructions).toHaveBeenCalledTimes(2);
    expect(mockSessions).toHaveLength(2);
    expect(first?.isValid()).toBe(false);
    expect(mockSessions[1]?.isValid()).toBe(true);
    /* The same person signing back in is a new visit, so it inherits no in-flight promise. */
    expect(mockSessions[1]).not.toBe(first);
  });

  it('replaces the owner when the authenticated user changes without a signed-out render', async () => {
    signIn('user-a');
    const view = await mountCoordinator();
    const forA = mockSessions[0];

    signIn('user-b');
    await rerenderCoordinator(view);

    expect(forA?.isValid()).toBe(false);
    expect(mockSessions).toHaveLength(2);
    expect(mockSessions[1]?.isValid()).toBe(true);
  });

  it('produces one effective owner under a Strict Mode double mount', async () => {
    /*
      React deliberately mounts, unmounts and remounts in development. The cleanup therefore detaches
      listeners and does **not** end the session: invalidating there would kill a legitimate run and
      mint a second owner for one sign-in, which is the version a reasonable first reading produces.
    */
    signIn();
    await act(async () => {
      await render(
        <StrictMode>
          <coordinatorModule.ContentSyncCoordinator />
        </StrictMode>,
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    /*
      React really did mount twice — two AppState subscriptions and two connectivity subscriptions,
      the first pair detached by the cleanup in between. Asserted so this case cannot quietly become
      vacuous if Strict Mode's behaviour changes: without a genuine double mount the counts below
      would be satisfied by a single ordinary mount.
    */
    expect(appStateRemovals).toHaveLength(2);
    expect(mockSubscribe).toHaveBeenCalledTimes(2);
    expect(appStateRemovals[0]).toHaveBeenCalledTimes(1);
    expect(mockUnsubscribe).toHaveBeenCalledTimes(1);

    /* One owner and one orchestrator, whatever React did to the component. */
    expect(mockConstructions).toHaveBeenCalledTimes(1);
    expect(mockSessions).toHaveLength(1);
    expect(mockSessions[0]?.isValid()).toBe(true);
    /*
      The effect really ran — a double mount that produced no owner would satisfy the counts above
      by doing nothing at all — and every trigger reached the single instance whose single-flight
      guard is what makes repeated triggers one transaction.
    */
    expect(mockRun.mock.calls.length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The manual check obeys the same rules
// ─────────────────────────────────────────────────────────────────────────────

describe('the manual "check for updates" action', () => {
  it('sends nothing when there is no signed-in owner', async () => {
    await mountCoordinator();
    await coordinatorModule.runContentSync({ force: true });

    expect(mockRun).not.toHaveBeenCalled();
  });

  it('sends a forced check through the owner while one is live', async () => {
    signIn();
    await mountCoordinator();
    mockRun.mockClear();

    await coordinatorModule.runContentSync({ force: true });

    expect(mockRun).toHaveBeenCalledWith({ force: true });
    /*
      `force` reaches the orchestrator, which is where "not due" is decided. It does not and cannot
      bypass the single-flight guard, the reachability check, validation or the publication — none of
      those is decided in the coordinator.
    */
  });

  it('sends nothing once the session it would have used has ended', async () => {
    signIn();
    const view = await mountCoordinator();
    signOut();
    await rerenderCoordinator(view);
    mockRun.mockClear();

    /* A screen that outlived the session, or the instant between sign-out and the effect re-running. */
    await coordinatorModule.runContentSync({ force: true });

    expect(mockRun).not.toHaveBeenCalled();
  });
});
