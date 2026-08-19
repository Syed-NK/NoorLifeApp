import { StyleSheet, View } from 'react-native';

import { modulePalettes } from '@ds/tokens';
import { ModuleText } from '@features/modules/components';
import { moduleLayout, moduleNeutrals } from '@features/modules/module-tokens';
import { useModuleMetrics } from '@features/modules/use-module-metrics';

import { QURAN_CONTENT_ATTRIBUTION } from '../data/dhikr/quran-content-attribution';
import type {
  SelectionResolution,
  SelectionResolutionFailure,
} from '../data/quran-selection/retained-selection.resolver';
import { ArabicText } from './faith-list';

/**
 * How a Quran selection is drawn, everywhere it is drawn.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── Why one component rather than the obvious three ────────────────────────
 * A selection appears on the Tasbih control card, in three sections of the Duas screen, and in the
 * selector's preview. Every one of those has to satisfy the same two display obligations — the
 * verse reference beside the scripture, and the translator's name beside the translation — and a
 * requirement met in three places and forgotten in a fourth is a requirement that is not met.
 *
 * So the obligations live here, in the render path, where they cannot be omitted by a caller: the
 * translation is drawn by the same branch that draws the credit, and there is no prop that separates
 * them. A screen cannot show a rendering of the meaning without naming who produced it, because
 * there is no code that would do that.
 *
 * ── The unavailable states are not errors ──────────────────────────────────
 * A device with no published generation is not broken and neither is one whose generation is missing
 * the range asked for. Both are stated plainly, with the thing the user can actually do, rather than
 * as a failure with a retry that would retry nothing — nothing here fetches, so there is nothing to
 * try again.
 *
 * ── What is deliberately absent ────────────────────────────────────────────
 * No share control, no copy affordance, no "save as". The permission prohibits emitting retained
 * text as a file or a standalone distribution, and the honest way to comply is to not build the
 * control rather than to build it and refuse.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const EMERALD_DEEP = modulePalettes.faith.dark;

export type QuranSelectionViewProps = {
  readonly resolution: SelectionResolution;
  /** `2:255` or `59:22-24`. Shown even when nothing resolved — the reference is NoorLife's own. */
  readonly reference: string;
  /**
   * Clamps each verse's scripture to a line count.
   *
   * Set on surfaces where the selection is a *preview* of something a tap opens in full — the Duas
   * rows, the Tasbih card. Unset in the selector, where seeing the whole passage is the point of
   * being there.
   */
  readonly arabicLines?: number;
  /** Clamps the translation the same way. Unset shows it whole. */
  readonly translationLines?: number;
  /** Draws the Quran Foundation sentence under the content. Off where the screen carries it once. */
  readonly showAttribution?: boolean;
  readonly testID?: string;
};

/** What an unresolved selection says. Exhaustive, so a new reason cannot render as nothing. */
export function unavailableMessage(reason: SelectionResolutionFailure): {
  readonly title: string;
  readonly body: string;
} {
  switch (reason) {
    case 'no-generation':
      return {
        title: 'The Qur’an is not on this device yet',
        body: 'Selections show their Arabic from the copy NoorLife keeps on your phone. Once it has downloaded, this verse appears here — including with no connection.',
      };
    case 'range-missing':
      return {
        title: 'These verses are not in the copy on this device',
        body: 'The reference is saved and nothing has been lost. It will show as soon as the downloaded Qur’an covers it.',
      };
  }
}

