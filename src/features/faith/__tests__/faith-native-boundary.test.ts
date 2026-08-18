import fs from 'node:fs';
import path from 'node:path';

/**
 * Each native capability is reachable from exactly one module.
 *
 * ── Why this is worth a test rather than a convention ───────────────────────
 * Three native packages were added for this work — `expo-location`, `expo-audio` and
 * `expo-haptics` — and two of them can do things the user has to be asked about or can hear. A
 * permission prompt raised from wherever a coordinate happened to be needed is a prompt nobody can
 * account for, and an audio player constructed in a second place is a second audio session competing
 * for the same output.
 *
 * Confining each to one module is what makes `LocationPort` and `useRecitationPlayer` meaningful:
 * they are not merely the *recommended* way to reach those capabilities, they are the only way. That
 * is a claim about the whole feature directory, which no runtime test can establish — the offending
 * import would be in a file no test happened to render. Reading every file is the only way to check
 * it, so that is what this does.
 */

const FAITH_DIR = path.join(process.cwd(), 'src', 'features', 'faith');
const MODULES_FAITH_DIR = path.join(process.cwd(), 'src', 'features', 'modules', 'faith');

function sourceFiles(dir: string): readonly string[] {
  if (!fs.existsSync(dir)) {
    return [];
  }
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === '__tests__' ? [] : sourceFiles(full);
    }
    return entry.name.endsWith('.ts') || entry.name.endsWith('.tsx') ? [full] : [];
  });
}

/** Executable text only, so a comment naming a module is not what fails the scan. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

const FILES = [...sourceFiles(FAITH_DIR), ...sourceFiles(MODULES_FAITH_DIR)];

function importersOf(moduleName: string): readonly string[] {
  const pattern = new RegExp(`from ['"]${moduleName}['"]|require\\(['"]${moduleName}['"]\\)`);
  return FILES.filter((file) => pattern.test(stripComments(fs.readFileSync(file, 'utf8'))))
    .map((file) => path.relative(process.cwd(), file).replace(/\\/g, '/'))
    .sort();
}

describe('the scan is reading the module', () => {
  it('found the Faith source it is supposed to be scanning', () => {
    // A scan over an empty file list passes every assertion below and proves nothing.
    expect(FILES.length).toBeGreaterThan(40);
    expect(FILES.some((file) => file.endsWith('reader-screen.tsx'))).toBe(true);
  });
});

describe('location', () => {
  it('is reachable from exactly one module', () => {
    /*
      Exact equality rather than a count: a *third* file gaining location access fails, and so does
      the port itself losing it. The port is the seam every screen and repository takes, which is
      also what makes denied permission, a device with no compass and a poorly-calibrated heading
      reachable from a test at all.
    */
    expect(importersOf('expo-location')).toEqual([
      'src/features/faith/data/location/expo-location.port.ts',
    ]);
  });

  it('prompts from exactly one place', () => {
    /*
      `requestPermission` is the only method that raises the OS dialog, and `useLocationPermission`
      is the only caller — so every prompt in the module is traceable to a control the user pressed.

      The pattern matches a *call on an object* rather than the bare identifier. The port's interface
      declares the method and the adapter implements it; both are definitions, and a scan that
      counted those would be asserting the capability does not exist rather than that it is reached
      from one place.
    */
    const callers = FILES.filter((file) =>
      /\blocation\s*\.\s*requestPermission\s*\(/.test(stripComments(fs.readFileSync(file, 'utf8'))),
    ).map((file) => path.relative(process.cwd(), file).replace(/\\/g, '/'));

    expect(callers.sort()).toEqual(['src/features/faith/hooks/use-location-permission.ts']);
  });

  /**
   * The notification prompt has its own single caller, and it is not the location path.
   *
   * ── Why the location scan had to become specific to stay meaningful ─────────
   * It matched any `.requestPermission(` call, which was exact while location was the only
   * permission in the module. It is not any more: `prayer-notifications.service.ts` requests the
   * *notification* permission, and a scan that cannot tell the two apart would have failed on a file
   * that never touches location — or, worse, been loosened until it asserted nothing.
   *
   * So there are two assertions, each naming its own port. A third permission in this module fails
   * both until it is given the same treatment.
   */
  it('prompts for notifications from exactly one place', () => {
    const callers = FILES.filter((file) =>
      /\bnotifications\s*\.\s*requestPermission\s*\(/.test(
        stripComments(fs.readFileSync(file, 'utf8')),
      ),
    ).map((file) => path.relative(process.cwd(), file).replace(/\\/g, '/'));

    expect(callers.sort()).toEqual([
      'src/features/faith/data/notifications/prayer-notifications.service.ts',
    ]);
  });

  /**
   * `expo-notifications` is reachable from exactly one module, like every other native capability.
   */
  it('reaches the notification module from exactly one file', () => {
    expect(importersOf('expo-notifications')).toEqual([
      'src/features/faith/data/notifications/expo-notifications.port.ts',
    ]);
  });

  it('asks for no background location anywhere', () => {
    for (const file of FILES) {
      const source = stripComments(fs.readFileSync(file, 'utf8'));
      expect(source).not.toMatch(/requestBackgroundPermissionsAsync|startLocationUpdatesAsync/);
      expect(source).not.toMatch(/startGeofencingAsync|watchMotionActivityAsync/);
    }
  });
});

describe('audio', () => {
  it('is reachable from exactly one module', () => {
    expect(importersOf('expo-audio')).toEqual([
      'src/features/faith/hooks/use-recitation-player.ts',
    ]);
  });

  it('records nothing', () => {
    // The module can record as well as play. NoorLife does neither by accident: the config plugin
    // suppresses the permission, and no code reaches for a recorder.
    for (const file of FILES) {
      const source = stripComments(fs.readFileSync(file, 'utf8'));
      expect(source).not.toMatch(/useAudioRecorder|AudioModule\.requestRecordingPermissions/);
    }
  });
});

describe('haptics', () => {
  it('is reachable from exactly one module', () => {
    expect(importersOf('expo-haptics')).toEqual(['src/features/faith/hooks/use-haptics.ts']);
  });
});

describe('the prayer-time library', () => {
  it('is reachable from exactly one module', () => {
    /*
      `adhan` is pure JavaScript and raises no permission, so this is a different kind of boundary:
      it keeps the *convention* in one place. Prayer times computed in two modules is two answers to
      a question the user configured once.
    */
    expect(importersOf('adhan')).toEqual([
      'src/features/faith/data/prayer/adhan-prayer-times.repository.ts',
    ]);
  });
});
