import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { AppIcon, PressableScale } from '@ds/components';

import { useModule, useModuleTheme } from '../module-context';
import type { ModuleQuickActionSpec } from '../module-definition';
import { moduleLayout, moduleNeutrals } from '../module-tokens';
import { moduleRasterIcon } from '../module-raster-icons';
import { quickActionColumns } from '../quick-action-fit';
import { useModuleMetrics } from '../use-module-metrics';
import { ModuleText } from './module-text';

/**
 * A tile's own width, around whatever label it holds.
 *
 * These were inline literals in the tile's style. The fit rule has to know them — the reason
 * "Memories" split mid-word is the label *plus this chrome* against a third of the content column —
 * and a rule reading a number the style could change independently is a rule that drifts. So the
 * style below and `tileChromeWidth` read the same constants, and `quick-action-fit.test.ts` asserts
 * that they do.
 */
const TILE_PADDING_H = 8;
const TILE_ICON_WELL = 26;
const TILE_INNER_GAP = 6;
/**
 * The card's own border, which is **not** scaled by `dp()`.
 *
 * Found by measurement, not by reading: the model said a 384 dp tile was 110.7 dp wide and the device
 * reported 108.4. The missing 2 dp is `borderWidth: 1` on each side, and 2 dp is 4% of the narrowest
 * text box — more than the whole headroom. A fit rule that ignores it is optimistic exactly where it
 * must not be.
 */
const TILE_BORDER = 1;

/** Lines a quick-action label may take. Two, as approved — reducing columns is what gives it room. */
const LABEL_LINES = 2;

/** Total width a tile adds to its label, at the current layout scale. */
function tileChromeWidth(dp: (value: number) => number): number {
  return TILE_BORDER * 2 + dp(TILE_PADDING_H) * 2 + dp(TILE_ICON_WELL) + dp(TILE_INNER_GAP);
}

export type ModuleQuickActionProps = {
  readonly action: ModuleQuickActionSpec;
  readonly onPress?: () => void;
  readonly testID?: string;
};

/**
 * One quick action.
 *
 * A 62 dp card holding an icon and a label. The label is `numberOfLines={2}` rather
 * than one: Main Home's review specifically rejected truncated quick-action labels,
 * and "Ask Faith AI" does not fit one line in a third of the content width.
 *
 * ── Why the icon well and gaps are as tight as they are ─────────────────────
 * At one third of a 393 dp column there are about 66 dp for text. The first build spent
 * 30 dp on the icon well and 8 dp on the gap, leaving ~56 dp — and "Memories" needs
 * ~50 dp plus bearing, so on the Pixel 8 it broke mid-word as "Memorie / s". React
 * Native breaks inside a word when the word cannot fit, so the fix is room, not a
 * shorter label: the registry's copy is the product's copy, and trimming it to suit the
 * layout would be the wrong way round.
 */
