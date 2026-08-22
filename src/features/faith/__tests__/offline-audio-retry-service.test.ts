import { mockFileSystem } from '../../../../jest.setup';
import { createTestOfflineService, generationFor, OFFLINE } from '@/test-support/faith-reader';

/**
 * `retrySurah` — what a retry does to disk, to the manifest, and to the recorded scope.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── Why these cases render nothing ─────────────────────────────────────────
 * Every question here is about the download service, not about a screen: what happens when the device
 * is offline, when the same verse refuses twice, when nobody owns the content, when a run is cancelled.
 * The service is the real one over the in-memory filesystem, so the answers come from the code that
 * will run on a device rather than from a stub of it.
 *
 * Keeping them out of the screen's suites is also what makes those suites reliable — see the note in
 * `offline-audio-retry.test.tsx` on how many screen mounts one file can hold with no act environment.
 *
 * ── The one thing every case below is really checking ──────────────────────
 * That a retry is the *existing* download path and not a second one. `retrySurah` re-queues that
 * surah's failed rows and calls `resume`, so the generation gate, the connectivity gate, the
 * single-run guard and the non-overwriting promotion are all inherited. Each case names the guarantee
 * it is leaning on.
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

/** Surah 1 held partially: the fourth verse refused, so the run stops without finishing. */
async function partialFatihah() {
  failingOn('1:4');
  const service = createTestOfflineService({ generation: generationFor(1, TOTAL) });
  await service.hydrate();
  await service.start({ kind: 'complete' });
  return service;
}

/** Counts every transfer the filesystem is asked for, and answers all of them with audio. */
function countingResponder(): () => number {
  let requests = 0;
  mockFileSystem.respondWith(() => {
    requests += 1;
    return mockFileSystem.audioBytes(4096);
  });
  return () => requests;
}

/** The recitation files only — the manifest is rewritten by every run and is not audio. */
const audioUris = () => mockFileSystem.uris().filter((uri) => uri.endsWith('.mp3'));

beforeEach(() => {
  mockFileSystem.reset();
});

describe('a successful retry finishes the surah and refetches nothing', () => {
  it('fetches only what was missing', async () => {
    const service = await partialFatihah();
    const held = service.snapshot().playableAyat;
    expect(held).toBeGreaterThan(0);
    expect(held).toBeLessThan(TOTAL);

    const requests = countingResponder();
    await service.retrySurah(1);

    expect(service.snapshot().playableAyat).toBe(TOTAL);
    /*
      `pendingWork` treats a verified-available row as needing nothing, so the files already on disk are
      not asked for again — the property that makes a retry cheap and keeps it inside the provider's
      request ceiling however many times a user presses it.
    */
    expect(requests()).toBe(TOTAL - held);
    expect(service.playableAyat(1)).toContain(4);
  });

  it('promotes without overwriting what is already there', async () => {
    const service = await partialFatihah();
    const before = new Map(
      audioUris().map((uri) => [uri, mockFileSystem.files.get(uri)?.bytes.length]),
    );
    expect(before.size).toBeGreaterThan(0);

    countingResponder();
    await service.retrySurah(1);

    /*
      Every file that existed before still exists with the same byte count. `expo`'s `moveSync` does not
      overwrite — the trap that passed 4,600 tests and failed on the first device — so a retry that
      promoted over a held file would fail on hardware. This asserts the held files are never touched.
    */
    for (const [uri, size] of before) {
      expect(mockFileSystem.files.get(uri)?.bytes.length).toBe(size);
    }
    expect(audioUris().length).toBe(TOTAL);
  });

  it('leaves the recorded scope exactly as the user set it', async () => {
    /*
      The dead handler called `start({ selected: [surah] })`, and `start` *records* its scope — so had it
      ever fired it would have narrowed "complete" to one surah and quietly dropped the rest of what the
      user asked for. `retrySurah` writes no scope at all.
    */
    const service = await partialFatihah();
    expect(service.snapshot().scope).toEqual({ kind: 'complete' });

    countingResponder();
    await service.retrySurah(1);

    expect(service.snapshot().scope).toEqual({ kind: 'complete' });
  });

  it('requests only the permitted resource', async () => {
    const service = await partialFatihah();
    countingResponder();
    await service.retrySurah(1);

    /*
      The offline-audio permission covers Sudais, resource 3, and nothing else. Every file this feature
      writes is named from `PERMITTED_RESOURCE_ID`, so a retry that reached another reciter or resource
      would show up in the names on disk.
    */
    const audio = audioUris();
    expect(audio.length).toBe(TOTAL);
    for (const uri of audio) {
      expect(uri).toMatch(/\/faith-recitations-downloaded\/r3-s1-a\d+\.mp3$/);
    }
  });
});

