import { useRouter, type Href } from 'expo-router';
import { Image, StyleSheet, View } from 'react-native';

import { AppIcon, PressableScale } from '@ds/components';
import { fontFamilies } from '@ds/tokens';
import { minimumHitSlop, statusLabel } from '@shared/utils/a11y';

import { faithRoutes } from '@features/faith/faith-routes';
import { faithSubmenu } from '@features/faith/faith-submenu-assets';

import { ModuleAIInsightCard } from '../components/module-ai-insight-card';
import { ModuleCard, ModuleCardHeading, ModuleTwoColumn } from '../components/module-card';
import { ModuleProgressBar } from '../components/module-chart';
import { ModuleText } from '../components/module-text';
import { useModule } from '../module-context';
import { moduleLayout, moduleNeutrals } from '../module-tokens';
import { useModuleMetrics } from '../use-module-metrics';
import { FaithHero } from './faith-hero';
import { faithHomeFixture, type WorshipItem, type WorshipStatus } from './faith-view-model';

/** Gold, from the approved reference's line-art icons. */
const GOLD_ICON = '#B98A2E';

/**
 * Faith's home screen, composed to `03-faith.png`.
 *
 * ── Why this is a module-specific composition ───────────────────────────────
 * The generic framework layout — hero, three quick actions, "At a glance", a "Today"
 * list, an AI card — is not what the approved reference shows, and no amount of tuning
 * gets there: Faith has eight feature cards, a Continue-Quran card, a two-column
 * Ayah/Worship row and two compact date cards, none of which the generic sections model.
 *
 * So the *shell* stays shared (scaffold, header, navigation, card, text, tokens) and the
 * *composition* is Faith's own. That is the correction: one framework, seven
 * compositions, rather than one layout wearing seven colours.
 *
 * Section order below is the reference's order, top to bottom, and the ordering test
 * asserts it against this list rather than against a snapshot.
 */
