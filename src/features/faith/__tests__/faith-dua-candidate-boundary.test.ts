import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { REVIEWED_DUA_MANIFEST } from '../data/dhikr/reviewed-dua-manifest';
import {
  UNPUBLISHABLE_CANDIDATE_STATUSES,
  candidateIsDisplayable,
  promoteCandidate,
  promoteCandidates,
  type DuaCandidate,
  type DuaCandidateStatus,
} from '../data/duas/dua-candidate';
import { reviewedDuas } from '../data/duas/reviewed-dua';

/**
 * **A proposal is not a publication**, and the distance between the two is what this file guards.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── The failure mode being designed against ────────────────────────────────
 * A review workflow makes candidate records exist. The moment one of those is importable from `src/`,
 * "somebody proposed this" and "the app shows this" are one edit apart — and the edit looks like
 * plumbing rather than like publishing religious content. Nobody reviews a one-line import.
 *
 * So the boundary is structural rather than procedural: candidate records live in `docs/`, which Metro
 * does not bundle and TypeScript does not resolve from the app. `src/` holds the *contract* — the
 * types, the promotion gate — and no data. The scans below assert exactly that, because it is the kind
 * of property a well-meaning refactor breaks while making everything tidier.
 *
 * ── Two gates in series, and the second does not trust the first ───────────
 * `promoteCandidate` produces `unknown`-shaped manifest data, not a `ReviewedDua`. Whatever it emits
 * still has to pass `parseReviewedDuas` — the same parser a manifest from any origin goes through. A
 * bug in the promotion cannot mint a publishable entry, because its output is not what screens read.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const DUAS_DIR = join(__dirname, '..', 'data', 'duas');
const SRC_ROOT = join(__dirname, '..', '..', '..');

/** A complete, promotable candidate. Every field synthetic; the reference is deliberately unreal. */
const approved = (over: Partial<DuaCandidate> = {}): DuaCandidate => ({
  id: 'test.candidate.001',
  status: 'approved',
  proposedTitle: 'A title the reviewer approved',
  proposedCategories: ['daily-remembrances'],
  sourceKind: 'quran',
  quranRange: { surah: 2, startAyah: 255, endAyah: 255 },
  hadithReference: null,
  provider: 'quran-foundation',
  proposedContext: 'The context the reviewer approved for display.',
  proposedRepetition: null,
  translationResourceId: 85,
  transliterationResourceId: null,
  review: {
    reviewer: 'A named reviewer',
    source: 'A citable published basis',
    decidedOn: '2026-08-20',
    recordId: 'review-record-0001',
    notes: null,
    repetitionBasis: null,
    popularRank: null,
  },
  fingerprint: null,
  version: 1,
  ...over,
});

describe('candidate data cannot reach the app', () => {
  it('ships no candidate array anywhere under src', () => {
    /*
      The contract module holds types and a gate. A candidate *record list* living beside them would be
      one import away from a screen, and an import is not a decision anybody reviews.

      Matched on the record type rather than on the word "candidate": `UNPUBLISHABLE_CANDIDATE_STATUSES`
      is a list of statuses and belongs here, and a name-based scan that flagged it would be a scan
      somebody disables rather than fixes.
    */
    for (const entry of readdirSync(DUAS_DIR)) {
      const source = readFileSync(join(DUAS_DIR, entry), 'utf8');
      const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      /* No array of candidate records, declared or exported, in any shape. */
      expect(code).not.toMatch(/DuaCandidate\s*\[\s*\]\s*=/);
      expect(code).not.toMatch(/:\s*readonly\s+DuaCandidate\s*\[\s*\]\s*=/);
      expect(code).not.toMatch(/Array<\s*DuaCandidate\s*>\s*=/);
      /*
        And no object literal carrying a proposal. `proposedTitle` is unique to a candidate record — a
        status string alone is not a usable marker, because to a regex a *type* annotation looks
        identical to a literal, and `DuaDetailReview.status: 'approved'` is a perfectly correct one.
      */
      expect(code).not.toMatch(/proposedTitle\s*:\s*['"`]/);
      expect(code).not.toMatch(/proposedCategories\s*:\s*\[/);
    }
  });

  it('has nothing under src importing a review document', () => {
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== '__tests__' && entry.name !== 'node_modules') {
            walk(path);
          }
        } else if (/\.tsx?$/.test(entry.name)) {
          const source = readFileSync(path, 'utf8');
          /* `docs/` is a review surface, not a module tree. Nothing in the app may resolve into it. */
          if (/from\s+['"][^'"]*docs\//.test(source) || /require\(['"][^'"]*docs\//.test(source)) {
            offenders.push(path);
          }
        }
      }
    };
    walk(SRC_ROOT);
    expect(offenders).toEqual([]);
  });

  it('answers that a candidate is displayable with a flat no, for every status', () => {
    /*
      Total by type — the signature returns `false`, not `boolean`. An `approved` candidate is not shown
      *as a candidate* either: it is promoted into the manifest and displayed from there, with the
      parser's guarantees attached.
    */
    const statuses: readonly DuaCandidateStatus[] = [
      'candidate',
      'needs-review',
      'approved',
      'rejected',
      'superseded',
    ];
    for (const status of statuses) {
      expect(candidateIsDisplayable()).toBe(false);
      expect(typeof status).toBe('string');
    }
  });

  it('still ships zero built-in Duas, which is the number this whole workflow starts from', () => {
    expect(REVIEWED_DUA_MANIFEST).toHaveLength(0);
    expect(reviewedDuas()).toHaveLength(0);
  });
});

