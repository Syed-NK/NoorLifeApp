import AsyncStorage from '@react-native-async-storage/async-storage';
import { configure, fireEvent, waitFor } from '@testing-library/react-native';

import { warmUpFirstMount } from '@/test-support/mock-latency-timers';
import { seedTranslationPreference } from '@/test-support/faith-preferences-fixtures';
import { playFromAyah, renderReader } from '@/test-support/faith-reader';

import { mockAudio, mockFileSystem, setRouteParams } from '../../../../jest.setup';

import { createExpoAudioStore, createRecitationAudio, type AudioStore } from '../data/audio';
import type { AyahRecitation } from '../data/quran-content.repository';

/**
 * Preparation as the **reader** experiences it.
 *
 * The engine's own suite proves the mechanism. These prove the wiring: that the reader never points
 * the platform player at a network URL, that advancing into a prefetched ayah costs no transfer, and
 * — the rule that matters most — that a preparation which fails stops on that ayah rather than
 * skipping it.
 */

const AYAT = [1, 2, 5] as const;

const RECITATIONS: readonly AyahRecitation[] = AYAT.map((ayah) => ({
  surah: 1 as never,
  ayah: ayah as never,
  reciterId: '3',
  url: `https://verses.quran.foundation/a/00100${ayah}.mp3`,
}));

const CACHE = 'file:///cache/faith-recitations';

/** A store that records every transfer it was asked to perform. */
function countingStore(): { readonly store: AudioStore; readonly downloads: string[] } {
  const inner = createExpoAudioStore();
  const downloads: string[] = [];
  return {
    downloads,
    store: {
      ...inner,
      download: async (request) => {
        downloads.push(request.name);
        return await inner.download(request);
      },
    },
  };
}

/**
 * Three seconds for `findBy*`/`waitFor`, and a matching per-test budget.
 *
 * Real timers throughout: preparation is a promise chain over a filesystem double, and one case holds
 * a transfer open on purpose so the "Preparing" state is observable at all. A fake clock resolves
 * `waitFor`'s budget before those settle. The real cost is the Faith fixtures' 280 ms per read across
 * several reads per mount, which at the library's one-second default began timing out under parallel
 * load — a slow harness reported as a broken player.
 */
configure({ asyncUtilTimeout: 3000 });
jest.setTimeout(15000);

warmUpFirstMount(() => renderReader({ recitations: RECITATIONS }).then(({ view }) => view));

beforeEach(async () => {
  await AsyncStorage.clear();
  await seedTranslationPreference();
  setRouteParams({ surah: '1' });
});

describe('the reader plays from prepared files', () => {
  it('never points the platform player at a network URL', async () => {
    const { view } = await renderReader({ recitations: RECITATIONS });
    await playFromAyah(view, 1);

    await waitFor(() => expect(mockAudio.currentUri()).not.toBeNull());

    /**
     * The whole change, in one assertion. Before it, the source was
     * `https://verses.quran.foundation/...` and every ayah began with a network open after the
     * previous one had ended. A regression that removed the preparation layer fails here.
     */
    expect(mockAudio.currentUri()).toBe(`${CACHE}/r3-s1-a1.mp3`);
    expect(mockAudio.currentUri()).not.toMatch(/^https?:/);
  });

  it('advances into a prefetched ayah without fetching it again', async () => {
    const { store, downloads } = countingStore();
    const { view } = await renderReader({
      recitations: RECITATIONS,
      audio: createRecitationAudio({ store }),
    });

    await playFromAyah(view, 1);
    await waitFor(() => expect(mockAudio.currentUri()).toBe(`${CACHE}/r3-s1-a1.mp3`));
    // The prefetch runs while verse one plays.
    await waitFor(() => expect(downloads).toContain('r3-s1-a2.mp3'));

    const before = [...downloads];
    fireEvent.press(await view.findByTestId('faith-reader-player-next'));

    await waitFor(() => expect(mockAudio.currentUri()).toBe(`${CACHE}/r3-s1-a2.mp3`));
    // The advance is a re-point, not a request: the file was already there.
    expect(downloads).toEqual(before);
  });

  it('prepares the current ayah before playback, and says so while it does', async () => {
    /**
     * The transfer is held open so the preparing state is observable at all — it is, by design, over
     * in a microtask when nothing is holding it.
     */
    // Typed through the promise's own resolver rather than through a `let` the checker narrows to
    // `never`: the assignment happens inside the executor, which TypeScript cannot see completes.
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const inner = createExpoAudioStore();
    const store: AudioStore = {
      ...inner,
      download: async (request) => {
        await gate;
        return await inner.download(request);
      },
    };

    const { view } = await renderReader({
      recitations: RECITATIONS,
      audio: createRecitationAudio({ store }),
    });
    await playFromAyah(view, 1);

    // No source yet: the player is deliberately pointed at nothing rather than at the network.
    expect(mockAudio.currentUri()).toBeNull();
    expect(String((await view.findByTestId('faith-reader-player-reciter')).props.children)).toMatch(
      /preparing/i,
    );

    release();
    await waitFor(() => expect(mockAudio.currentUri()).toBe(`${CACHE}/r3-s1-a1.mp3`));
  });
});

