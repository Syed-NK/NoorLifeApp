import { Directory, File, Paths } from 'expo-file-system';

import AsyncStorage from '@react-native-async-storage/async-storage';

import { faithStorageKeys } from '@features/faith/storage/faith-storage';
import {
  GENERATION_SCHEMA_VERSION,
  type GenerationDraft,
  openGeneration,
  publishGeneration,
  readActiveGeneration,
  READABLE_SCHEMA_VERSIONS,
} from '@features/faith/storage/faith-sync-generation';
import { ARABIC_SCRIPT, type ArabicRow } from '@features/faith/storage/faith-arabic-rows';

import { mockFileSystem } from '@/../jest.setup';

/**
 * The backup boundary is controlled here rather than left to the platform.
 *
 * Under Jest `Platform.OS` is `ios` and no native module is built, so the real boundary answers
 * `unavailable` and — correctly — drops Arabic from every publication. That is the fail-closed
 * behaviour, and it is asserted explicitly in its own case below; for the rest of this file it would
 * simply mean nothing under test ever holds Arabic.
 */
let mockExclusionOutcome: 'excluded' | 'not-required' | 'unavailable' | 'failed' = 'excluded';

jest.mock('@features/faith/storage/faith-backup-exclusion', () => ({
  ensureExcludedFromBackup: () => mockExclusionOutcome,
  isExcludedFromBackup: () => mockExclusionOutcome === 'excluded',
  isBackupSafe: (outcome: string) => outcome === 'excluded' || outcome === 'not-required',
}));

/**
 * Arabic inside the immutable generation — schema v2, and what v1 still means.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── The two properties these cases exist to hold ───────────────────────────
 * **Atomicity.** Arabic publishes with the other datasets or not at all. A generation is reached
 * through one pointer write, so there is no instant at which a reader can see the new Arabic beside
 * the old translations, and a failure anywhere before that write leaves the previous generation
 * active and whole. A half-updated Qur'an is the one outcome that must be impossible.
 *
 * **Honest absence.** A v1 generation predates the Arabic permission and carries no Arabic. That is
 * a valid generation, not a broken one — refusing it would discard a good translation and recitation
 * index and force a re-download to arrive at the same bytes. It reads back with `arabic: null`, and
 * the reader's obligation is to say Arabic is unavailable rather than substitute anything.
 *
 * The distinction that matters: **absent** Arabic is `null`; **claimed but unreadable** Arabic fails
 * the whole generation. A manifest that says it has 6,236 verses and cannot produce them is corrupt,
 * and corruption is refused rather than downgraded to absence.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const NOW = 1_700_000_000_000;
const GEN_ROOT = 'file:///documents/quran-sync';

function arabicRows(count: number): ArabicRow[] {
  return Array.from({ length: count }, (_, index) => ({
    verseKey: `1:${index + 1}`,
    surah: 1,
    ayah: index + 1,
    text: `verse-${index + 1}`,
    script: ARABIC_SCRIPT,
  }));
}

function draft(over: Partial<GenerationDraft> = {}): GenerationDraft {
  return {
    generationId: 'gen-a',
    createdAt: NOW,
    feed: {
      resources: 'recitations:3;translations:85',
      syncToken: 'tok_a',
      syncedUntilSequence: 1,
    },
    translations: {
      resourceId: 85,
      attribution: { resourceId: 85, name: 'The Clear Quran', translator: 'Dr. Mustafa Khattab' },
      rows: [
        {
          verseKey: '1:1',
          surah: 1,
          ayah: 1,
          text: 'In the Name of Allah',
          resourceId: 85,
          sequence: 1,
          refreshedAt: NOW,
        },
      ],
    },
    recitations: {
      resourceId: 3,
      rows: [
        {
          verseKey: '1:1',
          resourceId: 3,
          surah: 1,
          ayah: 1,
          durationSeconds: null,
          bytes: null,
          sequence: 1,
          refreshedAt: NOW,
        },
      ],
    },
    recitation: { lastCheckedAt: NOW, method: 'snapshot', mutationEverObserved: false },
    ...over,
  };
}

function withArabic(rows: ArabicRow[], lastCheckedAt = NOW): GenerationDraft {
  return draft({ arabic: { script: ARABIC_SCRIPT, rows, lastCheckedAt } });
}

beforeEach(async () => {
  mockFileSystem.reset();
  await AsyncStorage.clear();
  mockExclusionOutcome = 'excluded';
});

describe('schema versions', () => {
  it('publishes at version 2 and still reads version 1', () => {
    expect(GENERATION_SCHEMA_VERSION).toBe(2);
    expect(READABLE_SCHEMA_VERSIONS).toEqual([1, 2]);
  });
});

describe('publishing Arabic', () => {
  it('publishes Arabic alongside the other datasets through one pointer write', async () => {
    const outcome = await publishGeneration(withArabic(arabicRows(7)));
    expect(outcome.kind).toBe('published');

    const active = await readActiveGeneration();
    expect(active?.arabic?.rows).toHaveLength(7);
    expect(active?.arabic?.script).toBe(ARABIC_SCRIPT);
    expect(active?.arabic?.lastCheckedAt).toBe(NOW);
    /* And the other datasets came with it, from the same directory. */
    expect(active?.translations.rows).toHaveLength(1);
    expect(active?.recitations.rows).toHaveLength(1);

    /*
      One pointer write, not three. Every dataset became visible because this single key changed, so
      there is no window in which a reader could see new Arabic beside old translations.
    */
    const keys = await AsyncStorage.getAllKeys();
    expect(keys).toEqual([faithStorageKeys.quranGenerationPointer]);
    expect(await AsyncStorage.getItem(faithStorageKeys.quranGenerationPointer)).toContain('gen-a');
  });

  it('records the Arabic check clock inside the generation and nowhere else', async () => {
    await publishGeneration(withArabic(arabicRows(3), NOW - 1000));
    const active = await readActiveGeneration();
    expect(active?.manifest.arabic?.lastCheckedAt).toBe(NOW - 1000);

    /* No competing standalone Arabic clock may appear in key-value storage. */
    const keys = await AsyncStorage.getAllKeys();
    expect(keys.filter((key) => /arabic/i.test(key))).toEqual([]);
  });

  it('preserves Arabic text byte for byte through publish and reopen', async () => {
    /*
      Chosen so every transformation this test rules out would actually change it: the alef-hamza and
      alef-madda decompose under NFD, the ligature is rewritten by NFKC, the tatweel is what a
      "cleaner" strips, and the surrounding spaces are what a trim removes. A fixture invariant under
      a transformation would let that transformation pass unnoticed.
    */
    const awkward = ' أٓ آ ـ ﻻ ';
    const rows: ArabicRow[] = [
      { verseKey: '1:1', surah: 1, ayah: 1, text: awkward, script: ARABIC_SCRIPT },
    ];
    await publishGeneration(withArabic(rows));

    const active = await readActiveGeneration();
    const stored = active?.arabic?.rows[0]?.text ?? '';
    expect(stored).toBe(awkward);
    expect(stored).not.toBe(awkward.trim());
    expect(stored).not.toBe(awkward.normalize('NFD'));
    expect(stored).not.toBe(awkward.normalize('NFKC'));
    expect(stored).toContain('ـ');
  });
});

