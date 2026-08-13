import fs from 'node:fs';
import path from 'node:path';

import { createMockQuranRepository, mockAyatForTest } from '../data/mock';
import { surahNumber } from '../data/quran-content.repository';
import {
  MAX_CACHE_AGE_MS,
  MAX_PAGE_SIZE,
  QURAN_CONTENT_CLIENT_TIMEOUT_MS,
  QURAN_CONTENT_CONTRACT_VERSION,
  QURAN_CONTENT_FUNCTION_NAME,
  QURAN_CONTENT_OPERATIONS,
  QURAN_FOUNDATION_SOURCE,
  defaultQuranCachePolicy,
  quranFoundationApproval,
  quranFoundationInvariants,
  validateCachePolicy,
} from '../data/quran-foundation/quran-foundation.contract';

/**
 * The Quran Foundation contract, and the rules that survived its implementation.
 *
 * ── What changed, and what deliberately did not ─────────────────────────────
 * Production Content API access was approved on 2026-08-10, so the assertion that the adapter throws
 * rather than existing is gone — there is an adapter now, and `quran-foundation-adapter.test.ts`
 * drives it. Every other rule in this file is unchanged, which is the point of having written them
 * down before there was anything to check them against: an implementation inherits its predecessor's
 * invariants rather than renegotiating them.
 *
 * Several assertions below read the *source text* of the feature directory rather than behaviour.
 * That is deliberate: "no unofficial Qur'an API is called" is not a property any runtime assertion can
 * establish, because the offending code would be a request no test happened to exercise. Reading the
 * files is the only way to check it, so that is what these do.
 */

const REPO_ROOT = process.cwd();
const FAITH_DIR = path.join(REPO_ROOT, 'src', 'features', 'faith');
const FUNCTION_DIR = path.join(REPO_ROOT, 'supabase', 'functions', 'quran-content');

function faithSourceFiles(dir: string = FAITH_DIR): readonly string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === '__tests__' ? [] : faithSourceFiles(full);
    }
    return entry.name.endsWith('.ts') || entry.name.endsWith('.tsx') ? [full] : [];
  });
}

/** Executable text only, so a comment explaining a prohibition is not what fails a scan. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

describe('the approval this integration rests on', () => {
  it('records the date, the scope, and what remains unapproved', () => {
    expect(quranFoundationApproval.approvedOn).toBe('2026-08-10');
    expect(quranFoundationApproval.scope).toBe('content');
    expect(quranFoundationApproval.credentialLocation).toBe('supabase-function-secrets');
    // Search is the one with a visible product consequence — see `searchTranslations`.
    expect(quranFoundationApproval.unapproved).toContain('search');
    expect(quranFoundationApproval.unapproved).toContain('oauth-user-apis');
    expect(quranFoundationApproval.unapproved).toContain('bookmarks');
  });

  it('does not claim any scope beyond content', () => {
    expect(quranFoundationApproval.unapproved.length).toBeGreaterThanOrEqual(4);
    expect(quranFoundationInvariants.searchIsUnsupported).toBe(true);
  });
});

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

  it('uses the shorter windows for translations and catalogues', () => {
    /**
     * Scripture does not change, so it takes the full licence window. Translations are revisable by
     * their publishers and catalogues change when the vendor adds an edition, so both take a day —
     * short enough that a correction reaches users without an app release.
     */
    expect(defaultQuranCachePolicy.scriptureMaxAgeMs).toBe(MAX_CACHE_AGE_MS);
    expect(defaultQuranCachePolicy.translationMaxAgeMs).toBeLessThan(MAX_CACHE_AGE_MS);
    expect(defaultQuranCachePolicy.catalogueMaxAgeMs).toBeLessThan(MAX_CACHE_AGE_MS);
  });

  it('agrees with the edge function about the licence ceiling', () => {
    /**
     * A client and a server disagreeing about a licence term is the kind of drift nobody notices, so
     * the two constants are pinned to each other rather than each being "obviously" a week.
     */
    const contract = fs.readFileSync(path.join(FUNCTION_DIR, 'contract.ts'), 'utf8');
    const declared = /export const MAX_CACHE_AGE_MS = ([^;]+);/.exec(contract);
    expect(declared).not.toBeNull();

    /**
     * The declared value is a product of literals — `7 * 24 * 60 * 60 * 1000` — so it is multiplied
     * out rather than evaluated. Reading a committed file and handing it to `eval` would make this
     * test execute whatever that file happens to contain, which is a strange capability for an
     * assertion about a constant to have.
     */
    const factors = (declared?.[1] ?? '').split('*').map((part) => Number(part.trim()));
    expect(factors.every((factor) => Number.isFinite(factor))).toBe(true);
    expect(factors.reduce((product, factor) => product * factor, 1)).toBe(MAX_CACHE_AGE_MS);
  });
});