describe('a retry that cannot run leaves everything alone', () => {
  it('asks for nothing and writes nothing while offline', async () => {
    const owner = await partialFatihah();
    expect(owner.snapshot().scope).toEqual({ kind: 'complete' });
    const filesBefore = audioUris().length;

    const offline = createTestOfflineService({
      generation: generationFor(1, TOTAL),
      connectivity: OFFLINE,
    });
    await offline.hydrate();
    const requests = countingResponder();
    await offline.retrySurah(1);

    /* The connectivity gate stops the run before a byte is requested, and nothing on disk moves. */
    expect(requests()).toBe(0);
    expect(audioUris().length).toBe(filesBefore);
    expect(offline.snapshot().state).toBe('waiting-for-connection');
  });

  it('keeps the partial state when the same verse refuses again', async () => {
    const service = await partialFatihah();
    const held = service.snapshot().playableAyat;
    const before = new Map(
      audioUris().map((uri) => [uri, mockFileSystem.files.get(uri)?.bytes.length]),
    );

    failingOn('1:4');
    await service.retrySurah(1);

    /*
      A failure is never resolved by deleting what landed. Progress is allowed to *increase* — the first
      run stops at the bad verse rather than skipping it, so a retry can legitimately pick up verses
      after it — but every file already held must survive byte-for-byte, and the bad verse must not be
      claimed as playable.
    */
    expect(service.snapshot().playableAyat).toBeGreaterThanOrEqual(held);
    expect(service.snapshot().playableAyat).toBeLessThan(TOTAL);
    for (const [uri, size] of before) {
      expect(mockFileSystem.files.get(uri)?.bytes.length).toBe(size);
    }
    expect(service.playableAyat(1)).not.toContain(4);
    /* And it stays retryable rather than settling into a state with no way out. */
    expect(service.snapshot().downloadedSurahs.find((row) => row.surah === 1)?.complete).toBe(
      false,
    );
  });

  it('fetches nothing when no generation is bound', async () => {
    /*
      No bound generation is how both "nobody is signed in" and "this device holds content another owner
      synced" reach the download path: `bindForRun` returns null and `execute` fails closed with
      `no-generation` before any transfer. A retry inherits that by going through the same call.

      A scope has to be recorded first, or `resume` returns before the gate is ever consulted and the
      case would pass for the wrong reason.
    */
    const owner = await partialFatihah();
    expect(owner.snapshot().scope).toEqual({ kind: 'complete' });
    const filesBefore = audioUris().length;

    const stranger = createTestOfflineService({ generation: null });
    await stranger.hydrate();
    const requests = countingResponder();

    await stranger.retrySurah(1);

    expect(requests()).toBe(0);
    expect(audioUris().length).toBe(filesBefore);
    expect(stranger.snapshot().state).toBe('failed');
    expect(stranger.snapshot().lastFailure).toBe('no-generation');
  });

  it('does nothing for a surah it holds nothing of', async () => {
    mockFileSystem.respondWith(() => mockFileSystem.audioBytes(4096));
    const service = createTestOfflineService({ generation: generationFor(1, TOTAL) });
    await service.hydrate();
    await service.start({ kind: 'complete' });
    const filesBefore = audioUris().length;

    const requests = countingResponder();
    /* Surah 2 is not in this generation, so there is nothing to re-queue and nothing to fetch. */
    await service.retrySurah(2);

    expect(requests()).toBe(0);
    expect(audioUris().length).toBe(filesBefore);
  });
});

describe('cancellation returns to a truthful, retryable state', () => {
  it('keeps verified files and reports partial rather than complete', async () => {
    const service = await partialFatihah();
    const held = service.snapshot().playableAyat;

    await service.cancel();

    /*
      Cancelling is "stop asking me to finish this", not "throw away what I have": verified files stay
      and the scope is cleared, so the state is `partially-downloaded` and the row still offers a retry.
    */
    expect(service.snapshot().state).toBe('partially-downloaded');
    expect(service.snapshot().playableAyat).toBe(held);
    expect(service.snapshot().downloadedSurahs.find((row) => row.surah === 1)?.complete).toBe(
      false,
    );
  });

  it('can still be finished after cancelling', async () => {
    const service = await partialFatihah();
    await service.cancel();
    expect(service.snapshot().scope).toEqual({ kind: 'none' });
    expect(service.snapshot().playableAyat).toBeLessThan(TOTAL);

    countingResponder();
    /*
      Cancelling cleared the scope, and `resume` returns immediately on an empty scope — so without the
      branch in `retrySurah` the row would show a Retry control that did nothing at all. This is the
      case that found that, and the one that would find it again.
    */
    await service.retrySurah(1);

    expect(service.snapshot().playableAyat).toBe(TOTAL);
    /* The surah the user asked for becomes the scope, because there was no wider intent left. */
    expect(service.snapshot().scope).toEqual({ kind: 'selected', surahs: [1] });
  });
});

describe('repeated retries do not become repeated downloads', () => {
  it('runs once when called three times without awaiting', async () => {
    const service = await partialFatihah();
    const missing = TOTAL - service.snapshot().playableAyat;
    const requests = countingResponder();

    /*
      The `run !== null` guard in `execute` — "a second press is not a second download". Three
      overlapping calls must produce one run, and therefore exactly the missing verses once each.
    */
    await Promise.all([service.retrySurah(1), service.retrySurah(1), service.retrySurah(1)]);

    expect(requests()).toBe(missing);
    expect(service.snapshot().playableAyat).toBe(TOTAL);
  });

  it('is idempotent once the surah is complete', async () => {
    const service = await partialFatihah();
    countingResponder();
    await service.retrySurah(1);
    expect(service.snapshot().playableAyat).toBe(TOTAL);

    const second = countingResponder();
    await service.retrySurah(1);

    /* Nothing left to fetch, so nothing is fetched. */
    expect(second()).toBe(0);
    expect(service.snapshot().playableAyat).toBe(TOTAL);
  });
});
