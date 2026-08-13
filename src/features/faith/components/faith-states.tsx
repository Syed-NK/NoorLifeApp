import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppIcon } from '@ds/components';
import { ModuleStatusBanner, ModuleText } from '@features/modules/components';
import { useModuleTheme } from '@features/modules/module-context';
import { moduleLayout, moduleNeutrals } from '@features/modules/module-tokens';
import { useModuleMetrics } from '@features/modules/use-module-metrics';
import type { IconName } from '@shared/models/icon';

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

/**
 * The refresh indication that sits above content while it is being re-requested.
 *
 * ── Why this is a banner and not a spinner over the list ────────────────────
 * Because the content underneath is readable and stays readable. Every alternative considered took
 * something away: a full-screen skeleton removes 114 rows the user is looking at, an overlay dims
 * text somebody may be mid-sentence in, and a spinner in the header is invisible on a scrolled page.
 * A single line at the top is noticeable when looked for and ignorable when not, which is the right
 * weight for an event the user did not ask about and does not need to act on.
 *
 * There is no action, deliberately: a refresh is already happening, so a "Refresh" control would do
 * nothing, and a "Cancel" would leave the screen in a state nobody asked for.
 */
export function FaithRefreshingNotice({ testID }: { readonly testID: string }) {
  return (
    <ModuleStatusBanner
      tone="info"
      message="Checking for updates. What you are reading stays on screen."
      testID={`${testID}-refreshing`}
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
 * Warns that content on this screen is not from a verified source. Renders nothing when it is.
 *
 * ── Why this can only warn ──────────────────────────────────────────────────
 * It used to render both halves: a warning for sample content, and `Source: Quran Foundation
 * Content API` for approved content. The second half was a *technical* banner sitting above the
 * scripture on the Qur'an screen, the reader and the Daily Ayah — it named a vendor's API product
 * to somebody who had opened the app to read, and it was the most prominent thing on three reading
 * surfaces. It is gone.
 *
 * What replaced it is not less attribution but better-placed attribution. The translation edition
 * and its translator now appear beside the verses they belong to, the reciter appears with the audio
 * controls, and Quran Foundation is acknowledged on the content-information screen reached from
 * More. Provenance a reader can act on, rather than a badge they learn to scroll past.
 *
 * The warning half stays, and is the whole component now: an early `return null` for a verified
 * source means this cannot grow back into a banner without someone deleting that line and
 * explaining why. Sample scripture is exactly the thing that must not be mistaken for the real text,
 * so where the repository is a fixture the screen still says so in plain words.
 */
export function UnverifiedSourceNotice({
  source,
  testID,
}: {
  readonly source: ContentSource;
  readonly testID: string;
}) {
  const { dp } = useModuleMetrics();

  if (source.verified) {
    return null;
  }

  return (
    <View
      style={[
        styles.badge,
        {
          borderRadius: dp(moduleLayout.radiusSmall),
          paddingHorizontal: dp(9),
          paddingVertical: dp(6),
          columnGap: dp(6),
          backgroundColor: moduleNeutrals.warningSurface,
        },
      ]}
      accessible
      accessibilityLabel={`Sample content, not a verified source. ${source.attribution ?? ''}`}
      testID={`${testID}-source`}
    >
      <AppIcon name="warning" size={dp(14)} color={moduleNeutrals.warning} />
      <View style={styles.badgeText}>
        <ModuleText token="caption" color={moduleNeutrals.warning} numberOfLines={2}>
          Sample content — not a verified source
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
 * A screen whose content needs a provider NoorLife has not approved yet.
 *
 * ── Why this exists rather than sample content ───────────────────────────────
 * Hadith, Duas and the mosque directory each shipped for several phases from fixtures in
 * `data/mock/`. The fixtures were *convincing* — accurate collection names, real narration counts,
 * grades, Arabic supplication text, plausible mosque addresses and distances — and that was the
 * defect rather than the merit. A user cannot tell a fixture from a verified narration, and a
 * religious text nobody has checked against a critical edition is the one kind of placeholder that
 * must never reach a screen. The `UnverifiedSourceNotice` above it was an honest label on content
 * that should not have been rendered at all.
 *
 * ── Why it is not a skeleton ─────────────────────────────────────────────────
 * A skeleton row promises content that is arriving. Nothing is arriving: there is no provider, and
 * there will not be one until a licensing decision is taken. An indefinite skeleton is a lie with a
 * loading animation, so this state is deliberately terminal and says why in words.
 *
 * ── Why there is no action button ────────────────────────────────────────────
 * Every candidate action would be dishonest. "Retry" implies a transient failure, "Enable" implies
 * the user can, and "Learn more" would need a page that does not exist. The state explains and
 * stops.
 *
 * ── The clipping this card used to show, and what it actually was ───────────
 * This card was the surface that exposed an app-wide defect, so the diagnosis is recorded here
 * rather than only in the phase report — a future clipping report should start by checking whether
 * it is the same thing again.
 *
 * The symptom was a title reading "Nearby mosques are not" and a body ending mid-sentence, with no
 * ellipsis and blank space beneath. It reproduced at **every** OS font scale including 1.0, and only
 * in **release** builds — never under Metro, which is what made it look like a font-scale bug.
 *
 * It was none of the things it looked like. Not a fixed height (there is none here or above), not
 * the screen failing to scroll, not the title's `numberOfLines`, not `styles.body`'s `maxWidth`, and
 * **not `ModuleText`'s scaling model** — `fontSize` and `lineHeight` both go through the same sp
 * conversion and stay proportional.
 *
 * The cause was font resolution. Poppins was registered only at runtime by `expo-font`, and in a
 * release build React Native measured every string in the system fallback face while painting it in
 * Poppins, which is 10–18% wider. Yoga therefore sized each `Text` for a narrower face than Android
 * drew, so long strings were given too few line boxes and the surplus was cropped by the view's own
 * bounds. Re-navigating never corrected it, because the measurement spannable is cached by string
 * content. The fix embeds the four faces at build time — see `design-system/typography/fonts.ts`.
 */
export function FaithProviderLockedState({
  title,
  body,
  icon,
  testID,
}: {
  readonly title: string;
  readonly body: string;
  readonly icon: IconName;
  readonly testID: string;
}) {
  const theme = useModuleTheme();
  const { dp } = useModuleMetrics();

  return (
    <View
      style={[styles.state, { paddingVertical: dp(32), rowGap: dp(10) }]}
      accessible
      /*
        One node with the whole message. A screen reader landing on a locked screen needs the reason
        in a single utterance, not a title it has to swipe past to reach the explanation.
      */
      accessibilityLabel={`${title}. ${body}`}
      testID={`${testID}-locked`}
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
        <AppIcon name={icon} size={dp(24)} color={theme.ink} />
      </View>
      <ModuleText token="stateTitle" align="center" numberOfLines={2}>
        {title}
      </ModuleText>
      {/*
        No `numberOfLines` cap tight enough to truncate the reason. The whole point of this state is
        the explanation, and an ellipsised explanation would leave the user knowing only that
        something is missing.
      */}
      <ModuleText token="stateBody" align="center" style={styles.body}>
        {body}
      </ModuleText>
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
