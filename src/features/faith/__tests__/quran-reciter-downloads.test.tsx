import AsyncStorage from '@react-native-async-storage/async-storage';
import { configure, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';

import { warmUpFirstMount } from '@/test-support/mock-latency-timers';

import { mockFileSystem } from '../../../../jest.setup';

import {
  createExpoAudioStore,
  createRecitationAudio,
  type RecitationAudio,
  type SurahDownloadState,
} from '../data/audio';
import { createMockFaithRepositories } from '../data/mock';
import type { AyahRecitation, ReciterEdition } from '../data/quran-content.repository';
import { FaithRepositoryProvider } from '../di/faith-repository-context';
import { RecitationAudioProvider } from '../di/recitation-audio-context';
import { describeDownload, ReciterScreen } from '../screens/reciter-screen';
import {
  DEFAULT_RECITER_ID,
  DEFAULT_RECITER_NAME,
  defaultFaithPreferences,
  readFaithPreferences,
  writeFaithPreferences,
} from '../storage/faith-preferences';

/**
 * The reciter catalogue and its offline state.
 *
 * ── Two things are being defended, and they pull in opposite directions ─────
 * A user's own choice of reciter must survive everything — a migration, a superseded default, a
 * restart. And NoorLife's *own* default must stay the verified one, so an install that has never
 * chosen gets Sudais rather than whichever id a specification happened to name by example.
 *
 * The only thing that can distinguish them is the moment of choosing, so it is recorded there, and
 * these cases assert both halves rather than one.
 *
 * ── And the download controls, which are all explicit ───────────────────────
 * Nothing here downloads on its own. Every transfer in this file is the result of a control being
 * pressed, which is the shipped behaviour: a recitation is tens of megabytes per surah and a
 * complete one is several gigabytes the developer terms do not permit keeping.
 */

const RECITERS: readonly ReciterEdition[] = [
  { id: '3', name: DEFAULT_RECITER_NAME, style: 'Murattal' },
  { id: '7', name: 'Mishary Rashid Alafasy', style: 'Murattal' },
  { id: '1', name: 'AbdulBaset AbdulSamad', style: 'Mujawwad' },
];

const RECITATIONS: readonly AyahRecitation[] = [1, 2, 3].map((ayah) => ({
  surah: 18 as never,
  ayah: ayah as never,
  reciterId: '3',
  url: `https://verses.quran.foundation/a/018${String(ayah).padStart(3, '0')}.mp3`,
}));

/** A recorded reading position, which is what gives the download controls a surah to act on. */
async function seedPosition(): Promise<void> {
  await AsyncStorage.setItem(
    'noorlife.faith.quran.position',
    JSON.stringify({
      surah: 18,
      surahName: 'Al-Kahf',
      ayah: 1,
      ayahCount: 3,
      progress: 0.01,
      updatedAt: new Date().toISOString(),
    }),
  );
}

async function renderReciters(audio: RecitationAudio): Promise<typeof screen> {
  const mocks = createMockFaithRepositories();
  await render(
    <FaithRepositoryProvider
      repositories={{
        ...mocks,
        quran: {
          ...mocks.quran,
          availableReciters: async () => ({ kind: 'ok', data: RECITERS }),
          listRecitations: async () => ({
            kind: 'ok',
            data: { items: RECITATIONS, nextCursor: null },
          }),
        },
      }}
    >
      <RecitationAudioProvider audio={audio}>
        <ReciterScreen />
      </RecitationAudioProvider>
    </FaithRepositoryProvider>,
  );
  return screen;
}

/** Real timers and a raised budget, for the reason `quran-reader-preparation` records. */
configure({ asyncUtilTimeout: 3000 });
jest.setTimeout(15000);

warmUpFirstMount(() => renderReciters(createRecitationAudio({ store: createExpoAudioStore() })));

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe('the application default', () => {
  it('is the verified Sudais recitation', () => {
    /**
     * `3` is the resource id `list_recitation_resources` returns for Abdur-Rahman as-Sudais on
     * NoorLife's credentials. It is a constant because it was *checked* against the live catalogue,
     * which is exactly the check the previous translation default failed.
     */
    expect(DEFAULT_RECITER_ID).toBe('3');
    expect(defaultFaithPreferences.reciterId).toBe('3');
    expect(defaultFaithPreferences.reciterChosenByUser).toBe(false);
  });

  it('survives a fresh install with nothing stored', async () => {
    expect((await readFaithPreferences()).reciterId).toBe(DEFAULT_RECITER_ID);
  });

  it('replaces a superseded default that NoorLife itself chose', async () => {
    // `1` is a perfectly real recitation. It is simply not the one NoorLife settled on after checking
    // the catalogue, and an install predating that decision has no way of knowing.
    await writeFaithPreferences({ reciterId: '1', reciterChosenByUser: false });

    expect((await readFaithPreferences()).reciterId).toBe(DEFAULT_RECITER_ID);
  });
});

describe('a deliberate choice is never overridden', () => {
  it('keeps a user-selected reciter across a read', async () => {
    await writeFaithPreferences({ reciterId: '7', reciterChosenByUser: true });

    const preferences = await readFaithPreferences();
    expect(preferences.reciterId).toBe('7');
    expect(preferences.reciterChosenByUser).toBe(true);
  });

  it('keeps a user-selected reciter even when it is the superseded default', async () => {
    /**
     * The case the flag exists for. Nothing about a stored `1` distinguishes "the app chose this"
     * from "this user prefers AbdulBaset", and both are entirely reasonable readings — so the
     * correction is applied only to the one NoorLife is responsible for.
     */
    await writeFaithPreferences({ reciterId: '1', reciterChosenByUser: true });

    expect((await readFaithPreferences()).reciterId).toBe('1');
  });

  it('records the choice as the user’s when it is made on the screen', async () => {
    await seedPosition();
    const audio = createRecitationAudio({ store: createExpoAudioStore() });
    const view = await renderReciters(audio);

    fireEvent.press(await view.findByTestId('faith-reciters-row-7'));

    await waitFor(async () => {
      const preferences = await readFaithPreferences();
      expect(preferences.reciterId).toBe('7');
      expect(preferences.reciterChosenByUser).toBe(true);
    });
  });
});

describe('every availability state has its own sentence', () => {
  it('names the six states distinctly', () => {
    const states: readonly SurahDownloadState[] = [
      { kind: 'stream-only' },
      { kind: 'downloading', completed: 2, total: 3 },
      { kind: 'downloaded', bytes: 4 * 1024 * 1024, expiresAt: Date.now() },
      { kind: 'expired', bytes: 4 * 1024 * 1024 },
      { kind: 'incomplete', completed: 1, total: 3 },
      { kind: 'failed', failure: 'interrupted' },
    ];

    const described = states.map((state) => describeDownload(state, 'Al-Kahf'));

    // Six states, six sentences. A control that said "Download" in all of them would be wrong in five.
    expect(new Set(described).size).toBe(states.length);
    expect(described[0]).toMatch(/not downloaded/i);
    expect(described[1]).toMatch(/2 of 3/);
    expect(described[2]).toMatch(/downloaded/i);
    expect(described[3]).toMatch(/expired/i);
    expect(described[4]).toMatch(/partly/i);
    expect(described[5]).toMatch(/failed/i);
  });

  it('states expiry as a date, because a download is planned around', () => {
    const expiresAt = new Date('2026-08-18T00:00:00Z').getTime();
    const described = describeDownload(
      { kind: 'downloaded', bytes: 1024 * 1024, expiresAt },
      'Al-Kahf',
    );

    // "in 6 days" makes the user do arithmetic this sentence exists to save them.
    expect(described).toMatch(/until/i);
    expect(described).toMatch(/\d/);
  });
});

describe('downloads are explicit, and their progress is reported', () => {
  it('downloads nothing until a control is pressed', async () => {
    await seedPosition();
    const audio = createRecitationAudio({ store: createExpoAudioStore() });
    const view = await renderReciters(audio);
    await view.findByTestId('faith-reciters-row-3');

    // Rendering a catalogue of voices must not fetch any of them.
    expect(mockFileSystem.uris()).toEqual([]);
    expect(audio.stateFor('3', 18).kind).toBe('stream-only');
  });

  it('offers a download control per reciter and downloads the surah when pressed', async () => {
    await seedPosition();
    const audio = createRecitationAudio({ store: createExpoAudioStore() });
    const view = await renderReciters(audio);

    fireEvent.press(await view.findByTestId('faith-reciters-action-3'));

    await waitFor(() => expect(audio.stateFor('3', 18).kind).toBe('downloaded'));
    expect(mockFileSystem.uris().filter((uri) => uri.includes('-s18-'))).toHaveLength(3);
  });

  it('reports storage used once something has been downloaded', async () => {
    await seedPosition();
    const audio = createRecitationAudio({ store: createExpoAudioStore() });
    const view = await renderReciters(audio);

    // Nothing downloaded: no storage line, because there is nothing to describe.
    expect(view.queryByTestId('faith-reciters-storage')).toBeNull();

    fireEvent.press(await view.findByTestId('faith-reciters-action-3'));

    const storage = await view.findByTestId('faith-reciters-storage');
    expect(String(storage.props.accessibilityLabel)).toMatch(/1 surah downloaded/i);
    expect(String(storage.props.accessibilityLabel)).toMatch(/using/i);
  });

  it('offers a retry after a failed download rather than a fresh download', async () => {
    await seedPosition();
    let seen = 0;
    mockFileSystem.respondWith(() => {
      seen += 1;
      return seen > 1 ? new Error('ECONNRESET') : mockFileSystem.audioBytes(4096);
    });

    const audio = createRecitationAudio({ store: createExpoAudioStore() });
    const view = await renderReciters(audio);

    fireEvent.press(await view.findByTestId('faith-reciters-action-3'));

    await waitFor(() => expect(audio.stateFor('3', 18).kind).toBe('incomplete'));

    const action = await view.findByTestId('faith-reciters-action-3');
    expect(String(action.props.accessibilityLabel)).toMatch(/finish downloading/i);
  });

  it('offers removal of a completed download, and removal deletes the bytes', async () => {
    await seedPosition();
    const audio = createRecitationAudio({ store: createExpoAudioStore() });
    const view = await renderReciters(audio);

    fireEvent.press(await view.findByTestId('faith-reciters-action-3'));
    await waitFor(() => expect(audio.stateFor('3', 18).kind).toBe('downloaded'));

    const remove = await view.findByTestId('faith-reciters-action-3');
    await waitFor(() =>
      expect(String(view.getByTestId('faith-reciters-action-3').props.accessibilityLabel)).toMatch(
        /remove downloaded/i,
      ),
    );

    fireEvent.press(remove);

    await waitFor(() =>
      expect(mockFileSystem.uris().filter((uri) => uri.includes('-s18-'))).toEqual([]),
    );
  });

  it('does not offer a "download the whole reciter" control anywhere', async () => {
    /**
     * A complete recitation of the Qur'an is several gigabytes, and the Quran Foundation developer
     * terms do not permit a permanent local copy of one. Offering a control that would fetch it would
     * be offering to do something the licence forbids, so the download scope is always one surah.
     */
    await seedPosition();
    const view = await renderReciters(createRecitationAudio({ store: createExpoAudioStore() }));
    await view.findByTestId('faith-reciters-row-3');

    expect(view.queryByText(/download all/i)).toBeNull();
    expect(view.queryByText(/whole qur/i)).toBeNull();
    expect(view.queryByText(/entire/i)).toBeNull();
  });

  it('offers no download control at all when no surah has been opened', async () => {
    // With no recorded position there is nothing honest to offer: defaulting to Al-Fatihah would
    // download a surah nobody asked for.
    const view = await renderReciters(createRecitationAudio({ store: createExpoAudioStore() }));
    await view.findByTestId('faith-reciters-row-3');

    expect(view.queryByTestId('faith-reciters-action-3')).toBeNull();
  });
});
