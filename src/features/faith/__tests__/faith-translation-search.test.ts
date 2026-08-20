import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { RetainedQuran } from '../data/offline/retained-quran.source';
import {
  MAX_TRANSLATION_MATCHES,
  MIN_QUERY_LENGTH,
  isSearchableQuery,
  searchRetainedTranslation,
} from '../data/quran-selection/translation-search';

/**
 * **Finding a verse by words you remember, without building a copy of the Qur'an to do it.**
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── The two claims that matter, and they pull against each other ───────────
 * The feature: somebody who remembers a phrase and not a reference can reach the verse. The
 * constraint: `searchDuaLibrary` refuses to search scripture because indexing it means keeping a second
 * copy — outside the refresh path, outside the account boundary, immune to an upstream correction.
 *
 * Both hold only if the search creates nothing. So the cases below check the behaviour *and* check the
 * module for the absence of any persistence: no storage import, no cache, no module-level mutable
 * state. A search that quietly memoised its results would pass every behavioural case here and break
 * the constraint the whole design rests on.
 *
 * ── The fixture renderings are synthetic ───────────────────────────────────
 * Plain English placeholder sentences, not a real translation of anything. Nothing asserted needs them
 * to be scripture, and a fixture is exactly where unverified religious text survives a deletion.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const TRANSLATOR = 'A Named Translator';
const EDITION = 'A Named Edition';

function generation(
  bySurah: ReadonlyMap<number, readonly { readonly ayah: number; readonly text: string }[]>,
  options: { readonly withTranslation?: boolean } = {},
): RetainedQuran {
  const withTranslation = options.withTranslation ?? true;
  return {
    generationId: 'test-generation',
    arabic: {
      generationId: 'test-generation',
      script: 'text_uthmani',
      lastCheckedAt: 0,
      source: { name: 'Quran Foundation', edition: 'Uthmani', verified: true },
      /* Synthetic Arabic-script text with a Latin marker, per this module's fixture rule. */
      bySurah: new Map([[2, [{ ayah: 255, text: 'ألف-probe-١' }]]]),
    },
    translations: withTranslation
      ? {
          generationId: 'test-generation',
          resourceId: 85,
          source: {
            name: 'Quran Foundation',
            edition: EDITION,
            attribution: TRANSLATOR,
            verified: true,
          },
          bySurah,
        }
      : null,
  };
}

const SAMPLE = new Map<number, readonly { readonly ayah: number; readonly text: string }[]>([
  [
    2,
    [
      { ayah: 255, text: 'a placeholder sentence about guardianship and the heavens' },
      { ayah: 286, text: 'a placeholder sentence about burden and capacity' },
    ],
  ],
  [
    112,
    [
      { ayah: 1, text: 'a placeholder sentence about oneness' },
      { ayah: 2, text: 'a placeholder sentence about self-sufficiency' },
    ],
  ],
]);

const names = new Map([
  [2, 'Al-Baqarah'],
  [112, 'Al-Ikhlas'],
]);

const search = (query: string, retained: RetainedQuran | null = generation(SAMPLE)) =>
  searchRetainedTranslation({ query, retained, surahNames: names });

