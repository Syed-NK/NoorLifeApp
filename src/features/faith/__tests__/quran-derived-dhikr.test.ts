import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import AsyncStorage from '@react-native-async-storage/async-storage';

import { MAX_CACHE_AGE_MS } from '../data/quran-foundation/quran-foundation.contract';
import { QURAN_CONTENT_ATTRIBUTION } from '../data/dhikr/quran-content-attribution';
import {
  approvedForProduction,
  isValidRange,
  PRODUCTION_DHIKR_CATALOGUE,
  productionDhikrEntries,
  referenceLabel,
  verseKeysFor,
  type CuratedDhikrReference,
} from '../data/dhikr/quran-dhikr-catalogue';
import { PENDING_DHIKR_REVIEW_QUEUE } from '../data/dhikr/quran-dhikr-catalogue.review';
import { resolveDhikrReference } from '../data/dhikr/quran-dhikr.repository';
import { createMockFaithRepositories } from '../data/mock';
import {
  ayahNumber,
  surahNumber,
  type AyahText,
  type AyahTranslation,
  type QuranContentRepository,
} from '../data/quran-content.repository';
import {
  arabicNeedsRefresh,
  pruneDhikrCache,
  readDhikrCache,
  translationsExpired,
  usableCacheEntry,
  writeDhikrCacheEntry,
  type CachedDhikrContent,
} from '../storage/faith-dhikr-cache';
import {
  forgetUnapprovedDhikr,
  readDhikrUserState,
  recordDhikrSelection,
  toggleDhikrFavourite,
} from '../storage/faith-dhikr-state';

/**
 * The Quran-derived Dhikr feature: what may ship, what may not, and what may be kept.
 *
 * ── The two permissions, and the one this feature still lacks ───────────────
 * Quran Foundation has given written permission for a Quran-derived Dhikr selector under NoorLife's
 * existing Content API access. That grant is real, recorded, and says nothing whatever about whether
 * a particular ayah is appropriate as a dhikr — which is a religious judgement, is NoorLife's
 * obligation, and has not been obtained.
 *
 * Conflating the two is the failure mode this file exists to make impossible. Five source-less dhikr
 * presets once shipped in this app and had to be removed; a developer choosing verses from memory is
 * how they got there. So the production catalogue is empty, and these cases assert it stays that way
 * until a reviewer supplies what `approvedForProduction` demands.
 */

const SOURCE_ROOT = join(__dirname, '..', '..', '..');

/** Every `.ts`/`.tsx` file under `src/`, so a scan cannot miss a directory somebody added. */
function sourceFiles(directory: string = SOURCE_ROOT): readonly string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      found.push(...sourceFiles(path));
    } else if (/\.tsx?$/.test(entry)) {
      found.push(path);
    }
  }
  return found;
}

/** A well-formed approved entry, for the cases that need one. Never added to the real catalogue. */
function approvedFixture(overrides: Partial<CuratedDhikrReference> = {}): CuratedDhikrReference {
  return {
    id: 'test.entry',
    surah: 1,
    startAyah: 1,
    endAyah: 2,
    title: 'A reviewed selection',
    category: 'quranic-remembrance',
    recommendedTarget: null,
    reviewStatus: 'approved',
    review: { reviewer: 'A Reviewer', source: 'A citable work', reviewedOn: '2026-08-15' },
    contextNote: 'Why this reference is offered.',
    enabled: true,
    version: 1,
    ...overrides,
  };
}

beforeEach(async () => {
  await AsyncStorage.clear();
});

// ─────────────────────────────────────────────────────────────────────────────
// The bundle carries references, never scripture
// ─────────────────────────────────────────────────────────────────────────────

