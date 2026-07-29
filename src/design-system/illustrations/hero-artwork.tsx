import { StyleSheet, View } from 'react-native';

import { AppIcon } from '@ds/components/app-icon';
import { iconSize, onHeroColors, radius, spacing } from '@ds/tokens';
import type { IconName } from '@shared/models/icon';
import type { HeroIllustrationKey } from '@shared/models/module-theme';
import { RobotMascot } from './robot-mascot';

export type HeroArtworkProps = {
  readonly illustration: HeroIllustrationKey;
  /** Available height for the artwork inside the hero card. */
  readonly height: number;
};

/**
 * Resolves a module's `heroIllustration` key into the hero artwork.
 *
 * Spec §3.3 requires a purposeful illustration occupying 35–45% of the hero card.
 * The mascot is present in every hero (§1.6: the robot is the single AI mascot),
 * accompanied by a small motif specific to the module.
 *
 * ── PLACEHOLDER BOUNDARY ────────────────────────────────────────────────────
 * These are composed placeholders, not the illustrated artwork in
 * design-reference/. `ASSETS-REQUIRED.md` lists the exact production asset needed
 * per key. Because modules resolve artwork through a *key*, dropping in final art
 * is a change to this file only — no module configuration moves.
 *
 * Only `main-day-timeline` is exercised in Phase 1; the rest are wired so module
 * homes are not blank when Phase 2 begins.
 */
export function HeroArtwork({ illustration, height }: HeroArtworkProps) {
  const mascotSize = Math.min(height, 104);

  return (
    <View style={[styles.root, { height }]}>
      {illustration === 'main-day-timeline' ? (
        <DayTimelineMotif />
      ) : (
        <MotifIcons icons={motifIcons[illustration]} />
      )}
      <RobotMascot size={mascotSize} />
    </View>
  );
}

/**
 * Main Home motif: a calm day timeline with subtle sun/star accents, matching
 * "robot beside a calm day timeline with subtle sun/star elements" (§05).
 */
function DayTimelineMotif() {
  return (
    <View style={styles.motif}>
      <View style={styles.accentRow}>
        <AppIcon name="sparkle" size={iconSize.xs} color={onHeroColors.muted} />
        <AppIcon name="star" size={iconSize.xs} color={onHeroColors.muted} />
      </View>
      <View style={styles.timeline}>
        <View style={styles.timelineTrack} />
        {[0, 1, 2].map((index) => (
          <View key={index} style={styles.timelineNode} />
        ))}
      </View>
    </View>
  );
}

function MotifIcons({ icons }: { readonly icons: readonly IconName[] }) {
  return (
    <View style={styles.motif}>
      <View style={styles.accentRow}>
        {icons.map((icon) => (
          <AppIcon key={icon} name={icon} size={iconSize.lg} color={onHeroColors.secondary} />
        ))}
      </View>
    </View>
  );
}

/** Motif glyphs per module, taken from each module's §07–§13 hero description. */
const motifIcons: Readonly<Record<Exclude<HeroIllustrationKey, 'main-day-timeline'>, IconName[]>> =
  {
    'noor-ai-robot-wave': ['sparkle'],
    'faith-mosque-geometry': ['mosque'],
    'health-pulse-landscape': ['wellness'],
    'planner-calendar-stack': ['calendar', 'clock'],
    'finance-wallet-chart': ['money'],
    'learning-glowing-book': ['quran'],
    'family-portrait': ['family'],
    'goals-summit-target': ['target'],
  };

const styles = StyleSheet.create({
  root: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'flex-end',
    gap: spacing.xs,
  },
  motif: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  accentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  timeline: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: 64,
    height: spacing.md,
  },
  timelineTrack: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 2,
    borderRadius: radius.pill,
    backgroundColor: onHeroColors.hairline,
  },
  timelineNode: {
    width: spacing.sm,
    height: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: onHeroColors.secondary,
  },
});
