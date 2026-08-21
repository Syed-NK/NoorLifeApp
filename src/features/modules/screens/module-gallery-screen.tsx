import { useRouter } from 'expo-router';
import { useEffect, useState, type ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PressableScale } from '@ds/components';

import {
  ModuleActivityCard,
  ModuleEmptyState,
  ModuleErrorState,
  ModuleFeatureGrid,
  ModuleHeroCard,
  ModuleInsightCard,
  ModuleLoadingState,
  ModuleOfflineState,
  ModulePermissionState,
  ModuleQuickActionRow,
  ModuleSection,
  ModuleStatusBanner,
  ModuleSummaryCard,
  ModuleText,
} from '../components';
import { ModuleHeroAudit } from '../components/module-hero-audit';
import type { ModuleActivityItem } from '../components/module-activity-card';
import type { ModuleSummaryMetric } from '../components/module-summary-card';
import { ModuleProvider } from '../module-context';
import { getModuleDefinition } from '../module-registry';
import {
  FRAMEWORK_MODULE_IDS,
  moduleLayout,
  moduleNeutrals,
  type FrameworkModuleId,
} from '../module-tokens';
import { useModuleMetrics } from '../use-module-metrics';

/**
 * The Module Gallery — a development route, not a product screen.
 *
 * It renders every shared component in every module's theme, plus all six states, on
 * one scrollable page. That is the only practical way to review the framework: seven
 * themes across eighteen components is well over a hundred combinations, and checking
 * them by navigating the app would take as many screenshots.
 *
 * It is also where the contrast work gets verified by eye rather than only by
 * arithmetic. Switching to Finance — the palette whose raw primary fails white text
 * worst, at 2.64:1 — should still show readable labels everywhere, because every text
 * and fill role uses a derived variant instead of that primary.
 *
 * ── Why it is reachable in development only ─────────────────────────────────
 * The route file guards on `__DEV__`. This is scaffolding with no product purpose, and
 * shipping it would put an unfinished-looking screen one deep link from a real user.
 *
 * `ModuleText` needs only window metrics, not a module, so the chrome above the
 * switcher can use the same type ramp as the themed content below it.
 */
export function ModuleGalleryScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [moduleId, setModuleId] = useState<FrameworkModuleId>('faith');

  return (
    <View style={[styles.root, { paddingTop: insets.top }]} testID="module-gallery">
      <View style={styles.titleBar}>
        <ModuleText token="sectionTitle" numberOfLines={1} style={styles.flexText}>
          Module Gallery
        </ModuleText>
        <PressableScale
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Close the gallery"
          testID="module-gallery-close"
        >
          <ModuleText token="sectionAction" color={moduleNeutrals.info}>
            Close
          </ModuleText>
        </PressableScale>
      </View>
      <View style={styles.subtitleBar}>
        <ModuleText token="caption" color={moduleNeutrals.textTertiary}>
          Development only. Every shared component, in each module’s theme.
        </ModuleText>
      </View>

      {/* The switcher sits outside the provider, because it chooses what to provide. */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        // Without this the switcher claims a share of the column's flex space and the
        // tabs float in the middle of a tall empty band. A ScrollView is greedy by
        // default; a horizontal one used as a toolbar has to be told not to be.
        style={styles.switcherScroll}
        contentContainerStyle={styles.switcher}
      >
        {FRAMEWORK_MODULE_IDS.map((id) => {
          const definition = getModuleDefinition(id);
          const selected = id === moduleId;
          return (
            <PressableScale
              key={id}
              onPress={() => setModuleId(id)}
              accessibilityRole="tab"
              accessibilityLabel={`Show the ${definition.name} theme`}
              accessibilityState={{ selected }}
              style={[
                styles.tab,
                {
                  backgroundColor: selected ? definition.theme.fill : moduleNeutrals.surface,
                  borderColor: selected ? definition.theme.fill : moduleNeutrals.border,
                },
              ]}
              testID={`module-gallery-tab-${id}`}
            >
              <ModuleText
                token="sectionAction"
                color={selected ? definition.theme.onFill : moduleNeutrals.textSecondary}
                numberOfLines={1}
              >
                {definition.name}
              </ModuleText>
            </PressableScale>
          );
        })}
      </ScrollView>

      <ModuleProvider moduleId={moduleId}>
        <GalleryBody moduleId={moduleId} />
      </ModuleProvider>
    </View>
  );
}

/**
 * All seven heroes with their asset facts, on one page.
 *
 * This is the artwork lock's review surface: the seven hero cards in sequence, each
 * followed by the filename actually resolved, the rendered box, the theme colours, the
 * measured contrast ratios, and the `heroPictogram === pictogram` result. A reviewer can
 * confirm the lock from a single screenshot run instead of reading the registry.
 */
