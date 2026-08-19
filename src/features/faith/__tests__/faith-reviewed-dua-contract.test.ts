import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { REVIEWED_DUA_MANIFEST } from '../data/dhikr/reviewed-dua-manifest';
import { DUA_CATEGORIES } from '../data/duas/dua-categories';
import {
  MAX_POPULAR_DUAS,
  popularDuas,
  popularOverflowCount,
  popularSectionLayout,
  showPopularSection,
} from '../data/duas/dua-popular';
import {
  PERMITTED_HADITH_PROVIDERS,
  parseReviewedDuas,
  reviewedDuas,
  reviewedDuasForCategory,
  duaSourceLabel,
  type ReviewedDuaRejectionReason,
} from '../data/duas/reviewed-dua';

/**
 * **The reviewed-Dua contract, and the count of things that have passed it.**
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── The number this file exists to hold at zero ────────────────────────────
 * `reviewedDuas()` returns nothing, because no qualified reviewer has approved anything. That is the
 * honest state of the product and it is asserted rather than assumed: the day somebody adds an entry,
 * this test fails, and whoever added it has to come here and say why the entry is real. A gate nobody
 * notices being opened is not a gate.
 *
 * ── Every fixture below is synthetic, and deliberately so ──────────────────
 * The approved shape is built in this file from placeholder strings. No real Arabic, no real narration,
 * no real translation and no real reference-with-a-claim-attached appears anywhere — a fixture is
 * exactly where unverified religious content survives a deletion, and a test suite is the last place
 * anybody looks for it.
 *
 * ── What each group is actually protecting ─────────────────────────────────
 * The rejections are not a type check by another means. Every one of them is a way a real religious
 * claim could reach a screen while type-checking perfectly: a count with nothing behind it, an
 * editorial rank nobody approved, a narration from a provider that never licensed it, a user's own
 * category filled by a manifest, a romanisation smuggled in under a field meant to hold an integer.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/**
 * A complete, gate-passing entry. Synthetic in every field.
 *
 * Written as a factory rather than a constant so a case cannot mutate the shape the next case starts
 * from — a shared object frozen only by convention is how one deviation quietly becomes the baseline.
 */
const approved = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'test.reviewed.one',
  sourceKind: 'quran',
  provider: 'quran-foundation',
  surah: 2,
  startAyah: 255,
  endAyah: 255,
  title: 'A title the reviewer supplied',
  category: 'quranic-remembrance',
  categories: ['daily-remembrances'],
  arabicSource: 'retained-generation',
  translationResourceId: 85,
  transliterationResourceId: null,
  recommendedTarget: null,
  reviewStatus: 'approved',
  review: {
    reviewer: 'A named reviewer',
    source: 'A citable published basis',
    reviewedOn: '2026-08-19',
    recordId: 'review-record-0001',
    popularRank: null,
    repetitionBasis: null,
  },
  contextNote: 'Why this reference is offered, and on what basis.',
  enabled: true,
  version: 1,
  ...over,
});

/**
 * Source with its comments removed.
 *
 * Every scan below that looks for the *absence* of an identifier runs through this first. The files being
 * scanned explain at length why they exclude the thing being searched for, and a scan that failed on its
 * own subject matter would be a scan somebody deletes rather than fixes.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

/** The single rejection reason a one-row manifest produced, or `null` if it was approved. */
function rejectionFor(row: Record<string, unknown>): ReviewedDuaRejectionReason | null {
  const parse = parseReviewedDuas([row]);
  return parse.approved.length === 1 ? null : (parse.rejected[0]?.reason ?? null);
}

describe('what this build ships', () => {
  it('ships zero reviewed duas, and says so out loud', () => {
    expect(REVIEWED_DUA_MANIFEST).toHaveLength(0);
    expect(reviewedDuas()).toHaveLength(0);
  });

  it('has no licensed Hadith provider, which is why Sunnah is empty rather than hidden', () => {
    expect(PERMITTED_HADITH_PROVIDERS).toEqual([]);
  });

  it('holds the manifest as data, so a shipped entry cannot skip the parser', () => {
    /*
      Typed `readonly unknown[]`. Were it typed as the entry type, entries written there would be checked
      by the compiler and *not* by the gate — which is the whole difference between a catalogue and a
      manifest.
    */
    const source = readFileSync(
      join(__dirname, '..', 'data', 'dhikr', 'reviewed-dua-manifest.ts'),
      'utf8',
    );
    expect(source).toContain('export const REVIEWED_DUA_MANIFEST: readonly unknown[] = []');
  });

  it('accepts the synthetic approved shape, so every rejection below is about one field', () => {
    const parse = parseReviewedDuas([approved()]);
    expect(parse.rejected).toEqual([]);
    expect(parse.approved).toHaveLength(1);
  });
});

