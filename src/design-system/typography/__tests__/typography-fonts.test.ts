import { existsSync, readFileSync, statSync } from 'node:fs';
import { basename, extname, join } from 'node:path';

import appConfig from '../../../../app.json';
import { fontFamilies } from '@ds/tokens';
import { latinFontsToLoad } from '../fonts';

/**
 * The font pipeline's contract, asserted rather than trusted.
 *
 * ── Why this file exists ────────────────────────────────────────────────────
 * A release build once measured every string in the system fallback face while painting it in
 * Poppins, because Poppins was only registered at runtime and text was measured before that
 * finished. The fix embeds the four faces at build time through the `expo-font` config plugin,
 * and the thing that makes the fix work is a **name match**: React Native resolves an embedded
 * Android font by its *filename*, so `Poppins_600SemiBold.ttf` is what makes
 * `fontFamily: 'Poppins_600SemiBold'` resolve.
 *
 * That match spans three files that nothing otherwise ties together — `tokens/typography.ts`
 * names the families, `app.json` links the files, and `assets/fonts/` holds them. Renaming a
 * file, dropping a weight from the plugin list, or adding a fifth face to the ramp would each
 * reintroduce the defect silently and only in a release build, which is the hardest place to
 * notice it. These assertions turn all three into a failing test instead.
 *
 * ── What this deliberately does not assert ──────────────────────────────────
 * That the app renders in Poppins. No Jest environment can know that; only a device can, and the
 * device evidence lives in the phase report. This file asserts the wiring, which is the part
 * that can regress in a pull request.
 */

const PROJECT_ROOT = join(__dirname, '..', '..', '..', '..');

/** The four faces the app is permitted to use, from the locked token set. */
const REQUIRED_FACES = Object.values(fontFamilies);

/**
 * `app.json`'s plugin list, widened.
 *
 * TypeScript infers an exact literal type for an imported JSON file, so every plugin entry has
 * its own shape and a predicate that narrows to "the expo-font one" is rejected as unassignable.
 * Reading the list structurally is the accurate description anyway: what is being asserted is the
 * *config file's* content, not a type the compiler already knows.
 */
type PluginEntry = string | [string, Record<string, unknown>?];

function pluginEntries(): readonly PluginEntry[] {
  return appConfig.expo.plugins as readonly PluginEntry[];
}

function expoFontPlugin(): Record<string, unknown> | undefined {
  const entry = pluginEntries().find(
    (plugin) => Array.isArray(plugin) && plugin[0] === 'expo-font',
  );
  return Array.isArray(entry) ? entry[1] : undefined;
}

function androidPluginFonts(): readonly string[] {
  const android = expoFontPlugin()?.android as { fonts?: string[] } | undefined;
  return android?.fonts ?? [];
}

describe('Poppins is embedded at build time on Android', () => {
  it('links exactly the four locked faces, and no others', () => {
    const linked = androidPluginFonts().map((path) => basename(path, extname(path)));

    // Set comparison rather than array equality: the plugin list's order is not meaningful,
    // but "these four and nothing else" is. A fifth face would be a typography change that has
    // to go through the token set first.
    expect(new Set(linked)).toEqual(new Set(REQUIRED_FACES));
    expect(linked).toHaveLength(REQUIRED_FACES.length);
  });

  it.each(REQUIRED_FACES)('%s exists on disk and is a real TrueType file', (family) => {
    const path = join(PROJECT_ROOT, 'assets', 'fonts', `${family}.ttf`);
    expect(existsSync(path)).toBe(true);

    // Guards against a placeholder or a truncated copy: every face is ~150 KB, and a TrueType
    // file starts with the 0x00010000 sfnt version tag.
    expect(statSync(path).size).toBeGreaterThan(50_000);
    expect([...readFileSync(path).subarray(0, 4)]).toEqual([0x00, 0x01, 0x00, 0x00]);
  });

  it('links each face by the filename React Native will resolve it under', () => {
    // The whole fix rests on this equality. React Native's `ReactFontManager` looks an Android
    // asset font up by file basename, so the basename *is* the `fontFamily` string — asserting
    // it here is what stops a rename from silently breaking measurement in release only.
    for (const path of androidPluginFonts()) {
      expect(REQUIRED_FACES).toContain(basename(path, extname(path)));
      expect(path.startsWith('./assets/fonts/')).toBe(true);
      expect(extname(path)).toBe('.ttf');
    }
  });
});

describe('runtime registration still covers the platforms embedding does not', () => {
  it('registers the same four families as the Android plugin links', () => {
    // iOS resolves an embedded font by its internal PostScript name (`Poppins-SemiBold`), which
    // is not the key the app asks for, and web has no native project at all. Both therefore keep
    // the `useFonts` path, and it has to register the identical names or the two platforms would
    // diverge from Android.
    expect(new Set(Object.keys(latinFontsToLoad))).toEqual(new Set(REQUIRED_FACES));
  });

  it('is scoped to Android in app.json, so iOS is not given faces under unusable names', () => {
    const options = expoFontPlugin();

    expect(options).toBeDefined();
    expect(options).not.toHaveProperty('ios');
    // The top-level `fonts` key links on both platforms, which is the thing being avoided.
    expect(options).not.toHaveProperty('fonts');
  });
});