export function ModuleHeroAuditScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.root, { paddingTop: insets.top }]} testID="module-hero-audit">
      <View style={styles.titleBar}>
        <ModuleText token="sectionTitle" numberOfLines={1} style={styles.flexText}>
          Hero asset audit
        </ModuleText>
        <PressableScale
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Close the audit"
          testID="module-hero-audit-close"
        >
          <ModuleText token="sectionAction" color={moduleNeutrals.info}>
            Close
          </ModuleText>
        </PressableScale>
      </View>
      <View style={styles.subtitleBar}>
        <ModuleText token="caption" color={moduleNeutrals.textTertiary}>
          Development only. Every module hero uses the approved PNG that Main Home renders.
        </ModuleText>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 32 }}
        showsVerticalScrollIndicator={false}
        testID="module-hero-audit-scroll"
      >
        <View style={styles.auditList}>
          {FRAMEWORK_MODULE_IDS.map((id) => (
            <ModuleProvider key={id} moduleId={id}>
              <View style={styles.auditEntry}>
                <ModuleText
                  token="caption"
                  color={moduleNeutrals.textTertiary}
                  style={styles.sectionLabel}
                >
                  {getModuleDefinition(id).name.toUpperCase()}
                </ModuleText>
                <ModuleHeroCard testID={`audit-hero-${id}`} />
                <ModuleHeroAudit testID={`audit-facts-${id}`} />
              </View>
            </ModuleProvider>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

type Fixture = {
  readonly metrics: readonly ModuleSummaryMetric[];
  readonly activity: readonly ModuleActivityItem[];
  readonly insight: string;
};

/**
 * Component-review content for the gallery, and nowhere else.
 *
 * Every string names itself a sample. That is the point: the framework needs *something* rendered to
 * review overflow, truncation and alignment across seven themes, and the previous version used
 * plausible records — amounts, step counts, a person's name — which is exactly what made them unsafe
 * once the same table reached the product's own screens.
 */
const SAMPLE_FIXTURE: Fixture = {
  metrics: [
    { key: 'sample-a', label: 'Sample metric', value: '12', unit: 'units', icon: 'today' },
    {
      key: 'sample-b',
      label: 'Sample metric with a trend',
      value: '34%',
      icon: 'progress',
      trend: 'up',
      trendLabel: 'Sample trend sentence, long enough to wrap on a narrow screen',
    },
  ],
  activity: [
    {
      key: 'sample-done',
      title: 'Sample activity, done',
      meta: 'Sample detail',
      icon: 'today',
      status: 'done',
    },
    {
      key: 'sample-due',
      title: 'Sample activity, due',
      meta: 'Sample detail',
      icon: 'today',
      status: 'due',
    },
    {
      key: 'sample-upcoming',
      title: 'Sample activity, upcoming',
      meta: 'Sample detail',
      icon: 'today',
      status: 'upcoming',
    },
    {
      key: 'sample-missed',
      title: 'Sample activity with a long title that has to truncate somewhere sensible',
      meta: 'Sample detail',
      icon: 'today',
      status: 'missed',
    },
  ],
  insight:
    'Sample insight text, written at roughly the length a real one would be so the card can be reviewed for wrapping and height.',
};

/** The gallery's content, rendered inside the provider so each component themes itself. */
function GalleryBody({ moduleId }: { readonly moduleId: FrameworkModuleId }) {
  const { dp, pagePadding } = useModuleMetrics();
  const insets = useSafeAreaInsets();
  const definition = getModuleDefinition(moduleId);
  const [loaded, setLoaded] = useState<{ readonly key: string; readonly fixture: Fixture } | null>(
    null,
  );

  /*
    The gallery builds its own sample content rather than borrowing the product's.

    It used to read the mock repository's `populated` scenario, on the argument that the gallery
    should show "exactly the data the real screens do". That argument inverted: the real screens were
    showing the *gallery's* kind of data — invented totals and activity presented to a signed-in user
    as their own record (issue #23). The product fixtures are gone, so the sample lives here, in a
    `__DEV__`-only screen, and every value says out loud that it is a sample.

    Still tagged with the module id for the same reason `useModuleOverview` is: switching theme must
    re-render, and a key mismatch means "not loaded yet". The resolve stays asynchronous so the
    loading state remains reviewable.
  */
  useEffect(() => {
    let active = true;

    void Promise.resolve(SAMPLE_FIXTURE).then((sample) => {
      if (active) {
        setLoaded({ key: moduleId, fixture: sample });
      }
    });

    return () => {
      active = false;
    };
  }, [moduleId]);

  const fixture = loaded !== null && loaded.key === moduleId ? loaded.fixture : null;

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={{ paddingHorizontal: pagePadding, paddingBottom: insets.bottom + 32 }}
      showsVerticalScrollIndicator={false}
      testID="module-gallery-scroll"
    >
      <View style={{ rowGap: dp(moduleLayout.sectionGap) }}>
        <GallerySection label="Hero card">
          <ModuleHeroCard testID="gallery-hero" />
        </GallerySection>

        <GallerySection label="Quick actions">
          <ModuleQuickActionRow onSelect={() => undefined} testID="gallery-quick" />
        </GallerySection>

        <GallerySection label="Summary card">
          {fixture === null ? (
            <ModuleLoadingState rows={1} />
          ) : (
            <ModuleSummaryCard metrics={fixture.metrics} testID="gallery-summary" />
          )}
        </GallerySection>

        <GallerySection label="Activity card — all four statuses">
          {fixture === null ? null : (
            <ModuleActivityCard items={fixture.activity} testID="gallery-activity" />
          )}
        </GallerySection>

        <GallerySection label="Insight card">
          {fixture === null ? null : (
            <ModuleInsightCard
              message={fixture.insight}
              onPress={() => undefined}
              testID="gallery-insight"
            />
          )}
        </GallerySection>

        <GallerySection label="Feature grid — includes unavailable tiles">
          <ModuleFeatureGrid onSelect={() => undefined} testID="gallery-features" />
        </GallerySection>

        <GallerySection label="Section — tinted variant">
          <ModuleSection
            title="Tinted section"
            subtitle="One per screen at most."
            actionLabel="See all"
            onAction={() => undefined}
            tinted
            testID="gallery-tinted"
          >
            <ModuleText token="body">
              A tinted section groups related rows without introducing a second card border.
            </ModuleText>
          </ModuleSection>
        </GallerySection>

        <GallerySection label="Status banners — four tones">
          <View style={{ rowGap: dp(8) }}>
            <ModuleStatusBanner tone="info" message="Your data was last synced a moment ago." />
            <ModuleStatusBanner
              tone="success"
              message="Saved. Everyone in your family can see it."
            />
            <ModuleStatusBanner
              tone="warning"
              message="You are close to this month’s budget."
              actionLabel="Review"
              onAction={() => undefined}
            />
            <ModuleStatusBanner
              tone="error"
              message="Couldn’t sync just now."
              actionLabel="Retry"
              onAction={() => undefined}
              onDismiss={() => undefined}
            />
          </View>
        </GallerySection>

        <GallerySection label="Loading state — skeletons, reduced-motion aware">
          <ModuleLoadingState rows={2} testID="gallery-loading" />
        </GallerySection>

        <GallerySection label="Empty state">
          <ModuleEmptyState onAction={() => undefined} testID="gallery-empty" />
        </GallerySection>

        <GallerySection label="Error state">
          <ModuleErrorState onRetry={() => undefined} testID="gallery-error" />
        </GallerySection>

        <GallerySection label="Offline state">
          <ModuleOfflineState onRetry={() => undefined} testID="gallery-offline" />
        </GallerySection>

        {/* Every module declares at least one permission today, but the registry type
            allows none — so this renders only when there is one to show, rather than
            asserting the array is non-empty. */}
        {definition.permissions.length === 0 ? null : (
          <GallerySection label="Permission state">
            <ModulePermissionState
              permission={definition.permissions[0]!}
              onGrant={() => undefined}
              onSkip={() => undefined}
              testID="gallery-permission"
            />
          </GallerySection>
        )}

        <GallerySection label={`AI policy — ${definition.ai.label}`}>
          <View style={{ rowGap: dp(6) }}>
            <ModuleText token="body">{definition.ai.tagline}</ModuleText>
            {definition.ai.standingDisclaimer === undefined ? null : (
              <ModuleStatusBanner tone="warning" message={definition.ai.standingDisclaimer} />
            )}
            <ModuleText token="caption">{definition.ai.outOfScopeMessage}</ModuleText>
          </View>
        </GallerySection>
      </View>
    </ScrollView>
  );
}

function GallerySection({
  label,
  children,
}: {
  readonly label: string;
  readonly children: ReactNode;
}) {
  const { dp } = useModuleMetrics();
  return (
    <View style={{ rowGap: dp(6) }}>
      <ModuleText token="caption" color={moduleNeutrals.textTertiary} style={styles.sectionLabel}>
        {label.toUpperCase()}
      </ModuleText>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: moduleNeutrals.pageBackground,
  },
  titleBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  subtitleBar: {
    paddingHorizontal: 16,
    paddingBottom: 10,
  },
  flexText: {
    flex: 1,
    minWidth: 0,
  },
  switcherScroll: {
    flexGrow: 0,
    flexShrink: 0,
  },
  switcher: {
    paddingHorizontal: 16,
    paddingBottom: 10,
    columnGap: 6,
    // A horizontal ScrollView stretches its children to the full content height by
    // default, which turned these pills into full-height columns. Centring makes each
    // tab size to its own label.
    alignItems: 'center',
  },
  tab: {
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
  },
  scroll: {
    flex: 1,
  },
  sectionLabel: {
    letterSpacing: 0.6,
  },
  auditList: {
    rowGap: 22,
  },
  auditEntry: {
    rowGap: 6,
  },
});
