import { StyleSheet, View } from 'react-native';

import { AppIcon } from '@ds/components';
import { ModuleText } from '@features/modules/components';
import { ModuleCard } from '@features/modules/components/module-card';
import { useModuleTheme } from '@features/modules/module-context';
import { moduleLayout, moduleNeutrals } from '@features/modules/module-tokens';
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
const CARD_PADDING_DP = 7;
const COLUMN_GAP_DP = 5;
const CHEVRON_DP = 12;
/** The local title face. Inside the reference's 10.5–11 dp band, at its lower end. */
const TITLE_DP = 10.5;
const TITLE_LINE_DP = 14;

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
  const { dp, screenWidth, stackTwoColumns } = useModuleMetrics();
  const stacked = shouldStackPrayerActions(screenWidth, stackTwoColumns);
  const gap = dp(moduleLayout.twoColumnGap);

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
        ── Not the reference's subtitle ────────────────────────────────────────
        The reference reads "Manage notifications", and that is a claim NoorLife cannot make: no
        permission is requested, nothing is scheduled, no background handler exists and no delivery
        can be verified. Two words that say exactly what the destination does instead.
      */
      subtitle="Preferences only"
      /*
        A restrained vector, deliberately. P3's dimensional gold bell is *held*: artwork that says
        "finished feature" beside a control that reminds nobody is the failure the held state exists
        to prevent. See `faith-pictogram-assets.ts`.
      */
      mark={{ kind: 'vector', icon: 'notification' }}
      onPress={onReminders}
      accessibilityLabel="Prayer reminders. Preferences only — NoorLife does not schedule notifications yet. Opens reminder preferences."
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

  return (
    <View style={[styles.row, { columnGap: gap }]} testID={testID}>
      <View style={styles.column}>{calculation}</View>
      <View style={styles.column}>{reminders}</View>
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
  column: {
    flex: 1,
    minWidth: 0,
  },
  flex: {
    flex: 1,
    minWidth: 0,
  },
  fill: {
    flex: 1,
  },
});
