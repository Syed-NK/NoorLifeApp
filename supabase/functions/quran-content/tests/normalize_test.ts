import { assert, assertEquals } from './assert.ts';
import {
  normalizeChapter,
  normalizeChapters,
  type Normalized,
  normalizeEditions,
  normalizePayload,
  normalizeReciters,
  normalizeTranslations,
  normalizeVerses,
  readPagination,
  stripTranslationMarkup,
  toRevelation,
} from '../normalize.ts';
import { CONTENT_SOURCE_NAME } from '../contract.ts';
import type { NormalizeReason, TranslationAttribution } from '../ports.ts';

/**
 * The value of a normalisation that was expected to succeed.
 *
 * Asserting through a helper rather than at each call site so a failure reports **which check**
 * refused the body. A bare `assert(outcome.ok)` would say only that something was rejected, which is
 * precisely the problem the reason enum was introduced to solve — a test suite that reproduced it
 * would be an odd way to prove the fix.
 */
function value<T>(outcome: Normalized<T>, message = 'the body normalised'): T {
  assert(outcome.ok, `${message} — refused for: ${outcome.ok ? '' : outcome.reason}`);
  return outcome.value;
}

/**
 * A normalisation that was expected to fail, **and the check that failed it**.
 *
 * Pinning the reason rather than just the refusal is what makes these regressions. The deployed
 * defect was not "a valid body was refused" in the abstract — it was that eight independent checks
 * all reported the same indistinguishable `null`, so a fault in NoorLife's own catalogue read was
 * indistinguishable from a malformed vendor body. A test that asserted only `!ok` would still pass
 * if `attribution` and `envelope` were swapped.
 */
function refusedFor<T>(
  outcome: Normalized<T>,
  reason: NormalizeReason,
  message = 'the body was refused',
): void {
  assert(!outcome.ok, message);
  assertEquals(outcome.reason, reason, message);
}

/**
 * The normalisation boundary — and the one rule the whole integration rests on.
 *
 * ── Why the Arabic fixtures are written as escapes ───────────────────────────
 * Every scripture fixture below is built from `\uXXXX` escapes rather than pasted glyphs, and the
 * assertion compares the output against the same escaped constant. That makes the test prove exactly
 * what it claims: not "the Arabic looks right" but "these code points came back in this order". A
 * pasted string would be at the mercy of the editor, the file encoding and any tool that rewrites the
 * file — and a normalising step that quietly composed two code points into one would still *look*
 * identical in a diff.
 */

/**
 * The Basmala in Uthmani script, spelled out as escapes.
 *
 * Alef wasla, shadda, tatweel and a superscript alef are the characters a well-meaning "clean-up"
 * damages first. Writing them this way means the fixture cannot be altered by an editor, a file
 * re-encoding or a formatter, and a reader can see exactly which code points are being asserted.
 */
const BISMILLAH =
  '\u0628\u0650\u0633\u0652\u0645\u0650 \u0671\u0644\u0644\u064e\u0651\u0647\u0650 \u0671\u0644\u0631\u064e\u0651\u062d\u0652\u0645\u064e\u0640\u0670\u0646\u0650 \u0671\u0644\u0631\u064e\u0651\u062d\u0650\u064a\u0645\u0650';

/**
 * Alef followed by a combining maddah, which NFC composes into a single code point.
 *
 * The sharpest available test for "no normalisation": a `.normalize()` anywhere on the scripture
 * path turns these five code points into four, and nothing about the rendered glyph would say so.
 */
const DECOMPOSED = '\u0627\u0653\u0644\u064e\u0645';

/** Leading and trailing spaces, so an incidental `.trim()` on the scripture path is caught too. */
const PADDED = ` ${BISMILLAH} `;

