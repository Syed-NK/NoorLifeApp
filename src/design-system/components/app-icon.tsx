// This is the ONE file permitted to import the icon library directly; every other
// module is blocked by the `no-restricted-imports` rule in eslint.config.js, which
// also grants the exemption for this path.
import { MaterialCommunityIcons } from '@expo/vector-icons';
import {
  Image,
  type ImageSourcePropType,
  type ImageStyle,
  type StyleProp,
  type TextStyle,
} from 'react-native';

import { iconSize, neutralColors, type IconSizeToken } from '@ds/tokens';
import type { IconName } from '@shared/models/icon';
import { iconRegistry } from './icon-registry';

/**
 * A statically required coloured pictogram.
 *
 * `ImageSourcePropType` and not a string, because the type is the enforcement. Metro resolves
 * `require` at build time, so a template string, a variable lookup or a dynamic import silently
 * resolves to nothing in a release bundle — which is exactly how an icon-font fallback gets
 * reintroduced by accident. `faith-pictogram-assets.ts` records the same rule for the assets that
 * already ship. A prop that only accepts a resolved module reference cannot be handed a path.
 */
export type RasterIconSource = ImageSourcePropType;

type SharedIconProps = {
  /** Token size, or an explicit pixel size when the design fixes one. */
  readonly size?: IconSizeToken | number;
  /**
   * Icons are decorative by default: the surrounding control carries the label.
   * Pass a label only when the icon is the sole carrier of meaning.
   */
  readonly accessibilityLabel?: string;
  readonly testID?: string;
};

/** The monochrome glyph path — unchanged, and what all existing call sites use. */
export type AppGlyphIconProps = SharedIconProps & {
  readonly name: IconName;
  /**
   * Typed per path, because a glyph is text and artwork is not.
   *
   * The glyph renders through the icon font, so its style is a `TextStyle` and every existing call
   * site passes one. `ImageStyle` is narrower in ways that matter — `overflow: 'scroll'` is legal on
   * text and not on an image — so one shared type would have to widen to the union of both and let a
   * meaningless property through on either path.
   */
  readonly style?: StyleProp<TextStyle>;
  /** Must come from a token or a ModuleTheme. Defaults to `textSecondary`. */
  readonly color?: string;
  readonly source?: never;
  readonly fallbackName?: never;
};

/** The coloured raster path — commissioned artwork, rendered as delivered. */
export type AppRasterIconProps = SharedIconProps & {
  /**
   * The artwork, or `null` for a slot whose artwork is deliberately absent.
   *
   * `null` and not `undefined`: an omitted prop is an accident, a written `null` is a decision. That
   * distinction is what keeps "neither a glyph nor a source" a compile error while still letting a
   * registry express a slot that exists and has no image yet — the state
   * `faith-pictogram-assets.ts` calls `held`, and the reason it holds no `require` at all.
   */
  readonly source: RasterIconSource | null;
  /** See the glyph path's note: artwork takes an `ImageStyle`, not a `TextStyle`. */
  readonly style?: StyleProp<ImageStyle>;
  readonly name?: never;
  /**
   * Not available on raster, and a compile error rather than a comment.
   *
   * Tinting a commissioned pictogram destroys the thing it was commissioned for. Faith's asset
   * contract already says artwork is "transparent, `contain`, untinted"; typing it as `never` means
   * a caller who tries cannot ship it.
   */
  readonly color?: never;
  /**
   * A glyph to draw instead, when the artwork is deliberately absent.
   *
   * Explicit and optional. There is no implicit fallback: a raster slot with no artwork and no
   * declared substitute renders nothing rather than quietly reverting to a flat glyph, because a
   * silent revert is indistinguishable from artwork that was never commissioned.
   */
  readonly fallbackName?: IconName;
};

export type AppIconProps = AppGlyphIconProps | AppRasterIconProps;

