import { StyleSheet, View } from 'react-native';

import { AppIcon, PressableScale } from '@ds/components';
import { modulePalettes } from '@ds/tokens';
import { ModuleText } from '@features/modules/components';
import { ModuleCard } from '@features/modules/components/module-card';
import { moduleLayout, moduleNeutrals } from '@features/modules/module-tokens';
import { useModuleMetrics } from '@features/modules/use-module-metrics';

import { duaCategoryById } from '../data/duas/dua-categories';
import type { DuaDetailPresentation } from '../data/duas/dua-detail';
import { QuranSelectionView, SelectionOriginBadge } from './quran-selection-view';

/**
 * **One Dua, drawn in full** — and every section that is not supported simply not drawn.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── This component asks nothing and decides nothing ────────────────────────
 * It takes a `DuaDetailPresentation` and renders it. Every question a detail page could get wrong —
 * is there a transliteration, is there a count, is there a reviewer, may this open in the Reader — has
 * already been answered by `duaDetailPresentation`, in a pure function, from a validated object.
 *
 * That split is not tidiness. A detail page is where a missing field is most likely to be turned into
 * a plausible default, because the layout looks unfinished without it: an empty context box invites a
 * generic sentence, an absent count invites a familiar one. Here there is no branch that could do
 * that — a `null` produces no element at all, and there is no copy for a section that has no content.
 *
 * ── The two claims are drawn differently because they are different ────────
 * A reviewed entry carries its review: a named reviewer, a citable basis, a date, and NoorLife's own
 * record identifier for the approval. A personal selection carries none of those and is badged as the
 * user's own. Both carry the provider attribution and the translator's name, because both are showing
 * publisher text — the user chose a reference, not the words.
 *
 * ── Wrapping, never shrinking ──────────────────────────────────────────────
 * Every action is a full-width row rather than a horizontal bar of icons. At 320 dp with a 1.5 text
 * scale a row of four labelled controls cannot hold its labels or its 44 dp targets, and the answer
 * this module has settled on is that the layout gives way and the type does not — see the wrapping
 * note on `dua-library-items.tsx`.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const EMERALD = modulePalettes.faith.primary;
const EMERALD_DEEP = modulePalettes.faith.dark;
const MINT = modulePalettes.faith.soft;

export type DuaDetailViewProps = {
  readonly presentation: DuaDetailPresentation;
  /** Opens the Reader at the entry's first ayah. Offered only when `readerTarget` is present. */
  readonly onOpenInReader: () => void;
  /** Switches the Tasbih counter and opens it. Awaited by the caller before it navigates. */
  readonly onUseInTasbih: () => void;
  /** Toggles the user's favourite state. Offered only when `favourite` is not `null`. */
  readonly onToggleFavourite: () => void;
  /** Opens the module's attribution screen. */
  readonly onOpenSourceInfo: () => void;
  readonly testID?: string;
};

