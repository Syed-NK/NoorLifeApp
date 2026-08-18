import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import withImagelessNativeSplash, {
  ANIMATED_ICON_ITEM,
  SPLASH_PLUGIN_NAME,
  SPLASH_STYLE_GROUP,
  TRANSPARENT_ICON_VALUE,
  findSplashPluginProps,
  hasAndroidSplashImage,
  setTransparentSplashScreenAnimatedIcon,
} from '../with-imageless-native-splash';

import type { AndroidConfig, ExportedConfig, ExportedConfigWithProps } from '@expo/config-plugins';

/**
 * The image-less native splash, asserted at the three places it can be lost.
 *
 * The transformation is unit-tested against a styles resource shaped like the one
 * `expo-splash-screen@57.0.5` writes, because that is where the regressions live: rewriting more
 * than the one dangling item's value would drop the `#FAFFFD` background or the
 * `postSplashScreenTheme` hand-off that makes the app usable after the splash, writing anything
 * other than `@android:color/transparent` would either fail to link or draw a mark, and rewriting it
 * when an image *is* configured would unlink a real, generated `splashscreen_logo` drawable the
 * moment the designer's emblem lands.
 *
 * The transformation running at all then depends on `app.json` registering the plugin *before*
 * `expo-splash-screen`, which is the second place this can be lost, and the least obvious: mods run
 * in reverse registration order, so listing this earlier is what makes it run later. Order matters
 * here in a way it does not for the mailto plugin, since this mod edits styles the upstream plugin
 * has to have written first. That is checked separately below.
 *
 * ── Why nothing here reads the generated android/ folder ─────────────────────
 * `android/` is produced by `expo prebuild` and is gitignored, so a clean checkout or a CI run has
 * no `styles.xml` to assert against and any such test would fail for a reason unrelated to this
 * plugin. Every input asserted here — the plugin module and `app.json` — is source-controlled, so
 * this suite passes on a checkout that has never been prebuilt. The generated `styles.xml` is still
 * worth inspecting; it is a local validation step and a report artifact, not a Jest prerequisite.
 */

type ResourceXML = AndroidConfig.Resources.ResourceXML;

const ROOT = join(__dirname, '..', '..');
const APP_CONFIG = join(ROOT, 'app.json');

/** Exactly the string `app.json` has to carry for Expo to resolve this plugin. */
const PLUGIN_REFERENCE = './plugins/with-imageless-native-splash';

type AppConfig = { expo?: { plugins?: (string | unknown[])[] } };

function appConfig(): AppConfig {
  return JSON.parse(readFileSync(APP_CONFIG, 'utf8')) as AppConfig;
}

/** The plugin references `app.json` declares, with the `[name, options]` tuple form flattened. */
function registeredPlugins(): string[] {
  return (appConfig().expo?.plugins ?? []).map((entry) =>
    Array.isArray(entry) ? String(entry[0]) : String(entry),
  );
}

/**
 * The styles `expo-splash-screen` writes for a `backgroundColor`-only config.
 *
 * Copied from the shape `addSplashScreenStyle` produces — the four items in that order, alongside
 * the `AppTheme` group the prebuild template ships. The `windowSplashScreenAnimatedIcon` line is the
 * defect: no `splashscreen_logo` drawable is generated when no image is configured.
 */
function generatedStyles(): ResourceXML {
  return {
    resources: {
      style: [
        {
          $: { name: 'AppTheme', parent: 'Theme.AppCompat.DayNight.NoActionBar' },
          item: [
            { $: { name: 'android:editTextBackground' }, _: '@drawable/rn_edit_text_material' },
            { $: { name: 'colorPrimary' }, _: '@color/colorPrimary' },
            { $: { name: 'android:statusBarColor' }, _: '@android:color/transparent' },
          ],
        },
        {
          $: { name: 'Theme.App.SplashScreen', parent: 'Theme.SplashScreen' },
          item: [
            { $: { name: 'windowSplashScreenBackground' }, _: '@color/splashscreen_background' },
            { $: { name: 'windowSplashScreenAnimatedIcon' }, _: '@drawable/splashscreen_logo' },
            { $: { name: 'postSplashScreenTheme' }, _: '@style/AppTheme' },
            { $: { name: 'android:windowSplashScreenBehavior' }, _: 'icon_preferred' },
          ],
        },
      ],
    },
  };
}

function styleGroup(styles: ResourceXML, name: string) {
  return (styles.resources.style ?? []).find((group) => group.$.name === name);
}

