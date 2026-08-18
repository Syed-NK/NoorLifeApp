import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, View } from 'react-native';

import { modulePalettes } from '@ds/tokens';
import { ModuleText } from '@features/modules/components';
import { moduleColorThemes, moduleLayout, moduleNeutrals } from '@features/modules/module-tokens';
import { useModuleMetrics } from '@features/modules/use-module-metrics';

import type { NextPrayerDayRelation } from '../data/prayer-times.repository';
import { FaithPictogram, type FaithPictogramSlot } from './faith-locked-library';
import { PrayerProgressRing } from './prayer-progress-ring';

/**
 * The approved deep-emerald next-prayer card.
 *
 * ── Every value on it is live ───────────────────────────────────────────────
 * The reference is one capture of one day at one place — Dhuhr, 1:14 PM, 8 hr 29 min. None of those
 * is a string in this file. The prayer, its wall clock, the countdown and the ring's proportion all
 * arrive as props from the repository and the countdown hook, so the card shows whatever the day
 * actually is. `faith-prayer-timeline-layout.test.tsx` scans this file for the reference's literals.
 *
 * ── Contrast, measured rather than assumed ──────────────────────────────────
 * The ground is Faith's own `dark` (#155E4D) through `gradientStart` (#1A6452). White measures
 * 7.67:1 on the darker end and 7.03:1 on the lighter, and the palest Faith green measures 6.91:1 —
 * so the prayer line, the eyebrow and the countdown all clear AA comfortably and the display line
 * clears AAA. Gold is used only for the ring's head, which is non-text UI at 3.51:1 against the
 * darker end and therefore above the 3:1 the threshold for it is.
 */

/**
 * The two ends of the ground, and the pale green set on it. Both from locked sources.
 *
 * `dark` is the Faith palette's own deep green; `gradientStart` is the module theme's, already
 * asserted at 7.03:1 against white by `module-tokens.test.ts`. No hex is written here.
 */
const DEEP = modulePalettes.faith.dark;
const DEEP_END = moduleColorThemes.faith.gradientStart;
const MINT = modulePalettes.faith.soft;

/**
 * The card's proportions at the 393 dp baseline.
 *
 * The reference gives the prayer marker more room here than anywhere else in the module: it is the
 * single thing the screen is about, and at the grid's 36 dp it read as a bullet beside its own
 * headline. The ring is sized to hold two lines of countdown without crowding its stroke.
 */
/**
 * 62, at the low end of the reference's 62–72 dp band, and the ring at 78 of its 72–82.
 *
 * ── Why both sit low in their bands ─────────────────────────────────────────
 * The three parts share one row, so every dp given to the marker or the ring is taken from the
 * prayer line between them. At 68 and 80 that line measured 156 dp against a 155 dp column, so
 * "Dhuhr at 1:14 PM" broke after "1:14" — measured on the emulator, one dp short. These values leave
 * the column 173 dp, which holds the longest case ("Maghrib at 8:03 PM", 167 dp) with room to spare,
 * and still put the card at 110 dp inside the reference's 108–122 band.
 */
const PICTOGRAM_DP = 62;
/*
  72, the floor of the reference's 72-82 dp band, down from 78.

  The ring is the tallest thing in this card, so it alone sets the card's height: at 78 with 15 dp of
  padding the card measured 107.8 dp on the emulator. At 72 with 13 it measures 98, which is where
  the ten dp the dashboard needed came from. The stroke is unchanged and the inner disc still holds
  two lines of countdown without crowding — 72 less two 6 dp strokes is 60 dp against 30 dp of text.
*/
const RING_DP = 72;
const RING_STROKE_DP = 6;
const CARD_PADDING_DP = 13;
/** Between the marker, the copy and the ring. 9 dp, for the same reason the two above are low. */
const COLUMN_GAP_DP = 9;

/** This card's contribution to the dashboard's height. See `prayerActionMetrics` for why. */
export const prayerNextMetrics = {
  ringDp: RING_DP,
  pictogramDp: PICTOGRAM_DP,
  cardPaddingDp: CARD_PADDING_DP,
  /** A gradient, not a `ModuleCard` — no border to count. */
  get heightDp(): number {
    return this.cardPaddingDp * 2 + Math.max(this.ringDp, this.pictogramDp);
  },
} as const;

