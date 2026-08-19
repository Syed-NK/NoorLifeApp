import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppIcon, PressableScale } from '@ds/components';
import { modulePalettes } from '@ds/tokens';
import { ModuleText } from '@features/modules/components';
import { ModuleCard } from '@features/modules/components/module-card';
import { moduleLayout, moduleNeutrals } from '@features/modules/module-tokens';
import { useModuleMetrics } from '@features/modules/use-module-metrics';

import { FaithSectionHero } from '../components/faith-section-hero';
import { FaithScreen } from '../components/faith-screen';
import { FaithTrustNotice } from '../components/faith-locked-library';
import { QuranSelectionView, SelectionOriginBadge } from '../components/quran-selection-view';
import { QURAN_CONTENT_ATTRIBUTION } from '../data/dhikr/quran-content-attribution';
import { referenceLabel, type CuratedDhikrReference } from '../data/dhikr/quran-dhikr-catalogue';
import { reviewedQuranDuas } from '../data/dhikr/reviewed-dua-manifest';
import {
  selectionReferenceLabel,
  type QuranSelection,
  type QuranSelectionRef,
} from '../data/quran-selection/quran-selection';
import type { SelectionResolution } from '../data/quran-selection/retained-selection.resolver';
import { faithHeroImages } from '../faith-hero-images';
import { faithPictogramSlot } from '../faith-pictogram-assets';
import { faithNavKeys, faithRoutes, readerHref } from '../faith-routes';
import { useQuranSelections } from '../hooks/use-quran-selections';
import { useTasbih } from '../hooks/use-tasbih';
import { favouriteSelections, recentSelections } from '../storage/faith-quran-selections';

