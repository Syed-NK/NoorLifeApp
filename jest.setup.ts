/**
 * Jest setup for NoorLife.
 *
 * Only the native/host boundaries are mocked. Nothing in the design system,
 * module themes or feature code is mocked — those are the things under test.
 */

/**
 * ── There is deliberately no global `jest.setTimeout` here ──────────────────
 * 6C-3A raised the whole run to thirty seconds because provider-heavy suites were timing out under
 * parallel load. That diagnosis was wrong in an expensive way: the suites were not starved of CPU,
 * they were *sleeping*. Four mock data sources simulate latency with a real `setTimeout` —
 * `use-main-home-dashboard` 450 ms, `mock-module-repository` 350 ms, Faith's `mock-support` 280 ms,
 * `mock-auth-service` 650 ms — and every mount of every screen paid it in wall-clock time. Main
 * Home's four suites mount the screen 246 times between them, which is roughly 110 seconds of the
 * run spent waiting for timers that exist so a human can see a skeleton.
 *
 * Raising the budget hid that, and it hid something worse: a genuinely hung unit test took thirty
 * seconds to say so, and every suite in the project — including the pure ones that finish in
 * milliseconds — lost its ability to fail fast.
 *
 * The fix is `installMockLatencyTimers()` from `@/test-support/mock-latency-timers`, which the
 * affected suites opt into: it advances the mock clock instead of sleeping on it, and warms the
 * first mount in `beforeAll` so the opening test of a heavy suite is not charged for compiling a
 * provider stack. Neither changes a single assertion.
 *
 * The second half of the fix is `maxWorkers: "60%"` in `package.json`. Jest's default of
 * `cores - 1` had thirteen workers competing for fourteen cores, which inflated the slowest mount
 * from 2.6 s to 4.7 s and occasionally past five. Leaving 40% of the machine free made the whole
 * run *faster* — 70.8 s against 74.6 s — because the time was being lost to contention, not spent
 * on work.
 *
 * Jest's five-second default now applies to every test in the project, which is what makes a hang
 * look like a hang: no `jest.setTimeout` survives anywhere in `src`.
 */

/**
 * The shared router double.
 *
 * The `mock` name prefix is required: `jest.mock` factories are hoisted above
 * variable declarations, and Jest only permits a factory to close over an
 * out-of-scope variable when its name starts with `mock`.
 */

/**
 * The one feature import in this file, and it is here because it is a *process-wide* cache.
 *
 * Everything else mocked below is a native boundary. This is not: it is NoorLife's own startup
 * snapshot of the surah catalogue, which lives at module scope because it must be readable during a
 * component's first render. That makes it survive between tests in the same worker, which is a leak
 * no individual suite can be relied on to clean up — so it is cleared centrally, exactly like the
 * router and the audio doubles.
 */
import { resetSurahCatalogueWarmup } from '@features/faith/data/quran-catalogue-warmup';

const mockRouterInstance = {
  push: jest.fn(),
  replace: jest.fn(),
  navigate: jest.fn(),
  back: jest.fn(),
  canGoBack: jest.fn(() => true),
  dismiss: jest.fn(),
  /**
   * The header back arrow's method.
   *
   * `dismissTo(href)` pops to `href` when it is on the stack and replaces the current
   * screen with it when it is not — which is what makes a deep-linked module child return
   * to its module home instead of exiting the app.
   */
  dismissTo: jest.fn(),
  dismissAll: jest.fn(),
  canDismiss: jest.fn(() => true),
  setParams: jest.fn(),
};

/**
 * Route parameters the `useLocalSearchParams` double returns.
 *
 * ── Why this became settable ────────────────────────────────────────────────
 * It was a fixed `{}`, which was adequate while no screen read a parameter. The Qur'an reader now
 * lives at `/faith/reader/[surah]` with an optional `?ayah=` — it was a single parameterless route
 * that showed whatever position happened to be in storage, so every surah row opened the same
 * verses and a bookmark could not open its own.
 *
 * Mutable rather than a `jest.fn` per suite, because the mock factory is hoisted and cannot close
 * over a suite-local value. `setRouteParams` in `beforeEach` keeps one test's parameters out of the
 * next, and the reset below is unconditional so a suite that never sets them still starts empty.
 */
const mockRouteParams: Record<string, string | string[]> = {};

// Fonts: in tests the faces are always "loaded", so components render with their
// real styles instead of being gated behind a readiness flag.
jest.mock('expo-font', () => ({
  ...jest.requireActual('expo-font'),
  useFonts: () => [true, null],
  isLoaded: () => true,
  loadAsync: () => Promise.resolve(),
}));

// Safe area: the real provider renders nothing until it measures native insets,
// which never happens in jsdom. The library ships an official mock that supplies
// zero insets synchronously, so components under test actually render.
jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual('react-native-safe-area-context/jest/mock').default,
);

// Splash screen: no native module in the test environment.
jest.mock('expo-splash-screen', () => ({
  preventAutoHideAsync: () => Promise.resolve(),
  hideAsync: () => Promise.resolve(),
  setOptions: () => undefined,
}));

// AsyncStorage: the library ships an official in-memory mock. Without it any module that
// reaches the persistence boundary fails at import time, not at call time.
jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

/**
 * Application metadata: the values a real install reports.
 *
 * `expo-application` reads the installed package — `versionName` and `versionCode` on Android.
 * There is no installed package under Jest, so the module is stood in with the values the current
 * Android build actually declares. That makes the Help & Support suite a test of *what the screen
 * does with the numbers it is given*, which is the part this project owns; that the numbers are
 * real on a device is the responsibility of the library, and is verified on the device pass.
 */