export function FaithHomeContent() {
  const router = useRouter();
  const module = useModule();
  const { dp } = useModuleMetrics();
  const model = faithHomeFixture;

  const gap = dp(moduleLayout.sectionGap);
  /**
   * Every control resolves to a real, built destination.
   *
   * `comingSoon` is gone from this screen. It existed while the Faith routes did not, and
   * routing a live control to a placeholder was the honest choice then. Now that all
   * seventeen Faith routes exist, a placeholder here would be hiding a working screen.
   */
  const go = (href: Href) => () => router.push(href);

  return (
    <View style={{ rowGap: gap }}>
      <FaithHero onViewPrayerTimes={go(faithRoutes.prayerTimes)} testID="faith-hero" />

      <FaithFeatureGrid />

      {/* ── Continue Quran ───────────────────────────────────────────────── */}
      <ModuleCard testID="faith-continue">
        <View style={[styles.row, { columnGap: dp(11) }]}>
          <AppIcon name="quran" size={dp(30)} color={module.theme.ink} />
          <View style={styles.flex}>
            <ModuleText token="cardTitle" numberOfLines={1}>
              {model.continueQuran.title}
            </ModuleText>
            <ModuleText token="caption" numberOfLines={1}>
              {model.continueQuran.detail}
            </ModuleText>
            <View style={{ marginTop: dp(7) }}>
              <ModuleProgressBar
                value={model.continueQuran.progress}
                accessibilityLabel={`${model.continueQuran.detail}, reading progress`}
                testID="faith-continue-progress"
              />
            </View>
          </View>
          <PressableScale
            onPress={go(faithRoutes.reader)}
            accessibilityRole="button"
            accessibilityLabel={`Resume ${model.continueQuran.detail}`}
            style={[
              styles.playButton,
              {
                width: dp(moduleLayout.minTouchTarget),
                height: dp(moduleLayout.minTouchTarget),
                borderRadius: dp(moduleLayout.minTouchTarget) / 2,
                borderColor: module.theme.border,
              },
            ]}
            testID="faith-continue-play"
          >
            <AppIcon name="play" size={dp(18)} color={module.theme.ink} />
          </PressableScale>
        </View>
      </ModuleCard>

      {/* ── Daily Ayah | Today's Worship ─────────────────────────────────── */}
      <ModuleTwoColumn
        testID="faith-ayah-worship"
        left={
          <ModuleCard
            onPress={go(faithRoutes.dailyAyah)}
            accessibilityLabel={`${model.dailyAyah.title}. ${model.dailyAyah.translation} ${model.dailyAyah.reference}`}
            padding={moduleLayout.twoColumnPadding}
            style={styles.fillHeight}
            testID="faith-ayah"
          >
            <ModuleText token="cardTitle" numberOfLines={1}>
              {model.dailyAyah.title}
            </ModuleText>
            {/*
              The ayah is rendered right-to-left by this one node — `writingDirection` and
              a right alignment — rather than by putting the app into RTL. Faith needs
              Arabic to read correctly without flipping every other screen's layout.
            */}
            <ModuleText
              token="arabic"
              align="right"
              numberOfLines={2}
              style={[styles.arabic, { marginTop: dp(8) }]}
              accessibilityLanguage="ar"
            >
              {model.dailyAyah.arabic}
            </ModuleText>
            <ModuleText token="body" numberOfLines={3} style={{ marginTop: dp(6) }}>
              {model.dailyAyah.translation}
            </ModuleText>
            <View style={[styles.ayahFooter, { marginTop: dp(6) }]}>
              <ModuleText token="caption" numberOfLines={1} style={styles.flex}>
                {model.dailyAyah.reference}
              </ModuleText>
              <PressableScale
                onPress={go(faithRoutes.dailyAyah)}
                accessibilityRole="button"
                accessibilityLabel={`Open ${model.dailyAyah.reference} in full`}
                hitSlop={minimumHitSlop(dp(18))}
                testID="faith-ayah-share"
              >
                <AppIcon name="share" size={dp(17)} color={moduleNeutrals.textSecondary} />
              </PressableScale>
            </View>
          </ModuleCard>
        }
        right={
          <ModuleCard
            padding={moduleLayout.twoColumnPadding}
            style={styles.fillHeight}
            testID="faith-worship"
          >
            <ModuleCardHeading
              title={model.worship.title}
              actionLabel="View All"
              onAction={go(faithRoutes.worship)}
              testID="faith-worship-viewall"
            />
            <View style={{ rowGap: dp(7) }}>
              {model.worship.items.map((item) => (
                <WorshipRow key={item.key} item={item} />
              ))}
            </View>
          </ModuleCard>
        }
      />

      {/* ── Upcoming | Islamic Calendar ──────────────────────────────────── */}
      <ModuleTwoColumn
        testID="faith-dates"
        left={
          <CompactDateCard
            icon="crescent"
            iconColor={GOLD_ICON}
            eyebrow={model.upcoming.eyebrow}
            title={model.upcoming.title}
            detail={model.upcoming.detail}
            onPress={go(faithRoutes.events)}
            testID="faith-upcoming"
          />
        }
        right={
          <CompactDateCard
            icon="calendar"
            iconColor={module.theme.ink}
            eyebrow={model.islamicCalendar.eyebrow}
            title={model.islamicCalendar.title}
            detail={model.islamicCalendar.detail}
            onPress={go(faithRoutes.calendar)}
            testID="faith-calendar"
          />
        }
      />

      {/*
        ── Faith AI Insight ───────────────────────────────────────────────
        The shared card, at Main Home's exact geometry. It replaced a taller banner
        that carried the narration's source in a pill — that pill was what made Faith's
        card the tallest in the app. The source is not lost: it is shown on the Faith AI
        screen, beside the full narration, which is where a reader can actually act on it.
      */}
      <ModuleAIInsightCard
        message={model.insight.body}
        onPress={go(module.routes.ai)}
        testID="faith-insight"
      />
    </View>
  );
}

/**
 * The eight approved submenu tiles: two rows of four, in the reference's order.
 *
 * ── Approved PNG pictograms, not icon-font glyphs ───────────────────────────
 * The eight marks come from `faithSubmenu`, which holds a literal `require` per tile.
 * They were `AppIcon` glyphs tinted gold or green; the approved set replaces that. There
 * is no fallback path — `source` is required by the entry type, so a tile without its PNG
 * cannot be constructed.
 *
 * ── The rendering rules, and where each one lives ───────────────────────────
 *   • `contain`, so a pictogram is never cropped or stretched     → `resizeMode`
 *   • no tint                                                     → no `tintColor` prop
 *   • no background, no border, no second icon well               → the `Image` has no
 *     wrapper of its own; the tile surface is the only container
 *   • identical image box for all eight                           → one `imageBox` value
 *   • consistent baseline                                         → fixed box + `contain`
 *   • ≥44 dp touch target                                         → `minHeight` on the tile
 *
 * ── Sizing ──────────────────────────────────────────────────────────────────
 * A 40 dp image box inside a 74 dp tile. The previous build drew a 27 dp glyph in a 48 dp
 * tile, which left the large empty band the brief calls out. 40 dp fills the tile's upper
 * area while leaving room for the label at 11 dp without wrapping.
 */