export function DuaDetailView({
  presentation,
  onOpenInReader,
  onUseInTasbih,
  onToggleFavourite,
  onOpenSourceInfo,
  testID = 'faith-dua-detail',
}: DuaDetailViewProps) {
  const { dp } = useModuleMetrics();

  return (
    <View style={{ rowGap: dp(moduleLayout.cardGap) }} testID={testID}>
      <ModuleCard testID={`${testID}-header`}>
        <View style={{ rowGap: dp(6) }}>
          <SelectionOriginBadge origin={presentation.origin} testID={`${testID}-origin`} />
          <ModuleText
            token="cardTitle"
            color={moduleNeutrals.textPrimary}
            numberOfLines={3}
            accessibilityRole="header"
            testID={`${testID}-title`}
          >
            {presentation.title}
          </ModuleText>
          {/*
            Said out loud when the heading is the user's own words, so an untitled selection's neutral
            stand-in is never mistaken for a title NoorLife supplied.
          */}
          {presentation.titleIsUserWritten ? (
            <ModuleText token="caption" numberOfLines={1} testID={`${testID}-title-origin`}>
              Your own note
            </ModuleText>
          ) : null}
        </View>
      </ModuleCard>

      {/*
        The scripture, its meaning and the translator — or the honest unavailable state. Drawn by
        `QuranSelectionView` rather than here, because that component is where the two display
        obligations are impossible to separate: the credit is rendered by the same branch that renders
        the translation, and there is no prop that would show one without the other.
      */}
      {presentation.resolution === null ? null : (
        <ModuleCard testID={`${testID}-content`}>
          <QuranSelectionView
            resolution={presentation.resolution}
            reference={presentation.reference.replace(/^Qur’an\s/u, '')}
            testID={`${testID}-body`}
          />
        </ModuleCard>
      )}

      {/*
        ── Omitted, not emptied ──────────────────────────────────────────────
        `transliteration` is `null` for every entry today: NoorLife does not compose romanisations, and
        no provider romanisation is retrieved. So this card does not exist rather than existing with a
        dash in it — a labelled empty box is a claim that something is missing, when the truth is that
        nothing was ever promised.
      */}
      {presentation.transliteration === null ? null : (
        <DetailSection
          title="Transliteration"
          body={presentation.transliteration}
          testID={`${testID}-transliteration`}
        />
      )}

      {presentation.context === null ? null : (
        <DetailSection
          title="When this is said"
          body={presentation.context}
          testID={`${testID}-context`}
        />
      )}

      {presentation.repetition === null ? null : (
        <DetailSection
          title="Repetition"
          /*
            The count and its basis in one block, never the count alone. A number on a religious surface
            with nothing behind it is an instruction, and the parser refuses one without a stated basis
            precisely so this can render both or neither.
          */
          body={`${presentation.repetition} times`}
          note={presentation.repetitionBasis}
          testID={`${testID}-repetition`}
        />
      )}

      <SourceCard presentation={presentation} onOpenSourceInfo={onOpenSourceInfo} testID={testID} />

      {presentation.categories.length === 0 ? null : (
        <CategoryMembership categories={presentation.categories} testID={testID} />
      )}

      <View style={{ rowGap: dp(8) }} testID={`${testID}-actions`}>
        {presentation.readerTarget === null ? null : (
          <ActionRow
            icon="quran"
            label="Open in Reader"
            hint={`Opens ${presentation.reference} in the Qur’an reader`}
            onPress={onOpenInReader}
            testID={`${testID}-read`}
          />
        )}
        <ActionRow
          icon="tasbih"
          label="Use in Tasbih"
          hint={`Counts ${presentation.title} on the Tasbih counter`}
          onPress={onUseInTasbih}
          testID={`${testID}-use`}
        />
        {/*
          `null` means the concept does not apply — a reviewed entry has no favourite state anywhere in
          this app. Rendering a star that wrote nowhere would be a control that lies about what it does.
        */}
        {presentation.favourite === null ? null : (
          <ActionRow
            icon={presentation.favourite ? 'star' : 'bookmark'}
            label={presentation.favourite ? 'In your favorites' : 'Add to favorites'}
            hint={
              presentation.favourite
                ? `Removes ${presentation.reference} from your favorites`
                : `Adds ${presentation.reference} to your favorites`
            }
            selected={presentation.favourite}
            onPress={onToggleFavourite}
            testID={`${testID}-favourite`}
          />
        )}
      </View>
    </View>
  );
}

/** A titled block of reviewed prose. One shape, so a new section cannot invent its own layout. */
function DetailSection({
  title,
  body,
  note,
  testID,
}: {
  readonly title: string;
  readonly body: string;
  readonly note?: string | null;
  readonly testID: string;
}) {
  const { dp } = useModuleMetrics();

  return (
    <ModuleCard testID={testID}>
      <View style={{ rowGap: dp(4) }}>
        <ModuleText
          token="caption"
          color={EMERALD_DEEP}
          numberOfLines={2}
          accessibilityRole="header"
        >
          {title}
        </ModuleText>
        <ModuleText token="body" color={moduleNeutrals.textPrimary} testID={`${testID}-body`}>
          {body}
        </ModuleText>
        {note === null || note === undefined ? null : (
          <ModuleText token="caption" testID={`${testID}-note`}>
            {note}
          </ModuleText>
        )}
      </View>
    </ModuleCard>
  );
}

