import { useRouter, type Href } from 'expo-router';
import { useCallback } from 'react';
import { Image, StyleSheet, View } from 'react-native';

import { AppIcon, PressableScale } from '@ds/components';
import { statusLabel } from '@shared/utils/a11y';

import { ArabicText } from '@features/faith/components/faith-list';
import { UnverifiedSourceNotice } from '@features/faith/components/faith-states';
import { countdownLabel } from '@features/faith/screens/calendar-screens';
import { hasData } from '@features/faith/data/faith-result';
import type { WorshipDay, WorshipEntryStatus } from '@features/faith/data/worship.repository';
import { useFaithRepositories } from '@features/faith/di/faith-repository-context';
import { faithRoutes, readerHref } from '@features/faith/faith-routes';
import {
  faithSubmenu,
  getFaithSubmenuEntry,
  type FaithSubmenuKey,
} from '@features/faith/faith-submenu-assets';
import {
  formatPrayerClock,
  useFaithHome,
  type NextPrayerView,
} from '@features/faith/hooks/use-faith-home';
import { usePrayerCountdown } from '@features/faith/hooks/use-prayer-countdown';
import { useContinueReading } from '@features/faith/hooks/use-continue-reading';
import { todayIsoDate, useReadingLog } from '@features/faith/hooks/use-reading-log';
import { readOn, totalAyatRead } from '@features/faith/storage/faith-reading-log';
import { useTranslationPreference } from '@features/faith/hooks/use-translation-preference';
import { useFaithResource, type UseFaithResource } from '@features/faith/hooks/use-faith-resource';

import { ModuleAIInsightCard } from '../components/module-ai-insight-card';
import { ModuleCard, ModuleCardHeading, ModuleTwoColumn } from '../components/module-card';
import { ModuleProgressBar } from '../components/module-chart';
import { ModuleSkeleton } from '../components/module-skeleton';
import { ModuleText } from '../components/module-text';
import { useModule } from '../module-context';
import { moduleLayout, moduleNeutrals } from '../module-tokens';
import { useModuleMetrics } from '../use-module-metrics';
import { FaithHero } from './faith-hero';

/** Gold, from the approved reference's line-art icons. */
const GOLD_ICON = '#B98A2E';

/**
 * Placeholder lines inside a card that is already drawn.
 *
 * `ModuleSkeletonGroup` is the full-screen shape — a 96 dp hero block and rows beneath it — which is
 * right for a screen that is entirely loading and wrong inside a card whose heading has already
 * rendered. These are plain rows at body height, hidden from screen readers so the card's own label
 * is the only thing announced.
 */
function CardSkeleton({ rows, testID }: { readonly rows: number; readonly testID: string }) {
  const { dp } = useModuleMetrics();

  return (
    <View
      style={{ rowGap: dp(7), marginTop: dp(7) }}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      testID={testID}
    >
      {Array.from({ length: rows }, (_, index) => (
        <ModuleSkeleton key={index} height={14} radius={7} />
      ))}
    </View>
  );
}

/**
 * Faith's home screen.
 *
 * ── Why this is a module-specific composition ───────────────────────────────
 * The generic framework layout — hero, three quick actions, "At a glance", a "Today" list, an AI
 * card — is not the shape Faith needs: it has eight feature tiles, a Continue-reading card, a
 * two-column Ayah/Worship row and two compact date cards, none of which the generic sections model.
 * So the *shell* stays shared (scaffold, header, navigation, card, text, tokens) and the
 * *composition* is Faith's own.
 *
 * ── Everything on this screen is now something that is true ─────────────────
 * It used to render from `faithHomeFixture`, a module constant holding a next prayer, a Gregorian
 * date, a Hijri date, five prayer times, a Ramadan countdown, a verse of the Qur'an in Arabic, and a
 * line of guidance captioned "Source: Sahih Bukhari". None of it was the user's, none of it was
 * derived from anything, and the last of those attributed an unverified narration to a real
 * collection. The fixture is deleted.
 *
 * What replaced it, section by section:
 *
 *   • **The hero** takes the next prayer, the place and today's Hijri date from `useFaithHome`, and
 *     says "set your location" when there is no permission rather than naming a time.
 *   • **Continue reading** renders only once the user has actually read something.
 *   • **The verse of the day** is fetched live from the approved source with its own translation.
 *   • **Today's worship** is the user's own marks, from device storage.
 *   • **The date cards** are calculated, and say "expected" where a sighting decides the day.
 *   • **The AI card** carries a scope note. It carried a sentence of religious guidance with a
 *     hadith collection named beneath it, which the Faith AI boundary rules forbid outright.
 *
 * Each section renders its own loading and failure state, so a denied location permission does not
 * blank the calendar cards and an offline device still shows the worship checklist.
 */
