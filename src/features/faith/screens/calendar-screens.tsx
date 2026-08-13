import { useCallback, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppIcon, PressableScale } from '@ds/components';
import { ModuleStatusBanner, ModuleText } from '@features/modules/components';
import { ModuleCard } from '@features/modules/components/module-card';
import { useModuleTheme } from '@features/modules/module-context';
import { moduleLayout, moduleNeutrals } from '@features/modules/module-tokens';
import { useModuleMetrics } from '@features/modules/use-module-metrics';
import { minimumHitSlop } from '@shared/utils/a11y';

import { FaithRow, FaithRowGroup } from '../components/faith-list';
import { HijriMonthGrid } from '../components/hijri-month-grid';
import { FaithSectionHero } from '../components/faith-section-hero';
import { FaithResourceView, FaithScreen } from '../components/faith-screen';
import { hasData, type FaithResult } from '../data/faith-result';
import type { CalendarMonth, LocationToday, Observance } from '../data/faith-calendar.repository';
import { useFaithRepositories } from '../di/faith-repository-context';
import { faithHeroImages } from '../faith-hero-images';
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

/** Steps a Hijri {year, month} by one month, wrapping the year at the twelve-month boundary. */
export function stepHijriMonth(
  at: { readonly year: number; readonly month: number },
  direction: 1 | -1,
): { readonly year: number; readonly month: number } {
  const raw = at.month + direction;
  if (raw < 1) {
    return { year: at.year - 1, month: 12 };
  }
  if (raw > 12) {
    return { year: at.year + 1, month: 1 };
  }
  return { year: at.year, month: raw };
}