jest.mock('expo-application', () => ({
  nativeApplicationVersion: '1.0.0',
  nativeBuildVersion: '1',
}));

/**
 * Device: only the operating-system release, which is the one field the diagnostics allow-list
 * takes from this module. The model, brand and manufacturer are deliberately left undefined, so a
 * test would fail rather than quietly pass if one of them were ever read.
 */
jest.mock('expo-device', () => ({
  osVersion: '17',
}));

/**
 * Clipboard: an in-memory stand-in, so a test can read back what a screen copied.
 *
 * Which matters more here than usual — "the copied diagnostics contain no token and no email
 * address" is only a real assertion if the test can inspect the string that was actually written.
 */
/**
 * The recitation player.
 *
 * ── Why a hand-written double rather than jest-expo's ───────────────────────
 * `expo-audio` reaches for a native module at import time and throws in this environment, so the
 * suites that render the reader cannot even load without one. More usefully: the states worth
 * testing — buffering, a load that failed, a verse finishing so auto-advance fires — are states no
 * real player will reach in Jest, and a double is the only way to reach them at all.
 *
 * `mockAudioPlayerState` is the seam. A test sets it, renders, and asserts what the transport says;
 * `mockAudioPlayer` records the calls so "does pressing pause actually pause" is answerable.
 */
const mockAudioPlayerState = {
  isLoaded: true,
  playing: false,
  isBuffering: false,
  didJustFinish: false,
  currentTime: 0,
  duration: 0,
};

/**
 * The recorded calls, shared across every player instance the double creates.
 *
 * Separate from the instances themselves because the interesting assertion is almost always "was
 * pause called", not "was pause called on this particular native object" — and because the double
 * now creates a **new** instance per source, which would otherwise make every existing
 * `mockAudio.player.pause` assertion depend on which verse happened to be loaded.
 */
const mockAudioPlayerInstance = {
  play: jest.fn(),
  pause: jest.fn(),
  seekTo: jest.fn(),
  remove: jest.fn(),
  /**
   * Modelled because the reader now sets a playback rate on every loaded verse.
   *
   * A double that lacked it made `setPlaybackRate` throw `TypeError`, which the hook could only read
   * as "this platform will not change the rate" — so the double was asserting a capability gap that
   * does not exist on the device. `shouldCorrectPitch` is a settable property rather than a method,
   * so it is recorded through a setter below.
   */
  setPlaybackRate: jest.fn(),
};

/**
 * One native player, with the lifetime the real one has.
 *
 * ── Why the double models release at all ────────────────────────────────────
 * It did not, and that is precisely why a crash that fired on **every** close of the reader reached
 * a device. The previous double returned one immortal singleton from `useAudioPlayer`, so
 * `player.pause()` in an unmount cleanup was a call on a live object in Jest and a call on a freed
 * one on Android. A double that cannot express "this object is gone" cannot fail the test that
 * matters.
 *
 * So a released instance throws what `expo-modules-core` throws: `ERR_USING_RELEASED_SHARED_OBJECT`,
 * wrapped in the same `Call to function 'AudioPlayer.<name>' has been rejected` wording the device
 * reports, so a failing test reads like the logcat line it stands for.
 */
type MockAudioPlayer = {
  readonly id: number;
  readonly play: () => void;
  readonly pause: () => void;
  readonly seekTo: (seconds: number) => void;
  readonly remove: () => void;
  readonly setPlaybackRate: (rate: number, quality?: string) => void;
  shouldCorrectPitch: boolean;
  /** Test-only. Marks the object dead, as `useReleasingSharedObject` does. */
  readonly __release: () => void;
  readonly __isReleased: () => boolean;
};

let mockAudioPlayerSerial = 0;

function mockCreateAudioPlayer(): MockAudioPlayer {
  mockAudioPlayerSerial += 1;
  const id = mockAudioPlayerSerial;
  let released = false;

  const guarded =
    (name: string, record: jest.Mock) =>
    (...args: unknown[]): void => {
      if (released) {
        const error = new Error(
          `Call to function 'AudioPlayer.${name}' has been rejected.\n` +
            '→ Caused by: Cannot use shared object that was already released',
        ) as Error & { code?: string };
        error.code = 'ERR_USING_RELEASED_SHARED_OBJECT';
        throw error;
      }
      record(...args);
    };

  return {
    id,
    play: guarded('play', mockAudioPlayerInstance.play),
    pause: guarded('pause', mockAudioPlayerInstance.pause),
    seekTo: guarded('seekTo', mockAudioPlayerInstance.seekTo) as (seconds: number) => void,
    remove: guarded('remove', mockAudioPlayerInstance.remove),
    setPlaybackRate: guarded('setPlaybackRate', mockAudioPlayerInstance.setPlaybackRate) as (
      rate: number,
      quality?: string,
    ) => void,
    shouldCorrectPitch: false,
    __release: () => {
      released = true;
      mockAudioReleaseCount += 1;
    },
    __isReleased: () => released,
  };
}

