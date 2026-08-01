import { Image, StyleSheet, View } from 'react-native';

import { PressableScale } from '@ds/components';
import { neutralColors } from '@ds/tokens';
import { mainHomeModules } from '@ds/modules/module-themes';
import type { FrameworkModuleId } from '@features/modules/module-tokens';
import { useUpgradeSheetActions } from '@features/subscription/services/upgrade-sheet-context';
import type { ModuleTheme } from '@shared/models/module-theme';

import { useModuleLock } from '@features/subscription/use-module-lock';

import { UPGRADE_SOURCES } from '../home-premium-surfaces';
import { LOCKED } from '../main-home-metrics';
import { useMetrics } from '../main-home-metrics-context';
import { getModulePictogram } from '../module-pictograms';
import { MODULE_LOCK_SCRIM, LOCK_GLYPH } from '../module-lock-theme';
import { MODULE_TILE_TINT, moduleTileBorder } from '../module-tile-theme';
import { HomeLockBadge } from './home-lock-badge';
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
 * the page rather than swapped for grey, a scrim sits over it, and a lock badge appears at the
 * upper right. The approved PNG stays; it is never replaced by a lock glyph, which would throw
 * away the one thing that makes the tile recognisable at a glance.
 *
 * Lock state comes from `useModuleLock`, the same rules the module route gate applies, so a tile
 * and its destination cannot disagree.
 *
 * ── The scrim is beneath the content, not over it ────────────────────────────
 * It was the last child until the device pass, so it washed over the label as well as the tile and
 * took it to 2.68:1 — the "labels are slightly too faded" defect. Drawn first, the label keeps the
 * ~15:1 it was always supposed to have and the desaturation still lands where it was aimed: the
 * coloured surface. Same alpha, same tint, same everything else.
 *
 * ── A locked tap raises the shared sheet; it does not navigate ───────────────
 * It used to push `/subscription` directly, which the device pass caught: tapping Health jumped
 * straight to the plan chooser with no explanation of what had been asked for and no way back other
 * than the back button. Now it raises the one contextual sheet every other locked Main Home surface
 * uses, and "View Premium Plans" inside that sheet is the only thing that reaches the chooser.
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
  const { requestUpgrade } = useUpgradeSheetActions();

  return (
    <PressableScale
      onPress={() => {
        if (isLocked) {
          // The shared controller, not `router.push(subscriptionRoutes.welcome)`. A locked tile
          // still never enters the module — pushing it and letting its own gate bounce back would
          // flash a screen the user is not entitled to and leave it in the back stack — but it no
          // longer skips the explanation either. The tile *is* the whole module here, so the
          // feature and the module are the same name, which the sheet renders as
          // "Health is included with NoorLife Premium."
          requestUpgrade({
            featureTitle: theme.name,
            // Locked implies premium, and `main` has no tile — so the narrowing is safe.
            moduleId: theme.id as FrameworkModuleId,
            moduleName: theme.name,
            source: UPGRADE_SOURCES.moduleGrid,
          });
          return;
        }
        onSelectModule(theme);
      }}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? theme.name}
      accessibilityHint={
        isLocked
          ? 'Explains what NoorLife Premium includes'
          : `Opens the ${theme.name} module`
      }
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
      {/* Drawn first, so it desaturates the coloured surface and nothing else. A scrim rather than
          opacity on the tile: reducing the tile's own opacity would fade the label with it. */}
      {isLocked ? (
        <View
          pointerEvents="none"
          style={[styles.scrim, { borderRadius: dp(LOCKED.grid.tileRadius) }]}
          testID={`module-scrim-${theme.id}`}
        />
      ) : null}

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

      {isLocked ? <LockBadge testID={`module-lock-${theme.id}`} /> : null}
    </PressableScale>
  );
}

/**
 * The tile's lock badge: the shared padlock, upper right.
 *
 * ── Why there is no disc behind it ──────────────────────────────────────────
 * There used to be a near-white one, for a tile whose tint the glyph had to survive. Two things
 * removed the need. The scrim now sits beneath the content, so the ground under this badge is the
 * *desaturated* tint, where the shared ink measures 4.55–4.66:1 — well past the 3:1 an indicator
 * needs. And the disc could not be made to fit: the correction asks for an 18–20 dp container and
 * for the badge not to cover the pictogram, and an 83.5 dp tile holding a centred 48 dp pictogram
 * leaves a 17.75 dp margin — so any disc in that range overlaps the artwork's box. A bare 12 dp
 * glyph is 9.8 dp wide and clears it by ~3.9 dp.
 *
 * The deviation from the recommended container is therefore deliberate: the hard requirement (do not
 * cover the pictogram) wins over the recommendation, the contrast floor is still met by measurement,
 * and the tile now carries the same bare padlock as every other locked surface on the screen rather
 * than a treatment of its own.
 *
 * `pointerEvents="none"`, so it never intercepts the tap that raises the sheet.
 */
function LockBadge({ testID }: { readonly testID: string }) {
  const { dp } = useMetrics();

  return (
    <View style={[styles.badge, { top: dp(4), right: dp(4) }]} pointerEvents="none">
      <HomeLockBadge size={dp(LOCK_GLYPH)} testID={testID} />
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
