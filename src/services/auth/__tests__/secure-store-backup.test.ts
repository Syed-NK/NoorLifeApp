import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Android backup and device transfer — the half of the guarantee that lives in the repository.
 *
 * ── What this file used to do, and why it stopped ───────────────────────────
 * It also read `android/app/src/main/AndroidManifest.xml`. That file is not in the repository —
 * `.gitignore` ends with `/ios` and `/android` — and `expo prebuild` produces it. So the suite passed
 * on a developer machine with a prebuild lying around and failed in CI, where none had ever run. A
 * test whose answer depends on which computer ran it is not evidence, and asserting the manifest
 * exists made an ordinary Jest run require a generated native tree.
 *
 * The manifest assertions moved to `scripts/verify-native-backup.mjs`, which generates the native
 * project in a temporary workspace and asserts against the real output. Nothing was dropped and
 * nothing was softened: a missing manifest is a hard failure there, and the mutation self-test proves
 * each assertion can still fail.
 *
 * ── What stays here ─────────────────────────────────────────────────────────
 * Everything provable from tracked source and installed dependencies:
 *
 *   • the backup rule XML shipped by `expo-secure-store`, which is where the exclusion is actually
 *     written — it comes from the library, not from anything a developer here authored;
 *   • the plugin registration in `app.json` that causes those rules to be wired into the manifest,
 *     which is the *input* the native gate checks the *output* of;
 *   • the privacy copy that describes all of this to the user.
 *
 * ── What is deliberately not asserted ───────────────────────────────────────
 * That `android:allowBackup` is `false`. Turning every backup off would make this trivially green and
 * would also discard ordinary preference restore, which is a feature. The guarantee this project
 * makes is narrower and more useful: preferences are backed up, and the SecureStore file is not.
 */

const ROOT = join(__dirname, '..', '..', '..', '..');
const LIBRARY_RES = join(
  ROOT,
  'node_modules',
  'expo-secure-store',
  'android',
  'src',
  'main',
  'res',
  'xml',
);
const CLOUD_BACKUP_RULES = join(LIBRARY_RES, 'secure_store_backup_rules.xml');
const DATA_EXTRACTION_RULES = join(LIBRARY_RES, 'secure_store_data_extraction_rules.xml');

/** Collapses whitespace so an attribute can be matched without depending on the formatter. */
function read(path: string): string {
  return readFileSync(path, 'utf8').replace(/\s+/g, ' ');
}

describe('the expo-secure-store backup rules', () => {
  it('are present in the installed library, for both Android generations', () => {
    // Android 11 and lower read `fullBackupContent`; 12 and higher read `dataExtractionRules`.
    // Shipping only one of them leaves half the device population unprotected.
    expect(existsSync(CLOUD_BACKUP_RULES)).toBe(true);
    expect(existsSync(DATA_EXTRACTION_RULES)).toBe(true);
  });

  it('exclude the SecureStore file from Android 11-and-lower auto backup', () => {
    const rules = read(CLOUD_BACKUP_RULES);
    expect(rules).toMatch(/<full-backup-content>/);
    expect(rules).toMatch(/<exclude domain="sharedpref" path="SecureStore"\s*\/>/);
  });

  it('exclude the SecureStore file from cloud backup on Android 12 and higher', () => {
    const rules = read(DATA_EXTRACTION_RULES);
    const cloud = rules.slice(rules.indexOf('<cloud-backup>'), rules.indexOf('</cloud-backup>'));
    expect(cloud).not.toBe('');
    expect(cloud).toMatch(/<exclude domain="sharedpref" path="SecureStore"\s*\/>/);
  });

  it('exclude the SecureStore file from device transfer as well as cloud backup', () => {
    // Device transfer is the phone-to-phone path. It is a separate section and a separate mistake:
    // excluding only the cloud half still hands the token to the next device.
    const rules = read(DATA_EXTRACTION_RULES);
    const transfer = rules.slice(
      rules.indexOf('<device-transfer>'),
      rules.indexOf('</device-transfer>'),
    );
    expect(transfer).not.toBe('');
    expect(transfer).toMatch(/<exclude domain="sharedpref" path="SecureStore"\s*\/>/);
  });

  it('include ordinary preferences in both, which is what makes the exclusion meaningful', () => {
    /**
     * Stated as an assertion rather than left implicit.
     *
     * `<include domain="sharedpref" path="."/>` is why the SecureStore `<exclude>` has to be there:
     * without the include there would be nothing to carve out of, and a future edit that removed the
     * include would make this whole file pass for the wrong reason. It is also the fact the privacy
     * copy has to describe honestly — a plain preference *is* backed up and restored.
     */
    for (const path of [CLOUD_BACKUP_RULES, DATA_EXTRACTION_RULES]) {
      expect(read(path)).toMatch(/<include domain="sharedpref" path="\.\s*"\s*\/>/);
    }
  });
});

