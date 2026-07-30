import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { AppIcon, PressableScale } from '@ds/components';

import { ModuleCard, ModuleCardHeading, ModuleTwoColumn } from '../components/module-card';
import { ModuleLineChart } from '../components/module-chart';
import { ModuleInsightBanner } from '../components/module-insight-banner';
import { ModuleText } from '../components/module-text';
import { useModule } from '../module-context';
import { comingSoon } from '../module-routes';
import { moduleLayout, moduleNeutrals } from '../module-tokens';
import { useModuleMetrics } from '../use-module-metrics';
import { HealthHero } from './health-hero';
import { healthHomeFixture } from './health-view-model';

/** The reference's own accents, alongside the module theme. */
const TONE = {
  teal: '#0E9F8A',
  navy: '#2A3A6B',
  green: '#1B9E4B',
  red: '#D64535',
  grey: '#6B7896',
} as const;

/**
 * Health's home screen, composed to `04-health.png`.
 *
 * A module-specific composition for the same reason Faith has one: the approved reference
 * contains four metric cards, two different two-column rows and a Quick Log card, and the
 * generic framework sections model none of them. The shell — scaffold, header, navigation,
 * card, text, tokens — stays shared.
 */
export function HealthHomeContent() {
  const router = useRouter();
  const module = useModule();
  const { dp } = useModuleMetrics();
  const model = healthHomeFixture;

  const soon = (label: string) => () => router.push(comingSoon('health', label));
  const tone = (key: 'theme' | 'teal' | 'navy' | 'green' | 'red' | 'grey'): string =>
    key === 'theme' ? module.theme.ink : TONE[key];

  return (
    <View style={{ rowGap: dp(moduleLayout.sectionGap) }}>
      <HealthHero
        model={model.wellness}
        onViewInsights={() => router.push('/health/trends')}
        testID="health-hero"
      />

      {/* ── Four wellness metrics ────────────────────────────────────────── */}
      <View style={[styles.metricRow, { columnGap: dp(9) }]} testID="health-metrics">
        {model.metrics.map((metric) => (
          <PressableScale
            key={metric.key}
            onPress={soon(`${metric.label} detail`)}
            accessibilityRole="button"
            accessibilityLabel={`${metric.label}, ${metric.value}`}
            style={[
              styles.metricCard,
              {
                minHeight: dp(moduleLayout.healthMetricHeight),
                borderRadius: dp(moduleLayout.radiusSmall),
                paddingHorizontal: dp(6),
                paddingVertical: dp(5),
                columnGap: dp(4),
              },
            ]}
            testID={`health-metric-${metric.key}`}
          >
            <AppIcon
              name={metric.icon}
              size={dp(moduleLayout.healthMetricIcon)}
              color={tone(metric.tone)}
            />
            <View style={styles.flex}>
              <ModuleText token="metricValue" numberOfLines={1} maxFontSizeMultiplier={1.2}>
                {metric.value}
              </ModuleText>
              <ModuleText token="rowMeta" numberOfLines={1} maxFontSizeMultiplier={1.2}>
                {metric.label}
              </ModuleText>
            </View>
          </PressableScale>
        ))}
      </View>

      {/* ── Medication Reminder | Today's Focus ──────────────────────────── */}
      <ModuleTwoColumn
        testID="health-medication-focus"
        left={
          <ModuleCard
            onPress={soon('Medication reminders')}
            accessibilityLabel={`${model.medication.title}. ${model.medication.name}, ${model.medication.time}, ${model.medication.statusLabel}`}
            padding={moduleLayout.twoColumnPadding}
            style={styles.fillHeight}
            testID="health-medication"
          >
            <View style={[styles.row, { columnGap: dp(6) }]}>
              <AppIcon name="medication" size={dp(20)} color={TONE.green} />
              <ModuleText token="cardHeading" numberOfLines={2} style={styles.flex}>
                {model.medication.title}
              </ModuleText>
            </View>
            <ModuleText token="rowLabel" numberOfLines={1} style={{ marginTop: dp(6) }}>
              {model.medication.name}
            </ModuleText>
            <View style={[styles.pillStack, { rowGap: dp(6), marginTop: dp(7) }]}>
              <StatusPill label={model.medication.time} />
              <StatusPill label={model.medication.statusLabel} icon="check-circle" />
            </View>
          </ModuleCard>
        }
        right={
          <ModuleCard padding={moduleLayout.twoColumnPadding} style={styles.fillHeight} testID="health-focus">
            <ModuleCardHeading title={model.focus.title} />
            <View style={{ rowGap: dp(7) }}>
              {model.focus.items.map((item, index) => (
                <View key={item.key}>
                  {index === 0 ? null : (
                    <View style={[styles.divider, { marginBottom: dp(7) }]} accessible={false} />
                  )}
                  <PressableScale
                    onPress={soon(item.title)}
                    accessibilityRole="button"
                    accessibilityLabel={`${item.title}. ${item.detail}`}
                    style={[
                      styles.row,
                      { columnGap: dp(6), minHeight: dp(moduleLayout.minTouchTarget * 0.72) },
                    ]}
                    testID={`health-focus-${item.key}`}
                  >
                    {item.tiled ? (
                      <View
                        style={{
                          width: dp(26),
                          height: dp(26),
                          borderRadius: dp(8),
                          backgroundColor: module.theme.lightSurface,
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        <AppIcon name={item.icon} size={dp(17)} color={TONE.green} />
                      </View>
                    ) : (
                      <View style={styles.bareIcon}>
                        <AppIcon name={item.icon} size={dp(21)} color={module.theme.ink} />
                      </View>
                    )}
                    <View style={styles.flex}>
                      <ModuleText token="rowLabel" numberOfLines={1}>
                        {item.title}
                      </ModuleText>
                      <ModuleText token="rowMeta" numberOfLines={1}>
                        {item.detail}
                      </ModuleText>
                    </View>
                    <AppIcon
                      name="chevron-forward"
                      size={dp(13)}
                      color={moduleNeutrals.textTertiary}
                    />
                  </PressableScale>
                </View>
              ))}
            </View>
          </ModuleCard>
        }
      />

      {/* ── Weekly Trend | Recent Activity ───────────────────────────────── */}
      <ModuleTwoColumn
        testID="health-trend-activity"
        left={
          <ModuleCard
            onPress={() => router.push('/health/trends')}
            accessibilityLabel={`${model.weeklyTrend.title}. ${model.weeklyTrend.summary}`}
            padding={moduleLayout.twoColumnPadding}
            style={styles.fillHeight}
            testID="health-trend"
          >
            <ModuleText token="cardHeading" numberOfLines={1} accessibilityRole="header">
              {model.weeklyTrend.title}
            </ModuleText>
            <ModuleText
              token="rowMeta"
              color={module.theme.ink}
              numberOfLines={2}
              style={{ marginBottom: dp(6) }}
            >
              {model.weeklyTrend.summary}
            </ModuleText>
            <ModuleLineChart
              values={model.weeklyTrend.values}
              labels={model.weeklyTrend.labels}
              accessibilityLabel={`Seven day activity chart. ${model.weeklyTrend.summary}`}
              testID="health-trend-chart"
            />
          </ModuleCard>
        }
        right={
          <ModuleCard padding={moduleLayout.twoColumnPadding} style={styles.fillHeight} testID="health-activity">
            <ModuleCardHeading
              title={model.recentActivity.title}
              actionLabel="View All"
              onAction={() => router.push('/health/records')}
              testID="health-activity-viewall"
            />
            <View style={{ rowGap: dp(7) }}>
              {model.recentActivity.items.map((item) => (
                <View
                  key={item.key}
                  style={[styles.row, { columnGap: dp(6) }]}
                  accessible
                  accessibilityLabel={`${item.title}, ${item.detail}, ${item.time}`}
                  testID={`health-activity-${item.key}`}
                >
                  <AppIcon name={item.icon} size={dp(18)} color={tone(item.tone)} />
                  <View style={styles.flex}>
                    <ModuleText token="rowLabel" numberOfLines={1}>
                      {item.title}
                    </ModuleText>
                    <ModuleText token="rowMeta" numberOfLines={1}>
                      {item.detail}
                    </ModuleText>
                  </View>
                  <ModuleText token="rowMeta" numberOfLines={1}>
                    {item.time}
                  </ModuleText>
                </View>
              ))}
            </View>
          </ModuleCard>
        }
      />

      {/* ── Quick Log ────────────────────────────────────────────────────── */}
      <ModuleCard testID="health-quick-log">
        <ModuleText
          token="sectionTitle"
          numberOfLines={1}
          accessibilityRole="header"
          style={{ marginBottom: dp(8) }}
        >
          {model.quickLog.title}
        </ModuleText>
        <View style={[styles.quickRow, { columnGap: dp(8) }]}>
          {model.quickLog.actions.map((action) => (
            <PressableScale
              key={action.key}
              onPress={soon(`Log ${action.label}`)}
              accessibilityRole="button"
              accessibilityLabel={`Log ${action.label}`}
              style={[
                styles.quickCard,
                {
                  minHeight: dp(moduleLayout.quickLogHeight),
                  borderRadius: dp(moduleLayout.radiusSmall),
                  rowGap: dp(4),
                  paddingVertical: dp(7),
                },
              ]}
              testID={`health-quick-${action.key}`}
            >
              <AppIcon name={action.icon} size={dp(24)} color={tone(action.tone)} />
              <ModuleText
                token="tileLabel"
                align="center"
                numberOfLines={1}
                maxFontSizeMultiplier={1.2}
                style={styles.stretch}
              >
                {action.label}
              </ModuleText>
            </PressableScale>
          ))}
        </View>
      </ModuleCard>

      {/* ── Health AI Insight ────────────────────────────────────────────── */}
      <ModuleInsightBanner
        title={model.insight.title}
        body={model.insight.body}
        footnote={model.insight.disclaimer}
        footnoteStyle="plain"
        trailing="info"
        artworkTreatment="tile"
        onPress={() => router.push(module.routes.ai)}
        testID="health-insight"
      />
    </View>
  );
}

/** The pale pills the reference uses for the medication time and its taken state. */
function StatusPill({ label, icon }: { readonly label: string; readonly icon?: 'check-circle' }) {
  const { dp } = useModuleMetrics();
  return (
    <View
      style={[
        styles.statusPill,
        {
          borderRadius: dp(moduleLayout.radiusSmall),
          paddingHorizontal: dp(9),
          paddingVertical: dp(5),
          columnGap: dp(4),
        },
      ]}
    >
      {icon === undefined ? null : <AppIcon name={icon} size={dp(13)} color={TONE.green} />}
      <ModuleText token="caption" color={TONE.green} numberOfLines={1}>
        {label}
      </ModuleText>
    </View>
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
  metricRow: {
    flexDirection: 'row',
  },
  metricCard: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: moduleNeutrals.surface,
    borderWidth: 1,
    borderColor: moduleNeutrals.border,
  },
  pillStack: {
    alignItems: 'flex-end',
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#E8F7EE',
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: moduleNeutrals.divider,
  },
  bareIcon: {
    width: 26,
    alignItems: 'center',
  },
  quickRow: {
    flexDirection: 'row',
  },
  quickCard: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: moduleNeutrals.surface,
    borderWidth: 1,
    borderColor: moduleNeutrals.border,
    paddingHorizontal: 2,
  },
});
