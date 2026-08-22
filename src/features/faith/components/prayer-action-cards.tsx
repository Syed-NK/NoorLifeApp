import { StyleSheet, View } from 'react-native';

import { AppIcon } from '@ds/components';
import { ModuleText } from '@features/modules/components';
import { ModuleCard } from '@features/modules/components/module-card';
import { useModuleTheme } from '@features/modules/module-context';
import { moduleLayout, moduleNeutrals, moduleType } from '@features/modules/module-tokens';
import { useModuleMetrics } from '@features/modules/use-module-metrics';

import { faithPictogramSlot } from '../faith-pictogram-assets';
import { FaithPictogram, type FaithPictogramSlot } from './faith-locked-library';

/**
 * The two compact settings cards the approved reference sets side by side under the timeline.
 *
 * ── Why they are a pair rather than two rows in one group ───────────────────
 * The previous layout stacked them as rows inside a single card, which is what the arc dashboard
 * needed to claw back vertical space. The timeline does not need that space, and the reference draws
 * two equal cards in one row — which also makes their difference legible: they are two independent
 * destinations, not two lines of one setting.
 */

/**
 * Whether the pair must stack.
 *
 * ── Why the module's own signal is not the whole rule ───────────────────────
 * `stackTwoColumns` was calibrated on Faith Home's pairs, whose cards hold a heading and short rows.
 * These two hold a leading mark **and** a trailing chevron as well, so the same half-column leaves
 * materially less room for words — at 320 dp the module signal still says "two columns" while
 * "Calculation method" and its method name are each taking a second and third line.
 *
 * So the pair stacks below the module's reference width as well. Pure and exported, so the rule is
 * asserted directly rather than inferred from a rendered tree.
 */
export function shouldStackPrayerActions(screenWidth: number, stackTwoColumns: boolean): boolean {
  return stackTwoColumns || screenWidth < moduleLayout.referenceWidth;
}

/**
 * The width each title needs to render on **one line**, measured off the release build.
 *
 * ── Why these are measured numbers and not a guess at the ratio ─────────────
 * The pair used to be exactly half the row each, and the emulator showed what that costs: at 411 dp
 * the text column came to 108.2 dp, "Prayer reminders" rendered at 14.1 dp tall — one line — and
 * "Calculation method" rendered at **28.2 dp**, which is two. A wrapped title is the tallest thing in
 * either card, so it set the height of *both* (they stretch to match) and the row measured 57.5 dp
 * against the 44 dp its content actually needs.
 *
 * The interesting part is which line wrapped. The subtitle was the suspect — "Muslim World League" is
 * the longest string on the pair — and it was innocent: it measured 13.3 dp, one line, inside the same
 * 108.2 dp column. Only the title overflowed, and only on the calculation card, because it is the
 * longer of the two titles by two characters.
 *
 * So the correction is not "make one card bigger"; it is to give each card the width its own longest
 * line needs. These two constants are that requirement, in dp at the 393 dp baseline:
 *
 *   • `REMINDERS_TITLE_DP` — 104. "Prayer reminders" is known to fit inside 108.2 dp, and 104 is the
 *     largest value that leaves the other card enough. Any smaller and this one wraps instead, which
 *     would move the defect rather than fix it.
 *   • `CALCULATION_TITLE_DP` — 126. "Calculation method" is known **not** to fit inside 108.2 dp, and
 *     it is 18 characters against the other's 16 in the same face at the same size — so it needs
 *     about 108 × 18/16 ≈ 122 dp. 126 carries four dp of margin over that estimate, which is the
 *     honest amount given the estimate is a ratio rather than a second measurement.
 */
const CALCULATION_TITLE_DP = 126;
const REMINDERS_TITLE_DP = 104;

export type PrayerActionLayout =
  /** Side by side, at the widths each card's own longest line requires. */
  | {
      readonly kind: 'row';
      readonly calculationWidth: number;
      readonly remindersWidth: number;
    }
  /** One above the other, each at the full content width. */
  | { readonly kind: 'stacked' };

/**
 * How to lay the pair out, from the width actually available and what the text actually needs.
 *
 * ── Deterministic, and never a device check ─────────────────────────────────
 * Every input is a measurement: the content column the scaffold resolved, the gap between the cards,
 * the fixed furniture inside one (padding, mark, gaps, chevron) and the two title requirements above.
 * There is no width threshold standing in for a handset and no font-scale table.
 *
 * ── The stacking rule, and why it is a consequence rather than a second rule ──
 * The pair stacks when the row cannot give **both** cards their measured minimum. That covers the
 * narrow widths the old literal covered, and it also covers the case the literal could not see: a
 * large OS text size, where the titles grow but the column does not. React Native applies the font
 * scale on top of these dp values, so the requirement grows with it — dividing by the scale is what
 * expresses "the same words, in bigger letters, need more room".
 *
 * Stacking rather than shrinking is the whole point: nothing here reduces a font size, and nothing
 * ellipsises. A card that cannot hold its title beside its neighbour gets the full width instead.
 */