export function FaithHomeContent() {
  const router = useRouter();
  const module = useModule();
  const { dp } = useModuleMetrics();
  const { nextPrayer, upcoming } = useFaithHome();

  const gap = dp(moduleLayout.sectionGap);
  /**
   * Every control resolves to a real, built destination.
   *
   * `comingSoon` is gone from this screen. It existed while the Faith routes did not, and routing a
   * live control to a placeholder was the honest choice then. Now that every Faith route exists, a
   * placeholder here would be hiding a working screen.
   */
  const go = (href: Href) => () => router.push(href);

  /**
   * The instant the hero is counting down to, or `null` when there is nothing to count.
   *
   * Pulled out ahead of the conditional below because `usePrayerCountdown` is a hook and cannot be
   * called inside a branch. `null` is a valid argument to it, so the loading and failure paths cost
   * nothing.
   */
  const nextPrayerAt =
    nextPrayer.status === 'settled' && nextPrayer.result.kind === 'ok'
      ? nextPrayer.result.data.prayer.prayer.at
      : null;
  /**
   * A live countdown, replacing `formatTimeUntil(minutesUntil)`.
   *
   * `minutesUntil` is measured once by the repository, so the hero rendered it and then kept
   * rendering it — "in 4 hr 14 min" stayed at 4 hr 14 min while the prayer arrived and passed. The
   * hook re-derives the figure from the instant every fifteen seconds and on foreground, and it is the
   * same hook the Prayer times screen uses, so the two surfaces cannot drift apart.
   */
  const countdown = usePrayerCountdown(nextPrayerAt);

  /** What the hero says when there is no live prayer time, and why. */
  const heroCopy =
    nextPrayer.status === 'settled' && nextPrayer.result.kind === 'ok'
      ? {
          headline: `${nextPrayer.result.data.prayer.prayer.label} ${formatPrayerClock(nextPrayer.result.data.prayer.prayer.at)}`,
          support: `${countdown.label ?? ''} • ${nextPrayer.result.data.location.label}`,
          supportSecondary: nextPrayer.result.data.today.hijri.formatted,
        }
      : nextPrayer.status === 'loading'
        ? { headline: 'Loading today’s times…', support: '', supportSecondary: '' }
        : nextPrayer.result.kind === 'permission-required'
          ? {
              /*
                The one failure the user can do something about, so it says what. Everything else —
                an outage, a timeout, a place that would not resolve — falls through to the
                registry's static copy, which offers no instruction because there is none to give.
              */
              headline: 'Prayer times need your location',
              support: 'Tap below to set it. It stays on this device.',
              supportSecondary: '',
              actionLabel: 'Set your location',
            }
          : {};

  return (
    <View style={{ rowGap: gap }}>
      <FaithHero
        onViewPrayerTimes={go(faithRoutes.prayerTimes)}
        {...heroCopy}
        testID="faith-hero"
      />

      <FaithFeatureGrid />

      <ContinueReadingCard />

      <ReadingProgressCard />

      {/* ── Verse of the day | Today's worship ───────────────────────────── */}
      <ModuleTwoColumn
        testID="faith-ayah-worship"
        left={<DailyAyahCard onOpen={go(faithRoutes.dailyAyah)} />}
        right={<WorshipCard onViewAll={go(faithRoutes.worship)} />}
      />

      {/* ── Upcoming | Islamic Calendar ──────────────────────────────────── */}
      <ModuleTwoColumn
        testID="faith-dates"
        left={
          upcoming.status === 'settled' && upcoming.result.kind === 'ok' ? (
            <CompactDateCard
              icon="crescent"
              iconColor={GOLD_ICON}
              eyebrow="Upcoming"
              title={upcoming.result.data.name}
              /* "Expected" is the word the sighting qualifier turns into on screen. */
              detail={`${countdownLabel(upcoming.result.data.daysUntil)} • expected ${upcoming.result.data.gregorian}`}
              onPress={go(faithRoutes.events)}
              testID="faith-upcoming"
            />
          ) : (
            <CompactDateCard
              icon="crescent"
              iconColor={GOLD_ICON}
              eyebrow="Upcoming"
              title="Observances"
              detail="Ramadan, Eid and the days around them"
              onPress={go(faithRoutes.events)}
              testID="faith-upcoming"
            />
          )
        }
        right={<HijriTodayCard today={nextPrayer} onPress={go(faithRoutes.calendar)} />}
      />

      {/*
        ── Faith AI ────────────────────────────────────────────────────────
        A scope note, not an insight. The card used to read "Consistency in small acts of worship
        brings great reward." with "Source: Sahih Bukhari" beneath it — a religious statement the app
        generated, attributed to a collection it had not consulted. The Faith AI boundary rules
        forbid presenting generated text as Qur'an, Hadith or a ruling, and that card did exactly
        that on the module's front page. It now says what Faith AI can help with and nothing else.
      */}
      <ModuleAIInsightCard
        message="Ask about NoorLife’s Faith features — prayer times, the Qur’an reader, your worship record. Faith AI does not give religious rulings."
        onPress={go(module.routes.ai)}
        testID="faith-insight"
      />
    </View>
  );
}