function FaithFeatureGrid() {
  const router = useRouter();
  const { dp, contentWidth } = useModuleMetrics();

  const gap = dp(moduleLayout.featureGap);
  // Fractional width: flooring four columns is what left a sliver down Main Home's grid.
  const tileWidth = (contentWidth - gap * 3) / 4;
  const imageBox = dp(moduleLayout.faithSubmenuImage);

  return (
    <View style={[styles.grid, { columnGap: gap, rowGap: gap }]} testID="faith-features">
      {faithSubmenu.map((entry) => (
        <PressableScale
          key={entry.key}
          onPress={() => router.push(entry.href)}
          accessibilityRole="button"
          accessibilityLabel={entry.accessibilityLabel}
          style={[
            styles.tile,
            {
              width: tileWidth,
              height: dp(moduleLayout.faithSubmenuTileHeight),
              minHeight: dp(moduleLayout.minTouchTarget),
              borderRadius: dp(moduleLayout.radiusSmall),
              rowGap: dp(3),
            },
          ]}
          testID={`faith-feature-${entry.key}`}
        >
          {/*
            No wrapper view, no tint, no background. The tile's own surface is the only
            container the pictogram sits on.
          */}
          <Image
            source={entry.source}
            style={{ width: imageBox, height: imageBox }}
            resizeMode="contain"
            accessible={false}
            testID={`faith-feature-${entry.key}-image`}
          />
          <ModuleText
            token="tileLabel"
            align="center"
            numberOfLines={1}
            maxFontSizeMultiplier={1.25}
            style={styles.stretch}
          >
            {entry.label}
          </ModuleText>
        </PressableScale>
      ))}
    </View>
  );
}

/** Status is carried by an icon shape *and* a word, never by colour alone. */
function WorshipRow({ item }: { readonly item: WorshipItem }) {
  const module = useModule();
  const { dp } = useModuleMetrics();

  const SPOKEN: Readonly<Record<WorshipStatus, string>> = {
    completed: 'Completed',
    current: 'Current prayer',
    upcoming: 'Upcoming',
  };

  const size = dp(16);

  return (
    <View
      style={[styles.worshipRow, { columnGap: dp(8), minHeight: dp(20) }]}
      accessible
      accessibilityLabel={statusLabel(`${item.label}, ${item.detail}`, SPOKEN[item.status])}
      testID={`faith-worship-${item.key}`}
    >
      {item.status === 'completed' ? (
        <AppIcon name="check-circle" size={size} color={module.theme.ink} />
      ) : item.status === 'current' ? (
        // A filled disc, as the reference draws the current prayer.
        <View
          style={{
            width: size * 0.72,
            height: size * 0.72,
            borderRadius: size,
            backgroundColor: module.theme.ink,
            marginHorizontal: size * 0.14,
          }}
        />
      ) : (
        <View
          style={{
            width: size * 0.72,
            height: size * 0.72,
            borderRadius: size,
            borderWidth: 1.5,
            borderColor: moduleNeutrals.border,
            marginHorizontal: size * 0.14,
          }}
        />
      )}
      <ModuleText token="rowLabel" numberOfLines={1} style={styles.flex}>
        {item.label}
      </ModuleText>
      <ModuleText token="rowMeta" numberOfLines={1}>
        {item.detail}
      </ModuleText>
    </View>
  );
}

function CompactDateCard({
  icon,
  iconColor,
  eyebrow,
  title,
  detail,
  onPress,
  testID,
}: {
  readonly icon: 'crescent' | 'calendar';
  readonly iconColor: string;
  readonly eyebrow: string;
  readonly title: string;
  readonly detail: string;
  readonly onPress: () => void;
  readonly testID: string;
}) {
  const { dp } = useModuleMetrics();

  return (
    <ModuleCard
      onPress={onPress}
      accessibilityLabel={`${eyebrow}. ${title}. ${detail}`}
      padding={moduleLayout.twoColumnPadding}
      style={styles.fillHeight}
      testID={testID}
    >
      <View style={[styles.row, { columnGap: dp(8) }]}>
        <AppIcon name={icon} size={dp(24)} color={iconColor} />
        <View style={styles.flex}>
          <ModuleText token="rowMeta" numberOfLines={1}>
            {eyebrow}
          </ModuleText>
          <ModuleText token="rowLabel" numberOfLines={2}>
            {title}
          </ModuleText>
          <ModuleText token="rowMeta" numberOfLines={1}>
            {detail}
          </ModuleText>
        </View>
        <AppIcon name="chevron-forward" size={dp(16)} color={moduleNeutrals.textTertiary} />
      </View>
    </ModuleCard>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  flex: {
    flex: 1,
    minWidth: 0,
  },
  stretch: {
    alignSelf: 'stretch',
  },
  fillHeight: {
    flex: 1,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  tile: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: moduleNeutrals.surface,
    borderWidth: 1,
    borderColor: moduleNeutrals.border,
    paddingHorizontal: 2,
  },
  playButton: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    backgroundColor: moduleNeutrals.surface,
  },
  arabic: {
    // Renders this node right-to-left without switching the app's direction.
    writingDirection: 'rtl',
    fontFamily: fontFamilies.regular,
  },
  ayahFooter: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  worshipRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
});