/**
 * The whole resource tree as one string, with only the icon item's own value blanked out.
 *
 * Lets "nothing but `windowSplashScreenAnimatedIcon`'s value changed" be asserted as written rather
 * than as a list of things that happen to have been checked. The blanking is done by position — the
 * item whose `name` is the icon attribute, inside the splash group — not by matching values, so a
 * transform that reordered items, rewrote an attribute, touched a sibling item, or added a group all
 * show up as a difference here.
 */
function everythingButTheIconValue(styles: ResourceXML): string {
  const clone = JSON.parse(JSON.stringify(styles)) as ResourceXML;
  const item = (styleGroup(clone, SPLASH_STYLE_GROUP.name)?.item ?? []).find(
    (candidate) => candidate.$.name === ANIMATED_ICON_ITEM,
  );

  if (item) {
    item._ = '<blanked>';
  }

  return JSON.stringify(clone);
}

/** The `Theme.App.SplashScreen` items as a plain name → value map. */
function splashItems(styles: ResourceXML): Record<string, string> {
  const group = styleGroup(styles, SPLASH_STYLE_GROUP.name);
  return Object.fromEntries((group?.item ?? []).map((item) => [item.$.name, item._]));
}

/** Runs the plugin over a minimal config carrying the given `expo-splash-screen` props. */
function applyTo(splashProps: Record<string, unknown>): ExportedConfig {
  const config: ExportedConfig = {
    name: 'NoorLifeApp',
    slug: 'NoorLifeApp',
    plugins: [[SPLASH_PLUGIN_NAME, splashProps], PLUGIN_REFERENCE],
  };
  return withImagelessNativeSplash(config) as ExportedConfig;
}

describe('setTransparentSplashScreenAnimatedIcon', () => {
  it('replaces the dangling drawable reference, which is what fails to link at build time', () => {
    const styles = generatedStyles();
    expect(splashItems(styles)[ANIMATED_ICON_ITEM]).toBe('@drawable/splashscreen_logo');

    setTransparentSplashScreenAnimatedIcon(styles);

    expect(splashItems(styles)[ANIMATED_ICON_ITEM]).not.toBe('@drawable/splashscreen_logo');
  });

  it('sets the value to exactly @android:color/transparent, not merely to something resolvable', () => {
    // The exact string is the fix. A framework colour resolves on every API level with nothing
    // generated, and a fully transparent one paints no mark — which is what makes the field plain
    // #FAFFFD instead of the Expo placeholder launcher icon the platform default drew.
    const styles = generatedStyles();

    setTransparentSplashScreenAnimatedIcon(styles);

    expect(splashItems(styles)[ANIMATED_ICON_ITEM]).toBe('@android:color/transparent');
    expect(TRANSPARENT_ICON_VALUE).toBe('@android:color/transparent');
  });

  it('changes that one item and nothing else in the tree', () => {
    // Asserted structurally rather than as a checklist: this compares the entire resource tree with
    // only the icon item's own value blanked, so a reordered item, a rewritten attribute, a touched
    // sibling, or an added group all fail here even if the checks below still pass.
    const styles = generatedStyles();
    const before = everythingButTheIconValue(generatedStyles());

    setTransparentSplashScreenAnimatedIcon(styles);

    expect(everythingButTheIconValue(styles)).toBe(before);
  });

  it('keeps the #FAFFFD background, the postSplashScreenTheme hand-off, and the splash behaviour', () => {
    // These three are the whole point of the Phase 5B configuration: the background *is* the splash,
    // without postSplashScreenTheme the app never leaves the splash theme, and the behaviour item is
    // what expo-splash-screen wrote. Rewriting the group instead of one item's value would take all
    // of them with it.
    const styles = generatedStyles();

    setTransparentSplashScreenAnimatedIcon(styles);

    expect(splashItems(styles)).toEqual({
      windowSplashScreenBackground: '@color/splashscreen_background',
      [ANIMATED_ICON_ITEM]: TRANSPARENT_ICON_VALUE,
      postSplashScreenTheme: '@style/AppTheme',
      'android:windowSplashScreenBehavior': 'icon_preferred',
    });
  });

  it('keeps the icon item itself, rather than removing it as the first attempt did', () => {
    // Regression guard on the change this commit makes. Removal linked and built, but left the
    // attribute unset, and Android 12+ has no "no icon" state — the platform drew its own launcher
    // icon default. The item has to be present *and* transparent.
    const styles = generatedStyles();

    setTransparentSplashScreenAnimatedIcon(styles);

    const names = (styleGroup(styles, SPLASH_STYLE_GROUP.name)?.item ?? []).map(
      (item) => item.$.name,
    );
    expect(names).toContain(ANIMATED_ICON_ITEM);
    expect(names).toHaveLength(4);
  });

  it('leaves unrelated style groups byte-identical', () => {
    const styles = generatedStyles();
    const before = JSON.stringify(styleGroup(generatedStyles(), 'AppTheme'));

    setTransparentSplashScreenAnimatedIcon(styles);

    expect(JSON.stringify(styleGroup(styles, 'AppTheme'))).toBe(before);
    expect(styles.resources.style).toHaveLength(2);
  });

  it('is idempotent, so applying it again cannot damage an already-fixed styles file', () => {
    const styles = generatedStyles();

    setTransparentSplashScreenAnimatedIcon(styles);
    const afterFirst = JSON.stringify(styles);
    setTransparentSplashScreenAnimatedIcon(styles);
    setTransparentSplashScreenAnimatedIcon(styles);

    expect(JSON.stringify(styles)).toBe(afterFirst);
  });

  it('no-ops on styles that have no splash group at all, rather than inventing one', () => {
    // A prebuild that has not run the splash plugin yet, or a future template that names the group
    // differently. `setStylesItem` would happily *create* `Theme.App.SplashScreen` here, which would
    // be this plugin asserting a splash theme it has no business declaring — so the transform checks
    // the item exists before rewriting its value.
    const styles: ResourceXML = { resources: {} };

    expect(() => setTransparentSplashScreenAnimatedIcon(styles)).not.toThrow();
    expect(styleGroup(styles, SPLASH_STYLE_GROUP.name)).toBeUndefined();
  });
});

