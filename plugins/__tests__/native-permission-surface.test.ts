import fs from 'node:fs';
import path from 'node:path';

/**
 * What the Faith module's native dependencies are allowed to ask the OS for.
 *
 * ── Why this is a test and not a review note ────────────────────────────────
 * `expo-audio`, `expo-location` and `expo-haptics` were added for recitation playback, the Qibla
 * compass and the tasbih counter. Each ships a config plugin or a library manifest that contributes
 * Android permissions, and two of those contributions are ones NoorLife must **not** ship:
 *
 *   • `RECORD_AUDIO` — `expo-audio` adds it by default, because the same module records as well as
 *     plays. NoorLife records nothing. A Qur'an app asking for microphone access is the kind of
 *     thing that gets an app removed, and the default is opt-out rather than opt-in.
 *   • `ACCESS_BACKGROUND_LOCATION` — `expo-location` adds it when background location is enabled.
 *     Prayer times and the Qibla both need a location only while the user is looking at them.
 *
 * Both are excluded by explicit plugin configuration in `app.json`, and configuration is exactly the
 * kind of thing that gets "tidied" later by somebody who does not know why it was there. This reads
 * the file and fails if either comes back.
 */

const APP_JSON = path.join(process.cwd(), 'app.json');

type PluginEntry = string | [string, Record<string, unknown>];

type AppConfig = {
  readonly expo: {
    readonly plugins: readonly PluginEntry[];
    readonly android?: { readonly permissions?: readonly string[] };
  };
};

function readConfig(): AppConfig {
  return JSON.parse(fs.readFileSync(APP_JSON, 'utf8')) as AppConfig;
}

/** The configuration object for a plugin, or `null` when it is listed bare. */
function pluginOptions(name: string): Record<string, unknown> | null {
  const entry = readConfig().expo.plugins.find((plugin) =>
    Array.isArray(plugin) ? plugin[0] === name : plugin === name,
  );
  if (entry === undefined) {
    throw new Error(`Plugin "${name}" is not configured in app.json.`);
  }
  return Array.isArray(entry) ? entry[1] : null;
}

describe('expo-audio', () => {
  it('is configured rather than listed bare, so its defaults are not inherited', () => {
    // A bare `"expo-audio"` entry takes every default, and the defaults include the microphone.
    expect(pluginOptions('expo-audio')).not.toBeNull();
  });

  it('asks for no microphone access on either platform', () => {
    const options = pluginOptions('expo-audio') as Record<string, unknown>;

    // Android: suppresses RECORD_AUDIO in the merged manifest.
    expect(options.recordAudioAndroid).toBe(false);
    // iOS: suppresses NSMicrophoneUsageDescription, so the OS never offers the prompt.
    expect(options.microphonePermission).toBe(false);
    expect(options.enableBackgroundRecording).toBe(false);
  });

  /**
   * Playback stops when the app leaves the foreground.
   *
   * `enableBackgroundPlayback` defaults to **true**, and background recitation would be a reasonable
   * feature — but only alongside lock-screen controls and a notification the user can stop it from.
   * NoorLife has neither, so enabling it would leave audio playing with no way to reach it. That is
   * also what makes "stop audio when required by lifecycle behaviour" satisfiable at all.
   */
  it('does not keep playing in the background, because nothing could stop it', () => {
    const options = pluginOptions('expo-audio') as Record<string, unknown>;
    expect(options.enableBackgroundPlayback).toBe(false);
  });
});

describe('expo-location', () => {
  it('asks only for while-in-use location', () => {
    const options = pluginOptions('expo-location') as Record<string, unknown>;

    expect(options.isAndroidBackgroundLocationEnabled).toBe(false);
    expect(options.isIosBackgroundLocationEnabled).toBe(false);
  });

  it('explains what the location is for, and that it stays on the device', () => {
    const options = pluginOptions('expo-location') as Record<string, unknown>;
    const copy = String(options.locationWhenInUsePermission);

    // The prompt is the only place a user is told why, so it names both features by name rather
    // than saying "to provide app functionality".
    expect(copy).toMatch(/prayer times/i);
    expect(copy).toMatch(/qibla/i);
    expect(copy).toMatch(/stays on this device/i);
  });
});

describe('expo-haptics', () => {
  /**
   * It is deliberately absent from the plugins list.
   *
   * `expo-haptics` ships no `app.plugin.js`. Listing it makes Expo fall back to resolving the module
   * itself as a plugin, which fails on its TypeScript source. Its `VIBRATE` permission is merged
   * from the library's own `AndroidManifest.xml` at build time and needs no configuration.
   */
  it('is not listed as a config plugin, because it does not ship one', () => {
    const names = readConfig().expo.plugins.map((plugin) =>
      Array.isArray(plugin) ? plugin[0] : plugin,
    );
    expect(names).not.toContain('expo-haptics');
    expect(fs.existsSync(path.join(process.cwd(), 'node_modules/expo-haptics/app.plugin.js'))).toBe(
      false,
    );
  });

  it('declares its own VIBRATE permission, so nothing has to be added here', () => {
    const manifest = fs.readFileSync(
      path.join(process.cwd(), 'node_modules/expo-haptics/android/src/main/AndroidManifest.xml'),
      'utf8',
    );
    expect(manifest).toContain('android.permission.VIBRATE');
  });
});

describe('the Android permission surface', () => {
  /**
   * Exactly one permission is declared by hand, and it is the one no plugin contributes.
   *
   * ── Why the rule loosened, and by exactly how much ─────────────────────────
   * The policy was "declare nothing; let each library's own manifest contribute what it needs", and
   * it held while every capability came from a library that declared its own permissions. Prayer
   * alerts broke that in one specific place: `expo-notifications` adds `POST_NOTIFICATIONS` and
   * `RECEIVE_BOOT_COMPLETED` itself — both appear in the merged manifest without being named here —
   * but it does **not** add `SCHEDULE_EXACT_ALARM`, which Android 12+ requires for a notification to
   * fire at a precise instant rather than in a batching window.
   *
   * So the list is asserted to be exactly that one entry, rather than merely non-empty. A second
   * hand-declared permission fails this test and has to justify itself the same way.
   *
   * ── The store-policy consequence, stated here because it is a real cost ────
   * `SCHEDULE_EXACT_ALARM` is a Play-console-declarable permission: a listing that requests it must
   * justify why the app's core function needs exact timing. Prayer times are the justification, and
   * it is a good one — a prayer alert delivered in a fifteen-minute window is not a prayer alert.
   * The alternative permission, `USE_EXACT_ALARM`, is auto-granted and restricted to alarm-clock and
   * calendar apps; claiming it would be a stronger assertion about what NoorLife is, so the
   * user-grantable one is what is declared.
   */
  it('declares exactly one permission of its own, and only the one no plugin contributes', () => {
    expect(readConfig().expo.android?.permissions).toEqual([
      'android.permission.SCHEDULE_EXACT_ALARM',
    ]);
  });

  it('lets the notification plugin contribute its own permissions rather than restating them', () => {
    const declared = readConfig().expo.android?.permissions ?? [];
    for (const contributed of [
      'android.permission.POST_NOTIFICATIONS',
      'android.permission.RECEIVE_BOOT_COMPLETED',
    ]) {
      expect(declared).not.toContain(contributed);
    }
  });
});