/**
 * **Duas — a screen that does something now, and is honest about the half that does not.**
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── What this replaced, and why it could finally be replaced ───────────────
 * Three disabled preview rows over a card reading "Verified supplications will appear here when a
 * trusted source is connected". That was the correct screen at the time: the version before it
 * carried Arabic, transliteration, translation, a hadith reference and a repetition count for
 * supplications from a fixture, presented at display size as text a user may recite, none of it
 * checked. Removing it was the fix, and a locked screen was what remained.
 *
 * What has changed is not the permission position — NoorLife still has no approved Dua provider and
 * no scholarly review of any Quran-derived catalogue. What has changed is that the user can now
 * *keep verses of the Qur'an themselves*, from a copy this device retained and validated, and that
 * is content this screen is entitled to show and the user is entitled to organise.
 *
 * ── The distinction the whole screen is built around ───────────────────────
 * A verse somebody chose is not a supplication NoorLife endorsed. Both render the same publisher
 * scripture; only one carries a claim. So every item is badged with its origin, the reviewed
 * section is a *separate* section rather than a merge, and that section appears **only** when the
 * manifest holds an approved entry. There are none, and the screen says which thing is missing
 * rather than describing itself as unavailable — because personal selections work, and telling
 * somebody a working feature is unavailable is its own kind of false statement.
 *
 * ── What is deliberately not here ─────────────────────────────────────────
 * No share, no export, no copy-out. The permission prohibits emitting retained text as a file or a
 * standalone distribution, and the honest way to comply is to not build the control. The required
 * attribution is on the screen and the fuller record is one tap away.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const EMERALD = modulePalettes.faith.primary;
const EMERALD_DEEP = modulePalettes.faith.dark;

export function DuasScreen() {
  const { dp } = useModuleMetrics();
  const router = useRouter();
  const selections = useQuranSelections();
  const tasbih = useTasbih();

  /** Zero until a manifest carries an entry a named reviewer approved on a stated date. */
  const reviewed = useMemo(() => reviewedQuranDuas(), []);

  const favourites = useMemo(
    () => favouriteSelections(selections.selections),
    [selections.selections],
  );
  const recent = useMemo(() => recentSelections(selections.selections), [selections.selections]);

  /*
    Not named `use…`: a function beginning with `use` is a hook by convention and by lint, and this is
    an event handler that happens to be about the Tasbih screen.
  */
  const sendToTasbih = (id: string): void => {
    void selections.markUsed(id);
    void tasbih.chooseCounter(id);
    router.push(faithRoutes.tasbih);
  };

  const remove = (id: string): void => {
    void selections.remove(id);
    /*
      The counting state goes with it, and only it. `forgetCounter` takes one id and affects one
      counter — removing a selection must never be able to disturb the count on another.
    */
    void tasbih.forgetCounter(id);
  };

  const read = (ref: QuranSelectionRef): void => {
    router.push(readerHref(ref.surah, ref.startAyah));
  };

  return (
    <FaithScreen title="Duas" activeKey={faithNavKeys.more} testID="faith-duas">
      <View style={{ rowGap: dp(moduleLayout.sectionGap) }}>
        <FaithSectionHero
          submenu="duas"
          heroImage={faithHeroImages.duas}
          summary="Verses you keep, and the ones a scholar has approved."
        />

        {/*
          ── The reviewed section exists only when there is something in it ──────
          Not a locked placeholder, and not an empty list. A section rendered with nothing in it
          invites "try again"; a locked one implies the screen is broken. What is true is that
          NoorLife's scholarly review has not happened, and that is stated once, below, beside the
          thing that *does* work.
        */}
        {reviewed.length === 0 ? null : (
          <Section
            title="Reviewed Quranic Duas"
            summary="References a named reviewer approved, with the basis of the review recorded."
            testID="faith-duas-reviewed"
          >
            {reviewed.map((entry) => (
              <ReviewedItem
                key={entry.id}
                entry={entry}
                resolution={selections.resolve({
                  surah: entry.surah,
                  startAyah: entry.startAyah,
                  endAyah: entry.endAyah,
                })}
                onUse={() =>
                  void tasbih.chooseCounter(entry.id, entry.recommendedTarget ?? undefined)
                }
                onRead={() => read(entry)}
              />
            ))}
          </Section>
        )}

        <Section
          title="My Quran selections"
          summary="Verses you chose. NoorLife makes no religious claim about them."
          testID="faith-duas-selections"
        >
          {selections.selections.length === 0 ? (
            <ModuleText token="body" numberOfLines={4} testID="faith-duas-selections-empty">
              You have not kept any verses yet. Choose one from the Qur’an and it appears here, with
              its Arabic and its translation.
            </ModuleText>
          ) : (
            selections.selections.map((selection) => (
              <SelectionItem
                key={selection.id}
                selection={selection}
                resolution={selections.resolve(selection)}
                activeCounterId={tasbih.session?.counterId ?? null}
                onUse={() => sendToTasbih(selection.id)}
                onRead={() => read(selection)}
                onToggleFavourite={() => void selections.toggleFavourite(selection.id)}
                onRemove={() => remove(selection.id)}
              />
            ))
          )}
          <AddSelection onPress={() => router.push(faithRoutes.quranSelection)} />
        </Section>

        <Section
          title="Favourites"
          summary="The selections you starred"
          testID="faith-duas-favourites"
        >
          {favourites.length === 0 ? (
            <ModuleText token="body" numberOfLines={3} testID="faith-duas-favourites-empty">
              Nothing starred yet.
            </ModuleText>
          ) : (
            favourites.map((selection) => (
              <SelectionItem
                key={selection.id}
                selection={selection}
                resolution={selections.resolve(selection)}
                activeCounterId={tasbih.session?.counterId ?? null}
                onUse={() => sendToTasbih(selection.id)}
                onRead={() => read(selection)}
                onToggleFavourite={() => void selections.toggleFavourite(selection.id)}
                onRemove={() => remove(selection.id)}
                testIDPrefix="faith-duas-favourite"
              />
            ))
          )}
        </Section>

        <Section
          title="Recently used"
          summary="Selections you counted or opened lately"
          testID="faith-duas-recent"
        >
          {recent.length === 0 ? (
            <ModuleText token="body" numberOfLines={3} testID="faith-duas-recent-empty">
              Nothing used yet. Sending a selection to Tasbih or opening it in the Reader puts it
              here.
            </ModuleText>
          ) : (
            recent.map((selection) => (
              <SelectionItem
                key={selection.id}
                selection={selection}
                resolution={selections.resolve(selection)}
                activeCounterId={tasbih.session?.counterId ?? null}
                onUse={() => sendToTasbih(selection.id)}
                onRead={() => read(selection)}
                onToggleFavourite={() => void selections.toggleFavourite(selection.id)}
                onRemove={() => remove(selection.id)}
                testIDPrefix="faith-duas-recent-item"
              />
            ))
          )}
        </Section>

        {/*
          Stated once, where it is true, and next to the thing that works rather than instead of it.
          "Duas is unavailable" would be false — the selections above are usable — and "coming soon"
          would promise a date nobody has.
        */}
        {reviewed.length === 0 ? (
          <ModuleCard testID="faith-duas-awaiting-review">
            <View style={{ rowGap: dp(4) }}>
              <ModuleText token="cardTitle" numberOfLines={2}>
                Scholarly-reviewed duas are not ready yet
              </ModuleText>
              <ModuleText token="caption" numberOfLines={5}>
                NoorLife will not decide on its own which verses count as a dua, in what context, or
                how many times to say them. Nothing appears in that section until a qualified
                reviewer has approved each reference and their review is recorded. Your own
                selections above are unaffected.
              </ModuleText>
            </View>
          </ModuleCard>
        ) : null}

        <ModuleCard
          onPress={() => router.push(faithRoutes.contentInfo)}
          accessibilityLabel="Where this content comes from"
          testID="faith-duas-attribution"
        >
          <View style={{ rowGap: dp(4) }}>
            <ModuleText token="caption" numberOfLines={3}>
              {QURAN_CONTENT_ATTRIBUTION}
            </ModuleText>
            <ModuleText token="caption" color={EMERALD_DEEP} numberOfLines={1}>
              Where this content comes from
            </ModuleText>
          </View>
        </ModuleCard>

        <FaithTrustNotice
          pictogram={faithPictogramSlot('s1')}
          message="No unverified supplications are shown."
          testID="faith-duas-trust"
        />
      </View>
    </FaithScreen>
  );
}

