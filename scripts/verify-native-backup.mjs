#!/usr/bin/env node

/**
 * Verifies the Android backup contract against a generated native project.
 *
 * ── Why this is not a Jest test ─────────────────────────────────────────────
 * The facts below live in `android/app/src/main/AndroidManifest.xml`, which `.gitignore` excludes and
 * `expo prebuild` produces. `secure-store-backup.test.ts` used to read that file directly and assert
 * it existed. That passed on a developer machine with a stale prebuild lying around, and failed in
 * CI where no prebuild has ever run — a test whose answer depended on which computer ran it.
 *
 * Moving it here keeps the guarantee and removes the dishonesty: the manifest is generated on demand,
 * in a workspace of its own, and a missing one is a hard failure rather than a skip.
 *
 * ── Why a prebuild rather than `expo config` ────────────────────────────────
 * `expo config` resolves the *input*: it would report that `expo-secure-store` is in the plugin list.
 * The two backup attributes are written by that plugin's own manifest pass, and `android:allowBackup`
 * comes from the prebuild template — none of the three appears in `app.json`. Reading the plugin list
 * would prove NoorLife asked for the right thing, not that it got it. The Jest suite asserts the
 * input; this asserts the output, and they are deliberately different checks.
 *
 * ── Isolation ───────────────────────────────────────────────────────────────
 * `expo prebuild` writes into the project root. Running it in the checkout would leave an `android/`
 * tree behind and change what every later step sees. So HEAD is checked out into a detached git
 * worktree under the OS temp directory, `node_modules` is linked rather than copied, and the prebuild
 * runs there. The checkout is never written to, and the worktree is removed afterwards.
 *
 * Usage:
 *   node scripts/verify-native-backup.mjs              generate and verify
 *   node scripts/verify-native-backup.mjs --self-test  prove the assertions can fail
 */

import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = process.cwd();
let failures = [];

function check(label, condition) {
  if (condition) {
    console.log(`  ok    ${label}`);
  } else {
    console.log(`  FAIL  ${label}`);
    failures.push(label);
  }
}

/** Collapses whitespace so an attribute matches regardless of the formatter. */
// The merger reformats self-closing tags, so the same element appears both ways.
const SCHEME_TIGHT = '<data android:scheme="noorlifeapp"/>';
const SCHEME_SPACED = '<data android:scheme="noorlifeapp" />';

function squash(text) {
  return text.replace(/\s+/g, ' ');
}

/**
 * Every assertion about a generated manifest, in one place.
 *
 * Takes the text rather than a path, so the self-test can feed it a deliberately broken manifest and
 * prove these fail. A guarantee that cannot be shown to fail is not a guarantee.
 */
export function assertBackupAttributes(manifestText, label) {
  const manifest = squash(manifestText);
  check(
    `${label}: fullBackupContent points at the SecureStore rules`,
    manifest.includes('android:fullBackupContent="@xml/secure_store_backup_rules"'),
  );
  check(
    `${label}: dataExtractionRules points at the SecureStore rules`,
    manifest.includes('android:dataExtractionRules="@xml/secure_store_data_extraction_rules"'),
  );
  check(
    `${label}: ordinary backup stays enabled rather than switched off wholesale`,
    manifest.includes('android:allowBackup="true"'),
  );
}

/**
 * Facts that belong to the app manifest prebuild writes, and not to the merged output.
 *
 * Kept separate because the manifest merger reformats as it goes -- it emits `<data ... />` with a
 * space where prebuild emits `/>` -- and because the original suite only ever asserted the three
 * backup attributes against merged manifests. Asserting more against them would be a new claim, not
 * a preserved one.
 */
export function assertAppManifestExtras(manifestText, label) {
  const manifest = squash(manifestText);
  check(
    `${label}: declares the noorlifeapp scheme`,
    manifest.includes(SCHEME_TIGHT) || manifest.includes(SCHEME_SPACED),
  );
  check(`${label}: launchMode is singleTask`, manifest.includes('android:launchMode="singleTask"'));
}

/** Everything asserted against a freshly generated app manifest. */
export function assertManifest(manifestText, label) {
  assertBackupAttributes(manifestText, label);
  assertAppManifestExtras(manifestText, label);
}