describe('the mirrored wire contract matches the committed edge function', () => {
  const serverContract = fs.readFileSync(path.join(FUNCTION_DIR, 'contract.ts'), 'utf8');

  it('uses the server’s contract version', () => {
    const declared = /export const CONTRACT_VERSION = ([0-9]+);/.exec(serverContract);
    expect(declared).not.toBeNull();
    expect(QURAN_CONTENT_CONTRACT_VERSION).toBe(Number(declared?.[1]));
  });

  it('mirrors the approved operation list exactly', () => {
    const declared =
      /export const QURAN_OPERATIONS: readonly QuranOperation\[\] = \[([^\]]*)\]/.exec(
        serverContract,
      );
    expect(declared).not.toBeNull();
    const serverOperations = [...(declared?.[1] ?? '').matchAll(/'([^']+)'/g)].map((m) => m[1]);

    expect([...QURAN_CONTENT_OPERATIONS]).toEqual(serverOperations);
    /*
      Eight content reads, and no search or user operation among them.

      It was seven until verse-level recitation was approved and `list_verse_recitations` was added.
      The count is asserted rather than merely compared to the server's list because the two lists
      agreeing proves they were changed together, and the number proves the change was *this* one —
      an operation added to both sides at once would otherwise pass silently.
    */
    expect(serverOperations).toHaveLength(8);
    for (const forbidden of ['search', 'bookmarks', 'notes', 'sync']) {
      expect(serverOperations.some((name) => (name ?? '').includes(forbidden))).toBe(false);
    }
  });

  it('never asks for more than the vendor’s documented page size', () => {
    const declared = /export const MAX_PER_PAGE = ([0-9]+);/.exec(serverContract);
    expect(declared).not.toBeNull();
    expect(MAX_PAGE_SIZE).toBe(Number(declared?.[1]));
  });

  it('keeps the client deadline above the committed handler budget', () => {
    /**
     * The server owns the deadline. A client that gave up first would abandon a request the server is
     * still completing, and the user would see a timeout for a request that was answered.
     */
    const budget = /handlerBudgetMs: ([0-9_]+)/.exec(
      fs.readFileSync(path.join(FUNCTION_DIR, 'production.ts'), 'utf8'),
    );
    expect(budget).not.toBeNull();
    expect(QURAN_CONTENT_CLIENT_TIMEOUT_MS).toBeGreaterThan(
      Number((budget?.[1] ?? '0').replace(/_/g, '')),
    );
  });

  it('names a function rather than an address', () => {
    expect(QURAN_CONTENT_FUNCTION_NAME).toBe('quran-content');
    expect(QURAN_CONTENT_FUNCTION_NAME).not.toMatch(/https?:|\//);
  });

  it('is declared with verify_jwt in version control', () => {
    /**
     * A public `quran-content` would be NoorLife's approved Quran Foundation credential proxied for
     * the open internet. Asserted here as well as in the function's own Deno suite, because this is
     * the suite a developer runs by habit.
     */
    const config = fs.readFileSync(path.join(REPO_ROOT, 'supabase', 'config.toml'), 'utf8');
    const start = config.indexOf('[functions.quran-content]');
    expect(start).toBeGreaterThanOrEqual(0);
    const declaration = config.slice(start).split('\n[')[0] ?? '';
    expect(declaration).toMatch(/verify_jwt = true/);
    expect(config).not.toMatch(/verify_jwt = false/);
  });
});