describe('only a complete approval may be promoted', () => {
  it('promotes a complete approved candidate', () => {
    const outcome = promoteCandidate(approved());
    expect(outcome.ok).toBe(true);
  });

  it('refuses every status that is not approved', () => {
    for (const status of UNPUBLISHABLE_CANDIDATE_STATUSES) {
      const outcome = promoteCandidate(approved({ status }));
      expect(outcome).toEqual({ ok: false, refusal: 'not-approved' });
    }
    /* And the unpublishable set is the whole of the closed set except `approved`. */
    expect([...UNPUBLISHABLE_CANDIDATE_STATUSES].sort()).toEqual([
      'candidate',
      'needs-review',
      'rejected',
      'superseded',
    ]);
  });

  it('refuses an approval with no reviewer record at all', () => {
    expect(promoteCandidate(approved({ review: null }))).toEqual({
      ok: false,
      refusal: 'missing-review-record',
    });
  });

  it('refuses an approval whose record is missing any required field', () => {
    const base = approved().review;
    if (base === null) throw new Error('fixture');
    for (const patch of [
      { reviewer: '  ' },
      { source: '' },
      { recordId: '' },
      { decidedOn: 'August 2026' },
      { decidedOn: '' },
    ]) {
      const outcome = promoteCandidate(approved({ review: { ...base, ...patch } }));
      expect(outcome).toEqual({ ok: false, refusal: 'incomplete-review-record' });
    }
  });

  it('refuses a repetition count with no stated basis, and accepts one with', () => {
    const base = approved().review;
    if (base === null) throw new Error('fixture');

    expect(promoteCandidate(approved({ proposedRepetition: 33 }))).toEqual({
      ok: false,
      refusal: 'repetition-without-basis',
    });
    expect(
      promoteCandidate(
        approved({
          proposedRepetition: 33,
          review: { ...base, repetitionBasis: 'The basis the reviewer cited.' },
        }),
      ).ok,
    ).toBe(true);
  });

  it('refuses a malformed editorial rank', () => {
    const base = approved().review;
    if (base === null) throw new Error('fixture');
    for (const rank of [0, -1, 1.5]) {
      expect(promoteCandidate(approved({ review: { ...base, popularRank: rank } }))).toEqual({
        ok: false,
        refusal: 'invalid-popular-rank',
      });
    }
  });

  it('refuses a personal category, an unknown one, and none at all', () => {
    expect(promoteCandidate(approved({ proposedCategories: [] })).ok).toBe(false);
    expect(promoteCandidate(approved({ proposedCategories: ['favourites'] }))).toEqual({
      ok: false,
      refusal: 'personal-category',
    });
    expect(
      promoteCandidate(
        approved({ proposedCategories: ['bedtime' as unknown as 'daily-remembrances'] }),
      ),
    ).toEqual({ ok: false, refusal: 'unknown-category' });
  });

  it('refuses a mismatched source and reference, either way round', () => {
    expect(promoteCandidate(approved({ quranRange: null })).ok).toBe(false);
    expect(
      promoteCandidate(
        approved({ hadithReference: { collection: 'A Collection', reference: '1' } }),
      ),
    ).toEqual({ ok: false, refusal: 'source-reference-mismatch' });
  });

  it('refuses a Qur’an candidate from an unlicensed provider', () => {
    expect(promoteCandidate(approved({ provider: 'somewhere-else' }))).toEqual({
      ok: false,
      refusal: 'wrong-provider',
    });
  });

  it('refuses an id inside the user’s selection namespace', () => {
    expect(promoteCandidate(approved({ id: 'q.2.255.255' }))).toEqual({
      ok: false,
      refusal: 'reserved-id',
    });
  });

  it('reports every refusal alongside the rows, so a review pass can be triaged', () => {
    const result = promoteCandidates([
      approved({ id: 'test.a' }),
      approved({ id: 'test.b', status: 'rejected' }),
      approved({ id: 'test.c', status: 'needs-review' }),
    ]);
    expect(result.manifestRows).toHaveLength(1);
    expect(result.refused).toEqual([
      { id: 'test.b', refusal: 'not-approved' },
      { id: 'test.c', refusal: 'not-approved' },
    ]);
  });
});