describe('the source kind decides the shape of the reference', () => {
  it('refuses a row that names no source kind', () => {
    const { sourceKind, ...withoutKind } = approved();
    expect(sourceKind).toBe('quran');
    expect(rejectionFor(withoutKind)).toBe('invalid-source-kind');
  });

  it('refuses a source kind that is not one of the two', () => {
    expect(rejectionFor(approved({ sourceKind: 'website' }))).toBe('invalid-source-kind');
  });

  it('refuses a Qur’an row carrying a narration reference as well', () => {
    /*
      Both references present means one of them is wrong and nothing here can tell which. Refused rather
      than resolved by preferring the kind field, which would silently discard whichever the transcriber
      actually meant.
    */
    expect(rejectionFor(approved({ collection: 'A Collection', hadithReference: '1' }))).toBe(
      'source-reference-mismatch',
    );
  });

  it('refuses a Hadith row carrying a Qur’an range', () => {
    expect(
      rejectionFor(
        approved({ sourceKind: 'hadith', collection: 'A Collection', hadithReference: '1' }),
      ),
    ).toBe('source-reference-mismatch');
  });

  it('refuses a Hadith row on provider permission, however complete it is', () => {
    /*
      ── The fail-closed case that matters most today ──────────────────────────
      This row is well-formed, fully reviewed, and names a provider. It is refused because NoorLife has
      no Hadith licence — and it is refused by the *parser*, so no screen has to remember that. A data
      change alone can never publish a narration; `PERMITTED_HADITH_PROVIDERS` is code.
    */
    const { surah, startAyah, endAyah, ...withoutRange } = approved();
    expect([surah, startAyah, endAyah]).toEqual([2, 255, 255]);
    const hadith = {
      ...withoutRange,
      sourceKind: 'hadith',
      provider: 'some-hadith-provider',
      collection: 'A Collection',
      hadithReference: '1',
    };
    expect(rejectionFor(hadith)).toBe('missing-provider-permission');
  });

  it('refuses a Qur’an row from a provider that is not the licensed one', () => {
    expect(rejectionFor(approved({ provider: 'another-source' }))).toBe('missing-provenance');
  });

  it('refuses a Qur’an row with no provider named at all', () => {
    const { provider, ...withoutProvider } = approved();
    expect(provider).toBe('quran-foundation');
    expect(rejectionFor(withoutProvider)).toBe('missing-provenance');
  });

  it('renders the exact reference for each kind, and never a range it was not given', () => {
    expect(duaSourceLabel({ kind: 'quran', surah: 2, startAyah: 255, endAyah: 255 })).toBe(
      'Qur’an 2:255',
    );
    expect(duaSourceLabel({ kind: 'quran', surah: 59, startAyah: 22, endAyah: 24 })).toBe(
      'Qur’an 59:22-24',
    );
    expect(duaSourceLabel({ kind: 'hadith', collection: 'A Collection', reference: '99' })).toBe(
      'A Collection 99',
    );
  });
});

describe('categories are approved, never inferred', () => {
  it('refuses a row that names no category', () => {
    const { categories, ...withoutCategories } = approved();
    expect(categories).toEqual(['daily-remembrances']);
    expect(rejectionFor(withoutCategories)).toBe('missing-categories');
    expect(rejectionFor(approved({ categories: [] }))).toBe('missing-categories');
  });

  it('refuses a category that is not one of the ten cards', () => {
    expect(rejectionFor(approved({ categories: ['bedtime'] }))).toBe('unknown-category');
  });

  it('refuses a personal card, because those hold the user’s own data', () => {
    /*
      A reviewed entry filed under My Quran Selections would appear inside a list the user believes they
      built. That is the misrepresentation this whole module is arranged around, and it is refused at the
      manifest rather than filtered out at the screen.
    */
    expect(rejectionFor(approved({ categories: ['my-quran-selections'] }))).toBe(
      'personal-category',
    );
    expect(rejectionFor(approved({ categories: ['favourites'] }))).toBe('personal-category');
  });

  it('accepts an entry in several reviewed cards, and returns it under each', () => {
    const entry = approved({ categories: ['daily-remembrances', 'adhkar'] });
    const duas = reviewedDuas([entry]);
    expect(duas).toHaveLength(1);
    expect(reviewedDuasForCategory('daily-remembrances', duas)).toHaveLength(1);
    expect(reviewedDuasForCategory('adhkar', duas)).toHaveLength(1);
    /* And under nothing it was not filed in. */
    expect(reviewedDuasForCategory('travel', duas)).toHaveLength(0);
  });

  it('offers every one of the ten cards as a real, addressable category', () => {
    /* The ten presentation ids the parser validates against are the ten the grid draws. */
    expect(DUA_CATEGORIES).toHaveLength(10);
    for (const category of DUA_CATEGORIES) {
      const rejection = rejectionFor(approved({ categories: [category.id] }));
      expect(rejection).toBe(category.kind === 'personal' ? 'personal-category' : null);
    }
  });
});

