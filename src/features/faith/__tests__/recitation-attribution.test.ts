import fs from 'node:fs';
import path from 'node:path';

import {
  attributionForReciter,
  SUDAIS_ATTRIBUTION,
  SUDAIS_RESOURCE_ID,
} from '../data/quran-foundation/recitation-attribution';

/**
 * The attribution Quran Foundation requires is exact, and it applies to resource 3 alone.
 *
 * ── Why a byte-for-byte assertion ───────────────────────────────────────────
 * The permission stipulates the wording, not the gist. A licence condition that reads correctly but
 * has lost a full stop, gained an accent, or been shortened to fit a row is not met — and every one of
 * those is a plausible edit that no ordinary test would notice, because the string would still look
 * right in a screenshot. This asserts the characters.
 *
 * ── Why the scope matters as much as the wording ────────────────────────────
 * The grant covers **Abdur-Rahman as-Sudais, resource ID 3** and nothing else. Every other reciter is
 * used under the ordinary Developer Terms. The failure mode is generalisation: somebody adds a second
 * reciter's credit, the lookup becomes a map, and NoorLife is implicitly claiming a bespoke permission
 * it does not hold for recordings it does not have one for. The cases below hold that line from both
 * sides — the right answer for 3, and `null` for everything else including ids that do not exist.
 *
 * See `docs/QURAN_FOUNDATION_AUDIO_PERMISSION.md` for the compliance record.
 */

describe('the required attribution', () => {
  it('is the exact wording granted, character for character', () => {
    expect(SUDAIS_ATTRIBUTION).toBe(
      'Recitation by Abdur-Rahman as-Sudais. Audio provided by Quran Foundation (Quran.com).',
    );
  });

  it('keeps the punctuation the permission specifies', () => {
    // Each clause is a sentence, and the second ends in a full stop after the closing parenthesis.
    expect(SUDAIS_ATTRIBUTION.endsWith('(Quran.com).')).toBe(true);
    expect(SUDAIS_ATTRIBUTION.split('. ')).toHaveLength(2);
    // "Quran" unaccented in both places, as written in the grant.
    expect(SUDAIS_ATTRIBUTION).not.toMatch(/Qur['’]an|Qurʾan/);
  });

  it('names the reciter as the permission spells it', () => {
    expect(SUDAIS_ATTRIBUTION).toContain('Abdur-Rahman as-Sudais');
    expect(SUDAIS_ATTRIBUTION).toContain('Quran Foundation');
  });
});

describe('the permission applies to resource 3 only', () => {
  it('is resource id 3', () => {
    expect(SUDAIS_RESOURCE_ID).toBe('3');
  });

  it('returns the attribution for resource 3', () => {
    expect(attributionForReciter('3')).toBe(SUDAIS_ATTRIBUTION);
  });

  it.each(['1', '2', '4', '5', '7', '10', '12', '161', '', 'sudais', '03', ' 3'])(
    'returns null for reciter "%s"',
    (id) => {
      expect(attributionForReciter(id)).toBeNull();
    },
  );

  it('does not extend to any other reciter by string coincidence', () => {
    // `'03'` and `' 3'` above are the near-misses that a loose comparison would let through. Exact
    // equality is what keeps a padded or trimmed id from inheriting the grant.
    for (let id = 0; id <= 250; id += 1) {
      const answer = attributionForReciter(String(id));
      expect(answer === null || id === 3).toBe(true);
    }
  });
});

describe('the wording exists in exactly one place', () => {
  /**
   * A second copy of the sentence is the failure this guards.
   *
   * Two literals drift: one gets edited for a layout, the other does not, and the app displays two
   * different "exact" attributions. The screens must reach for the constant.
   *
   * Comments are stripped first, so the prose in this file and in the attribution module — both of
   * which necessarily quote the sentence — are not what fails the scan.
   */
  it('is not duplicated as a literal anywhere in src/', () => {
    const OWNER = 'src/features/faith/data/quran-foundation/recitation-attribution.ts';
    const root = path.join(process.cwd(), 'src');

    const files = (function walk(dir: string): readonly string[] {
      return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          return entry.name === '__tests__' ? [] : walk(full);
        }
        return entry.name.endsWith('.ts') || entry.name.endsWith('.tsx') ? [full] : [];
      });
    })(root);

    const offenders = files
      .map((file) => path.relative(process.cwd(), file).replace(/\\/g, '/'))
      .filter((file) => file !== OWNER)
      .filter((file) => {
        const source = fs
          .readFileSync(path.join(process.cwd(), file), 'utf8')
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/^\s*\/\/.*$/gm, '');
        return source.includes('Audio provided by Quran Foundation');
      });

    expect(offenders).toEqual([]);
  });
});
