import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import React, { type ReactElement } from 'react';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';

import type { FaithRepositories } from '@features/faith/data';
import {
  createExpoAudioStore,
  createRecitationAudio,
  type RecitationAudio,
} from '@features/faith/data/audio';
import { createMockFaithRepositories } from '@features/faith/data/mock';
import type { AyahRecitation } from '@features/faith/data/quran-content.repository';
import { FaithRepositoryProvider } from '@features/faith/di/faith-repository-context';
import { RecitationAudioProvider } from '@features/faith/di/recitation-audio-context';
import { ReaderScreen } from '@features/faith/screens/reader-screen';

import { setRouteParams } from '../../jest.setup';

/**
 * Shared scaffolding for the Qur'an reader's suites.
 *
 * ── Why the *real* audio service is used and not a stub ─────────────────────
 * The behaviour these suites exist to pin is the preparation pipeline: an ayah is downloaded and
 * validated before it plays, the next few are prefetched while it does, an advance into a prefetched
 * ayah costs no transfer, and a failed preparation stops rather than skipping. A stubbed service
 * would let all four of those pass while none of them worked.
 *
 * So the tests drive `createRecitationAudio` over `createExpoAudioStore`, on top of the in-memory
 * filesystem double in `jest.setup.ts`. Every layer between the press and the bytes is the shipped
 * one; only the disk is fake.
 *
 * ── A fresh service per render, deliberately ────────────────────────────────
 * The production service is a module-level singleton because its in-flight map has to survive
 * navigation. That is exactly what must **not** survive between tests: a prepared ayah left behind by
 * one case would make the next case's "does it download before playing" assertion pass for the wrong
 * reason. Each render gets its own.
 */

/** Al-Fatihah's first two verses, with audio. The rest of the fixture surah has none. */
export const READER_RECITATIONS: readonly AyahRecitation[] = [
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
];

export type ReaderHarness = {
  readonly view: typeof screen;
  /** The service the tree is using, for asserting download state and usage directly. */
  readonly audio: RecitationAudio;
};

export async function renderReader(options?: {
  readonly repositories?: Partial<FaithRepositories>;
  readonly recitations?: readonly AyahRecitation[];
  readonly surah?: string;
  readonly audio?: RecitationAudio;
  /**
   * Safe-area insets for this render, for the suites that assert the layout arithmetic.
   *
   * The library's Jest double answers zero on every edge, which is the one value that makes an
   * inset added twice indistinguishable from an inset added once. Supplying a real bottom inset is
   * how the docked player's clearance can be checked at all.
   */
  readonly insets?: { readonly top: number; readonly bottom: number };
}): Promise<ReaderHarness> {
  setRouteParams({ surah: options?.surah ?? '1' });
  const mocks = createMockFaithRepositories();
  const recitations = options?.recitations;
  const audio = options?.audio ?? createRecitationAudio({ store: createExpoAudioStore() });

  const quran = {
    ...mocks.quran,
    ...(recitations === undefined
      ? {}
      : {
          listRecitations: async () => ({
            kind: 'ok' as const,
            data: { items: recitations, nextCursor: null },
          }),
          availableReciters: async () => ({
            kind: 'ok' as const,
            data: [{ id: '3', name: 'Abdur-Rahman as-Sudais', style: 'Murattal' }],
          }),
        }),
    ...options?.repositories?.quran,
  };

  const tree = (
    <FaithRepositoryProvider repositories={{ ...mocks, ...options?.repositories, quran }}>
      <RecitationAudioProvider audio={audio}>
        <ReaderScreen />
      </RecitationAudioProvider>
    </FaithRepositoryProvider>
  );

  await render(
    options?.insets === undefined ? (
      tree
    ) : (
      <SafeAreaInsetsContext.Provider
        value={{ ...options.insets, left: 0, right: 0 }}
        // The library's own hook reads this context first and falls back to its zero double, so
        // providing it is the supported way to render a screen on a device with a gesture bar.
      >
        {tree}
      </SafeAreaInsetsContext.Provider>
    ),
  );

  return { view: screen, audio };
}

/** Renders `element` inside both Faith providers, for suites that are not the reader itself. */
export async function renderInFaith(
  element: ReactElement,
  repositories?: Partial<FaithRepositories>,
  audio?: RecitationAudio,
): Promise<typeof screen> {
  const mocks = createMockFaithRepositories();
  await render(
    <FaithRepositoryProvider repositories={{ ...mocks, ...repositories }}>
      <RecitationAudioProvider
        audio={audio ?? createRecitationAudio({ store: createExpoAudioStore() })}
      >
        {element}
      </RecitationAudioProvider>
    </FaithRepositoryProvider>,
  );
  return screen;
}

/**
 * Starts playback the only way the reader offers: press the verse, then **Play** in its sheet.
 *
 * There is no per-ayah play button and no overflow menu any more, and this helper is the executable
 * statement of that: every suite that wants audio playing has to go through the same two deliberate
 * taps a user makes, and a regression that reintroduced a one-tap control would not make any of
 * them pass more easily.
 */
export async function playFromAyah(view: typeof screen, ayah: number): Promise<void> {
  fireEvent.press(await view.findByTestId(`faith-reader-ayah-1-${ayah}`));
  fireEvent.press(await view.findByTestId('faith-reader-action-play'));
}

/** Waits until the transport has a source loaded — that is, preparation produced a local file. */
export async function waitForPrepared(view: typeof screen): Promise<void> {
  await waitFor(() => expect(view.getByTestId('faith-reader-player-title')).toBeTruthy());
}