function verseBody(texts: readonly string[], surah = 1) {
  return {
    verses: texts.map((text, index) => ({
      id: index + 1,
      chapter_id: surah,
      verse_number: index + 1,
      verse_key: `${surah}:${index + 1}`,
      text_uthmani: text,
    })),
    pagination: {
      per_page: 10,
      current_page: 1,
      next_page: null,
      total_pages: 1,
      total_records: 3,
    },
  };
}

Deno.test('Qur’anic Arabic comes back byte-for-byte', () => {
  const page = normalizeVerses(verseBody([BISMILLAH, DECOMPOSED, PADDED]), 1);
  assert(page !== null, 'the body normalised');

  assertEquals(page.verses[0]?.arabic, BISMILLAH);
  assertEquals(page.verses[1]?.arabic, DECOMPOSED);
  assertEquals(page.verses[2]?.arabic, PADDED);

  // Code-point identity, stated separately so a failure says *which* invariant broke.
  assertEquals([...(page.verses[1]?.arabic ?? '')].length, 5, 'no Unicode composition happened');
  assertEquals(
    page.verses[1]?.arabic.normalize('NFC') === page.verses[1]?.arabic,
    false,
    'the fixture would have changed under NFC',
  );
  assertEquals(page.verses[2]?.arabic.startsWith(' '), true, 'no trimming happened');
  assertEquals(page.verses[2]?.arabic.endsWith(' '), true);
});

Deno.test('a verse with no Arabic is a failure, not a blank ayah', () => {
  /**
   * An ayah rendered as blank is a claim that the ayah is blank. It happens when the request forgot
   * `fields=text_uthmani`, which is a defect in this function's own request — so it must be loud.
   */
  assertEquals(normalizeVerses({ verses: [{ verse_key: '1:1' }] }, 1), null);
  assertEquals(normalizeVerses({ verses: [{ verse_key: '1:1', text_uthmani: '' }] }, 1), null);
  assertEquals(normalizeVerses({ verses: [{ verse_key: '1:1', text_uthmani: 42 }] }, 1), null);
});