export function CalendarScreen() {
  const { dp } = useModuleMetrics();
  const { calendar, prayerTimes } = useFaithRepositories();

  /**
   * Today, at the user's prayer location.
   *
   * ── This screen is location-scoped, not device-local, and that is the call ──
   * It could have gone the other way. A calendar is arguably about the user rather than about a
   * place, and the device's day would always be available — no permission, no unresolved state.
   *
   * It is location-scoped for two reasons. The first is that the dates on this screen are the *same
   * dates* as the ones on Faith Home and the Prayer screen: a user who sees "27 Safar" in the hero
   * and taps through to the calendar is looking at one fact, and two subsystems answering it
   * differently is the defect this work exists to remove, not a nuance to preserve. The second is
   * that what this screen is actually for is religious dates — when Ramadan begins, how many days
   * until Eid — and those are decided where the user is, by the same reasoning that decides a prayer
   * time.
   *
   * So the Faith module has exactly one meaning for "today", and there is no device-local variant of
   * it anywhere in the module — not on this interface and not beside it. Two "today"s under similar
   * names is what produced the original defect, and no naming convention survives a hurried call
   * site.
   *
   * The cost is stated plainly: with no location, this screen shows a location-required state
   * instead of a date. That is the honest trade, and it is the same state the Prayer and Qibla
   * screens show for the same reason.
   *
   * Month browsing and date conversion below need no today at all — they are zone-free arithmetic —
   * so they keep working regardless.
   */
  const today = useFaithResource(
    'faith.calendar.today',
    useCallback(async (): Promise<FaithResult<LocationToday>> => {
      const location = await prayerTimes.resolveCurrentLocation();
      return hasData(location) ? calendar.getLocationToday(location.data) : location;
    }, [prayerTimes, calendar]),
  );

  /**
   * Which month is on screen, and which day is open — `null` until today resolves.
   *
   * ── Why the browsed month is state and today is a resource ──────────────────
   * They answer different questions. Today is a fact the repository owns and re-derives; the
   * browsed month is a place the user navigated to, and it must survive today's resource
   * refreshing underneath it. Deriving the visible month from `today` every render is what would
   * snap the user back to this month whenever the screen refocused.
   */
  const [browsing, setBrowsing] = useState<{
    readonly year: number;
    readonly month: number;
  } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  /**
   * Today's date, once the resource has answered with one.
   *
   * `status` is checked before `result` because `UseFaithResource` has no `result` while loading —
   * the union is what makes "we do not know yet" distinct from "we asked and there is none".
   */
  const resolvedToday =
    today.status === 'loading' || !hasData(today.result) ? null : today.result.data;
  const todayGregorian = resolvedToday?.gregorian ?? null;
  /**
   * Memoised, because it feeds a `useCallback` that feeds a resource.
   *
   * Built inline, this is a fresh object literal on every render, so the month callback's identity
   * changed every render and the resource had to treat each one as a new request — a refetch loop
   * on a screen whose data never changed. The dependencies are the two numbers it is derived from,
   * not the objects holding them.
   */
  const todayHijriYear = resolvedToday?.hijri.year ?? null;
  const todayHijriMonth = resolvedToday?.hijri.month ?? null;
  const visible = useMemo(
    () =>
      browsing ??
      (todayHijriYear === null || todayHijriMonth === null
        ? null
        : { year: todayHijriYear, month: todayHijriMonth }),
    [browsing, todayHijriYear, todayHijriMonth],
  );

  /**
   * The month the user is actually in, not a month named in a design reference.
   *
   * This asked for Dhul-Qadah 1446 by literal, so the grid showed May 2025 for the rest of time.
   * The key carries the month, so stepping months refetches rather than redrawing stale days.
   */
  const month = useFaithResource(
    visible === null ? null : `faith.calendar.month.${visible.year}.${visible.month}`,
    useCallback(async (): Promise<FaithResult<CalendarMonth>> => {
      if (visible === null) {
        return { kind: 'empty' };
      }
      return calendar.getMonth(visible.year, visible.month);
    }, [calendar, visible]),
  );

  const observances = useFaithResource(
    'faith.calendar.upcoming',
    useCallback(async (): Promise<FaithResult<readonly Observance[]>> => {
      const location = await prayerTimes.resolveCurrentLocation();
      return hasData(location) ? calendar.listUpcomingObservances(location.data, 3) : location;
    }, [prayerTimes, calendar]),
  );

  return (
    <FaithScreen title="Islamic Calendar" activeKey={faithNavKeys.more} testID="faith-calendar">
      <View style={{ rowGap: dp(moduleLayout.sectionGap) }}>
        {/*
          ── No "View Calendar" action yet, and this is a deliberate gap ────────────
          The month grid is on this screen, immediately below. A button that pushed this route would
          navigate to where the user already is, and scrolling to the grid needs a scroll ref that
          `FaithScreen` does not currently expose — it owns the `ScrollView` internally.

          So the control is omitted rather than drawn non-functional. Threading a ref through
          `FaithScreen` is the fix and is recorded as outstanding, along with the same gap on Prayer and
          Tasbih.
        */}
        <FaithSectionHero
          submenu="calendar"
          heroImage={faithHeroImages.calendar}
          summary="Hijri dates alongside the Gregorian calendar."
        />

        <ModuleStatusBanner
          tone="info"
          message="Dates are calculated. Your local authority’s moon sighting takes precedence."
          testID="faith-calendar-banner"
        />

        {/*
          ── There is deliberately no separate "Today" card here ────────────────
          There was one, and once the grid gained a selected-day card beneath it the screen stated
          the same date twice within one viewport — "Today · 27 Safar 1448 AH · 2026-08-12" above
          the month, and again below it. The lower card already defaults to today when the user has
          chosen no other day, so it answers both questions with one card, and it is the one that
          stays correct when a different day is selected.
        */}
        <FaithResourceView
          resource={month}
          empty={{ title: 'No month data', body: 'This month could not be loaded.' }}
          loadingRows={5}
          testID="faith-calendar-month"
        >
          {(value) => {
            const chosen =
              value.days.find((entry) => entry.gregorian === selected) ??
              value.days.find((entry) => entry.gregorian === todayGregorian) ??
              null;

            return (
              <View style={{ rowGap: dp(moduleLayout.sectionGap) }}>
                <ModuleCard testID="faith-calendar-month-card">
                  <View style={[styles.monthHeader, { marginBottom: dp(10) }]}>
                    <MonthStep
                      direction={-1}
                      label="Previous month"
                      onPress={() => {
                        if (visible === null) return;
                        setSelected(null);
                        setBrowsing(stepHijriMonth(visible, -1));
                      }}
                      testID="faith-calendar-previous"
                    />
                    <ModuleText
                      token="cardTitle"
                      align="center"
                      numberOfLines={1}
                      accessibilityRole="header"
                      style={styles.flex}
                      testID="faith-calendar-month-title"
                    >
                      {`${value.monthName} ${value.hijriYear} AH`}
                    </ModuleText>
                    <MonthStep
                      direction={1}
                      label="Next month"
                      onPress={() => {
                        if (visible === null) return;
                        setSelected(null);
                        setBrowsing(stepHijriMonth(visible, 1));
                      }}
                      testID="faith-calendar-next"
                    />
                  </View>

                  <HijriMonthGrid
                    month={value}
                    todayGregorian={todayGregorian ?? ''}
                    selectedGregorian={selected}
                    onSelect={setSelected}
                  />
                </ModuleCard>

                {/*
                  The selected day, in both calendars, with anything falling on it named in words.
                  Defaults to today when the user has not chosen a day, so the card is never an
                  empty frame waiting for a tap.
                */}
                {chosen === null ? null : (
                  <ModuleCard testID="faith-calendar-selected">
                    <ModuleText token="caption" numberOfLines={1}>
                      {chosen.gregorian === todayGregorian ? 'Today' : 'Selected day'}
                    </ModuleText>
                    <ModuleText token="cardTitle" numberOfLines={2}>
                      {chosen.hijri.formatted}
                    </ModuleText>
                    <ModuleText token="caption" numberOfLines={2}>
                      {`${chosen.gregorian} • ${
                        chosen.hijri.basis === 'calculated' ? 'Calculated' : 'Confirmed by sighting'
                      }`}
                    </ModuleText>
                  </ModuleCard>
                )}
              </View>
            );
          }}
        </FaithResourceView>

        {/*
          Upcoming observances, on the calendar itself rather than only behind a separate route.
          Every one is labelled expected — `EventsScreen` carries the same wording, and
          `countdownLabel` is shared so the two can never describe the same day differently.
        */}
        <FaithResourceView
          resource={observances}
          empty={{ title: 'Nothing upcoming', body: 'No observances are scheduled.' }}
          loadingRows={3}
          testID="faith-calendar-upcoming"
        >
          {(list) => (
            <FaithRowGroup title="Upcoming" testID="faith-calendar-upcoming-list">
              {list.map((item) => (
                <FaithRow
                  key={item.id}
                  title={item.name}
                  subtitle={`${item.hijri.formatted} • expected ${item.gregorian}`}
                  meta={countdownLabel(item.daysUntil)}
                  icon="calendar"
                  accessibilityLabel={`${item.name}, ${countdownLabel(item.daysUntil)}, expected ${item.gregorian}, calculated`}
                  testID={`faith-calendar-observance-${item.id}`}
                />
              ))}
            </FaithRowGroup>
          )}
        </FaithResourceView>
      </View>
    </FaithScreen>
  );
}