/** The most recent source `useAudioPlayer` was pointed at. `null` when the player was released. */
let mockAudioSource: { readonly uri: string } | null = null;
/** How many instances have been released, so a test can assert against a double release. */
let mockAudioReleaseCount = 0;
/** The instance the most recent render returned, for tests that need its identity. */
let mockAudioCurrentPlayer: MockAudioPlayer | null = null;
/** Which instance the current `didJustFinish` belongs to. A completion is not transferable. */
let mockAudioFinishedForPlayer: number | null = null;
/**
 * When true, the completion flag is reported to **every** player, not just the one that earned it.
 *
 * ── Why the double has to be able to do this ────────────────────────────────
 * The note below used to claim that a completion leaking across a source change was "a property of
 * the double, not of the device". That claim was wrong, and believing it is what let a skipping
 * player reach a physical device with a green suite behind it.
 *
 * On the device, `useAudioPlayerStatus` holds its status in React state. When the source changes
 * there is at least one commit where `player` is the **new** instance and the status in state is
 * still the **old** one — carrying `didJustFinish: true`. The consumer sees a new player and a
 * finished status in the same render. The double removed that commit entirely by scoping the flag
 * to an instance id, so the race it produces could not be written down, let alone tested.
 *
 * The scoping stays the default, because a well-behaved sequence really does look like that. This
 * flag is how a test asks for the other, real, commit.
 */
let mockAudioFinishLeaks = false;

/**
 * Components currently reading the status, so a change re-renders them.
 *
 * ── Why a subscription and not a mutable object ─────────────────────────────
 * The first version of this double let a test assign `mockAudio.state.playing = true` and assert the
 * label changed. It never did: React has no way to know a plain object was mutated, so the component
 * kept rendering the previous status and the test was really asserting nothing. Wrapping the read in
 * `useState` and notifying makes "the player started buffering" an event the tree actually sees —
 * which is the whole point, since buffering and load failure are states no real player reaches under
 * Jest.
 */
type MockAudioStatus = typeof mockAudioPlayerState;

const mockAudioListeners = new Set<(status: MockAudioStatus) => void>();

jest.mock('expo-audio', () => {
  const react = jest.requireActual<typeof import('react')>('react');
  return {
    /**
     * `useAudioPlayer`, modelled on `expo-modules-core`'s `useReleasingSharedObject`.
     *
     * Three behaviours are copied from the real implementation because the bugs live in them:
     *
     *   1. **A new instance per source.** The player is keyed on the serialised source, exactly as
     *      the SDK keys `useReleasingSharedObject` on `JSON.stringify(initialSource)`.
     *   2. **The previous instance is released when the source changes**, in an effect rather than
     *      during render.
     *   3. **The instance is released on unmount, from a cleanup registered here** — inside the
     *      hook. That placement is the load-bearing part: React runs cleanups in the order their
     *      effects were declared, so this one runs before any cleanup the *consumer* registers
     *      after calling `useAudioPlayer`. A consumer that touches the player on unmount therefore
     *      touches a released object, which is the defect this double now reproduces.
     */
    useAudioPlayer: (source: { uri: string } | null = null) => {
      const key = JSON.stringify(source ?? null);
      const instance = react.useRef<MockAudioPlayer | null>(null);
      const pendingRelease = react.useRef<MockAudioPlayer | null>(null);
      const previousKey = react.useRef<string>(key);

      if (instance.current === null) {
        instance.current = mockCreateAudioPlayer();
        mockAudioSource = source;
      }

      const player = react.useMemo(() => {
        if (previousKey.current !== key) {
          pendingRelease.current = instance.current;
          instance.current = mockCreateAudioPlayer();
          previousKey.current = key;
        }
        mockAudioSource = source;
        return instance.current as MockAudioPlayer;
      }, [key]);

      mockAudioCurrentPlayer = player;

      react.useEffect(() => {
        if (pendingRelease.current !== null) {
          pendingRelease.current.__release();
          pendingRelease.current = null;
        }
      }, [player]);

      react.useEffect(() => {
        return () => {
          instance.current?.__release();
        };
      }, []);

      return player;
    },
    /**
     * `useAudioPlayerStatus`, including the part that resets when the player changes.
     *
     * The real hook is `useEvent(player, PLAYBACK_STATUS_UPDATE, player.currentStatus)`, and its
     * fallback is memoised on `player.id`. A **new** player therefore starts from that player's own
     * status — not loaded, not playing, and emphatically **not** just finished.
     *
     * Modelling that matters because `didJustFinish` is sticky in this double: without the reset, a
     * verse finishing would leave the flag set across the swap to the next verse, the auto-advance
     * effect would see a completion that belongs to the player before last, and one finish would
     * walk the whole surah. That is a property of the double, not of the device, and a test tuned to
     * it would be tuned to a lie.
     */
    useAudioPlayerStatus: (player: { id: number }) => {
      const [status, setStatus] = react.useState(() => ({ ...mockAudioPlayerState }));
      react.useEffect(() => {
        const listener = (next: MockAudioStatus): void => setStatus({ ...next });
        mockAudioListeners.add(listener);
        // Re-sync on mount, so a status set before this component rendered is not missed.
        listener(mockAudioPlayerState);
        return () => {
          mockAudioListeners.delete(listener);
        };
      }, []);

      /**
       * A completion belongs to the instance that reported it.
       *
       * `mockAudioFinishedForPlayer` is stamped when a test sets `didJustFinish`, and the flag is
       * only reported to the player it was stamped for. Without this the flag is sticky and global:
       * a verse finishing would still read as finished on the *next* verse's player, so a single
       * completion would walk the whole surah — an artefact of the double that a test tuned to it
       * would enshrine.
       */
      const belongsHere = mockAudioFinishLeaks || mockAudioFinishedForPlayer === player.id;
      return status.didJustFinish && !belongsHere ? { ...status, didJustFinish: false } : status;
    },
    setAudioModeAsync: jest.fn(async () => undefined),
  };
});

