import AsyncStorage from '@react-native-async-storage/async-storage';

import { parseAudioFileName } from '../data/audio/audio-store.port';
import {
  AUDIO_MANIFEST_VERSION,
  EMPTY_MANIFEST,
  findRow,
  isPlayable,
  manifestKey,
  planLegacyMigration,
  readAudioManifest,
  removeRows,
  rowsForSurah,
  upsertRows,
  writeAudioManifest,
  type AudioManifestRow,
} from '../storage/faith-audio-manifest';

/**
 * The manifest that retires filename probing.
 *
 * ── What was wrong with the practice it replaces ────────────────────────────
 * Presence used to be decided by building `r3-s93-a1.mp3` and asking whether that file existed, and
 * identity was read back out of the name when a sweep or a removal needed it. A name is a **guess**
 * about identity: it cannot say which vendor row the bytes came from, whether they were ever
 * validated, when they last agreed with the publisher, or whether a partial file is a download in
 * progress or the wreckage of a killed process.
 *
 * The migration below is the only place a name may still be parsed, and it is also the place the
 * guess is proved — against synchronised recitation rows. Anything it cannot prove is quarantined,
 * because a mis-bound recitation plays a verse in the wrong place and nothing downstream could
 * detect it.
 */

const NOW = 1_786_000_000_000;

const row = (ayah: number, over: Partial<AudioManifestRow> = {}): AudioManifestRow => ({
  reciterId: '3',
  surah: 93,
  ayah,
  fileName: `r3-s93-a${ayah}.mp3`,
  bytes: 30_000 + ayah,
  integrity: null,
  downloadedAt: NOW,
  lastSyncedAt: NOW,
  recordKey: `93:${ayah}`,
  sequence: ayah,
  state: 'available',
  ...over,
});

const known = (ayah: number) => ({
  resourceId: 3,
  surah: 93,
  ayah,
  verseKey: `93:${ayah}`,
  sequence: ayah,
});

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe('the audio manifest', () => {
  it('starts empty and unmigrated', async () => {
    const manifest = await readAudioManifest();
    expect(manifest).toEqual(EMPTY_MANIFEST);
    /*
      Stored rather than inferred from an empty row list: a user with no downloads and a user whose
      legacy files were all unprovable both have zero rows, and only one still needs the migration.
    */
    expect(manifest.migratedLegacyFiles).toBe(false);
  });

  it('round-trips rows', async () => {
    await writeAudioManifest({ ...EMPTY_MANIFEST, rows: [row(1), row(2)] });
    const stored = await readAudioManifest();

    expect(stored.rows).toHaveLength(2);
    expect(stored.rows[0]?.recordKey).toBe('93:1');
  });

  it('stores no URL and no host', async () => {
    await writeAudioManifest({ ...EMPTY_MANIFEST, rows: [row(1)] });
    const raw = await AsyncStorage.getItem('noorlife.faith.quran.audio-manifest');

    expect(raw).not.toContain('http');
    expect(raw).not.toContain('quran.foundation');
  });

  it('discards a manifest written by an older schema', async () => {
    await AsyncStorage.setItem(
      'noorlife.faith.quran.audio-manifest',
      JSON.stringify({ version: 0, rows: [row(1)], migratedLegacyFiles: true }),
    );

    expect(await readAudioManifest()).toEqual(EMPTY_MANIFEST);
  });

  it('discards a manifest containing a row in an unknown state', async () => {
    await AsyncStorage.setItem(
      'noorlife.faith.quran.audio-manifest',
      JSON.stringify({
        version: AUDIO_MANIFEST_VERSION,
        rows: [{ ...row(1), state: 'probably-fine' }],
        migratedLegacyFiles: true,
      }),
    );

    expect(await readAudioManifest()).toEqual(EMPTY_MANIFEST);
  });
});

describe('finding a row', () => {
  const manifest = { ...EMPTY_MANIFEST, rows: [row(1), row(2)] };

  it('matches on reciter, surah and ayah together', () => {
    expect(findRow(manifest, '3', 93, 1)?.ayah).toBe(1);
    expect(findRow(manifest, '3', 93, 9)).toBeNull();
    expect(findRow(manifest, '3', 1, 1)).toBeNull();
  });

  it('never matches a file belonging to another reciter', () => {
    /*
      Not a near miss to tolerate. A file for the right verse under a different reciter is a
      different recitation, and playing it substitutes one reciter for another silently.
    */
    expect(findRow(manifest, '2', 93, 1)).toBeNull();
  });

  it('keys identity by all three parts', () => {
    expect(manifestKey('3', 93, 1)).toBe('3:93:1');
    expect(manifestKey('3', 93, 1)).not.toBe(manifestKey('2', 93, 1));
  });
});

describe('playability', () => {
  it('allows only a verified file, and one whose check is merely overdue', () => {
    expect(isPlayable(row(1, { state: 'available' }))).toBe(true);
    /*
      Overdue, not withheld. The licence expressly permits an offline device to keep permitted audio
      past the seven-day window and synchronise when it can, so this state says the check is owed —
      it does not take the recitation away from someone who is offline.
    */
    expect(isPlayable(row(1, { state: 'stale-check-due' }))).toBe(true);
  });

  it('refuses every state that is not a verified file', () => {
    for (const state of [
      'queued',
      'downloading',
      'paused',
      'downloaded',
      'verifying',
      'updating',
      'removal-required',
      'failed',
      'removing',
    ] as const) {
      expect(isPlayable(row(1, { state }))).toBe(false);
    }
    expect(isPlayable(null)).toBe(false);
  });

  it('refuses bytes that arrived but were never checked', () => {
    /*
      `downloaded` and `available` are deliberately distinct. Bytes having arrived is not the same as
      bytes having been validated, and collapsing the two is how an unverified file reaches a player.
    */
    expect(isPlayable(row(1, { state: 'downloaded' }))).toBe(false);
  });
});

