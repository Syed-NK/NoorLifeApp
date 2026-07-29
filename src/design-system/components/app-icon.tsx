// This is the ONE file permitted to import the icon library directly; every other
// module is blocked by the `no-restricted-imports` rule in eslint.config.js, which
// also grants the exemption for this path.
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { StyleProp, TextStyle } from 'react-native';

import { iconSize, neutralColors, type IconSizeToken } from '@ds/tokens';
import type { IconName } from '@shared/models/icon';
import { iconRegistry } from './icon-registry';

export type AppIconProps = {
  readonly name: IconName;
  /** Token size, or an explicit pixel size when the design fixes one. */
  readonly size?: IconSizeToken | number;
  /** Must come from a token or a ModuleTheme. Defaults to `textSecondary`. */
  readonly color?: string;
  readonly style?: StyleProp<TextStyle>;
  /**
   * Icons are decorative by default: the surrounding control carries the label.
   * Pass a label only when the icon is the sole carrier of meaning.
   */
  readonly accessibilityLabel?: string;
};

/**
 * The only icon primitive in NoorLife.
 *
 * Screens reference semantic names (`'module-faith'`, `'mosque'`) and never a glyph
 * name or a family, so the underlying icon set can be replaced in one file. Every
 * glyph resolves to MaterialCommunityIcons — see icon-registry.ts for why the set is
 * deliberately single-family.
 *
 * Emoji are never used as interface icons.
 */
export function AppIcon({
  name,
  size = 'md',
  color = neutralColors.textSecondary,
  style,
  accessibilityLabel,
}: AppIconProps) {
  const resolvedSize = typeof size === 'number' ? size : iconSize[size];
  const { glyph } = iconRegistry[name];

  return (
    <MaterialCommunityIcons
      // The registry is compile-time exhaustive, but its glyph names are plain
      // strings; the library's own name union is narrower, so the cast lives at this
      // single boundary rather than duplicating thousands of glyph literals.
      name={glyph as React.ComponentProps<typeof MaterialCommunityIcons>['name']}
      size={resolvedSize}
      color={color}
      style={style}
      accessible={accessibilityLabel !== undefined}
      accessibilityRole="image"
      {...(accessibilityLabel === undefined
        ? { accessibilityElementsHidden: true, importantForAccessibility: 'no' as const }
        : { accessibilityLabel })}
    />
  );
}