describe('content identity may be named and never carried', () => {
  it('refuses an unknown Arabic strategy, so the manifest cannot become the source of the text', () => {
    /*
      Refused as `embedded-content` rather than as a malformed field, and the distinction is the gate
      working as intended: `arabicSource` is one of the three keys allowed to match a forbidden name, and
      that allowance is conditional on the value being a member of the closed set. An unrecognised string
      has not proved it is an identifier, so it is treated as what it might be — content — rather than as a
      typo. That is the stricter of the two available answers and it is the correct one.
    */
    expect(rejectionFor(approved({ arabicSource: 'inline' }))).toBe('embedded-content');

    /* An absent strategy carries nothing, so it is the field parser that refuses it. */
    const { arabicSource, ...withoutStrategy } = approved();
    expect(arabicSource).toBe('retained-generation');
    expect(rejectionFor(withoutStrategy)).toBe('invalid-content-identity');
  });

  it('accepts a romanisation resource id, because an integer cannot be a romanisation', () => {
    expect(rejectionFor(approved({ transliterationResourceId: 3 }))).toBeNull();
  });

  it('refuses text in a resource-identity field, which is the case a name check would miss', () => {
    /*
      ── The gate's actual question ────────────────────────────────────────────
      It used to reject any key containing "translat" or "transliterat" by name, which made it impossible
      for an entry to say *which* translation a reviewer approved. It now admits three identity keys and
      requires each to hold an integer or a closed slug — so naming a resource is possible and carrying
      its contents is not.

      Synthetic Arabic-script text with a Latin marker, per this module's fixture rule.
    */
    expect(rejectionFor(approved({ transliterationResourceId: 'bismi-probe' }))).toBe(
      'embedded-content',
    );
    expect(rejectionFor(approved({ translationResourceId: 'ألف-probe-١' }))).toBe(
      'embedded-content',
    );
  });

  it('still refuses a field that carries text under any other name', () => {
    for (const key of ['arabic', 'translation', 'transliteration', 'text', 'verseText']) {
      expect(rejectionFor(approved({ [key]: 'ألف-probe-١' }))).toBe('embedded-content');
    }
  });

  it('refuses a fingerprint that is not a digest', () => {
    expect(rejectionFor(approved({ fingerprint: 'looks about right' }))).toBe(
      'invalid-fingerprint',
    );
    expect(rejectionFor(approved({ fingerprint: 'a'.repeat(64) }))).toBeNull();
  });
});

describe('a repetition count needs a basis, and an editorial rank needs a reviewer', () => {
  it('refuses a count with nothing stated behind it', () => {
    /*
      A number on a religious surface with no basis is an invented instruction wearing the catalogue's
      authority. This is the exact failure the five removed dhikr presets were removed for.
    */
    expect(rejectionFor(approved({ recommendedTarget: 33 }))).toBe('repetition-without-evidence');
  });

  it('accepts a count once the review states its basis', () => {
    const withBasis = approved({
      recommendedTarget: 33,
      review: {
        ...(approved().review as Record<string, unknown>),
        repetitionBasis: 'The basis the reviewer cited.',
      },
    });
    expect(rejectionFor(withBasis)).toBeNull();
    expect(reviewedDuas([withBasis])[0]?.recommendedTarget).toBe(33);
  });

  it('refuses a rank placed outside the review record', () => {
    /*
      Accepting a top-level rank would mean an entry could be promoted without the reviewer's block being
      touched, which is what "popular rank without review approval" would amount to in practice.
    */
    expect(rejectionFor(approved({ popularRank: 1 }))).toBe('popular-rank-not-approved');
  });

  it('refuses a malformed rank inside the review record', () => {
    for (const rank of [0, -1, 1.5, 'first']) {
      const row = approved({
        review: { ...(approved().review as Record<string, unknown>), popularRank: rank },
      });
      expect(rejectionFor(row)).toBe('popular-rank-not-approved');
    }
  });

  it('refuses a review record with no traceable identifier', () => {
    const { recordId, ...reviewWithoutRecord } = approved().review as Record<string, unknown>;
    expect(recordId).toBe('review-record-0001');
    expect(rejectionFor(approved({ review: reviewWithoutRecord }))).toBe(
      'missing-review-record-id',
    );
  });
});

