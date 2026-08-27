import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { AppIcon, PressableScale } from '@ds/components';

import { useModule } from '../module-context';
import { moduleRasterIcon } from '../module-raster-icons';
import type { ModuleCapability } from '../module-definition';
import { moduleLayout, moduleNeutrals } from '../module-tokens';
import { useModuleMetrics } from '../use-module-metrics';
import { ModuleText } from './module-text';

export type ModuleFeatureGridProps = {
  /** Defaults to the module's own capabilities. */
  readonly items?: readonly ModuleCapability[];
  /** Overrides navigation, for the gallery and for tests. */
  readonly onSelect?: (item: ModuleCapability) => void;
  readonly testID?: string;
};

/**
 * The module's capability grid.
 *
 * Four columns on a 9 dp gap and a 74 dp tile — the same rhythm as Main Home's
 * module grid, so entering a module does not change the grain of the layout. Tile
 * width keeps its fractional remainder rather than flooring; flooring four columns
 * is exactly what left a visible sliver down the right of Main Home's grid.
 *
 * ── Unavailable capabilities ────────────────────────────────────────────────
 * A tile whose feature is not built is rendered at reduced opacity, marked
 * `accessibilityState={{ disabled: true }}`, and given its reason as an
 * accessibility hint. It is not hidden: the module's shape is more honest if the
 * user can see what is coming. It is also not pressable, so it cannot look live and
 * then do nothing. The reduced opacity is never the only signal — the disabled
 * state and the hint carry it for anyone who cannot see the difference.
 */
export function ModuleFeatureGrid({ items, onSelect, testID }: ModuleFeatureGridProps) {
  const router = useRouter();
  const module = useModule();
  const { dp, featureTileWidth } = useModuleMetrics();

  const tiles = items ?? module.capabilities;
  const gap = dp(moduleLayout.featureGap);
  const prefix = testID ?? `${module.id}-features`;

  return (
    <View style={[styles.grid, { columnGap: gap, rowGap: gap }]} testID={testID}>
      {tiles.map((item) => {
        const disabled = !item.available;

        /*
          Artwork only where the tile is usable — issue #68.

          An unavailable tile greys its icon to `textTertiary`, and commissioned artwork cannot be
          tinted. `moduleRasterIcon` refuses artwork for anything unavailable, so a disabled tile
          keeps the glyph and keeps the grey.
        */
        const art = moduleRasterIcon(module.id, item.icon, item.available);

        const inner = (
          <>
            {art === null ? (
              <AppIcon
                name={item.icon}
                /*
                  The glyph inset stays — issue #70, class A.

                  A MaterialCommunityIcons mark fills its em box edge to edge, so it needs insetting
                  inside the well. Commissioned artwork does not: it carries its own transparent
                  margin, and is drawn at the full token in the branch below. Two paths, two rules,
                  and the same rendered optical weight.
                */
                size={dp(moduleLayout.featurePictogram * 0.6)}
                color={disabled ? moduleNeutrals.textTertiary : module.theme.ink}
                testID={`${prefix}-${item.key}-glyph`}
              />
            ) : (
              <AppIcon
                source={art}
                /*
                  The full token — issue #70, class A.

                  `* 0.6` insets a *glyph*, whose mark fills its em box. Commissioned artwork carries
                  its own transparent margin, so applying the glyph inset shrank it twice: measured,
                  Finance's optical mark was 63% of Main Home's in an identically-sized 74 dp tile.
                  `FaithPictogram` already draws PNGs at the full box and insets only its glyph
                  fallback; this is that rule, here.
                */
                size={dp(moduleLayout.featurePictogram)}
                testID={`${prefix}-${item.key}-art`}
              />
            )}
            <ModuleText
              token="tileLabel"
              align="center"
              numberOfLines={1}
              color={disabled ? moduleNeutrals.textTertiary : moduleNeutrals.textPrimary}
              // The tile is a fixed 74 dp, so an unbounded multiplier would clip.
              maxFontSizeMultiplier={1.3}
              style={styles.label}
            >
              {item.label}
            </ModuleText>
          </>
        );

        const tileStyle = [
          styles.tile,
          {
            width: featureTileWidth,
            height: dp(moduleLayout.featureTileHeight),
            borderRadius: dp(moduleLayout.radiusSmall),
            backgroundColor: disabled ? moduleNeutrals.surfaceMuted : module.theme.wellSurface,
            borderColor: disabled ? moduleNeutrals.border : module.theme.wellSurface,
            rowGap: dp(6),
            opacity: disabled ? 0.72 : 1,
          },
        ];

        if (disabled) {
          return (
            <View
              key={item.key}
              style={tileStyle}
              accessible
              accessibilityRole="button"
              accessibilityLabel={`${item.label}, not available yet`}
              accessibilityHint={item.unavailableReason}
              accessibilityState={{ disabled: true }}
              testID={`${prefix}-${item.key}`}
            >
              {inner}
            </View>
          );
        }

        return (
          <PressableScale
            key={item.key}
            onPress={() => {
              if (onSelect !== undefined) {
                onSelect(item);
                return;
              }
              if (item.href !== undefined) {
                router.push(item.href);
              }
            }}
            accessibilityRole="button"
            accessibilityLabel={item.accessibilityLabel ?? item.label}
            style={tileStyle}
            testID={`${prefix}-${item.key}`}
          >
            {inner}
          </PressableScale>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  tile: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    paddingHorizontal: 4,
  },
  label: {
    alignSelf: 'stretch',
  },
});