describe('the invariants an implementation must satisfy', () => {
  it('records them, unchanged by the arrival of an implementation', () => {
    expect(quranFoundationInvariants).toMatchObject({
      scriptureIsImmutable: true,
      noAutomaticTranslation: true,
      noUnofficialFallback: true,
      credentialsAreServerSide: true,
      sourceMetadataRequired: true,
      paginationRequired: true,
      maxCacheAgeMs: MAX_CACHE_AGE_MS,
      noMockFallbackInProduction: true,
      searchIsUnsupported: true,
    });
  });

  it('marks the approved source as verified, and nothing else in the app does', () => {
    expect(QURAN_FOUNDATION_SOURCE.verified).toBe(true);
    expect(QURAN_FOUNDATION_SOURCE.name).toContain('Quran Foundation');

    /**
     * `verified: true` is what removes the "not a verified source" warning from every Faith screen,
     * so the set of places that can set it is the set of places that can make that claim. There is
     * exactly one, and this is it.
     */
    const setters = faithSourceFiles()
      .filter((file) => /verified:\s*true/.test(stripComments(fs.readFileSync(file, 'utf8'))))
      .map((file) => path.relative(REPO_ROOT, file).replace(/\\/g, '/'));
    expect(setters).toEqual([
      // Validates the flag on the way in, and refuses a payload that does not carry it.
      'src/features/faith/data/quran-foundation/quran-content.endpoint.ts',
      // Declares the approved source's own descriptor.
      'src/features/faith/data/quran-foundation/quran-foundation.contract.ts',
      // Rebuilds it onto each item, from the validated wire value.
      'src/features/faith/data/quran-foundation/quran-foundation.repository.ts',
    ]);
  });
});

