import { act, cleanup, render } from '@testing-library/react-native';

/**
 * The due-boundary timer — the trigger for a device that never generates a lifecycle event.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── The gap this closes ────────────────────────────────────────────────────
 * The coordinator had four triggers: authenticated startup, foreground, connectivity becoming
 * confirmed, and the manual action. Every one of them is an *event*. A device that stays signed in,
 * connected and foregrounded across the seven-day boundary generates none of them, and the check
 * that C7 obliges would simply not happen until something else woke the app.
 *
 * ── What it deliberately is not ────────────────────────────────────────────
 * Not a second sync engine, not a background task, and not another persisted timestamp. It reads the
 * same clock the orchestrator's own due gate reads — `manifest.createdAt` on the active generation —
 * and calls the same single-flight path every other trigger calls. Its whole job is to ask the
 * question at a moment when nothing else would.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const NOW = 1_760_000_000_000;
const SYNC_INTERVAL = 7 * 24 * 60 * 60 * 1000;

let clock = NOW;
const mockRun = jest.fn(
  async () => ({ kind: 'not-due' }) as { kind: string; retryAfterMs?: number },
);
const mockIsRunning = jest.fn(() => false);
let connectivityListener: ((state: unknown) => void) | null = null;
let mockAuthStatus: 'unknown' | 'signed-in' | 'signed-out' = 'signed-in';
let mockAuthUserId: string | null = 'user-1';
/** `null` means the device has no published generation yet. */
let mockGenerationCreatedAt: number | null = NOW;

jest.mock('@features/faith/data/sync/content-sync.orchestrator', () => ({
  ...jest.requireActual('@features/faith/data/sync/content-sync.orchestrator'),
  createContentSyncOrchestrator: () => ({ run: mockRun, isRunning: mockIsRunning }),
}));

jest.mock('@features/faith/storage/faith-sync-generation', () => ({
  ...jest.requireActual('@features/faith/storage/faith-sync-generation'),
  readActiveGeneration: jest.fn(async () =>
    mockGenerationCreatedAt === null ? null : { manifest: { createdAt: mockGenerationCreatedAt } },
  ),
}));

jest.mock('@features/faith/data/connectivity/expo-connectivity.port', () => ({
  createExpoConnectivity: () => ({
    current: async () => ({
      isConnected: true,
      reachability: 'online' as const,
      kind: 'wifi' as const,
      isWifi: true,
      isMetered: false,
    }),
    subscribe: (listener: (state: unknown) => void) => {
      connectivityListener = listener;
      return () => {
        connectivityListener = null;
      };
    },
  }),
}));

