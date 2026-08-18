import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, View, type LayoutChangeEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppIcon, PressableScale } from '@ds/components';
import { ModuleStatusBanner, ModuleText } from '@features/modules/components';
import { ModuleCard } from '@features/modules/components/module-card';
import { useModuleTheme } from '@features/modules/module-context';
import { moduleLayout, moduleNeutrals } from '@features/modules/module-tokens';
import { useModuleMetrics } from '@features/modules/use-module-metrics';

import { FaithPictogram } from '../components/faith-locked-library';
import { FaithPictogramDevAudit } from '../components/faith-pictogram-dev-audit';
import { FaithResourceView, FaithScreen } from '../components/faith-screen';
import { FaithSectionHero } from '../components/faith-section-hero';
import { PrayerActionCards } from '../components/prayer-action-cards';
import {
  prayerDashboardMode,
  prayerDashboardSafeBodyHeight,
  type PrayerDashboardMode,
} from '../components/prayer-dashboard-fit';
import {
  PrayerJourneyTimeline,
  type PrayerJourneyEntry,
} from '../components/prayer-journey-timeline';
import { PrayerNextSummary } from '../components/prayer-next-summary';
import { PrayerProvenanceDevAudit } from '../components/prayer-provenance-dev-audit';
import { useActiveLocationRevision } from '../data/location/active-location';
import { hasData } from '../data/faith-result';
import {
  formatDurationParts,
  formatPrayerClock,
  formatRemaining,
} from '../data/prayer/prayer-clock';
import { prayerIntervalProgress, prayerMarkerState } from '../data/prayer/prayer-interval';
import type { DailyPrayerTimes, NextPrayer, PrayerKey } from '../data/prayer-times.repository';
import { useFaithRepositories } from '../di/faith-repository-context';
import { faithHeroImages } from '../faith-hero-images';
import { faithPictogramSlot, type FaithPictogramId } from '../faith-pictogram-assets';
import { faithNavKeys, faithRoutes } from '../faith-routes';
import { useFaithPreferences } from '../hooks/use-faith-preferences';
import { useFaithResource } from '../hooks/use-faith-resource';
import {
  useActiveLocationRefresh,
  type ActiveLocationRefresh,
  type DeviceRefreshState,
} from '../hooks/use-location-refresh';
import { permissionAdvice, useLocationPermission } from '../hooks/use-location-permission';
import { usePrayerCountdown } from '../hooks/use-prayer-countdown';
import { useTopOnEntry } from '../hooks/use-top-on-entry';

/**
 * Prayer times for today — the approved **timeline** composition.
 *
 * ── What this screen is, and what it stopped being ──────────────────────────
 * Header, hero, a compact location card, a deep-emerald next-prayer card with a live progress ring,
 * one white "Today's prayer journey" card holding the six markers as a vertical timeline, and two
 * compact action cards in a row.
 *
 * It replaced a semicircular day arc with a two-column time grid inside a combined "Today" card. The
 * arc is gone rather than tuned: it had to reconcile prominent artwork with true time-proportional
 * placement, and those two are geometrically incompatible on a handset — Maghrib to Isha can be 9%
 * of a day, so honouring the proportions drove every marker toward 24 dp while holding the marker
 * size made the spacing meaningless. A vertical timeline asserts order, which is a claim the data
 * fully supports, and it grows downwards when the OS text size does.
 *
 * ── The reminder card is honest about what it does ──────────────────────────
 * Opening it persists preferences; it does **not** schedule an OS notification, because that needs a
 * permission flow and a background handler this phase does not build. The card says "Preferences
 * only" and the destination repeats it before any switch is reachable. P3's dimensional gold bell
 * stays held for the same reason.
 */
