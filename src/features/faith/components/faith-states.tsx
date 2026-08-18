import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppIcon } from '@ds/components';
import { ModuleStatusBanner, ModuleText } from '@features/modules/components';
import { useModuleTheme } from '@features/modules/module-context';
import { moduleLayout, moduleNeutrals } from '@features/modules/module-tokens';
import { useModuleMetrics } from '@features/modules/use-module-metrics';

import type { ContentSource } from '../data/faith-result';

/**
 * Faith-specific states and notices.
 *
 * These are the cases the shared framework's five state components do not cover:
 * no-results, staleness, slow network, and the source badge that every screen showing
 * religious content must carry.
 */

/** No search results. Distinct from empty — the user searched and matched nothing. */
export function FaithNoResultsState({
  query,
  testID,
}: {
  readonly query: string;
  readonly testID: string;
}) {
  const theme = useModuleTheme();
  const { dp } = useModuleMetrics();

  return (
    <View
      style={[styles.state, { paddingVertical: dp(28), rowGap: dp(8) }]}
      accessible
      accessibilityLiveRegion="polite"
      accessibilityLabel={
        query === ''
          ? 'Type at least two characters to search.'
          : `No results for ${query}. Try different keywords.`
      }
      testID={`${testID}-no-results`}
    >
      <View
        style={[
          styles.iconWell,
          {
            width: dp(56),
            height: dp(56),
            borderRadius: dp(28),
            backgroundColor: theme.lightSurface,
            borderColor: theme.border,
          },
        ]}
      >
        <AppIcon name="search" size={dp(24)} color={theme.ink} />
      </View>
      <ModuleText token="stateTitle" align="center" numberOfLines={2}>
        {query === '' ? 'Start typing to search' : 'No results found'}
      </ModuleText>
      <ModuleText token="stateBody" align="center" numberOfLines={3} style={styles.body}>
        {query === ''
          ? 'Enter at least two characters.'
          : `Nothing matched “${query}”. Try different keywords or check the spelling.`}
      </ModuleText>
    </View>
  );
}

/** Content served from cache. States when, and offers a refresh. */
export function FaithStaleBanner({
  cachedAt,
  onRefresh,
  testID,
}: {
  readonly cachedAt: string;
  readonly onRefresh: () => void;
  readonly testID: string;
}) {
  return (
    <ModuleStatusBanner
      tone="info"
      message={`Showing saved content from ${formatCachedAt(cachedAt)}. It may be out of date.`}
      actionLabel="Refresh"
      onAction={onRefresh}
      testID={`${testID}-stale`}
    />
  );
}

function formatCachedAt(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) {
    return 'an earlier session';
  }
  const hours = Math.floor((Date.now() - then) / 3_600_000);
  if (hours < 1) {
    return 'a few minutes ago';
  }
  if (hours < 24) {
    return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  }
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

/**
 * Where a piece of religious content came from.
 *
 * ── Why this is not optional ────────────────────────────────────────────────
 * Every screen showing Qur'an, Hadith or a dua renders one of these. While Quran
 * Foundation approval is pending all content is `verified: false`, and the badge says so
 * in plain words rather than in a colour a user has to decode. When an approved source
 * arrives the same badge names it.
 *
 * The unverified variant uses the warning tone deliberately: sample scripture is exactly
 * the thing that must not be mistaken for the real text.
 */
export function SourceBadge({
  source,
  testID,
}: {
  readonly source: ContentSource;
  readonly testID: string;
}) {
  const { dp } = useModuleMetrics();
  const theme = useModuleTheme();

  const tone = source.verified ? theme.lightSurface : moduleNeutrals.warningSurface;
  const ink = source.verified ? theme.ink : moduleNeutrals.warning;

  return (
    <View
      style={[
        styles.badge,
        {
          borderRadius: dp(moduleLayout.radiusSmall),
          paddingHorizontal: dp(9),
          paddingVertical: dp(6),
          columnGap: dp(6),
          backgroundColor: tone,
        },
      ]}
      accessible
      accessibilityLabel={
        source.verified
          ? `Source: ${source.name}${source.edition === undefined ? '' : `, ${source.edition}`}`
          : `Sample content, not a verified source. ${source.attribution ?? ''}`
      }
      testID={`${testID}-source`}
    >
      <AppIcon name={source.verified ? 'shield' : 'warning'} size={dp(14)} color={ink} />
      <View style={styles.badgeText}>
        <ModuleText token="caption" color={ink} numberOfLines={2}>
          {source.verified ? `Source: ${source.name}` : 'Sample content — not a verified source'}
        </ModuleText>
        {source.attribution === undefined ? null : (
          <ModuleText token="caption" numberOfLines={2}>
            {source.attribution}
          </ModuleText>
        )}
      </View>
    </View>
  );
}

/**
 * Reports whether a load has been running long enough to call slow.
 *
 * Three seconds, and deliberately not configurable per screen: an inconsistent threshold
 * would mean the same connection produced a warning on one screen and not another.
 */
export function useSlowNetworkNotice(isLoading: boolean, thresholdMs = 3000): boolean {
  // Records *which* load turned slow rather than a bare boolean. Clearing a boolean when
  // `isLoading` goes false would mean a synchronous setState inside the effect, which
  // cascades a render and which the React Compiler rejects. Comparing a marker against
  // the current loading state derives the same answer with no reset needed.
  const [slowFor, setSlowFor] = useState<number | null>(null);
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    if (!isLoading) {
      return;
    }
    const timer = setTimeout(() => setSlowFor(generation), thresholdMs);
    return () => clearTimeout(timer);
  }, [isLoading, thresholdMs, generation]);

  useEffect(() => {
    if (!isLoading) {
      // Asynchronous, so it does not cascade: the next load gets a fresh generation and
      // the stale `slowFor` no longer matches.
      const id = setTimeout(() => setGeneration((value) => value + 1), 0);
      return () => clearTimeout(id);
    }
    return undefined;
  }, [isLoading]);

  return isLoading && slowFor === generation;
}

const styles = StyleSheet.create({
  state: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconWell: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  body: {
    maxWidth: 280,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  badgeText: {
    flex: 1,
    minWidth: 0,
  },
});
