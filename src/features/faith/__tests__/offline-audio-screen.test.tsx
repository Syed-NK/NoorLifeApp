import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import React from 'react';
import { mockFileSystem } from '../../../../jest.setup';
import { describeEstimate, OfflineAudioScreen } from '../screens/offline-audio-screen';
import { formatBytes } from '../components/reader/quran-audio-player';
import { estimateSize, upperBoundBytes, withMeasuredSizes } from '../data/audio/offline-estimate';
import { SUDAIS_ATTRIBUTION } from '../data/quran-foundation/recitation-attribution';
import type { OfflineDownloadService } from '../data/audio/offline-download.service';

import {
  createTestOfflineService,
  generationFor,
  renderInFaith,
  renderReader,
  READER_DOWNLOADED,
} from '@/test-support/faith-reader';

/**
 * The published total, read off the device's own generation rather than chosen.
 *
 * `gen-1786885216299-fc1ccbdb` sums `durationSeconds` across all 6,236 resource-3 rows to 72,955
 * seconds — 20.3 hours. An invented figure here would let the wording drift from what a user actually
 * sees, which for the one number this screen is allowed to state is the whole point.
 */
const DEVICE_TOTAL_DURATION_SECONDS = 72_955;

/**
 * The Offline audio screen: what it claims, what it refuses to claim, and what it will not offer.
 *
 * ── The three things these tests are really about ──────────────────────────
 *   1. **Honesty about size.** Three genuinely different sentences for three genuinely different
 *      states of knowledge, and never a confident number over an unknown total.
 *   2. **Honesty about retention.** Nothing on this screen says the audio expires, because for this
 *      reciter it does not. The seven-day window is a check obligation.
 *   3. **What is absent.** No share, no export, no path, no URL, and no playback control — and on the
 *      player, no download control. The two surfaces stay separate.
 */

async function renderOffline(service?: OfflineDownloadService) {
  return await renderInFaith(<OfflineAudioScreen />, undefined, service);
}

beforeEach(() => {
  mockFileSystem.reset();
});

describe('what it says before anything is downloaded', () => {
  it('starts at not-downloaded and offers a download rather than implying one is running', async () => {
    const service = createTestOfflineService({ generation: generationFor(1, 7) });
    await service.hydrate();
    const view = await renderOffline(service);

    expect(String(view.getByTestId('faith-offline-audio-status').props.accessibilityLabel)).toMatch(
      /not downloaded/i,
    );
    expect(view.getByTestId('faith-offline-audio-start')).toBeTruthy();
    /* Nothing to pause, nothing to remove, nothing to retry. */
    expect(view.queryByTestId('faith-offline-audio-pause')).toBeNull();
    expect(view.queryByTestId('faith-offline-audio-remove-all')).toBeNull();
    expect(view.queryByTestId('faith-offline-audio-retry')).toBeNull();
  });

  it('defaults Wi-Fi-only to on', async () => {
    const service = createTestOfflineService({ generation: generationFor(1, 7) });
    await service.hydrate();
    const view = await renderOffline(service);

    expect(
      String(view.getByTestId('faith-offline-audio-wifi-toggle').props.accessibilityLabel),
    ).toMatch(/wi-fi only, on/i);
  });

  it('says a download is explicitly the user’s to start', async () => {
    const service = createTestOfflineService({ generation: generationFor(1, 7) });
    await service.hydrate();
    const view = await renderOffline(service);

    expect(String(view.getByTestId('faith-offline-audio-start').props.accessibilityLabel)).toMatch(
      /you choose when this runs/i,
    );
  });
});