export type PrayerNextSummaryProps = {
  /** The next prayer's marker — its own approved P2 artwork, never tinted. */
  readonly pictogram: FaithPictogramSlot;
  readonly prayerName: string;
  /** The wall clock at the **location**, already formatted. */
  readonly clock: string;
  /** "8 hr 29 min remaining", or "now". */
  readonly remaining: string;
  /** The same duration split for the ring, at most two lines. */
  readonly remainingLines: readonly string[];
  /**
   * Which day the prayer falls on at the location.
   *
   * ── Why the qualifier belongs in this card ──────────────────────────────
   * After Isha this card shows tomorrow's Fajr while the timeline below shows today's, and the two
   * differ by a minute or so. The screen already carried a sentence explaining that — at the foot of
   * a different card, a full screen height below the contradiction it explains. A reader comparing
   * "4:31" here with "4:30" there has no reason to scroll looking for a footnote.
   */
  readonly dayRelation: NextPrayerDayRelation;
  /** 0–1 elapsed through the current interval, or `null` when that interval is not knowable. */
  readonly progress: number | null;
  readonly testID: string;
};

export function PrayerNextSummary({
  pictogram,
  prayerName,
  clock,
  remaining,
  remainingLines,
  dayRelation,
  progress,
  testID,
}: PrayerNextSummaryProps) {
  const { dp, stackTwoColumns } = useModuleMetrics();

  /*
    The eyebrow carries the qualifier rather than the title line. The title is `${prayerName} at
    ${clock}` and is the one string on this card that may never be abbreviated or wrapped mid-time —
    its own note records that it was already retuned to stop the longest prayer name breaking the
    line. Appending "tomorrow" there would reintroduce exactly that. The eyebrow is a short caption
    with room, sits directly above the time, and is read first.
  */
  const eyebrow = dayRelation === 'tomorrow' ? 'Next prayer tomorrow' : 'Next prayer';

  /*
    The same signal the module's two-column pairs use. At a narrow width or a large OS text size the
    three parts stack instead of shrinking — the brief's rule, and the module's existing one, so the
    whole screen reflows on one decision rather than on a guess local to this card.
  */
  const stacked = stackTwoColumns;

  return (
    <LinearGradient
      colors={[DEEP, DEEP_END]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={{
        borderRadius: dp(moduleLayout.cardRadius),
        padding: dp(CARD_PADDING_DP),
        flexDirection: stacked ? 'column' : 'row',
        alignItems: 'center',
        columnGap: dp(COLUMN_GAP_DP),
        rowGap: dp(10),
      }}
      accessible
      /*
        One utterance, in the order the card reads: what this is, which prayer and when, then how
        long. The ring is not announced separately — it is the same duration drawn a second way, and
        hearing it twice would be noise. When the interval is unknown the ring simply has no sweep;
        the spoken sentence is unchanged, because the countdown never depended on the interval.
      */
      accessibilityLabel={`${eyebrow}. ${prayerName} at ${clock}. ${remaining}.`}
      testID={testID}
    >
      <FaithPictogram slot={pictogram} size={dp(PICTOGRAM_DP)} testID={`${testID}-pictogram`} />

      <View style={[styles.flex, { rowGap: dp(2) }, stacked ? styles.centred : null]}>
        <ModuleText
          token="caption"
          color={MINT}
          align={stacked ? 'center' : undefined}
          numberOfLines={2}
          testID={`${testID}-eyebrow`}
        >
          {eyebrow}
        </ModuleText>
        {/*
          ── `heroTitle`, not `faithPrayer` ────────────────────────────────────
          `faithPrayer` is the module's token for exactly this pair — a prayer joined to its time —
          and its own note records why it is 20 dp: it was measured against the hero's 199 dp copy
          column. This card's column is 173 dp, and at 20 dp the longest name overflows it and breaks
          the line mid-time. `heroTitle` is 19 dp in the same SemiBold face, which fits every prayer
          name here with room to spare. Changing `faithPrayer` instead would have shrunk the hero to
          suit a narrower card, which is the wrong direction.

          Uncapped: this line is the card's entire subject, and it is the one string here that must
          never be abbreviated.
        */}
        <ModuleText
          token="heroTitle"
          color={moduleNeutrals.surface}
          align={stacked ? 'center' : undefined}
          testID={`${testID}-prayer`}
        >
          {`${prayerName} at ${clock}`}
        </ModuleText>
        <ModuleText
          token="body"
          color={MINT}
          align={stacked ? 'center' : undefined}
          testID={`${testID}-remaining`}
        >
          {remaining}
        </ModuleText>
      </View>

      <PrayerProgressRing
        size={dp(RING_DP)}
        stroke={dp(RING_STROKE_DP)}
        progress={progress}
        lines={remainingLines}
        testID={`${testID}-ring`}
      />
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
    minWidth: 0,
  },
  centred: {
    alignItems: 'center',
  },
});