/**
 * The only icon primitive in NoorLife.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── Two paths, one component ────────────────────────────────────────────────
 * Screens reference semantic names (`'module-faith'`, `'mosque'`) and never a glyph name or a
 * family, so the underlying icon set can be replaced in one file. Every glyph resolves to
 * MaterialCommunityIcons — see icon-registry.ts for why the set is deliberately single-family.
 *
 * Commissioned coloured pictograms are the second path. They were previously unreachable from here:
 * the module grid and Faith's feature tiles render their own `Image` through per-feature asset
 * registries, and everything else — quick actions, feature grids, navigation, empty states, settings
 * rows — got a flat single-colour glyph because that was all this component could produce.
 *
 * ── Why a union rather than a sibling component ─────────────────────────────
 * A discriminated union keeps one import and one name at 139 existing call sites, none of which
 * needed an edit: they all pass `name`. It also makes the four ways of getting this wrong into
 * compile errors instead of review items — both a glyph and a source, neither, a tint on artwork, or
 * a `fallbackName` on a glyph. A sibling `AppRasterIcon` would have left every one of those as a
 * convention that holds until somebody is in a hurry.
 *
 * ── What the raster path does not do ────────────────────────────────────────
 * It does not tint, stretch, crop or distort. `contain` inside a square box is the whole layout
 * rule, and it is the rule the shipped assets were drawn for. It claims no minimum tap target: the
 * interactive parent owns hit size, exactly as it does for the glyph path. It fetches nothing —
 * `ImageSourcePropType` here is always a resolved local module, never a URI.
 *
 * Emoji are never used as interface icons.
 * ═══════════════════════════════════════════════════════════════════════════
 */
export function AppIcon(props: AppIconProps) {
  const { size = 'md', accessibilityLabel, testID } = props;
  const resolvedSize = typeof size === 'number' ? size : iconSize[size];

  /*
    Both paths share this, so the two cannot drift into two different accessibility contracts.

    Decorative is the default and the common case: 136 of the 139 call sites pass no label, because
    the row, tile or button around the icon is what a reader announces. A second announcement there
    is noise, and on the raster path it would be worse — "image" spoken beside a control that already
    said what it does.
  */
  const accessibility =
    accessibilityLabel === undefined
      ? ({
          accessible: false,
          accessibilityElementsHidden: true,
          importantForAccessibility: 'no' as const,
        } as const)
      : ({
          accessible: true,
          accessibilityRole: 'image' as const,
          accessibilityLabel,
        } as const);

  if (props.name === undefined) {
    if (props.source === null) {
      /*
        A declared-absent slot. Renders the substitute if one was named, and otherwise nothing.

        Nothing is the right default: a raster slot with no artwork and no declared substitute
        reverting to a flat glyph would be indistinguishable from artwork that was never
        commissioned, which is how the monochrome fallback this issue exists to remove got
        reintroduced last time.
      */
      if (props.fallbackName === undefined) {
        return null;
      }
      return (
        <MaterialCommunityIcons
          name={
            iconRegistry[props.fallbackName].glyph as React.ComponentProps<
              typeof MaterialCommunityIcons
            >['name']
          }
          size={resolvedSize}
          color={neutralColors.textSecondary}
          testID={testID}
          {...accessibility}
        />
      );
    }

    return (
      <Image
        source={props.source}
        /*
          A square box and `contain`. The artwork decides how it sits inside that box; nothing here
          scales one axis independently, so an asset that is not square letterboxes rather than
          distorting. `width`/`height` rather than `flex`, because an icon's size is a design decision
          the caller already made through the token.
        */
        style={[{ width: resolvedSize, height: resolvedSize }, props.style]}
        resizeMode="contain"
        testID={testID}
        {...accessibility}
      />
    );
  }

  const { glyph } = iconRegistry[props.name];

  return (
    <MaterialCommunityIcons
      // The registry is compile-time exhaustive, but its glyph names are plain
      // strings; the library's own name union is narrower, so the cast lives at this
      // single boundary rather than duplicating thousands of glyph literals.
      name={glyph as React.ComponentProps<typeof MaterialCommunityIcons>['name']}
      size={resolvedSize}
      color={props.color ?? neutralColors.textSecondary}
      style={props.style}
      testID={testID}
      {...accessibility}
    />
  );
}