const MOCK_AUDIO_DEFAULTS = {
  isLoaded: true,
  playing: false,
  isBuffering: false,
  didJustFinish: false,
  currentTime: 0,
  duration: 0,
};

/** Exposed so a test can drive the player's reported state. */
export const mockAudio = {
  /**
   * The recorded calls, aggregated across every instance.
   *
   * `mockAudio.player.pause` still answers "was pause called", which is what almost every assertion
   * wants. When a test needs to know *which* instance, or whether one is dead, use the two helpers
   * below.
   */
  player: mockAudioPlayerInstance,
  /** The URI currently loaded, or null. Lets a test assert *what* is being played. */
  currentUri: (): string | null => mockAudioSource?.uri ?? null,
  /** The instance the last render returned. Its identity changes when the source does. */
  currentPlayer: (): MockAudioPlayer | null => mockAudioCurrentPlayer,
  /** How many native instances have been released. A second release of one would show here. */
  releaseCount: (): number => mockAudioReleaseCount,
  /** Reports a new player status to every mounted consumer. */
  setStatus(patch: Partial<typeof MOCK_AUDIO_DEFAULTS>): void {
    if (patch.didJustFinish === true) {
      // Stamped with the instance that is loaded now, so the flag cannot outlive it.
      mockAudioFinishedForPlayer = mockAudioCurrentPlayer?.id ?? null;
    }
    Object.assign(mockAudioPlayerState, patch);
    for (const listener of mockAudioListeners) {
      listener(mockAudioPlayerState);
    }
  },

  /**
   * Reports a completion that is visible to **whatever player is current**, including a new one.
   *
   * This is the device's real behaviour across a source change, and it is what reproduces the
   * skip: the consumer observes a fresh player and a still-finished status in one commit. Every
   * subsequent `setStatus` keeps leaking until `reset` or `stopLeaking` — a stale flag does not
   * un-stale itself, which is the point.
   */
  emitLeakedFinish(): void {
    mockAudioFinishLeaks = true;
    // `isLoaded` is deliberately left as it stands: a leak arriving while the replacement source is
    // still buffering is a distinct case from one arriving after it has loaded, and a test must be
    // able to ask for either.
    Object.assign(mockAudioPlayerState, { didJustFinish: true });
    for (const listener of mockAudioListeners) {
      listener(mockAudioPlayerState);
    }
  },

  /**
   * Re-notifies subscribers with the status exactly as it stands, changing nothing.
   *
   * This is a **duplicate observation of one completion**, which is what a re-render produces:
   * `didJustFinish` is a status flag, so it is still set and still belongs to the same source.
   * Distinct from calling `setStatus({ didJustFinish: true })` again, which re-stamps the flag to
   * whatever player is current and is therefore a *new* completion for a *new* source.
   */
  replayStatus(): void {
    for (const listener of mockAudioListeners) {
      listener(mockAudioPlayerState);
    }
  },

  /** Ends the leak and clears the flag, as the platform does once the new source reports in. */
  stopLeaking(): void {
    mockAudioFinishLeaks = false;
    Object.assign(mockAudioPlayerState, { didJustFinish: false });
    for (const listener of mockAudioListeners) {
      listener(mockAudioPlayerState);
    }
  },
  reset(): void {
    mockAudioFinishLeaks = false;
    Object.assign(mockAudioPlayerState, MOCK_AUDIO_DEFAULTS);
    mockAudioSource = null;
    mockAudioCurrentPlayer = null;
    mockAudioFinishedForPlayer = null;
    mockAudioReleaseCount = 0;
    mockAudioListeners.clear();
    mockAudioPlayerInstance.play.mockClear();
    mockAudioPlayerInstance.pause.mockClear();
    mockAudioPlayerInstance.seekTo.mockClear();
    mockAudioPlayerInstance.setPlaybackRate.mockClear();
    mockAudioPlayerInstance.remove.mockClear();
  },
};

/**
 * `expo-file-system`, as an in-memory filesystem.
 *
 * ── Why a real double rather than a stub of the store ───────────────────────
 * The Qur'an reader now writes recitation audio to disk, and the parts of that worth testing are
 * precisely the parts a stubbed `AudioStore` would skip: that a transfer writes to `<name>.part` and
 * is only renamed onto the playable name after its bytes validate, that an aborted transfer leaves
 * nothing behind, and that a body which is not audio is deleted rather than cached. Those are
 * properties of `expo-audio-store.ts`, so the thing that has to be doubled is the filesystem
 * underneath it.
 *
 * The model is a flat `Map` from URI to bytes. Directories exist only as a prefix, which is enough:
 * nothing in the app nests, and `list()` is a prefix scan.
 */
const mockFsFiles = new Map<string, { bytes: Uint8Array; lastModified: number }>();

/** What a download of a given URL produces. Replaced per test; the default is valid MP3 bytes. */
let mockFsResponder: (url: string) => Uint8Array | Error = () => mockAudioBytes(4096);

/** Free space the double reports, so the low-storage branch is reachable. */
let mockFsFreeBytes = 8 * 1024 * 1024 * 1024;

/** A buffer that begins with an ID3 tag, which is what `isPlausibleAudio` accepts. */
function mockAudioBytes(size: number): Uint8Array {
  const bytes = new Uint8Array(size);
  bytes[0] = 0x49;
  bytes[1] = 0x44;
  bytes[2] = 0x33;
  return bytes;
}

