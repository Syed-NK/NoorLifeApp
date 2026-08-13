import { StyleSheet, View } from 'react-native';

import { AppIcon } from '@ds/components';
import { modulePalettes, shadowCard } from '@ds/tokens';
import { ModuleText } from '@features/modules/components';
import { ModuleCard } from '@features/modules/components/module-card';
import { useModuleTheme } from '@features/modules/module-context';
import { moduleLayout, moduleNeutrals } from '@features/modules/module-tokens';
import { useModuleMetrics } from '@features/modules/use-module-metrics';

import type { PrayerMarkerState } from '../data/prayer/prayer-interval';
import { FaithPictogram, type FaithPictogramSlot } from './faith-locked-library';

/**
 * "Today's prayer journey" — the day's six markers as one chronological vertical timeline.
 *
 * ── Why vertical, and what it replaced ──────────────────────────────────────
 * A semicircular arc with the six markers spaced around it. The arc had to reconcile two things it
 * could not: prominent artwork and true time-proportional placement. Maghrib to Isha can be 9% of a
 * day, so honouring the proportions drove every marker toward 24 dp, and holding the marker size
 * meant the spacing stopped meaning anything. A vertical list has no such conflict — it is ordered
 * rather than scaled, which is exactly the claim the data supports — and it grows downwards when the
 * OS text size does, where the arc could only shrink.
 *
 * ── Three states, and none of them is carried by colour alone ───────────────
 * Emerald and neutral do most of the visual work, and a reader who cannot separate those two hues
 * still has three independent cues:
 *
 *   passed    the track through the marker is drawn at full weight, and the five *prayers* carry a
 *             completion badge.
 *   next      the marker is larger, ringed in gold, and its row is highlighted and set in a heavier
 *             face at a larger size than the rows around it.
 *   upcoming  a hairline track, no badge, no highlight.
 *
 * Sunrise deliberately never carries the completion badge. It is a time marker, not a prayer, so
 * "completed" is not a thing that can be true of it — its track weight still shows that it has
 * passed, which is a statement about the clock rather than about worship.
 */

/** NoorLife's own gold, from the locked Faith palette. Never a new hue. */
const GOLD = modulePalettes.faith.supporting;

/**
 * The reference's proportions at the 393 dp baseline.
 *
 * The rail is wide enough for the largest disc plus air, so the text column starts on the same x
 * whichever marker is next — a rail that resized with the state would shift every label sideways
 * once an hour.
 */
const RAIL_DP = 50;
const DISC_DP = 38;
const NEXT_DISC_DP = 46;
const PICTOGRAM_DP = 34;
const NEXT_PICTOGRAM_DP = 38;
/**
 * 50, and measured rather than chosen.
 *
 * At 52 the six rows rendered at a 52 dp pitch and the card measured 369.5 dp — 4.5 dp above the
 * reference's 330–365 band. 50 lands it at ~357 dp with the pitch still inside the reference's
 * 48–54 dp row band, and still leaves 12 dp of visible track between two discs.
 */
const ROW_MIN_HEIGHT_DP = 50;
/**
 * Vertical breathing room, carried by the **text column** rather than by the row.
 *
 * It was `paddingVertical` on the row, and that put it on the wrong element: an absolutely
 * positioned child is laid out against its parent's padding box, so the rail — and therefore the
 * track — spanned the row *minus* both paddings. With a 38 dp disc in a 52 dp row that left 3.5 dp
 * of visible line above and below rather than 7, and the timeline read as six circles joined by
 * dashes. On the text column it grows the row identically and leaves the rail full height.
 */
const ROW_PADDING_DP = 4;
const BADGE_DP = 15;
/** Track weights. The difference is deliberate and load-bearing — see the note on states above. */
const TRACK_PASSED_DP = 3;
const TRACK_UPCOMING_DP = 2;

/**
 * The upcoming track's colour.
 *
 * ── Why not the divider hairline ────────────────────────────────────────────
 * `moduleNeutrals.divider` (#E6EAF2) is the right value for a rule *between* rows and the wrong one
 * for a track: it measures 1.13:1 against the card's white, so on the emulator the timeline rendered
 * as six unconnected circles with nothing joining them. `textTertiary` measures 3.6:1 — visible as a
 * line, and still the quietest neutral in the palette, which is what "restrained" has to mean for
 * something that must actually be seen.
 */
const TRACK_UPCOMING_COLOUR = moduleNeutrals.textTertiary;

/**
 * The three states, re-exported from the domain rather than restated here.
 *
 * They are a fact about the day, not about this drawing — see `data/prayer/prayer-interval.ts`.
 */
export type PrayerJourneyState = PrayerMarkerState;

export type PrayerJourneyEntry = {
  readonly key: string;
  readonly label: string;
  /** The wall clock at the location, already formatted. */
  readonly clock: string;
  readonly pictogram: FaithPictogramSlot;
  readonly state: PrayerJourneyState;
  /**
   * False for Sunrise, true for the five prayers.
   *
   * Drives the completion badge and the spoken description, so "not a prayer" is a property of the
   * entry rather than a string comparison against a label that could be translated later.
   */
  readonly isPrayer: boolean;
};