export function prayerActionLayout(input: {
  /** The scaffold's resolved content column, in dp. */
  readonly contentWidth: number;
  /** The gap between the two cards, in dp. */
  readonly gap: number;
  /** Fixed width inside one card: both paddings, the mark, both gaps and the chevron. */
  readonly overhead: number;
  /** The OS text-size setting. Requirements grow with it; the column does not. */
  readonly fontScale: number;
}): PrayerActionLayout {
  const { contentWidth, gap, overhead, fontScale } = input;
  const scale = Math.max(fontScale, 1);
  const calculation = CALCULATION_TITLE_DP * scale;
  const reminders = REMINDERS_TITLE_DP * scale;

  const available = contentWidth - gap;
  const required = calculation + reminders + overhead * 2;
  if (available < required) {
    return { kind: 'stacked' };
  }

  /*
    Whatever the row has over the minimum is shared in proportion to each card's requirement, so the
    surplus lands where the text is densest rather than being split evenly between a card that needs
    it and one that does not.
  */
  const surplus = available - required;
  const calculationWidth =
    overhead + calculation + (surplus * calculation) / (calculation + reminders);
  return {
    kind: 'row',
    calculationWidth,
    remindersWidth: available - calculationWidth,
  };
}

/**
 * The reference's proportions for a compact action card, at the 393 dp baseline.
 *
 * ── Why these four numbers are what they are ────────────────────────────────
 * The reference sets both titles on one line inside a 173.8 dp card. Measured off the mock, its
 * title renders 101.9 dp wide at a cap height of 7.1 dp — a ~10 dp face. Measured off the build at
 * 320 dp, "Calculation method" occupies 10.22 dp of width per dp of font size in Poppins SemiBold,
 * so at 10.5 dp it needs **107.3 dp** and at the module's 12 dp `cardHeading` it needs 122.6 — which
 * is why it took a second line.
 *
 * A 176 dp card leaves the text column `176 − 2×padding − mark − 2×gap − chevron`. At the previous
 * 10 / 30 / 8 / 14 that was 96 dp. These values leave **110 dp**, which clears 107.3 with real
 * margin rather than by a dp — 8 dp of padding would have left 108, and a 0.7 dp margin is inside
 * the error of the width measurement it rests on. 7 dp is also the reference's own: its card padding
 * measures 7.6 dp. Only the padding, the gaps and the chevron were tightened; the P4 gear stays at
 * 30 dp, because the instruction is not to shrink it.
 */
const MARK_DP = 30;
/**
 * The furniture around the text, tightened so the two titles can sit side by side on one line each.
 *
 * ── What moved, and what deliberately did not ───────────────────────────────
 * Padding 7 → 6, the internal gaps 5 → 4 and the chevron 12 → 10. Together they return ten dp of
 * text column across the pair, which is the difference between the row measuring 44 dp and 57.5.
 * The P4 gear stays at 30 dp — the instruction has never been to shrink it, and the mark is what
 * makes each card identifiable at a glance.
 *
 * The chevron is still drawn, still 10 dp, and still boxed. Its own note explains why the box
 * matters: an icon glyph's advance width exceeds its `size`, so an unboxed chevron quietly takes
 * more of the row than it is budgeted — which is exactly how a title ends up on two lines.
 */
const CARD_PADDING_DP = 6;
const COLUMN_GAP_DP = 4;
const CHEVRON_DP = 10;
/** The local title face. Inside the reference's 10.5–11 dp band, at its lower end. */
const TITLE_DP = 10.5;
const TITLE_LINE_DP = 14;

/** Padding + mark + both internal gaps + chevron. The fixed cost of one card, in dp. */
const CARD_OVERHEAD_DP = CARD_PADDING_DP * 2 + MARK_DP + COLUMN_GAP_DP * 2 + CHEVRON_DP;

/**
 * This row's contribution to the dashboard's height, and the numbers behind it.
 *
 * Exported so the fit contract can be *composed from the values that ship* rather than from a second
 * copy of them in a test. A change to the padding or the mark moves the model in the same commit,
 * which is the only way "the dashboard fits 411 dp" stays true rather than becoming a stale comment.
 */