describe('no Quran text is hard-coded in the bundle', () => {
  it('has no Arabic in the Dhikr data layer', () => {
    /*
      A blunt instrument on purpose. Any Arabic-block codepoint in these files means scripture entered
      the source bundle, where it is outside the refresh path, immune to a correction upstream, and
      editable by a well-meant tidy-up nobody reviews closely. The permission's first mandatory
      requirement is that Arabic remains unchanged; keeping it out of the bundle is how that is
      enforced structurally rather than by inspection.
    */
    const arabic = /[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/;
    for (const path of sourceFiles(join(SOURCE_ROOT, 'features', 'faith', 'data', 'dhikr'))) {
      expect({
        file: relative(SOURCE_ROOT, path),
        hasArabic: arabic.test(readFileSync(path, 'utf8')),
      }).toEqual({ file: relative(SOURCE_ROOT, path), hasArabic: false });
    }
  });

  it('models a reference as endpoints, with no field that could hold text', () => {
    const entry = approvedFixture();
    /* There is nowhere to put Arabic, a translation or a transliteration. That is the design. */
    expect(Object.keys(entry).sort()).toEqual(
      [
        'category',
        'contextNote',
        'enabled',
        'endAyah',
        'id',
        'recommendedTarget',
        'review',
        'reviewStatus',
        'startAyah',
        'surah',
        'title',
        'version',
      ].sort(),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The scholarly-review gate
// ─────────────────────────────────────────────────────────────────────────────

describe('only scholarly-approved entries reach production', () => {
  it('ships an empty production catalogue', () => {
    /*
      The expected state for this release, and it is not a placeholder. The architecture is complete;
      the data is what would be a fabrication.
    */
    expect(PRODUCTION_DHIKR_CATALOGUE).toHaveLength(0);
    expect(productionDhikrEntries()).toHaveLength(0);
  });

  it('keeps the development review queue out of production', () => {
    /* Whatever is proposed there is pending, and pending never ships. */
    for (const entry of PENDING_DHIKR_REVIEW_QUEUE) {
      expect(entry.reviewStatus).toBe('pending');
      expect(approvedForProduction(entry)).toBe(false);
    }
    expect(productionDhikrEntries(PENDING_DHIKR_REVIEW_QUEUE)).toHaveLength(0);
  });

  it('is not imported by anything on a production path', () => {
    /*
      The second, independent guard. The gate is a runtime check and runtime checks get relaxed; a
      file nothing imports cannot be shipped by a call site that decided to be helpful.
    */
    /*
      Matched on an actual `import`/`require` of the module, not on any mention of its name — the
      catalogue's own doc comment refers to the review file by name to explain why it exists, and a
      scan that counted prose would make the two files unable to reference each other in writing.
    */
    const imports =
      /(?:from\s*['"][^'"]*quran-dhikr-catalogue\.review['"]|require\(\s*['"][^'"]*quran-dhikr-catalogue\.review['"])/;
    const importers = sourceFiles()
      .filter((path) => !path.includes('__tests__'))
      .filter((path) => imports.test(readFileSync(path, 'utf8')));
    expect(importers.map((path) => relative(SOURCE_ROOT, path))).toEqual([]);
  });

  it('rejects an entry for each thing that could make it unsafe', () => {
    expect(approvedForProduction(approvedFixture())).toBe(true);

    /* Not reviewed, reviewed-and-rejected, or withdrawn after approval. */
    expect(approvedForProduction(approvedFixture({ reviewStatus: 'pending' }))).toBe(false);
    expect(approvedForProduction(approvedFixture({ reviewStatus: 'rejected' }))).toBe(false);
    expect(approvedForProduction(approvedFixture({ reviewStatus: 'withdrawn' }))).toBe(false);

    /* Deliberately taken out of circulation. */
    expect(approvedForProduction(approvedFixture({ enabled: false }))).toBe(false);

    /* No reviewer to point at — an empty name is the same as no record. */
    expect(approvedForProduction(approvedFixture({ review: null }))).toBe(false);
    expect(
      approvedForProduction(
        approvedFixture({
          review: { reviewer: '   ', source: 'A work', reviewedOn: '2026-08-15' },
        }),
      ),
    ).toBe(false);
    expect(
      approvedForProduction(
        approvedFixture({ review: { reviewer: 'A', source: '  ', reviewedOn: '2026-08-15' } }),
      ),
    ).toBe(false);

    /* No context note — the permission requires the original context be preserved. */
    expect(approvedForProduction(approvedFixture({ contextNote: null }))).toBe(false);
    expect(approvedForProduction(approvedFixture({ contextNote: '  ' }))).toBe(false);

    /* An impossible reference. */
    expect(approvedForProduction(approvedFixture({ surah: 115 }))).toBe(false);
    expect(approvedForProduction(approvedFixture({ startAyah: 0 }))).toBe(false);
    expect(approvedForProduction(approvedFixture({ startAyah: 5, endAyah: 2 }))).toBe(false);
  });

  it('never invents a recommended count', () => {
    /*
      `null` is the safe default and the honest one. A count NoorLife chose — or inferred from a
      familiar practice — would be an invented religious instruction wearing the catalogue's
      authority. The gate does not require one, so an entry without a reviewed count still ships and
      simply offers none.
    */
    expect(approvedFixture().recommendedTarget).toBeNull();
    expect(approvedForProduction(approvedFixture({ recommendedTarget: null }))).toBe(true);
  });

  it('validates ranges and renders them as references', () => {
    expect(isValidRange(approvedFixture({ startAyah: 3, endAyah: 3 }))).toBe(true);
    expect(referenceLabel(approvedFixture({ surah: 2, startAyah: 255, endAyah: 255 }))).toBe(
      '2:255',
    );
    expect(referenceLabel(approvedFixture({ surah: 59, startAyah: 22, endAyah: 24 }))).toBe(
      '59:22-24',
    );
    expect(verseKeysFor(approvedFixture({ surah: 59, startAyah: 22, endAyah: 24 }))).toEqual([
      '59:22',
      '59:23',
      '59:24',
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Retrieval binds by verse key and fails closed
// ─────────────────────────────────────────────────────────────────────────────

const SOURCE = { name: 'Test source', verified: true } as const;

function quranReturning(options: {
  readonly text?: readonly AyahText[];
  readonly translations?: readonly AyahTranslation[];
  readonly textFails?: boolean;
}): QuranContentRepository {
  const base = createMockFaithRepositories().quran;
  return {
    ...base,
    async listAyahs() {
      if (options.textFails === true) {
        return { kind: 'error', code: 'unavailable' };
      }
      return { kind: 'ok', data: { items: options.text ?? [], nextCursor: null } };
    },
    async listTranslations() {
      return { kind: 'ok', data: { items: options.translations ?? [], nextCursor: null } };
    },
  };
}

function text(surah: number, ayah: number, arabic: string): AyahText {
  return { surah: surahNumber(surah), ayah: ayahNumber(ayah), arabic, source: SOURCE };
}

function translation(
  surah: number,
  ayah: number,
  body: string,
  translator?: string,
): AyahTranslation {
  return {
    surah: surahNumber(surah),
    ayah: ayahNumber(ayah),
    translationId: '85',
    text: body,
    source: translator === undefined ? SOURCE : { ...SOURCE, attribution: translator },
  };
}

describe('content is bound to the reference it was fetched for', () => {
  const entry = approvedFixture({ surah: 1, startAyah: 1, endAyah: 2 });

  it('resolves an entry, preserving order and crediting the translator', async () => {
    const quran = quranReturning({
      /* Deliberately out of order, so "preserves ordering" is a real assertion. */
      text: [text(1, 2, 'ARABIC-1-2'), text(1, 1, 'ARABIC-1-1')],
      translations: [
        translation(1, 1, 'meaning one', 'A Translator'),
        translation(1, 2, 'meaning two', 'A Translator'),
      ],
    });

    const outcome = await resolveDhikrReference(quran, entry, '85');
    expect(outcome.kind).toBe('resolved');
    if (outcome.kind !== 'resolved') {
      return;
    }
    expect(outcome.data.verses.map((verse) => verse.verseKey)).toEqual(['1:1', '1:2']);
    /* Copied byte for byte — nothing on this path trims, normalises or re-points. */
    expect(outcome.data.verses[0]?.arabic).toBe('ARABIC-1-1');
    expect(outcome.data.translator).toBe('A Translator');
  });

  it('refuses when a verse of the range did not arrive', async () => {
    const quran = quranReturning({
      text: [text(1, 1, 'ARABIC-1-1')],
      translations: [translation(1, 1, 'meaning one', 'A Translator')],
    });

    /*
      Partial rendering is the tempting failure here, and it is the wrong one: a dhikr captioned as a
      two-verse range showing one verse is a misquotation.
    */
    expect(await resolveDhikrReference(quran, entry, '85')).toEqual({
      kind: 'failed',
      reason: 'binding-failed',
    });
  });

  it('never derives a verse from its position in the array', async () => {
    /*
      The source returns two verses — but they are 1:3 and 1:4, not the 1:1 and 1:2 that were asked
      for. A positional reading would render them under the wrong reference; a key-based one refuses.
    */
    const quran = quranReturning({
      text: [text(1, 3, 'ARABIC-1-3'), text(1, 4, 'ARABIC-1-4')],
      translations: [
        translation(1, 3, 'meaning three', 'A Translator'),
        translation(1, 4, 'meaning four', 'A Translator'),
      ],
    });

    expect(await resolveDhikrReference(quran, entry, '85')).toEqual({
      kind: 'failed',
      reason: 'binding-failed',
    });
  });

  it('refuses a translation with no translator', async () => {
    const quran = quranReturning({
      text: [text(1, 1, 'ARABIC-1-1'), text(1, 2, 'ARABIC-1-2')],
      /* No `attribution`, so there is nobody to credit. */
      translations: [translation(1, 1, 'meaning one'), translation(1, 2, 'meaning two')],
    });

    expect(await resolveDhikrReference(quran, entry, '85')).toEqual({
      kind: 'failed',
      reason: 'attribution-missing',
    });
  });

  it('refuses when no translation edition has been resolved', async () => {
    const quran = quranReturning({ text: [text(1, 1, 'A'), text(1, 2, 'B')] });
    expect(await resolveDhikrReference(quran, entry, null)).toEqual({
      kind: 'failed',
      reason: 'no-translation-selected',
    });
  });

  it('reports an unavailable source separately from a binding failure', async () => {
    const quran = quranReturning({ textFails: true });
    expect(await resolveDhikrReference(quran, entry, '85')).toEqual({
      kind: 'failed',
      reason: 'unavailable',
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Attribution
// ─────────────────────────────────────────────────────────────────────────────

describe('attribution', () => {
  it('pins the required sentence byte for byte', () => {
    expect(QURAN_CONTENT_ATTRIBUTION).toBe(
      'Quran text and translations provided by Quran Foundation (Quran.com).',
    );
  });

  it('exists as one constant and is never retyped as a literal', () => {
    /*
      A licence condition met in three places and broken in a fourth is broken. The sentence may
      appear only in the file that defines it — everywhere else reads the constant.
    */
    const offenders = sourceFiles()
      .filter((path) => !path.includes('__tests__'))
      .filter((path) => !path.endsWith('quran-content-attribution.ts'))
      .filter((path) => readFileSync(path, 'utf8').includes(QURAN_CONTENT_ATTRIBUTION));
    expect(offenders.map((path) => relative(SOURCE_ROOT, path))).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The private cache, and its two different retention rules
// ─────────────────────────────────────────────────────────────────────────────

function cached(overrides: Partial<CachedDhikrContent> = {}): CachedDhikrContent {
  const now = Date.now();
  return {
    entryId: 'test.entry',
    version: 1,
    verses: [{ verseKey: '1:1', arabic: 'ARABIC-1-1', translation: 'meaning one' }],
    translator: 'A Translator',
    refreshedAt: now,
    translationFetchedAt: now,
    ...overrides,
  };
}

describe('the private cache keeps Arabic and translations under different rules', () => {
  it('drops a translation past one week and keeps the Arabic', () => {
    const stale = cached({ translationFetchedAt: Date.now() - MAX_CACHE_AGE_MS - 1 });
    expect(translationsExpired(stale)).toBe(true);

    const usable = usableCacheEntry(stale);
    /* The scripture is retained legitimately and stays available… */
    expect(usable.verses[0]?.arabic).toBe('ARABIC-1-1');
    /* …and the translation, which has no Content Sync behind it, does not. */
    expect(usable.verses[0]?.translation).toBe('');
    /* The translator goes with the text it credited, rather than crediting nothing. */
    expect(usable.translator).toBe('');
  });

  it('treats an aged Arabic copy as due a refresh, not as unusable', () => {
    const stale = cached({ refreshedAt: Date.now() - MAX_CACHE_AGE_MS - 1 });
    expect(arabicNeedsRefresh(stale)).toBe(true);
    /* Still readable — the permission allows a safe last-known copy while offline. */
    expect(usableCacheEntry(stale).verses[0]?.arabic).toBe('ARABIC-1-1');
  });

  it('treats a clock that moved backwards as expired rather than fresh', () => {
    expect(translationsExpired(cached({ translationFetchedAt: Date.now() + 60_000 }))).toBe(true);
  });

  it('prunes entries the catalogue no longer approves', async () => {
    await writeDhikrCacheEntry(cached({ entryId: 'kept' }));
    await writeDhikrCacheEntry(cached({ entryId: 'withdrawn' }));

    await pruneDhikrCache(new Set(['kept']));

    /* "Corrections and removals are applied promptly" — a withdrawn reference loses its text. */
    expect((await readDhikrCache()).map((item) => item.entryId)).toEqual(['kept']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The user's own state, which never expires
// ─────────────────────────────────────────────────────────────────────────────

describe('user state survives content expiry', () => {
  it('keeps the selection and favourites in a separate key from the cache', async () => {
    await recordDhikrSelection('test.entry');
    await toggleDhikrFavourite('test.entry');
    await writeDhikrCacheEntry(cached());

    /* Expiring every cached translation must not touch the user's own record. */
    await pruneDhikrCache(new Set(['test.entry']), Date.now() + MAX_CACHE_AGE_MS + 1);

    const state = await readDhikrUserState();
    expect(state.selectedEntryId).toBe('test.entry');
    expect(state.favouriteEntryIds).toEqual(['test.entry']);
    expect(state.recentEntryIds).toEqual(['test.entry']);
  });

  it('stores a reference rather than a copy of the content', async () => {
    await recordDhikrSelection('test.entry');
    const raw = JSON.stringify(await readDhikrUserState());
    /* An id and nothing else — no Arabic, no translation, no title. */
    expect(raw).not.toContain('ARABIC');
    expect(raw).not.toContain('meaning');
  });

  it('does not repeat an entry in recents when it is chosen twice', async () => {
    await recordDhikrSelection('a');
    await recordDhikrSelection('b');
    await recordDhikrSelection('a');
    expect((await readDhikrUserState()).recentEntryIds).toEqual(['a', 'b']);
  });

  it('forgets a reference the catalogue withdrew, without touching counts', async () => {
    await recordDhikrSelection('withdrawn');
    await toggleDhikrFavourite('withdrawn');

    const state = await forgetUnapprovedDhikr(new Set<string>());

    /* Unselectable and no longer offered… */
    expect(state.selectedEntryId).toBeNull();
    expect(state.favouriteEntryIds).toEqual([]);
    expect(state.recentEntryIds).toEqual([]);
    /* …and nothing here reaches the Tasbih store, where the user's counts live. */
    expect(await AsyncStorage.getItem('noorlife.faith.tasbih.session')).toBeNull();
  });
});
