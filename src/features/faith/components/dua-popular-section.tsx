import { ScrollView, StyleSheet, View } from 'react-native';

import { AppIcon, PressableScale } from '@ds/components';
import { modulePalettes } from '@ds/tokens';
import { ModuleText } from '@features/modules/components';
import { moduleLayout, moduleNeutrals } from '@features/modules/module-tokens';
import { useModuleMetrics } from '@features/modules/use-module-metrics';

import { popularSectionLayout } from '../data/duas/dua-popular';
import { duaSourceLabel, type ReviewedDua } from '../data/duas/reviewed-dua';
import { SelectionOriginBadge } from './quran-selection-view';

/**
 * **Popular Duas** — the section a reviewer's editorial rank fills, and which draws nothing until one
 * does.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── It renders nothing today, and that is the finished behaviour ───────────
 * `entries` is empty for every category in this build, because "popular" here means *a named reviewer
 * assigned this entry a rank*, and no reviewer has ranked anything. The component returns `null` — no
 * heading, no skeleton, no placeholder cards, and no "coming soon". The page around it renders normally.
 *
 * The reason for building it anyway is that the alternative puts content behind engineering: a section
 * that had to be designed the day a manifest arrived would mean reviewed supplications waiting on a
 * screen change rather than on review. Everything from the rank's home inside the review record to this
 * card's layout is finished, so the arrival of content is a data change and nothing else.
 *
 * ── Why it cannot be filled with anything else ─────────────────────────────
 * `entries` is `ReviewedDua[]`. A `QuranSelection` will not typecheck, so the tempting fix for an empty
 * section — show the user's own selections here — is not available to this component or to a later
 * refactor of it. Describing somebody's private choice as popular would attribute to it a claim about
 * what other people do. See `popularDuas` for the same guard at the data layer.
 *
 * ── The row stops scrolling sideways when it stops being honest ────────────
 * `popularSectionLayout` decides. A horizontal row hides some of its cards and relies on a cut-off card
 * as the hint that more exist; at a large text size the cards grow, the viewport does not, and the hint
 * disappears along with the content. Then it stacks. See that function for the full reasoning.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const EMERALD_DEEP = modulePalettes.faith.dark;

export type DuaPopularSectionProps = {
  /** Ranked reviewed entries, already ordered. Empty means the section does not exist. */
  readonly entries: readonly ReviewedDua[];
  /** Ranked entries the display bound left out, so the count can be stated rather than hidden. */
  readonly overflowCount: number;
  readonly onOpen: (duaId: string) => void;
  readonly testIDPrefix?: string;
};

export function DuaPopularSection({
  entries,
  overflowCount,
  onOpen,
  testIDPrefix = 'faith-dua-category-popular',
}: DuaPopularSectionProps) {
  const { dp, fontScale, stackTwoColumns, contentWidth } = useModuleMetrics();

  /*
    The whole section, heading included. A heading over nothing is a promise, and an empty state here
    would be the third different sentence about unreviewed content on one page — the results section
    below already says it once, accurately.
  */
  if (entries.length === 0) {
    return null;
  }

  const layout = popularSectionLayout({ stackTwoColumns, fontScale });
  /*
    Two thirds of the reading width, so the next card is always partly visible and is its own affordance
    for the swipe. A full-width card would look like the only one there is.
  */
  const cardWidth = layout === 'horizontal' ? Math.round(contentWidth * 0.66) : null;

  const cards = entries.map((entry) => (
    <PopularCard
      key={entry.id}
      entry={entry}
      width={cardWidth}
      onPress={() => onOpen(entry.id)}
      testID={`${testIDPrefix}-${entry.id}`}
    />
  ));

  return (
    <View style={{ rowGap: dp(6) }} testID={testIDPrefix}>
      <ModuleText
        token="cardTitle"
        color={moduleNeutrals.textPrimary}
        numberOfLines={2}
        accessibilityRole="header"
      >
        Popular Duas
      </ModuleText>

      {layout === 'horizontal' ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ columnGap: dp(moduleLayout.cardGap) }}
          testID={`${testIDPrefix}-scroll`}
        >
          {cards}
        </ScrollView>
      ) : (
        <View style={{ rowGap: dp(8) }} testID={`${testIDPrefix}-stacked`}>
          {cards}
        </View>
      )}

      {/*
        Said, not hidden. A bound that silently truncates reads as "this is all of them", and the honest
        version costs one line and points at where the rest actually are.
      */}
      {overflowCount === 0 ? null : (
        <ModuleText token="caption" numberOfLines={2} testID={`${testIDPrefix}-overflow`}>
          {`${overflowCount} more ${overflowCount === 1 ? 'is' : 'are'} in the list below.`}
        </ModuleText>
      )}
    </View>
  );
}

/**
 * One compact card.
 *
 * ── Compact means fewer facts, not smaller ones ────────────────────────────
 * The badge, the title and the reference. No context note, no review record, no repetition and no
 * actions — those are on the detail page a tap away, and crowding them onto a card that is two thirds of
 * a screen wide is how the reference ends up truncated beside a row of 30 dp targets. Type does not
 * shrink here any more than it does anywhere else in this module.
 */
function PopularCard({
  entry,
  width,
  onPress,
  testID,
}: {
  readonly entry: ReviewedDua;
  /** A fixed width in the horizontal row; `null` when stacked and the card fills its line. */
  readonly width: number | null;
  readonly onPress: () => void;
  readonly testID: string;
}) {
  const { dp } = useModuleMetrics();
  const reference = duaSourceLabel(entry.source);

  return (
    <PressableScale
      onPress={onPress}
      accessibilityRole="button"
      /* Says what it is, where it is from, and that it was reviewed — the claim the badge carries visually. */
      accessibilityLabel={`${entry.title}. ${reference}. Scholarly-reviewed.`}
      style={[
        styles.card,
        width === null ? styles.fullRow : { width },
        {
          borderRadius: dp(moduleLayout.cardRadius),
          padding: dp(moduleLayout.cardPadding),
          rowGap: dp(6),
          minHeight: dp(moduleLayout.minTouchTarget),
        },
      ]}
      testID={testID}
    >
      <SelectionOriginBadge origin="reviewed" />
      <ModuleText token="body" color={moduleNeutrals.textPrimary} numberOfLines={2}>
        {entry.title}
      </ModuleText>
      <View style={[styles.row, { columnGap: dp(6) }]}>
        <ModuleText
          token="caption"
          color={EMERALD_DEEP}
          numberOfLines={1}
          style={styles.flex}
          testID={`${testID}-reference`}
        >
          {reference}
        </ModuleText>
        <AppIcon name="chevron-forward" size={dp(16)} color={EMERALD_DEEP} />
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  row: { alignItems: 'center', flexDirection: 'row' },
  card: {
    backgroundColor: moduleNeutrals.surface,
    borderColor: moduleNeutrals.border,
    borderWidth: 1,
  },
  fullRow: { width: '100%' },
});
