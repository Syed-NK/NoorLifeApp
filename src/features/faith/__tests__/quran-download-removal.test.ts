import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import AsyncStorage from '@react-native-async-storage/async-storage';

import { mockFileSystem } from '../../../../jest.setup';

import {
  audioFileName,
  fileSafeReciterId,
  parseAudioFileName,
} from '../data/audio/audio-store.port';
import { createExpoAudioStore } from '../data/audio/expo-audio-store';
import { createRecitationAudio } from '../data/audio/recitation-audio';
import { readSurahDownloads, recordSurahDownload } from '../storage/faith-audio-downloads';

/**
 * Downloaded recitation can be removed, and removing it removes the bytes.
 *
 * ── The two defects these cases were written against ────────────────────────
 *   1. **Removal was unreachable.** `removeDownload` has always existed; nothing in the app could
 *      reach it for an arbitrary surah. The reciter rows describe exactly one surah —
 *      `position?.surah`, the continue-reading position — and that stays `null` until the user
 *      deliberately marks a verse read. So "open a surah, download it, leave" produced a device
 *      holding tens of megabytes with no screen listing it and no control removing it. In the
 *      player, the completed state was a *disabled* control that re-announced its own status.
 *   2. **Removal could delete nothing and report success.** The deletion loop ran `1..ayahCount`
 *      from a count the *caller* supplied, and the reciter screen supplied
 *      `position?.ayahCount ?? 0` — zero whenever there was no reading position. The loop then
 *      removed no files while the index entry was dropped, so the bytes became unreachable rather
 *      than removed: invisible to the user, invisible to the storage total, and still on the device.
 */

const RECITER = '3';
const SURAH = 1;
const AYAH_COUNT = 7;

/**
 * Where the store writes, matching `expo-audio-store.ts`.
 *
 * Duplicated here on purpose: a test that discovered the path from the store under test could not
 * fail if the store started writing somewhere else, and "the bytes are in private cache storage" is
 * one of the conditions the recitation permission turns on.
 */
const STORE_DIRECTORY = 'file:///cache/faith-recitations';

function createAudio() {
  const store = createExpoAudioStore();
  return { store, audio: createRecitationAudio({ store }) };
}

/** Seeds a completed download: the files on disk, and the index entry describing them. */
async function seedDownload(reciterId = RECITER, surah = SURAH, ayahCount = AYAH_COUNT) {
  let bytes = 0;
  for (let ayah = 1; ayah <= ayahCount; ayah += 1) {
    const name = audioFileName(reciterId, surah, ayah);
    const content = mockFileSystem.audioBytes(4096);
    bytes += content.length;
    mockFileSystem.seed(`${STORE_DIRECTORY}/${name}`, content);
  }
  await recordSurahDownload({
    reciterId,
    surah,
    files: ayahCount,
    ayahCount,
    bytes,
    storedAt: Date.now(),
  });
}

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe('a download can be removed without knowing how many verses it has', () => {
  it('deletes every file of the surah and forgets the record', async () => {
    await seedDownload();
    const { store, audio } = createAudio();
    await audio.hydrate();
    expect(store.list().length).toBe(AYAH_COUNT);

    /*
      No `ayahCount` argument. That is the correction: the count is enumerated from the store rather
      than supplied by a caller who had no reliable way of knowing it.
    */
    await audio.removeDownload(RECITER, SURAH);

    expect(store.list()).toHaveLength(0);
    expect(await readSurahDownloads()).toHaveLength(0);
  });

  it('still deletes the files when the caller passes a count of zero', async () => {
    await seedDownload();
    const { store, audio } = createAudio();
    await audio.hydrate();

    /*
      Exactly the call the reciter screen used to make. Under the old implementation this removed
      nothing and dropped the index entry, orphaning every byte.
    */
    await audio.removeDownload(RECITER, SURAH, 0);

    expect(store.list()).toHaveLength(0);
    expect(await readSurahDownloads()).toHaveLength(0);
  });

  it('leaves another reciter’s download alone', async () => {
    await seedDownload(RECITER, SURAH, AYAH_COUNT);
    await seedDownload('7', SURAH, AYAH_COUNT);
    const { store, audio } = createAudio();
    await audio.hydrate();

    await audio.removeDownload(RECITER, SURAH);

    const remaining = store.list().map((file) => parseAudioFileName(file.name)?.reciterId);
    expect(new Set(remaining)).toEqual(new Set([fileSafeReciterId('7')]));
    expect((await readSurahDownloads()).map((entry) => entry.reciterId)).toEqual(['7']);
  });

  it('removes every download for one reciter and keeps the others', async () => {
    await seedDownload(RECITER, 1, 7);
    await seedDownload(RECITER, 112, 4);
    await seedDownload('7', 1, 7);
    const { store, audio } = createAudio();
    await audio.hydrate();

    await audio.removeReciterDownloads(RECITER);

    expect(await readSurahDownloads()).toHaveLength(1);
    expect((await readSurahDownloads())[0]?.reciterId).toBe('7');
    const remaining = store.list().map((file) => parseAudioFileName(file.name)?.reciterId);
    expect(new Set(remaining)).toEqual(new Set([fileSafeReciterId('7')]));
  });

  it('reports the surah as no longer downloaded afterwards', async () => {
    await seedDownload();
    const { audio } = createAudio();
    await audio.hydrate();
    expect(audio.stateFor(RECITER, SURAH).kind).toBe('downloaded');

    await audio.removeDownload(RECITER, SURAH);

    /* The UI reads this synchronously, so it has to be right the moment the removal resolves. */
    expect(audio.stateFor(RECITER, SURAH).kind).toBe('stream-only');
  });

  it('removes everything, sweeping the store rather than trusting the index', async () => {
    await seedDownload();
    const { store, audio } = createAudio();
    await audio.hydrate();
    /* A file whose index entry was lost — the case a record-driven sweep would leave behind. */
    mockFileSystem.seed(
      `${STORE_DIRECTORY}/${audioFileName('9', 99, 1)}`,
      mockFileSystem.audioBytes(4096),
    );

    await audio.removeAll();

    expect(store.list()).toHaveLength(0);
    expect(await readSurahDownloads()).toHaveLength(0);
  });
});