describe('finding a verse by its words', () => {
  it('matches on a phrase the user remembers, without a reference or a surah name', () => {
    const result = search('guardianship');
    expect(result.state).toBe('ok');
    expect(result.matches.map((m) => m.reference)).toEqual(['2:255']);
    expect(result.matches[0]?.surahName).toBe('Al-Baqarah');
  });

  it('is case-insensitive, because nobody remembers capitalisation', () => {
    expect(search('ONENESS').matches.map((m) => m.reference)).toEqual(['112:1']);
    expect(search('Oneness').matches.map((m) => m.reference)).toEqual(['112:1']);
  });

  it('matches a partial word, and does not pretend to know synonyms', () => {
    /* "self" finds "self-sufficiency" — a substring of a word the user typed part of. */
    expect(search('self').matches.map((m) => m.reference)).toEqual(['112:2']);
    /*
      And "independence" finds nothing, though it means much the same thing. Stemming or synonyms would
      decide that a word the user did not type is close enough to a word in a rendering of the Qur'an,
      which is not a judgement this app makes.
    */
    expect(search('independence').matches).toEqual([]);
  });

  it('returns matches in the Qur’an’s own order, not by relevance', () => {
    /*
      "placeholder sentence" is in all four. Mushaf order is the one ordering every reader already
      knows; scoring renderings of scripture by match quality would impose one NoorLife cannot justify.
    */
    expect(search('placeholder sentence').matches.map((m) => m.reference)).toEqual([
      '2:255',
      '2:286',
      '112:1',
      '112:2',
    ]);
  });

  it('carries the translator and edition out with the results', () => {
    /*
      A snippet is translation text on screen, so the credit obligation applies to the result list and
      not only to the opened verse. Carried by the search so no caller can render rows without it.
    */
    const result = search('oneness');
    expect(result.translator).toBe(TRANSLATOR);
    expect(result.translationEdition).toBe(EDITION);
  });

  it('shows a bounded excerpt around the match, elided so it cannot pass for the whole verse', () => {
    const long = new Map([
      [
        2,
        [
          {
            ayah: 1,
            text: `${'padding word '.repeat(20)}needle${' trailing word'.repeat(20)}`,
          },
        ],
      ],
    ]);
    const result = searchRetainedTranslation({
      query: 'needle',
      retained: generation(long),
      surahNames: names,
    });
    const snippet = result.matches[0]?.snippet ?? '';

    expect(snippet).toContain('needle');
    expect(snippet.startsWith('…')).toBe(true);
    expect(snippet.endsWith('…')).toBe(true);
    /* Bounded, so a result row is a row and not a wall of the verse. */
    expect(snippet.length).toBeLessThan(200);
  });

  it('returns a short verse whole, with no misleading ellipsis', () => {
    const snippet = search('oneness').matches[0]?.snippet ?? '';
    expect(snippet).toBe('a placeholder sentence about oneness');
  });
});

describe('the bounds are stated rather than silent', () => {
  it('does not search a query below the floor, and says so instead of saying nothing matched', () => {
    for (const query of ['', ' ', 'a', 'on']) {
      const result = search(query);
      expect(result.state).toBe('too-short');
      expect(result.matches).toEqual([]);
      expect(isSearchableQuery(query)).toBe(false);
    }
    expect(MIN_QUERY_LENGTH).toBe(3);
    expect(isSearchableQuery('one')).toBe(true);
  });

  it('caps the list and reports exactly how many it left out', () => {
    const many = new Map([
      [
        2,
        Array.from({ length: MAX_TRANSLATION_MATCHES + 7 }, (_unused, index) => ({
          ayah: index + 1,
          text: 'a placeholder sentence containing needle',
        })),
      ],
    ]);
    const result = searchRetainedTranslation({
      query: 'needle',
      retained: generation(many),
      surahNames: names,
    });

    expect(result.matches).toHaveLength(MAX_TRANSLATION_MATCHES);
    /* The real remainder, counted past the cap — not the number found before the scan gave up. */
    expect(result.overflow).toBe(7);
  });

  it('reports no overflow when everything fitted', () => {
    expect(search('oneness').overflow).toBe(0);
  });
});

describe('the honest states when there is nothing to search', () => {
  it('distinguishes no generation at all from a generation with no translation', () => {
    expect(search('oneness', null).state).toBe('no-generation');

    const arabicOnly = generation(new Map(), { withTranslation: false });
    const result = searchRetainedTranslation({
      query: 'oneness',
      retained: arabicOnly,
      surahNames: names,
    });
    expect(result.state).toBe('no-translation');
    /* And neither is reported as an empty result, which would blame the user's words. */
    expect(result.matches).toEqual([]);
  });

  it('names no translator when there is no translation to credit', () => {
    expect(search('oneness', null).translator).toBeNull();
  });

  it('answers a real search that matched nothing as exactly that', () => {
    const result = search('unmatchable-string');
    expect(result.state).toBe('ok');
    expect(result.matches).toEqual([]);
    expect(result.overflow).toBe(0);
  });
});

