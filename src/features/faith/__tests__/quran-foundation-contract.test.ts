import fs from 'node:fs';
import path from 'node:path';

import { createMockQuranRepository, mockAyatForTest } from '../data/mock';
import { surahNumber } from '../data/quran-content.repository';
import {
  MAX_CACHE_AGE_MS,
  createQuranFoundationRepository,
  defaultQuranCachePolicy,
  quranFoundationInvariants,
  validateCachePolicy,
} from '../data/quran-foundation/quran-foundation.contract';

/**
 * The Quran Foundation contract, and the rules that survive its implementation.
 *
 * Several of these assert against the *source text* of the feature directory rather than
 * against behaviour. That is deliberate: "no unofficial Qur'an API is called" is not a
 * property any runtime assertion can establish, because the offending code would be a
 * `fetch` that simply is not exercised by a test. Reading the files is the only way to
 * check it, so that is what these do.
 */

const FAITH_DIR = path.join(process.cwd(), 'src', 'features', 'faith');

function faithSourceFiles(dir: string = FAITH_DIR): readonly string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === '__tests__' ? [] : faithSourceFiles(full);
    }
    return entry.name.endsWith('.ts') || entry.name.endsWith('.tsx') ? [full] : [];
  });
}

describe('cache policy', () => {
  it('caps every window at one week', () => {
    expect(MAX_CACHE_AGE_MS).toBe(7 * 24 * 60 * 60 * 1000);
    expect(validateCachePolicy(defaultQuranCachePolicy)).toBe(defaultQuranCachePolicy);
  });

  it('rejects a window longer than a week', () => {
    expect(() =>
      validateCachePolicy({
        ...defaultQuranCachePolicy,
        scriptureMaxAgeMs: MAX_CACHE_AGE_MS + 1,
      }),
    ).toThrow(/one week/);
  });

  it('rejects a non-positive window', () => {
    expect(() =>
      validateCachePolicy({ ...defaultQuranCachePolicy, translationMaxAgeMs: 0 }),
    ).toThrow(/must be positive/);
  });
});

describe('the adapter is not implemented', () => {
  it('throws rather than degrading to an unofficial source', () => {
    expect(() =>
      createQuranFoundationRepository({
        endpointPath: '/functions/v1/quran-content',
        cachePolicy: defaultQuranCachePolicy,
        enabledTranslations: [],
        enabledReciters: [],
        serveStaleWhenOffline: true,
      }),
    ).toThrow(/pending approval/i);
  });

  it('records the invariants an implementation must satisfy', () => {
    expect(quranFoundationInvariants).toMatchObject({
      scriptureIsImmutable: true,
      noAutomaticTranslation: true,
      noUnofficialFallback: true,
      credentialsAreServerSide: true,
      sourceMetadataRequired: true,
      paginationRequired: true,
      maxCacheAgeMs: MAX_CACHE_AGE_MS,
    });
  });
});