/**
 * Continue reading, or an invitation to start.
 *
 * ── Both states are real ────────────────────────────────────────────────────
 * The card used to show "Surah Al-Kahf • Verse 32" at 55% on a device that had never opened the
 * reader, because the position was seeded. There is no seed: a user who has not read sees a card
 * that opens the surah list, and a user who has sees where they actually stopped, with the fraction
 * the bar is drawn from stated in words beside it.
 *
 * The play control that used to sit here is gone. It toggled a boolean, streamed nothing, and its
 * accessibility hint admitted as much — a transport control that has never played anything is not a
 * control, and it was the most prominent thing on the card.
 */
function ContinueReadingCard() {
  const router = useRouter();
  const { dp } = useModuleMetrics();
  const { position, ready } = useContinueReading();

  const image = (
    <Image
      source={getFaithSubmenuEntry('quran').source}
      style={{
        width: dp(moduleLayout.faithContinueImage),
        height: dp(moduleLayout.faithContinueImage),
      }}
      resizeMode="contain"
      accessible={false}
      testID="faith-continue-image"
    />
  );

  if (!ready) {
    return (
      <ModuleCard testID="faith-continue">
        <CardSkeleton rows={2} testID="faith-continue-skeleton" />
      </ModuleCard>
    );
  }

  if (position === null) {
    return (
      <ModuleCard
        onPress={() => router.push(faithRoutes.quran)}
        accessibilityLabel="Start reading the Qur’an. Opens the surah list."
        testID="faith-continue"
      >
        <View style={[styles.row, { columnGap: dp(11) }]}>
          {image}
          <View style={styles.flex}>
            <ModuleText token="cardTitle" numberOfLines={1}>
              Start reading
            </ModuleText>
            <ModuleText token="caption" numberOfLines={2}>
              Choose a surah, and NoorLife will remember where you stop.
            </ModuleText>
          </View>
          <AppIcon name="chevron-forward" size={dp(16)} color={moduleNeutrals.textTertiary} />
        </View>
      </ModuleCard>
    );
  }

  const detail = `${position.surahName} • verse ${position.ayah}`;
  const fraction = `${position.ayah} of ${position.ayahCount} verses`;

  return (
    <ModuleCard
      onPress={() => router.push(readerHref(position.surah, position.ayah))}
      accessibilityLabel={`Continue reading. ${detail}. ${fraction}. Opens the reader.`}
      testID="faith-continue"
    >
      <View style={[styles.row, { columnGap: dp(11) }]}>
        {image}
        <View style={styles.flex}>
          <ModuleText token="cardTitle" numberOfLines={1}>
            Continue reading
          </ModuleText>
          <ModuleText token="caption" numberOfLines={1}>
            {detail}
          </ModuleText>
          <View style={{ marginTop: dp(7) }}>
            <ModuleProgressBar
              value={position.progress}
              accessibilityLabel={`${detail}, ${fraction}`}
              testID="faith-continue-progress"
            />
          </View>
          <ModuleText token="caption" numberOfLines={1} style={{ marginTop: dp(3) }}>
            {fraction}
          </ModuleText>
        </View>
        <AppIcon name="chevron-forward" size={dp(16)} color={moduleNeutrals.textTertiary} />
      </View>
    </ModuleCard>
  );
}

