import { withAndroidStyles, AndroidConfig, type ConfigPlugin } from '@expo/config-plugins';

/**
 * Makes the image-less native splash configured in Phase 5B build on Android, and be image-less.
 *
 * ── The defect this exists to fix ────────────────────────────────────────────
 * `app.json` configures `expo-splash-screen` with `backgroundColor` and no `image`, which the
 * splash config treats as valid — `image` is optional, and `getAndroidSplashConfig` leaves it
 * `undefined` rather than substituting a default. Two of the three Android mods honour that:
 *
 * - `withAndroidSplashImages` clears every per-density `splashscreen_logo.png` and, with no image in
 *   any density or theme, writes none back. After prebuild there is **no** `splashscreen_logo`
 *   resource anywhere in `android/app/src/main/res`.
 * - `withAndroidSplashDrawables` guards its bitmap layer on `image &&`, so the generated layer-list
 *   is background-only.
 *
 * `withAndroidSplashStyles` does not. Its `addSplashScreenStyle` builds the `<item>` array as an
 * unconditional literal, so `Theme.App.SplashScreen` always gets:
 *
 *     <item name="windowSplashScreenAnimatedIcon">@drawable/splashscreen_logo</item>
 *
 * whether or not an image was configured. The style therefore points at a drawable that the sibling
 * mod deliberately did not create, and `:app:processReleaseResources` fails to link it. The bug is
 * the missing `image &&` guard, in the installed `expo-splash-screen@57.0.5`.
 *
 * ── Why the value becomes @android:color/transparent ─────────────────────────
 * Removing the item links and builds, and that is what this plugin did first. Removal is not enough:
 * Android 12+ has no "no icon" state for the system splash, so an unset
 * `windowSplashScreenAnimatedIcon` falls through to the platform default rather than to nothing. A
 * cold launch of the release APK on an Android 17 / API 37 emulator drew the **Expo placeholder
 * launcher icon** over the `#FAFFFD` field — an unrelated mark from the default `com.anonymous`
 * scaffold, which is a worse outcome than a blank field and directly contradicts what Phase 5B
 * documented. That observation, not a preference, is why the value is replaced instead.
 *
 * `@android:color/transparent` is a framework colour resource, so it resolves on every API level with
 * nothing to generate and nothing to ship. It is valid *as this attribute's value* on both paths
 * through `androidx.core:core-splashscreen:1.2.0`, checked rather than assumed because the whole fix
 * rests on it: the attribute is declared `<attr format="reference"
 * name="windowSplashScreenAnimatedIcon"/>`, and a colour reference is a reference. On API 31+ the
 * library's `values-v31` theme maps it straight to the platform's
 * `android:windowSplashScreenAnimatedIcon`, which the framework inflates through
 * `Context.getDrawable` — a colour resource inflates to a `ColorDrawable`, and a fully transparent
 * one occupies the icon slot while painting nothing. Below 31 the library reads the same attribute
 * into its own splash view, with the same result. The icon element is therefore present and
 * resolvable but invisible, which leaves exactly the plain `#FAFFFD` field Phase 5B specified.
 *
 * Nothing is invented by this: transparency is the absence of a mark, not a substitute for one. No
 * placeholder drawable is added to the project, and no robot, wordmark, family character, or
 * approximated emblem is configured as the splash. The missing emblem stays missing and stays
 * reported — see `docs/PHASE_5B_MISSING_EMBLEM_ASSET.md`. This suppresses a wrong mark; it does not
 * supply the right one.
 *
 * Only the value changes. The `#FAFFFD` `windowSplashScreenBackground`, the `postSplashScreenTheme`
 * hand-off that makes the app usable after the splash, and `android:windowSplashScreenBehavior` are
 * all left as `expo-splash-screen` wrote them, as is the item's own `name` attribute and its position
 * in the group.
 *
 * ── Why a config plugin rather than an edit to the native folder ─────────────
 * `android/` is generated and gitignored (`.gitignore` ends with `/ios` and `/android`), so an edit
 * to `styles.xml` is undone by the next `expo prebuild` — which clears and recreates the folder on
 * every run, even without `--clean`. Patching `node_modules` would not survive a clean install
 * either. A local plugin registered in `app.json` runs on the styles `expo-splash-screen` just
 * wrote, so the fix regenerates with the project. It is also self-cancelling: the moment the
 * designer's emblem lands and `app.json` gains an `image`, the guard below stops rewriting anything
 * and Expo's generated `@drawable/splashscreen_logo` reference is left exactly as written.
 *
 * ── Registration order: this must come BEFORE expo-splash-screen ─────────────
 * Counter-intuitive, and verified against both the source and a real prebuild rather than assumed,
 * because getting it backwards fails silently. Mods do not run in registration order. `withMod`
 * wraps the *existing* mod and hands it to the new action as `nextMod`:
 *
 *     const results = await action({ ... });   // the newly registered plugin's work
 *     return nextMod(results);                 // then everything registered before it
 *
 * so each new registration becomes the outer layer and runs *first*. Mods therefore execute in
 * reverse registration order, and the plugin listed **earliest** in `app.json` has the **last** say
 * over `styles.xml`. Listed after `expo-splash-screen`, this plugin rewrites the item and
 * `addSplashScreenStyle` immediately writes the drawable reference back — the observed result was a
 * `styles.xml` still carrying the dangling reference and a build that still failed.
 */

