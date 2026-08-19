import { StyleSheet, View } from 'react-native';

import { AppIcon, PressableScale } from '@ds/components';
import { modulePalettes } from '@ds/tokens';
import { ModuleText } from '@features/modules/components';
import { moduleLayout, moduleNeutrals } from '@features/modules/module-tokens';
import { useModuleMetrics } from '@features/modules/use-module-metrics';

import { referenceLabel, type CuratedDhikrReference } from '../data/dhikr/quran-dhikr-catalogue';
import {
  selectionReferenceLabel,
  type QuranSelection,
} from '../data/quran-selection/quran-selection';
import type { SelectionResolution } from '../data/quran-selection/retained-selection.resolver';
import { QuranSelectionView, SelectionOriginBadge } from './quran-selection-view';

/**
 * The two kinds of row the Duas library draws, and the actions on them.
 *
 * ── Why these moved out of the screen ──────────────────────────────────────
 * They were local to `duas-screen.tsx` when there was one list. The category grid gives them three
 * homes — a category's own list, a search result, and whatever a future card needs — and three
 * copies of "which actions does a personal selection get, and does a reviewed entry get a remove
 * button?" is three chances for one of them to answer differently.
 *
 * Moved verbatim. The badge, the action set, the testIDs and the accessibility labels are unchanged,
 * so the suites that already assert them keep asserting the same thing about the same component.
 */

const EMERALD_DEEP = modulePalettes.faith.dark;

/**
 * One of the user's own selections.
 *
 * ── Every item states what it is, on the item ──────────────────────────────
 * The badge is on the row and not only on the section heading, because a row is what somebody
 * screenshots, scrolls to and remembers, and because these rows appear under several different
 * headings. A user who cannot tell a personal selection from a reviewed one will reasonably assume
 * NoorLife vouched for both.
 */
export function SelectionItem({
  selection,
  resolution,
  activeCounterId,
  onUse,
  onRead,
  onToggleFavourite,
  onRemove,
  testIDPrefix = 'faith-duas-selection',
}: {
  readonly selection: QuranSelection;
  readonly resolution: SelectionResolution;
  readonly activeCounterId: string | null;
  readonly onUse: () => void;
  readonly onRead: () => void;
  readonly onToggleFavourite: () => void;
  readonly onRemove: () => void;
  readonly testIDPrefix?: string;
}) {
  const { dp } = useModuleMetrics();
  const reference = selectionReferenceLabel(selection);
  const counting = activeCounterId === selection.id;

  return (
    <View
      style={[
        styles.item,
        { borderRadius: dp(moduleLayout.radiusSmall), padding: dp(12), rowGap: dp(8) },
      ]}
      testID={`${testIDPrefix}-${selection.id}`}
    >
      <View style={[styles.row, { columnGap: dp(8) }]}>
        <SelectionOriginBadge origin="personal" />
        <View style={styles.flex} />
        {counting ? (
          <ModuleText token="caption" color={EMERALD_DEEP} numberOfLines={1}>
            Counting now
          </ModuleText>
        ) : null}
      </View>

      {selection.label === null ? null : (
        <ModuleText token="body" color={moduleNeutrals.textPrimary} numberOfLines={2}>
          {selection.label}
        </ModuleText>
      )}

      <QuranSelectionView
        resolution={resolution}
        reference={reference}
        arabicLines={3}
        translationLines={5}
        testID={`${testIDPrefix}-body-${selection.id}`}
      />

      <View style={[styles.actions, { columnGap: dp(8), rowGap: dp(8) }]}>
        <Action
          icon="quran"
          label={`Read Qur’an ${reference} in the reader`}
          onPress={onRead}
          testID={`${testIDPrefix}-read-${selection.id}`}
        />
        <Action
          icon="tasbih"
          label={`Count Qur’an ${reference} in Tasbih`}
          onPress={onUse}
          testID={`${testIDPrefix}-use-${selection.id}`}
        />
        <Action
          icon={selection.favourite ? 'star' : 'bookmark'}
          label={
            selection.favourite
              ? `Remove Qur’an ${reference} from favourites`
              : `Add Qur’an ${reference} to favourites`
          }
          onPress={onToggleFavourite}
          testID={`${testIDPrefix}-favourite-${selection.id}`}
        />
        <Action
          icon="close"
          label={`Remove Qur’an ${reference} from your selections`}
          onPress={onRemove}
          testID={`${testIDPrefix}-remove-${selection.id}`}
        />
      </View>
    </View>
  );
}

/**
 * A reviewed entry, which is a different claim and carries its review with it.
 *
 * Unreachable while the manifest is empty, and written so that populating the manifest is a data
 * change rather than a screen change. It has **no remove control**: it is not the user's record to
 * delete, and no favourite control either — favouriting a reviewed entry is state the reviewed
 * catalogue's own store owns, and adding a second place to keep it here would be two answers to one
 * question.
 */