/**
 * Reading progress, when there is any.
 *
 * ── It is absent rather than zeroed on a first run ──────────────────────────
 * A card reading "0 of 10 verses today" on a device that has never opened the reader is a scoreboard
 * for a game nobody started. The Continue-reading card above already offers the way in, so this one
 * simply does not exist until the log has something in it — which is also the only state in which
 * its numbers mean anything.
 */
function ReadingProgressCard() {
  const router = useRouter();
  const { dp } = useModuleMetrics();
  const { log, ready } = useReadingLog();

  const today = todayIsoDate();
  const readToday = readOn(log, today);
  const total = totalAyatRead(log);

  if (!ready || total === 0) {
    return null;
  }

  const met = readToday >= log.dailyGoal;

  return (
    <ModuleCard
      onPress={() => router.push(faithRoutes.progress)}
      accessibilityLabel={`Reading progress. ${readToday} of ${log.dailyGoal} verses today${met ? ', goal met' : ''}. Opens your reading progress.`}
      testID="faith-reading-progress"
    >
      <View style={[styles.row, { columnGap: dp(11) }]}>
        <AppIcon name="target" size={dp(24)} color={GOLD_ICON} />
        <View style={styles.flex}>
          <ModuleText token="cardTitle" numberOfLines={1}>
            {met ? 'Today’s reading goal met' : 'Reading today'}
          </ModuleText>
          <ModuleText token="caption" numberOfLines={1}>
            {`${readToday} of ${log.dailyGoal} verses`}
          </ModuleText>
          <View style={{ marginTop: dp(7) }}>
            <ModuleProgressBar
              value={log.dailyGoal === 0 ? 0 : Math.min(1, readToday / log.dailyGoal)}
              accessibilityLabel={`${readToday} of ${log.dailyGoal} verses toward today's goal`}
              testID="faith-reading-progress-bar"
            />
          </View>
        </View>
        <AppIcon name="chevron-forward" size={dp(16)} color={moduleNeutrals.textTertiary} />
      </View>
    </ModuleCard>
  );
}

/**
 * Today's verse, fetched live.
 *
 * ── There is no Arabic in this file ─────────────────────────────────────────
 * The card used to render a verse held as a string literal in `faith-view-model.ts` — scripture in
 * the JS bundle, from no attributed source, outside the boundary the Quran Foundation integration
 * exists to enforce. The verse and its translation now arrive from the approved source, chosen by
 * date. See `daily-ayah-rotation.ts`, which holds surah and ayah *numbers* and no text.
 */