describe('hasAndroidSplashImage', () => {
  it('is false for the backgroundColor-only config Phase 5B ships', () => {
    expect(hasAndroidSplashImage({ backgroundColor: '#FAFFFD' })).toBe(false);
  });

  it('is false when no props are passed at all', () => {
    expect(hasAndroidSplashImage(undefined)).toBe(false);
  });

  it.each([
    ['image', { image: './assets/images/entry-auth/splash-emblem.png', imageWidth: 120 }],
    ['drawable', { drawable: { icon: './assets/images/entry-auth/splash-emblem.xml' } }],
    ['xxxhdpi', { xxxhdpi: './assets/images/entry-auth/splash-emblem.png' }],
    ['android.image', { android: { image: './assets/images/entry-auth/splash-emblem.png' } }],
    ['dark.image', { dark: { image: './assets/images/entry-auth/splash-emblem.png' } }],
    ['android.dark.image', { android: { dark: { image: './a.png' } } }],
  ])('is true when the config sets %s', (_label, props) => {
    // Each of these makes expo-splash-screen generate a real splashscreen_logo resource. Stripping
    // the style item then would break the splash instead of fixing it — this is the guard that lets
    // the designer's emblem land by editing app.json alone, with no change to this plugin.
    expect(hasAndroidSplashImage(props)).toBe(true);
  });
});

describe('the plugin', () => {
  it.each([
    ['image', { image: './assets/images/entry-auth/splash-emblem.png', imageWidth: 120 }],
    ['drawable', { drawable: { icon: './assets/images/entry-auth/splash-emblem.xml' } }],
    ['xxxhdpi', { xxxhdpi: './assets/images/entry-auth/splash-emblem.png' }],
    ['android.image', { android: { image: './assets/images/entry-auth/splash-emblem.png' } }],
    ['dark.image', { dark: { image: './assets/images/entry-auth/splash-emblem.png' } }],
    ['android.dark.image', { android: { dark: { image: './a.png' } } }],
  ])('does not touch styles when the config sets %s', (_label, imageProps) => {
    // Asserted through the plugin rather than the helper, because the guard lives in the plugin: it
    // must decide *not to register the mod at all*, not register one that quietly does nothing. Every
    // shape that makes expo-splash-screen emit a real splashscreen_logo is covered, since blanking a
    // genuine emblem to transparent would be a silent regression rather than a build failure.
    const result = applyTo({ backgroundColor: '#FAFFFD', ...imageProps });

    expect(result.mods?.android?.styles).toBeUndefined();
  });

  it('registers an android styles mod when no image is configured', () => {
    const result = applyTo({ backgroundColor: '#FAFFFD' });

    expect(typeof result.mods?.android?.styles).toBe('function');
  });

  it('makes the icon transparent when that mod is actually run', async () => {
    // End-to-end through the registered mod rather than the exported helper, so the wiring between
    // the two — the part that only otherwise runs during a prebuild — is covered as well.
    const result = applyTo({ backgroundColor: '#FAFFFD' });
    const mod = result.mods?.android?.styles;
    const modConfig = { ...result, modResults: generatedStyles() };

    const applied = (await mod?.(
      modConfig as unknown as ExportedConfigWithProps<ResourceXML>,
    )) as unknown as { modResults: ResourceXML };

    expect(splashItems(applied.modResults)[ANIMATED_ICON_ITEM]).toBe('@android:color/transparent');
    expect(splashItems(applied.modResults).windowSplashScreenBackground).toBe(
      '@color/splashscreen_background',
    );
    expect(splashItems(applied.modResults).postSplashScreenTheme).toBe('@style/AppTheme');
  });

  it('is a function, which is what Expo requires of a config plugin', () => {
    // `resolveConfigPluginExport` throws INVALID_PLUGIN_TYPE on anything else, and that failure
    // would only surface during a prebuild.
    expect(typeof withImagelessNativeSplash).toBe('function');
  });
});