describe('the Arabic is not searched, and nothing is transliterated', () => {
  it('does not match the Arabic side even when the query is the Arabic text', () => {
    /*
      The fixture's Arabic is `ألف-probe-١` and its translations contain no such string. A search for it
      finds nothing, because only the translation map is scanned.
    */
    const result = search('ألف-probe-١');
    expect(result.matches).toEqual([]);
  });

  it('mentions no transliteration or romanisation machinery in the module', () => {
    const source = readFileSync(
      join(__dirname, '..', 'data', 'quran-selection', 'translation-search.ts'),
      'utf8',
    );
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    /* No transliteration table, no fuzzy distance, no stemmer — each would be a guess about scripture. */
    expect(code).not.toMatch(/translitera|romanis|levenshtein|fuzzy|stem\(|soundex/i);
    /* And the Arabic map is never read. */
    expect(code).not.toMatch(/\.arabic\b/);
  });
});

describe('nothing is stored, which is what keeps the library rule intact', () => {
  const MODULE = join(__dirname, '..', 'data', 'quran-selection', 'translation-search.ts');

  it('imports no storage, no async storage and no filesystem', () => {
    const source = readFileSync(MODULE, 'utf8');
    expect(source).not.toMatch(/AsyncStorage|faith-storage|expo-file-system|node:fs/);
    /* It takes the generation as an argument; it never reads one for itself. */
    expect(source).not.toMatch(/retainedQuran\.read|useFaithRepositories/);
  });

  it('holds no module-level mutable state, so nothing survives a call', () => {
    const source = readFileSync(MODULE, 'utf8');
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    /*
      Module scope only — lines with no indentation. A `let` *inside* the scan is an ordinary local and
      dies with the call; a `let` at module scope is state that outlives it, which is the thing that
      would turn this into a cache.
    */
    const moduleScope = code
      .split('\n')
      .filter((line) => /^\S/.test(line))
      .join('\n');

    expect(moduleScope).not.toMatch(/^(?:let|var)\s/m);
    expect(moduleScope).not.toMatch(/\bnew (?:Map|WeakMap|Set)\(/);
    expect(moduleScope).not.toMatch(/cache|memo/i);
  });

  it('returns a fresh answer for the same query, rather than a remembered one', () => {
    const first = search('oneness');
    const second = search('oneness');
    /* Equal in value and not the same object: nothing was kept between the two calls. */
    expect(second.matches).toEqual(first.matches);
    expect(second.matches).not.toBe(first.matches);
  });

  it('follows a replaced generation without any invalidation step', () => {
    /*
      The refresh obligation, met by construction. The second call scans the new map because the map is
      the input — there is no cached index that could still be answering from the old one.
    */
    const replaced = new Map([[2, [{ ayah: 255, text: 'a corrected placeholder rendering' }]]]);
    expect(search('guardianship').matches).toHaveLength(1);
    expect(search('guardianship', generation(replaced)).matches).toEqual([]);
    expect(search('corrected', generation(replaced)).matches.map((m) => m.reference)).toEqual([
      '2:255',
    ]);
  });

  it('is the only scripture search in the Duas domain, and the library one still refuses', () => {
    /*
      `searchDuaLibrary` must keep its position: it searches metadata and never scripture. If it grew a
      translation scan it would be doing so over a *stored* list, which is the case the rule is about.
    */
    const library = readFileSync(join(__dirname, '..', 'data', 'duas', 'dua-library.ts'), 'utf8');
    const code = library.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/translation|arabic/i);

    for (const entry of readdirSync(join(__dirname, '..', 'data', 'duas'))) {
      const source = readFileSync(join(__dirname, '..', 'data', 'duas', entry), 'utf8');
      /* No Duas-domain module builds a searchable copy of scripture of its own. */
      expect(source).not.toMatch(/index(?:ed)?Translation|translationIndex/i);
    }
  });
});