function Section({
  title,
  summary,
  children,
  testID,
}: {
  readonly title: string;
  readonly summary: string;
  readonly children: React.ReactNode;
  readonly testID: string;
}) {
  const { dp } = useModuleMetrics();

  return (
    <ModuleCard testID={testID}>
      <View style={{ rowGap: dp(10) }}>
        <View>
          <ModuleText token="cardTitle" numberOfLines={2} accessibilityRole="header">
            {title}
          </ModuleText>
          <ModuleText token="caption" numberOfLines={3}>
            {summary}
          </ModuleText>
        </View>
        {children}
      </View>
    </ModuleCard>
  );
}

/**
 * One of the user's own selections.
 *
 * ── Every item states what it is, on the item ──────────────────────────────
 * The badge is on the row and not only on the section heading, because a row is what somebody
 * screenshots, scrolls to and remembers, and because these rows appear under three different
 * headings. A user who cannot tell a personal selection from a reviewed one will reasonably assume
 * NoorLife vouched for both.
 */
function SelectionItem({
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
 * Unreachable while the manifest is empty, and written now so that populating the manifest is a
 * data change rather than a screen change. It has **no remove control**: it is not the user's
 * record to delete, and no favourite control either — favouriting a reviewed entry is state the
 * reviewed catalogue's own store owns, and adding a second place to keep it here would be two
 * answers to one question.
 */
function ReviewedItem({
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

function AddSelection({ onPress }: { readonly onPress: () => void }) {
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
      testID="faith-duas-add-selection"
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
    backgroundColor: EMERALD_DEEP,
    borderColor: EMERALD,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'center',
  },
});
