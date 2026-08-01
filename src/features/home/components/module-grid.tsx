import { Image, StyleSheet, View } from 'react-native';

import { PressableScale } from '@ds/components';
import { neutralColors } from '@ds/tokens';
import { mainHomeModules } from '@ds/modules/module-themes';
import type { ModuleTheme } from '@shared/models/module-theme';

import { useModuleLock, useUpgradeNavigation } from '@features/subscription/use-module-lock';

import { LOCKED } from '../main-home-metrics';
import { useMetrics } from '../main-home-metrics-context';
import { getModulePictogram } from '../module-pictograms';
import {
  MODULE_LOCK_BADGE_SURFACE,
  MODULE_LOCK_INK,
  MODULE_LOCK_SCRIM,
} from '../module-lock-theme';
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
 *
 * ── Phase 6B: entitlement states inside the locked geometry ─────────────────
 * A locked tile keeps every measurement above — width, height, radius, border, the 48 dp
 * pictogram, the label. Only its *surface* changes: the module's own tint is desaturated toward
 * the page rather than swapped for grey, a light scrim sits over it, and a small lock badge
 * appears at the upper right. The approved PNG stays; it is never replaced by a lock glyph, which
 * would throw away the one thing that makes the tile recognisable at a glance.
 *
 * Lock state comes from `useModuleLock`, the same rules the module route gate applies, so a tile
 * and its destination cannot disagree.
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
        <ModuleTile
          key={theme.id}
          theme={theme}
          tileWidth={tileWidth}
          tileHeight={tileHeight}
          pictogram={pictogram}
          onSelectModule={onSelectModule}
        />
      ))}
    </View>
  );
}

type ModuleTileProps = {
  /**
   * Typed from the array element, not as a bare `ModuleTheme`.
   *
   * `ModuleTheme['id']` includes `main`, which is locked Main Home itself and has no tile, tint or
   * pictogram. Narrowing here keeps the tint lookup and `getModulePictogram` exhaustive rather than
   * needing a cast at each call.
   */
  readonly theme: (typeof mainHomeModules)[number];
  readonly tileWidth: number;
  readonly tileHeight: number;
  readonly pictogram: number;
  readonly onSelectModule: (theme: ModuleTheme) => void;
};

/**
 * One tile, in its entitled or locked state.
 *
 * Extracted so each tile can consult the entitlement selector with its own module id — hooks
 * cannot run inside the `map` above.
 */
function ModuleTile({ theme, tileWidth, tileHeight, pictogram, onSelectModule }: ModuleTileProps) {
  const { dp } = useMetrics();
  const { isLocked, accessibilityLabel } = useModuleLock(theme.id, theme.name);
  const goToUpgrade = useUpgradeNavigation();

  return (
    <PressableScale
      onPress={() => {
        // A locked tile goes straight to the upgrade screen. Pushing the module and letting
        // its own gate bounce back would flash a screen the user is not entitled to and leave
        // it in the back stack.
        if (isLocked) {
          goToUpgrade();
          return;
        }
        onSelectModule(theme);
      }}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? theme.name}
      accessibilityHint={isLocked ? 'Opens NoorLife plans' : `Opens the ${theme.name} module`}
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
      testID={isLocked ? `module-card-${theme.id}-locked` : `module-card-${theme.id}`}
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

      {isLocked ? (
        <>
          {/* A light scrim rather than opacity on the tile. Reducing the tile's own opacity
                  would fade the label with it; a scrim desaturates the coloured surface while the
                  label keeps its contrast. Sits under the badge, over the pictogram. */}
          <View
            pointerEvents="none"
            style={[styles.scrim, { borderRadius: dp(LOCKED.grid.tileRadius) }]}
            testID={`module-scrim-${theme.id}`}
          />
          <LockBadge testID={`module-lock-${theme.id}`} />
        </>
      ) : null}
    </PressableScale>
  );
}

/**
 * The lock badge — a padlock drawn from primitives, upper right.
 *
 * Drawn rather than imported: these screens forbid icon-font glyphs, and a padlock is a rectangle
 * and an arc. Small and consistent across all six locked tiles, and `pointerEvents="none"` so it
 * never intercepts the tap that opens the upgrade screen.
 */
function LockBadge({ testID }: { readonly testID: string }) {
  const { dp } = useMetrics();
  const size = dp(13);

  return (
    <View
      pointerEvents="none"
      style={[
        styles.badge,
        { width: size, height: size, borderRadius: size / 2, top: dp(5), right: dp(5) },
      ]}
      testID={testID}
    >
      {/* The shackle: a half-ring above the body. */}
      <View
        style={{
          width: dp(5),
          height: dp(3.5),
          borderTopLeftRadius: dp(3),
          borderTopRightRadius: dp(3),
          borderWidth: dp(1.1),
          borderBottomWidth: 0,
          borderColor: MODULE_LOCK_INK,
        }}
      />
      <View
        style={{
          width: dp(7),
          height: dp(5),
          borderRadius: dp(1.4),
          backgroundColor: MODULE_LOCK_INK,
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  scrim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: MODULE_LOCK_SCRIM,
  },
  badge: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: MODULE_LOCK_BADGE_SURFACE,
  },
  tile: {
    borderWidth: LOCKED.grid.tileBorderWidth,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: LOCKED.grid.tilePaddingHorizontal,
    paddingVertical: LOCKED.grid.tilePaddingVertical,
    // The token, not the literal it replaced. Same value, so no visual change — but this file is
    // now on the reopened list, which is held to sourcing every colour from a token rather than
    // spelling one out. (The scan is textual, so naming the old value here would fail it too.)
    shadowColor: neutralColors.textPrimary,
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
