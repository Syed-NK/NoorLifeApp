import {
  cleanup,
  configure,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import React, { type ReactElement } from 'react';

import { warmUpFirstMount } from '@/test-support/mock-latency-timers';

import { mockAudio, setRouteParams } from '../../../../jest.setup';

import type { FaithRepositories } from '../data';
import { createMockFaithRepositories } from '../data/mock';
import type { AyahRecitation } from '../data/quran-content.repository';
import { createExpoAudioStore, createRecitationAudio } from '../data/audio';
import { FaithRepositoryProvider } from '../di/faith-repository-context';
import { RecitationAudioProvider } from '../di/recitation-audio-context';
import { ReaderScreen } from '../screens/reader-screen';

/**
 * The recitation player's **lifecycle**, as distinct from its behaviour.
 *
 * ── The defect this file exists for ─────────────────────────────────────────
 * Closing the reader crashed the screen with
 *
 *     Call to function 'AudioPlayer.pause' has been rejected.
 *     → Caused by: Cannot use shared object that was already released
 *     code: 'ERR_USING_RELEASED_SHARED_OBJECT'
 *     componentStack: at ReaderBody … at FaithResourceView …
 *
 * on an API 36 emulator, every single time. `useRecitationPlayer` registered
 * `useEffect(() => () => player.pause(), [player])`, and `useAudioPlayer` — which the SDK 57 docs
 * describe as creating "an `AudioPlayer` instance that automatically releases when the component
 * unmounts" — registers its release in a cleanup at the point it is called, near the top of the
 * hook. React runs effect cleanups in the order their effects were declared, so the release always
 * ran first and the `pause` always landed on a freed native object.
 *
 * ── Why the existing recitation suite could not catch it ────────────────────
 * The `expo-audio` double returned one immortal player and had no notion of release, so a call on a
 * dead object was a call on a live one under Jest. The double now models
 * `useReleasingSharedObject`: a new instance per source, released when the source changes and on
 * unmount, throwing `ERR_USING_RELEASED_SHARED_OBJECT` if used afterwards. Every case below fails
 * against the pre-fix hook.
 *
 * ── What "must not crash" means as an assertion ─────────────────────────────
 * A throw from an effect cleanup can surface as a red screen, or it can be caught by React and
 * merely reported. So these assert on two channels: the tree still answers queries, **and** nothing
 * matching the released-object wording reached `console.error`. Checking only the first would pass
 * on a build that logged the crash and carried on.
 *
 * ── One harness note, learned the expensive way ─────────────────────────────
 * There is no `act(async () => undefined)` anywhere below. Flushing that way overlaps React's own
 * act scope — "You seem to have overlapping act() calls" — and the damage lands on the *next* test,
 * which then fails to render at all. Every wait here is a `waitFor` or a `findBy*` on the thing the
 * case is actually about.
 */
warmUpFirstMount(() => withRepositories(<ReaderScreen />));

/**
 * Three seconds for `findBy*`/`waitFor`, against the library's default of one.
 *
 * Real timers are kept on purpose: this suite drives the player through promise chains, and
 * `mock-latency-timers` records what happens to those under a fake clock — `waitFor` exhausts a
 * simulated budget in microseconds before they settle. What the real clock costs here is the Faith
 * fixtures' 280 ms per read, several reads per mount, twelve mounts. At one second the mount after
 * the rapid-switching case began timing out, which is a slow harness reported as a broken screen.
 * Three seconds stays inside Jest's five-second per-test budget, so a genuine hang still hangs.
 */
configure({ asyncUtilTimeout: 3000 });

/**
 * Fifteen seconds per test, against Jest's five.
 *
 * The rapid-switching case now drives six sequential selections, and each one passes through the
 * preparation layer — a transfer and a validation before the player is pointed anywhere. On a
 * saturated machine that ran past the default budget and reported a *harness* timeout as a broken
 * player. Fifteen seconds is still far below a hang: a genuinely wedged transport still hangs.
 */
jest.setTimeout(15000);

/**
 * Ayat one, two and **five** — not one, two, three.
 *
 * A play control only exists where a verse is rendered, and the Al-Fatihah fixture serves 1, 2 and
 * 5. Asking for a control on a verse the reader never drew would be a test failing on its own
 * fixture rather than on the code.
 */
const RECITATIONS: readonly AyahRecitation[] = [
  {
    surah: 1 as never,
    ayah: 1 as never,
    reciterId: '3',
    url: 'https://verses.quran.foundation/a/001001.mp3',
  },
  {
    surah: 1 as never,
    ayah: 2 as never,
    reciterId: '3',
    url: 'https://verses.quran.foundation/a/001002.mp3',
  },
  {
    surah: 1 as never,
    ayah: 5 as never,
    reciterId: '3',
    url: 'https://verses.quran.foundation/a/001005.mp3',
  },
];

/**
 * What the player is actually pointed at, which is a **local file** and not the CDN URL.
 *
 * The reader prepares each ayah before playing it, so the transport's source is a `file://` URI
 * under the audio cache directory. Asserting against these rather than against
 * `https://verses.quran.foundation/...` is what keeps this suite honest that preparation is in the
 * path: pointing the player back at the network would fail every one of these.
 */
const CACHE = 'file:///cache/faith-recitations';
const FIRST = `${CACHE}/r3-s1-a1.mp3`;
const SECOND = `${CACHE}/r3-s1-a2.mp3`;
const THIRD = `${CACHE}/r3-s1-a5.mp3`;

async function withRepositories(
  element: ReactElement,
  repositories?: Partial<FaithRepositories>,
): Promise<typeof screen> {
  const mocks = createMockFaithRepositories();
  await render(
    <FaithRepositoryProvider repositories={{ ...mocks, ...repositories }}>
      {/*
        A fresh audio service per render. The production one is a module singleton so its in-flight
        map survives navigation; that is exactly what must not survive between cases here, where a
        file prepared by one would let the next one's advance succeed without preparing anything.
      */}
      <RecitationAudioProvider audio={createRecitationAudio({ store: createExpoAudioStore() })}>
        {element}
      </RecitationAudioProvider>
    </FaithRepositoryProvider>,
  );
  return screen;
}

async function readerWithAudio(): Promise<typeof screen> {
  setRouteParams({ surah: '1' });
  const mocks = createMockFaithRepositories();
  const view = await withRepositories(<ReaderScreen />, {
    quran: {
      ...mocks.quran,
      listRecitations: async () => ({
        kind: 'ok',
        data: { items: RECITATIONS, nextCursor: null },
      }),
      availableReciters: async () => ({
        kind: 'ok',
        data: [{ id: '3', name: 'Abdur-Rahman as-Sudais', style: 'Murattal' }],
      }),
    },
  });
  // Settled before any case begins, so a slow mount is never mistaken for a missing control.
  await view.findByTestId('faith-reader-ayah-1-1');
  return view;
}

/**
 * Starts playback the only way the reader offers it: press the verse, then **Play** in its sheet.
 *
 * There is no per-ayah play button and no overflow menu. Every case here goes through the two
 * deliberate taps, which is also the executable statement that a one-tap control per ayah no longer
 * exists.
 */
async function playVerse(view: typeof screen, ayah: number): Promise<void> {
  fireEvent.press(await view.findByTestId(`faith-reader-ayah-1-${ayah}`));
  fireEvent.press(await view.findByTestId('faith-reader-action-play'));
}

/** Every message the released-object failure produces, in the wording the runtime uses. */
const RELEASED_OBJECT = /already released|ERR_USING_RELEASED_SHARED_OBJECT|has been rejected/i;

/**
 * Anything React reported during the test.
 *
 * Installed and removed by hooks rather than inside each test: a test that failed before its restore
 * line would otherwise leave `console.error` hijacked for every test after it, turning one real
 * failure into a page of misleading ones.
 */
let reportedErrors: string[] = [];
let originalConsoleError: typeof console.error;

/** The released-object failures reported so far. Empty is the passing state. */
function releasedObjectErrors(): readonly string[] {
  return reportedErrors.filter((line) => RELEASED_OBJECT.test(line));
}

beforeEach(() => {
  mockAudio.reset();
  reportedErrors = [];
  originalConsoleError = console.error;
  console.error = (...args: unknown[]) => {
    reportedErrors.push(args.map((entry) => String(entry)).join(' '));
  };
});

afterEach(async () => {
  /**
   * Unmounted explicitly, before the console is handed back.
   *
   * The library's automatic cleanup runs in its own `afterEach`, and the ordering between that and
   * this suite's hooks is not something to depend on: a case that leaves a reader mounted while
   * `mockAudio.reset()` clears the double's listeners produces a tree wired to nothing, and the
   * *next* case then renders into a wedged module state and fails for a reason that has nothing to
   * do with it. Tearing down here makes each case start from an empty tree.
   */
  await cleanup();
  console.error = originalConsoleError;
});

describe('opening the reader', () => {
  it('touches no released player when nothing is playing', async () => {
    /**
     * The reported entry point: the reader is opened, no verse has been pressed, and the screen
     * still reached a freed object. `ReaderBody` mounts and unmounts inside `FaithResourceView`
     * whenever the resource changes state, so "nothing was played" was never any protection.
     */
    await readerWithAudio();

    // Nothing was pressed, so nothing should have been asked of the player.
    expect(mockAudio.player.play).not.toHaveBeenCalled();
    expect(mockAudio.player.pause).not.toHaveBeenCalled();

    await cleanup();

    expect(releasedObjectErrors()).toEqual([]);
  });

  it('creates a player before a verse is chosen, and releases exactly that one', async () => {
    await readerWithAudio();

    const idle = mockAudio.currentPlayer();
    expect(idle).not.toBeNull();
    expect(mockAudio.currentUri()).toBeNull();

    await cleanup();

    expect(idle?.__isReleased()).toBe(true);
    expect(mockAudio.releaseCount()).toBe(1);
  });
});

describe('React Strict Mode', () => {
  /**
   * The double setup/cleanup cycle, which is the harshest version of the same defect.
   *
   * ── What Strict Mode does to `useReleasingSharedObject` ─────────────────────
   * React mounts, tears down and remounts every effect. `useReleasingSharedObject` releases in the
   * `[]` cleanup — its `isFastRefresh` guard is `false` by then, because the setup that ran a moment
   * earlier set it — so the player **is** released on that simulated unmount, while the component
   * stays mounted. Any cleanup the app registers after `useAudioPlayer` runs in the same pass, after
   * that release. It is the unmount ordering again, arriving without anybody navigating anywhere.
   *
   * ── What this suite can and cannot assert ───────────────────────────────────
   * It asserts what **this app** does: no cleanup here touches a player, so a double cycle produces
   * no call from NoorLife's code and no released-object error.
   *
   * It cannot assert that Strict Mode is *supported*. It is not, and the limitation is the SDK's
   * rather than this hook's: `useReleasingSharedObject` does not recreate the object after releasing
   * it in that cleanup, so the instance the second setup keeps is a dead one. That is why this app
   * mounts no `StrictMode` boundary. The value of the case below is that it pins the half NoorLife
   * owns — and that when the SDK's own limitation does bite, the screen degrades to the play
   * control's retry state instead of crashing.
   */
  it('registers no cleanup that touches the player across a double cycle', async () => {
    setRouteParams({ surah: '1' });
    const mocks = createMockFaithRepositories();

    await render(
      <React.StrictMode>
        <FaithRepositoryProvider
          repositories={{
            ...mocks,
            quran: {
              ...mocks.quran,
              listRecitations: async () => ({
                kind: 'ok',
                data: { items: RECITATIONS, nextCursor: null },
              }),
              availableReciters: async () => ({
                kind: 'ok',
                data: [{ id: '3', name: 'Abdur-Rahman as-Sudais', style: 'Murattal' }],
              }),
            },
          }}
        >
          <RecitationAudioProvider audio={createRecitationAudio({ store: createExpoAudioStore() })}>
            <ReaderScreen />
          </RecitationAudioProvider>
        </FaithRepositoryProvider>
      </React.StrictMode>,
    );

    await screen.findByTestId('faith-reader-ayah-1-1');

    /**
     * The guard that stops this passing vacuously.
     *
     * A release while the tree is still mounted is the signature of the double cycle. If Strict Mode
     * ever stopped double-invoking effects this would read zero, and the case would be asserting
     * nothing — so it fails rather than passing quietly.
     */
    expect(mockAudio.releaseCount()).toBeGreaterThanOrEqual(1);

    // Nothing in this app spoke to a player during that cycle.
    expect(mockAudio.player.pause).not.toHaveBeenCalled();
    expect(releasedObjectErrors()).toEqual([]);

    await cleanup();

    expect(mockAudio.player.pause).not.toHaveBeenCalled();
    expect(releasedObjectErrors()).toEqual([]);
  });

  it('degrades to the retry state rather than crashing when the double cycle leaves a dead player', async () => {
    /**
     * The SDK's limitation, met head on. After Strict Mode's simulated unmount the instance the
     * hook holds is released, so the next `play` throws `ERR_USING_RELEASED_SHARED_OBJECT` from the
     * native boundary. Escaping the effect, that would take the whole reader down; caught, it is the
     * same nonfatal state a bad URL produces.
     */
    setRouteParams({ surah: '1' });
    const mocks = createMockFaithRepositories();

    await render(
      <React.StrictMode>
        <FaithRepositoryProvider
          repositories={{
            ...mocks,
            quran: {
              ...mocks.quran,
              listRecitations: async () => ({
                kind: 'ok',
                data: { items: RECITATIONS, nextCursor: null },
              }),
              availableReciters: async () => ({
                kind: 'ok',
                data: [{ id: '3', name: 'Abdur-Rahman as-Sudais', style: 'Murattal' }],
              }),
            },
          }}
        >
          <RecitationAudioProvider audio={createRecitationAudio({ store: createExpoAudioStore() })}>
            <ReaderScreen />
          </RecitationAudioProvider>
        </FaithRepositoryProvider>
      </React.StrictMode>,
    );

    fireEvent.press(await screen.findByTestId('faith-reader-ayah-1-1'));
    fireEvent.press(await screen.findByTestId('faith-reader-action-play'));

    // Whatever the platform did with that press, the surah is still on screen and readable.
    await waitFor(() => expect(screen.getByTestId('faith-reader-ayah-1-2')).toBeTruthy());
    expect(screen.getByTestId('faith-reader-arabic-1-1')).toBeTruthy();
  });
});

describe('unmounting', () => {
  it('does not call pause on the released player', async () => {
    /**
     * The regression, as directly as it can be stated: press play, unmount, and assert the freed
     * object was never spoken to. Against the pre-fix hook the double throws out of the cleanup.
     */
    const view = await readerWithAudio();
    await playVerse(view, 1);
    await view.findByTestId('faith-reader-player');

    const playing = mockAudio.currentPlayer();
    mockAudio.player.pause.mockClear();

    await cleanup();

    expect(playing?.__isReleased()).toBe(true);
    expect(mockAudio.player.pause).not.toHaveBeenCalled();
    expect(releasedObjectErrors()).toEqual([]);
  });

  it('releases once, not twice', async () => {
    // A double release is the other half of the same mistake: the SDK owns the lifetime, so this
    // app must neither pre-empt it nor repeat it.
    const view = await readerWithAudio();
    await playVerse(view, 1);
    await view.findByTestId('faith-reader-player');

    const before = mockAudio.releaseCount();
    await cleanup();

    expect(mockAudio.releaseCount()).toBe(before + 1);
  });
});

describe('changing what is loaded', () => {
  it('swaps players when the verse changes, and never reuses the released one', async () => {
    const view = await readerWithAudio();

    await playVerse(view, 1);
    await waitFor(() => expect(mockAudio.currentUri()).toBe(FIRST));
    const first = mockAudio.currentPlayer();

    await playVerse(view, 2);
    await waitFor(() => expect(mockAudio.currentUri()).toBe(SECOND));

    const second = mockAudio.currentPlayer();
    expect(second).not.toBe(first);
    // The outgoing instance is gone, and the incoming one is alive.
    expect(first?.__isReleased()).toBe(true);
    expect(second?.__isReleased()).toBe(false);
    expect(releasedObjectErrors()).toEqual([]);
  });

  it('survives switching through several verses in a row', async () => {
    /**
     * Every press releases the previous instance, so scrubbing through a surah is a run of releases
     * with a live player at the end of it — the shape a cleanup holding an outgoing player would
     * fire against repeatedly.
     *
     * ── Why each press waits for its own swap ──────────────────────────────────
     * An earlier version fired six presses in one synchronous loop. That is not a faster version of
     * this test, it is a broken one: each press schedules asynchronous work, so the next press's
     * `act` scope opens inside the previous one's and React reports "overlapping act() calls". The
     * suite then failed from *that* test onward, and none of those failures were about the player.
     *
     * Waiting for each swap still exercises the invariant — six loads, five releases, no completed
     * playback anywhere — while leaving the harness able to tell the truth.
     */
    const view = await readerWithAudio();

    const sequence: readonly (readonly [number, string])[] = [
      [1, FIRST],
      [2, SECOND],
      [5, THIRD],
      [1, FIRST],
      [5, THIRD],
      [2, SECOND],
    ];

    const seen: unknown[] = [];
    for (const [ayah, uri] of sequence) {
      await playVerse(view, ayah);
      await waitFor(() => expect(mockAudio.currentUri()).toBe(uri));
      seen.push(mockAudio.currentPlayer());
    }

    // Every instance but the last is gone, and the last one is alive and is the one on screen.
    for (const player of seen.slice(0, -1) as { __isReleased: () => boolean }[]) {
      expect(player.__isReleased()).toBe(true);
    }
    expect(mockAudio.currentPlayer()?.__isReleased()).toBe(false);
    expect(releasedObjectErrors()).toEqual([]);
  });

  it('survives running to the end of the surah and then unmounting', async () => {
    /**
     * Reaching the end of the loaded page stops the transport, which sets the source back to `null`,
     * which makes the SDK release the instance and build a fresh idle one. Unmounting after that
     * releases that *second* object — another chance for a stale cleanup to fire.
     *
     * The player has no Stop control any more; this is the path that reaches the same state, and it
     * is the one a listener actually takes.
     */
    const view = await readerWithAudio();
    await playVerse(view, 5);
    await view.findByTestId('faith-reader-player');
    await waitFor(() => expect(mockAudio.currentUri()).not.toBeNull());

    mockAudio.setStatus({ didJustFinish: true, isLoaded: true, playing: false });
    await waitFor(() => expect(mockAudio.currentUri()).toBeNull());

    await cleanup();

    expect(releasedObjectErrors()).toEqual([]);
  });
});

describe('auto-advance', () => {
  it('ignores a completion that belongs to no loaded verse', async () => {
    /**
     * The stale-callback case with real consequences. `didJustFinish` is a status **flag**, not an
     * event: it stays set until the player reports something else. Observed while nothing is loaded
     * — the state the end of a surah leaves behind — the old code computed the current index as
     * `-1` and played `ordered[0]`, so the reader started reciting verse one seconds after the
     * recitation had finished.
     */
    const view = await readerWithAudio();
    await playVerse(view, 5);
    await view.findByTestId('faith-reader-player');
    await waitFor(() => expect(mockAudio.currentUri()).not.toBeNull());

    // The last verse of the loaded page finishes, so the transport stops and unloads.
    mockAudio.setStatus({ didJustFinish: true, isLoaded: true, playing: false });
    await waitFor(() => expect(mockAudio.currentUri()).toBeNull());

    mockAudio.setStatus({ didJustFinish: true, playing: false });
    await new Promise((resolve) => setTimeout(resolve, 50));

    /*
      Nothing was loaded, so nothing may start. The player itself is still on screen — it is
      permanent now — so its presence proves nothing either way; what would prove a restart is a
      source being pointed at again, and there is none.
    */
    expect(mockAudio.currentUri()).toBeNull();
    /*
      Nothing is being recited. The verse is still the one the player is *pointed at*, which is a
      different statement and is drawn differently — see `verseState` for why the two must not be
      the same mark.
    */
    expect(view.queryByTestId('faith-reader-ayah-active-1-1')).toBeNull();
  });

  it('acts on a verse’s completion once, however often the flag is observed', async () => {
    /**
     * Any re-render that changes the auto-advance effect's dependencies observes the same still-set
     * flag again. Advancing per observation rather than per completion would skip verses — two
     * observations of verse one finishing would land on verse five.
     */
    const view = await readerWithAudio();
    await playVerse(view, 1);
    await waitFor(() => expect(mockAudio.currentUri()).toBe(FIRST));

    mockAudio.setStatus({ didJustFinish: true, playing: false });
    await waitFor(() => expect(mockAudio.currentUri()).toBe(SECOND));

    // The same flag, reported again against the verse that has already been advanced past.
    mockAudio.setStatus({ didJustFinish: true, playing: false });
    await waitFor(() => expect(mockAudio.currentUri()).toBe(THIRD));

    // Verse five, and not past the end of the list: one completion, one advance.
    expect(mockAudio.currentUri()).toBe(THIRD);
  });

  it('does not reach for a released player when the screen closes mid-advance', async () => {
    const view = await readerWithAudio();
    await playVerse(view, 1);
    await waitFor(() => expect(mockAudio.currentUri()).toBe(FIRST));

    // The verse finishes, and the user leaves before the next one has started.
    mockAudio.setStatus({ didJustFinish: true, playing: false });
    await cleanup();

    expect(releasedObjectErrors()).toEqual([]);
  });
});

describe('audio failure', () => {
  it('renders a retry rather than crashing when the platform refuses to play', async () => {
    /**
     * A rejected native call — an unplayable URL, denied audio focus, a missing codec — throws a
     * `CodedError`. Escaping an effect, that unmounts the tree behind an error boundary: a screen
     * full of scripture disappearing because a sound file would not open. It has to degrade to the
     * control's own retry state instead.
     */
    const view = await readerWithAudio();
    mockAudio.player.play.mockImplementationOnce(() => {
      throw new Error('Call to function `AudioPlayer.play` has been rejected.');
    });

    await playVerse(view, 1);

    // The failure is reported once, by the one control that owns playback.
    expect(await view.findByTestId('faith-reader-player-retry')).toBeTruthy();
    // The verses are still on screen: the failure cost the recitation, not the surah.
    expect(view.getByTestId('faith-reader-arabic-1-2')).toBeTruthy();
  });

  it('clears the failure when the same verse is retried', async () => {
    const view = await readerWithAudio();
    mockAudio.player.play.mockImplementationOnce(() => {
      throw new Error('Call to function `AudioPlayer.play` has been rejected.');
    });

    await playVerse(view, 1);
    const retry = await view.findByTestId('faith-reader-player-retry');

    // The retry retries: it re-selects the same verse rather than reloading the screen.
    fireEvent.press(retry);

    await waitFor(() => expect(view.queryByTestId('faith-reader-player-retry')).toBeNull());
  });
});
