import { Image, StyleSheet, View } from 'react-native';

import { PressableScale } from '@ds/components';
import { mainHomeModules } from '@ds/modules/module-themes';
import type { ModuleTheme } from '@shared/models/module-theme';

import { LOCKED } from '../main-home-metrics';
import { useMetrics } from '../main-home-metrics-context';
import { getModulePictogram } from '../module-pictograms';
import { MODULE_TILE_TINT, moduleTileBorder } from '../module-tile-theme';
import { HomeText } from './home-text';

export type ModuleGridProps = {
  readonly onSelectModule: (theme: ModuleTheme) => void;
  readonly testID?: string;
};

/**
 * The eight-module grid.
 *
 * Locked by PNG_PICTOGRAM_IMPLEMENTATION_LOCK.md, 03-module-grid-reference.png and
 * 09-png-pictogram-system-preview.png:
 *
 *   • exactly four columns × two rows, 7 dp gaps both ways
 *   • tile height 71 dp, radius 13 dp
 *   • a very light shade of the module's own colour, with a 0.75 dp border in that colour
 *     at ~14% opacity — never a dark grey outline
 *   • the cleaned transparent PNG pictogram at 48 × 48 dp, `resizeMode="contain"`
 *   • **no white box behind the pictogram** — the PNGs are transparent and sit directly on
 *     the tinted tile
 *   • label 10/13 medium, one line, centred
 *
 * No vector icon appears here. `getModulePictogram` throws on an unresolved asset rather
 * than falling back, so a bundling failure is reported instead of silently substituted.
 *
 * Tile width is arithmetic, not a flex-wrap side effect, so four per row is guaranteed and
 * the grid cannot collapse to three columns.
 *
 * The shadow is on the tile only; the image has none.
 */
export function ModuleGrid({ onSelectModule, testID }: ModuleGridProps) {
  const { dp, contentWidth } = useMetrics();

  const gap = dp(LOCKED.grid.gap);
  // Not floored. Flooring 83.5 to 83 left the row 2 dp short of the content width, so the
  // fourth tile sat 2 dp further from the right edge than the first sat from the left —
  // exactly the unequal outer margins the grid-spacing correction forbids. The fractional
  // width keeps all four columns equal (they land within 0.4 dp of each other on device) and
  // the row flush with both page margins.
  const tileWidth = (contentWidth - gap * (LOCKED.grid.columns - 1)) / LOCKED.grid.columns;
  const tileHeight = dp(LOCKED.grid.tileHeight);
  const pictogram = dp(LOCKED.grid.pictogram);

  return (
    <View style={[styles.grid, { gap }]} testID={testID}>
      {mainHomeModules.map((theme) => (
        <PressableScale
          key={theme.id}
          onPress={() => onSelectModule(theme)}
          accessibilityRole="button"
          accessibilityLabel={theme.name}
          accessibilityHint={`Opens the ${theme.name} module`}
          style={[
            styles.tile,
            {
              width: tileWidth,
              height: tileHeight,
              borderRadius: dp(LOCKED.grid.tileRadius),
              backgroundColor: MODULE_TILE_TINT[theme.id],
              borderColor: moduleTileBorder(theme.id),
            },
          ]}
          testID={`module-card-${theme.id}`}
        >
          <View style={styles.content}>
            <Image
              source={getModulePictogram(theme.id)}
              style={{
                width: pictogram,
                height: pictogram,
                marginBottom: dp(LOCKED.grid.pictogramLabelGap),
              }}
              resizeMode="contain"
              accessible={false}
              testID={`module-pictogram-${theme.id}`}
            />
            <HomeText
              token="tileLabel"
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.9}
              style={styles.label}
            >
              {theme.name}
            </HomeText>
          </View>
        </PressableScale>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  tile: {
    borderWidth: LOCKED.grid.tileBorderWidth,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: LOCKED.grid.tilePaddingHorizontal,
    paddingVertical: LOCKED.grid.tilePaddingVertical,
    shadowColor: '#172033',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 1,
  },
  /** Groups the pictogram and label so the pair centres as one unit inside the tile. */
  content: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    textAlign: 'center',
  },
});
