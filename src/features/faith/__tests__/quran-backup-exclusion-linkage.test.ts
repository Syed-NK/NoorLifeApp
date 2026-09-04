import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The iOS *linkage* boundary for the Qur’an backup-exclusion module — issue #110.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── Why this file exists next to the structural test ───────────────────────
 * `quran-arabic-backup-exclusion.test.ts` asserts the Swift source and the config file. It passed
 * for the whole time the module was **absent from the shipped iOS binary**, because reading a source
 * file cannot tell you whether anything compiled it. That is the exact gap #110 records.
 *
 * The property that actually failed was narrower than "the files exist": Expo's Apple autolinking
 * adds a module to the Podfile only when it can find a **podspec** beside the native source. Without
 * one there is no pod, nothing compiles the Swift, and `requireOptionalNativeModule` resolves `null`
 * forever — which the JavaScript boundary correctly reports as `unavailable`.
 *
 * So this file asks the resolver the same question CocoaPods will ask it. It is not a source-shape
 * assertion dressed up as a linkage one: deleting the podspec makes it fail, which was verified by
 * doing exactly that.
 *
 * ── What it still cannot prove ─────────────────────────────────────────────
 * That `NSURLIsExcludedFromBackupKey` is actually set on a device. Only an iOS run can show that,
 * and #110 keeps that gate open. This file proves the module will be *built*, which is the
 * precondition that was missing and the one that rots silently.
 * ═══════════════════════════════════════════════════════════════════════════
 */

type ResolvedModule = {
  readonly packageName: string;
  readonly pods?: readonly { readonly podName: string; readonly podspecDir: string }[];
  readonly modules?: readonly { readonly class: string }[];
};

type AutolinkingApi = {
  readonly findModulesAsync: (options: {
    readonly platform: string;
    readonly searchPaths: readonly string[];
    readonly projectRoot: string;
  }) => Promise<Record<string, unknown>>;
  readonly resolveModulesAsync: (
    modules: Record<string, unknown>,
    options: { readonly platform: string; readonly projectRoot: string },
  ) => Promise<readonly ResolvedModule[]>;
};

const ROOT = process.cwd();
const MODULE_DIR = join(ROOT, 'modules', 'quran-backup-exclusion');
const IOS_DIR = join(MODULE_DIR, 'ios');
const PODSPEC = join(IOS_DIR, 'QuranBackupExclusion.podspec');
const SWIFT = join(IOS_DIR, 'QuranBackupExclusionModule.swift');
const CONFIG = join(MODULE_DIR, 'expo-module.config.json');

const PACKAGE_NAME = 'quran-backup-exclusion';
/** The name `requireOptionalNativeModule` asks for, and the name `Name(...)` declares in Swift. */
const NATIVE_NAME = 'QuranBackupExclusion';

/*
  Loaded by path rather than by bare specifier: the package's `exports` map is CommonJS and Jest's
  resolver for this preset does not follow the `./exports` subpath.
*/
// eslint-disable-next-line @typescript-eslint/no-require-imports
const autolinking = require(
  join(ROOT, 'node_modules', 'expo-modules-autolinking', 'build', 'exports.js'),
) as AutolinkingApi;

/*
  Only this one module is resolved, not the whole project.

  `queryAutolinkingModulesFromProjectAsync` answers the same question but resolves all forty-odd
  packages, and paying that on every suite run is real contention on a machine already running the
  rest of the suite in parallel. Discovery is shared and cheap; resolution is then asked about the
  single package under test. The answer is identical — the pod and class below are exactly what the
  full project query returns — for about a seventh of the work.

  The Android side is deliberately not resolved at all. Its resolver additionally parses Gradle files
  across every package (~21 s here) and would only restate what the module's own configuration
  already decides: a module declaring no Android platform and shipping no Android source cannot be
  built there. That is asserted directly below instead, which is both the causal property and cheap.
*/
async function discoverApple(): Promise<Record<string, unknown>> {
  return autolinking.findModulesAsync({
    platform: 'apple',
    searchPaths: [join(ROOT, 'modules')],
    projectRoot: ROOT,
  });
}

async function resolveApple(
  discovered: Record<string, unknown>,
): Promise<ResolvedModule | undefined> {
  const onlyThisModule = { [PACKAGE_NAME]: discovered[PACKAGE_NAME] };
  const resolved = await autolinking.resolveModulesAsync(onlyThisModule, {
    platform: 'apple',
    projectRoot: ROOT,
  });
  return resolved.find((m) => m.packageName === PACKAGE_NAME);
}

