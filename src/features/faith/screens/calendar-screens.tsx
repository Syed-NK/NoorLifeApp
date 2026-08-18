import { useCallback } from 'react';
import { View } from 'react-native';

import { ModuleStatusBanner, ModuleText } from '@features/modules/components';
import { ModuleCard } from '@features/modules/components/module-card';
import { moduleLayout } from '@features/modules/module-tokens';
import { useModuleMetrics } from '@features/modules/use-module-metrics';

import { FaithRow, FaithRowGroup } from '../components/faith-list';
import { FaithIdentity } from '../components/faith-identity';
import { FaithResourceView, FaithScreen } from '../components/faith-screen';
import { useFaithRepositories } from '../di/faith-repository-context';
import { faithNavKeys } from '../faith-routes';
import { useFaithResource } from '../hooks/use-faith-resource';

/**
 * The Hijri calendar and the observances screen.
 *
 * ── "Expected", not "confirmed" ─────────────────────────────────────────────
 * Every calculated date is labelled expected, because moon sighting decides the real one
 * and it differs by region. The `HijriDate.basis` field carries that distinction from the
 * repository, and both screens render it — an app that printed "Ramadan begins 1 March"
 * as settled fact would be asserting something it cannot know.
 */

export function CalendarScreen() {
  const { dp } = useModuleMetrics();
  const { calendar } = useFaithRepositories();

  const today = useFaithResource(
    'faith.calendar.today',
    useCallback(() => calendar.getToday(), [calendar]),
  );

  const month = useFaithResource(
    'faith.calendar.month',
    useCallback(() => calendar.getMonth(1446, 11), [calendar]),
  );

  return (
    <FaithScreen title="Islamic Calendar" activeKey={faithNavKeys.more} testID="faith-calendar">
      <View style={{ rowGap: dp(moduleLayout.sectionGap) }}>
        <FaithIdentity submenu="calendar" summary="Hijri dates alongside the Gregorian calendar." />

        <ModuleStatusBanner
          tone="info"
          message="Dates are calculated. Your local authority’s moon sighting takes precedence."
          testID="faith-calendar-banner"
        />

        <FaithResourceView
          resource={today}
          empty={{ title: 'No date', body: 'Today’s Hijri date could not be resolved.' }}
          loadingRows={1}
          testID="faith-calendar-today"
        >
          {(value) => (
            <ModuleCard testID="faith-calendar-today-card">
              <ModuleText token="caption" numberOfLines={1}>
                Today
              </ModuleText>
              <ModuleText token="cardTitle" numberOfLines={2}>
                {value.hijri.formatted}
              </ModuleText>
              <ModuleText token="caption" numberOfLines={1}>
                {`${value.gregorian} • ${value.hijri.basis === 'calculated' ? 'Calculated' : 'Confirmed by sighting'}`}
              </ModuleText>
            </ModuleCard>
          )}
        </FaithResourceView>

        <FaithResourceView
          resource={month}
          empty={{ title: 'No month data', body: 'This month could not be loaded.' }}
          loadingRows={5}
          testID="faith-calendar-month"
        >
          {(value) => (
            <FaithRowGroup
              title={`${value.monthName} ${value.hijriYear} AH`}
              testID="faith-calendar-days"
            >
              {value.days.slice(0, 30).map((entry) => (
                <FaithRow
                  key={entry.hijri.day}
                  title={`${entry.hijri.day} ${entry.hijri.monthName}`}
                  subtitle={entry.gregorian}
                  icon="calendar"
                  accessibilityLabel={`${entry.hijri.formatted}, ${entry.gregorian}`}
                  testID={`faith-calendar-day-${entry.hijri.day}`}
                />
              ))}
            </FaithRowGroup>
          )}
        </FaithResourceView>
      </View>
    </FaithScreen>
  );
}

/** Upcoming observances — reached from the home screen's "Upcoming" card. */
export function EventsScreen() {
  const { dp } = useModuleMetrics();
  const { calendar } = useFaithRepositories();

  const observances = useFaithResource(
    'faith.observances',
    useCallback(() => calendar.listUpcomingObservances(10), [calendar]),
  );

  return (
    <FaithScreen title="Upcoming" activeKey={faithNavKeys.more} testID="faith-events">
      <View style={{ rowGap: dp(moduleLayout.sectionGap) }}>
        <ModuleStatusBanner
          tone="info"
          message="Expected dates, calculated in advance. Local moon sighting decides the day."
          testID="faith-events-banner"
        />

        <FaithResourceView
          resource={observances}
          empty={{ title: 'Nothing upcoming', body: 'No observances are scheduled.' }}
          loadingRows={4}
          testID="faith-events-body"
        >
          {(list) => (
            <View style={{ rowGap: dp(moduleLayout.cardGap) }}>
              {list.map((item) => (
                <ModuleCard key={item.id} testID={`faith-event-${item.id}`}>
                  <View style={{ rowGap: dp(4) }}>
                    <ModuleText token="caption" numberOfLines={1}>
                      {item.daysUntil >= 0 ? `In ${item.daysUntil} days` : 'Past'}
                    </ModuleText>
                    <ModuleText token="cardTitle" numberOfLines={2}>
                      {item.name}
                    </ModuleText>
                    <ModuleText token="caption" numberOfLines={2}>
                      {`${item.hijri.formatted} • expected ${item.gregorian}`}
                    </ModuleText>
                    <ModuleText token="body" numberOfLines={3}>
                      {item.description}
                    </ModuleText>
                  </View>
                </ModuleCard>
              ))}
            </View>
          )}
        </FaithResourceView>
      </View>
    </FaithScreen>
  );
}
