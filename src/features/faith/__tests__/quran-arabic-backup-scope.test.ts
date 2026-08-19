import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The retained Arabic Qur'an must not leave the device.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── The licence condition this enforces ────────────────────────────────────
 * The 2026-08-18 grant permits retention in **private application storage** and forbids export.
 * Android Auto Backup is an export: it copies application data to the user's Google account, where
 * Quran Foundation content would sit outside NoorLife's control. So the question "is the generation
 * directory inside backup scope?" is a licence question, not a preference.
 *
 * ── Why the answer is already "no", and why this test still exists ─────────
 * The backup rules NoorLife ships declare `<include domain="sharedpref" path="."/>` and nothing else.
 * Android's rule is that **once any `<include>` is present, only the included paths are backed up** —
 * so `domain="file"`, where the generation lives, is out of scope by construction rather than by an
 * explicit exclude.
 *
 * That is a good property resting on a subtle rule, which is exactly the kind that gets broken by a
 * well-meaning edit. Adding `<include domain="file" path="."/>` to back up some unrelated setting
 * would silently pull the entire Qur'an into cloud backup. This test fails if that ever happens.
 *
 * It reads the rules the app actually points at — the `expo-secure-store` XML named by the manifest —
 * rather than asserting against a copy, so it cannot pass against a file nothing ships.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const RULES_DIR = join(
  process.cwd(),
  'node_modules',
  'expo-secure-store',
  'android',
  'src',
  'main',
  'res',
  'xml',
);
const CLOUD_BACKUP_RULES = join(RULES_DIR, 'secure_store_backup_rules.xml');
const DATA_EXTRACTION_RULES = join(RULES_DIR, 'secure_store_data_extraction_rules.xml');

function rules(path: string): string {
  return readFileSync(path, 'utf8').replace(/\s+/g, ' ');
}

/** Every `<include domain="…">` the rules declare. */
function includedDomains(text: string): string[] {
  return [...text.matchAll(/<include domain="([^"]+)"/g)].map((match) => match[1]!);
}

describe('the backup rules the app actually ships', () => {
  it('are present', () => {
    expect(existsSync(CLOUD_BACKUP_RULES)).toBe(true);
    expect(existsSync(DATA_EXTRACTION_RULES)).toBe(true);
  });

  it.each([
    ['Android 11 and lower', CLOUD_BACKUP_RULES],
    ['Android 12 and higher', DATA_EXTRACTION_RULES],
  ])('include only sharedpref on %s, leaving app files out of backup scope', (_label, path) => {
    const domains = includedDomains(rules(path));
    expect(domains.length).toBeGreaterThan(0);
    expect([...new Set(domains)]).toEqual(['sharedpref']);
  });

  it.each([
    ['Android 11 and lower', CLOUD_BACKUP_RULES],
    ['Android 12 and higher', DATA_EXTRACTION_RULES],
  ])('do not include the file domain on %s, where the Qur’an generation lives', (_label, path) => {
    /*
      The assertion that protects the licence. `domain="file"` is the app's private files directory —
      `Paths.document` — which is where a published generation and its Arabic dataset are written.
    */
    expect(includedDomains(rules(path))).not.toContain('file');
  });

  it('covers both cloud backup and device transfer on Android 12 and higher', () => {
    /* Device transfer is the phone-to-phone path: a separate section and a separate mistake. */
    const text = rules(DATA_EXTRACTION_RULES);
    const cloud = text.slice(text.indexOf('<cloud-backup>'), text.indexOf('</cloud-backup>'));
    const transfer = text.slice(
      text.indexOf('<device-transfer>'),
      text.indexOf('</device-transfer>'),
    );

    expect(cloud).not.toBe('');
    expect(transfer).not.toBe('');
    expect(includedDomains(cloud)).not.toContain('file');
    expect(includedDomains(transfer)).not.toContain('file');
  });
});

describe('the generation root', () => {
  it('is the app-private document directory and never shared or external storage', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/features/faith/storage/faith-sync-generation.ts'),
      'utf8',
    );
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

    expect(code).toContain('Paths.document');
    for (const forbidden of [
      'Paths.cache',
      'MediaStore',
      'getExternalStorage',
      'Environment.DIRECTORY',
      'sharedstorage',
    ]) {
      expect(code).not.toContain(forbidden);
    }
  });

  it('exposes no export, share or copy-out path for Quran Foundation content', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/features/faith/storage/faith-sync-generation.ts'),
      'utf8',
    );
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

    for (const forbidden of ['Sharing.', 'shareAsync', 'MediaLibrary', 'createAssetAsync']) {
      expect(code).not.toContain(forbidden);
    }
  });
});