/**
 * How much of the verse the home card previews.
 *
 * ── Why the card is bounded at all ──────────────────────────────────────────
 * It was not, and the longest verse in the Qur'an found the gap. 2:286 rendered in full drove the
 * card past 500 dp, and because the Verse and Worship cards share a row, Worship stretched to match
 * an empty height it had nothing to put in. The Ramadan, Islamic Calendar and Faith AI cards were
 * pushed off the screen by a single day's verse — so the home screen's composition depended on
 * which ayah the rotation happened to land on.
 *
 * ── Why line counts rather than a height cap ────────────────────────────────
 * A `maxHeight` crops the final line through its glyphs. Arabic carries harakat above and below the
 * baseline, so a cropped line is not merely untidy — it can be misread. `numberOfLines` ends on a
 * whole line and ellipsises, which says "there is more" without damaging what it shows.
 *
 * Three Arabic lines and two of translation is what fits the approved compact card. It was measured
 * rather than guessed: at four Arabic lines the pair rendered 226 dp against a 190–220 dp target,
 * and the Faith AI card below it sat just under the fold. Three lands the pair at ~190 dp with the
 * whole composition — Verse, Worship, Ramadan, Islamic Calendar, Faith AI — reachable.
 *
 * Both counts scale with the user's type size rather than being pinned to a pixel height, so an
 * enlarged scale reflows into the same number of larger lines instead of clipping.
 */
const ARABIC_PREVIEW_LINES = 3;
const TRANSLATION_PREVIEW_LINES = 2;

/**
 * Today's verse, as a preview.
 *
 * The complete Arabic and translation live in the reader, which this card opens at the exact surah
 * and ayah it is previewing. Nothing here is a shortened *source* — the repository returns the whole
 * verse and the clamp is presentational, so the reader has the full text without a second request.
 */
function DailyAyahCard({ onOpen }: { readonly onOpen: () => void }) {
  const { dp } = useModuleMetrics();
  const { quran } = useFaithRepositories();
  const { translation } = useTranslationPreference();

  const ayah = useFaithResource(
    `faith.home.daily-ayah.${translation?.id ?? 'unresolved'}`,
    useCallback(
      // See the note in `daily-ayah-screen.tsx`: no resolved edition means nothing to request.
      async () =>
        translation === null
          ? ({ kind: 'error', code: 'unavailable' } as const)
          : await quran.getAyahOfTheDay(translation.id),
      [quran, translation],
    ),
  );

  // `result` only exists once settled — the union is what makes "not yet" distinct from "none".
  const verse = ayah.status !== 'loading' && hasData(ayah.result) ? ayah.result.data : null;

  const body =
    ayah.status === 'loading' ? (
      <CardSkeleton rows={3} testID="faith-ayah-skeleton" />
    ) : verse !== null ? (
      <>
        {/*
          A preview, clamped to four lines. See the note above the component for why this card is
          bounded and why the bound is a line count rather than a height.
        */}
        <ArabicText numberOfLines={ARABIC_PREVIEW_LINES} testID="faith-ayah-arabic">
          {verse.text.arabic}
        </ArabicText>
        <ModuleText
          token="body"
          numberOfLines={TRANSLATION_PREVIEW_LINES}
          style={{ marginTop: dp(6) }}
        >
          {verse.translation.text}
        </ModuleText>
        {/*
          The reference stays visible whatever the verse's length — it is the one line that says
          *which* verse this preview is of, so a clamp that pushed it out would leave an unattributed
          fragment of scripture on the home screen.
        */}
        <ModuleText token="caption" numberOfLines={1} style={{ marginTop: dp(6) }}>
          {`Surah ${verse.text.surah}:${verse.text.ayah}`}
        </ModuleText>
        <UnverifiedSourceNotice source={verse.text.source} testID="faith-ayah" />
      </>
    ) : (
      /*
        No verse today rather than yesterday's verse or an invented one. The card keeps its heading
        and its tap target so the section does not collapse, and says plainly that it has nothing.
      */
      <ModuleText token="caption" numberOfLines={3} style={{ marginTop: dp(6) }}>
        Today’s verse could not be loaded. Tap to try again.
      </ModuleText>
    );

  return (
    <ModuleCard
      onPress={onOpen}
      /*
        ── The spoken label is not the clamped preview ─────────────────────────
        The visual preview is deliberately cut, and a screen-reader user must not be handed the same
        cut as though it were the verse. The label names the surah and ayah, says the preview is
        partial, and says what a tap does — so the truncation is described rather than reproduced.

        The full Arabic is *not* read out here: this is a home-screen card in a scrolling list, and
        a screen reader announcing an entire verse on focus would bury the six cards around it. The
        reader is one tap away and is where the complete text belongs.
      */
      accessibilityLabel={
        verse === null
          ? 'Verse of the day. Opens in full.'
          : `Verse of the day. Surah ${verse.text.surah}, ayah ${verse.text.ayah}. Preview only — opens the complete verse and translation in the reader.`
      }
      padding={moduleLayout.twoColumnPadding}
      style={styles.fillHeight}
      testID="faith-ayah"
    >
      <ModuleText token="cardTitle" numberOfLines={1}>
        Verse of the day
      </ModuleText>
      {body}
    </ModuleCard>
  );
}

