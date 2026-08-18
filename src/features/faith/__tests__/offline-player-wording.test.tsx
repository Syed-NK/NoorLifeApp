import { render, screen } from '@testing-library/react-native';

import { ModuleProvider } from '@features/modules/module-context';

import {
  QuranAudioPlayer,
  type QuranAudioPlayerProps,
} from '../components/reader/quran-audio-player';

/**
 * What the player *says* when it cannot play, kept in its own file on purpose.
 *
 * ── Why not appended to `quran-audio-player.test.tsx` ──────────────────────
 * That file renders the panel dozens of times, and this project has no React act environment. Once a
 * suite has accumulated enough renders, later ones in the same file yield an empty tree — the
 * "overlapping act()" behaviour its own header warns about. A wording assertion that silently found
 * nothing would pass for the wrong reason, which is precisely the failure this file exists to catch.
 */

const noop = (): void => undefined;

function props(overrides?: Partial<QuranAudioPlayerProps>): QuranAudioPlayerProps {
  return {
    surahName: 'Al-Fatihah',
    ayah: 1,
    totalAyat: 7,
    reciterName: 'Abdur-Rahman as-Sudais',
    state: 'not-downloaded',
    positionSeconds: null,
    durationSeconds: null,
    rate: 1,
    rates: [0.75, 1, 1.25, 1.5],
    rateSupported: true,
    hasPrevious: false,
    hasNext: false,
    downloadedAyat: 0,
    missingAyah: null,
    onTogglePlay: noop,
    onPrevious: noop,
    onNext: noop,
    onSeek: noop,
    onChangeRate: noop,
    onRetry: noop,
    onOpenReciters: noop,
    onManageOfflineAudio: noop,
    ...overrides,
  };
}

async function renderPlayer(overrides?: Partial<QuranAudioPlayerProps>): Promise<typeof screen> {
  await render(
    <ModuleProvider moduleId="faith">
      <QuranAudioPlayer {...props(overrides)} />
    </ModuleProvider>,
  );
  return screen;
}

describe('the disabled play control says why, without blaming the publisher', () => {
  it('names the download, not a missing recording, when nothing is on the device', async () => {
    /*
      ── Found on a release device, over Al-Fatihah ────────────────────────────
      The label read "No recitation available for Al-Fatihah • Aya 1" — over a surah Quran Foundation
      publishes in full. The audio was simply not downloaded. For a screen-reader user that sentence is
      the *only* thing said about a control that will not respond, so getting the cause wrong is not a
      cosmetic slip: it tells them to give up on a verse that is one download away.
    */
    const view = await renderPlayer();
    const label = String(view.getByTestId('faith-reader-player-toggle').props.accessibilityLabel);

    expect(label).toMatch(/is not downloaded/i);
    expect(label).not.toMatch(/no recitation available/i);
    expect(label).not.toMatch(/unavailable/i);
  });
});

describe('while the manifest is still being read', () => {
  it('says it is checking rather than asserting an absence it has not established', async () => {
    const view = await renderPlayer({ state: 'loading' });
    expect(String(view.getByTestId('faith-reader-player-toggle').props.accessibilityLabel)).toMatch(
      /checking downloaded audio/i,
    );
  });
});