/**
 * How far away an observance is, in words.
 *
 * Exported so the home screen's card and this screen cannot describe the same day differently —
 * "In 1 days" on one surface and "Tomorrow" on the other is the kind of drift two call sites
 * produce and one function prevents.
 */
export function countdownLabel(daysUntil: number): string {
  if (daysUntil < 0) {
    return 'Past';
  }
  if (daysUntil === 0) {
    return 'Today';
  }
  if (daysUntil === 1) {
    return 'Tomorrow';
  }
  return `In ${daysUntil} days`;
}

/** Upcoming observances — reached from the home screen's "Upcoming" card. */
export function EventsScreen() {
  const { dp } = useModuleMetrics();
  const { calendar, prayerTimes } = useFaithRepositories();

  /*
    Location-scoped for the same reason the calendar's "today" is: `daysUntil` is a countdown, and a
    countdown measured from a day the user is not on is wrong by a day for anyone across a midnight
    boundary. `permission-required` passes straight through to the screen's own state.
  */
  const observances = useFaithResource(
    'faith.observances',
    useCallback(async (): Promise<FaithResult<readonly Observance[]>> => {
      const location = await prayerTimes.resolveCurrentLocation();
      return hasData(location) ? calendar.listUpcomingObservances(location.data, 10) : location;
    }, [prayerTimes, calendar]),
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
                      {countdownLabel(item.daysUntil)}
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

/**
 * One month-navigation control: a bordered disc, matching the header's Back and Help controls.
 *
 * Its own component so the two steps cannot drift in size, hit target or spoken label — the pair is
 * the most easily mismatched thing on the screen, being mirror images of each other.
 */
function MonthStep({
  direction,
  label,
  onPress,
  testID,
}: {
  readonly direction: 1 | -1;
  readonly label: string;
  readonly onPress: () => void;
  readonly testID: string;
}) {
  const theme = useModuleTheme();
  const { dp } = useModuleMetrics();
  const size = dp(moduleLayout.headerControl);

  return (
    <PressableScale
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      // The visible disc is 36 dp, as elsewhere; hit-slop brings the target to the 44 dp minimum.
      hitSlop={minimumHitSlop(size)}
      style={{
        width: size,
        height: size,
        borderRadius: size,
        borderWidth: 1,
        borderColor: moduleNeutrals.border,
        backgroundColor: moduleNeutrals.surface,
        alignItems: 'center',
        justifyContent: 'center',
      }}
      testID={testID}
    >
      <AppIcon
        name={direction === 1 ? 'chevron-forward' : 'chevron-back'}
        size={dp(moduleLayout.headerIcon)}
        color={theme.ink}
      />
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  monthHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  flex: {
    flex: 1,
    minWidth: 0,
  },
});