Deno.test('a verse from the wrong surah is refused rather than rendered', () => {
  // Showing surah 3 for a request for surah 2 is worse than an error.
  assertEquals(normalizeVerses(verseBody([BISMILLAH], 3), 2), null);
  assertEquals(
    normalizeVerses({ verses: [{ verse_key: 'x:1', text_uthmani: BISMILLAH }] }, 1),
    null,
  );
  assertEquals(normalizeVerses({ verses: [{ verse_key: '1', text_uthmani: BISMILLAH }] }, 1), null);
  assertEquals(
    normalizeVerses({ verses: [{ verse_key: '0:1', text_uthmani: BISMILLAH }] }, 0),
    null,
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Chapters
// ─────────────────────────────────────────────────────────────────────────────

const AL_KAHF = {
  id: 18,
  revelation_place: 'makkah',
  revelation_order: 69,
  bismillah_pre: true,
  name_simple: 'Al-Kahf',
  name_complex: 'Al-Kahf',
  name_arabic: '\u0627\u0644\u0643\u0647\u0641',
  verses_count: 110,
  pages: [293, 304],
  translated_name: { language_name: 'english', name: 'The Cave' },
};

Deno.test('a chapter maps onto the domain shape', () => {
  const chapters = normalizeChapters({ chapters: [AL_KAHF] });
  assert(chapters !== null, 'the catalogue normalised');
  assertEquals(chapters[0], {
    number: 18,
    name: 'Al-Kahf',
    arabicName: '\u0627\u0644\u0643\u0647\u0641',
    meaning: 'The Cave',
    ayahCount: 110,
    revelation: 'meccan',
  });
});

Deno.test('revelation place is mapped, never defaulted', () => {
  assertEquals(toRevelation('makkah'), 'meccan');
  assertEquals(toRevelation('Makkah'), 'meccan');
  assertEquals(toRevelation('madinah'), 'medinan');
  assertEquals(toRevelation('MADINAH'), 'medinan');

  /**
   * An unrecognised value fails the whole response rather than falling back. Where a surah was
   * revealed is a fact about scripture, and a default would be this function inventing one — quietly,
   * for every future spelling the vendor introduces.
   */
  for (const value of ['jerusalem', '', 'unknown', null, 7, undefined]) {
    assertEquals(toRevelation(value), null, String(value));
  }
  assertEquals(
    normalizeChapters({ chapters: [{ ...AL_KAHF, revelation_place: 'elsewhere' }] }),
    null,
  );
});

Deno.test('an incomplete chapter fails the response', () => {
  for (
    const patch of [
      { id: 0 },
      { id: 115 },
      { name_simple: '' },
      { name_arabic: '' },
      { verses_count: 0 },
      { verses_count: 999 },
      { translated_name: {} },
      { translated_name: null },
    ]
  ) {
    assertEquals(
      normalizeChapters({ chapters: [{ ...AL_KAHF, ...patch }] }),
      null,
      JSON.stringify(patch),
    );
  }
  assertEquals(normalizeChapters({ chapters: [] }), null, 'an empty catalogue is not a catalogue');
  assertEquals(normalizeChapters({ chapters: 'nope' }), null);
  assertEquals(normalizeChapters(null), null);
});

Deno.test('a single chapter must be the one that was asked for', () => {
  assert(normalizeChapter({ chapter: AL_KAHF }, 18) !== null, 'the requested chapter normalises');
  assertEquals(normalizeChapter({ chapter: AL_KAHF }, 2), null);
  assertEquals(normalizeChapter({ chapters: [AL_KAHF] }, 18), null);
});

// ─────────────────────────────────────────────────────────────────────────────
// Translations and attribution
// ─────────────────────────────────────────────────────────────────────────────

function translationBody(entries: readonly Record<string, unknown>[], nextPage: number | null = 2) {
  return {
    translations: entries,
    pagination: {
      per_page: 20,
      current_page: 1,
      next_page: nextPage,
      total_pages: 6,
      total_records: 110,
    },
  };
}

/**
 * A translation row **as the live API actually returns it** — with no `resource_name`.
 *
 * The vendor's schema requires only `resource_id` and `text`; `resource_name` is optional and the
 * production API omits it on both routes NoorLife reads. The normaliser used to require it, which
 * turned every valid translation into `502 upstream_unavailable` behind an `upstream_outcome: ok`.
 * This is the shape the fix has to accept.
 */
const LIVE_ROW = {
  resource_id: 131,
  verse_key: '18:1',
  text: 'All praise is for Allah.',
};

/** The same row with the optional label the documentation's example shows. */
const LABELLED_ROW = {
  ...LIVE_ROW,
  resource_name: 'Dr. Mustafa Khattab, the Clear Quran',
};

/** The catalogue answer for edition 131: a title and a translator, as separate fields. */
const CATALOGUE: TranslationAttribution = {
  title: 'The Clear Quran',
  translator: 'Dr. Mustafa Khattab',
};

Deno.test('a live row without resource_name is accepted and credited from the catalogue', () => {
  /**
   * The regression, stated directly. `resource_name` is absent — exactly as production sends it —
   * and the page still normalises, with a title and a translator that came from the vendor's own
   * catalogue keyed by the requested id.
   */
  const page = value(normalizeTranslations(translationBody([LIVE_ROW]), 18, 131, CATALOGUE));

  assertEquals(page.translations[0], {
    surah: 18,
    ayah: 1,
    translationId: '131',
    text: 'All praise is for Allah.',
  });
  assertEquals(page.source, {
    name: CONTENT_SOURCE_NAME,
    edition: 'The Clear Quran',
    attribution: 'Dr. Mustafa Khattab',
    verified: true,
  });
});

Deno.test('response-level meta credits the edition when the catalogue is unavailable', () => {
  /**
   * `meta.translation_name` / `meta.author_name` are required by `QuranTranslationMeta`, but that
   * component is referenced by one path only — `/quran/translations/{id}` — and neither route this
   * function reads declares a `meta` block. So it is honoured where it appears, never depended on.
   */
  const body = {
    ...translationBody([LIVE_ROW]),
    meta: {
      translation_name: 'The Clear Quran',
      author_name: 'Dr. Mustafa Khattab',
      filters: { chapter_number: 18 },
    },
  };
  const page = value(normalizeTranslations(body, 18, 131, undefined));
  assertEquals(page.source.edition, 'The Clear Quran');
  assertEquals(page.source.attribution, 'Dr. Mustafa Khattab');
});

Deno.test('the catalogue outranks meta, and neither is mixed with the other', () => {
  /**
   * Each source is taken whole. Half a title from one and half a translator from another would be a
   * credit no source actually asserts — worse than either, because both halves are real.
   */
  const body = {
    ...translationBody([LABELLED_ROW]),
    meta: { translation_name: 'Some Other Title', author_name: 'Somebody Else', filters: {} },
  };
  const page = value(normalizeTranslations(body, 18, 131, CATALOGUE));
  assertEquals(page.source.edition, CATALOGUE.title);
  assertEquals(page.source.attribution, CATALOGUE.translator);
});

Deno.test('the entry label is the last resort, and names no translator it was not given', () => {
  /**
   * `resource_name` is one combined string — "Dr. Mustafa Khattab, the Clear Quran". Splitting it
   * into a title and a translator would be this function inventing the boundary, so it becomes the
   * edition title and the credit line says less rather than more.
   */
  const page = value(normalizeTranslations(translationBody([LABELLED_ROW]), 18, 131, undefined));
  assertEquals(page.source.edition, 'Dr. Mustafa Khattab, the Clear Quran');
  assertEquals(page.source.attribution, undefined, 'no translator is invented from a label');
});

Deno.test('rows to render with nobody to credit fail closed, and say so', () => {
  /**
   * No catalogue, no meta, no label — and rows that would otherwise render. An unattributed
   * rendering of the Qur'an next to the Arabic is the one outcome the hierarchy exists to prevent.
   *
   * ── This is the deployed defect, reproduced ─────────────────────────────────
   * The body here is a *valid live response*: `LIVE_ROW` is the exact shape production sends. What
   * is missing is not in the response at all — it is the catalogue lookup, a second upstream read
   * that fails on its own account. The page is correctly refused; the point of the assertion is that
   * the refusal is now labelled `attribution`, which is what tells an operator to look at NoorLife's
   * catalogue read rather than at the vendor's body.
   */
  refusedFor(normalizeTranslations(translationBody([LIVE_ROW]), 18, 131, undefined), 'attribution');
});

Deno.test('empty or half-present attribution is not attribution', () => {
  // A blank title, a blank translator, or one of the pair missing: none of them is a credit.
  for (
    const meta of [
      { translation_name: '', author_name: 'Dr. Mustafa Khattab', filters: {} },
      { translation_name: 'The Clear Quran', author_name: '', filters: {} },
      { translation_name: 'The Clear Quran', filters: {} },
      { author_name: 'Dr. Mustafa Khattab', filters: {} },
      {},
    ]
  ) {
    const body = { ...translationBody([LIVE_ROW]), meta };
    refusedFor(
      normalizeTranslations(body, 18, 131, undefined),
      'attribution',
      JSON.stringify(meta),
    );
  }
  // And a blank entry label is silence, not a credit.
  refusedFor(
    normalizeTranslations(
      translationBody([{ ...LIVE_ROW, resource_name: '' }]),
      18,
      131,
      undefined,
    ),
    'attribution',
  );
});

Deno.test('rows disagreeing about the edition fail closed', () => {
  /**
   * The ids already matched the request, so this is a response that is internally inconsistent about
   * what it is. Choosing one of two contradictory labels would be choosing which claim to print
   * above somebody's scripture.
   */
  const conflicting = translationBody([
    { ...LIVE_ROW, resource_name: 'The Clear Quran' },
    { ...LIVE_ROW, verse_key: '18:2', resource_name: 'Saheeh International' },
  ]);
  refusedFor(normalizeTranslations(conflicting, 18, 131, undefined), 'label_conflict');

  // Rows that merely stay silent are not disagreeing, and are accepted.
  const partial = translationBody([
    { ...LIVE_ROW, resource_name: 'The Clear Quran' },
    { ...LIVE_ROW, verse_key: '18:2' },
  ]);
  value(normalizeTranslations(partial, 18, 131, undefined), 'silence is not conflict');
});

Deno.test('a translation from a different edition is refused', () => {
  // Rendering it would attribute the user's chosen translation to a translator who did not write it.
  refusedFor(normalizeTranslations(translationBody([LIVE_ROW]), 18, 20, CATALOGUE), 'resource_id');
});

Deno.test('a mixed-resource response fails closed', () => {
  /**
   * One row from the requested edition and one from another. Accepting the page would render two
   * translators' work under a single credit.
   */
  const mixed = translationBody([LIVE_ROW, { ...LIVE_ROW, verse_key: '18:2', resource_id: 20 }]);
  refusedFor(normalizeTranslations(mixed, 18, 131, CATALOGUE), 'resource_id');
});

Deno.test('an empty page is a legitimate end of list, not an error', () => {
  const page = value(normalizeTranslations(translationBody([], null), 18, 131, CATALOGUE));
  assertEquals(page.translations.length, 0);
  assertEquals(page.pagination.nextCursor, null);
  // Nothing to render, so nothing to fail over — the source still names the requested edition.
  assertEquals(page.source.edition, CATALOGUE.title);
});

Deno.test('an empty page with no attribution at all still normalises', () => {
  // There are no rows to credit, so the absence of a credit cannot mislead anybody.
  const page = value(normalizeTranslations(translationBody([], null), 18, 131, undefined));
  assertEquals(page.translations.length, 0);
  assertEquals(page.source.edition, 'Translation 131');
});

Deno.test('every check that can refuse a translations page is distinguishable in the log', () => {
  /**
   * ── The regression that would have made the deployed defect a five-minute fix ─
   * Each row below is a *different* way for a `200` to be refused, and every one of them used to
   * produce the same `null` — so the operational log carried `upstream_outcome: ok` and
   * `error_code: upstream_unavailable` for all of them, with nothing to tell them apart. The reasons
   * are asserted as a set here so a future change that collapses two of them fails a test rather
   * than quietly re-blinding the log.
   *
   * The values name checks, never content. That is asserted structurally by `NormalizeReason` being
   * a closed union of literals — there is no member with a payload for a verse to travel in.
   */
  refusedFor(normalizeTranslations(null, 18, 131, CATALOGUE), 'envelope', 'not an object');
  refusedFor(
    normalizeTranslations({ translations: 'nope' }, 18, 131, CATALOGUE),
    'envelope',
    'translations was not an array',
  );
  refusedFor(
    normalizeTranslations(
      translationBody([{ ...LIVE_ROW, verse_key: '19:1' }]),
      18,
      131,
      CATALOGUE,
    ),
    'verse_key',
    'a row from another surah',
  );
  refusedFor(
    normalizeTranslations(translationBody([{ ...LIVE_ROW, verse_key: 'x' }]), 18, 131, CATALOGUE),
    'verse_key',
    'an unparseable verse key',
  );
  refusedFor(
    normalizeTranslations(translationBody([{ ...LIVE_ROW, resource_id: 20 }]), 18, 131, CATALOGUE),
    'resource_id',
    'a row from another edition',
  );
  refusedFor(
    normalizeTranslations(translationBody([{ ...LIVE_ROW, text: 42 }]), 18, 131, CATALOGUE),
    'text_type',
    'text that was not a string',
  );
  refusedFor(
    normalizeTranslations(
      translationBody([{ ...LIVE_ROW, text: '<sup foot_note="1">1</sup>' }]),
      18,
      131,
      CATALOGUE,
    ),
    'text_empty',
    'text that was nothing but markup',
  );
  refusedFor(
    normalizeTranslations([LIVE_ROW], 18, 131, CATALOGUE),
    'envelope',
    'an array where an envelope belongs',
  );
});

Deno.test('translation markup is removed without the words being touched', () => {
  /**
   * The vendor's schema says translation text "could have HTML tags for formatting and footnotes".
   * NoorLife renders into a React Native `Text`, which has no markup layer, so leaving the tags in
   * would put a literal `<i>` on the screen.
   */
  assertEquals(
    stripTranslationMarkup('In the Name of Allah<sup foot_note="12">1</sup>, the Most Merciful.'),
    'In the Name of Allah, the Most Merciful.',
  );
  assertEquals(stripTranslationMarkup('<i>Alif Lam Mim</i>'), 'Alif Lam Mim');
  assertEquals(stripTranslationMarkup('one<br/>two'), 'onetwo');
  assertEquals(stripTranslationMarkup('Moses &amp; Aaron'), 'Moses & Aaron');
  assertEquals(stripTranslationMarkup('&lt;not a tag&gt;'), '<not a tag>');
  assertEquals(stripTranslationMarkup('  padded  '), 'padded');

  /**
   * And what it deliberately does not do: internal spacing, case, punctuation and Unicode are the
   * translator's, and come through unaltered.
   */
  assertEquals(
    stripTranslationMarkup('a  double   spaced — “quoted” sentence'),
    'a  double   spaced — “quoted” sentence',
  );
});

Deno.test('a translation that was nothing but markup is refused', () => {
  refusedFor(
    normalizeTranslations(
      translationBody([{ ...LABELLED_ROW, text: '<sup foot_note="1">1</sup>' }]),
      18,
      131,
    ),
    'text_empty',
  );
  refusedFor(
    normalizeTranslations(translationBody([{ ...LABELLED_ROW, text: 42 }]), 18, 131),
    'text_type',
  );
});

Deno.test('markup removal never touches the scripture path', () => {
  /**
   * The immutability rule is about Qur'anic Arabic, and this is the assertion that the markup step
   * cannot reach it: a verse whose text happens to contain angle brackets comes back with them.
   */
  const withAngles = `${BISMILLAH}<i>`;
  const page = normalizeVerses(verseBody([withAngles]), 1);
  assert(page !== null, 'the page normalised');
  assertEquals(page.verses[0]?.arabic, withAngles);
});

// ─────────────────────────────────────────────────────────────────────────────
// Pagination
// ─────────────────────────────────────────────────────────────────────────────

Deno.test('pagination becomes an opaque cursor bounded by the vendor’s own answer', () => {
  assertEquals(readPagination({ next_page: 3, total_records: 110 }), {
    nextCursor: '3',
    total: 110,
  });
  assertEquals(readPagination({ next_page: null, total_records: 7 }), {
    nextCursor: null,
    total: 7,
  });
  assertEquals(readPagination({}), { nextCursor: null });
  assertEquals(readPagination(null), { nextCursor: null });
  // A next page that is not a positive integer is the end of the list rather than a cursor to trust.
  for (const next of [0, -1, 2.5, '3', true]) {
    assertEquals(readPagination({ next_page: next }).nextCursor, null, String(next));
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Catalogues
// ─────────────────────────────────────────────────────────────────────────────

Deno.test('an edition without a translator is left out of the catalogue', () => {
  /**
   * The catalogue is what the preferences screen offers. An entry with no author would, once chosen,
   * produce translations NoorLife could not attribute — so it is better never offered. One unusable
   * entry does not fail the list, because the rest of it is still correct.
   */
  const editions = normalizeEditions({
    translations: [
      {
        id: 131,
        name: 'The Clear Quran',
        author_name: 'Dr. Mustafa Khattab',
        language_name: 'english',
      },
      { id: 999, name: 'Anonymous rendering', language_name: 'english' },
      { id: 0, name: 'Bad id', author_name: 'Someone', language_name: 'english' },
    ],
  });
  assertEquals(editions, [
    { id: '131', language: 'english', name: 'The Clear Quran', translator: 'Dr. Mustafa Khattab' },
  ]);
});

Deno.test('a reciter keeps its style when the vendor sends one', () => {
  assertEquals(
    normalizeReciters({
      recitations: [
        { id: 1, reciter_name: 'AbdulBaset AbdulSamad', style: 'Mujawwad' },
        { id: 2, reciter_name: 'Another Reciter' },
        { id: 3 },
      ],
    }),
    [
      { id: '1', name: 'AbdulBaset AbdulSamad', style: 'Mujawwad' },
      { id: '2', name: 'Another Reciter' },
    ],
  );
});

Deno.test('a catalogue that is not a list is not a catalogue', () => {
  assertEquals(normalizeEditions({ translations: 'nope' }), null);
  assertEquals(normalizeEditions(null), null);
  assertEquals(normalizeReciters({ recitations: {} }), null);
});

// ─────────────────────────────────────────────────────────────────────────────
// The Daily Ayah
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The Daily Ayah body **as the live API sends it** — the embedded translation carries no
 * `resource_name`, because it is the very same optional field the paginated route omits.
 *
 * `get_verse` showed the identical normalisation failure for the identical reason, so it gets the
 * identical fixture.
 */
const DAILY_BODY = {
  verse: {
    id: 6231,
    verse_key: '94:6',
    text_uthmani: BISMILLAH,
    translations: [{
      resource_id: 131,
      text: 'Surely with hardship comes ease.',
    }],
  },
};

Deno.test('the daily verse keeps scripture and translation in separate objects', () => {
  const payload = value(
    normalizePayload(
      { operation: 'get_verse', surah: 94, ayah: 6, translationId: 131 },
      DAILY_BODY,
      CATALOGUE,
    ),
  );
  assert(payload.operation === 'get_verse', 'a single-verse payload came back');

  assertEquals(payload.verse.arabic, BISMILLAH);
  assertEquals(payload.translation?.text, 'Surely with hardship comes ease.');
  assertEquals(payload.source.edition, 'Uthmani script (text_uthmani)');
  // Credited from the catalogue, because the embedded row carries no label — as live responses do.
  assertEquals(payload.translationSource?.edition, CATALOGUE.title);
  assertEquals(payload.translationSource?.attribution, CATALOGUE.translator);
  // There is no shape in which the translation could be attached to the scripture object.
  assertEquals('text' in payload.verse, false);
  assertEquals('translation' in payload.verse, false);
});

Deno.test('the daily verse refuses an ambiguous or mismatched translation', () => {
  const query = { operation: 'get_verse', surah: 94, ayah: 6, translationId: 131 } as const;

  // No translation came back for the requested edition.
  refusedFor(
    normalizePayload(query, { verse: { verse_key: '94:6', text_uthmani: BISMILLAH } }, CATALOGUE),
    'envelope',
  );
  // Two came back, and choosing one would be inventing a policy about whose rendering the user sees.
  refusedFor(
    normalizePayload(query, {
      verse: {
        verse_key: '94:6',
        text_uthmani: BISMILLAH,
        translations: [
          { resource_id: 131, resource_name: 'A', text: 'one' },
          { resource_id: 20, resource_name: 'B', text: 'two' },
        ],
      },
    }, CATALOGUE),
    'envelope',
  );
  // A different edition than the one asked for.
  refusedFor(
    normalizePayload(query, {
      verse: {
        verse_key: '94:6',
        text_uthmani: BISMILLAH,
        translations: [{ resource_id: 20, resource_name: 'B', text: 'two' }],
      },
    }, CATALOGUE),
    'resource_id',
  );
  // The wrong verse entirely. Refused on the scripture check, before any translation is looked at.
  refusedFor(
    normalizePayload(query, { verse: { verse_key: '94:5', text_uthmani: BISMILLAH } }),
    'shape',
  );
});

Deno.test('scripture alone is a complete daily payload when no translation was asked for', () => {
  const payload = value(
    normalizePayload(
      { operation: 'get_verse', surah: 94, ayah: 6, translationId: null },
      { verse: { verse_key: '94:6', text_uthmani: BISMILLAH } },
    ),
  );
  assert(payload.operation === 'get_verse', 'a single-verse payload came back');
  assertEquals(payload.translation, undefined);
  assertEquals(payload.translationSource, undefined);
});

Deno.test('every payload that carries content carries its source', () => {
  const verses = value(
    normalizePayload(
      { operation: 'list_verses', surah: 1, page: 1, perPage: 10 },
      verseBody([BISMILLAH]),
    ),
  );
  assert(verses.operation === 'list_verses', 'a verse-listing payload came back');
  assertEquals(verses.source.name, CONTENT_SOURCE_NAME);
  assertEquals(verses.source.verified, true);

  const translations = value(
    normalizePayload(
      { operation: 'list_verse_translations', surah: 18, translationId: 131, page: 1, perPage: 20 },
      translationBody([LABELLED_ROW]),
    ),
  );
  assert(
    translations.operation === 'list_verse_translations',
    'a translation-listing payload came back',
  );
  assertEquals(translations.source.name, CONTENT_SOURCE_NAME);
  assertEquals(translations.source.verified, true);
});

Deno.test('a daily verse nobody can be credited for is refused', () => {
  /**
   * No catalogue, no `meta`, no label on the embedded row. The Arabic is fine and the rendering is
   * real, but showing a translation with no attribution beside scripture is the outcome this path
   * exists to refuse.
   */
  refusedFor(
    normalizePayload(
      { operation: 'get_verse', surah: 94, ayah: 6, translationId: 131 },
      DAILY_BODY,
      undefined,
    ),
    'attribution',
  );
});

Deno.test('a daily verse falls back to response meta when the catalogue is unavailable', () => {
  const payload = value(
    normalizePayload(
      { operation: 'get_verse', surah: 94, ayah: 6, translationId: 131 },
      {
        ...DAILY_BODY,
        meta: {
          translation_name: 'The Clear Quran',
          author_name: 'Dr. Mustafa Khattab',
          filters: { verse_key: '94:6' },
        },
      },
      undefined,
    ),
  );
  assert(payload.operation === 'get_verse', 'a single-verse payload came back');
  assertEquals(payload.translationSource?.edition, 'The Clear Quran');
  assertEquals(payload.translationSource?.attribution, 'Dr. Mustafa Khattab');
});

Deno.test('scripture validation is untouched by the attribution change', () => {
  /**
   * The relaxation was to an optional *label on a translation*. Nothing about the Arabic moved: a
   * verse with no `text_uthmani`, an empty one, or one for a different verse is refused exactly as
   * before, whatever attribution is available.
   */
  const query = { operation: 'get_verse', surah: 94, ayah: 6, translationId: 131 } as const;
  for (
    const verse of [
      { verse_key: '94:6' },
      { verse_key: '94:6', text_uthmani: '' },
      { verse_key: '94:5', text_uthmani: BISMILLAH },
    ]
  ) {
    refusedFor(
      normalizePayload(
        query,
        { verse: { ...verse, translations: DAILY_BODY.verse.translations } },
        CATALOGUE,
      ),
      'shape',
      JSON.stringify(verse),
    );
  }
});
