import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { WireEdition } from '@features/faith/data/quran-foundation/quran-foundation.contract';
import {
  isPublishableAttribution,
  resolveTranslationAttribution,
} from '@features/faith/data/sync/translation-attribution';
import { TRANSLATION_RESOURCE_ID } from '@features/faith/data/sync/content-sync.orchestrator';

/**
 * Resolving who translated the text, from the publisher's own catalogue.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── The device state that prompted this ────────────────────────────────────
 * The live generation holds 6,236 valid translation rows and `attribution: null`. Attribution was
 * only ever carried forward from the previous generation and never sourced, so it started null on
 * bootstrap and every later generation inherited the null faithfully.
 *
 * These cases are about the *refusals* far more than the success. A wrong translator name attached
 * to scripture is worse than a missing one, so every ambiguous catalogue must fail closed and say
 * which kind of ambiguity it was.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const ENGLISH = 'english';

function edition(over: Partial<WireEdition> = {}): WireEdition {
  return {
    id: '85',
    language: 'english',
    name: 'M.A.S. Abdel Haleem',
    translator: 'Abdul Haleem',
    ...over,
  } as WireEdition;
}

describe('resolving resource 85 from the catalogue', () => {
  it('returns the edition name and translator the catalogue states', () => {
    const result = resolveTranslationAttribution([edition()], TRANSLATION_RESOURCE_ID, ENGLISH);

    expect(result).toEqual({
      kind: 'resolved',
      attribution: {
        resourceId: 85,
        name: 'M.A.S. Abdel Haleem',
        translator: 'Abdul Haleem',
      },
    });
  });

  it('matches on the exact resource id, never on position or proximity', () => {
    /*
      A catalogue is a list, and reading "the first English one" would attribute resource 85's text
      to whichever translation the vendor happened to return first.
    */
    const catalogue = [
      edition({ id: '20', name: 'Sahih International', translator: 'Sahih International' }),
      edition({ id: '84', name: 'Another Edition', translator: 'Another Translator' }),
      edition(),
      edition({ id: '86', name: 'Yet Another', translator: 'Someone Else' }),
    ];

    const result = resolveTranslationAttribution(catalogue, TRANSLATION_RESOURCE_ID, ENGLISH);
    expect(result.kind === 'resolved' && result.attribution.translator).toBe('Abdul Haleem');
  });

  it('trims surrounding whitespace without otherwise altering the names', () => {
    const result = resolveTranslationAttribution(
      [edition({ name: '  M.A.S. Abdel Haleem  ', translator: ' Abdul Haleem ' })],
      TRANSLATION_RESOURCE_ID,
      ENGLISH,
    );
    expect(result.kind === 'resolved' && result.attribution.name).toBe('M.A.S. Abdel Haleem');
    expect(result.kind === 'resolved' && result.attribution.translator).toBe('Abdul Haleem');
  });
});