describe('a promoted row is still only a proposal to the parser', () => {
  it('produces a row the production gate accepts', () => {
    const outcome = promoteCandidate(approved());
    if (!outcome.ok) throw new Error('fixture did not promote');

    /*
      The end-to-end property: an approval that survived promotion also survives the parser every screen
      reads through. If these two ever disagree, content a reviewer approved would silently not appear.
    */
    const parsed = reviewedDuas([outcome.manifestRow]);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.id).toBe('test.candidate.001');
    expect(parsed[0]?.review.recordId).toBe('review-record-0001');
    expect(parsed[0]?.categories).toEqual(['daily-remembrances']);
  });

  it('carries a reviewer’s rank and repetition through into the parsed entry', () => {
    const base = approved().review;
    if (base === null) throw new Error('fixture');
    const outcome = promoteCandidate(
      approved({
        proposedRepetition: 33,
        review: {
          ...base,
          popularRank: 2,
          repetitionBasis: 'The basis the reviewer cited.',
        },
      }),
    );
    if (!outcome.ok) throw new Error('fixture did not promote');

    const parsed = reviewedDuas([outcome.manifestRow]);
    expect(parsed[0]?.review.popularRank).toBe(2);
    expect(parsed[0]?.recommendedTarget).toBe(33);
  });

  it('emits manifest data rather than a domain object, so the parser cannot be skipped', () => {
    const source = readFileSync(join(DUAS_DIR, 'dua-candidate.ts'), 'utf8');
    /* Typed `unknown` deliberately: a `ReviewedDua` return would let a caller bypass the gate. */
    expect(source).toContain('readonly manifestRow: unknown;');
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/:\s*ReviewedDua\b/);
  });

  it('does not let the promotion gate write anywhere', () => {
    const source = readFileSync(join(DUAS_DIR, 'dua-candidate.ts'), 'utf8');
    /* Promotion is a pure transformation. It does not touch the manifest, storage or the filesystem. */
    expect(source).not.toMatch(/AsyncStorage|node:fs|writeFile|REVIEWED_DUA_MANIFEST\s*[.=]/);
  });
});

describe('the reviewer template exists and proposes nothing', () => {
  const TEMPLATE = join(
    __dirname,
    '..',
    '..',
    '..',
    '..',
    'docs',
    'DUA_SCHOLARLY_REVIEW_TEMPLATE.md',
  );

  it('is present', () => {
    expect(existsSync(TEMPLATE)).toBe(true);
  });

  it('asks for every decision the gate requires', () => {
    const doc = readFileSync(TEMPLATE, 'utf8');
    for (const asked of [
      'appropriate to present as a Dua',
      'Approved categories',
      'context',
      'Beginning and end',
      'meaning preserved',
      'Repetition guidance',
      'Popular designation',
      'Cautions',
      'Decision',
    ]) {
      expect(doc.toLowerCase()).toContain(asked.toLowerCase());
    }
  });

  it('contains no Arabic and no real candidate reference', () => {
    const doc = readFileSync(TEMPLATE, 'utf8');
    /*
      The template is a form, not a proposal. Putting real references in it would be NoorLife making the
      editorial choice the form exists to ask somebody else to make.
    */
    expect(doc).not.toMatch(/[؀-ۿ]/u);
    expect(doc).toContain('contains no candidate Duas');
    /* And it says plainly that a candidate list is still owed by a human. */
    expect(doc).toContain('has not proposed any references');
  });
});