/**
 * The user's own worship marks for today.
 *
 * The four rows used to be a constant with fixed times and fixed statuses. They are now the day's
 * real record: which acts are tracked comes from the worship repository's seed, and each row's
 * status is either what the user marked or what the clock implies for an unmarked one.
 */
function WorshipCard({ onViewAll }: { readonly onViewAll: () => void }) {
  const { worship } = useFaithRepositories();
  const today = new Date().toISOString().slice(0, 10);

  const day = useFaithResource(
    `faith.home.worship.${today}`,
    useCallback(() => worship.getDay(today), [worship, today]),
  );

  return (
    <ModuleCard
      padding={moduleLayout.twoColumnPadding}
      style={styles.fillHeight}
      testID="faith-worship"
    >
      <ModuleCardHeading
        title="Today’s worship"
        actionLabel="View All"
        onAction={onViewAll}
        testID="faith-worship-viewall"
      />
      {day.status === 'loading' ? (
        <CardSkeleton rows={4} testID="faith-worship-skeleton" />
      ) : hasData(day.result) ? (
        <WorshipRows day={day.result.data} />
      ) : (
        <ModuleText token="caption" numberOfLines={2}>
          Your worship record could not be read from this device.
        </ModuleText>
      )}
    </ModuleCard>
  );
}

/**
 * The prayers, and nothing else.
 *
 * Filtered to `kind === 'prayer'` and capped at four so the card keeps the height it shares with the
 * verse card beside it. "View All" is right above and reaches the rest, so the cap hides nothing
 * that cannot be reached in one tap.
 */
function WorshipRows({ day }: { readonly day: WorshipDay }) {
  const { dp } = useModuleMetrics();
  const rows = day.entries.filter((entry) => entry.kind === 'prayer').slice(0, 4);

  return (
    <View style={{ rowGap: dp(7) }}>
      {rows.map((entry) => (
        <WorshipRow
          key={entry.key}
          label={entry.label}
          detail={entry.detail}
          status={entry.status}
        />
      ))}
    </View>
  );
}

