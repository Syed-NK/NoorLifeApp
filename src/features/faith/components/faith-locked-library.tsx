import { Image, StyleSheet, View, type ImageSourcePropType } from 'react-native';

import { AppIcon } from '@ds/components';
import { modulePalettes } from '@ds/tokens';
import { ModuleText } from '@features/modules/components';
import { ModuleCard } from '@features/modules/components/module-card';
import { useModuleTheme } from '@features/modules/module-context';
import { moduleLayout, moduleNeutrals } from '@features/modules/module-tokens';
import { useModuleMetrics } from '@features/modules/use-module-metrics';
import type { IconName } from '@shared/models/icon';

/**
 * The shared furniture for a provider-locked Faith library — Hadith and Duas.
 *
 * ── Why one component pair rather than two screens ──────────────────────────
 * The approved Hadith and Duas references are the same composition with different words: a status
 * card, three disabled preview rows, and a trust notice. Building each screen separately is how the
 * two drift, and the part that must never drift is the *disabledness* — a row that quietly became
 * pressable on one of them would open a screen that cannot exist.
 *
 * ── Why the rows are not buttons ────────────────────────────────────────────
 * They carry no `onPress`, no `accessibilityRole="button"` and no `Pressable`. A disabled button is
 * still announced as a button, and a screen reader user would be told there is a control here and
 * then find that activating it does nothing. These are informational rows that say what is coming;
 * `accessibilityState.disabled` plus an explicit "not available yet" in the label is the honest
 * description of that, and it is the whole of their interaction contract.
 */

/**
 * Where a pictogram comes from, as a type rather than a path.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * The references draw dimensional emerald/cream/gold artwork that NoorLife does not have for most
 * of these slots — see `docs/FAITH_ASSET_GAPS.md`. The choices were to leave the slots empty, to
 * substitute something invented, or to name the seam. This names the seam: a slot is either an
 * approved PNG or a restrained vector standing in for one, and swapping a vector for artwork later
 * is a one-line change at the call site with no component edit and no layout change.
 *
 * A slot is never an emoji and never third-party artwork. Both were considered and rejected: an
 * emoji is a font glyph that renders differently on every device and reads as a placeholder, and
 * copied artwork is not NoorLife's to ship.
 */
export type FaithPictogramSlot =
  | { readonly kind: 'png'; readonly source: ImageSourcePropType }
  | { readonly kind: 'vector'; readonly icon: IconName };

/** NoorLife's own gold, from the locked Faith palette. Never a new hue. */
const GOLD = modulePalettes.faith.supporting;

/**
 * Renders one slot at one size.
 *
 * Exported because the Prayer screen occupies slots too — the location card's P1 — and a second
 * renderer would be a second set of rules about tinting, containers and accessibility for the same
 * kind of asset.
 */
export function FaithPictogram({
  slot,
  size,
  testID,
}: {
  readonly slot: FaithPictogramSlot;
  readonly size: number;
  readonly testID?: string;
}) {
  const theme = useModuleTheme();

  if (slot.kind === 'png') {
    return (
      <Image
        source={slot.source}
        style={{ width: size, height: size }}
        resizeMode="contain"
        // Decorative: every one of these sits beside text that already says what it is.
        accessible={false}
        testID={testID}
      />
    );
  }

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <AppIcon name={slot.icon} size={size * 0.72} color={theme.ink} />
    </View>
  );
}

/**
 * The status card: what this library will hold, and what it is waiting for.
 *
 * Deliberately not an empty state and not a skeleton. Nothing is loading and nothing is missing by
 * accident — the content is absent because no provider has been approved, and the card says so in
 * words rather than animating a promise it cannot keep.
 */
export function FaithLibraryStatusCard({
  pictogram,
  title,
  body,
  testID,
}: {
  readonly pictogram: FaithPictogramSlot;
  readonly title: string;
  readonly body: string;
  readonly testID: string;
}) {
  const { dp } = useModuleMetrics();

  return (
    <ModuleCard padding={moduleLayout.cardPadding} testID={testID}>
      <View
        style={[styles.row, { columnGap: dp(12) }]}
        accessible
        accessibilityLabel={`${title}. ${body}`}
      >
        <FaithPictogram
          slot={pictogram}
          size={dp(moduleLayout.faithIdentityImage)}
          testID={`${testID}-pictogram`}
        />
        <View style={[styles.flex, { rowGap: dp(3) }]}>
          {/*
            Uncapped, both of them. This card's entire job is to explain the absence, and an
            ellipsised explanation leaves the reader knowing only that something is missing. The
            card is content-height, so a longer line grows it.
          */}
          <ModuleText token="cardTitle">{title}</ModuleText>
          <ModuleText token="body">{body}</ModuleText>
        </View>
      </View>
    </ModuleCard>
  );
}

export type FaithLockedPreviewRowSpec = {
  readonly pictogram: FaithPictogramSlot;
  readonly label: string;
  readonly description: string;
  readonly testID: string;
};

