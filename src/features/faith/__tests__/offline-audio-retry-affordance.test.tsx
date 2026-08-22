import { fireEvent } from '@testing-library/react-native';
import React from 'react';

import { mockFileSystem } from '../../../../jest.setup';
import {
  createTestOfflineService,
  generationFor,
  renderInFaith,
} from '@/test-support/faith-reader';

import { ACTIVE_DOWNLOAD_STATES } from '../storage/faith-offline-recitation';
import { OfflineAudioScreen } from '../screens/offline-audio-screen';
import type { OfflineDownloadService } from '../data/audio/offline-download.service';

/**
 * The Retry control's own state and shape: when it refuses a press, and what a screen reader hears.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * Split out of `offline-audio-retry.test.tsx` for the reason that file documents — each case mounts the
 * whole Offline audio screen after a real download run, and past about six of those in one file the
 * later renders stop resolving with no act environment. Which rows *offer* Retry lives there; whether
 * the control is usable lives here.
 *
 * ── Why disabled rather than absent ────────────────────────────────────────
 * `execute` returns immediately when a run is already in flight — "a second press is not a second
 * download" — so while the download is estimating, transferring, verifying or removing, no retry can
 * take effect on any row. Hiding the control would make the row change shape under the user's finger;
 * disabling it, with a hint that says why, tells them the truth and keeps the layout still.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const TOTAL = 7;

function failingOn(...verseKeys: readonly string[]) {
  mockFileSystem.respondWith((url) =>
    verseKeys.some((key) => url.includes(key))
      ? new TextEncoder().encode('nope')
      : mockFileSystem.audioBytes(4096),
  );
}

async function partialFatihah() {
  failingOn('1:4');
  const service = createTestOfflineService({ generation: generationFor(1, TOTAL) });
  await service.hydrate();
  await service.start({ kind: 'complete' });
  return service;
}

async function renderOffline(service?: OfflineDownloadService) {
  return await renderInFaith(<OfflineAudioScreen />, undefined, service);
}

const retryId = (surah: number) => `faith-offline-audio-retry-surah-${surah}`;

beforeEach(() => {
  mockFileSystem.reset();
});

describe('Retry refuses a press it could not honour', () => {
  /*
    Driven from `ACTIVE_DOWNLOAD_STATES` itself rather than a hand-written list, so a state added to
    that constant without a matching decision here fails instead of quietly becoming pressable. The
    snapshot is what the screen reads, so the state is stubbed on that one method rather than raced.
  */
  it.each(ACTIVE_DOWNLOAD_STATES)('is disabled while %s', async (state) => {
    const service = await partialFatihah();
    const real = service.snapshot();
    jest.spyOn(service, 'snapshot').mockReturnValue({ ...real, state });

    const retrySurah = jest.spyOn(service, 'retrySurah');
    const view = await renderOffline(service);
    const retry = view.getByTestId(retryId(1));

    /*
      `accessibilityState`, not a `disabled` prop: `PressableScale` puts the accessibility props on an
      inner `Pressable`, and RN's `Pressable` does not forward `disabled` to the host view — it folds it
      into `accessibilityState` and `focusable`. Asserting `props.disabled` would read `undefined` and
      pass for a control that was never disabled at all.
    */
    expect(retry.props.accessibilityState.disabled).toBe(true);
    expect(String(retry.props.accessibilityHint)).toMatch(
      /unavailable while a download is running/i,
    );

    /* And the press genuinely does not reach the service — the part a user would notice. */
    fireEvent.press(retry);
    expect(retrySurah).not.toHaveBeenCalled();
  });

  it('is enabled once the run has stopped, and says what it will do', async () => {
    const service = await partialFatihah();
    const retrySurah = jest.spyOn(service, 'retrySurah');
    const view = await renderOffline(service);
    const retry = view.getByTestId(retryId(1));

    expect(retry.props.accessibilityState.disabled).toBe(false);
    fireEvent.press(retry);
    expect(retrySurah).toHaveBeenCalledWith(1);
    /*
      The hint describes a run over the recorded scope: the download resumes and fetches what is still
      missing. It must not promise to fetch this surah alone — the executor derives "finished" from the
      scope it is handed, so a one-surah run would report the whole download complete.
    */
    expect(String(retry.props.accessibilityHint)).toMatch(/resumes the download/i);
    expect(String(retry.props.accessibilityHint)).not.toMatch(/only this surah|this surah alone/i);
  });
});

describe('what a screen reader is told', () => {
  it('names the surah, its progress, and the control’s role, and caps its growth', async () => {
    const service = await partialFatihah();
    const view = await renderOffline(service);

    const entry = service.snapshot().downloadedSurahs.find((row) => row.surah === 1);
    const retry = view.getByTestId(retryId(1));

    /* Derived from the row it describes, so the label cannot drift from the progress it reports. */
    expect(String(retry.props.accessibilityLabel)).toBe(
      `Retry surah 1, ${entry?.playable} of ${entry?.total} verses downloaded`,
    );
    expect(retry.props.accessibilityRole).toBe('button');

    /* Bounded, because the row holds two labels side by side and must not become a column. */
    expect(view.getByText('Retry').props.maxFontSizeMultiplier).toBe(1.4);
    expect(view.getByText('Remove').props.maxFontSizeMultiplier).toBe(1.4);
  });
});