describe('ids are stable, unique, and never the user’s', () => {
  it('refuses an id in the user’s selection namespace', () => {
    /*
      One detail route serves reviewed entries and personal selections, and it tells them apart by prefix.
      A reviewed id beginning `q.` would make that ambiguous, so it is refused — which is what makes
      `parseDuaDetailId` total rather than a guess.
    */
    expect(rejectionFor(approved({ id: 'q.2.255.255' }))).toBe('reserved-id');
  });

  it('refuses both rows when two claim one id, rather than picking by iteration order', () => {
    const parse = parseReviewedDuas([approved(), approved({ title: 'A different title' })]);
    expect(parse.approved).toHaveLength(1);
    expect(parse.rejected).toEqual([{ index: 1, reason: 'duplicate-id', id: 'test.reviewed.one' }]);
  });

  it('reports a rejection with its position, so a dropped row can be found', () => {
    const parse = parseReviewedDuas([approved(), { id: 'test.two' }]);
    expect(parse.approved).toHaveLength(1);
    expect(parse.rejected[0]?.index).toBe(1);
    expect(parse.rejected[0]?.id).toBe('test.two');
  });

  it('refuses a manifest that is not a list at all', () => {
    expect(parseReviewedDuas({ entries: [] }).approved).toEqual([]);
    expect(parseReviewedDuas(null).rejected[0]?.reason).toBe('not-an-object');
  });

  it('keeps the underlying gate’s reasons rather than restating them', () => {
    /* The Qur’an-shaped core is validated once, in the manifest parser, and its reason is passed through. */
    expect(rejectionFor(approved({ reviewStatus: 'pending' }))).toBe('not-approved');
    expect(rejectionFor(approved({ surah: 115 }))).toBe('invalid-range');
    expect(rejectionFor(approved({ endAyah: 254 }))).toBe('invalid-range');
    expect(rejectionFor(approved({ contextNote: '   ' }))).toBe('missing-provenance');
    expect(rejectionFor(approved({ title: '' }))).toBe('missing-title');
    expect(rejectionFor(approved({ review: { reviewer: 'A', source: 'B' } }))).toBe(
      'missing-review-record',
    );
  });
});