export const prayerActionMetrics = {
  markDp: MARK_DP,
  cardPaddingDp: CARD_PADDING_DP,
  columnGapDp: COLUMN_GAP_DP,
  chevronDp: CHEVRON_DP,
  overheadDp: CARD_OVERHEAD_DP,
  calculationTitleDp: CALCULATION_TITLE_DP,
  remindersTitleDp: REMINDERS_TITLE_DP,
  /** One title line plus one subtitle line — the text column when nothing wraps. */
  textDp: TITLE_LINE_DP + moduleType.rowMeta[1],
  /** `ModuleCard` draws a one dp border on each edge, and both count toward the row's height. */
  borderDp: 2,
  /** The row's height with neither title wrapped: border + padding + the taller of mark and text. */
  get heightDp(): number {
    return this.borderDp + this.cardPaddingDp * 2 + Math.max(this.markDp, this.textDp);
  },
} as const;

export type PrayerActionCardsProps = {
  /** The live calculation method, e.g. "Muslim World League". Never a literal in this file. */
  readonly methodLabel: string;
  readonly onCalculation: () => void;
  readonly onReminders: () => void;
  readonly testID: string;
};

export function PrayerActionCards({
  methodLabel,
  onCalculation,
  onReminders,
  testID,
}: PrayerActionCardsProps) {
  const { dp, screenWidth, stackTwoColumns, contentWidth, fontScale } = useModuleMetrics();
  /*
    ── Two independent reasons to stack, and both have to be honoured ─────────
    The module's own signal still applies: below the reference width every card here is already being
    downscaled and the pair was calibrated above it. On top of that, the measured rule below stacks
    whenever the row cannot give both titles a single line — which is what covers a large OS text
    size at a width the first rule is happy with.
  */
  /*
    The next smaller existing spacing token, 7 rather than `twoColumnGap`'s 9. Two dp back into the
    text budget, taken from the one place on this row where the space is doing nothing but separating
    two cards that are already separated by their own borders.
  */
  const gap = dp(moduleLayout.sectionGap);
  const layout = prayerActionLayout({
    contentWidth,
    gap,
    overhead: dp(CARD_OVERHEAD_DP),
    fontScale,
  });
  const stacked =
    shouldStackPrayerActions(screenWidth, stackTwoColumns) || layout.kind === 'stacked';

  const calculation = (
    <ActionCard
      title="Calculation method"
      subtitle={methodLabel}
      /*
        P4, installed. It opens `/faith/preferences`, which owns the value the subtitle states — so
        dimensional artwork is upgrading a control that already does what it appears to do.
      */
      mark={{ kind: 'pictogram', slot: faithPictogramSlot('p4') }}
      onPress={onCalculation}
      accessibilityLabel={`Calculation method, currently ${methodLabel}. Opens calculation settings.`}
      testID="faith-prayer-calculation-settings"
    />
  );

  const reminders = (
    <ActionCard
      title="Prayer reminders"
      /*
        ── This said "Preferences only", and that stopped being true ───────────
        It was right when the destination stored switches and delivered nothing: no permission was
        requested, nothing was scheduled, and the card said so. Alerts are now real local
        notifications scheduled from the same instants this screen renders, so "preferences only" —
        and the spoken "NoorLife does not schedule notifications yet" below it — had become a
        statement that the feature does not work. Found on a device, on this card, one tap from the
        settings it was describing.

        Still not the reference's "Manage notifications", and deliberately not "Choose which prayers
        notify you" either — a phrase two existing tests explicitly ban, because it promises that a
        notification *will* arrive. Delivery is the one thing this feature can never claim: there is
        no receipt, and Do Not Disturb, battery saving and per-channel settings can each suppress an
        alert silently.

        So the subtitle describes the *settings* rather than an outcome. Their granularity is the
        useful thing to know before tapping, and it is true whatever the platform does afterwards.
      */
      subtitle="Per prayer, per day"
      /*
        A restrained vector, deliberately. P3's dimensional gold bell is *held*: artwork that says
        "finished feature" beside a control that reminds nobody is the failure the held state exists
        to prevent. See `faith-pictogram-assets.ts`.
      */
      mark={{ kind: 'vector', icon: 'notification' }}
      onPress={onReminders}
      accessibilityLabel="Prayer reminders. Notification settings for each prayer, including which days and how long before. Opens prayer reminder settings."
      testID="faith-prayer-reminders-action"
    />
  );

  if (stacked) {
    return (
      <View style={{ rowGap: gap }} testID={testID}>
        <View>{calculation}</View>
        <View>{reminders}</View>
      </View>
    );
  }

  /*
    ── Explicit widths, not `flex: 1` each ───────────────────────────────────
    Equal flex is what produced two 174 dp cards and a wrapped title on the one that needed 126 dp of
    text. These are the widths the rule computed, so each card is exactly as wide as its own longest
    line requires plus its share of whatever the row had spare. `alignItems: 'stretch'` still matches
    their heights, which is now 44 dp for both because neither title wraps.
  */
  const widths = layout.kind === 'row' ? layout : null;
  return (
    <View style={[styles.row, { columnGap: gap }]} testID={testID}>
      <View style={{ width: widths?.calculationWidth }}>{calculation}</View>
      <View style={{ width: widths?.remindersWidth }}>{reminders}</View>
    </View>
  );
}