/**
 * Where this came from, and who said it was appropriate.
 *
 * ── Why the review record is spelled out rather than summarised ────────────
 * "Scholarly reviewed" on its own is an appeal to an authority the user cannot inspect. A name, the
 * basis it was checked against, the date, and NoorLife's own identifier for the record make the claim
 * *checkable* — and the identifier is the part that makes it traceable to a document rather than to a
 * name that several people share. An entry that could not supply all four never reaches this screen;
 * the parser refuses it.
 */
function SourceCard({
  presentation,
  onOpenSourceInfo,
  testID,
}: {
  readonly presentation: DuaDetailPresentation;
  readonly onOpenSourceInfo: () => void;
  readonly testID: string;
}) {
  const { dp } = useModuleMetrics();
  const { review } = presentation;

  return (
    <ModuleCard testID={`${testID}-source`}>
      <View style={{ rowGap: dp(6) }}>
        <ModuleText
          token="caption"
          color={EMERALD_DEEP}
          numberOfLines={2}
          accessibilityRole="header"
        >
          Source
        </ModuleText>

        <SourceLine
          label={presentation.sourceKind === 'quran' ? 'Qur’an reference' : 'Narration'}
          value={presentation.reference}
          testID={`${testID}-source-reference`}
        />
        <SourceLine
          label="Provided by"
          value={presentation.provider}
          testID={`${testID}-source-provider`}
        />

        {review === null ? (
          /*
            Stated rather than left blank. A page that showed a review block for reviewed entries and
            nothing at all for personal ones would leave the user to infer the difference from an
            absence, and the whole point of the badge is that they never have to.
          */
          <ModuleText token="caption" numberOfLines={4} testID={`${testID}-source-unreviewed`}>
            You chose this verse yourself. NoorLife has not reviewed it as a supplication and makes
            no claim about reciting it.
          </ModuleText>
        ) : (
          <View style={{ rowGap: dp(4) }} testID={`${testID}-review`}>
            <SourceLine label="Review status" value="Approved" testID={`${testID}-review-status`} />
            <SourceLine
              label="Reviewed by"
              value={review.reviewer}
              testID={`${testID}-review-reviewer`}
            />
            <SourceLine label="Basis" value={review.basis} testID={`${testID}-review-basis`} />
            <SourceLine
              label="Approved on"
              value={review.approvedOn}
              testID={`${testID}-review-date`}
            />
            <SourceLine
              label="Review record"
              value={review.recordId}
              testID={`${testID}-review-record`}
            />
          </View>
        )}

        {/*
          The exact sentence the permission specifies, from the one constant that holds it. Never
          paraphrased, never shortened to fit — see `QURAN_CONTENT_ATTRIBUTION`.
        */}
        <ModuleText token="caption" testID={`${testID}-attribution`}>
          {presentation.attribution}
        </ModuleText>

        <PressableScale
          onPress={onOpenSourceInfo}
          accessibilityRole="button"
          accessibilityLabel="Where this content comes from"
          style={[
            styles.link,
            {
              minHeight: dp(moduleLayout.minTouchTarget),
              borderRadius: dp(moduleLayout.radiusSmall),
              paddingHorizontal: dp(12),
            },
          ]}
          testID={`${testID}-source-info`}
        >
          <ModuleText token="button" color={EMERALD_DEEP} numberOfLines={2}>
            Where this content comes from
          </ModuleText>
        </PressableScale>
      </View>
    </ModuleCard>
  );
}

/**
 * One labelled fact.
 *
 * Two `ModuleText`s stacked rather than a row, so a long value wraps under its label instead of
 * competing with it for a line — at 320 dp with a 1.5 scale a label and a reviewer's name on one row
 * leaves neither enough width, and the value is the half that must not be truncated.
 */