describe('a generation without Arabic', () => {
  it('publishes and reads back as arabic: null rather than failing', async () => {
    const outcome = await publishGeneration(draft());
    expect(outcome.kind).toBe('published');

    const active = await readActiveGeneration();
    expect(active).not.toBeNull();
    expect(active?.arabic).toBeNull();
    /* The rest of the generation is fully usable — this is the migration case, not a broken one. */
    expect(active?.translations.rows).toHaveLength(1);
  });

  it('stages no Arabic file at all, rather than an empty one', async () => {
    await publishGeneration(draft());
    const file = new File(`${GEN_ROOT}/gen-a/arabic.json`);
    expect(file.exists).toBe(false);
  });

  it('opens a hand-written v1 manifest, reporting Arabic as unavailable', async () => {
    /* A generation produced by the previous build: schema 1, no arabic key present at all. */
    await publishGeneration(draft());
    const manifestFile = new File(`${GEN_ROOT}/gen-a/generation.json`);
    const manifest = JSON.parse(manifestFile.textSync()) as Record<string, unknown>;
    delete manifest.arabic;
    manifest.schemaVersion = 1;
    manifestFile.write(JSON.stringify(manifest));

    const opened = openGeneration('gen-a');
    expect(opened).not.toBeNull();
    expect(opened?.manifest.schemaVersion).toBe(1);
    expect(opened?.arabic).toBeNull();
    expect(opened?.translations.rows).toHaveLength(1);
  });
});