describe('the size estimate never claims more than it knows', () => {
  it('leads with duration, not bytes, when the publisher gives no sizes', () => {
    /*
      ── The branch that actually runs in production ────────────────────────────
      All 6,236 rows of the live resource-3 generation carry `bytes: null`. So this is not the
      defensive case for an unlikely feed — it is the case, and it has to be the most carefully worded
      string on the screen.
    */
    const message = describeEstimate({
      kind: 'unknown',
      totalAyat: 6236,
      totalDurationSeconds: DEVICE_TOTAL_DURATION_SECONDS,
    });

    expect(message).toMatch(/does not give file sizes/i);
    expect(message).toMatch(/not known until it starts/i);
    /* Duration is published, so it may be stated. */
    expect(message).toMatch(/About 20 hours of recitation/);
    /*
      And no byte figure of any kind. Converting 20 hours to megabytes needs a bitrate nobody
      published, and that multiplication is the invention this whole module exists to refuse.
    */
    expect(message).not.toMatch(/d+(.d+)?s*(KB|MB|GB)/);
  });

  it('says nothing about duration either when none was published', () => {
    const message = describeEstimate({
      kind: 'unknown',
      totalAyat: 6236,
      totalDurationSeconds: null,
    });
    expect(message).not.toMatch(/hours|minutes/i);
    expect(message).not.toMatch(/d+(.d+)?s*(KB|MB|GB)/);
  });

  it('credits the user’s own downloads rather than the publisher for a measured projection', () => {
    /*
      The misattribution this prevents: on the live feed every byte figure the screen can ever show was
      computed from files this device downloaded. Saying "the publisher gave a size for 2,000 verses"
      would credit Quran Foundation with a measurement it did not supply.
    */
    const message = describeEstimate({
      kind: 'partial',
      totalAyat: 6236,
      knownAyat: 2000,
      knownBytes: 180_000_000,
      lowBytes: 500_000_000,
      highBytes: 640_000_000,
      basis: 'surah-means',
      sizeSource: 'measured',
      totalDurationSeconds: DEVICE_TOTAL_DURATION_SECONDS,
    });

    expect(message).toMatch(/already downloaded/i);
    expect(message).not.toMatch(/publisher gave/i);
    /* A range stays a range — the midpoint is a number nobody measured. */
    expect(message).toMatch(/Estimated .* to .* in total/i);
    expect(message).toMatch(/2,000 of 6,236 verses/);
  });

  it('says "as published" only when the publisher really did supply the sizes', () => {
    const message = describeEstimate({
      kind: 'partial',
      totalAyat: 100,
      knownAyat: 40,
      knownBytes: 4_000_000,
      lowBytes: 9_000_000,
      highBytes: 11_000_000,
      basis: 'surah-means',
      sizeSource: 'published',
      totalDurationSeconds: null,
    });
    expect(message).toMatch(/the publisher gave sizes for/i);
    expect(message).not.toMatch(/already downloaded/i);
  });

  it('states an exact total only when every verse has a known size, and names the source', () => {
    expect(
      describeEstimate({
        kind: 'exact',
        totalAyat: 6236,
        bytes: 500_000_000,
        sizeSource: 'measured',
        totalDurationSeconds: DEVICE_TOTAL_DURATION_SECONDS,
      }),
    ).toMatch(/measured from the files on this device/i);

    expect(
      describeEstimate({
        kind: 'exact',
        totalAyat: 7,
        bytes: 500_000,
        sizeSource: 'published',
        totalDurationSeconds: null,
      }),
    ).toMatch(/as published/i);
  });

  it('says nothing at all before a scope has been estimated', () => {
    expect(describeEstimate(null)).toMatch(/worked out when you start/i);
  });
});

describe('what it says once verses are on the device', () => {
  it('counts verses and surahs against what the publisher publishes', async () => {
    const service = createTestOfflineService({ generation: generationFor(1, 7) });
    await service.hydrate();
    await service.start({ kind: 'complete' });
    const view = await renderOffline(service);

    expect(String(view.getByTestId('faith-offline-audio-ayat').props.children)).toBe(
      '7 of 7 verses',
    );
    expect(String(view.getByTestId('faith-offline-audio-surahs').props.children)).toBe(
      '1 of 1 surahs complete',
    );
  });

  it('lists a downloaded surah with a way to remove it', async () => {
    const service = createTestOfflineService({ generation: generationFor(1, 7) });
    await service.hydrate();
    await service.start({ kind: 'complete' });
    const view = await renderOffline(service);

    expect(view.getByTestId('faith-offline-audio-surah-1')).toBeTruthy();
    expect(view.getByTestId('faith-offline-audio-remove-surah-1')).toBeTruthy();
  });

  it('names a partly-downloaded surah as partial rather than as complete', async () => {
    const service = createTestOfflineService({ generation: generationFor(1, 7) });
    await service.hydrate();
    await service.start({ kind: 'complete' });
    await service.removeSurah(1);
    await service.start({ kind: 'selected', surahs: [1] });
    /* Take one file away behind the app's back, then let the repair pass notice. */
    mockFileSystem.files.delete('file:///documents/faith-recitations-downloaded/r3-s1-a4.mp3');
    await service.hydrate();

    const view = await renderOffline(service);
    expect(String(view.getByTestId('faith-offline-audio-surah-1').props.children)).toBeDefined();
    expect(view.getByTestId('faith-offline-audio-surah-1')).toBeTruthy();
  });
});