function SourceLine({
  label,
  value,
  testID,
}: {
  readonly label: string;
  readonly value: string;
  readonly testID: string;
}) {
  const { dp } = useModuleMetrics();

  return (
    <View style={{ rowGap: dp(1) }}>
      <ModuleText token="caption" color={moduleNeutrals.textSecondary} numberOfLines={2}>
        {label}
      </ModuleText>
      <ModuleText token="body" color={moduleNeutrals.textPrimary} testID={testID}>
        {value}
      </ModuleText>
    </View>
  );
}

/**
 * The cards this entry appears under.
 *
 * Labels rather than links: a chip that navigated back to the category the user just came from is a
 * loop, and the point of the block is to say where the entry is filed — which for a personal selection
 * is the user's own two cards and carries no religious claim at all.
 */
function CategoryMembership({
  categories,
  testID,
}: {
  readonly categories: readonly string[];
  readonly testID: string;
}) {
  const { dp } = useModuleMetrics();
  const labels = categories
    .map((id) => duaCategoryById(id)?.label ?? null)
    .filter((label): label is string => label !== null);

  if (labels.length === 0) {
    return null;
  }

  return (
    <ModuleCard testID={`${testID}-categories`}>
      <View style={{ rowGap: dp(6) }}>
        <ModuleText
          token="caption"
          color={EMERALD_DEEP}
          numberOfLines={2}
          accessibilityRole="header"
        >
          Appears in
        </ModuleText>
        {/* Wraps, so a card with three memberships stacks them rather than clipping the third. */}
        <View style={[styles.chips, { columnGap: dp(6), rowGap: dp(6) }]}>
          {labels.map((label) => (
            <View
              key={label}
              style={[
                styles.chip,
                {
                  borderRadius: dp(moduleLayout.radiusSmall),
                  paddingHorizontal: dp(8),
                  paddingVertical: dp(3),
                },
              ]}
            >
              <ModuleText token="caption" color={EMERALD_DEEP} numberOfLines={2}>
                {label}
              </ModuleText>
            </View>
          ))}
        </View>
      </View>
    </ModuleCard>
  );
}

/**
 * One full-width action.
 *
 * Labelled in text as well as by its glyph, and `accessibilityState` carries selection rather than
 * colour — a starred entry must be distinguishable without seeing the fill.
 */
function ActionRow({
  icon,
  label,
  hint,
  selected = false,
  onPress,
  testID,
}: {
  readonly icon: 'quran' | 'tasbih' | 'star' | 'bookmark';
  readonly label: string;
  readonly hint: string;
  readonly selected?: boolean;
  readonly onPress: () => void;
  readonly testID: string;
}) {
  const { dp } = useModuleMetrics();

  return (
    <PressableScale
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{ selected }}
      style={[
        styles.action,
        {
          minHeight: dp(moduleLayout.minTouchTarget),
          borderRadius: dp(moduleLayout.radiusSmall),
          paddingHorizontal: dp(12),
          paddingVertical: dp(8),
          columnGap: dp(10),
          backgroundColor: selected ? MINT : moduleNeutrals.surface,
          borderColor: selected ? EMERALD : moduleNeutrals.border,
          borderWidth: selected ? 2 : 1,
        },
      ]}
      testID={testID}
    >
      <AppIcon name={icon} size={dp(18)} color={EMERALD_DEEP} />
      <ModuleText token="button" color={EMERALD_DEEP} numberOfLines={2} style={styles.flex}>
        {label}
      </ModuleText>
      <AppIcon name="chevron-forward" size={dp(18)} color={EMERALD_DEEP} />
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  action: { alignItems: 'center', flexDirection: 'row' },
  chips: { flexDirection: 'row', flexWrap: 'wrap' },
  chip: {
    backgroundColor: MINT,
    borderColor: EMERALD,
    borderWidth: 1,
  },
  link: {
    alignItems: 'center',
    backgroundColor: moduleNeutrals.surface,
    borderColor: moduleNeutrals.border,
    borderWidth: 1,
    justifyContent: 'center',
  },
});