describe('a generation that claims Arabic it cannot produce', () => {
  it('is refused when the Arabic file is missing', async () => {
    await publishGeneration(withArabic(arabicRows(4)));
    new File(`${GEN_ROOT}/gen-a/arabic.json`).delete();

    /* Claimed-but-unreadable is corruption, not absence. The whole generation is refused. */
    expect(openGeneration('gen-a')).toBeNull();
  });

  it('is refused when the Arabic file fails its checksum', async () => {
    await publishGeneration(withArabic(arabicRows(4)));
    const file = new File(`${GEN_ROOT}/gen-a/arabic.json`);
    const payload = JSON.parse(file.textSync()) as { script: string; rows: ArabicRow[] };
    payload.rows[0] = { ...payload.rows[0]!, text: 'tampered' };
    file.write(JSON.stringify(payload));

    expect(openGeneration('gen-a')).toBeNull();
  });

  it('is refused when a row is in a different script from the manifest', async () => {
    await publishGeneration(withArabic(arabicRows(2)));
    const manifestFile = new File(`${GEN_ROOT}/gen-a/generation.json`);
    const manifest = JSON.parse(manifestFile.textSync()) as {
      arabic: { script: string; checksum: string };
    };
    manifest.arabic.script = 'text_indopak';
    manifestFile.write(JSON.stringify(manifest));

    expect(openGeneration('gen-a')).toBeNull();
  });
});

describe('atomicity', () => {
  it('leaves the previous generation active when the Arabic write fails', async () => {
    await publishGeneration(withArabic(arabicRows(2)));
    const before = await readActiveGeneration();
    expect(before?.arabic?.rows).toHaveLength(2);

    mockFileSystem.failWritesTo(`${GEN_ROOT}/gen-b/arabic.json.part`);
    const outcome = await publishGeneration({
      ...withArabic(arabicRows(9)),
      generationId: 'gen-b',
      createdAt: NOW + 1,
    });
    expect(outcome.kind).toBe('failed');

    const after = await readActiveGeneration();
    expect(after?.manifest.generationId).toBe('gen-a');
    expect(after?.arabic?.rows).toHaveLength(2);
  });

  it('leaves the previous generation active when the run is cancelled before the pointer', async () => {
    await publishGeneration(withArabic(arabicRows(2)));

    const outcome = await publishGeneration(
      { ...withArabic(arabicRows(9)), generationId: 'gen-c', createdAt: NOW + 2 },
      { isValid: () => false },
    );
    expect(outcome.kind).toBe('failed');

    const after = await readActiveGeneration();
    expect(after?.manifest.generationId).toBe('gen-a');
    expect(after?.arabic?.rows).toHaveLength(2);
  });

  it('never exposes a generation whose Arabic is newer than its pointer', async () => {
    await publishGeneration(withArabic(arabicRows(2)));
    /* A fully staged but unpublished successor must be unreachable through the pointer. */
    new Directory(`${GEN_ROOT}/gen-d`).create();
    new File(`${GEN_ROOT}/gen-d/arabic.json`).write(
      JSON.stringify({ script: ARABIC_SCRIPT, rows: arabicRows(9) }),
    );

    const active = await readActiveGeneration();
    expect(active?.manifest.generationId).toBe('gen-a');
    expect(active?.arabic?.rows).toHaveLength(2);
  });
});

describe('failing closed when backup exclusion cannot be confirmed', () => {
  it.each(['unavailable', 'failed'] as const)(
    'drops Arabic from the publication when the boundary answers %s',
    async (outcome) => {
      mockExclusionOutcome = outcome;

      const result = await publishGeneration(withArabic(arabicRows(5)));
      expect(result.kind).toBe('published');
      expect(result.kind === 'published' && result.arabicRefusedForBackup).toBe(true);

      /*
        Retaining the Qur'an where it might be copied to iCloud is what the licence forbids, so the
        honest outcome is to hold no Arabic and let the reader say it is unavailable.
      */
      const active = await readActiveGeneration();
      expect(active?.arabic).toBeNull();
      expect(new File(`${GEN_ROOT}/gen-a/arabic.json`).exists).toBe(false);
    },
  );

  it('still publishes translations and recitations, which have their own terms', async () => {
    mockExclusionOutcome = 'unavailable';
    await publishGeneration(withArabic(arabicRows(5)));

    const active = await readActiveGeneration();
    expect(active?.translations.rows).toHaveLength(1);
    expect(active?.recitations.rows).toHaveLength(1);
  });

  it('publishes Arabic when Android reports the platform already excludes it', async () => {
    mockExclusionOutcome = 'not-required';
    const result = await publishGeneration(withArabic(arabicRows(5)));

    expect(result.kind === 'published' && result.arabicRefusedForBackup).toBe(false);
    const active = await readActiveGeneration();
    expect(active?.arabic?.rows).toHaveLength(5);
  });
});

describe('storage location', () => {
  it('keeps Arabic in the app-private document directory, not shared storage', async () => {
    await publishGeneration(withArabic(arabicRows(2)));
    const file = new File(`${GEN_ROOT}/gen-a/arabic.json`);
    expect(file.exists).toBe(true);
    expect(file.uri.startsWith(Paths.document.uri)).toBe(true);
  });
});
