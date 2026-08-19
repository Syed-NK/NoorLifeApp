import {
  ARABIC_SCRIPT,
  type ArabicRow,
  expectedVerseKeys,
  isExactlyPreserved,
  MAX_SURAH,
  TOTAL_AYAH_COUNT,
  validateArabicDataset,
} from '@features/faith/storage/faith-arabic-rows';

/**
 * Completeness and exactness, which are the two things the Arabic permission actually requires.
 *
 * The grant permits retaining the **complete, unmodified** Arabic text. A dataset that is nearly
 * complete is not a lesser version of a licensed artefact — it is an unlicensed one, and a reader
 * built on it would silently omit verses. So the validator has no partial-success path, and these
 * cases exist to keep it that way.
 *
 * Ayah counts are supplied by the caller throughout. This repository does not author a table of 114
 * ayah counts: that is scholarly content, and inventing it is exactly the kind of reconstruction the
 * licence forbids.
 */

/** A small synthetic Qur'an shape: three surahs of 7, 3 and 4 ayat. */
const SMALL_COUNTS = [7, 3, 4] as const;
const SMALL_KEYS = expectedVerseKeys(SMALL_COUNTS);

function row(verseKey: string, text = `text-${verseKey}`): ArabicRow {
  const [surah, ayah] = verseKey.split(':');
  return {
    verseKey,
    surah: Number(surah),
    ayah: Number(ayah),
    text,
    script: ARABIC_SCRIPT,
  };
}

function completeSmallDataset(): ArabicRow[] {
  return SMALL_KEYS.map((key) => row(key));
}

describe('the expected key set', () => {
  it('is built from supplied ayah counts rather than an invented table', () => {
    expect(SMALL_KEYS).toHaveLength(14);
    expect(SMALL_KEYS[0]).toBe('1:1');
    expect(SMALL_KEYS[6]).toBe('1:7');
    expect(SMALL_KEYS[7]).toBe('2:1');
    expect(SMALL_KEYS.at(-1)).toBe('3:4');
  });

  it('states the complete ayah count of the Qur’an as a named constant', () => {
    expect(TOTAL_AYAH_COUNT).toBe(6236);
    expect(MAX_SURAH).toBe(114);
  });
});

describe('completeness', () => {
  it('accepts exactly the expected rows, once each', () => {
    const result = validateArabicDataset(completeSmallDataset(), SMALL_KEYS);
    expect(result.ok).toBe(true);
    expect(result.ok && result.rows).toHaveLength(SMALL_KEYS.length);
  });

  it('refuses a dataset one row short', () => {
    const rows = completeSmallDataset().slice(0, -1);
    const result = validateArabicDataset(rows, SMALL_KEYS);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.failure.kind).toBe('wrong-row-count');
  });

  it('refuses a dataset with an extra row', () => {
    const rows = [...completeSmallDataset(), row('3:5')];
    const result = validateArabicDataset(rows, SMALL_KEYS);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.failure.kind).toBe('wrong-row-count');
  });

  it('names the missing verse when the count is right but a key is absent', () => {
    /* Right length, wrong membership: a duplicate standing in for a missing verse. */
    const rows = completeSmallDataset();
    rows[5] = row('1:1');
    const result = validateArabicDataset(rows, SMALL_KEYS);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.failure.kind).toBe('duplicate-verse-key');
  });

  it('names a missing verse key when no duplicate masks it', () => {
    const keys = [...SMALL_KEYS];
    const rows = completeSmallDataset().filter((r) => r.verseKey !== '2:2');
    rows.push(row('3:5'));
    const result = validateArabicDataset(rows, keys);
    expect(result.ok).toBe(false);
    /* 3:5 is outside the expected set, so the absent 2:2 is what the caller must be told about. */
    expect(!result.ok && result.failure.kind).toBe('missing-verse-key');
    expect(
      !result.ok && result.failure.kind === 'missing-verse-key' && result.failure.verseKey,
    ).toBe('2:2');
  });
});