describe('editing the manifest', () => {
  it('inserts and replaces by identity, in order', () => {
    const first = upsertRows(EMPTY_MANIFEST, [row(11), row(2)]);
    expect(first.rows.map((entry) => entry.ayah)).toEqual([2, 11]);

    const second = upsertRows(first, [row(2, { state: 'removal-required' })]);
    expect(second.rows).toHaveLength(2);
    expect(findRow(second, '3', 93, 2)?.state).toBe('removal-required');
  });

  it('removes by identity and leaves everything else', () => {
    const manifest = upsertRows(EMPTY_MANIFEST, [row(1), row(2), row(3)]);
    const next = removeRows(manifest, [{ reciterId: '3', surah: 93, ayah: 2 }]);

    expect(next.rows.map((entry) => entry.ayah)).toEqual([1, 3]);
  });

  it('lists one surah of one reciter', () => {
    const manifest = upsertRows(EMPTY_MANIFEST, [
      row(1),
      row(1, { reciterId: '2', fileName: 'r2-s93-a1.mp3' }),
      row(1, { surah: 1, fileName: 'r3-s1-a1.mp3' }),
    ]);

    expect(rowsForSurah(manifest, '3', 93)).toHaveLength(1);
    expect(rowsForSurah(manifest, '3', 1)).toHaveLength(1);
    expect(rowsForSurah(manifest, '9', 93)).toEqual([]);
  });
});

describe('migrating off filename probing', () => {
  it('writes a row for every file whose identity the vendor corroborates', () => {
    const plan = planLegacyMigration({
      fileNames: ['r3-s93-a1.mp3', 'r3-s93-a2.mp3'],
      parse: parseAudioFileName,
      bytesFor: () => 30_000,
      knownRows: [known(1), known(2)],
      at: NOW,
    });

    expect(plan.unprovable).toEqual([]);
    expect(plan.rows.map((entry) => entry.ayah)).toEqual([1, 2]);
    expect(plan.rows[0]?.recordKey).toBe('93:1');
  });

  it('promotes nothing to available — the bytes still have to be verified', () => {
    const plan = planLegacyMigration({
      fileNames: ['r3-s93-a1.mp3'],
      parse: parseAudioFileName,
      bytesFor: () => 30_000,
      knownRows: [known(1)],
      at: NOW,
    });

    /*
      Identity being proved is not the bytes being valid. A migrated file goes through verification
      like any other rather than being trusted on the strength of having existed before.
    */
    expect(plan.rows[0]?.state).toBe('downloaded');
    expect(isPlayable(plan.rows[0] ?? null)).toBe(false);
  });

  it('invents no integrity value it was never given', () => {
    const plan = planLegacyMigration({
      fileNames: ['r3-s93-a1.mp3'],
      parse: parseAudioFileName,
      bytesFor: () => 30_000,
      knownRows: [known(1)],
      at: NOW,
    });

    expect(plan.rows[0]?.integrity).toBeNull();
    expect(plan.rows[0]?.downloadedAt).toBeNull();
  });

  it('quarantines a file nothing corroborates', () => {
    const plan = planLegacyMigration({
      fileNames: ['r3-s93-a1.mp3', 'r3-s93-a99.mp3'],
      parse: parseAudioFileName,
      bytesFor: () => 30_000,
      knownRows: [known(1)],
      at: NOW,
    });

    /*
      The name says ayah 99 and nothing agrees with it. A name is not evidence, so the file is
      quarantined and the surah can be downloaded again against real identity.
    */
    expect(plan.unprovable).toEqual(['r3-s93-a99.mp3']);
    expect(plan.rows.map((entry) => entry.ayah)).toEqual([1]);
  });

  it('quarantines a file for a reciter with no synchronised rows', () => {
    const plan = planLegacyMigration({
      fileNames: ['r1-s93-a1.mp3'],
      parse: parseAudioFileName,
      bytesFor: () => 30_000,
      knownRows: [known(1)],
      at: NOW,
    });

    /* Resource 1 is not resource 3, and NoorLife holds a retention permission for one of them. */
    expect(plan.unprovable).toEqual(['r1-s93-a1.mp3']);
    expect(plan.rows).toEqual([]);
  });

  it('quarantines an unreadable name and a zero-length file', () => {
    const plan = planLegacyMigration({
      fileNames: ['nonsense.mp3', 'r3-s93-a1.mp3.part', 'r3-s93-a2.mp3'],
      parse: parseAudioFileName,
      bytesFor: (name) => (name === 'r3-s93-a2.mp3' ? 0 : 30_000),
      knownRows: [known(1), known(2)],
      at: NOW,
    });

    /* A partial left by a killed process has no identity worth recovering, and neither has an empty file. */
    expect([...plan.unprovable].sort()).toEqual(
      ['nonsense.mp3', 'r3-s93-a1.mp3.part', 'r3-s93-a2.mp3'].sort(),
    );
    expect(plan.rows).toEqual([]);
  });

  it('records when each migrated row last agreed with the vendor', () => {
    const plan = planLegacyMigration({
      fileNames: ['r3-s93-a1.mp3'],
      parse: parseAudioFileName,
      bytesFor: () => 30_000,
      knownRows: [known(1)],
      at: NOW,
    });

    expect(plan.rows[0]?.lastSyncedAt).toBe(NOW);
    expect(plan.rows[0]?.sequence).toBe(1);
  });
});