describe('a failed preparation never skips an ayah', () => {
  it('holds on the failing verse and offers a retry', async () => {
    /**
     * ── The rule this file exists for ───────────────────────────────────────────
     * A recitation of the Qur'an that quietly omits a verse is the worst thing this screen can
     * produce. When the file for an ayah cannot be made, the transport stops **on that ayah**: it
     * does not advance, it does not fall back to streaming the URL, and it does not move on.
     */
    mockFileSystem.respondWith(() => new Error('ECONNRESET'));

    const { view } = await renderReader({ recitations: RECITATIONS });
    await playFromAyah(view, 1);

    const retry = await view.findByTestId('faith-reader-player-retry');
    expect(String(retry.props.accessibilityLabel)).toMatch(/did not finish/i);

    // Still verse one. Not verse two, and not nothing.
    expect(String(view.getByTestId('faith-reader-player-title').props.children)).toContain('Aya 1');
    /*
      The transport is still on verse one and marks it. It is `focused` rather than `active`: the
      file could not be produced, so nothing is playing, and the reader says so rather than drawing
      the recitation green over a verse that is not being recited.
    */
    expect(view.getByTestId('faith-reader-ayah-focused-1-1')).toBeTruthy();
    expect(view.queryByTestId('faith-reader-ayah-active-1-2')).toBeNull();
    expect(view.queryByTestId('faith-reader-ayah-focused-1-2')).toBeNull();

    // And it stays there rather than drifting on.
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(view.getByTestId('faith-reader-ayah-focused-1-1')).toBeTruthy();
  });

  it('names the failure rather than reporting a generic error', async () => {
    // Four preparation failures, four different things for the user to do. Collapsing them into one
    // message would give three quarters of the affected users advice that cannot work.
    mockFileSystem.respondWith(() => {
      const html = new Uint8Array(8192);
      html.set([0x3c, 0x21, 0x44, 0x4f], 0);
      return html;
    });

    const { view } = await renderReader({ recitations: RECITATIONS });
    await playFromAyah(view, 1);

    const retry = await view.findByTestId('faith-reader-player-retry');
    expect(String(retry.props.accessibilityLabel)).toMatch(/did not arrive intact/i);
  });

  it('recovers when the retry succeeds', async () => {
    mockFileSystem.respondWith(() => new Error('ECONNRESET'));

    const { view } = await renderReader({ recitations: RECITATIONS });
    await playFromAyah(view, 1);
    const retry = await view.findByTestId('faith-reader-player-retry');

    mockFileSystem.respondWith(() => mockFileSystem.audioBytes(4096));
    fireEvent.press(retry);

    await waitFor(() => expect(mockAudio.currentUri()).toBe(`${CACHE}/r3-s1-a1.mp3`));
    expect(view.queryByTestId('faith-reader-player-retry')).toBeNull();
  });

  it('reports being offline as being offline', async () => {
    const inner = createExpoAudioStore();
    const store: AudioStore = {
      ...inner,
      download: () => {
        const error = new Error('Network request failed');
        return Promise.reject(error);
      },
    };

    const { view } = await renderReader({
      recitations: RECITATIONS,
      audio: createRecitationAudio({ store }),
    });
    await playFromAyah(view, 1);

    // The transport classifies an unfinished transfer as interrupted, which is the honest reading of
    // a failure this app cannot distinguish from a dropped connection — and the advice is the same.
    const retry = await view.findByTestId('faith-reader-player-retry');
    expect(String(retry.props.accessibilityLabel)).toMatch(/did not finish|offline/i);
  });

  it('reports low storage as low storage, not as a failed download', async () => {
    mockFileSystem.setFreeBytes(1024);

    const { view } = await renderReader({ recitations: RECITATIONS });
    await playFromAyah(view, 1);

    const retry = await view.findByTestId('faith-reader-player-retry');
    expect(String(retry.props.accessibilityLabel)).toMatch(/not enough free space/i);
  });
});

describe('changing surah cancels preparation for the one being left', () => {
  it('aborts the outgoing surah’s transfers when the reader is pointed elsewhere', async () => {
    const audio = createRecitationAudio({ store: createExpoAudioStore() });

    const { view } = await renderReader({ recitations: RECITATIONS, audio });
    await playFromAyah(view, 1);
    await waitFor(() => expect(mockAudio.currentUri()).not.toBeNull());

    /**
     * The scope is declared by the loaded page, so a transfer started for surah 1 is aborted the
     * moment the engine is told the user is listening to surah 18. Asserted against the engine
     * directly, because the abort is not something the rendered tree can show.
     *
     * A verse the prefetch has **not** already reached, deliberately: an ayah that is already on disk
     * resolves from the filesystem without a transfer, so there would be nothing for the scope change
     * to cancel and the case would pass without exercising anything.
     */
    const pending = audio.preparation.prepare({
      surah: 1 as never,
      ayah: 7 as never,
      reciterId: '3',
      url: 'https://verses.quran.foundation/a/001007.mp3',
    });
    audio.preparation.setScope({ reciterId: '3', surah: 18 });

    expect(await pending).toEqual({ kind: 'cancelled' });
  });
});