describe('the configuration that wires those rules into the manifest', () => {
  /**
   * The input side of the contract.
   *
   * Neither backup attribute appears in `app.json`: they are written during `expo prebuild` by the
   * `expo-secure-store` config plugin, which runs only because the plugin is registered here. Drop
   * the registration and the generated manifest silently loses both attributes, so this is the
   * smallest tracked fact whose removal breaks the guarantee.
   *
   * `scripts/verify-native-backup.mjs` asserts the resulting output. This asserts the cause; that
   * asserts the effect. Neither substitutes for the other.
   */
  const appConfig = JSON.parse(readFileSync(join(ROOT, 'app.json'), 'utf8')) as {
    expo: { plugins: (string | [string, unknown])[] };
  };
  const pluginNames = appConfig.expo.plugins.map((entry) =>
    Array.isArray(entry) ? entry[0] : entry,
  );

  it('registers the expo-secure-store config plugin', () => {
    expect(pluginNames).toContain('expo-secure-store');
  });

  it('depends on expo-secure-store, so the plugin and its rule XML are installed', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>;
    };
    expect(pkg.dependencies['expo-secure-store']).toBeDefined();
  });

  it('does not disable backup wholesale in app.json', () => {
    // `allowBackup: false` would satisfy every exclusion assertion above by removing the feature
    // rather than scoping it. The generated manifest is checked for the same thing natively.
    const android = (appConfig.expo as unknown as { android?: Record<string, unknown> }).android;
    expect(android?.allowBackup).not.toBe(false);
  });
});

describe('the privacy copy that describes all of this', () => {
  const copy = readFileSync(
    join(ROOT, 'src', 'features', 'profile', 'privacy-security-copy.ts'),
    'utf8',
  );

  it('does not claim that uninstalling removes everything', () => {
    // Neither platform guarantees it: Android Auto Backup can restore preferences onto a reinstall,
    // and iOS Keychain items are not guaranteed to be removed when an app is deleted.
    expect(copy).not.toMatch(/uninstall\w*[^.]{0,80}\b(removes|deletes) (everything|all)/i);
    expect(copy).toMatch(/may retain or restore some settings/);
  });

  it('distinguishes ordinary preferences from the secure store', () => {
    expect(copy).toContain('SecureStore');
    expect(copy).toMatch(/excluding only the `SecureStore` file/);
  });

  it('does not promise a ThisDeviceOnly keychain class the app does not set', () => {
    // `expo-secure-store` defaults to `kSecAttrAccessibleWhenUnlocked`, which is not a
    // `ThisDeviceOnly` class, so a Keychain item can travel in an encrypted device backup. The copy
    // has to name the default it actually gets and say plainly that it is *not* the device-only one.
    expect(copy).toMatch(/kSecAttrAccessibleWhenUnlocked/);
    expect(copy).toMatch(/is \*not\* a\s*\n?\s*\*?\s*`?ThisDeviceOnly`? class/);
  });
});