describe('Apple autolinking', () => {
  let discovered: Record<string, unknown>;
  let resolved: ResolvedModule | undefined;

  beforeAll(async () => {
    discovered = await discoverApple();
    resolved = await resolveApple(discovered);
  });

  it('discovers the module as an Apple-platform Expo module', () => {
    /* Discovery reads `expo-module.config.json`; it succeeded even while the module was unlinked. */
    expect(Object.keys(discovered)).toContain(PACKAGE_NAME);
  });

  it('resolves it to something buildable, which is the step that was missing', () => {
    /*
      The assertion #110 needed. Before the podspec existed the resolver returned every other module
      and simply omitted this one, so the module was never compiled into the binary.
    */
    expect(resolved).toBeDefined();
  });

  it('contributes a pod, so CocoaPods has something to compile', () => {
    expect(resolved?.pods?.length).toBeGreaterThan(0);
    expect(resolved?.pods?.[0]?.podName).toBe(NATIVE_NAME);
    /* The pod must point at the directory holding the Swift source, not somewhere else. */
    expect(resolved?.pods?.[0]?.podspecDir).toBe(IOS_DIR);
  });

  it('registers the module class the Swift file defines', () => {
    const classes = (resolved?.modules ?? []).map((m) => m.class);
    expect(classes).toContain('QuranBackupExclusionModule');
    /* The declared class must actually exist in the source, or the app crashes at registration. */
    expect(readFileSync(SWIFT, 'utf8')).toContain(
      'public class QuranBackupExclusionModule: Module',
    );
  });

  it('exposes the native name the JavaScript boundary asks for', () => {
    /*
      `requireOptionalNativeModule('QuranBackupExclusion')` matches `Name("QuranBackupExclusion")`.
      A rename on either side reintroduces a permanent `unavailable` without any build failing.
    */
    expect(readFileSync(SWIFT, 'utf8')).toContain(`Name("${NATIVE_NAME}")`);
    const boundary = readFileSync(
      join(ROOT, 'src/features/faith/storage/faith-backup-exclusion.ts'),
      'utf8',
    );
    expect(boundary).toContain(
      `requireOptionalNativeModule<NativeBackupExclusion>('${NATIVE_NAME}')`,
    );
  });

  it('is stable across repeated resolution', async () => {
    /*
      Resolution is a pure query over the filesystem, so a second call must not change the answer.
      Idempotence matters here because the exclusion itself is called twice by design — once when the
      generation root is created and again before Arabic publishes.
    */
    const again = await resolveApple(discovered);
    expect(again?.pods?.[0]?.podName).toBe(resolved?.pods?.[0]?.podName);
    expect(again?.pods?.[0]?.podspecDir).toBe(resolved?.pods?.[0]?.podspecDir);
    expect((again?.modules ?? []).map((m) => m.class)).toEqual(
      (resolved?.modules ?? []).map((m) => m.class),
    );
  });
});

describe('Android is left exactly as it was', () => {
  /*
    Android's guarantee comes from its backup rules (`<include domain="sharedpref">`), asserted by
    `quran-arabic-backup-scope.test.ts`. Building a native module there would be capability for
    nothing, and would turn the JavaScript boundary's `not-required` into a lie.
  */
  it('declares no Android platform, so nothing there can build it', () => {
    const config = JSON.parse(readFileSync(CONFIG, 'utf8')) as {
      platforms: string[];
      android?: unknown;
    };
    /* Autolinking builds a module for a platform only if that platform is declared. */
    expect(config.platforms).not.toContain('android');
    expect(config.android).toBeUndefined();
  });

  it('ships no Android source and no podspec-equivalent build file', () => {
    expect(existsSync(join(MODULE_DIR, 'android'))).toBe(false);
    expect(existsSync(join(MODULE_DIR, 'build.gradle'))).toBe(false);
  });

  it('leaves the JavaScript boundary answering not-required off iOS', () => {
    /*
      The paired half of the same guarantee: even linked, the boundary never calls native anywhere
      but iOS, so Android's outcome stays a distinct, honest `not-required`.
    */
    const boundary = readFileSync(
      join(ROOT, 'src/features/faith/storage/faith-backup-exclusion.ts'),
      'utf8',
    );
    expect(boundary).toContain("if (Platform.OS !== 'ios') {");
    expect(boundary).toContain("return 'not-required';");
  });
});

describe('the podspec', () => {
  const podspec = (): string => readFileSync(PODSPEC, 'utf8');

  it('exists beside the Swift source', () => {
    expect(existsSync(PODSPEC)).toBe(true);
  });

  it('names the pod so autolinking and the Swift module agree', () => {
    expect(podspec()).toMatch(/s\.name\s+=\s+'QuranBackupExclusion'/);
  });

  it('compiles the Swift source', () => {
    /* Without a glob that reaches the .swift file the pod links but registers nothing. */
    expect(podspec()).toContain("s.source_files = '**/*.{h,m,swift}'");
    expect(existsSync(SWIFT)).toBe(true);
  });

  it('adds no third-party dependency', () => {
    const text = podspec();
    /*
      `NSURLIsExcludedFromBackupKey` is Foundation. The only dependency is ExpoModulesCore, which
      every Expo app already links — the same restraint the Receipts module documents.
    */
    const dependencies = [...text.matchAll(/s\.dependency\s+'([^']+)'/g)].map((m) => m[1]);
    expect(dependencies).toEqual(['ExpoModulesCore']);
    expect(text).not.toMatch(/s\.vendored_(frameworks|libraries)/);
  });
});

describe('the exclusion stays confined to regenerable Qur’an content', () => {
  it('permits exactly one directory, the generation root', () => {
    const swift = readFileSync(SWIFT, 'utf8');
    /*
      The generation root holds only content re-derivable from Quran Foundation. User-authored Faith
      data — bookmarks, notes, reading position — is not stored there and is not touched by this
      module; widening the allow-list would need its own review, which is why equality is asserted
      here rather than a prefix match.
    */
    expect(swift).toContain('allowedRelativePath = "quran-sync"');
    expect(swift).toContain('resolvedCandidate.path == resolvedAllowed.path');
    const allowed = [...swift.matchAll(/allowedRelativePath\s*=\s*"([^"]+)"/g)].map((m) => m[1]);
    expect(allowed).toEqual(['quran-sync']);
  });

  it('logs no path and no user data when it refuses', () => {
    const swift = readFileSync(SWIFT, 'utf8');
    /* A refusal returns false. Printing the path would put a sandbox path into device logs. */
    expect(swift).not.toMatch(/\bprint\(/);
    expect(swift).not.toMatch(/NSLog|os_log/);
  });
});