export function ModuleQuickAction({ action, onPress, testID }: ModuleQuickActionProps) {
  const router = useRouter();
  /*
    The module, for the artwork lookup — and read through the hook rather than assumed.

    Without this, `module` here resolves to Node's own module global, which is typed and therefore
    compiles: `module.id` becomes a file path, the artwork lookup misses, and every tile silently
    keeps its glyph. The test caught it; the compiler could not.
  */
  const module = useModule();
  const theme = useModuleTheme();
  const { dp } = useModuleMetrics();

  return (
    <PressableScale
      onPress={
        onPress ??
        (() => {
          if (action.href !== undefined) {
            router.push(action.href);
          }
        })
      }
      accessibilityRole="button"
      accessibilityLabel={action.accessibilityLabel ?? action.label}
      style={[
        styles.card,
        {
          minHeight: dp(moduleLayout.quickActionHeight),
          borderRadius: dp(moduleLayout.radiusSmall),
          borderColor: moduleNeutrals.border,
          columnGap: dp(TILE_INNER_GAP),
          paddingHorizontal: dp(TILE_PADDING_H),
          paddingVertical: dp(TILE_PADDING_H),
        },
      ]}
      testID={testID}
    >
      <View
        style={[
          styles.iconWell,
          {
            width: dp(TILE_ICON_WELL),
            height: dp(TILE_ICON_WELL),
            borderRadius: dp(TILE_ICON_WELL / 2),
            backgroundColor: theme.lightSurface,
          },
        ]}
      >
        {/*
          Commissioned artwork where this module has it, the glyph everywhere else — issue #68.

          The size and the icon well are unchanged, so a tile with artwork occupies exactly the box a
          tile with a glyph did. Artwork carries no tint: `theme.ink` is the glyph's colour and has
          no meaning for a pictogram that was drawn in the module's palette already.
        */}
        {(() => {
          const art = moduleRasterIcon(module.id, action.icon);
          return art === null ? (
            <AppIcon
              name={action.icon}
              size={dp(moduleLayout.quickActionIcon * 0.75)}
              color={theme.ink}
            />
          ) : (
            <AppIcon
              source={art}
              size={dp(moduleLayout.quickActionIcon * 0.75)}
              testID={testID === undefined ? undefined : `${testID}-art`}
            />
          );
        })()}
      </View>
      <ModuleText token="quickAction" numberOfLines={LABEL_LINES} style={styles.label}>
        {action.label}
      </ModuleText>
    </PressableScale>
  );
}

export type ModuleQuickActionRowProps = {
  /** Defaults to the module's own quick actions. */
  readonly actions?: readonly ModuleQuickActionSpec[];
  readonly onSelect?: (action: ModuleQuickActionSpec) => void;
  readonly testID?: string;
};

/**
 * The quick-action row beneath the hero. Equal-width cards, so none dominates.
 *
 * ── Why this wraps rather than staying one line (issue #52) ──────────────────
 * It used to be a single flex row, which made the column count the *action* count and left each
 * tile a third of the content column — 52.7 dp of text at 320 dp. At OS text size 1.3 and above the
 * approved labels stopped fitting that: "Memories" split between letters and "Ask Family AI"
 * ellipsised, because a single-line-too-narrow tile has nothing else to give.
 *
 * `quickActionColumns` now answers how many columns this row's own labels can take, and the tiles
 * lay out as a wrapping grid of that many. Three are kept wherever they work, which is every module
 * at the default text size; a row falls to two or one only where its copy genuinely does not fit.
 * Order, navigation, accessibility labels and tile styling are untouched — the grid is the only
 * thing that changes, and it grows downward instead of squeezing sideways.
 */
export function ModuleQuickActionRow({ actions, onSelect, testID }: ModuleQuickActionRowProps) {
  const module = useModule();
  const { dp, contentWidth, fontScale, type } = useModuleMetrics();
  const items = actions ?? module.quickActions;
  const prefix = testID ?? `${module.id}-quick`;

  const columnGap = dp(moduleLayout.cardGap);
  const columns = quickActionColumns({
    labels: items.map((action) => action.label),
    contentWidth,
    columnGap,
    tileChromeWidth: tileChromeWidth(dp),
    fontSize: type('quickAction').fontSize,
    fontScale,
    maxLines: LABEL_LINES,
  });

  /*
    An explicit width rather than `flex: 1`, because a wrapping row cannot use flex to make its last
    line's tiles match the ones above. Equal widths are the approved property — a lone tile on the
    second line stays one column wide rather than stretching to dominate the row.
  */
  const tileWidth = (contentWidth - columnGap * (columns - 1)) / columns;

  return (
    <View style={[styles.row, { columnGap, rowGap: columnGap }]} testID={testID}>
      {items.map((action) => (
        <View key={action.key} style={{ width: tileWidth }}>
          <ModuleQuickAction
            action={action}
            onPress={onSelect === undefined ? undefined : () => onSelect(action)}
            testID={`${prefix}-${action.key}`}
          />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: moduleNeutrals.surface,
    borderWidth: TILE_BORDER,
  },
  iconWell: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    flex: 1,
    minWidth: 0,
  },
  row: {
    flexDirection: 'row',
    // Wraps onto another line when the fit rule reduces the column count.
    flexWrap: 'wrap',
  },
});