type ResourceXML = AndroidConfig.Resources.ResourceXML;

/** The style group `expo-splash-screen` writes, matched on both name and parent as it declares it. */
export const SPLASH_STYLE_GROUP = {
  name: 'Theme.App.SplashScreen',
  parent: 'Theme.SplashScreen',
};

/** The one item rewritten here — the icon reference, never the background or the post-splash theme. */
export const ANIMATED_ICON_ITEM = 'windowSplashScreenAnimatedIcon';

/**
 * What that item's value becomes: a framework colour, so it always resolves and paints nothing.
 *
 * Not a project resource and not an asset — there is deliberately nothing to add to `assets/` or to
 * generate into `android/res` for this.
 */
export const TRANSPARENT_ICON_VALUE = '@android:color/transparent';

/** How `app.json` names the upstream plugin whose props decide whether an image exists. */
export const SPLASH_PLUGIN_NAME = 'expo-splash-screen';

/**
 * The props keys that make `expo-splash-screen` emit a `splashscreen_logo` resource.
 *
 * `image` is the documented one; the per-density keys and `drawable` are the other paths through
 * `setSplashImageDrawablesAsync`. Any of them means the drawable is real and must not be unlinked.
 */
const IMAGE_KEYS = ['image', 'drawable', 'mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi'] as const;

type SplashProps = Record<string, unknown> | undefined;

function hasImageKey(props: SplashProps): boolean {
  if (!props) {
    return false;
  }
  return IMAGE_KEYS.some((key) => Boolean(props[key]));
}

function asProps(value: unknown): SplashProps {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

/**
 * Whether the config asks for a splash image on Android, in any of the places it can be asked for.
 *
 * Mirrors `getAndroidSplashConfig`'s merge order — root, then the `android` override, plus both
 * `dark` blocks. A dark-only image still produces a night-qualified `splashscreen_logo.png`, which
 * is enough for the style reference to link, so it counts too. Erring toward "configured" is the
 * safe direction: the failure mode of a false positive is the untouched status quo, while a false
 * negative would strip a splash icon the project genuinely ships.
 */
export function hasAndroidSplashImage(props: SplashProps): boolean {
  if (!props) {
    return false;
  }
  const android = asProps(props.android);
  const candidates: SplashProps[] = [props, android, asProps(props.dark), asProps(android?.dark)];
  return candidates.some(hasImageKey);
}

type PluginEntry = string | [string, unknown?] | unknown;

/** The props `app.json` passes to `expo-splash-screen`, or `undefined` if it passes none. */
export function findSplashPluginProps(plugins: PluginEntry[] | undefined): SplashProps {
  for (const entry of plugins ?? []) {
    if (Array.isArray(entry) && entry[0] === SPLASH_PLUGIN_NAME) {
      return asProps(entry[1]);
    }
  }
  return undefined;
}

/**
 * Points the dangling `windowSplashScreenAnimatedIcon` at `@android:color/transparent`, in place.
 *
 * Replaces a value that is already there rather than asserting one: when the group or the item is
 * absent — a styles file `expo-splash-screen` has not written yet, or a future template that names
 * the group differently — this returns the XML untouched instead of inventing a splash theme.
 * `setStylesItem` overwrites the matching item where it sits, so the item keeps its position and the
 * rest of the group is not rewritten, and re-running this is a no-op once the value already matches.
 */
export function setTransparentSplashScreenAnimatedIcon(styles: ResourceXML): ResourceXML {
  const existing = AndroidConfig.Styles.getStylesItem({
    name: ANIMATED_ICON_ITEM,
    xml: styles,
    parent: SPLASH_STYLE_GROUP,
  });

  if (!existing) {
    return styles;
  }

  return AndroidConfig.Styles.setStylesItem({
    item: { $: existing.$, _: TRANSPARENT_ICON_VALUE },
    xml: styles,
    parent: SPLASH_STYLE_GROUP,
  });
}

const withImagelessNativeSplash: ConfigPlugin = (config) => {
  const splashProps = findSplashPluginProps(config.plugins);

  if (hasAndroidSplashImage(splashProps)) {
    return config;
  }

  return withAndroidStyles(config, (androidConfig) => {
    androidConfig.modResults = setTransparentSplashScreenAnimatedIcon(androidConfig.modResults);
    return androidConfig;
  });
};

export default withImagelessNativeSplash;