/** Exposed so a test can seed files, script a transfer, and read what was written. */
export const mockFileSystem = {
  files: mockFsFiles,
  /** Bytes that pass validation, of any length. */
  audioBytes: mockAudioBytes,
  /** Every URI currently present, including partials. */
  uris: (): string[] => [...mockFsFiles.keys()],
  /** Scripts what the next downloads return: bytes, or an `Error` to reject with. */
  respondWith(responder: (url: string) => Uint8Array | Error): void {
    mockFsResponder = responder;
  },
  setFreeBytes(value: number): void {
    mockFsFreeBytes = value;
  },
  /** Places a file directly, bypassing the transfer. `lastModified` drives expiry tests. */
  seed(uri: string, bytes: Uint8Array, lastModified: number = Date.now()): void {
    mockFsFiles.set(uri, { bytes, lastModified });
  },
  reset(): void {
    mockFsFiles.clear();
    mockFsResponder = () => mockAudioBytes(4096);
    mockFsFreeBytes = 8 * 1024 * 1024 * 1024;
  },
};

jest.mock('expo-file-system', () => {
  /**
   * Joins path segments without touching the scheme's own `//`.
   *
   * Written as a fold that trims the seam rather than as a join-then-collapse, because collapsing
   * runs of slashes afterwards turns `file:///cache` into `file://cache` — a malformed URI that
   * every assertion built on `toContain` would still pass against.
   */
  const join = (parts: (string | { uri: string })[]): string =>
    parts
      .map((part) => (typeof part === 'string' ? part : part.uri))
      .filter((part) => part.length > 0)
      .reduce(
        (accumulated, part) =>
          accumulated === ''
            ? part
            : `${accumulated.replace(/\/+$/, '')}/${part.replace(/^\/+/, '')}`,
        '',
      );

  class MockDirectory {
    readonly uri: string;
    constructor(...uris: (string | { uri: string })[]) {
      this.uri = join(uris);
    }
    get exists(): boolean {
      // A directory exists once anything has been written under it, or once `create` marked it.
      return [...mockFsFiles.keys()].some((uri) => uri.startsWith(`${this.uri}/`));
    }
    create(): void {
      // Nothing to do: the flat map needs no directory entry, and `create` is idempotent by design.
    }
    list(): MockFile[] {
      return [...mockFsFiles.keys()]
        .filter((uri) => uri.startsWith(`${this.uri}/`))
        .map((uri) => new MockFile(uri));
    }
    delete(): void {
      for (const uri of [...mockFsFiles.keys()]) {
        if (uri.startsWith(`${this.uri}/`)) {
          mockFsFiles.delete(uri);
        }
      }
    }
  }

  class MockFile {
    readonly uri: string;
    constructor(...uris: (string | { uri: string })[]) {
      this.uri = join(uris);
    }
    get name(): string {
      return this.uri.slice(this.uri.lastIndexOf('/') + 1);
    }
    get exists(): boolean {
      return mockFsFiles.has(this.uri);
    }
    get size(): number {
      return mockFsFiles.get(this.uri)?.bytes.length ?? 0;
    }
    get lastModified(): number | null {
      return mockFsFiles.get(this.uri)?.lastModified ?? null;
    }
    delete(): void {
      if (!mockFsFiles.has(this.uri)) {
        throw new Error('ENOENT');
      }
      mockFsFiles.delete(this.uri);
    }
    open(): { readBytes: (length: number) => Uint8Array; close: () => void } {
      const entry = mockFsFiles.get(this.uri);
      if (entry === undefined) {
        throw new Error('ENOENT');
      }
      return {
        readBytes: (length: number) => entry.bytes.slice(0, length),
        close: () => undefined,
      };
    }
    moveSync(destination: MockFile): void {
      const entry = mockFsFiles.get(this.uri);
      if (entry === undefined) {
        throw new Error('ENOENT');
      }
      mockFsFiles.delete(this.uri);
      mockFsFiles.set(destination.uri, entry);
    }
    static async downloadFileAsync(
      url: string,
      destination: MockFile,
      options?: { signal?: AbortSignal },
    ): Promise<MockFile> {
      // Awaited once so the transfer is genuinely asynchronous: a synchronous double would let a
      // test pass that depends on two preparations overlapping when they never could.
      await Promise.resolve();
      if (options?.signal?.aborted === true) {
        const error = new Error('Aborted');
        error.name = 'AbortError';
        throw error;
      }
      const produced = mockFsResponder(url);
      if (produced instanceof Error) {
        throw produced;
      }
      mockFsFiles.set(destination.uri, { bytes: produced, lastModified: Date.now() });
      return destination;
    }
  }

  return {
    File: MockFile,
    Directory: MockDirectory,
    FileMode: { ReadOnly: 'r', ReadWrite: 'rw', WriteOnly: 'w', Append: 'wa', Truncate: 'wt' },
    Paths: {
      get cache(): MockDirectory {
        return new MockDirectory('file:///cache');
      },
      get document(): MockDirectory {
        return new MockDirectory('file:///documents');
      },
      get availableDiskSpace(): number {
        return mockFsFreeBytes;
      },
    },
  };
});

jest.mock('expo-clipboard', () => {
  let contents = '';
  return {
    setStringAsync: (text: string) => {
      contents = text;
      return Promise.resolve(true);
    },
    getStringAsync: () => Promise.resolve(contents),
  };
});

/**
 * `expo-crypto`, which is a native module and has no JS implementation under Jest.
 *
 * Only `getRandomValues` is needed here: `pending-auth-flow.ts` uses it to mint `nl_rid`. The values
 * are deliberately *not* cryptographic in tests — they only have to be distinct, so that a suite can
 * tell two pending requests apart. Nothing under test depends on their unpredictability.
 */
