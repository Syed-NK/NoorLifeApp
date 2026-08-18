import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The storage boundary, asserted as an absence.
 *
 * ── Why a source scan and not a behavioural test ────────────────────────────
 * The two defects being guarded against are both invisible to a passing behavioural suite. Rows in
 * AsyncStorage work perfectly against an in-memory double and fail on a real device at a size no
 * fixture reaches; a second durable write outside the publication path works perfectly until the
 * process dies between them. Neither is provable by pressing buttons — both are statements about
 * which call sites exist, so they are read off the source.
 *
 * Comments are stripped before scanning, so a comment explaining why something must never appear is
 * not what makes a scan fail. That matters here: these modules document their own prohibitions at
 * length.
 */

const ROOT = join(__dirname, '..', '..', '..', '..');
const FAITH = join(ROOT, 'src', 'features', 'faith');

function code(...segments: string[]): string {
  return readFileSync(join(FAITH, ...segments), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

describe('large datasets are file-backed', () => {
  it('keeps every large row store off AsyncStorage', () => {
    /**
     * `faith-sync-generation.ts` is the module that holds 6,236-row datasets, and it must reach
     * AsyncStorage for exactly one thing: the pointer. Rows go to the filesystem.
     *
     * Asserted by counting `writeChecked` call sites rather than by forbidding the import, because
     * the pointer write is a legitimate use of the same helper — one call, and the test says which.
     */
    const generation = code('storage', 'faith-sync-generation.ts');
    const writes = [...generation.matchAll(/writeChecked\(/g)];
    expect(writes).toHaveLength(1);
    expect(/writeChecked\(faithStorageKeys\.quranGenerationPointer/.test(generation)).toBe(true);

    /* And the row payloads are written through the filesystem, not a key-value store. */
    expect(/new File\(/.test(generation)).toBe(true);
    expect(/AsyncStorage/.test(generation)).toBe(false);
  });

  it('has exactly one publication site for the active generation pointer', () => {
    /*
      Two writers of the pointer would be two publication paths, and the guarantee that a crash
      cannot expose a mixed generation depends on there being one.
    */
    const files = [
      ['storage', 'faith-sync-generation.ts'],
      ['storage', 'faith-sync-rows.ts'],
      ['storage', 'faith-sync-checkpoint.ts'],
      ['storage', 'faith-recitation-check.ts'],
      ['data', 'sync', 'content-sync.orchestrator.ts'],
      ['data', 'audio', 'offline-migration.ts'],
    ] as const;

    const writers = files.filter((segments) =>
      /writeChecked\(\s*faithStorageKeys\.quranGenerationPointer/.test(code(...segments)),
    );
    expect(writers.map((segments) => segments.join('/'))).toEqual([
      'storage/faith-sync-generation.ts',
    ]);
  });

  it('does not let the orchestrator write content or a token outside the generation', () => {
    /**
     * The correction to defect 1, read structurally. The orchestrator publishes through exactly one
     * call and writes no durable content of its own — no row store, no separate token, no side clock.
     */
    const orchestrator = code('data', 'sync', 'content-sync.orchestrator.ts');

    expect([...orchestrator.matchAll(/publishGeneration\(/g)]).toHaveLength(1);
    for (const forbidden of [
      'replaceSyncedTranslations',
      'replaceSyncedRecitations',
      'recordRecitationCheck',
      'commitSync',
      'writeChecked',
      'writeJson',
    ]) {
      expect(orchestrator).not.toContain(forbidden);
    }
  });

  it('keeps the token inside the generation and nowhere else', () => {
    /*
      `syncToken` may be read from the generation manifest and sent on the wire. It must never be
      written to a separate durable record — that is the skew the generation design removes.
    */
    const orchestrator = code('data', 'sync', 'content-sync.orchestrator.ts');
    expect(/feed\.syncToken/.test(orchestrator)).toBe(true);
    expect(/syncToken:\s*finalToken/.test(orchestrator)).toBe(true);
    /* The only place `syncToken:` is assigned is inside the generation draft's `feed`. */
    expect([...orchestrator.matchAll(/syncToken:/g)]).toHaveLength(1);
  });
});

describe('private storage only', () => {
  it('names no shared, external or exported storage anywhere in the sync path', () => {
    const modules = [
      code('storage', 'faith-sync-generation.ts'),
      code('data', 'sync', 'content-sync.orchestrator.ts'),
      code('data', 'audio', 'offline-migration.ts'),
    ].join('\n');

    for (const forbidden of [
      'MediaStore',
      'MediaLibrary',
      'StorageAccessFramework',
      'getContentUriAsync',
      'Sharing',
      'shareAsync',
      'Downloads',
      'externalDirectory',
      'ExternalStorage',
    ]) {
      expect(modules).not.toContain(forbidden);
    }

    /* And the one root it does name is the app-internal documents directory. */
    const generation = code('storage', 'faith-sync-generation.ts');
    expect(/Paths\.document/.test(generation)).toBe(true);
    expect(/Paths\.cache/.test(generation)).toBe(false);
  });
});

describe('nothing sensitive is logged', () => {
  it('has no logging call in the sync path at all', () => {
    /*
      The simplest form of "no token, cursor, path or verse is ever logged": there is no logger in
      these modules to log one with.
    */
    for (const segments of [
      ['storage', 'faith-sync-generation.ts'],
      ['data', 'sync', 'content-sync.orchestrator.ts'],
      ['storage', 'faith-recitation-check.ts'],
      ['data', 'audio', 'offline-migration.ts'],
      ['data', 'connectivity', 'expo-connectivity.port.ts'],
      ['data', 'connectivity', 'connectivity.port.ts'],
    ] as const) {
      expect(/console\s*\.\s*[a-z]+\s*\(/.test(code(...segments))).toBe(false);
    }
  });

  it('reads no network identifier through the connectivity boundary', () => {
    const port = code('data', 'connectivity', 'expo-connectivity.port.ts');
    for (const forbidden of ['getIpAddressAsync', 'isAirplaneModeEnabledAsync', 'ssid', 'bssid']) {
      expect(port).not.toContain(forbidden);
    }
  });

  it('imports expo-network in exactly one module', () => {
    /* One connectivity boundary, as approved. A second importer would be a second interpretation. */
    const candidates = [
      ['data', 'connectivity', 'expo-connectivity.port.ts'],
      ['data', 'connectivity', 'connectivity.port.ts'],
      ['data', 'sync', 'content-sync.orchestrator.ts'],
      ['data', 'audio', 'offline-migration.ts'],
    ] as const;
    const importers = candidates.filter((segments) =>
      /from 'expo-network'/.test(code(...segments)),
    );
    expect(importers.map((segments) => segments.join('/'))).toEqual([
      'data/connectivity/expo-connectivity.port.ts',
    ]);
  });
});

describe('no ordinary cache becomes synchronised storage', () => {
  it('never lets the generation reader fall back to the seven-day cache', () => {
    /*
      Serving cached content while describing it as synchronised is the one substitution that would
      make the retention permission unfounded: cache expires precisely because nothing would report a
      correction. The reader answers `null` instead.
    */
    const generation = code('storage', 'faith-sync-generation.ts');
    for (const forbidden of ['quran-cache', 'QuranCache', 'serveStale', 'MAX_CACHE_AGE_MS']) {
      expect(generation).not.toContain(forbidden);
    }
  });

  it('keeps the retired row store out of the runtime sync path', () => {
    /**
     * `faith-sync-rows.ts` survives for its row *types* and for the manifest migration's read of
     * previously-synchronised identities. What it must no longer be is a place synchronised content
     * is written: the orchestrator does not import its writers at all.
     */
    const orchestrator = code('data', 'sync', 'content-sync.orchestrator.ts');
    const rowsImport =
      /import\s+type\s*\{[\s\S]*?\}\s*from\s*'\.\.\/\.\.\/storage\/faith-sync-rows'/;
    expect(rowsImport.test(orchestrator)).toBe(true);
  });
});