describe('malformed and out-of-range rows', () => {
  it.each([
    ['not an object', null],
    ['a bare string', 'verse'],
    ['a missing verseKey', { surah: 1, ayah: 1, text: 'x', script: ARABIC_SCRIPT }],
    [
      'a non-canonical verseKey',
      { verseKey: '01:1', surah: 1, ayah: 1, text: 'x', script: ARABIC_SCRIPT },
    ],
    [
      'a separator that is not a colon',
      { verseKey: '1-1', surah: 1, ayah: 1, text: 'x', script: ARABIC_SCRIPT },
    ],
    ['a zero ayah', { verseKey: '1:0', surah: 1, ayah: 0, text: 'x', script: ARABIC_SCRIPT }],
    ['empty text', { verseKey: '1:1', surah: 1, ayah: 1, text: '', script: ARABIC_SCRIPT }],
    [
      'a non-integer surah',
      { verseKey: '1:1', surah: 1.5, ayah: 1, text: 'x', script: ARABIC_SCRIPT },
    ],
  ])('refuses %s', (_label, bad) => {
    const rows: unknown[] = completeSmallDataset();
    rows[0] = bad;
    const result = validateArabicDataset(rows, SMALL_KEYS);
    expect(result.ok).toBe(false);
  });

  it('refuses a verse key outside the canonical surah range', () => {
    const keys = expectedVerseKeys([1]);
    const result = validateArabicDataset([row('115:1')], keys);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.failure.kind).toBe('verse-key-out-of-range');
  });

  it('refuses a row whose key and numeric fields disagree', () => {
    const rows = completeSmallDataset();
    rows[0] = { ...rows[0]!, surah: 3 };
    const result = validateArabicDataset(rows, SMALL_KEYS);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.failure.kind).toBe('verse-key-mismatch');
  });

  it('refuses a row in a script other than the pinned one', () => {
    const rows: unknown[] = completeSmallDataset();
    rows[0] = { ...(rows[0] as ArabicRow), script: 'text_indopak' };
    const result = validateArabicDataset(rows, SMALL_KEYS);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.failure.kind).toBe('wrong-script');
  });
});

describe('exact preservation', () => {
  /**
   * Arabic that would be changed by every transformation an engineer might reach for: combining
   * marks that NFC would reorder, a tatweel that a "cleaner" would strip, and surrounding whitespace
   * that a trim would remove.
   */
  const AWKWARD = ' بِـسْمِ ٱللَّهِ ';

  it('returns the publisher text byte for byte', () => {
    const keys = expectedVerseKeys([1]);
    const result = validateArabicDataset([row('1:1', AWKWARD)], keys);
    expect(result.ok).toBe(true);
    const stored = result.ok ? result.rows[0]!.text : '';
    expect(stored).toBe(AWKWARD);
    expect(isExactlyPreserved(AWKWARD, stored)).toBe(true);
  });

  it('does not trim, normalise or strip diacritics', () => {
    const keys = expectedVerseKeys([1]);
    const result = validateArabicDataset([row('1:1', AWKWARD)], keys);
    const stored = result.ok ? result.rows[0]!.text : '';

    expect(stored).not.toBe(AWKWARD.trim());
    expect(stored).not.toBe(AWKWARD.normalize('NFC'));
    expect(stored).not.toBe(AWKWARD.normalize('NFD'));
    expect(stored).toContain('ـ');
    expect(stored.startsWith(' ')).toBe(true);
    expect(stored.endsWith(' ')).toBe(true);
  });

  it('rejects rather than repairs, so no failure path can silently transform', () => {
    /* A validator that "fixed" a mismatch would be applying a transformation under another name. */
    const rows = completeSmallDataset();
    rows[0] = { ...rows[0]!, ayah: 2 };
    const result = validateArabicDataset(rows, SMALL_KEYS);
    expect(result.ok).toBe(false);
  });
});

describe('the module authors no scripture', () => {
  it('contains no Arabic literal and no ayah-count table', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('node:fs') as typeof import('node:fs');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require('node:path') as typeof import('node:path');
    const source = fs.readFileSync(
      path.join(process.cwd(), 'src/features/faith/storage/faith-arabic-rows.ts'),
      'utf8',
    );
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

    /* No Arabic-range codepoints in executable source: no fallback verse, no reconstructed Bismillah. */
    expect(/[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/.test(code)).toBe(false);
    /* No embedded table of per-surah ayah counts. */
    expect(/\[\s*7\s*,\s*286\s*,/.test(code)).toBe(false);
  });
});