jest.mock('expo-crypto', () => {
  let calls = 0;
  // Spread the real module first: `web-crypto.ts` also uses `digest` and `CryptoDigestAlgorithm`, and
  // replacing the whole module would take those away from every suite that exercises PKCE hashing.
  return {
    ...jest.requireActual('expo-crypto'),
    getRandomValues: (array: Uint8Array) => {
      calls += 1;
      // The call number is written across the leading bytes, so every id this returns is distinct
      // for the life of the process rather than distinct only until a byte pattern wraps.
      for (let index = 0; index < array.length; index += 1) {
        array[index] = index < 4 ? (calls >>> (index * 8)) & 0xff : (calls + index * 17) & 0xff;
      }
      return array;
    },
  };
});

/**
 * Secure store: an in-memory stand-in for the Keystore.
 *
 * `isAvailableAsync` resolves true so the token-writing path is exercised rather than skipped —
 * the session-storage tests need to observe that a token goes here and never to AsyncStorage.
 *
 * ── Why a token is seeded ───────────────────────────────────────────────────
 * The store starts holding an access token, so `AuthProvider` restores a session and screens
 * behind authentication render signed-in. That is the realistic precondition for those screens:
 * Main Home is only reachable with a session, and rendering it without one is a state the app
 * never produces. On a real device a fresh install has no token, so launch correctly resolves
 * to signed-out and routes into the entry flow.
 *
 * Entry-flow tests that need the signed-out path clear this key first.
 */
jest.mock('expo-secure-store', () => {
  /**
   * The backing map is hung off `globalThis` rather than closed over.
   *
   * `jest.resetModules()` re-evaluates mock factories, so a closed-over Map would be replaced — and a
   * suite that simulates a process restart that way would silently lose the very storage it is
   * checking survived. Real secure storage outlives a process; this double now does too.
   */
  const globals = globalThis as { __noorlifeSecureStore?: Map<string, string> };
  globals.__noorlifeSecureStore ??= new Map<string, string>([
    ['noorlife.auth.accessToken', 'jest-seeded-token'],
  ]);
  const store = globals.__noorlifeSecureStore;
  return {
    isAvailableAsync: () => Promise.resolve(true),
    getItemAsync: (key: string) => Promise.resolve(store.get(key) ?? null),
    setItemAsync: (key: string, value: string) => {
      store.set(key, value);
      return Promise.resolve();
    },
    deleteItemAsync: (key: string) => {
      store.delete(key);
      return Promise.resolve();
    },
  };
});

/**
 * Supabase configuration for tests.
 *
 * Set before any test module is imported, because `src/lib/supabase.ts` reads these at import time to
 * decide whether the backend is configured. Obvious non-secret placeholders — no real project is
 * contacted, since `createClient` itself is mocked below.
 */
process.env.EXPO_PUBLIC_SUPABASE_URL = 'http://localhost:54321';
process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'test-publishable-key';

/**
 * The `public.profiles` row the double serves, and the values it is restored to.
 *
 * Held outside the `jest.mock` factory so `beforeEach` can reset it. A write through the double
 * *mutates* this row — see the note on `from` below — which means a test that saves a new name and a
 * later test that expects the original one would otherwise interfere.
 *
 * The `mock` name prefix is required: `jest.mock` factories are hoisted above variable declarations,
 * and Jest only permits a factory to close over an out-of-scope variable when its name starts with
 * `mock`.
 */
const mockProfileRow: {
  id: string;
  full_name: string | null;
  avatar_url: string | null;
  onboarding_completed: boolean;
} = {
  id: 'test-user-id',
  full_name: 'Ahmed Al-Rashid',
  avatar_url: null,
  onboarding_completed: true,
};
const MOCK_PROFILE_DEFAULTS = { ...mockProfileRow };

/**
 * Supabase client double.
 *
 * Resolves a confirmed session for a demo user, which is the realistic precondition for any screen
 * behind authentication: Main Home is only reachable with one, and rendering it signed-out is a state
 * the app never produces. On a device with no `.env` the real client is null and launch correctly
 * resolves to signed-out, routing into the entry flow.
 *
 * Only the surface the service actually calls is implemented. A fuller fake would invite tests to
 * assert against the double rather than against our own code.
 */