export function ReviewedItem({
  entry,
  resolution,
  onUse,
  onRead,
}: {
  readonly entry: CuratedDhikrReference;
  readonly resolution: SelectionResolution;
  readonly onUse: () => void;
  readonly onRead: () => void;
}) {
  const { dp } = useModuleMetrics();
  const reference = referenceLabel(entry);

  return (
    <View
      style={[
        styles.item,
        { borderRadius: dp(moduleLayout.radiusSmall), padding: dp(12), rowGap: dp(8) },
      ]}
      testID={`faith-duas-reviewed-${entry.id}`}
    >
      <SelectionOriginBadge origin="reviewed" />

      <ModuleText token="body" color={moduleNeutrals.textPrimary} numberOfLines={2}>
        {entry.title}
      </ModuleText>

      <QuranSelectionView
        resolution={resolution}
        reference={reference}
        arabicLines={3}
        translationLines={5}
        testID={`faith-duas-reviewed-body-${entry.id}`}
      />

      {/* The context the review supplied. Required for approval — see the catalogue's gate. */}
      {entry.contextNote === null ? null : (
        <ModuleText token="caption" numberOfLines={5}>
          {entry.contextNote}
        </ModuleText>
      )}

      {entry.review === null ? null : (
        <ModuleText token="caption" numberOfLines={3} testID={`faith-duas-review-${entry.id}`}>
          {`Reviewed by ${entry.review.reviewer} on ${entry.review.reviewedOn} — ${entry.review.source}`}
        </ModuleText>
      )}

      <View style={[styles.actions, { columnGap: dp(8), rowGap: dp(8) }]}>
        <Action
          icon="quran"
          label={`Read Qur’an ${reference} in the reader`}
          onPress={onRead}
          testID={`faith-duas-reviewed-read-${entry.id}`}
        />
        <Action
          icon="tasbih"
          label={`Count ${entry.title} in Tasbih`}
          onPress={onUse}
          testID={`faith-duas-reviewed-use-${entry.id}`}
        />
      </View>
    </View>
  );
}

export function AddSelection({
  onPress,
  testID = 'faith-duas-add-selection',
}: {
  readonly onPress: () => void;
  readonly testID?: string;
}) {
  const { dp } = useModuleMetrics();

  return (
    <PressableScale
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="Choose a verse from the Qur’an"
      style={[
        styles.add,
        {
          minHeight: dp(moduleLayout.minTouchTarget),
          borderRadius: dp(moduleLayout.radiusSmall),
          paddingHorizontal: dp(12),
          columnGap: dp(8),
        },
      ]}
      testID={testID}
    >
      <AppIcon name="add" size={dp(18)} color={moduleNeutrals.surface} />
      <ModuleText token="button" color={moduleNeutrals.surface} numberOfLines={2}>
        Choose a verse from the Qur’an
      </ModuleText>
    </PressableScale>
  );
}

/**
 * One item action.
 *
 * ── There is no share control, and there will not be one ───────────────────
 * The permission prohibits emitting retained Quran text as a file or a standalone distribution. A
 * share control that refused at the point of use would be a control that lies about what it does, so
 * the honest arrangement is that the affordance does not exist.
 */
function Action({
  icon,
  label,
  onPress,
  testID,
}: {
  readonly icon: 'quran' | 'tasbih' | 'star' | 'bookmark' | 'close';
  readonly label: string;
  readonly onPress: () => void;
  readonly testID: string;
}) {
  const { dp } = useModuleMetrics();
  const size = dp(moduleLayout.minTouchTarget);

  return (
    <PressableScale
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={{
        width: size,
        height: size,
        borderRadius: dp(moduleLayout.radiusSmall),
        borderWidth: 1,
        borderColor: moduleNeutrals.border,
        backgroundColor: moduleNeutrals.surface,
        alignItems: 'center',
        justifyContent: 'center',
      }}
      testID={testID}
    >
      <AppIcon name={icon} size={dp(18)} color={EMERALD_DEEP} />
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { alignItems: 'center', flexDirection: 'row' },
  /*
    Wrapping rather than a fixed row of four. At 320 dp with a 1.5x text setting four 44 dp targets
    and their gaps exceed the card's content width, and wrapping keeps every target at its full size
    instead of shrinking them below the minimum.
  */
  actions: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap' },
  item: {
    backgroundColor: moduleNeutrals.surface,
    borderColor: moduleNeutrals.border,
    borderWidth: 1,
  },
  add: {
    alignItems: 'center',
    backgroundColor: modulePalettes.faith.dark,
    borderColor: modulePalettes.faith.primary,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'center',
  },
});