type ActionMark =
  | { readonly kind: 'pictogram'; readonly slot: FaithPictogramSlot }
  | { readonly kind: 'vector'; readonly icon: 'notification' };

function ActionCard({
  title,
  subtitle,
  mark,
  onPress,
  accessibilityLabel,
  testID,
}: {
  readonly title: string;
  readonly subtitle: string;
  readonly mark: ActionMark;
  readonly onPress: () => void;
  readonly accessibilityLabel: string;
  readonly testID: string;
}) {
  const theme = useModuleTheme();
  const { dp, scale } = useModuleMetrics();

  return (
    <ModuleCard
      padding={CARD_PADDING_DP}
      onPress={onPress}
      accessibilityLabel={accessibilityLabel}
      style={styles.fill}
      testID={testID}
    >
      <View style={[styles.row, { columnGap: dp(COLUMN_GAP_DP) }]}>
        {/*
          ── A fixed box, so the text column is the width the arithmetic says ──
          Both marks are laid out inside the same `MARK_DP` box. Without it the two cards had
          *different* text columns — the gear is an `Image` at 30 dp, the bell a glyph at 24 — so the
          reminders title fitted on one line and the calculation title did not, which looked like a
          font problem and was a layout one.
        */}
        <View style={[styles.mark, { width: dp(MARK_DP), height: dp(MARK_DP) }]}>
          {mark.kind === 'pictogram' ? (
            <FaithPictogram slot={mark.slot} size={dp(MARK_DP)} testID={`${testID}-pictogram`} />
          ) : (
            <AppIcon name={mark.icon} size={dp(MARK_DP * 0.8)} color={theme.ink} />
          )}
        </View>
        <View style={styles.flex}>
          {/*
            ── A local size, and only here ─────────────────────────────────────
            The token stays `cardHeading`, so the face is still Poppins SemiBold and the ink is still
            the shared primary; only `fontSize` and `lineHeight` are overridden, on this one card.
            `moduleType.cardHeading` is untouched — it is set on card headings across three modules,
            and shrinking it there to fix a 176 dp column here would be the wrong direction.

            Scaled the way `useModuleMetrics().type` scales a token — value × layout scale, one
            decimal kept — so this line behaves like every other piece of type in the module on a
            narrow device. The **OS** font scale is applied on top by React Native, which is what
            lets the title wrap naturally at an enlarged text size instead of being pinned to one
            line; `numberOfLines={2}` is the ceiling on that, so it can never clip.
          */}
          <ModuleText
            token="cardHeading"
            numberOfLines={2}
            style={local(TITLE_DP, TITLE_LINE_DP)}
            testID={`${testID}-title`}
          >
            {title}
          </ModuleText>
          {/*
            `rowMeta` rather than a second local override: it is an existing global token at the size
            this line needs, and the reference sets the method name visibly smaller than the title.
          */}
          <ModuleText token="rowMeta" numberOfLines={2} testID={`${testID}-subtitle`}>
            {subtitle}
          </ModuleText>
        </View>
        {/*
          Decorative, and boxed for the same reason as the mark: an icon glyph's own advance width is
          wider than its `size`, so an unboxed chevron quietly took ~8 dp more of the row than it was
          budgeted and pushed the title onto a second line.

          The touch target is the whole card — `ModuleCard` carries the press — so the glyph is sized
          to the reference rather than to a 44 dp minimum it does not need to meet.
        */}
        <View style={[styles.mark, { width: dp(CHEVRON_DP) }]}>
          <AppIcon
            name="chevron-forward"
            size={dp(CHEVRON_DP)}
            color={moduleNeutrals.textSecondary}
          />
        </View>
      </View>
    </ModuleCard>
  );

  /** A token's size overridden locally, scaled exactly as `useModuleMetrics().type` scales one. */
  function local(fontSize: number, lineHeight: number) {
    return {
      fontSize: +(fontSize * scale).toFixed(1),
      lineHeight: +(lineHeight * scale).toFixed(1),
    };
  }
}

const styles = StyleSheet.create({
  /** A fixed box for a mark or a chevron, so neither takes more of the row than it is budgeted. */
  mark: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  flex: {
    flex: 1,
    minWidth: 0,
  },
  fill: {
    flex: 1,
  },
});
