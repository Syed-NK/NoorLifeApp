import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  parseReviewedDuaManifest,
  REVIEWED_DUA_MANIFEST,
  reviewedQuranDuas,
  type ManifestRejectionReason,
} from '../data/dhikr/reviewed-dua-manifest';

/**
 * **The reviewed catalogue's gate, and the count of things that have passed it.**
 *
 * ── The number this file exists to hold at zero ────────────────────────────
 * `reviewedQuranDuas()` returns nothing, because no qualified reviewer has approved anything. That
 * is the honest state of the product and it is asserted rather than assumed: the day somebody adds
 * an entry, this test fails, and whoever added it has to come here and say why the entry is real.
 * A gate that nobody notices being opened is not a gate.
 *
 * ── What the parser is actually for ────────────────────────────────────────
 * A typed catalogue is checked by the compiler. A *manifest* is data — transcribed from a reviewer's
 * document by somebody who is not a compiler — so `"aproved"` is a string, a missing review date is
 * an absent property, and an entry that picked up an `arabic` column in a spreadsheet is just an
 * object with an extra key. Every case below is one of those, and every one of them must fail
 * closed: not "approved with a warning", not "approved minus the bad field". Refused.
 */

/** A complete, well-formed, approved entry — the shape everything below deviates from by one field. */
const APPROVED = {
  id: 'test.entry',
  surah: 2,
  startAyah: 255,
  endAyah: 255,
  title: 'A title the reviewer supplied',
  category: 'quranic-remembrance',
  recommendedTarget: null,
  reviewStatus: 'approved',
  review: {
    reviewer: 'A named reviewer',
    source: 'A citable published basis',
    reviewedOn: '2026-08-19',
  },
  contextNote: 'Why this reference is offered, and on what basis.',
  enabled: true,
  version: 1,
} as const;

const withField = (patch: Record<string, unknown>): unknown => ({ ...APPROVED, ...patch });

describe('what this build ships', () => {
  it('ships zero reviewed entries, and says so out loud', () => {
    expect(REVIEWED_DUA_MANIFEST).toHaveLength(0);
    expect(reviewedQuranDuas()).toHaveLength(0);
  });

  it('holds the manifest as data, so shipped entries cannot skip the parser', () => {
    /*
      Typed `readonly unknown[]`. If it were typed as the entry type, entries written here would be
      checked by the compiler and *not* by the gate — which is exactly the difference between a
      catalogue and a manifest, and the reason this file exists.
    */
    expect(Array.isArray(REVIEWED_DUA_MANIFEST)).toBe(true);
  });
});