export function PrayerTimesScreen() {
  const { dp, screenWidth, screenHeight, fontScale } = useModuleMetrics();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { prayerTimes } = useFaithRepositories();
  const { preferences } = useFaithPreferences();

  const settings = {
    method: preferences.calculationMethod,
    asr: preferences.asrMethod,
    offsetsMinutes: {},
  };

  /*
    ── The revision is part of every location-derived key ────────────────────
    Saving a location bumps it once, which changes both keys below in the same commit and re-reads
    the one storage record. Without it a location saved on another screen changed no key here, and
    Prayer Times could render Dubai's label beside Mountain View's times until something unrelated
    forced a reload. See `data/location/active-location.ts`.
  */
  const locationRevision = useActiveLocationRevision();

  const times = useFaithResource(
    `prayer.today.${locationRevision}.${preferences.calculationMethod}.${preferences.asrMethod}`,
    useCallback(async () => {
      const location = await prayerTimes.resolveCurrentLocation();
      if (!hasData(location)) {
        return location;
      }
      /*
        ── "Today" is the day at the *location*, not on the device ──────────────
        This line read `todayIsoDate()`, which reads `getFullYear()`/`getMonth()`/`getDate()` — the
        device's calendar day. Between midnight at the location and midnight on the phone the two
        disagree, so a traveller was shown one day's times, the *next* prayer from another day (that
        path already used the location's day), and a Hijri date from a third. Asking the repository
        is what makes all three the same day.

        `null` when the zone will not resolve, which is an error rather than a reason to fall back to
        the device — a plausible day in the wrong zone is indistinguishable from the right one.
      */
      const day = prayerTimes.locationCalendarDay(location.data);
      if (day === null) {
        return { kind: 'error', code: 'unavailable' } as const;
      }
      return prayerTimes.getDailyTimes(location.data, day, settings);
      // `settings` is derived from preferences, which are in the key.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [prayerTimes, preferences.calculationMethod, preferences.asrMethod]),
  );

  /**
   * The next prayer, as its own resource.
   *
   * ── Why not derived from `times` ─────────────────────────────────────────────
   * Because today's list cannot answer the question after Isha. Once the day's last prayer has passed
   * the next one is *tomorrow's* Fajr at tomorrow's time, which is not in `times` and is not today's
   * Fajr either — reusing that would report a past instant and a negative duration. The repository
   * already handles the rollover, computing tomorrow at the prayer location rather than by adding
   * 86,400,000 ms, so this asks it rather than reimplementing the rule on screen.
   *
   * Keyed on the same method and Asr convention as `times`, so the cards and the timeline can never
   * be calculated under different conventions.
   */
  const next = useFaithResource(
    `prayer.next.${locationRevision}.${preferences.calculationMethod}.${preferences.asrMethod}`,
    useCallback(async () => {
      const location = await prayerTimes.resolveCurrentLocation();
      if (!hasData(location)) {
        return location;
      }
      return prayerTimes.getNextPrayer(location.data, settings);
      // `settings` is derived from preferences, which are in the key.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [prayerTimes, preferences.calculationMethod, preferences.asrMethod]),
  );

  /**
   * The Grant control raises the real prompt, and reloads only if it was granted.
   *
   * It used to be wired to `reload`, which re-ran a request that failed for the same reason it
   * failed the first time — a button labelled Grant that never asked the OS for anything.
   */
  const permission = useLocationPermission(times.reload);
  const advice = permissionAdvice(permission.outcome);

  /**
   * The refresh capability the **active authority** actually has.
   *
   * ── Why this is not simply "a refresh" any more ─────────────────────────────
   * Because two of the three authorities have nothing to refresh. A saved city and a typed
   * coordinate are the user's answer, not an estimate of one, and waking the GPS to check them costs
   * a permission prompt, a radio and several seconds to learn something already known. The hook
   * therefore hands back a union in which `refreshDevice` exists only under device authority — see
   * its own note — so the control below cannot be wired up in a mode that must not have it.
   *
   * ── Why both resources reload together ──────────────────────────────────────
   * They are the day's times and the next prayer, and they are calculated from the same coordinate.
   * Reloading one without the other is how a screen ends up naming a new city beside the old city's
   * times. The repository has already written the new location to storage by the time this runs, so
   * both re-reads see the same coordinate — which is the property that actually makes the update
   * atomic, rather than the two calls being adjacent.
   */
  const locationRefresh = useActiveLocationRefresh(
    useCallback(() => {
      times.reload();
      next.reload();
    }, [times, next]),
  );

  /*
    ── The scroll region, owned by this screen ───────────────────────────────
    The scaffold draws it; this screen decides where it sits on entry. `resetKey` is the identity of
    what is being displayed — the location and the two calculation conventions — so a saved city, a
    changed method or a switch back to the device all return the reader to the hero, and a countdown
    tick or a background reload does not. See `useTopOnEntry`.
  */
  const scrollRef = useTopOnEntry(
    `${locationRevision}.${preferences.calculationMethod}.${preferences.asrMethod}`,
  );

  /**
   * Whether the dashboard fits one viewport here, measured rather than assumed.
   *
   * The safe body is derived from the scaffold's own tokens — the status-bar inset it pads by, the
   * header, the navigation bar including its gesture inset, and the breathing room under the last
   * card. The content height is the real laid-out height of the column below. When the second is
   * within the first the screen needs no scrolling; when it is not, it scrolls, from zero, with
   * nothing clipped. See `prayer-dashboard-fit.ts`.
   */
  const [contentHeight, setContentHeight] = useState(0);
  const viewportHeight = prayerDashboardSafeBodyHeight({
    screenHeight,
    insetTop: insets.top,
    insetBottom: insets.bottom,
    dp,
  });
  const mode: PrayerDashboardMode = prayerDashboardMode({
    screenWidth,
    fontScale,
    viewportHeight,
    contentHeight,
  });

  const onContentLayout = useCallback((event: LayoutChangeEvent) => {
    setContentHeight(event.nativeEvent.layout.height);
  }, []);

  return (
    <FaithScreen
      title="Prayer Times"
      activeKey={faithNavKeys.worship}
      scrollRef={scrollRef}
      /*
        ── Zero breathing room once the dashboard is known to fit ──────────────
        In compact mode there is nothing to scroll, and the fourteen dp the scaffold reserves under
        the last card would be the only thing making the content taller than its box — a screen with
        every card visible that still scrolls by fourteen dp. Dropping it there takes the scroll range
        to zero. In overflow mode it is left alone, because that is where the padding does its real
        job: letting the final action cards travel clear of the navigation bar.

        The bar's own height is never touched by this — see the prop's note.
      */
      scrollBottomInset={mode === 'compact' ? 0 : undefined}
      testID="faith-prayer-times"
    >
      <View
        style={{ rowGap: dp(moduleLayout.sectionGap) }}
        onLayout={onContentLayout}
        /*
          The resolved mode, on the element whose height decided it. Read by the layout suite and by
          the device verification pass, so "compact at 411 dp, overflow at 1.3x" is a property that
          can be asserted rather than a screenshot somebody eyeballed.
        */
        testID={`faith-prayer-dashboard-${mode}`}
      >
        {/*
          ── No action, and no live time on the hero ───────────────────────────────
          The baked heading reads "Next prayer" and cannot be edited, so the real prayer and its
          location-local time are shown natively in the emerald summary card below — with the live
          countdown — rather than being drawn over the image or contradicting it.
        */}
        <FaithSectionHero
          submenu="prayer"
          heroImage={faithHeroImages.prayer}
          summary="Today’s times, and the reminders you choose."
        />

        {advice === null ? null : (
          <ModuleStatusBanner
            tone="warning"
            message={advice}
            testID="faith-prayer-times-permission-advice"
          />
        )}

        <FaithResourceView
          resource={times}
          empty={{ title: 'No times available', body: 'Prayer times could not be calculated.' }}
          loadingRows={5}
          onGrantPermission={() => void permission.request()}
          testID="faith-prayer-times-body"
        >
          {/*
            `next` is read defensively: it is a separate resource with its own lifecycle, so it may
            still be loading when the day's times have arrived. The summary simply does not render
            until it has data, which is why a `null` here is not an error state.
          */}
          {(day) => (
            <PrayerDay
              day={day}
              next={next.status === 'settled' && hasData(next.result) ? next.result.data : null}
              locationRefresh={locationRefresh}
            />
          )}
        </FaithResourceView>

        {/*
          ── The two action cards ────────────────────────────────────────────────
          Outside the resource view on purpose: they are settings, and they remain reachable when
          the day's times cannot be calculated — which is one of the moments a user is most likely
          to want to change the calculation method.
        */}
        <PrayerActionCards
          methodLabel={methodLabel(preferences.calculationMethod)}
          onCalculation={() => router.push(faithRoutes.preferences)}
          onReminders={() => router.push(faithRoutes.reminders)}
          testID="faith-prayer-actions"
        />
      </View>
    </FaithScreen>
  );
}

function PrayerDay({
  day,
  next,
  locationRefresh,
}: {
  readonly day: DailyPrayerTimes;
  readonly next: NextPrayer | null;
  readonly locationRefresh: ActiveLocationRefresh;
}) {
  const { dp } = useModuleMetrics();
  const theme = useModuleTheme();
  const router = useRouter();

  /**
   * The live countdown, from the same hook the hero and Main Home use.
   *
   * Deliberately not `next.minutesUntil`: that figure is computed once, when the repository was
   * called, and rendering it directly is how the hero once displayed "in 4 hr 14 min" indefinitely
   * while the prayer arrived and passed. Passing `null` when there is no next prayer keeps the hook
   * call unconditional, which is what the rules of hooks require.
   *
   * ── One clock for the whole screen ──────────────────────────────────────
   * `now` comes from the hook rather than from a second `useState(() => Date.now())` here. This
   * screen ran two clocks: the hook's, ticking every fifteen seconds, and its own, frozen at mount.
   * The ring's sweep and the timeline's past/next markers were drawn from the frozen one while the
   * countdown beside them read the live one, so the two drifted apart for as long as the screen
   * stayed open — and a prayer that passed meanwhile still rendered as upcoming. Reading both from
   * one sample removes the drift and the minute-boundary flake it caused in tests.
   */
  const { minutes, now } = usePrayerCountdown(next?.prayer.at ?? null);

  /**
   * Which row, if any, is the next prayer — matched by **instant**, never by key.
   *
   * ── The day boundary this closes ────────────────────────────────────────────
   * After Isha the next prayer is tomorrow's Fajr, and its key is still `fajr`. Matching on the key
   * would highlight *today's* Fajr — a row whose time passed before dawn — and tell the reader the
   * day has not started. Matching the timestamp cannot do that: tomorrow's Fajr is not in today's
   * list, so no row is highlighted and the card states the boundary in words instead.
   */
  const nextInstant = next === null ? null : next.prayer.at;
  const highlighted = day.times.find((time) => time.at === nextInstant) ?? null;

  const entries: readonly PrayerJourneyEntry[] = day.times.map((time) => ({
    key: time.key,
    label: time.label,
    clock: formatTime(time.at),
    pictogram: faithPictogramSlot(PRAYER_MARKER_SLOT[time.key]),
    state: prayerMarkerState(time.at, highlighted?.at ?? null, now),
    /* Sunrise is a clock reading, not an act of worship, and every surface here honours that. */
    isPrayer: time.key !== 'sunrise',
  }));

  /*
    Only after every one of today's markers has passed, and only with a real next prayer to name.
    `formatTime` reads the offset the repository stamped, so "tomorrow" is tomorrow at the location.
  */
  const dayBoundaryNote =
    next !== null && highlighted === null
      ? `Today’s prayers are complete. Next is ${next.prayer.label} tomorrow at ${formatTime(next.prayer.at)}.`
      : null;

  /**
   * How far through the wait the moment is, or `null` when that cannot be known.
   *
   * See `data/prayer/prayer-interval.ts`: between midnight at the location and Fajr the interval
   * began at *yesterday's* Isha, which is not in today's list, and inventing a start would draw a
   * proportion that means nothing. The ring shows its track and no sweep there; the countdown beside
   * it is unaffected, because a countdown needs no interval.
   */
  const interval = next === null ? null : prayerIntervalProgress(day.times, next.prayer.at, now);

  /*
    ── The device control and its commentary are one decision ────────────────
    Both come from the same narrowing. Under city or coordinates authority the union carries neither
    a `refreshDevice` nor a `state`, so there is no button to draw and no freshness to qualify — and
    that is the correction, stated structurally: the screen is not *choosing* to stay silent about a
    device fix, it has nothing to say because nothing was attempted.
  */
  const device = locationRefresh.authority === 'device' ? locationRefresh : null;
  const note = device === null ? null : refreshNote(device.state);

  return (
    /*
      ── `sectionGap`, the next smaller existing token, rather than `cardGap` ──
      Three dp per gap and two gaps here. `cardGap` is 10 and `sectionGap` is 7, and stepping down
      the existing scale is what the correction asks for rather than inventing a value between them.
      The cards keep their own borders and shadows, so seven dp still reads as three distinct
      surfaces — this is the separation the reference draws, not a denser one.
    */
    <View style={{ rowGap: dp(moduleLayout.sectionGap) }}>
      {/*
        ── Location ────────────────────────────────────────────────────────────
        Every value is the repository's: the place label it resolved, the Hijri date it calculated
        for the *location's* calendar day, and the method the preferences selected. Nothing here is
        guessed — where a place name could not be resolved the repository supplies a coordinate-safe
        label rather than a city, so this card never names somewhere the user is not.
      */}
      <ModuleCard
        padding={LOCATION_CARD_PADDING_DP}
        onPress={() => router.push(faithRoutes.location)}
        accessibilityLabel={`Prayer location: ${day.location.label}. Opens Prayer location, where you can choose your location.`}
        testID="faith-prayer-location"
      >
        {/*
          ── No vertical padding of its own ──────────────────────────────────
          The card already carries `moduleLayout.cardPadding` on every edge, and the 48 dp pictogram
          is what sets this row's height — so the four dp that used to sit here bought no separation
          from anything, it simply made the tallest card on the screen eight dp taller than the
          composition it is measured against. The horizontal gap is untouched.
        */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            columnGap: dp(LOCATION_ROW_GAP_DP),
          }}
        >
          {/*
            P1 — a mosque inside a gold-rimmed map pin. 48 dp rather than the 28 dp compact-card
            token: the reference gives this pictogram enough weight to anchor the card, because it
            identifies the place the whole screen is calculated for.
          */}
          <FaithPictogram
            slot={faithPictogramSlot('p1')}
            size={dp(LOCATION_PICTOGRAM_DP)}
            testID="faith-prayer-location-pictogram"
          />
          <View style={{ flex: 1, minWidth: 0, rowGap: dp(2) }}>
            {/* Uncapped: a resolved place name is the one thing this card exists to state. */}
            <ModuleText token="cardTitle" testID="faith-prayer-location-label">
              {day.location.label}
            </ModuleText>
            <ModuleText token="caption" testID="faith-prayer-location-meta">
              {`${day.hijriDate} • ${methodLabel(day.settings.method)}`}
            </ModuleText>
            {/*
              Only ever a *qualification* of the label above, never a replacement for it. The times
              on this screen remain real times for the location named — a refresh that failed means
              "this may be out of date", which is a different statement from "this is wrong".

              Unreachable under city or coordinates authority, and unreachable for a verdict from a
              location that is no longer active: the hook only surfaces a device state stamped with
              the revision being rendered. That pair is what stops "Could not get a new position just
              now" appearing beneath a city the user chose while an acquisition was still running.

              It wraps rather than truncates — no `numberOfLines` — because a warning that ellipsises
              is a warning nobody can act on.
            */}
            {note === null ? null : (
              <ModuleText
                token="caption"
                color={moduleNeutrals.warning}
                testID="faith-prayer-location-refresh-note"
              >
                {note}
              </ModuleText>
            )}
          </View>

          {/*
            ── The Change affordance ───────────────────────────────────────────
            A word and a chevron rather than a chevron alone. The card is pressable, but a chevron on
            a card that also holds a button reads as decoration — "Change" says what pressing does,
            and it is what the brief asks to sit alongside the refresh control.
          */}
          <View style={{ flexDirection: 'row', alignItems: 'center', columnGap: dp(2) }}>
            <ModuleText token="rowMeta" color={theme.ink} testID="faith-prayer-location-change">
              Change
            </ModuleText>
            <AppIcon name="chevron-forward" size={dp(14)} color={theme.ink} />
          </View>

          {/*
            ── The device refresh control, and the modes that do not get one ───
            Rendered only under device authority. It acquires a *new* position rather than re-reading
            the stored one — see `refreshDeviceLocation` — which is precisely why a saved city or a
            typed coordinate must not offer it: there is nothing to re-acquire, and the button's own
            label ("Gets a new position from this device") would be describing something the app has
            no business doing to a location the user chose deliberately.

            No replacement control is drawn in those modes. The screen recalculates from the stored
            snapshot whenever the location revision or a calculation convention changes, so a manual
            "reload the calculations" action would be a button for work that has already happened —
            and one shaped like this would be indistinguishable from the GPS refresh it replaced.
            **Change** remains, in every mode, and it is the action those modes actually need.

            Disabled while a fix is in flight so a second tap cannot wake the GPS twice. The hook
            holds a synchronous in-flight ref as well, for the frame before `disabled` is committed.
          */}
          {device === null ? null : (
            <PressableScale
              onPress={() => void device.refreshDevice()}
              disabled={device.state.kind === 'refreshing'}
              accessibilityRole="button"
              accessibilityLabel="Refresh location. Gets a new position from this device and recalculates today’s prayer times."
              accessibilityState={{ disabled: device.state.kind === 'refreshing' }}
              hitSlop={10}
              testID="faith-prayer-location-refresh"
            >
              <View
                style={{
                  width: dp(36),
                  height: dp(36),
                  borderRadius: dp(18),
                  borderWidth: 1,
                  borderColor: moduleNeutrals.border,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {device.state.kind === 'refreshing' ? (
                  <ActivityIndicator size="small" color={theme.ink} />
                ) : (
                  <AppIcon name="retry" size={dp(18)} color={theme.ink} />
                )}
              </View>
            </PressableScale>
          )}
        </View>
      </ModuleCard>

      {/*
        ── The next-prayer summary ─────────────────────────────────────────────
        Rendered only with a live next prayer and a live countdown behind it. There is no placeholder
        state and no baked prayer: a card that showed a name and a time it did not have would be
        indistinguishable from one that did.
      */}
      {next === null || minutes === null ? null : (
        <PrayerNextSummary
          pictogram={faithPictogramSlot(PRAYER_MARKER_SLOT[next.prayer.key])}
          prayerName={next.prayer.label}
          clock={formatTime(next.prayer.at)}
          remaining={formatRemaining(minutes)}
          remainingLines={formatDurationParts(minutes)}
          dayRelation={next.dayRelation}
          progress={
            interval !== null && interval.kind === 'known' ? interval.elapsedFraction : null
          }
          testID="faith-prayer-next"
        />
      )}

      <PrayerJourneyTimeline
        entries={entries}
        dayBoundaryNote={dayBoundaryNote}
        testID="faith-prayer-journey"
      />

      {/*
        ── Development only, both of them ──────────────────────────────────────
        Placed inside `PrayerDay` rather than beside the hero because both audit *this rendering*:
        the provenance panel needs the day and the next prayer it is reporting on, and putting the
        pictogram panel beside it keeps the two diagnostics in one place instead of one at each end
        of a scrolling screen. Neither renders in a production bundle.
      */}
      <PrayerProvenanceDevAudit
        day={day}
        next={next}
        countdownLabel={minutes === null ? null : formatRemaining(minutes)}
        testID="faith-prayer-provenance-audit"
      />
      <FaithPictogramDevAudit slots={PRAYER_SLOTS} testID="faith-prayer-pictogram-audit" />
    </View>
  );
}

/**
 * The pictogram slots this screen occupies.
 *
 * P3 is listed even though nothing draws it: it is *held*, and the audit's job is to report that
 * decision on the screen it applies to. Omitting it would make the panel read as though every slot
 * here were resolved, which is the impression the hold exists to prevent.
 */
const PRAYER_SLOTS: readonly FaithPictogramId[] = [
  'p1',
  'p2-fajr',
  'p2-sunrise',
  'p2-dhuhr',
  'p2-asr',
  'p2-maghrib',
  'p2-isha',
  'p3',
  'p4',
];

/**
 * The location card's pictogram, and the card padding around it.
 *
 * ── Why 44 rather than the reference's 48–52 band ───────────────────────────
 * Because at 48 this card was costing height twice over. The pictogram set a 48 dp floor, and the
 * text column beside it — the place name over "29 Safar 1448 AH • Muslim World League" — was itself
 * 51 dp, because that caption wrapped to two lines in the 210 dp the 48 dp mark left it. So the card
 * measured 73.5 dp on the emulator and *neither* constraint was the pictogram's fault alone.
 *
 * Four dp off the mark returns those four dp to the text column, which is enough for the caption to
 * hold one line: the column becomes ~230 dp against the ~224 dp the string measures. The text block
 * then drops to 36 dp, the mark's 44 becomes the floor again, and the card lands at 66 — seven and a
 * half dp saved from one four dp change, because the wrap went with it.
 *
 * 44 is the module's own minimum touch target, so the mark is still drawn at a size the design system
 * treats as substantial. It is not itself a touch target — the whole card carries the press — and no
 * target on this screen was reduced.
 */
const LOCATION_PICTOGRAM_DP = 40;
/** One dp under the shared card padding, matching the timeline card beneath it. */
const LOCATION_CARD_PADDING_DP = 10;
/**
 * Between the mark, the text column and the Change affordance.
 *
 * ── Six, and the six dp it gave back are the point ──────────────────────────
 * This row has two gaps, so every dp here costs two of text column — and the text column is where
 * the card's height is actually decided. At 12, with a 44 dp mark, the column measured 216.8 dp and
 * "29 Safar 1448 AH • Muslim World League" needed one more line than that allowed; the card then
 * stood at 71.6 dp rather than the 62 its content needs, because a wrapped caption is taller than
 * the mark beside it.
 *
 * Six here and four off the mark return sixteen dp to the column. Nothing is abbreviated, nothing is
 * shrunk, and the row still reads as three separate things: the gap is smaller than the mark, which
 * is what keeps them from merging visually.
 */
const LOCATION_ROW_GAP_DP = 6;

/**
 * Which approved marker belongs to which prayer.
 *
 * ── Why this mapping lives here ─────────────────────────────────────────────
 * It is the one place a repository `PrayerKey` meets a registry slot id, and both halves are visible
 * on one line — so a mismatch is a reading error rather than something to trace across two files.
 * `Record<PrayerKey, …>` makes it total: a seventh key could not be added to the domain without the
 * compiler demanding a marker for it.
 *
 * Sunrise has its own asset because it is on the timeline, and it carries no claim to being a prayer
 * — the image says nothing either way, and the row beneath it says "Time marker • not a prayer" in
 * words.
 */
const PRAYER_MARKER_SLOT: Readonly<Record<PrayerKey, FaithPictogramId>> = {
  fajr: 'p2-fajr',
  sunrise: 'p2-sunrise',
  dhuhr: 'p2-dhuhr',
  asr: 'p2-asr',
  maghrib: 'p2-maghrib',
  isha: 'p2-isha',
};

/**
 * The prayer's wall clock, in the **location's** zone.
 *
 * ── Why this delegates rather than formatting here ──────────────────────────
 * It used to be a local implementation reading `date.getHours()` and `date.getMinutes()` — device-local
 * getters. That made this screen the last surviving copy of the timezone defect: the repository was
 * corrected to stamp each timestamp with the location's own offset, and this function then parsed that
 * string back into a `Date` and re-rendered it in the device's zone, undoing the fix on the one screen
 * whose entire purpose is to show prayer times.
 *
 * `formatPrayerClock` reads the hours and minutes out of the string without going through a `Date`, so
 * the offset the repository stamped is the offset displayed. It is the only prayer-time formatter in
 * the module now, which is what stops a fifth copy appearing.
 */
function formatTime(iso: string): string {
  const clock = formatPrayerClock(iso);
  return clock === '' ? '—' : clock;
}

/**
 * What to say beneath the place name about the freshness of the **device fix** behind it, or `null`.
 *
 * ── Only ever reached under device authority ────────────────────────────────
 * It used to take a state that had a `user-selected` member, which it had to return `null` for — a
 * function whose type admitted a case it existed to say nothing about. Narrowing at the call site
 * removes the case entirely: a city has no freshness to qualify, because no device position was
 * requested, so there is nothing here to decide.
 *
 * Silent on the states that need no words. `idle` and `refreshing` say nothing because the label is
 * already correct and a spinner is already visible; `updated` says nothing because the new place
 * name *is* the message.
 */
function refreshNote(state: DeviceRefreshState): string | null {
  switch (state.kind) {
    case 'stale':
      return state.reason === 'permission'
        ? 'Location access is off, so this place cannot be re-checked.'
        : state.reason === 'timeout'
          ? 'Could not get a new position just now. Showing the last one.'
          : 'A new position was not available. Showing the last one.';
    case 'kept':
      return state.reason === 'accuracy-unusable'
        ? 'The new position was too imprecise to use. Showing the last one.'
        : state.reason === 'invalid-coordinate'
          ? 'The device reported an unusable position. Showing the last one.'
          : null;
    default:
      return null;
  }
}

function methodLabel(method: string): string {
  return method
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}