describe('findSplashPluginProps', () => {
  it('reads the props from the tuple form app.json uses', () => {
    expect(findSplashPluginProps([[SPLASH_PLUGIN_NAME, { backgroundColor: '#FAFFFD' }]])).toEqual({
      backgroundColor: '#FAFFFD',
    });
  });

  it('is undefined when the splash plugin is declared bare or absent', () => {
    expect(findSplashPluginProps([SPLASH_PLUGIN_NAME])).toBeUndefined();
    expect(findSplashPluginProps(['expo-router'])).toBeUndefined();
    expect(findSplashPluginProps(undefined)).toBeUndefined();
  });
});

describe('app.json', () => {
  it('registers the plugin, without which the release build stays broken', () => {
    // The quiet failure: the plugin file can be perfect and every test above can pass while
    // :app:processReleaseResources still fails, because nothing asked Expo to apply it.
    expect(registeredPlugins()).toContain(PLUGIN_REFERENCE);
  });

  it('registers it before expo-splash-screen, which is the only order that works', () => {
    // Reads backwards, and is the single most fragile line in this fix. Mods run in *reverse*
    // registration order: `withMod` makes each new registration the outer layer, running its own
    // action before delegating to `nextMod`, so the plugin listed earliest gets the last word on
    // styles.xml. Listed after expo-splash-screen this removes the item and `addSplashScreenStyle`
    // writes it straight back — which is exactly what a prebuild produced before this was flipped,
    // a styles.xml still carrying the dangling reference and a build that still failed.
    const plugins = registeredPlugins();

    expect(plugins.indexOf(PLUGIN_REFERENCE)).toBeLessThan(plugins.indexOf(SPLASH_PLUGIN_NAME));
  });

  it('registers it exactly once, so the mod does not run twice', () => {
    expect(registeredPlugins().filter((reference) => reference === PLUGIN_REFERENCE)).toHaveLength(
      1,
    );
  });

  it('names a plugin file that is actually on disk', () => {
    // Guards the typo that `expo prebuild` would only report at build time, and pins the reference
    // to a source-controlled file rather than anything generated.
    expect(existsSync(join(ROOT, `${PLUGIN_REFERENCE}.ts`))).toBe(true);
  });

  it('still configures the splash with #FAFFFD and no image', () => {
    // This plugin only makes sense while Phase 5B's emblem is missing. If someone adds an `image`
    // here, this assertion fails and forces a second look at whether the plugin is still wanted —
    // the guard above already makes it inert, but the reminder is cheap.
    const entry = (appConfig().expo?.plugins ?? []).find(
      (plugin) => Array.isArray(plugin) && plugin[0] === SPLASH_PLUGIN_NAME,
    ) as [string, Record<string, unknown>] | undefined;

    expect(entry?.[1]).toEqual({ backgroundColor: '#FAFFFD' });
  });

  it('keeps the other plugins it already declared', () => {
    // This entry was inserted into an existing list; dropping a sibling would be a silent
    // regression in routing, secure store, or the mailto package visibility fix.
    expect(registeredPlugins()).toEqual(
      expect.arrayContaining([
        'expo-router',
        SPLASH_PLUGIN_NAME,
        'expo-secure-store',
        './plugins/with-mailto-package-visibility',
      ]),
    );
  });
});