/**
 * The three preview rows, as one card with hairline dividers — as both references draw them.
 *
 * ── Why a single card rather than three ─────────────────────────────────────
 * The references show one grouped surface with rules between the rows, not three separate cards
 * with gaps. Grouping also matches what the rows *are*: one list of things that will arrive
 * together when a provider does, rather than three independent features at three different stages.
 */
export function FaithLockedPreviewRows({
  rows,
  testID,
}: {
  readonly rows: readonly FaithLockedPreviewRowSpec[];
  readonly testID: string;
}) {
  const { dp } = useModuleMetrics();
  const theme = useModuleTheme();

  return (
    <ModuleCard padding={0} testID={testID}>
      {rows.map((row, index) => (
        <View
          key={row.testID}
          style={[
            styles.row,
            {
              columnGap: dp(10),
              paddingHorizontal: dp(moduleLayout.cardPadding),
              paddingVertical: dp(12),
            },
            index === 0 ? null : styles.divided,
          ]}
          accessible
          /*
            One node, one utterance, and the unavailability last so it is the thing the listener is
            left with. `disabled` is set as state rather than role: there is no control here to
            disable, and announcing a button nobody can press would be the same lie the rows exist
            to avoid.
          */
          accessibilityState={{ disabled: true }}
          accessibilityLabel={`${row.label}. ${row.description}. Coming soon — this feature is not available yet.`}
          testID={row.testID}
        >
          <FaithPictogram
            slot={row.pictogram}
            size={dp(moduleLayout.faithSubmenuImage)}
            testID={`${row.testID}-pictogram`}
          />

          <View style={[styles.flex, { rowGap: dp(2) }]}>
            <ModuleText token="cardTitle">{row.label}</ModuleText>
            <ModuleText token="body">{row.description}</ModuleText>
          </View>

          {/*
            The chip and the padlock are one group and both are decorative: the row's own label
            already ends with "Coming soon — this feature is not available yet", so announcing them
            again would repeat the same sentence twice to a screen reader.
          */}
          <View style={[styles.row, { columnGap: dp(8) }]} accessible={false}>
            <View
              style={{
                backgroundColor: moduleNeutrals.successSurface,
                borderRadius: dp(moduleLayout.radiusPill),
                paddingHorizontal: dp(10),
                paddingVertical: dp(5),
              }}
            >
              <ModuleText token="caption" color={theme.ink} numberOfLines={1}>
                Coming soon
              </ModuleText>
            </View>
            <View
              style={{
                width: dp(30),
                height: dp(30),
                borderRadius: dp(15),
                borderWidth: 1,
                borderColor: GOLD,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <AppIcon name="lock" size={dp(15)} color={GOLD} />
            </View>
          </View>
        </View>
      ))}
    </ModuleCard>
  );
}

/**
 * The trust notice — the promise the locked state is keeping.
 *
 * It is the reason the rest of the screen is empty, so it reads as a statement of policy rather
 * than as an error: nothing unverified is shown, and that is a decision rather than a failure.
 */
export function FaithTrustNotice({
  pictogram,
  message,
  testID,
}: {
  /** S1 in the asset registry — the emerald shield with a gold rim and a cream check. */
  readonly pictogram: FaithPictogramSlot;
  readonly message: string;
  readonly testID: string;
}) {
  const theme = useModuleTheme();
  const { dp } = useModuleMetrics();

  return (
    <View
      style={[
        styles.row,
        {
          columnGap: dp(12),
          padding: dp(moduleLayout.cardPadding),
          borderRadius: dp(moduleLayout.cardRadius),
          borderWidth: 1,
          borderColor: theme.border,
          backgroundColor: theme.lightSurface,
        },
      ]}
      accessible
      accessibilityLabel={message}
      testID={testID}
    >
      {/*
        ── The gold disc is drawn only around the stand-in ──────────────────────
        The approved S1 artwork *is* an emerald shield with a gold rim, so once it is installed the
        rim is in the image and a second drawn ring around it would double it. While the slot is a
        vector, the disc is what supplies the reference's gold edge — so the container follows the
        slot's kind rather than being unconditional.

        Decorative either way: the message beside it is the content.
      */}
      {pictogram.kind === 'png' ? (
        <FaithPictogram slot={pictogram} size={dp(38)} testID={`${testID}-shield`} />
      ) : (
        <View
          style={{
            width: dp(38),
            height: dp(38),
            borderRadius: dp(19),
            borderWidth: 1.5,
            borderColor: GOLD,
            backgroundColor: moduleNeutrals.surface,
            alignItems: 'center',
            justifyContent: 'center',
          }}
          accessible={false}
          testID={`${testID}-shield`}
        >
          <AppIcon name={pictogram.icon} size={dp(20)} color={theme.ink} />
        </View>
      )}
      <ModuleText token="body" style={styles.flex}>
        {message}
      </ModuleText>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  flex: {
    flex: 1,
    minWidth: 0,
  },
  divided: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: moduleNeutrals.divider,
  },
});
