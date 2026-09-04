import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The iOS backup-exclusion boundary, asserted structurally.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── What can and cannot be proven from here ────────────────────────────────
 * `NSURLIsExcludedFromBackupKey` is set by Foundation on a real device. No Jest run can prove the
 * flag was applied — only an iOS build can, and that verification is required before production
 * release and is recorded as outstanding.
 *
 * What *can* be proven here is everything that would make such a build meaningless: that the module
 * exists and is iOS-only, that it refuses paths outside the one directory it may touch, that it
 * reads the flag back instead of trusting the write, that the JavaScript boundary fails closed, and
 * that the publish path actually consults it. Those are the properties that rot silently between
 * device checks, so they are pinned in the suite that runs on every commit.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const MODULE_DIR = join(process.cwd(), 'modules', 'quran-backup-exclusion');
const SWIFT = join(MODULE_DIR, 'ios', 'QuranBackupExclusionModule.swift');
const CONFIG = join(MODULE_DIR, 'expo-module.config.json');
const BOUNDARY = join(process.cwd(), 'src/features/faith/storage/faith-backup-exclusion.ts');
const GENERATION = join(process.cwd(), 'src/features/faith/storage/faith-sync-generation.ts');

function read(path: string): string {
  return readFileSync(path, 'utf8');
}

function code(path: string): string {
  return read(path)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

describe('the native module', () => {
  it('exists and is declared iOS-only', () => {
    expect(existsSync(CONFIG)).toBe(true);
    expect(existsSync(SWIFT)).toBe(true);

    const config = JSON.parse(read(CONFIG)) as {
      platforms: string[];
      apple: { modules: string[] };
    };
    /*
      Android needs no per-directory action, so building this there would be capability for nothing.
      The key is `apple`, not the legacy `ios`: SDK 57 reads both, but only one is the current
      shape, and the linkage assertions live in `quran-backup-exclusion-linkage.test.ts`.
    */
    expect(config.platforms).toEqual(['apple']);
    expect(config.apple.modules).toContain('QuranBackupExclusionModule');
  });

  it('adds no third-party dependency', () => {
    const swift = code(SWIFT);
    /* Foundation and ExpoModulesCore only — both already present in any Expo iOS app. */
    expect(swift).toContain('import ExpoModulesCore');
    expect(swift).not.toMatch(/^import (?!ExpoModulesCore|Foundation|UIKit)/m);

    const pkg = JSON.parse(read(join(process.cwd(), 'package.json'))) as {
      dependencies: Record<string, string>;
    };
    expect(Object.keys(pkg.dependencies)).not.toContain('quran-backup-exclusion');
  });

  it('accepts only the app’s own Qur’an generation directory', () => {
    const swift = code(SWIFT);
    expect(swift).toContain('allowedRelativePath = "quran-sync"');
    /* Resolved against the sandbox's Documents directory, not against caller-supplied roots. */
    expect(swift).toContain('.documentDirectory');
    expect(swift).toContain('resolvingSymlinksInPath');
    /* Equality, not prefix matching: a parent or a traversal is not "inside" by accident. */
    expect(swift).toContain('resolvedCandidate.path == resolvedAllowed.path');
  });

  it('confirms the flag by reading it back rather than trusting the write', () => {
    const swift = code(SWIFT);
    expect(swift).toContain('isExcludedFromBackup = true');
    expect(swift).toContain('resourceValues(forKeys: [.isExcludedFromBackupKey])');
    expect(swift).toContain('readBack.isExcludedFromBackup == true');
  });
});

describe('the JavaScript boundary', () => {
  it('fails closed on iOS and treats a missing module as a failure', () => {
    const boundary = code(BOUNDARY);
    expect(boundary).toContain("Platform.OS !== 'ios'");
    expect(boundary).toContain("return 'not-required'");
    expect(boundary).toContain("return 'unavailable'");
    expect(boundary).toContain("return 'failed'");
    /* Only these two outcomes may be treated as safe. */
    expect(boundary).toContain("return outcome === 'excluded' || outcome === 'not-required';");
  });

  it('keeps Android’s guarantee distinct from iOS’s', () => {
    /*
      `not-required` and `excluded` are different facts: one says the platform already guarantees it,
      the other says this app set it. Collapsing them would let an Android pass read as evidence
      about iOS.
    */
    const boundary = code(BOUNDARY);
    expect(boundary).toMatch(/'excluded'/);
    expect(boundary).toMatch(/'not-required'/);
    expect(boundary).not.toMatch(/not-required.*===.*excluded/);
  });

  it('requires the module optionally, so Android does not throw for a module it never builds', () => {
    expect(code(BOUNDARY)).toContain('requireOptionalNativeModule');
  });
});

describe('the publish path consults it', () => {
  it('checks retention before staging Arabic and drops Arabic when unconfirmed', () => {
    const generation = code(GENERATION);
    expect(generation).toContain('arabicRetentionAllowed()');
    expect(generation).toContain('arabicRefusedForBackup');
    /* The rest of the generation still publishes; refusing translations too would be a second wrong. */
    expect(generation).toContain('arabic = null;');
  });

  it('applies the exclusion when the generation root is created', () => {
    expect(code(GENERATION)).toContain('ensureExcludedFromBackup(root.uri)');
  });

  it('does not move the dataset to cache storage to dodge backup', () => {
    /* A purgeable Qur'an is a worse answer than a correctly excluded one. */
    const generation = code(GENERATION);
    expect(generation).toContain('Paths.document');
    expect(generation).not.toContain('Paths.cache');
  });
});