describe('Popular is a reviewer’s ordering, or it is nothing', () => {
  const ranked = (id: string, rank: number | null): Record<string, unknown> =>
    approved({
      id,
      review: { ...(approved().review as Record<string, unknown>), popularRank: rank },
    });

  it('is hidden at zero reviewed entries, which is every category in this build', () => {
    for (const category of DUA_CATEGORIES) {
      expect(showPopularSection(category.id, reviewedDuas())).toBe(false);
      expect(popularDuas(category.id, reviewedDuas())).toEqual([]);
      expect(popularOverflowCount(category.id, reviewedDuas())).toBe(0);
    }
  });

  it('includes only entries a reviewer ranked, never the rest of the category', () => {
    const duas = reviewedDuas([ranked('test.a', 1), ranked('test.b', null)]);
    expect(duas).toHaveLength(2);
    expect(popularDuas('daily-remembrances', duas).map((dua) => dua.id)).toEqual(['test.a']);
    /* An unranked entry is not rank zero — it is simply not in this section. */
    expect(showPopularSection('daily-remembrances', duas)).toBe(true);
  });

  it('orders by the explicit reviewed rank, not by manifest order', () => {
    const duas = reviewedDuas([ranked('test.c', 3), ranked('test.a', 1), ranked('test.b', 2)]);
    expect(popularDuas('daily-remembrances', duas).map((dua) => dua.id)).toEqual([
      'test.a',
      'test.b',
      'test.c',
    ]);
  });

  it('breaks a tie stably, so the section does not reorder under the reader', () => {
    const first = popularDuas(
      'daily-remembrances',
      reviewedDuas([ranked('test.z', 1), ranked('test.a', 1)]),
    );
    const second = popularDuas(
      'daily-remembrances',
      reviewedDuas([ranked('test.a', 1), ranked('test.z', 1)]),
    );
    expect(first.map((dua) => dua.id)).toEqual(['test.a', 'test.z']);
    expect(second.map((dua) => dua.id)).toEqual(first.map((dua) => dua.id));
  });

  it('states an overflow rather than truncating silently', () => {
    const rows = Array.from({ length: MAX_POPULAR_DUAS + 2 }, (_, index) =>
      ranked(`test.${index}`, index + 1),
    );
    const duas = reviewedDuas(rows);
    expect(duas).toHaveLength(MAX_POPULAR_DUAS + 2);
    expect(popularDuas('daily-remembrances', duas)).toHaveLength(MAX_POPULAR_DUAS);
    expect(popularOverflowCount('daily-remembrances', duas)).toBe(2);
  });

  it('shows nothing in a category the ranked entry was not filed under', () => {
    const duas = reviewedDuas([ranked('test.a', 1)]);
    expect(popularDuas('travel', duas)).toEqual([]);
    expect(showPopularSection('travel', duas)).toBe(false);
  });

  it('cannot be handed a personal selection, at the type level and in the source', () => {
    /*
      ── The guarantee is the signature, and this is the assertion of it ───────
      `popularDuas` takes `ReviewedDua[]`. A `QuranSelection` will not typecheck, so the tempting fix for
      an empty section — show the user's own selections there — is unavailable to this function and to a
      later refactor of it. The scan is the part a type cannot state: nothing in the popular module even
      mentions the selection type.
    */
    /*
      Comments stripped first, the same way `faith-no-fabrication-scan.test.ts` does it: the prose in both
      files necessarily names the type it is explaining the exclusion of, and that prose is the record of
      the decision rather than a violation of it. What must hold is that no *code* in either file reaches
      for a selection.
    */
    const code = stripComments(
      readFileSync(join(__dirname, '..', 'data', 'duas', 'dua-popular.ts'), 'utf8'),
    );
    expect(code).not.toMatch(/QuranSelection/);
    expect(code).not.toMatch(/selection/i);

    const component = readFileSync(
      join(__dirname, '..', 'components', 'dua-popular-section.tsx'),
      'utf8',
    );
    expect(component).toContain('readonly entries: readonly ReviewedDua[]');
    expect(stripComments(component)).not.toMatch(/QuranSelection/);
  });

  it('stops scrolling sideways once the cards would hide each other', () => {
    expect(popularSectionLayout({ stackTwoColumns: false, fontScale: 1 })).toBe('horizontal');
    /* A large text size grows the cards while the viewport stays put, so the row stacks. */
    expect(popularSectionLayout({ stackTwoColumns: false, fontScale: 1.3 })).toBe('stacked');
    expect(popularSectionLayout({ stackTwoColumns: false, fontScale: 1.5 })).toBe('stacked');
    /* And never later than every other side-by-side pair in the app. */
    expect(popularSectionLayout({ stackTwoColumns: true, fontScale: 1 })).toBe('stacked');
  });
});

describe('no reviewed dua content is written in executable source', () => {
  const DUAS_DIR = join(__dirname, '..', 'data', 'duas');

  it('holds no Arabic script anywhere in the Duas domain', () => {
    for (const entry of readdirSync(DUAS_DIR)) {
      const source = readFileSync(join(DUAS_DIR, entry), 'utf8');
      /*
        The whole file, comments included. There is no legitimate reason for Arabic script to appear in a
        module that deals only in references, and a comment is exactly where a "temporary" example sits
        for a release.
      */
      expect(source).not.toMatch(/[؀-ۿ]/);
    }
  });

  it('declares no entry in the Duas domain, so the manifest stays the only source', () => {
    for (const entry of readdirSync(DUAS_DIR)) {
      const source = readFileSync(join(DUAS_DIR, entry), 'utf8');
      /* The one place an approval may be assigned is the manifest gate, and it is not in this directory. */
      expect(source).not.toMatch(/reviewStatus\s*:\s*['"]approved['"]/);
    }
  });
});
