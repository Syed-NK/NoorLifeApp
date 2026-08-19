import { Modal, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { AppIcon, PressableScale } from '@ds/components';
import { modulePalettes } from '@ds/tokens';
import { ModuleText } from '@features/modules/components';
import { moduleLayout, moduleNeutrals } from '@features/modules/module-tokens';
import { useModuleMetrics } from '@features/modules/use-module-metrics';
import { minimumHitSlop } from '@shared/utils/a11y';

/**
 * The search field and the filter sheet the Duas surfaces share.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── Why these moved out of the grid screen ─────────────────────────────────
 * They were local to `duas-screen.tsx` when the grid was the only place you could search. The category
 * pages need the same two controls, and a second copy would be a second answer to questions that have
 * already been settled once on a device: at what width the placeholder has to shorten, whether the
 * spoken name shortens with it (it does not), whether the input carries its own type token, and whether
 * the active filter is distinguishable without seeing the colour.
 *
 * Every one of those was a fix. Copying the components would copy today's answers and none of tomorrow's
 * — so they live here, and both surfaces pass a `testIDPrefix` instead of owning a variant.
 *
 * ── The filter set is a parameter, not a constant ──────────────────────────
 * The library-wide sheet offers *All / My Quran Selections / Favorites / Reviewed*; a category page
 * offers a set that depends on the card — see `categoryFilterOptions`, and its note on why some filters
 * are absent rather than empty. So the sheet is generic over the id type and renders what it is handed.
 * It decides nothing about which filters are legitimate.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const EMERALD = modulePalettes.faith.primary;
const EMERALD_DEEP = modulePalettes.faith.dark;
const MINT = modulePalettes.faith.soft;

/** The full phrase, used as the spoken name at every width and as the placeholder where it fits. */
const FULL_PLACEHOLDER = 'Find a remembrance';
/** What the placeholder becomes when the full phrase would be clipped. Short, and honest. */
const COMPACT_PLACEHOLDER = 'Search';

export type DuaSearchRowProps = {
  readonly value: string;
  readonly onChange: (text: string) => void;
  readonly onOpenFilter: () => void;
  /** Whether a filter other than the default is active. Carries the button's emphasis and its state. */
  readonly filterActive: boolean;
  /** The active filter's label, for the button's spoken name. */
  readonly filterLabel: string;
  /** What the field searches, in the user's terms. Differs between the library and a category page. */
  readonly searchHint: string;
  readonly testIDPrefix: string;
};

export function DuaSearchRow({
  value,
  onChange,
  onOpenFilter,
  filterActive,
  filterLabel,
  searchHint,
  testIDPrefix,
}: DuaSearchRowProps) {
  const { dp, type, fontScale, contentWidth } = useModuleMetrics();

  /*
    The field's own width, less its icon, its padding and the filter button beside it — measured the same
    way the grid measures a card, rather than guessed from a breakpoint. `compact` is true when the full
    phrase would not fit, which is a question about this device and this text size together.
  */
  const fieldWidth =
    contentWidth - dp(moduleLayout.minTouchTarget) - dp(moduleLayout.cardGap) - dp(18) - dp(24);
  const compact = FULL_PLACEHOLDER.length * type('body').fontSize * fontScale * 0.625 > fieldWidth;

  return (
    <View style={[styles.searchRow, { columnGap: dp(moduleLayout.cardGap) }]}>
      <View
        style={[
          styles.search,
          {
            borderRadius: dp(moduleLayout.radiusSmall),
            minHeight: dp(moduleLayout.minTouchTarget),
            paddingHorizontal: dp(12),
            columnGap: dp(10),
          },
        ]}
      >
        <AppIcon name="search" size={dp(18)} color={moduleNeutrals.textSecondary} />
        {/*
          ── The placeholder shortens; the spoken name never does ──────────────
          "Find a remembrance" is a single line in a `TextInput`, which cannot wrap, so at 320 dp with a
          1.5 text scale it was clipped mid-phrase to "Find a" — a label that reads as an unfinished
          sentence and says less than nothing.

          At compact widths it becomes "Search", which is short enough to render whole and is honest
          about what the field does. `accessibilityLabel` keeps the full phrase either way, so assistive
          technology is told the purpose in full at every size — the visible text is what gives way to
          the width, not the meaning.
        */}
        <TextInput
          value={value}
          onChangeText={onChange}
          placeholder={compact ? COMPACT_PLACEHOLDER : FULL_PLACEHOLDER}
          placeholderTextColor={moduleNeutrals.textTertiary}
          accessibilityLabel={FULL_PLACEHOLDER}
          accessibilityHint={searchHint}
          style={[
            styles.flex,
            {
              color: moduleNeutrals.textPrimary,
              paddingVertical: dp(10),
              /*
                ── The input had no size, and that was the actual defect ──────
                A `TextInput` does not inherit `ModuleText`'s token, so this field was rendering at the
                platform default. At a 1.5 text scale that is visibly larger than every label around it,
                which is why the placeholder clipped while the card titles beside it fitted comfortably.
                Giving it the body token makes it scale like the rest of the screen instead of on its own
                curve.
              */
              fontSize: type('body').fontSize,
            },
          ]}
          testID={`${testIDPrefix}-search`}
        />
        {/*
          Offered only when there is something to clear. A permanent clear button on an empty field is a
          control that does nothing, and a screen reader announces it just as loudly.
        */}
        {value.length === 0 ? null : (
          <PressableScale
            onPress={() => onChange('')}
            accessibilityRole="button"
            accessibilityLabel="Clear the search"
            hitSlop={minimumHitSlop(dp(moduleLayout.minTouchTarget))}
            testID={`${testIDPrefix}-search-clear`}
          >
            <AppIcon name="close" size={dp(18)} color={moduleNeutrals.textSecondary} />
          </PressableScale>
        )}
      </View>

      <PressableScale
        onPress={onOpenFilter}
        accessibilityRole="button"
        accessibilityLabel={`Filter. Currently ${filterLabel}.`}
        style={[
          styles.filterButton,
          {
            width: dp(moduleLayout.minTouchTarget),
            height: dp(moduleLayout.minTouchTarget),
            borderRadius: dp(moduleLayout.radiusSmall),
            /* The active filter is carried by the border weight as well as the fill, never by colour alone. */
            borderColor: filterActive ? EMERALD : moduleNeutrals.border,
            borderWidth: filterActive ? 2 : 1,
            backgroundColor: filterActive ? MINT : moduleNeutrals.surface,
          },
        ]}
        testID={`${testIDPrefix}-filter`}
      >
        <AppIcon name="settings" size={dp(18)} color={EMERALD_DEEP} />
      </PressableScale>
    </View>
  );
}

export type DuaFilterSheetProps<T extends string> = {
  readonly open: boolean;
  readonly options: readonly { readonly id: T; readonly label: string }[];
  readonly selected: T;
  readonly onSelect: (filter: T) => void;
  readonly onClose: () => void;
  readonly testIDPrefix: string;
};

/**
 * The filter sheet.
 *
 * A `Modal` rather than an inline row, because the approved design puts the control behind a button and
 * an inline row of chips would push the first row of content below the fold at every text size.
 */
export function DuaFilterSheet<T extends string>({
  open,
  options,
  selected,
  onSelect,
  onClose,
  testIDPrefix,
}: DuaFilterSheetProps<T>) {
  const { dp } = useModuleMetrics();

  return (
    <Modal
      visible={open}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      testID={`${testIDPrefix}-filter-sheet`}
    >
      {/* The scrim dismisses, and is labelled, so it is not a silent trap for a screen reader. */}
      <Pressable
        style={styles.scrim}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="Close the filter"
        testID={`${testIDPrefix}-filter-scrim`}
      >
        <View
          style={[
            styles.sheet,
            {
              borderTopLeftRadius: dp(moduleLayout.cardRadius),
              borderTopRightRadius: dp(moduleLayout.cardRadius),
              padding: dp(moduleLayout.cardPadding),
              rowGap: dp(6),
            },
          ]}
        >
          <ModuleText token="cardTitle" numberOfLines={1} accessibilityRole="header">
            Show
          </ModuleText>
          {options.map((item) => {
            const active = item.id === selected;
            return (
              <PressableScale
                key={item.id}
                onPress={() => onSelect(item.id)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                accessibilityLabel={item.label}
                style={[
                  styles.filterRow,
                  {
                    minHeight: dp(moduleLayout.minTouchTarget),
                    borderRadius: dp(moduleLayout.radiusSmall),
                    paddingHorizontal: dp(12),
                    columnGap: dp(8),
                    backgroundColor: active ? MINT : moduleNeutrals.surface,
                    borderColor: active ? EMERALD : moduleNeutrals.border,
                    borderWidth: active ? 2 : 1,
                  },
                ]}
                testID={`${testIDPrefix}-filter-${item.id}`}
              >
                <ModuleText
                  token="body"
                  color={moduleNeutrals.textPrimary}
                  numberOfLines={2}
                  style={styles.flex}
                >
                  {item.label}
                </ModuleText>
                {/* A tick as well as the fill: the selected row must not depend on colour alone. */}
                {active ? <AppIcon name="check" size={dp(18)} color={EMERALD_DEEP} /> : null}
              </PressableScale>
            );
          })}
        </View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  searchRow: { alignItems: 'center', flexDirection: 'row' },
  search: {
    alignItems: 'center',
    backgroundColor: moduleNeutrals.surface,
    borderColor: moduleNeutrals.border,
    borderWidth: 1,
    flex: 1,
    flexDirection: 'row',
  },
  filterButton: { alignItems: 'center', justifyContent: 'center' },
  scrim: { backgroundColor: '#14265F55', flex: 1, justifyContent: 'flex-end' },
  sheet: { backgroundColor: moduleNeutrals.surface },
  filterRow: { alignItems: 'center', flexDirection: 'row' },
});