export type PrayerJourneyTimelineProps = {
  /** In chronological order. Six entries on an ordinary day. */
  readonly entries: readonly PrayerJourneyEntry[];
  /**
   * The honest day-boundary line, when today's markers have all passed.
   *
   * `null` on an ordinary day. Present after Isha, when the next prayer is *tomorrow's* Fajr and no
   * row on this card may be highlighted — highlighting today's completed Fajr would say the day has
   * not started, which is the opposite of true.
   */
  readonly dayBoundaryNote: string | null;
  readonly testID: string;
};

export function PrayerJourneyTimeline({
  entries,
  dayBoundaryNote,
  testID,
}: PrayerJourneyTimelineProps) {
  const { dp } = useModuleMetrics();

  return (
    <ModuleCard testID={testID}>
      <ModuleText
        token="cardHeading"
        accessibilityRole="header"
        style={{ marginBottom: dp(6) }}
        testID={`${testID}-heading`}
      >
        Today’s prayer journey
      </ModuleText>

      {entries.map((entry, index) => (
        <Row
          key={entry.key}
          entry={entry}
          /*
            The segment between two markers is emerald once the marker *above* it has passed, so the
            completed run ends at the first marker that has not. Drawn per row as two halves meeting
            at the disc's centre; the first row has no half above it and the last none below, which
            is what makes the track start and end on a marker rather than at a card edge.
          */
          trackAbove={index === 0 ? null : (entries[index - 1]?.state ?? 'upcoming')}
          trackBelow={index === entries.length - 1 ? null : entry.state}
          separated={
            index > 0 && entry.state !== 'next' && (entries[index - 1]?.state ?? '') !== 'next'
          }
          testID={`${testID}-${entry.key}`}
        />
      ))}

      {dayBoundaryNote === null ? null : (
        <View
          style={{
            marginTop: dp(8),
            paddingTop: dp(8),
            borderTopWidth: StyleSheet.hairlineWidth,
            borderTopColor: moduleNeutrals.divider,
          }}
          accessible
          accessibilityLabel={dayBoundaryNote}
          testID={`${testID}-tomorrow`}
        >
          <ModuleText token="caption">{dayBoundaryNote}</ModuleText>
        </View>
      )}
    </ModuleCard>
  );
}