describe('removal is confirmed, and says what it costs', () => {
  it('does not remove anything on the first press', async () => {
    const service = createTestOfflineService({ generation: generationFor(1, 7) });
    await service.hydrate();
    await service.start({ kind: 'complete' });
    const view = await renderOffline(service);

    fireEvent.press(view.getByTestId('faith-offline-audio-remove-all'));

    /* `fireEvent` does not flush in this environment, so the dialog is awaited rather than read. */
    expect(await view.findByTestId('faith-offline-audio-confirm')).toBeTruthy();
    expect(service.snapshot().playableAyat).toBe(7);
  });

  it('offers Cancel first, as the safe default', async () => {
    const service = createTestOfflineService({ generation: generationFor(1, 7) });
    await service.hydrate();
    await service.start({ kind: 'complete' });
    const view = await renderOffline(service);
    fireEvent.press(view.getByTestId('faith-offline-audio-remove-all'));

    expect(
      String(
        (await view.findByTestId('faith-offline-audio-confirm-cancel')).props.accessibilityLabel,
      ),
    ).toMatch(/keep the downloaded audio/i);
    fireEvent.press(view.getByTestId('faith-offline-audio-confirm-cancel'));
    await waitFor(() => expect(view.queryByTestId('faith-offline-audio-confirm')).toBeNull());
    expect(service.snapshot().playableAyat).toBe(7);
  });

  it('says how much is being deleted and that the reader will stop playing', async () => {
    const service = createTestOfflineService({ generation: generationFor(1, 7) });
    await service.hydrate();
    await service.start({ kind: 'complete' });
    const view = await renderOffline(service);
    fireEvent.press(view.getByTestId('faith-offline-audio-remove-all'));
    await view.findByTestId('faith-offline-audio-confirm');

    const body = view
      .getAllByText(/deletes/i)
      .map((node) => String(node.props.children))
      .join(' ');
    expect(body).toMatch(/7 verses/);
    expect(body).toMatch(/will not be able to play/i);
  });
});

describe('nothing on this screen threatens deletion by elapsed time', () => {
  it('never uses expiry language anywhere in its copy', async () => {
    /*
      ── The wording that had to go ─────────────────────────────────────────────
      The reciter screen used to read "Downloads are kept for up to one week, then removed", which
      described a ceiling that does not apply to this reciter. The permission grants retention beyond
      one week; the seven-day window is a *check* obligation, and an offline device keeps its audio.
    */
    const service = createTestOfflineService({ generation: generationFor(1, 7) });
    await service.hydrate();
    await service.start({ kind: 'complete' });
    const view = await renderOffline(service);

    const text = JSON.stringify(view.toJSON());
    expect(text).not.toMatch(/expire/i);
    expect(text).not.toMatch(/kept for up to/i);
    expect(text).not.toMatch(/one week/i);
  });

  it('says a check is due while stating the audio still plays', async () => {
    const service = createTestOfflineService({ generation: generationFor(1, 7) });
    await service.hydrate();
    await service.start({ kind: 'complete' });
    const view = await renderOffline(service);

    expect(String(view.getByTestId('faith-offline-audio-check').props.accessibilityLabel)).toMatch(
      /not checked yet|check is due/i,
    );
  });
});

describe('the required attribution', () => {
  it('is displayed exactly as granted', async () => {
    const service = createTestOfflineService({ generation: generationFor(1, 7) });
    await service.hydrate();
    const view = await renderOffline(service);

    /*
      Byte for byte, from the one constant. The permission specifies it exactly — not paraphrased,
      not reordered, not abbreviated to fit a row.
    */
    expect(
      String(view.getByTestId('faith-offline-audio-attribution').props.accessibilityLabel),
    ).toBe(SUDAIS_ATTRIBUTION);
    expect(SUDAIS_ATTRIBUTION).toBe(
      'Recitation by Abdur-Rahman as-Sudais. Audio provided by Quran Foundation (Quran.com).',
    );
  });
});

