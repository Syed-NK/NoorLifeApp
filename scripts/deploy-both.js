#!/usr/bin/env node

/**
 * Build once, install on every attached target, screenshot each.
 *
 *   node scripts/deploy-both.js            build, install, launch, screenshot
 *   node scripts/deploy-both.js --no-build install the existing APK only
 *   node scripts/deploy-both.js --clear    wipe app data first, for a genuine first run
 *
 * ── Why one APK and not one per target ──────────────────────────────────────
 * The emulator is x86_64 and the phone is arm64, and both architectures build to the same path,
 * `android/app/build/outputs/apk/release/app-release.apk`. Building them separately means the second
 * silently overwrites the first, and installing the wrong one is not an install error: `adb install`
 * reports `Success` and the app then dies on launch with
 * `SoLoaderDSONotFoundError: couldn't find DSO to load: libreactnative.so`. Passing both
 * architectures to one build produces a single APK that runs on either.
 */

const { execFileSync, execSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ANDROID_HOME =
  process.env.ANDROID_HOME ?? path.join(os.homedir(), 'AppData', 'Local', 'Android', 'Sdk');
const ADB = path.join(ANDROID_HOME, 'platform-tools', 'adb.exe');
const JAVA_HOME = process.env.JAVA_HOME ?? 'C:\\Program Files\\Android\\Android Studio\\jbr';

const APK = path.join('android', 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk');
const PACKAGE = 'com.anonymous.NoorLifeApp';
const ARCHITECTURES = 'arm64-v8a,x86_64';
const SHOT_DIR = path.join('android', 'build', 'screenshots');

/**
 * Settle time after the window appears, before the screenshot.
 *
 * The window exists while the splash is still up: the entry gate deliberately holds it for a
 * `SPLASH_MINIMUM_MS` of 1500 (src/app/index.tsx) before it resolves a destination. Shooting on
 * first focus captures the robot on a blank canvas every time, which looks like a broken build.
 * This is that floor plus margin for the redirect and first paint.
 */
const SETTLE_MS = 3500;

const args = process.argv.slice(2);
const skipBuild = args.includes('--no-build');
const clearData = args.includes('--clear');

const adb = (deviceArgs, ...rest) =>
  execFileSync(ADB, [...deviceArgs, ...rest], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

/** Same call, but undecoded — a PNG through a utf8 decode is a corrupt PNG. */
const adbBinary = (deviceArgs, ...rest) =>
  execFileSync(ADB, [...deviceArgs, ...rest], { maxBuffer: 64 * 1024 * 1024 });

function build() {
  console.log(`building for ${ARCHITECTURES} (one APK for both targets)...`);
  // Inherits stdio so Gradle's own progress is visible; this takes minutes.
  execSync(`gradlew app:assembleRelease -PreactNativeArchitectures=${ARCHITECTURES}`, {
    cwd: 'android',
    stdio: 'inherit',
    env: { ...process.env, JAVA_HOME, ANDROID_HOME },
  });
}

/** Serial numbers of everything ready, newest connection last. */
function targets() {
  return adb([], 'devices')
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.trim().split(/\s+/))
    .filter((parts) => parts[1] === 'device')
    .map((parts) => parts[0]);
}

function label(serial) {
  try {
    return adb(['-s', serial], 'shell', 'getprop', 'ro.product.model').trim();
  } catch {
    return serial;
  }
}

function deploy(serial) {
  const name = label(serial);
  console.log(`\n── ${name} (${serial}) ──`);

  console.log(adb(['-s', serial], 'install', '-r', APK).trim().split(/\r?\n/).pop());
  if (clearData) {
    adb(['-s', serial], 'shell', 'pm', 'clear', PACKAGE);
    console.log('app data cleared');
  }
  adb(
    ['-s', serial],
    'shell',
    'monkey',
    '-p',
    PACKAGE,
    '-c',
    'android.intent.category.LAUNCHER',
    '1',
  );

  const focused = waitForApp(serial);
  if (focused) {
    sleep(SETTLE_MS);
  }
  const shot = path.join(SHOT_DIR, `${serial.replace(/[:.]/g, '-')}.png`);
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  fs.writeFileSync(shot, adbBinary(['-s', serial], 'exec-out', 'screencap', '-p'));
  console.log(
    focused ? `launched, screenshot: ${shot}` : `WARNING: app never took focus on ${name}`,
  );
}

/** Blocking sleep — this is a sequential deploy script, so there is nothing to yield to. */
function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function waitForApp(serial) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try {
      if (adb(['-s', serial], 'shell', 'dumpsys', 'window').includes(`${PACKAGE}/`)) {
        return true;
      }
    } catch {
      /* keep polling — the window service can be briefly unavailable during launch */
    }
  }
  return false;
}

/**
 * Everything with a side effect, behind one entry point.
 *
 * This used to run at module scope, so merely `require`-ing this file started a Gradle release build
 * and then `adb install` on every attached device. Nothing in the repository imports it, so nothing
 * was actually triggering it — but "no current caller" is not a safety property, and a script that
 * builds and installs on import is one stray import away from doing so inside a test run.
 *
 * `require.main === module` is true only when node was pointed at this file directly, which is what
 * `npm run deploy:both` does. Importing it now yields the module and runs nothing.
 */
function main() {
  if (!skipBuild) {
    build();
  }

  if (!fs.existsSync(APK)) {
    console.error(`No APK at ${APK}`);
    process.exit(1);
  }

  const found = targets();
  if (found.length === 0) {
    console.error('No devices attached. Start the emulator and/or reconnect the phone:');
    console.error('  emulator -avd Pixel_8 &');
    console.error('  adb connect <phone-ip>:<port>   # port from Wireless debugging on the phone');
    process.exit(1);
  }

  // Named up front, so a run against only one target is obvious rather than looking complete.
  console.log(`${found.length} target(s): ${found.map((s) => `${label(s)} (${s})`).join(', ')}`);
  if (found.length < 2) {
    console.log(
      'NOTE: only one target — the other still needs checking before this counts as verified.',
    );
  }

  for (const serial of found) {
    deploy(serial);
  }
}

module.exports = { main };

if (require.main === module) {
  main();
}