function Row({
  entry,
  trackAbove,
  trackBelow,
  separated,
  testID,
}: {
  readonly entry: PrayerJourneyEntry;
  readonly trackAbove: PrayerJourneyState | null;
  readonly trackBelow: PrayerJourneyState | null;
  readonly separated: boolean;
  readonly testID: string;
}) {
  const theme = useModuleTheme();
  const { dp } = useModuleMetrics();

  const isNext = entry.state === 'next';
  const disc = dp(isNext ? NEXT_DISC_DP : DISC_DP);

  const trackStyle = (state: PrayerJourneyState | null) =>
    state === null
      ? null
      : {
          width: dp(state === 'passed' ? TRACK_PASSED_DP : TRACK_UPCOMING_DP),
          backgroundColor: state === 'passed' ? theme.ink : TRACK_UPCOMING_COLOUR,
        };

  return (
    <View
      style={[
        styles.row,
        {
          minHeight: dp(ROW_MIN_HEIGHT_DP),
          columnGap: dp(6),
        },
        /*
          The approved pale-mint highlight, pulled out to the card's padding so it reads as a band
          across the row rather than as a chip around the text. A negative margin with matching
          padding, so nothing inside the row moves when the highlight appears.
        */
        isNext
          ? {
              backgroundColor: theme.lightSurface,
              borderRadius: dp(moduleLayout.radiusSmall),
              marginHorizontal: -dp(6),
              paddingHorizontal: dp(6),
            }
          : null,
      ]}
      accessible
      /*
        One utterance per row, and it states the semantic state in words: a listener gets "next
        prayer" or "completed" rather than inferring it from a colour they cannot see. Sunrise says
        what it is before anything else, so it is never mistaken for one of the five.
      */
      accessibilityLabel={spokenLabel(entry)}
      testID={testID}
    >
      {/*
        `alignSelf: 'stretch'` is load-bearing. Without it the rail sizes to the disc — its only
        in-flow child — and the two absolutely-positioned track halves, which are laid out against
        the rail's box, span the disc's height rather than the row's. They were therefore drawn
        entirely underneath the marker and the timeline rendered as six unconnected circles. Found
        on the emulator; a jsdom tree has no layout, so nothing in Jest could have seen it.
      */}
      <View style={[styles.rail, styles.stretch, { width: dp(RAIL_DP) }]}>
        {trackAbove === null ? null : (
          <View
            style={[styles.trackAbove, trackStyle(trackAbove)]}
            accessible={false}
            testID={`${testID}-track-above`}
          />
        )}
        {trackBelow === null ? null : (
          <View
            style={[styles.trackBelow, trackStyle(trackBelow)]}
            accessible={false}
            testID={`${testID}-track-below`}
          />
        )}

        <View
          style={[
            /*
              ── The depth is the disc's, never the artwork's ────────────────────
              `shadowCard` sits on this wrapper — the same locked token every resting card in the
              app uses (elevation 2, 7% of #172033). The approved PNG is a *child* of this View and
              carries no shadow, no tint and no elevation of its own, so nothing here touches a
              pixel of it.

              `shadowCard` rather than `shadowRaised`: raised is elevation 8 at 12%, which reads as
              a floating control and would lift a 38 dp disc off the card like a button. The state
              outline stays the strongest edge on the marker, which is what keeps passed / next /
              upcoming legible.

              An **opaque** background is load-bearing under Android elevation: a translucent fill
              lets the view's own shadow show through from underneath and renders as a grey vignette
              inside the shape. This is the card's white, so there is nothing to show through.
            */
            shadowCard,
            {
              width: disc,
              height: disc,
              borderRadius: disc / 2,
              /*
                The card's own white, so the disc is not a coloured well behind approved artwork — it
                is what breaks the track so the line appears to pass behind the marker. The visible
                edge is the border, which is where the state is carried.
              */
              backgroundColor: moduleNeutrals.surface,
              borderWidth: isNext ? dp(2) : 1,
              borderColor: isNext
                ? GOLD
                : entry.state === 'passed'
                  ? theme.ink
                  : moduleNeutrals.divider,
              alignItems: 'center',
              justifyContent: 'center',
            },
          ]}
          accessible={false}
          testID={`${testID}-marker`}
        >
          <FaithPictogram
            slot={entry.pictogram}
            size={dp(isNext ? NEXT_PICTOGRAM_DP : PICTOGRAM_DP)}
            testID={`${testID}-pictogram`}
          />

          {/*
            The completion badge — a shape, not a hue, so "done" survives a reader who cannot
            separate emerald from grey. Never drawn on Sunrise: completion is a claim about an act
            of worship, and Sunrise is a clock reading.
          */}
          {entry.state === 'passed' && entry.isPrayer ? (
            <View
              style={[
                styles.badge,
                {
                  width: dp(BADGE_DP),
                  height: dp(BADGE_DP),
                  borderRadius: dp(BADGE_DP) / 2,
                  backgroundColor: moduleNeutrals.surface,
                  borderColor: theme.ink,
                },
              ]}
              accessible={false}
              testID={`${testID}-completed`}
            >
              <AppIcon name="check" size={dp(9)} color={theme.ink} />
            </View>
          ) : null}
        </View>
      </View>

      {/*
        The name and the time share one box, and that box carries the separator.
        The rule therefore runs the full width from the rail to the card's edge — under the time as
        well as under the name, which is how the reference draws it. It also keeps the vertical
        padding off the row, so the rail stays full height and the track keeps its length.
      */}
      <View
        style={[
          styles.row,
          styles.flex,
          { paddingVertical: dp(ROW_PADDING_DP), columnGap: dp(8) },
          separated
            ? {
                borderTopWidth: StyleSheet.hairlineWidth,
                borderTopColor: moduleNeutrals.divider,
                paddingTop: dp(8),
              }
            : null,
        ]}
      >
        <View style={styles.flex}>
          {/*
            Uncapped. A prayer name is one short word, and clamping it is what produced mid-word
            breaks at large type sizes; the row grows instead, which is what its minimum height
            leaves room for.
          */}
          <ModuleText
            token={isNext ? 'cardTitle' : 'body'}
            color={isNext ? theme.ink : moduleNeutrals.textPrimary}
            testID={`${testID}-label`}
          >
            {entry.label}
          </ModuleText>
          {entry.isPrayer ? null : (
            <ModuleText token="caption" testID={`${testID}-marker-note`}>
              Time marker • not a prayer
            </ModuleText>
          )}
        </View>

        <ModuleText
          token={isNext ? 'cardTitle' : 'body'}
          color={isNext ? theme.ink : moduleNeutrals.textSecondary}
          testID={`${testID}-time`}
        >
          {entry.clock}
        </ModuleText>
      </View>
    </View>
  );
}

/** What a screen reader is told about one row, state included. */
function spokenLabel(entry: PrayerJourneyEntry): string {
  const identity = entry.isPrayer ? entry.label : `${entry.label}, time marker, not a prayer`;
  const state =
    entry.state === 'next'
      ? ', next prayer'
      : entry.state === 'passed'
        ? entry.isPrayer
          ? ', completed'
          : ', passed'
        : ', later today';
  return `${identity} at ${entry.clock}${state}`;
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  rail: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  stretch: {
    alignSelf: 'stretch',
  },
  /*
    The two halves of the track. Each runs from an edge of the row to its vertical centre, where the
    disc covers the join — which is why they can be separate colours without a visible seam.
  */
  trackAbove: {
    position: 'absolute',
    top: 0,
    bottom: '50%',
  },
  trackBelow: {
    position: 'absolute',
    top: '50%',
    bottom: 0,
  },
  badge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  flex: {
    flex: 1,
    minWidth: 0,
  },
});