describe('the removal surfaces exist and offer no way out of private storage', () => {
  const reciterScreen = readFileSync(
    join(__dirname, '..', 'screens', 'reciter-screen.tsx'),
    'utf8',
  );
  const player = readFileSync(
    join(__dirname, '..', 'components', 'reader', 'quran-audio-player.tsx'),
    'utf8',
  );

  it('lists downloads independently of the reading position', () => {
    /*
      The reciter rows are bound to `targetSurah`; this panel is bound to the download index, which
      is what makes removal reachable when there is no reading position at all.
    */
    expect(reciterScreen).toContain('faith-reciters-downloads');
    expect(reciterScreen).toContain('onRemoveDownload');
  });

  it('puts bulk removal behind a confirmation', () => {
    expect(reciterScreen).toContain('faith-reciter-downloads-confirm');
    expect(reciterScreen).toContain('faith-reciter-downloads-confirm-cancel');
    expect(reciterScreen).toContain('faith-reciter-downloads-confirm-remove');
  });

  it('states current storage usage', () => {
    expect(reciterScreen).toContain('faith-reciters-storage');
    expect(reciterScreen).toContain('totalDownloadedBytes');
  });

  it('makes the player’s completed state remove rather than repeat itself', () => {
    /*
      The control used to be `disabled` when done, so pressing it re-announced "is downloaded" and
      did nothing. It is now the removal path, and it carries the destructive glyph rather than the
      tick — a delete button wearing the badge for "this worked" is the one icon a user is least
      expecting to take something away.
    */
    expect(player).toContain('onRemoveDownload');
    expect(player).toContain('done ? onRemove : onDownload');
    expect(player).toContain("done ? 'delete' : 'download'");
  });

  it('offers no share or export of downloaded audio anywhere', () => {
    /*
      Condition C3 of the recitation permission, asserted as an absence. Sharing a *verse* is a
      different thing and lives in `verse-share.ts`; nothing may hand out the audio file.
    */
    for (const source of [reciterScreen, player]) {
      expect(source).not.toMatch(/Share\s*(?:the\s*)?(?:download|audio|recitation)/i);
      /* Word-bounded: `export function` is a language keyword, not a share affordance. */
      expect(source).not.toMatch(
        /export(?:ing|ed)?s+(?:thes+)?(?:audio|download|recitation|file)/i,
      );
      expect(source).not.toMatch(/save to files|copy to downloads|share sheet/i);
    }
  });
});
