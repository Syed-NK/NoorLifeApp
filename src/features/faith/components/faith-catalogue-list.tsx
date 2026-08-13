import { useMemo } from 'react';
import { FlatList, StyleSheet, TextInput, View } from 'react-native';

import { AppIcon, PressableScale } from '@ds/components';
import { ModuleText } from '@features/modules/components';
import { useModuleTheme } from '@features/modules/module-context';
import { moduleLayout, moduleNeutrals } from '@features/modules/module-tokens';
import { useModuleMetrics } from '@features/modules/use-module-metrics';
import { minimumHitSlop } from '@shared/utils/a11y';

/**
 * The shared frame for the two catalogue selectors.
 *
 * ── Why one component rather than two screens that look alike ───────────────
 * The screen this replaces put every translation edition *and* every reciter into one unfiltered
 * scroll — hundreds of rows across every language the vendor offers, with the selected one somewhere
 * inside it. Splitting that into two screens is only half the fix; the other half is that both need
 * the same three things (a search field, a filter row, a virtualized list) and would drift apart
 * within a release if each wrote its own.
 *
 * ── Virtualized, deliberately ───────────────────────────────────────────────
 * `FlatList` rather than a mapped `ScrollView`. The translation catalogue is in the hundreds, and the
 * old screen mounted every row on every render — which is what made it feel like a wall of text as
 * much as the missing filter did.
 */

export type CatalogueFilter = {
  readonly id: string;
  readonly label: string;
};

export type CatalogueRow = {
  readonly id: string;
  readonly title: string;
  /** The one-line detail beneath the title — "English • M.A.S. Abdel Haleem". */
  readonly detail: string;
  /** Optional third line, e.g. a download or cache state. */
  readonly trailingNote?: string;
  readonly accessibilityLabel: string;
  /**
   * An action belonging to the row rather than to selecting it.
   *
   * ── Why it is a second control and not a tap on the row ─────────────────────
   * Selecting a reciter and downloading their recitation are different decisions with very different
   * costs, and a list where one gesture did both would make a tens-of-megabytes transfer the
   * accidental result of browsing voices. So the row selects and the control downloads, and the
   * control is absent — never disabled — where there is nothing to download.
   */
  readonly action?: {
    readonly icon: 'download' | 'downloading' | 'delete' | 'retry';
    readonly label: string;
    readonly accessibilityLabel: string;
    readonly onPress: () => void;
    /** Drawn in the warning tone, for a failed or expired download. */
    readonly warning?: boolean;
  };
};

export type FaithCatalogueListProps = {
  readonly rows: readonly CatalogueRow[];
  readonly selectedId: string | null;
  readonly onSelect: (id: string) => void;
  readonly query: string;
  readonly onQueryChange: (value: string) => void;
  readonly searchPlaceholder: string;
  readonly searchLabel: string;
  /** Omitted entirely when a catalogue has no meaningful filter values. */
  readonly filters?: readonly CatalogueFilter[];
  readonly activeFilterId?: string;
  readonly onFilterChange?: (id: string) => void;
  readonly filterLabel?: string;
  /** Shown when the query and filter together match nothing. */
  readonly emptyMessage: string;
  readonly testID: string;
};