export function QuranSelectionView({
  resolution,
  reference,
  arabicLines,
  translationLines,
  showAttribution = false,
  testID,
}: QuranSelectionViewProps) {
  const { dp } = useModuleMetrics();

  if (resolution.kind === 'failed') {
    const message = unavailableMessage(resolution.reason);
    return (
      <View style={{ rowGap: dp(4) }} testID={`${testID ?? 'faith-selection'}-unavailable`}>
        <ModuleText token="body" color={moduleNeutrals.textPrimary} numberOfLines={2}>
          {message.title}
        </ModuleText>
        <ModuleText token="caption" numberOfLines={4}>
          {message.body}
        </ModuleText>
        <ReferenceLine reference={reference} />
      </View>
    );
  }

  const { verses, translator, translationEdition } = resolution.data;

  return (
    <View style={{ rowGap: dp(8) }} testID={testID}>
      {verses.map((verse) => (
        <View key={verse.verseKey} style={{ rowGap: dp(2) }}>
          {/*
            Rendered exactly as the publisher sent it. `ArabicText` sets the script's own typography
            and marks the language so a machine translator does not offer to rewrite scripture.
          */}
          <ArabicText
            size="display"
            {...(arabicLines === undefined ? {} : { numberOfLines: arabicLines })}
            testID={`${testID ?? 'faith-selection'}-arabic-${verse.verseKey}`}
          >
            {verse.arabic}
          </ArabicText>
          {verse.translation === null ? null : (
            <ModuleText
              token="body"
              color={moduleNeutrals.textSecondary}
              {...(translationLines === undefined ? {} : { numberOfLines: translationLines })}
              testID={`${testID ?? 'faith-selection'}-translation-${verse.verseKey}`}
            >
              {verse.translation}
            </ModuleText>
          )}
        </View>
      ))}

      <ReferenceLine reference={reference} />

      {/*
        ── The translator's name is drawn by the branch that drew the translation ──
        Not by a separate optional prop, and not by the caller. The licence requires the credit
        wherever the translation appears, and the cheapest way to guarantee that is to make the two
        impossible to separate: `translator` is non-null exactly when at least one verse resolved a
        translation, and this is the only place either is rendered.
      */}
      {translator === null ? (
        <ModuleText
          token="caption"
          numberOfLines={2}
          testID={`${testID ?? 'faith-selection'}-no-translation`}
        >
          The meaning is not available on this device yet.
        </ModuleText>
      ) : (
        <ModuleText
          token="caption"
          numberOfLines={2}
          testID={`${testID ?? 'faith-selection'}-translator`}
        >
          {translationEdition === null
            ? `Translation by ${translator}`
            : `${translationEdition} — translation by ${translator}`}
        </ModuleText>
      )}

      {showAttribution ? (
        <ModuleText
          token="caption"
          numberOfLines={3}
          testID={`${testID ?? 'faith-selection'}-attribution`}
        >
          {QURAN_CONTENT_ATTRIBUTION}
        </ModuleText>
      ) : null}
    </View>
  );
}

/** The surah and ayah this is, in NoorLife's own words. Always drawn, resolved or not. */
function ReferenceLine({ reference }: { readonly reference: string }) {
  return (
    <ModuleText token="caption" color={EMERALD_DEEP} numberOfLines={1}>
      {`Qur’an ${reference}`}
    </ModuleText>
  );
}

/**
 * The badge distinguishing a private selection from a scholarly-reviewed entry.
 *
 * ── Why every item carries one ─────────────────────────────────────────────
 * The two look identical otherwise: both are a reference, both render publisher scripture, both sit
 * in the same list. The difference is whether anybody qualified said this verse is appropriate for
 * the purpose it is filed under — and a user who cannot tell them apart will reasonably assume
 * NoorLife vouched for both. This is the whole of that distinction, so it is never optional.
 */
export function SelectionOriginBadge({
  origin,
  testID,
}: {
  readonly origin: 'personal' | 'reviewed';
  readonly testID?: string;
}) {
  const { dp } = useModuleMetrics();
  const personal = origin === 'personal';

  return (
    <View
      style={[
        styles.badge,
        {
          borderRadius: dp(moduleLayout.radiusSmall),
          paddingHorizontal: dp(8),
          paddingVertical: dp(3),
          borderColor: personal ? moduleNeutrals.border : EMERALD_DEEP,
          backgroundColor: personal ? moduleNeutrals.surface : modulePalettes.faith.soft,
        },
      ]}
      testID={testID}
    >
      <ModuleText
        token="caption"
        color={personal ? moduleNeutrals.textSecondary : EMERALD_DEEP}
        numberOfLines={1}
      >
        {personal ? 'Your selection' : 'Scholarly-reviewed'}
      </ModuleText>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: 'flex-start',
    borderWidth: 1,
  },
});