jest.mock('@supabase/supabase-js', () => {
  const session = {
    /**
     * A session carries an access token, because the real one does and because one code path now
     * depends on it: `signOutEverywhere` reads the session before asking for a global sign-out,
     * since `supabase-js` skips the network entirely — and still answers `{ error: null }` — when
     * there is no token to present. A double without one would make that path look like the normal
     * case.
     */
    access_token: 'jest-session-access-token',
    user: {
      id: 'test-user-id',
      email: 'ahmed@example.com',
      email_confirmed_at: '2026-01-01T00:00:00Z',
      user_metadata: { full_name: 'Ahmed Al-Rashid' },
      /**
       * Where Supabase records the sign-in method.
       *
       * Deliberately *not* updated by a profile write, because the real backend does not update it
       * either: `user_metadata.full_name` is the copy taken at signup, and `public.profiles` is the
       * record from then on. Keeping the two able to disagree is what lets a test prove the app
       * prefers the durable row.
       */
      app_metadata: { provider: 'email' },
    },
  };
  return {
    createClient: () => ({
      auth: {
        getSession: () => Promise.resolve({ data: { session }, error: null }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => undefined } } }),
        signInWithPassword: () => Promise.resolve({ data: { session }, error: null }),
        signUp: () => Promise.resolve({ data: { session: null, user: session.user }, error: null }),
        signOut: () => Promise.resolve({ error: null }),
        resetPasswordForEmail: () => Promise.resolve({ error: null }),
        updateUser: () => Promise.resolve({ data: { user: session.user }, error: null }),
        resend: () => Promise.resolve({ error: null }),
        verifyOtp: () => Promise.resolve({ data: { session }, error: null }),
        exchangeCodeForSession: () => Promise.resolve({ data: { session }, error: null }),
        signInWithOAuth: () => Promise.resolve({ data: { url: null }, error: null }),
        signInWithIdToken: () => Promise.resolve({ data: { session }, error: null }),
      },
      /**
       * The query builder, as supabase-js actually shapes it.
       *
       * Every method returns the builder and the builder itself is thenable, which is what makes
       * `.from(t).update(v).eq('id', x)` awaitable — the real client works this way, and a double
       * whose `update` returned a bare promise made `.eq` a type error at runtime that only
       * survived because its one caller swallowed failures.
       *
       * ── Why a write actually writes ─────────────────────────────────────────
       * `update` applies the patch to the stored row, so a subsequent read returns what was
       * written. A double that accepted writes and then kept serving the old value would make
       * "Profile Home shows the new name without a restart" pass or fail for reasons that have
       * nothing to do with the app — the read would be stale no matter what the app did.
       */
      from: () => {
        const chain = {
          select: () => chain,
          eq: () => chain,
          update: (patch: Record<string, unknown>) => {
            Object.assign(mockProfileRow, patch);
            return chain;
          },
          // A copy, so a caller holding the result cannot mutate the stored row by accident.
          maybeSingle: () => Promise.resolve({ data: { ...mockProfileRow }, error: null }),
          then: (resolve: (value: { data: null; error: null }) => unknown) =>
            Promise.resolve(resolve({ data: null, error: null })),
        };
        return chain;
      },
    }),
  };
});

// Auth session: `makeRedirectUri` needs the expo-constants manifest, which jsdom has no equivalent of.
jest.mock('expo-auth-session', () => ({
  makeRedirectUri: () => 'noorlifeapp://',
}));

/**
 * Linking: the deep-link boundary, stood in with something a test can drive.
 *
 * ── Why this is global rather than per-suite ─────────────────────────────────
 * `AuthCallbackProvider` is inside `AppProviders`, so *every* suite that renders a screen now reaches
 * `getInitialURL` and `addEventListener` on mount. Left to the real module those are native calls with
 * no implementation under Jest: they resolved slowly and non-deterministically, and the two provider
 * suites measured on this machine went from 8.0 s to 13.0 s for no assertion's benefit.
 *
 * The default is the honest cold-start case — the app was **not** launched by a link — so no suite
 * inherits a pending callback it did not ask for. `mockLinking` is exported so the callback suites can
 * set a launch URL or fire a warm `url` event, which is the only way to test either on a machine that
 * cannot make Android send an intent.
 *
 * The `mock` name prefix is required: `jest.mock` factories are hoisted above variable declarations,
 * and Jest only permits a factory to close over an out-of-scope variable when its name starts with
 * `mock`.
 */
const mockLinkingInstance = {
  /** Handlers registered through `addEventListener('url', …)`, so a test can fire one. */
  urlHandlers: new Set<(event: { url: string }) => void>(),
  getInitialURL: jest.fn<Promise<string | null>, []>(() => Promise.resolve(null)),
  canOpenURL: jest.fn<Promise<boolean>, [string]>(() => Promise.resolve(true)),
  openURL: jest.fn<Promise<boolean>, [string]>(() => Promise.resolve(true)),
  openSettings: jest.fn<Promise<void>, []>(() => Promise.resolve()),
  createURL: jest.fn<string, [string]>(
    (path: string) => `noorlifeapp://${path.replace(/^\//, '')}`,
  ),
  /** Delivers a warm-start URL to every registered handler. */
  emit(url: string) {
    for (const handler of mockLinkingInstance.urlHandlers) {
      handler({ url });
    }
  },
};

jest.mock('expo-linking', () => ({
  getInitialURL: () => mockLinkingInstance.getInitialURL(),
  canOpenURL: (url: string) => mockLinkingInstance.canOpenURL(url),
  openURL: (url: string) => mockLinkingInstance.openURL(url),
  openSettings: () => mockLinkingInstance.openSettings(),
  createURL: (path: string) => mockLinkingInstance.createURL(path),
  addEventListener: (_type: string, handler: (event: { url: string }) => void) => {
    mockLinkingInstance.urlHandlers.add(handler);
    return {
      remove: () => {
        mockLinkingInstance.urlHandlers.delete(handler);
      },
    };
  },
}));

/** Exposed so the callback suites can simulate a cold-start launch URL and a warm `url` event. */
export const mockLinking = mockLinkingInstance;

// Apple authentication: unavailable in the test environment, which is also the Android behaviour.
jest.mock('expo-apple-authentication', () => ({
  isAvailableAsync: () => Promise.resolve(false),
  signInAsync: () => Promise.reject(new Error('unavailable')),
  AppleAuthenticationButton: () => null,
  AppleAuthenticationButtonType: { CONTINUE: 2 },
  AppleAuthenticationButtonStyle: { WHITE_OUTLINE: 1 },
  AppleAuthenticationScope: { FULL_NAME: 0, EMAIL: 1 },
}));