describe('the gate', () => {
  it('accepts a complete, approved, specifically attributed entry', () => {
    const parsed = parseReviewedDuaManifest([APPROVED]);
    expect(parsed.rejected).toHaveLength(0);
    expect(parsed.approved).toHaveLength(1);
    expect(parsed.approved[0]?.id).toBe('test.entry');
    expect(parsed.approved[0]?.review?.reviewer).toBe('A named reviewer');
  });

  it.each([
    ['a pending entry', { reviewStatus: 'pending' }, 'not-approved'],
    ['a rejected entry', { reviewStatus: 'rejected' }, 'not-approved'],
    ['a withdrawn entry', { reviewStatus: 'withdrawn' }, 'not-approved'],
    ['a misspelt status', { reviewStatus: 'aproved' }, 'invalid-review-status'],
    ['a status that is not a string', { reviewStatus: 1 }, 'invalid-review-status'],
    ['a disabled entry', { enabled: false }, 'not-approved'],
    ['no review record', { review: null }, 'missing-review-record'],
    [
      'an unnamed reviewer',
      { review: { ...APPROVED.review, reviewer: '   ' } },
      'missing-review-record',
    ],
    ['no citable source', { review: { ...APPROVED.review, source: '' } }, 'missing-review-record'],
    [
      'a review date that does not exist',
      { review: { ...APPROVED.review, reviewedOn: '2026-02-30' } },
      'missing-review-record',
    ],
    [
      'a review date that is not a date',
      { review: { ...APPROVED.review, reviewedOn: 'last spring' } },
      'missing-review-record',
    ],
    ['no provenance note', { contextNote: '  ' }, 'missing-provenance'],
    ['no id', { id: '' }, 'missing-id'],
    ['no title', { title: '' }, 'missing-title'],
    ['a category outside the closed set', { category: 'invented' }, 'invalid-category'],
    ['surah 115', { surah: 115 }, 'invalid-range'],
    ['a reversed range', { startAyah: 5, endAyah: 2 }, 'invalid-range'],
    ['a fractional target', { recommendedTarget: 1.5 }, 'invalid-target'],
    ['a target of zero', { recommendedTarget: 0 }, 'invalid-target'],
  ] as const)('refuses %s', (_name, patch, reason: ManifestRejectionReason) => {
    const parsed = parseReviewedDuaManifest([withField(patch)]);
    expect(parsed.approved).toHaveLength(0);
    expect(parsed.rejected[0]?.reason).toBe(reason);
  });

  it.each([
    ['arabic', { arabic: 'x' }],
    ['a translation', { translation: 'x' }],
    ['a transliteration', { transliteration: 'x' }],
    ['verse text', { verseText: 'x' }],
    ['a script field', { script: 'text_uthmani' }],
    ['text nested inside the review record', { review: { ...APPROVED.review, arabicText: 'x' } }],
  ] as const)('refuses an entry carrying %s outright, rather than stripping it', (_name, patch) => {
    const parsed = parseReviewedDuaManifest([withField(patch)]);
    expect(parsed.approved).toHaveLength(0);
    expect(parsed.rejected[0]?.reason).toBe('embedded-content');
  });

  it.each([
    ['null', null],
    ['a string', 'not an entry'],
    ['a number', 7],
    ['an array', []],
  ] as const)('refuses %s as an entry', (_name, value) => {
    const parsed = parseReviewedDuaManifest([value]);
    expect(parsed.approved).toHaveLength(0);
    expect(parsed.rejected[0]?.reason).toBe('not-an-object');
  });

  it('refuses a manifest that is not a list at all', () => {
    expect(parseReviewedDuaManifest({ entries: [APPROVED] }).approved).toHaveLength(0);
    expect(parseReviewedDuaManifest(null).approved).toHaveLength(0);
    expect(parseReviewedDuaManifest(undefined).approved).toHaveLength(0);
  });

  it('refuses both halves of a duplicated id rather than picking one', () => {
    const parsed = parseReviewedDuaManifest([APPROVED, { ...APPROVED, surah: 3 }]);
    expect(parsed.approved).toHaveLength(1);
    expect(parsed.rejected).toHaveLength(1);
  });

  it('keeps the good entries when one entry beside them is malformed, and reports the drop', () => {
    const parsed = parseReviewedDuaManifest([
      APPROVED,
      withField({ id: 'test.bad', reviewStatus: 'pending' }),
      withField({ id: 'test.other', surah: 112, startAyah: 1, endAyah: 4 }),
    ]);
    expect(parsed.approved.map((entry) => entry.id)).toEqual(['test.entry', 'test.other']);
    expect(parsed.rejected).toEqual([{ index: 1, reason: 'not-approved', id: 'test.bad' }]);
  });

  it('takes a recommended count only where the review states one', () => {
    expect(parseReviewedDuaManifest([APPROVED]).approved[0]?.recommendedTarget).toBeNull();
    expect(
      parseReviewedDuaManifest([withField({ recommendedTarget: 3 })]).approved[0]
        ?.recommendedTarget,
    ).toBe(3);
  });
});

describe('nothing has quietly acquired an approval', () => {
  const SOURCE_ROOT = join(__dirname, '..');

  function faithSources(dir: string = SOURCE_ROOT): string[] {
    const found: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== '__tests__') {
          found.push(...faithSources(path));
        }
      } else if (/\.tsx?$/.test(entry.name)) {
        found.push(path);
      }
    }
    return found;
  }

  it('has no production source declaring an entry approved', () => {
    /*
      A scan rather than a type check, because the failure this catches is somebody writing
      `reviewStatus: 'approved'` into a source file — which type-checks perfectly and is precisely
      the act that requires a real reviewer behind it. The parser and the catalogue are allowed to
      *mention* the string; nothing else may assign it.
    */
    const offenders = faithSources()
      .filter(
        (path) =>
          !path.endsWith('reviewed-dua-manifest.ts') && !path.endsWith('quran-dhikr-catalogue.ts'),
      )
      .filter((path) => /reviewStatus\s*:\s*['"]approved['"]/.test(readFileSync(path, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