describe('no secrets and no direct vendor calls in the Faith bundle', () => {
  const files = faithSourceFiles();

  it('finds source files to check', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it('contains no Quran Foundation or other Qur’an API hostname', () => {
    const forbidden = [
      'api.quran.foundation',
      'api.quran.com',
      'alquran.cloud',
      'api.alquran',
      'quranapi',
      'api.sunnah.com',
    ];
    for (const file of files) {
      const source = fs.readFileSync(file, 'utf8');
      for (const host of forbidden) {
        expect({
          file: path.relative(process.cwd(), file),
          host,
          found: source.includes(host),
        }).toEqual({ file: path.relative(process.cwd(), file), host, found: false });
      }
    }
  });

  it('makes no network call from the Faith feature at all', () => {
    for (const file of files) {
      const source = fs.readFileSync(file, 'utf8');
      const relative = path.relative(process.cwd(), file);
      // The README documents the future architecture in prose; the contract file names
      // `fetch` only inside a comment. Neither is code, and neither is a .ts file body
      // that calls it.
      expect({ file: relative, fetch: /\bfetch\s*\(/.test(source) }).toEqual({
        file: relative,
        fetch: false,
      });
      expect({ file: relative, xhr: /XMLHttpRequest/.test(source) }).toEqual({
        file: relative,
        xhr: false,
      });
    }
  });

  it('holds no credential-shaped constant', () => {
    const patterns = [
      /client[_-]?secret\s*[:=]\s*['"][^'"]+['"]/i,
      /api[_-]?key\s*[:=]\s*['"][^'"]+['"]/i,
      /bearer\s+[A-Za-z0-9._-]{20,}/i,
      /EXPO_PUBLIC_QURAN/,
    ];
    for (const file of files) {
      const source = fs.readFileSync(file, 'utf8');
      for (const pattern of patterns) {
        expect({
          file: path.relative(process.cwd(), file),
          pattern: pattern.source,
          found: pattern.test(source),
        }).toEqual({
          file: path.relative(process.cwd(), file),
          pattern: pattern.source,
          found: false,
        });
      }
    }
  });

  it('gives the client config nowhere to put a secret', () => {
    const contract = fs.readFileSync(
      path.join(FAITH_DIR, 'data', 'quran-foundation', 'quran-foundation.contract.ts'),
      'utf8',
    );
    const configBlock = contract.slice(
      contract.indexOf('export type QuranFoundationClientConfig'),
      contract.indexOf('export type QuranFoundationEndpoint'),
    );
    expect(configBlock).not.toMatch(/secret|apiKey|clientId|token|password/i);
  });
});

describe('Qur’an text immutability', () => {
  it('returns the fixture text byte-for-byte', async () => {
    const repository = createMockQuranRepository();
    const result = await repository.listAyahs(surahNumber(94));

    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      const sixth = result.data.items.find((item) => item.ayah === 6);
      expect(sixth?.arabic).toBe(mockAyatForTest['94:6']!.arabic);
    }
  });

  it('does not mutate the fixture when read repeatedly', async () => {
    const before = mockAyatForTest['94:6']!.arabic;
    const repository = createMockQuranRepository();
    await repository.listAyahs(surahNumber(94));
    await repository.getAyahOfTheDay('mock.en.clear');
    await repository.searchTranslations('ease', 'mock.en.clear');
    expect(mockAyatForTest['94:6']!.arabic).toBe(before);
  });

  it('keeps translation in a separate object from scripture', async () => {
    const repository = createMockQuranRepository();
    const daily = await repository.getAyahOfTheDay('mock.en.clear');

    expect(daily.kind).toBe('ok');
    if (daily.kind === 'ok') {
      // The scripture object has no translation field to confuse it with.
      expect(daily.data.text).not.toHaveProperty('text');
      expect(daily.data.text.arabic).not.toBe(daily.data.translation.text);
      expect(daily.data.translation.translationId).toBe('mock.en.clear');
    }
  });

  it('requires a translation id — there is no implicit default', async () => {
    const repository = createMockQuranRepository();
    const result = await repository.listTranslations(surahNumber(94), 'mock.en.plain');
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.data.items.every((item) => item.translationId === 'mock.en.plain')).toBe(true);
    }
  });

  it('stamps every fixture as unverified while approval is pending', async () => {
    const repository = createMockQuranRepository();
    const result = await repository.listAyahs(surahNumber(94));
    if (result.kind === 'ok') {
      expect(result.data.items.every((item) => !item.source.verified)).toBe(true);
    }
  });
});

describe('branded verse numbers', () => {
  it('rejects a surah outside 1–114', () => {
    expect(() => surahNumber(0)).toThrow(RangeError);
    expect(() => surahNumber(115)).toThrow(RangeError);
    expect(() => surahNumber(1.5)).toThrow(RangeError);
  });
});

describe('pagination', () => {
  it('pages rather than returning everything at once', async () => {
    const repository = createMockQuranRepository();
    const first = await repository.listAyahs(surahNumber(1), { limit: 2 });

    expect(first.kind).toBe('ok');
    if (first.kind === 'ok') {
      expect(first.data.items).toHaveLength(2);
      expect(first.data.nextCursor).not.toBeNull();

      const second = await repository.listAyahs(surahNumber(1), {
        limit: 2,
        cursor: first.data.nextCursor!,
      });
      if (second.kind === 'ok') {
        expect(second.data.items[0]?.ayah).not.toBe(first.data.items[0]?.ayah);
      }
    }
  });
});