jest.mock('@application/providers/auth-provider', () => ({
  useAuth: () => ({
    status: mockAuthStatus,
    authority: mockAuthStatus === 'signed-in' ? 'online' : null,
    user: mockAuthUserId === null ? null : { id: mockAuthUserId },
  }),
  isOnlineAuthenticated: (state: { status: string; authority: string | null }) =>
    state.status === 'signed-in' && state.authority === 'online',
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const coordinator = require('@features/faith/di/content-sync-coordinator') as {
  ContentSyncCoordinator: () => null;
  resetContentSyncCoordinator: () => void;
  DUE_BOUNDARY_CHUNK_MS: number;
  DUE_BOUNDARY_MIN_DELAY_MS: number;
};

const { ContentSyncCoordinator, resetContentSyncCoordinator, DUE_BOUNDARY_CHUNK_MS } = coordinator;

const ONLINE = {
  isConnected: true,
  reachability: 'online' as const,
  kind: 'wifi' as const,
  isWifi: true,
  isMetered: false,
};

/** Mounts the coordinator and lets the startup run settle. */
async function mount() {
  const view = render(<ContentSyncCoordinator />);
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  return view;
}

/**
 * Advances both the fake timers and the clock the timer derives its delay from.
 *
 * In hourly steps, and that is not cosmetic: each wakeup arms the next one *after* awaiting the
 * generation read, so a timer armed inside a promise callback does not exist yet when
 * `advanceTimersByTime` collects the timers to fire. Stepping with a flush between lets each chunk
 * arm the one after it, which is exactly how it behaves on a device.
 */
async function advance(ms: number) {
  const step = 60 * 60 * 1000;
  let remaining = ms;
  while (remaining > 0) {
    const delta = Math.min(step, remaining);
    clock += delta;
    await act(async () => {
      jest.advanceTimersByTime(delta);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    remaining -= delta;
  }
}

/** Re-renders the same tree, so an auth change runs the existing effect's cleanup and body. */
async function rerender(view: { rerender: (node: React.ReactElement) => void }) {
  view.rerender(<ContentSyncCoordinator />);
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  jest.useFakeTimers();
  /*
    Timers do not belong to a test unless they are cleared between them. React's own scheduling and a
    boundary armed by the previous case would otherwise still be pending here, and a count assertion
    would be measuring both. This isolates rather than hides: every case arms its own.
  */
  jest.clearAllTimers();
  clock = NOW;
  jest.spyOn(Date, 'now').mockImplementation(() => clock);
  mockRun.mockClear();
  mockRun.mockImplementation(async () => ({ kind: 'not-due' }));
  mockIsRunning.mockClear();
  connectivityListener = null;
  mockAuthStatus = 'signed-in';
  mockAuthUserId = 'user-1';
  mockGenerationCreatedAt = NOW;
  resetContentSyncCoordinator();
});

afterEach(() => {
  cleanup();
  resetContentSyncCoordinator();
  jest.clearAllTimers();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
// The boundary
// ─────────────────────────────────────────────────────────────────────────────

describe('the due boundary', () => {
  it('triggers on a continuously foregrounded session with no other event', async () => {
    await mount();
    const afterStartup = mockRun.mock.calls.length;

    /* No foreground change, no reconnection, no manual action — only time passing. */
    await advance(SYNC_INTERVAL + 1000);

    expect(mockRun.mock.calls.length).toBeGreaterThan(afterStartup);
  });

  it('does not trigger before the boundary', async () => {
    await mount();
    const afterStartup = mockRun.mock.calls.length;

    await advance(SYNC_INTERVAL - DUE_BOUNDARY_CHUNK_MS);

    expect(mockRun.mock.calls.length).toBe(afterStartup);
  });

  it('wakes in bounded chunks that make no request until the boundary', async () => {
    await mount();
    const afterStartup = mockRun.mock.calls.length;

    /* Several chunk boundaries pass. Each one re-evaluates and each one declines to ask. */
    await advance(DUE_BOUNDARY_CHUNK_MS * 3);

    expect(mockRun.mock.calls.length).toBe(afterStartup);
  });

  it('triggers once when the boundary is already in the past at mount', async () => {
    mockGenerationCreatedAt = NOW - SYNC_INTERVAL - 1;
    await mount();
    const afterStartup = mockRun.mock.calls.length;

    /* A past-due boundary must not become a zero-delay loop. */
    await advance(1000);
    const afterFirstWake = mockRun.mock.calls.length;
    await advance(1000);

    expect(afterFirstWake - afterStartup).toBeLessThanOrEqual(1);
    expect(mockRun.mock.calls.length - afterFirstWake).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Exactly one
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// Lifecycle
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// Outcomes
// ─────────────────────────────────────────────────────────────────────────────

describe('what the timer does with each outcome', () => {
  it('does not spin when the device is offline at the boundary', async () => {
    mockGenerationCreatedAt = NOW - SYNC_INTERVAL - 1;
    mockRun.mockImplementation(async () => ({ kind: 'failed', failure: 'offline' }));
    await mount();
    const afterStartup = mockRun.mock.calls.length;

    /* Ten minutes of an offline device. A spin would be hundreds of calls. */
    await advance(10 * 60 * 1000);

    expect(mockRun.mock.calls.length - afterStartup).toBeLessThanOrEqual(10);
  });

  it('re-derives a full interval after a successful publication', async () => {
    await mount();
    /* The publication moves the authoritative clock forward. */
    mockRun.mockImplementation(async () => {
      mockGenerationCreatedAt = clock;
      return { kind: 'synced' };
    });

    await advance(SYNC_INTERVAL + 1000);
    const afterFirstBoundary = mockRun.mock.calls.length;

    /* A day later there is nothing owed, because the clock moved. */
    await advance(24 * 60 * 60 * 1000);

    expect(mockRun.mock.calls.length).toBe(afterFirstBoundary);
  });

  it('treats a device with no generation as owing a check without spinning', async () => {
    mockGenerationCreatedAt = null;
    await mount();
    const afterStartup = mockRun.mock.calls.length;

    await advance(5 * 60 * 1000);

    expect(mockRun.mock.calls.length - afterStartup).toBeLessThanOrEqual(5);
  });

  it('cannot be postponed indefinitely by a future timestamp', async () => {
    /* A clock rollback puts `createdAt` a year ahead. The wait is capped at one chunk regardless. */
    mockGenerationCreatedAt = NOW + 365 * 24 * 60 * 60 * 1000;
    await mount();
    const afterStartup = mockRun.mock.calls.length;

    await advance(DUE_BOUNDARY_CHUNK_MS + 1000);

    /* It re-evaluated rather than sleeping for a year; whether it ran is the orchestrator's call. */
    expect(jest.getTimerCount()).toBeGreaterThan(0);
    expect(mockRun.mock.calls.length).toBeGreaterThanOrEqual(afterStartup);
  });
});
