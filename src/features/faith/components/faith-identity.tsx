import { Image, StyleSheet, View } from 'react-native';

import { ModuleCard } from '@features/modules/components/module-card';
import { ModuleText } from '@features/modules/components';
import { moduleLayout } from '@features/modules/module-tokens';
import { useModuleMetrics } from '@features/modules/use-module-metrics';

import { getFaithSubmenuEntry, type FaithSubmenuKey } from '../faith-submenu-assets';

/**
 * The pictogram identity a Faith child screen inherits from the tile that opened it.
 *
 * ── Why every child needs one ───────────────────────────────────────────────
 * A user taps the Tasbih pictogram and lands on a screen whose only identifier is the
 * word "Tasbih" in a 17 dp header. The visual thread from tile to screen is broken, and
 * on a module with eight near-identical children that thread is most of the wayfinding.
 * Repeating the tile's own PNG closes it.
 *
 * ── One box for all eight ───────────────────────────────────────────────────
 * 56 dp, in the specified 48–64 band, identical on every child. Identical rather than
 * per-screen because these are seen in sequence — a Qibla mark that rendered larger than
 * the Hadith one would read as a hierarchy that does not exist.
 *
 * The PNG is transparent, `contain`, untinted, and sits directly on the card surface. No
 * wrapper well: the pictograms already carry their own visual container, and nesting them
 * in a second circle is what made the earlier builds look like icons-in-buttons.
 *
 * ── Not in the header ───────────────────────────────────────────────────────
 * Deliberately below it. The header title is centred and 17 dp; dropping a 56 dp image
 * into that row would either shrink the pictogram past legibility or push the title
 * off-centre. The identity belongs in the content column where it has room.
 */

export type FaithIdentityProps = {
  readonly submenu: FaithSubmenuKey;
  /** One line describing what the screen is for. */
  readonly summary: string;
  readonly testID?: string;
};

export function FaithIdentity({ submenu, summary, testID }: FaithIdentityProps) {
  const { dp } = useModuleMetrics();
  const entry = getFaithSubmenuEntry(submenu);
  const box = dp(moduleLayout.faithIdentityImage);

  return (
    <ModuleCard testID={testID ?? `faith-identity-${submenu}`}>
      <View style={[styles.row, { columnGap: dp(12) }]}>
        <Image
          source={entry.source}
          style={{ width: box, height: box }}
          resizeMode="contain"
          accessible={false}
          testID={`faith-identity-${submenu}-image`}
        />
        <View style={styles.text}>
          <ModuleText token="cardTitle" numberOfLines={1} accessibilityRole="header">
            {entry.label}
          </ModuleText>
          <ModuleText token="body" numberOfLines={2}>
            {summary}
          </ModuleText>
        </View>
      </View>
    </ModuleCard>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  text: {
    flex: 1,
    minWidth: 0,
  },
});