function makeWorkspace() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'noorlife-native-'));
  const dir = path.join(base, 'checkout');
  console.log(`Workspace: ${dir}`);

  // A detached worktree of HEAD: tracked files only, never a copy of the working tree, so a dirty
  // checkout cannot change what is being verified. Chosen over git archive piped to tar because the
  // tar that ships with Windows reads a leading drive letter as a remote host and refuses the path.
  execFileSync('git', ['worktree', 'add', '--detach', '--quiet', dir, 'HEAD'], { cwd: ROOT });

  // Linked, not copied: prebuild needs the config plugins, and copying node_modules would dominate
  // the runtime of this check.
  fs.symlinkSync(
    path.join(ROOT, 'node_modules'),
    path.join(dir, 'node_modules'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  return dir;
}

/** Removes the worktree and its registration, so nothing is left behind in .git either. */
function removeWorkspace(dir) {
  // --force because prebuild leaves an untracked android/ tree inside the worktree.
  spawnSync('git', ['worktree', 'remove', '--force', dir], { cwd: ROOT, encoding: 'utf8' });
  spawnSync('git', ['worktree', 'prune'], { cwd: ROOT, encoding: 'utf8' });
  fs.rmSync(path.dirname(dir), { recursive: true, force: true });
}

function prebuild(dir) {
  console.log('Running expo prebuild (android, --no-install)...');
  // shell: true because on Windows the CLI is npx.cmd, which spawnSync will not resolve without a
  // shell -- it fails with status null and empty output, which reads like a silent Expo failure.
  const result = spawnSync('npx expo prebuild --platform android --no-install', {
    cwd: dir,
    encoding: 'utf8',
    shell: true,
    env: { ...process.env, CI: '1', EXPO_NO_TELEMETRY: '1' },
  });
  if (result.error) {
    throw new Error(`Could not start expo prebuild: ${result.error.message}`);
  }
  if (result.status !== 0) {
    console.log(result.stdout ?? '');
    console.error(result.stderr ?? '');
    throw new Error(`expo prebuild failed with status ${result.status}`);
  }
  console.log(result.stdout.trim());
}

const GOOD_FIXTURE = path.join(ROOT, 'scripts', '__fixtures__', 'android-manifest-good.xml');

function selfTest() {
  console.log('SELF-TEST: the assertions must be able to fail.\n');
  const good = fs.readFileSync(GOOD_FIXTURE, 'utf8');

  console.log('1. a correct manifest passes');
  assertManifest(good, 'fixture');
  if (failures.length !== 0) {
    console.error('SELF-TEST FAILED: a correct manifest did not pass.');
    process.exit(1);
  }

  const mutations = {
    'fullBackupContent removed': ['android:fullBackupContent="@xml/secure_store_backup_rules"', ''],
    'dataExtractionRules removed': [
      'android:dataExtractionRules="@xml/secure_store_data_extraction_rules"',
      '',
    ],
    'allowBackup flipped to false': ['android:allowBackup="true"', 'android:allowBackup="false"'],
    'noorlifeapp scheme removed': ['<data android:scheme="noorlifeapp"/>', ''],
    'launchMode removed': ['android:launchMode="singleTask"', ''],
  };

  let allCaught = true;
  for (const [name, [from, to]] of Object.entries(mutations)) {
    failures = [];
    const mutated = good.replace(from, to);
    if (mutated === good) {
      console.error(`SELF-TEST FAILED: mutation "${name}" changed nothing in the fixture.`);
      allCaught = false;
      continue;
    }
    console.log(`\n2. mutation: ${name}`);
    assertManifest(mutated, 'mutated');
    if (failures.length === 0) {
      console.error(`SELF-TEST FAILED: "${name}" was not caught.`);
      allCaught = false;
    }
  }

  failures = [];
  console.log('\n3. a missing generated manifest is a hard failure, not a pass');
  const absent = path.join(ROOT, 'scripts', '__fixtures__', 'does-not-exist.xml');
  if (fs.existsSync(absent)) {
    console.error('SELF-TEST FAILED: the absent-file fixture unexpectedly exists.');
    allCaught = false;
  } else {
    let threw = false;
    try {
      readGeneratedManifest(absent);
    } catch {
      threw = true;
    }
    check('an absent manifest path throws rather than returning empty', threw);
    if (failures.length !== 0) allCaught = false;
  }

  if (!allCaught) process.exit(1);
  console.log('\nSELF-TEST PASSED: every assertion fails when its fact is removed.');
  process.exit(0);
}

/** Reads a generated manifest, treating absence as a failure rather than as nothing to check. */
function readGeneratedManifest(manifestPath) {
  if (!fs.existsSync(manifestPath)) {
    throw new Error(
      `No generated manifest at ${manifestPath}. The backup contract is unverified, and unverified ` +
        'is a failure — this gate does not treat a missing manifest as success.',
    );
  }
  return fs.readFileSync(manifestPath, 'utf8');
}

function main() {
  if (process.argv.includes('--self-test')) return selfTest();

  let dir;
  try {
    dir = makeWorkspace();
    prebuild(dir);

    console.log('\nGenerated manifest:');
    const manifestPath = path.join(dir, 'android', 'app', 'src', 'main', 'AndroidManifest.xml');
    assertManifest(readGeneratedManifest(manifestPath), 'generated');

    // Manifest *merging* happens during a Gradle build, which this gate deliberately does not run.
    // Checked when a release build already exists; reported as not-run otherwise, and never reported
    // as passing.
    const merged = [
      'android/app/build/intermediates/merged_manifests/release/processReleaseManifest/AndroidManifest.xml',
      'android/app/build/intermediates/packaged_manifests/release/processReleaseManifestForPackage/AndroidManifest.xml',
    ].map((p) => path.join(ROOT, p));
    const present = merged.filter((p) => fs.existsSync(p));

    console.log('\nMerged release manifests:');
    if (present.length === 0) {
      console.log(
        '  NOT RUN — no release build in this checkout, and this gate does not build one.',
      );
      console.log('  The generated-source manifest above is asserted unconditionally regardless.');
    } else {
      for (const p of present) {
        assertBackupAttributes(
          fs.readFileSync(p, 'utf8'),
          `merged/${path.basename(path.dirname(p))}`,
        );
      }
    }
  } finally {
    if (dir) {
      removeWorkspace(dir);
      console.log(`\nWorkspace removed: ${dir}`);
    }
  }

  if (failures.length > 0) {
    console.error(`\n${failures.length} native backup assertion(s) failed.`);
    process.exit(1);
  }
  console.log('\nNative backup contract verified.');
}

main();