describe('no secrets and no direct vendor calls in the Faith bundle', () => {
  const files = faithSourceFiles();

  it('finds source files to check', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it('contains no Quran Foundation or other Qur’an API hostname', () => {
    /**
     * Unchanged by approval, and more important because of it. The vendor hostnames now exist — in
     * `supabase/functions/quran-content/`, on the server, where the credential is. They may not
     * appear here: an `EXPO_PUBLIC_*` value is inlined into the shipped bundle, and a device that
     * knew the vendor's address would be a device one configuration mistake away from calling it.
     */
    const forbidden = [
      'apis.quran.foundation',
      'oauth2.quran.foundation',
      'quran.foundation',
      'api.quran.com',
      'alquran.cloud',
      'api.alquran',
      'quranapi',
      'api.sunnah.com',
    ];
    for (const file of files) {
      const source = stripComments(fs.readFileSync(file, 'utf8'));
      for (const host of forbidden) {
        expect({
          file: path.relative(REPO_ROOT, file),
          host,
          found: source.includes(host),
        }).toEqual({ file: path.relative(REPO_ROOT, file), host, found: false });
      }
    }
  });

  it('makes no direct network call from the Faith feature', () => {
    /**
     * Narrowed from "no network call at all", and narrowed honestly: the Faith feature now reaches
     * NoorLife's own edge function through the shared Supabase client, which is a network call by any
     * reasonable definition. What it still does not do is open a connection of its own — no `fetch`,
     * no `XMLHttpRequest`, no URL construction — which is what keeps "no vendor endpoint is called
     * from mobile source" true by construction rather than by inspection.
     */
    for (const file of files) {
      const source = stripComments(fs.readFileSync(file, 'utf8'));
      const relative = path.relative(REPO_ROOT, file);
      expect({ file: relative, fetch: /\bfetch\s*\(/.test(source) }).toEqual({
        file: relative,
        fetch: false,
      });
      expect({ file: relative, xhr: /XMLHttpRequest|WebSocket/.test(source) }).toEqual({
        file: relative,
        xhr: false,
      });
      expect({ file: relative, url: /new URL\s*\(/.test(source) }).toEqual({
        file: relative,
        url: false,
      });
    }
  });

  it('invokes exactly one edge function, from exactly one module', () => {
    const invokers = files
      .filter((file) => /\.invoke\s*\(/.test(stripComments(fs.readFileSync(file, 'utf8'))))
      .map((file) => path.relative(REPO_ROOT, file).replace(/\\/g, '/'));
    expect(invokers).toEqual([
      'src/features/faith/data/quran-foundation/quran-content.endpoint.ts',
    ]);

    const endpoint = stripComments(
      fs.readFileSync(
        path.join(FAITH_DIR, 'data', 'quran-foundation', 'quran-content.endpoint.ts'),
        'utf8',
      ),
    );
    // One call site, no loop around it, and no retry construct of any kind.
    expect(endpoint.match(/\.invoke\s*\(/g)).toHaveLength(1);
    expect(endpoint).not.toMatch(/\bwhile\s*\(|\bdo\s*\{|\bretry|setTimeout|setInterval/i);
    expect(endpoint.match(/getSession\s*\(/g)).toHaveLength(1);
    expect(endpoint).not.toMatch(/refreshSession|setSession|signIn|signOut/);
  });

  it('holds no credential-shaped constant', () => {
    const patterns = [
      /client[_-]?secret\s*[:=]\s*['"][^'"]+['"]/i,
      /api[_-]?key\s*[:=]\s*['"][^'"]+['"]/i,
      /bearer\s+[A-Za-z0-9._-]{20,}/i,
      /EXPO_PUBLIC_QURAN/,
      /QF_CLIENT_ID|QF_CLIENT_SECRET/,
      /x-auth-token|x-client-id/,
      /client_credentials|grant_type/,
    ];
    for (const file of files) {
      const source = stripComments(fs.readFileSync(file, 'utf8'));
      for (const pattern of patterns) {
        expect({
          file: path.relative(REPO_ROOT, file),
          pattern: pattern.source,
          found: pattern.test(source),
        }).toEqual({
          file: path.relative(REPO_ROOT, file),
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
      contract.indexOf('export const QURAN_FOUNDATION_SOURCE'),
    );
    expect(configBlock.length).toBeGreaterThan(100);
    expect(stripComments(configBlock)).not.toMatch(/secret|apiKey|clientId|token|password/i);
  });

  it('gives the request type nowhere to put a URL', () => {
    /**
     * The device cannot ask the edge function to fetch an arbitrary address, because there is no
     * property in the request union to put one in. The server refuses unknown fields by name as well;
     * this is the half that means the app could not send one even if it tried.
     */
    const contract = fs.readFileSync(
      path.join(FAITH_DIR, 'data', 'quran-foundation', 'quran-foundation.contract.ts'),
      'utf8',
    );
    const union = /export type QuranContentRequest =([\s\S]*?)\n\n/.exec(stripComments(contract));
    expect(union).not.toBeNull();
    for (const forbidden of ['url', 'path', 'host', 'origin', 'endpoint', 'headers', 'params']) {
      expect({ forbidden, present: (union?.[1] ?? '').includes(forbidden) }).toEqual({
        forbidden,
        present: false,
      });
    }
  });

  it('never falls back to sample scripture from the approved adapter', () => {
    /**
     * The rule that matters most once a real source exists. A fallback would put unverified verses on
     * screen at exactly the moment nobody is watching for them — and the badge, which reads the
     * repository's own source, would already have said "verified" before the swap happened.
     */
    const adapterDir = path.join(FAITH_DIR, 'data', 'quran-foundation');
    for (const file of faithSourceFiles(adapterDir)) {
      const source = stripComments(fs.readFileSync(file, 'utf8'));
      expect({
        file: path.relative(REPO_ROOT, file),
        importsMock: /from\s+['"][^'"]*mock/.test(source),
      }).toEqual({ file: path.relative(REPO_ROOT, file), importsMock: false });
      expect(source).not.toMatch(/MOCK_SOURCE|createMockQuranRepository/);
    }

    /**
     * And the one file that chooses a repository never reaches for the mock as a fallback. It has
     * exactly one branch — whether an approved repository could be built at all — and no `catch`, no
     * `||` fallback and no error handling that could substitute fixtures for a failed read.
     */
    const di = stripComments(
      fs.readFileSync(path.join(FAITH_DIR, 'di', 'faith-repository-context.tsx'), 'utf8'),
    );
    expect(di).toMatch(/createProductionQuranRepository\(\)/);
    expect(di).not.toMatch(/catch|\|\|\s*createMockFaithRepositories|try\s*\{/);
    // The environment question belongs to the data layer, not to the DI file.
    expect(di).not.toMatch(/isSupabaseConfigured|EXPO_PUBLIC/);
  });

  it('logs nothing from the adapter', () => {
    // A prompt, an answer, an access token and a verse of scripture are each enough to matter.
    for (const file of faithSourceFiles(path.join(FAITH_DIR, 'data', 'quran-foundation'))) {
      const source = stripComments(fs.readFileSync(file, 'utf8'));
      expect({
        file: path.relative(REPO_ROOT, file),
        logs: /console\s*\.\s*[a-z]+\s*\(/.test(source),
      }).toEqual({ file: path.relative(REPO_ROOT, file), logs: false });
    }
  });
});

describe('Qur’an text immutability', () => {
  it('applies no transformation on the scripture path', () => {
    /**
     * The structural half. `quran-foundation-adapter.test.ts` proves byte preservation for the
     * fixtures it drives; this proves there is no code that *could* alter a verse on any path,
     * including one no test happened to exercise.
     */
    const adapterDir = path.join(FAITH_DIR, 'data', 'quran-foundation');
    for (const file of faithSourceFiles(adapterDir)) {
      const source = stripComments(fs.readFileSync(file, 'utf8'));
      const relative = path.relative(REPO_ROOT, file);
      expect({ file: relative, normalises: /\.normalize\s*\(/.test(source) }).toEqual({
        file: relative,
        normalises: false,
      });
      expect({
        file: relative,
        transforms: /\barabic\s*\.\s*(replace|trim|normalize|slice|split|toLowerCase)/.test(source),
      }).toEqual({ file: relative, transforms: false });
    }
  });

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
    await repository.getAyahOfTheDay('131');
    await repository.searchTranslations('ease', '131');
    expect(mockAyatForTest['94:6']!.arabic).toBe(before);
  });

  it('keeps translation in a separate object from scripture', async () => {
    const repository = createMockQuranRepository();
    const daily = await repository.getAyahOfTheDay('131');

    expect(daily.kind).toBe('ok');
    if (daily.kind === 'ok') {
      // The scripture object has no translation field to confuse it with.
      expect(daily.data.text).not.toHaveProperty('text');
      expect(daily.data.text.arabic).not.toBe(daily.data.translation.text);
      expect(daily.data.translation.translationId).toBe('131');
    }
  });

  it('requires a translation id — there is no implicit default', async () => {
    const repository = createMockQuranRepository();
    const result = await repository.listTranslations(surahNumber(94), '20');
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.data.items.every((item) => item.translationId === '20')).toBe(true);
    }
  });

  it('stamps every fixture as unverified, whatever the approved source is doing', async () => {
    const repository = createMockQuranRepository();
    const result = await repository.listAyahs(surahNumber(94));
    expect(repository.source.verified).toBe(false);
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
