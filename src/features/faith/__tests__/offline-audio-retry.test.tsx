import { fireEvent } from '@testing-library/react-native';
import React from 'react';

import { mockFileSystem } from '../../../../jest.setup';
import { touchTarget } from '@ds/tokens';
import {
  createTestOfflineService,
  generationFor,
  renderInFaith,
} from '@/test-support/faith-reader';

import { OfflineAudioScreen } from '../screens/offline-audio-screen';
import type { OfflineDownloadService } from '../data/audio/offline-download.service';

/**
 * Retrying a partial Surah download — the control that was missing, and the one that never worked.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── The defect ─────────────────────────────────────────────────────────────
 * An incomplete surah's row passed `onPress` alongside `trailingInteractive`. `FaithRow` ignores
 * `onPress` in that combination — deliberately, because a row press that also drove the control beside
 * it would put two handlers on one gesture — so the handler had never run. The row reported
 * `clickable=false` to the platform, while a Jest case calling the prop directly would have passed.
 * A user with a partial download had no way to finish it.
 *
 * ── What replaced it ───────────────────────────────────────────────────────
 * A second control in the same trailing area, beside Remove: two independently focusable nodes with
 * their own labels, hints and targets, sharing no gesture. It calls `retrySurah`, which re-queues that
 * surah's failed verses and then resumes the **recorded** scope through the one executor.
 *
 * ── Why this file renders so little ────────────────────────────────────────
 * Each case here drives a real download over the in-memory filesystem and then mounts the whole
 * Offline audio screen. This project has no act environment, and past about six of those in one file
 * the later renders stop resolving — which looks exactly like a missing control and is not. So the
 * cases are split by what they need a render *for*:
 *
 *   • this file — which rows offer Retry, and that pressing it reaches the service
 *   • `offline-audio-retry-affordance.test.tsx` — the disabled state and the accessible shape
 *   • `offline-audio-retry-service.test.ts` — everything about the download itself, rendering nothing
 * ═══════════════════════════════════════════════════════════════════════════
 */

const TOTAL = 7;

/** Bytes for every verse except the ones named, which come back as something that is not audio. */
function failingOn(...verseKeys: readonly string[]) {
  mockFileSystem.respondWith((url) =>
    verseKeys.some((key) => url.includes(key))
      ? new TextEncoder().encode('nope')
      : mockFileSystem.audioBytes(4096),
  );
}

/**
 * A service holding surah 1 partially, with the fourth verse refused.
 *
 * How many verses land is deliberately *not* asserted as a constant. The run stops at the first bad
 * verse rather than skipping past it — `offline-download-service.test.ts` pins that — and how many of
 * the three concurrent transfers had already finished when it stops is a property of the concurrency,
 * not of this fix. So the fixture reports what it produced and the cases relate to it.
 */
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
const removeId = (surah: number) => `faith-offline-audio-remove-surah-${surah}`;

beforeEach(() => {
  mockFileSystem.reset();
});

describe('Retry appears exactly where there is something to retry', () => {
  it('offers it on a partial surah, beside an untouched Remove', async () => {
    const service = await partialFatihah();
    const { playableAyat, state } = service.snapshot();
    /* Partial means some landed and some did not — the state the retry exists for. */
    expect(playableAyat).toBeGreaterThan(0);
    expect(playableAyat).toBeLessThan(TOTAL);
    /*
      And a run that hit a bad verse ends in `failed`, not merely stopped. Both are retryable, and
      `failed` is the one `retrySurah` has to re-queue for the retry to reach anything at all.
    */
    expect(state).toBe('failed');

    const view = await renderOffline(service);
    const retry = view.getByTestId(retryId(1));
    const remove = view.getByTestId(removeId(1));

    /* Two controls, two labels, no shared gesture. */
    expect(retry).not.toBe(remove);
    expect(String(retry.props.accessibilityLabel)).toMatch(/^Retry surah 1/);
    expect(String(remove.props.accessibilityLabel)).toMatch(/^Remove downloaded surah 1/);
  });

  it('does not offer it on a complete surah', async () => {
    mockFileSystem.respondWith(() => mockFileSystem.audioBytes(4096));
    const service = createTestOfflineService({ generation: generationFor(1, TOTAL) });
    await service.hydrate();
    await service.start({ kind: 'complete' });
    expect(service.snapshot().state).toBe('complete');

    const view = await renderOffline(service);
    /* Nothing is missing, so a control offering to fetch it would be offering nothing. */
    expect(view.queryByTestId(retryId(1))).toBeNull();
    expect(view.getByTestId(removeId(1))).toBeTruthy();
  });

  it('lists no row at all, and so no Retry, without a generation', async () => {
    const service = createTestOfflineService({ generation: null });
    await service.hydrate();

    const view = await renderOffline(service);
    expect(view.queryByTestId(retryId(1))).toBeNull();
    expect(view.queryByTestId(removeId(1))).toBeNull();
  });

  it('still offers it after a retry has failed again', async () => {
    const service = await partialFatihah();
    failingOn('1:4');
    await service.retrySurah(1);

    /* A failure leaves the user somewhere they can try again from, not somewhere with no way out. */
    const view = await renderOffline(service);
    expect(view.getByTestId(retryId(1))).toBeTruthy();
  });
});