export function FaithCatalogueList({
  rows,
  selectedId,
  onSelect,
  query,
  onQueryChange,
  searchPlaceholder,
  searchLabel,
  filters,
  activeFilterId,
  onFilterChange,
  filterLabel,
  emptyMessage,
  testID,
}: FaithCatalogueListProps) {
  const theme = useModuleTheme();
  const { dp } = useModuleMetrics();

  /**
   * The header, memoised.
   *
   * `ListHeaderComponent` is re-created on every render otherwise, which remounts the `TextInput`
   * and drops the keyboard after each keystroke — the classic version of this bug.
   */
  const header = useMemo(
    () => (
      <View style={{ rowGap: dp(10), paddingBottom: dp(10) }}>
        <View
          style={[
            styles.search,
            {
              borderRadius: dp(12),
              paddingHorizontal: dp(12),
              minHeight: dp(moduleLayout.minTouchTarget),
              columnGap: dp(8),
            },
          ]}
        >
          <AppIcon name="search" size={dp(18)} color={moduleNeutrals.textSecondary} />
          <TextInput
            value={query}
            onChangeText={onQueryChange}
            placeholder={searchPlaceholder}
            placeholderTextColor={moduleNeutrals.textTertiary}
            accessibilityLabel={searchLabel}
            autoCorrect={false}
            autoCapitalize="none"
            returnKeyType="search"
            style={[styles.input, { color: moduleNeutrals.textPrimary, fontSize: dp(15) }]}
            testID={`${testID}-search`}
          />
          {query.length === 0 ? null : (
            <PressableScale
              onPress={() => onQueryChange('')}
              accessibilityRole="button"
              accessibilityLabel="Clear search"
              hitSlop={minimumHitSlop(dp(20))}
              testID={`${testID}-search-clear`}
            >
              <AppIcon name="close" size={dp(16)} color={moduleNeutrals.textSecondary} />
            </PressableScale>
          )}
        </View>

        {filters === undefined || filters.length === 0 ? null : (
          <FlatList
            data={filters}
            horizontal
            showsHorizontalScrollIndicator={false}
            keyExtractor={(filter) => filter.id}
            accessibilityLabel={filterLabel}
            contentContainerStyle={{ columnGap: dp(8), paddingVertical: dp(2) }}
            renderItem={({ item }) => {
              const active = item.id === activeFilterId;
              return (
                <PressableScale
                  onPress={() => onFilterChange?.(item.id)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={`${item.label}${active ? ', selected' : ''}`}
                  style={{
                    borderRadius: dp(999),
                    paddingHorizontal: dp(14),
                    minHeight: dp(36),
                    justifyContent: 'center',
                    backgroundColor: active ? theme.ink : moduleNeutrals.surfaceMuted,
                  }}
                  testID={`${testID}-filter-${item.id}`}
                >
                  <ModuleText
                    token="caption"
                    numberOfLines={1}
                    color={active ? moduleNeutrals.surface : moduleNeutrals.textSecondary}
                  >
                    {item.label}
                  </ModuleText>
                </PressableScale>
              );
            }}
            testID={`${testID}-filters`}
          />
        )}
      </View>
    ),
    [
      dp,
      query,
      onQueryChange,
      searchPlaceholder,
      searchLabel,
      filters,
      activeFilterId,
      onFilterChange,
      filterLabel,
      theme.ink,
      testID,
    ],
  );

  return (
    <FlatList
      data={rows}
      keyExtractor={(row) => row.id}
      /**
       * Sticky, so the search field and the filter chips stay reachable while scrolling a long
       * catalogue — otherwise narrowing a 300-row list means scrolling back to the top first.
       */
      ListHeaderComponent={header}
      stickyHeaderIndices={[0]}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      showsVerticalScrollIndicator={false}
      /**
       * The scaffold's `fills` mode already reserves the bottom navigation's height on the content
       * column, so the last row clears the bar. This is the list's own breathing room beneath it.
       */
      contentContainerStyle={{ paddingBottom: dp(moduleLayout.scrollBottomInset) }}
      ListEmptyComponent={
        <View style={{ paddingVertical: dp(24) }} testID={`${testID}-no-results`}>
          <ModuleText token="body" numberOfLines={3}>
            {emptyMessage}
          </ModuleText>
        </View>
      }
      renderItem={({ item }) => {
        const selected = item.id === selectedId;
        return (
          <PressableScale
            onPress={() => onSelect(item.id)}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            accessibilityLabel={item.accessibilityLabel}
            style={[
              styles.row,
              {
                minHeight: dp(moduleLayout.minTouchTarget + 12),
                paddingVertical: dp(10),
                columnGap: dp(10),
              },
            ]}
            testID={`${testID}-row-${item.id}`}
          >
            <View style={styles.rowText}>
              <ModuleText token="rowLabel" numberOfLines={2}>
                {item.title}
              </ModuleText>
              <ModuleText token="rowMeta" numberOfLines={2}>
                {item.detail}
              </ModuleText>
              {item.trailingNote === undefined ? null : (
                <ModuleText token="caption" numberOfLines={1}>
                  {item.trailingNote}
                </ModuleText>
              )}
            </View>
            {/*
              A checkmark, not colour alone. The row also carries `accessibilityState.selected`
              and says ", selected" in its label, so the state survives for a screen-reader user
              and for anyone who cannot distinguish the tick's colour from the ink around it.
            */}
            {item.action === undefined ? null : (
              <PressableScale
                onPress={item.action.onPress}
                accessibilityRole="button"
                accessibilityLabel={item.action.accessibilityLabel}
                hitSlop={minimumHitSlop(dp(12))}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  columnGap: dp(6),
                  paddingHorizontal: dp(8),
                  minHeight: dp(moduleLayout.minTouchTarget),
                }}
                testID={`${testID}-action-${item.id}`}
              >
                <AppIcon
                  name={item.action.icon}
                  size={dp(18)}
                  color={item.action.warning === true ? moduleNeutrals.warning : theme.ink}
                />
                <ModuleText
                  token="caption"
                  numberOfLines={1}
                  color={item.action.warning === true ? moduleNeutrals.warning : theme.ink}
                >
                  {item.action.label}
                </ModuleText>
              </PressableScale>
            )}
            {selected ? (
              <View testID={`${testID}-selected-${item.id}`}>
                <AppIcon name="check-circle" size={dp(20)} color={theme.ink} />
              </View>
            ) : null}
          </PressableScale>
        );
      }}
      ItemSeparatorComponent={() => <View style={styles.separator} />}
      testID={`${testID}-list`}
    />
  );
}

const styles = StyleSheet.create({
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: moduleNeutrals.surfaceMuted,
  },
  input: {
    flex: 1,
    padding: 0,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  rowText: {
    flex: 1,
    minWidth: 0,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: moduleNeutrals.divider,
  },
});