/**
 * Today's Hijri date, calculated at the user's prayer location.
 *
 * `basis` is rendered as a word rather than assumed away: a Hijri date derived arithmetically can
 * differ from the observed one by a day, and a card that printed it as settled fact would be
 * asserting something no calculation can know.
 *
 * ── Why it takes the hero's resource instead of fetching its own ────────────
 * It used to call `calendar.getToday()` on its own, and that method resolved the day from the
 * device. Two independent lookups for one screen, and around midnight they could name different
 * days — this card saying one date while the hero two rows up counted down to a prayer from
 * another.
 *
 * Now there is one resource. The same `PrayerLocation` produces the hero's next prayer and this
 * card's date, in a single `Promise.all` inside `useFaithHome`, so the two **cannot** disagree:
 * there is no second request to be in flight, no cache to be warm for one caller and cold for the
 * other, and nothing to reconcile when it lands.
 *
 * ── Why the unresolved states name themselves ───────────────────────────────
 * The old card fell back to the generic "Hijri date / Hijri dates alongside Gregorian" for every
 * non-settled state, which read as a title rather than as an absence. Each state now says which one
 * it is, and none of them prints a date.
 */
function HijriTodayCard({
  today,
  onPress,
}: {
  /** The hero's own resource. Shared deliberately — see the note above. */
  readonly today: UseFaithResource<NextPrayerView>;
  readonly onPress: () => void;
}) {
  const settled = today.status === 'settled' && hasData(today.result) ? today.result.data : null;

  const copy =
    settled !== null
      ? {
          title: settled.today.hijri.formatted,
          detail: `${settled.today.gregorian} • calculated`,
        }
      : today.status === 'loading'
        ? // Honest about what is happening, and carrying no date while it happens.
          { title: 'Calculating…', detail: 'Working out today’s date where you are' }
        : today.result.kind === 'permission-required'
          ? {
              title: 'Location needed',
              detail: 'Today’s Hijri date depends on where you are',
            }
          : {
              /*
                Covers a zone the platform cannot resolve and a stored location too old to date from.
                Both are `unavailable` from the repository, and both are states in which the only
                honest thing to print is that there is no date — not a plausible one.
              */
              title: 'Date unavailable',
              detail: 'Today’s Hijri date could not be calculated',
            };

  return (
    <CompactDateCard
      icon="calendar"
      pictogram="calendar"
      iconColor={GOLD_ICON}
      eyebrow="Islamic calendar"
      title={copy.title}
      detail={copy.detail}
      onPress={onPress}
      testID="faith-calendar"
    />
  );
}