describe('a press reaches the existing download path', () => {
  it('invokes the service’s own surah retry, once, for that surah', async () => {
    const service = await partialFatihah();
    const retrySurah = jest.spyOn(service, 'retrySurah');

    const view = await renderOffline(service);
    /*
      `fireEvent.press` calls the prop directly and never reaches the platform view tree, so this alone
      would have passed against the dead `onPress` too. What makes it meaningful is the union type on
      `FaithRowProps` and the affordance file's check that the row itself is not pressable.
    */
    await fireEvent.press(view.getByTestId(retryId(1)));

    expect(retrySurah).toHaveBeenCalledTimes(1);
    expect(retrySurah).toHaveBeenCalledWith(1);
    /*
      And not `start` — which records its scope, so a one-surah start would have narrowed "complete"
      to that surah. `offline-audio-retry-service.test.ts` pins the scope itself.
    */
    expect(service.snapshot().scope).toEqual({ kind: 'complete' });
  });

  it('does not fire the retry when Remove is pressed', async () => {
    const service = await partialFatihah();
    const retrySurah = jest.spyOn(service, 'retrySurah');
    const removeSurah = jest.spyOn(service, 'removeSurah');
    const view = await renderOffline(service);

    await fireEvent.press(view.getByTestId(removeId(1)));

    /*
      Two gestures, not one. This is the assertion the old shape could never have passed honestly: an
      `onPress` on the row would have sat under both controls, so a press anywhere in the trailing area
      was ambiguous. Remove still opens its own confirmation — asserted in `offline-audio-screen.test`,
      which flushes for the modal — and it must not have started a download on the way there.
    */
    expect(retrySurah).not.toHaveBeenCalled();
    expect(removeSurah).not.toHaveBeenCalled();
    expect(service.snapshot().scope).toEqual({ kind: 'complete' });
  });
});

describe('the row does not reintroduce the shape that caused this', () => {
  it('passes no row press beside its trailing controls, and keeps both reachable', async () => {
    const service = await partialFatihah();
    const view = await renderOffline(service);

    const row = view.getByTestId('faith-offline-audio-surah-1');
    /*
      `FaithRowProps` is a union — pressable, or carrying its own control, never both — so this is a
      compile error as well as an assertion. It is asserted anyway because the compile error is what a
      future edit would have to defeat, and this is what a reader sees.
    */
    expect(row.props.onPress).toBeUndefined();
    expect(row.props.accessible).toBe(false);

    for (const id of [retryId(1), removeId(1)]) {
      /*
        The node the testID is on. #115 collapsed `PressableScale` to one element, so the box a
        view and fills it with an absolutely-positioned `Pressable` that carries the accessibility props
        — so the touch target is the parent's box, and reading `style` off the queried node returns
        `absoluteFill` and would pass whatever the floor was set to.
      */
      const style = view.getByTestId(id).props.style;
      const flat = (Array.isArray(style) ? style : [style])
        .filter(
          (entry: unknown): entry is Record<string, unknown> =>
            typeof entry === 'object' && entry !== null,
        )
        .reduce<Record<string, unknown>>((all, entry) => ({ ...all, ...entry }), {});
      /*
        The token itself, never wrapped in `dp()`: that scales by screen width, and a floor measured at
        43 dp on a 384 dp phone is not a floor. This is the defect `205659b` fixed for the prayer sheet.
      */
      expect(flat.minHeight).toBe(touchTarget.minimum);
      expect(flat.minWidth).toBe(touchTarget.minimum);
    }
  });
});
