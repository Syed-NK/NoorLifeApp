import AsyncStorage from '@react-native-async-storage/async-storage';
import { configure, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';

import { warmUpFirstMount } from '@/test-support/mock-latency-timers';
import { seedTranslationPreference } from '@/test-support/faith-preferences-fixtures';

import { mockAudio, setRouteParams } from '../../../../jest.setup';

import type { FaithRepositories } from '../data';
import { createMockFaithRepositories } from '../data/mock';
import type { AyahRecitation } from '../data/quran-content.repository';
import { createExpoAudioStore, createRecitationAudio } from '../data/audio';
import { FaithRepositoryProvider } from '../di/faith-repository-context';
import { RecitationAudioProvider } from '../di/recitation-audio-context';
import { ReaderScreen } from '../screens/reader-screen';

/**
 * The advance state machine: one completion moves exactly one ayah.
 *
 * ── The defect these were written to reproduce ──────────────────────────────
 * The player skipped ayat on a physical device. The cause was two guards keyed on two *different*
 * identities that do not line up:
 *
 *   • `handledFinishFor` recorded which **ayah number** had already been advanced past;
 *   • an effect cleared that record whenever the **player instance** changed.
 *
 * Advancing changes the source, which produces a new player, which cleared the record — on a commit
 * where the status in React state was still the previous source's, still carrying
 * `didJustFinish: true`. All three guards passed a second time and one completion advanced two
 * ayat. The green highlight, the transport label and the audio then disagreed about which verse was
 * being recited, which is what made it visible.
 *
 * ── Why this could not be caught before ─────────────────────────────────────
 * The audio double scoped `didJustFinish` to the instance that reported it, and its own comment
 * asserted that a leak across a source change was "a property of the double, not of the device".
 * That was wrong: `useAudioPlayerStatus` holds React state, so the leaking commit is exactly what
 * the device does. `mockAudio.emitLeakedFinish()` now models it.
 *
 * Nothing here logs a URL, a verse, a token or a credential — the fixtures carry an opaque host and
 * the assertions are about ayah numbers and control labels.
 */

const AYAT = [1, 2, 3, 4, 5] as const;

const RECITATIONS: readonly AyahRecitation[] = AYAT.map((ayah) => ({
  surah: 1 as never,
  ayah: ayah as never,
  reciterId: '3',
  url: `https://verses.example.invalid/001${String(ayah).padStart(3, '0')}.mp3`,
}));

/**
 * Five consecutive verses, with deliberately synthetic text.
 *
 * The shared mock repository ships only 1:1, 1:2 and 1:5 for Al-Fatihah, so a card for verse 3 or 4
 * never renders and the highlight cannot be observed there. These cases are about the *advance state
 * machine*, not about scripture, so the page is supplied here with placeholder Latin text — no
 * Qur'anic Arabic is invented, and the no-fabrication scan has nothing to find.
 */
const SYNTHETIC_PAGE = {
  kind: 'ok' as const,
  data: {
    items: AYAT.map((ayah) => ({
      surah: 1 as never,
      ayah: ayah as never,
      arabic: `SYNTHETIC-VERSE-${ayah}`,
      source: { name: 'Test fixture', verified: false },
    })),
    nextCursor: null,
  },
};

/**
 * Three seconds for `findBy*`/`waitFor`, and a matching per-test budget.
 *
 * Real timers, deliberately: this suite drives the transport through promise chains, and every verse
 * now also passes through the preparation layer — a transfer and a validation before the player is
 * pointed anywhere. Under a fake clock `waitFor` exhausts a simulated budget in microseconds before
 * those settle. What the real clock costs is the Faith fixtures' 280 ms per read, several reads per
 * mount, eleven mounts; at the library's one-second default this began timing out under parallel
 * load, which is a slow harness reported as a broken player.
 */
configure({ asyncUtilTimeout: 3000 });
jest.setTimeout(15000);

warmUpFirstMount(() => withReader());

beforeEach(async () => {
  await AsyncStorage.clear();
  await seedTranslationPreference();
  setRouteParams({ surah: '1' });
  mockAudio.reset();
});

async function withReader(repositories?: Partial<FaithRepositories>): Promise<typeof screen> {
  const mocks = createMockFaithRepositories();
  await render(
    <FaithRepositoryProvider
      repositories={{
        ...mocks,
        quran: {
          ...mocks.quran,
          listAyahs: async () => SYNTHETIC_PAGE,
          listTranslations: async () => ({ kind: 'empty' as const }),
          listRecitations: async () => ({
            kind: 'ok',
            data: { items: RECITATIONS, nextCursor: null },
          }),
          availableReciters: async () => ({
            kind: 'ok',
            data: [{ id: '3', name: 'Abdur-Rahman as-Sudais', style: 'Murattal' }],
          }),
        },
        ...repositories,
      }}
    >
      {/*
        A fresh audio service per render.

        The production one is a module singleton so its in-flight map survives navigation; that is
        exactly what must not survive between tests, since a file prepared by one case would make the
        next case's advance succeed without preparing anything.
      */}
      <RecitationAudioProvider audio={createRecitationAudio({ store: createExpoAudioStore() })}>
        <ReaderScreen />
      </RecitationAudioProvider>
    </FaithRepositoryProvider>,
  );
  return screen;
}

/**
 * The verse the reader is marking, in either of the two ways it marks one.
 *
 * ── The two are a real distinction, and this suite needs both ───────────────
 * `active` is the verse the platform is reporting playback of; `focused` is the verse the transport
 * is *pointed at* while paused, stopped or idle. Most cases here ask "which verse did the transport
 * move to", which is answered by either mark — but the end-of-page cases ask specifically whether
 * anything is still being recited, and for those `activeAyah` below is the one that can tell.
 */
function recitingAyah(view: typeof screen): number | null {
  for (const ayah of [1, 2, 3, 4, 5]) {
    if (
      view.queryByTestId(`faith-reader-ayah-active-1-${ayah}`) !== null ||
      view.queryByTestId(`faith-reader-ayah-focused-1-${ayah}`) !== null
    ) {
      return ayah;
    }
  }
  return null;
}

/** The verse being recited — the darker green, which requires the platform to report playback. */
function activeAyah(view: typeof screen): number | null {
  for (const ayah of [1, 2, 3, 4, 5]) {
    if (view.queryByTestId(`faith-reader-ayah-active-1-${ayah}`) !== null) {
      return ayah;
    }
  }
  return null;
}

/**
 * Starts playback the only way the reader offers: press the verse, then **Play** in its sheet.
 *
 * There is no per-ayah play button and no overflow menu. Routing every case through the two
 * deliberate taps is also what keeps this suite honest about the transport it is testing — a
 * regression that restored a one-tap control on each ayah would not make any of these pass more
 * easily.
 *
 * The platform is then told to report playback, which is what the device does a moment after a
 * source loads. Without it the reader would be right to draw the paused mark rather than the
 * reciting one, and every case here would be asserting against a state no listener ever sees.
 */
async function playFrom(ayah: number): Promise<typeof screen> {
  const view = await withReader();
  fireEvent.press(await view.findByTestId(`faith-reader-ayah-1-${ayah}`));
  fireEvent.press(await view.findByTestId('faith-reader-action-play'));
  await waitFor(() => expect(mockAudio.currentUri()).not.toBeNull());
  mockAudio.setStatus({ playing: true, isLoaded: true });
  await waitFor(() => expect(activeAyah(view)).toBe(ayah));
  return view;
}

describe('one completion advances exactly one ayah', () => {
  it('does not skip when the finished flag leaks across the source change', async () => {
    /**
     * THE REGRESSION. Before the fix this ended on ayah 3 after a single completion.
     *
     * The sequence is the device's: verse 1 finishes, the hook advances to verse 2 and re-points the
     * player, and the very next commit still carries the finished status from verse 1's source.
     */
    const view = await playFrom(1);

    mockAudio.emitLeakedFinish();

    await waitFor(() => expect(recitingAyah(view)).toBe(2));
    // Held: the leaked flag is still set and still visible to the new player, and it must do nothing.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(recitingAyah(view)).toBe(2);
  });

  it('ignores a duplicate completion for the same source', async () => {
    const view = await playFrom(1);

    mockAudio.setStatus({ didJustFinish: true, isLoaded: true });
    await waitFor(() => expect(recitingAyah(view)).toBe(2));

    /**
     * The *same* completion observed again, which is what a re-render produces — not a new one.
     *
     * `replayStatus` re-notifies with the flag exactly as it stands and re-stamps nothing. Calling
     * `setStatus({ didJustFinish: true })` a second time would stamp the flag onto verse 2's source
     * and would be a genuine second completion, which should advance.
     */
    mockAudio.replayStatus();
    mockAudio.replayStatus();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(recitingAyah(view)).toBe(2);
  });

  it('advances one ayah per completion across a run of them', async () => {
    const view = await playFrom(1);

    for (const expected of [2, 3, 4]) {
      mockAudio.stopLeaking();
      mockAudio.setStatus({ didJustFinish: true, isLoaded: true });
      await waitFor(() => expect(recitingAyah(view)).toBe(expected));

      /**
       * The highlight and the transport must never disagree.
       *
       * Both read `transport.current`, so this is structural rather than incidental — but it is the
       * symptom the skip presented as on the device (the green block on one verse while a different
       * one was audible), so it is asserted at every step rather than assumed.
       */
      const label = await view.findByTestId('faith-reader-player-title');
      expect(String(label.props.children)).toContain(`Aya ${expected}`);
    }
  });

  it('stops at the end of the loaded page instead of wrapping to verse one', async () => {
    const view = await playFrom(5);

    mockAudio.setStatus({ didJustFinish: true, isLoaded: true });

    // Stopping unloads the source, which is the transport's own statement that it is finished.
    await waitFor(() => expect(mockAudio.currentUri()).toBeNull());
    // The wrap bug: `ordered[index + 1]` with `index === -1` is `ordered[0]`, which would restart
    // the surah seconds after it ended.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(activeAyah(view)).toBeNull();
    // Still pointed at the verse it ended on, and emphatically not back at verse one.
    expect(recitingAyah(view)).toBe(5);
  });
});

describe('completions that must never advance', () => {
  it('does nothing when a completion arrives before the replacement source has reported in', async () => {
    /**
     * Requirement: a completion belonging to the previous source cannot advance the new one.
     *
     * The sharp version of this is the leak test above, where the flag is live across the swap. This
     * is the other shape it takes on a slow connection: the next verse is selected, the platform is
     * still fetching it, and the previous source's completion is still set. Nothing has been heard
     * from the new source, so nothing may be concluded about it.
     */
    const view = await playFrom(1);

    fireEvent.press(await view.findByTestId('faith-reader-player-next'));
    await waitFor(() => expect(recitingAyah(view)).toBe(2));

    mockAudio.setStatus({ isLoaded: false, isBuffering: true, playing: false });
    mockAudio.emitLeakedFinish();
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Verse 2 was never played to its end. Advancing here would skip it entirely.
    expect(recitingAyah(view)).toBe(2);
  });

  it('does not advance after pause', async () => {
    const view = await playFrom(1);

    fireEvent.press(await view.findByTestId('faith-reader-player-toggle'));
    mockAudio.setStatus({ playing: false });
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(recitingAyah(view)).toBe(1);
  });

  it('does not advance or restart once the page has been played to its end', async () => {
    /**
     * ── Why the end of the page, and not a Stop button ──────────────────────────
     * The player no longer has one: the approved layout is play/pause, the two ayah steps, seek,
     * speed and download, and stopping is now something the transport does to itself when a surah
     * runs out. That is also the only state in which `selection` is null with a completion still
     * in the air — which is precisely the guard this case exists to hold.
     *
     * Without it, `index` computes as `-1`, `ordered[index + 1]` is `ordered[0]`, and the reader
     * restarts the surah from verse one seconds after it finished.
     */
    const view = await playFrom(5);

    mockAudio.setStatus({ didJustFinish: true, isLoaded: true });
    await waitFor(() => expect(mockAudio.currentUri()).toBeNull());

    mockAudio.emitLeakedFinish();
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Neither the next verse nor verse one. Finished means finished: nothing is being recited, no
    // source has been pointed at again, and the transport has not wrapped.
    expect(activeAyah(view)).toBeNull();
    expect(mockAudio.currentUri()).toBeNull();
    expect(recitingAyah(view)).toBe(5);
  });

  it('does not advance while the platform is still buffering', async () => {
    const view = await playFrom(1);

    mockAudio.setStatus({ isLoaded: false, isBuffering: true, playing: false });
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(recitingAyah(view)).toBe(1);
  });
});

describe('manual transport moves exactly one ayah', () => {
  it('advances one and only one on next', async () => {
    const view = await playFrom(2);

    fireEvent.press(await view.findByTestId('faith-reader-player-next'));

    await waitFor(() => expect(recitingAyah(view)).toBe(3));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(recitingAyah(view)).toBe(3);
  });

  it('goes back one and only one on previous', async () => {
    const view = await playFrom(3);

    fireEvent.press(await view.findByTestId('faith-reader-player-previous'));

    await waitFor(() => expect(recitingAyah(view)).toBe(2));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(recitingAyah(view)).toBe(2);
  });

  it('lands on the last pressed verse when next is pressed rapidly', async () => {
    const view = await playFrom(1);

    const next = await view.findByTestId('faith-reader-player-next');
    fireEvent.press(next);
    fireEvent.press(next);
    fireEvent.press(next);

    /**
     * Three presses, three ayat — never more. Each press replaces the source, so any completion
     * still in flight from an earlier one belongs to a token that is no longer current.
     */
    await waitFor(() => expect(recitingAyah(view)).toBe(4));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(recitingAyah(view)).toBe(4);
  });
});