/**
 * The eight approved submenu tiles: two rows of four, in the reference's order.
 *
 * ── Approved PNG pictograms, not icon-font glyphs ───────────────────────────
 * The eight marks come from `faithSubmenu`, which holds a literal `require` per tile. There is no
 * fallback path — `source` is required by the entry type, so a tile without its PNG cannot be
 * constructed.
 *
 * ── The rendering rules, and where each one lives ───────────────────────────
 *   • `contain`, so a pictogram is never cropped or stretched     → `resizeMode`
 *   • no tint                                                     → no `tintColor` prop
 *   • no background, no border, no second icon well               → the `Image` has no
 *     wrapper of its own; the tile surface is the only container
 *   • identical image box for all eight                           → one `imageBox` value
 *   • ≥44 dp touch target                                         → `minHeight` on the tile
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
function WorshipRow({
  label,
  detail,
  status,
}: {
  readonly label: string;
  /** Absent when no location has been granted, so no time could be calculated. */
  readonly detail?: string;
  readonly status: WorshipEntryStatus;
}) {
  const module = useModule();
  const { dp } = useModuleMetrics();

  const SPOKEN: Readonly<Record<WorshipEntryStatus, string>> = {
    completed: 'Completed',
    current: 'Current prayer',
    upcoming: 'Upcoming',
    missed: 'Not marked',
  };

  const size = dp(16);

  return (
    <View
      style={[styles.worshipRow, { columnGap: dp(8), minHeight: dp(20) }]}
      accessible
      // The time is spoken only when there is one, so a row without a calculated time does not
      // announce a trailing comma into a screen reader.
      accessibilityLabel={statusLabel(
        detail === undefined ? label : `${label}, ${detail}`,
        SPOKEN[status],
      )}
      testID={`faith-worship-${label.toLowerCase().replace(/\s+/g, '-')}`}
    >
      {status === 'completed' ? (
        <AppIcon name="check-circle" size={size} color={module.theme.ink} />
      ) : status === 'current' ? (
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
      {/*
        Two lines, so a prayer name is never abbreviated. "Maghrib Prayer" beside "8:04 PM" fits the
        half-width card at 411 dp and does not at 393 dp or below, where it rendered "Maghrib Pray…"
        — and an ellipsised prayer name is the one thing this checklist cannot afford to get wrong.
        The row is content-height, so the second line grows the card instead of clipping.
      */}
      <ModuleText token="rowLabel" numberOfLines={2} style={styles.flex}>
        {label}
      </ModuleText>
      {/*
        Nothing rather than an empty line. The row's job is the act and its tick state; the time is
        supporting information the checklist can do without, and reserving a blank column for a
        string that is not coming just makes the label column narrower for no reason.
      */}
      {detail === undefined ? null : (
        <ModuleText token="rowMeta" numberOfLines={1}>
          {detail}
        </ModuleText>
      )}
    </View>
  );
}

function CompactDateCard({
  icon,
  iconColor,
  pictogram,
  eyebrow,
  title,
  detail,
  onPress,
  testID,
}: {
  /**
   * Vector fallback, used only where no approved pictogram exists.
   *
   * Upcoming/observances has none in the design pack, so it keeps a restrained crescent rather than
   * borrowing an unrelated mark. Recorded in `docs/FAITH_ASSET_GAPS.md`.
   */
  readonly icon: 'crescent' | 'calendar';
  readonly iconColor: string;
  /** The approved pictogram, where one exists. Takes precedence over `icon`. */
  readonly pictogram?: FaithSubmenuKey;
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
        {pictogram === undefined ? (
          <AppIcon name={icon} size={dp(24)} color={iconColor} />
        ) : (
          <Image
            source={getFaithSubmenuEntry(pictogram).source}
            style={{
              width: dp(moduleLayout.faithCompactImage),
              height: dp(moduleLayout.faithCompactImage),
            }}
            resizeMode="contain"
            accessible={false}
            testID={`${testID}-image`}
          />
        )}
        <View style={styles.flex}>
          <ModuleText token="rowMeta" numberOfLines={1}>
            {eyebrow}
          </ModuleText>
          <ModuleText token="rowLabel" numberOfLines={2}>
            {title}
          </ModuleText>
          {/*
            Uncapped, because every cap tried still hid a date. The detail is the only part of this
            card carrying information — "In 180 days • expected 2027-02-08", "2026-08-12 •
            calculated" — and at one line those rendered "In 180 days • expec…" and "2026-08-12 •
            calc…", at two the Ramadan card still stopped at "• expected 2027-0…". A date that is
            announced and then hidden is worse than no date.

            Safe to leave unbounded: the card is content-height, and `fillHeight` only equalises the
            pair, so a longer detail grows both cards rather than clipping either. This is the
            "compact cards may grow" case the correction brief allows.
          */}
          <ModuleText token="rowMeta">{detail}</ModuleText>
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
  /**
   * Equalises a pair of cards side by side, and gets out of the way when they stack.
   *
   * ── Why the basis is `auto` rather than `flex: 1` ───────────────────────────
   * `flex: 1` is `flexGrow: 1, flexShrink: 1, flexBasis: 0`, and the zero basis is what breaks once
   * `ModuleTwoColumn` switches to a vertical stack: the stacked wrapper has no definite height, so a
   * child measuring from a zero basis has nothing to grow into and collapses.
   *
   * With `auto` the basis is the card's own content height. Side by side the wrapper is stretched to
   * the taller sibling, so the card still grows to fill it and the pair still lines up; stacked, the
   * wrapper is content-sized, there is no free space to distribute, and the card is exactly as tall
   * as its copy needs. One declaration, correct in both layouts, and no call site has to know which
   * one it is in.
   */
  fillHeight: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 'auto',
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
  worshipRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
});