// Router: navigation is asserted by inspecting the shared double above.
jest.mock('expo-router', () => ({
  useRouter: () => mockRouterInstance,
  useLocalSearchParams: () => ({ ...mockRouteParams }),
  useGlobalSearchParams: () => ({ ...mockRouteParams }),
  usePathname: () => '/home',
  useSegments: () => [],
  useFocusEffect: () => undefined,
  /**
   * `Redirect` renders an observable marker rather than nothing.
   *
   * It used to render `null`, which made a redirect indistinguishable from a screen that rendered
   * nothing — and the entry gate's whole job is choosing a destination. The rule Phase 6C-3C has to
   * guarantee ("a cold-start callback resolves to `/auth/callback` *instead of* Main Home") is a
   * statement about which href the gate produced, so the href has to be readable.
   *
   * A `View` with the href as its accessibility label, so a test reads a prop rather than parsing a
   * rendered string. Nothing navigates: this is the whole of the stand-in.
   */
  Redirect: ({ href }: { readonly href?: unknown }) =>
    // `jest.requireActual` rather than a bare `require`: a `jest.mock` factory may not close over an
    // out-of-scope import, and this keeps the file free of `require()`-style imports.
    jest
      .requireActual<typeof import('react')>('react')
      .createElement(jest.requireActual<typeof import('react-native')>('react-native').View, {
        testID: 'router-redirect',
        accessibilityLabel: typeof href === 'string' ? href : JSON.stringify(href),
      }),
  Link: ({ children }: { readonly children?: unknown }) => children,
  Stack: () => null,
  Tabs: () => null,
  router: mockRouterInstance,
}));

/** Exposed so tests can assert navigation. */
export const mockRouter = mockRouterInstance;

/**
 * Sets the route parameters the next render will read. Cleared between tests.
 *
 * Call before rendering a screen that lives at a parameterised route — the reader at
 * `/faith/reader/[surah]` is the first of them.
 */
export function setRouteParams(params: Readonly<Record<string, string | string[]>>): void {
  for (const key of Object.keys(mockRouteParams)) {
    delete mockRouteParams[key];
  }
  Object.assign(mockRouteParams, params);
}

beforeEach(() => {
  for (const value of Object.values(mockRouterInstance)) {
    value.mockClear();
  }
  // Unconditional, so a suite that never sets parameters cannot inherit another's.
  setRouteParams({});
  mockAudio.reset();
  // The filesystem is process-wide, so a file written by one test would otherwise be found by the
  // next one's cache read — which is exactly the kind of cross-test leak an audio cache invites.
  mockFileSystem.reset();
  /**
   * The Qur'an catalogue snapshot is a module-level singleton, by design.
   *
   * It has to be, because the whole point of it is to be readable during a component's first render,
   * before any provider effect has run — see `quran-catalogue-warmup.ts`. That makes it process-wide,
   * and a process-wide cache is exactly the thing that leaks between tests: a suite injecting its own
   * Qur'an repository would otherwise be served the catalogue a previous suite's repository produced,
   * and would assert against data it never supplied.
   */
  resetSurahCatalogueWarmup();
  // The profile row is writable, so it is restored between tests.
  Object.assign(mockProfileRow, MOCK_PROFILE_DEFAULTS);

  /**
   * Linking is restored to "the app was not launched by a link".
   *
   * A launch URL set by one test would otherwise give the next one a pending callback it never asked
   * for — and because the provider deduplicates by code, the symptom would be a test that passes
   * alone and fails in sequence. The handler set is cleared too: an unmounted provider's listener is
   * removed by its own effect, but a test that throws mid-render never gets there.
   */
  mockLinkingInstance.getInitialURL.mockReset();
  mockLinkingInstance.getInitialURL.mockResolvedValue(null);
  mockLinkingInstance.canOpenURL.mockClear();
  mockLinkingInstance.openURL.mockClear();
  mockLinkingInstance.openSettings.mockClear();
  mockLinkingInstance.urlHandlers.clear();
});

/**
 * `expo-notifications`: a stand-in, because the real module needs a native runtime.
 *
 * ── Why the whole module and not just the scheduling calls ──────────────────
 * `expo-notifications.port.ts` registers a notification handler at module scope — deliberately, so a
 * prayer alert arriving on a cold start is presented with NoorLife's settings rather than the
 * platform's. That means the module is evaluated the moment anything imports the DI context, which
 * in Jest is almost every Faith suite. Without this, importing a screen fails before a test runs.
 *
 * The behaviour under test is exercised through `createFakeNotificationPort`, which is a real
 * stateful implementation. This mock exists only so the import graph resolves; it deliberately
 * grants nothing and schedules nothing, so a test that reached the real port by accident would fail
 * visibly rather than appear to pass.
 */
jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  getPermissionsAsync: jest.fn(async () => ({
    granted: false,
    canAskAgain: true,
    status: 'undetermined',
  })),
  requestPermissionsAsync: jest.fn(async () => ({
    granted: false,
    canAskAgain: true,
    status: 'undetermined',
  })),
  setNotificationChannelAsync: jest.fn(async () => undefined),
  scheduleNotificationAsync: jest.fn(async () => 'jest-notification-id'),
  cancelScheduledNotificationAsync: jest.fn(async () => undefined),
  getAllScheduledNotificationsAsync: jest.fn(async () => []),
  PermissionStatus: { UNDETERMINED: 'undetermined', GRANTED: 'granted', DENIED: 'denied' },
  AndroidImportance: { DEFAULT: 3, HIGH: 4 },
  SchedulableTriggerInputTypes: { DATE: 'date', TIME_INTERVAL: 'timeInterval' },
}));