describe('what this screen must never offer', () => {
  it('has no share, export or file-path control of any kind', async () => {
    /*
      Licence conditions: private application storage, in-app listening only, no standalone-file
      sharing. A control that moved one of these files anywhere else would be the single most
      consequential line in this module.
    */
    const service = createTestOfflineService({ generation: generationFor(1, 7) });
    await service.hydrate();
    await service.start({ kind: 'complete' });
    const view = await renderOffline(service);

    const text = JSON.stringify(view.toJSON());
    expect(text).not.toMatch(/\bshare\b/i);
    expect(text).not.toMatch(/\bexport\b/i);
    expect(text).not.toMatch(/file:\/\//);
    expect(text).not.toMatch(/https?:\/\//);
    expect(text).not.toMatch(/\/documents\//);
  });

  it('claims nothing about how playback sounds', async () => {
    /*
      "Gapless" is a measurement, not an architecture. The word may not appear on a screen; what can
      be measured is reported in the verification record instead.
    */
    const service = createTestOfflineService({ generation: generationFor(1, 7) });
    await service.hydrate();
    await service.start({ kind: 'complete' });
    const view = await renderOffline(service);

    const text = JSON.stringify(view.toJSON());
    expect(text).not.toMatch(/gapless/i);
    expect(text).not.toMatch(/seamless/i);
  });

  it('carries no playback control', async () => {
    const service = createTestOfflineService({ generation: generationFor(1, 7) });
    await service.hydrate();
    await service.start({ kind: 'complete' });
    const view = await renderOffline(service);

    expect(view.queryByTestId('faith-reader-player')).toBeNull();
    expect(view.queryByTestId('faith-reader-player-toggle')).toBeNull();
  });
});

describe('the docked player carries no download control', () => {
  it('offers management rather than a download when a verse is missing', async () => {
    const { view } = await renderReader({ downloaded: READER_DOWNLOADED });

    /*
      Locked decision 5: the reader player is playback-only. The control that used to live here cycled
      Download / Cancel / Remove / Retry / Finish across a six-state union — five of those are about
      storage rather than listening, and none belongs on the surface somebody reaches for
      mid-recitation.
    */
    const player = await view.findByTestId('faith-reader-player');
    const text = JSON.stringify(player.toJSON?.() ?? screen.toJSON());
    expect(text).not.toMatch(/faith-reader-player-download/);
    expect(text).not.toMatch(/\bdownloading\b/i);
  });
});

describe('the estimator against the feed NoorLife actually receives', () => {
  /**
   * The live shape, reproduced exactly: a duration on every row, a size on none.
   *
   * Read off the emulator's published generation — `{"verseKey":"1:1","durationSeconds":3,
   * "bytes":null,"sequence":1354,...}` — across all 6,236 rows. A fixture that gave rows sizes would
   * test a feed NoorLife does not have.
   */
  const liveShapeRows = (count: number) =>
    Array.from({ length: count }, (_, index) => ({
      surah: 1,
      ayah: index + 1,
      bytes: null,
      durationSeconds: 15,
    }));

  it('answers unknown, and carries the published duration', () => {
    const estimate = estimateSize(liveShapeRows(100));
    expect(estimate.kind).toBe('unknown');
    expect(estimate.totalDurationSeconds).toBe(1500);
  });

  it('refuses to state a size before anything has been downloaded', () => {
    expect(upperBoundBytes(estimateSize(liveShapeRows(6236)))).toBeNull();
  });

  it('becomes a measured projection once files land, and says so', () => {
    /*
      Twenty of a hundred verses downloaded. Their byte counts are real files at the bitrate the CDN
      served, so they are measurements — and folding them back in is the only route by which this
      feature can ever show a size at all.
    */
    const measured = new Map(
      Array.from({ length: 20 }, (_, index) => [`1:${index + 1}`, 90_000] as const),
    );
    const estimate = estimateSize(withMeasuredSizes(liveShapeRows(100), measured));

    expect(estimate.kind).toBe('partial');
    if (estimate.kind !== 'partial') {
      return;
    }
    expect(estimate.sizeSource).toBe('measured');
    expect(estimate.knownAyat).toBe(20);
    expect(estimate.knownBytes).toBe(20 * 90_000);
    /* Every remaining verse projected at the measured rate — a projection, not a claim. */
    expect(estimate.lowBytes).toBe(100 * 90_000);
    expect(estimate.highBytes).toBe(100 * 90_000);
  });

  it('reaches exact once every verse has been measured', () => {
    const measured = new Map(
      Array.from({ length: 50 }, (_, index) => [`1:${index + 1}`, 80_000] as const),
    );
    const estimate = estimateSize(withMeasuredSizes(liveShapeRows(50), measured));
    expect(estimate.kind).toBe('exact');
    expect(estimate.kind === 'exact' && estimate.sizeSource).toBe('measured');
  });

  it('distinguishes a mixed source from a purely measured one', () => {
    const rows = [
      { surah: 1, ayah: 1, bytes: 70_000, durationSeconds: 10 },
      { surah: 1, ayah: 2, bytes: null, durationSeconds: 10 },
      { surah: 1, ayah: 3, bytes: null, durationSeconds: 10 },
    ];
    const estimate = estimateSize(withMeasuredSizes(rows, new Map([['1:2', 90_000]])));
    expect(estimate.kind === 'partial' && estimate.sizeSource).toBe('mixed');
  });

  it('lets a measured file win over a published size for the same verse', () => {
    /*
      The file on disk is what occupies the storage the user is being asked about, and it is the
      figure that was validated. A published size that disagreed would have failed validation and
      never been promoted, so the two cannot silently differ.
    */
    const rows = [{ surah: 1, ayah: 1, bytes: 50_000, durationSeconds: 10 }];
    const estimate = estimateSize(withMeasuredSizes(rows, new Map([['1:1', 91_234]])));
    expect(estimate.kind === 'exact' && estimate.bytes).toBe(91_234);
    expect(estimate.kind === 'exact' && estimate.sizeSource).toBe('measured');
  });

  it('leaves the rows alone when nothing has been measured', () => {
    const rows = liveShapeRows(5);
    expect(withMeasuredSizes(rows, new Map())).toBe(rows);
  });
});

describe('byte figures never stand in for nothing', () => {
  it('says zero bytes rather than inventing one kilobyte', async () => {
    /*
      ── The defect this pins, seen on a release device ────────────────────────
      `formatBytes` floored every value at 1 KB, so the Offline audio screen read "1 KB downloaded"
      with nothing on the device at all — a fabricated measurement standing in for nothing, which is
      precisely what this feature refuses everywhere else. No unit test had asked what zero looks like.
    */
    const service = createTestOfflineService({ generation: generationFor(1, 7) });
    await service.hydrate();
    const view = await renderOffline(service);

    expect(String(view.getByTestId('faith-offline-audio-bytes').props.children)).toBe(
      '0 bytes downloaded',
    );
  });

  it('still rounds a genuinely small non-zero file up rather than down to nothing', () => {
    /* A 400-byte file is not "0 KB"; rounding it away would be the same lie in the other direction. */
    expect(formatBytes(400)).toBe('1 KB');
    expect(formatBytes(0)).toBe('0 bytes');
  });
});

describe('every counter on the screen comes from one walk of one manifest', () => {
  it('agrees between the header and the per-surah list', async () => {
    /*
      ── The defect this closes, seen on a release device ──────────────────────
      The header read "789 verses, 5 surahs complete" while the list below showed surah 4 with 132
      verses and omitted surah 5 entirely. The list was a `useMemo` over 114 surahs keyed on a scalar,
      and it did not re-run. Two counters over one manifest disagreeing is precisely what this feature
      is arranged to make impossible.
    */
    const generation = {
      generationId: 'gen-test',
      rows: [...generationFor(1, 7).rows, ...generationFor(2, 5).rows, ...generationFor(3, 4).rows],
    };
    const service = createTestOfflineService({ generation });
    await service.hydrate();
    await service.start({ kind: 'complete' });

    const snapshot = service.snapshot();
    expect(snapshot.playableAyat).toBe(16);
    expect(snapshot.completeSurahs).toBe(3);

    /* The list is the same fact, not a second derivation of it. */
    expect(snapshot.downloadedSurahs).toEqual([
      { surah: 1, playable: 7, total: 7, complete: true },
      { surah: 2, playable: 5, total: 5, complete: true },
      { surah: 3, playable: 4, total: 4, complete: true },
    ]);
    expect(snapshot.downloadedSurahs.filter((s) => s.complete)).toHaveLength(
      snapshot.completeSurahs,
    );
    expect(snapshot.downloadedSurahs.reduce((sum, s) => sum + s.playable, 0)).toBe(
      snapshot.playableAyat,
    );
  });

  it('keeps agreeing after a surah is partly removed', async () => {
    const generation = {
      generationId: 'gen-test',
      rows: [...generationFor(1, 7).rows, ...generationFor(2, 5).rows],
    };
    const service = createTestOfflineService({ generation });
    await service.hydrate();
    await service.start({ kind: 'complete' });
    await service.removeSurah(2);

    const snapshot = service.snapshot();
    expect(snapshot.downloadedSurahs).toEqual([
      { surah: 1, playable: 7, total: 7, complete: true },
    ]);
    expect(snapshot.completeSurahs).toBe(1);
    expect(snapshot.playableAyat).toBe(7);
  });
});
