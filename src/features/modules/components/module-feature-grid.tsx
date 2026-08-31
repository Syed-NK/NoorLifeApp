import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { AppIcon, PressableScale } from '@ds/components';

import { useModule } from '../module-context';
import { moduleRasterIcon } from '../module-raster-icons';
import type { ModuleCapability } from '../module-definition';
import { moduleLayout, moduleNeutrals } from '../module-tokens';
import { useModuleMetrics } from '../use-module-metrics';
import { ModuleText } from './module-text';

/**
 * Lines a capability label may take — issue #136.
 *
 * Two where the label can break, matching what #52 approved for the quick-action label. One line
 * cost Finance's `Bank sync` its last two characters at OS text size 1.5: measured against the
 * Poppins advance tables, the label wants 71.44 dp of a 71.25 dp box at 384 dp, and at 411 dp the
 * 0.06 dp it nominally has left is inside the rounding React Native applies when it resolves the
 * fractional tile width to whole physical pixels. Both targets drew an ellipsis.
 *
 * `Bank sync` is two words and its widest is 34.93 dp, so a second line clears it at every width
 * with room to spare. The two fixes this rules out are the two the earlier issues already ruled
 * out: shortening the registry's copy fits the product to the layout rather than the other way
 * round, and lowering `maxFontSizeMultiplier` is the typographic cap #125 settled.
 *
 * ── Why a single word keeps one line — issue #138 ───────────────────────────
 * A second line only helps a label that has somewhere to break. React Native splits a word wider
 * than its line between letters instead of wrapping it, so handing the extra line to a single word
 * trades an ellipsis for the mid-word split #52 identified as the worse of the two. Measured: with
 * two lines for everything, Family's `Memories` went from `Memorie…` to `Memorie` / `s` at 320 dp
 * and text size 1.5.
 *
 * So the clamp is decided by whether the copy can use it. That keeps this change to the labels it
 * fixes and leaves every single-word label rendering exactly as it did. #138 owns the one cell that
 * needs horizontal room rather than a line.
 */
function labelLines(label: string): number {
  return /\s/.test(label.trim()) ? 2 : 1;
}

/** The approved typographic cap for a capability label. Unchanged by #136 — only the clamp moved. */
const FEATURE_LABEL_MAX_FONT_MULTIPLIER = 1.3;

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
              numberOfLines={labelLines(item.label)}
              color={disabled ? moduleNeutrals.textTertiary : moduleNeutrals.textPrimary}
              /*
                Still capped, so a second line cannot become a third — issue #136.

                The cap is the approved typographic limit and #125 settled that it is not the lever
                to buy width with; it stays exactly as it was. What changed is the clamp above it.
              */
              maxFontSizeMultiplier={FEATURE_LABEL_MAX_FONT_MULTIPLIER}
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
            /*
              A floor, not a fixed height — issue #136.

              74 dp is still the rhythm every tile keeps, and every label that fits one line still
              renders in a 74 dp tile. But a hard height would clip the second line the fix above
              depends on, so fixing a horizontal ellipsis would have bought a vertical one. The row
              is a flex line with the default `stretch`, so a tile that does take the second line
              lifts its whole row and the grid stays even.
            */
            minHeight: dp(moduleLayout.featureTileHeight),
            borderRadius: dp(moduleLayout.radiusSmall),
            /*
              The disabled branch stays neutral, deliberately — issue #91.

              `surfaceMuted` means *unavailable* here, not "a nested row", so it must not take the
              module tint when a module opts into the surface roles. Finance's Bank sync and Receipts
              tiles have to keep reading as unavailable, which is exactly what #90 spent its effort
              asserting; a decorative tint would undo it silently.
            */
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