describe('catalogues that must not produce an attribution', () => {
  it('refuses when the catalogue does not name the resource', () => {
    /*
      The case that matters most: there is a *known* expected answer for resource 85, and this module
      must still refuse rather than supply it. Hard-coding the identity here would make the app claim
      a translator the publisher did not confirm on this run.
    */
    const result = resolveTranslationAttribution(
      [edition({ id: '20', name: 'Sahih International', translator: 'Sahih International' })],
      TRANSLATION_RESOURCE_ID,
      ENGLISH,
    );
    expect(result).toEqual({ kind: 'absent' });
  });

  it('refuses an empty catalogue', () => {
    expect(resolveTranslationAttribution([], TRANSLATION_RESOURCE_ID, ENGLISH)).toEqual({
      kind: 'absent',
    });
  });

  it('accepts duplicate rows that agree, because a paginated list may repeat one', () => {
    const result = resolveTranslationAttribution(
      [edition(), edition(), edition()],
      TRANSLATION_RESOURCE_ID,
      ENGLISH,
    );
    expect(result.kind).toBe('resolved');
  });

  it('refuses duplicate rows that disagree, rather than taking the first', () => {
    /*
      Picking a winner would make the displayed translator depend on response ordering — a value that
      changes between runs for reasons no user could see.
    */
    const result = resolveTranslationAttribution(
      [edition(), edition({ translator: 'Someone Else' })],
      TRANSLATION_RESOURCE_ID,
      ENGLISH,
    );
    expect(result).toEqual({ kind: 'conflicting' });
  });

  it('treats a casing difference as a conflict rather than silently merging', () => {
    const result = resolveTranslationAttribution(
      [edition(), edition({ translator: 'abdul haleem' })],
      TRANSLATION_RESOURCE_ID,
      ENGLISH,
    );
    expect(result).toEqual({ kind: 'conflicting' });
  });

  it.each([
    ['an empty translator', { translator: '' }],
    ['a whitespace translator', { translator: '   ' }],
    ['an empty edition name', { name: '' }],
  ])('refuses %s', (_label, over) => {
    expect(
      resolveTranslationAttribution([edition(over)], TRANSLATION_RESOURCE_ID, ENGLISH),
    ).toEqual({ kind: 'incomplete' });
  });

  it('refuses a catalogue row in the wrong language', () => {
    const result = resolveTranslationAttribution(
      [edition({ language: 'urdu' })],
      TRANSLATION_RESOURCE_ID,
      ENGLISH,
    );
    expect(result).toEqual({ kind: 'wrong-language' });
  });

  it('distinguishes its refusals rather than collapsing them', () => {
    /*
      Three different faults with three different fixes: ask the vendor why the catalogue is silent,
      why it contradicts itself, or why it moved the resource to another language.
    */
    const kinds = new Set([
      resolveTranslationAttribution([], TRANSLATION_RESOURCE_ID, ENGLISH).kind,
      resolveTranslationAttribution(
        [edition(), edition({ translator: 'Other' })],
        TRANSLATION_RESOURCE_ID,
        ENGLISH,
      ).kind,
      resolveTranslationAttribution(
        [edition({ language: 'urdu' })],
        TRANSLATION_RESOURCE_ID,
        ENGLISH,
      ).kind,
      resolveTranslationAttribution([edition({ translator: '' })], TRANSLATION_RESOURCE_ID, ENGLISH)
        .kind,
    ]);
    expect(kinds.size).toBe(4);
  });
});

describe('what may be published beside translation rows', () => {
  it('accepts a complete attribution bound to the same resource', () => {
    expect(
      isPublishableAttribution(
        { resourceId: 85, name: 'M.A.S. Abdel Haleem', translator: 'Abdul Haleem' },
        85,
      ),
    ).toBe(true);
  });

  it('refuses attribution belonging to a different resource', () => {
    /*
      Misattribution is worse than absence: it names a real translator as the author of text they did
      not write. The resource id on the attribution must match the rows it is bound to.
    */
    expect(
      isPublishableAttribution(
        { resourceId: 20, name: 'Sahih International', translator: 'Sahih International' },
        85,
      ),
    ).toBe(false);
  });

  it('refuses null, which is exactly the state on the device today', () => {
    expect(isPublishableAttribution(null, 85)).toBe(false);
  });

  it.each([
    ['an empty translator', { resourceId: 85, name: 'Edition', translator: '' }],
    ['a whitespace translator', { resourceId: 85, name: 'Edition', translator: '  ' }],
    ['an empty name', { resourceId: 85, name: '', translator: 'Abdul Haleem' }],
  ])('refuses %s', (_label, attribution) => {
    expect(isPublishableAttribution(attribution, 85)).toBe(false);
  });
});

describe('what this repair deliberately does not do', () => {
  it('introduces no Arabic Qur’an text anywhere in the module', () => {
    /*
      The attribution repair is scoped to resource 85 metadata. Retaining the complete Arabic Qur'an
      for the offline reader is a separate, still-unanswered permission question, and this file must
      not become the place somebody quietly starts.
    */
    const source = readFileSync(
      join(__dirname, '..', 'data', 'sync', 'translation-attribution.ts'),
      'utf8',
    );
    expect(source).not.toMatch(/[؀-ۿ]/);
  });

  it('hard-codes no translator identity as a fallback', () => {
    const source = readFileSync(
      join(__dirname, '..', 'data', 'sync', 'translation-attribution.ts'),
      'utf8',
    );
    /* The names appear only in prose explaining what the catalogue is expected to say. */
    const code = source
      .split('\n')
      .filter((line) => !/^\s*(\*|\/\*|\/\/)/.test(line))
      .join('\n');
    expect(code).not.toContain('Abdul Haleem');
    expect(code).not.toContain('Abdel Haleem');
  });
});
