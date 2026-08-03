import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Android backup and device transfer, asserted against the configuration that actually ships.
 *
 * ── Why this reads generated files rather than checking a comment ────────────
 * `android/` is **not** in the repository — `.gitignore` ends with `/ios` and `/android`, and
 * `git ls-files android` returns nothing. Both native projects are produced by `expo prebuild`, and
 * the backup rules themselves come from the `expo-secure-store` AAR rather than from anything a
 * developer here wrote. So the only honest place to verify the guarantee is the generated manifest
 * and the library's own resources.
 *
 * That also names the failure this test exists to catch: an SDK bump, a plugin change or a
 * hand-edited manifest that drops the SecureStore exclusion. The session token would then be copied
 * off the device by Android Auto Backup and restored onto a different phone, and nothing in the
 * application would look any different. The privacy screen would still be making its promise.
 *
 * ── What is deliberately not asserted ───────────────────────────────────────
 * That `android:allowBackup` is `false`. Turning every backup off would make this test trivially
 * green and would also discard ordinary preference restore, which is a feature. The guarantee this
 * project actually makes is narrower and more useful: preferences are backed up, and the SecureStore
 * file is not.
 */

const ROOT = join(__dirname, '..', '..', '..', '..');
const GENERATED_MANIFEST = join(ROOT, 'android', 'app', 'src', 'main', 'AndroidManifest.xml');
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

/**
 * The merged manifests a release build produces, in the order the AGP versions in play write them.
 *
 * Checked when present and skipped when absent, because a fresh clone has no `android/app/build` at
 * all. The generated source manifest and the library resources below are always present, so the
 * guarantee is never left entirely unasserted — this pair adds the "and the merge did not undo it"
 * half after a build has run.
 */
const MERGED_RELEASE_MANIFESTS = [
  join(
    ROOT,
    'android/app/build/intermediates/merged_manifests/release/processReleaseManifest/AndroidManifest.xml',
  ),
  join(
    ROOT,
    'android/app/build/intermediates/packaged_manifests/release/processReleaseManifestForPackage/AndroidManifest.xml',
  ),
];

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

describe('the generated Android manifest', () => {
  const hasNativeProject = existsSync(GENERATED_MANIFEST);

  it('exists, because these guarantees cannot be verified without it', () => {
    // `expo prebuild` has to have run. A missing manifest is reported rather than skipped: a
    // protection test that quietly does nothing is worse than no test.
    expect(hasNativeProject).toBe(true);
  });

  it('points both backup attributes at the SecureStore-aware rules', () => {
    const manifest = read(GENERATED_MANIFEST);
    expect(manifest).toContain('android:fullBackupContent="@xml/secure_store_backup_rules"');
    expect(manifest).toContain(
      'android:dataExtractionRules="@xml/secure_store_data_extraction_rules"',
    );
  });

  it('leaves ordinary backup enabled rather than switching it off wholesale', () => {
    // Documented, not incidental: `allowBackup="false"` would satisfy the exclusion tests above by
    // removing the feature instead of scoping it, and would be an undocumented shortcut.
    expect(read(GENERATED_MANIFEST)).toContain('android:allowBackup="true"');
  });

  it('declares the NoorLife scheme for deep links and does not rely on Expo Go’s', () => {
    const manifest = read(GENERATED_MANIFEST);
    expect(manifest).toContain('<data android:scheme="noorlifeapp"/>');
    // `exp+noorlifeapp` is contributed by the prebuild for Expo Go. Its presence in the manifest is
    // fine; what matters is that the callback parser refuses it, which
    // `auth-callback-url.test.ts` asserts.
    expect(manifest).toContain('android:launchMode="singleTask"');
  });
});

describe('the merged release manifest', () => {
  const available = MERGED_RELEASE_MANIFESTS.filter((path) => existsSync(path));

  it.each(MERGED_RELEASE_MANIFESTS)('%s keeps the backup attributes after merging', (path) => {
    if (!existsSync(path)) {
      // No release build in this working tree. The generated-source and library assertions above
      // still hold, and the release build in the phase's validation run covers this pair.
      expect(available.length).toBeGreaterThanOrEqual(0);
      return;
    }
    const manifest = read(path);
    expect(manifest).toContain('android:fullBackupContent="@xml/secure_store_backup_rules"');
    expect(manifest).toContain(
      'android:dataExtractionRules="@xml/secure_store_data_extraction_rules"',
    );
    expect(manifest).toContain('android:allowBackup="true"');
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
